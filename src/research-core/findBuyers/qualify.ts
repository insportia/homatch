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
import { NEARBY_DISTRICTS, normKey, parentDistrict } from './places.ts';

export const QUALIFICATION_VERSION = 5; // 4: financing dimension; 5: people-first — brokers soliciting sellers, unconfirmed buy/rent (2026-10-16)

export type MatchCategory = 'STRONG' | 'POTENTIAL' | 'WEAK' | 'REJECTED';
export type Fit = 'COMPATIBLE' | 'NEARBY' | 'CITY' | 'FLEXIBLE' | 'STRETCH' | 'UNCONFIRMED' | 'INCOMPATIBLE' | 'UNKNOWN';

export type RejectionReason =
  | 'NOT_REAL_ESTATE' | 'JOB_SEARCH' | 'SERVICE_AD' | 'SALE_ADVERTISEMENT' | 'RENT_ADVERTISEMENT'
  | 'AGENT_INTERMEDIARY' | 'WRONG_TRANSACTION' | 'UNCLEAR_INTENT' | 'NON_RESIDENTIAL'
  | 'PROPERTY_TYPE_MISMATCH' | 'BUDGET_INCOMPATIBLE' | 'OTHER_CITY' | 'STALE' | 'UNDATED' | 'DUPLICATE'
  /** The intent gate (buyerIntent.ts) found no buyer/tenant intent: seller, service, praise … */
  | 'INTENT_EXCLUDED';

/** Soft limitations recorded on non-rejected leads (why it is not Strong). */
export type Limitation =
  | 'BUDGET_UNKNOWN' | 'BUDGET_STRETCH' | 'LOCATION_UNKNOWN' | 'LOCATION_CITY_ONLY' | 'LOCATION_OTHER_AREA'
  | 'ROOMS_DIFFER' | 'ROOMS_UNKNOWN' | 'AREA_DIFFERS' | 'LOW_CONFIDENCE'
  /** A home seeker who did not say whether they buy or rent: interested, needs verification. */
  | 'TRANSACTION_UNCONFIRMED'
  /** Wants to pay the seller over time. Not a rejection: the property records nothing
   *  either way, so the seller's agreement is UNCONFIRMED, not assumed refused. */
  | 'FINANCING_SELLER_INSTALMENTS'
  /** Buys with a bank mortgage (informational: the seller is paid in full by the bank). */
  | 'FINANCING_MORTGAGE'
  /** States a down payment below the configured risk ratio of the price (default 10%).
   *  A risk heuristic, not a lender's eligibility rule. */
  | 'DOWN_PAYMENT_LOW';

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

export function budgetFit(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx']): Fit {
  if (!r.budget || r.budget.max == null || dna.price == null) return 'UNKNOWN';
  const want = toUsd({ amount: r.budget.max, currency: r.budget.currency }, fx);
  const wantMin = r.budget.min != null ? toUsd({ amount: r.budget.min, currency: r.budget.currency }, fx) : null;
  const price = dna.currency && dna.currency !== 'USD'
    ? toUsd({ amount: dna.price, currency: (dna.currency as 'GEL' | 'EUR') }, fx) : dna.price;
  /* A purchase budget against a sale price; a monthly budget against a rent. */
  if (wantMin != null && wantMin > price * 1.3) return 'INCOMPATIBLE';
  /* Within a normal negotiating margin (5%) the budget fits. Up to 15% under is the
     controlled flexibility the search allows: kept, but labelled STRETCH and never
     reported as an exact budget match (2026-10-12; was 10% / 20%). */
  if (want >= price * 0.95) return 'COMPATIBLE';
  if (want >= price * 0.85) return 'STRETCH';
  return 'INCOMPATIBLE';
}

/** Financing never rejects and never by itself makes a lead WEAK: seller instalments need
 *  the seller's agreement (UNCONFIRMED: no listing field records it either way); a down
 *  payment below the risk ratio is a STRETCH. Either only keeps the lead below STRONG and
 *  lowers its budget component. A mortgage is the bank's decision, not ours. */
export function financingFit(r: DemandReading, dna: PropertyDna, fx?: QualifyContext['fx'], ratio = DEFAULT_LOW_DOWN_PAYMENT_RATIO): { fit: Fit; limitations: Limitation[] } {
  const limitations: Limitation[] = [];
  if (dna.transaction === 'RENT') return { fit: 'UNKNOWN', limitations };
  const price = dna.price == null ? null : dna.currency && dna.currency !== 'USD'
    ? toUsd({ amount: dna.price, currency: (dna.currency as 'GEL' | 'EUR') }, fx) : dna.price;
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
  const dnaType = familyOf(dna);
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
  const bFit = budgetFit(r, dna, ctx.fx);
  const lFit = locationFit(r, dna);
  const qFit = requirementsFit(r, dna);
  const fin = financingFit(r, dna, ctx.fx, ctx.lowDownPaymentRatio ?? DEFAULT_LOW_DOWN_PAYMENT_RATIO);
  const financingRisk = fin.fit === 'STRETCH' || fin.fit === 'UNCONFIRMED';
  if (!reasons.length) {
    if (bFit === 'INCOMPATIBLE') reasons.push('BUDGET_INCOMPATIBLE');
    if (lFit === 'INCOMPATIBLE' && r.cities.length && !r.districts.length) reasons.push('OTHER_CITY');
    /* The family must match. Before 2026-10-12 only HOUSE vs APARTMENT was compared,
       so an apartment seeker for a land plot or a shop was kept as a WEAK lead. */
    if (r.propertyType && r.propertyType !== familyOf(dna)) reasons.push('PROPERTY_TYPE_MISMATCH');
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
    const confirmedBudget = bFit === 'COMPATIBLE';
    const goodPlace = lFit === 'COMPATIBLE' || lFit === 'NEARBY' || lFit === 'FLEXIBLE';
    const softMismatch = lFit === 'INCOMPATIBLE' || qFit === 'INCOMPATIBLE' || bFit === 'STRETCH';
    const strongFit = confirmedBudget && goodPlace && qFit !== 'INCOMPATIBLE' && r.confidence >= 0.7;
    /* Budget and place confirmed but financing unconfirmed or a stretch: Potential, never Strong. */
    if (txUnconfirmed) category = 'WEAK';
    else if (strongFit && !financingRisk) category = 'STRONG';
    else if (strongFit) category = 'POTENTIAL';
    else if (!softMismatch && (confirmedBudget || goodPlace || lFit === 'CITY')) category = 'POTENTIAL';
    else category = 'WEAK';
  }

  return {
    version: QUALIFICATION_VERSION, category, reasons, limitations, role: r.role, transaction: r.transaction,
    budgetFit: bFit, locationFit: lFit, requirementsFit: qFit, financingFit: fin.fit, score, components,
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

/** The DNA's family; a DNA stored before `family` existed derives it from its type. */
export function familyOf(dna: { propertyType: string | null; family?: PropertyFamily }): PropertyFamily {
  return dna.family ?? propertyFamily(dna.propertyType);
}
