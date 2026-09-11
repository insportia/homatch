// HOMATCH — the one vocabulary for "how far along is this".
//
// Verify, document extraction, document analysis and Find Clients are four
// different pieces of work with four different failure modes, and until now
// each described its own progress in its own words: research_jobs speaks
// CREATED/RUNNING/COMPLETE/FAILED, deal_room_documents speaks
// NONE/QUEUED/RUNNING/DONE/FAILED/UNSUPPORTED/REQUIRES_OCR, matching_jobs
// speaks queued/running/succeeded/failed. A progress indicator that wants to
// show all four at once has to learn all three dialects, and every new
// product adds a fourth.
//
// So there is one vocabulary, and each product maps onto it at its own
// boundary. Nothing downstream — the job centre, the notification, the
// result page, the document card — knows which product it is looking at.
//
// THE ONE DISTINCTION THAT IS NOT COSMETIC
//
// CANCELLABLE vs COMMITTED. Everything else here describes how much work is
// done; those two describe whose money is at stake. Before the deadline the
// job has spent nothing irrecoverable and the customer may still walk away.
// After it, Homatch has begun buying external provider time on their behalf,
// and a cancellation would leave us holding a bill with nothing to settle it
// against. That line is enforced in Postgres (see the
// background_jobs_cancel() RPC), never here — this file only names it.

/** Where a durable unit of work is, in the only vocabulary the UI knows. */
export type JobState =
  /** Persisted, nothing has picked it up yet. */
  | 'QUEUED'
  /** Claimed by a worker; preparation only, no provider spend yet. */
  | 'STARTING'
  /** Inside the cancellation window. The customer may still stop this. */
  | 'CANCELLABLE'
  /** Past the window. External spend has been authorised. */
  | 'COMMITTED'
  /** Doing the expensive work. */
  | 'PROCESSING'
  /** Some stages are finished and readable; others are still running. */
  | 'PARTIAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export const JOB_STATES: readonly JobState[] = [
  'QUEUED', 'STARTING', 'CANCELLABLE', 'COMMITTED',
  'PROCESSING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const;

/** Nothing further will happen on its own. */
export const TERMINAL_STATES: readonly JobState[] = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;

export const isTerminal = (s: JobState): boolean => TERMINAL_STATES.includes(s);

/** Still worth watching: the job centre keeps these visible and polls them. */
export const isActive = (s: JobState): boolean => !isTerminal(s);

/**
 * Is there something readable NOW?
 *
 * PARTIAL is the whole reason this predicate exists. A verification that has
 * finished identity and ownership but is still gathering comparables has real
 * answers to show, and blanking the screen until every stage lands is how a
 * customer concludes nothing is happening.
 */
export const hasReadableResult = (s: JobState): boolean => s === 'PARTIAL' || s === 'COMPLETED';

/**
 * May a normal (non-admin) user stop this?
 *
 * Advisory only. The button is hidden on `false`, but the server re-derives
 * this from `cancel_deadline_at` on every cancel attempt — a hidden button is
 * a courtesy and a server check is a control.
 */
export const isUserCancellable = (s: JobState): boolean => s === 'QUEUED' || s === 'STARTING' || s === 'CANCELLABLE';

/**
 * How long a customer has to change their mind.
 *
 * Fifteen seconds is not a compromise between "long enough to react" and
 * "short enough to be safe" — it is the largest window in which Homatch can
 * guarantee it has spent nothing recoverable. Every product that uses this
 * clock must do its unpaid preparation inside it and start buying only after
 * (see PART C §28).
 */
export const CANCEL_WINDOW_MS = 15_000;

/** Whole seconds left on the countdown, floored at zero. */
export function cancelSecondsRemaining(deadlineIso: string | null | undefined, nowMs = Date.now()): number {
  if (!deadlineIso) return 0;
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

/**
 * A worker that has said nothing for this long is presumed dead.
 *
 * Deliberately generous. A verification stage can legitimately spend minutes
 * inside one provider call without writing anything, and requeuing a job that
 * was merely thinking would buy the same research twice.
 */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export function isHeartbeatStale(lastHeartbeatIso: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lastHeartbeatIso) return false;
  const beat = Date.parse(lastHeartbeatIso);
  if (!Number.isFinite(beat)) return false;
  return nowMs - beat > HEARTBEAT_STALE_MS;
}
