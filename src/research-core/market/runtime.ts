// HOMATCH RESEARCH CORE — assembling the portal fetch path.
//
// The adapters never touch the network. This is where the one path out is
// built: the SSRF boundary, the per-source policy, the rate limit, the circuit
// breaker, the cache and the coalescer, wired once and handed to every adapter
// as an AdapterContext.
//
// WHY FetchTransport IS ACCEPTABLE HERE AND NOT IN GENERAL
//
// FetchTransport cannot pin a connection to a validated address, so HttpClient
// normally refuses it. That refusal exists because a user-supplied URL can be
// made to resolve to a private address after validation. Nothing here fetches
// a user-supplied URL: the portal adapters address a fixed allowlist of
// operator-configured hosts, expressed as the source policies below, and the
// registry refuses any host without a policy. That is the precondition the
// transport's own comment names, stated at the call site rather than assumed.

import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { RequestCoalescer } from '../flow/coalescer.ts';
import { HttpClient } from '../fetch/http-client.ts';
import { FetchTransport } from '../fetch/fetch-transport.ts';
import type { Transport } from '../fetch/transport.ts';
import { NetworkPolicy } from '../net/network-policy.ts';
import { RobotsChecker, type RobotsFetcher } from '../net/robots.ts';
import {
  DEFAULT_SOURCE_POLICY,
  SourceAccessPolicyRegistry,
  type SourcePolicy,
} from '../net/source-policy.ts';
import type { AdapterContext, AdapterDocument } from '../discovery/adapter.ts';
import { PortalRegistry } from '../adapters/portal/types.ts';
import { SsGeAdapter, SS_GE_HOST } from '../adapters/portal/ss-ge.ts';
import { ConfiguredPortalAdapter } from '../adapters/portal/configured.ts';
import { HOME24_GE, PLACE_GE, REALTING, ZARAYA } from '../adapters/portal/sources.ts';

/**
 * Portals this build knows how to read.
 *
 * A source with no policy here is not fetched at all — the registry has no
 * silent default that would let an unreviewed host onto the network.
 */
