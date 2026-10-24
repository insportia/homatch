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

import type { LeadItem, LeadPriceKey } from '@/services/homatchLeads';

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

/**
 * Selection maths for the bulk bar: unlocked leads cost nothing, members once, and each lead
 * at the ONE price that applies to it (VIP overrides EXACT; nearby / similar otherwise).
 * The server re-prices every unlock; this is the preview.
 */
export function selectionTotals(items: Array<Pick<LeadItem, 'matchId' | 'segment' | 'unlocked' | 'priceCredits' | 'priceKey' | 'category'>>, selected: Set<string>) {
  let standard = 0; let exact = 0; let premium = 0; let already = 0; let credits = 0;
  for (const it of items) {
    if (!selected.has(it.matchId)) continue;
    if (it.unlocked) { already += 1; continue; }
    const key = leadPriceKey(it);
    if (key === 'PREMIUM') premium += 1; else if (key === 'EXACT') exact += 1; else standard += 1;
    credits += Number(it.priceCredits || 0);
  }
  return { standard, exact, premium, already, credits: Math.round(credits * 100) / 100 };
}

/* ── Why this match (smart match expansion) ──────────────────────────────── */

/** The price that applies to one lead: VIP overrides; EXACT; otherwise nearby / similar. */
export function leadPriceKey(item: Pick<LeadItem, 'priceKey' | 'segment' | 'category'>): LeadPriceKey {
  if (item.priceKey) return item.priceKey;
  if (item.segment === 'MORTGAGE') return 'MORTGAGE';
  if (item.segment === 'PREMIUM' || item.category === 'VIP') return 'PREMIUM';
  return item.category === 'EXACT' ? 'EXACT' : 'STANDARD';
}

/** The display category, also for a feed that predates the expansion (segment only). */
export function leadCategory(item: Pick<LeadItem, 'category' | 'segment'>): 'EXACT' | 'NEARBY_SIMILAR' | 'VIP' | null {
  if (item.category) return item.category;
  return item.segment === 'PREMIUM' ? 'VIP' : null;
}

export const UNCERTAINTY_CODES = [
  'ABOVE_MAX', 'ABOVE_MAX_FLEXIBLE', 'BELOW_MIN', 'BUDGET_UNSTATED', 'PRICE_UNSTATED', 'CURRENCY_DIFFERS',
  'TYPE_UNSTATED', 'SIZE_UNSTATED', 'CITY_WIDE_SEARCH', 'AREA_PRICE_LEVEL_UNKNOWN', 'RENOVATION_UNKNOWN',
  'BUILDING_STATUS_UNKNOWN', 'AMENITIES_UNKNOWN',
] as const;

/**
 * The reasons a person is in the owner's results, as sentences built only from the stored
 * evidence (geography measured, budget compared, similarities agreed) — and, separately,
 * what is uncertain. Nothing is inferred beyond the explanation the server sent.
 */
export function matchReasons(item: Pick<LeadItem, 'explanation' | 'kind'>, t: Translate,
  fmt: (n: number, currency: string | null) => string, num: (n: number) => string = String): { reasons: string[]; uncertain: string[] } {
  const e = item.explanation;
  if (!e) return { reasons: [], uncertain: [] };
  const reasons: string[] = [];
  const g = e.geo ?? {};
  const place = (v: string | null | undefined) => (v && v.trim() ? v.trim() : t('hl_why_their_area'));
  if (g.level === 'EXACT_AREA') reasons.push(t('hl_why_geo_exact', { place: place(g.demandPlace ?? g.supplyPlace) }));
  else if (g.level === 'NEARBY_AREA') {
    reasons.push(t('hl_why_geo_nearby', { from: place(g.demandPlace), to: place(g.supplyPlace), km: num(Number(g.km ?? 0)) }));
    if (Array.isArray(g.samples) && g.samples.length === 2) reasons.push(t('hl_why_geo_measured', { a: num(g.samples[0]), b: num(g.samples[1]) }));
    if (g.priceLevelRatio != null) reasons.push(t('hl_why_price_level'));
  } else if (g.level === 'CITY_WIDE') reasons.push(t('hl_why_geo_city'));
  else if (g.level === 'OTHER_AREA') reasons.push(t('hl_why_geo_similar', { from: place(g.demandPlace), to: place(g.supplyPlace) }));
  if (g.streetMentioned) reasons.push(t('hl_why_street'));

  const b = e.budget ?? {};
  const cur = b.currency ?? null;
  if (b.verdict === 'WITHIN') reasons.push(t('hl_why_budget_within'));
  else if (b.verdict === 'ABOVE_MAX_TOLERANCE') {
    reasons.push(t('hl_why_budget_above', { amount: fmt(Number(b.outsideBy ?? 0), cur), tolerance: fmt(Number(b.tolerance ?? 0), cur) }));
    if (b.flexible) reasons.push(t('hl_why_budget_flexible'));
  } else if (b.verdict === 'BELOW_MIN_TOLERANCE') {
    reasons.push(t('hl_why_budget_below', { amount: fmt(Number(b.outsideBy ?? 0), cur), tolerance: fmt(Number(b.tolerance ?? 0), cur) }));
  } else if (b.verdict === 'UNKNOWN') reasons.push(t('hl_why_budget_unknown'));

  const sim = e.similarity ?? {};
  const dims = matchedCriteria((sim.agreed ?? []).filter((d) => d !== 'PRICE' && d !== 'DISTRICT' && d !== 'CITY'), t);
  if (dims.length) reasons.push(t('hl_why_also', { list: dims.join(', ') }));
  if (sim.renovation === 'AGREE') reasons.push(t('hl_why_renovation_ok'));
  if (sim.buildingStatus === 'AGREE') reasons.push(t('hl_why_building_ok'));
  const amen = (sim.amenities?.agreed ?? []).filter((a) => (FEATURE_AMENITIES as readonly string[]).includes(a)).map((a) => t(`hl_feature_${a}`));
  if (amen.length) reasons.push(t('hl_why_amenities_ok', { list: amen.join(', ') }));

  const known = new Set<string>(UNCERTAINTY_CODES);
  const uncertain = [...new Set((e.uncertainty ?? []).filter((c) => known.has(c)))].map((c) => t(`hl_unc_${c}`));
  return { reasons, uncertain };
}

