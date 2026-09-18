// HOMATCH RESEARCH CORE — measured consumption, handed to the systems that
// already know what things cost.
//
// THE CORE HOLDS NO RATES AND MAKES NO PRICING DECISION.
//
// Homatch already has two cost systems and both are better than anything this
// core would bring:
//
//   provider_price_book  effective-dated rates, so a job completed last month
//                        is priced at last month's number. src/verify/cogs.ts
//                        prices against it and reports `priced: false` plus
//                        `unpricedUnits` when a dimension has no rate — the
//                        rule that an unknown cost is a named gap and never a
//                        silent zero is ALREADY implemented there.
//   billing.ts           beginExecution / settleExecution / releaseExecution,
//                        which take measured `ActualUsage` and decide money in
//                        SQL.
//
// So this file converts `ProviderUsage` into the shapes those two already
// accept, and does nothing else. The standalone engine's own cost model — a
// static, undated rate map — is deliberately NOT imported: it would be a
// second, worse answer to a question that already has a good one.

import type { ProviderUsage } from '../core/types.ts';

/**
 * The measured-usage shape `settleExecution` takes.
 *
 * Declared structurally rather than imported: `_shared/billing.ts` is Deno
 * edge code with URL imports that the Vite build cannot resolve. The shape is
 * pinned by __tests__/bridge-cost.test.mjs, which reads the real file.
 */
export interface ActualUsageLike {
  provider?: string;
  providerOperation?: string;
  providerRequestId?: string;
  searchCount?: number;
  providerUnits?: number;
  durationMs?: number;
  rawProviderCostCents?: number;
  metadata?: Record<string, unknown>;
  failureReason?: string;
}

export interface ToActualUsageOptions {
  /**
   * Raw provider spend in cents, if the provider reported it.
   *
   * UNDEFINED IS NOT ZERO. Passing undefined means "this provider did not tell
   * us what it charged", and the caller must then leave the field absent so
   * cogs.ts records it as unpriced rather than free. Passing 0 means "this
   * genuinely cost nothing", which is true of a cache hit and of a fetch of a
   * free public page — and false of everything else.
   */
  rawProviderCostCents?: number;
  providerRequestId?: string;
  failureReason?: string;
}

export function toActualUsage(
  usage: ProviderUsage,
  options: ToActualUsageOptions = {},
): ActualUsageLike {
  const out: ActualUsageLike = {
    provider: usage.provider,
    providerOperation: usage.providerOperation ?? undefined,
    // `searchCount` and `providerUnits` are what billing already meters.
    // networkRequests is deliberately NOT mapped onto either: a redirect hop
    // and a retried attempt are both network requests and neither is a
    // billable unit, and conflating them would over-bill a slow source.
    searchCount: usage.billableRequests,
    providerUnits: usage.providerUnits,
    durationMs: usage.durationMs,
    metadata: {
      network_requests: usage.networkRequests,
      billable_requests: usage.billableRequests,
      cache_hits: usage.cacheHits,
      coalesced_requests: usage.coalescedRequests,
    },
  };

  if (options.rawProviderCostCents !== undefined) {
    out.rawProviderCostCents = options.rawProviderCostCents;
  }
  if (options.providerRequestId) out.providerRequestId = options.providerRequestId;
  if (options.failureReason) out.failureReason = options.failureReason;

  return out;
}

/**
 * A row for `cost_events`, the ledger research-agent already writes.
 *
 * `cost_usd` is null when the provider did not report a cost and no rate is
 * known. NULL, not 0 — the existing COGS work is explicit that "a zero meaning
 * 'no rate for this' must never be read as a zero meaning 'free'", and this
 * keeps that distinction at the row level.
 */
export interface CostEventRow {
  provider: string;
  operation_type: string;
  source: string;
  units: number;
  cost_usd: number | null;
  success: boolean;
  cache_hit: boolean;
  job_id: string | null;
}

export function toCostEventRow(
  usage: ProviderUsage,
  input: {
    operationType: string;
    jobId?: string | null;
    success?: boolean;
    /** Only when the provider actually reported it. Omit otherwise. */
    costUsd?: number;
    /** Dimensions that had no rate, so the gap is actionable. */
    unpricedUnits?: string[];
  },
): CostEventRow {
  const annotations = [
    `net=${usage.networkRequests}`,
    `billable=${usage.billableRequests}`,
    usage.cacheHits ? `cached=${usage.cacheHits}` : null,
    usage.coalescedRequests ? `coalesced=${usage.coalescedRequests}` : null,
    input.costUsd === undefined ? 'unpriced=PROVIDER_CALL' : null,
    input.unpricedUnits?.length ? `unpriced=${input.unpricedUnits.join('+')}` : null,
  ].filter((value): value is string => value !== null);

  return {
    provider: usage.provider,
    operation_type: input.operationType,
    source: annotations.join(';'),
    units: usage.billableRequests,
    cost_usd: input.costUsd ?? null,
    success: input.success ?? true,
    // The number the reuse work has to move.
    cache_hit: usage.cacheHits > 0 || usage.coalescedRequests > 0,
    job_id: input.jobId ?? null,
  };
}

/**
 * What coalescing and caching SAVED, in provider calls.
 *
 * Not in money: turning it into money needs a rate, the rate lives in
 * provider_price_book, and this core does not read it. Reported as avoided
 * calls so the caller can price them with the same rates it prices the real
 * ones with — which is the only way the saving and the spend are comparable.
 */
export function avoidedProviderCalls(usage: ProviderUsage): number {
  return usage.cacheHits + usage.coalescedRequests;
}
