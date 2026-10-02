// META ADS — WHAT THE NUMBERS MEAN. Deterministic analysis over real Meta
// insights and HOMATCH lead outcomes: evidence levels, segment comparison,
// creative classification, campaign health and structured recommendations.
//
// The rule this file exists to keep: NO WINNER FROM A TINY SAMPLE. Every
// judgement carries an evidence level, and only MEANINGFUL_SIGNAL or
// HIGH_CONFIDENCE may produce a recommendation that changes money or
// delivery. AI never produces a recommendation; it may only narrate the
// structured ones built here. Pure.

import { kpis, sumTotals, type MetricTotals, type Outcomes } from './kpi.ts';

export type Evidence = 'INSUFFICIENT_DATA' | 'EARLY_SIGNAL' | 'MEANINGFUL_SIGNAL' | 'HIGH_CONFIDENCE';

export interface AnalysisParams {
  minImpressions: number;
  earlyResults: number;
  meaningfulResults: number;
  highResults: number;
  /** A leader must beat the runner-up by this share on cost per result. */
  minCostGap: number;
  /** Days after an applied change before the same object is judged again. */
  cooldownDays: number;
  fatigueMinImpressions: number;
}

export const DEFAULT_ANALYSIS_PARAMS: AnalysisParams = {
  minImpressions: 1000,
  earlyResults: 3,
  meaningfulResults: 10,
  highResults: 30,
  minCostGap: 0.2,
  cooldownDays: 3,
  fatigueMinImpressions: 3000,
};

/**
 * ONE LEARNING MODEL, told truthfully. A campaign that has not run has no
 * evidence: it starts from HOMATCH's initial strategy. A running one collects
 * Meta's own reported results; only once evidenceOf() finds a real signal do
 * HOMATCH's recommendations lean on them (still RECOMMEND — nothing is applied
 * without the owner). Signals are Meta's aggregate reporting (creatives,
 * placements, Meta's own age/gender breakdowns) — no trait is ever inferred.
 */
export type LearningStage = 'NEW' | 'COLLECTING' | 'USING_SIGNALS';

export function learningStage(launched: boolean, evidence: Evidence | null | undefined): LearningStage {
  if (!launched) return 'NEW';
  return !evidence || evidence === 'INSUFFICIENT_DATA' ? 'COLLECTING' : 'USING_SIGNALS';
}

export function evidenceOf(results: number, impressions: number, p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS): Evidence {
  if (results >= p.highResults && impressions >= p.minImpressions * 5) return 'HIGH_CONFIDENCE';
  if (results >= p.meaningfulResults && impressions >= p.minImpressions) return 'MEANINGFUL_SIGNAL';
  if (results >= p.earlyResults || impressions >= p.minImpressions) return 'EARLY_SIGNAL';
  return 'INSUFFICIENT_DATA';
}

const RANK: Record<Evidence, number> = { INSUFFICIENT_DATA: 0, EARLY_SIGNAL: 1, MEANINGFUL_SIGNAL: 2, HIGH_CONFIDENCE: 3 };
export const atLeast = (e: Evidence, min: Evidence) => RANK[e] >= RANK[min];
const weaker = (a: Evidence, b: Evidence): Evidence => (RANK[a] <= RANK[b] ? a : b);

export interface Segment {
  key: string;
  totals: MetricTotals;
  outcomes?: Outcomes;
}

export interface SegmentVerdict {
  key: string;
  evidence: Evidence;
  results: number;
  costPerResultMinor: number | null;
  ctr: number | null;
  qualificationRate: number | null;
}

/**
 * THE LEADER among segments (placements, ages, locations, creatives), judged
 * on cost per QUALIFIED result when HOMATCH has enough qualification data,
 * otherwise on cost per result. Null when no segment has meaningful
 * evidence or the gap is too small to call.
 */
