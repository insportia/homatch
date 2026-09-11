// HOMATCH — is what we already know still good enough to lean on?
//
// This is the question that decides whether a verification costs money. Not
// "do we have a report" — a cached report cannot be partially refreshed and
// cannot say which of its claims has gone out of date — but, fact by fact:
//
//   do we know this, from what, is that still fresh, and has it changed?
//
// TWO RULES RUN THROUGH ALL OF IT.
//
// OLD IS NOT WRONG. A stale fact is one that must be RE-CHECKED before a
// report leans on it. It is not known to be false and is not thrown away: it
// stays as the previous value, and if the re-check agrees, the fact was right
// all along and is now also current.
//
// FRESHNESS IS A PROPERTY OF THE KIND OF FACT, NOT OF THE PIPELINE. Ownership
// can change between agreeing a price and signing. A building does not gain a
// floor. One TTL for both is either wasteful or dangerous, and in practice it
// is both at once — too slow for the mortgage, too eager for the floor count.

/** How fast a kind of fact goes out of date. */
export type FreshnessClass = 'HIGH_VOLATILITY' | 'MEDIUM_VOLATILITY' | 'LOW_VOLATILITY';

/** A row of intelligence_freshness_policy. */
export interface FreshnessPolicy {
  fact_key_pattern: string;
  freshness_class: FreshnessClass;
  max_age_hours: number;
}

/** The parts of a stored fact this module needs to judge it. */
export interface KnownFact {
  fact_key: string;
  status?: string | null;
  last_verified_at?: string | null;
  freshness_class?: FreshnessClass | null;
  content_hash?: string | null;
  source_ref?: string | null;
}

/**
 * The policy that governs a fact key.
 *
 * A pattern ending in '.' is a prefix — 'encumbrance.' covers every kind of
 * encumbrance without listing them — and an exact match always wins over a
 * prefix, so 'listing.price' can be governed more tightly than 'listing.'
 * without the general rule having to know it exists.
 *
 * Between two prefixes the LONGER one wins, because it is the more specific
 * statement about this fact.
 */
export function policyFor(
  factKey: string,
  policies: readonly FreshnessPolicy[] | null | undefined
): FreshnessPolicy | null {
  if (!factKey || !Array.isArray(policies) || !policies.length) return null;

  const exact = policies.find((p) => p.fact_key_pattern === factKey);
  if (exact) return exact;

  const prefixes = policies
    .filter((p) => p.fact_key_pattern.endsWith('.') && factKey.startsWith(p.fact_key_pattern))
    .sort((a, b) => b.fact_key_pattern.length - a.fact_key_pattern.length);

  return prefixes[0] ?? null;
}

export type FactState =
  /** Known, fresh, and usable as it stands. */
  | 'FRESH'
  /** Known, but past its policy age. Re-check before relying on it. */
  | 'STALE'
  /** Known and explicitly marked as contradicted by other evidence. */
  | 'CONFLICTING'
  /** We do not hold this fact at all. */
  | 'MISSING';

export interface FactAssessment {
  factKey: string;
  state: FactState;
  ageHours: number | null;
  maxAgeHours: number | null;
  freshnessClass: FreshnessClass | null;
  /** Why this fact does or does not need paying for again. */
  reason: string;
}

const hoursBetween = (from: string | null | undefined, nowMs: number): number | null => {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 3_600_000);
};

/**
 * Whether one fact we hold can be used as it stands.
 *
 * A fact with no policy is treated as STALE rather than fresh. That is
 * deliberate and is the safe direction: an unknown fact kind is one nobody
 * has thought about yet, and assuming it ages slowly would silently reuse
 * something that might change hourly. The cost of being wrong here is one
 * re-check; the cost of the opposite is a report that says a property is
 * unencumbered when it no longer is.
 */
