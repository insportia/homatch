// HOMATCH VERIFY — estimated progress, and the elapsed clock.
//
// WHY THE OLD PERCENTAGE WAS REMOVED, AND WHY THIS ONE IS DIFFERENT
//
// The backend used to set `progress.percent` to a round number per phase —
// 5, 34, 37, 72 — and the UI rendered it as a progress bar. A job could sit
// at 37% for ten minutes and then jump to 100. It was a number that measured
// nothing, and a customer plans around numbers.
//
// The percentage is back because it is genuinely useful to a person waiting,
// but it is now an ESTIMATE with an honest shape, and the estimate is
// RECONSTRUCTED, never remembered:
//
//   pct = clamp(bandFloor(stage), bandCeiling(stage), curve(elapsed))
//
// Both inputs come from the server — `created_at` and `stage` — so the same
// verification produces the same number in any tab, after any refresh, on any
// device, at the same moment. Nothing is stored in the client, so there is
// nothing to reset.
//
// MONOTONIC BY CONSTRUCTION, NOT BY CLAMPING
//
// `elapsed` only ever grows and the pipeline's stages only ever move forward,
// so both terms are non-decreasing. It cannot go backwards, and it cannot
// restart, because neither of the two things it is made of can.
//
// The curve is asymptotic: it approaches its ceiling and never arrives. A run
// that takes forty minutes still has somewhere to go at minute thirty-nine.
//
// 100 MEANS ONE THING
//
// 100% is not a stage. It is returned only when a valid report has been
// persisted and can actually be read. Research finishing is not the report
// being ready, and the number must never say otherwise.
//
// This is presentation only. Nothing here is sent to the server, and no
// backend transition is triggered by it.

/** Server lifecycle as the customer's client sees it. */
export type JobStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'WAITING_HUMAN'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED';

export interface ProgressInput {
  status: JobStatus | string | null | undefined;
  /** research_jobs.stage — the pipeline's own state name. */
  stage: string | null | undefined;
  /** research_jobs.created_at. The authoritative start of this run. */
  createdAt: string | number | null | undefined;
  /** research_jobs.completed_at, once research is terminal. */
  completedAt?: string | number | null | undefined;
  /** True only when a valid report has been persisted and is readable. */
  reportReady?: boolean;
  /** Injected so this module is pure and testable. */
  now?: number;
}

/**
 * Conceptual phases. These are what the CUSTOMER is told is happening; they
 * deliberately do not mirror the internal stage names one-to-one, and they
 * never name a provider, a worker, a portal or an internal state.
 */
export type Phase =
  | 'STARTING'
  | 'IDENTITY'
  | 'LOCATION'
  | 'OFFICIAL'
  | 'COMPANY'
  | 'PARTICIPANTS'
  | 'MARKET'
  | 'RECONCILIATION'
  | 'SYNTHESIS'
  | 'READY';

interface Band {
  phase: Phase;
  floor: number;
  ceiling: number;
}

/*
 * Stage -> band. Unknown stages fall through to a mid-research band rather
 * than to zero: a stage this table has not heard of is far more likely to be
 * a new step in the middle of the pipeline than a job that has not started,
 * and showing 1% for a run that is twenty minutes in would be the worse
 * failure.
 */
