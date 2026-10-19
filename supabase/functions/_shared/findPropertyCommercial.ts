/*
 * Find Property paid external discovery: the commercial split of one campaign.
 *
 * The split is the owner's single paid discovery policy (37% HOMATCH / 63%
 * providers of the TOTAL price; src/research-core/billing/paidDiscoveryPolicy.ts).
 * Statutory VAT is accounted separately and never enters this split.
 *
 *   $5  → provider ≤ $3.15 · HOMATCH $1.85
 *   $10 → provider ≤ $6.30 · HOMATCH $3.70
 *
 * Pure integer-cent arithmetic; reads no production setting.
 */
import {
  allocateCampaign, minimumCampaignCredits, PAID_DISCOVERY_CURRENT_POLICY, type PaidDiscoveryPolicyId,
} from '../../../src/research-core/billing/paidDiscoveryPolicy.ts';

export const CREDITS_PER_USD = 10;
export const FIND_PROPERTY_MIN_CREDITS = minimumCampaignCredits(CREDITS_PER_USD); // 50 = $5

export interface CommercialAllocation {
  credits: number;
  grossCents: number;
  /** Hard ceiling on all provider spending for the campaign (63% of VAT-exclusive revenue). */
  providerCapCents: number;
  /** HOMATCH share (37% of VAT-exclusive revenue). */
  homatchCents: number;
  /** Georgian VAT inside the price (gross − VAT-exclusive revenue): provider + HOMATCH + VAT = gross. */
  vatCents: number;
  /** Provider ceiling in micro-USD, the unit the memo23 reservation RPC uses. */
  providerCapMicros: number;
  policy: PaidDiscoveryPolicyId;
}

export type AllocationError = 'BELOW_CAMPAIGN_MINIMUM' | 'INVALID_CREDITS';

export function allocate(credits: number, creditsPerUsd = CREDITS_PER_USD): CommercialAllocation | { error: AllocationError } {
  if (!Number.isInteger(credits) || credits <= 0) return { error: 'INVALID_CREDITS' };
  if (credits < minimumCampaignCredits(creditsPerUsd)) return { error: 'BELOW_CAMPAIGN_MINIMUM' };
  const a = allocateCampaign(credits, creditsPerUsd, PAID_DISCOVERY_CURRENT_POLICY);
  return {
    credits, grossCents: a.priceCents, providerCapCents: a.providerBudgetCents, homatchCents: a.homatchMarginCents,
    vatCents: a.priceCents - a.providerBudgetCents - a.homatchMarginCents,
    providerCapMicros: a.providerBudgetMicros, policy: a.policy,
  };
}

export type SpendDecision =
  | { allowed: true; remainingCents: number }
  | { allowed: false; reason: 'UNKNOWN_COST' | 'PROVIDER_CAP_REACHED' | 'KILL_SWITCH' };

/**
 * Server-side gate before every provider call. An unknown cost is refused,
 * never treated as zero; the cap is never exceeded, not even by one call.
 */
export function authorizeProviderSpend(
  allocation: Pick<CommercialAllocation, 'providerCapCents'>,
  spentCents: number,
  nextCostCents: number | null | undefined,
  opts: { killSwitch?: boolean } = {},
): SpendDecision {
  if (opts.killSwitch) return { allowed: false, reason: 'KILL_SWITCH' };
  if (nextCostCents === null || nextCostCents === undefined || !Number.isFinite(nextCostCents) || nextCostCents < 0) return { allowed: false, reason: 'UNKNOWN_COST' };
  const spent = Math.max(0, spentCents);
  if (spent + nextCostCents > allocation.providerCapCents) return { allowed: false, reason: 'PROVIDER_CAP_REACHED' };
  return { allowed: true, remainingCents: allocation.providerCapCents - spent - nextCostCents };
}
