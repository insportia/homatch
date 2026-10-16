// HOMATCH Verify — the browser side of report-content translation.
//
// One ReportTranslator per target language. It answers `lookup(text)` from
// memory (shared by every report on the page, seeded from sessionStorage), and
// `request(text)` queues an unknown Georgian text; queued texts are sent in
// debounced batches (CLIENT_BATCH_* limits, a few requests in flight) to
// verify-synthesis `translate`. Every answer lands in memory and
// sessionStorage and notifies subscribers, which re-render the page in the
// customer's language. Nothing here ever blocks: an unknown text is simply
// shown in Georgian until its translation arrives.
//
// Pure TypeScript with injected I/O (send, storage, timers), so node:test
// covers caching, batching and failure handling without a browser.

import { CLIENT_BATCH_CHARS, CLIENT_BATCH_TEXTS, isTranslatable, normalizeSource, type TranslationLang } from './textTranslation.ts';

export type SendBatch = (texts: string[]) => Promise<Record<string, string>>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TranslatorOptions {
  lang: TranslationLang;
  send: SendBatch;
  storage?: StorageLike | null;
  debounceMs?: number;
  maxBatchTexts?: number;
  maxBatchChars?: number;
  concurrency?: number;
  /** A text whose request failed is asked for again after this long. */
  retryAfterMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

export const STORAGE_PREFIX = 'homatch.verifyTr.v1.';
/** sessionStorage is small; a language's cache above this is not persisted (memory still holds it). */
const STORAGE_MAX_CHARS = 2_500_000;

/** Memory shared by every translator of a language on this page. */
const MEMORY = new Map<string, Map<string, string>>();
export const memoryFor = (lang: string): Map<string, string> => {
  let m = MEMORY.get(lang);
  if (!m) { m = new Map(); MEMORY.set(lang, m); }
  return m;
};
/** Tests only. */
export const resetTranslationMemory = (): void => MEMORY.clear();

export class ReportTranslator {
  readonly lang: TranslationLang;
  private readonly send: SendBatch;
  private readonly storage: StorageLike | null;
  private readonly memory: Map<string, string>;
  private readonly debounceMs: number;
  private readonly maxBatchTexts: number;
  private readonly maxBatchChars: number;
  private readonly concurrency: number;
  private readonly retryAfterMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly now: () => number;

  private readonly queue = new Set<string>();
  private readonly inflight = new Set<string>();
  /** text → when it may be asked for again. */
  private readonly failedUntil = new Map<string, number>();
  /** Called when translations land. */
  private readonly listeners = new Set<() => void>();
  /** Called when the number of pending texts changes. */
  private readonly pendingListeners = new Set<() => void>();
  private timerArmed = false;
  private running = 0;
  private persistArmed = false;
  private retryArmed = false;
  private stopped = false;

  constructor(o: TranslatorOptions) {
    this.lang = o.lang;
    this.send = o.send;
    this.storage = o.storage ?? null;
    this.memory = memoryFor(o.lang);
    this.debounceMs = o.debounceMs ?? 50;
    this.maxBatchTexts = o.maxBatchTexts ?? CLIENT_BATCH_TEXTS;
    this.maxBatchChars = o.maxBatchChars ?? CLIENT_BATCH_CHARS;
    this.concurrency = o.concurrency ?? 3;
    this.retryAfterMs = o.retryAfterMs ?? 60_000;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.now = o.now ?? (() => Date.now());
    this.load();
  }

  /** The translation when known, else undefined. */
  lookup(text: string): string | undefined {
    return this.memory.get(normalizeSource(text));
  }

  /** The translation when known, else the original — and the original is queued. */
  tr(text: string): string {
    if (!isTranslatable(text)) return text;
    const hit = this.lookup(text);
    if (hit !== undefined) {
      const lead = /^\s*/.exec(text)![0];
      const trail = /\s*$/.exec(text)![0];
      return lead + hit + trail;
    }
    this.request(text);
    return text;
  }

  /** Queues a text for translation unless it is known, queued, in flight or recently failed. */
  request(text: string): void {
    if (this.stopped || !isTranslatable(text)) return;
    const t = normalizeSource(text);
    if (this.memory.has(t) || this.queue.has(t) || this.inflight.has(t)) return;
    const until = this.failedUntil.get(t);
    if (until !== undefined && until > this.now()) return;
    this.queue.add(t);
    this.arm();
    this.notifyPending();
  }

  prefetch(texts: Iterable<string>): void {
    for (const t of texts) this.request(t);
  }

  /** Texts queued or in flight — what the "translating…" indicator shows. */
  get pending(): number {
    return this.queue.size + this.inflight.size;
  }

  /** fn runs whenever a batch of translations has landed. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** fn runs whenever `pending` changes (the "translating…" indicator). */
  subscribePending(fn: () => void): () => void {
    this.pendingListeners.add(fn);
    return () => { this.pendingListeners.delete(fn); };
  }

  /** Stops sending; what is in flight still lands in the shared memory. */
  stop(): void {
    this.stopped = true;
    this.queue.clear();
    this.listeners.clear();
    this.pendingListeners.clear();
  }

  /** Sends everything queued now (tests, and the debounce timer). */
  async flush(): Promise<void> {
    this.timerArmed = false;
    const runs: Promise<void>[] = [];
    while (this.queue.size && this.running < this.concurrency) {
      const batch = this.takeBatch();
      if (!batch.length) break;
      runs.push(this.run(batch));
    }
    await Promise.all(runs);
  }

  private arm(): void {
    if (this.timerArmed) return;
    this.timerArmed = true;
    this.setTimer(() => { void this.flush(); }, this.debounceMs);
  }

  private takeBatch(): string[] {
    const batch: string[] = [];
    let chars = 0;
    for (const t of this.queue) {
      if (batch.length >= this.maxBatchTexts) break;
      if (batch.length && chars + t.length > this.maxBatchChars) break;
      batch.push(t);
      chars += t.length;
    }
    for (const t of batch) { this.queue.delete(t); this.inflight.add(t); }
    return batch;
  }

  private async run(batch: string[]): Promise<void> {
    this.running++;
    let answer: Record<string, string> = {};
    try {
      answer = (await this.send(batch)) ?? {};
    } catch {
      answer = {};
    }
    this.running--;
    let learned = 0;
    for (const t of batch) {
      this.inflight.delete(t);
      const v = answer[t];
      if (typeof v === 'string' && v.trim()) {
        this.memory.set(t, v);
        this.failedUntil.delete(t);
        learned++;
      } else {
        this.failedUntil.set(t, this.now() + this.retryAfterMs);
      }
    }
    if (learned) { this.persist(); this.notify(this.listeners); }
    this.notifyPending();
    // Texts that came back untranslated are asked for once more after the
    // back-off: the listeners (the DOM layer) look at the page again then.
    if (learned < batch.length && !this.retryArmed) {
      this.retryArmed = true;
      this.setTimer(() => { this.retryArmed = false; if (!this.stopped) this.notify(this.listeners); }, this.retryAfterMs + 50);
    }
    // More was queued while this batch travelled.
    if (this.queue.size && !this.stopped) this.arm();
  }

  private notify(set: Set<() => void>): void {
    for (const fn of [...set]) {
      try { fn(); } catch { /* a listener never breaks the translator */ }
    }
  }

  private pendingNotifyArmed = false;
  /** Coalesced: a render pass can queue hundreds of texts at once. */
  private notifyPending(): void {
    if (this.pendingNotifyArmed) return;
    this.pendingNotifyArmed = true;
    this.setTimer(() => { this.pendingNotifyArmed = false; this.notify(this.pendingListeners); }, 0);
  }

  private key(): string { return STORAGE_PREFIX + this.lang; }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key());
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && !this.memory.has(k)) this.memory.set(k, v);
    } catch { /* a broken cache is an empty cache */ }
  }

  private persist(): void {
    if (!this.storage || this.persistArmed) return;
    this.persistArmed = true;
    this.setTimer(() => {
      this.persistArmed = false;
      try {
        const s = JSON.stringify(Object.fromEntries(this.memory));
        if (s.length > STORAGE_MAX_CHARS) { this.storage!.removeItem(this.key()); return; }
        this.storage!.setItem(this.key(), s);
      } catch { /* full or blocked storage: memory still holds it */ }
    }, 250);
  }
}