export const PORTAL_SOURCE_POLICIES: SourcePolicy[] = [
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:ss.ge',
    domains: ['ss.ge'],
    hosts: [SS_GE_HOST],
    sourceFamily: 'ss.ge',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    // Deliberately gentle. A comparable sweep is six pages, not a crawl, and
    // the portal owes us nothing.
    rate: { concurrency: 2, requestsPerSecond: 1, burst: 2 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 4_000_000,
    timeoutMs: 12_000,
    // A listing market moves in days, not seconds. Ten minutes of reuse turns
    // fifty concurrent verifications of the same district into one fetch,
    // while staying far inside any reasonable notion of current.
    cacheTtlMs: 10 * 60 * 1000,
    cacheStaleMs: 30 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.55,
    notes:
      'home.ss.ge serves search results as JSON inside __NEXT_DATA__. robots.txt ' +
      'disallows only /ka/user, /en/user and /ru/user; listing and search paths ' +
      'are permitted. No browser, no session, no bypass.',
  },

  /*
   * THE THREE ADDED 2026-09-25, AFTER AN AUDIT AND A PROBE.
   *
   * scripts/audit-property-sources.mjs read each one's robots.txt with the
   * identifying User-Agent and found every listing path permitted;
   * scripts/probe-property-sources.mjs then established how each publishes
   * its data. Both ran before a line of adapter was written, which is the
   * order the survey note below this block asks for.
   *
   * Every rate here is deliberately slower than ss.ge's. These are smaller
   * operations than ss.ge and a first-contact sweep is not the moment to
   * find out where their limits are.
   */
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:home24.ge',
    domains: ['home24.ge'],
    hosts: ['www.home24.ge', 'home24.ge'],
    sourceFamily: 'home24.ge',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    rate: { concurrency: 1, requestsPerSecond: 0.5, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 4_000_000,
    timeoutMs: 15_000,
    cacheTtlMs: 10 * 60 * 1000,
    cacheStaleMs: 30 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.5,
    notes:
      'Publishes schema.org RealEstateListing, Offer, PostalAddress, PropertyValue ' +
      'and a QuantitativeValue in MTK on every detail page - the richest structured ' +
      'data of the eighteen sites audited. robots.txt permits every listing path.',
  },
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:place.ge',
    domains: ['place.ge'],
    hosts: ['place.ge', 'www.place.ge'],
    sourceFamily: 'place.ge',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    rate: { concurrency: 1, requestsPerSecond: 0.5, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 4_000_000,
    timeoutMs: 15_000,
    cacheTtlMs: 10 * 60 * 1000,
    cacheStaleMs: 30 * 60 * 1000,
    visibility: 'PUBLIC',
    // Lower than home24: OpenGraph only, so a listing from here carries an
    // id, a title and little else. Authority is what the source PUBLISHES,
    // not how much we like it.
    authority: 0.35,
    notes:
      'OpenGraph only - no ld+json and no microdata. A listing from here ' +
      'carries an id and a title, and deliberately no price: the site writes ' +
      'prices in several formats in running text and a pattern that guessed ' +
      'would produce a market figure that is not one.',
  },
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:realting.com',
    domains: ['realting.com'],
    hosts: ['realting.com', 'www.realting.com'],
    sourceFamily: 'realting.com',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    /*
     * ITS ROBOTS.TXT NAMES NO CRAWL-DELAY FOR US.
     *
     * It grants Crawl-delay: 0 to facebookexternalhit and states none for
     * `*`, so this number is OUR restraint rather than their instruction --
     * one request every five seconds, which is slower than they ask for
     * because they did not ask.
     *
     * What their robots.txt does say matters more: `Disallow: /*?` puts every
     * query-string URL off limits, with narrow Allow exceptions. Nothing here
     * fetches one -- canonicalize() strips the query string before the URL is
     * ever requested, which was written for identity reasons and turns out to
     * be the same rule.
     */
    rate: { concurrency: 1, requestsPerSecond: 0.2, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 4_000_000,
    timeoutMs: 20_000,
    cacheTtlMs: 30 * 60 * 1000,
    cacheStaleMs: 60 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.5,
    notes:
      'International portal: schema.org Apartment/Offer/PostalAddress on every '
      + 'detail page, so it needs no extraction rules. Sale and long-term rent '
      + 'only; its short-term-rental URLs are a nightly rate the model has no '
      + 'transaction for and the detail pattern does not match them.',
  },
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:zarayaproperties.com',
    domains: ['zarayaproperties.com'],
    hosts: ['www.zarayaproperties.com', 'zarayaproperties.com'],
    sourceFamily: 'zarayaproperties.com',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    // Its own robots.txt asks for Crawl-delay: 10. Honoured here rather than
    // discovered by being rate-limited.
    rate: { concurrency: 1, requestsPerSecond: 0.1, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 4_000_000,
    timeoutMs: 20_000,
    cacheTtlMs: 30 * 60 * 1000,
    cacheStaleMs: 60 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.4,
    notes:
      "A developer's own site. What it publishes is a DEVELOPER_PRICE, not a " +
      'resale asking price, and pooling the two produces a market statistic ' +
      'that is simply wrong. Publishes Crawl-delay: 10, honoured in the rate above.',
  },
];

export interface PortalRuntime {
  client: HttpClient;
  registry: PortalRegistry;
  context: AdapterContext;
  /** Cache/coalescing counters, for the honest metrics the report needs. */
  stats(): {
    coalescedJoins: number;
    coalescedExecutions: number;
    cacheHits: number;
    cacheMisses: number;
    networkRequests: number;
  };
}

export interface PortalRuntimeOptions {
  transport?: Transport;
  now?: () => number;
  /** Shared across a process so concurrent jobs actually join each other. */
  coalescer?: RequestCoalescer;
  documentCache?: Map<string, { document: AdapterDocument; expiresAt: number }>;
}

