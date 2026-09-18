// HOMATCH RESEARCH CORE — from a seed to a comparable envelope.
//
// THE FAILURE THIS EXISTS TO PREVENT
//
// "Apartments Tbilisi" returns a hundred thousand rows, and treating them as
// comparables produces a median that describes the city rather than the
// property. A 97m² two-bedroom in Krtsanisi is not comparable to a 34m² studio
// in Gldani, and a report that says otherwise is worse than one that says it
// could not tell.
//
// So the envelope is derived from the subject: its district, its area within a
// tolerance, its transaction type, its property type. Every bound is computed
// from a seed field that was actually established, and the rationale names
// which one.
//
// WHY THE TOLERANCE IS PROPORTIONAL AND CLAMPED
//
// A fixed ±20m² is too wide for a 35m² studio and too narrow for a 400m²
// house. A pure percentage is too narrow at the small end — ±15% of 35m² is
// ±5m², which excludes genuinely similar flats. So it is a percentage with a
// floor and a ceiling, which behaves sensibly across the whole range.
//
// WHEN THE SUBJECT'S AREA IS UNKNOWN there is no area filter at all, and the
// envelope says so in `appliedFilters.unsupported` further down the pipeline.
// A guessed range around an unknown centre is not a smaller claim, it is a
// different one.

import type { ListingQuery, ListingPropertyType, ListingTransaction, Range } from '../adapters/portal/types.ts';
import type { ResearchSeed } from './seed.ts';

/** ±15% of the subject's area, never tighter than 10m², never wider than 60m². */
export const AREA_TOLERANCE_PCT = 0.15;
export const AREA_TOLERANCE_MIN_SQM = 10;
export const AREA_TOLERANCE_MAX_SQM = 60;

/** How far the bedroom count may differ and still be a comparable. */
export const BEDROOM_TOLERANCE = 1;

export function areaRangeFor(areaSqm: number | null): Range {
  if (areaSqm === null || !Number.isFinite(areaSqm) || areaSqm <= 0) {
    return { min: null, max: null };
  }
  const raw = areaSqm * AREA_TOLERANCE_PCT;
  const tolerance = Math.min(AREA_TOLERANCE_MAX_SQM, Math.max(AREA_TOLERANCE_MIN_SQM, raw));
  return {
    min: Math.max(1, Math.round(areaSqm - tolerance)),
    max: Math.round(areaSqm + tolerance),
  };
}

export function bedroomRangeFor(bedrooms: number | null): Range {
  if (bedrooms === null || !Number.isFinite(bedrooms) || bedrooms <= 0) {
    return { min: null, max: null };
  }
  return {
    min: Math.max(1, bedrooms - BEDROOM_TOLERANCE),
    max: bedrooms + BEDROOM_TOLERANCE,
  };
}

function propertyTypeFor(raw: string | null): ListingPropertyType {
  const value = String(raw ?? '').toUpperCase();
  if (!value) return 'ANY';
  if (/APARTMENT|FLAT|ბინა|КВАРТИР/i.test(value)) return 'APARTMENT';
  if (/HOUSE|VILLA|COTTAGE|სახლ|ДОМ/i.test(value)) return 'HOUSE';
  if (/LAND|PLOT|მიწ|УЧАСТОК|ЗЕМЛ/i.test(value)) return 'LAND';
  if (/COMMERCIAL|OFFICE|RETAIL|კომერ|КОММЕРЧ|ОФИС/i.test(value)) return 'COMMERCIAL';
  return 'ANY';
}

export interface EnvelopeOptions {
  /** Defaults to SALE: a Verify subject is a purchase decision by default. */
  transaction?: ListingTransaction;
  limit?: number;
  /** Deterministic id prefix so query ids are stable across a run. */
  idPrefix?: string;
}

/**
 * The primary envelope: same district, same property type, similar area.
 *
 * Bedrooms are a CLIENT-side narrowing on most portals, so they are carried on
 * the query but never assumed to be enforced — the adapter reports which of
 * them it could actually apply.
 */
export function buildComparableEnvelope(
  seed: ResearchSeed,
  options: EnvelopeOptions = {},
): ListingQuery | null {
  const city = seed.location.city?.value ?? null;
  if (!city) return null;

  const transaction =
    options.transaction ??
    (seed.property.transaction === 'RENT' ? 'RENT' : 'SALE');

  const area = areaRangeFor(seed.property.areaSqm?.value ?? null);
  const district = seed.location.district?.value ?? null;
  const subDistrict = seed.location.subDistrict?.value ?? null;

  // The bar from the seed: a city plus something that narrows it.
  if (!district && !subDistrict && area.min === null) return null;

  const reasons: string[] = [];
  if (subDistrict) reasons.push(`sub-district ${subDistrict} (${seed.location.subDistrict?.origin})`);
  else if (district) reasons.push(`district ${district} (${seed.location.district?.origin})`);
  else reasons.push(`city ${city}`);
  if (area.min !== null) {
    reasons.push(
      `area ${area.min}-${area.max}m² around the subject's ${seed.property.areaSqm?.value}m²`,
    );
  }
  const bedrooms = bedroomRangeFor(seed.property.bedrooms?.value ?? null);
  if (bedrooms.min !== null) reasons.push(`${bedrooms.min}-${bedrooms.max} bedrooms`);

  return {
    id: `${options.idPrefix ?? 'cmp'}:${transaction.toLowerCase()}:primary`,
    transaction,
    propertyType: propertyTypeFor(seed.property.propertyType?.value ?? null),
    countryCode: seed.location.countryCode?.value ?? 'GE',
    city,
    district,
    subDistrict,
    projectName: seed.project.name?.value ?? null,
    area,
    rooms: { min: null, max: null },
    bedrooms,
    floor: { min: null, max: null },
    price: { min: null, max: null },
    priceCurrency: null,
    languages: seed.languages,
    limit: options.limit ?? 40,
    rationale: `Comparable envelope for ${seed.subjectRef}: ${reasons.join('; ')}.`,
  };
}

/**
 * A deliberately wider second envelope, used ONLY when the primary one comes
 * back too thin to say anything.
 *
 * It drops the area bound and widens to the whole district, and it is marked
 * as such so the report can distinguish "five close comparables" from "five
 * loosely similar properties in the same district" — which are different
 * claims and must not be pooled silently.
 */
export function widenEnvelope(primary: ListingQuery): ListingQuery {
  return {
    ...primary,
    id: `${primary.id}:widened`,
    subDistrict: null,
    area: {
      min: primary.area.min === null ? null : Math.round(primary.area.min * 0.75),
      max: primary.area.max === null ? null : Math.round(primary.area.max * 1.25),
    },
    bedrooms: { min: null, max: null },
    rationale:
      `${primary.rationale} Widened because the primary envelope returned too few ` +
      'independent comparables to characterise the market.',
  };
}
