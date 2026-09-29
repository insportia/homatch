// UNDO AND REDO, AS DATA.
//
// Each entry is a whole transaction: one drag, one colour, or one AI plan
// with forty operations — undone as ONE step, because that is how the
// customer experienced it. Pure: the workspace holds the stacks in state.

import { applyUnchecked, type Transaction } from './operations.ts';
import type { DesignState } from './designState.ts';

export interface HistoryStacks {
  past: Transaction[];
  future: Transaction[];
}

export const HISTORY_LIMIT = 200;

export const emptyHistory = (): HistoryStacks => ({ past: [], future: [] });

export function record(h: HistoryStacks, tx: Transaction): HistoryStacks {
  const past = [...h.past, tx];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, future: [] };
}

export function undo(h: HistoryStacks, state: DesignState): { history: HistoryStacks; state: DesignState; tx: Transaction } | null {
  const tx = h.past[h.past.length - 1];
  if (!tx) return null;
  return { history: { past: h.past.slice(0, -1), future: [tx, ...h.future] }, state: applyUnchecked(state, tx.inverse), tx };
}

export function redo(h: HistoryStacks, state: DesignState): { history: HistoryStacks; state: DesignState; tx: Transaction } | null {
  const tx = h.future[0];
  if (!tx) return null;
  return { history: { past: [...h.past, tx], future: h.future.slice(1) }, state: applyUnchecked(state, tx.ops), tx };
}
