import { AcquisitionError, endpoints } from './api.js';

export type MyHomeAccessMode = 'LIVE' | 'PROBE' | 'CACHE_ONLY';
export interface MyHomeAccessDecision { mode: MyHomeAccessMode; retryAt: string | null }
export interface MyHomeAccessStore {
  /** Durable decision from ingress; `startup` never spends the post-cooldown probe. */
  decide(purpose: 'run' | 'startup'): Promise<MyHomeAccessDecision>;
  restrict(evidence: string): Promise<void>;
  recovered(): Promise<void>;
}

/** First cooldown step: the local latch never outlives the durable cooldown. */
export const LOCAL_COOLDOWN_MS = 15 * 60_000;

/** Shared transport policy. A real refusal (401/403/challenge) stops this
 * process from contacting MyHome for a bounded time and records a durable,
 * bounded cooldown; it is never a permanent ban and never needs a manual
 * clearance. No retry, rotation or challenge interaction. Only dictionaries
 * are cached here, never customer listings or asking prices.
 */
export class MyHomeEngine {
  private blockedUntil = 0;
  private store: MyHomeAccessStore | null = null;
  private dictionaries = new Map<string, { expires: number; value: unknown }>();
  constructor(private now = Date.now) {}
  configure(store: MyHomeAccessStore) { this.store = store; }
  private local(): MyHomeAccessDecision | null {
    return this.now() < this.blockedUntil ? { mode: 'CACHE_ONLY', retryAt: new Date(this.blockedUntil).toISOString() } : null;
  }
  /** Throws only when the durable state cannot be read; callers treat that as transient. */
  async ready(purpose: 'run' | 'startup' = 'run'): Promise<MyHomeAccessDecision> {
    return this.local() ?? (this.store ? await this.store.decide(purpose) : { mode: 'LIVE', retryAt: null });
  }
  async recovered() { await this.store?.recovered().catch(() => {}); }
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    // Another run in this process was refused: do not navigate through it.
    if (this.local()) throw new AcquisitionError('https://www.myhome.ge', 403, 'ACCESS_RESTRICTED; provider cooling down; request not sent');
    try { return await operation(); }
    catch (error) {
      if (error instanceof AcquisitionError && error.category === 'ACCESS_RESTRICTED') {
        this.blockedUntil = this.now() + LOCAL_COOLDOWN_MS;
        this.dictionaries.clear();
        // The local latch holds even if the durable write fails.
        await this.store?.restrict(error.message.slice(0, 300)).catch(() => {});
      }
      throw error;
    }
  }
  async dictionary<T>(url: string, locale: string, load: () => Promise<T>): Promise<T> {
    if (![endpoints.locations, endpoints.filters].includes(url)) return this.guard(load);
    const key = `${locale}:${url}`, cached = this.dictionaries.get(key);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value) as T;
    const value = await this.guard(load);
    if (!this.dictionaries.has(key) && this.dictionaries.size >= 12) this.dictionaries.delete(this.dictionaries.keys().next().value!);
    this.dictionaries.set(key, { value: structuredClone(value), expires: this.now() + 3_600_000 });
    return value;
  }
  status() { return { access: this.local() ? 'COOLING_DOWN' : 'UNKNOWN', blockedUntil: this.local()?.retryAt ?? null, cachedDictionaries: this.dictionaries.size }; }
}

export const myHomeEngine = new MyHomeEngine();
