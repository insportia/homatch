// HOMATCH RESEARCH CORE — the second network path, for hosts nobody has vetted.
//
// TWO TRUST MODELS, TWO PATHS, DELIBERATELY NOT ONE
//
// A KNOWN IMPLEMENTED SOURCE is reached through createPortalRuntime(): a fixed
// host allowlist derived from PORTAL_SOURCE_POLICIES, a per-source policy
// written by an operator, and no DNS resolution, because the catalogue is a
// closed set of eight public portals that no input can extend.
//
// An UNKNOWN CANDIDATE SOURCE is a hostname that arrived in a database row. It
// is reached through this file, and nothing here resembles the other path:
//
//   - no host allowlist, because there is nothing to put on it; instead
//   - DNS IS RESOLVED, and every address it returns must classify as public
//   - one shared, tight policy instead of a per-source one
//   - ports restricted to 80 and 443
//   - three redirect hops, each one re-validated from scratch
//   - a small byte cap, a short timeout, and a content-type gate
//   - no credentials of any kind, ever
//
// THE MISTAKE THIS FILE EXISTS TO NOT MAKE
//
// The tempting shortcut was to widen the portal allowlist with the hostnames in
// source_registry. That reads like a config change and is actually the removal
// of the only boundary on that path: `skipDnsResolution: true` is justified
// there BY the allowlist being fixed and public, so a list fed from a table
// would leave a row containing `http://169.254.169.254/` with nothing at all in
// front of it. The two properties hold each other up, and taking one away takes
// both.
//
// WHAT THIS PATH STILL CANNOT DO, STATED RATHER THAN IMPLIED
//
// It cannot pin the connection to the address it validated. WHATWG `fetch`
// offers no hook for it in any runtime this code runs in — Deno's
// `createHttpClient` has no DNS override, and there is no pinning transport
// available in an Edge Function. So a window remains between "we resolved this
// name and every answer was public" and "the platform resolved it again and
// connected", and a resolver that changed its answer inside that window is a
// DNS rebind we would not detect.
//
// Fail closed was considered and rejected as dishonest: it would mean no
// candidate auditing at all, which is not a security posture, it is a missing
// feature with a security-shaped excuse. What is done instead is to make the
// window worth as little as possible, which is a real answer rather than a
// slogan:
//
//   - the request carries NO credential, cookie, token or header that would
//     mean anything to an internal service, so a rebind reaches an unauthorized
//     GET from an unknown client
//   - the response is never executed, never trusted and never stored as fact;
//     it is measured (bytes, status, content type, shape) and thrown away
//   - the byte cap and timeout bound what a rebind could cost
//   - every redirect hop is re-validated, closing the far more practical
//     version of this attack, which needs no rebinding at all
//
// That is the whole of the residual risk and it is written down here, next to
// the code that carries it, rather than in a report somebody will not re-read.

import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { HttpClient } from '../fetch/http-client.ts';
import { FetchTransport } from '../fetch/fetch-transport.ts';
import type { Transport } from '../fetch/transport.ts';
import { HttpError, ResearchError } from '../core/errors.ts';
import { NetworkPolicy, NetworkPolicyError, canonicalHost, type DnsResolver } from './network-policy.ts';
import { RobotsChecker, RobotsDisallowedError, type RobotsFetcher } from './robots.ts';
import {
  DEFAULT_SOURCE_POLICY,
  SourceAccessPolicyRegistry,
  type SourcePolicy,
} from './source-policy.ts';

/**
 * Who we are, said plainly.
 *
 * It names the activity (a source audit, not a crawl), points at a page that
 * explains it, and does not pretend to be a browser. A site that wants us gone
 * can act on this, which is the difference between rate-limit compliance and a
 * claim of rate-limit compliance.
 */
export const CANDIDATE_AUDIT_USER_AGENT =
  'HomatchSourceAudit/1.0 (+https://homatch.ge/research-bot; evaluating whether this site may be used as a source; respects robots.txt)';

/** Ports a candidate may be contacted on. Not data-driven, on purpose. */
export const CANDIDATE_AUDIT_PORTS = [80, 443];

/**
 * Names that are internal by convention in a way ip.ts cannot see, because
 * they are NAMES, not addresses.
 *
 * NetworkPolicy already blocks `.internal`, `.local`, `metadata.google.internal`
 * and friends. This list is the cloud-specific handful that resolve to a
 * metadata service from inside a provider's network and look like ordinary
 * public names from outside it. Blocking them by name costs nothing and closes
 * the case where the DNS answer is genuinely public-looking.
 */
