/*
 * A SEARCH PAID FOR ONCE.
 *
 * Krtsanisi Street will be verified again. Two flats in the same building,
 * two buyers in the same week, or one buyer reopening a case tomorrow all ask
 * the market the same questions — and every one of those questions is billed.
 * Without this, the second Verify on a street pays full price to rediscover
 * exactly what the first one already found.
 *
 * ── WHY IT DECORATES RATHER THAN LIVES INSIDE THE ENGINE ─────────────
 *
 * The discovery engine's contract is one method: ask a query, get results. A
 * cache satisfies that contract exactly, so it wraps a provider instead of
 * complicating one — which also means the acceptance fixture, the locked
 * provider and the live lane all cache identically, or not at all, without the
 * engine knowing which it is talking to.
 *
 * ── FRESHNESS IS NOT OPTIONAL HERE ───────────────────────────────────
 *
 * A listing is a live claim about a market. Serving a month-old search as
 * though it were today's would put withdrawn inventory into a price range and
 * date the report without saying so. So an entry has an explicit age, a stale
 * entry is a miss, and the run reports how much of what it used was cached.
 */

import type { DiscoveryQuery } from '../../research-core/market/discoveryPlan.ts';
import type {
  SearchHit,
  SearchProvider,
  SearchResponse,
} from '../../research-core/market/discoveryRun.ts';

/** How long a search result may stand in for a live one. */
export const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface CachedSearch {
  hits: readonly SearchHit[];
  storedAt: number;
}

/**
 * Where cached searches live.
 *
 * Deliberately a two-method port rather than a table: the edge function backs
 * it with `research_cache`, tests back it with a Map, and neither needs the
 * other to exist.
 */
export interface SearchCacheStore {
  get(key: string): Promise<CachedSearch | null>;
  set(key: string, value: CachedSearch): Promise<void>;
}

/** A trivially correct store, for tests and single-process runs. */
export function memorySearchCache(): SearchCacheStore & { size(): number } {
  const map = new Map<string, CachedSearch>();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    size() { return map.size; },
  };
}

/*
 * THE KEY IS THE QUESTION, NOT THE ASKING.
 *
 * Scoped by provider because two providers answer the same string differently,
 * and by language because the planner's formulations repeat across languages
 * while their results do not. It is NOT scoped by property: the whole point is
 * that the next property on this street inherits this street's evidence.
 *
 * Public search results only. Nothing customer-specific is ever keyed here, so
 * there is no tenant to leak between — which is exactly why this may be shared
 * at all.
 */
export function searchCacheKey(providerId: string, query: DiscoveryQuery): string {
  return `mds1:${providerId}:${query.language}:${query.text.trim().toLocaleLowerCase()}`;
}

export interface CachingProviderStats {
  hits: number;
  misses: number;
  /** Entries that existed but were too old to use. */
  stale: number;
}

/**
 * Wraps a provider so an identical recent question is answered for free.
 *
 * Only an OK response is stored. Caching a PROVIDER_ERROR would turn one bad
 * minute into six bad hours, and caching a PROVIDER_LOCKED would keep
 * answering "locked" after the lock was lifted.
 */
export function cachingSearchProvider(
  inner: SearchProvider,
  store: SearchCacheStore,
  options: { ttlMs?: number; now?: () => number } = {},
): SearchProvider & { stats(): CachingProviderStats } {
  const ttl = options.ttlMs ?? SEARCH_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const stats: CachingProviderStats = { hits: 0, misses: 0, stale: 0 };

  return {
    id: inner.id,
    stats() { return { ...stats }; },
    async search(query: DiscoveryQuery): Promise<SearchResponse> {
      const key = searchCacheKey(inner.id, query);
      try {
        const cached = await store.get(key);
        if (cached) {
          if (now() - cached.storedAt <= ttl) {
            stats.hits += 1;
            return { status: 'OK', hits: cached.hits };
          }
          stats.stale += 1;
        }
      } catch {
        // A cache that cannot be read is a cache miss, never a failed search.
      }

      stats.misses += 1;
      const fresh = await inner.search(query);
      if (fresh.status === 'OK') {
        try {
          await store.set(key, { hits: fresh.hits, storedAt: now() });
        } catch {
          // Storing is an optimisation. Failing to store must never fail a run.
        }
      }
      return fresh;
    },
  };
}