export function leaderOf(goal: string, segments: Segment[], p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS) {
  const verdicts: SegmentVerdict[] = segments.map((s) => {
    const k = kpis(goal, s.totals, s.outcomes);
    return {
      key: s.key, evidence: evidenceOf(k.results, s.totals.impressions, p), results: k.results,
      costPerResultMinor: k.costPerResultMinor, ctr: k.ctr, qualificationRate: k.qualificationRate,
    };
  });
  const qualified = segments.reduce((n, s) => n + Number(s.outcomes?.qualifiedLeads ?? 0), 0);
  const useQuality = qualified >= p.meaningfulResults;
  const cost = (s: Segment) => {
    const k = kpis(goal, s.totals, s.outcomes);
    return useQuality ? k.cpqlMinor : k.costPerResultMinor;
  };
  const eligible = segments
    .map((s, i) => ({ s, v: verdicts[i], c: cost(s) }))
    .filter((x) => x.c != null && atLeast(x.v.evidence, 'MEANINGFUL_SIGNAL'))
    .sort((a, b) => (a.c as number) - (b.c as number));
  if (eligible.length < 2) return { leader: null, runnerUp: null, basis: useQuality ? 'QUALIFIED' : 'RESULT', verdicts } as const;
  const [best, second] = eligible;
  const gap = ((second.c as number) - (best.c as number)) / (second.c as number);
  if (gap < p.minCostGap) return { leader: null, runnerUp: null, basis: useQuality ? 'QUALIFIED' : 'RESULT', verdicts } as const;
  return {
    leader: { key: best.s.key, costMinor: best.c as number, evidence: weaker(best.v.evidence, second.v.evidence), gap },
    runnerUp: { key: second.s.key, costMinor: second.c as number },
    basis: useQuality ? 'QUALIFIED' : 'RESULT',
    verdicts,
  } as const;
}

/* ── CREATIVES ────────────────────────────────────────────────────────── */

export type CreativeClass = 'STRONGEST_SIGNAL' | 'NEEDS_MORE_DATA' | 'UNDERPERFORMING' | 'POSSIBLE_FATIGUE' | 'STEADY';

export interface DailyPoint { date: string; totals: MetricTotals }

/**
 * FATIGUE needs at least two independent signals in the recent window versus
 * the one before it: CTR falling, cost per result rising, frequency rising —
 * never one number crossing one threshold.
 */
export function fatigueSignals(goal: string, series: DailyPoint[], p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS) {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 6) return { fatigued: false, signals: [] as string[] };
  const half = Math.floor(sorted.length / 2);
  const earlier = sumTotals(sorted.slice(0, half).map((d) => d.totals));
  const recent = sumTotals(sorted.slice(half).map((d) => d.totals));
  if (!earlier || !recent || recent.impressions < p.fatigueMinImpressions / 2 || earlier.impressions < p.fatigueMinImpressions / 2) {
    return { fatigued: false, signals: [] as string[] };
  }
  const ke = kpis(goal, earlier);
  const kr = kpis(goal, recent);
  const signals: string[] = [];
  if (ke.ctr != null && kr.ctr != null && kr.ctr < ke.ctr * 0.75) signals.push('CTR_DECLINING');
  if (ke.costPerResultMinor != null && kr.costPerResultMinor != null && kr.costPerResultMinor > ke.costPerResultMinor * 1.25) signals.push('COST_RISING');
  const fe = earlier.reach ? earlier.impressions / earlier.reach : null;
  const fr = recent.reach ? recent.impressions / recent.reach : null;
  const freqRising = sorted.slice(half).some((d) => d.totals.reach && d.totals.impressions / d.totals.reach > 2.5);
  if ((fe != null && fr != null && fr > fe * 1.2) || freqRising) signals.push('FREQUENCY_RISING');
  if (ke.resultRate != null && kr.resultRate != null && kr.resultRate < ke.resultRate * 0.75) signals.push('CONVERSION_DECLINING');
  return { fatigued: signals.length >= 2, signals };
}

