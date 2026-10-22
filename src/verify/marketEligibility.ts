// HOMATCH Verify — WHO the market search is about, and WHICH listings may
// describe it (2026-10-22, Verify V1 market defect F6).
//
// WHY THIS EXISTS (production job 61c1c38c, cadastral 01.14.07.001.044)
//
// The subject was a co-owned 2,509 m² non-agricultural plot on Tskneti
// highway 31 (Bagebi) carrying 2,054 m² and 10,066 m² of buildings. The
// MyHome.ge / SS.ge search was sent {city: თბილისი, APARTMENT, BUY} with no
// area, rooms or district, both portals were read city-wide, and 103
// 35–56 m² flats in Mukhiani, Saburtalo and Sololaki became the "market".
//
// Four faults, in order along the path:
//   1. the search started on the first BROWSER_WAITING tick, before the NAPR
//      extract existed, so nothing the register says could reach it;
//   2. buildResearchSeed never read the register's unit or land area, and its
//      type came from the IDENTITY model's assetClass (APARTMENT_IN_PROJECT);
//   3. marketProfileFromSeed turned an unknown type into APARTMENT and sent
//      null area / district through, which the worker read as "whole city";
//   4. nothing between the listings and the MARKET model, the RA price range
//      or the report checked type, deal, size, place or currency.
//
// This module answers both questions deterministically, from facts already in
// result_json (the register first), and records a reason for every listing it
// sets aside. A subject it cannot describe gets NO portal search and NO range:
// "insufficient data" is a true statement, a city-wide sweep presented as
// comparables is not.
//
// Pure: no clock, no network. The NBG rate is injected by the caller.

import type { ReportComparable } from './marketLane.ts';
import type { MarketProfileRequest } from './marketplaceComparables.ts';
import { listingKeyFromUrl } from './marketplaceComparables.ts';
import { comparableKindOf, dealTypeOf, kindsCompatible, subjectMarketFacts, subjectPropertyKind, MIN_DEFENSIBLE_COMPARABLES, SIZE_BAND, type PropertyKind } from './intelligence/marketHierarchy.ts';
import { buildPropertyRegister, type RegisterExtract } from './intelligence/propertyRegister.ts';
import { propertyKindFromRegister, registeredAddressOf, type PropertyKind as RegisterKind } from './intelligence/propertyKind.ts';
import { areaOf, areAdjacent, type AreaKey } from './intelligence/marketGeography.ts';
import { cityOfAddress } from './intelligence/locationIntelligence.ts';
import { trimOutliers } from './intelligence/marketIntelligence.ts';
import type { FxPoint } from './intelligence/fx.ts';

/* ------------------------------------------------------------------ *
 * Tunables (documented, one place)                                    *
 * ------------------------------------------------------------------ */

/**
 * How far a comparable's area may sit from the subject's, as a share of the
 * subject's area. Apartments use the customer gate's own SIZE_BAND (±35 %) so
 * the two gates can never disagree; houses and commercial units vary more;
 * land plots are priced per m² over a wide spread of plot sizes.
 */
export const AREA_TOLERANCE: Record<SearchableKind, number> = {
  APARTMENT: SIZE_BAND,
  HOUSE: 0.4,
  COMMERCIAL: 0.5,
  LAND: 0.5,
};

/** Room counts may differ by at most this much (residential units, both sides known). */
export const ROOMS_TOLERANCE = 1;

/** A measured distance beyond this is not the subject's location, whatever the label says. */
export const MAX_DISTANCE_M: Record<SearchableKind, number> = {
  APARTMENT: 1500,
  HOUSE: 3000,
  COMMERCIAL: 1500,
  LAND: 5000,
};

/** Below this many accepted, priced listings there is no range — mirrors the customer gate. */
export const MIN_ELIGIBLE_FOR_RANGE = MIN_DEFENSIBLE_COMPARABLES;

/** The reporting currency every accepted price is expressed in. */
export const REPORT_CURRENCY = 'USD';

/* ------------------------------------------------------------------ *
 * The subject                                                         *
 * ------------------------------------------------------------------ */

export type SubjectAssetClass =
  | 'APARTMENT'
  | 'HOUSE'
  | 'COMMERCIAL'
  | 'LAND'
  /** A parcel carrying a named development's buildings: not a flat, not bare land. */
  | 'DEVELOPMENT_PROJECT'
  | 'PARKING'
  /** Land with buildings and no project, storage, or a register that contradicts itself. */
  | 'MIXED'
  | 'UNKNOWN';

