/*
 * EXHAUSTIVE, RESUMABLE KEYSET SCANS — the replacement for "read the first 500".
 *
 * Native matching used to compare a demand against at most MAX_CANDIDATES=500
 * properties (unordered) and a property against at most 600 searches, then retire
 * every match outside that window as if it no longer fitted. A scan here visits
 * EVERY row exactly once, in a deterministic order (ascending key), one bounded
 * page at a time, and stops only at:
 *
 *   the end of the data      → complete: true
 *   the caller's deadline    → complete: false, cursor = last key fully handled
 *
 * The cursor is durable (the caller stores it), so the next invocation resumes
 * where this one stopped: no row is skipped, none is handled twice by a single
 * pass, and nothing is silently truncated. A failing page is retried with
 * backoff; a page that keeps failing throws — an error is never "no rows".
 */

export interface ScanOptions<T> {
  /** Rows strictly after `after` (null = from the start), ascending by key, at most `size`. */
  fetchPage: (after: string | null, size: number) => Promise<T[]>;
  keyOf: (row: T) => string;
  /**
   * Handle one page; the cursor advances only after this resolves. Returning a
   * number n < rows.length means "only the first n rows were handled, stop here"
   * (out of time mid-page): the cursor then points at row n-1 and the scan is
   * incomplete.
   */
  onPage: (rows: T[]) => Promise<void | number> | void | number;
  pageSize?: number;
  /** Resume point from a previous, incomplete scan. */
  startAfter?: string | null;
  /** Epoch ms after which no new page is started. */
  deadlineAt?: number;
  now?: () => number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ScanResult {
  complete: boolean;
  /** Last key fully handled (resume with startAfter = cursor). Null when nothing was handled. */
  cursor: string | null;
  pages: number;
  rows: number;
  /** Largest page held in memory at once — bounded by pageSize. */
  maxPageRows: number;
  retried: number;
}

export const DEFAULT_PAGE_SIZE = 500;

export async function withRetry<R>(fn: () => Promise<R>, retries = 3, sleep = defaultSleep): Promise<{ value: R; retried: number }> {
  let attempt = 0;
  for (;;) {
    try {
      return { value: await fn(), retried: attempt };
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await sleep(Math.min(4_000, 250 * 2 ** (attempt - 1)));
    }
  }
}

function defaultSleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export async function scanAll<T>(options: ScanOptions<T>): Promise<ScanResult> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE));
  const now = options.now ?? Date.now;
  let cursor = options.startAfter ?? null;
  const result: ScanResult = { complete: false, cursor, pages: 0, rows: 0, maxPageRows: 0, retried: 0 };
  for (;;) {
    if (options.deadlineAt != null && now() >= options.deadlineAt) return { ...result, cursor };
    const { value: page, retried } = await withRetry(() => options.fetchPage(cursor, pageSize), options.retries ?? 3, options.sleep);
    result.retried += retried;
    if (!page.length) return { ...result, complete: true, cursor };
    if (page.length > pageSize) throw new Error(`scan page returned ${page.length} rows for a page of ${pageSize}`);
    const last = options.keyOf(page[page.length - 1]);
    if (cursor !== null && !(last > cursor)) throw new Error('scan keys must strictly increase (non-monotonic cursor)');
    const handled = await options.onPage(page);
    if (typeof handled === 'number' && handled < page.length) {
      const n = Math.max(0, Math.floor(handled));
      if (n > 0) cursor = options.keyOf(page[n - 1]);
      result.pages += n > 0 ? 1 : 0;
      result.rows += n;
      result.maxPageRows = Math.max(result.maxPageRows, page.length);
      return { ...result, complete: false, cursor };
    }
    cursor = last;
    result.pages += 1;
    result.rows += page.length;
    result.maxPageRows = Math.max(result.maxPageRows, page.length);
    if (page.length < pageSize) return { ...result, complete: true, cursor };
  }
}

/** Split ids into bounded chunks (PostgREST `in` filters travel in the URL). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Retirement is decided only after a COMPLETE pass: a match whose row was not
 * re-confirmed since the pass started no longer fits. Started-at is taken with a
 * safety margin so clock skew between the edge runtime and Postgres can only keep
 * a stale match one pass longer, never retire a live one.
 */
export const RETIRE_CLOCK_MARGIN_MS = 120_000;
export function scanStartedAt(nowMs: number): string {
  return new Date(nowMs - RETIRE_CLOCK_MARGIN_MS).toISOString();
}
