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
import { extractListing, isDetailUrl, transactionFromUrl, type PortalSourceConfig } from './family.ts';
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
    return this.routes.some((route) => route.transaction === query.transaction);
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
    const route = this.routes.find((r) => r.transaction === query.transaction);
    if (!route) {
      return {
        ok: false,
        reason: 'CAPABILITY_NOT_SUPPORTED',
        detail: `${this.id} publishes no ${query.transaction} collection page`,
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

    const candidates = detailLinks(collection.body, route.url, this.config);
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

    if (listings.length === 0) {
      return {
        ok: false,
        reason: 'PARSE_FAILED',
        detail: `no listing on ${this.config.host} could be read: ${failures.slice(0, 3).join('; ')}`,
      };
    }

    return {
      ok: true,
      value: {
        listings,
        /*
         * NULL, not zero and not a guess. None of these sources states a
         * total for a collection page in a form anyone has verified, and a
         * number invented here would become a market size in a report.
         */
        totalAvailable: null,
        truncated: candidates.length > wanted.length,
        appliedFilters: clientSideOnly(query),
        pagesFetched: 1,
        networkRequests,
      },
    };
  }
}

/**
 * Every envelope constraint, declared as applied CLIENT-SIDE.
 *
 * These sources' collection pages separate sale from rent and nothing else
 * that has been verified. Declaring a server-side filter this adapter does
 * not have would make a broad sweep look like a targeted one, which is the
 * difference between twenty comparables and twenty arbitrary listings.
 */
function clientSideOnly(query: ListingQuery): AppliedFilters {
  /*
   * THREE LISTS, NOT A MAP PER CONSTRAINT. Read off the AppliedFilters
   * declaration rather than invented -- an earlier version of this function
   * returned a per-field map through a cast, which type-checked and would
   * have reached the report as an object nothing knew how to read.
   */
  const client: string[] = [];
  const unsupported: string[] = [];

  // The ONE thing these collection pages genuinely separate. Sale and rent
  // are different URLs, so the portal really did enforce it.
  const server = ['transaction'];

  // Applied here, after fetching, because that is where it happens.
  client.push('propertyType');
  if (query.city) client.push('city');
  if (query.district) client.push('district');
  if (query.area && (query.area.min !== null || query.area.max !== null)) client.push('area');
  if (query.bedrooms && (query.bedrooms.min !== null || query.bedrooms.max !== null)) client.push('bedrooms');

  /*
   * Price is UNSUPPORTED rather than client-side on the OpenGraph sources,
   * because those listings carry no price at all -- a constraint cannot be
   * applied to a field that is absent, and calling it client-applied would
   * claim a filter that never ran.
   */
  if (query.price && (query.price.min !== null || query.price.max !== null)) unsupported.push('price');

  return { server, client, unsupported };
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
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push(absolute);
  }
  return out;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
