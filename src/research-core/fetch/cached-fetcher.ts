// HOMATCH RESEARCH CORE — one hundred requests, one fetch.
//
// This is the piece Homatch does not have today. `research_cache` is a RESULT
// cache: it stops the second request from repeating the first. It does
// nothing about a hundred requests arriving in the same second, which is
// exactly when a popular subject is being researched and exactly when the
// spend happens. Coalescing is what turns that hundred into one.
//
// THE ORDER OF THE CHECKS IS THE DESIGN
//
//   1. cache read          — if it is fresh, nobody fetches anything.
//   2. coalesce            — if somebody is already fetching it, join them.
//   3. fetch               — one request, under policy, rate limit and breaker.
//   4. cache write         — so the next hundred take path 1.
//
// Getting 1 and 2 the wrong way round means a hundred requests all miss the
// cache, all decide to fetch, and only then discover each other.
//
// AND THE THING THAT NEARLY BROKE IT
//
// `forceRefresh` must skip the cache read at BOTH points. An earlier version
// re-checked the cache inside the coalesced worker, which meant a forced
// refresh joined a queue and then got handed the stale copy it was trying to
// replace — a refresh button that refreshed nothing. The re-check inside the
// worker is conditional on `forceRefresh` for that reason, and the test named
// "a forced refresh is not answered from the cache it is replacing" is what
// keeps it that way.
//
// SCOPE IS IN THE KEY. Two customers asking for the same private page share
// neither a cache entry nor a coalescing group, because the key they build
// differs — see bridge/cache-key.ts. That is not a policy check that could be
// forgotten; it is arithmetic.

import { emptyUsage, mergeUsage, type ProviderUsage, type RequestContext } from '../core/types.ts';
import { RequestCoalescer } from '../flow/coalescer.ts';
import { RefreshCoordinator } from '../flow/refresh-coordinator.ts';
import { judgeDocumentAge, type CacheFreshness } from '../bridge/freshness.ts';
import { documentFingerprint } from '../bridge/cache-key.ts';
import type { SourceAccessPolicyRegistry } from '../net/source-policy.ts';
import type { HttpClient, FetchResult } from './http-client.ts';

/** What `research_cache` gives back, in the shape this core needs. */
export interface StoredDocument {
  fingerprint: string;
  url: string;
  status: number;
  body: string;
  contentType: string | null;
  contentHash: string | null;
  retrievedAt: string;
}

/**
 * A port over `research_cache`. The core never holds a Supabase client; the
 * host implements this with the service-role client it already has, and RLS
 * stays exactly as it is.
 */
export interface DocumentStore {
  get(fingerprint: string): Promise<StoredDocument | null>;
  put(document: StoredDocument, meta: { provider: string; queryJson: Record<string, unknown> }): Promise<void>;
  /** Increment hit_count. Best-effort: a failure here must not fail a request. */
  touch(fingerprint: string): Promise<void>;
}

/** A store that keeps nothing. The default, so caching is opt-in and visible. */
export const noDocumentStore: DocumentStore = {
  async get(): Promise<StoredDocument | null> {
    return null;
  },
  async put(): Promise<void> {
    /* nothing kept */
  },
  async touch(): Promise<void> {
    /* nothing kept */
  },
};

export type FetchPath =
  | 'CACHE_LIVE'
  | 'CACHE_FRESH'
  | 'CACHE_AGING'
  | 'COALESCED'
  | 'NETWORK';

export interface CachedFetchResult {
  document: StoredDocument;
  path: FetchPath;
  freshness: CacheFreshness | null;
  /** Non-null only when this call actually went to the network. */
  network: FetchResult | null;
  usage: ProviderUsage;
}

export interface CachedFetcherOptions {
  httpClient: HttpClient;
  policies: SourceAccessPolicyRegistry;
  store?: DocumentStore;
  coalescer?: RequestCoalescer;
  refresh?: RefreshCoordinator;
  now?: () => number;
  /** Provider code recorded against cache rows. Free pages use their source id. */
  providerFor?: (policyId: string) => string;
}

export interface CachedFetchOptions {
  context: RequestContext;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  /** Extra key material when the same URL can return different things. */
  variant?: Record<string, string | number | boolean | null> | null;
}

export class CachedFetcher {
  private readonly store: DocumentStore;
  private readonly coalescer: RequestCoalescer;
  private readonly refresh: RefreshCoordinator;
  private readonly now: () => number;

  private readonly options: CachedFetcherOptions;

  constructor(options: CachedFetcherOptions) {
    this.options = options;

    this.store = options.store ?? noDocumentStore;
    this.now = options.now ?? (() => Date.now());
    this.coalescer = options.coalescer ?? new RequestCoalescer(this.now);
    this.refresh = options.refresh ?? new RefreshCoordinator({ now: this.now });
  }

