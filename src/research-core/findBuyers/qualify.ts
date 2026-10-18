// LEAD QUALIFICATION — one explicit, recorded decision per candidate.
//
//   1 real-estate intent   2 buyer vs tenant   3 seeker vs advertiser
//   4 location             5 budget            6 property requirements
//   7 evidence & recency   8 duplicate    9 financing (when the seeker states it)
//
// Each dimension is COMPATIBLE / NEARBY / INCOMPATIBLE / UNKNOWN (and a few
// specific states). UNKNOWN is never COMPATIBLE: a buyer who did not state a
// budget can be a Potential match, never a Strong one. Every rejection carries
// its reasons; nothing about the person is invented — all values come from the
// DemandReading, which comes from the text.

import { propertyFamily, type PropertyFamily } from './propertyFamily.ts';
import type { PropertyDna } from './propertyDna.ts';
import type { DemandReading } from './demandClassifier.ts';
import { toUsd, transactionUnconfirmed } from './demandClassifier.ts';
import { ADMIN_DISTRICTS, AREA_PARENT, NEARBY_DISTRICTS, STREETS, cityOfArea, normKey, parentDistrict, streetOfAddress } from './places.ts';

export const QUALIFICATION_VERSION = 9; // 9: the subtype a seeker states (office / shop / warehouse / villa / farmland) is compared with the property's — a commercial conflict is a type mismatch, a house/land one is never Strong (2026-10-18); 8: a business-named author or one who advertises homes in the same read is an intermediary, broker phrases ("თანამშრომლობთ", "ბინებს ვეძებ", "მყავს კლიენტი"), bedroom counts in words ("ერთ საძინებლიან") (2026-10-18); 7: stated size compared with the property's size band, a smaller home (or two+ rooms larger) is not this property's buyer, the model never makes a seeker of a text with no wish to buy (2026-10-17); 4: financing dimension; 5: people-first — brokers soliciting sellers, unconfirmed buy/rent (2026-10-16); 6: street / micro-area / district levels, budget levels incl. unstated currency, counterparty seekers and listing collectors are supply (2026-10-17)

export type MatchCategory = 'STRONG' | 'POTENTIAL' | 'WEAK' | 'REJECTED';
export type Fit = 'COMPATIBLE' | 'NEARBY' | 'CITY' | 'FLEXIBLE' | 'STRETCH' | 'UNCONFIRMED' | 'INCOMPATIBLE' | 'UNKNOWN';

export type RejectionReason =
  | 'NOT_REAL_ESTATE' | 'JOB_SEARCH' | 'SERVICE_AD' | 'SALE_ADVERTISEMENT' | 'RENT_ADVERTISEMENT'
  | 'AGENT_INTERMEDIARY' | 'WRONG_TRANSACTION' | 'UNCLEAR_INTENT' | 'NON_RESIDENTIAL'
  | 'PROPERTY_TYPE_MISMATCH' | 'BUDGET_INCOMPATIBLE' | 'OTHER_CITY' | 'STALE' | 'UNDATED' | 'DUPLICATE'
  /** The intent gate (buyerIntent.ts) found no buyer/tenant intent: seller, service, praise … */
  | 'INTENT_EXCLUDED'
  /** Names only other districts/areas of the property's city and states no flexibility (v6). */
  | 'OTHER_AREA'
  /** Explicitly excludes the property's district, micro-area or street ("not Krtsanisi"). */
  | 'LOCATION_EXCLUDED'
  /** The stated size is outside the property's size band ("up to 60 m²" for 97 m²) (v7). */
  | 'AREA_MISMATCH'
  /** Wants a smaller home (fewer rooms/bedrooms), or two or more rooms more (v7). */
  | 'ROOMS_MISMATCH';

