// META ADS — THE STRATEGY ENGINE. Deterministic, typed, and OURS.
//
// The customer states a HUMAN goal, a budget and a duration. This module —
// not an LLM, not the browser, not Meta — turns that into a typed campaign
// plan and validates it. The pipeline the whole product obeys:
//
//   intent → strategy engine → TYPED plan → deterministic validation →
//   policy validation → budget validation → capability validation →
//   explicit customer confirmation → adapter → Meta
//
// An LLM may polish copy; it never emits campaign JSON that reaches Meta.
//
// No React, no Deno, no Supabase: imported by the browser (previews), by
// edge functions (the only launch path) and by node:test directly.

export const STRATEGY_VERSION = 'homatch-meta-v1';

/** Pinned Graph/Marketing API version (mirrored in admin_settings). v26.0
 *  released 2026-07-29; its breaking changes apply to all versions from
 *  2026-10-27, so pinning latest is the conservative choice. */
export const META_API_VERSION = 'v26.0';

export type MetaGoal =
  | 'LEADS_ON_META' | 'LEADS_ON_WEBSITE' | 'SITE_REGISTRATIONS'
  | 'ENGAGEMENT' | 'MESSAGES' | 'PROMOTE';

/** Human goal → current outcome-based Meta objective. MESSAGES maps but is
 *  gated off by default in settings until the capability is verified for
 *  the connected account. */
export const GOAL_TO_OBJECTIVE: Record<MetaGoal, string> = {
  LEADS_ON_META: 'OUTCOME_LEADS',
  LEADS_ON_WEBSITE: 'OUTCOME_LEADS',
  SITE_REGISTRATIONS: 'OUTCOME_LEADS',
  ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
  MESSAGES: 'OUTCOME_ENGAGEMENT',
  PROMOTE: 'OUTCOME_TRAFFIC',
};

export type DealKind = 'SALE' | 'RENT_LONG' | 'RENT_SHORT' | 'COMMERCIAL' | 'LAND' | 'OTHER';

/**
 * POLICY CLASSIFICATION — never guessed, never skipped.
 *
 * Housing ads (sale and rental of residential property) are a Meta Special
 * Ad Category with restricted targeting. HOMATCH classifies from the OFFER,
 * not from the customer's self-description, and the classification is
 * visible in Admin. Commercial-only offers and non-property offers are not
 * housing; when in doubt the classifier says HOUSING, because the failure
 * mode of over-classifying is narrower targeting, while the failure mode of
 * under-classifying is a policy violation.
 */
export function classifySpecialAdCategories(offer: {
  isProperty: boolean; dealKind?: DealKind | null;
}): string[] {
  if (!offer.isProperty) return [];
  if (offer.dealKind === 'COMMERCIAL') return [];
  return ['HOUSING'];
}

export interface CreativeRef {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  ready: boolean;
}

export interface StrategyInput {
  goal: MetaGoal;
  dailyBudgetCents: number;
  durationDays: number;
  currency: string;
  specialAdCategories: string[];
  creatives: CreativeRef[];
  destination: { type: 'META_FORM' | 'WEBSITE' | 'HOMATCH_PAGE' | 'MESSAGING' | 'ON_POST'; url?: string };
  audienceExternalId?: string | null;
  countryCode?: string;               // default market
  placementsMode: 'RECOMMENDED' | 'CUSTOM';
  customPlacements?: string[];
}

export interface PlannedAdSet {
  key: string;
  dailyBudgetCents: number;
  creativeIds: string[];
  /** v26: special-ad-category ad sets must set this explicitly. */
  advantageAudience: boolean;
}

export interface TypedCampaignPlan {
  version: typeof STRATEGY_VERSION;
  apiVersion: typeof META_API_VERSION;
  objective: string;
  specialAdCategories: string[];
  /** v26: required on campaign create when there is no campaign budget. */
  adsetBudgetSharing: false;
  adSets: PlannedAdSet[];
  destinationType: StrategyInput['destination']['type'];
  placements: { mode: 'RECOMMENDED' } | { mode: 'CUSTOM'; list: string[] };
  audienceExternalId: string | null;
  totalBudgetCents: number;
}

export interface PlanIssue { code: string; field?: string }

/**
 * BUILD. Small budgets are never fragmented: one ad set carries every
 * creative (Meta's own delivery optimizes between ads) unless the daily
 * budget can genuinely feed parallel ad sets. "More ad sets" is not a
 * strategy; evidence per dollar is.
 */