export function classifyCreatives(goal: string, ads: Array<{ key: string; totals: MetricTotals; outcomes?: Outcomes; series?: DailyPoint[] }>,
  p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS) {
  const lead = leaderOf(goal, ads, p);
  return ads.map((a) => {
    const k = kpis(goal, a.totals, a.outcomes);
    const evidence = evidenceOf(k.results, a.totals.impressions, p);
    const fatigue = a.series ? fatigueSignals(goal, a.series, p) : { fatigued: false, signals: [] };
    let cls: CreativeClass = 'STEADY';
    if (!atLeast(evidence, 'MEANINGFUL_SIGNAL')) cls = 'NEEDS_MORE_DATA';
    else if (fatigue.fatigued) cls = 'POSSIBLE_FATIGUE';
    else if (lead.leader?.key === a.key) cls = 'STRONGEST_SIGNAL';
    else if (lead.leader && k.costPerResultMinor != null && k.costPerResultMinor >= lead.leader.costMinor * 1.5) cls = 'UNDERPERFORMING';
    return { key: a.key, cls, evidence, kpis: k, fatigueSignals: fatigue.signals };
  });
}

/* ── HEALTH ───────────────────────────────────────────────────────────── */

export type HealthState = 'HEALTHY' | 'WATCH' | 'ACTION_RECOMMENDED' | 'INSUFFICIENT_DATA' | 'STATE';
/* STATE: a plain fact (paused, in Meta review, data updated) — neither good nor bad, never green. */
export type HealthDimension = 'DELIVERY' | 'COST_EFFICIENCY' | 'LEAD_QUALITY' | 'CREATIVE_HEALTH' | 'AUDIENCE_LEARNING' | 'BUDGET_UTILIZATION' | 'DATA_HEALTH';

export interface HealthInput {
  goal: string;
  status: string;
  daysRunning: number;
  dailyBudgetMinor: number;
  last3Days: MetricTotals | null;
  current: MetricTotals | null;        // comparison window (e.g. last 7 days)
  previous: MetricTotals | null;       // the window before it
  outcomes: Outcomes;
  leads: number;
  creativeClasses: CreativeClass[];
  lastSyncMinutes: number | null;
  connectionOk: boolean;
}

