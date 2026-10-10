import { AcquisitionError, endpoints } from './api.js';

export interface MyHomeAccessStore {
  restricted(): Promise<boolean>;
  restrict(): Promise<void>;
}

/** Shared transport policy. Access restrictions require deliberate operator
 * clearance; no timeout, automatic source probe or challenge interaction.
 * Only dictionaries are cached, never customer listings or asking prices.
 */
export class MyHomeEngine {
  private restricted = false;
  private store: MyHomeAccessStore | null = null;
  private dictionaries = new Map<string, { expires: number; value: unknown }>();
  constructor(private now = Date.now) {}
  configure(store: MyHomeAccessStore) { this.store = store; }
  async ready() {
    if (this.restricted || await this.store?.restricted()) {
      this.restricted = true;
      throw new AcquisitionError('https://www.myhome.ge', 403, 'ACCESS_RESTRICTED; provider circuit open; authorized access required');
    }
  }
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    if (this.restricted) await this.ready();
    try { return await operation(); }
    catch (error) {
      if (error instanceof AcquisitionError && error.category === 'ACCESS_RESTRICTED') {
        this.restricted = true;
        this.dictionaries.clear();
        // Preserve the source error and local latch if durable storage fails.
        // Existing ACCESS_DENIED run evidence also survives worker restarts.
        await this.store?.restrict().catch(() => {});
      }
      throw error;
    }
  }
  async dictionary<T>(url: string, locale: string, load: () => Promise<T>): Promise<T> {
    if (![endpoints.locations, endpoints.filters].includes(url)) return this.guard(load);
    if (this.restricted) await this.ready();
    const key = `${locale}:${url}`, cached = this.dictionaries.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value) as T;
    const value = await this.guard(load);
    if (!this.dictionaries.has(key) && this.dictionaries.size >= 12) this.dictionaries.delete(this.dictionaries.keys().next().value!);
    this.dictionaries.set(key, { value: structuredClone(value), expires: this.now() + 3_600_000 });
    return value;
  }
  status() { return { access: this.restricted ? 'ACCESS_RESTRICTED' : 'UNKNOWN', cachedDictionaries: this.dictionaries.size }; }
}

export const myHomeEngine = new MyHomeEngine();
