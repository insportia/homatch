// HOMATCH RESEARCH CORE — what two sources disagreeing about one flat is worth.
//
// The resolver's job is to decide that three observations describe one
// property. This is what to DO with that, and the answer is not "average
// them". An average of three asking prices is a number no source published
// and a customer shown it could not be told where it came from.
//
// The disagreement IS the product. "The same flat is on three sources at
// $150,000, $162,000 and $155,000" is a thing a seller can act on — it says
// the market has not settled, and it says which agent is most optimistic.
// "$155,667" says nothing and cannot be checked.
//
// EVERY STATEMENT HERE IS A COUNT OR A COMPARISON OF REAL FIELDS
//
// Nothing is modelled, inferred or smoothed. A spread exists only when two
// observations state a price in the SAME currency; a staleness gap exists
// only when two state a last-seen date. Where the evidence is absent the
// statement is absent, which is why every field below is nullable and why
// none of them has a default.
//
// WHAT IT WILL NOT SAY
//
// Anything about a property that only one source published. One observation
// is not a disagreement, it is a listing, and dressing it up as "observed on
// 1 source" invites a reader to treat the number as a measurement of the
// market rather than of our coverage.

import type { ResolvableObservation } from './entity-resolution.ts';

/** An observation with the timestamps the store keeps alongside it. */
export interface ObservedListing extends ResolvableObservation {
  /** When this source was last seen saying this. */
  lastSeenAt?: string | null;
  /** When the source itself said it was published. */
  publishedAt?: string | null;
  /** Whether the source still carries it. */
  stillListed?: boolean | null;
}

export interface PriceSpread {
  currency: string;
  low: number;
  high: number;
  /** high - low, in the currency. The number a seller argues about. */
  absolute: number;
  /** As a fraction of the LOW price. Never of an average nobody published. */
  fraction: number;
  lowSource: string;
  highSource: string;
}

export interface FieldDisagreement {
  field: 'areaSqm' | 'rooms' | 'bedrooms' | 'district' | 'propertyType';
  /** Each distinct value, with the sources that stated it. */
  values: Array<{ value: string; sources: string[] }>;
}

export interface CrossSourceIntelligence {
  /** Distinct sources that published this property. Always >= 2 here. */
  sourceCount: number;
  observationCount: number;
  sources: string[];
  /** Null unless two sources priced it in the same currency. */
  priceSpread: PriceSpread | null;
  /** Null unless two sources carry a last-seen date. */
  freshnessGapDays: number | null;
  freshestSource: string | null;
  stalestSource: string | null;
  /** Sources that have stopped carrying it, where a source said so. */
  removedFrom: string[];
  /** Fields the sources do not agree on. Empty when they agree. */
  disagreements: FieldDisagreement[];
}

/**
 * What can honestly be said about one property seen on several sources.
 *
 * Returns null for fewer than two SOURCES — not fewer than two observations.
 * One source listing the same flat twice is a duplicate on that source, and
 * calling it corroboration would turn a data-quality problem into evidence.
 */
export function describeAcrossSources(
  observations: readonly ObservedListing[],
): CrossSourceIntelligence | null {
  const sources = [...new Set(observations.map((o) => o.adapterId).filter(Boolean))] as string[];
  if (sources.length < 2) return null;

  return {
    sourceCount: sources.length,
    observationCount: observations.length,
    sources: sources.sort(),
    priceSpread: spreadOf(observations),
    ...freshnessOf(observations),
    removedFrom: observations
      .filter((o) => o.stillListed === false)
      .map((o) => o.adapterId!)
      .filter(Boolean)
      .sort(),
    disagreements: disagreementsIn(observations),
  };
}

/**
 * The gap between the cheapest and dearest asking price.
 *
 * ONE CURRENCY ONLY. Two sources quoting 150,000 USD and 400,000 GEL are
 * quoting nearly the same price, and subtracting them would produce a
 * "spread" of 250,000 of nothing. Converting them would need a rate this
 * module does not have and must not invent — the same rule that stops the
 * envelope filter comparing across currencies.
 *
 * The fraction is of the LOW price, not of an average. An average of asking
 * prices is a number nobody published, and "18% above the cheapest listing"
 * is a sentence a person can check against the two listings.
 */
