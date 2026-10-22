// HOMATCH — FIND BUYERS 2.0: WHICH KIND OF INTERNAL MATCH IS THIS PERSON? (owner, 2026-10-18)
//
// The strict native comparison (assessMatch at the native floor) answers "does this member's
// stated search fit this listing exactly". Owners asked for more reach without losing
// precision: people searching the next district over, people a little outside their stated
// budget, people searching elsewhere in the city for a property just like this one. This
// module decides, for one member search and one listing, whether the pair belongs in the
// owner's internal results at all and, if it does, in which category and why.
//
// IT IS STILL THE ONE COMPARISON. Every dimension (who can transact, sale or rent, city,
// property type, area, bedrooms/rooms) is judged by assessMatch. Exactly two things are
// relaxed before calling it, and both are reported, never hidden:
//
//   · the district stops being a disqualifier (FLEXIBLE) — geography is then judged here,
//     from real evidence, and the category says how far the listing is from what they named;
//   · the budget envelope is widened by the configured DISCOVERY TOLERANCE — the verdict
//     records whether the price is inside the stated budget or only inside the tolerance.
//
// CATEGORIES
//
//   EXACT            the member named this listing's area, wants this kind of property, and
//                    the price is inside the budget they stated. All three documented; a
//                    street mention alone never makes a match exact.
//   NEARBY_SIMILAR   one of:
//                      SAME_AREA_BUDGET_FLEX  their area, but the price is only inside the
//                                             tolerance, the budget is unknown, or the type
//                                             was not stated
//                      NEARBY_AREA            a neighbouring area, by measured geography
//                      CITY_WIDE              they searched the whole city, no area named
//                      SIMILAR_PROPERTY       elsewhere in the same city, but the listing is
//                                             like what they asked for on price, size and the
//                                             quality they stated
//   (VIP is a pricing overlay decided in SQL from the member's documented budget; it never
//    changes the evidence here.)
//
// GEOGRAPHY IS MEASURED, NEVER ASSUMED. "Nearby" means: the two areas' listing medians,
// computed from geocoded portal listings HOMATCH has actually observed, are within the
// configured distance, and each area has enough geocoded listings to trust its median. An
// area without that evidence is never "nearby" anything — it can only be an exact match.
// Names are compared through the one place vocabulary (place.ts / market_place_aliases);
// two names it cannot resolve across scripts are simply unrelated.
//
// A TOLERANCE IS NOT PURCHASING CAPACITY. A listing above the stated maximum is shown only
// as low confidence unless the member said their budget is flexible.
//
// Pure: no I/O, no Deno, no browser. Used by supply-matching (the writer) and by tests.

import {
  assessMatch,
  type ConstraintStrength,
  type DemandSide,
  type MatchAssessment,
  type MatchDimension,
  type SupplySide,
} from './compatibility.ts';
import { latinNameFor } from '../normalize/place.ts';

export const INTERNAL_TIERS_VERSION = 'fb2-tiers-1';

export type InternalCategory = 'EXACT' | 'NEARBY_SIMILAR';
export type InternalKind =
  | 'EXACT_LOCATION'
  | 'SAME_AREA_BUDGET_FLEX'
  | 'NEARBY_AREA'
  | 'CITY_WIDE'
  | 'SIMILAR_PROPERTY';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type BudgetVerdict = 'WITHIN' | 'BELOW_MIN_TOLERANCE' | 'ABOVE_MAX_TOLERANCE' | 'UNKNOWN';
export type GeoLevel = 'EXACT_AREA' | 'NEARBY_AREA' | 'CITY_WIDE' | 'OTHER_AREA';
export type QualityVerdict = 'AGREE' | 'CONFLICT' | 'UNKNOWN';

export interface BudgetBand {
  /** Inclusive upper bound of the listing price this band covers; null = no upper bound. */
  upTo: number | null;
  /** ± tolerance in the band currency. */
  tolerance: number;
}

export interface ExpansionConfig {
  /** Discovery tolerance by listing price (sale), in bandsCurrency. */
  saleBands: BudgetBand[];
  bandsCurrency: string;
  /** Rent tolerance as a fraction of the rent (0 = none). */
  rentTolerancePct: number;
  /** Two areas are neighbours when their measured listing medians are this close. */
  nearbyMaxKm: number;
  /** An area needs this many geocoded listings before its median is trusted. */
  minGeoSamples: number;
  /** Nearby areas must also be comparably priced (median USD/m² ratio), when both are known. */
  priceLevelMaxRatio: number;
  /** Whether SIMILAR_PROPERTY candidates are produced at all. */
  similarEnabled: boolean;
}

