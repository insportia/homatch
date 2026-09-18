// HOMATCH RESEARCH CORE — turning an approved spend into a research plan.
//
// `beginExecution` already decides everything that matters about money: how
// the run is funded, which quality tier the customer's plan buys, how many
// credits were authorised, what the provider-spend ceiling is, how many
// results the product allows, and what priority the run gets. All of it
// already exists and nothing consumes several of those fields.
//
// This file consumes them. It does not decide any of them, and there is no
// path here that can widen a ceiling — every function below narrows.
//
// THE PARTIAL-BUDGET CASE IS THE WHOLE POINT
//
// billing.ts sets `partialBudget` when the customer could not cover the full
// estimate and authorised what they had. Its comment is explicit that the
// worker "must scope the search to the budget rather than running a full one
// and being cut off part way". A budget that is only checked when it runs out
// produces exactly the behaviour that comment forbids: a search that stops
// mid-sentence. So the ceilings below are applied to the PLAN, before the
// first fetch.

import type { ProfileLimits, ResearchProfile } from '../profiles/types.ts';
import { workClassForGrant, type WorkClass } from '../core/types.ts';

/**
 * The parts of `ExecutionGrant` this core uses.
 *
 * Declared structurally rather than imported, for the same reason as the
 * other bridges: billing.ts is Deno edge code. Pinned by
 * __tests__/bridge-budget.test.mjs against the real file.
 */
export interface ExecutionGrantLike {
  ok: boolean;
  funding: 'INCLUDED' | 'PAYG' | 'UNAVAILABLE';
  productCode: string;
  qualityTier: 'STANDARD' | 'ENHANCED' | 'MAXIMUM';
  resultCeiling: number | null;
  providerBudgetCeilingCents: number | null;
  priorityLevel: number;
  partialBudget: boolean;
  authorizedMaxCredits: number;
  estimateMaxCredits: number;
}

export interface ResearchBudget {
  workClass: WorkClass;
  /** Wall-clock the run may take before returning what it has. */
  softDeadlineMs: number;
  hardDeadlineMs: number;
  /** Documents this run may fetch. */
  maxDocuments: number;
  /** Distinct sources this run may consult. */
  maxSources: number;
  /** Qualified results the product allows, when it caps them. */
  resultCeiling: number | null;
  /** Hard ceiling on provider spend, in cents. null = no product ceiling. */
  providerBudgetCeilingCents: number | null;
  /** True when the plan was scaled down to fit what the customer authorised. */
  scaledToPartialBudget: boolean;
}

/**
 * How much of a profile's full depth each quality tier buys.
 *
 * Tiers are a PLAN concept that already exists (`product_plan_entitlements`),
 * and this is the first thing to act on them for research. The multipliers are
 * depth, not price: STANDARD gathers less, MAXIMUM gathers more, and the money
 * for each was settled before this function ran.
 */
const TIER_DEPTH: Record<ExecutionGrantLike['qualityTier'], number> = {
  STANDARD: 0.5,
  ENHANCED: 0.75,
  MAXIMUM: 1,
};

export function budgetFor(
  profile: ResearchProfile,
  grant: ExecutionGrantLike,
  options: { interactive?: boolean } = {},
): ResearchBudget {
  const interactive = options.interactive ?? true;
  const depth = TIER_DEPTH[grant.qualityTier];

  // A partial budget scales the plan by the FRACTION actually authorised. A
  // customer who could fund 40% of the estimate gets 40% of the work, planned
  // that way from the start, rather than 100% of the work stopped at 40%.
  const fraction =
    grant.partialBudget && grant.estimateMaxCredits > 0
      ? clamp(grant.authorizedMaxCredits / grant.estimateMaxCredits, 0.1, 1)
      : 1;

  const scale = depth * fraction;
  const limits: ProfileLimits = profile.limits;

  return {
    workClass: workClassForGrant({ funding: grant.funding, interactive }),
    // Deadlines shrink with depth but never below a floor that would make the
    // run pointless — a two-second research budget buys nothing and still
    // costs a scheduler slot.
    softDeadlineMs: Math.max(5_000, Math.round(limits.softDeadlineMs * scale)),
    hardDeadlineMs: Math.max(10_000, Math.round(limits.hardDeadlineMs * scale)),
    maxDocuments: Math.max(1, Math.round(limits.maxDocuments * scale)),
    maxSources: Math.max(1, Math.round(limits.maxSources * scale)),
    resultCeiling: grant.resultCeiling,
    providerBudgetCeilingCents: grant.providerBudgetCeilingCents,
    scaledToPartialBudget: grant.partialBudget,
  };
}

/**
 * A budget for work nobody is paying for directly — a background refresh, a
 * scheduled re-check.
 *
 * It still has ceilings. "Nobody is waiting" is not "spend freely": a
 * background run that reaches a paid provider spends the same money as an
 * interactive one, so it gets the BACKGROUND class and a provider ceiling of
 * zero unless a caller deliberately raises it.
 */
export function backgroundBudget(
  profile: ResearchProfile,
  options: { providerBudgetCeilingCents?: number } = {},
): ResearchBudget {
  return {
    workClass: 'BACKGROUND',
    softDeadlineMs: profile.limits.softDeadlineMs,
    hardDeadlineMs: profile.limits.hardDeadlineMs,
    maxDocuments: profile.limits.maxDocuments,
    maxSources: profile.limits.maxSources,
    resultCeiling: null,
    providerBudgetCeilingCents: options.providerBudgetCeilingCents ?? 0,
    scaledToPartialBudget: false,
  };
}

/** Narrow a budget. There is deliberately no function that widens one. */
export function narrow(budget: ResearchBudget, limits: Partial<ResearchBudget>): ResearchBudget {
  return {
    ...budget,
    softDeadlineMs: Math.min(budget.softDeadlineMs, limits.softDeadlineMs ?? Infinity),
    hardDeadlineMs: Math.min(budget.hardDeadlineMs, limits.hardDeadlineMs ?? Infinity),
    maxDocuments: Math.min(budget.maxDocuments, limits.maxDocuments ?? Infinity),
    maxSources: Math.min(budget.maxSources, limits.maxSources ?? Infinity),
    resultCeiling: minNullable(budget.resultCeiling, limits.resultCeiling),
    providerBudgetCeilingCents: minNullable(
      budget.providerBudgetCeilingCents,
      limits.providerBudgetCeilingCents,
    ),
  };
}

function minNullable(a: number | null, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
