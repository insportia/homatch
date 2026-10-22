// EMAIL MARKETING ECONOMICS — pure arithmetic, five layers kept apart:
//   A  customer plan price and allowance (HOMATCH's commercial terms)
//   B  Resend transactional cost (/emails, priced per email, account-wide tiers)
//   C  Resend Marketing cost (Broadcasts, priced by CONTACTS, sends not limited)
//   D  other execution cost (AI, domains add-on, infrastructure) — passed in, never assumed
//   E  VAT and the internal 37/63 allocation of VAT-exclusive revenue
//
// Allocations are not costs, and estimates are labelled as estimates by the caller.
// Every figure is computed at full precision; rounding is for display only.

export const VAT_BPS = 1800;
export const HOMATCH_SHARE = 0.37;
export const EXECUTION_SHARE = 0.63;

export const HOMATCH_PLANS = {
  FREE: { grossUsd: 0, includedEmails: 50, period: 'LIFETIME' as const },
  PRO: { grossUsd: 50, includedEmails: 50_000, period: 'MONTH' as const },
  SCALE: { grossUsd: 220, includedEmails: 100_000, period: 'MONTH' as const },
};
export const OVERAGE_GROSS_PER_1K = 2.2;

export interface VatSplit { gross: number; net: number; vat: number }

/** gross is VAT-inclusive: net = gross × 10000 / (10000 + bps); VAT = gross − net. */
export function splitVat(grossUsd: number, vatBps = VAT_BPS): VatSplit {
  const net = (grossUsd * 10_000) / (10_000 + vatBps);
  return { gross: grossUsd, net, vat: grossUsd - net };
}

export interface Allocation extends VatSplit { homatch: number; execution: number }

export function allocate(grossUsd: number, vatBps = VAT_BPS): Allocation {
  const s = splitVat(grossUsd, vatBps);
  return { ...s, homatch: s.net * HOMATCH_SHARE, execution: s.net * EXECUTION_SHARE };
}

/* ── layer B: Resend transactional (verified 2026-10-22) ─────────────────── */

export interface TxTier { name: string; monthlyUsd: number; emails: number; overagePer1k: number | null; domains: number }
export const RESEND_TX_TIERS: TxTier[] = [
  { name: 'Free', monthlyUsd: 0, emails: 3_000, overagePer1k: null, domains: 3 },
  { name: 'Pro 50k', monthlyUsd: 20, emails: 50_000, overagePer1k: 0.9, domains: 10 },
  { name: 'Pro 100k', monthlyUsd: 35, emails: 100_000, overagePer1k: 0.9, domains: 10 },
  { name: 'Scale 100k', monthlyUsd: 90, emails: 100_000, overagePer1k: 0.9, domains: 1_000 },
  { name: 'Scale 200k', monthlyUsd: 160, emails: 200_000, overagePer1k: 0.8, domains: 1_000 },
  { name: 'Scale 500k', monthlyUsd: 350, emails: 500_000, overagePer1k: 0.7, domains: 1_000 },
  { name: 'Scale 1M', monthlyUsd: 650, emails: 1_000_000, overagePer1k: 0.65, domains: 1_000 },
  { name: 'Scale 1.5M', monthlyUsd: 825, emails: 1_500_000, overagePer1k: 0.52, domains: 1_000 },
  { name: 'Scale 2.5M', monthlyUsd: 1_150, emails: 2_500_000, overagePer1k: 0.46, domains: 1_000 },
];

/** Monthly provider cost of sending `emails` on one tier (base + overage in started thousands). */
export function txCostOnTier(tier: TxTier, emails: number): number | null {
  if (emails <= tier.emails) return tier.monthlyUsd;
  if (tier.overagePer1k == null) return null;
  return tier.monthlyUsd + Math.ceil((emails - tier.emails) / 1000) * tier.overagePer1k;
}

/** The cheapest transactional tier (optionally requiring a domain count) for an ACCOUNT-WIDE volume. */
export function cheapestTx(emails: number, minDomains = 0): { tier: TxTier; costUsd: number } | null {
  let best: { tier: TxTier; costUsd: number } | null = null;
  for (const tier of RESEND_TX_TIERS) {
    if (tier.domains < minDomains) continue;
    const c = txCostOnTier(tier, emails);
    if (c == null) continue;
    if (!best || c < best.costUsd) best = { tier, costUsd: c };
  }
  return best;
}