export function health(h: HealthInput, p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS): Record<HealthDimension, { state: HealthState; code: string }> {
  const live = ['ACTIVE', 'META_REVIEW', 'SUBMITTED'].includes(h.status);
  const cur = h.current ? kpis(h.goal, h.current) : null;
  const prev = h.previous ? kpis(h.goal, h.previous) : null;
  const curEv = h.current ? evidenceOf(cur!.results, h.current.impressions, p) : 'INSUFFICIENT_DATA';

  // Not delivering because paused / ended / in review is a state, not a verdict.
  const delivery = !live
    ? { state: 'STATE' as HealthState, code: h.status }
    : h.status !== 'ACTIVE' ? { state: 'STATE' as HealthState, code: h.status === 'SUBMITTED' ? 'SUBMITTED' : 'IN_REVIEW' }
      : h.daysRunning >= 2 && (h.last3Days?.impressions ?? 0) === 0 ? { state: 'ACTION_RECOMMENDED' as HealthState, code: 'NOT_DELIVERING' }
        : { state: 'HEALTHY' as HealthState, code: 'DELIVERING' };

  let cost: { state: HealthState; code: string } = { state: 'INSUFFICIENT_DATA', code: 'COLLECTING' };
  if (atLeast(curEv, 'MEANINGFUL_SIGNAL') && cur?.costPerResultMinor != null && prev?.costPerResultMinor != null) {
    const rise = (cur.costPerResultMinor - prev.costPerResultMinor) / prev.costPerResultMinor;
    cost = rise > 0.5 ? { state: 'ACTION_RECOMMENDED', code: 'COST_RISING_SHARPLY' }
      : rise > 0.25 ? { state: 'WATCH', code: 'COST_RISING' }
        : { state: 'HEALTHY', code: 'COST_STABLE' };
  } else if (atLeast(curEv, 'MEANINGFUL_SIGNAL')) cost = { state: 'HEALTHY', code: 'COST_STABLE' };

  const qualified = Number(h.outcomes.qualifiedLeads ?? 0);
  const quality: { state: HealthState; code: string } = h.leads < 5
    ? { state: 'INSUFFICIENT_DATA', code: 'FEW_LEADS' }
    : qualified / h.leads < 0.15 && h.leads >= p.meaningfulResults ? { state: 'ACTION_RECOMMENDED', code: 'LOW_QUALIFICATION' }
      : qualified / h.leads < 0.3 ? { state: 'WATCH', code: 'QUALIFICATION_BELOW_TARGET' }
        : { state: 'HEALTHY', code: 'QUALIFICATION_GOOD' };

  const creative: { state: HealthState; code: string } = h.creativeClasses.length === 0 || h.creativeClasses.every((c) => c === 'NEEDS_MORE_DATA')
    ? { state: 'INSUFFICIENT_DATA', code: 'COLLECTING' }
    : h.creativeClasses.includes('POSSIBLE_FATIGUE') ? { state: 'WATCH', code: 'FATIGUE_SIGNS' }
      : h.creativeClasses.filter((c) => c !== 'NEEDS_MORE_DATA').every((c) => c === 'UNDERPERFORMING') ? { state: 'ACTION_RECOMMENDED', code: 'ALL_UNDERPERFORMING' }
        : { state: 'HEALTHY', code: 'CREATIVES_OK' };

  const weekly = cur?.results ?? 0;
  const learning: { state: HealthState; code: string } = h.daysRunning < 3
    ? { state: 'INSUFFICIENT_DATA', code: 'EARLY_DAYS' }
    : weekly >= 50 ? { state: 'HEALTHY', code: 'LEARNED' } : { state: 'WATCH', code: 'STILL_LEARNING' };

  const expected = h.dailyBudgetMinor * 3;
  const spent3 = h.last3Days?.spendMinor ?? 0;
  const budget: { state: HealthState; code: string } = !live || h.daysRunning < 3 || expected === 0
    ? { state: 'INSUFFICIENT_DATA', code: 'EARLY_DAYS' }
    : spent3 < expected * 0.5 ? { state: 'WATCH', code: 'UNDER_SPENDING' } : { state: 'HEALTHY', code: 'ON_PACE' };

  const data: { state: HealthState; code: string } = !h.connectionOk ? { state: 'ACTION_RECOMMENDED', code: 'CONNECTION_NEEDS_ATTENTION' }
    : h.lastSyncMinutes == null ? { state: 'INSUFFICIENT_DATA', code: 'NOT_SYNCED' }
      : h.lastSyncMinutes > 24 * 60 ? { state: 'ACTION_RECOMMENDED', code: 'STALE_DATA' }
        : h.lastSyncMinutes > 6 * 60 ? { state: 'WATCH', code: 'DATA_DELAYED' } : { state: 'STATE', code: 'FRESH' }; // freshness, not quality

  return {
    DELIVERY: delivery, COST_EFFICIENCY: cost, LEAD_QUALITY: quality, CREATIVE_HEALTH: creative,
    AUDIENCE_LEARNING: learning, BUDGET_UTILIZATION: budget, DATA_HEALTH: data,
  };
}

/* ── RECOMMENDATIONS ──────────────────────────────────────────────────── */

export type RecommendationType =
  | 'KEEP' | 'MONITOR' | 'TEST' | 'REALLOCATE' | 'REDUCE' | 'INCREASE' | 'REFRESH_CREATIVE'
  | 'PAUSE' | 'EXPAND' | 'NARROW' | 'COLLECT_DATA';

export interface Recommendation {
  type: RecommendationType;
  /** 'campaign', or 'ad:<metaId>' / 'adset:<metaId>'. */
  affected: string;
  window: { current: string; previous: string | null };
  metric: 'COST_PER_RESULT' | 'COST_PER_QUALIFIED_LEAD' | 'CTR' | 'SPEND_PACE';
  baseline: number | null;
  candidate: number | null;
  confidence: Evidence;
  reasonCodes: string[];
  /** Whether HOMATCH can carry it out through Meta when the customer applies it. */
  actionable: boolean;
  /** For INCREASE/REDUCE: the proposed daily budget, minor units. */
  proposedDailyMinor?: number;
}

