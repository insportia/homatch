// HOMATCH — the client's view of durable work.
//
// Everything here is a thin wrapper over an RPC. That is deliberate: the
// fifteen-second rule, ownership and idempotency are all decided in Postgres
// (see 20260912090000_background_jobs.sql), and a client-side helper that
// appeared to decide any of them would be a lie waiting to be believed.
//
// The one thing this file DOES decide is what the UI is allowed to assume,
// and the answer is nothing. `canCancel` comes from the server on every read;
// the countdown below is a rendering of `cancelDeadlineAt`, not a timer this
// module owns. If the two ever disagree the server wins, and the customer
// sees a refusal rather than a cancelled job that was not.

import { supabase } from '@/db/supabase';
import type { JobState } from '@/jobs/jobState';
import { reportError } from '@/lib/errorReporting';

export type ProductType =
  | 'VERIFY' | 'DOCUMENT_ANALYSIS' | 'FIND_CLIENTS' | 'MARKET_RESEARCH'
  | 'LOCATION_RESEARCH' | 'CONTRACT_ANALYSIS' | 'AI_ENRICHMENT'
  | 'EMAIL_CAMPAIGN' | 'AI_CALL';

export type SubjectType = 'RESEARCH_JOB' | 'DOCUMENT' | 'MATCHING_JOB' | 'DEAL_ROOM' | 'PROPERTY';

export interface JobStageMark {
  stage: string;
  at: string;
  ok: boolean;
}

/** Exactly what background_job_public() returns. No client-computed fields. */
export interface BackgroundJob {
  id: string;
  productType: ProductType;
  subjectType: SubjectType;
  subjectId: string | null;
  subjectLabel: string | null;
  /** Already accounts for the clock — see background_job_effective_state(). */
  state: JobState;
  storedState: JobState;
  /** The server's answer, not ours. */
  canCancel: boolean;
  progress: number;
  currentStage: string | null;
  stages: JobStageMark[];
  createdAt: string;
  startedAt: string | null;
  cancelDeadlineAt: string;
  committedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  lastHeartbeatAt: string | null;
  /** A translation key or null. Never prose. */
  userSafeError: string | null;
  attempt: number;
  /** Stable in-app destination for the finished thing (§35). */
  resultRef: string | null;
  reservationId: string | null;
  authorizedBudgetCredits: number | null;
  metadata: Record<string, unknown>;
}

const asJob = (v: unknown): BackgroundJob | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    ...(o as unknown as BackgroundJob),
    stages: Array.isArray(o.stages) ? (o.stages as JobStageMark[]) : [],
    metadata: o.metadata && typeof o.metadata === 'object' ? (o.metadata as Record<string, unknown>) : {},
    progress: typeof o.progress === 'number' ? o.progress : 0,
  };
};

/**
 * Register a durable job.
 *
 * `idempotencyKey` is the whole defence against a double-click buying two
 * verifications. Derive it from what the customer ASKED FOR — the cadastral
 * code, the document id — never from Date.now(), which makes every click a
 * different request and defeats the point.
 */
export async function startJob(args: {
  productType: ProductType;
  subjectType: SubjectType;
  idempotencyKey: string;
  subjectId?: string | null;
  subjectLabel?: string | null;
  resultRef?: string | null;
  reservationId?: string | null;
  authorizedBudgetCredits?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<{ job: BackgroundJob | null; created: boolean }> {
  const { data, error } = await supabase.rpc('background_job_start', {
    p_product_type: args.productType,
    p_subject_type: args.subjectType,
    p_idempotency_key: args.idempotencyKey,
    p_subject_id: args.subjectId ?? null,
    p_subject_label: args.subjectLabel ?? null,
    p_result_ref: args.resultRef ?? null,
    p_reservation_id: args.reservationId ?? null,
    p_authorized_budget_credits: args.authorizedBudgetCredits ?? null,
    p_metadata: args.metadata ?? {},
  });
  if (error) throw error;
  const o = (data ?? {}) as Record<string, unknown>;
  return { job: asJob(o.job), created: o.created === true };
}

export type CancelOutcome =
  | { ok: true; job: BackgroundJob | null }
  /** The window closed. Not an error — the expected answer after 15 seconds. */
  | { ok: false; reason: 'COMMITTED' | 'ALREADY_FINISHED' | 'NOT_FOUND' };

/**
 * Ask the server to stop this.
 *
 * It may say no, and a `COMMITTED` refusal is a normal outcome rather than a
 * failure: provider spend has started and cancelling would leave Homatch
 * holding a bill with nothing to settle it against (§27). The caller shows
 * the customer why, and the job carries on.
 */
export async function cancelJob(jobId: string): Promise<CancelOutcome> {
  const { data, error } = await supabase.rpc('background_job_cancel', { p_job_id: jobId });
  if (error) throw error;
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.ok === true) return { ok: true, job: asJob(o.job) };
  const reason = String(o.reason ?? 'NOT_FOUND');
  return {
    ok: false,
    reason: reason === 'COMMITTED' || reason === 'ALREADY_FINISHED' ? reason : 'NOT_FOUND',
  };
}

/** App bootstrap and the job centre (§51, §32). */
export async function listMyJobs(recentHours = 48): Promise<BackgroundJob[]> {
  const { data, error } = await supabase.rpc('background_jobs_mine', {
    p_recent_hours: recentHours,
    p_limit: 100,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(asJob).filter((j): j is BackgroundJob => !!j);
}

export async function getJob(jobId: string): Promise<BackgroundJob | null> {
  const { data, error } = await supabase.rpc('background_job_get', { p_job_id: jobId });
  if (error) throw error;
  return asJob(data);
}

/**
 * The live job for a product row, so a page re-attaches after a refresh
 * instead of asking the customer to start again (§31, §36).
 */
export async function getJobForSubject(
  subjectType: SubjectType,
  subjectId: string
): Promise<BackgroundJob | null> {
  const { data, error } = await supabase.rpc('background_job_for_subject', {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  });
  if (error) throw error;
  return asJob(data);
}

/**
 * Register a job without letting a registry failure stop the work.
 *
 * The durable registry is how a customer WATCHES their job; research-agent's
 * own pg_cron driver is what RUNS it. If this insert fails the verification
 * still happens and still lands — it just will not appear in the job centre
 * until the next read. Refusing to start the research because a bookkeeping
 * row could not be written would be the worse trade.
 */
export async function startJobBestEffort(
  args: Parameters<typeof startJob>[0]
): Promise<BackgroundJob | null> {
  try {
    const { job } = await startJob(args);
    return job;
  } catch (e) {
    reportError(e, {
      // PROPERTY is a subject a job can have but not one errorReporting's own
      // narrower vocabulary names; the job id is what a reader chases anyway.
      subjectType: args.subjectType === 'PROPERTY' ? undefined : args.subjectType,
      subjectId: args.subjectId ?? null,
      boundary: 'startJob',
    });
    return null;
  }
}