/** Marginal transactional cost per 1,000 emails once the account is on a tier (its overage rate). */
export function txMarginalPer1k(tier: TxTier): number | null {
  return tier.overagePer1k;
}

/* ── layer C: Resend Marketing (Broadcasts; contacts-priced) ─────────────── */

export interface MkTier { name: string; monthlyUsd: number; contacts: number }
export const RESEND_MK_TIERS: MkTier[] = [
  { name: 'Free', monthlyUsd: 0, contacts: 1_000 },
  { name: 'Pro 5k', monthlyUsd: 40, contacts: 5_000 },
  { name: 'Pro 10k', monthlyUsd: 80, contacts: 10_000 },
  { name: 'Pro 15k', monthlyUsd: 120, contacts: 15_000 },
  { name: 'Pro 25k', monthlyUsd: 180, contacts: 25_000 },
  { name: 'Pro 50k', monthlyUsd: 250, contacts: 50_000 },
  { name: 'Pro 100k', monthlyUsd: 450, contacts: 100_000 },
  { name: 'Pro 150k', monthlyUsd: 650, contacts: 150_000 },
];

/** The smallest Marketing tier holding `contacts` (account-wide), or null above the published range. */
export function marketingTierFor(contacts: number): MkTier | null {
  return RESEND_MK_TIERS.find((t) => contacts <= t.contacts) ?? null;
}

/* ── per-customer scenarios ──────────────────────────────────────────────── */

export interface Scenario {
  plan: 'PRO' | 'SCALE';
  route: 'TRANSACTIONAL' | 'BROADCAST';
  emails: number;
  contacts: number;
  revenue: Allocation;
  providerCostUsd: number | null;
  /** Net revenue minus provider cost (other execution cost D not included). */
  contributionUsd: number | null;
  /** Execution allocation minus provider cost: what is left of the 63% after Resend. */
  executionHeadroomUsd: number | null;
  note: string;
}

/**
 * One customer's month. Transactional: priced at the marginal rate of the tier the WHOLE
 * account is on (`accountTier`), because Resend bills HOMATCH's account, not each customer.
 * Broadcast: the customer's contacts consume Marketing tier capacity; their share is the
 * tier price × (contacts / tier contacts) — sends themselves are not priced.
 */
export function scenario(plan: 'PRO' | 'SCALE', route: 'TRANSACTIONAL' | 'BROADCAST', emails: number, contacts: number, accountTier?: TxTier): Scenario {
  const revenue = allocate(HOMATCH_PLANS[plan].grossUsd);
  let providerCostUsd: number | null;
  let note: string;
  if (route === 'TRANSACTIONAL') {
    const tier = accountTier ?? RESEND_TX_TIERS[3];
    const rate = tier.overagePer1k ?? (tier.emails ? tier.monthlyUsd / (tier.emails / 1000) : null);
    providerCostUsd = rate == null ? null : (emails / 1000) * rate;
    note = `transactional at ${tier.name} marginal $${rate}/1k`;
  } else {
    const t = marketingTierFor(contacts);
    providerCostUsd = t ? (t.monthlyUsd * contacts) / t.contacts : null;
    note = t ? `broadcast: ${contacts} contacts on ${t.name} ($${t.monthlyUsd}/${t.contacts})` : 'contacts above published Marketing tiers';
  }
  return {
    plan, route, emails, contacts, revenue, providerCostUsd,
    contributionUsd: providerCostUsd == null ? null : revenue.net - providerCostUsd,
    executionHeadroomUsd: providerCostUsd == null ? null : revenue.execution - providerCostUsd,
    note,
  };
}

/** Overage block economics: $2.20 gross per 1,000 vs the account's transactional marginal rate. */
export function overageBlock(accountTier: TxTier = RESEND_TX_TIERS[3]): Allocation & { providerCostUsd: number | null } {
  return { ...allocate(OVERAGE_GROSS_PER_1K), providerCostUsd: accountTier.overagePer1k };
}

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(digits)}`;
