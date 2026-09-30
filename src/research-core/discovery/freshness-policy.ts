// HOMATCH RESEARCH CORE — THE ONE ACTIVE-DEMAND FRESHNESS POLICY.
//
// Find Buyers / Find Tenants promises people who are interested NOW. Before
// this module there were three answers to "how old may demand be": a 7-day
// evidence-verification window, a 180-day (rent) / 365-day (sale) ceiling
// with a score multiplier, and nothing at all on already-stored matches. A
// 2009 forum post reached a customer as a current buyer through that gap.
//
// This replaces all of them for ACTIVE EXTERNAL DEMAND with one rule, owned by
// Admin through one setting (`discovery_freshness_policy`):
//
//   published 0–7 days ago     STRONGEST     eligible
//   published 8–14 days ago    VERY_FRESH    eligible
//   published 15–30 days ago   ELIGIBLE      eligible, progressively weaker
//   published > 30 days ago    STALE         NOT eligible — a gate, not a penalty
//   publication date unknown   UNDATED       NOT eligible by default
//   publication date in future INVALID_DATE  NOT eligible
//
// The clock is the ORIGINAL PUBLICATION time. When HOMATCH discovered the
// post, when the row was created, when we last re-read it: none of these is a
// substitute, and none is accepted here — the function takes publishedAt and
// nothing else that could be mistaken for it.
//
// Stale and undated rows are not deleted. They stay as history, provenance,
// dedupe keys and analytics. They are simply never an active result.
//
// What the ranking weight is for: ORDERING WITHIN THE ELIGIBLE SET. It is not
// a way to let an ineligible signal through at a discount; an ineligible
// verdict always carries weight 0.

const DAY_MS = 86_400_000;

export type ActiveDemandBand =
  | 'STRONGEST'
  | 'VERY_FRESH'
  | 'ELIGIBLE'
  | 'STALE'
  | 'UNDATED'
  | 'INVALID_DATE';

export interface ActiveDemandFreshnessPolicy {
  /** The normal maximum age of active external demand, in days. */
  activeMaxDays: number;
  /** The strongest band ends here. */
  strongestDays: number;
  /** The very-fresh band ends here. */
  veryFreshDays: number;
  /**
   * The safety ceiling nothing may exceed — not a campaign override, not a
   * per-source setting, not a customer widening.
   */
  hardMaxDays: number;
  /**
   * Per-source maxima (TELEGRAM, FORUM, …). Only ever TIGHTER than or equal to
   * hardMaxDays; a source value above the ceiling is clamped, not honoured.
   */
  sourceMaxDays: Record<string, number>;
  /** Whether a campaign may widen the window at all, and to what. */
  customerMayWiden: boolean;
  customerMaxDays: number;
  /** Undated demand: never active by default. */
  undatedEligible: boolean;
  /** Tolerated clock skew before a future date is treated as invalid. */
  futureSkewHours: number;
}

export const DEFAULT_ACTIVE_DEMAND_POLICY: Readonly<ActiveDemandFreshnessPolicy> = Object.freeze({
  activeMaxDays: 30,
  strongestDays: 7,
  veryFreshDays: 14,
  hardMaxDays: 60,
  sourceMaxDays: {},
  customerMayWiden: false,
  customerMaxDays: 45,
  undatedEligible: false,
  futureSkewHours: 24,
});

const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Parse the admin setting into a coherent policy.
 *
 * Coherence is enforced here, so that no combination of admin edits can
 * produce a policy that contradicts itself: bands are ordered, the active
 * window never exceeds the hard ceiling, and neither per-source nor customer
 * maxima can exceed it either. A malformed setting falls back to the default,
 * which IS the policy — never to "no limit".
 */
export function parseActiveDemandPolicy(raw: unknown): ActiveDemandFreshnessPolicy {
  let v: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) ?? {}; } catch { v = {}; }
  } else if (raw && typeof raw === 'object') {
    v = raw as Record<string, unknown>;
  }
  const d = DEFAULT_ACTIVE_DEMAND_POLICY;
  const hardMaxDays = int(v.hardMaxDays, 1, 365, d.hardMaxDays);
  const activeMaxDays = int(v.activeMaxDays, 1, hardMaxDays, Math.min(d.activeMaxDays, hardMaxDays));
  const strongestDays = int(v.strongestDays, 0, activeMaxDays, Math.min(d.strongestDays, activeMaxDays));
  const veryFreshDays = int(v.veryFreshDays, strongestDays, activeMaxDays, Math.max(strongestDays, Math.min(d.veryFreshDays, activeMaxDays)));
  const sourceMaxDays: Record<string, number> = {};
  if (v.sourceMaxDays && typeof v.sourceMaxDays === 'object') {
    for (const [source, days] of Object.entries(v.sourceMaxDays as Record<string, unknown>)) {
      const n = int(days, 1, hardMaxDays, NaN);
      if (Number.isFinite(n)) sourceMaxDays[source.toUpperCase()] = n;
    }
  }
  return {
    activeMaxDays,
    strongestDays,
    veryFreshDays,
    hardMaxDays,
    sourceMaxDays,
    customerMayWiden: v.customerMayWiden === true,
    customerMaxDays: int(v.customerMaxDays, activeMaxDays, hardMaxDays, Math.max(activeMaxDays, Math.min(d.customerMaxDays, hardMaxDays))),
    undatedEligible: v.undatedEligible === true,
    futureSkewHours: int(v.futureSkewHours, 0, 72, d.futureSkewHours),
  };
}

