// HOMATCH FOR EXPATS — what a budget reaches, from what was actually observed.
//
// THE QUESTION THIS ANSWERS, AND THE ONE IT REFUSES TO
//
// It answers: at the price per square metre Homatch has actually observed in
// this district, how much floor area does $150,000 correspond to, and how
// confident is that reading?
//
// It does NOT answer: which apartments are for sale. Homatch's production
// inventory is one property row. A "what can I buy" screen that showed
// listings would have to invent them, and §84 forbids exactly that. So this
// engine deals only in observed price evidence and floor area, and the
// product says plainly that it is showing a market reading rather than a
// shop window.
//
// WHY A PROJECT READING IS NOT PRESENTED AS A DISTRICT AVERAGE
//
// The market snapshots production holds are PROJECT-scoped: 35 comparables
// around one Vake development, six around one in Krtsanisi. It is tempting
// to average them into "Vake: 2,580/m²" and print that as the district. It
// would be wrong twice over — snapshotStore.ts already refuses to blend
// scopes because "averaging a project median with a city median produces a
// number that describes nothing", and a reader would take a single
// development's asking prices for a whole district's market.
//
// So a reading carries its own `basis`, and the basis is rendered. A Vake
// reading says it comes from one project. That is a smaller claim than a
// district median and it is one the evidence actually supports.
//
// WHY THE ABSENT DISTRICTS ARE RETURNED RATHER THAN OMITTED
//
// Six of the eight Tbilisi districts have no reading at all. Dropping them
// from the result would leave a foreigner believing Homatch has looked at
// Vake and Krtsanisi and found the others wanting. They are returned with
// `availability: 'COVERAGE_GAP'`, which is a statement about our coverage
// and is rendered as one (§36).

import type { StoredSnapshot } from '../verify/intelligence/marketSnapshot.ts';
import type { Availability } from './types.ts';
import { EXPAT_DISTRICTS, districtMatches, type ExpatDistrict } from './geography.ts';

/**
 * A snapshot row plus the locality columns the store does not return.
 *
 * `findSnapshot` selects a narrow column list aimed at Verify's needs. FOR
 * EXPATS groups by district, so it needs `city` and `district` too. Rather
 * than widen Verify's query — which is its own product's contract — this
 * declares the shape FOR EXPATS reads, and the public RPC returns it.
 */
export interface LocatedSnapshot extends StoredSnapshot {
  city: string | null;
  district: string | null;
}

/** How directly a reading describes the place it is being shown under. */
export const READING_BASES = [
  /** The snapshot's own scope is this district. */
  'DISTRICT',
  /** A project inside the district. One development, not the district. */
  'PROJECT_IN_DISTRICT',
  /** The city as a whole, shown because the district has nothing. */
  'CITY',
] as const;
export type ReadingBasis = (typeof READING_BASES)[number];