/** Soft limitations recorded on non-rejected leads (why it is not Strong). */
export type Limitation =
  | 'BUDGET_UNKNOWN' | 'BUDGET_STRETCH' | 'LOCATION_UNKNOWN' | 'LOCATION_CITY_ONLY' | 'LOCATION_OTHER_AREA'
  | 'ROOMS_DIFFER' | 'ROOMS_UNKNOWN' | 'AREA_DIFFERS' | 'LOW_CONFIDENCE'
  /** A home seeker who did not say whether they buy or rent: interested, needs verification. */
  | 'TRANSACTION_UNCONFIRMED'
  /** Wants to pay the seller over time. Not a rejection: the property records nothing
   *  either way, so the seller's agreement is UNCONFIRMED, not assumed refused. */
  | 'FINANCING_SELLER_INSTALMENTS'
  /** A sibling micro-area or a nearby district, not the property's own place. */
  | 'LOCATION_NEARBY_ONLY'
  /** A micro-area of the property's district; whether the property is in it is not recorded. */
  | 'LOCATION_MICRO_AREA_UNCONFIRMED'
  /** "Any district" stated by the writer — flexible, but the place is not a match. */
  | 'LOCATION_FLEXIBLE_STATED'
  /** An amount without a currency: compared under USD and GEL, decided only when both agree. */
  | 'BUDGET_CURRENCY_UNSTATED'
  /** The budget is far above the asking price: likely another segment. */
  | 'BUDGET_ABOVE_RANGE'
  /** States another subtype of the same house/land family (a villa for a cottage, farmland for
   *  a building plot): kept, never Strong (v9). */
  | 'SUBTYPE_DIFFERS'
  /** Buys with a bank mortgage (informational: the seller is paid in full by the bank). */
  | 'FINANCING_MORTGAGE'
  /** States a down payment below the configured risk ratio of the price (default 10%).
   *  A risk heuristic, not a lender's eligibility rule. */
  | 'DOWN_PAYMENT_LOW';

/** How precisely the place in the text meets the property's place (v6). */
export type LocationLevel =
  | 'EXACT_STREET' | 'SAME_MICRO_AREA' | 'SAME_DISTRICT' | 'MICRO_AREA_OF_DISTRICT' | 'SIBLING_MICRO_AREA'
  | 'NEARBY_DISTRICT' | 'FLEXIBLE_STATED' | 'CITY_ONLY' | 'OTHER_DISTRICT' | 'EXCLUDED' | 'OTHER_CITY' | 'UNKNOWN';
/** How the stated budget meets the asking price (v6). */
export type BudgetLevel = 'WITHIN' | 'NEAR' | 'ABOVE_RANGE' | 'BELOW' | 'PERIOD_MISMATCH' | 'UNSTATED_CURRENCY' | 'UNKNOWN';

export interface Qualification {
  version: number;
  category: MatchCategory;
  /** v6: the precise location and budget readings behind locationFit / budgetFit. */
  locationLevel?: LocationLevel;
  budgetLevel?: BudgetLevel;
  reasons: RejectionReason[];
  limitations: Limitation[];
  role: DemandReading['role'];
  transaction: DemandReading['transaction'];
  budgetFit: Fit;
  locationFit: Fit;
  requirementsFit: Fit;
  /** How the seeker's stated way of paying fits the property: UNKNOWN when not stated
   *  (most buyers do not say); UNCONFIRMED for seller instalments (needs the seller's
   *  agreement, which no listing field records); STRETCH for a down payment below the
   *  risk ratio; COMPATIBLE for a mortgage without that flag. */
  financingFit?: Fit;
  /** 0–100, from the dimensions above (no constant intent bonus). */
  score: number;
  components: Record<'intent' | 'location' | 'budget' | 'requirements' | 'recency', number>;
  /** What the text stated, for the customer's explanation. */
  stated: { budget: string | null; places: string[]; rooms: number | null; bedrooms: number | null };
  /* Find Buyers 3.0 intent gate (absent on older leads). */
  intent?: string;
  resultType?: 'DIRECT' | 'INTEREST' | 'EXCLUDED';
  signals?: string[];
}

