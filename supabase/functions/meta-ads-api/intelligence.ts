// META ADS — CAMPAIGN INTELLIGENCE. One loader turns stored Meta insights and
// HOMATCH lead outcomes into the analysis the customer sees AND the analysis
// the monitor judges — the same numbers on screen and in every alert.
// Deterministic; no AI here.

import { emptyTotals, kpis, sumTotals, type MetricTotals, type Outcomes } from '../../../src/lib/metaAds/kpi.ts';
import { placementLabel } from '../../../src/lib/metaAds/insights.ts';
import {
  leaderOf, classifyCreatives, health, recommend, summaryFacts, factsKey, evidenceOf,
  DEFAULT_ANALYSIS_PARAMS, type AnalysisParams, type DailyPoint, type Recommendation,
} from '../../../src/lib/metaAds/analysis.ts';

type Sb = any;

export const QUALIFIED = ['QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON'];
export const VIEWED = ['VIEWING', 'NEGOTIATING', 'WON'];

const totalsOf = (r: any): MetricTotals => ({
  currency: r.currency, spendMinor: Number(r.spend_minor), impressions: Number(r.impressions),
  reach: r.reach == null ? null : Number(r.reach), clicks: Number(r.clicks), linkClicks: Number(r.link_clicks),
  landingPageViews: Number(r.landing_page_views), leads: Number(r.leads), messages: Number(r.messages),
  registrations: Number(r.registrations), postEngagements: Number(r.post_engagements),
});

const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

function outcomesOf(leads: any[]): Outcomes & { leads: number } {
  return {
    leads: leads.length,
    qualifiedLeads: leads.filter((l) => QUALIFIED.includes(l.status)).length,
    contacted: leads.filter((l) => l.status !== 'NEW').length,
    viewings: leads.filter((l) => VIEWED.includes(l.status)).length,
    won: leads.filter((l) => l.status === 'WON').length,
  };
}

export interface CampaignAnalysis {
  currency: string;
  windows: { current: { since: string; until: string }; previous: { since: string; until: string } };
  lifetime: MetricTotals | null;
  current: MetricTotals | null;
  previous: MetricTotals | null;
  daily: Array<{ date: string; totals: MetricTotals }>;
  outcomes: { lifetime: Outcomes & { leads: number }; current: Outcomes & { leads: number }; previous: Outcomes & { leads: number } };
  ads: Array<{ key: string; totals: MetricTotals; outcomes: Outcomes; series: DailyPoint[] }>;
  creativeClasses: ReturnType<typeof classifyCreatives>;
  segments: {
    placement: Array<{ key: string; totals: MetricTotals }>;
    ageGender: Array<{ key: string; totals: MetricTotals }>;
    country: Array<{ key: string; totals: MetricTotals }>;
    region: Array<{ key: string; totals: MetricTotals }>;
    hour: Array<{ key: string; totals: MetricTotals }>;
  };
  leaders: { placement: { key: string; evidence: any } | null; audience: { key: string; evidence: any } | null; creative: { key: string; evidence: any } | null };
  leadHours: number[];
  health: ReturnType<typeof health>;
  recommendations: Recommendation[];
  facts: ReturnType<typeof summaryFacts>;
  factsKey: string;
  evidence: ReturnType<typeof evidenceOf>;
}