export interface MarketReading {
  district: ExpatDistrict;
  availability: Availability;
  /** Null whenever availability is not ESTABLISHED. */
  pricePerSqm: {
    median: number;
    low: number;
    high: number;
    currency: string;
  } | null;
  basis: ReadingBasis | null;
  /** The snapshot's own scope key, so the reader can see what was measured. */
  scopeKey: string | null;
  sampleCount: number;
  sourceCount: number;
  confidence: string | null;
  observedAt: string | null;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The best reading for one district, from the snapshots handed in.
 *
 * Preference order is narrowest-honest-first: a snapshot whose own scope is
 * the district, then a project sitting inside it, then nothing. A city-wide
 * snapshot is deliberately NOT promoted into a district slot — a Tbilisi
 * median shown under "Vake" is the blend this file exists to refuse. City
 * readings are surfaced separately, as the city.
 *
 * Among several projects in one district the largest sample wins, not the
 * newest: six comparables read yesterday describe a market less well than
 * thirty-five read last week, and the reading carries its own date so the
 * reader can weigh the age themselves.
 */
export function readingForDistrict(
  district: ExpatDistrict,
  snapshots: readonly LocatedSnapshot[],
): MarketReading {
  const empty: MarketReading = {
    district,
    availability: 'COVERAGE_GAP',
    pricePerSqm: null,
    basis: null,
    scopeKey: null,
    sampleCount: 0,
    sourceCount: 0,
    confidence: null,
    observedAt: null,
  };

  const inDistrict = snapshots.filter((s) => districtMatches(district, s.district));
  if (inDistrict.length === 0) return empty;

  const ownScope = inDistrict.filter((s) => s.scope_type === 'DISTRICT');
  const pool = ownScope.length > 0 ? ownScope : inDistrict.filter((s) => s.scope_type === 'PROJECT');
  if (pool.length === 0) return empty;

  const best = pool.reduce((a, b) =>
    (b.usable_comparable_count ?? 0) > (a.usable_comparable_count ?? 0) ? b : a,
  );

  const median = num(best.median_price_per_sqm);
  if (median === null || median <= 0) return empty;

  const low = num(best.lower_price_per_sqm) ?? median;
  const high = num(best.upper_price_per_sqm) ?? median;

  return {
    district,
    availability: 'ESTABLISHED',
    pricePerSqm: { median, low, high, currency: best.currency },
    basis: ownScope.length > 0 ? 'DISTRICT' : 'PROJECT_IN_DISTRICT',
    scopeKey: best.scope_key,
    sampleCount: best.usable_comparable_count ?? best.sample_count ?? 0,
    sourceCount: best.source_count ?? 0,
    confidence: best.confidence ?? null,
    observedAt: best.last_refreshed_at ?? null,
  };
}

/**
 * Readings for every district of a city, gaps included.
 *
 * Districts WITH evidence come first, because a page whose first six rows
 * all say "not yet covered" buries the two that answer the question. Within
 * each group the original geographic order is kept, so the list does not
 * reshuffle as coverage grows.
 */
export function readingsForCity(
  cityKey: string,
  snapshots: readonly LocatedSnapshot[],
): MarketReading[] {
  const readings = EXPAT_DISTRICTS.filter((d) => d.cityKey === cityKey).map((d) =>
    readingForDistrict(d, snapshots),
  );
  const covered = readings.filter((r) => r.availability === 'ESTABLISHED');
  const gaps = readings.filter((r) => r.availability !== 'ESTABLISHED');
  return [...covered, ...gaps];
}

/* ── Budget → floor area ──────────────────────────────────────────────── */

export interface AffordabilityInput {
  budget: number;
  currency: string;
  reading: MarketReading;
  /**
   * The rate from the reading's currency into the budget's, when they
   * differ. Null means no conversion is available, and the answer is then
   * a coverage gap rather than a guess.
   */
  fxToBudgetCurrency?: number | null;
}

export interface Affordability {
  availability: Availability;
  /** Square metres the budget corresponds to, as a range. Null on a gap. */
  sqm: { low: number; high: number; typical: number } | null;
  /** The price/m² used, expressed in the budget's currency. */
  pricePerSqm: { median: number; low: number; high: number; currency: string } | null;
  reading: MarketReading;
}

/**
 * What the budget corresponds to in floor area.
 *
 * Note the inversion: the HIGH end of the area range comes from the LOW end
 * of the price range. Cheaper metres mean more of them. Getting this
 * backwards produces a plausible-looking result that is exactly wrong, so
 * the test suite pins it.
 *
 * This is purchase price against observed asking price per square metre. It
 * is not a valuation, it does not include transfer costs, notary fees,
 * renovation or furniture, and the product says so next to the number
 * rather than folding a guess at them into it.
 */
export function affordableArea(input: AffordabilityInput): Affordability {
  const { reading } = input;
  const gap: Affordability = {
    availability: reading.availability === 'ESTABLISHED' ? 'UNKNOWN' : reading.availability,
    sqm: null,
    pricePerSqm: null,
    reading,
  };

  if (reading.availability !== 'ESTABLISHED' || !reading.pricePerSqm) return gap;
  if (!Number.isFinite(input.budget) || input.budget <= 0) return gap;

  const p = reading.pricePerSqm;
  let rate = 1;
  if (p.currency !== input.currency) {
    const supplied = input.fxToBudgetCurrency;
    if (!supplied || !Number.isFinite(supplied) || supplied <= 0) {
      return { ...gap, availability: 'COVERAGE_GAP' };
    }
    rate = supplied;
  }

  const median = p.median * rate;
  const low = p.low * rate;
  const high = p.high * rate;
  if (median <= 0 || low <= 0 || high <= 0) return gap;

  return {
    availability: 'ESTABLISHED',
    sqm: {
      // Cheapest metres buy the most of them.
      high: input.budget / low,
      low: input.budget / high,
      typical: input.budget / median,
    },
    pricePerSqm: { median, low, high, currency: input.currency },
    reading,
  };
}

/**
 * A rough room count for an area, as an orientation aid only.
 *
 * Returns a BAND, never a number, and the bands are wide. Georgian listings
 * count rooms inclusive of the living room, floor areas include shared
 * walls, and the relationship between the two is loose enough that a precise
 * answer would be invented. A foreigner who has never seen a Tbilisi flat
 * needs "this is roughly a one or two bedroom", and nothing more exact is
 * available without looking at actual plans.
 */
export const AREA_BANDS = ['STUDIO', 'ONE_TWO', 'TWO_THREE', 'THREE_PLUS'] as const;
export type AreaBand = (typeof AREA_BANDS)[number];

export function areaBand(sqm: number): AreaBand | null {
  if (!Number.isFinite(sqm) || sqm <= 0) return null;
  if (sqm < 40) return 'STUDIO';
  if (sqm < 70) return 'ONE_TWO';
  if (sqm < 110) return 'TWO_THREE';
  return 'THREE_PLUS';
}

/**
 * Districts this budget reaches, ordered by how much area it buys.
 *
 * Coverage gaps are excluded here rather than sorted last: this list is
 * explicitly "where your money goes furthest", and a district we know
 * nothing about cannot be placed in that ordering at all. The gaps are
 * still shown by `readingsForCity`, on the coverage panel where they mean
 * something.
 */
export function rankByArea(
  budget: number,
  currency: string,
  readings: readonly MarketReading[],
  fx?: (from: string, to: string) => number | null,
): Affordability[] {
  return readings
    .map((reading) =>
      affordableArea({
        budget,
        currency,
        reading,
        fxToBudgetCurrency:
          reading.pricePerSqm && reading.pricePerSqm.currency !== currency && fx
            ? fx(reading.pricePerSqm.currency, currency)
            : null,
      }),
    )
    .filter((a) => a.availability === 'ESTABLISHED' && a.sqm !== null)
    .sort((a, b) => (b.sqm as { typical: number }).typical - (a.sqm as { typical: number }).typical);
}

/**
 * How many districts in this city Homatch can currently speak about.
 *
 * Shown next to the result so the reader can size the answer: two of eight
 * is a useful reading and a small one, and saying so is the difference
 * between evidence and a claim to completeness.
 */
export function coverage(readings: readonly MarketReading[]): {
  covered: number;
  total: number;
} {
  return {
    covered: readings.filter((r) => r.availability === 'ESTABLISHED').length,
    total: readings.length,
  };
}
