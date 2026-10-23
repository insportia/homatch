/*
 * The advisor's reading of one property against one customer's request.
 *
 * Deterministic and evidence-only: every point comes from a fact a source
 * published (or a phrase in the listing's own description) compared with a
 * criterion the customer actually asked for. Nothing is inferred from silence:
 * a listing that does not mention an elevator yields an UNKNOWN point, never
 * "no elevator". The UI turns the codes into friendly sentences in six
 * languages; the codes themselves are never shown.
 *
 *   fits        confirmed: the listing states it and it matches the request
 *   misses      confirmed: the listing states it and it does not match
 *   unknown     the customer asked, the listing does not say
 *   highlights  what makes it worth a look beyond the request (value, owner, …)
 */
import type { SearchIntelligenceBrief, NumericRange } from './brief.ts';
import { districtFit, type PropertyFacts } from './ranking.ts';

export type AdvisorVerdict = 'TOP' | 'GOOD' | 'CONSIDER' | 'UPGRADE';

export interface AdvisorPoint {
  code: string;
  /** Values for the sentence: numbers stay numbers so the UI formats them per locale. */
  params?: Record<string, string | number>;
}

export interface AdvisorAssessment {
  verdict: AdvisorVerdict;
  fits: AdvisorPoint[];
  misses: AdvisorPoint[];
  unknown: AdvisorPoint[];
  highlights: AdvisorPoint[];
}

/** The subset of a result the advisor reads; a ResultProperty or PropertyView satisfies it. */
export interface AdvisorInput {
  group: string;
  facts: PropertyFacts;
  intelligence?: {
    strong: boolean;
    preferences: { confirmed: string[]; mentioned: string[]; unconfirmed: string[]; contradicted: string[] };
  };
  vsComparable: number | null;
  seller: { classification: string; reasonCodes?: string[] };
  listings: Array<{ publishedAt?: string | null; updatedAt?: string | null }>;
  priceDiscrepancy: { significant: boolean; differenceUsd: number } | null;
  upgrade: { overMaxPct: number | null; advantages: Array<{ code: string; delta: number | null }> } | null;
}

type Fit = 'IN' | 'BELOW' | 'ABOVE' | 'UNKNOWN' | 'NA';

function inRange(value: number | null, range: NumericRange | null | undefined): Fit {
  if (!range || (range.min === null && range.max === null)) return 'NA';
  if (value === null || !Number.isFinite(value)) return 'UNKNOWN';
  if (range.min !== null && value < range.min) return 'BELOW';
  if (range.max !== null && value > range.max) return 'ABOVE';
  return 'IN';
}

const ANY = 'ANY';
const wanted = <T extends string>(field: { value: T[] } | null | undefined): T[] =>
  (field?.value ?? []).filter((v) => v !== ANY);

function amenityState(code: string, f: PropertyFacts, prefs: { mentioned: string[]; contradicted: string[] } | null): 'YES' | 'NO' | 'MENTIONED' | 'UNKNOWN' {
  const structured = code === 'PARKING' ? f.parking : code === 'FURNISHED' ? f.furnished
    : code === 'ELEVATOR' ? f.elevator ?? (f.amenities.includes('ELEVATOR') ? true : f.amenities.includes('NO_ELEVATOR') ? false : null)
      : f.amenities.includes(code) ? true : null;
  if (structured === true) return 'YES';
  if (structured === false || prefs?.contradicted.includes(code)) return 'NO';
  if (prefs?.mentioned.includes(code)) return 'MENTIONED';
  return 'UNKNOWN';
}

const DAY = 86_400_000;

