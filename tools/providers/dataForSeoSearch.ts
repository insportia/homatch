/*
 * THE BOUGHT SEARCH LANE, OUTSIDE THE CORE ON PURPOSE.
 *
 * Research Core may contain no vendor adapter — enforced by
 * src/research-core/__tests__/discoveryLadder.test.mjs, because the discovery
 * function that preceded this one was built entirely on bought SERP calls and
 * therefore has no capability today. So this satisfies the same one-method
 * SearchProvider contract from outside, and the core stays free of it.
 *
 * ── THE LOCK IS RESPECTED, NOT ROUTED AROUND ────────────────────
 *
 * The edge function this calls currently answers every request with HTTP 423
 * and `paidLaunchesBlocked: true` — a deliberate kill switch held while
 * production readiness is verified. This adapter CALLS THAT FUNCTION and
 * reports the lock. It does not read vendor credentials, does not talk to the
 * vendor directly, and has no bypass flag, because a kill switch with a bypass
 * is a comment.
 *
 * The consequence is stated wherever it matters: while the lock holds, the
 * bought search lane cannot run, and a run that could not ask is reported as a
 * run that could not ask — never as a market with nothing on it.
 */

import type { DiscoveryQuery } from '../../src/research-core/market/discoveryPlan.ts';
import type { SearchProvider, SearchResponse } from '../../src/research-core/market/discoveryRun.ts';
import { normaliseSerp } from '../../src/research-core/market/searchProviders.ts';

export interface DataForSeoOptions {
  /** Base URL of the Supabase functions host. */
  functionsUrl: string;
  /** The caller's own authorisation. Never a vendor credential. */
  authorization?: string | null;
  /** Georgia; overridable so the adapter is not Tbilisi-shaped. */
  locationName?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The real search-engine lane, gated by the existing edge function.
 *
 * COST, stated because activating it is not this module's decision: DataForSEO
 * bills per SERP request. A full multilingual discovery plan for one property
 * is on the order of 20–60 requests, so a run costs roughly 20–60 SERP calls —
 * material at Verify volume, which is exactly why the switch exists.
 */
export function dataForSeoProvider(options: DataForSeoOptions): SearchProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${options.functionsUrl.replace(/\/+$/, '')}/dataforseo-search`;
  return {
    id: 'DATAFORSEO',
    async search(query: DiscoveryQuery): Promise<SearchResponse> {
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.authorization ? { authorization: options.authorization } : {}),
          },
          body: JSON.stringify({
            keyword: query.text,
            language_code: query.language,
            location_name: options.locationName ?? 'Georgia',
          }),
        });
        const body = await res.json().catch(() => null) as
          | { success?: boolean; paidLaunchesBlocked?: boolean; error?: string; results?: unknown }
          | null;

        if (res.status === 423 || body?.paidLaunchesBlocked) {
          return {
            status: 'PROVIDER_LOCKED',
            hits: [],
            detail: body?.error ?? 'paid external discovery is locked',
          };
        }
        if (!res.ok || body?.success === false) {
          return { status: 'PROVIDER_ERROR', hits: [], detail: `http ${res.status}` };
        }
        return { status: 'OK', hits: normaliseSerp(body?.results) };
      } catch (e) {
        return { status: 'PROVIDER_ERROR', hits: [], detail: String(e).slice(0, 120) };
      }
    },
  };
}
