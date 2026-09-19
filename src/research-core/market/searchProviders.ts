/*
 * WHO ANSWERS A DISCOVERY QUERY.
 *
 * The engine in discoveryRun.ts never chooses a provider, because choosing one
 * is an operational decision with a price attached. These are the adapters it
 * can be handed.
 *
 * ── THERE IS NO PAID-PROVIDER RUNG IN HERE ───────────────────────
 *
 * Research Core contains no vendor adapter, by a rule this repository enforces
 * in src/research-core/__tests__/discoveryLadder.test.mjs: the discovery
 * function that preceded this one was built entirely on bought SERP calls and
 * has no capability today, because everything it could do it could only do by
 * paying. A vendor adapter therefore lives OUTSIDE the core, is supplied by the
 * caller, and satisfies the same one-method contract as everything here does.
 *
 * What the core does own is the consequence: a provider that will not answer
 * produces PROVIDER_LOCKED, which is a statement about us. It must never be
 * rendered as a market with nothing on it — that confusion is the whole reason
 * a street carrying hundreds of public listings was reported as SAME_STREET = 0.
 */

import type { DiscoveryQuery } from './discoveryPlan.ts';
import type { SearchHit, SearchProvider, SearchResponse } from './discoveryRun.ts';

/* ------------------------------------------------------------------ *
 * A recorded harvest                                                  *
 * ------------------------------------------------------------------ */

export interface HarvestedResult extends SearchHit {
  /** The query that surfaced it, verbatim, so a replay is honest. */
  query: string;
}

/**
 * Replays results that a real search engine really returned.
 *
 * This is how the acceptance fixture runs the PRODUCTION engine over PRODUCTION
 * evidence without a network or a bill: the rows are raw index output, the
 * extraction, address resolution, project identity and tiering are the real
 * code, and if any of them regress the fixture fails.
 *
 * It is not a stand-in for a provider in production. A run served by this
 * reports its id, and `providerStatus` stays OK only because these results
 * genuinely came back.
 */
export function harvestProvider(rows: readonly HarvestedResult[], id = 'HARVEST'): SearchProvider {
  const byQuery = new Map<string, SearchHit[]>();
  for (const r of rows) {
    const key = r.query.trim().toLocaleLowerCase();
    const list = byQuery.get(key) ?? [];
    list.push({ url: r.url, title: r.title, snippet: r.snippet });
    byQuery.set(key, list);
  }
  return {
    id,
    async search(query: DiscoveryQuery): Promise<SearchResponse> {
      return { status: 'OK', hits: byQuery.get(query.text.trim().toLocaleLowerCase()) ?? [] };
    },
  };
}

/**
 * A SERP payload, reduced to the three fields that carry evidence.
 *
 * Tolerant of shape on purpose: a provider reorganising its envelope must not
 * be able to silently turn discovery into zero results, which is the exact
 * class of failure this whole layer exists to make visible.
 */
export function normaliseSerp(payload: unknown): SearchHit[] {
  const out: SearchHit[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : null;
    if (url) {
      out.push({
        url,
        title: typeof o.title === 'string' ? o.title : '',
        snippet: typeof o.description === 'string' ? o.description
          : typeof o.snippet === 'string' ? o.snippet : '',
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
  };
  visit(payload);

  const seen = new Set<string>();
  return out.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
}

/**
 * A provider that cannot answer, and says so.
 *
 * The honest default when no search lane is configured. Returning zero results
 * from a provider that was never asked would be indistinguishable from a
 * street with nothing for sale on it — the precise confusion that produced
 * SAME_STREET = 0 in the first place.
 */
export const noSearchProvider: SearchProvider = {
  id: 'NONE',
  async search(): Promise<SearchResponse> {
    return { status: 'PROVIDER_LOCKED', hits: [], detail: 'no search provider configured' };
  },
};
