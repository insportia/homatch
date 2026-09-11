// HOMATCH — a market is a place, not a property.
//
// Every verification has been buying the same knowledge again. The market
// stage sweeps five bands of listings, the deterministic layer turns them into
// a median and a range, the report quotes it, and then all of it is thrown
// away. The next flat in the same building starts from zero and pays for the
// same sweep — and that sweep is 45% of what a Verify costs, most of it web
// search at roughly $0.04 a call.
//
// But "what do flats cost in this project" is not a fact about one flat. It is
// a fact about a market segment, true for every flat in it until the market
// moves. This module makes that reusable.
//
// WHAT A SNAPSHOT IS
//
// The output of marketIntelligence.ts — median, band, tier, sample size,
// condition mix — stored against the SEGMENT it describes rather than the job
// that happened to compute it, with an explicit age and an explicit
// confidence.
//
// WHY A TABLE AND NOT THE FACT GRAPH. intelligence_facts holds one current
// value per (entity, key). A snapshot is an aggregate over many listings with
// a sample count, a spread and a confidence, keyed by a segment that is not an
// entity at all. Forcing it into the graph would flatten exactly the structure
// that makes it trustworthy.
//
// WHAT THIS DOES NOT DO
//
// It never invents a market. A snapshot is only ever written from comparables
// that were actually gathered, and a thin one says so through its confidence
// instead of pretending. And it is not a cache of asking prices: listing price
// and status stay volatile and are refreshed on their own clock, because a
// stale asking price presented as current is the error this product cannot
// make.

import type { MarketIntelligence, ComparableTier } from './marketIntelligence.ts';

/* ------------------------------------------------------------------ *
 * The segment a snapshot describes                                    *
 * ------------------------------------------------------------------ */

/**
 * How specific a snapshot is.
 *
 * Ordered narrowest first, and read in that order: a project-level answer is
 * better than a district-level one, and a district-level one is better than
 * nothing. The fallback chain is the whole point — an over-specific key that
 * never matches saves nothing.
 */
export const SNAPSHOT_SCOPES = ['PROJECT', 'MICRO_LOCATION', 'DISTRICT', 'CITY'] as const;
export type SnapshotScope = (typeof SNAPSHOT_SCOPES)[number];

/**
 * Room bands, because a 2-room and a 3-room flat are different markets and a
 * 2-room and a 2-room are not.
 *
 * Banded rather than exact: exact room counts fragment the segment until
 * nothing ever matches, and the price difference between 4 and 5 rooms is
 * smaller than the difference between 1 and 2.
 */
export type RoomBand = '1' | '2' | '3' | '4_PLUS' | 'UNKNOWN';

export function roomBandOf(rooms: unknown): RoomBand {
  const n = typeof rooms === 'number' ? rooms : Number(String(rooms ?? '').match(/\d+/)?.[0]);
  if (!Number.isFinite(n) || n <= 0) return 'UNKNOWN';
  if (n >= 4) return '4_PLUS';
  return String(Math.trunc(n)) as RoomBand;
}

export interface SegmentKey {
  scopeType: SnapshotScope;
  /** Project slug, district slug or city name — whatever the scope means. */
  scopeKey: string;
  propertyType: string;
  roomBand: RoomBand;
}

const slug = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The key a snapshot is stored and looked up under.
 *
 * Deliberately FOUR dimensions and not twelve. Every dimension added divides
 * the pool of properties that can share an answer, and with a segment nobody
 * else ever lands in, reuse is zero and the whole exercise is decorative.
 * Condition is handled inside the snapshot as a mix, and by the adjustment
 * layer, rather than splitting the segment in two.
 */
export function segmentKeyOf(s: SegmentKey): string | null {
  const scope = slug(s.scopeKey);
  if (!scope) return null;
  return [s.scopeType, scope, slug(s.propertyType) || 'residential', s.roomBand].join('|');
}

/**
 * The segments a property belongs to, narrowest first.
 *
 * A lookup walks this in order and takes the first usable answer, which is the
 * reuse hierarchy the mandate describes: project, then micro-location, then
 * district, then city.
 */
