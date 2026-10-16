/*
 * MARKET SEGMENTATION — where a property sits in ITS OWN local market.
 *
 * PREMIUM / MIDDLE / ECONOMY is never an absolute price. A $2,500/m² flat is
 * premium in Varketili and middle in Vake, so a property is placed against the
 * distribution of asking price per square metre of comparable listings:
 *
 *   same transaction   SALE and RENT are separate markets, never mixed
 *   same type family   APARTMENT (incl. studio, penthouse) / HOUSE / COMMERCIAL / LAND
 *   same place         street → neighbourhood → district → city, the most local
 *                      level that holds at least `minComparables` comparables
 *   one currency       every price normalised to USD through an explicit
 *                      converter; a price with no known rate is EXCLUDED, never
 *                      converted at parity
 *
 * Every price here is an ASKING price from a listing. None of it is a
 * transaction price, and `basis.priceKind` says so on every result.
 *
 * Thin evidence is UNKNOWN, not a guess: when no level reaches the minimum,
 * or the subject itself has no price per m², the answer is UNKNOWN with the
 * reason.
 *
 * ONE SOURCE OF TRUTH. supabase/migrations/20261024100000_market_segmentation.sql
 * mirrors this logic in SQL (percentile_cont for thresholds, stddev_pop for
 * dispersion, the same place/street/type/transaction keys and the same
 * confidence formula). src/research-core/__tests__/marketSegmentation.test.mjs
 * pins the parity: both sides are tested on the same fixture numbers, and the
 * migration's default rule must equal DEFAULT_SEGMENT_RULES.
 *
 * Pure and runtime-neutral (no DOM, no Deno): the Find Buyers planner and the
 * edge functions can import it as well as the frontend.
 */

import { latinNameFor } from '../normalize/place.ts';
import type { CurrencyConverter } from '../normalize/currency.ts';

export type MarketSegment = 'PREMIUM' | 'MIDDLE' | 'ECONOMY' | 'UNKNOWN';
export type SegmentLevel = 'STREET' | 'NEIGHBORHOOD' | 'DISTRICT' | 'CITY';
export type SegmentConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type MarketTransaction = 'SALE' | 'RENT';
export type PropertyTypeFamily = 'APARTMENT' | 'HOUSE' | 'COMMERCIAL' | 'LAND' | 'OTHER';

export const SEGMENT_LEVELS: readonly SegmentLevel[] = ['STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY'];

export interface SegmentRules {
  /** Smallest comparable sample a level must hold before it is used. */
  minComparables: number;
  /** At or above this percentile of the local ppsqm distribution → PREMIUM. 0..1 */
  premiumPercentile: number;
  /** At or below this percentile → ECONOMY. 0..1 */
  economyPercentile: number;
  /** Levels tried, most local first. A level left out is never used. */
  levels: SegmentLevel[];
  /** Areas below this (m²) are treated as data errors and ignored. */
  minAreaSqm: number;
}

/**
 * The default rule. The migration seeds exactly these params as the one ACTIVE
 * rule (version 1); the parity test reads the SQL and fails if they drift.
 */
export const DEFAULT_SEGMENT_RULES: Readonly<SegmentRules> = Object.freeze({
  minComparables: 8,
  premiumPercentile: 0.7,
  economyPercentile: 0.3,
  levels: ['STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY'] as SegmentLevel[],
  minAreaSqm: 10,
});

/** A property or listing as segmentation reads it. Every field may be unknown. */
export interface MarketItem {
  id?: string | null;
  /** Source + listing id, used to drop the same advert seen twice. */
  dedupeKey?: string | null;
  transaction?: string | null;
  propertyType?: string | null;
  price?: number | null;
  currency?: string | null;
  areaSqm?: number | null;
  /** Stated price per m², used only when price or area is missing. */
  pricePerSqm?: number | null;
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  /** Street or full address line; the house number is ignored. */
  street?: string | null;
}

export interface SegmentThresholds {
  /** ppsqm (USD) at the economy percentile — at or below is ECONOMY. */
  economyMax: number;
  /** ppsqm (USD) at the premium percentile — at or above is PREMIUM. */
  premiumMin: number;
  median: number;
  currency: 'USD';
}

