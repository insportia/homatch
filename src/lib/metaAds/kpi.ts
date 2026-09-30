// META ADS — THE ONE KPI DEFINITION. Every screen, every recommendation and
// every AI summary reads ratios from here; no component computes CTR or CPL
// on its own.
//
// Rules: money in minor units of ONE currency; a ratio with a zero or missing
// denominator is null (shown as "—"), never 0 and never Infinity; totals
// across different currencies are never added together.

import type { MetaGoal } from './strategy.ts';

export interface MetricTotals {
  currency: string;
  spendMinor: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  messages: number;
  registrations: number;
  postEngagements: number;
}

export interface Outcomes {
  /** HOMATCH CRM outcomes for leads attributed to the same scope. */
  qualifiedLeads?: number;
  contacted?: number;
  viewings?: number;
  won?: number;
}

export const emptyTotals = (currency = 'USD'): MetricTotals => ({
  currency, spendMinor: 0, impressions: 0, reach: null, clicks: 0, linkClicks: 0,
  landingPageViews: 0, leads: 0, messages: 0, registrations: 0, postEngagements: 0,
});

/** What counts as a "result" for each goal. */
export function resultOf(goal: MetaGoal | string, m: MetricTotals): number {
  switch (goal) {
    case 'LEADS_ON_META': case 'LEADS_ON_WEBSITE': return m.leads;
    case 'SITE_REGISTRATIONS': return m.registrations;
    case 'MESSAGES': return m.messages;
    case 'ENGAGEMENT': return m.postEngagements;
    case 'PROMOTE': return m.landingPageViews || m.linkClicks;
    default: return m.leads;
  }
}

export const RESULT_KIND: Record<string, 'LEAD' | 'REGISTRATION' | 'MESSAGE' | 'ENGAGEMENT' | 'VISIT'> = {
  LEADS_ON_META: 'LEAD', LEADS_ON_WEBSITE: 'LEAD', SITE_REGISTRATIONS: 'REGISTRATION',
  MESSAGES: 'MESSAGE', ENGAGEMENT: 'ENGAGEMENT', PROMOTE: 'VISIT',
};

const ratio = (num: number, den: number | null | undefined): number | null =>
  den && den > 0 && Number.isFinite(num) ? num / den : null;

export interface Kpis {
  spendMinor: number;
  results: number;
  costPerResultMinor: number | null;
  ctr: number | null;          // link clicks ÷ impressions (0..1)
  cpcMinor: number | null;     // spend ÷ link clicks
  cpmMinor: number | null;     // spend ÷ impressions × 1000
  frequency: number | null;    // impressions ÷ reach
  cplMinor: number | null;     // spend ÷ leads
  resultRate: number | null;   // results ÷ link clicks
  cpqlMinor: number | null;    // spend ÷ qualified leads
  qualificationRate: number | null;
  costPerViewingMinor: number | null;
  leadToViewingRate: number | null;
}

export function kpis(goal: MetaGoal | string, m: MetricTotals, o: Outcomes = {}): Kpis {
  const results = resultOf(goal, m);
  const clicks = m.linkClicks || m.clicks;
  return {
    spendMinor: m.spendMinor,
    results,
    costPerResultMinor: ratio(m.spendMinor, results),
    ctr: ratio(clicks, m.impressions),
    cpcMinor: ratio(m.spendMinor, clicks),
    cpmMinor: m.impressions > 0 ? (m.spendMinor / m.impressions) * 1000 : null,
    frequency: ratio(m.impressions, m.reach ?? 0),
    cplMinor: ratio(m.spendMinor, m.leads),
    resultRate: ratio(results, clicks),
    cpqlMinor: o.qualifiedLeads != null ? ratio(m.spendMinor, o.qualifiedLeads) : null,
    qualificationRate: o.qualifiedLeads != null ? ratio(o.qualifiedLeads, m.leads) : null,
    costPerViewingMinor: o.viewings != null ? ratio(m.spendMinor, o.viewings) : null,
    leadToViewingRate: o.viewings != null ? ratio(o.viewings, m.leads) : null,
  };
}

/** Sum rows of ONE currency. Reach is not additive across days or segments,
 *  so a sum only keeps reach when a single row carries it. */
export function sumTotals(rows: MetricTotals[]): MetricTotals | null {
  if (rows.length === 0) return null;
  const currency = rows[0].currency;
  if (rows.some((r) => r.currency !== currency)) throw new Error('MIXED_CURRENCY');
  const t = emptyTotals(currency);
  for (const r of rows) {
    t.spendMinor += r.spendMinor; t.impressions += r.impressions; t.clicks += r.clicks;
    t.linkClicks += r.linkClicks; t.landingPageViews += r.landingPageViews; t.leads += r.leads;
    t.messages += r.messages; t.registrations += r.registrations; t.postEngagements += r.postEngagements;
  }
  t.reach = rows.length === 1 ? rows[0].reach : null;
  return t;
}

/** Group by currency — the only honest "total" across ad accounts. */
export function totalsByCurrency(rows: MetricTotals[]): Record<string, MetricTotals> {
  const by: Record<string, MetricTotals[]> = {};
  for (const r of rows) (by[r.currency] ??= []).push(r);
  return Object.fromEntries(Object.entries(by).map(([c, rs]) => [c, sumTotals(rs)!]));
}

/** Percent change, null when there is no baseline. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
