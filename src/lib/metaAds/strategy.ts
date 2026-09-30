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

import { applyTargeting, normalizeIntent, validateTargeting, type LocationChoice, type TargetingIntent } from './targeting.ts';

export const STRATEGY_VERSION = 'homatch-meta-v2';

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
  /** Width/height of the primary media, when known — decides which
   *  placements a creative can serve well (vertical vs feed). */
  width?: number | null;
  height?: number | null;
  /** 0..1 from creativeAdvice(): resolution, format fit, completeness. */
  quality?: number | null;
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
  /** Where, which ages, which gender (targeting.ts). Absent: the market default. */
  targeting?: TargetingIntent | null;
  /** Legacy single default market, used only when targeting is absent. */
  countryCode?: string;
  placementsMode: 'RECOMMENDED' | 'CUSTOM';
  customPlacements?: string[];
}

/* ── STRATEGY PARAMETERS ───────────────────────────────────────────────
 * Canonical and server-side. The defaults below are what production runs
 * unless admin_settings.meta_ads_strategy_params overrides a field; nothing
 * in the browser decides a structure.
 *
 *   minAdSetDailyCents   the least a single ad set needs per day to deliver
 *                        and learn in a lead objective. Other objectives
 *                        scale it by objectiveCellFactor.
 *   minAdDailyCents      the least one ad needs per day to be a real test
 *                        rather than a starved variant.
 *   learningDays         below twice this, a campaign has no time to learn
 *                        from parallel cells: it stays in one ad set.
 */
export interface StrategyParams {
  minAdSetDailyCents: number;
  minAdDailyCents: number;
  maxAdSets: number;
  maxAdsPerAdSet: number;
  learningDays: number;
  objectiveCellFactor: Record<string, number>;
}

export const DEFAULT_STRATEGY_PARAMS: StrategyParams = {
  minAdSetDailyCents: 800,
  minAdDailyCents: 150,
  maxAdSets: 4,
  maxAdsPerAdSet: 4,
  learningDays: 3,
  objectiveCellFactor: { OUTCOME_LEADS: 1, OUTCOME_ENGAGEMENT: 0.6, OUTCOME_TRAFFIC: 0.6 },
};

