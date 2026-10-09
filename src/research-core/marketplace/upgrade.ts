// HOMATCH MARKETPLACE SEARCH — Budget Upgrade Intelligence ("ღირს განხილვა").
//
// The customer's maximum is a HARD limit for normal results. Separately, a
// property slightly above it may be worth a look, and only when it is:
//
//   ≤ +5%   preferred window
//   ≤ +10%  extended window, the absolute ceiling; +10% and one dollar is out
//
// and only when it brings REAL, evidence-backed advantages over the strongest
// in-budget alternative. Fitting inside the extra 10% is never a reason on its
// own. The budget is never widened because results are poor, at most three are
// shown, and when none qualifies the section does not exist.
//
// "What do I get for the extra money" is a list of facts with numbers, not a
// score: extra price, extra percentage, extra area, room and bedroom
// differences, price per m², location, renovation, building, parking,
// amenities, seller evidence, freshness.

import type { BudgetBand, PropertyFacts } from './ranking.ts';
import { districtFit } from './ranking.ts';
import type { FreshnessState } from './normalize.ts';
import type { SellerClass } from './seller.ts';

export const MAX_UPGRADE_RECOMMENDATIONS = 3;

export interface UpgradeCandidateInput {
  key: string;
  facts: PropertyFacts;
  band: BudgetBand;
  fits: boolean;
  criteriaScore: number;
  freshness: FreshnessState;
  seller: SellerClass;
  score: number;
}

export type AdvantageCode =
  | 'MORE_AREA' | 'EXTRA_BEDROOM' | 'EXTRA_ROOM' | 'BETTER_RENOVATION' | 'NEWER_BUILDING' | 'PARKING'
  | 'BALCONY' | 'TERRACE' | 'ELEVATOR' | 'BETTER_LOCATION' | 'BETTER_PRICE_PER_SQM' | 'OWNER_LISTING' | 'FRESHER';

export interface Advantage {
  code: AdvantageCode;
  /** The measured difference where one exists (m², rooms, %, USD/m²). */
  delta: number | null;
  major: boolean;
}

export interface Gain {
  baselineKey: string;
  extraPriceUsd: number | null;
  /** Over the customer's confirmed maximum, e.g. 0.047 = +4.7%. */
  overMaxPct: number | null;
  extraAreaSqm: number | null;
  roomDifference: number | null;
  bedroomDifference: number | null;
  pricePerSqmDifferenceUsd: number | null;
  advantages: Advantage[];
  disadvantages: string[];
}

const RENOVATION_RANK: Record<string, number> = { RENOVATED: 4, GREEN_FRAME: 3, WHITE_FRAME: 2, BLACK_FRAME: 1, NEEDS_RENOVATION: 0 };
const FRESH_RANK: Record<FreshnessState, number> = { VERIFIED: 2, RECENT: 1, STALE: 0 };

const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);

