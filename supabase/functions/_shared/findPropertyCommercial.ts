/*
 * Find Property external discovery: the commercial split of one paid run.
 *
 * Gross is what the customer pays (10 credits = $1), VAT included. At most 45%
 * of gross may be spent on providers (OpenAI, Actors, portals); HOMATCH keeps
 * at least 55%, and the included VAT is funded from that 55% share.
 *
 *   $5  → provider ≤ $2.25 · HOMATCH $2.75 · VAT $0.76 · net $1.99
 *   $10 → provider ≤ $4.50 · HOMATCH $5.50 · VAT $1.53 · net $3.97
 *
 * Pure integer-cent arithmetic. This is a policy calculation only: it reads no
 * production pricing or tax setting and changes neither. The VAT rate is an
 * input so the caller passes the configured value.
 */

export const CREDITS_PER_USD = 10;
export const FIND_PROPERTY_MIN_CREDITS = 50;
export const PROVIDER_SHARE_BPS = 4500;
export const DEFAULT_VAT_BPS = 1800;

export interface CommercialAllocation {
  credits: number;
  grossCents: number;
  /** Hard ceiling on all provider spending for the run. */
  providerCapCents: number;
  /** HOMATCH allocation before VAT (gross − provider cap). */
  homatchCents: number;
  /** VAT contained in the gross price, funded from the HOMATCH share. */
  vatCents: number;
  /** HOMATCH after VAT. */
  netCents: number;
}

export type AllocationError = 'BELOW_CAMPAIGN_MINIMUM' | 'INVALID_CREDITS' | 'INVALID_VAT_RATE';

export function allocate(credits: number, vatBps = DEFAULT_VAT_BPS): CommercialAllocation | { error: AllocationError } {
  if (!Number.isInteger(credits) || credits <= 0) return { error: 'INVALID_CREDITS' };
  if (credits < FIND_PROPERTY_MIN_CREDITS) return { error: 'BELOW_CAMPAIGN_MINIMUM' };
  if (!Number.isInteger(vatBps) || vatBps < 0 || vatBps > 5000) return { error: 'INVALID_VAT_RATE' };
  const grossCents = credits * (100 / CREDITS_PER_USD);
  // The provider share is a cap: round down so it can never exceed 45%.
  const providerCapCents = Math.floor((grossCents * PROVIDER_SHARE_BPS) / 10_000);
  const homatchCents = grossCents - providerCapCents;
  // VAT included in gross: gross × rate / (1 + rate), rounded half-up to the cent.
  const vatCents = Math.round((grossCents * vatBps) / (10_000 + vatBps));
  return { credits, grossCents, providerCapCents, homatchCents, vatCents, netCents: homatchCents - vatCents };
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
