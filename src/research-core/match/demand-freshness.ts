// HOMATCH RESEARCH CORE — is this demand still demand?
//
// A buyer post from 2009 reached a customer's Find Buyers list as a paid
// opportunity, because active-match eligibility had no age limit at all: the
// delivery gate checks when WE last verified the evidence, not when the
// person actually spoke. This module is the missing half — the policy for
// how old a demand signal may be and still count as a CURRENT opportunity.
//
// Three commitments, in order:
//
//   1. ANCIENT DEMAND IS NOT A MATCH. Past a hard ceiling the signal is
//      ineligible, full stop. The row itself is untouched — history,
//      provenance and entity context keep it — but no new active match is
//      created from it.
//   2. AGE DECAYS RANK. Between "fresh" and the ceiling, the compatibility
//      score is multiplied down, so a perfect-fit six-month-old post sits
//      below a good-fit post from this week instead of above it.
//   3. UNDATED IS NOT FRESH. A post whose publication date we could not
//      read gets a flat penalty and can never reach the top factor. It is
//      not rejected — absence of a date is not evidence of age (see
//      coverage.ts) — but it is never treated as new either. The database's
//      own created_at is NEVER a substitute: that records when we ingested
//      it, and "we found this today" is not "this was posted today".
//
// One table, used by every matcher (run-matching-v2, supply-matching's
// demand side, and any future ranker), so there is exactly one place where
// "too old" is defined.

export type DemandTransaction = 'RENT' | 'SALE' | string | null | undefined;

export type DemandFreshnessReason =
  | 'FRESH'     // within the fresh window — full factor
  | 'AGING'     // recent enough to act on, mildly decayed
  | 'OLD'       // still plausible, clearly decayed
  | 'STALE'     // near the ceiling — eligible, heavily decayed
  | 'ANCIENT'   // past the ceiling — ineligible for an active match
  | 'UNDATED';  // no readable publication date — flat penalty, never fresh

export interface DemandFreshnessVerdict {
  /** May an ACTIVE match be created from this signal at all? */
  eligible: boolean;
  /** Multiplier for the compatibility score. 0 when ineligible. */
  factor: number;
  /** Whole days since publication, or null when the date is unreadable. */
  ageDays: number | null;
  reason: DemandFreshnessReason;
}

const DAY_MS = 86_400_000;

/**
 * Hard ceilings by transaction, in days. Rental demand expires faster than
 * purchase demand: someone who needed a flat six months ago has one.
 */
export const DEMAND_MAX_AGE_DAYS: Record<'RENT' | 'SALE' | 'DEFAULT', number> = {
  RENT: 180,
  SALE: 365,
  DEFAULT: 365,
};

/** The decay steps, applied to whichever ceiling governs the signal. */
const DECAY: ReadonlyArray<{ upToDays: number; factor: number; reason: DemandFreshnessReason }> = [
  { upToDays: 14, factor: 1.0, reason: 'FRESH' },
  { upToDays: 60, factor: 0.92, reason: 'AGING' },
  { upToDays: 180, factor: 0.8, reason: 'OLD' },
  { upToDays: Number.POSITIVE_INFINITY, factor: 0.6, reason: 'STALE' },
];

/** The flat factor for a signal with no readable publication date. */
export const UNDATED_DEMAND_FACTOR = 0.75;

export function demandAgeCeilingDays(transaction: DemandTransaction): number {
  const key = String(transaction ?? '').toUpperCase();
  if (key === 'RENT') return DEMAND_MAX_AGE_DAYS.RENT;
  if (key === 'SALE') return DEMAND_MAX_AGE_DAYS.SALE;
  return DEMAND_MAX_AGE_DAYS.DEFAULT;
}

export function judgeDemandFreshness(
  publishedAt: string | number | Date | null | undefined,
  opts: { now?: number; transaction?: DemandTransaction } = {},
): DemandFreshnessVerdict {
  const now = opts.now ?? Date.now();

  let publishedMs: number | null = null;
  if (publishedAt !== null && publishedAt !== undefined && publishedAt !== '') {
    const parsed = publishedAt instanceof Date ? publishedAt.getTime() : new Date(publishedAt).getTime();
    if (!Number.isNaN(parsed)) publishedMs = parsed;
  }

  // Unreadable — and a FUTURE date is unreadable too: a post "from next
  // month" is a data error, and treating it as brand-new would reward
  // exactly the kind of source that lies about dates.
  if (publishedMs === null || publishedMs > now) {
    return { eligible: true, factor: UNDATED_DEMAND_FACTOR, ageDays: null, reason: 'UNDATED' };
  }

  const ageDays = Math.floor((now - publishedMs) / DAY_MS);
  if (ageDays > demandAgeCeilingDays(opts.transaction)) {
    return { eligible: false, factor: 0, ageDays, reason: 'ANCIENT' };
  }

  const step = DECAY.find((d) => ageDays <= d.upToDays) ?? DECAY[DECAY.length - 1];
  return { eligible: true, factor: step.factor, ageDays, reason: step.reason };
}
