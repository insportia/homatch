// LEAD QUALIFICATION — one explicit, recorded decision per candidate.
//
//   1 real-estate intent   2 buyer vs tenant   3 seeker vs advertiser
//   4 location             5 budget            6 property requirements
//   7 evidence & recency   8 duplicate
//
// Each dimension is COMPATIBLE / NEARBY / INCOMPATIBLE / UNKNOWN (and a few
// specific states). UNKNOWN is never COMPATIBLE: a buyer who did not state a
// budget can be a Potential match, never a Strong one. Every rejection carries
// its reasons; nothing about the person is invented — all values come from the
// DemandReading, which comes from the text.

import type { PropertyDna } from './propertyDna.ts';
import type { DemandReading } from './demandClassifier.ts';
import { toUsd } from './demandClassifier.ts';
import { NEARBY_DISTRICTS, normKey, parentDistrict } from './places.ts';

export const QUALIFICATION_VERSION = 2;

export type MatchCategory = 'STRONG' | 'POTENTIAL' | 'WEAK' | 'REJECTED';
export type Fit = 'COMPATIBLE' | 'NEARBY' | 'CITY' | 'FLEXIBLE' | 'STRETCH' | 'INCOMPATIBLE' | 'UNKNOWN';

export type RejectionReason =
  | 'NOT_REAL_ESTATE' | 'JOB_SEARCH' | 'SERVICE_AD' | 'SALE_ADVERTISEMENT' | 'RENT_ADVERTISEMENT'
  | 'AGENT_INTERMEDIARY' | 'WRONG_TRANSACTION' | 'UNCLEAR_INTENT' | 'NON_RESIDENTIAL'
  | 'PROPERTY_TYPE_MISMATCH' | 'BUDGET_INCOMPATIBLE' | 'OTHER_CITY' | 'STALE' | 'UNDATED' | 'DUPLICATE';

/** Soft limitations recorded on non-rejected leads (why it is not Strong). */
export type Limitation =
  | 'BUDGET_UNKNOWN' | 'BUDGET_STRETCH' | 'LOCATION_UNKNOWN' | 'LOCATION_CITY_ONLY' | 'LOCATION_OTHER_AREA'
  | 'ROOMS_DIFFER' | 'ROOMS_UNKNOWN' | 'AREA_DIFFERS' | 'LOW_CONFIDENCE';

export interface Qualification {
  version: number;
  category: MatchCategory;
  reasons: RejectionReason[];
  limitations: Limitation[];
  role: DemandReading['role'];
  transaction: DemandReading['transaction'];
  budgetFit: Fit;
  locationFit: Fit;
  requirementsFit: Fit;
  /** 0–100, from the dimensions above (no constant intent bonus). */
  score: number;
  components: Record<'intent' | 'location' | 'budget' | 'requirements' | 'recency', number>;
  /** What the text stated, for the customer's explanation. */
  stated: { budget: string | null; places: string[]; rooms: number | null; bedrooms: number | null };
}

export interface QualifyContext {
  ageDays: number | null;
  duplicate?: boolean;
  fx?: Partial<Record<string, number>>;
}

const MAX_AGE_DAYS = 30;

export function budgetFit(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx']): Fit {
  if (!r.budget || r.budget.max == null || dna.price == null) return 'UNKNOWN';
  const want = toUsd({ amount: r.budget.max, currency: r.budget.currency }, fx);
  const wantMin = r.budget.min != null ? toUsd({ amount: r.budget.min, currency: r.budget.currency }, fx) : null;
  const price = dna.currency && dna.currency !== 'USD'
    ? toUsd({ amount: dna.price, currency: (dna.currency as 'GEL' | 'EUR') }, fx) : dna.price;
  /* A purchase budget against a sale price; a monthly budget against a rent. */
  if (wantMin != null && wantMin > price * 1.3) return 'INCOMPATIBLE';
  if (want >= price * 0.9) return 'COMPATIBLE';
  if (want >= price * 0.8) return 'STRETCH';
  return 'INCOMPATIBLE';
}

export function locationFit(r: DemandReading, dna: PropertyDna): Fit {
  const dnaCity = normKey(dna.city);
  const dnaDistrict = normKey(dna.district);
  if (r.cities.length && dnaCity && !r.cities.includes(dnaCity)) return 'INCOMPATIBLE';
  if (r.districts.length && dnaDistrict) {
    const parents = r.districts.map(parentDistrict);
    if (r.districts.includes(dnaDistrict) || parents.includes(dnaDistrict)) return 'COMPATIBLE';
    const near = NEARBY_DISTRICTS[dnaDistrict] ?? [];
    if (r.districts.some((d) => near.includes(d) || near.includes(parentDistrict(d)))) return 'NEARBY';
    return r.locationFlexible ? 'FLEXIBLE' : 'INCOMPATIBLE';
  }
  if (r.locationFlexible) return 'FLEXIBLE';
  if (r.cities.length && dnaCity && r.cities.includes(dnaCity)) return 'CITY';
  return 'UNKNOWN';
}

export function requirementsFit(r: DemandReading, dna: PropertyDna): Fit {
  const dnaType = dna.propertyType === 'HOUSE' || dna.propertyType === 'VILLA' ? 'HOUSE'
    : dna.propertyType === 'LAND' ? 'LAND' : dna.propertyType === 'COMMERCIAL' || dna.propertyType === 'OFFICE' ? 'COMMERCIAL' : 'APARTMENT';
  if (r.propertyType && r.propertyType !== dnaType) return 'INCOMPATIBLE';
  const dnaRooms = dna.rooms ?? (dna.bedrooms != null ? dna.bedrooms + 1 : null);
  let d: number | null = null;
  if (r.bedrooms != null && dna.bedrooms != null) d = Math.abs(r.bedrooms - dna.bedrooms);
  else if (r.rooms != null && dnaRooms != null) d = Math.abs(r.rooms - dnaRooms);
  if (d == null) return 'UNKNOWN';
  if (d === 0) return 'COMPATIBLE';
  if (d === 1) return 'NEARBY';
  return 'INCOMPATIBLE';
}