export const CANDIDATE_BLOCKED_HOSTS = [
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '169.254.169.254.nip.io',
  'nip.io',
  '.nip.io',
  'sslip.io',
  '.sslip.io',
  'xip.io',
  '.xip.io',
  'localtest.me',
  '.localtest.me',
  'vcap.me',
  '.vcap.me',
];

/**
 * Content types an audit is willing to read.
 *
 * An audit looks at pages, sitemaps, robots.txt and feeds. It has no reason to
 * pull a PDF, a video or an installer, and a source that answers a page request
 * with 40MB of video is a source the audit should record as unusable rather
 * than download. The gate is on the RESPONSE, because a candidate chooses what
 * it sends and Content-Type in a request would be a suggestion.
 */
export const CANDIDATE_AUDIT_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/xml',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/json',
  'application/ld+json',
]);

/**
 * The one policy every candidate shares.
 *
 * Not per-source, because a source with its own policy is by definition no
 * longer a candidate — writing one is what PERMITTED means, and it graduates
 * the host onto the other path. A single shared record also means the audit
 * posture is one thing a reviewer can read, rather than a property of whichever
 * row happened to be audited.
 */
export const CANDIDATE_AUDIT_POLICY: SourcePolicy = {
  ...DEFAULT_SOURCE_POLICY,
  id: 'candidate:unaudited',
  domains: [],
  hosts: [],
  // Every candidate is a sibling of every other candidate. Independence must be
  // under-counted for hosts we know nothing about, never invented.
  sourceFamily: 'candidate',
  kind: 'OTHER',
  providerCode: null,
  enabled: true,
  // GET only. HEAD tells an audit almost nothing it needs and doubles the
  // requests a site has to serve to be evaluated.
  allowedMethods: ['GET'],
  // One at a time, one per second. An audit reads at most a handful of
  // documents and is never in a hurry; a site being evaluated is owed more
  // courtesy than one we have already decided to use, not less.
  rate: { concurrency: 1, requestsPerSecond: 1, burst: 1 },
  robots: 'RESPECT',
  browserRenderingAllowed: false,
  // 600KB reads any real home page, sitemap index or robots.txt. A document
  // that needs more than this to be recognised is not one an audit can judge.
  maxResponseBytes: 600_000,
  timeoutMs: 8_000,
  // Three hops covers http->https->www and a locale redirect. Each one is
  // re-validated; the limit is about cost, not safety.
  redirects: { follow: true, max: 3, allowCrossDomain: true },
  // Nothing an audit fetches is cached. The next audit asks again, because the
  // question is "what does this host do now".
  cacheTtlMs: 0,
  cacheStaleMs: 0,
  visibility: 'PUBLIC',
  // Zero, and it stays zero until a human writes a policy. Authority is a claim
  // about evidential weight and an unaudited host has earned none.
  authority: 0,
  canonicalization: { stripWww: true, stripTracking: true },
  notes:
    'Shared policy for a host that arrived in a database row and has never been reviewed. ' +
    'Grants the narrowest thing that can still answer "is this a usable source": one GET at a ' +
    'time, 600KB, 8s, three re-validated redirects, text-like responses only, no credentials. ' +
    'A host that earns a policy of its own stops using this one.',
};

export type CandidateRefusal =
  | 'MALFORMED_URL'
  | 'SCHEME_NOT_ALLOWED'
  | 'CREDENTIALS_IN_URL'
  | 'PORT_NOT_ALLOWED'
  | 'INTERNAL_HOSTNAME'
  | 'HOST_BLOCKED'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILURE'
  | 'DNS_UNAVAILABLE'
  | 'NO_ADDRESSES'
  | 'ROBOTS_DISALLOWED'
  | 'CONTENT_TYPE_REFUSED'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'TRANSPORT_ERROR';

export interface CandidateFetchResult {
  ok: boolean;
  /** Why not, when not. Recorded as audit evidence, never thrown away. */
  refusal?: CandidateRefusal;
  detail?: string;
  status?: number;
  finalUrl?: string;
  body?: string;
  contentType?: string | null;
  bytes?: number;
  truncated?: boolean;
  redirectChain?: string[];
  /** Validated public addresses actually approved for this fetch. */
  addresses?: string[];
  durationMs?: number;
}