/** The owner's defaults (2026-10-18): ≤$50k ±$5k, $50,001–$119,999 ±$10k, ≥$120k ±$15k. */
export const DEFAULT_EXPANSION_CONFIG: ExpansionConfig = {
  saleBands: [
    { upTo: 50_000, tolerance: 5_000 },
    { upTo: 119_999, tolerance: 10_000 },
    { upTo: null, tolerance: 15_000 },
  ],
  bandsCurrency: 'USD',
  rentTolerancePct: 0,
  nearbyMaxKm: 2.5,
  minGeoSamples: 5,
  priceLevelMaxRatio: 1.35,
  similarEnabled: true,
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Merge a stored (admin) config over the defaults, keeping every value sane. */
export function expansionConfigFrom(raw: unknown): ExpansionConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bands = Array.isArray(r.saleBands)
    ? (r.saleBands as unknown[]).map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const upTo = o.upTo === null ? null : num(o.upTo);
      const tolerance = num(o.tolerance);
      return tolerance !== null && tolerance >= 0 && (upTo === null || upTo > 0) ? { upTo, tolerance } : null;
    }).filter((b): b is BudgetBand => b !== null)
    : [];
  const clamp = (v: unknown, lo: number, hi: number, d: number) => {
    const n = num(v);
    return n === null ? d : Math.min(hi, Math.max(lo, n));
  };
  const d = DEFAULT_EXPANSION_CONFIG;
  return {
    saleBands: bands.length ? bands : d.saleBands,
    bandsCurrency: typeof r.bandsCurrency === 'string' && /^[A-Z]{3}$/.test(r.bandsCurrency) ? r.bandsCurrency : d.bandsCurrency,
    rentTolerancePct: clamp(r.rentTolerancePct, 0, 0.5, d.rentTolerancePct),
    nearbyMaxKm: clamp(r.nearbyMaxKm, 0, 10, d.nearbyMaxKm),
    minGeoSamples: Math.round(clamp(r.minGeoSamples, 2, 1000, d.minGeoSamples)),
    priceLevelMaxRatio: clamp(r.priceLevelMaxRatio, 1, 5, d.priceLevelMaxRatio),
    similarEnabled: typeof r.similarEnabled === 'boolean' ? r.similarEnabled : d.similarEnabled,
  };
}

/**
 * The discovery tolerance for one listing price, or 0 when none applies (another currency
 * than the bands, a rent with no configured tolerance, an unknown price).
 */
export function budgetTolerance(price: number | null, currency: string | null, tx: 'SALE' | 'RENT', config: ExpansionConfig): number {
  if (price === null || !(price > 0)) return 0;
  if (tx === 'RENT') return Math.round(price * config.rentTolerancePct);
  if (String(currency ?? '').trim().toUpperCase() !== config.bandsCurrency) return 0;
  for (const band of config.saleBands) {
    if (band.upTo === null || price <= band.upTo) return band.tolerance;
  }
  return 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Geography
 * ──────────────────────────────────────────────────────────────────────── */

/** The same key as SQL market_place_key(): the vocabulary's Latin key, else the normalised name. */
export function placeKey(name: string | null | undefined): string | null {
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n) return null;
  return latinNameFor(n) ?? n;
}

/** One area's measured position: internal_match_place_geo. */
export interface PlaceGeo {
  cityKey: string;
  placeKey: string;
  samples: number;
  lat: number;
  lon: number;
  /** Median USD price per m² of the geocoded sale listings, when there were enough. */
  ppsqmUsd: number | null;
}

export interface GeoIndex {
  get(cityKey: string | null, placeKey: string | null): PlaceGeo | null;
}

