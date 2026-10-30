/*
 * WHY A VERIFY REPORT WAS NOT DELIVERED, WRITTEN DOWN FOR ADMIN.
 *
 * Production 2026-10-29: verify-synthesis failed to boot and every report
 * attempt of job 674df06e ended as synthesis_state FAILED with nothing
 * anywhere saying why. Each failure is now one row of
 * public.verify_report_failures (20261208130000_verify_report_delivery.sql):
 * admin-only (RLS on, no policy), read through admin_verify_delivery.
 *
 * Bookkeeping, never control flow: callers write synthesis_state FIRST, then
 * call this. It never throws, and before the migration is applied the insert
 * simply fails and is logged, so nothing about the pipeline depends on it.
 */
import { reportFailureReason } from '../../../src/verify/reportDelivery.ts';

export type ReportFailureSource = 'DRIVER' | 'RESEARCH' | 'BACKGROUND' | 'REQUEST';

// deno-lint-ignore no-explicit-any
export async function recordReportFailure(sb: any, f: { jobId: string; source: ReportFailureSource; error: unknown; attempt?: number | null; httpStatus?: number | null }): Promise<void> {
  try {
    const { error } = await sb.from('verify_report_failures').insert({
      job_id: f.jobId,
      source: f.source,
      attempt: Number.isFinite(Number(f.attempt)) ? Number(f.attempt) : null,
      http_status: Number.isFinite(Number(f.httpStatus)) ? Number(f.httpStatus) : null,
      reason: reportFailureReason(f.error),
    });
    if (error) console.warn(JSON.stringify({ scope: 'verify_report_failure', event: 'record_failed', jobId: f.jobId, error: String(error.message ?? error).slice(0, 160) }));
  } catch (e) {
    console.warn(JSON.stringify({ scope: 'verify_report_failure', event: 'record_failed', jobId: f.jobId, error: String((e as Error)?.message ?? e).slice(0, 160) }));
  }
}

/** A non-2xx answer from verify-synthesis, with the start of its body (a boot error says BOOT_ERROR there). */
export async function synthesisHttpError(res: Response): Promise<Error & { httpStatus: number }> {
  let body = '';
  try { body = (await res.text()).slice(0, 300); } catch { /* the status alone still says enough */ }
  const err = new Error(`verify-synthesis ${res.status}${body ? `: ${body}` : ''}`) as Error & { httpStatus: number };
  err.httpStatus = res.status;
  return err;
}
