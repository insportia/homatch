// FIND BUYERS / FIND TENANTS — the two phases of every campaign. Pure.
//
//   PHASE 1  SOURCE DISCOVERY   find communities (Telegram search, Facebook /
//                               LinkedIn group search), audit, register once.
//   PHASE 2  EXTRACTION         read the consolidated pool (source-dependent
//                               Actors) and search platforms directly
//                               (independent search Actors), then match.
//
// Phase 2 does not START a paid run while Phase 1 is still working — so the
// groups Phase 1 finds are in the pool Phase 2 reads — but Phase 1 is
// bounded: when its deadline passes, or every discovery job has reached an
// outcome (done, failed, skipped), Phase 2 proceeds with whatever the pool
// holds. A provider that never answers cannot stall a campaign.
//
// The discovery budget is planned from the campaign's own numbers (registry
// prices x planned probes), not a fixed share: when known sources already
// cover the property no discovery job is planned at all (campaignPlan.ts),
// and when they do not, discovery may spend what the extraction probes leave.

import { classifyActor } from './actorCatalog.ts';
import type { Stage } from './actorInputs.ts';
import { STAGE_ACTOR } from './actorInputs.ts';

/** Social Actor stages whose output is SOURCES (communities), not demand. */
export const DISCOVERY_STAGES: ReadonlySet<string> = new Set(['FB_GROUP_SEARCH', 'LINKEDIN_GROUPS']);
/** Native providers that discover sources. */
export const DISCOVERY_PROVIDERS: ReadonlySet<string> = new Set(['TELEGRAM_SOURCES']);

export type CampaignPhase = 'PHASE1_DISCOVERY' | 'PHASE2_EXTRACTION';
export type Phase2Category = 'SOURCE_DEPENDENT' | 'INDEPENDENT_SEARCH';

export function phaseOfStage(stage: string | null | undefined): CampaignPhase {
  return DISCOVERY_STAGES.has(String(stage ?? '')) ? 'PHASE1_DISCOVERY' : 'PHASE2_EXTRACTION';
}

/** Phase 2 Actors that read given communities/URLs vs those that search on their own. */
export function phase2Category(stage: Stage): Phase2Category {
  return classifyActor(STAGE_ACTOR[stage]).needsSeed ? 'SOURCE_DEPENDENT' : 'INDEPENDENT_SEARCH';
}

/**
 * Phase 1's time box inside the campaign window: a third of it, never less
 * than 3 nor more than 10 minutes (default window 30 min → 10 min).
 */
export function phase1TimeoutMinutes(campaignWindowMinutes: number): number {
  const w = Number.isFinite(campaignWindowMinutes) && campaignWindowMinutes > 0 ? campaignWindowMinutes : 30;
  return Math.max(3, Math.min(10, Math.floor(w / 3)));
}

export interface Phase1Job {
  provider: string | null;
  stage?: string | null;
  status: string;
}
export type Phase1State = 'NONE' | 'RUNNING' | 'DONE' | 'TIMED_OUT';

const OPEN = new Set(['PENDING', 'PROCESSING', 'RETRY_WAIT', 'PAUSED']);

/** A native discovery provider's job, or a social job whose stage discovers sources (only social jobs carry a stage). */
export function isPhase1Job(j: { provider: string | null; stage?: string | null }): boolean {
  return DISCOVERY_PROVIDERS.has(String(j.provider ?? '').toUpperCase()) || DISCOVERY_STAGES.has(String(j.stage ?? ''));
}

/**
 * Where Phase 1 stands. DONE: every discovery job reached an outcome (its
 * partial results are kept either way). TIMED_OUT: the box closed with work
 * still open — Phase 2 proceeds with the pool as it is. NONE: nothing to
 * discover (known sources cover the property, or discovery is off).
 */
export function phase1State(jobs: readonly Phase1Job[], nowMs: number, deadlineMs: number | null, expectedProviders: readonly string[] = []): {
  state: Phase1State; open: number; finished: number;
} {
  const own = jobs.filter(isPhase1Job);
  /* A discovery job the plan expects but that is not queued yet counts as
     open (the native Telegram search is queued just after the paid jobs). */
  const missing = expectedProviders.filter((p) => !own.some((j) => String(j.provider ?? '').toUpperCase() === p.toUpperCase())).length;
  const open = own.filter((j) => OPEN.has(String(j.status).toUpperCase())).length + missing;
  const finished = own.length - open;
  if (!own.length && !missing) return { state: 'NONE', open, finished };
  if (!open) return { state: 'DONE', open, finished };
  if (deadlineMs != null && nowMs >= deadlineMs) return { state: 'TIMED_OUT', open, finished };
  return { state: 'RUNNING', open, finished };
}