/** A tolerance band as the owner reads it: "Up to $50,000: ±$5,000". */
export function bandLabels(bands: Array<{ upTo: number | null; tolerance: number }>, currency: string, t: Translate,
  fmt: (n: number, currency: string | null) => string): string[] {
  let from = 0;
  return bands.map((band) => {
    const range = band.upTo == null
      ? t('hl_band_from', { min: fmt(from, currency) })
      : from === 0 ? t('hl_band_upto', { max: fmt(band.upTo, currency) })
        : `${fmt(from, currency)}–${fmt(band.upTo, currency)}`;
    if (band.upTo != null) from = band.upTo + 1;
    return `${range}: ±${fmt(band.tolerance, currency)}`;
  });
}

/** Amenities a Marketplace Search can state (research-core/marketplace/taxonomy.ts AMENITIES). */
const FEATURE_AMENITIES = ['PARKING', 'BALCONY', 'TERRACE', 'ELEVATOR', 'GARDEN', 'POOL', 'FURNISHED',
  'CENTRAL_HEATING', 'VIEW', 'PET_FRIENDLY', 'STORAGE', 'AIR_CONDITIONING'] as const;
const BUILDING = ['NEW_BUILD', 'OLD_BUILD', 'UNDER_CONSTRUCTION'] as const;
const RENOVATION = ['RENOVATED', 'GREEN_FRAME', 'WHITE_FRAME', 'BLACK_FRAME', 'NEEDS_RENOVATION'] as const;

/**
 * The member's stated features (Find Buyers 2.0, intent_profiles.requirements), as labels:
 * must-haves, building and renovation choices, furnished / parking. Only known codes are
 * shown; an unknown value is left out rather than printed raw.
 */
export function featureParts(features: Record<string, unknown> | null | undefined, t: Translate): { must: string[]; nice: string[]; avoid: string[]; other: string[] } {
  const f = features ?? {};
  const list = (v: unknown, allowed: readonly string[]) => (Array.isArray(v) ? v.map(String).filter((x) => allowed.includes(x)) : []);
  const amen = (v: unknown) => list(v, FEATURE_AMENITIES).map((a) => t(`hl_feature_${a}`));
  const other: string[] = [];
  for (const b of list(f.buildingStatuses, BUILDING)) other.push(t(`mps_bs_${b}`));
  for (const r of list(f.renovation, RENOVATION)) other.push(t(`mps_rn_${r}`));
  if (f.furnished === true) other.push(t('hl_feature_FURNISHED'));
  if (f.furnished === false) other.push(t('hl_feature_unfurnished'));
  if (f.parking === true) other.push(t('hl_feature_PARKING'));
  if (typeof f.bathroomsMin === 'number') other.push(t('hl_feature_bathrooms_min', { n: f.bathroomsMin }));
  if (typeof f.statedCurrencyUnconverted === 'string') other.push(t('hl_feature_budget_currency_only', { currency: f.statedCurrencyUnconverted }));
  return { must: amen(f.mustHave), nice: amen(f.niceToHave), avoid: amen(f.exclusions), other: [...new Set(other)] };
}
