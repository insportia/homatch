// HOMATCH RESEARCH CORE — how much discovery this customer has actually paid for.
//
// The ladder in ladder.ts already climbs cheapest-first and stops as soon as
// the job has what it asked for. What it could not do is stop because the
// CUSTOMER'S ENTITLEMENT ran out, or refuse a source because the customer's
// plan does not reach that far down the priority list. Without that, one
// campaign on the free plan can fan out across every registered source, and
// a hundred registered sources turn a single cheap search into a hundred
// outbound fetches.
//
// THIS DOES NOT INVENT A BILLING SYSTEM.
//
// product_plan_entitlements already exists and already carries every number
// this needs. Read out of production on 2026-09-26:
//
//   product_code    plan     quality_tier  result_ceiling  budget_cents  priority_level
//   FIND_CLIENTS    FREE     STANDARD      10              200           0
//   FIND_CLIENTS    VIP      ENHANCED      30              600           1
//   FIND_CLIENTS    PREMIUM  MAXIMUM       75              1500          2
//   BROKER_FINDER   FREE     STANDARD      5               90            0
//   BROKER_FINDER   PREMIUM  MAXIMUM       40              700           2
//
// So the ladder does not need a new budget model. It needs to be told to
// read the one the billing system has been keeping all along.
//
// THE TWO LADDERS LINE UP ALREADY, WHICH IS WHY THIS IS SMALL.
//
// priority_level on the entitlement runs 0, 1, 2 for FREE, VIP and PREMIUM.
// source_registry.priority_tier runs 0..3 for P0 critical, P1 high, P2
// secondary and P3 experimental. Those are the same axis pointing the same
// way, so "how far down the source list may this plan reach" is one
// comparison rather than a mapping table somebody has to maintain.
//
// WHAT IT REFUSES TO MAKE UP
//
// A cost in cents that nobody measured. provider_budget_ceiling_cents is
// null on several products, and an unmeasured ceiling is reported as null and
// bounded by JOB COUNT instead. Inventing "about a cent a fetch" here would
// put a number with no measurement behind it in front of a spend guard, and
// the guard would then be enforcing a fiction. A ceiling nobody set is
// UNKNOWN, and the honest bound for UNKNOWN is the conservative one.

/** The three tiers product_plan_entitlements actually carries. */
export type QualityTier = 'STANDARD' | 'ENHANCED' | 'MAXIMUM';

/**
 * One row of product_plan_entitlements, as the planner needs it.
 *
 * Nullable exactly where the table is nullable. A missing field is a fact
 * about the configuration, not a licence to pick a default that suits us.
 */
export interface Entitlement {
  productCode: string;
  planCode: string;
  qualityTier: QualityTier | null;
  /** How many customer-visible results this plan may end up with. */
  resultCeiling: number | null;
  /** Internal spend ceiling. Null means nobody has costed this product. */
  providerBudgetCeilingCents: number | null;
  /** 0, 1, 2 — and the same axis as source_registry.priority_tier. */
  priorityLevel: number | null;
  /**
   * How THIS run is funded, when the caller knows.
   *
   * THE RECONCILIATION THIS EXISTS FOR. Homatch's customer model is
   * pay-as-you-go: a customer buys a search. Using the subscription plan's
   * priority_level as a hard CAP on which sources that search may read turns
   * the plan into the primary discovery product and puts an unexplained
   * subscription wall in front of somebody who has just authorised credits —
   * a FREE-plan customer paying for a large campaign would still have been
   * held to P0.
   *
   * So the plan's level is a FLOOR, not a ceiling:
   *
   *   INCLUDED  this is the search the plan already covers, and the plan's
   *             own level is what it covers. Nothing extra was authorised.
   *   PAYG      the customer authorised credits for this specific search, so
   *             depth is governed by the money they authorised rather than by
   *             which subscription they hold.
   *
   * Absent means the caller did not say, and the conservative reading applies
   * -- the plan's level -- because inferring "they paid" from silence is the
   * failure that would make every search the widest one.
   */
  funding?: 'INCLUDED' | 'PAYG' | null;
}

/**
 * The bounds one search runs inside.
 *
 * Every field is derived, and `rationale` says from what, because a planner
 * that silently narrows a paying customer's search is indistinguishable from
 * a bug until somebody can read why.
 */
export interface SearchBudget {
  /** Highest source priority_tier this plan may reach. 0 = P0 only. */
  sourcePriorityCeiling: number;
  /** Stop climbing once this many useful unique results are held. */
  targetResults: number;
  /** Internal spend ceiling in cents, or null when nobody measured it. */
  maxInternalCostCents: number | null;
  /** The bound that always applies, measured cost or not. */
  maxSourceJobs: number;
  maxPagesPerSource: number;
  maxDetailFetches: number;
  /** Whether a stage may spend an LLM call on semantic enrichment. */
  expensiveEnrichmentAllowed: boolean;
  /** Human-readable derivation. Carried into the job record. */
  rationale: string;
}