export async function analyzeCampaign(sb: Sb, c: any, params: AnalysisParams = DEFAULT_ANALYSIS_PARAMS, now = Date.now()): Promise<CampaignAnalysis> {
  const [{ data: rows }, { data: leads }] = await Promise.all([
    sb.from('meta_insights').select('*').eq('campaign_id', c.id).limit(20000),
    sb.from('meta_leads').select('id,status,received_at,ad_external_id').eq('campaign_id', c.id).limit(10000),
  ]);
  const all = rows ?? [];
  const currency = String(c.currency ?? all[0]?.currency ?? 'USD');
  const curUntil = dayStr(now);
  const curSince = dayStr(now - 6 * 86_400_000);
  const prevUntil = dayStr(now - 7 * 86_400_000);
  const prevSince = dayStr(now - 13 * 86_400_000);
  const inRange = (d: string | null, a: string, b: string) => !!d && d >= a && d <= b;

  const adDaily = all.filter((r: any) => r.level === 'ad' && r.breakdown === 'none' && r.day);
  const byDay = new Map<string, MetricTotals[]>();
  for (const r of adDaily) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(totalsOf(r));
  const daily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ts]) => ({ date, totals: sumTotals(ts)! }));
  const windowSum = (a: string, b: string) => sumTotals(daily.filter((d) => inRange(d.date, a, b)).map((d) => d.totals));
  const current = windowSum(curSince, curUntil);
  const previous = windowSum(prevSince, prevUntil);
  const lifetimeRow = all.find((r: any) => r.level === 'campaign' && r.breakdown === 'none' && !r.day);
  const lifetime = lifetimeRow ? totalsOf(lifetimeRow) : sumTotals(daily.map((d) => d.totals));

  const leadRows = leads ?? [];
  const leadsIn = (a: string, b: string) => leadRows.filter((l: any) => inRange(String(l.received_at).slice(0, 10), a, b));
  const outcomes = { lifetime: outcomesOf(leadRows), current: outcomesOf(leadsIn(curSince, curUntil)), previous: outcomesOf(leadsIn(prevSince, prevUntil)) };

  const adIds: string[] = [...new Set<string>(adDaily.map((r: any) => String(r.object_external_id)))];
  const ads = adIds.map((id) => {
    const series = adDaily.filter((r: any) => r.object_external_id === id).map((r: any) => ({ date: r.day, totals: totalsOf(r) }));
    return {
      key: id,
      totals: sumTotals(series.map((s: any) => s.totals)) ?? emptyTotals(currency),
      outcomes: outcomesOf(leadRows.filter((l: any) => l.ad_external_id === id)),
      series,
    };
  });
  const creativeClasses = classifyCreatives(c.goal, ads, params);

  const seg = (b: string, label: (k: string) => string = (k) => k) => {
    const m = new Map<string, MetricTotals[]>();
    for (const r of all.filter((x: any) => x.level === 'campaign' && x.breakdown === b && !x.day)) {
      const k = label(r.breakdown_key);
      (m.get(k) ?? m.set(k, []).get(k)!).push(totalsOf(r));
    }
    return [...m.entries()].map(([key, ts]) => ({ key, totals: sumTotals(ts)! }));
  };
  const segments = {
    placement: seg('placement', placementLabel), ageGender: seg('age_gender'), country: seg('country'),
    region: seg('region'), hour: seg('hour'),
  };
  const pl = leaderOf(c.goal, segments.placement, params);
  const au = leaderOf(c.goal, segments.ageGender, params);
  const cr = leaderOf(c.goal, ads, params);
  const leaders = {
    placement: pl.leader ? { key: pl.leader.key, evidence: pl.leader.evidence } : null,
    audience: au.leader ? { key: au.leader.key, evidence: au.leader.evidence } : null,
    creative: cr.leader ? { key: cr.leader.key, evidence: cr.leader.evidence } : null,
  };
  // HOMATCH-side timing: when leads ARRIVED (not Meta delivery hours).
  const leadHours = Array.from({ length: 24 }, (_, h) => leadRows.filter((l: any) => new Date(l.received_at).getUTCHours() === h).length);

  const { data: changed } = await sb.from('meta_recommendations').select('affected').eq('campaign_id', c.id).eq('status', 'APPLIED')
    .gte('acted_at', new Date(now - params.cooldownDays * 86_400_000).toISOString());
  const recommendations = recommend({
    goal: c.goal, status: c.status, dailyBudgetMinor: Number(c.daily_budget_cents ?? 0),
    window: { current: `${curSince}..${curUntil}`, previous: `${prevSince}..${prevUntil}` },
    campaign: { current, previous, outcomes: outcomes.current }, ads, recentlyChanged: (changed ?? []).map((x: any) => x.affected),
  }, params);

  const launched = c.launched_at ? Date.parse(c.launched_at) : now;
  const last3 = sumTotals(daily.filter((d) => d.date >= dayStr(now - 2 * 86_400_000)).map((d) => d.totals));
  const h = health({
    goal: c.goal, status: c.status, daysRunning: Math.floor((now - launched) / 86_400_000),
    dailyBudgetMinor: Number(c.daily_budget_cents ?? 0), last3Days: last3, current, previous,
    outcomes: outcomes.current, leads: outcomes.current.leads, creativeClasses: creativeClasses.map((x) => x.cls),
    lastSyncMinutes: c.insights_synced_at ? Math.round((now - Date.parse(c.insights_synced_at)) / 60_000) : null,
    connectionOk: !c.last_error || c.last_error?.key !== 'meta_err_reconnect',
  }, params);
  const facts = summaryFacts({ goal: c.goal, status: c.status, currency, totals: lifetime, outcomes: outcomes.lifetime,
    placementLeader: leaders.placement, audienceLeader: leaders.audience, creativeLeader: leaders.creative, recommendations });
  const k = lifetime ? kpis(c.goal, lifetime, outcomes.lifetime) : null;
  return {
    currency, windows: { current: { since: curSince, until: curUntil }, previous: { since: prevSince, until: prevUntil } },
    lifetime, current, previous, daily, outcomes, ads, creativeClasses, segments, leaders, leadHours,
    health: h, recommendations, facts, factsKey: factsKey(facts),
    evidence: evidenceOf(k?.results ?? 0, lifetime?.impressions ?? 0, params),
  };
}