export interface LevelAttempt {
  level: SegmentLevel;
  key: string | null;
  sampleSize: number;
  sufficient: boolean;
}

export interface SegmentResult {
  segment: MarketSegment;
  /** 0..1 — sample size × dispersion × locality. 0 for UNKNOWN. */
  confidence: number;
  confidenceBand: SegmentConfidenceBand;
  level: SegmentLevel | null;
  sampleSize: number;
  /** Mid-rank percentile of the subject within the chosen pool, 0..1. */
  percentile: number | null;
  thresholds: SegmentThresholds | null;
  basis: {
    priceKind: 'ASKING';
    currency: 'USD';
    transaction: MarketTransaction | null;
    propertyType: PropertyTypeFamily | null;
    subjectPricePerSqmUsd: number | null;
    /** Coefficient of variation of the chosen pool. */
    dispersion: number | null;
    levelsTried: LevelAttempt[];
    excluded: { noRate: number; noPricePerSqm: number; duplicates: number; otherMarket: number };
    reason: string;
    rules: SegmentRules;
  };
}

/* ── keys (mirrored in SQL: market_* functions) ─────────────────────── */

const norm = (value: string | null | undefined) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** A place as one key across scripts: 'თბილისი', 'Tbilisi', 'тбилиси' → 'tbilisi'. */
export function placeKey(value: string | null | undefined): string | null {
  const n = norm(value);
  if (!n) return null;
  return latinNameFor(n) ?? n;
}

/*
 * Street words that say "this is a street" rather than which one. Kept short
 * and literal: a missed suffix costs a street-level match and nothing else.
 * Mirrored by public.market_street_key().
 */
const STREET_WORDS = new Set([
  'ქ', 'ქუჩა', 'გამზ', 'გამზირი', 'ჩიხი', 'შესახვევი',
  'st', 'str', 'street', 'ave', 'avenue', 'rd', 'road', 'lane',
  'ул', 'улица', 'пр', 'проспект', 'пер', 'переулок',
]);

