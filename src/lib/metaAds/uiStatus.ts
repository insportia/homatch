// META ADS — THE ONE CUSTOMER-FACING CAMPAIGN STATUS. Pure.
//
// Every surface that names a campaign's state or counts campaigns by state
// (the dashboard's counts and filters, every campaign card, the drill-down
// header) reads it from here, so a number and the list it summarises can
// never disagree.
//
// Sources, in the order they are trusted:
//   1. Campaign Guard (guard_state) — a locked campaign is locked, whatever
//      Meta says about delivery.
//   2. Lost control (last_error.key = meta_err_reconnect on a launched
//      campaign) — HOMATCH can no longer read or steer it.
//   3. Meta's reconciled delivery (status written by the sync from Meta's
//      effective_status, plus external_status itself). A campaign Meta reports
//      as paused — at campaign, ad-set or ad level — is PAUSED, never ACTIVE.
//   4. HOMATCH's own lifecycle for anything not yet at Meta (drafts, the
//      HOMATCH check, payment). A creative held for a person at HOMATCH
//      (MANUAL_REVIEW) is HOMATCH_REVIEW — "In review" — never a draft and
//      never Meta's review.
//
// ACTIVE therefore means one thing: Meta is running it. Being created,
// enabled in HOMATCH or "live" in any other sense is not ACTIVE.

export type UiStatus =
  | 'DRAFT' | 'READY' | 'IN_REVIEW' | 'HOMATCH_REVIEW' | 'ACTIVE' | 'PAUSED' | 'NEEDS_ATTENTION'
  | 'ENDED' | 'FAILED' | 'ACCESS_LOST' | 'LOCKED';

export const UI_STATUSES: UiStatus[] = ['ACTIVE', 'IN_REVIEW', 'HOMATCH_REVIEW', 'PAUSED', 'NEEDS_ATTENTION', 'LOCKED', 'ACCESS_LOST', 'FAILED', 'READY', 'DRAFT', 'ENDED'];

export interface StatusInput {
  status: string;
  external_status?: string | null;
  guard_state?: string | null;
  last_error_key?: string | null;
  launched_at?: string | null;
  /** health ACTION_RECOMMENDED or a Guard review (dashboard row). */
  attention?: boolean;
}

/** Meta effective_status values that mean "not delivering because someone paused it". */
const META_PAUSED = ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];
const REVIEWING = ['SUBMITTED', 'META_REVIEW', 'LAUNCHING'];
const BUILDING = ['DRAFT', 'CONNECTION_REQUIRED', 'CREATIVE_REQUIRED', 'AUDIENCE_REQUIRED', 'PREFLIGHT_REQUIRED'];

export function uiStatus(c: StatusInput): UiStatus {
  const s = String(c.status ?? '').toUpperCase();
  const meta = String(c.external_status ?? '').toUpperCase();
  const atMeta = !!c.launched_at || REVIEWING.includes(s) || ['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED', 'REJECTED'].includes(s);

  if (c.guard_state === 'LOCKED_FOR_REVIEW') return 'LOCKED';
  if (atMeta && c.last_error_key === 'meta_err_reconnect' && !['COMPLETED', 'ARCHIVED'].includes(s)) return 'ACCESS_LOST';
  if (s === 'COMPLETED' || s === 'ARCHIVED') return 'ENDED';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'REJECTED') return 'NEEDS_ATTENTION';
  // Meta's own word wins over a HOMATCH status that has not caught up yet.
  if (atMeta && META_PAUSED.includes(meta)) return 'PAUSED';
  if (s === 'PAUSED') return 'PAUSED';
  if (s === 'ACTIVE') return 'ACTIVE';
  if (REVIEWING.includes(s)) return 'IN_REVIEW';
  if (s === 'MANUAL_REVIEW') return 'HOMATCH_REVIEW';
  if (s === 'NEEDS_CHANGES' || s === 'PAYMENT_REQUIRED') return 'NEEDS_ATTENTION';
  if (s === 'READY') return 'READY';
  if (BUILDING.includes(s)) return 'DRAFT';
  return 'DRAFT';
}

/** Whether the customer has something to do, whatever the status. */
export function needsAttention(c: StatusInput): boolean {
  const u = uiStatus(c);
  return u === 'NEEDS_ATTENTION' || u === 'FAILED' || u === 'ACCESS_LOST' || u === 'LOCKED'
    || (!!c.attention && (u === 'ACTIVE' || u === 'PAUSED' || u === 'IN_REVIEW'))
    || c.guard_state === 'NEEDS_REVIEW';
}

/** Whether the state was last confirmed by Meta (shown as "Synced with Meta"). */
export function statusFromMeta(c: StatusInput): boolean {
  const u = uiStatus(c);
  return u === 'ACTIVE' || u === 'PAUSED' || u === 'IN_REVIEW' || u === 'ENDED' || (u === 'NEEDS_ATTENTION' && String(c.status).toUpperCase() === 'REJECTED');
}

export interface StatusCounts { total: number; active: number; paused: number; attention: number }

export function statusCounts(rows: StatusInput[]): StatusCounts {
  return {
    total: rows.length,
    active: rows.filter((r) => uiStatus(r) === 'ACTIVE').length,
    paused: rows.filter((r) => uiStatus(r) === 'PAUSED').length,
    attention: rows.filter((r) => needsAttention(r)).length,
  };
}

/** The dashboard's KPI filters. 'all' shows everything. */
export type KpiFilter = 'all' | 'active' | 'paused' | 'attention';
export function matchesKpi(c: StatusInput, f: KpiFilter): boolean {
  if (f === 'active') return uiStatus(c) === 'ACTIVE';
  if (f === 'paused') return uiStatus(c) === 'PAUSED';
  if (f === 'attention') return needsAttention(c);
  return true;
}