const POINTS: Record<Fit, number> = { COMPATIBLE: 100, NEARBY: 80, FLEXIBLE: 70, CITY: 55, STRETCH: 55, UNKNOWN: 35, INCOMPATIBLE: 0 };

export function qualify(r: DemandReading, dna: PropertyDna, ctx: QualifyContext): Qualification {
  const reasons: RejectionReason[] = [];
  const limitations: Limitation[] = [];
  const wanted = dna.transaction === 'RENT' ? 'RENT' : 'BUY';
  const seekerRole = wanted === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER';

  /* 1–3: what is this, and is it the right side of the right market? */
  switch (r.role) {
    case 'JOB': reasons.push('JOB_SEARCH'); break;
    case 'SERVICE': reasons.push('SERVICE_AD'); break;
    case 'IRRELEVANT': reasons.push('NOT_REAL_ESTATE'); break;
    case 'SALE_OFFER': reasons.push('SALE_ADVERTISEMENT'); break;
    case 'RENT_OFFER': reasons.push('RENT_ADVERTISEMENT'); break;
    case 'AGENT': reasons.push('AGENT_INTERMEDIARY'); break;
    case 'UNCLEAR': reasons.push('UNCLEAR_INTENT'); break;
    default: if (r.role !== seekerRole) reasons.push('WRONG_TRANSACTION');
  }
  if (!reasons.length && r.propertyType === 'COMMERCIAL' && dna.propertyType !== 'COMMERCIAL') reasons.push('NON_RESIDENTIAL');

  /* 4–6: compatibility, each with UNKNOWN kept distinct. */
  const bFit = budgetFit(r, dna, ctx.fx);
  const lFit = locationFit(r, dna);
  const qFit = requirementsFit(r, dna);
  if (!reasons.length) {
    if (bFit === 'INCOMPATIBLE') reasons.push('BUDGET_INCOMPATIBLE');
    if (lFit === 'INCOMPATIBLE' && r.cities.length && !r.districts.length) reasons.push('OTHER_CITY');
    if (qFit === 'INCOMPATIBLE' && r.propertyType && r.propertyType !== (dna.propertyType === 'HOUSE' ? 'HOUSE' : 'APARTMENT')) reasons.push('PROPERTY_TYPE_MISMATCH');
  }
  /* 7: evidence must be current. */
  if (ctx.ageDays == null) reasons.push('UNDATED');
  else if (ctx.ageDays > MAX_AGE_DAYS) reasons.push('STALE');
  /* 8: the same person/text already counted. */
  if (ctx.duplicate) reasons.push('DUPLICATE');

  if (bFit === 'UNKNOWN') limitations.push('BUDGET_UNKNOWN');
  if (bFit === 'STRETCH') limitations.push('BUDGET_STRETCH');
  if (lFit === 'UNKNOWN') limitations.push('LOCATION_UNKNOWN');
  if (lFit === 'CITY') limitations.push('LOCATION_CITY_ONLY');
  if (lFit === 'INCOMPATIBLE' && r.districts.length) limitations.push('LOCATION_OTHER_AREA');
  if (qFit === 'UNKNOWN') limitations.push('ROOMS_UNKNOWN');
  if (qFit === 'INCOMPATIBLE' && !reasons.includes('PROPERTY_TYPE_MISMATCH')) limitations.push('ROOMS_DIFFER');
  if (r.confidence < 0.6) limitations.push('LOW_CONFIDENCE');

  const recency = ctx.ageDays == null ? 0 : ctx.ageDays <= 3 ? 100 : ctx.ageDays <= 7 ? 85 : ctx.ageDays <= 14 ? 65 : ctx.ageDays <= 30 ? 40 : 0;
  const components = {
    intent: Math.round(100 * (reasons.length ? 0 : r.confidence)),
    location: POINTS[lFit],
    budget: POINTS[bFit],
    requirements: POINTS[qFit],
    recency,
  };
  const score = reasons.length ? Math.min(20, Math.round(0.2 * components.intent))
    : Math.round(0.25 * components.intent + 0.25 * components.location + 0.25 * components.budget + 0.15 * components.requirements + 0.1 * components.recency);

  let category: MatchCategory;
  if (reasons.length) category = 'REJECTED';
  else {
    const confirmedBudget = bFit === 'COMPATIBLE';
    const goodPlace = lFit === 'COMPATIBLE' || lFit === 'NEARBY' || lFit === 'FLEXIBLE';
    const softMismatch = lFit === 'INCOMPATIBLE' || qFit === 'INCOMPATIBLE' || bFit === 'STRETCH';
    if (confirmedBudget && goodPlace && qFit !== 'INCOMPATIBLE' && r.confidence >= 0.7) category = 'STRONG';
    else if (!softMismatch && (confirmedBudget || goodPlace || lFit === 'CITY')) category = 'POTENTIAL';
    else category = 'WEAK';
  }

  return {
    version: QUALIFICATION_VERSION, category, reasons, limitations, role: r.role, transaction: r.transaction,
    budgetFit: bFit, locationFit: lFit, requirementsFit: qFit, score, components,
    stated: { budget: r.budget?.evidence ?? null, places: [...r.cities, ...r.districts], rooms: r.rooms, bedrooms: r.bedrooms },
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
