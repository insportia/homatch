/** One context per operation; never reuse an authenticated context across jobs. */
export class BrowserPool {
  #browser;
  #launching;
  #active = new Set();
  #accounts = new Set();
  #closed = false;
  constructor({ launch, maxContexts = 2, timeoutMs = 90_000 }) {
    if (!Number.isInteger(maxContexts) || maxContexts < 1 || maxContexts > 8 || timeoutMs < 1000 || timeoutMs > 300_000) throw new Error('INVALID_BROWSER_LIMITS');
    Object.assign(this, { launch, maxContexts, timeoutMs });
  }
  get active() { return this.#active.size; }
  async run({ userId, portalId, accountId, storageState, signal }, execute) {
    const account = JSON.stringify([userId, portalId, accountId]);
    if (![userId, portalId, accountId].every(v => typeof v === 'string' && v)) throw new Error('INVALID_BROWSER_IDENTITY');
    if (this.#closed || this.active >= this.maxContexts || this.#accounts.has(account)) throw new Error('BROWSER_BACKPRESSURE');
    const token = {};
    this.#active.add(token);
    this.#accounts.add(account);
    let context;
    let timer;
    const close = () => { void context?.close().catch(() => {}); };
    try {
      signal?.throwIfAborted();
      if (!this.#browser?.isConnected()) {
        this.#launching ??= this.launch().finally(() => { this.#launching = undefined; });
        this.#browser = await this.#launching;
      }
      signal?.throwIfAborted();
      if (this.#closed) throw new Error('BROWSER_POOL_CLOSED');
      context = await this.#browser.newContext({ storageState, acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(15_000);
      context.setDefaultNavigationTimeout(30_000);
      // Nothing is recorded by default: traces/HAR/DOM may contain PII, credentials and cookies.
      signal?.addEventListener('abort', close, { once: true });
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { close(); reject(new Error('BROWSER_TIMEOUT')); }, this.timeoutMs); });
      return await Promise.race([execute(context), timeout]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', close);
      await context?.close().catch(() => {});
      this.#accounts.delete(account);
      this.#active.delete(token);
    }
  }
  async close() {
    this.#closed = true;
    await this.#launching?.catch(() => {});
    await this.#browser?.close();
  }
}
