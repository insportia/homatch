// HOMATCH MARKETPLACE SEARCH — the search lifecycle, derived from real worker state.
//
// A search's status is never set by a timer or a guess; it is computed from
// its worker runs and the processed result set. One slow worker never holds
// the others' results back, one failed worker never fails the search, and
// results become visible as soon as there are enough real ones to show.

import { type WorkerRunStatus, isTerminalWorkerStatus } from './worker-contract.ts';

export type SearchStatus =
  | 'CREATED' | 'READY' | 'DISPATCHING' | 'SEARCHING' | 'PROCESSING' | 'RESULTS_AVAILABLE'
  | 'COMPLETE' | 'PARTIAL_COMPLETE' | 'FAILED' | 'CANCELLED';
export const SEARCH_STATUSES: readonly SearchStatus[] = [
  'CREATED', 'READY', 'DISPATCHING', 'SEARCHING', 'PROCESSING', 'RESULTS_AVAILABLE',
  'COMPLETE', 'PARTIAL_COMPLETE', 'FAILED', 'CANCELLED',
];
export const TERMINAL_SEARCH_STATUSES: readonly SearchStatus[] = ['COMPLETE', 'PARTIAL_COMPLETE', 'FAILED', 'CANCELLED'];
export const isTerminalSearch = (s: SearchStatus) => TERMINAL_SEARCH_STATUSES.includes(s);

/**
 * Results become visible as soon as ONE real property exists, whichever worker
 * produced it: completed sources never wait for slow ones.
 */
export const PROGRESSIVE_MIN_PROPERTIES = 1;

export interface WorkerRunState {
  workerId: string;
  status: WorkerRunStatus;
  deadlineAt: string | null;
  returnedCount: number;
}

export interface ProcessedCounts {
  properties: number;
  strongMatches: number;
}

/** Non-terminal runs past their deadline become TIMED_OUT. Returns the ids that changed. */
export function timedOut(runs: readonly WorkerRunState[], now: Date): string[] {
  return runs
    .filter((r) => !isTerminalWorkerStatus(r.status) && r.deadlineAt && Date.parse(r.deadlineAt) <= now.getTime())
    .map((r) => r.workerId);
}

export function deriveSearchStatus(current: SearchStatus, runs: readonly WorkerRunState[], counts: ProcessedCounts):
  { status: SearchStatus; failureReason: string | null } {
  if (current === 'CANCELLED' || current === 'FAILED') return { status: current, failureReason: null };
  if (!runs.length) return { status: 'FAILED', failureReason: 'NO_ELIGIBLE_WORKERS' };
  const terminal = runs.every((r) => isTerminalWorkerStatus(r.status));
  if (terminal) {
    const succeeded = runs.filter((r) => r.status === 'COMPLETE' || r.status === 'PARTIAL');
    if (!succeeded.length) return { status: 'FAILED', failureReason: 'ALL_WORKERS_FAILED' };
    const allComplete = runs.every((r) => r.status === 'COMPLETE');
    return { status: allComplete ? 'COMPLETE' : 'PARTIAL_COMPLETE', failureReason: null };
  }
  if (counts.properties >= PROGRESSIVE_MIN_PROPERTIES) return { status: 'RESULTS_AVAILABLE', failureReason: null };
  if (runs.some((r) => r.status === 'RESULTS_RECEIVED' || r.status === 'PROCESSING')) return { status: 'PROCESSING', failureReason: null };
  if (runs.some((r) => r.status === 'SEARCHING')) return { status: 'SEARCHING', failureReason: null };
  return { status: current === 'CREATED' || current === 'READY' ? 'DISPATCHING' : current, failureReason: null };
}

export interface SearchProgress {
  sourcesTotal: number;
  sourcesCompleted: number;
  sourcesFailed: number;
  /** completed / total, from real worker state; null when there are no sources. */
  fraction: number | null;
}

export function progressOf(runs: readonly WorkerRunState[]): SearchProgress {
  const done = runs.filter((r) => isTerminalWorkerStatus(r.status));
  const failed = done.filter((r) => r.status === 'FAILED' || r.status === 'TIMED_OUT' || r.status === 'BLOCKED');
  return {
    sourcesTotal: runs.length,
    sourcesCompleted: done.length,
    sourcesFailed: failed.length,
    fraction: runs.length ? done.length / runs.length : null,
  };
}

/** The customer-facing stage list. Each stage is done only when its real counter says so. */
export type SearchStage = 'SEARCHING_LISTINGS' | 'CHECKING_DETAILS' | 'MERGING' | 'COMPARING_PRICES' | 'SELECTING';

export function stagesOf(counts: { discovered: number; validated: number; uniqueProperties: number; processed: boolean; terminal: boolean }):
  Array<{ stage: SearchStage; state: 'DONE' | 'ACTIVE' | 'PENDING' }> {
  const reached = [
    counts.discovered > 0 || counts.terminal,
    counts.validated > 0 || (counts.terminal && counts.discovered === 0),
    counts.processed,
    counts.processed,
    counts.processed && counts.terminal,
  ];
  const order: SearchStage[] = ['SEARCHING_LISTINGS', 'CHECKING_DETAILS', 'MERGING', 'COMPARING_PRICES', 'SELECTING'];
  const firstOpen = reached.indexOf(false);
  return order.map((stage, i) => ({
    stage,
    state: reached[i] && (i < firstOpen || firstOpen === -1) ? 'DONE' : i === firstOpen ? 'ACTIVE' : 'PENDING',
  }));
}