export interface RecommendInput {
  goal: string;
  status: string;
  dailyBudgetMinor: number;
  window: { current: string; previous: string | null };
  campaign: { current: MetricTotals | null; previous: MetricTotals | null; outcomes: Outcomes };
  ads: Array<{ key: string; totals: MetricTotals; outcomes?: Outcomes; series?: DailyPoint[] }>;
  recentlyChanged: string[];
}

export function recommend(r: RecommendInput, p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS): Recommendation[] {
  const out: Recommendation[] = [];
  if (!['ACTIVE', 'PAUSED'].includes(r.status)) return out;
  const cur = r.campaign.current;
  const k = cur ? kpis(r.goal, cur, r.campaign.outcomes) : null;
  const ev = cur ? evidenceOf(k!.results, cur.impressions, p) : 'INSUFFICIENT_DATA';
  const base = { window: r.window };

  if (!atLeast(ev, 'EARLY_SIGNAL')) {
    // Paused cannot collect: say so instead of "wait for more data".
    const paused = r.status === 'PAUSED';
    return [{ ...base, type: 'COLLECT_DATA', affected: 'campaign', metric: 'COST_PER_RESULT', baseline: null, candidate: null,
      confidence: ev, reasonCodes: [paused ? 'PAUSED_NOT_COLLECTING' : 'NOT_ENOUGH_RESULTS_YET'], actionable: false }];
  }

  const classes = classifyCreatives(r.goal, r.ads, p);
  const strongest = classes.find((c) => c.cls === 'STRONGEST_SIGNAL');
  for (const c of classes) {
    if (r.recentlyChanged.includes(`ad:${c.key}`)) continue;
    if (c.cls === 'UNDERPERFORMING' && strongest && atLeast(c.evidence, 'MEANINGFUL_SIGNAL')) {
      out.push({ ...base, type: 'REALLOCATE', affected: `ad:${c.key}`, metric: 'COST_PER_RESULT',
        baseline: strongest.kpis.costPerResultMinor, candidate: c.kpis.costPerResultMinor,
        confidence: weaker(c.evidence, strongest.evidence),
        reasonCodes: ['CREATIVE_COSTS_MORE_THAN_STRONGEST', `STRONGEST:${strongest.key}`], actionable: true });
    }
    if (c.cls === 'POSSIBLE_FATIGUE') {
      out.push({ ...base, type: 'REFRESH_CREATIVE', affected: `ad:${c.key}`, metric: 'CTR',
        baseline: null, candidate: c.kpis.ctr, confidence: c.evidence, reasonCodes: c.fatigueSignals, actionable: false });
    }
  }

  const prev = r.campaign.previous;
  if (!r.recentlyChanged.includes('campaign') && prev && k?.costPerResultMinor != null) {
    const kp = kpis(r.goal, prev, {});
    const evPrev = evidenceOf(kp.results, prev.impressions, p);
    if (kp.costPerResultMinor != null && atLeast(ev, 'MEANINGFUL_SIGNAL') && atLeast(evPrev, 'MEANINGFUL_SIGNAL')) {
      const delta = (k.costPerResultMinor - kp.costPerResultMinor) / kp.costPerResultMinor;
      const both = weaker(ev, evPrev);
      if (delta <= -0.2 && both === 'HIGH_CONFIDENCE' && r.status === 'ACTIVE') {
        out.push({ ...base, type: 'INCREASE', affected: 'campaign', metric: 'COST_PER_RESULT', baseline: kp.costPerResultMinor,
          candidate: k.costPerResultMinor, confidence: both, reasonCodes: ['COST_IMPROVED_TWO_WINDOWS'], actionable: true,
          proposedDailyMinor: Math.round(r.dailyBudgetMinor * 1.2) });
      } else if (delta >= 0.3) {
        out.push({ ...base, type: both === 'HIGH_CONFIDENCE' ? 'REDUCE' : 'MONITOR', affected: 'campaign', metric: 'COST_PER_RESULT',
          baseline: kp.costPerResultMinor, candidate: k.costPerResultMinor, confidence: both,
          reasonCodes: ['COST_PER_RESULT_ROSE'], actionable: both === 'HIGH_CONFIDENCE',
          ...(both === 'HIGH_CONFIDENCE' ? { proposedDailyMinor: Math.round(r.dailyBudgetMinor * 0.8) } : {}) });
      }
    }
  }

  const leads = Number(cur?.leads ?? 0);
  const qualified = Number(r.campaign.outcomes.qualifiedLeads ?? -1);
  if (qualified >= 0 && leads >= p.meaningfulResults && qualified / leads < 0.15) {
    out.push({ ...base, type: 'NARROW', affected: 'campaign', metric: 'COST_PER_QUALIFIED_LEAD',
      baseline: null, candidate: k?.cpqlMinor ?? null, confidence: evidenceOf(leads, cur!.impressions, p),
      reasonCodes: ['LOW_QUALIFICATION_RATE'], actionable: false });
  }

  if (out.length === 0) {
    out.push({ ...base, type: atLeast(ev, 'MEANINGFUL_SIGNAL') ? 'KEEP' : 'MONITOR', affected: 'campaign', metric: 'COST_PER_RESULT',
      baseline: null, candidate: k?.costPerResultMinor ?? null, confidence: ev,
      reasonCodes: [atLeast(ev, 'MEANINGFUL_SIGNAL') ? 'PERFORMING_STEADILY' : 'COLLECTING_MORE_DATA'], actionable: false });
  }
  return out;
}