/** Factual comparison of an upgrade candidate against an in-budget baseline. */
export function whatYouGain(
  baseline: UpgradeCandidateInput,
  candidate: UpgradeCandidateInput,
  context: { maxUsd: number; districts: readonly string[] },
): Gain {
  const b = baseline.facts;
  const c = candidate.facts;
  const adv: Advantage[] = [];
  const dis: string[] = [];
  const extraArea = diff(c.areaSqm, b.areaSqm);
  if (extraArea !== null && b.areaSqm && (extraArea >= 8 || extraArea / b.areaSqm >= 0.08)) {
    adv.push({ code: 'MORE_AREA', delta: Math.round(extraArea), major: extraArea / b.areaSqm >= 0.10 });
  } else if (extraArea !== null && extraArea < -3) dis.push('LESS_AREA');
  const bedDiff = diff(c.bedrooms, b.bedrooms);
  if (bedDiff !== null && bedDiff > 0) adv.push({ code: 'EXTRA_BEDROOM', delta: bedDiff, major: true });
  else if (bedDiff !== null && bedDiff < 0) dis.push('FEWER_BEDROOMS');
  const roomDiff = diff(c.rooms, b.rooms);
  if (roomDiff !== null && roomDiff > 0 && !(bedDiff !== null && bedDiff > 0)) adv.push({ code: 'EXTRA_ROOM', delta: roomDiff, major: false });
  if (c.renovationStatus && b.renovationStatus && (RENOVATION_RANK[c.renovationStatus] ?? -1) > (RENOVATION_RANK[b.renovationStatus] ?? -1)) {
    adv.push({ code: 'BETTER_RENOVATION', delta: null, major: c.renovationStatus === 'RENOVATED' });
  }
  if (c.constructionYear != null && b.constructionYear != null && c.constructionYear > b.constructionYear && c.buildingStatus !== 'UNDER_CONSTRUCTION') {
    adv.push({ code: 'NEWER_BUILDING', delta: null, major: false });
  }
  if (c.parking === true && b.parking === false) adv.push({ code: 'PARKING', delta: null, major: false });
  for (const [code, amenity] of [['BALCONY', 'BALCONY'], ['TERRACE', 'TERRACE'], ['ELEVATOR', 'ELEVATOR']] as const) {
    if (c.amenities.includes(amenity) && b.amenities.includes(`NO_${amenity}`)) adv.push({ code, delta: null, major: false });
  }
  const cd = districtFit(c.district, context.districts);
  const bd = districtFit(b.district, context.districts);
  if (cd === 'MATCH' && bd !== 'MATCH' && bd !== 'NA') adv.push({ code: 'BETTER_LOCATION', delta: null, major: true });
  else if (bd === 'MATCH' && cd !== 'MATCH' && cd !== 'NA') dis.push('WORSE_LOCATION');
  const ppsqmDiff = diff(c.pricePerSqmUsd, b.pricePerSqmUsd);
  if (ppsqmDiff !== null && b.pricePerSqmUsd && ppsqmDiff <= -0.05 * b.pricePerSqmUsd) {
    adv.push({ code: 'BETTER_PRICE_PER_SQM', delta: Math.round(ppsqmDiff), major: ppsqmDiff <= -0.08 * b.pricePerSqmUsd });
  }
  const owner = (s: SellerClass) => s === 'VERIFIED_OWNER' || s === 'LIKELY_OWNER';
  if (owner(candidate.seller) && !owner(baseline.seller)) adv.push({ code: 'OWNER_LISTING', delta: null, major: false });
  if (FRESH_RANK[candidate.freshness] > FRESH_RANK[baseline.freshness]) adv.push({ code: 'FRESHER', delta: null, major: false });
  else if (candidate.freshness === 'STALE') dis.push('STALE');
  return {
    baselineKey: baseline.key,
    extraPriceUsd: diff(c.priceUsd, b.priceUsd),
    overMaxPct: c.priceUsd !== null ? Math.round(((c.priceUsd - context.maxUsd) / context.maxUsd) * 1000) / 1000 : null,
    extraAreaSqm: extraArea !== null ? Math.round(extraArea) : null,
    roomDifference: roomDiff,
    bedroomDifference: bedDiff,
    pricePerSqmDifferenceUsd: ppsqmDiff !== null ? Math.round(ppsqmDiff) : null,
    advantages: adv,
    disadvantages: dis,
  };
}

/** Real value: a major advantage, or at least two advantages, and no disqualifying disadvantage. */
export function isMeaningful(g: Gain): boolean {
  if (g.disadvantages.some((d) => d === 'WORSE_LOCATION' || d === 'STALE' || d === 'FEWER_BEDROOMS' || d === 'LESS_AREA')) return false;
  const improvements = g.advantages.filter((a) => a.code !== 'OWNER_LISTING' && a.code !== 'FRESHER');
  return improvements.some((a) => a.major) || improvements.length >= 2;
}

export interface UpgradeRecommendation {
  key: string;
  band: 'UPGRADE_PREFERRED' | 'UPGRADE_EXTENDED';
  gain: Gain;
}

/**
 * Pick at most three upgrades. Each is compared with the strongest in-budget
 * alternative of the same search; a candidate that is not meaningfully better
 * is not shown, however close to the budget it is.
 */
export function selectUpgrades(
  candidates: readonly UpgradeCandidateInput[],
  context: { maxUsd: number; districts: readonly string[] },
): UpgradeRecommendation[] {
  const inBudget = candidates.filter((c) => c.band === 'IN_BUDGET' && c.fits).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  if (!inBudget.length) return [];
  const baseline = inBudget[0];
  const pool = candidates
    .filter((c) => (c.band === 'UPGRADE_PREFERRED' || c.band === 'UPGRADE_EXTENDED')
      && c.facts.priceUsd !== null && c.facts.priceUsd * 100 >= context.maxUsd * 105
      && c.facts.priceUsd * 100 <= context.maxUsd * 110
      && c.fits && c.criteriaScore >= baseline.criteriaScore - 0.05)
    .map((c) => ({ c, gain: whatYouGain(baseline, c, context) }))
    .filter((x) => isMeaningful(x.gain))
    .sort((x, y) => (x.c.band === y.c.band ? 0 : x.c.band === 'UPGRADE_PREFERRED' ? -1 : 1)
      || y.gain.advantages.filter((a) => a.major).length - x.gain.advantages.filter((a) => a.major).length
      || y.c.score - x.c.score
      || x.c.key.localeCompare(y.c.key));
  return pool.slice(0, MAX_UPGRADE_RECOMMENDATIONS).map((x) => ({ key: x.c.key, band: x.c.band as UpgradeRecommendation['band'], gain: x.gain }));
}