export function strategyParams(raw: unknown): StrategyParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof StrategyParams, lo: number, hi: number) => {
    const v = Number(r[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : (DEFAULT_STRATEGY_PARAMS[k] as number);
  };
  const factors = { ...DEFAULT_STRATEGY_PARAMS.objectiveCellFactor };
  if (r.objectiveCellFactor && typeof r.objectiveCellFactor === 'object') {
    for (const [k, v] of Object.entries(r.objectiveCellFactor as Record<string, unknown>)) {
      if (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 5) factors[k] = Number(v);
    }
  }
  return {
    minAdSetDailyCents: num('minAdSetDailyCents', 100, 1_000_000),
    minAdDailyCents: num('minAdDailyCents', 50, 1_000_000),
    maxAdSets: Math.round(num('maxAdSets', 1, 10)),
    maxAdsPerAdSet: Math.round(num('maxAdsPerAdSet', 1, 10)),
    learningDays: Math.round(num('learningDays', 1, 14)),
    objectiveCellFactor: factors,
  };
}

export interface PlannedAdSet {
  key: string;
  dailyBudgetCents: number;
  creativeIds: string[];
  /** v26: special-ad-category ad sets must set this explicitly. */
  advantageAudience: boolean;
  /** What this ad set tests, when the plan has more than one. */
  segment?: { kind: 'ALL' | 'LOCATION' | 'FORMAT'; label: string };
  /** The Meta targeting spec for this ad set (targeting.ts applyTargeting). */
  targeting?: Record<string, unknown>;
  /** FORMAT segments: the placements this ad set runs in. */
  placements?: string[] | null;
}

export type StrategyReason =
  | 'COMPACT_BUDGET_ONE_AD_SET'
  | 'BUDGET_CONCENTRATED_ON_STRONGEST_CREATIVES'
  | 'ALL_CREATIVES_TESTED'
  | 'SINGLE_CREATIVE'
  | 'LOCATIONS_TESTED_SEPARATELY'
  | 'LOCATIONS_COMBINED_FOR_BUDGET'
  | 'FORMATS_TESTED_SEPARATELY'
  | 'SHORT_DURATION_SIMPLIFIED'
  | 'BROAD_AUDIENCE_META_OPTIMIZES'
  | 'HOUSING_AUDIENCE_RULES'
  | 'CUSTOM_AUDIENCE_USED';

export interface StrategySummary {
  campaignCount: 1;
  adSetCount: number;
  adCount: number;
  /** Parallel ad sets the daily budget can feed; the ceiling on complexity. */
  testingCapacity: number;
  reasonCodes: StrategyReason[];
  /** HIGH when every input is known; MEDIUM when a creative's shape or
   *  quality had to be assumed. */
  confidence: 'HIGH' | 'MEDIUM';
  /** How many creatives this plan can use well — the advice to the customer. */
  recommendedCreativeCount: number;
  heldBackCreativeIds: string[];
  targetingAdjustments: string[];
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
  /** Every country the plan reaches — special_ad_category_country. */
  countries: string[];
  strategy: StrategySummary;
}

export interface PlanIssue { code: string; field?: string }

const VERTICAL = (c: CreativeRef) => !!c.width && !!c.height && c.height / c.width >= 1.5;
const FEEDISH = (c: CreativeRef) => !!c.width && !!c.height && c.height / c.width < 1.5;
/* Names from payload.ts PLACEMENTS — the only catalogue the payload maps. */
export const VERTICAL_PLACEMENTS = ['facebook_stories', 'instagram_stories', 'instagram_reels'];
export const FEED_PLACEMENTS = ['facebook_feed', 'instagram_feed'];

function splitBudget(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/**
 * BUILD. The simplest structure the budget can genuinely support.
 *
 *   testing capacity = daily budget ÷ what one ad set needs to learn
 *                      (scaled by objective), capped by maxAdSets, and 1
 *                      when the campaign is too short to learn in parallel.
 *
 * Ad sets exist only for a real hypothesis the customer's choices create —
 * separate places, or vertical vs feed creatives — and only when capacity
 * funds each one. Inside an ad set, the number of ads is what the ad set's
 * budget can feed (minAdDailyCents each); the strongest creatives run first
 * and the rest are held back and named, never silently dropped.
 */
export function buildPlan(input: StrategyInput, params: StrategyParams = DEFAULT_STRATEGY_PARAMS): TypedCampaignPlan {
  const objective = GOAL_TO_OBJECTIVE[input.goal];
  const factor = params.objectiveCellFactor[objective] ?? 1;
  const cellCents = Math.max(1, Math.round(params.minAdSetDailyCents * factor));
  const daily = Math.max(0, Math.round(input.dailyBudgetCents));
  const reasons: StrategyReason[] = [];

  const shortRun = input.durationDays < params.learningDays * 2;
  let capacity = Math.max(1, Math.min(params.maxAdSets, Math.floor(daily / cellCents)));
  if (shortRun && capacity > 1) { capacity = 1; reasons.push('SHORT_DURATION_SIMPLIFIED'); }

  const ready = input.creatives.filter((c) => c.ready)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Number(b.c.quality ?? 0.5) - Number(a.c.quality ?? 0.5)) || a.i - b.i)
    .map((x) => x.c);
  const unknownShape = ready.some((c) => !c.width || !c.height || c.quality == null);

  const intent = input.targeting
    ?? normalizeIntent(null, input.countryCode ? [input.countryCode] : ['GE']);
  const locations = intent.locations;

  type Cell = { segment: PlannedAdSet['segment']; only?: LocationChoice[]; creatives: CreativeRef[]; placements?: string[] | null };
  let cells: Cell[] = [{ segment: { kind: 'ALL', label: 'all' }, creatives: ready }];

  const vertical = ready.filter(VERTICAL);
  const feed = ready.filter(FEEDISH);
  if (locations.length > 1 && capacity >= 2) {
    const n = Math.min(capacity, locations.length);
    if (n === locations.length) {
      cells = locations.map((l) => ({ segment: { kind: 'LOCATION', label: l.name }, only: [l], creatives: ready }));
      reasons.push('LOCATIONS_TESTED_SEPARATELY');
    } else {
      reasons.push('LOCATIONS_COMBINED_FOR_BUDGET');
    }
  } else if (locations.length > 1) {
    reasons.push('LOCATIONS_COMBINED_FOR_BUDGET');
  } else if (capacity >= 2 && input.placementsMode === 'RECOMMENDED' && vertical.length > 0 && feed.length > 0) {
    cells = [
      { segment: { kind: 'FORMAT', label: 'vertical' }, creatives: vertical, placements: VERTICAL_PLACEMENTS },
      { segment: { kind: 'FORMAT', label: 'feed' }, creatives: feed, placements: FEED_PLACEMENTS },
    ];
    reasons.push('FORMATS_TESTED_SEPARATELY');
  }
  if (cells.length === 1) reasons.push('COMPACT_BUDGET_ONE_AD_SET');

  const budgets = splitBudget(daily, cells.length);
  const housing = input.specialAdCategories.includes('HOUSING');
  const adjustments = new Set<string>();
  const used = new Set<string>();
  const adSets: PlannedAdSet[] = cells.map((cell, i) => {
    const adsFundable = Math.max(1, Math.floor(budgets[i] / params.minAdDailyCents));
    const take = Math.max(1, Math.min(params.maxAdsPerAdSet, adsFundable, cell.creatives.length || 1));
    const chosen = cell.creatives.slice(0, take);
    chosen.forEach((c) => used.add(c.id));
    const applied = applyTargeting(intent, input.specialAdCategories, cell.only);
    applied.adjustments.forEach((a) => adjustments.add(a));
    return {
      key: `set_${i + 1}`,
      dailyBudgetCents: budgets[i],
      creativeIds: chosen.map((c) => c.id),
      advantageAudience: true,
      segment: cell.segment,
      targeting: applied.spec,
      placements: cell.placements ?? null,
    };
  });

  const held = ready.filter((c) => !used.has(c.id)).map((c) => c.id);
  if (ready.length === 1) reasons.push('SINGLE_CREATIVE');
  else if (held.length) reasons.push('BUDGET_CONCENTRATED_ON_STRONGEST_CREATIVES');
  else if (ready.length > 1) reasons.push('ALL_CREATIVES_TESTED');
  reasons.push(housing ? 'HOUSING_AUDIENCE_RULES' : 'BROAD_AUDIENCE_META_OPTIMIZES');
  if (input.audienceExternalId) reasons.push('CUSTOM_AUDIENCE_USED');

  const perAdSetBudget = Math.floor(daily / adSets.length);
  const recommended = Math.max(1, Math.min(params.maxAdsPerAdSet, Math.floor(perAdSetBudget / params.minAdDailyCents)))
    * (adSets.some((s) => s.segment?.kind === 'FORMAT') ? 2 : 1);
  const all = applyTargeting(intent, input.specialAdCategories);

  return {
    version: STRATEGY_VERSION,
    apiVersion: META_API_VERSION,
    objective,
    specialAdCategories: input.specialAdCategories,
    adsetBudgetSharing: false,
    adSets,
    destinationType: input.destination.type,
    placements: input.placementsMode === 'CUSTOM'
      ? { mode: 'CUSTOM', list: (input.customPlacements ?? []).slice(0, 12) }
      : { mode: 'RECOMMENDED' },
    audienceExternalId: input.audienceExternalId ?? null,
    totalBudgetCents: daily * input.durationDays,
    countries: all.countries,
    strategy: {
      campaignCount: 1,
      adSetCount: adSets.length,
      adCount: adSets.reduce((n, s) => n + s.creativeIds.length, 0),
      testingCapacity: capacity,
      reasonCodes: [...new Set(reasons)],
      confidence: unknownShape ? 'MEDIUM' : 'HIGH',
      recommendedCreativeCount: Math.min(recommended, params.maxAdSets * params.maxAdsPerAdSet),
      heldBackCreativeIds: held,
      targetingAdjustments: [...adjustments],
    },
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
  if (input.targeting) {
    for (const t of validateTargeting(input.targeting)) issues.push({ code: t.code, field: 'targeting' });
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
  // Exact integer maths in basis points (percent to 2 decimals): the same
  // number the database quote gives (meta_service_fee_quote), half-up.
  const bp = Math.round(feePercent * 100);
  const feeCents = Math.round((mediaCents * bp) / 10000);
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
