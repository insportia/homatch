// HOMATCH RESEARCH CORE — a source configuration, driven as a real adapter.
//
// family.ts reads one page. This turns a PortalSourceConfig into a
// ListingPortalAdapter: something the market lane can register, hand a
// ListingQuery, and receive PortalListings from — over the shared, policy-
// enforced fetch path and nothing else.
//
// WHY THIS IS SEPARATE FROM ss-ge.ts
//
// ss-ge.ts expresses a QUERY: home.ss.ge honours cityIdList, subdistrictIds
// and area bounds server-side, so it asks a narrow question and gets twenty
// relevant answers. That is worth hand-writing and it stays hand-written.
//
// The three sources this drives publish no such query language that anyone
// has verified. So it does the honest thing available: read a collection page
// the site itself publishes, take the listing links off it, and read those.
// What it CANNOT do is claim a server-side filter it does not have —
// appliedFilters says every envelope constraint was applied client-side,
// because that is what happened, and a narrower result set that looks like a
// server filter would make a broad sweep look like a targeted one.
//
// TWO REQUESTS PER LISTING, AT MOST
//
// One collection page, then one detail page per candidate, bounded by the
// query's own limit. No pagination beyond what the caller asked for, no
// following of anything that is not a detail URL for THIS source, and every
// hop goes through AdapterContext.fetchDocument — the shared client with the
// SSRF allowlist, robots, the rate limiter, the breaker and the cache.
//
// A SOURCE WITH NO POLICY IS NOT FETCHED
//
// The registry in market/runtime.ts refuses any host without a SourcePolicy,
// so registering an adapter here is not enough to reach the network. That is
// deliberate: the policy is where the rate, the robots stance and the byte
// cap live, and an adapter that could bypass it would be an adapter that
// could hammer somebody.

import type { AdapterContext, AdapterOutcome } from '../../discovery/adapter.ts';
import { samePlace } from '../../normalize/place.ts';
import { toSqm } from '../../normalize/area.ts';
import type { NormalizedListing } from '../../parse/listing.ts';
import {
  extractListing,
  isDetailUrl,
  servableUrl,
  transactionFromUrl,
  type PortalSourceConfig,
} from './family.ts';
import type {
  AppliedFilters,
  ListingPortalAdapter,
  ListingQuery,
  ListingSearchResult,
  PortalListing,
} from './types.ts';

export const CONFIGURED_ADAPTER_VERSION = 'configured-portal-1.0.0';

export interface CollectionRoute {
  /** SALE or RENT, and the collection URL that lists it. */
  transaction: 'SALE' | 'RENT';
  url: string;
  /** What the site calls this property type on that page, when it separates. */
  propertyType?: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL';
  /**
   * The market this collection page covers, where a source covers more than
   * one.
   *
   * Absent means "this source has one market and this is it", which is true
   * of every Georgian site here. An international portal publishes a separate
   * collection page per country -- realting.com serves /georgia/property and
   * /montenegro/property -- and without this the adapter would answer a
   * Montenegro question with Georgian listings and the envelope would throw
   * every one of them away, reporting a working source as empty.
   *
   * ISO-3166 alpha-2, upper case, matching ListingQuery.countryCode.
   */
  countryCode?: string;
}

export interface ConfiguredAdapterOptions {
  config: PortalSourceConfig;
  /**
   * The collection pages this source publishes, read off the site rather than
   * constructed. A URL pattern guessed from another portal's shape is how an
   * adapter ends up fetching 404s politely.
   */
  routes: readonly CollectionRoute[];
  countries?: readonly string[];
}

export class ConfiguredPortalAdapter implements ListingPortalAdapter {
  readonly id: string;
  readonly sourceFamily: string;
  readonly countries: readonly string[];

  private readonly config: PortalSourceConfig;
  private readonly routes: readonly CollectionRoute[];

  constructor(options: ConfiguredAdapterOptions) {
    this.config = options.config;
    this.id = options.config.id;
    this.sourceFamily = options.config.host;
    this.countries = options.countries ?? [options.config.countryCode];
    this.routes = options.routes;
  }

  /**
   * Can this adapter express a useful question for this envelope?
   *
   * Only the market and the transaction, because those are the only two this
   * source's own collection pages distinguish. Claiming support for a
   * bedroom envelope it cannot ask about would make a broad sweep look
   * targeted.
   */
  supports(query: ListingQuery): boolean {
    if (!this.countries.includes(String(query.countryCode ?? '').toUpperCase())) return false;
    return this.routeFor(query) !== null;
  }

