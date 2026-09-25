// HOMATCH — the freshness contract, where it meets rows.
//
// The RULES are in src/research-core/discovery/revalidation.ts, which is pure
// and has no database in it. This is the half that reads raw_signals, decides
// whether a piece of evidence may be delivered, schedules a re-check when it
// may not, and writes the result of one back.
//
// WHY THE GATE LIVES IN THE MATCH WRITER
//
// run-matching-v2 is the only thing in Homatch that turns external evidence
// into a row a customer sees. Everything upstream of it produces intelligence;
// everything downstream reads `matches`. So it is the one place where "this is
// too old to show" can be enforced once instead of in every reader.
//
// It is also the right place for the OTHER half of the rule. A stale signal is
// not discarded — it is refused for this run and QUEUED, so the next campaign
// that wants it finds it fresh. Dropping it silently would make the corpus
// shrink every week with nothing recording why.
//
// WHAT MUST NOT HAPPEN HERE
//
// A fetch. This module schedules work and never performs it: revalidating
// during a match run would put somebody else's server latency inside a
// customer's campaign, and a signal wanted by forty campaigns would be
// re-read forty times. The worker does the reading, on its own tick, against
// a deduplicated queue.

import {
  type DeliveryDecision,
  type EvidenceFreshness,
  type FreshnessPolicy,
  applyRevalidation,
  judgeDelivery,
  type RevalidationOutcome,
} from '../../../src/research-core/discovery/revalidation.ts';

export type { DeliveryDecision, RevalidationOutcome };

/** The columns the contract needs. Select exactly these and nothing more. */
export const FRESHNESS_COLUMNS =
  'discovered_at,last_seen_at,last_verified_at,content_changed_at,expires_at,'
  + 'content_fingerprint,validation_state,failed_checks';

/** A raw_signals row, in the shape the pure module understands. */
export function freshnessFromRow(row: Record<string, unknown> | null | undefined): EvidenceFreshness {
  const at = String(row?.discovered_at ?? new Date().toISOString());
  return {
    firstSeenAt: at,
    lastSeenAt: String(row?.last_seen_at ?? at),
    /*
     * NULL stays NULL. A row that predates the contract has never been
     * re-read, and defaulting this to discovered_at would mark the entire
     * historical corpus verified at the moment it arrived.
     */
    lastVerifiedAt: row?.last_verified_at ? String(row.last_verified_at) : null,
    contentChangedAt: row?.content_changed_at ? String(row.content_changed_at) : null,
    expiresAt: row?.expires_at ? String(row.expires_at) : null,
    contentFingerprint: String(row?.content_fingerprint ?? ''),
    validationState: (row?.validation_state as EvidenceFreshness['validationState']) ?? 'UNVERIFIED',
    failedChecks: Number(row?.failed_checks ?? 0),
  };
}

/** The configured delivery window, or the seven-day default. */
export async function loadFreshnessPolicy(db: any): Promise<FreshnessPolicy> {
  try {
    const { data } = await db
      .from('admin_settings')
      .select('value')
      .eq('key', 'evidence_delivery_window_days')
      .maybeSingle();
    const days = Number(typeof data?.value === 'object' ? data.value : data?.value);
    return Number.isFinite(days) && days > 0 ? { deliveryWindowDays: days } : {};
  } catch {
    // A missing setting is not a reason to deliver stale evidence, and not a
    // reason to deliver none: the default IS the policy.
    return {};
  }
}

export interface GateResult {
  decision: DeliveryDecision;
  /** May this evidence become a customer-visible match right now? */
  deliverable: boolean;
  /** Set when a re-check was scheduled because of this decision. */
  queuedJobId: string | null;
}

/**
 * May this signal be delivered, and if not, is anything being done about it?
 *
 * The four refusals, each for its own reason:
 *
 *   REMOVED              it is gone. Nothing to re-check, nothing to show.
 *   INVALID              re-read and it no longer qualifies. Same.
 *   NEEDS_REVALIDATION   it may still be true and we cannot currently say so.
 *                        Refused for this run and QUEUED.
 *   UNVERIFIABLE         we have tried and cannot read it. Queued too, because
 *                        a source that was refusing us last week may not be
 *                        this week — but never delivered on the strength of a
 *                        first sighting we already know we cannot confirm.
 */
export async function gateForDelivery(
  db: any,
  signalId: string,
  row: Record<string, unknown> | null | undefined,
  options: { policy?: FreshnessPolicy; now?: number; requestedBy?: string } = {},
): Promise<GateResult> {
  const decision = judgeDelivery(freshnessFromRow(row), {
    now: options.now,
    policy: options.policy,
  });

  if (decision.deliverable) {
    return { decision, deliverable: true, queuedJobId: null };
  }

  if (!decision.needsRevalidation) {
    // REMOVED or INVALID. Re-checking something we conclusively established is
    // gone would be spending money to learn it again.
    return { decision, deliverable: false, queuedJobId: null };
  }

  let queuedJobId: string | null = null;
  try {
    const { data } = await db.rpc('request_revalidation', {
      p_signal_id: signalId,
      p_reason: decision.reason,
      p_requested_by: options.requestedBy ?? 'run-matching-v2',
    });
    queuedJobId = data ? String(data) : null;
  } catch {
    /*
     * Failing to QUEUE a re-check must not turn into delivering stale
     * evidence. The signal stays undelivered either way; the worst case is
     * that it waits for the next campaign to ask.
     */
    queuedJobId = null;
  }

  return { decision, deliverable: false, queuedJobId };
}

/**
 * Write one revalidation result back onto the signal.
 *
 * Every rule about which timestamp may move is applied by applyRevalidation,
 * not here: this reads the row, hands it over, and writes what comes back.
 * Reimplementing "advance last_verified_at" in SQL is exactly how a timeout
 * becomes a confirmation.
 */
export async function recordRevalidation(
  db: any,
  signalId: string,
  outcome: RevalidationOutcome,
  options: { at?: string; text?: string | null; policy?: FreshnessPolicy } = {},
): Promise<{ ok: boolean; contentChanged: boolean; reason: string }> {
  const { data: row, error } = await db
    .from('raw_signals')
    .select(FRESHNESS_COLUMNS)
    .eq('id', signalId)
    .maybeSingle();
  if (error || !row) {
    return { ok: false, contentChanged: false, reason: 'the signal could not be read' };
  }

  const result = applyRevalidation(freshnessFromRow(row), {
    outcome,
    at: options.at ?? new Date().toISOString(),
    text: options.text ?? null,
    policy: options.policy,
  });
  const f = result.freshness;

  /*
   * discovered_at is deliberately absent from this update. It is immutable,
   * a trigger enforces that, and including it -- even set to its own value --
   * invites the next edit to set it to something else.
   */
  const { error: writeError } = await db.from('raw_signals').update({
    last_seen_at: f.lastSeenAt,
    last_verified_at: f.lastVerifiedAt,
    content_changed_at: f.contentChangedAt,
    expires_at: f.expiresAt,
    content_fingerprint: f.contentFingerprint,
    validation_state: f.validationState,
    failed_checks: f.failedChecks,
    last_revalidation_outcome: outcome,
  }).eq('id', signalId);

  if (writeError) {
    return { ok: false, contentChanged: result.contentChanged, reason: String(writeError.message ?? writeError) };
  }
  return { ok: true, contentChanged: result.contentChanged, reason: result.reason };
}