/** Phase 2 may start a new paid run (or a native read) only when Phase 1 is not RUNNING. */
export function phase2MayStart(state: Phase1State): boolean {
  return state !== 'RUNNING';
}

export interface DiscoveryBudgetPlan {
  discoveryCapMicros: number;
  extractionReserveMicros: number;
  discoveryNeedMicros: number;
  rationale: 'NO_DISCOVERY_PLANNED' | 'FULL_DISCOVERY' | 'DISCOVERY_LIMITED_BY_EXTRACTION' | 'ONE_DISCOVERY_PROBE';
}

/**
 * The Phase 1 spend ceiling for one campaign, from its own estimates:
 *  - extraction probes planned for Phase 2 are reserved first (they reach
 *    people now);
 *  - discovery may use what is left, up to what its planned jobs cost;
 *  - if that leaves nothing, one discovery probe is still allowed when the
 *    budget holds it, because new communities are what later reads feed on.
 * The campaign-wide hard cap stays the database's (find_buyers_reserve_actor_run).
 */
export function planDiscoveryBudget(input: {
  providerBudgetMicros: number;
  discoveryEstimatesMicros: readonly number[];
  extractionEstimatesMicros: readonly number[];
}): DiscoveryBudgetPlan {
  const budget = Math.max(0, Math.floor(input.providerBudgetMicros || 0));
  const disc = input.discoveryEstimatesMicros.filter((n) => Number.isFinite(n) && n > 0);
  const need = disc.reduce((a, b) => a + b, 0);
  const reserve = Math.min(budget, input.extractionEstimatesMicros.filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => a + b, 0));
  if (!disc.length) return { discoveryCapMicros: 0, extractionReserveMicros: reserve, discoveryNeedMicros: 0, rationale: 'NO_DISCOVERY_PLANNED' };
  const available = Math.max(0, budget - reserve);
  if (available >= need) return { discoveryCapMicros: need, extractionReserveMicros: reserve, discoveryNeedMicros: need, rationale: 'FULL_DISCOVERY' };
  const oneProbe = Math.min(...disc);
  if (available >= oneProbe) return { discoveryCapMicros: available, extractionReserveMicros: reserve, discoveryNeedMicros: need, rationale: 'DISCOVERY_LIMITED_BY_EXTRACTION' };
  return { discoveryCapMicros: oneProbe <= budget ? oneProbe : 0, extractionReserveMicros: reserve, discoveryNeedMicros: need, rationale: 'ONE_DISCOVERY_PROBE' };
}

/** Same formula as find_buyers_reserve_actor_run: start fee + limit × price/1k. */
export function probeEstimateMicros(a: { startFeeMicros?: number | null; pricePer1kMicros?: number | null }, size: number): number {
  if (a.pricePer1kMicros == null) return 0;
  return Number(a.startFeeMicros ?? 0) + Math.ceil(Math.max(0, size) * Number(a.pricePer1kMicros) / 1000);
}

/* ── per-campaign Actor circuit breaker ──────────────────────────────── */

/** An Actor's provider message for "the query matched nothing". */
export function isEmptyResultMessage(message: unknown): boolean {
  return !/target\(s\) failed/i.test(String(message ?? '')) && /dataset is empty|produced no items|no items (were )?found|no results/i.test(String(message ?? ''));
}

export interface BreakerRun { status: string; items_fetched?: number | null; useful_results?: number | null; cost_booked_at?: string | null }

/**
 * OPEN after BREAKER_LIMIT consecutive finished runs of one Actor in one
 * campaign that failed or returned nothing useful (VILLION: Bluesky failed 6
 * times, VK twice, LinkedIn posts 3 times with 0 items — all paid). A useful
 * run resets the count. Runs still in flight are not judged.
 */
export const BREAKER_LIMIT = 2;
export function actorBreaker(runs: readonly BreakerRun[]): { open: boolean; consecutive: number } {
  let consecutive = 0;
  for (const r of runs) {
    const finished = Boolean(r.cost_booked_at) || ['FAILED', 'TIMED_OUT', 'SUCCEEDED', 'ABORTED'].includes(r.status);
    if (!finished || r.status === 'RELEASED') continue;
    const bad = r.status !== 'SUCCEEDED' || Number(r.items_fetched ?? 0) === 0;
    if (bad) consecutive++;
    else if (Number(r.useful_results ?? 0) > 0 || Number(r.items_fetched ?? 0) > 0) consecutive = 0;
  }
  return { open: consecutive >= BREAKER_LIMIT, consecutive };
}
