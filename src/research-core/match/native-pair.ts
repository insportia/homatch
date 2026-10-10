// HOMATCH — ONE MEMBER'S REQUIREMENTS AGAINST ONE MEMBER'S PROPERTY.
//
// The mapping supply-matching's native pass applies before it calls assessMatch():
// an intent_profiles row (plus the strength map on its subscription) becomes a
// DemandSide, and a properties row plus its property_facts becomes a SupplySide.
//
// It lived only inside the edge function, so anything else that wanted to explain a
// native match — the owner's profile view, the admin demo — would have had to copy
// it, and two copies of a mapping are how two screens start disagreeing about the
// same pair. Extracted verbatim: the worker now calls these functions and its
// behaviour is unchanged (tests/matrix/internalMatches.test.mjs pins the seam).
//
// Pure: no I/O, no Deno, no browser. Imported by the worker over a relative path and
// by the SPA through '@/research-core/match/native-pair'.

import {
  assessMatch,
  type DemandSide,
  type MatchAssessment,
  type StrengthMap,
  type SupplySide,
} from './compatibility.ts';
import { nativeSupplyRole } from './participants.ts';

/**
 * The floor for calling a native pair a match. Three, not the module's default of
 * two — see supply-matching's MIN_AGREEMENTS, which is this constant.
 */
export const NATIVE_MIN_AGREEMENTS = 3;

/** An intent_profiles row as the worker selects it (only the fields the mapping reads). */
export interface IntentProfileShape {
  intent_type?: string | null;
  transaction_type?: string | null;
  city?: string | null;
  district?: string | null;
  property_types?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  currency?: string | null;
  area_min?: number | null;
  area_max?: number | null;
  bedrooms_min?: number | null;
  bedrooms_max?: number | null;
  rooms_min?: number | null;
  rooms_max?: number | null;
}

/**
 * THE FIRMNESS THE PERSON STATED, where they stated one.
 *
 * A native demand carries its own strength map on the subscription
 * (search_criteria.strength); a confirmed Search Plan stores each constraint as
 * { value, strength } instead. Only a demand with no stated strengths falls back to
 * the product default — a district is a preference unless the person said otherwise.
 */
export function strengthFromCriteria(criteria: Record<string, unknown> | null | undefined): StrengthMap {
  const source = (criteria ?? {}) as Record<string, unknown>;
  const planStrength = (): StrengthMap | null => {
    const map: Record<string, string> = {};
    const pick = (field: string, dimension: string) => {
      const entry = source[field] as { strength?: string } | null | undefined;
      if (entry && typeof entry === 'object' && entry.strength && entry.strength !== 'UNKNOWN') {
        map[dimension] = entry.strength;
      }
    };
    pick('city', 'CITY'); pick('districts', 'DISTRICT'); pick('propertyTypes', 'PROPERTY_TYPE');
    pick('budget', 'PRICE'); pick('bedrooms', 'BEDROOMS'); pick('areaSqm', 'AREA');
    return Object.keys(map).length ? map as StrengthMap : null;
  };
  const statedStrength = (source.strength && typeof source.strength === 'object')
    ? source.strength as StrengthMap
    : planStrength();
  return statedStrength && Object.keys(statedStrength).length
    ? { DISTRICT: 'PREFERRED', ...statedStrength }
    : { DISTRICT: 'PREFERRED' };
}

/** An intent_profiles row, shaped as demand. */
export function demandSideFromIntentProfile(row: IntentProfileShape, strength: StrengthMap): DemandSide {
  return {
    intentType: row.intent_type ?? null,
    transactionType: row.transaction_type ?? null,
    city: row.city ?? null,
    district: row.district ?? null,
    propertyTypes: row.property_types ?? null,
    budgetMin: row.budget_min as number | null,
    budgetMax: row.budget_max as number | null,
    currency: row.currency ?? null,
    areaMin: row.area_min as number | null,
    areaMax: row.area_max as number | null,
    bedroomsMin: row.bedrooms_min as number | null,
    bedroomsMax: row.bedrooms_max as number | null,
    roomsMin: row.rooms_min ?? null,
    roomsMax: row.rooms_max ?? null,
    strength,
  };
}

/** A properties row (the fields the mapping reads). */
export interface PropertyShape {
  transaction_type?: string | null;
  property_type?: string | null;
  listed_by_role?: string | null;
}

/** The newest property_facts row for that property. */
export interface PropertyFactsShape {
  city?: string | null;
  district?: string | null;
  total_price?: number | null;
  currency?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
}

/**
 * A PROPERTY, SHAPED AS SUPPLY. The same SupplySide the observation path builds, so
 * assessMatch() cannot treat the two differently. A rent price and a sale price are
 * the same column on a property and the transaction type says which, so only one of
 * the two amounts is ever populated — putting the figure in both would let a rental
 * match a buyer's budget.
 */
export function supplySideFromProperty(
  property: PropertyShape,
  facts: PropertyFactsShape | null | undefined,
): SupplySide {
  const transaction = String(property.transaction_type ?? '').toUpperCase();
  const amount = (facts?.total_price as number | null) ?? null;
  const amountCurrency = (facts?.currency as string | null) ?? null;
  return {
    /* Who listed it and what they offer -- see nativeSupplyRole. A rental listed by
       its owner is LANDLORD supply, so a tenant can match it. */
    role: nativeSupplyRole(transaction, property.listed_by_role ?? null),
    transaction: transaction || null,
    city: (facts?.city as string | null) ?? null,
    district: (facts?.district as string | null) ?? null,
    propertyType: property.property_type ?? null,
    saleAmount: transaction === 'RENT' ? null : amount,
    saleCurrency: transaction === 'RENT' ? null : amountCurrency,
    rentAmount: transaction === 'RENT' ? amount : null,
    rentCurrency: transaction === 'RENT' ? amountCurrency : null,
    areaSqm: (facts?.area as number | null) ?? null,
    bedrooms: (facts?.bedrooms as number | null) ?? null,
    rooms: (facts?.rooms as number | null) ?? null,
  };
}

/** The native pass's comparison: assessMatch at the native agreement floor. */
export function assessNativePair(demand: DemandSide, supply: SupplySide): MatchAssessment {
  return assessMatch(demand, supply, { minAgreements: NATIVE_MIN_AGREEMENTS });
}

/**
 * How a native match is badged. STRONG from 0.8 of the agreed weight, POTENTIAL
 * otherwise; anything that is not COMPATIBLE is not a match and is not badged.
 */
export type NativeFitBand = 'STRONG' | 'POTENTIAL' | 'NONE';

export const NATIVE_STRONG_SCORE = 0.8;

export function nativeFitBand(assessment: Pick<MatchAssessment, 'compatibility' | 'score'>): NativeFitBand {
  if (assessment.compatibility !== 'COMPATIBLE') return 'NONE';
  return assessment.score >= NATIVE_STRONG_SCORE ? 'STRONG' : 'POTENTIAL';
}

/** The same band from a stored supply_matches.match_score (0..1). */
export function nativeFitBandFromScore(score: number | null | undefined): NativeFitBand {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return 'POTENTIAL';
  return Number(score) >= NATIVE_STRONG_SCORE ? 'STRONG' : 'POTENTIAL';
}