export function buildPlan(input: StrategyInput): TypedCampaignPlan {
  const ready = input.creatives.filter((c) => c.ready);
  const SPLIT_FLOOR_CENTS = 1000; // $10/day per ad set, minimum worth splitting
  const wantSplit = ready.length >= 4 && input.dailyBudgetCents >= SPLIT_FLOOR_CENTS * 2;
  const adSets: PlannedAdSet[] = [];
  if (wantSplit) {
    const half = Math.ceil(ready.length / 2);
    const groups = [ready.slice(0, half), ready.slice(half)];
    const budgets = [Math.floor(input.dailyBudgetCents / 2),
      input.dailyBudgetCents - Math.floor(input.dailyBudgetCents / 2)];
    groups.forEach((group, i) => adSets.push({
      key: `set_${i + 1}`,
      dailyBudgetCents: budgets[i],
      creativeIds: group.map((c) => c.id),
      advantageAudience: input.specialAdCategories.length > 0 ? true : true,
    }));
  } else {
    adSets.push({
      key: 'set_1',
      dailyBudgetCents: input.dailyBudgetCents,
      creativeIds: ready.map((c) => c.id),
      advantageAudience: true,
    });
  }
  return {
    version: STRATEGY_VERSION,
    apiVersion: META_API_VERSION,
    objective: GOAL_TO_OBJECTIVE[input.goal],
    specialAdCategories: input.specialAdCategories,
    adsetBudgetSharing: false,
    adSets,
    destinationType: input.destination.type,
    placements: input.placementsMode === 'CUSTOM'
      ? { mode: 'CUSTOM', list: (input.customPlacements ?? []).slice(0, 12) }
      : { mode: 'RECOMMENDED' },
    audienceExternalId: input.audienceExternalId ?? null,
    totalBudgetCents: input.dailyBudgetCents * input.durationDays,
  };
}

/** DETERMINISTIC VALIDATION — the gate in front of money and Meta. */
export function validatePlanInput(
  input: StrategyInput,
  limits: { minDurationDays: number; minDailyCents: number; maxDailyCents: number },
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (!GOAL_TO_OBJECTIVE[input.goal]) issues.push({ code: 'GOAL_UNSUPPORTED', field: 'goal' });
  if (!(input.durationDays >= limits.minDurationDays)) {
    issues.push({ code: 'DURATION_BELOW_MINIMUM', field: 'durationDays' });
  }
  if (!(input.dailyBudgetCents >= limits.minDailyCents)) {
    issues.push({ code: 'BUDGET_BELOW_MINIMUM', field: 'dailyBudgetCents' });
  }
  if (input.dailyBudgetCents > limits.maxDailyCents) {
    issues.push({ code: 'BUDGET_ABOVE_MAXIMUM', field: 'dailyBudgetCents' });
  }
  if (input.creatives.filter((c) => c.ready).length === 0) {
    issues.push({ code: 'CREATIVE_REQUIRED', field: 'creatives' });
  }
  if ((input.destination.type === 'WEBSITE')
      && !(input.destination.url ?? '').startsWith('https://')) {
    issues.push({ code: 'DESTINATION_URL_INVALID', field: 'destination' });
  }
  if (input.goal === 'LEADS_ON_META' && input.destination.type !== 'META_FORM') {
    issues.push({ code: 'DESTINATION_GOAL_MISMATCH', field: 'destination' });
  }
  return issues;
}

/* ── MONEY ──────────────────────────────────────────────────────────────
 * ONE formula, integer cents, fee ADDED ON TOP of media spend (the
 * transparent model: media + fee = total). The percent itself comes from
 * admin_settings (meta_ads_fee_percent) — callers pass it in; nothing here
 * hardcodes 9.
 */
export interface CampaignTotals {
  mediaCents: number;
  feeCents: number;
  totalCents: number;
  feePercent: number;
}

export function computeTotals(
  dailyBudgetCents: number, durationDays: number, feePercent: number,
): CampaignTotals {
  const mediaCents = Math.round(dailyBudgetCents) * Math.round(durationDays);
  const feeCents = Math.round((mediaCents * feePercent) / 100);
  return { mediaCents, feeCents, totalCents: mediaCents + feeCents, feePercent };
}

/* ── LIFECYCLE ──────────────────────────────────────────────────────────
 * The single source of legal transitions; DB guard + edge function + UI
 * all consult this map rather than inventing their own.
 */
export const CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CONNECTION_REQUIRED', 'CREATIVE_REQUIRED', 'AUDIENCE_REQUIRED', 'PREFLIGHT_REQUIRED', 'ARCHIVED'],
  CONNECTION_REQUIRED: ['DRAFT', 'PREFLIGHT_REQUIRED', 'ARCHIVED'],
  CREATIVE_REQUIRED: ['DRAFT', 'PREFLIGHT_REQUIRED', 'ARCHIVED'],
  AUDIENCE_REQUIRED: ['DRAFT', 'PREFLIGHT_REQUIRED', 'ARCHIVED'],
  PREFLIGHT_REQUIRED: ['READY', 'NEEDS_CHANGES', 'MANUAL_REVIEW', 'DRAFT', 'ARCHIVED'],
  NEEDS_CHANGES: ['PREFLIGHT_REQUIRED', 'DRAFT', 'ARCHIVED'],
  MANUAL_REVIEW: ['READY', 'NEEDS_CHANGES', 'REJECTED'],
  READY: ['PAYMENT_REQUIRED', 'LAUNCHING', 'PREFLIGHT_REQUIRED', 'ARCHIVED'],
  PAYMENT_REQUIRED: ['READY', 'LAUNCHING', 'ARCHIVED'],
  LAUNCHING: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['META_REVIEW', 'ACTIVE', 'REJECTED', 'FAILED'],
  META_REVIEW: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'REJECTED', 'FAILED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  FAILED: ['READY', 'DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (CAMPAIGN_TRANSITIONS[from] ?? []).includes(to);
}