type SearchableKind = 'APARTMENT' | 'HOUSE' | 'COMMERCIAL' | 'LAND';
const SEARCHABLE: readonly SubjectAssetClass[] = ['APARTMENT', 'HOUSE', 'COMMERCIAL', 'LAND'];

export interface SubjectMarketProfile {
  assetClass: SubjectAssetClass;
  /** REGISTRY when the NAPR extract decided the class; IDENTITY when only research text did. */
  assetClassBasis: 'REGISTRY' | 'IDENTITY' | null;
  /** The unit's area for a unit, the plot's area for land. */
  areaSqm: number | null;
  areaBasis: 'REGISTRY_UNIT' | 'REGISTRY_LAND' | 'REGISTRY_BUILDINGS' | 'OFFICIAL_TEXT' | 'SEED' | null;
  /** The plot's registered area, whatever the class (context for a project). */
  landAreaSqm: number | null;
  rooms: number | null;
  city: string | null;
  district: string | null;
  /** The district as a known neighbourhood key, when it resolves to one. */
  areaKey: AreaKey | null;
  latitude: number | null;
  longitude: number | null;
  project: string | null;
  address: string | null;
  transactionType: 'BUY' | 'MONTHLY_RENT';
}

interface SeedLike {
  location?: Record<string, { value?: unknown } | null | undefined>;
  property?: { areaSqm?: { value?: unknown } | null; rooms?: { value?: unknown } | null; transaction?: string } & Record<string, unknown>;
  project?: { name?: { value?: unknown } | null } & Record<string, unknown>;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const pos = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const coord = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const REGISTER_TO_CLASS: Partial<Record<RegisterKind, SubjectAssetClass>> = {
  APARTMENT: 'APARTMENT',
  PRIVATE_HOUSE: 'HOUSE',
  LAND: 'LAND',
  PARKING: 'PARKING',
  COMMERCIAL: 'COMMERCIAL',
  OFFICE: 'COMMERCIAL',
  STORAGE: 'MIXED',
  OTHER: 'MIXED',
  AMBIGUOUS: 'MIXED',
};
const TEXT_TO_CLASS: Record<PropertyKind, SubjectAssetClass> = {
  APARTMENT: 'APARTMENT', HOUSE: 'HOUSE', LAND: 'LAND', PARKING: 'PARKING', COMMERCIAL: 'COMMERCIAL',
};

/** "მიწის ნაკვეთი შენობა-ნაგებობებით": a plot with buildings on it. */
const BUILDINGS_ON_PLOT = /შენობა[-\s]?ნაგებობ|buildings?\s+on|with\s+buildings|строени/iu;

/** The latest parsed NAPR extract in result_json, or null. Never throws. */
export function latestRegisterOf(result: unknown): Partial<RegisterExtract> | null {
  try {
    return buildPropertyRegister(obj(result).browserOfficial)?.latest ?? null;
  } catch {
    return null;
  }
}

/**
 * The subject, as the market search and the eligibility gate see it.
 *
 * `result` is research_jobs.result_json as it stands (mid-run: the IDENTITY
 * model's view is under result.identity, not yet at the top level). `seed` is
 * buildResearchSeed() over the same result. `registerLatest` may be passed to
 * reuse an already-parsed extract (and by tests); omitted, it is parsed here.
 */
export function subjectMarketProfile(input: {
  result: unknown;
  seed?: SeedLike | null;
  registerLatest?: Partial<RegisterExtract> | null;
}): SubjectMarketProfile {
  const r = obj(input.result);
  const identity = obj(r.identity);
  // Mid-run the identity's own words live under result.identity; the final
  // report carries them at the top level. Read both, register first.
  const view = {
    ...r,
    entityType: r.entityType ?? obj(identity.entity).type ?? null,
    assetClass: r.assetClass ?? identity.assetClass ?? null,
  };
  const seed = input.seed ?? {};
  const latest = input.registerLatest !== undefined ? input.registerLatest : latestRegisterOf(r);
  const l = obj(latest);

  /* ---- what kind of property ---- */
  let assetClass: SubjectAssetClass = 'UNKNOWN';
  let assetClassBasis: SubjectMarketProfile['assetClassBasis'] = null;
  if (latest) {
    const reg = propertyKindFromRegister(latest, registeredAddressOf(r, txt(l.recordId), null));
    const mapped = REGISTER_TO_CLASS[reg.kind];
    if (mapped) {
      assetClass = mapped;
      assetClassBasis = 'REGISTRY';
    }
  }
  if (assetClass === 'UNKNOWN') {
    const fromText = subjectPropertyKind(view);
    if (fromText) {
      assetClass = TEXT_TO_CLASS[fromText];
      assetClassBasis = 'IDENTITY';
    }
  }
  const project = txt(obj(seed.project?.name).value) ?? txt(obj(r.reconciledIdentity).project) ?? txt(obj(r.projectProfile).name) ?? null;
  const buildingsOnPlot = !!txt(l.buildingsText) || !!pos(l.buildingsTotalAreaSqm) || BUILDINGS_ON_PLOT.test(String(view.entityType ?? ''));
  if (assetClass === 'LAND' && buildingsOnPlot) assetClass = project ? 'DEVELOPMENT_PROJECT' : 'MIXED';

  /* ---- how big ---- */
  const facts = subjectMarketFacts(view);
  const seedArea = pos(obj(seed.property?.areaSqm).value);
  let areaSqm: number | null = null;
  let areaBasis: SubjectMarketProfile['areaBasis'] = null;
  const pick = (v: number | null, basis: NonNullable<SubjectMarketProfile['areaBasis']>) => {
    if (areaSqm == null && v != null) {
      areaSqm = v;
      areaBasis = basis;
    }
  };
  if (assetClass === 'LAND') {
    // A plot is compared on its own registered area, never a unit's.
    pick(pos(l.landAreaSqm), 'REGISTRY_LAND');
  } else if (assetClass === 'APARTMENT' || assetClass === 'COMMERCIAL' || assetClass === 'PARKING') {
    pick(pos(l.unitAreaSqm), 'REGISTRY_UNIT');
    pick(pos(facts.area), 'OFFICIAL_TEXT');
    pick(seedArea, 'SEED');
  } else if (assetClass === 'HOUSE') {
    pick(pos(l.unitAreaSqm), 'REGISTRY_UNIT');
    pick(pos(l.buildingsTotalAreaSqm), 'REGISTRY_BUILDINGS');
    pick(pos(facts.area), 'OFFICIAL_TEXT');
    pick(seedArea, 'SEED');
  }

  /* ---- where ---- */
  const loc = obj(seed.location);
  const address = txt(obj(loc.address).value) ?? txt(facts.address) ?? null;
  const city = txt(obj(loc.city).value) ?? (address ? cityOfAddress(address) ?? null : null);
  const district = txt(obj(loc.subDistrict).value) ?? txt(obj(loc.district).value) ?? txt(facts.district) ?? null;
  const areaKey = (district ? areaOf(district)?.area : null) ?? (facts.district ? areaOf(facts.district)?.area : null) ?? null;

  const residential = assetClass === 'APARTMENT' || assetClass === 'HOUSE';
  return {
    assetClass,
    assetClassBasis,
    areaSqm,
    areaBasis,
    landAreaSqm: pos(l.landAreaSqm),
    rooms: residential ? pos(obj(seed.property?.rooms).value) : null,
    city,
    district,
    areaKey,
    latitude: coord(obj(loc.latitude).value),
    longitude: coord(obj(loc.longitude).value),
    project: project ?? txt(facts.project) ?? null,
    address,
    transactionType: seed.property?.transaction === 'RENT' ? 'MONTHLY_RENT' : 'BUY',
  };
}

/* ------------------------------------------------------------------ *
 * Whether to search the portals at all                                *
 * ------------------------------------------------------------------ */

export type InsufficientReason =
  | 'PROPERTY_TYPE_UNKNOWN'
  | 'PROPERTY_TYPE_NOT_SEARCHABLE'
  | 'AREA_UNKNOWN'
  | 'LOCATION_UNKNOWN'
  /** Only the identity model's guess is known and the register is still being read. */
  | 'AWAITING_REGISTRY';

export interface MarketplaceSearchPlan {
  /** The worker request, or null when no defensible search exists. */
  request: MarketProfileRequest | null;
  reason: InsufficientReason | null;
}

/**
 * The MyHome.ge / SS.ge request for this subject, or the reason there is none.
 *
 * Never a city-wide search: a subject without a district is not searched.
 * Never an apartment search for something that is not an apartment.
 * `requireRegistry` (the pre-official attempt) refuses a class that only the
 * identity model asserted, so the decision waits for the register.
 */
export function marketplaceSearchPlan(p: SubjectMarketProfile, opts: { requireRegistry?: boolean } = {}): MarketplaceSearchPlan {
  if (opts.requireRegistry && p.assetClassBasis !== 'REGISTRY') return { request: null, reason: 'AWAITING_REGISTRY' };
  if (p.assetClass === 'UNKNOWN') return { request: null, reason: 'PROPERTY_TYPE_UNKNOWN' };
  if (!SEARCHABLE.includes(p.assetClass)) return { request: null, reason: 'PROPERTY_TYPE_NOT_SEARCHABLE' };
  if (!p.city || !p.district) return { request: null, reason: 'LOCATION_UNKNOWN' };
  if (!p.areaSqm) return { request: null, reason: 'AREA_UNKNOWN' };
  return {
    request: {
      city: p.city,
      district: p.district,
      transactionType: p.transactionType,
      propertyType: p.assetClass as SearchableKind,
      areaSqm: p.areaSqm,
      rooms: p.rooms,
      priceUsd: null,
    },
    reason: null,
  };
}

/* ------------------------------------------------------------------ *
 * Which listings may describe the subject                             *
 * ------------------------------------------------------------------ */

export type ExclusionReason =
  | 'SUBJECT_PROFILE_INSUFFICIENT'
  | 'PROPERTY_TYPE_MISMATCH'
  | 'DEAL_TYPE_MISMATCH'
  | 'SIZE_OUT_OF_BAND'
  | 'SIZE_UNKNOWN'
  | 'ROOMS_MISMATCH'
  | 'LOCATION_WIDER_MARKET'
  | 'LOCATION_MISMATCH'
  | 'TOO_FAR'
  | 'PROJECT_MISMATCH'
  | 'NOT_NEW_BUILD'
  | 'PRICE_MISSING'
  | 'CURRENCY_UNKNOWN'
  | 'CURRENCY_UNCONVERTIBLE'
  | 'DUPLICATE';

/** Any comparable shape the pipeline carries (lane, worker fold, or the MARKET model). */
export type AnyComparable = Partial<ReportComparable> & Record<string, any>;

export interface RejectedListing {
  url: string | null;
  source: string | null;
  reasons: ExclusionReason[];
}

export interface MarketEligibility {
  state: 'OK' | 'INSUFFICIENT_DATA';
  /** Why there is no valuation basis: a subject that cannot be described, or too few accepted listings. */
  reason: InsufficientReason | 'TOO_FEW_ELIGIBLE_COMPARABLES' | null;
  subject: { assetClass: SubjectAssetClass; assetClassBasis: SubjectMarketProfile['assetClassBasis']; areaSqm: number | null; areaBasis: SubjectMarketProfile['areaBasis']; district: string | null; rooms: number | null; transactionType: 'BUY' | 'MONTHLY_RENT' };
  accepted: AnyComparable[];
  /** One entry per listing set aside, with every reason that applied (capped at 400). */
  rejected: RejectedListing[];
  rejectedCounts: Partial<Record<ExclusionReason, number>>;
  /** Whether a price range may be computed from `accepted`. */
  valuationAllowed: boolean;
  currency: typeof REPORT_CURRENCY;
  fx: { date: string; gelPerUsd: number; source: string | null } | null;
  tolerances: { area: number | null; rooms: number | null; maxDistanceM: number | null };
}

const parseNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/[,\s]/g, '').match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function currencyOf(v: unknown): 'USD' | 'GEL' | 'OTHER' | null {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return null;
  if (s === 'USD' || s === '$' || s === 'US$' || s === 'დოლარი') return 'USD';
  if (s === 'GEL' || s === '₾' || s === 'LARI' || s === 'ლარი') return 'GEL';
  return 'OTHER';
}

