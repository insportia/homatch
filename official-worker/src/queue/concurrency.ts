/*
 * Bounded concurrency for the evidence write-back (2026-10-30 speed audit).
 *
 * A TAS run stored every visual, raw reply and full text ONE upload at a time — 57–96 uploads,
 * each an edge gateway call plus a signed PUT to our own storage, 30–49 s per run after the
 * archive work was done. They are independent and content-addressed (the same bytes always land
 * at the same path), so a few at a time is safe. This only ever talks to HOMATCH's own storage,
 * never to an official website.
 */
export const EVIDENCE_UPLOAD_CONCURRENCY = 4;

/**
 * fn over items with at most `limit` in flight. Results come back in the items' order, one
 * settled outcome per item; a failure never stops the others (the caller decides what it means).
 */
export async function mapSettled<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  }));
  return out;
}