export interface QualifyContext {
  ageDays: number | null;
  duplicate?: boolean;
  fx?: Partial<Record<string, number>>;
  /** Down payment / price below which DOWN_PAYMENT_LOW is flagged (admin setting
   *  find_buyers_financing.lowDownPaymentRatio); 0 turns the flag off. */
  lowDownPaymentRatio?: number;
}

/** Default risk ratio for DOWN_PAYMENT_LOW: a heuristic, configurable, never a rejection. */
export const DEFAULT_LOW_DOWN_PAYMENT_RATIO = 0.1;
export function lowDownPaymentRatio(raw: unknown): number {
  const n = Number((raw as { lowDownPaymentRatio?: unknown } | null)?.lowDownPaymentRatio);
  return Number.isFinite(n) ? Math.max(0, Math.min(0.5, n)) : DEFAULT_LOW_DOWN_PAYMENT_RATIO;
}

const MAX_AGE_DAYS = 30;

const priceUsd = (dna: PropertyDna, fx?: QualifyContext['fx']): number | null => {
  if (dna.price == null) return null;
  if (!dna.currency || dna.currency === 'USD') return dna.price;
  const v = toUsd({ amount: dna.price, currency: dna.currency as 'GEL' | 'EUR' }, fx);
  return Number.isFinite(v) ? v : null;
};

/** One reading of a budget against the price, in USD. */
function budgetLevelUsd(want: number, wantMin: number | null, price: number): BudgetLevel {
  /* Within a normal negotiating margin (5%) the budget fits. Up to 15% under is the
     controlled flexibility the search allows: NEAR, never reported as an exact fit
     (2026-10-12). A minimum far above the price, or a maximum more than twice it,
     is another market segment (v6). */
  if (wantMin != null && wantMin > price * 1.3) return 'ABOVE_RANGE';
  if (want >= price * 0.95) return want > price * 2 && wantMin == null ? 'ABOVE_RANGE' : 'WITHIN';
  if (want >= price * 0.85) return 'NEAR';
  return 'BELOW';
}

/** The budget level, never invented: UNKNOWN without a budget or a usable price; an
 *  amount without a currency is decided only when USD and GEL readings agree. */
export function budgetLevel(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx']): BudgetLevel {
  const price = priceUsd(dna, fx);
  if (!r.budget || r.budget.max == null || price == null) return 'UNKNOWN';
  /* A monthly budget against a sale price (or a purchase sum against a rent). */
  if (r.budget.period === 'MONTHLY' && dna.transaction === 'SALE') return 'PERIOD_MISMATCH';
  if (r.budget.period === 'TOTAL' && dna.transaction === 'RENT' && r.budget.currencyStated !== false) return 'PERIOD_MISMATCH';
  const read = (currency: 'USD' | 'GEL' | 'EUR') => {
    const want = toUsd({ amount: r.budget!.max!, currency }, fx);
    const wantMin = r.budget!.min != null ? toUsd({ amount: r.budget!.min, currency }, fx) : null;
    return Number.isFinite(want) ? budgetLevelUsd(want, wantMin != null && Number.isFinite(wantMin) ? wantMin : null, price) : 'UNKNOWN' as BudgetLevel;
  };
  if (r.budget.currencyStated === false) {
    const usd = read('USD'); const gel = read('GEL');
    return usd === gel ? usd : 'UNSTATED_CURRENCY';
  }
  return read(r.budget.currency);
}

export function budgetFit(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx']): Fit {
  return BUDGET_FIT[budgetLevel(r, dna, fx)];
}
const BUDGET_FIT: Record<BudgetLevel, Fit> = {
  WITHIN: 'COMPATIBLE', NEAR: 'STRETCH', ABOVE_RANGE: 'STRETCH', BELOW: 'INCOMPATIBLE', PERIOD_MISMATCH: 'INCOMPATIBLE',
  UNSTATED_CURRENCY: 'UNKNOWN', UNKNOWN: 'UNKNOWN',
};