/** A street name without its number, punctuation or "street" word. */
export function streetKey(value: string | null | undefined): string | null {
  const n = norm(value)
    .replace(/[0-9]+[a-zа-яა-ჰ]?/g, ' ')
    .replace(/[.,;:#№/\\()"'«»\-–—]+/g, ' ');
  const words = n.split(' ').filter((w) => w && !STREET_WORDS.has(w));
  return words.length ? words.join(' ') : null;
}

/** SALE and RENT are separate markets. BUY/INVESTMENT are sale markets. */
export function transactionKey(value: string | null | undefined): MarketTransaction | null {
  const v = norm(value).toUpperCase();
  if (['SALE', 'BUY', 'SELL', 'INVESTMENT', 'INVEST', 'PURCHASE'].includes(v)) return 'SALE';
  if (['RENT', 'LEASE', 'RENTAL', 'LONG_TERM_RENT'].includes(v)) return 'RENT';
  return null;
}

export function typeFamily(value: string | null | undefined): PropertyTypeFamily | null {
  const v = norm(value).toUpperCase();
  if (!v) return null;
  if (['APARTMENT', 'FLAT', 'STUDIO', 'PENTHOUSE', 'DUPLEX'].includes(v)) return 'APARTMENT';
  if (['HOUSE', 'VILLA', 'TOWNHOUSE', 'COTTAGE'].includes(v)) return 'HOUSE';
  if (['COMMERCIAL', 'OFFICE', 'RETAIL', 'SHOP', 'WAREHOUSE', 'HOTEL'].includes(v)) return 'COMMERCIAL';
  if (['LAND', 'PLOT'].includes(v)) return 'LAND';
  return 'OTHER';
}

/* ── numbers (mirrored in SQL: percentile_cont, stddev_pop) ─────────── */

/** Postgres percentile_cont: linear interpolation at p·(n−1). */
export function percentileCont(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mid-rank percentile: (below + ½·equal) / n. */
export function midRank(values: readonly number[], x: number): number {
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return values.length ? (below + equal / 2) / values.length : NaN;
}

/** Coefficient of variation with the population standard deviation. */
export function dispersion(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return NaN;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const LEVEL_WEIGHT: Record<SegmentLevel, number> = { STREET: 1, NEIGHBORHOOD: 0.95, DISTRICT: 0.85, CITY: 0.7 };

/**
 * Confidence from sample size, dispersion and locality — never from the
 * subject's own price.
 *   sample   min(1, n / (3·minComparables))
 *   spread   1 at CV ≤ 0.25, falling linearly to 0.4 at CV ≥ 0.75
 *   level    STREET 1 · NEIGHBORHOOD 0.95 · DISTRICT 0.85 · CITY 0.7
 * Rounded to 3 decimals. Mirrored by public.market_segment_confidence().
 */
export function segmentConfidence(n: number, cv: number, level: SegmentLevel, minComparables: number): number {
  const sample = Math.min(1, n / Math.max(1, 3 * minComparables));
  const c = Number.isFinite(cv) ? cv : 1;
  const spread = c <= 0.25 ? 1 : c >= 0.75 ? 0.4 : 1 - ((c - 0.25) / 0.5) * 0.6;
  return Math.round(sample * spread * LEVEL_WEIGHT[level] * 1000) / 1000;
}

export function confidenceBand(confidence: number): SegmentConfidenceBand {
  if (!(confidence > 0)) return 'NONE';
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.45) return 'MEDIUM';
  return 'LOW';
}

/* ── normalisation ──────────────────────────────────────────────────── */

function toUsd(amount: number, currency: string | null | undefined, converter?: CurrencyConverter | null): number | null {
  const code = String(currency ?? '').trim().toUpperCase() || 'USD';
  if (code === 'USD') return amount;
  if (!converter) return null;
  const converted = converter.convert(amount, code, 'USD');
  return converted ? converted.amount : null;
}

/** Asking price per m² in USD, or null when it cannot be known honestly. */
export function pricePerSqmUsd(
  item: MarketItem,
  rules: Pick<SegmentRules, 'minAreaSqm'> = DEFAULT_SEGMENT_RULES,
  converter?: CurrencyConverter | null,
): { value: number | null; noRate: boolean } {
  const price = Number(item.price);
  const area = Number(item.areaSqm);
  let local: number | null = null;
  if (Number.isFinite(price) && price > 0 && Number.isFinite(area) && area >= rules.minAreaSqm) local = price / area;
  else if (Number.isFinite(Number(item.pricePerSqm)) && Number(item.pricePerSqm) > 0) local = Number(item.pricePerSqm);
  if (local === null) return { value: null, noRate: false };
  const usd = toUsd(local, item.currency, converter);
  return usd === null ? { value: null, noRate: true } : { value: usd, noRate: false };
}

function levelKey(item: MarketItem, level: SegmentLevel): string | null {
  const city = placeKey(item.city);
  if (!city) return null;
  if (level === 'CITY') return city;
  if (level === 'DISTRICT') { const d = placeKey(item.district); return d ? `${city}|${d}` : null; }
  if (level === 'NEIGHBORHOOD') { const n = placeKey(item.neighborhood); return n ? `${city}|${n}` : null; }
  const s = streetKey(item.street);
  return s ? `${city}|${s}` : null;
}

function validateRules(input: Partial<SegmentRules> | null | undefined): SegmentRules {
  const r = { ...DEFAULT_SEGMENT_RULES, ...(input ?? {}) } as SegmentRules;
  const min = Math.max(3, Math.floor(Number(r.minComparables) || DEFAULT_SEGMENT_RULES.minComparables));
  let econ = Number(r.economyPercentile);
  let prem = Number(r.premiumPercentile);
  if (!(econ > 0 && econ < 1)) econ = DEFAULT_SEGMENT_RULES.economyPercentile;
  if (!(prem > 0 && prem < 1)) prem = DEFAULT_SEGMENT_RULES.premiumPercentile;
  if (econ >= prem) { econ = DEFAULT_SEGMENT_RULES.economyPercentile; prem = DEFAULT_SEGMENT_RULES.premiumPercentile; }
  const levels = (Array.isArray(r.levels) ? r.levels : DEFAULT_SEGMENT_RULES.levels)
    .filter((l): l is SegmentLevel => (SEGMENT_LEVELS as readonly string[]).includes(l));
  return {
    minComparables: min,
    economyPercentile: econ,
    premiumPercentile: prem,
    levels: SEGMENT_LEVELS.filter((l) => levels.includes(l)),
    minAreaSqm: Math.max(1, Number(r.minAreaSqm) || DEFAULT_SEGMENT_RULES.minAreaSqm),
  };
}

export { validateRules as normaliseSegmentRules };

/* ── the classifier ─────────────────────────────────────────────────── */

/**
 * Place `subject` in its local market.
 *
 * `comparables` may include the subject itself (dropped by id) and the same
 * advert twice (dropped by dedupeKey). Only comparables in the same
 * transaction market and type family, with a price per m² in USD, count.
 */
export function classifySegment(
  subject: MarketItem,
  comparables: readonly MarketItem[],
  rulesInput?: Partial<SegmentRules> | null,
  options: { converter?: CurrencyConverter | null } = {},
): SegmentResult {
  const rules = validateRules(rulesInput);
  const transaction = transactionKey(subject.transaction);
  const family = typeFamily(subject.propertyType);
  const subjectPpsqm = pricePerSqmUsd(subject, rules, options.converter);
  const excluded = { noRate: 0, noPricePerSqm: 0, duplicates: 0, otherMarket: 0 };

  const unknown = (reason: string, levelsTried: LevelAttempt[] = []): SegmentResult => ({
    segment: 'UNKNOWN', confidence: 0, confidenceBand: 'NONE', level: null, sampleSize: 0,
    percentile: null, thresholds: null,
    basis: {
      priceKind: 'ASKING', currency: 'USD', transaction, propertyType: family,
      subjectPricePerSqmUsd: subjectPpsqm.value, dispersion: null, levelsTried, excluded, reason, rules,
    },
  });

  if (!transaction) return unknown('NO_TRANSACTION');
  if (!family) return unknown('NO_PROPERTY_TYPE');
  if (subjectPpsqm.value === null) return unknown(subjectPpsqm.noRate ? 'SUBJECT_NO_FX_RATE' : 'SUBJECT_NO_PRICE_PER_SQM');
  if (!placeKey(subject.city)) return unknown('NO_CITY');

  /* The usable pool: same market, deduplicated, priced in USD. */
  const seen = new Set<string>();
  const pool: Array<{ item: MarketItem; ppsqm: number }> = [];
  for (const c of comparables) {
    if (subject.id && c.id && c.id === subject.id) continue;
    if (transactionKey(c.transaction) !== transaction || typeFamily(c.propertyType) !== family) {
      excluded.otherMarket += 1;
      continue;
    }
    const key = c.dedupeKey || (c.id ? `id:${c.id}` : null);
    if (key) {
      if (seen.has(key)) { excluded.duplicates += 1; continue; }
      seen.add(key);
    }
    const p = pricePerSqmUsd(c, rules, options.converter);
    if (p.value === null) {
      if (p.noRate) excluded.noRate += 1; else excluded.noPricePerSqm += 1;
      continue;
    }
    pool.push({ item: c, ppsqm: p.value });
  }

  const levelsTried: LevelAttempt[] = [];
  for (const level of rules.levels) {
    const key = levelKey(subject, level);
    if (!key) { levelsTried.push({ level, key: null, sampleSize: 0, sufficient: false }); continue; }
    const values = pool.filter((p) => levelKey(p.item, level) === key).map((p) => p.ppsqm).sort((a, b) => a - b);
    const sufficient = values.length >= rules.minComparables;
    levelsTried.push({ level, key, sampleSize: values.length, sufficient });
    if (!sufficient) continue;

    /* Rounded to cents, as the SQL mirror rounds its numeric percentile_cont. */
    const economyMax = round2(percentileCont(values, rules.economyPercentile));
    const premiumMin = round2(percentileCont(values, rules.premiumPercentile));
    const median = round2(percentileCont(values, 0.5));
    const x = subjectPpsqm.value;
    const segment: MarketSegment = x >= premiumMin ? 'PREMIUM' : x <= economyMax ? 'ECONOMY' : 'MIDDLE';
    /* Rounded to 3 decimals before it is used, exactly as the SQL mirror does. */
    const cv = Math.round(dispersion(values) * 1000) / 1000;
    const confidence = segmentConfidence(values.length, cv, level, rules.minComparables);
    return {
      segment,
      confidence,
      confidenceBand: confidenceBand(confidence),
      level,
      sampleSize: values.length,
      percentile: Math.round(midRank(values, x) * 1000) / 1000,
      thresholds: { economyMax, premiumMin, median, currency: 'USD' },
      basis: {
        priceKind: 'ASKING', currency: 'USD', transaction, propertyType: family,
        subjectPricePerSqmUsd: x, dispersion: cv, levelsTried, excluded,
        reason: 'CLASSIFIED', rules,
      },
    };
  }
  return unknown('INSUFFICIENT_COMPARABLES', levelsTried);
}

/* ── buyer compatibility ────────────────────────────────────────────── */

/**
 * A buyer's or tenant's DOCUMENTED requirement. Only what they stated: a
 * budget they typed, an area range they asked for. Nothing here is inferred
 * from behaviour, a mortgage calculation or a conversation, and the result
 * never describes the person — only which segments their stated budget can
 * reach.
 */
export interface BuyerRequirement {
  transaction?: string | null;
  propertyType?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  areaMin?: number | null;
  areaMax?: number | null;
}

export interface BuyerSegmentCompatibility {
  segments: Exclude<MarketSegment, 'UNKNOWN'>[];
  basis: 'PRICE_PER_SQM' | 'NONE';
  budgetConfirmed: boolean;
  /** The stated budget per m² interval, USD, when it could be formed. */
  pricePerSqmRange: { min: number; max: number | null } | null;
  reason: string;
}

/**
 * Which segments of a local market a stated budget overlaps. A buyer can be
 * compatible with several: a $200k ceiling for 60–100 m² reaches every
 * segment whose band intersects $0–3,333/m².
 *
 * Budget per m² uses the most generous honest reading of what they stated:
 * the lowest bound is budgetMin / areaMax and the highest is budgetMax /
 * areaMin (or budgetMax / areaMax when only a maximum area was given).
 * Without a stated budget or any stated area there is no basis and the answer
 * is empty, not a guess.
 */
export function buyerSegmentCompatibility(
  buyer: BuyerRequirement,
  thresholds: SegmentThresholds | null,
  options: { converter?: CurrencyConverter | null } = {},
): BuyerSegmentCompatibility {
  const none = (reason: string, budgetConfirmed = false): BuyerSegmentCompatibility =>
    ({ segments: [], basis: 'NONE', budgetConfirmed, pricePerSqmRange: null, reason });
  const max = Number(buyer.budgetMax);
  const min = Number(buyer.budgetMin);
  const hasMax = Number.isFinite(max) && max > 0;
  const hasMin = Number.isFinite(min) && min > 0;
  if (!hasMax && !hasMin) return none('NO_STATED_BUDGET');
  if (!thresholds) return none('NO_MARKET_BAND', true);
  const areaMin = Number(buyer.areaMin) > 0 ? Number(buyer.areaMin) : null;
  const areaMax = Number(buyer.areaMax) > 0 ? Number(buyer.areaMax) : null;
  if (!areaMin && !areaMax) return none('NO_STATED_AREA', true);

  const usd = (v: number) => toUsd(v, buyer.currency, options.converter);
  const maxUsd = hasMax ? usd(max) : null;
  const minUsd = hasMin ? usd(min) : null;
  if ((hasMax && maxUsd === null) || (hasMin && minUsd === null)) return none('BUDGET_NO_FX_RATE', true);

  const lo = minUsd !== null ? minUsd / (areaMax ?? areaMin!) : 0;
  const hi = maxUsd !== null ? maxUsd / (areaMin ?? areaMax!) : null;

  const segments: Exclude<MarketSegment, 'UNKNOWN'>[] = [];
  /* ECONOMY (−∞, economyMax] · MIDDLE (economyMax, premiumMin) · PREMIUM [premiumMin, ∞) */
  if (lo <= thresholds.economyMax) segments.push('ECONOMY');
  if ((hi === null || hi > thresholds.economyMax) && lo < thresholds.premiumMin) segments.push('MIDDLE');
  if (hi === null || hi >= thresholds.premiumMin) segments.push('PREMIUM');
  return {
    segments,
    basis: 'PRICE_PER_SQM',
    budgetConfirmed: true,
    pricePerSqmRange: { min: Math.round(lo), max: hi === null ? null : Math.round(hi) },
    reason: segments.length ? 'OVERLAP' : 'NO_OVERLAP',
  };
}
