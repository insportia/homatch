/**
 * THE WATCHDOG FOR A WORKER THAT STOPPED MOVING.
 *
 * THE PRODUCTION FAILURE THIS EXISTS FOR
 *
 * A Verify job sat in FINANCIAL_ENTITY_WAITING for 2,307 seconds. The
 * official-worker's entity job never reached COMPLETE or FAILED, and the
 * poll that drives that stage said, in full:
 *
 *     if (w.status !== 'COMPLETE' && w.status !== 'FAILED') return;
 *
 * — still running, come back later. Forever. Nothing downstream ran: no
 * MARKET, no SYNTHESIS, and because the job never finished, every section of
 * the customer's report stayed PENDING, which renders as "not started". A
 * report that is permanently about to begin is worse than one that says a
 * source could not be read.
 *
 * WHAT "PROGRESS" MEANS HERE, AND WHY IT IS NOT "STILL RUNNING"
 *
 * `status: RUNNING` is not progress; it is the absence of an ending. The
 * question a watchdog has to answer is whether the job is DOING anything,
 * and the worker already tells us: which stage it is on, how far through its
 * source list, how many results it has produced, how many steps it has
 * finished, and when it last touched itself. Fold those into a signature and
 * a stall is visible — the signature stops changing.
 *
 * Two bounds, because they fail differently:
 *
 *   STALL     nothing has changed for three minutes. The usual case: a
 *             browser hung on a page that will never load.
 *   MAX WAIT  ten minutes total, however much it has been fidgeting. A job
 *             that keeps ticking a counter without ever finishing is still a
 *             job nobody can wait for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not fail the Verify. One registry lookup out of three is an
 * enrichment, and losing it is a gap in the evidence, not a reason to throw
 * away everything already collected. The caller records the source as
 * TIMEOUT — which the customer-facing mapper already renders as "could not
 * be completed" — and carries on with the rest of the queue.
 *
 * It is pure. No clock of its own, no network, no database: `nowMs` is
 * passed in, which is what lets the regression test drive a stalled worker
 * through ten simulated minutes in a millisecond.
 */

/** Nothing has changed for this long: the worker is stuck. */
export const FINANCIAL_ENTITY_STALL_MS = 180_000;

/** Total patience, however busy it looks. */
export const FINANCIAL_ENTITY_MAX_WAIT_MS = 600_000;

export interface WorkerSnapshot {
  status?: string | null;
  stage?: string | null;
  sourceIndex?: number | null;
  results?: unknown[] | null;
  steps?: { status?: string | null }[] | null;
  updatedAt?: string | null;
}

/**
 * A short string that changes when, and only when, the worker has moved.
 *
 * Every component is something the worker updates as it works. `updatedAt`
 * alone would be tempting and is not enough: a heartbeat that rewrites a
 * timestamp without doing anything would read as progress for ever.
 */
export function progressSignature(w: WorkerSnapshot | null | undefined): string {
  const results = Array.isArray(w?.results) ? w!.results.length : 0;
  const steps = Array.isArray(w?.steps) ? w!.steps : [];
  const done = steps.filter((s) => {
    const v = String(s?.status ?? '').toUpperCase();
    return v !== '' && v !== 'PENDING' && v !== 'RUNNING';
  }).length;
  return [
    w?.status ?? '',
    w?.stage ?? '',
    w?.sourceIndex ?? '',
    results,
    steps.length,
    done,
    w?.updatedAt ?? '',
  ].join('|');
}

export interface WatchdogState {
  /** When this wait began, in epoch milliseconds. */
  startedAt: number;
  /** When the signature last changed. */
  lastProgressAt: number;
  /** The signature at that moment; null before the first poll. */
  signature: string | null;
  /** How many times we have looked. Reported, never used to decide. */
  polls: number;
}

export type WatchdogVerdict =
  /** Something moved. Keep waiting, and reset the stall clock. */
  | 'PROGRESSED'
  /** Nothing moved, but not for long enough to give up. */
  | 'WAITING'
  /** Nothing has moved for STALL_MS. Give up on this source. */
  | 'GIVE_UP_STALLED'
  /** MAX_WAIT_MS has passed in total. Give up on this source. */
  | 'GIVE_UP_MAX_WAIT';