/** Financing never rejects and never by itself makes a lead WEAK: seller instalments need
 *  the seller's agreement (UNCONFIRMED: no listing field records it either way); a down
 *  payment below the risk ratio is a STRETCH. Either only keeps the lead below STRONG and
 *  lowers its budget component. A mortgage is the bank's decision, not ours. */
export function financingFit(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx'], ratio = DEFAULT_LOW_DOWN_PAYMENT_RATIO): { fit: Fit; limitations: Limitation[] } {
  const limitations: Limitation[] = [];
  if (dna.transaction === 'RENT') return { fit: 'UNKNOWN', limitations };
  const price = priceUsd(dna, fx);
  const down = r.downPayment ? toUsd({ amount: r.downPayment.amount, currency: r.downPayment.currency }, fx) : null;
  const lowDown = ratio > 0 && down != null && price != null && down < price * ratio;
  if (r.financing === 'INSTALMENTS') limitations.push('FINANCING_SELLER_INSTALMENTS');
  if (r.financing === 'MORTGAGE') limitations.push('FINANCING_MORTGAGE');
  if (lowDown) limitations.push('DOWN_PAYMENT_LOW');
  if (lowDown) return { fit: 'STRETCH', limitations };
  if (r.financing === 'INSTALMENTS') return { fit: 'UNCONFIRMED', limitations };
  if (r.financing === 'MORTGAGE') return { fit: 'COMPATIBLE', limitations };
  return { fit: 'UNKNOWN', limitations };
}

/** The property's place as the qualification sees it: its street (from the address),
 *  micro-area (neighbourhood, or a stored district that is itself a micro-area), the
 *  administrative district and the city. Nothing is inferred beyond the stored fields. */
export function propertyPlace(dna: PropertyDna): { street: string | null; microArea: string | null; district: string | null; city: string | null } {
  const stored = normKey(dna.district) || null;
  const hood = normKey(dna.neighborhood) || null;
  const microArea = hood && hood !== stored ? hood : stored && AREA_PARENT[stored] ? stored : null;
  const district = stored ? (ADMIN_DISTRICTS.has(stored) ? stored : AREA_PARENT[stored] ?? stored) : microArea ? AREA_PARENT[microArea] ?? null : null;
  const street = (dna as { street?: string | null }).street ?? streetOfAddress((dna as { address?: string | null }).address ?? null);
  return { street: street ? normKey(street) : null, microArea, district, city: normKey(dna.city) || null };
}

const LEVEL_RANK: Record<LocationLevel, number> = {
  EXACT_STREET: 9, SAME_MICRO_AREA: 8, SAME_DISTRICT: 7, MICRO_AREA_OF_DISTRICT: 6, SIBLING_MICRO_AREA: 5, NEARBY_DISTRICT: 4,
  FLEXIBLE_STATED: 3, CITY_ONLY: 2, UNKNOWN: 1, OTHER_DISTRICT: 0, EXCLUDED: -1, OTHER_CITY: -2,
};

/**
 * Where the writer wants to live, against the property — precise and evidence-only.
 * A request for "Ponichala" (a micro-area of the Krtsanisi district) is NOT a match for
 * an apartment on Krtsanisi Street: the property's micro-area is not recorded, so it is
 * MICRO_AREA_OF_DISTRICT (nearby, needs checking), never EXACT (owner, 2026-10-17).
 * Flexibility is only what the writer stated.
 */
export function locationLevel(r: DemandReading, dna: PropertyDna): LocationLevel {
  const p = propertyPlace(dna);
  const excluded = r.excludedPlaces ?? [];
  if (excluded.some((x) => x === p.district || x === p.microArea || (p.street && x === `street:${p.street}`))) return 'EXCLUDED';
  if (r.cities.length && p.city && !r.cities.includes(p.city)) {
    /* "Tbilisi or Batumi" is fine; only another city alone is OTHER_CITY. */
    return 'OTHER_CITY';
  }
  const streets = r.streets ?? [];
  const places = r.districts;
  if (!streets.length && !places.length) {
    if (r.locationFlexible) return 'FLEXIBLE_STATED';
    if (r.cities.length && p.city && r.cities.includes(p.city)) return 'CITY_ONLY';
    return 'UNKNOWN';
  }
  const levels: LocationLevel[] = [];
  for (const st of streets) {
    if (p.street && st === p.street) levels.push('EXACT_STREET');
    else levels.push(...placeLevels(STREETS[st]?.district ?? null, p));
  }
  for (const key of places) levels.push(...placeLevels(key, p));
  if (!levels.length) return 'UNKNOWN';
  /* A place named in another city (Old Batumi for a Tbilisi flat). */
  const best = levels.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0];
  if (best === 'OTHER_DISTRICT' && r.locationFlexible) return 'FLEXIBLE_STATED';
  return best;
}