export function segmentsFor(p: {
  projectSlug?: string | null;
  microLocation?: string | null;
  district?: string | null;
  city?: string | null;
  propertyType?: string | null;
  rooms?: unknown;
}): SegmentKey[] {
  const propertyType = p.propertyType || 'RESIDENTIAL';
  const roomBand = roomBandOf(p.rooms);
  const out: SegmentKey[] = [];
  const add = (scopeType: SnapshotScope, scopeKey: unknown) => {
    const k = String(scopeKey ?? '').trim();
    if (k) out.push({ scopeType, scopeKey: k, propertyType, roomBand });
  };
  add('PROJECT', p.projectSlug);
  add('MICRO_LOCATION', p.microLocation);
  add('DISTRICT', p.district);
  add('CITY', p.city);
  return out;
}

/* ------------------------------------------------------------------ *
 * Confidence                                                          *
 * ------------------------------------------------------------------ */

export type SnapshotConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * How much a snapshot can be leaned on, computed rather than felt.
 *
 * Three levels, not a percentage. A number like "0.73 confident" implies a
 * precision this evidence does not have, and the decision it feeds is
 * three-way anyway: reuse it, top it up, or go and research properly.
 *
 * The deterministic layer already refuses to build an analysis from fewer than
 * two listings in a tier (MIN_FOR_BASIS), so that is the floor here too rather
 * than a second opinion about the same thing.
 */
export function confidenceOf(input: {
  usableCount: number;
  basis: ComparableTier | null | undefined;
  /** Distinct sources the listings came from. One portal is one opinion. */
  sourceCount?: number;
}): SnapshotConfidence {
  const usable = Math.max(0, Math.trunc(input.usableCount || 0));
  if (usable < 3) return 'LOW';

  /*
   * A band that actually describes THIS property. The deterministic layer's
   * tiers are SAME_PROJECT, SAME_STREET, SAME_DISTRICT, PEER_PROJECT and
   * WIDER_MARKET; the first two are the same building or the same street,
   * and a median built from those is a statement about this property. A
   * city-wide median is a statement about the city.
   */
  const narrow = input.basis === 'SAME_PROJECT' || input.basis === 'SAME_STREET';
  const sources = Math.max(1, Math.trunc(input.sourceCount ?? 1));

  // Five usable listings, from a band that actually describes this property,
  // out of more than one source.
  if (usable >= 5 && narrow && sources >= 2) return 'HIGH';
  return 'MEDIUM';
}

/* ------------------------------------------------------------------ *
 * Freshness                                                           *
 * ------------------------------------------------------------------ */

/**
 * How long a snapshot stays usable, by scope.
 *
 * Narrower scopes move faster: a single project's asking prices shift when one
 * developer changes a price list, while a whole city's median does not move in
 * a fortnight. These are starting points to be measured, not laws — they live
 * in one place so they can be changed without hunting through the pipeline.
 *
 * Deliberately far shorter than the listing-attribute policies and far longer
 * than the price/status policy, because a market range is a different kind of
 * thing from either.
 */
export const SNAPSHOT_MAX_AGE_HOURS: Record<SnapshotScope, number> = {
  PROJECT: 14 * 24,
  MICRO_LOCATION: 14 * 24,
  DISTRICT: 30 * 24,
  CITY: 30 * 24,
};

export function ageHours(since: string | null | undefined, now: number = Date.now()): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 3_600_000);
}

/* ------------------------------------------------------------------ *
 * The decision                                                        *
 * ------------------------------------------------------------------ */

/** A snapshot as the store returns it. */
export interface StoredSnapshot {
  scope_type: SnapshotScope;
  scope_key: string;
  property_type: string;
  room_band: string;
  currency: string;
  median_price_per_sqm: number | string;
  lower_price_per_sqm: number | string | null;
  upper_price_per_sqm: number | string | null;
  sample_count: number;
  usable_comparable_count: number;
  source_count: number | null;
  confidence: SnapshotConfidence;
  basis_tier: string | null;
  last_refreshed_at: string;
}

export type RefreshReason =
  | 'NO_SNAPSHOT'
  | 'STALE'
  | 'LOW_CONFIDENCE'
  | 'TOO_FEW_COMPARABLES'
  | 'PRICE_ANOMALY'
  | 'OUTSIDE_SEGMENT'
  | 'FORCED';

