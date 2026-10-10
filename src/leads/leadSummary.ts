/*
 * HOMATCH Leads — what a lead card SAYS, built only from what the member stated.
 *
 * The approved structure is
 *   "Looking for a {propertyType} in {preferredLocations}, with a budget of {budgetRange}.
 *    {verifiedPreferenceSummary} This listing matches {matchedCriteria}."
 * Every field is optional: a clause whose data is missing is omitted, never guessed.
 * Nothing here invents readiness, urgency, nationality or purchasing power.
 *
 * Pure: the caller passes t() and a number formatter, so node:test covers it.
 */

import type { LeadItem } from '@/services/homatchLeads';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Engine dimensions a match can agree on, in the order they read best. */
export const DIMENSION_ORDER = ['TRANSACTION', 'PROPERTY_TYPE', 'CITY', 'DISTRICT', 'PRICE', 'BEDROOMS', 'AREA'] as const;

const PROPERTY_TYPE_KEYS: Record<string, string> = {
  APARTMENT: 'hl_type_apartment', HOUSE: 'hl_type_house', VILLA: 'hl_type_villa', STUDIO: 'hl_type_studio',
  PENTHOUSE: 'hl_type_penthouse', TOWNHOUSE: 'hl_type_townhouse', COMMERCIAL: 'hl_type_commercial', LAND: 'hl_type_land',
  OFFICE: 'hl_type_office',
};

export function propertyTypeLabel(types: string[] | null | undefined, t: Translate): string | null {
  const known = (types ?? []).map((x) => String(x).toUpperCase()).filter((x) => PROPERTY_TYPE_KEYS[x]);
  if (!known.length) return null;
  return [...new Set(known)].slice(0, 2).map((x) => t(PROPERTY_TYPE_KEYS[x])).join(t('hl_list_or'));
}

export function locationLabel(loc: LeadItem['locations'] | null | undefined): string | null {
  if (!loc) return null;
  const parts = [...(loc.neighborhoods ?? []).slice(0, 2), loc.district, loc.city]
    .map((x) => (x ?? '').trim()).filter(Boolean);
  const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return unique.length ? unique.join(', ') : null;
}

export function budgetLabel(budget: LeadItem['budget'], fmt: (n: number, currency: string | null) => string, t: Translate): string | null {
  if (!budget) return null;
  const { min, max, currency } = budget;
  if (min != null && max != null && min > 0 && max > 0) return min === max ? fmt(max, currency) : `${fmt(min, currency)} – ${fmt(max, currency)}`;
  if (max != null && max > 0) return t('hl_budget_up_to', { amount: fmt(max, currency) });
  if (min != null && min > 0) return t('hl_budget_from', { amount: fmt(min, currency) });
  return null;
}

export function requirementParts(req: LeadItem['requirements'] | null | undefined, t: Translate): string[] {
  const r = req ?? {};
  const out: string[] = [];
  const range = (lo: number | undefined, hi: number | undefined, one: string, both: string, upTo: string) => {
    if (lo != null && hi != null && lo !== hi) out.push(t(both, { min: lo, max: hi }));
    else if (lo != null) out.push(t(one, { n: lo }));
    else if (hi != null) out.push(t(upTo, { n: hi }));
  };
  range(r.bedroomsMin, r.bedroomsMax, 'hl_req_bedrooms_min', 'hl_req_bedrooms_range', 'hl_req_bedrooms_max');
  if (r.bedroomsMin == null && r.bedroomsMax == null) range(r.roomsMin, r.roomsMax, 'hl_req_rooms_min', 'hl_req_rooms_range', 'hl_req_rooms_max');
  range(r.areaMin, r.areaMax, 'hl_req_area_min', 'hl_req_area_range', 'hl_req_area_max');
  return out;
}

export function matchedCriteria(agreed: string[] | null | undefined, t: Translate): string[] {
  const set = new Set((agreed ?? []).map((x) => String(x).toUpperCase()));
  return DIMENSION_ORDER.filter((d) => set.has(d)).map((d) => t(`hl_dim_${d.toLowerCase()}`));
}

