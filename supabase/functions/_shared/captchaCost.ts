/*
 * CAPTCHA SPEND IN cost_events (2026-10-11).
 *
 * Every 2Captcha solve the worker reports already lands in
 * verify_captcha_events — the per-job ledger the Verify customer meter reads.
 * Finance (finance_cost_facts, provider totals, system health) reads
 * cost_events, where CAPTCHA spend was missing entirely. This builds the
 * cost_events row for one newly recorded ledger event, written by
 * verify-queue in the same request.
 *
 * Deliberate choices:
 *   provider        'OTHER' — cost_provider has no 2Captcha value, and adding
 *                   one is a separate (enum) migration. The vendor is named in
 *                   `source` (vendor=2captcha).
 *   operation_type  'CAPTCHA_SOLVE' — NOT 'VERIFY_*': finance_cost_facts
 *                   excludes VERIFY% from cost_events (that stream is the
 *                   OpenAI stage meter), and recordVerificationCost skips a
 *                   job that already has a VERIFY_ row.
 *   job_id          NULL — verify_job_cost() already prices CAPTCHA from
 *                   verify_captcha_events AND adds every non-OpenAI
 *                   cost_events row carrying the job id; attaching the job
 *                   here would bill the customer for the same solve twice.
 *                   The job and task ids travel in `source`.
 *   request_id      the ledger's idempotency key, so the row is traceable to
 *                   (and written once with) its ledger event.
 *
 * A solve with no recorded price is UNPRICED, never a silent 0. An outcome
 * that consumed no paid solve (disabled, budget, no challenge…) writes nothing.
 * Pure: no network.
 */

/** Ledger outcomes that consumed a paid 2Captcha solve. */
export const PAID_CAPTCHA_OUTCOMES: ReadonlySet<string> = new Set(['ACCEPTED', 'REJECTED', 'NO_CHANGE']);

export interface CaptchaLedgerInput {
  idempotencyKey: string;
  source: string;
  outcome: string;
  costUsd: number | null;
  kind: string | null;
  provider: string | null;
  jobId: string | null;
  taskId: string | null;
}

export function captchaCostEventRow(e: CaptchaLedgerInput): Record<string, unknown> | null {
  if (!PAID_CAPTCHA_OUTCOMES.has(e.outcome)) return null;
  // A REJECTED solve is reported bad and refunded by 2Captcha: the ledger records it at 0.
  if (e.outcome === 'REJECTED' && e.costUsd === 0) return null;
  const known = e.costUsd != null && Number.isFinite(e.costUsd) && e.costUsd >= 0;
  return {
    provider: 'OTHER',
    operation_type: 'CAPTCHA_SOLVE',
    source: [
      `vendor=${(e.provider || '2captcha').toLowerCase()}`,
      `kind=${e.kind || 'recaptcha_v2'}`,
      `source=${e.source}`,
      `outcome=${e.outcome}`,
      e.jobId ? `job=${e.jobId}` : null,
      e.taskId ? `task=${e.taskId}` : null,
    ].filter(Boolean).join(';'),
    request_id: e.idempotencyKey,
    units: 1,
    cost_usd: known ? e.costUsd : 0,
    // The worker's figure is CAPTCHA_RECAPTCHA_COST_USD per solve (default $0.003), not a provider invoice.
    pricing_state: known ? 'ESTIMATED' : 'UNPRICED',
    success: e.outcome === 'ACCEPTED',
    cache_hit: false,
    job_id: null,
  };
}