export interface MarketPlan {
  /** The snapshot to lean on, if one is usable. */
  snapshot: StoredSnapshot | null;
  /** Whether the market stage has to go and research. */
  refresh: boolean;
  /** Why. Recorded against the job and never shown to a customer. */
  reasons: RefreshReason[];
  /** Searches this stage should spend. Zero is a real answer. */
  searchBudget: number;
  summary: string;
}

/**
 * How far outside the known band a price has to be before it is worth
 * re-checking the band rather than the price.
 *
 * A property genuinely priced 40% above its market is the single most
 * valuable thing a report can tell a buyer, and it is also what a stale or
 * thin snapshot looks like from the inside. So an outlier buys a refresh: if
 * the market really has moved, we find out; if it has not, the anomaly is
 * confirmed against fresh evidence and the report is stronger for it.
 */
const ANOMALY_RATIO = 0.4;

export function priceIsAnomalous(
  subjectPricePerSqm: number | null | undefined,
  snapshot: Pick<StoredSnapshot, 'median_price_per_sqm'> | null | undefined
): boolean {
  /*
   * Number(null) is 0, not NaN — so a missing subject price would read as
   * infinitely below the market and trigger a refresh on every property whose
   * own asking price was never found. Absent is not zero.
   */
  if (subjectPricePerSqm == null || snapshot?.median_price_per_sqm == null) return false;
  const subject = Number(subjectPricePerSqm);
  const median = Number(snapshot.median_price_per_sqm);
  if (!Number.isFinite(subject) || subject <= 0) return false;
  if (!Number.isFinite(median) || median <= 0) return false;
  return Math.abs(subject - median) / median > ANOMALY_RATIO;
}

/**
 * Whether this verification has to buy market research, and how much.
 *
 * KNOWN INTELLIGENCE FIRST. A fresh, confident snapshot for a segment this
 * property actually belongs to means the market question is already answered,
 * and the honest budget is zero — not one "just to be safe", because a search
 * taken for reassurance costs the same as a search taken for a reason.
 *
 * Every other path states its reason, and the reason is stored, so a refresh
 * that repeatedly buys nothing can be found and stopped.
 */
export function planMarket(input: {
  snapshot: StoredSnapshot | null | undefined;
  subjectPricePerSqm?: number | null;
  /** Set when the property is not the kind of thing the segment describes. */
  outsideSegment?: boolean;
  forced?: boolean;
  now?: number;
}): MarketPlan {
  const reasons: RefreshReason[] = [];
  const snapshot = input.snapshot ?? null;
  const now = input.now ?? Date.now();

  if (input.forced) reasons.push('FORCED');
  if (input.outsideSegment) reasons.push('OUTSIDE_SEGMENT');

  if (!snapshot) {
    reasons.push('NO_SNAPSHOT');
    return {
      snapshot: null,
      refresh: true,
      reasons,
      searchBudget: 6,
      summary: 'no market snapshot for this segment; full research',
    };
  }

  const age = ageHours(snapshot.last_refreshed_at, now);
  const maxAge = SNAPSHOT_MAX_AGE_HOURS[snapshot.scope_type] ?? SNAPSHOT_MAX_AGE_HOURS.DISTRICT;
  // An unreadable timestamp is treated as stale. The safe direction.
  if (age === null || age > maxAge) reasons.push('STALE');
  if (snapshot.confidence === 'LOW') reasons.push('LOW_CONFIDENCE');
  if (Number(snapshot.usable_comparable_count) < 3) reasons.push('TOO_FEW_COMPARABLES');
  if (priceIsAnomalous(input.subjectPricePerSqm, snapshot)) reasons.push('PRICE_ANOMALY');

  if (!reasons.length) {
    return {
      snapshot,
      refresh: false,
      reasons,
      searchBudget: 0,
      summary: `reusing ${snapshot.scope_type} snapshot (${snapshot.confidence}, ${snapshot.usable_comparable_count} comparables, ${Math.round(age ?? 0)}h old)`,
    };
  }

  /*
   * A refresh with something to build on is a top-up, not a sweep. The
   * snapshot still supplies the band; the searching is for whatever the reason
   * says is missing.
   */
  const topUp = snapshot.confidence !== 'LOW' && !reasons.includes('NO_SNAPSHOT');
  return {
    snapshot,
    refresh: true,
    reasons,
    searchBudget: topUp ? 2 : 4,
    summary: `refreshing ${snapshot.scope_type} snapshot: ${reasons.join(', ').toLowerCase()}`,
  };
}