function placeLevels(key: string | null, p: ReturnType<typeof propertyPlace>): LocationLevel[] {
  if (!key) return [];
  if (p.city && cityOfArea(key) !== p.city) return ['OTHER_CITY'];
  const isAdmin = ADMIN_DISTRICTS.has(key);
  const parent = isAdmin ? key : AREA_PARENT[key] ?? null;
  if (p.microArea && key === p.microArea) return ['SAME_MICRO_AREA'];
  if (isAdmin && key === p.district) return ['SAME_DISTRICT'];
  if (!isAdmin && parent && parent === p.district) return [p.microArea ? 'SIBLING_MICRO_AREA' : 'MICRO_AREA_OF_DISTRICT'];
  const near = p.district ? NEARBY_DISTRICTS[p.district] ?? [] : [];
  const nearOfMicro = p.microArea ? NEARBY_DISTRICTS[p.microArea] ?? [] : [];
  if (near.includes(key) || (parent && near.includes(parent)) || nearOfMicro.includes(key)) return ['NEARBY_DISTRICT'];
  return ['OTHER_DISTRICT'];
}

const LOCATION_FIT: Record<LocationLevel, Fit> = {
  EXACT_STREET: 'COMPATIBLE', SAME_MICRO_AREA: 'COMPATIBLE', SAME_DISTRICT: 'COMPATIBLE',
  MICRO_AREA_OF_DISTRICT: 'NEARBY', SIBLING_MICRO_AREA: 'NEARBY', NEARBY_DISTRICT: 'NEARBY',
  FLEXIBLE_STATED: 'FLEXIBLE', CITY_ONLY: 'CITY', UNKNOWN: 'UNKNOWN',
  OTHER_DISTRICT: 'INCOMPATIBLE', EXCLUDED: 'INCOMPATIBLE', OTHER_CITY: 'INCOMPATIBLE',
};

export function locationFit(r: DemandReading, dna: PropertyDna): Fit {
  return LOCATION_FIT[locationLevel(r, dna)];
}

export function requirementsFit(r: DemandReading, dna: PropertyDna): Fit {
  const dnaType = familyOf(dna);
  if (r.propertyType && r.propertyType !== dnaType) return 'INCOMPATIBLE';
  const dnaRooms = dna.rooms ?? (dna.bedrooms != null ? dna.bedrooms + 1 : null);
  /* Signed (v7, owner 2026-10-17): wanting FEWER rooms than the property has is wanting a
     smaller, cheaper home — not this property's buyer. One room more is near; two+ is not. */
  let d: number | null = null;
  /* Rooms inferred from bedrooms (no stated room count) are an estimate: one room fewer
     than the estimate is near, never a rejection. */
  let estimated = false;
  if (r.bedrooms != null && dna.bedrooms != null) d = r.bedrooms - dna.bedrooms;
  else if (r.rooms != null && dnaRooms != null) { d = r.rooms - dnaRooms; estimated = dna.rooms == null; }
  if (d == null) return 'UNKNOWN';
  if (d === 0) return 'COMPATIBLE';
  if (d === 1 || (estimated && d === -1)) return 'NEARBY';
  return 'INCOMPATIBLE';
}

export type AreaLevel = 'WITHIN' | 'MISMATCH' | 'UNKNOWN';

