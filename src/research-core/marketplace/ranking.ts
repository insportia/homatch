// HOMATCH MARKETPLACE SEARCH — hard filters and explainable ranking.
//
// HARD CONSTRAINTS STAY HARD. A known value outside what the customer confirmed
// excludes the property from normal results; an unknown value is kept but
// marked unverified and ranks lower, because "the listing did not say" is not
// the same as "it does not fit".
//
// RANKING IS A SUM OF NAMED COMPONENTS, each 0..1 with a fixed weight, and every
// component is persisted so Admin can see why a property is where it is. Not
// cheapest first. Seller type has a small weight and the owner preference only
// applies when the rest of the property is already competitive.

import type { MarketplaceSearchRequest } from './worker-contract.ts';
import type { FreshnessState } from './normalize.ts';
import type { SellerClass } from './seller.ts';
import { comparePlaces, placeNamesFor } from '../normalize/place.ts';
import { type LocalComparison, vsComparable } from './price-intel.ts';

export const RANKING_VERSION = 'marketplace-ranking-1';

export interface PropertyFacts {
  priceUsd: number | null;
  pricePerSqmUsd: number | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  city: string | null;
  district: string | null;
  buildingStatus: string | null;
  renovationStatus: string | null;
  parking: boolean | null;
  furnished: boolean | null;
  amenities: string[];
  constructionYear?: number | null;
  elevator?: boolean | null;
}

export type BudgetBand = 'BELOW_MIN' | 'IN_BUDGET' | 'UPGRADE_PREFERRED' | 'UPGRADE_EXTENDED' | 'ABOVE_CEILING' | 'UNKNOWN';

/**
 * Where a price sits against the confirmed range. Integer arithmetic on purpose:
 * with a $150,000 maximum, $165,000 is the last eligible upgrade price and
 * $165,001 is not, with no floating-point slack either way.
 */
export function budgetBand(priceUsd: number | null, minUsd: number, maxUsd: number): BudgetBand {
  if (priceUsd === null || !Number.isFinite(priceUsd)) return 'UNKNOWN';
  const p = Math.round(priceUsd * 100);
  const max = Math.round(maxUsd * 100);
  if (p < Math.round(minUsd * 100)) return 'BELOW_MIN';
  if (p <= max) return 'IN_BUDGET';
  if (p * 100 <= max * 105) return 'UPGRADE_PREFERRED';
  if (p * 100 <= max * 110) return 'UPGRADE_EXTENDED';
  return 'ABOVE_CEILING';
}

export type CheckResult = 'PASS' | 'FAIL' | 'UNKNOWN';

/**
 * One requested criterion against one property: what was asked, what the listing
 * says, where that came from, and the verdict. Hard checks decide eligibility; soft
 * ones (a stated wish) only rank. UNKNOWN is never a PASS.
 */
export interface ConstraintCheck {
  field: string;
  hard: boolean;
  expected: unknown;
  observed: unknown;
  /** STRUCTURED: a field the source published. DESCRIPTION: the listing's own text. */
  basis: 'STRUCTURED' | 'DESCRIPTION' | 'NONE';
  result: CheckResult;
}

export interface HardFilterResult {
  /** Passes every non-price hard constraint. */
  fits: boolean;
  band: BudgetBand;
  violations: string[];
  unverified: string[];
  /** Every requested criterion, hard and soft, in a fixed order (persisted for audit). */
  checks: ConstraintCheck[];
}

/** What the listing's own description says about requested amenities (result-evidence.ts). */
export interface TextEvidence {
  mentioned: readonly string[];
  contradicted: readonly string[];
}

const inRange = (v: number | null, r: { min: number | null; max: number | null } | null): 'IN' | 'OUT' | 'UNKNOWN' | 'NA' => {
  if (!r || (r.min === null && r.max === null)) return 'NA';
  if (v === null) return 'UNKNOWN';
  if (r.min !== null && v < r.min) return 'OUT';
  if (r.max !== null && v > r.max) return 'OUT';
  return 'IN';
};

/**
 * A requested district is compared under every spelling the place table knows for it, so
 * the answer does not depend on the alphabet the customer typed in: "Krtsanisi" is also
 * checked as "კრწანისი", and a listing that names "დიღმის მასივი" is then a different
 * place in the source's own script (live production search, 2026-10-16), not "unknown".
 * A name the table does not know keeps its single spelling, so nothing new is inferred.
 */
