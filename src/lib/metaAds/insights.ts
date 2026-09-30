// META ADS — META INSIGHTS, NORMALIZED. Graph rows in, MetricTotals out, and a
// query planner that asks Meta only for breakdowns it can actually answer.
//
// Meta refuses many metric × breakdown combinations: demographic breakdowns
// (age, gender) cannot be combined with geography (country, region); reach
// and frequency are unavailable with hourly breakdowns; placement comes as
// publisher_platform × platform_position. The planner encodes those rules so
// no invalid request is ever sent. Pure.

import { emptyTotals, type MetricTotals } from './kpi.ts';

export type Level = 'campaign' | 'adset' | 'ad';
export type BreakdownSet = 'none' | 'age_gender' | 'country' | 'region' | 'placement' | 'device' | 'hour';

export const BREAKDOWN_FIELDS: Record<BreakdownSet, string[]> = {
  none: [],
  age_gender: ['age', 'gender'],
  country: ['country'],
  region: ['region'],
  placement: ['publisher_platform', 'platform_position'],
  device: ['device_platform'],
  hour: ['hourly_stats_aggregated_by_advertiser_time_zone'],
};

/** Breakdowns whose rows carry no reach (Meta does not compute unique reach per hour). */
const NO_REACH: BreakdownSet[] = ['hour'];

export const INSIGHT_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'account_currency', 'date_start', 'date_stop'];

export interface InsightQuery {
  level: Level;
  breakdown: BreakdownSet;
  timeIncrement: 1 | 'all_days';
  fields: string[];
}

/** Every combination Meta accepts that HOMATCH uses. */
export function isValidQuery(q: InsightQuery): boolean {
  if (!(q.breakdown in BREAKDOWN_FIELDS)) return false;
  if (NO_REACH.includes(q.breakdown) && q.fields.includes('reach')) return false;
  // Hourly rows are aggregated over the window; a daily series of them is not offered.
  if (q.breakdown === 'hour' && q.timeIncrement === 1) return false;
  return true;
}

/**
 * The plan for one campaign sync. Daily series at ad level (the finest level;
 * campaign and ad-set totals are derived by summing), plus window totals per
 * breakdown at campaign level — enough for placement, audience, location and
 * time intelligence without hammering Meta.
 */
export function planQueries(opts: { hasRegions: boolean }): InsightQuery[] {
  const withReach = INSIGHT_FIELDS;
  const noReach = INSIGHT_FIELDS.filter((f) => f !== 'reach');
  const qs: InsightQuery[] = [
    { level: 'ad', breakdown: 'none', timeIncrement: 1, fields: withReach },
    { level: 'campaign', breakdown: 'none', timeIncrement: 'all_days', fields: withReach },
    { level: 'campaign', breakdown: 'age_gender', timeIncrement: 'all_days', fields: withReach },
    { level: 'campaign', breakdown: 'country', timeIncrement: 'all_days', fields: withReach },
    { level: 'campaign', breakdown: 'placement', timeIncrement: 'all_days', fields: withReach },
    { level: 'campaign', breakdown: 'hour', timeIncrement: 'all_days', fields: noReach },
  ];
  if (opts.hasRegions) qs.push({ level: 'campaign', breakdown: 'region', timeIncrement: 'all_days', fields: withReach });
  return qs.filter(isValidQuery);
}

/** Graph query string for a planned query over a date window (YYYY-MM-DD). */
export function queryString(q: InsightQuery, since: string, until: string): string {
  const p = new URLSearchParams({
    level: q.level,
    fields: q.fields.join(','),
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  });
  if (q.timeIncrement === 1) p.set('time_increment', '1');
  const b = BREAKDOWN_FIELDS[q.breakdown];
  if (b.length) p.set('breakdowns', b.join(','));
  return p.toString();
}

/* ── ACTIONS ──────────────────────────────────────────────────────────── */