export function assessFact(
  factKey: string,
  fact: KnownFact | null | undefined,
  policies: readonly FreshnessPolicy[] | null | undefined,
  now: Date | number = Date.now()
): FactAssessment {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const policy = policyFor(factKey, policies);
  const maxAgeHours = policy?.max_age_hours ?? null;
  const freshnessClass = policy?.freshness_class ?? null;

  if (!fact || fact.status === 'SUPERSEDED') {
    return {
      factKey, state: 'MISSING', ageHours: null, maxAgeHours, freshnessClass,
      reason: 'not held',
    };
  }

  if (fact.status === 'CONFLICTING') {
    return {
      factKey, state: 'CONFLICTING', ageHours: hoursBetween(fact.last_verified_at, nowMs), maxAgeHours, freshnessClass,
      reason: 'contradicted by other evidence',
    };
  }

  const ageHours = hoursBetween(fact.last_verified_at, nowMs);

  if (fact.status === 'STALE') {
    return { factKey, state: 'STALE', ageHours, maxAgeHours, freshnessClass, reason: 'marked stale' };
  }

  if (!policy) {
    return {
      factKey, state: 'STALE', ageHours, maxAgeHours, freshnessClass,
      reason: 'no freshness policy for this kind of fact',
    };
  }

  if (ageHours === null) {
    return {
      factKey, state: 'STALE', ageHours, maxAgeHours, freshnessClass,
      reason: 'never verified',
    };
  }

  if (ageHours > policy.max_age_hours) {
    return {
      factKey, state: 'STALE', ageHours, maxAgeHours, freshnessClass,
      reason: `${Math.round(ageHours)}h old, policy allows ${policy.max_age_hours}h`,
    };
  }

  return {
    factKey, state: 'FRESH', ageHours, maxAgeHours, freshnessClass,
    reason: `${Math.round(ageHours)}h old, within ${policy.max_age_hours}h`,
  };
}

/* ------------------------------------------------------------------ *
 * The gate                                                            *
 * ------------------------------------------------------------------ */

export interface RefreshPlan {
  /** Fact keys that must be researched again, with the reason for each. */
  refresh: FactAssessment[];
  /** Fact keys we hold and may use as they stand. */
  reuse: FactAssessment[];
  /** True when something has to be paid for. */
  needsResearch: boolean;
  /**
   * A short, internal explanation of why this verification cost what it cost.
   * Recorded against the job, never shown to a customer.
   */
  reason: string;
}

/**
 * What a verification actually has to go and find out.
 *
 * The point of the whole intelligence layer, in one function: given the facts
 * a report needs and the facts we already hold, decide which of them must be
 * paid for again.
 *
 * A stage that has nothing to refresh should not run. A stage that has one
 * stale fact should run for that fact.
 */
export function planRefresh(
  required: readonly string[],
  held: readonly KnownFact[] | null | undefined,
  policies: readonly FreshnessPolicy[] | null | undefined,
  now: Date | number = Date.now()
): RefreshPlan {
  const byKey = new Map<string, KnownFact>();
  for (const f of held ?? []) {
    // Only a CURRENT fact can be reused. A superseded one is history.
    if (f && f.fact_key && f.status !== 'SUPERSEDED') byKey.set(f.fact_key, f);
  }

  const assessments = [...new Set(required)].map((k) => assessFact(k, byKey.get(k), policies, now));
  const refresh = assessments.filter((a) => a.state !== 'FRESH');
  const reuse = assessments.filter((a) => a.state === 'FRESH');

  const missing = refresh.filter((a) => a.state === 'MISSING').length;
  const stale = refresh.filter((a) => a.state === 'STALE').length;
  const conflicting = refresh.filter((a) => a.state === 'CONFLICTING').length;

  const parts: string[] = [];
  if (missing) parts.push(`${missing} missing`);
  if (stale) parts.push(`${stale} stale`);
  if (conflicting) parts.push(`${conflicting} conflicting`);
  if (reuse.length) parts.push(`${reuse.length} reused`);

  return {
    refresh,
    reuse,
    needsResearch: refresh.length > 0,
    reason: parts.join(', ') || 'nothing required',
  };
}

/* ------------------------------------------------------------------ *
 * Source-level change detection                                       *
 * ------------------------------------------------------------------ */

export type SourceVerdict = 'UNCHANGED' | 'CHANGED' | 'UNKNOWN';

/**
 * Has the source itself changed since we read it?
 *
 * The cheapest possible question, and the one worth asking before any paid
 * interpretation: if the registry extract carries the same version, or the
 * page the same hash, then whatever we concluded from it last time is still
 * what it says, and re-reading it buys nothing.
 *
 * UNKNOWN is a real answer and must not be read as UNCHANGED. Missing a hash
 * means we cannot tell, and "we cannot tell" has to cost a re-check —
 * otherwise the first source that stops exposing a version silently freezes
 * its facts for ever.
 */
export function compareSource(
  previous: { content_hash?: string | null; source_ref?: string | null } | null | undefined,
  current: { content_hash?: string | null; source_ref?: string | null } | null | undefined
): SourceVerdict {
  const pHash = previous?.content_hash?.trim();
  const cHash = current?.content_hash?.trim();
  if (pHash && cHash) return pHash === cHash ? 'UNCHANGED' : 'CHANGED';

  // A document revision or registry version is as good as a hash, and is
  // often the only thing an official source exposes.
  const pRef = previous?.source_ref?.trim();
  const cRef = current?.source_ref?.trim();
  if (pRef && cRef) return pRef === cRef ? 'UNCHANGED' : 'CHANGED';

  return 'UNKNOWN';
}
