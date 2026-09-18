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

  const registry = new PortalRegistry().register(new SsGeAdapter());

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