export function geoIndexFrom(rows: readonly PlaceGeo[]): GeoIndex {
  const map = new Map<string, PlaceGeo>();
  for (const r of rows) {
    if (!r || !r.placeKey || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    map.set(`${r.cityKey}|${r.placeKey}`, r);
  }
  return { get: (c, p) => (c && p ? map.get(`${c}|${p}`) ?? null : null) };
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeoEvidence {
  level: GeoLevel;
  /** The area the member named that this verdict rests on. */
  demandPlace: string | null;
  /** The listing's area. */
  supplyPlace: string | null;
  km: number | null;
  samples: [number, number] | null;
  /** max/min of the two areas' median USD/m², when both are known. */
  priceLevelRatio: number | null;
  /** The member's stated street/landmark preference appears in the listing address. */
  streetMentioned: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * Quality and amenities (what the member stated vs what the listing states)
 * ──────────────────────────────────────────────────────────────────────── */

export interface SupplyQuality {
  condition?: string | null;
  constructionStatus?: string | null;
  newBuild?: boolean | null;
  /** Amenity → true/false as the listing states it; absent = unstated. */
  amenities?: Partial<Record<string, boolean | null>>;
}

export interface DemandRequirements {
  renovation?: string[];
  buildingStatuses?: string[];
  mustHave?: string[];
  niceToHave?: string[];
  nearby?: string[];
}

export function requirementsFrom(raw: unknown): DemandRequirements {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 20) : undefined);
  return {
    renovation: list(r.renovation), buildingStatuses: list(r.buildingStatuses),
    mustHave: list(r.mustHave), niceToHave: list(r.niceToHave), nearby: list(r.nearby),
  };
}

/** NEW/GOOD ↔ RENOVATED and NEEDS_RENOVATION ↔ NEEDS_RENOVATION; frames are never inferred. */
export function renovationVerdict(wanted: readonly string[] | undefined, condition: string | null | undefined): QualityVerdict {
  const w = (wanted ?? []).map((x) => x.toUpperCase()).filter((x) => x !== 'ANY');
  const c = String(condition ?? '').toUpperCase();
  if (!w.length || !c) return 'UNKNOWN';
  const offered = c === 'NEW' || c === 'GOOD' ? 'RENOVATED' : c === 'NEEDS_RENOVATION' ? 'NEEDS_RENOVATION' : null;
  if (!offered) return 'UNKNOWN';
  if (w.includes(offered)) return 'AGREE';
  /* Only a clear opposite is a conflict: "renovated only" vs a flat that needs work, or the reverse. */
  const onlyFinished = w.every((x) => x === 'RENOVATED');
  const onlyNeedsWork = w.every((x) => x === 'NEEDS_RENOVATION');
  return (onlyFinished && offered === 'NEEDS_RENOVATION') || (onlyNeedsWork && offered === 'RENOVATED') ? 'CONFLICT' : 'UNKNOWN';
}

export function buildingStatusVerdict(wanted: readonly string[] | undefined, q: SupplyQuality): QualityVerdict {
  const w = (wanted ?? []).map((x) => x.toUpperCase()).filter((x) => x !== 'ANY');
  if (!w.length) return 'UNKNOWN';
  const cs = String(q.constructionStatus ?? '').toUpperCase();
  const offered = /UNDER|BUILDING|CONSTRUCT/.test(cs) || String(q.condition ?? '').toUpperCase() === 'UNDER_CONSTRUCTION'
    ? 'UNDER_CONSTRUCTION'
    : /OLD/.test(cs) ? 'OLD_BUILD'
      : /NEW|COMPLET|READY/.test(cs) || q.newBuild === true ? 'NEW_BUILD'
        : null;
  if (!offered) return 'UNKNOWN';
  return w.includes(offered) ? 'AGREE' : 'CONFLICT';
}

export interface AmenityEvidence { agreed: string[]; conflicted: string[]; unknown: string[] }

export function amenityEvidence(wanted: readonly string[] | undefined, q: SupplyQuality): AmenityEvidence {
  const out: AmenityEvidence = { agreed: [], conflicted: [], unknown: [] };
  for (const a of wanted ?? []) {
    const key = a.toUpperCase();
    const v = q.amenities?.[key];
    if (v === true) out.agreed.push(key); else if (v === false) out.conflicted.push(key); else out.unknown.push(key);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * The verdict
 * ──────────────────────────────────────────────────────────────────────── */

export interface InternalCandidateInput {
  demand: DemandSide;
  /** Every area the member named: district first, then neighbourhoods. */
  demandPlaces: readonly string[];
  requirements: DemandRequirements;
  supply: SupplySide;
  supplyNeighborhood?: string | null;
  supplyAddress?: string | null;
  supplyQuality?: SupplyQuality;
}

export interface BudgetEvidence {
  verdict: BudgetVerdict;
  price: number | null;
  currency: string | null;
  min: number | null;
  max: number | null;
  /** Positive: how far outside the stated budget the price is (0 inside). */
  outsideBy: number;
  tolerance: number;
  /** The member said their budget is a preference, not a hard limit. */
  flexible: boolean;
}

export interface InternalCandidate {
  version: string;
  category: InternalCategory;
  kind: InternalKind;
  confidence: Confidence;
  /** 0..1, for ranking only. */
  score: number;
  geo: GeoEvidence;
  budget: BudgetEvidence;
  similarity: {
    agreed: MatchDimension[];
    preferenceMisses: MatchDimension[];
    unknown: MatchDimension[];
    renovation: QualityVerdict;
    buildingStatus: QualityVerdict;
    amenities: AmenityEvidence;
  };
  /** Codes the interface explains; never empty for anything below HIGH confidence. */
  uncertainty: string[];
  /** The relaxed assessment, as stored for the profile view. */
  assessment: Pick<MatchAssessment, 'agreed' | 'conflicted' | 'preferenceMisses' | 'unknown' | 'flexible' | 'rationale' | 'roles' | 'deal'>;
}

const tx = (v: string | null | undefined): 'SALE' | 'RENT' => (/RENT|LEASE/i.test(String(v ?? '')) ? 'RENT' : 'SALE');
const positive = (v: unknown) => { const n = num(v); return n !== null && n > 0 ? n : null; };

function budgetEvidence(demand: DemandSide, supply: SupplySide, config: ExpansionConfig): BudgetEvidence {
  const t = tx(demand.transactionType ?? supply.transaction);
  const price = positive(t === 'RENT' ? supply.rentAmount : supply.saleAmount);
  const currency = (t === 'RENT' ? supply.rentCurrency : supply.saleCurrency) ?? null;
  const min = positive(demand.budgetMin);
  const max = positive(demand.budgetMax);
  const strength: ConstraintStrength = demand.strength?.PRICE ?? 'REQUIRED';
  const flexible = strength === 'PREFERRED' || strength === 'FLEXIBLE';
  const tolerance = budgetTolerance(price, currency, t, config);
  const base = { price, currency, min, max, tolerance, flexible };
  const same = String(currency ?? '').trim().toUpperCase() !== ''
    && String(currency ?? '').trim().toUpperCase() === String(demand.currency ?? '').trim().toUpperCase();
  if (price === null || (min === null && max === null) || !same) return { ...base, verdict: 'UNKNOWN', outsideBy: 0 };
  if (max !== null && price > max) {
    return { ...base, verdict: price - max <= tolerance ? 'ABOVE_MAX_TOLERANCE' : 'UNKNOWN', outsideBy: price - max };
  }
  if (min !== null && price < min) {
    return { ...base, verdict: min - price <= tolerance ? 'BELOW_MIN_TOLERANCE' : 'UNKNOWN', outsideBy: min - price };
  }
  return { ...base, verdict: 'WITHIN', outsideBy: 0 };
}

function streetMentioned(nearby: readonly string[] | undefined, address: string | null | undefined): boolean {
  const addr = String(address ?? '').toLowerCase();
  if (!addr) return false;
  return (nearby ?? []).some((raw) => {
    /* The distinctive word of a street preference ("კრწანისის ქ." → "კრწანისის"), 4+ letters. */
    const word = String(raw).toLowerCase().replace(/(ქუჩა|ქ\.|street|st\.|avenue|ave\.|გამზირი|улица|ул\.)/g, ' ')
      .split(/[\s,.;]+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0];
    return Boolean(word && addr.includes(word));
  });
}

function geoEvidence(input: InternalCandidateInput, geo: GeoIndex, config: ExpansionConfig): GeoEvidence {
  const cityKey = placeKey(input.supply.city);
  const supplyKeys = [input.supply.district, input.supplyNeighborhood].map(placeKey).filter((k): k is string => Boolean(k));
  const demandKeys = [...new Set(input.demandPlaces.map(placeKey).filter((k): k is string => Boolean(k)))];
  const street = streetMentioned(input.requirements.nearby, input.supplyAddress);
  const supplyPlace = input.supply.district ?? input.supplyNeighborhood ?? null;
  if (!demandKeys.length) {
    return { level: 'CITY_WIDE', demandPlace: null, supplyPlace, km: null, samples: null, priceLevelRatio: null, streetMentioned: street };
  }
  const exact = input.demandPlaces.find((p) => supplyKeys.includes(placeKey(p) ?? ''));
  if (exact) {
    return { level: 'EXACT_AREA', demandPlace: exact, supplyPlace, km: 0, samples: null, priceLevelRatio: null, streetMentioned: street };
  }
  let best: GeoEvidence | null = null;
  for (const sk of supplyKeys) {
    const s = geo.get(cityKey, sk);
    if (!s || s.samples < config.minGeoSamples) continue;
    for (const p of input.demandPlaces) {
      const d = geo.get(cityKey, placeKey(p));
      if (!d || d.samples < config.minGeoSamples) continue;
      const km = Math.round(haversineKm(s, d) * 100) / 100;
      if (km > config.nearbyMaxKm) continue;
      const ratio = s.ppsqmUsd && d.ppsqmUsd
        ? Math.round((Math.max(s.ppsqmUsd, d.ppsqmUsd) / Math.min(s.ppsqmUsd, d.ppsqmUsd)) * 100) / 100 : null;
      if (ratio !== null && ratio > config.priceLevelMaxRatio) continue;
      if (!best || (best.km ?? Infinity) > km) {
        best = { level: 'NEARBY_AREA', demandPlace: p, supplyPlace, km, samples: [d.samples, s.samples], priceLevelRatio: ratio, streetMentioned: street };
      }
    }
  }
  return best ?? { level: 'OTHER_AREA', demandPlace: input.demandPlaces[0] ?? null, supplyPlace, km: null, samples: null, priceLevelRatio: null, streetMentioned: street };
}

const KIND_FACTOR: Record<InternalKind, number> = {
  EXACT_LOCATION: 1, SAME_AREA_BUDGET_FLEX: 0.9, NEARBY_AREA: 0.85, CITY_WIDE: 0.8, SIMILAR_PROPERTY: 0.7,
};

/**
 * One member search against one listing. Null when the pair does not belong in the owner's
 * internal results at all — a conflict on anything they required, a price beyond even the
 * tolerance, another city, or nothing documented enough to stand on.
 */
export function classifyInternalCandidate(
  input: InternalCandidateInput,
  geo: GeoIndex,
  config: ExpansionConfig = DEFAULT_EXPANSION_CONFIG,
  minAgreements = 3,
): InternalCandidate | null {
  const budget = budgetEvidence(input.demand, input.supply, config);
  /* A stated budget the price is beyond even the tolerance: not a candidate. */
  if (budget.verdict === 'UNKNOWN' && budget.outsideBy > 0) return null;

  const widened = budget.tolerance > 0 && budget.verdict !== 'UNKNOWN';
  const relaxedDemand: DemandSide = {
    ...input.demand,
    budgetMin: widened && input.demand.budgetMin != null ? Math.max(0, Number(input.demand.budgetMin) - budget.tolerance) : input.demand.budgetMin,
    budgetMax: widened && input.demand.budgetMax != null ? Number(input.demand.budgetMax) + budget.tolerance : input.demand.budgetMax,
    strength: { ...(input.demand.strength ?? {}), DISTRICT: 'FLEXIBLE' },
  };
  const relaxed = assessMatch(relaxedDemand, input.supply, { minAgreements });
  if (relaxed.compatibility !== 'COMPATIBLE') return null;
  /* The city is never relaxed and must be documented on both sides. */
  if (!relaxed.agreed.includes('CITY')) return null;

  const q = input.supplyQuality ?? {};
  const renovation = renovationVerdict(input.requirements.renovation, q.condition);
  const buildingStatus = buildingStatusVerdict(input.requirements.buildingStatuses, q);
  const amenities = amenityEvidence(input.requirements.mustHave, q);
  /* A must-have the listing explicitly lacks, or a stated quality it contradicts, is a real no. */
  if (amenities.conflicted.length || renovation === 'CONFLICT' || buildingStatus === 'CONFLICT') return null;

  const g = geoEvidence(input, geo, config);
  const typeAgreed = relaxed.agreed.includes('PROPERTY_TYPE');
  const sizeAgreed = relaxed.agreed.includes('AREA') || relaxed.agreed.includes('BEDROOMS');

  let category: InternalCategory;
  let kind: InternalKind;
  if (g.level === 'EXACT_AREA') {
    if (typeAgreed && budget.verdict === 'WITHIN') { category = 'EXACT'; kind = 'EXACT_LOCATION'; }
    else { category = 'NEARBY_SIMILAR'; kind = 'SAME_AREA_BUDGET_FLEX'; }
  } else if (g.level === 'NEARBY_AREA') {
    category = 'NEARBY_SIMILAR'; kind = 'NEARBY_AREA';
  } else if (g.level === 'CITY_WIDE') {
    category = 'NEARBY_SIMILAR'; kind = 'CITY_WIDE';
  } else {
    /* Another part of the city: only when the listing is genuinely like what they asked for. */
    if (!config.similarEnabled || !typeAgreed || !sizeAgreed || budget.verdict === 'UNKNOWN') return null;
    category = 'NEARBY_SIMILAR'; kind = 'SIMILAR_PROPERTY';
  }

  const uncertainty: string[] = [];
  if (budget.verdict === 'UNKNOWN') uncertainty.push(budget.price === null ? 'PRICE_UNSTATED' : (budget.min === null && budget.max === null) ? 'BUDGET_UNSTATED' : 'CURRENCY_DIFFERS');
  if (budget.verdict === 'ABOVE_MAX_TOLERANCE') uncertainty.push(budget.flexible ? 'ABOVE_MAX_FLEXIBLE' : 'ABOVE_MAX');
  if (budget.verdict === 'BELOW_MIN_TOLERANCE') uncertainty.push('BELOW_MIN');
  if (!typeAgreed) uncertainty.push('TYPE_UNSTATED');
  if (!sizeAgreed) uncertainty.push('SIZE_UNSTATED');
  if (kind === 'CITY_WIDE') uncertainty.push('CITY_WIDE_SEARCH');
  if (kind === 'NEARBY_AREA' && g.priceLevelRatio === null) uncertainty.push('AREA_PRICE_LEVEL_UNKNOWN');
  if (input.requirements.renovation?.length && renovation === 'UNKNOWN') uncertainty.push('RENOVATION_UNKNOWN');
  if (input.requirements.buildingStatuses?.length && buildingStatus === 'UNKNOWN') uncertainty.push('BUILDING_STATUS_UNKNOWN');
  if (amenities.unknown.length) uncertainty.push('AMENITIES_UNKNOWN');

  /* Never high confidence above the stated maximum unless they said the budget is flexible. */
  let confidence: Confidence = category === 'EXACT' ? 'HIGH' : 'MEDIUM';
  if (budget.verdict === 'UNKNOWN' || (budget.verdict === 'ABOVE_MAX_TOLERANCE' && !budget.flexible) || kind === 'SIMILAR_PROPERTY') {
    confidence = 'LOW';
  }

  const budgetFactor = budget.verdict === 'WITHIN' ? 1
    : budget.verdict === 'BELOW_MIN_TOLERANCE' ? 0.9
      : budget.verdict === 'ABOVE_MAX_TOLERANCE' ? (budget.flexible ? 0.85 : 0.75) : 0.85;
  const score = Math.round(Math.min(1, Math.max(0, relaxed.score * KIND_FACTOR[kind] * budgetFactor)) * 1000) / 1000;

  return {
    version: INTERNAL_TIERS_VERSION,
    category, kind, confidence, score,
    geo: g,
    budget,
    similarity: {
      agreed: relaxed.agreed, preferenceMisses: relaxed.preferenceMisses, unknown: relaxed.unknown,
      renovation, buildingStatus, amenities,
    },
    uncertainty,
    assessment: {
      agreed: relaxed.agreed, conflicted: relaxed.conflicted, preferenceMisses: relaxed.preferenceMisses,
      unknown: relaxed.unknown, flexible: relaxed.flexible, rationale: relaxed.rationale, roles: relaxed.roles, deal: relaxed.deal,
    },
  };
}

/** property_facts booleans → the amenity vocabulary the member chose from. */
export function supplyQualityFromFacts(facts: Record<string, unknown> | null | undefined): SupplyQuality {
  const f = facts ?? {};
  const b = (v: unknown) => (v === true ? true : v === false ? false : null);
  return {
    condition: (f.condition as string | null) ?? null,
    constructionStatus: (f.construction_status as string | null) ?? null,
    newBuild: b(f.new_build),
    amenities: {
      PARKING: b(f.parking), ELEVATOR: b(f.elevator), BALCONY: b(f.balcony), TERRACE: b(f.terrace),
      FURNISHED: b(f.furnished), AIR_CONDITIONING: b(f.air_conditioning), GARDEN: b(f.yard),
    },
  };
}