/**
 * THE CONSERVATIVE DEFAULT, and why it is the strict one.
 *
 * A campaign whose product has no entitlement row is not a premium campaign.
 * Treating an absent row as "unbounded" is how a configuration gap turns into
 * a hundred outbound fetches nobody authorised, so an unknown plan gets the
 * narrowest envelope: critical sources only, one page, no enrichment.
 */
const UNENTITLED: Omit<SearchBudget, 'rationale'> = {
  sourcePriorityCeiling: 0,
  targetResults: 5,
  maxInternalCostCents: null,
  maxSourceJobs: 2,
  maxPagesPerSource: 1,
  maxDetailFetches: 5,
  expensiveEnrichmentAllowed: false,
};

/**
 * Per-tier shape of the search, for the parts the entitlement row does not
 * state.
 *
 * result_ceiling and provider_budget_ceiling_cents come from the row. Pages
 * and detail fetches do not exist in that table, so they are derived from the
 * tier and kept deliberately small: these multiply into outbound requests
 * against somebody else's server, and the ceiling that matters to a source
 * operator is requests, not our spend.
 */
/**
 * How far a paid search may reach, whatever plan the customer is on.
 *
 * P2 — secondary sources with real inventory — and not P3. Experimental
 * sources have not been shown to yield useful unique results, and charging a
 * customer for a search that spent its budget there would be selling effort
 * rather than findings. P3 is closed at every plan and every budget.
 */
const PAYG_CEILING = 2;

const TIER_SHAPE: Record<QualityTier, {
  maxSourceJobs: number;
  maxPagesPerSource: number;
  detailPerResult: number;
  expensiveEnrichmentAllowed: boolean;
}> = {
  STANDARD: { maxSourceJobs: 3, maxPagesPerSource: 1, detailPerResult: 1, expensiveEnrichmentAllowed: false },
  ENHANCED: { maxSourceJobs: 8, maxPagesPerSource: 3, detailPerResult: 1, expensiveEnrichmentAllowed: true },
  MAXIMUM: { maxSourceJobs: 20, maxPagesPerSource: 6, detailPerResult: 1, expensiveEnrichmentAllowed: true },
};

/** Derive the bounds for one search from the entitlement the customer holds. */
export function deriveSearchBudget(entitlement: Entitlement | null): SearchBudget {
  if (!entitlement) {
    return {
      ...UNENTITLED,
      rationale: 'no entitlement row for this product and plan; narrowest envelope',
    };
  }

  const tier = entitlement.qualityTier;
  if (!tier || !(tier in TIER_SHAPE)) {
    return {
      ...UNENTITLED,
      rationale: `entitlement ${entitlement.productCode}/${entitlement.planCode}`
        + ` states no usable quality_tier; narrowest envelope`,
    };
  }

  const shape = TIER_SHAPE[tier];

  /*
   * A null priority_level is not "reach everything". It is a plan nobody has
   * placed on the ladder, so it reaches the critical sources and no further.
   */
  const planLevel = entitlement.priorityLevel ?? 0;

  /*
   * PAYG RAISES THE FLOOR; THE MONEY IS STILL THE CAP.
   *
   * A customer who authorised credits for this search is not asking for their
   * subscription tier's opinion of how deep to look. So PAYG lifts the tier
   * gate to PAYG_CEILING and depth is then bounded by the two things that
   * actually cost something -- maxSourceJobs and maxInternalCostCents -- both
   * of which are unchanged and both of which still apply.
   *
   * NOT to tier 3. Experimental sources are unproven, not merely cheap: a
   * source nobody has shown to produce useful unique results should not be
   * charged to a customer at any budget. That is a quality decision and it is
   * deliberately NOT a paywall -- P3 is closed to everyone, including the
   * highest plan and the largest campaign.
   */
  const ceiling = entitlement.funding === 'PAYG'
    ? Math.max(planLevel, PAYG_CEILING)
    : planLevel;

  /*
   * A null result_ceiling means the product does not cap results — VERIFY and
   * CONTRACT_INTELLIGENCE are both like this, because they answer about one
   * subject rather than returning a list. The stop condition then comes from
   * jobs and cost rather than from a result count, so the target is set to
   * the job bound rather than to a number invented here.
   */
  const target = entitlement.resultCeiling ?? shape.maxSourceJobs;

  const reasons = [
    `${entitlement.productCode}/${entitlement.planCode}`,
    `tier ${tier}`,
    entitlement.funding === 'PAYG' && ceiling > planLevel
      ? `sources up to P${ceiling} (PAYG lifted the plan's P${planLevel}; budget is the cap)`
      : `sources up to P${ceiling}`,
    entitlement.resultCeiling === null
      ? 'no result_ceiling on this product, bounded by jobs'
      : `result_ceiling ${entitlement.resultCeiling}`,
    entitlement.providerBudgetCeilingCents === null
      ? 'provider_budget_ceiling_cents unset, so cost is UNKNOWN and bounded by job count'
      : `budget ${entitlement.providerBudgetCeilingCents}c`,
  ];

  return {
    sourcePriorityCeiling: ceiling,
    targetResults: target,
    maxInternalCostCents: entitlement.providerBudgetCeilingCents,
    maxSourceJobs: shape.maxSourceJobs,
    maxPagesPerSource: shape.maxPagesPerSource,
    maxDetailFetches: target * shape.detailPerResult,
    expensiveEnrichmentAllowed: shape.expensiveEnrichmentAllowed,
    rationale: reasons.join('; '),
  };
}

