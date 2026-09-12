/**
 * UNDO AND REDO FOR THE PAGE BEING EDITED.
 *
 * A page is a plain object that every edit replaces wholly, so history here
 * is a stack of those objects rather than a log of operations to invert.
 * That is a deliberate trade: snapshots cost memory, and buy the property
 * that undo cannot drift from what actually happened. There is no "invert a
 * duplicate" or "invert a reorder" to get subtly wrong, because nothing is
 * inverted — the previous page IS the previous page.
 *
 * WHY IT IS BOUNDED
 *
 * A long editing session would otherwise hold every intermediate page in
 * memory for as long as the tab is open. LIMIT keeps the most recent steps
 * and drops the oldest, which is the half nobody reaches for: an editor who
 * wants the state from forty edits ago wants the published version, and that
 * is what version history is for.
 *
 * WHY REDO IS CLEARED ON EDIT
 *
 * Undo three times, then type: the three futures you abandoned are no longer
 * reachable from where you are. Keeping them would let a redo jump to a page
 * that never followed from this one.
 */

/** How many steps back an editing session can reach. */
export const LIMIT = 60;

export interface History<T> {
  past: readonly T[];
  future: readonly T[];
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/**
 * Record a step. `previous` is the state being left behind.
 *
 * Returns the history only — the caller owns the present, because the
 * present is React state and this module holds no state of its own.
 */
export function record<T>(h: History<T>, previous: T): History<T> {
  const past = [...h.past, previous];
  return {
    past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past,
    future: [],
  };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/**
 * Step back. `present` is what is on screen now, and becomes the future.
 *
 * Returns null when there is nothing to undo, so a caller cannot accidentally
 * treat "no history" as "an empty page".
 */
export function undo<T>(h: History<T>, present: T): { present: T; history: History<T> } | null {
  if (h.past.length === 0) return null;
  const previous = h.past[h.past.length - 1];
  return {
    present: previous,
    history: { past: h.past.slice(0, -1), future: [present, ...h.future] },
  };
}

/** Step forward again, if nothing has been edited since stepping back. */
export function redo<T>(h: History<T>, present: T): { present: T; history: History<T> } | null {
  if (h.future.length === 0) return null;
  const next = h.future[0];
  return {
    present: next,
    history: { past: [...h.past, present], future: h.future.slice(1) },
  };
}

/**
 * Is this keystroke an undo, a redo, or neither?
 *
 * Kept here rather than in the component so the mapping is testable without a
 * browser, and so the two places that need it cannot disagree.
 *
 * Redo has two spellings on purpose: Ctrl+Shift+Z is what the web and macOS
 * use, and Ctrl+Y is what Windows editors use. Somebody who has learned one
 * should not have to learn the other.
 */
export function historyIntent(e: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
}): 'undo' | 'redo' | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  return null;
}
