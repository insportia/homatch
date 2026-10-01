// META ADS — INSIGHTS INGESTION. The planned queries (insights.ts), run
// against Meta, normalized, and stored by a deterministic row key so a repeat
// sync overwrites instead of duplicating. Throttled: a campaign's insights
// are read at most every INSIGHTS_MIN_MINUTES, and only while it is live or
// inside its settlement grace period.

import { graphAll } from '../_shared/metaAds.ts';
import { planQueries, queryString, normalizeRow } from '../../../src/lib/metaAds/insights.ts';

type Sb = any;

export const INSIGHTS_MIN_MINUTES = 30;
/** Daily rows are read for the most recent window only; totals cover all time. */
export const DAILY_WINDOW_DAYS = 35;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `slowdown` stretches the cadence under capacity pressure (rateLimit.allowance: ELEVATED = 2 → every hour). */
export function insightsDue(c: any, force = false, slowdown = 1, now = Date.now()): boolean {
  if (!c.external_campaign_id || String(c.external_campaign_id).startsWith('mock_')) return false;
  if (force) return true;
  const last = c.insights_synced_at ? Date.parse(c.insights_synced_at) : 0;
  return now - last >= INSIGHTS_MIN_MINUTES * Math.max(1, slowdown) * 60_000;
}

/** `breakdowns: false` (ELEVATED pressure) reads only the primary daily + total rows — the heavy breakdowns wait. */
export async function syncInsights(sb: Sb, c: any, token: string, opts: { breakdowns?: boolean } = {}): Promise<{ rows: number; queries: number }> {
  const launched = c.launched_at ? Date.parse(c.launched_at) : Date.now() - 86_400_000;
  const until = day(Date.now());
  const since = day(launched);
  const dailySince = day(Math.max(launched, Date.now() - DAILY_WINDOW_DAYS * 86_400_000));
  const hasRegions = Array.isArray(c.targeting?.locations) && c.targeting.locations.some((l: any) => l.type !== 'country');
  const audit = { sb, userId: c.user_id, campaignId: c.id };
  let rows = 0;
  let queries = 0;
  const plan = planQueries({ hasRegions }).filter((q) => opts.breakdowns !== false || q.breakdown === 'none');
  for (const q of plan) {
    const from = q.timeIncrement === 1 ? dailySince : since;
    const data = await graphAll(`/${c.external_campaign_id}/insights?${queryString(q, from, until)}`, { token, audit } as any, 10);
    queries += 1;
    const batch = data.map((raw: any) => {
      const n = normalizeRow(raw, q, c.currency);
      return {
        campaign_id: c.id, user_id: c.user_id, level: n.level,
        object_external_id: n.objectId ?? (n.level === 'campaign' ? String(c.external_campaign_id) : ''),
        day: n.date, breakdown: n.breakdown, breakdown_key: n.breakdownKey ?? '',
        window_since: q.timeIncrement === 1 ? null : from, window_until: q.timeIncrement === 1 ? null : until,
        currency: n.totals.currency, spend_minor: n.totals.spendMinor, impressions: n.totals.impressions,
        reach: n.totals.reach, clicks: n.totals.clicks, link_clicks: n.totals.linkClicks,
        landing_page_views: n.totals.landingPageViews, leads: n.totals.leads, messages: n.totals.messages,
        registrations: n.totals.registrations, post_engagements: n.totals.postEngagements,
        fetched_at: new Date().toISOString(),
      };
    });
    for (let i = 0; i < batch.length; i += 200) {
      const { error } = await sb.from('meta_insights').upsert(batch.slice(i, i + 200), { onConflict: 'campaign_id,row_key' });
      if (error) throw error;
    }
    rows += batch.length;
  }
  await sb.from('meta_campaigns').update({ insights_synced_at: new Date().toISOString() }).eq('id', c.id);
  return { rows, queries };
}