/**
 * The window that actually applies to one signal from one source in one
 * campaign. The campaign may only widen when the policy allows it, and never
 * past the customer maximum; the source may only narrow.
 */
export function effectiveMaxDays(
  policy: ActiveDemandFreshnessPolicy,
  options: { source?: string | null; campaignMaxDays?: number | null } = {},
): number {
  let days = policy.activeMaxDays;
  const requested = Number(options.campaignMaxDays);
  if (Number.isFinite(requested) && requested > 0) {
    days = requested <= policy.activeMaxDays
      ? Math.trunc(requested)
      : policy.customerMayWiden ? Math.min(Math.trunc(requested), policy.customerMaxDays) : policy.activeMaxDays;
  }
  const sourceCap = options.source ? policy.sourceMaxDays[String(options.source).toUpperCase()] : undefined;
  if (sourceCap !== undefined) days = Math.min(days, sourceCap);
  return Math.max(1, Math.min(days, policy.hardMaxDays));
}

export interface ActiveDemandVerdict {
  eligible: boolean;
  band: ActiveDemandBand;
  /** Whole days since ORIGINAL publication; null when unknown. */
  ageDays: number | null;
  /** The window this verdict was judged against. */
  maxDays: number;
  /** Ranking weight inside the eligible set; 0 whenever ineligible. */
  weight: number;
  /** True when the campaign asked for, and got, a wider-than-normal window. */
  widened: boolean;
  reason: string;
}

export function judgeActiveDemand(
  publishedAt: string | number | Date | null | undefined,
  options: {
    policy?: ActiveDemandFreshnessPolicy;
    now?: number;
    source?: string | null;
    campaignMaxDays?: number | null;
  } = {},
): ActiveDemandVerdict {
  const policy = options.policy ?? DEFAULT_ACTIVE_DEMAND_POLICY;
  const now = options.now ?? Date.now();
  const maxDays = effectiveMaxDays(policy, options);
  const widened = maxDays > policy.activeMaxDays;

  let ms: number | null = null;
  if (publishedAt !== null && publishedAt !== undefined && publishedAt !== '') {
    const parsed = publishedAt instanceof Date ? publishedAt.getTime()
      : typeof publishedAt === 'number' ? publishedAt : Date.parse(publishedAt);
    if (Number.isFinite(parsed)) ms = parsed;
  }

  if (ms === null) {
    return {
      eligible: policy.undatedEligible, band: 'UNDATED', ageDays: null, maxDays,
      weight: policy.undatedEligible ? 0.5 : 0, widened,
      reason: 'original publication date unknown — freshness uncertain',
    };
  }
  if (ms > now + policy.futureSkewHours * 3_600_000) {
    return {
      eligible: false, band: 'INVALID_DATE', ageDays: null, maxDays, weight: 0, widened,
      reason: 'publication date is in the future',
    };
  }

  const ageDays = Math.max(0, Math.floor((now - ms) / DAY_MS));
  if (ageDays > maxDays) {
    return {
      eligible: false, band: 'STALE', ageDays, maxDays, weight: 0, widened,
      reason: `published ${ageDays} days ago — outside the ${maxDays}-day active window`,
    };
  }
  if (ageDays <= policy.strongestDays) {
    return { eligible: true, band: 'STRONGEST', ageDays, maxDays, weight: 1, widened, reason: `published ${ageDays} day(s) ago` };
  }
  if (ageDays <= policy.veryFreshDays) {
    return { eligible: true, band: 'VERY_FRESH', ageDays, maxDays, weight: 0.9, widened, reason: `published ${ageDays} days ago` };
  }
  /* Linear from 0.8 at the end of the very-fresh band down to 0.5 at the edge. */
  const span = Math.max(1, maxDays - policy.veryFreshDays);
  const weight = Math.round((0.8 - 0.3 * ((ageDays - policy.veryFreshDays) / span)) * 1000) / 1000;
  return {
    eligible: true, band: 'ELIGIBLE', ageDays, maxDays, weight: Math.max(0.5, weight), widened,
    reason: `published ${ageDays} days ago — eligible, weaker`,
  };
}

/** The earliest publication time still eligible — for query floors and scan depth. */
export function activeWindowStart(
  policy: ActiveDemandFreshnessPolicy,
  options: { now?: number; source?: string | null; campaignMaxDays?: number | null } = {},
): Date {
  return new Date((options.now ?? Date.now()) - effectiveMaxDays(policy, options) * DAY_MS);
}