/** What a search has consumed so far. Measured, never estimated after the fact. */
export interface BudgetProgress {
  usefulResults: number;
  sourceJobsExecuted: number;
  /** Actual measured spend. Null entries are not counted as zero. */
  internalCostCents: number | null;
}

export type StopReason =
  | 'TARGET_REACHED'
  | 'BUDGET_EXHAUSTED'
  | 'JOB_LIMIT_REACHED'
  | 'CONTINUE';

export interface StopDecision {
  stop: boolean;
  reason: StopReason;
  detail: string;
}

/**
 * May this search climb one more rung?
 *
 * Checked BEFORE a stage runs, never after, because the point is to not spend
 * the money rather than to notice afterwards that it was spent.
 */
export function shouldContinue(
  budget: SearchBudget,
  progress: BudgetProgress,
): StopDecision {
  /*
   * ENOUGH IS ENOUGH, EVEN WITH BUDGET LEFT.
   *
   * A premium plan buys the OPPORTUNITY to search further, not an obligation
   * to. Continuing to fetch once the target is met spends a source's rate
   * limit and our money to add results the customer will never reach.
   */
  if (progress.usefulResults >= budget.targetResults) {
    return {
      stop: true,
      reason: 'TARGET_REACHED',
      detail: `${progress.usefulResults} useful result(s) at or above the target of ${budget.targetResults}`,
    };
  }

  if (progress.sourceJobsExecuted >= budget.maxSourceJobs) {
    return {
      stop: true,
      reason: 'JOB_LIMIT_REACHED',
      detail: `${progress.sourceJobsExecuted} source job(s) executed, limit ${budget.maxSourceJobs}`,
    };
  }

  /*
   * An unmeasured cost does not stop the search and does not pretend to be
   * zero either: with maxInternalCostCents null the job bound above is the
   * only spend guard, which is exactly why that bound exists.
   */
  if (budget.maxInternalCostCents !== null
    && progress.internalCostCents !== null
    && progress.internalCostCents >= budget.maxInternalCostCents) {
    return {
      stop: true,
      reason: 'BUDGET_EXHAUSTED',
      detail: `${progress.internalCostCents}c spent against a ceiling of ${budget.maxInternalCostCents}c`,
    };
  }

  return { stop: false, reason: 'CONTINUE', detail: 'budget and target both allow another stage' };
}

/** A source as the planner needs to judge it: identity plus its business tier. */
export interface TieredSource {
  id: string;
  /** source_registry.priority_tier. Null means nobody has tiered it yet. */
  priorityTier: number | null;
}

export interface TierGateResult<T> {
  eligible: T[];
  skipped: Array<{ id: string; reason: 'OVER_BUDGET'; detail: string }>;
}

/**
 * Which sources this plan may reach.
 *
 * An untiered source is NOT silently admitted. Nobody has judged whether it
 * is worth a customer's budget, and admitting it by default is how the long
 * tail ends up being searched on the cheapest plan — the exact behaviour this
 * module exists to prevent.
 */
export function withinPriorityCeiling<T extends TieredSource>(
  sources: readonly T[],
  budget: SearchBudget,
): TierGateResult<T> {
  const eligible: T[] = [];
  const skipped: TierGateResult<T>['skipped'] = [];

  for (const source of sources) {
    if (source.priorityTier === null) {
      skipped.push({
        id: source.id,
        reason: 'OVER_BUDGET',
        detail: 'source has no priority_tier; not judged worth a customer budget',
      });
      continue;
    }
    if (source.priorityTier > budget.sourcePriorityCeiling) {
      skipped.push({
        id: source.id,
        reason: 'OVER_BUDGET',
        detail: `source is P${source.priorityTier}, plan reaches P${budget.sourcePriorityCeiling}`,
      });
      continue;
    }
    eligible.push(source);
  }

  return { eligible, skipped };
}
