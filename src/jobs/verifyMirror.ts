// HOMATCH — what a Verify background job says, read from research_jobs.
//
// jobs-worker mirrors every live Verify job onto its research_jobs row. This
// is that mapping, kept pure so it can be tested without Deno or a database.
//
// RESEARCH COMPLETE IS NOT THE VERIFICATION COMPLETE
//
// research_jobs.status turns COMPLETE when the research stages finish. The
// report the customer paid for is written afterwards by verify-synthesis and
// lands as synthesis_state = 'READY' a minute or two later. Mapping COMPLETE
// straight to COMPLETED told the customer their verification was done while
// the report did not exist yet, and left current_stage at SYNTHESIS_WAITING on
// every finished job (prod: background job 0015e291…, research job 61c1c38c…:
// COMPLETED 12:10:46, report READY 12:12:34).
//
// So the terminal decision for a finished research run is the SAME one billing
// makes — settlementOutcome() — and nothing else:
//   COMPLETE       (report READY)                        → COMPLETED
//   SYSTEM_FAILED  (report FAILED after the last attempt,
//                   or not READY past the settle grace)  → FAILED (no charge)
//   null           (report still being written)          → PROCESSING, REPORT_WRITING
// A job can therefore never read COMPLETED while billing would release it, or
// FAILED while billing would charge it.

import { settlementOutcome } from '../verify/pauseResume.ts';

/*
 * The same numbers research-agent's settlement sweep uses
 * (MAX_SYNTHESIS_ATTEMPTS, SYNTHESIS_SETTLE_GRACE_MS). A test reads both
 * files and fails if they drift apart.
 */
export const VERIFY_MAX_SYNTHESIS_ATTEMPTS = 4;
export const VERIFY_SYNTHESIS_SETTLE_GRACE_MS = 2 * 60 * 60 * 1000;

/** Research is finished; the report is still being written. */
export const VERIFY_REPORT_WRITING_STAGE = 'REPORT_WRITING';
/** Never 100 before the report exists — 100 means "ready". */
export const VERIFY_REPORT_WRITING_PROGRESS = 95;

/** The current_stage a finished job keeps, per terminal state. */
export const TERMINAL_STAGE: Record<'COMPLETED' | 'FAILED' | 'CANCELLED', string> = {
  COMPLETED: 'COMPLETE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

/** research_jobs' vocabulary, in the shared one. */
export function verifyState(status: string, cancelledAt: string | null): string {
  if (cancelledAt) return 'CANCELLED';
  switch ((status || '').toUpperCase()) {
    case 'CREATED': return 'QUEUED';
    case 'RUNNING':
    case 'WAITING_HUMAN': return 'PROCESSING';
    case 'COMPLETE': return 'COMPLETED';
    case 'FAILED': return 'FAILED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'PROCESSING';
  }
}

/**
 * Stage-based, from stages the pipeline has actually finished.
 *
 * Deliberately NOT a function of elapsed time. A percentage that moves
 * because the clock moved tells the customer nothing and, worse, teaches them
 * that the number is decorative (§48).
 */
const VERIFY_STAGE_ORDER = [
  'CREATED', 'IDENTITY', 'OFFICIAL_BROWSER', 'OFFICIAL', 'PUBLIC_RESEARCH',
  'MARKET', 'RECONCILE', 'SYNTHESIS', 'COMPLETE',
];
export function verifyProgress(stage: string): number {
  const i = VERIFY_STAGE_ORDER.indexOf((stage || '').toUpperCase());
  if (i === -1) return 5;
  return Math.round((i / (VERIFY_STAGE_ORDER.length - 1)) * 100);
}

export interface VerifyResearchRow {
  status?: string | null;
  stage?: string | null;
  cancelled_at?: string | null;
  synthesis_state?: string | null;
  synthesis_attempts?: number | null;
  completed_at?: string | null;
}

export interface VerifyMirror {
  state: string;
  stage: string | null;
  progress: number | null;
  errorKey: string | null;
}

/** What the background job of this research row should say right now. */
export function verifyMirror(r: VerifyResearchRow, now: number = Date.now()): VerifyMirror {
  const state = verifyState(String(r.status ?? ''), r.cancelled_at ?? null);

  if (state === 'COMPLETED') {
    const outcome = settlementOutcome(
      {
        status: 'COMPLETE',
        synthesis_state: r.synthesis_state ?? null,
        synthesis_attempts: r.synthesis_attempts ?? null,
        completed_at: r.completed_at ?? null,
      },
      { maxSynthesisAttempts: VERIFY_MAX_SYNTHESIS_ATTEMPTS, synthesisGraceMs: VERIFY_SYNTHESIS_SETTLE_GRACE_MS, now },
    );
    if (outcome === 'COMPLETE') {
      return { state: 'COMPLETED', stage: TERMINAL_STAGE.COMPLETED, progress: 100, errorKey: null };
    }
    if (outcome === 'SYSTEM_FAILED') {
      return { state: 'FAILED', stage: TERMINAL_STAGE.FAILED, progress: null, errorKey: 'verify_result_failed' };
    }
    return { state: 'PROCESSING', stage: VERIFY_REPORT_WRITING_STAGE, progress: VERIFY_REPORT_WRITING_PROGRESS, errorKey: null };
  }

  if (state === 'FAILED') {
    return { state, stage: TERMINAL_STAGE.FAILED, progress: null, errorKey: 'verify_result_failed' };
  }
  if (state === 'CANCELLED') {
    return { state, stage: TERMINAL_STAGE.CANCELLED, progress: null, errorKey: null };
  }
  return { state, stage: r.stage ?? null, progress: verifyProgress(String(r.stage ?? '')), errorKey: null };
}
