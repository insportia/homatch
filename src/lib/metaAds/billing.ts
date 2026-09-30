// META ADS — THE HOMATCH SERVICE BALANCE. Integer minor units throughout.
//
// With the customer's own ad account (CUSTOMER_AD_ACCOUNT, the default) Meta
// bills the ad budget to the customer's card. HOMATCH holds only its service
// fee: fee% of the PLANNED budget, reserved when the campaign launches.
//
//   deposit      money the customer adds. NON-REFUNDABLE to cash, and it
//                stays in their HOMATCH balance for future campaigns.
//   reserved     fee held for a running campaign (ledger HOMATCH_FEE).
//   consumed     the part of a reservation the campaign actually used: the
//                fee on what Meta really spent.
//   released     the part that goes back to the AVAILABLE HOMATCH balance —
//                on a budget decrease, and at the end for unspent budget.
//                Released is never "refunded": nothing leaves HOMATCH.
//
// Fee policy is resolved server-side from the customer's row (never from the
// browser): STANDARD_PERCENT (the admin setting, 9 today), FEE_EXEMPT, or
// CUSTOM_PERCENT. A policy changes HOMATCH's commercial terms only — never
// Meta's billing, policy or limits.

export type FeePolicyKind = 'STANDARD_PERCENT' | 'FEE_EXEMPT' | 'CUSTOM_PERCENT';
export interface FeePolicy { kind: FeePolicyKind; percent?: number | null }

export function effectiveFeePercent(policy: FeePolicy | null | undefined, standardPercent: number): number {
  if (!policy || policy.kind === 'STANDARD_PERCENT') return clampPct(standardPercent);
  if (policy.kind === 'FEE_EXEMPT') return 0;
  return clampPct(Number(policy.percent ?? standardPercent));
}

const clampPct = (p: number) => (Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0);

/** The fee on a planned budget. Rounded half-up to the minor unit. */
export function serviceFeeCents(plannedMediaCents: number, feePercent: number): number {
  return Math.round((Math.max(0, Math.round(plannedMediaCents)) * clampPct(feePercent)) / 100);
}

export const plannedMediaCents = (dailyBudgetCents: number, durationDays: number) =>
  Math.max(0, Math.round(dailyBudgetCents)) * Math.max(0, Math.round(durationDays));

/**
 * ADD FUNDS. What the customer sees before paying:
 *   budget $100, rate 9%, required $9, available $4 → add $5.
 */
export function fundingPlan(input: { dailyBudgetCents: number; durationDays: number; feePercent: number; availableCents: number }) {
  const planned = plannedMediaCents(input.dailyBudgetCents, input.durationDays);
  const required = serviceFeeCents(planned, input.feePercent);
  const available = Math.max(0, Math.round(input.availableCents));
  return {
    plannedMediaCents: planned,
    feePercent: clampPct(input.feePercent),
    requiredCents: required,
    availableCents: available,
    shortfallCents: Math.max(0, required - available),
  };
}

/**
 * EDIT BUDGET / DURATION. The fee a campaign must hold for its new plan, set
 * against what it holds now:
 *
 *   increase  $100 → $200 at 9%: holds 900, needs 1800 → reserve 900 more.
 *   decrease  $200 → $100: holds 1800, needs 900 → release 900 to the
 *             available HOMATCH balance.
 *
 * A release never goes below the fee on what Meta has ALREADY spent — that
 * part is consumed and stays consumed.
 */
export function budgetChange(input: {
  newDailyBudgetCents: number; newDurationDays: number; feePercent: number;
  heldFeeCents: number; spentMediaCents: number;
}) {
  const planned = plannedMediaCents(input.newDailyBudgetCents, input.newDurationDays);
  const required = serviceFeeCents(planned, input.feePercent);
  const held = Math.max(0, Math.round(input.heldFeeCents));
  const consumedFloor = serviceFeeCents(input.spentMediaCents, input.feePercent);
  const target = Math.max(required, consumedFloor);
  return {
    newPlannedMediaCents: planned,
    requiredFeeCents: required,
    additionalCents: Math.max(0, target - held),
    releaseCents: Math.max(0, held - target),
  };
}

/**
 * END / SETTLE. The fee consumed is the fee on the real spend (capped at the
 * plan); the rest of the reservation is released to the available balance.
 */
export function settleServiceFee(input: { heldFeeCents: number; plannedMediaCents: number; spentMediaCents: number; feePercent: number }) {
  const held = Math.max(0, Math.round(input.heldFeeCents));
  const spend = Math.max(0, Math.min(Math.round(input.spentMediaCents), Math.round(input.plannedMediaCents)));
  const consumed = Math.min(held, serviceFeeCents(spend, input.feePercent));
  return { consumedCents: consumed, releaseCents: held - consumed, spendCents: spend };
}

/**
 * The fee a campaign holds right now, from its own ledger rows: every
 * HOMATCH_FEE taken for it, less every release/refund already given back.
 * Keys are per operation, so the same row is never counted twice.
 */
export function heldFeeFromLedger(rows: Array<{ entry_type: string; amount_cents: number | string }>): number {
  let held = 0;
  for (const r of rows) {
    const a = Number(r.amount_cents);
    if (r.entry_type === 'HOMATCH_FEE') held += -a;
    if (r.entry_type === 'FEE_RELEASE' || r.entry_type === 'REFUND') held -= a;
  }
  return Math.max(0, held);
}

/** Customer vocabulary for ledger rows — never "refunded". */
export const LEDGER_LABEL_KEY: Record<string, string> = {
  DEPOSIT: 'mads_ledger_deposit',
  HOMATCH_FEE: 'mads_ledger_service_reserved',
  FEE_RELEASE: 'mads_ledger_released_to_balance',
  REFUND: 'mads_ledger_released_to_balance',
  RESERVE: 'mads_ledger_budget_reserved',
  RELEASE: 'mads_ledger_released_to_balance',
  META_SPEND: 'mads_ledger_meta_spend',
  ADJUSTMENT: 'mads_ledger_adjustment',
};