/**
 * The stated size against the property's size band (v7). The band is the DNA's area
 * tolerance (±20% by default); an approximate single figure ("about 80 m²") counts ±10%.
 * Only a range that cannot overlap the band is a mismatch — "up to 60 m²" for 97 m².
 */
/** The seeker's stated subtypes against the property's. Unstated on either side → UNKNOWN,
 *  never a match and never a conflict. */
export function subtypeFit(r: DemandReading, dna: PropertyDna): 'MATCH' | 'CONFLICT' | 'UNKNOWN' {
  const own = dna.subtype ?? null;
  const stated = r.subtypes ?? [];
  if (!own || !stated.length || (r.propertyType && r.propertyType !== familyOf(dna))) return 'UNKNOWN';
  const near: Record<string, string> = { WAREHOUSE: 'INDUSTRIAL', INDUSTRIAL: 'WAREHOUSE' };
  return stated.includes(own) || stated.includes(near[own] as never) ? 'MATCH' : 'CONFLICT';
}

export function areaLevel(r: DemandReading, dna: PropertyDna): AreaLevel {
  const a = r.area ?? (r.areaSqm != null ? { min: r.areaSqm, max: r.areaSqm, approx: true } : null);
  if (!a || dna.areaSqm == null) return 'UNKNOWN';
  const band = dna.tolerances?.area ?? { min: Math.round(dna.areaSqm * 0.8), max: Math.round(dna.areaSqm * 1.2) };
  const lo = a.min != null ? (a.approx ? a.min * 0.9 : a.min) : null;
  const hi = a.max != null ? (a.approx ? a.max * 1.1 : a.max) : null;
  if (hi != null && hi < band.min) return 'MISMATCH';
  if (lo != null && lo > band.max) return 'MISMATCH';
  return 'WITHIN';
}

const POINTS: Record<Fit, number> = { COMPATIBLE: 100, NEARBY: 80, FLEXIBLE: 70, CITY: 55, STRETCH: 55, UNCONFIRMED: 55, UNKNOWN: 35, INCOMPATIBLE: 0 };