export interface WatchdogAssessment {
  verdict: WatchdogVerdict;
  /** The state to persist for the next poll. */
  next: WatchdogState;
  waitedMs: number;
  sinceProgressMs: number;
  /** True for either give-up verdict, so callers need not enumerate them. */
  giveUp: boolean;
}

export interface WatchdogLimits {
  stallMs?: number;
  maxWaitMs?: number;
}

/** A fresh wait, stamped at the moment the worker job was created. */
export function beginWait(nowMs: number): WatchdogState {
  return { startedAt: nowMs, lastProgressAt: nowMs, signature: null, polls: 0 };
}

/**
 * Should we keep waiting for this worker job?
 *
 * The max-wait bound is checked BEFORE progress is credited, deliberately: a
 * worker that is still moving at the ten-minute mark is exactly the case the
 * ceiling exists for, and crediting its progress first would reset nothing
 * but would let the caller read PROGRESSED and keep going.
 */
export function assessFinancialEntityWait(
  state: WatchdogState | null | undefined,
  worker: WorkerSnapshot | null | undefined,
  nowMs: number,
  limits: WatchdogLimits = {},
): WatchdogAssessment {
  const stallMs = limits.stallMs ?? FINANCIAL_ENTITY_STALL_MS;
  const maxWaitMs = limits.maxWaitMs ?? FINANCIAL_ENTITY_MAX_WAIT_MS;

  // A wait with no recorded start is one that began before this watchdog
  // existed. Starting its clock now is the honest reading: we do not know
  // how long it has been going, and inventing a start time would either
  // abandon it instantly or excuse it for ever.
  const base: WatchdogState = state && Number.isFinite(state.startedAt)
    ? state
    : beginWait(nowMs);

  const signature = progressSignature(worker);
  const polls = (base.polls ?? 0) + 1;
  const waitedMs = Math.max(0, nowMs - base.startedAt);

  if (waitedMs >= maxWaitMs) {
    return {
      verdict: 'GIVE_UP_MAX_WAIT',
      next: { ...base, signature, polls },
      waitedMs,
      sinceProgressMs: Math.max(0, nowMs - base.lastProgressAt),
      giveUp: true,
    };
  }

  // The first poll has nothing to compare against, so it establishes the
  // baseline rather than counting as movement.
  const moved = base.signature !== null && base.signature !== signature;
  if (moved || base.signature === null) {
    return {
      verdict: base.signature === null ? 'WAITING' : 'PROGRESSED',
      next: { ...base, lastProgressAt: nowMs, signature, polls },
      waitedMs,
      sinceProgressMs: 0,
      giveUp: false,
    };
  }

  const sinceProgressMs = Math.max(0, nowMs - base.lastProgressAt);
  if (sinceProgressMs >= stallMs) {
    return {
      verdict: 'GIVE_UP_STALLED',
      next: { ...base, signature, polls },
      waitedMs,
      sinceProgressMs,
      giveUp: true,
    };
  }

  return {
    verdict: 'WAITING',
    next: { ...base, signature, polls },
    waitedMs,
    sinceProgressMs,
    giveUp: false,
  };
}

/**
 * The record left behind when a source is abandoned.
 *
 * Shaped like every other entry in `browserOfficial.results` so the existing
 * machinery reads it without a special case: `customerSourceStatus` already
 * maps `TIMEOUT` to TECHNICAL_FAILED, which surfaces to the customer as a
 * source that could not be completed. `forEntity` is what stops the same
 * lookup being started again on a later pass — the point is a bounded wait,
 * not a bounded wait repeated indefinitely.
 */
export function unavailableEntityResult(input: {
  source: 'enreg' | 'rstax' | 'debtor';
  name: string | null;
  idCode: string | null;
  reason: WatchdogVerdict;
  waitedMs: number;
  workerJobId: string | null;
  atIso: string;
}): Record<string, unknown> {
  return {
    source: input.source,
    status: 'TIMEOUT',
    sourceClass: 'OFFICIAL',
    forEntity: { name: input.name, idCode: input.idCode },
    retrievedAt: input.atIso,
    // Honest, and deliberately not dressed up as a result: there is no data
    // here, only an explanation for its absence.
    unavailable: true,
    unavailableReason: input.reason,
    waitedMs: input.waitedMs,
    workerJobId: input.workerJobId,
    documents: [],
  };
}