/* ── SUMMARY FACTS ────────────────────────────────────────────────────── */

/**
 * The only material an AI summary may use. Each fact is a code with its
 * numbers; the narrative rewrites these and nothing else. A deterministic
 * rendering of the same facts is always available without AI.
 */
export interface SummaryFact { code: string; params: Record<string, string | number | null>; confidence?: Evidence }

export function summaryFacts(input: {
  goal: string; status: string; currency: string; totals: MetricTotals | null; outcomes: Outcomes;
  placementLeader?: { key: string; evidence: Evidence } | null;
  audienceLeader?: { key: string; evidence: Evidence } | null;
  creativeLeader?: { key: string; evidence: Evidence } | null;
  recommendations: Recommendation[];
}): SummaryFact[] {
  const facts: SummaryFact[] = [{ code: 'STATUS', params: { status: input.status } }];
  if (input.totals) {
    const k = kpis(input.goal, input.totals, input.outcomes);
    facts.push({ code: 'SPEND_RESULTS', params: { spendMinor: input.totals.spendMinor, currency: input.currency, results: k.results, costPerResultMinor: k.costPerResultMinor != null ? Math.round(k.costPerResultMinor) : null } });
    if (input.totals.leads > 0) facts.push({ code: 'LEADS_QUALIFIED', params: { leads: input.totals.leads, qualified: input.outcomes.qualifiedLeads ?? null } });
  } else facts.push({ code: 'NO_DATA_YET', params: {} });
  if (input.placementLeader) facts.push({ code: 'PLACEMENT_LEADS', params: { placement: input.placementLeader.key }, confidence: input.placementLeader.evidence });
  if (input.audienceLeader) facts.push({ code: 'AUDIENCE_LEADS', params: { segment: input.audienceLeader.key }, confidence: input.audienceLeader.evidence });
  if (input.creativeLeader) facts.push({ code: 'CREATIVE_LEADS', params: { creative: input.creativeLeader.key }, confidence: input.creativeLeader.evidence });
  const top = input.recommendations[0];
  if (top) facts.push({ code: `RECOMMEND_${top.type}`, params: { affected: top.affected }, confidence: top.confidence });
  return facts;
}

/** A stable hash of the facts: the summary is regenerated only when it changes. */
export function factsKey(facts: SummaryFact[]): string {
  const s = JSON.stringify(facts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