const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped'];
const MESSAGE_ACTIONS = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const REGISTRATION_ACTIONS = ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'omni_complete_registration'];
const LPV_ACTIONS = ['landing_page_view', 'omni_landing_page_view'];
const ENGAGEMENT_ACTIONS = ['post_engagement', 'page_engagement'];

/** Meta reports the same result under several action types; take the
 *  largest of a family rather than summing duplicates of one event. */
function family(actions: Array<{ action_type?: string; value?: string | number }>, types: string[]): number {
  let best = 0;
  for (const a of actions) {
    if (types.includes(String(a.action_type))) best = Math.max(best, Number(a.value ?? 0) || 0);
  }
  return best;
}

const toMinor = (spend: unknown) => Math.round((parseFloat(String(spend ?? '0')) || 0) * 100);
const int = (v: unknown) => Math.max(0, Math.round(Number(v ?? 0) || 0));

export interface NormalizedRow {
  date: string | null;           // date_start for daily rows; null for window totals
  level: Level;
  objectId: string | null;       // ad/adset/campaign id at the row's level
  breakdown: BreakdownSet;
  breakdownKey: string | null;   // e.g. "25-34|female", "GE", "instagram|stories", "18"
  totals: MetricTotals;
}

export function normalizeRow(row: Record<string, unknown>, q: InsightQuery, currencyFallback = 'USD'): NormalizedRow {
  const actions = Array.isArray(row.actions) ? row.actions as Array<{ action_type?: string; value?: string }> : [];
  const totals = emptyTotals(String(row.account_currency ?? currencyFallback));
  totals.spendMinor = toMinor(row.spend);
  totals.impressions = int(row.impressions);
  totals.reach = row.reach != null ? int(row.reach) : null;
  totals.clicks = int(row.clicks);
  totals.linkClicks = int(row.inline_link_clicks);
  totals.leads = family(actions, LEAD_ACTIONS);
  totals.messages = family(actions, MESSAGE_ACTIONS);
  totals.registrations = family(actions, REGISTRATION_ACTIONS);
  totals.landingPageViews = family(actions, LPV_ACTIONS);
  totals.postEngagements = family(actions, ENGAGEMENT_ACTIONS);
  const b = BREAKDOWN_FIELDS[q.breakdown];
  const key = b.length ? b.map((f) => {
    const v = String(row[f] ?? '');
    return f === 'hourly_stats_aggregated_by_advertiser_time_zone' ? v.slice(0, 2) : v;
  }).join('|') : null;
  const idField = q.level === 'ad' ? 'ad_id' : q.level === 'adset' ? 'adset_id' : 'campaign_id';
  return {
    date: q.timeIncrement === 1 ? String(row.date_start ?? '') || null : null,
    level: q.level,
    objectId: row[idField] != null ? String(row[idField]) : null,
    breakdown: q.breakdown,
    breakdownKey: key,
    totals,
  };
}

/** Rows stored for placement analysis, in customer words. */
export function placementLabel(key: string): string {
  const [platform, position] = key.split('|');
  const p = `${platform}_${position}`.toLowerCase();
  const known: Record<string, string> = {
    facebook_feed: 'FACEBOOK_FEED', instagram_feed: 'INSTAGRAM_FEED', instagram_stream: 'INSTAGRAM_FEED',
    facebook_story: 'FACEBOOK_STORIES', instagram_story: 'INSTAGRAM_STORIES', facebook_stories: 'FACEBOOK_STORIES',
    instagram_reels: 'INSTAGRAM_REELS', facebook_facebook_reels: 'FACEBOOK_REELS', facebook_marketplace: 'MARKETPLACE',
    messenger_messenger_inbox: 'MESSENGER', instagram_explore: 'INSTAGRAM_EXPLORE', audience_network_classic: 'AUDIENCE_NETWORK',
    facebook_video_feeds: 'FACEBOOK_VIDEO_FEEDS', facebook_right_hand_column: 'FACEBOOK_RIGHT_COLUMN', facebook_search: 'FACEBOOK_SEARCH',
  };
  return known[p] ?? 'OTHER';
}
