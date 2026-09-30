// META ADS — FROM ANALYSIS TO CONDITIONS. Which situations deserve an event,
// how serious they are, and the bucketed evidence that identifies them. Every
// performance condition needs MEANINGFUL evidence first; nothing here reacts
// to one cheap lead or one bad hour. Pure.

import { kpis, type MetricTotals, type Outcomes } from './kpi.ts';
import { evidenceOf, atLeast, type Evidence, type HealthDimension, type HealthState, type Recommendation, type CreativeClass } from './analysis.ts';
import { changeBucket, type Condition } from './events.ts';

export interface CampaignSnapshot {
  id: string;
  goal: string;
  status: string;
  currency: string;
  lastError?: { code?: string; key?: string } | null;
  current: MetricTotals | null;
  previous: MetricTotals | null;
  outcomesCurrent: Outcomes;
  outcomesPrevious: Outcomes;
  leadsCurrent: number;
  leadsPrevious: number;
  health: Partial<Record<HealthDimension, { state: HealthState; code: string }>>;
  recommendations: Array<Recommendation & { id?: string; isNew?: boolean }>;
  creativeClasses: Array<{ key: string; cls: CreativeClass; evidence: Evidence }>;
  placementLeader?: { key: string; evidence: Evidence } | null;
  audienceLeader?: { key: string; evidence: Evidence } | null;
  connectionOk: boolean;
  serviceShortfallMinor?: number;
}

const link = (id: string, tab?: string) => `/outreach/meta/campaigns/${id}${tab ? `?tab=${tab}` : ''}`;