/**
 * A synchronous shape check, with no DNS and no network.
 *
 * Its job is to let a producer sort thousands of rows without resolving any of
 * them: a row whose URL is `javascript:`, or has a password in it, or names port
 * 22, is not a candidate website and never needs to be asked about. It is NOT
 * the security boundary — it cannot be, because it does not resolve anything.
 * `fetchCandidate` re-checks all of this through the real NetworkPolicy, which
 * is the boundary.
 */
export function candidateUrlShape(url: string): { ok: boolean; reason?: CandidateRefusal; host?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'MALFORMED_URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'SCHEME_NOT_ALLOWED' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'CREDENTIALS_IN_URL' };
  }

  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!CANDIDATE_AUDIT_PORTS.includes(port)) {
    return { ok: false, reason: 'PORT_NOT_ALLOWED' };
  }

  const host = canonicalHost(parsed.hostname);
  if (!host) return { ok: false, reason: 'MALFORMED_URL' };

  return { ok: true, host };
}

export interface CandidateAuditPathOptions {
  /**
   * REQUIRED. Rule 3 is the whole point of this path, and it cannot be
   * enforced without a resolver.
   */
  resolver: DnsResolver;
  /** Injected by tests. Production uses the platform's fetch. */
  transport?: Transport;
  now?: () => number;
  /** Additional hosts the operator wants refused by name. */
  blockedHosts?: string[];
}

export interface CandidateAuditPath {
  fetchCandidate(url: string, options?: { maxBytes?: number }): Promise<CandidateFetchResult>;
  /** The policy in force, so a caller can report it rather than restate it. */
  policy: SourcePolicy;
  /** Requests actually put on the wire, for the audit trail. */
  networkRequests(): number;
}

/**
 * Build the candidate-audit path.
 *
 * Throws rather than degrading if no resolver is supplied. NetworkPolicy would
 * also fail closed at request time (DNS_UNAVAILABLE), but a missing resolver is
 * a wiring mistake, and a wiring mistake should be a construction error at
 * start-up rather than a per-URL refusal that looks like every candidate being
 * unreachable.
 */