  async fetch(url: string, options: CachedFetchOptions): Promise<CachedFetchResult> {
    const policy = this.options.policies.resolve(url);
    const provider = this.options.providerFor?.(policy.id) ?? policy.providerCode ?? policy.id;

    const fingerprint = documentFingerprint({
      url,
      canonicalization: policy.canonicalization,
      provider,
      context: options.context,
      visibility: policy.visibility,
      variant: options.variant ?? null,
    });

    // ── 1. Cache ──────────────────────────────────────────────────────────
    if (!options.forceRefresh) {
      const cached = await this.store.get(fingerprint);
      if (cached) {
        const verdict = judgeDocumentAge(cached.retrievedAt, policy, this.now());
        if (verdict.usable) {
          // Best-effort. A failing counter must never fail a served request.
          await this.store.touch(fingerprint).catch(() => undefined);

          if (verdict.refreshBehind) {
            // Serve now, refresh behind, exactly once however many notice.
            void this.refresh
              .refreshOnce(fingerprint, () => this.fetchAndStore(url, fingerprint, provider, options))
              .catch(() => undefined);
          }

          return {
            document: cached,
            path: verdict.status === 'LIVE' ? 'CACHE_LIVE'
              : verdict.status === 'FRESH' ? 'CACHE_FRESH' : 'CACHE_AGING',
            freshness: verdict.status,
            network: null,
            usage: { ...emptyUsage(provider, 'fetch'), cacheHits: 1 },
          };
        }
      }
    }

    // ── 2. Coalesce ───────────────────────────────────────────────────────
    // Checked BEFORE running, so the joiners can be counted. `isInFlight` is
    // synchronous, which is what lets a burst arriving in one tick collapse.
    const joined = this.coalescer.isInFlight(fingerprint);

    const result = await this.coalescer.run(fingerprint, async () => {
      // A forced refresh deliberately does NOT re-check the cache here. See
      // the header: re-checking is how a refresh returns the stale copy.
      if (!options.forceRefresh) {
        const late = await this.store.get(fingerprint);
        if (late) {
          const verdict = judgeDocumentAge(late.retrievedAt, policy, this.now());
          if (verdict.usable) return { document: late, network: null };
        }
      }
      return this.fetchAndStore(url, fingerprint, provider, options);
    });

    if (joined) {
      return {
        document: result.document,
        path: 'COALESCED',
        freshness: null,
        network: null,
        // A coalesced request issued no network call of its own. Counting it
        // as one would make the saving invisible in exactly the ledger that
        // exists to show it.
        usage: { ...emptyUsage(provider, 'fetch'), coalescedRequests: 1 },
      };
    }

    return {
      document: result.document,
      path: result.network ? 'NETWORK' : 'CACHE_FRESH',
      freshness: null,
      network: result.network,
      usage: result.network
        ? {
            ...emptyUsage(provider, 'fetch'),
            networkRequests: result.network.networkRequests,
            // Whether a fetch is BILLABLE is a fact about the provider, not
            // about the request. A free public page is never billable however
            // many hops it took; a metered provider is billable once per
            // logical call, not once per redirect.
            billableRequests: policy.providerCode ? 1 : 0,
            durationMs: result.network.durationMs,
          }
        : { ...emptyUsage(provider, 'fetch'), cacheHits: 1 },
    };
  }

  private async fetchAndStore(
    url: string,
    fingerprint: string,
    provider: string,
    options: CachedFetchOptions,
  ): Promise<{ document: StoredDocument; network: FetchResult | null }> {
    const network = await this.options.httpClient.fetch(url, { signal: options.signal });

    const document: StoredDocument = {
      fingerprint,
      // The identity URL, so a stored row cannot carry a session parameter.
      url: network.canonicalIdentityUrl,
      status: network.status,
      body: network.body,
      contentType: network.contentType.mime,
      contentHash: null,
      retrievedAt: new Date(this.now()).toISOString(),
    };

    await this.store.put(document, {
      provider,
      queryJson: {
        requested_url: network.requestedUrl,
        final_url: network.finalUrl,
        policy_id: network.policyId,
        redirects: network.redirectChain.length,
      },
    });

    return { document, network };
  }

  /** Coalescing and refresh counters, for the metrics the saving shows up in. */
  stats(): { coalescing: ReturnType<RequestCoalescer['stats']>; refresh: ReturnType<RefreshCoordinator['stats']> } {
    return { coalescing: this.coalescer.stats(), refresh: this.refresh.stats() };
  }
}

/** Sum the usage of many fetches into one provider total. */
export function totalUsage(results: readonly CachedFetchResult[], provider: string): ProviderUsage {
  return results.reduce<ProviderUsage>(
    (acc, result) => mergeUsage(acc, result.usage),
    emptyUsage(provider, 'fetch'),
  );
}