export function qualify(r: DemandReading, dna: PropertyDna, ctx: QualifyContext): Qualification {
  const reasons: RejectionReason[] = [];
  const limitations: Limitation[] = [];
  const wanted = dna.transaction === 'RENT' ? 'RENT' : 'BUY';
  const seekerRole = wanted === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER';

  /* 1–3: what is this, and is it the right side of the right market? A seeker whose
     buy-or-rent is unconfirmed is neither rejected nor confirmed: WEAK, needs verification. */
  const txUnconfirmed = transactionUnconfirmed(r);
  if (txUnconfirmed) limitations.push('TRANSACTION_UNCONFIRMED');
  else switch (r.role) {
    case 'JOB': reasons.push('JOB_SEARCH'); break;
    case 'SERVICE': reasons.push('SERVICE_AD'); break;
    case 'IRRELEVANT': reasons.push('NOT_REAL_ESTATE'); break;
    case 'SALE_OFFER': reasons.push('SALE_ADVERTISEMENT'); break;
    case 'RENT_OFFER': reasons.push('RENT_ADVERTISEMENT'); break;
    case 'AGENT': reasons.push('AGENT_INTERMEDIARY'); break;
    case 'UNCLEAR': reasons.push('UNCLEAR_INTENT'); break;
    default: if (r.role !== seekerRole) reasons.push('WRONG_TRANSACTION');
  }
  if (!reasons.length && r.propertyType === 'COMMERCIAL' && familyOf(dna) !== 'COMMERCIAL') reasons.push('NON_RESIDENTIAL');

  /* 4–6: compatibility, each with UNKNOWN kept distinct. */
  const bLevel = budgetLevel(r, dna, ctx.fx);
  const bFit = BUDGET_FIT[bLevel];
  const lLevel = locationLevel(r, dna);
  const lFit = LOCATION_FIT[lLevel];
  const qFit = requirementsFit(r, dna);
  const aLevel = areaLevel(r, dna);
  const fin = financingFit(r, dna, ctx.fx, ctx.lowDownPaymentRatio ?? DEFAULT_LOW_DOWN_PAYMENT_RATIO);
  const financingRisk = fin.fit === 'STRETCH' || fin.fit === 'UNCONFIRMED';
  const subtype = subtypeFit(r, dna);
  if (!reasons.length) {
    if (bFit === 'INCOMPATIBLE') reasons.push('BUDGET_INCOMPATIBLE');
    if (lLevel === 'OTHER_CITY') reasons.push('OTHER_CITY');
    if (lLevel === 'EXCLUDED') reasons.push('LOCATION_EXCLUDED');
    /* Named only other areas of the city, no stated flexibility: not this property's buyer. */
    if (lLevel === 'OTHER_DISTRICT') reasons.push('OTHER_AREA');
    /* The family must match. Before 2026-10-12 only HOUSE vs APARTMENT was compared,
       so an apartment seeker for a land plot or a shop was kept as a WEAK lead. */
    if (r.propertyType && r.propertyType !== familyOf(dna)) reasons.push('PROPERTY_TYPE_MISMATCH');
    /* v9: a stated commercial subtype that is not this property's (an office for a warehouse). */
    else if (subtype === 'CONFLICT' && familyOf(dna) === 'COMMERCIAL') reasons.push('PROPERTY_TYPE_MISMATCH');
    /* v7: the size and the rooms they state must fit this property. */
    if (aLevel === 'MISMATCH') reasons.push('AREA_MISMATCH');
    if (qFit === 'INCOMPATIBLE' && !reasons.includes('PROPERTY_TYPE_MISMATCH')) reasons.push('ROOMS_MISMATCH');
  }
  /* 7: evidence must be current. */
  if (ctx.ageDays == null) reasons.push('UNDATED');
  else if (ctx.ageDays > MAX_AGE_DAYS) reasons.push('STALE');
  /* 8: the same person/text already counted. */
  if (ctx.duplicate) reasons.push('DUPLICATE');

  if (bFit === 'UNKNOWN') limitations.push('BUDGET_UNKNOWN');
  if (bLevel === 'NEAR') limitations.push('BUDGET_STRETCH');
  if (bLevel === 'ABOVE_RANGE') limitations.push('BUDGET_ABOVE_RANGE');
  if (bLevel === 'UNSTATED_CURRENCY') limitations.push('BUDGET_CURRENCY_UNSTATED');
  if (lFit === 'UNKNOWN') limitations.push('LOCATION_UNKNOWN');
  if (lFit === 'CITY') limitations.push('LOCATION_CITY_ONLY');
  if (lFit === 'INCOMPATIBLE' && (r.districts.length || (r.streets ?? []).length)) limitations.push('LOCATION_OTHER_AREA');
  if (lLevel === 'MICRO_AREA_OF_DISTRICT') limitations.push('LOCATION_MICRO_AREA_UNCONFIRMED');
  if (lLevel === 'SIBLING_MICRO_AREA' || lLevel === 'NEARBY_DISTRICT') limitations.push('LOCATION_NEARBY_ONLY');
  if (lLevel === 'FLEXIBLE_STATED') limitations.push('LOCATION_FLEXIBLE_STATED');
  if (qFit === 'UNKNOWN') limitations.push('ROOMS_UNKNOWN');
  if (qFit === 'INCOMPATIBLE' && !reasons.includes('PROPERTY_TYPE_MISMATCH')) limitations.push('ROOMS_DIFFER');
  if (subtype === 'CONFLICT' && !reasons.includes('PROPERTY_TYPE_MISMATCH')) limitations.push('SUBTYPE_DIFFERS');
  if (r.confidence < 0.6) limitations.push('LOW_CONFIDENCE');
  limitations.push(...fin.limitations);

  const recency = ctx.ageDays == null ? 0 : ctx.ageDays <= 3 ? 100 : ctx.ageDays <= 7 ? 85 : ctx.ageDays <= 14 ? 65 : ctx.ageDays <= 30 ? 40 : 0;
  const components = {
    intent: Math.round(100 * (reasons.length ? 0 : r.confidence)),
    location: POINTS[lFit],
    /* Ability to pay: a stated financing risk lowers it to that risk's points, never raises it. */
    budget: financingRisk ? Math.min(POINTS[bFit], POINTS[fin.fit]) : POINTS[bFit],
    requirements: POINTS[qFit],
    recency,
  };
  const score = reasons.length ? Math.min(20, Math.round(0.2 * components.intent))
    : Math.round(0.25 * components.intent + 0.25 * components.location + 0.25 * components.budget + 0.15 * components.requirements + 0.1 * components.recency);

  let category: MatchCategory;
  if (reasons.length) category = 'REJECTED';
  else {
    /* v6 (owner, 2026-10-17): STRONG needs the property's own place (street, micro-area or
       district) AND a budget within range — a nearby area, a stated "any district", a city
       or an unknown budget never makes a strong candidate. POTENTIAL needs one of them
       confirmed and the other at least plausible; everything else needs qualification. */
    const confirmedBudget = bFit === 'COMPATIBLE';
    const ownPlace = lFit === 'COMPATIBLE';
    const closePlace = lFit === 'NEARBY' || lFit === 'FLEXIBLE';
    const softMismatch = lFit === 'INCOMPATIBLE' || qFit === 'INCOMPATIBLE';
    const strongFit = confirmedBudget && ownPlace && qFit !== 'INCOMPATIBLE' && subtype !== 'CONFLICT' && r.confidence >= 0.7;
    /* Budget and place confirmed but financing unconfirmed or a stretch: Potential, never Strong. */
    if (txUnconfirmed) category = 'WEAK';
    else if (strongFit && !financingRisk) category = 'STRONG';
    else if (strongFit) category = 'POTENTIAL';
    else if (!softMismatch && confirmedBudget && (ownPlace || closePlace || lFit === 'CITY')) category = 'POTENTIAL';
    else if (!softMismatch && ownPlace && (bFit === 'UNKNOWN' || bFit === 'STRETCH')) category = 'POTENTIAL';
    else category = 'WEAK';
  }

  return {
    version: QUALIFICATION_VERSION, category, reasons, limitations, role: r.role, transaction: r.transaction,
    budgetFit: bFit, locationFit: lFit, requirementsFit: qFit, financingFit: fin.fit, score, components,
    locationLevel: lLevel, budgetLevel: bLevel,
    stated: { budget: r.budget?.evidence ?? null, places: [...r.cities, ...r.districts, ...(r.streets ?? []).map((k) => `street:${k}`)], rooms: r.rooms, bedrooms: r.bedrooms },
  };
}

/** Legacy intent_class for columns/consumers that still read it. */
export function legacyIntentClass(q: Qualification, counterpart: 'BUYER' | 'TENANT'): string {
  if (q.category === 'REJECTED') {
    if (q.reasons.includes('SALE_ADVERTISEMENT') || q.reasons.includes('RENT_ADVERTISEMENT')) return 'SELLER';
    if (q.reasons.includes('AGENT_INTERMEDIARY')) return 'AGENT';
    if (q.reasons.includes('SERVICE_AD')) return 'SERVICE_PROVIDER';
    if (q.reasons.includes('UNCLEAR_INTENT')) return 'UNCERTAIN';
    return 'NOISE';
  }
  const high = q.category === 'STRONG' || q.category === 'POTENTIAL';
  return counterpart === 'TENANT' ? (high ? 'TENANT_HIGH' : 'TENANT_MEDIUM') : (high ? 'BUYER_HIGH' : 'BUYER_MEDIUM');
}

/** The DNA's family; a DNA stored before `family` existed derives it from its type. */
export function familyOf(dna: { propertyType: string | null; family?: PropertyFamily }): PropertyFamily {
  return dna.family ?? propertyFamily(dna.propertyType);
}
