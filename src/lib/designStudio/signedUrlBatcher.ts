// SIGNED CATALOGUE URLS — asked for together, kept until they expire.
//
// Browsing the catalogue must not mint a URL per row on mount: a 2,000-row
// result would be 2,000 signing calls before anybody scrolls. Rows ask for
// their thumbnail only once they are on screen; requests arriving within a
// short window (~50 ms) are collected and signed in ONE call, and the URL is
// cached for the session until shortly before it expires, then re-signed on
// the next request. A key that cannot be signed resolves null (the row shows
// its drawn swatch) and is not retried for a minute.
//
// Pure: the signer, the clock and the scheduler are injected, so the logic
// is tested without a network or timers.

export interface SignedUrlBatcherOptions {
  /** Sign many keys at once; a key that cannot be signed is simply absent. */
  sign: (keys: string[]) => Promise<Map<string, string>>;
  /** URL lifetime the signer is asked for, in seconds. */
  expiresInS?: number;
  /** How long before expiry a cached URL is treated as gone, in ms. */
  safetyMarginMs?: number;
  /** How long requests are collected before one signing call, in ms. */
  windowMs?: number;
  /** How long a failed key is left alone before it may be asked for again, in ms. */
  failureBackoffMs?: number;
  /** Largest number of keys in one signing call. */
  maxBatch?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export interface SignedUrlBatcher {
  /** A still-valid cached URL, without asking for anything. */
  peek(key: string): string | null;
  /** The URL for a key (batched with whatever else is asked for in the same window). */
  get(key: string): Promise<string | null>;
  /** Forget a key (its URL failed to load): the next get() signs it again. */
  invalidate(key: string): void;
  /** Number of signing calls made so far (observability and tests). */
  readonly calls: number;
}

interface Entry { url: string | null; expiresAt: number }

export function createSignedUrlBatcher(options: SignedUrlBatcherOptions): SignedUrlBatcher {
  const expiresInS = options.expiresInS ?? 600;
  const margin = options.safetyMarginMs ?? 60_000;
  const windowMs = options.windowMs ?? 50;
  const backoff = options.failureBackoffMs ?? 60_000;
  const maxBatch = Math.max(1, options.maxBatch ?? 60);
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const cache = new Map<string, Entry>();
  const waiting = new Map<string, Array<(url: string | null) => void>>();
  const inflight = new Map<string, Promise<string | null>>();
  let timer = false;
  let calls = 0;

  const fresh = (key: string): Entry | null => {
    const e = cache.get(key);
    if (!e) return null;
    if (e.expiresAt <= now()) { cache.delete(key); return null; }
    return e;
  };

  async function flush() {
    timer = false;
    const batch = [...waiting.entries()];
    waiting.clear();
    for (let i = 0; i < batch.length; i += maxBatch) {
      const chunk = batch.slice(i, i + maxBatch);
      const keys = chunk.map(([k]) => k);
      calls += 1;
      let signed: Map<string, string>;
      try {
        signed = await options.sign(keys);
      } catch {
        signed = new Map();
      }
      const at = now();
      for (const [key, resolvers] of chunk) {
        const url = signed.get(key) ?? null;
        cache.set(key, url
          ? { url, expiresAt: at + expiresInS * 1000 - margin }
          : { url: null, expiresAt: at + backoff });
        inflight.delete(key);
        for (const r of resolvers) r(url);
      }
    }
  }

  return {
    peek(key) {
      return fresh(key)?.url ?? null;
    },
    get(key) {
      if (!key) return Promise.resolve(null);
      const hit = fresh(key);
      if (hit) return Promise.resolve(hit.url);
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = new Promise<string | null>((resolve) => {
        waiting.set(key, [resolve]);
      });
      inflight.set(key, p);
      if (!timer) {
        timer = true;
        schedule(() => { void flush(); }, windowMs);
      }
      return p;
    },
    invalidate(key) {
      cache.delete(key);
    },
    get calls() { return calls; },
  };
}