export function assessProperty(p: AdvisorInput, brief: SearchIntelligenceBrief, now: Date = new Date()): AdvisorAssessment {
  const f = p.facts;
  const fits: AdvisorPoint[] = [];
  const misses: AdvisorPoint[] = [];
  const unknown: AdvisorPoint[] = [];
  const highlights: AdvisorPoint[] = [];

  // Budget. Below the minimum is not a problem worth raising; above the maximum is.
  const price = inRange(f.priceUsd, brief.price?.value);
  if (price === 'IN' || price === 'BELOW') fits.push({ code: 'BUDGET' });
  else if (price === 'ABOVE' && f.priceUsd !== null && brief.price?.value.max != null) {
    const over = f.priceUsd - brief.price.value.max;
    misses.push({ code: 'OVER_BUDGET', params: { amount: Math.round(over), pct: Math.round((over / brief.price.value.max) * 100) } });
  } else if (price === 'UNKNOWN') unknown.push({ code: 'PRICE' });

  const area = inRange(f.areaSqm, brief.area?.value);
  if (area === 'IN') fits.push({ code: 'AREA', params: { v: f.areaSqm as number } });
  else if (area === 'BELOW') misses.push({ code: 'AREA_SMALLER', params: { v: f.areaSqm as number } });
  else if (area === 'ABOVE') misses.push({ code: 'AREA_LARGER', params: { v: f.areaSqm as number } });
  else if (area === 'UNKNOWN') unknown.push({ code: 'AREA' });

  const rooms = inRange(f.rooms, brief.rooms?.value);
  if (rooms === 'IN') fits.push({ code: 'ROOMS', params: { n: f.rooms as number } });
  else if (rooms === 'BELOW' || rooms === 'ABOVE') misses.push({ code: 'ROOMS', params: { n: f.rooms as number } });
  else if (rooms === 'UNKNOWN') unknown.push({ code: 'ROOMS' });

  const bedrooms = inRange(f.bedrooms, brief.bedrooms?.value);
  if (bedrooms === 'IN') fits.push({ code: 'BEDROOMS', params: { n: f.bedrooms as number } });
  else if (bedrooms === 'BELOW' || bedrooms === 'ABOVE') misses.push({ code: 'BEDROOMS', params: { n: f.bedrooms as number } });
  else if (bedrooms === 'UNKNOWN') unknown.push({ code: 'BEDROOMS' });

  const districts = brief.districts?.value ?? [];
  if (districts.length) {
    const d = districtFit(f.district, districts);
    if (d === 'MATCH') fits.push({ code: 'DISTRICT', params: { district: f.district as string } });
    else if (d === 'OTHER') misses.push({ code: 'DISTRICT', params: { district: f.district as string } });
    else if (d === 'UNKNOWN') unknown.push({ code: 'DISTRICT' });
  }

  const statuses = wanted(brief.buildingStatuses);
  if (statuses.length) {
    if (!f.buildingStatus) unknown.push({ code: 'BUILDING' });
    else if ((statuses as string[]).includes(f.buildingStatus)) fits.push({ code: 'BUILDING', params: { status: f.buildingStatus } });
    else misses.push({ code: 'BUILDING', params: { status: f.buildingStatus } });
  }
  const renovations = wanted(brief.renovationPreferences);
  if (renovations.length) {
    if (!f.renovationStatus) unknown.push({ code: 'RENOVATION' });
    else if ((renovations as string[]).includes(f.renovationStatus)) fits.push({ code: 'RENOVATION', params: { status: f.renovationStatus } });
    else misses.push({ code: 'RENOVATION', params: { status: f.renovationStatus } });
  }
  if (brief.maxBuildingAge != null) {
    const year = now.getUTCFullYear();
    if (f.constructionYear == null || f.constructionYear > year) unknown.push({ code: 'BUILD_YEAR' });
    else if (year - f.constructionYear <= brief.maxBuildingAge) fits.push({ code: 'BUILD_YEAR', params: { year: f.constructionYear } });
    else misses.push({ code: 'BUILD_YEAR', params: { year: f.constructionYear } });
  }

  const floor = inRange(f.floor, brief.floorRange ?? null);
  if (floor === 'IN') fits.push({ code: 'FLOOR', params: { n: f.floor as number } });
  else if (floor === 'BELOW' || floor === 'ABOVE') misses.push({ code: 'FLOOR', params: { n: f.floor as number } });
  else if (floor === 'UNKNOWN') unknown.push({ code: 'FLOOR' });
  for (const pref of brief.floorPreferences ?? []) {
    if (pref === 'NOT_FIRST') {
      if (f.floor === null) { if (floor !== 'UNKNOWN') unknown.push({ code: 'FLOOR' }); }
      else if (f.floor === 1) misses.push({ code: 'FIRST_FLOOR' });
      else fits.push({ code: 'NOT_FIRST_FLOOR' });
    }
    if (pref === 'NOT_LAST') {
      if (f.floor === null || f.totalFloors === null) { if (!unknown.some((u) => u.code === 'FLOOR')) unknown.push({ code: 'FLOOR' }); }
      else if (f.floor === f.totalFloors) misses.push({ code: 'LAST_FLOOR' });
      else fits.push({ code: 'NOT_LAST_FLOOR' });
    }
  }

  if (brief.furnished?.value != null) {
    if (f.furnished === null) unknown.push({ code: 'FURNISHED' });
    else if (f.furnished === brief.furnished.value) fits.push({ code: brief.furnished.value ? 'FURNISHED' : 'UNFURNISHED' });
    else misses.push({ code: f.furnished ? 'FURNISHED' : 'UNFURNISHED' });
  }

  // Parking is asked either as its own field or as a must-have; one point either way.
  const amenities = [...new Set([...(brief.parking?.value === true ? ['PARKING'] : []), ...brief.mustHave, ...brief.niceToHave])]
    .filter((code) => code !== 'FURNISHED' || brief.furnished?.value == null);
  const prefs = p.intelligence?.preferences ?? null;
  /* A nice-to-have the listing does not mention is a soft unknown: it never blocks a "good match". */
  const required = new Set([...(brief.parking?.value === true ? ['PARKING'] : []), ...brief.mustHave]);
  let softUnknown = 0;
  for (const code of amenities) {
    const state = amenityState(code, f, prefs);
    if (state === 'YES') fits.push({ code: 'AMENITY', params: { amenity: code } });
    else if (state === 'MENTIONED') fits.push({ code: 'AMENITY_MENTIONED', params: { amenity: code } });
    else if (state === 'NO') misses.push({ code: 'AMENITY', params: { amenity: code } });
    else {
      unknown.push({ code: 'AMENITY', params: { amenity: code } });
      if (!required.has(code)) softUnknown += 1;
    }
  }
  for (const code of brief.exclusions) {
    if (f.amenities.includes(code)) misses.push({ code: 'EXCLUDED', params: { amenity: code } });
  }

  // Beyond the request: only what the evidence supports.
  if (p.vsComparable !== null && p.vsComparable <= -5) highlights.push({ code: 'BELOW_MARKET', params: { pct: Math.round(Math.abs(p.vsComparable)) } });
  if (p.seller.classification === 'LIKELY_OWNER') highlights.push({ code: 'OWNER' });
  const newest = Math.max(...p.listings.map((l) => Date.parse(l.updatedAt ?? l.publishedAt ?? '') || 0));
  if (newest > 0 && now.getTime() - newest >= 0 && now.getTime() - newest <= 2 * DAY) highlights.push({ code: 'FRESH' });
  if (p.listings.length > 1) highlights.push({ code: 'MULTI_SITE', params: { n: p.listings.length } });
  if (p.priceDiscrepancy?.significant) highlights.push({ code: 'PRICE_DIFFERS', params: { amount: Math.round(p.priceDiscrepancy.differenceUsd) } });
  for (const a of p.upgrade?.advantages ?? []) highlights.push({ code: `UPGRADE_${a.code}`, params: { n: a.delta !== null ? Math.abs(a.delta) : 0 } });

  /* "Good match" is a claim: nothing the customer required may contradict it or be unknown.
     A required criterion the listing does not state makes it "worth a look" (ask first). */
  const verdict: AdvisorVerdict = p.group === 'UPGRADE' || p.upgrade ? 'UPGRADE'
    : p.intelligence?.strong ? 'TOP'
      : misses.length === 0 && unknown.length === softUnknown ? 'GOOD' : 'CONSIDER';
  return { verdict, fits, misses, unknown, highlights };
}

/** Recommended = the top of the list; everything else is "also worth a look". */
export const isRecommended = (a: AdvisorAssessment) => a.verdict === 'TOP' || a.verdict === 'GOOD';
