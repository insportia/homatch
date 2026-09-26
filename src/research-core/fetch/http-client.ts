// HOMATCH RESEARCH CORE — the single outbound HTTP path.
//
// Everything that protects a source, and everything that protects Homatch from
// a source, lives here rather than in adapters, so an adapter author cannot
// bypass it by accident:
//
//   - network policy (SSRF) on the initial target AND on every redirect
//   - source access policy: enabled, methods, byte cap, timeout, redirects
//   - robots.txt, where the source policy says to respect it
//   - per-host concurrency and rate limiting
//   - per-host circuit breaking
//   - retry with Retry-After and jittered backoff
//   - content-type detection with body sniffing
//
// It fetches `fetchUrl` and reports `canonicalIdentityUrl` separately. Those
// are different strings and conflating them was a real bug: canonicalization
// strips query parameters, which can change or destroy the resource requested.
//
// It knows nothing about money. It counts `networkRequests`; bridge/cost.ts
// turns counts into the shapes cogs.ts already prices.

import { ResearchError, HttpError } from '../core/errors.ts';
import { createLogger, type Logger } from '../core/logger.ts';
import { canonicalizeUrl, deriveUrlIdentity, isHttpUrl, resolveUrl } from '../normalize/url.ts';
import { hostnameOf, registrableDomainOf } from '../normalize/domain.ts';
import { detectContentType, type ContentTypeInfo } from '../normalize/content-type.ts';
import { parseRetryAfter, retry, type BackoffOptions } from '../flow/backoff.ts';
import type { RateLimiter } from '../flow/rate-limiter.ts';
import type { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import {
  NetworkPolicy,
  NetworkPolicyError,
  redactUrl,
  type ResolvedTarget,
} from '../net/network-policy.ts';
import {
  SourceAccessPolicyRegistry,
  SourceDisabledError,
  type ResolvedSourcePolicy,
} from '../net/source-policy.ts';
import { RobotsDisallowedError, type RobotsChecker } from '../net/robots.ts';
import { headerValue, type RawResponse, type Transport } from './transport.ts';


export interface HttpClientOptions {
  transport: Transport;
  rateLimiter: RateLimiter;
  breakers: CircuitBreakerRegistry;
  /** The SSRF boundary. Required: there is no safe default for "no policy". */
  networkPolicy: NetworkPolicy;
  sourcePolicies?: SourceAccessPolicyRegistry;
  /** Supplied only when some source policy sets robots: 'RESPECT'. */
  robots?: RobotsChecker;
  logger?: Logger;
  defaultTimeoutMs?: number;
  maxAttempts?: number;
  backoff?: Partial<BackoffOptions>;
  headers?: Record<string, string>;
  /** Rate limits key on this. Registrable domain treats mirrors as one host. */
  limitKeyMode?: 'hostname' | 'registrable-domain';
  /**
   * Refuse to use a transport that cannot pin the connection to a validated
   * address. On by default; tests with a mock transport turn it off.
   */
  requirePinningTransport?: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD';
  /** Override the rate-limit bucket, e.g. to charge a search provider. */
  limitKey?: string;
  maxAttempts?: number;
  maxBytes?: number;
  /** Only for fetching robots.txt itself, which must not recurse. */
  skipRobots?: boolean;
}

export interface FetchResult {
  /** Exactly what the caller asked for. */
  requestedUrl: string;
  /** What we actually put on the wire (minimally normalized). */
  fetchUrl: string;
  /** Where we ended up after redirects - a real, fetchable URL. */
  finalUrl: string;
  /** Cache/dedupe identity derived from `finalUrl`. Never fetched. */
  canonicalIdentityUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: ContentTypeInfo;
  redirectChain: string[];
  /** Hops actually performed, including redirects and retried attempts. */
  networkRequests: number;
  bytes: number;
  truncated: boolean;
  durationMs: number;
  limitKey: string;
  policyId: string;
  sourceVisibility: 'PUBLIC' | 'PRIVATE';
  /** Validated addresses actually contacted, for the audit trail. */
  contactedAddresses: string[];
}

export class HttpClient {
  private readonly logger: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sourcePolicies: SourceAccessPolicyRegistry;

  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;

    this.logger = options.logger ?? createLogger('research:http');
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sourcePolicies = options.sourcePolicies ?? new SourceAccessPolicyRegistry();

    if ((options.requirePinningTransport ?? true) && !options.transport.pinsAddresses) {
      throw new ResearchError(
        'CONFIG_ERROR',
        `Transport "${options.transport.name}" cannot pin connections to validated addresses. ` +
          'Use NodeHttpTransport, or set requirePinningTransport: false for a mock transport.',
        { retryable: false },
      );
    }
  }

  limitKeyFor(url: string): string {
    const mode = this.options.limitKeyMode ?? 'registrable-domain';
    const key = mode === 'hostname' ? hostnameOf(url) : registrableDomainOf(url);
    return key ?? 'unknown-host';
  }

  policyFor(url: string): ResolvedSourcePolicy {
    return this.sourcePolicies.resolve(url);
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const started = Date.now();

    const policyProbe = this.sourcePolicies.resolve(url);
    const identity = deriveUrlIdentity(url, policyProbe.canonicalization);
    if (!identity) {
      throw new HttpError(400, redactUrl(url));
    }

    // Resolve the policy again from the normalized fetch URL, in case the input
    // was odd enough to change which source it belongs to.
    const policy = this.sourcePolicies.resolve(identity.fetchUrl);

    if (!policy.enabled) {
      throw new SourceDisabledError(policy.id, redactUrl(identity.fetchUrl));
    }

    const method = options.method ?? 'GET';
    if (!policy.allowedMethods.includes(method)) {
      throw new ResearchError(
        'CONFIG_ERROR',
        `Method ${method} is not allowed for source "${policy.id}"`,
        { retryable: false },
      );
    }

    // The SSRF check runs before anything else touches the network - including
    // the robots.txt fetch. Checking robots first would mean issuing a request
    // to an unvalidated host in order to decide whether we may issue a request
    // to it, which defeats the point.
    const firstTarget: ResolvedTarget = await this.options.networkPolicy.resolveTarget(
      identity.fetchUrl,
    );

    /*
     * robots is checked per ORIGIN, not once per call.
     *
     * It used to be checked here alone, for the entry URL, and a redirect
     * crossing to another host then reached that host's pages without its
     * robots.txt ever being read. On the portal path every hop is an
     * allowlisted portal with a policy of its own, so the gap was invisible;
     * on the candidate-audit path, where an unvetted site chooses the redirect
     * target, it is the difference between respecting robots and claiming to.
     *
     * RobotsChecker caches per origin, so the cost is one extra fetch the
     * first time a redirect introduces a host we have not asked yet.
     */
    const robotsChecked = new Set<string>();
    const assertRobots = async (target: string): Promise<void> => {
      if (policy.robots !== 'RESPECT' || options.skipRobots) return;
      const origin = originOf(target);
      if (robotsChecked.has(origin)) return;
      robotsChecked.add(origin);
      await this.assertRobotsAllows(target, policy);
    };

    await assertRobots(identity.fetchUrl);

    const maxRedirects = policy.redirects.follow ? policy.redirects.max : 0;
    const maxBytes = options.maxBytes ?? policy.maxResponseBytes;
    const timeoutMs = options.timeoutMs ?? policy.timeoutMs ?? this.defaultTimeoutMs;
    const originDomain = registrableDomainOf(identity.fetchUrl);

    const redirectChain: string[] = [];
    const contactedAddresses: string[] = [];
    let networkRequests = 0;
    let bytes = 0;
    let truncated = false;

    let currentUrl = identity.fetchUrl;
    let response: RawResponse | null = null;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // Validated per hop, not once at the start. A redirect is attacker-
      // controlled input and is the classic way past an entry-point-only check.
      // Hop 0 reuses the pre-check above rather than resolving twice.
      const target: ResolvedTarget =
        hop === 0 && currentUrl === identity.fetchUrl
          ? firstTarget
          : await this.options.networkPolicy.resolveTarget(currentUrl);
      for (const address of target.addresses) contactedAddresses.push(address.address);

      // A redirect that changed origin has not been cleared by robots yet.
      await assertRobots(currentUrl);

      const limitKey = options.limitKey ?? this.limitKeyFor(currentUrl);
      const hopUrl = currentUrl;
      const pinnedAddresses = target.addresses.map((address) => address.address);

      const hopResponse = await this.options.rateLimiter.run(
        limitKey,
        () =>
          this.options.breakers.get(limitKey).execute(() =>
            retry(
              async () => {
                networkRequests += 1;
                const raw = await this.options.transport.send({
                  url: hopUrl,
                  method,
                  headers: { ...(this.options.headers ?? {}), ...(options.headers ?? {}) },
                  timeoutMs,
                  signal: options.signal,
                  maxBytes,
                  pinnedAddresses,
                });

                // Turn retryable statuses into errors so `retry` can act, and
                // carry Retry-After through so the server's guidance wins.
                if (raw.status === 429 || raw.status === 408 || raw.status >= 500) {
                  const retryAfter = parseRetryAfter(headerValue(raw.headers, 'retry-after'));
                  throw new HttpError(raw.status, redactUrl(hopUrl), retryAfter);
                }
                return raw;
              },
              {
                maxAttempts: options.maxAttempts ?? this.maxAttempts,
                ...this.options.backoff,
                signal: options.signal,
                onRetry: ({ attempt, delayMs, error }) =>
                  this.logger.debug('retrying request', {
                    url: redactUrl(hopUrl),
                    attempt,
                    delayMs,
                    error: error instanceof Error ? error.message : String(error),
                  }),
              },
            ),
          ),
        options.signal,
      );

      bytes += hopResponse.bytes;
      truncated = truncated || hopResponse.truncated;
      response = hopResponse;

      const location = headerValue(hopResponse.headers, 'location');
      const isRedirect = hopResponse.status >= 300 && hopResponse.status < 400 && location;
      if (!isRedirect) break;

      if (!policy.redirects.follow) break;

      // Redirects resolve against the ACTUAL current URL, never a canonical one.
      const next = resolveUrl(currentUrl, location as string);
      if (!next || !isHttpUrl(next)) {
        this.logger.warn('unusable redirect target', { from: redactUrl(currentUrl) });
        break;
      }

      if (!policy.redirects.allowCrossDomain && registrableDomainOf(next) !== originDomain) {
        throw new ResearchError(
          'CONFIG_ERROR',
          `Source "${policy.id}" forbids cross-domain redirects (${originDomain} -> ${registrableDomainOf(next)})`,
          { retryable: false },
        );
      }

      // Loop detection: a redirect back to somewhere we have already been ends
      // the chain rather than burning the hop budget.
      if (next === currentUrl || redirectChain.includes(next)) {
        this.logger.warn('redirect loop detected', { url: redactUrl(next) });
        break;
      }

      redirectChain.push(currentUrl);
      currentUrl = next;

      if (hop === maxRedirects) {
        this.logger.warn('redirect limit reached', {
          url: redactUrl(currentUrl),
          max: maxRedirects,
        });
      }
    }

    if (!response) throw new HttpError(500, redactUrl(identity.fetchUrl));

    // Non-retryable error statuses (notably 404) surface here and are NOT
    // retried: a missing page stays missing.
    if (response.status >= 400) {
      throw new HttpError(response.status, redactUrl(currentUrl));
    }

    // We stopped following redirects (loop, hop limit, policy, or an unusable
    // Location) without reaching a document. Returning the bare 3xx would hand
    // the caller an empty body dressed up as a success.
    if (response.status >= 300 && response.status < 400) {
      throw new HttpError(response.status, redactUrl(currentUrl));
    }

    return {
      requestedUrl: identity.requestedUrl,
      fetchUrl: identity.fetchUrl,
      finalUrl: currentUrl,
      canonicalIdentityUrl: canonicalizeUrl(currentUrl, policy.canonicalization) ?? currentUrl,
      status: response.status,
      headers: response.headers,
      body: response.body,
      contentType: detectContentType(headerValue(response.headers, 'content-type'), response.body),
      redirectChain,
      networkRequests,
      bytes,
      truncated,
      durationMs: Date.now() - started,
      limitKey: options.limitKey ?? this.limitKeyFor(currentUrl),
      policyId: policy.id,
      sourceVisibility: policy.visibility,
      contactedAddresses: [...new Set(contactedAddresses)],
    };
  }

  private async assertRobotsAllows(url: string, policy: ResolvedSourcePolicy): Promise<void> {
    if (!this.options.robots) {
      throw new ResearchError(
        'CONFIG_ERROR',
        `Source "${policy.id}" is configured robots: 'RESPECT' but no RobotsChecker was supplied. ` +
          'Refusing to fetch rather than silently ignoring robots.txt.',
        { retryable: false },
      );
    }

    const decision = await this.options.robots.check(url);
    if (!decision.allowed) {
      throw new RobotsDisallowedError(redactUrl(url), decision.rule);
    }
  }
}

/**
 * Scheme + host + port, which is the scope of one robots.txt. Two ports on one
 * hostname are two origins and genuinely have two robots files.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export { NetworkPolicyError };