function spreadOf(observations: readonly ObservedListing[]): PriceSpread | null {
  const priced = observations.filter(
    (o) => typeof o.saleAmount === 'number' && o.saleAmount > 0 && o.saleCurrency && o.adapterId,
  );
  if (priced.length < 2) return null;

  /* Group by currency and take the largest group; a tie is not resolved
     because there is nothing to prefer between two equal-sized groups. */
  const byCurrency = new Map<string, ObservedListing[]>();
  for (const o of priced) {
    const key = String(o.saleCurrency).toUpperCase();
    byCurrency.set(key, [...(byCurrency.get(key) ?? []), o]);
  }
  let best: ObservedListing[] = [];
  let currency = '';
  for (const [key, group] of byCurrency) {
    if (group.length > best.length) { best = group; currency = key; }
  }
  if (best.length < 2) return null;

  /* Distinct SOURCES, or one source listing a flat twice at two prices looks
     like the market disagreeing with itself. */
  if (new Set(best.map((o) => o.adapterId)).size < 2) return null;

  const sorted = [...best].sort((a, b) => (a.saleAmount as number) - (b.saleAmount as number));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const lowAmount = low.saleAmount as number;
  const highAmount = high.saleAmount as number;
  if (highAmount === lowAmount) return null;

  return {
    currency,
    low: lowAmount,
    high: highAmount,
    absolute: Number((highAmount - lowAmount).toFixed(2)),
    fraction: Number(((highAmount - lowAmount) / lowAmount).toFixed(4)),
    lowSource: low.adapterId!,
    highSource: high.adapterId!,
  };
}

/**
 * How far apart the sources' last sightings are.
 *
 * "Source A updated today; source B is 18 days old" is a real statement about
 * which listing to trust. It needs two dates, and a source that has never
 * been seen contributes nothing rather than a zero.
 */
function freshnessOf(observations: readonly ObservedListing[]): {
  freshnessGapDays: number | null;
  freshestSource: string | null;
  stalestSource: string | null;
} {
  const dated = observations
    .filter((o) => o.lastSeenAt && o.adapterId)
    .map((o) => ({ source: o.adapterId!, at: Date.parse(o.lastSeenAt!) }))
    .filter((o) => Number.isFinite(o.at));
  if (dated.length < 2) {
    return { freshnessGapDays: null, freshestSource: null, stalestSource: null };
  }

  const sorted = [...dated].sort((a, b) => a.at - b.at);
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  /* Whole days. Hours between two scans is scheduling noise, not staleness. */
  const days = Math.floor((newest.at - oldest.at) / 86_400_000);
  return {
    freshnessGapDays: days,
    freshestSource: newest.source,
    stalestSource: oldest.source,
  };
}

/**
 * Fields on which the sources do not agree.
 *
 * Kept as the values each source stated, never reconciled. A flat described
 * as 89 m² by one portal and 87 m² by another is a fact about the portals,
 * and the resolver already decided those are close enough to be one property
 * — so this is not a contradiction to resolve, it is a difference to show.
 *
 * Absence is not disagreement. Two sources, one of which is silent, agree as
 * far as anybody can tell.
 */
/** One comparable field of an observation, by name, with the types kept. */
function valueOf(
  o: ObservedListing,
  field: FieldDisagreement['field'],
): string | number | null | undefined {
  switch (field) {
    case 'areaSqm': return o.areaSqm;
    case 'rooms': return o.rooms;
    case 'bedrooms': return o.bedrooms;
    case 'district': return o.district;
    case 'propertyType': return o.propertyType;
  }
}

function disagreementsIn(observations: readonly ObservedListing[]): FieldDisagreement[] {
  const fields: FieldDisagreement['field'][] =
    ['areaSqm', 'rooms', 'bedrooms', 'district', 'propertyType'];
  const out: FieldDisagreement[] = [];

  for (const field of fields) {
    const stated = new Map<string, Set<string>>();
    for (const o of observations) {
      /* Named access, not an index signature. A cast to Record<string,
         unknown> would let a typo in the field list compile and silently
         report no disagreement for a field nobody is reading. */
      const raw = valueOf(o, field);
      if (raw === null || raw === undefined || raw === '') continue;
      if (!o.adapterId) continue;
      const key = String(raw);
      stated.set(key, (stated.get(key) ?? new Set()).add(o.adapterId));
    }
    if (stated.size < 2) continue;

    out.push({
      field,
      values: [...stated.entries()]
        .map(([value, sources]) => ({ value, sources: [...sources].sort() }))
        .sort((a, b) => a.value.localeCompare(b.value)),
    });
  }
  return out;
}
