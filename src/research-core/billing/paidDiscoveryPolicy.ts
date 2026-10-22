/*
 * PAID EXTERNAL DISCOVERY — PRICING POLICIES.
 *
 * CURRENT (owner, Finance V2, 2026-10-19): paid_discovery_37_63_vat_v2. The customer
 * price P is VAT-inclusive (Georgian VAT 18%, fixed in the policy id). VAT is taken
 * out first; the VAT-exclusive revenue N = P / 1.18 is split 37% HOMATCH / 63%
 * execution, and every directly attributable provider and AI cost is paid from the
 * execution share:
 *
 *   execution budget = 63% of N = P × 6300 / 11800   ($10 → $5.338983, $5 → $2.669491)
 *   charge for spend = spend × 11800 / 6300, capped at P (spend × 1.873…)
 *
 * HISTORICAL: paid_discovery_37_63_v1 (2026-10-16) — the split below on the gross P.
 * A campaign keeps the policy it was stamped with at start; nothing is re-priced.
 *
 * Every paid discovery campaign (Find Buyers/Tenants, Find Property external
 * discovery) splits its customer price P the same way:
 *
 *   HOMATCH profit          = 37% of P   (55% − 18%·P)
 *   external provider budget = 63% of P  (45% + 18%·P)
 *
 * The 18% is of the TOTAL price P, never a VAT-inclusive uplift; statutory VAT
 * is accounted separately and never enters this split.
 *
 * Charging is "consumed ÷ 0.63, capped": the customer pays the provider spend
 * the campaign actually used divided by 0.63, never more than the P they
 * authorised, and the rest of the reservation is released. A fully used $5
 * campaign charges $5.00 ($3.15 providers / $1.85 HOMATCH).
 *
 * Integer arithmetic only (micro-USD and cents), so the edge functions, the
 * SQL twin (public.paid_discovery_provider_share_bps) and Admin reports agree to
 * the cent. Applies to campaigns stamped with PAID_DISCOVERY_POLICY_ID; older
 * campaigns keep the terms they started under.
 */

export const PAID_DISCOVERY_POLICY_ID = 'paid_discovery_37_63_v1';
/** VAT-first policy for campaigns started from Finance V2 on. 18% is part of the id: a new rate is a new policy. */
export const PAID_DISCOVERY_VAT_POLICY_ID = 'paid_discovery_37_63_vat_v2';
export const PAID_DISCOVERY_VAT_BPS = 1800;
/** The policy a NEW campaign is stamped with. */
export const PAID_DISCOVERY_CURRENT_POLICY = PAID_DISCOVERY_VAT_POLICY_ID;
export type PaidDiscoveryPolicyId = typeof PAID_DISCOVERY_POLICY_ID | typeof PAID_DISCOVERY_VAT_POLICY_ID;
export const PAID_DISCOVERY_POLICIES: readonly PaidDiscoveryPolicyId[] = [PAID_DISCOVERY_POLICY_ID, PAID_DISCOVERY_VAT_POLICY_ID];
/** True for a campaign under either paid discovery policy (the commercial campaign checks). */
export function isPaidDiscoveryPolicy(policy: unknown): policy is PaidDiscoveryPolicyId {
  return policy === PAID_DISCOVERY_POLICY_ID || policy === PAID_DISCOVERY_VAT_POLICY_ID;
}
/** Execution share of the GROSS price as a fraction numerator/denominator: v1 6300/10000, v2 6300/11800. */
function executionShare(policy: PaidDiscoveryPolicyId): { num: number; den: number } {
  return policy === PAID_DISCOVERY_VAT_POLICY_ID
    ? { num: PAID_DISCOVERY_PROVIDER_BPS, den: 10_000 + PAID_DISCOVERY_VAT_BPS }
    : { num: PAID_DISCOVERY_PROVIDER_BPS, den: 10_000 };
}
export const PAID_DISCOVERY_PROVIDER_BPS = 6300;
export const PAID_DISCOVERY_HOMATCH_BPS = 10_000 - PAID_DISCOVERY_PROVIDER_BPS; // 3700
/** $5 / 50 credits at 10 credits = $1. */
export const PAID_DISCOVERY_MIN_USD = 5;

const MICROS_PER_USD = 1_000_000;
const MICROS_PER_CENT = 10_000;

function wholeNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number`);
  return value;
}

/** Credits → micro-USD at the configured rate (10 credits = $1 → 1 credit = 100,000 µ$). */
export function creditsToMicros(credits: number, creditsPerUsd: number): number {
  wholeNonNegative(credits, 'credits');
  if (!(creditsPerUsd > 0)) throw new RangeError('creditsPerUsd must be positive');
  return Math.round((credits * MICROS_PER_USD) / creditsPerUsd);
}

/** Cents → credits, kept to 1/100 credit so no cent is lost or invented. */
export function centsToCredits(cents: number, creditsPerUsd: number): number {
  return Math.round(cents * creditsPerUsd) / 100;
}

export interface CampaignAllocation {
  policy: PaidDiscoveryPolicyId;
  priceMicros: number;
  /** Output VAT inside P (0 under v1, where VAT was not part of the split). */
  vatMicros: number;
  /** VAT-exclusive revenue N (= P under v1). */
  netMicros: number;
  providerBudgetMicros: number;
  homatchMarginMicros: number;
  priceCents: number;
  providerBudgetCents: number;
  homatchMarginCents: number;
}

/**
 * Split a price P (micro-USD). v1: provider budget = floor(63% of P), HOMATCH the rest.
 * v2: VAT = P − floor(P / 1.18 rounded half up), execution = floor(P × 6300 / 11800),
 * HOMATCH = N − execution. Integer µ$ throughout (the SQL twin is identical).
 */
export function allocatePriceMicros(priceMicros: number, policy: PaidDiscoveryPolicyId = PAID_DISCOVERY_POLICY_ID): CampaignAllocation {
  const p = Math.floor(wholeNonNegative(priceMicros, 'priceMicros'));
  const share = executionShare(policy);
  const providerBudgetMicros = Math.floor((p * share.num) / share.den);
  const netMicros = policy === PAID_DISCOVERY_VAT_POLICY_ID ? Math.round((p * 10_000) / (10_000 + PAID_DISCOVERY_VAT_BPS)) : p;
  const homatchMarginMicros = netMicros - providerBudgetMicros;
  return {
    policy,
    priceMicros: p,
    vatMicros: p - netMicros,
    netMicros,
    providerBudgetMicros,
    homatchMarginMicros,
    priceCents: Math.floor(p / MICROS_PER_CENT),
    providerBudgetCents: Math.floor(providerBudgetMicros / MICROS_PER_CENT),
    homatchMarginCents: Math.floor(netMicros / MICROS_PER_CENT) - Math.floor(providerBudgetMicros / MICROS_PER_CENT),
  };
}

/** Same split, from the credits the customer authorises. */
export function allocateCampaign(credits: number, creditsPerUsd: number, policy: PaidDiscoveryPolicyId = PAID_DISCOVERY_POLICY_ID): CampaignAllocation {
  return allocatePriceMicros(creditsToMicros(credits, creditsPerUsd), policy);
}

/** Gross micro-USD that pays for `spendMicros` of execution under a policy, rounded up. */
function grossForSpendMicros(spendMicros: number, policy: PaidDiscoveryPolicyId): number {
  const share = executionShare(policy);
  return Math.ceil((spendMicros * share.den) / share.num);
}

export interface SpendCharge {
  policy: PaidDiscoveryPolicyId;
  /** Provider spend actually consumed, capped at the campaign's provider budget. */
  spendMicros: number;
  chargeCents: number;
  chargeCredits: number;
  homatchMarginCents: number;
  releasedCredits: number;
  capped: boolean;
}

/**
 * What a campaign charges for the provider spend it consumed: spend ÷ 0.63,
 * rounded UP to the cent (never undercharging a fraction of a cent of COGS),
 * capped at the authorised price, with everything else released.
 */
export function chargeForSpend(spendMicros: number, authorisedCredits: number, creditsPerUsd: number, policy: PaidDiscoveryPolicyId = PAID_DISCOVERY_POLICY_ID): SpendCharge {
  const spend = Math.ceil(wholeNonNegative(spendMicros, 'spendMicros'));
  const allocation = allocateCampaign(authorisedCredits, creditsPerUsd, policy);
  const grossMicros = grossForSpendMicros(spend, policy);
  const uncappedCents = Math.ceil(grossMicros / MICROS_PER_CENT);
  const capCents = allocation.priceCents;
  const chargeCents = Math.min(uncappedCents, capCents);
  const chargeCredits = Math.min(authorisedCredits, centsToCredits(chargeCents, creditsPerUsd));
  const spendCents = Math.ceil(Math.min(spend, allocation.providerBudgetMicros) / MICROS_PER_CENT);
  return {
    policy,
    spendMicros: Math.min(spend, allocation.providerBudgetMicros),
    chargeCents,
    chargeCredits,
    /* v2: the VAT inside the charge is not HOMATCH's; margin = net charge − spend. */
    homatchMarginCents: Math.max(0, (policy === PAID_DISCOVERY_VAT_POLICY_ID
      ? Math.round((chargeCents * 10_000) / (10_000 + PAID_DISCOVERY_VAT_BPS)) : chargeCents) - spendCents),
    releasedCredits: Math.max(0, Math.round((authorisedCredits - chargeCredits) * 100) / 100),
    capped: uncappedCents > capCents,
  };
}

/**
 * Credits owed for provider spend, consumed ÷ 0.63 rounded up to the cent, with
 * NO cap: the caller's wallet_settle clamps to the reservation and any Expand
 * Research extensions carry the rest, so the cap lives in one place (the wallet).
 */
export function creditsForSpend(spendMicros: number, creditsPerUsd: number, policy: PaidDiscoveryPolicyId = PAID_DISCOVERY_POLICY_ID): number {
  const spend = Math.ceil(wholeNonNegative(spendMicros, 'spendMicros'));
  const cents = Math.ceil(grossForSpendMicros(spend, policy) / MICROS_PER_CENT);
  return centsToCredits(cents, creditsPerUsd);
}

/** Minimum credits for a paid discovery campaign: never below $5. */
export function minimumCampaignCredits(creditsPerUsd: number, configuredMinUsd = PAID_DISCOVERY_MIN_USD): number {
  return Math.ceil(Math.max(PAID_DISCOVERY_MIN_USD, configuredMinUsd) * creditsPerUsd);
}

/** "$3.15" — for Admin/report display only; money math stays in integers above. */
export function formatUsdCents(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}