function listingKind(c: AnyComparable): PropertyKind | null {
  const raw = String(c.sourcePropertyType ?? '').toUpperCase();
  if (raw === 'APARTMENT' || raw === 'HOUSE' || raw === 'LAND' || raw === 'COMMERCIAL') return raw;
  return comparableKindOf(c as never);
}

function dealOf(c: AnyComparable, ppsm: number | undefined): 'SALE' | 'RENT' | 'UNKNOWN' {
  const t = String(c.transactionType ?? c.dealType ?? '').toUpperCase();
  if (t === 'BUY' || t === 'SALE') return 'SALE';
  if (/RENT/.test(t)) return 'RENT';
  return dealTypeOf(c as never, ppsm);
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/["'«»„“”]/g, '').replace(/\s+/g, ' ').trim();

/** The subject's own project, named by the listing (not merely an alias like a neighbourhood). */
function namesSubjectProject(c: AnyComparable, project: string | null): boolean {
  const p = norm(project);
  if (p.length < 4) return false;
  const stated = norm(c.project);
  if (stated) return stated === p || stated.includes(p) || p.includes(stated);
  return norm(`${c.address ?? ''} ${c.similarity ?? ''}`).includes(p);
}

const NEW_BUILD = /ახალი\s*აშენებ|ახალაშენებ|new[-\s]?build|новостро|მშენებარე|under\s*construction|კარკას|frame|NEW_BUILD|UNDER_CONSTRUCTION/i;
const OLD_BUILD = /ძველი\s*აშენებ|old[-\s]?build|старый\s*фонд|OLD_BUILD/i;

function compAreaKey(c: AnyComparable): AreaKey | null {
  const m = areaOf(c.district) ?? areaOf(c.address);
  return m && !m.viaStreetName ? m.area : (m?.area ?? null);
}

/**
 * The deterministic eligibility gate. Run BEFORE the MARKET model reads the
 * set, on whatever it appends, and again before any range is computed —
 * idempotent: an accepted listing is already in the reporting currency.
 */
export function applyMarketEligibility(
  comparables: AnyComparable[],
  subject: SubjectMarketProfile,
  opts: { fx?: FxPoint | null } = {},
): MarketEligibility {
  const kind = subject.assetClass;
  const fx = opts.fx && opts.fx.gelPerUsd > 0 ? opts.fx : null;
  const searchable = (SEARCHABLE as readonly string[]).includes(kind) ? (kind as SearchableKind) : null;
  const tolerance = searchable ? AREA_TOLERANCE[searchable] : null;
  const maxDistance = searchable ? MAX_DISTANCE_M[searchable] : kind === 'DEVELOPMENT_PROJECT' ? MAX_DISTANCE_M.APARTMENT : null;
  const residentialUnit = kind === 'APARTMENT' || kind === 'HOUSE';

  // What the subject could not be described by — decided once, for every listing.
  const profileGap: InsufficientReason | null =
    kind === 'UNKNOWN' ? 'PROPERTY_TYPE_UNKNOWN'
      : kind === 'MIXED' || kind === 'PARKING' ? 'PROPERTY_TYPE_NOT_SEARCHABLE'
        : kind !== 'DEVELOPMENT_PROJECT' && !subject.areaSqm ? 'AREA_UNKNOWN'
          : !subject.areaKey && (subject.latitude == null || subject.longitude == null) && kind !== 'DEVELOPMENT_PROJECT' ? 'LOCATION_UNKNOWN'
            : null;

  const accepted: AnyComparable[] = [];
  const rejected: RejectedListing[] = [];
  const counts: Partial<Record<ExclusionReason, number>> = {};
  const seen = new Set<string>();
  const subjectDeal = subject.transactionType === 'MONTHLY_RENT' ? 'RENT' : 'SALE';

  for (const c of Array.isArray(comparables) ? comparables : []) {
    if (!c || typeof c !== 'object') continue;
    const reasons: ExclusionReason[] = [];
    const url = txt(c.url);

    /* identity: one listing, one vote */
    const keys = [listingKeyFromUrl(url), url ? `url:${url}` : null, ...((Array.isArray(c.alsoListedAt) ? c.alsoListedAt : []).map((a: any) => listingKeyFromUrl(a?.url)))]
      .filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k))) reasons.push('DUPLICATE');

    if (profileGap) reasons.push('SUBJECT_PROFILE_INSUFFICIENT');

    /* price, in one currency */
    const area = parseNum(c.area);
    let ppsm = parseNum(c.pricePerSqm) ?? (parseNum(c.price) && area ? parseNum(c.price)! / area : null);
    let price = parseNum(c.price);
    const cur = currencyOf(c.currency);
    let converted: { from: string; gelPerUsd: number; date: string; source: string | null } | null = null;
    if (ppsm == null) reasons.push('PRICE_MISSING');
    else if (cur === null) reasons.push('CURRENCY_UNKNOWN');
    else if (cur === 'OTHER') reasons.push('CURRENCY_UNCONVERTIBLE');
    else if (cur === 'GEL') {
      if (!fx) reasons.push('CURRENCY_UNCONVERTIBLE');
      else {
        ppsm = ppsm / fx.gelPerUsd;
        price = price != null ? price / fx.gelPerUsd : null;
        converted = { from: 'GEL', gelPerUsd: fx.gelPerUsd, date: fx.date, source: fx.source ?? null };
      }
    }

    /* the same kind of property, the same deal */
    const ck = listingKind(c);
    if (kind === 'DEVELOPMENT_PROJECT') {
      // A development is read only through its own (or a named peer's) new-build asks.
      if (ck && ck !== 'APARTMENT') reasons.push('PROPERTY_TYPE_MISMATCH');
      const tier = String(c.comparableType ?? '');
      if (tier === 'SAME_PROJECT') {
        if (!namesSubjectProject(c, subject.project)) reasons.push('PROJECT_MISMATCH');
      } else if (tier === 'PEER_PROJECT') {
        // A peer only when its place is shown to be the subject's own (or adjacent) area, or measured close.
        const ca = compAreaKey(c);
        const d = typeof c.distanceM === 'number' ? c.distanceM : parseNum(c.distanceM);
        const near = (d != null && maxDistance != null && d <= maxDistance) || (!!ca && !!subject.areaKey && (ca === subject.areaKey || areAdjacent(ca, subject.areaKey)));
        if (!near) reasons.push('LOCATION_WIDER_MARKET');
      } else reasons.push('LOCATION_WIDER_MARKET');
      const cls = `${c.condition ?? ''} ${c.similarity ?? ''} ${c.buildingStatus ?? ''}`;
      if (OLD_BUILD.test(cls) && !NEW_BUILD.test(cls)) reasons.push('NOT_NEW_BUILD');
    } else if (searchable) {
      if (!kindsCompatible(searchable, ck)) reasons.push('PROPERTY_TYPE_MISMATCH');
    }
    const deal = dealOf(c, ppsm ?? undefined);
    if (deal !== 'UNKNOWN' && deal !== subjectDeal) reasons.push('DEAL_TYPE_MISMATCH');

    /* size and rooms */
    if (searchable && subject.areaSqm && tolerance != null) {
      if (!area) reasons.push('SIZE_UNKNOWN');
      else if (Math.abs(area - subject.areaSqm) > tolerance * subject.areaSqm) reasons.push('SIZE_OUT_OF_BAND');
    }
    if (residentialUnit && subject.rooms) {
      const rooms = parseNum(c.rooms);
      if (rooms && Math.abs(rooms - subject.rooms) > ROOMS_TOLERANCE) reasons.push('ROOMS_MISMATCH');
    }

    /* the subject's own location */
    if (kind !== 'DEVELOPMENT_PROJECT') {
      const tier = String(c.comparableType ?? 'WIDER_MARKET');
      const d = typeof c.distanceM === 'number' ? c.distanceM : parseNum(c.distanceM);
      const ca = compAreaKey(c);
      const sa = subject.areaKey;
      const sameArea = !!ca && !!sa && (ca === sa || areAdjacent(ca, sa));
      const otherArea = !!ca && !!sa && !sameArea;
      if (d != null && maxDistance != null && d > maxDistance) reasons.push('TOO_FAR');
      else if (d != null) {
        /* measured and close: the label does not matter */
      } else if (tier === 'SAME_PROJECT') {
        /* the subject's own building */
      } else if (tier === 'WIDER_MARKET') {
        // A city-wide read still states each listing's neighbourhood; one that
        // names the subject's own (or an adjacent) area is local evidence.
        if (!sameArea) reasons.push('LOCATION_WIDER_MARKET');
      } else if (tier === 'PEER_PROJECT') {
        if (!sameArea) reasons.push(otherArea ? 'LOCATION_MISMATCH' : 'LOCATION_WIDER_MARKET');
      } else if (otherArea) {
        // MICRO_LOCATION / SAME_DISTRICT whose own stated area is elsewhere.
        reasons.push('LOCATION_MISMATCH');
      }
    }

    if (reasons.length) {
      for (const r of reasons) counts[r] = (counts[r] ?? 0) + 1;
      if (rejected.length < 400) rejected.push({ url, source: txt(c.source), reasons });
      continue;
    }
    for (const k of keys) seen.add(k);
    const tierNow = String(c.comparableType ?? '');
    accepted.push({
      ...c,
      ...(tierNow === 'WIDER_MARKET' ? { comparableType: 'SAME_DISTRICT' } : {}),
      ...(converted
        ? {
            price: price != null ? String(Math.round(price)) : c.price ?? null,
            pricePerSqm: String(Math.round(ppsm! * 100) / 100),
            currency: REPORT_CURRENCY,
            originalPrice: c.price ?? null,
            originalPricePerSqm: c.pricePerSqm ?? null,
            originalCurrency: 'GEL',
            fxConversion: converted,
          }
        : { currency: REPORT_CURRENCY }),
    });
  }

  const priced = accepted.filter((c) => parseNum(c.pricePerSqm) != null).length;
  const reason: MarketEligibility['reason'] = profileGap ?? (priced < MIN_ELIGIBLE_FOR_RANGE ? 'TOO_FEW_ELIGIBLE_COMPARABLES' : null);
  return {
    state: reason ? 'INSUFFICIENT_DATA' : 'OK',
    reason,
    subject: {
      assetClass: kind,
      assetClassBasis: subject.assetClassBasis,
      areaSqm: subject.areaSqm,
      areaBasis: subject.areaBasis,
      district: subject.district,
      rooms: subject.rooms,
      transactionType: subject.transactionType,
    },
    accepted,
    rejected,
    rejectedCounts: counts,
    valuationAllowed: !reason,
    currency: REPORT_CURRENCY,
    fx: fx ? { date: fx.date, gelPerUsd: fx.gelPerUsd, source: fx.source ?? null } : null,
    tolerances: { area: tolerance, rooms: residentialUnit ? ROOMS_TOLERANCE : null, maxDistanceM: maxDistance },
  };
}

