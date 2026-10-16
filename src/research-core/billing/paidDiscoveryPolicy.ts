/*
 * PAID EXTERNAL DISCOVERY — THE ONE PRICING POLICY (owner decision, 2026-10-16).
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
  policy: typeof PAID_DISCOVERY_POLICY_ID;
  priceMicros: number;
  providerBudgetMicros: number;
  homatchMarginMicros: number;
  priceCents: number;
  providerBudgetCents: number;
  homatchMarginCents: number;
}

/** Split a price P (micro-USD) into the provider budget (floor of 63%) and HOMATCH's 37% (the remainder). */
export function allocatePriceMicros(priceMicros: number): CampaignAllocation {
  const p = Math.floor(wholeNonNegative(priceMicros, 'priceMicros'));
  const providerBudgetMicros = Math.floor((p * PAID_DISCOVERY_PROVIDER_BPS) / 10_000);
  const homatchMarginMicros = p - providerBudgetMicros;
  return {
    policy: PAID_DISCOVERY_POLICY_ID,
    priceMicros: p,
    providerBudgetMicros,
    homatchMarginMicros,
    priceCents: Math.floor(p / MICROS_PER_CENT),
    providerBudgetCents: Math.floor(providerBudgetMicros / MICROS_PER_CENT),
    homatchMarginCents: Math.floor(p / MICROS_PER_CENT) - Math.floor(providerBudgetMicros / MICROS_PER_CENT),
  };
}

/** Same split, from the credits the customer authorises. */
export function allocateCampaign(credits: number, creditsPerUsd: number): CampaignAllocation {
  return allocatePriceMicros(creditsToMicros(credits, creditsPerUsd));
}

export interface SpendCharge {
  policy: typeof PAID_DISCOVERY_POLICY_ID;
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
export function chargeForSpend(spendMicros: number, authorisedCredits: number, creditsPerUsd: number): SpendCharge {
  const spend = Math.ceil(wholeNonNegative(spendMicros, 'spendMicros'));
  const allocation = allocateCampaign(authorisedCredits, creditsPerUsd);
  const grossMicros = Math.ceil((spend * 10_000) / PAID_DISCOVERY_PROVIDER_BPS);
  const uncappedCents = Math.ceil(grossMicros / MICROS_PER_CENT);
  const capCents = allocation.priceCents;
  const chargeCents = Math.min(uncappedCents, capCents);
  const chargeCredits = Math.min(authorisedCredits, centsToCredits(chargeCents, creditsPerUsd));
  const spendCents = Math.ceil(Math.min(spend, allocation.providerBudgetMicros) / MICROS_PER_CENT);
  return {
    policy: PAID_DISCOVERY_POLICY_ID,
    spendMicros: Math.min(spend, allocation.providerBudgetMicros),
    chargeCents,
    chargeCredits,
    homatchMarginCents: Math.max(0, chargeCents - spendCents),
    releasedCredits: Math.max(0, Math.round((authorisedCredits - chargeCredits) * 100) / 100),
    capped: uncappedCents > capCents,
  };
}

/**
 * Credits owed for provider spend, consumed ÷ 0.63 rounded up to the cent, with
 * NO cap: the caller's wallet_settle clamps to the reservation and any Expand
 * Research extensions carry the rest, so the cap lives in one place (the wallet).
 */
export function creditsForSpend(spendMicros: number, creditsPerUsd: number): number {
  const spend = Math.ceil(wholeNonNegative(spendMicros, 'spendMicros'));
  const cents = Math.ceil(Math.ceil((spend * 10_000) / PAID_DISCOVERY_PROVIDER_BPS) / MICROS_PER_CENT);
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
