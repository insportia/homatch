// HOMATCH RESEARCH CORE — the listing-portal adapter contract.
//
// The social adapters in ../meta-platform.ts answer "what are people saying".
// A property portal answers a different question — "what is on the market that
// resembles THIS property" — and the difference is not cosmetic. A portal has
// a query language: a city, a district, an area range, a transaction type. A
// portal that is asked the right question returns twenty relevant candidates
// in one request; the same portal asked "apartments Tbilisi" returns a hundred
// thousand and no comparables at all.
//
// So this contract is built around a ListingQuery — a comparable ENVELOPE
// derived from the subject property — rather than a text string.
//
// WHY A SEPARATE CONTRACT AND NOT A FIFTH CAPABILITY ON SourceAdapter
//
// SourceAdapter's scan() returns PublicSignal — a post, a comment, an
// utterance with a direction. A portal result is not an utterance. It is a
// structured listing with an area, a price basis and a floor, and forcing it
// through the signal shape would lose exactly the fields comparables are made
// of. Both contracts share AdapterContext, AdapterOutcome and AdapterFailure,
// so they share the fetch path, the failure vocabulary and the access states,
// and neither knows the other exists.
//
// WHAT AN ADAPTER MUST NOT DO
//
// Reach the network itself — it is handed a context whose fetchDocument is the
// shared policy-enforced client. Invent a field the page did not carry. Treat
// an asking price as a transaction price. Pool a rent with a sale. Compute a
// publication date from the time it happened to fetch the page.

import type { PriceBasis } from '../../core/types.ts';
import type { NormalizedListing } from '../../parse/listing.ts';
import type { ResearchLanguage } from '../../discovery/lexicon.ts';
import type { AdapterContext, AdapterOutcome } from '../../discovery/adapter.ts';

/** What kind of transaction the envelope is looking for. Never mixed. */
export type ListingTransaction = 'SALE' | 'RENT';

export type ListingPropertyType =
  | 'APARTMENT'
  | 'HOUSE'
  | 'COMMERCIAL'
  | 'LAND'
  | 'ANY';

/**
 * A numeric window with an explicit reason.
 *
 * The reason travels because "why was this a comparable" is a question the
 * report has to answer, and a bare pair of numbers cannot.
 */
export interface Range {
  min: number | null;
  max: number | null;
}

/**
 * The comparable envelope: a structured question a portal can actually answer.
 *
 * Every field is optional because every portal supports a different subset,
 * and an adapter that cannot express a constraint server-side must say so
 * (see `appliedFilters` / `clientFiltered` on the result) rather than silently
 * returning a wider set as though it were the answer.
 */
export interface ListingQuery {
  /** Stable id so every candidate can name the query that produced it. */
  id: string;
  transaction: ListingTransaction;
  propertyType: ListingPropertyType;
  countryCode: string;
  city: string | null;
  district: string | null;
  subDistrict: string | null;
  /** Free-text project/building name, when the subject belongs to one. */
  projectName: string | null;
  area: Range;
  rooms: Range;
  bedrooms: Range;
  floor: Range;
  price: Range;
  priceCurrency: string | null;
  languages: readonly ResearchLanguage[];
  /** Stop after this many normalized listings. */
  limit: number;
  /**
   * Operator- and report-facing: why this envelope was chosen. Carried into
   * every candidate so a reader can trace a comparable back to its reason.
   */
  rationale: string;
}

/** How a portal answered, per constraint. Honest about what it could not do. */
export interface AppliedFilters {
  /** Constraints the portal enforced server-side. */
  server: string[];
  /** Constraints this adapter had to apply after fetching. */
  client: string[];
  /** Constraints neither could apply. The envelope is wider than requested. */
  unsupported: string[];
}

/**
 * One listing a portal returned, with everything needed to trace it.
 *
 * `listing` is the canonical Homatch shape — the same NormalizedListing the
 * rest of the core already speaks — so nothing downstream learns a second
 * evidence model.
 */
export interface PortalListing {
  /** Adapter id, e.g. 'ss-ge'. */
  portalId: string;
  /** Source family for independence weighting, e.g. 'ss.ge'. */
  sourceFamily: string;
  /** The portal's own id for this listing, when it has one. */
  externalId: string | null;
  /** A real, openable listing URL. Never a search-results page. */
  url: string;
  listing: NormalizedListing;
  /** Which price basis this portal's numbers carry. Never inferred later. */
  priceBasis: PriceBasis;
  /** ISO time this was read. Distinct from the listing's publishedAt. */
  retrievedAt: string;
  via: 'http' | 'browser';
  /** ListingQuery.id that produced this candidate. */
  queryId: string;
  /** Why this candidate was considered relevant, in one line. */
  matchRationale: string;
}

export interface ListingSearchResult {
  listings: PortalListing[];
  /**
   * How many the portal said exist for this envelope, when it says so.
   *
   * Null means the portal did not report a total — which is different from
   * zero, and the report must not turn one into the other.
   */
  totalAvailable: number | null;
  /** True when the scan stopped at `limit` rather than at the end. */
  truncated: boolean;
  appliedFilters: AppliedFilters;
  /**
   * Readable listings this adapter dropped because they were outside the
   * envelope — a flat in another city, a house when the query asked for
   * apartments.
   *
   * Separate from a parse failure and separate from an empty market. A sweep
   * that read forty listings and kept two is a different event from one that
   * found two, and with only `listings.length` to go on the two report
   * identically. Optional because the hand-written adapters ask the portal a
   * narrow question and have nothing to reject.
   */
  rejectedByEnvelope?: number;
  pagesFetched: number;
  /** Real hops, for cost accounting and the external-request metric. */
  networkRequests: number;
}

export interface ListingPortalAdapter {
  /** Stable key used in source keys, metrics and the source registry. */
  readonly id: string;
  /** Registrable domain family, for source-independence weighting. */
  readonly sourceFamily: string;
  /** Markets this portal actually covers. ISO-3166 alpha-2, upper case. */
  readonly countries: readonly string[];
  /** True when this adapter can express a useful question for this envelope. */
  supports(query: ListingQuery): boolean;
  /** True when this adapter recognises a listing URL as its own. */
  handles(url: string): boolean;
  /** The identity form of a listing URL on this portal. */
  canonicalize(url: string): string | null;
  searchListings(
    query: ListingQuery,
    context: AdapterContext,
  ): Promise<AdapterOutcome<ListingSearchResult>>;
}

/**
 * The portals available to a run.
 *
 * Deliberately tiny. A new portal is a new file plus one `register` call, and
 * nothing in the market lane changes — which is the whole point of the
 * contract existing at all.
 */
export class PortalRegistry {
  private readonly adapters: ListingPortalAdapter[] = [];

  register(adapter: ListingPortalAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** Adapters that cover this market AND can express this envelope. */
  for(query: ListingQuery): ListingPortalAdapter[] {
    const country = query.countryCode.toUpperCase();
    return this.adapters.filter(
      (adapter) => adapter.countries.includes(country) && adapter.supports(query),
    );
  }

  forUrl(url: string): ListingPortalAdapter | null {
    return this.adapters.find((adapter) => adapter.handles(url)) ?? null;
  }

  all(): readonly ListingPortalAdapter[] {
    return this.adapters;
  }
}

/** Convenience for adapters: a range with neither bound is no constraint. */
export function isRangeOpen(range: Range): boolean {
  return range.min === null && range.max === null;
}

/** True when `value` sits inside the range. A null bound is unbounded. */
export function withinRange(range: Range, value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

export type { AdapterContext, AdapterOutcome };
