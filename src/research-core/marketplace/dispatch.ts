// HOMATCH MARKETPLACE SEARCH — concurrent worker orchestration policy.
//
// CONCURRENT, NEVER SEQUENTIAL. When a search starts, one run is created for
// EVERY eligible worker in a single batch; each worker claims its own runs
// independently. Nothing waits for worker A before worker B starts, and each
// run has its own lease, deadline, retry budget and failure boundary.
//
// BOUNDED. Parallel is not unlimited: a worker (one provider) holds at most
// `maxConcurrency` live leases, and all workers together at most the global
// limit (admin_settings marketplace_max_concurrent_runs). A claim over either
// bound gets fewer runs, or none, and simply claims again later.
//
// FAILURE IS LOCAL. A lease that expires (the worker died or hung) is retried
// while attempts and the deadline allow; a run that already delivered results
// keeps them as PARTIAL. A slow, blocked or failed run never touches another
// run, and results are reprocessed after every report, so finished workers'
// properties are visible while the rest are still searching.
//
// Pure: the edge functions apply these decisions; the SQL claim enforces the
// same bounds atomically.

import { type WorkerRunStatus, isTerminalWorkerStatus } from './worker-contract.ts';

export const DEFAULT_GLOBAL_CONCURRENCY = 40;
export const DEFAULT_WORKER_CONCURRENCY = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_SECONDS = 120;

/** Statuses holding a live lease (counted against the concurrency bounds). */
export const IN_FLIGHT: readonly WorkerRunStatus[] = ['SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'];

export interface RunLease {
  id: string;
  workerId: string;
  status: WorkerRunStatus;
  attempts: number;
  returnedCount: number;
  leaseExpiresAt: string | null;
  deadlineAt: string;
}

/** How many runs a claim may take right now. Never negative, never above either bound. */
export function claimSlots(input: {
  requested: number;
  workerLimit: number;
  workerInFlight: number;
  globalLimit: number;
  globalInFlight: number;
}): number {
  const requested = Math.max(1, Math.min(20, Math.trunc(input.requested) || 1));
  return Math.max(0, Math.min(
    requested,
    Math.max(1, input.workerLimit) - input.workerInFlight,
    Math.max(1, input.globalLimit) - input.globalInFlight,
  ));
}

const live = (r: RunLease, now: number) =>
  IN_FLIGHT.includes(r.status) && r.leaseExpiresAt !== null && Date.parse(r.leaseExpiresAt) > now;

/** Live leases per worker and in total. */
export function inFlight(runs: readonly RunLease[], now: Date): { global: number; byWorker: Map<string, number> } {
  const byWorker = new Map<string, number>();
  let global = 0;
  for (const r of runs) {
    if (!live(r, now.getTime())) continue;
    global += 1;
    byWorker.set(r.workerId, (byWorker.get(r.workerId) ?? 0) + 1);
  }
  return { global, byWorker };
}

export type ReapAction =
  | { action: 'REQUEUE' }
  | { action: 'CLOSE'; status: 'PARTIAL' | 'TIMED_OUT' | 'FAILED'; reason: string };

/**
 * What to do with one run whose lease expired or whose deadline passed.
 * null = leave it alone (terminal, still leased, or simply queued in time).
 */
export function reapDecision(r: RunLease, now: Date, maxAttempts = DEFAULT_MAX_ATTEMPTS): ReapAction | null {
  if (isTerminalWorkerStatus(r.status)) return null;
  const t = now.getTime();
  const pastDeadline = Date.parse(r.deadlineAt) <= t;
  if (pastDeadline) {
    return { action: 'CLOSE', status: r.returnedCount > 0 ? 'PARTIAL' : 'TIMED_OUT', reason: 'DEADLINE' };
  }
  const leaseExpired = IN_FLIGHT.includes(r.status) && (r.leaseExpiresAt === null || Date.parse(r.leaseExpiresAt) <= t);
  if (!leaseExpired) return null;
  /* Results already delivered stay delivered: the run closes PARTIAL rather than starting over. */
  if (r.returnedCount > 0) return { action: 'CLOSE', status: 'PARTIAL', reason: 'LEASE_EXPIRED_AFTER_RESULTS' };
  if (r.attempts < maxAttempts) return { action: 'REQUEUE' };
  return { action: 'CLOSE', status: 'FAILED', reason: 'LEASE_EXPIRED_NO_ATTEMPTS_LEFT' };
}

/** A worker's own FAILED report: retried when the worker says it is transient and budget remains. */
export function retryDecision(r: Pick<RunLease, 'attempts' | 'deadlineAt' | 'returnedCount'>, retryable: boolean, now: Date,
  maxAttempts = DEFAULT_MAX_ATTEMPTS): 'REQUEUE' | 'FAIL' {
  if (!retryable || r.returnedCount > 0) return 'FAIL';
  if (r.attempts >= maxAttempts) return 'FAIL';
  return Date.parse(r.deadlineAt) > now.getTime() ? 'REQUEUE' : 'FAIL';
}

/** Lease end for a claim or heartbeat, never past the run's own deadline. */
export function leaseUntil(now: Date, deadlineAt: string, leaseSeconds = DEFAULT_LEASE_SECONDS): string {
  return new Date(Math.min(now.getTime() + leaseSeconds * 1000, Date.parse(deadlineAt))).toISOString();
}