  /**
   * The collection page that answers THIS question, or null.
   *
   * A route with no countryCode serves every market the adapter claims --
   * true of a single-market source. A route that names one serves only that
   * market, so a portal covering eleven countries cannot answer a question
   * about a twelfth just because it has a sale page somewhere.
   */
  private routeFor(query: ListingQuery): CollectionRoute | null {
    const country = String(query.countryCode ?? '').toUpperCase();
    return this.routes.find((route) =>
      route.transaction === query.transaction
      && (!route.countryCode || route.countryCode.toUpperCase() === country)) ?? null;
  }

  handles(url: string): boolean {
    return isDetailUrl(url, this.config);
  }

  canonicalize(url: string): string | null {
    /*
     * The canonical form is the URL WITHOUT its query string and fragment.
     * The identity is the listing id inside the path; a tracking parameter
     * appended by a referrer must not make the same listing a second entity.
     */
    if (!isDetailUrl(url, this.config)) return null;
    try {
      const parsed = new URL(url);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  async searchListings(
    query: ListingQuery,
    context: AdapterContext,
  ): Promise<AdapterOutcome<ListingSearchResult>> {
    const route = this.routeFor(query);
    if (!route) {
      return {
        ok: false,
        reason: 'CAPABILITY_NOT_SUPPORTED',
        detail:
          `${this.id} publishes no ${query.transaction} collection page for `
          + `${query.countryCode ?? 'that market'}`,
      };
    }

    let networkRequests = 0;

    let collection;
    try {
      collection = await context.fetchDocument(route.url);
      networkRequests += 1;
    } catch (error) {
      return { ok: false, reason: 'NETWORK_ERROR', detail: message(error) };
    }

    if (collection.status >= 400) {
      /*
       * A refusal is reported as a refusal. An empty result here would read
       * as "this portal has no inventory", which is a false statement about
       * a market rather than a true one about a request.
       */
      return {
        ok: false,
        reason: collection.status === 403 || collection.status === 401 ? 'BLOCKED' : 'NOT_FOUND',
        detail: `collection page answered HTTP ${collection.status}`,
      };
    }

    /*
     * TWO WAYS A COLLECTION PAGE NAMES ITS LISTINGS.
     *
     * Anchors are the usual one. makler.ge does something better: it
     * publishes a schema.org ItemList with every listing's url and a
     * numberOfItems, and its grid carries no <a href> to a listing at all --
     * 375KB of markup, 46 mentions of /ad/, zero anchors. Scraping hrefs
     * found nothing and would have written the source off.
     *
     * The ItemList is preferred where present: it is the site stating its
     * own listing URLs deliberately, rather than us inferring them from
     * layout. Anchors remain the fallback, and a source that offers both
     * gets the union.
     */
    const fromList = itemListUrls(collection.body, route.url, this.config);
    const fromAnchors = detailLinks(collection.body, route.url, this.config);
    const candidates = [...new Set([...fromList, ...fromAnchors])];
    if (candidates.length === 0) {
      /*
       * The collection page answered and carried no listing links. That is a
       * PARSE failure, not an empty market: the page exists, we could not
       * read it, and the difference decides whether a source is marked
       * DEGRADED or simply quiet.
       */
      return {
        ok: false,
        reason: 'PARSE_FAILED',
        detail: 'the collection page carried no recognisable listing links',
      };
    }

    const limit = Math.max(1, Math.min(query.limit ?? 10, 25));
    const wanted = candidates.slice(0, limit);
    const listings: PortalListing[] = [];
    const failures: string[] = [];
    /*
     * Kept apart from `failures` on purpose. A listing dropped because it is
     * in another city is not a listing this adapter could not read, and
     * folding the two together would make a working source look broken.
     */
    const outsideEnvelope: string[] = [];
    /*
     * Union across the listings actually returned. One kept listing that
     * never stated its bedroom count is enough to make "bedrooms was applied"
     * false for the set the caller receives.
     */
    const unevaluated = new Set<string>();

    for (const url of wanted) {
      let detail;
      try {
        detail = await context.fetchDocument(url);
        networkRequests += 1;
      } catch (error) {
        failures.push(`${url}: ${message(error)}`);
        continue;
      }
      if (detail.status >= 400) { failures.push(`${url}: HTTP ${detail.status}`); continue; }

      const extracted = extractListing(detail.body, detail.url || url, this.config);
      if (!extracted.ok || !extracted.listing) { failures.push(`${url}: ${extracted.reason}`); continue; }

      const verdict = withinEnvelope(query, extracted.listing);
      if (!verdict.keep) { outsideEnvelope.push(`${url}: ${verdict.reason}`); continue; }
      for (const constraint of verdict.unevaluated) unevaluated.add(constraint);

      const transaction = transactionFromUrl(url, this.config) ?? route.transaction;

      listings.push({
        portalId: this.id,
        sourceFamily: this.sourceFamily,
        externalId: extracted.listing.listingId,
        url: this.canonicalize(detail.url || url) ?? url,
        listing: extracted.listing,
        priceBasis: transaction === 'RENT' ? this.config.rentBasis : this.config.saleBasis,
        retrievedAt: detail.retrievedAt,
        via: detail.via,
        queryId: query.id,
        matchRationale:
          `listed on ${this.config.host}'s own ${transaction.toLowerCase()} collection page`,
      });
    }

    if (listings.length === 0 && failures.length > 0) {
      return {
        ok: false,
        reason: 'PARSE_FAILED',
        detail: `no listing on ${this.config.host} could be read: ${failures.slice(0, 3).join('; ')}`,
      };
    }

    /*
     * Every listing was read and none of them matched the envelope. That is a
     * true empty answer, not a failure: the listings this collection page
     * published are somewhere else, or some other kind of property. Reporting
     * it as PARSE_FAILED would mark a working source DEGRADED for answering
     * honestly; returning the unfiltered set would answer a question nobody
     * asked. The count travels so the caller can tell the two apart.
     */

    return {
      ok: true,
      value: {
        listings,
        /*
         * NULL unless the SOURCE stated it, and a guess never.
         *
         * Most of these sources publish no total, and a number invented here
         * would become a market size in a report. makler.ge does publish one
         * -- schema.org ItemList carries numberOfItems, 1056 for apartments
         * for sale in Tbilisi -- so for that source this is a real figure
         * with a provenance, and for the others it stays null.
         *
         * It is NOT the number of listings returned, and it is not a
         * denominator for coverage. It is what one collection page said its
         * category contains.
         */
        totalAvailable: itemListTotal(collection.body),
        truncated: candidates.length > wanted.length,
        appliedFilters: appliedFilters(query, unevaluated, Boolean(route.countryCode)),
        /*
         * How many readable listings the envelope removed. A sweep that found
         * forty and kept two is a different event from one that found two,
         * and without this number they report identically.
         */
        rejectedByEnvelope: outsideEnvelope.length,
        pagesFetched: 1,
        networkRequests,
      },
    };
  }
}

interface EnvelopeVerdict {
  keep: boolean;
  reason: string | null;
  /**
   * Constraints that could not be evaluated for THIS listing, because the
   * listing does not state the field — or, for price, states it in another
   * currency.
   *
   * This is what makes appliedFilters a statement about the returned set
   * rather than about the code path. A caller reading `client: ['bedrooms']`
   * is entitled to believe every listing it got back satisfies the bedroom
   * constraint. If one of them simply never said how many bedrooms it has,
   * that belief is false, and the honest place for the constraint is
   * `unsupported` — the envelope really was wider than requested.
   */
  unevaluated: string[];
}

/**
 * The client-side filter, ACTUALLY APPLIED.
 *
 * The first version of this file declared city as client-applied and never
 * applied it. A Tbilisi query came back with a flat in Chakvi -- 300km away,
 * on the Black Sea -- and appliedFilters reported the city as handled. A
 * filter claimed and not run is worse than one declared unsupported, because
 * the report says the envelope was honoured and what reaches the customer is
 * a comparable from another market.
 *
 * ABSENCE IS NOT A MISMATCH. A listing that does not STATE a city is kept.
 * Dropping it would narrow a result set on the strength of a field the source
 * never published, which is the same error facing the other way: inventing a
 * disqualifying fact out of silence.
 */
function withinEnvelope(query: ListingQuery, listing: NormalizedListing): EnvelopeVerdict {
  const unevaluated: string[] = [];
  const reject = (reason: string): EnvelopeVerdict => ({ keep: false, reason, unevaluated });

  if (query.propertyType !== 'ANY') {
    if (!listing.propertyType) unevaluated.push('propertyType');
    else if (listing.propertyType !== query.propertyType) {
      return reject(`propertyType ${listing.propertyType} is not ${query.propertyType}`);
    }
  }

  if (query.city) {
    if (!listing.city) unevaluated.push('city');
    else if (!samePlace(listing.city, query.city)) {
      return reject(`city ${listing.city} is not ${query.city}`);
    }
  }

  if (query.district) {
    if (!listing.district) unevaluated.push('district');
    else if (!samePlace(listing.district, query.district)) {
      return reject(`district ${listing.district} is not ${query.district}`);
    }
  }

  /*
   * Converted to sqm before comparing. A source publishing hectares against
   * an envelope in square metres would otherwise reject every plot it has, or
   * keep every one, depending which way the numbers happened to fall.
   */
  if (constrains(query.area)) {
    if (!listing.area) unevaluated.push('area');
    else if (outsideRange(toSqm(listing.area), query.area)) {
      return reject(`area ${toSqm(listing.area)}sqm is outside the envelope`);
    }
  }

  if (constrains(query.bedrooms)) {
    if (listing.bedrooms === null) unevaluated.push('bedrooms');
    else if (outsideRange(listing.bedrooms, query.bedrooms)) {
      return reject(`${listing.bedrooms} bedrooms is outside the envelope`);
    }
  }

  /*
   * Price is compared ONLY in the currency the envelope asked in. These
   * portals quote USD and GEL on the same page and no rate is carried here;
   * converting one to the other with a number invented at read time would put
   * a fabricated exchange rate inside a filter decision, where nothing
   * downstream could ever see it. A different currency, or none stated, means
   * the constraint did not apply to this listing -- and appliedFilters says
   * so for the sweep.
   */
  if (constrains(query.price)) {
    const money = query.transaction === 'RENT' ? listing.rent : listing.sale;
    if (!money || !query.priceCurrency || money.currency !== query.priceCurrency) {
      unevaluated.push('price');
    } else if (outsideRange(money.amount, query.price)) {
      return reject(`${money.amount} ${money.currency} is outside the envelope`);
    }
  }

  return { keep: true, reason: null, unevaluated };
}

/** True when a range actually narrows anything. An open window is not a filter. */
function constrains(range: { min: number | null; max: number | null } | null): boolean {
  return Boolean(range) && (range!.min !== null || range!.max !== null);
}

function outsideRange(value: number, range: { min: number | null; max: number | null } | null): boolean {
  if (!range) return false;
  if (range.min !== null && value < range.min) return true;
  if (range.max !== null && value > range.max) return true;
  return false;
}

/*
 * TWO SPELLINGS OF ONE PLACE -- see normalize/place.ts.
 *
 * This file used to carry its own alias table. There are now two callers
 * that have to agree about whether "\u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8" and "Tbilisi" are one
 * city: this filter, which decides whether a listing answers a query, and
 * the entity resolver, which decides whether two listings are one property.
 * Two tables would have drifted, and the drift would show up as a filter
 * that keeps a listing which the resolver then refuses to match.
 */

/**
 * What this adapter did with each constraint, for the listings it is
 * returning.
 *
 * `server` holds only what the PORTAL enforced: these collection pages
 * separate sale from rent by URL and nothing else anyone has verified.
 *
 * `client` holds constraints withinEnvelope evaluated against EVERY returned
 * listing. A constraint that one of them could not be judged on -- no stated
 * bedroom count, a price in another currency -- moves to `unsupported`, even
 * though it removed other listings. That is the stricter reading and the
 * right one: the caller's question is "is everything I got back inside my
 * envelope", and the answer there is no.
 *
 * Nothing is listed in `client` that is not applied in withinEnvelope, and a
 * test drives a violating listing through every name on the list.
 */
function appliedFilters(
  query: ListingQuery,
  unevaluated: ReadonlySet<string>,
  countryScoped: boolean,
): AppliedFilters {
  /*
   * THREE LISTS, NOT A MAP PER CONSTRAINT. Read off the AppliedFilters
   * declaration rather than invented -- an earlier version of this function
   * returned a per-field map through a cast, which type-checked and would
   * have reached the report as an object nothing knew how to read.
   */
  const client: string[] = [];
  const unsupported: string[] = [];

  /*
   * Sale and rent are different URLs, so the portal really did enforce it.
   *
   * On an international source the COUNTRY is enforced the same way -- the
   * collection page for Georgia is a different URL from the one for
   * Montenegro -- and that is a genuine server-side narrowing rather than
   * something this adapter did afterwards. Claiming it only where a route
   * actually names a country keeps the distinction honest.
   */
  const server = ['transaction'];
  if (countryScoped) server.push('countryCode');

  const record = (constraint: string) => {
    if (unevaluated.has(constraint)) unsupported.push(constraint);
    else client.push(constraint);
  };

  if (query.propertyType !== 'ANY') record('propertyType');
  if (query.city) record('city');
  if (query.district) record('district');
  if (query.area && (query.area.min !== null || query.area.max !== null)) record('area');
  if (query.bedrooms && (query.bedrooms.min !== null || query.bedrooms.max !== null)) record('bedrooms');

  /*
   * Price needs a currency on BOTH sides. An envelope that names none cannot
   * be compared against anything, and the OpenGraph sources in this family
   * publish listings carrying no price at all -- so this is frequently, and
   * correctly, unsupported.
   */
  if (query.price && (query.price.min !== null || query.price.max !== null)) {
    if (query.priceCurrency) record('price');
    else unsupported.push('price');
  }

  /*
   * Constraints this family cannot express at all. Stated rather than
   * omitted: a caller reading appliedFilters is entitled to learn that its
   * envelope was widened, and silence reads as agreement.
   */
  if (query.subDistrict) unsupported.push('subDistrict');
  if (query.projectName) unsupported.push('projectName');
  if (query.rooms && (query.rooms.min !== null || query.rooms.max !== null)) unsupported.push('rooms');
  if (query.floor && (query.floor.min !== null || query.floor.max !== null)) unsupported.push('floor');

  return { server, client, unsupported };
}

/**
 * Listing URLs a collection page publishes as a schema.org ItemList.
 *
 * Only URLs this source recognises as its own detail pages: an ItemList can
 * legitimately contain breadcrumbs, categories or related searches, and
 * isDetailUrl is what separates a listing from a link to one.
 */
export function itemListUrls(html: string, base: string, config: PortalSourceConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of jsonLdBlocks(html)) {
    const items = (node as { itemListElement?: unknown }).itemListElement;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const raw = (item as { url?: unknown })?.url;
      if (typeof raw !== 'string') continue;
      let absolute: string;
      try {
        const url = new URL(raw, base);
        url.search = '';
        url.hash = '';
        absolute = url.toString().replace(/\/$/, '');
      } catch {
        continue;
      }
      if (!isDetailUrl(absolute, config)) continue;
      /* The URL the site SERVES, which is not always the one it publishes. */
      const servable = servableUrl(absolute, config);
      if (seen.has(servable)) continue;
      seen.add(servable);
      out.push(servable);
    }
  }
  return out;
}

