// HOMATCH — research completion is not report delivery.
//
// Production incident 2026-10-29: verify-synthesis failed to boot, and job
// 674df06e (cadastral 01.16.06.039.039) read COMPLETE everywhere while its
// synthesis_state was FAILED and no report existed. research_jobs.status says
// the RESEARCH finished. What the customer paid for is the report, and that is
// delivered only when synthesis_state = READY and synthesis_json exists.
//
// One pure answer, shared by the customer page, the history list, the Admin
// views (the SQL in 20261208130000_verify_report_delivery.sql mirrors it) and
// billing's settlementOutcome(), so "delivered", "being prepared" and "could
// not be prepared" mean the same thing on every surface:
//
//   RESEARCHING      research is still running (or queued / waiting on a human)
//   PREPARING        research is done, the report is being written or retried
//   DELIVERED        synthesis_state READY and the report exists
//   FAILED           research is done, the report could not be written: every
//                    attempt was spent, or it is still missing past the settle
//                    grace (billing has released the use: nothing is charged)
//   RESEARCH_FAILED  the research itself failed
//   STOPPED          the customer stopped it (cancelled or paused)

import { settlementOutcome } from './pauseResume.ts';

export type ReportDelivery = 'RESEARCHING' | 'PREPARING' | 'DELIVERED' | 'FAILED' | 'RESEARCH_FAILED' | 'STOPPED';

/** research-agent MAX_SYNTHESIS_ATTEMPTS / verify-synthesis REPORT_MAX_ATTEMPTS (a test keeps them equal). */
export const REPORT_MAX_ATTEMPTS = 4;
/** research-agent SYNTHESIS_SETTLE_GRACE_MS: past it a missing report is a failure and billing releases. */
export const REPORT_SETTLE_GRACE_MS = 2 * 60 * 60 * 1000;

export interface ReportDeliveryInput {
  status?: string | null;
  synthesis_state?: string | null;
  synthesis_attempts?: number | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  /**
   * Whether synthesis_json exists. null/undefined = not known to the caller
   * (a list that does not read the payload): READY is then trusted.
   */
  reportPresent?: boolean | null;
}

/** The report the customer paid for exists. */
export function isReportDelivered(synthesisState: unknown, reportPresent: boolean | null | undefined): boolean {
  return synthesisState === 'READY' && reportPresent !== false;
}

export function reportDeliveryState(job: ReportDeliveryInput, now: number = Date.now()): ReportDelivery {
  const status = String(job.status ?? '').toUpperCase();
  if (job.cancelled_at || status === 'CANCELLED' || status === 'PAUSED') return 'STOPPED';
  if (status === 'FAILED') return 'RESEARCH_FAILED';
  if (status !== 'COMPLETE') return 'RESEARCHING';
  // Billing's own decision, without the "no official source" rule (that one
  // changes what is charged, not whether the customer received the report).
  const outcome = settlementOutcome(
    {
      status: 'COMPLETE',
      synthesis_state: job.synthesis_state ?? null,
      synthesis_attempts: job.synthesis_attempts ?? null,
      completed_at: job.completed_at ?? null,
    },
    { maxSynthesisAttempts: REPORT_MAX_ATTEMPTS, synthesisGraceMs: REPORT_SETTLE_GRACE_MS, now, reportPresent: job.reportPresent ?? null },
  );
  if (outcome === 'COMPLETE') return 'DELIVERED';
  if (outcome === 'SYSTEM_FAILED') return 'FAILED';
  return 'PREPARING';
}

/*
 * THE DIAGNOSTIC REASON ADMIN READS (verify_report_failures.reason).
 *
 * Whatever failed is written down — an HTTP status and the first part of the
 * body for a call that came back non-2xx (a boot error answers 503
 * BOOT_ERROR), else the error's message — but never a credential: bearer
 * tokens, JWTs and provider keys are masked, and the text is bounded.
 */
const MAX_REASON = 400;
export function reportFailureReason(e: unknown): string {
  let s = e instanceof Error ? e.message : typeof e === 'string' ? e : (() => {
    try { return JSON.stringify(e); } catch { return String(e); }
  })();
  s = String(s ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***jwt***')
    .replace(/\b(sk|rk|pk|re)_(live|test)?_?[A-Za-z0-9]{12,}/g, '***key***')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '***key***')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = 'unknown';
  return s.length > MAX_REASON ? `${s.slice(0, MAX_REASON - 1)}…` : s;
}

/** A boot failure of the edge runtime, as the platform answers it. */
export function looksLikeBootError(status: number, body: string): boolean {
  if (status < 500) return false;
  return /BOOT_ERROR|worker failed to boot|failed to boot|InvalidWorkerCreation|does not provide an export/i.test(body || '');
}
