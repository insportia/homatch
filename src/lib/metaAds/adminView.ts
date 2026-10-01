// META ADS — THE ADMIN CONTROL CENTER'S VIEW OF A CAMPAIGN. Pure.
//
// The admin sees three things the customer sees as one:
//   • the HOMATCH lifecycle   — meta_campaigns.status, exactly as stored;
//   • the canonical delivery  — uiStatus() from ./uiStatus, the SAME function
//     the customer dashboard counts with, so a campaign Meta reports paused
//     is never "Active/Delivering" here either;
//   • Meta's own word         — external_status (effective_status at the last
//     sync), with when that sync happened and whether it is still fresh.
// A disagreement between the first and the third is a DISCREPANCY, shown,
// never silently resolved. Transport health (connection, API errors) is a
// separate signal and never changes the delivery state.
//
// Every admin KPI and the Campaigns filter read from here, so a count and the
// list it opens can never disagree.
import { uiStatus, needsAttention, type StatusInput, type UiStatus } from './uiStatus.ts';

export interface AdminCampaignRow extends StatusInput {
  external_campaign_id?: string | null;
  last_synced_at?: string | null;
}

/** HOMATCH statuses whose Meta state the sync keeps reading (index.ts statusSync). */
export const SYNCED_LIFECYCLE = ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'];
/** The minute pass reads delivering/reviewing campaigns every minute and paused
 *  ones every fifth; the 15-minute maintenance pass reads them all. Older than
 *  this, the state on screen is stale. */
export const STALE_AFTER_MS = 20 * 60_000;

const META_PAUSED = ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];
const META_GONE = ['DELETED', 'ARCHIVED'];
const META_PROBLEM = ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'];

const atMeta = (c: AdminCampaignRow) =>
  !!c.external_campaign_id && !String(c.external_campaign_id).startsWith('mock_');

export type Freshness = 'FRESH' | 'STALE' | 'NEVER' | 'NOT_SYNCED';

/** Whether the Meta state on screen is recent enough to trust. */
export function syncFreshness(c: AdminCampaignRow, now: number): Freshness {
  if (!atMeta(c) || !SYNCED_LIFECYCLE.includes(String(c.status).toUpperCase())) return 'NOT_SYNCED';
  if (!c.last_synced_at) return 'NEVER';
  const t = Date.parse(c.last_synced_at);
  if (!Number.isFinite(t)) return 'NEVER';
  return now - t > STALE_AFTER_MS ? 'STALE' : 'FRESH';
}

export type Discrepancy =
  | 'META_PAUSED_HOMATCH_ACTIVE'   // HOMATCH says ACTIVE, Meta says paused
  | 'META_ACTIVE_HOMATCH_PAUSED'   // HOMATCH says PAUSED, Meta is delivering
  | 'META_GONE'                    // HOMATCH thinks it is live, Meta deleted/archived it
  | 'META_PROBLEM'                 // Meta reports disapproval / issues / billing
  | 'NO_META_STATE';               // launched at Meta, but no state ever read

/** HOMATCH's lifecycle and Meta's reported state disagree — or Meta is silent. */
export function discrepancy(c: AdminCampaignRow): Discrepancy | null {
  if (!atMeta(c)) return null;
  const s = String(c.status ?? '').toUpperCase();
  const meta = String(c.external_status ?? '').toUpperCase();
  if (!SYNCED_LIFECYCLE.includes(s)) return null;
  if (!meta) return 'NO_META_STATE';
  if (META_GONE.includes(meta)) return 'META_GONE';
  if (META_PROBLEM.includes(meta)) return 'META_PROBLEM';
  if (s === 'ACTIVE' && META_PAUSED.includes(meta)) return 'META_PAUSED_HOMATCH_ACTIVE';
  if (s === 'PAUSED' && meta === 'ACTIVE') return 'META_ACTIVE_HOMATCH_PAUSED';
  return null;
}

/** The admin KPI / Campaigns filters. One meaning each, used for both. */
export const ADMIN_FILTERS = [
  'all', 'delivering', 'paused', 'review', 'drafts', 'rejected', 'failed', 'attention', 'discrepancy', 'stale',
] as const;
export type AdminFilter = typeof ADMIN_FILTERS[number];
export const isAdminFilter = (v: unknown): v is AdminFilter => ADMIN_FILTERS.includes(v as AdminFilter);

export function matchesAdminFilter(c: AdminCampaignRow, f: AdminFilter, now: number): boolean {
  const u: UiStatus = uiStatus(c);
  switch (f) {
    case 'delivering': return u === 'ACTIVE';
    case 'paused': return u === 'PAUSED';
    // Meta's review, or HOMATCH's own manual check of a creative (MANUAL_REVIEW).
    case 'review': return u === 'IN_REVIEW' || String(c.status).toUpperCase() === 'MANUAL_REVIEW';
    case 'drafts': return (u === 'DRAFT' || u === 'READY') && String(c.status).toUpperCase() !== 'MANUAL_REVIEW';
    // Rejected is a lifecycle fact (the customer sees it as "needs attention").
    case 'rejected': return String(c.status).toUpperCase() === 'REJECTED';
    case 'failed': return u === 'FAILED';
    case 'attention': return needsAttention(c);
    case 'discrepancy': return discrepancy(c) !== null;
    case 'stale': { const fr = syncFreshness(c, now); return fr === 'STALE' || fr === 'NEVER'; }
    default: return true;
  }
}

export type AdminCounts = Record<AdminFilter, number>;

export function adminCounts(rows: AdminCampaignRow[], now: number): AdminCounts {
  const out = Object.fromEntries(ADMIN_FILTERS.map((f) => [f, 0])) as AdminCounts;
  for (const r of rows) for (const f of ADMIN_FILTERS) if (matchesAdminFilter(r, f, now)) out[f] += 1;
  return out;
}