export function createCandidateAuditPath(
  options: CandidateAuditPathOptions,
): CandidateAuditPath {
  if (!options.resolver) {
    throw new ResearchError(
      'CONFIG_ERROR',
      'createCandidateAuditPath requires a DNS resolver: without one, "every resolved address ' +
        'must be public" cannot be checked, and this path exists only to check it.',
      { retryable: false },
    );
  }

  const now = options.now ?? (() => Date.now());

  const transport =
    options.transport ??
    new FetchTransport({ maxBytes: 600_000, userAgent: CANDIDATE_AUDIT_USER_AGENT });

  const networkPolicy = new NetworkPolicy({
    /*
     * NO hostAllowlistOnly, and that is the point. A candidate is by definition
     * not on a list. What replaces the list is the resolver below plus the
     * classification in ip.ts: the host may be anything, the ADDRESSES may not.
     */
    resolver: options.resolver,
    // Not set, stated for the reader: skipDnsResolution would disable the only
    // rule protecting this path. allowPrivateNetworks likewise.
    skipDnsResolution: false,
    allowPrivateNetworks: false,
    allowCredentials: false,
    allowedSchemes: ['http:', 'https:'],
    allowedPorts: CANDIDATE_AUDIT_PORTS,
    blockedHosts: [...CANDIDATE_BLOCKED_HOSTS, ...(options.blockedHosts ?? [])],
  });

  /*
   * robots.txt goes through the same transport and the same policy as
   * everything else — it is a fetch of an unvetted host like any other. It
   * cannot go through HttpClient, because HttpClient consults robots before
   * every request and that recurses.
   *
   * The URL it is handed is built by RobotsChecker from a URL that has already
   * been through NetworkPolicy once; it is validated again here, because "it
   * was fine a moment ago for a different path on the same host" is not a
   * check.
   */
  const robotsFetcher: RobotsFetcher = {
    async fetch(robotsUrl: string) {
      const decision = await networkPolicy.check(robotsUrl);
      if (!decision.allowed) return null;
      try {
        const response = await transport.send({
          url: robotsUrl,
          method: 'GET',
          headers: {},
          timeoutMs: 6_000,
          maxBytes: 128_000,
        });
        return { status: response.status, body: response.body };
      } catch {
        return null;
      }
    },
  };

  const robots = new RobotsChecker({
    userAgent: CANDIDATE_AUDIT_USER_AGENT,
    fetcher: robotsFetcher,
    now,
  });

  const client = new HttpClient({
    transport,
    robots,
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 1, requestsPerSecond: 1 } }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy,
    // Every host resolves to the candidate policy, because the registry is
    // empty and CANDIDATE_AUDIT_POLICY is its fallback. A host that HAS a
    // policy belongs on the portal path, not this one.
    sourcePolicies: new SourceAccessPolicyRegistry([], CANDIDATE_AUDIT_POLICY),
    /*
     * The transport cannot pin. See the file header for the whole of what that
     * costs and what is done about it; the short version is that the request
     * carries nothing worth stealing and the response is never trusted.
     */
    requirePinningTransport: false,
    /*
     * NO HEADERS. Not an empty object for tidiness — an empty object as the
     * assertion. Nothing about Homatch's identity, session, tenant or billing
     * has any business travelling to a host we have not evaluated, and the way
     * to be sure of that is for there to be nowhere to put it.
     */
    headers: {},
    defaultTimeoutMs: 8_000,
    // One attempt. A candidate that 503s is evidence about the candidate, and
    // retrying it three times is a small denial-of-service in exchange for a
    // datum we already have.
    maxAttempts: 1,
    limitKeyMode: 'registrable-domain',
  });

  let networkRequests = 0;

  const fetchCandidate = async (
    url: string,
    fetchOptions: { maxBytes?: number } = {},
  ): Promise<CandidateFetchResult> => {
    const started = now();

    // Cheap shape check first, so an obviously impossible row never reaches
    // DNS. The real check is the policy inside client.fetch().
    const shape = candidateUrlShape(url);
    if (!shape.ok) {
      return { ok: false, refusal: shape.reason, durationMs: now() - started };
    }

    try {
      const result = await client.fetch(url, {
        method: 'GET',
        maxBytes: fetchOptions.maxBytes ?? CANDIDATE_AUDIT_POLICY.maxResponseBytes,
      });
      networkRequests += result.networkRequests;

      const mime = result.contentType?.mime ?? null;
      if (mime && !CANDIDATE_AUDIT_CONTENT_TYPES.has(mime)) {
        /*
         * Refused AFTER the read, which is the honest place for it. The bytes
         * are already capped, and a Content-Type header is a claim a candidate
         * makes about itself — believing it before reading would let a site
         * declare text/html and send anything. What matters is that a
         * non-text response is recorded as unusable and its body is dropped
         * here rather than handed to a parser.
         */
        return {
          ok: false,
          refusal: 'CONTENT_TYPE_REFUSED',
          detail: mime,
          status: result.status,
          finalUrl: result.finalUrl,
          bytes: result.bytes,
          addresses: result.contactedAddresses,
          durationMs: now() - started,
        };
      }

      return {
        ok: true,
        status: result.status,
        finalUrl: result.finalUrl,
        body: result.body,
        contentType: mime,
        bytes: result.bytes,
        truncated: result.truncated,
        redirectChain: result.redirectChain,
        addresses: result.contactedAddresses,
        durationMs: now() - started,
      };
    } catch (error) {
      networkRequests += 1;
      return {
        ...classifyFailure(error),
        durationMs: now() - started,
      };
    }
  };

  return {
    fetchCandidate,
    policy: CANDIDATE_AUDIT_POLICY,
    networkRequests: () => networkRequests,
  };
}

/**
 * Turn a thrown error into recorded evidence.
 *
 * An audit's failures are its findings. "This host refuses robots" and "this
 * host resolves into private space" are two very different facts about a
 * candidate and collapsing them into "fetch failed" is how an auditor ends up
 * reporting our own configuration as a property of somebody's website — which
 * has happened here before, twice.
 */
export function classifyFailure(error: unknown): CandidateFetchResult {
  if (error instanceof NetworkPolicyError) {
    const reason = error.decision.reason;
    return {
      ok: false,
      refusal: (reason ?? 'TRANSPORT_ERROR') as CandidateRefusal,
      detail: error.decision.category ?? error.decision.detail,
    };
  }

  if (error instanceof RobotsDisallowedError) {
    return { ok: false, refusal: 'ROBOTS_DISALLOWED', detail: describe(error) };
  }

  if (error instanceof ResearchError) {
    if (error instanceof HttpError) {
      return { ok: false, refusal: 'HTTP_ERROR', status: error.status };
    }
    if (error.code === 'TIMEOUT') return { ok: false, refusal: 'TIMEOUT' };
    return { ok: false, refusal: 'TRANSPORT_ERROR', detail: error.code };
  }

  return { ok: false, refusal: 'TRANSPORT_ERROR', detail: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
