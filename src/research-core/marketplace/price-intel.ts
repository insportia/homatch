// HOMATCH MARKETPLACE SEARCH — price intelligence.
//
// Two different questions, kept apart:
//
//   ACROSS SOURCES  one property listed at several prices. Lowest, highest,
//                   difference, percentage, source count, when each was seen.
//                   Factual, never an accusation: a stale listing, an agency
//                   margin or a negotiated reduction all produce a spread.
//   AGAINST SIMILAR how a property's price per m² compares with comparable
//                   results IN THIS SEARCH. A small sample of current listings,
//                   never called "market value".

import type { NormalizedListing } from './normalize.ts';

export interface SourcePrice {
  listingId: string;
  source: string;
  priceUsd: number;
  observedAt: string;
  isLowest: boolean;
  isHighest: boolean;
}

export interface PriceDiscrepancy {
  lowestUsd: number;
  highestUsd: number;
  differenceUsd: number;
  /** (highest − lowest) / lowest, 4 decimals. */
  differencePct: number;
  sourceCount: number;
  listingCount: number;
  prices: SourcePrice[];
  /** A difference worth showing the customer. */
  significant: boolean;
}

/** Below this the "difference" is rounding between sources. */
export const SIGNIFICANT_PRICE_DIFFERENCE = 0.02;

export function priceDiscrepancy(listings: readonly NormalizedListing[]): PriceDiscrepancy | null {
  const priced = listings.filter((l) => l.priceUsd !== null && l.priceUsd > 0);
  if (priced.length < 2) return null;
  const amounts = priced.map((l) => l.priceUsd as number);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const sources = new Set(priced.map((l) => l.source));
  const differencePct = Math.round(((highest - lowest) / lowest) * 10000) / 10000;
  return {
    lowestUsd: lowest,
    highestUsd: highest,
    differenceUsd: highest - lowest,
    differencePct,
    sourceCount: sources.size,
    listingCount: priced.length,
    prices: priced
      .map((l) => ({ listingId: l.id, source: l.source, priceUsd: l.priceUsd as number, observedAt: l.observedAt, isLowest: l.priceUsd === lowest, isHighest: l.priceUsd === highest }))
      .sort((a, b) => a.priceUsd - b.priceUsd || a.listingId.localeCompare(b.listingId)),
    significant: sources.size >= 2 && differencePct >= SIGNIFICANT_PRICE_DIFFERENCE,
  };
}

export interface LocalComparison {
  comparableCount: number;
  medianPriceUsd: number | null;
  medianPricePerSqmUsd: number | null;
}

/** Fewer comparables than this and no comparison is stated at all. */
export const MIN_COMPARABLES = 5;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Statistics over this search's comparable properties (one representative price each). */
export function localComparison(items: ReadonlyArray<{ priceUsd: number | null; pricePerSqmUsd: number | null }>): LocalComparison {
  const prices = items.map((i) => i.priceUsd).filter((v): v is number => v !== null && v > 0);
  const ppsqm = items.map((i) => i.pricePerSqmUsd).filter((v): v is number => v !== null && v > 0);
  if (prices.length < MIN_COMPARABLES) return { comparableCount: prices.length, medianPriceUsd: null, medianPricePerSqmUsd: null };
  return {
    comparableCount: prices.length,
    medianPriceUsd: median(prices),
    medianPricePerSqmUsd: ppsqm.length >= MIN_COMPARABLES ? median(ppsqm) : null,
  };
}

/** Relative difference of a price per m² from the comparable median; null when not stated. */
export function vsComparable(pricePerSqmUsd: number | null, comparison: LocalComparison): number | null {
  if (pricePerSqmUsd === null || comparison.medianPricePerSqmUsd === null) return null;
  return Math.round(((pricePerSqmUsd - comparison.medianPricePerSqmUsd) / comparison.medianPricePerSqmUsd) * 1000) / 1000;
}
