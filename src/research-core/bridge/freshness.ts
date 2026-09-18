// HOMATCH RESEARCH CORE — two different questions about "how old is too old".
//
// They get confused constantly, and confusing them is how a six-hour mortgage
// check ends up answered from a day-old page.
//
//   HTTP DOCUMENT FRESHNESS   How long may we reuse the bytes of this page
//                             before fetching it again? A property of the
//                             SOURCE. Lives in SourcePolicy.cacheTtlMs, and is
//                             the only kind this core decides.
//
//   FACT FRESHNESS            How long does what the page SAID stay good?
//                             A property of the KIND OF FACT. Ownership
//                             changes on a Tuesday; a building does not gain a
//                             floor. Homatch decides this in
//                             intelligence_freshness_policy, per fact-key
//                             pattern, in the database, and
//                             src/verify/intelligence/freshness.ts implements
//                             the judgement.
//
// THE CORE MUST NOT DECIDE THE SECOND ONE. The DB-driven model is richer than
// any static table this core could carry, it is already seeded and tested, and
// a duplicate would be a second answer that drifts. So this file's job is to
// keep the two apart and to DELEGATE the fact question, never to answer it.
//
// It is also why the core cannot just serve a cached page and call the facts
// current. A fresh document can carry a stale fact — the page simply has not
// been updated — and only the fact-level policy knows the difference.

import type { ResolvedSourcePolicy } from '../net/source-policy.ts';

/** Matches `research_cache.freshness_status`, exactly. */
export type CacheFreshness = 'LIVE' | 'FRESH' | 'AGING' | 'STALE';

export interface DocumentAgeVerdict {
  status: CacheFreshness;
  ageMs: number;
  /** Serve immediately. True for everything except STALE. */
  usable: boolean;
  /**
   * Serve the copy we have AND refresh behind it. True only for AGING, which
   * is the whole point of the status existing.
   */
  refreshBehind: boolean;
}

/**
 * Judge a cached DOCUMENT against its source's policy.
 *
 * LIVE    fetched within the last minute; another request just did this.
 * FRESH   inside cacheTtlMs. Serve it, do nothing else.
 * AGING   past the TTL but inside the stale window. Serve it and refresh
 *         behind it — the customer waits for nothing and the next request
 *         gets the new copy.
 * STALE   past the stale window. Do not serve; fetch.
 */
export function judgeDocumentAge(
  retrievedAtIso: string,
  policy: Pick<ResolvedSourcePolicy, 'cacheTtlMs' | 'cacheStaleMs'>,
  now: number = Date.now(),
): DocumentAgeVerdict {
  const retrievedAt = Date.parse(retrievedAtIso);
  if (!Number.isFinite(retrievedAt)) {
    // An unparseable timestamp is not evidence of freshness.
    return { status: 'STALE', ageMs: Number.POSITIVE_INFINITY, usable: false, refreshBehind: false };
  }

  const ageMs = Math.max(0, now - retrievedAt);
  // LIVE is a subset of FRESH, never a way past the TTL. A source configured
  // with a thirty-second lifetime must not have a five-minute-old copy called
  // "live" because sixty seconds is a nice round number.
  const liveWindowMs = Math.min(60_000, policy.cacheTtlMs);
  if (ageMs <= liveWindowMs) return { status: 'LIVE', ageMs, usable: true, refreshBehind: false };
  if (ageMs <= policy.cacheTtlMs) return { status: 'FRESH', ageMs, usable: true, refreshBehind: false };
  if (ageMs <= policy.cacheTtlMs + policy.cacheStaleMs) {
    return { status: 'AGING', ageMs, usable: true, refreshBehind: true };
  }
  return { status: 'STALE', ageMs, usable: false, refreshBehind: false };
}

/**
 * The fact-freshness question, as a PORT.
 *
 * The implementation lives outside the core, in the edge function that can
 * read intelligence_freshness_policy and call the existing
 * src/verify/intelligence/freshness.ts. The core only ever asks.
 */
export interface FactFreshnessPort {
  /**
   * Does this fact need re-checking before a report leans on it?
   *
   * Old is not wrong: a stale fact is one that must be RE-CHECKED, not one
   * known to be false and not one to throw away. That rule belongs to the
   * existing implementation and is restated here so a future implementor of
   * this interface inherits it.
   */
  needsRecheck(input: {
    entityId: string | null;
    factKey: string;
    lastVerifiedAt: string | null;
  }): Promise<boolean>;
}

/**
 * The port used when no implementation was supplied.
 *
 * Says everything needs re-checking. That is the safe direction: it costs
 * money, it never reports a stale fact as current, and a caller that wanted
 * reuse has to wire the real policy up — which is a visible omission rather
 * than a silent one.
 */
export const alwaysRecheck: FactFreshnessPort = {
  async needsRecheck(): Promise<boolean> {
    return true;
  },
};