/**
 * Store recommendations: one row per (campaign, type, object, window). An
 * existing one keeps its status (a dismissed recommendation is not re-opened
 * for the same window); open ones no longer produced expire. Returns the rows
 * that are NEW this cycle.
 */
export async function persistRecommendations(sb: Sb, c: any, recs: Recommendation[]) {
  const fresh: Array<Recommendation & { id: string; isNew: boolean }> = [];
  const keys: string[] = [];
  for (const r of recs) {
    const dedupe = `${c.id}:${r.type}:${r.affected}:${r.window.current}`;
    keys.push(dedupe);
    const { data: prior } = await sb.from('meta_recommendations').select('id,status').eq('dedupe_key', dedupe).maybeSingle();
    if (prior) { fresh.push({ ...r, id: prior.id, isNew: false }); continue; }
    const { data, error } = await sb.from('meta_recommendations').insert({
      campaign_id: c.id, user_id: c.user_id, type: r.type, affected: r.affected, window_current: r.window.current,
      window_previous: r.window.previous, metric: r.metric, baseline: r.baseline, candidate: r.candidate,
      confidence: r.confidence, reason_codes: r.reasonCodes, actionable: r.actionable,
      proposed: r.proposedDailyMinor ? { dailyBudgetCents: r.proposedDailyMinor } : null, dedupe_key: dedupe,
    }).select('id').single();
    if (error) { if (String(error.message).includes('duplicate')) continue; throw error; }
    fresh.push({ ...r, id: data.id, isNew: true });
  }
  const { data: open } = await sb.from('meta_recommendations').select('id,dedupe_key').eq('campaign_id', c.id).eq('status', 'OPEN');
  const stale = (open ?? []).filter((o: any) => !keys.includes(o.dedupe_key)).map((o: any) => o.id);
  if (stale.length) await sb.from('meta_recommendations').update({ status: 'EXPIRED' }).in('id', stale);
  return fresh;
}

/** Outcome of recommendations applied at least three days ago. */
export async function scoreAppliedRecommendations(sb: Sb, c: any, a: CampaignAnalysis) {
  const { data: applied } = await sb.from('meta_recommendations').select('id,before_metrics,acted_at').eq('campaign_id', c.id)
    .eq('status', 'APPLIED').is('outcome', null).lte('acted_at', new Date(Date.now() - 3 * 86_400_000).toISOString());
  for (const r of applied ?? []) {
    const before = Number(r.before_metrics?.costPerResultMinor ?? NaN);
    const k = a.current ? kpis(c.goal, a.current, a.outcomes.current) : null;
    const ev = a.current ? evidenceOf(k!.results, a.current.impressions) : 'INSUFFICIENT_DATA';
    let outcome = 'INSUFFICIENT_DATA';
    if (Number.isFinite(before) && k?.costPerResultMinor != null && (ev === 'MEANINGFUL_SIGNAL' || ev === 'HIGH_CONFIDENCE')) {
      const d = (k.costPerResultMinor - before) / before;
      outcome = d <= -0.1 ? 'HELPED' : d >= 0.1 ? 'HURT' : 'NEUTRAL';
    }
    await sb.from('meta_recommendations').update({ outcome, outcome_at: new Date().toISOString(), after_metrics: { costPerResultMinor: k?.costPerResultMinor ?? null, evidence: ev } }).eq('id', r.id);
  }
}