/**
 * How many listings the collection page says its category holds.
 *
 * Read from ItemList.numberOfItems and nowhere else. A count of the items
 * present on the page would be the page size, not the total, and reporting
 * that as `totalAvailable` would make a first page look like a whole market.
 */
export function itemListTotal(html: string): number | null {
  for (const node of jsonLdBlocks(html)) {
    const raw = (node as { numberOfItems?: unknown }).numberOfItems;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

/** Parsed ld+json blocks. A malformed one is skipped, not fatal. */
function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const match of String(html).matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1].trim());
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && typeof node === 'object') out.push(node as Record<string, unknown>);
      }
    } catch { /* a site with one broken block still has the others */ }
  }
  return out;
}

/** Detail URLs for THIS source, in document order, de-duplicated. */
export function detailLinks(html: string, base: string, config: PortalSourceConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(html).matchAll(/href=["']([^"'#\s]+)["']/gi)) {
    let absolute: string;
    try {
      const url = new URL(match[1], base);
      url.search = '';
      url.hash = '';
      absolute = url.toString().replace(/\/$/, '');
    } catch {
      continue;
    }
    if (!isDetailUrl(absolute, config)) continue;
    const servable = servableUrl(absolute, config);
    if (seen.has(servable)) continue;
    seen.add(servable);
    out.push(servable);
  }
  return out;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
