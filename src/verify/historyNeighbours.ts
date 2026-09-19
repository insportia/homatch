/*
 * WHICH STORED REPORT SITS EITHER SIDE OF THIS ONE.
 *
 * Verify's history is what listVerifyHistory returns: every research run the
 * customer has started, newest first, soft-deleted rows already excluded.
 * That order is the whole basis for "newer" and "older" here — it is not
 * re-sorted, because a second ordering would eventually disagree with the
 * list the customer is looking at, and then the arrows would lie.
 *
 * WHY THIS IS NOT INLINE IN THE PAGE. The interesting part is entirely the
 * boundaries: the newest report has no newer, the oldest has no older, a
 * report that is not in the history has neither, and one report alone has
 * nothing at all. Those are four cases that a component cannot be made to
 * demonstrate without rendering it, and they are exactly where an off-by-one
 * hides — so they live here, where a test can simply ask.
 *
 * Returning null rather than `{newer: null, older: null}` is deliberate: the
 * caller renders NOTHING in that case, and a pair of permanently disabled
 * arrows is worse than no arrows at all.
 */

/** The minimum this needs from a history row. */
export interface HistoryEntry {
  id: string;
}

export interface Neighbours<T extends HistoryEntry> {
  /** The run started after this one. Null at the newest end. */
  newer: T | null;
  /** The run started before this one. Null at the oldest end. */
  older: T | null;
}

export function neighboursFor<T extends HistoryEntry>(
  /** Newest first, exactly as listVerifyHistory returns it. */
  history: readonly T[],
  currentId: string | null | undefined
): Neighbours<T> | null {
  const id = typeof currentId === 'string' ? currentId : '';
  if (!id || history.length < 2) return null;

  const i = history.findIndex((entry) => entry.id === id);
  // Not in the history: an anonymous run, a job still being written, or one
  // the customer has since deleted. Nothing can be said about its neighbours.
  if (i < 0) return null;

  const newer = i > 0 ? history[i - 1] : null;
  const older = i < history.length - 1 ? history[i + 1] : null;
  return newer || older ? { newer, older } : null;
}