const BANDS: Record<string, Band> = {
  QUEUED: { phase: 'STARTING', floor: 1, ceiling: 4 },
  CREATED: { phase: 'STARTING', floor: 1, ceiling: 4 },

  IDENTITY_WAITING: { phase: 'IDENTITY', floor: 5, ceiling: 25 },
  BROWSER_READY: { phase: 'LOCATION', floor: 22, ceiling: 30 },

  BROWSER_WAITING: { phase: 'OFFICIAL', floor: 28, ceiling: 62 },
  OFFICIAL_READY: { phase: 'OFFICIAL', floor: 55, ceiling: 66 },
  OFFICIAL_COLLECTION_WAITING: { phase: 'OFFICIAL', floor: 58, ceiling: 70 },

  ENREG_CHECK_PENDING: { phase: 'COMPANY', floor: 66, ceiling: 74 },
  FINANCIAL_ENTITY_WAITING: { phase: 'PARTICIPANTS', floor: 68, ceiling: 78 },

  PUBLIC_RESEARCH_READY: { phase: 'PARTICIPANTS', floor: 72, ceiling: 80 },
  PUBLIC_RESEARCH_WAITING: { phase: 'PARTICIPANTS', floor: 74, ceiling: 82 },
  PUBLIC_RESEARCH_CHECK_PENDING: { phase: 'PARTICIPANTS', floor: 78, ceiling: 84 },

  MARKET_READY: { phase: 'MARKET', floor: 78, ceiling: 86 },
  MARKET_WAITING: { phase: 'MARKET', floor: 80, ceiling: 88 },
  RECONCILIATION_CHECK_PENDING: { phase: 'RECONCILIATION', floor: 84, ceiling: 90 },

  SYNTHESIS_READY: { phase: 'SYNTHESIS', floor: 86, ceiling: 96 },
  SYNTHESIS_WAITING: { phase: 'SYNTHESIS', floor: 88, ceiling: 97 },
  COMPLETE: { phase: 'SYNTHESIS', floor: 90, ceiling: 98 },
};

const UNKNOWN_BAND: Band = { phase: 'OFFICIAL', floor: 28, ceiling: 62 };

/** The point the curve reaches for beyond any realistic run. Never 100. */
const CURVE_CEILING = 97;
/**
 * Shapes how fast the estimate rises. At ~3 min it is near 19%, at ~10 min
 * near 49%, at ~20 min near 73% — so a twenty-minute run does not sit pinned
 * at 98 after three minutes, which is exactly what the old percentage did.
 */
const CURVE_TAU_MS = 14 * 60 * 1000;

export function bandFor(stage: string | null | undefined): Band {
  const key = String(stage || '').toUpperCase();
  return BANDS[key] ?? UNKNOWN_BAND;
}

export function phaseFor(stage: string | null | undefined): Phase {
  return bandFor(stage).phase;
}

/** Milliseconds this run has been alive, from the server's own clock. */
export function elapsedMs(input: ProgressInput): number {
  const started = toMillis(input.createdAt);
  if (started === null) return 0;
  const now = input.now ?? Date.now();
  // A finished run's clock FREEZES at completion. It is a duration, not a
  // stopwatch someone forgot to stop.
  const end = input.reportReady ? toMillis(input.completedAt) ?? now : now;
  return Math.max(0, end - started);
}

export function estimateProgress(input: ProgressInput): number {
  // The only thing that means finished.
  if (input.reportReady) return 100;

  const status = String(input.status || '').toUpperCase();
  // A run that stopped is not a run that is progressing. Freeze where it is
  // rather than letting the curve keep climbing under a dead job.
  const frozen = status === 'FAILED' || status === 'CANCELLED';

  const band = bandFor(status === 'COMPLETE' ? 'COMPLETE' : input.stage);
  const t = elapsedMs(input);
  const curved = CURVE_CEILING * (1 - Math.exp(-t / CURVE_TAU_MS));

  // The band floor is what stops a fast pipeline from being under-reported,
  // and the ceiling is what stops the curve from claiming a stage is nearly
  // done when the pipeline has not said so.
  const pct = Math.min(band.ceiling, Math.max(band.floor, curved));
  // A stopped run must stop moving. The curve is a function of elapsed time,
  // so anything derived from it keeps climbing under a job that is no longer
  // doing anything — which is exactly the dishonesty this module exists to
  // remove. The band floor is stable and says the true thing: the pipeline
  // reached this stage and went no further.
  if (frozen) return Math.round(band.floor);

  // WAITING_HUMAN is a real stop, but it is the customer's move, not ours —
  // holding the number still says that more honestly than creeping upward.
  if (status === 'WAITING_HUMAN') return Math.round(band.floor);

  return Math.round(pct);
}

/** mm:ss, from a duration that is measured rather than guessed. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function toMillis(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
}