/**
 * The accepted set a price range may be computed from: nothing when the gate
 * says insufficient, otherwise every accepted listing with Tukey (1.5 × IQR)
 * outliers removed on price per m² — the same trim the customer gate uses.
 */
export function rangeBasis(gate: MarketEligibility): { kept: AnyComparable[]; outliersTrimmed: number } {
  if (!gate.valuationAllowed) return { kept: [], outliersTrimmed: 0 };
  const priced = gate.accepted.filter((c) => parseNum(c.pricePerSqm) != null);
  const { kept, trimmed } = trimOutliers(priced, (c) => parseNum(c.pricePerSqm) as number);
  if (kept.length < MIN_ELIGIBLE_FOR_RANGE) return { kept: [], outliersTrimmed: trimmed.length };
  return { kept, outliersTrimmed: trimmed.length };
}

/** A compact, customer-free summary for result_json / Admin (no listing URLs beyond the capped reject list). */
export function eligibilitySummary(gate: MarketEligibility): Record<string, unknown> {
  return {
    state: gate.state,
    reason: gate.reason,
    subject: gate.subject,
    accepted: gate.accepted.length,
    rejectedCounts: gate.rejectedCounts,
    rejected: gate.rejected,
    valuationAllowed: gate.valuationAllowed,
    currency: gate.currency,
    fx: gate.fx,
    tolerances: gate.tolerances,
  };
}

/**
 * The MARKET model's instruction when the gate says there is no valuation
 * basis. Prepended to the stage prompt; the rest of the prompt is untouched.
 */
export function marketEligibilityBrief(gate: { state?: unknown; reason?: unknown; subject?: { assetClass?: unknown } } | null | undefined): string {
  if (!gate || gate.state !== 'INSUFFICIENT_DATA') return '';
  const kind = String(gate.subject?.assetClass ?? 'UNKNOWN');
  return (
    `MARKET ELIGIBILITY (deterministic, binding): reliable comparables for this subject are INSUFFICIENT (${String(gate.reason)}; subject class ${kind}). ` +
    'Do NOT produce, estimate or imply a valuation, a price range, a median, a price per m² for the subject, or a price position. ' +
    `Return only comparables that are the same property class (${kind}), the same deal type and in the subject's own neighbourhood — never city-wide stock and never a different property class; ` +
    'code re-checks every listing you return and discards the rest. In priceEvidence, state plainly that the market could not be characterised from reliable comparables.\n\n'
  );
}