export function detect(s: CampaignSnapshot): Condition[] {
  const out: Condition[] = [];

  // Performance: cost per result, current comparison window vs the previous one.
  if (s.current && s.previous) {
    const cur = kpis(s.goal, s.current, s.outcomesCurrent);
    const prev = kpis(s.goal, s.previous, s.outcomesPrevious);
    const evCur = evidenceOf(cur.results, s.current.impressions);
    const evPrev = evidenceOf(prev.results, s.previous.impressions);
    if (cur.costPerResultMinor != null && prev.costPerResultMinor != null && atLeast(evCur, 'MEANINGFUL_SIGNAL') && atLeast(evPrev, 'MEANINGFUL_SIGNAL')) {
      const change = (cur.costPerResultMinor - prev.costPerResultMinor) / prev.costPerResultMinor;
      const both = atLeast(evCur, 'HIGH_CONFIDENCE') && atLeast(evPrev, 'HIGH_CONFIDENCE') ? 'HIGH_CONFIDENCE' : 'MEANINGFUL_SIGNAL';
      if (change >= 0.25) {
        out.push({
          type: 'PERFORMANCE_DETERIORATED', subject: 'campaign',
          severity: change >= 0.75 && both === 'HIGH_CONFIDENCE' ? 'CRITICAL' : 'IMPORTANT', actionRequired: change >= 0.75,
          evidence: { metric: 'COST_PER_RESULT', change: changeBucket(change), confidence: both },
          facts: { change, currentMinor: Math.round(cur.costPerResultMinor), previousMinor: Math.round(prev.costPerResultMinor), currency: s.currency },
          deepLink: link(s.id, 'performance'),
        });
      } else if (change <= -0.25) {
        out.push({
          type: 'PERFORMANCE_IMPROVED', subject: 'campaign', severity: 'INFO',
          evidence: { metric: 'COST_PER_RESULT', change: changeBucket(change), confidence: both },
          facts: { change, currentMinor: Math.round(cur.costPerResultMinor), previousMinor: Math.round(prev.costPerResultMinor), currency: s.currency },
          deepLink: link(s.id, 'performance'),
        });
      }
    }
  }

  // Lead quality: qualification rate, with enough leads in both windows.
  const qc = s.outcomesCurrent.qualifiedLeads;
  const qp = s.outcomesPrevious.qualifiedLeads;
  if (qc != null && qp != null && s.leadsCurrent >= 10 && s.leadsPrevious >= 10) {
    const rc = qc / s.leadsCurrent;
    const rp = qp / s.leadsPrevious;
    const delta = rc - rp;
    if (Math.abs(delta) >= 0.15) {
      out.push({
        type: 'LEAD_QUALITY_CHANGED', subject: 'campaign', severity: delta < 0 ? 'IMPORTANT' : 'INFO',
        evidence: { direction: delta < 0 ? 'DOWN' : 'UP', step: Math.round(Math.abs(delta) * 10) / 10 },
        facts: { current: rc, previous: rp }, deepLink: link(s.id, 'leads'),
      });
    }
  }

  // Creative fatigue, per ad.
  for (const c of s.creativeClasses) {
    if (c.cls === 'POSSIBLE_FATIGUE') {
      out.push({ type: 'CREATIVE_FATIGUE', subject: `ad:${c.key}`, severity: 'IMPORTANT', evidence: { cls: c.cls, confidence: c.evidence }, deepLink: link(s.id, 'creatives') });
    }
  }

  // Findings worth knowing, only with meaningful evidence.
  if (s.placementLeader && atLeast(s.placementLeader.evidence, 'MEANINGFUL_SIGNAL')) {
    out.push({ type: 'PLACEMENT_FINDING', subject: 'campaign', severity: 'INFO', evidence: { leader: s.placementLeader.key, confidence: s.placementLeader.evidence }, deepLink: link(s.id, 'placements') });
  }
  if (s.audienceLeader && atLeast(s.audienceLeader.evidence, 'MEANINGFUL_SIGNAL')) {
    out.push({ type: 'AUDIENCE_FINDING', subject: 'campaign', severity: 'INFO', evidence: { leader: s.audienceLeader.key, confidence: s.audienceLeader.evidence }, deepLink: link(s.id, 'audience') });
  }

  // A genuinely new, evidence-backed recommendation (one-shot per recommendation).
  for (const r of s.recommendations) {
    if (!r.isNew || !r.id || !['MEANINGFUL_SIGNAL', 'HIGH_CONFIDENCE'].includes(r.confidence)) continue;
    if (['KEEP', 'MONITOR', 'COLLECT_DATA'].includes(r.type)) continue;
    out.push({ type: 'NEW_RECOMMENDATION', subject: r.affected, occurrence: r.id, severity: r.actionable ? 'IMPORTANT' : 'INFO',
      evidence: { type: r.type, confidence: r.confidence }, facts: { type: r.type }, deepLink: link(s.id, 'optimization') });
  }

  // Delivery states Meta imposes.
  if (s.status === 'REJECTED') {
    out.push({ type: 'CAMPAIGN_REJECTED', subject: 'campaign', severity: 'CRITICAL', actionRequired: true, evidence: { status: 'REJECTED' }, deepLink: link(s.id) });
  } else if (s.lastError?.code === 'WITH_ISSUES' || s.lastError?.code === 'PARTIALLY_REJECTED') {
    out.push({ type: 'CAMPAIGN_RESTRICTED', subject: 'campaign', severity: 'IMPORTANT', actionRequired: true, evidence: { issue: s.lastError.code }, deepLink: link(s.id) });
  }

  // Health dimensions that mean "look now".
  if (s.health.DELIVERY?.state === 'ACTION_RECOMMENDED') {
    out.push({ type: 'DATA_HEALTH', subject: 'delivery', severity: 'IMPORTANT', actionRequired: true, evidence: { code: s.health.DELIVERY.code }, deepLink: link(s.id) });
  }
  if (s.health.DATA_HEALTH?.state === 'ACTION_RECOMMENDED' && s.connectionOk) {
    out.push({ type: 'DATA_HEALTH', subject: 'data', severity: 'IMPORTANT', evidence: { code: s.health.DATA_HEALTH.code }, deepLink: link(s.id) });
  }
  if (!s.connectionOk && ['ACTIVE', 'PAUSED', 'META_REVIEW', 'SUBMITTED'].includes(s.status)) {
    out.push({ type: 'CONTROL_ACCESS_LOST', subject: 'connection', severity: 'CRITICAL', actionRequired: true, evidence: { reason: 'CONNECTION' }, deepLink: '/outreach/meta?tab=connections' });
  }
  if ((s.serviceShortfallMinor ?? 0) > 0) {
    out.push({ type: 'SERVICE_BALANCE_LOW', subject: 'balance', severity: 'IMPORTANT', actionRequired: true, evidence: { short: true }, facts: { shortfallMinor: s.serviceShortfallMinor ?? 0, currency: s.currency }, deepLink: '/outreach/meta?tab=overview' });
  }
  return out;
}