/**
 * One process-wide coalescer and document cache.
 *
 * The point of coalescing is that two verifications running at the same time
 * for the same district issue ONE request. That only happens if they share
 * this object, so it is module-level rather than per-call.
 */
/**
 * Identified, contactable, and honest about what it is.
 *
 * A research fetcher that disguises itself as a browser is the first step
 * toward the evasion this system does not do. This says who we are and points
 * at a page explaining it, which is what makes rate limiting and robots
 * compliance meaningful rather than decorative.
 */
export const PORTAL_USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

const sharedCoalescer = new RequestCoalescer();
const sharedDocuments = new Map<string, { document: AdapterDocument; expiresAt: number }>();

/** Every host any configured portal policy names. The network boundary. */
export function portalHostAllowlist(policies: SourcePolicy[] = PORTAL_SOURCE_POLICIES): string[] {
  const hosts = new Set<string>();
  for (const policy of policies) {
    for (const host of policy.hosts ?? []) hosts.add(host.toLowerCase());
    // A registrable domain is admitted as a suffix so a portal that moves
    // between `www.` and a bare host does not silently become unreachable.
    for (const domain of policy.domains) hosts.add(`.${domain.toLowerCase()}`);
  }
  return Array.from(hosts).sort();
}

export function createPortalRuntime(options: PortalRuntimeOptions = {}): PortalRuntime {
  const now = options.now ?? (() => Date.now());
  const sourcePolicies = new SourceAccessPolicyRegistry(PORTAL_SOURCE_POLICIES);
  const allowlist = portalHostAllowlist();
  const transport = options.transport ?? new FetchTransport({ maxBytes: 4_000_000, userAgent: PORTAL_USER_AGENT });

  /*
   * robots.txt is fetched through the same transport, never through a bare
   * `fetch`. It deliberately does NOT go through HttpClient: that would
   * recurse, because HttpClient consults robots before every request.
   *
   * A 4xx (no robots.txt) reads as "nothing is disallowed"; the checker's own
   * handling of a 5xx is to fail closed, which is why this returns the status
   * rather than swallowing it.
   */
  const robotsFetcher: RobotsFetcher = {
    async fetch(robotsUrl: string) {
      try {
        const response = await transport.send({
          url: robotsUrl,
          method: 'GET',
          headers: {},
          timeoutMs: 8_000,
        });
        return { status: response.status, body: response.body };
      } catch {
        return null;
      }
    },
  };

  const robots = new RobotsChecker({
    userAgent: PORTAL_USER_AGENT,
    fetcher: robotsFetcher,
    now,
  });

  const client = new HttpClient({
    transport,
    robots,
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 2, requestsPerSecond: 1 } }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy: new NetworkPolicy({
      /*
       * The allowlist IS the boundary, and it is derived from the policies
       * above so adding a portal cannot forget to extend it.
       *
       * hostAllowlistOnly is checked BEFORE any DNS work, so nothing outside
       * this list is contacted whatever it resolves to — including a literal
       * IP, which is not on the list and is therefore refused. DNS resolution
       * is then skipped because no resolver exists in every runtime this code
       * has to run in (`node:dns` is absent in Deno and the browser), and the
       * rule it would enforce — "a user-supplied hostname must not resolve
       * into the private range" — has nothing to protect here: no URL fetched
       * on this path comes from a user. It is a fixed set of public portals.
       */
      hostAllowlistOnly: allowlist,
      skipDnsResolution: true,
      allowedPorts: [80, 443],
    }),
    sourcePolicies,
    // See the header: the allowlist is what makes this safe, not the transport.
    requirePinningTransport: false,
    defaultTimeoutMs: 12_000,
  });

  const coalescer = options.coalescer ?? sharedCoalescer;
  const documents = options.documentCache ?? sharedDocuments;

  let cacheHits = 0;
  let cacheMisses = 0;
  let networkRequests = 0;

  const fetchDocument = async (
    url: string,
    fetchOptions?: { forceRefresh?: boolean },
  ): Promise<AdapterDocument> => {
    const policy = client.policyFor(url);
    const key = `portal:${url}`;

    if (!fetchOptions?.forceRefresh) {
      const cached = documents.get(key);
      if (cached && cached.expiresAt > now()) {
        cacheHits += 1;
        return cached.document;
      }
    }
    cacheMisses += 1;

    // Single-flight: concurrent callers for the same URL wait on one fetch
    // rather than each opening their own.
    return coalescer.run(key, async () => {
      const result = await client.fetch(url);
      networkRequests += result.networkRequests;
      const document: AdapterDocument = {
        url: result.finalUrl,
        status: result.status,
        body: result.body,
        contentType: result.contentType?.mime ?? null,
        retrievedAt: new Date(now()).toISOString(),
        via: 'http',
      };
      if (result.status >= 200 && result.status < 300) {
        documents.set(key, { document, expiresAt: now() + policy.cacheTtlMs });
      }
      return document;
    });
  };

  /*
   * THE PORTALS THE DETERMINISTIC MARKET LANE ACTUALLY QUERIES.
   *
   * One. Everything else that looks like portal support is URL CLASSIFICATION,
   * not discovery: PROPERTY_PORTAL_HOST_RE in research-agent recognises
   * myhome.ge, ss.ge, korter.ge, mymarket.ge, livo.ge and place.ge so a link
   * the model or web_search returns is filed correctly. None of them is
   * queried here; only ss.ge can be asked a question.
   *
   * SURVEYED 2026-09-20, WHILE LOOKING TO BROADEN MARKET COVERAGE:
   *
   *   korter.ge   robots.txt Disallows /api/, /pyapi/ and /node-api/ — the
   *               endpoints carrying the data. The rendered pages are a JS
   *               shell: the homepage returns 200 with no prices and no
   *               ld+json, and the obvious search paths 404. A compliant
   *               adapter therefore cannot read it over plain HTTP. It would
   *               need the browser lane, which is a different architecture and
   *               far larger than "a new file plus one register call".
   *   myhome.ge   not surveyed
   *   livo.ge     not surveyed
   *   place.ge    not surveyed
   *
   * SURVEYED 2026-09-25, choosing the second batch from the audited list:
   *
   *   brokeri.ge  4,006 listing URLs in its sitemap, so the inventory is real
   *               and permitted. No server-rendered collection page reaches
   *               them: /services/sale, /services/rent and /areas/vake each
   *               return ~30KB of marketing markup with ZERO listing links.
   *               korter.ge's category. It could only be read by fetching
   *               sitemap URLs one at a time, and a sitemap carries no city
   *               and no transaction -- 4,006 fetches to find the handful a
   *               campaign asked for, against a site that gains nothing from
   *               it. Not implemented, on those grounds rather than technical
   *               ones.
   *   realting.com  IMPLEMENTED. See REALTING in sources.ts.
   *
   * Recorded rather than acted on, deliberately. Adding an adapter here is
   * cheap by design — see the contract in adapters/portal/types.ts — but one
   * written against a guessed page shape cannot be verified without spending a
   * real research run, and an unverified scraper is worse than a single portal
   * that works. The next person to widen this starts from the survey above
   * instead of repeating it.
   */
  /*
   * FOUR NOW, AND THE SURVEY ABOVE IS WHY THREE OF THEM ARE HERE.
   *
   * The note above says an adapter written against a guessed page shape
   * cannot be verified without spending a real research run. So none of
   * these was guessed: each site's robots.txt was read, its structure
   * probed, and one real page captured as a fixture before the
   * configuration was written. korter.ge remains absent for exactly the
   * reason recorded above -- independently re-confirmed by the 2026-09-25
   * probe, which found the same JS shell.
   *
   * Registering an adapter is still not enough to reach the network: the
   * SourceAccessPolicyRegistry above refuses any host without a policy, and
   * that is where the rate, the robots stance and the byte cap live.
   */
  const registry = new PortalRegistry()
    .register(new SsGeAdapter())
    .register(new ConfiguredPortalAdapter({
      config: HOME24_GE,
      routes: [
        // Read off the site, not constructed: this is the collection URL the
        // 2026-09-25 capture actually fetched, and it yielded 23 detail links.
        { transaction: 'SALE', url: 'https://www.home24.ge/ge/results/for_sale/flat', propertyType: 'APARTMENT' },
        { transaction: 'RENT', url: 'https://www.home24.ge/ge/results/for_rent/flat', propertyType: 'APARTMENT' },
      ],
    }))
    .register(new ConfiguredPortalAdapter({
      config: PLACE_GE,
      routes: [
        { transaction: 'SALE', url: 'https://place.ge/ge/sakartvelo/bina/iyideba', propertyType: 'APARTMENT' },
        { transaction: 'RENT', url: 'https://place.ge/ge/sakartvelo/bina/qiravdeba', propertyType: 'APARTMENT' },
      ],
    }))
    .register(new ConfiguredPortalAdapter({
      config: ZARAYA,
      routes: [
        // One route: a developer sells, it does not let.
        { transaction: 'SALE', url: 'https://www.zarayaproperties.com/en/properties-1', propertyType: 'APARTMENT' },
      ],
    }))
    .register(new ConfiguredPortalAdapter({
      config: REALTING,
      /*
       * ELEVEN MARKETS ON FOUR CONTINENTS, EACH WITH ITS OWN COLLECTION PAGE.
       *
       * Every URL here was fetched on 2026-09-25 and the listing links on it
       * were counted: Georgia 30, Montenegro 32, Cyprus 31, Turkey 31,
       * Poland 31, Thailand 31, Latvia 31, Lithuania 30, Israel 32, the
       * United States 32, Cambodia 31.
       *
       * None was constructed by pattern from another. The site could have
       * used any shape for any of them, and a guessed URL is how an adapter
       * ends up fetching 404s politely — this list is what was loaded, not
       * what the sitemap implies.
       *
       * ONLY GEORGIA HAS A RENT ROUTE, because only Georgia's was checked.
       * The rest will get one when somebody has opened the page, which is the
       * same standard the sale routes were held to.
       *
       * Homatch is a Georgian product today. This is here so that the
       * architecture cannot quietly assume it always will be: a market
       * planner that can only name one country is not a planner, and nothing
       * reveals that faster than a source that answers about ten others.
       */
      countries: ['GE', 'ME', 'CY', 'TR', 'PL', 'TH', 'LV', 'LT', 'IL', 'US', 'KH'],
      routes: [
        { transaction: 'SALE', countryCode: 'GE', url: 'https://realting.com/georgia/property' },
        { transaction: 'RENT', countryCode: 'GE', url: 'https://realting.com/georgia/property-to-rent' },
        { transaction: 'SALE', countryCode: 'ME', url: 'https://realting.com/montenegro/property' },
        { transaction: 'SALE', countryCode: 'CY', url: 'https://realting.com/cyprus/property' },
        { transaction: 'SALE', countryCode: 'TR', url: 'https://realting.com/turkey/property' },
        { transaction: 'SALE', countryCode: 'PL', url: 'https://realting.com/poland/property' },
        { transaction: 'SALE', countryCode: 'TH', url: 'https://realting.com/thailand/property' },
        { transaction: 'SALE', countryCode: 'LV', url: 'https://realting.com/latvia/property' },
        { transaction: 'SALE', countryCode: 'LT', url: 'https://realting.com/lithuania/property' },
        { transaction: 'SALE', countryCode: 'IL', url: 'https://realting.com/israel/property' },
        { transaction: 'SALE', countryCode: 'US', url: 'https://realting.com/united-states/property' },
        { transaction: 'SALE', countryCode: 'KH', url: 'https://realting.com/cambodia/property' },
      ],
    }));

  const context: AdapterContext = {
    fetchDocument,
    authenticatedSession: false,
    now,
  };

  return {
    client,
    registry,
    context,
    stats: () => {
      const c = coalescer.stats();
      return {
        coalescedJoins: c.joins,
        coalescedExecutions: c.executions,
        cacheHits,
        cacheMisses,
        networkRequests,
      };
    },
  };
}