/** The approved one-paragraph summary, with every unsupported clause omitted. */
export function buildLeadSummary(item: Pick<LeadItem, 'propertyTypes' | 'locations' | 'budget' | 'requirements' | 'agreed' | 'transaction'>,
  t: Translate, fmt: (n: number, currency: string | null) => string): string {
  const type = propertyTypeLabel(item.propertyTypes, t) ?? t('hl_type_property');
  const where = locationLabel(item.locations);
  const budget = budgetLabel(item.budget, fmt, t);
  const key = where && budget ? 'hl_summary_full' : where ? 'hl_summary_where' : budget ? 'hl_summary_budget' : 'hl_summary_type';
  // The approved English template says "a {{propertyType}}"; restore "an" before a vowel
  // ("an apartment"). No other locale uses a standalone "a" article.
  const sentences = [t(key, { propertyType: type, preferredLocations: where ?? '', budgetRange: budget ?? '' }).replace(/\ba (?=[aeiou])/gi, 'an ')];
  const prefs = requirementParts(item.requirements, t);
  if (prefs.length) sentences.push(t('hl_summary_prefs', { preferences: prefs.join(', ') }));
  const matched = matchedCriteria(item.agreed, t);
  if (matched.length) sentences.push(t('hl_summary_matches', { matchedCriteria: matched.join(', ') }));
  return sentences.join(' ');
}

/* ── Research budget rules (credits) ─────────────────────────────────────── */

export interface BudgetLimits { min: number; max: number; balance: number | null }
export type BudgetProblem = 'NOT_A_NUMBER' | 'NOT_WHOLE' | 'BELOW_MINIMUM' | 'ABOVE_MAXIMUM' | 'OVER_BALANCE';

/** A starting Research budget: whole credits, ≥ min, ≤ max, ≤ the wallet. */
export function validateResearchBudget(value: unknown, limits: BudgetLimits): BudgetProblem | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[\s,]/g, ''));
  if (!Number.isFinite(n) || String(value ?? '').trim() === '') return 'NOT_A_NUMBER';
  if (!Number.isInteger(n)) return 'NOT_WHOLE';
  if (n < limits.min) return 'BELOW_MINIMUM';
  if (n > limits.max) return 'ABOVE_MAXIMUM';
  if (limits.balance != null && n > limits.balance) return 'OVER_BALANCE';
  return null;
}

/**
 * Expanding a running search: the customer picks the new TOTAL; only the difference is
 * authorised. The difference must be ≥ minStep (the product's minimum useful budget)
 * and affordable.
 */
export function researchExtension(currentTotal: number, newTotal: number, limits: { max: number; balance: number | null; minStep: number }):
  { additional: number; problem: BudgetProblem | 'NOT_HIGHER' | 'STEP_TOO_SMALL' | null } {
  if (!Number.isFinite(newTotal) || !Number.isInteger(newTotal)) return { additional: 0, problem: 'NOT_WHOLE' };
  const additional = newTotal - currentTotal;
  if (additional <= 0) return { additional: 0, problem: 'NOT_HIGHER' };
  if (newTotal > limits.max) return { additional, problem: 'ABOVE_MAXIMUM' };
  if (additional < limits.minStep) return { additional, problem: 'STEP_TOO_SMALL' };
  if (limits.balance != null && additional > limits.balance) return { additional, problem: 'OVER_BALANCE' };
  return { additional, problem: null };
}

/** Selection maths for the bulk bar: unlocked leads cost nothing, members once. */
export function selectionTotals(items: Array<Pick<LeadItem, 'matchId' | 'segment' | 'unlocked' | 'priceCredits'>>, selected: Set<string>) {
  let standard = 0; let premium = 0; let already = 0; let credits = 0;
  for (const it of items) {
    if (!selected.has(it.matchId)) continue;
    if (it.unlocked) { already += 1; continue; }
    if (it.segment === 'PREMIUM') premium += 1; else standard += 1;
    credits += Number(it.priceCredits || 0);
  }
  return { standard, premium, already, credits: Math.round(credits * 100) / 100 };
}