/* ------------------------------------------------------------------ *
 * Writing one                                                         *
 * ------------------------------------------------------------------ */

export interface SnapshotDraft {
  segment: SegmentKey;
  currency: string;
  medianPricePerSqm: number;
  lowerPricePerSqm: number | null;
  upperPricePerSqm: number | null;
  sampleCount: number;
  usableComparableCount: number;
  sourceCount: number;
  basisTier: string | null;
  confidence: SnapshotConfidence;
  refreshReason: RefreshReason | 'INITIAL';
}

/**
 * Turns a computed market analysis into something storable, or refuses.
 *
 * Refuses when there is nothing worth storing: no median, or too thin to be
 * worth reusing. A snapshot that would immediately read LOW and force a
 * refresh on the next run is not intelligence, it is a row.
 */
export function draftSnapshot(
  segment: SegmentKey,
  market: MarketIntelligence | null | undefined,
  opts: { sourceCount?: number; refreshReason?: RefreshReason | 'INITIAL' } = {}
): SnapshotDraft | null {
  if (!market) return null;
  const median = Number(market.median);
  if (!Number.isFinite(median) || median <= 0) return null;

  const usable = Math.max(0, Math.trunc(Number(market.basisCount) || 0));
  if (usable < 2) return null;

  const confidence = confidenceOf({
    usableCount: usable,
    basis: market.basis,
    sourceCount: opts.sourceCount,
  });

  return {
    segment,
    currency: market.currency || 'USD',
    medianPricePerSqm: median,
    lowerPricePerSqm: Number.isFinite(Number(market.min)) ? Number(market.min) : null,
    upperPricePerSqm: Number.isFinite(Number(market.max)) ? Number(market.max) : null,
    sampleCount: Math.max(0, Math.trunc(Number(market.count) || 0)),
    usableComparableCount: usable,
    sourceCount: Math.max(1, Math.trunc(opts.sourceCount ?? 1)),
    basisTier: market.basis ?? null,
    confidence,
    refreshReason: opts.refreshReason ?? 'INITIAL',
  };
}

/**
 * What the market stage is told when a snapshot answers the question.
 *
 * It still writes the market section — the report is built from its output, so
 * skipping the stage would empty a section the buyer reads. What changes is
 * that it is given the answer instead of being sent to find it.
 */
export function snapshotBrief(plan: MarketPlan): string {
  const s = plan.snapshot;
  if (!s || plan.refresh) return '';

  const band =
    s.lower_price_per_sqm && s.upper_price_per_sqm
      ? `${Number(s.lower_price_per_sqm).toFixed(0)}-${Number(s.upper_price_per_sqm).toFixed(0)}`
      : null;

  return [
    '',
    'MARKET RANGE ALREADY ESTABLISHED FOR THIS SEGMENT.',
    `Homatch has current market intelligence for this ${s.scope_type.toLowerCase().replace('_', '-')}:`,
    `  median ${Number(s.median_price_per_sqm).toFixed(0)} ${s.currency} per sqm` +
      (band ? `, observed range ${band}` : ''),
    `  based on ${s.usable_comparable_count} comparable listings, confidence ${s.confidence}`,
    '',
    'Use these figures. Do NOT search for comparables to rebuild this range —',
    'it was built from real listings and the arithmetic behind it is done in',
    'code, not here. Report the range, place the subject against it, and give',
    'the evidence-backed reasons for where it sits.',
    '',
    'If your own evidence CONTRADICTS this range — the subject is priced far',
    'outside it, or something you read says the market has moved — say so',
    'plainly and search to establish what is actually true. Being right',
    'outranks being cheap.',
  ].join('\n');
}