export function districtFit(district: string | null, wanted: readonly string[]): 'MATCH' | 'OTHER' | 'UNKNOWN' | 'NA' {
  if (!wanted.length) return 'NA';
  if (!district) return 'UNKNOWN';
  const verdicts = wanted.map((w) => placeNamesFor(w).map((name) => comparePlaces(district, name)));
  if (verdicts.some((v) => v.includes('AGREE'))) return 'MATCH';
  if (verdicts.every((v) => v.includes('CONFLICT'))) return 'OTHER';
  return 'UNKNOWN';
}

const structuredAmenity = (must: string, f: PropertyFacts): boolean | null => must === 'PARKING' ? f.parking
  : must === 'FURNISHED' ? f.furnished
    : must === 'ELEVATOR' ? f.elevator ?? (f.amenities.includes('ELEVATOR') ? true : f.amenities.includes('NO_ELEVATOR') ? false : null)
      : f.amenities.includes(must) ? true : null;

export function hardFilter(f: PropertyFacts, req: MarketplaceSearchRequest, text: TextEvidence = { mentioned: [], contradicted: [] }): HardFilterResult {
  const violations: string[] = [];
  const unverified: string[] = [];
  const checks: ConstraintCheck[] = [];
  const record = (field: string, hard: boolean, expected: unknown, observed: unknown, result: CheckResult, basis: ConstraintCheck['basis'] = observed === null || observed === undefined ? 'NONE' : 'STRUCTURED') => {
    checks.push({ field, hard, expected, observed: observed ?? null, basis, result });
    if (!hard) return;
    if (result === 'FAIL') violations.push(field);
    else if (result === 'UNKNOWN') unverified.push(field);
  };
  const range = (field: string, v: number | null, r: { min: number | null; max: number | null } | null) => {
    const fit = inRange(v, r);
    if (fit !== 'NA') record(field, true, r, v, fit === 'IN' ? 'PASS' : fit === 'OUT' ? 'FAIL' : 'UNKNOWN');
  };
  const band = budgetBand(f.priceUsd, req.priceMinUsd, req.priceMaxUsd);
  /* Price is recorded for the audit; its band (upgrades, OTHER) is decided by the pipeline. */
  checks.push({ field: 'PRICE', hard: true, expected: { min: req.priceMinUsd, max: req.priceMaxUsd }, observed: f.priceUsd,
    basis: f.priceUsd === null ? 'NONE' : 'STRUCTURED', result: band === 'IN_BUDGET' ? 'PASS' : band === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL' });
  range('AREA', f.areaSqm, { min: req.areaMinSqm, max: req.areaMaxSqm });
  range('ROOMS', f.rooms, req.rooms);
  range('BEDROOMS', f.bedrooms, req.bedrooms);
  range('BATHROOMS', f.bathrooms, req.bathrooms);
  range('FLOOR_RANGE', f.floor, req.floorRange ?? null);
  if (req.maxBuildingAge != null) {
    const year = req.requestedAt ? new Date(req.requestedAt).getUTCFullYear() : NaN;
    record('BUILDING_AGE', true, req.maxBuildingAge, f.constructionYear ?? null,
      f.constructionYear == null || !Number.isFinite(year) || f.constructionYear > year ? 'UNKNOWN'
        : year - f.constructionYear > req.maxBuildingAge ? 'FAIL' : 'PASS');
  }
  for (const preference of req.floorPreferences ?? []) {
    if (preference === 'NOT_FIRST') record('FLOOR_NOT_FIRST', true, 'NOT_FIRST', f.floor, f.floor === null ? 'UNKNOWN' : f.floor === 1 ? 'FAIL' : 'PASS');
    if (preference === 'NOT_LAST') record('FLOOR_NOT_LAST', true, 'NOT_LAST', f.floor === null || f.totalFloors === null ? null : `${f.floor}/${f.totalFloors}`,
      f.floor === null || f.totalFloors === null ? 'UNKNOWN' : f.floor === f.totalFloors ? 'FAIL' : 'PASS');
  }
  const d = districtFit(f.district, req.districts);
  if (d !== 'NA') record('DISTRICT', true, req.districts, f.district, d === 'MATCH' ? 'PASS' : d === 'OTHER' ? 'FAIL' : 'UNKNOWN');
  if (req.buildingStatuses.length) {
    record('BUILDING_STATUS', true, req.buildingStatuses, f.buildingStatus,
      !f.buildingStatus ? 'UNKNOWN' : req.buildingStatuses.includes(f.buildingStatus as never) ? 'PASS' : 'FAIL');
  }
  /* A required finishing condition the listing does not state is UNVERIFIED, not a pass
     (production search d3d859cc: "must be renovated", 106 of 150 homes did not say). */
  if (req.renovationPreferences.length) {
    record('RENOVATION', true, req.renovationPreferences, f.renovationStatus,
      !f.renovationStatus ? 'UNKNOWN' : req.renovationPreferences.includes(f.renovationStatus as never) ? 'PASS' : 'FAIL');
  }
  if (req.preferredBuildingStatuses?.length) {
    record('PREFERRED_BUILDING_STATUS', false, req.preferredBuildingStatuses, f.buildingStatus,
      !f.buildingStatus ? 'UNKNOWN' : req.preferredBuildingStatuses.includes(f.buildingStatus as never) ? 'PASS' : 'FAIL');
  }
  if (req.preferredRenovations?.length) {
    record('PREFERRED_RENOVATION', false, req.preferredRenovations, f.renovationStatus,
      !f.renovationStatus ? 'UNKNOWN' : req.preferredRenovations.includes(f.renovationStatus as never) ? 'PASS' : 'FAIL');
  }
  if (req.parking === true) record('PARKING', true, true, f.parking, f.parking === true ? 'PASS' : f.parking === false ? 'FAIL' : 'UNKNOWN');
  if (req.furnished !== null) record('FURNISHED', true, req.furnished, f.furnished,
    f.furnished === null ? 'UNKNOWN' : f.furnished === req.furnished ? 'PASS' : 'FAIL');
  /* A required amenity: the source's structured field first; otherwise the listing's own
     description (the seller's words) confirms or denies it. Silence stays UNKNOWN. */
  for (const must of req.mustHave) {
    const known = structuredAmenity(must, f);
    if (known !== null) record(`REQUIRED_${must}`, true, true, known, known ? 'PASS' : 'FAIL');
    else if (text.contradicted.includes(must)) record(`REQUIRED_${must}`, true, true, false, 'FAIL', 'DESCRIPTION');
    else if (text.mentioned.includes(must)) record(`REQUIRED_${must}`, true, true, true, 'PASS', 'DESCRIPTION');
    else record(`REQUIRED_${must}`, true, true, null, 'UNKNOWN');
  }
  for (const ex of req.exclusions) if (f.amenities.includes(ex)) record(`EXCLUDED_${ex}`, true, false, true, 'FAIL');
  return { fits: violations.length === 0, band, violations, unverified, checks };
}

export const RANKING_WEIGHTS = {
  criteria: 0.40,
  budget: 0.08,
  freshness: 0.12,
  value: 0.12,
  completeness: 0.10,
  evidence: 0.08,
  seller: 0.06,
  ownerPreference: 0.04,
} as const;

/**
 * Soft preferences ("preferably new") move the score by at most ±PREFERENCE_SPAN/2 and never
 * touch `criteria`, which decides strong-match eligibility: a wish ranks, it never qualifies or
 * disqualifies. Neutral (0.5, no effect) when no preference was stated.
 */
export const PREFERENCE_SPAN = 0.06;

/** 0..1: share of stated preferences the listing meets (PASS 1, UNKNOWN 0.5, FAIL 0); 0.5 when none. */
export function preferenceScore(filter: HardFilterResult): number {
  const soft = filter.checks.filter((c) => !c.hard);
  if (!soft.length) return 0.5;
  return soft.reduce((s, c) => s + (c.result === 'PASS' ? 1 : c.result === 'UNKNOWN' ? 0.5 : 0), 0) / soft.length;
}

export interface RankingComponents {
  /** Soft preferences only; outside RANKING_WEIGHTS (see PREFERENCE_SPAN). */
  preference?: number;
  criteria: number;
  budget: number;
  freshness: number;
  value: number;
  completeness: number;
  evidence: number;
  seller: number;
  ownerPreference: number;
}

export interface RankInput {
  facts: PropertyFacts;
  filter: HardFilterResult;
  freshness: FreshnessState;
  oldListing: boolean;
  seller: SellerClass;
  sellerConfidence: number;
  sourceCount: number;
  completeness: number;
  listingAgeDays?: number | null;
  descriptionFit?: number;
  warningCount?: number;
}

export interface RankResult {
  score: number;
  components: RankingComponents;
  vsComparable: number | null;
}

const SELLER_SCORE: Record<SellerClass, number> = {
  VERIFIED_OWNER: 1, LIKELY_OWNER: 0.85, DEVELOPER: 0.7, AGENCY: 0.6, BROKER: 0.55, UNKNOWN: 0.5,
};

function criteriaScore(f: PropertyFacts, filter: HardFilterResult, req: MarketplaceSearchRequest): number {
  const parts: number[] = [];
  const d = districtFit(f.district, req.districts);
  parts.push(d === 'MATCH' || d === 'NA' ? 1 : d === 'UNKNOWN' ? 0.55 : 0);
  for (const [v, r] of [[f.areaSqm, { min: req.areaMinSqm, max: req.areaMaxSqm }], [f.rooms, req.rooms], [f.bedrooms, req.bedrooms]] as const) {
    const fit = inRange(v, r);
    if (fit !== 'NA') parts.push(fit === 'IN' ? 1 : fit === 'UNKNOWN' ? 0.5 : 0);
  }
  if (req.buildingStatuses.length) parts.push(f.buildingStatus ? (req.buildingStatuses.includes(f.buildingStatus as never) ? 1 : 0) : 0.5);
  if (req.renovationPreferences.length) parts.push(f.renovationStatus ? (req.renovationPreferences.includes(f.renovationStatus as never) ? 1 : 0) : 0.5);
  for (const c of filter.checks) {
    if (c.field.startsWith('REQUIRED_')) parts.push(c.result === 'PASS' ? 1 : c.result === 'FAIL' ? 0 : 0.5);
  }
  for (const nice of req.niceToHave) {
    const has = nice === 'PARKING' ? f.parking : f.amenities.includes(nice) ? true : null;
    parts.push(has === true ? 1 : 0.7);
  }
  if (!filter.fits) return 0;
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

export function rankProperty(input: RankInput, req: MarketplaceSearchRequest, local: LocalComparison): RankResult {
  const criteria = criteriaScore(input.facts, input.filter, req);
  const budget = input.filter.band === 'IN_BUDGET' ? 1 : input.filter.band === 'UPGRADE_PREFERRED' ? 0.6 : input.filter.band === 'UPGRADE_EXTENDED' ? 0.4 : 0;
  const activity = input.listingAgeDays == null ? 0.35 : Math.max(0, 1 - input.listingAgeDays / 35);
  const freshness = (0.8 * activity + 0.2 * (input.freshness === 'VERIFIED' ? 1 : input.freshness === 'RECENT' ? 0.7 : 0.2)) * (input.oldListing ? 0 : 1);
  const vs = vsComparable(input.facts.pricePerSqmUsd, local);
  /* −20% per m² vs similar → 1, +20% → 0, unknown → neutral. */
  const value = vs === null ? 0.5 : Math.max(0, Math.min(1, 0.5 - vs * 2.5));
  const evidence = Math.max(0, Math.min(1, 0.55 + 0.15 * Math.max(0, input.sourceCount - 1) + 0.15 * (input.descriptionFit ?? 0)) - 0.12 * (input.warningCount ?? 0));
  const seller = SELLER_SCORE[input.seller] * (0.5 + 0.5 * input.sellerConfidence);
  /* Owner preference only for an already competitive, current property. */
  const ownerPreference = (input.seller === 'VERIFIED_OWNER' || input.seller === 'LIKELY_OWNER')
    && criteria >= 0.75 && input.freshness !== 'STALE' ? 1 : 0;
  const components: RankingComponents = {
    criteria: round3(criteria), budget, freshness: round3(freshness), value: round3(value),
    completeness: round3(input.completeness), evidence: round3(evidence), seller: round3(seller), ownerPreference,
  };
  const preference = preferenceScore(input.filter);
  const base = (Object.keys(RANKING_WEIGHTS) as Array<keyof typeof RANKING_WEIGHTS>)
    .reduce((s, k) => s + RANKING_WEIGHTS[k] * components[k], 0);
  const score = Math.max(0, Math.min(1, base + PREFERENCE_SPAN * (preference - 0.5)));
  return { score: round3(score), components: { ...components, preference: round3(preference) }, vsComparable: vs };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
