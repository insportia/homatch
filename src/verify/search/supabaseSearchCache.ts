/*
 * THE SEARCH CACHE, ON THE TABLE HOMATCH ALREADY HAS.
 *
 * `research_cache` is the store for fetched records — a unique `fingerprint`,
 * a `provider`, `query_json`, `content_hash` and a retention window. Market
 * discovery adds no table of its own; it adds rows with its own key prefix so
 * nothing it writes can collide with, or invalidate, what is already there.
 *
 * ── A CACHE FAILURE IS A CACHE MISS ──────────────────────────────────
 *
 * Every operation here is wrapped. A missing column, a permissions change or a
 * slow table must be able to make discovery more expensive and must never be
 * able to make it fail, because the alternative is a verification that dies on
 * an optimisation.
 */

import { sha256Hex } from '../../research-core/core/sha256.ts';
import type { CachedSearch, SearchCacheStore } from './searchCache.ts';

/** Matches the existing rule: keys this code writes are version-prefixed. */
const PROVIDER_TAG = 'market-discovery-search';

/**
 * A fingerprint that cannot collide with an existing one.
 *
 * `homatch-research` stores a bare 64-character SHA-256 of "mode:query:lang".
 * This is the same length and would be indistinguishable, so the hash is taken
 * over a namespaced string and the row is additionally tagged by `provider` —
 * redefining an existing fingerprint would invalidate the whole cache at once,
 * which is a real cost event rather than a slow afternoon.
 */
function fingerprintFor(key: string): string {
  return sha256Hex(`${PROVIDER_TAG}:${key}`);
}

/**
 * Only the two calls this file makes.
 *
 * Narrow on purpose: a cache has no business being handed something that can
 * write to every table, and the narrow shape documents exactly what a caller
 * has to supply for it to work.
 */
interface CacheQuery {
  eq(col: string, value: string): CacheQuery;
  maybeSingle(): Promise<{ data: unknown }>;
}

interface MinimalClient {
  from(table: string): {
    select(cols: string): CacheQuery;
    upsert(row: Record<string, unknown>, options?: { onConflict?: string }): Promise<unknown>;
  };
}

export function supabaseSearchCache(
  db: MinimalClient,
  options: { retentionHours?: number } = {},
): SearchCacheStore {
  const retentionHours = options.retentionHours ?? 24;

  return {
    async get(key: string): Promise<CachedSearch | null> {
      try {
        const fingerprint = fingerprintFor(key);
        const { data } = await db
          .from('research_cache')
          .select('query_json, created_at')
          .eq('fingerprint', fingerprint)
          .eq('provider', PROVIDER_TAG)
          .maybeSingle();
        const row = data as { query_json?: unknown; created_at?: string } | null;
        const payload = row?.query_json as { hits?: unknown; storedAt?: number } | undefined;
        if (!payload || !Array.isArray(payload.hits)) return null;
        const storedAt = typeof payload.storedAt === 'number'
          ? payload.storedAt
          : Date.parse(row?.created_at ?? '') || 0;
        return { hits: payload.hits as CachedSearch['hits'], storedAt };
      } catch {
        return null;
      }
    },

    async set(key: string, value: CachedSearch): Promise<void> {
      try {
        const fingerprint = fingerprintFor(key);
        const payload = { hits: value.hits, storedAt: value.storedAt };
        const body = JSON.stringify(payload);
        await db.from('research_cache').upsert(
          {
            fingerprint,
            provider: PROVIDER_TAG,
            query_json: payload,
            content_hash: sha256Hex(body),
            retention_expires_at: new Date(
              value.storedAt + retentionHours * 3600_000,
            ).toISOString(),
          },
          { onConflict: 'fingerprint' },
        );
      } catch {
        // Bookkeeping only.
      }
    },
  };
}
