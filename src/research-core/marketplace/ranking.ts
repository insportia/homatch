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
import { comparePlaces } from '../normalize/place.ts';
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

export interface HardFilterResult {
  /** Passes every non-price hard constraint. */
  fits: boolean;
  band: BudgetBand;
  violations: string[];
  unverified: string[];
}

const inRange = (v: number | null, r: { min: number | null; max: number | null } | null): 'IN' | 'OUT' | 'UNKNOWN' | 'NA' => {
  if (!r || (r.min === null && r.max === null)) return 'NA';
  if (v === null) return 'UNKNOWN';
  if (r.min !== null && v < r.min) return 'OUT';
  if (r.max !== null && v > r.max) return 'OUT';
  return 'IN';
};

export function districtFit(district: string | null, wanted: readonly string[]): 'MATCH' | 'OTHER' | 'UNKNOWN' | 'NA' {
  if (!wanted.length) return 'NA';
  if (!district) return 'UNKNOWN';
  if (wanted.some((w) => comparePlaces(district, w) === 'AGREE')) return 'MATCH';
  if (wanted.every((w) => comparePlaces(district, w) === 'CONFLICT')) return 'OTHER';
  return 'UNKNOWN';
}

export function hardFilter(f: PropertyFacts, req: MarketplaceSearchRequest): HardFilterResult {
  const violations: string[] = [];
  const unverified: string[] = [];
  const check = (name: string, r: 'IN' | 'OUT' | 'UNKNOWN' | 'NA') => {
    if (r === 'OUT') violations.push(name);
    else if (r === 'UNKNOWN') unverified.push(name);
  };
  check('AREA', inRange(f.areaSqm, { min: req.areaMinSqm, max: req.areaMaxSqm }));
  check('ROOMS', inRange(f.rooms, req.rooms));
  check('BEDROOMS', inRange(f.bedrooms, req.bedrooms));
  check('BATHROOMS', inRange(f.bathrooms, req.bathrooms));
  for (const preference of req.floorPreferences ?? []) {
    if (preference === 'NOT_FIRST') check('FLOOR_NOT_FIRST', f.floor === null ? 'UNKNOWN' : f.floor <= 1 ? 'OUT' : 'IN');
    if (preference === 'NOT_LAST') check('FLOOR_NOT_LAST', f.floor === null || f.totalFloors === null ? 'UNKNOWN' : f.floor >= f.totalFloors ? 'OUT' : 'IN');
  }
  const d = districtFit(f.district, req.districts);
  if (d === 'OTHER') violations.push('DISTRICT');
  else if (d === 'UNKNOWN') unverified.push('DISTRICT');
  if (req.buildingStatuses.length) {
    if (!f.buildingStatus) unverified.push('BUILDING_STATUS');
    else if (!req.buildingStatuses.includes(f.buildingStatus as never)) violations.push('BUILDING_STATUS');
  }
  if (req.renovationPreferences.length && f.renovationStatus && !req.renovationPreferences.includes(f.renovationStatus as never)) {
    violations.push('RENOVATION');
  }
  if (req.parking === true && f.parking === false) violations.push('PARKING');
  if (req.furnished !== null && f.furnished !== null && req.furnished !== f.furnished) violations.push('FURNISHED');
  for (const ex of req.exclusions) if (f.amenities.includes(ex)) violations.push(`EXCLUDED_${ex}`);
  return { fits: violations.length === 0, band: budgetBand(f.priceUsd, req.priceMinUsd, req.priceMaxUsd), violations, unverified };
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

export interface RankingComponents {
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
  for (const must of req.mustHave) {
    const has = must === 'PARKING' ? f.parking : must === 'FURNISHED' ? f.furnished : f.amenities.includes(must) ? true : null;
    parts.push(has === true ? 1 : has === false ? 0 : 0.5);
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
  const freshness = (input.freshness === 'VERIFIED' ? 1 : input.freshness === 'RECENT' ? 0.7 : 0.2) * (input.oldListing ? 0.6 : 1);
  const vs = vsComparable(input.facts.pricePerSqmUsd, local);
  /* −20% per m² vs similar → 1, +20% → 0, unknown → neutral. */
  const value = vs === null ? 0.5 : Math.max(0, Math.min(1, 0.5 - vs * 2.5));
  const evidence = Math.min(1, 0.6 + 0.2 * Math.max(0, input.sourceCount - 1));
  const seller = SELLER_SCORE[input.seller] * (0.5 + 0.5 * input.sellerConfidence);
  /* Owner preference only for an already competitive, current property. */
  const ownerPreference = (input.seller === 'VERIFIED_OWNER' || input.seller === 'LIKELY_OWNER')
    && criteria >= 0.75 && input.freshness !== 'STALE' ? 1 : 0;
  const components: RankingComponents = {
    criteria: round3(criteria), budget, freshness: round3(freshness), value: round3(value),
    completeness: round3(input.completeness), evidence: round3(evidence), seller: round3(seller), ownerPreference,
  };
  const score = (Object.keys(RANKING_WEIGHTS) as Array<keyof RankingComponents>)
    .reduce((s, k) => s + RANKING_WEIGHTS[k] * components[k], 0);
  return { score: round3(score), components, vsComparable: vs };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
