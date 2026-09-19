// HOMATCH HOME FINANCING — the two non-numeric tables.
//
// WHAT TO LOOK AT (§4) and BEFORE YOU SIGN (§9). Both are lists of
// things a borrower should inspect; they differ in when.
//
//   The CHECKLIST is for while you are choosing — fifteen things that
//   decide whether one offer is better FOR YOU than another, each tied
//   to the field in this workspace that already holds the answer, so the
//   list can tick itself as the borrower fills the form.
//
//   BEFORE YOU SIGN is for after you have chosen — the clauses people
//   agree to without reading. Those cannot tick themselves: nothing in a
//   calculator knows what a contract says. So each one carries a
//   question to ask the bank and a thing to find in the document.
//
// NEITHER TABLE RANKS ANYTHING. There is no "good" value for a
// checklist item, because whether a 3% origination fee is acceptable
// depends on what the alternative charges — which is what the offer
// comparison is for.
//
// Plain data, no React, so the tests can import it directly.

import type { MortgageInput } from './types.ts';

/* ── §4: what to look at when comparing ─────────────────────────────── */

export type ChecklistGroup = 'COST' | 'TERMS' | 'RISK' | 'EXIT';

export interface ChecklistItem {
  id: string;
  group: ChecklistGroup;
  labelKey: string;
  /** Why this one matters, in one sentence. */
  whyKey: string;
  /** The question to put to the bank when the answer is not on paper. */
  askKey: string;
  /**
   * The MortgageInput field that answers this item, when one does.
   *
   * Items with no field are things a calculator cannot know — an
   * early-repayment clause, a penalty schedule — and they stay
   * unticked by design rather than being quietly marked done.
   */
  field?: keyof MortgageInput;
}

export const CHECKLIST: ChecklistItem[] = [
  {
    id: 'effective_rate',
    group: 'COST',
    labelKey: 'mortgage_check_effective_rate',
    whyKey: 'mortgage_check_effective_rate_why',
    askKey: 'mortgage_check_effective_rate_ask',
    field: 'effectiveAnnualRatePercentFromBank',
  },
  {
    id: 'monthly_payment',
    group: 'COST',
    labelKey: 'mortgage_check_monthly_payment',
    whyKey: 'mortgage_check_monthly_payment_why',
    askKey: 'mortgage_check_monthly_payment_ask',
  },
  {
    id: 'total_repayment',
    group: 'COST',
    labelKey: 'mortgage_check_total_repayment',
    whyKey: 'mortgage_check_total_repayment_why',
    askKey: 'mortgage_check_total_repayment_ask',
  },
  {
    id: 'total_interest',
    group: 'COST',
    labelKey: 'mortgage_check_total_interest',
    whyKey: 'mortgage_check_total_interest_why',
    askKey: 'mortgage_check_total_interest_ask',
  },
  {
    id: 'initial_fees',
    group: 'COST',
    labelKey: 'mortgage_check_initial_fees',
    whyKey: 'mortgage_check_initial_fees_why',
    askKey: 'mortgage_check_initial_fees_ask',
    field: 'originationFeePercent',
  },
  {
    id: 'recurring_fees',
    group: 'COST',
    labelKey: 'mortgage_check_recurring_fees',
    whyKey: 'mortgage_check_recurring_fees_why',
    askKey: 'mortgage_check_recurring_fees_ask',
    field: 'monthlyFeeFlat',
  },
  {
    id: 'insurance',
    group: 'COST',
    labelKey: 'mortgage_check_insurance',
    whyKey: 'mortgage_check_insurance_why',
    askKey: 'mortgage_check_insurance_ask',
    field: 'mandatoryInsuranceAnnualFlat',
  },
  {
    id: 'valuation',
    group: 'COST',
    labelKey: 'mortgage_check_valuation',
    whyKey: 'mortgage_check_valuation_why',
    askKey: 'mortgage_check_valuation_ask',
    field: 'valuationFeeFlat',
  },
  {
    id: 'rate_type',
    group: 'TERMS',
    labelKey: 'mortgage_check_rate_type',
    whyKey: 'mortgage_check_rate_type_why',
    askKey: 'mortgage_check_rate_type_ask',
    field: 'rateType',
  },
  {
    id: 'rate_exposure',
    group: 'RISK',
    labelKey: 'mortgage_check_rate_exposure',
    whyKey: 'mortgage_check_rate_exposure_why',
    askKey: 'mortgage_check_rate_exposure_ask',
    field: 'indexOrReferenceName',
  },
  {
    id: 'currency_risk',
    group: 'RISK',
    labelKey: 'mortgage_check_currency_risk',
    whyKey: 'mortgage_check_currency_risk_why',
    askKey: 'mortgage_check_currency_risk_ask',
    field: 'propertyCurrency',
  },
  {
    id: 'grace_period',
    group: 'TERMS',
    labelKey: 'mortgage_check_grace_period',
    whyKey: 'mortgage_check_grace_period_why',
    askKey: 'mortgage_check_grace_period_ask',
    field: 'gracePeriodMonths',
  },
  {
    id: 'early_repayment',
    group: 'EXIT',
    labelKey: 'mortgage_check_early_repayment',
    whyKey: 'mortgage_check_early_repayment_why',
    askKey: 'mortgage_check_early_repayment_ask',
  },
  {
    id: 'refinancing',
    group: 'EXIT',
    labelKey: 'mortgage_check_refinancing',
    whyKey: 'mortgage_check_refinancing_why',
    askKey: 'mortgage_check_refinancing_ask',
  },
  {
    id: 'penalties',
    group: 'EXIT',
    labelKey: 'mortgage_check_penalties',
    whyKey: 'mortgage_check_penalties_why',
    askKey: 'mortgage_check_penalties_ask',
  },
];

export const CHECKLIST_GROUP_ORDER: ChecklistGroup[] = ['COST', 'TERMS', 'RISK', 'EXIT'];

export const CHECKLIST_GROUP_LABELS: Record<ChecklistGroup, string> = {
  COST: 'mortgage_check_group_cost',
  TERMS: 'mortgage_check_group_terms',
  RISK: 'mortgage_check_group_risk',
  EXIT: 'mortgage_check_group_exit',
};

/**
 * Which checklist items the workspace can already answer.
 *
 * Only items with a `field` can ever be answered here, and only when
 * that field actually holds something. An item is never ticked because
 * it "probably does not apply" — that is precisely the assumption this
 * list exists to prevent.
 */
export function answeredChecklistItems(input: MortgageInput | null): Set<string> {
  const answered = new Set<string>();
  if (!input) return answered;
  for (const item of CHECKLIST) {
    if (!item.field) continue;
    const value = input[item.field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    answered.add(item.id);
  }
  return answered;
}

/* ── §9: before you sign ────────────────────────────────────────────── */

/**
 * One contractual topic.
 *
 * The four-part shape is the point. "Early repayment fees can be capped"
 * is trivia; "ask what the fee is in the first three years, and find the
 * clause that states it" is something a person can act on at a desk in a
 * bank.
 */
export interface SigningTopic {
  id: string;
  titleKey: string;
  /** Short by default — one line, shown collapsed. */
  summaryKey: string;
  whatKey: string;
  whyKey: string;
  askKey: string;
  checkKey: string;
}

/**
 * The five original topics, each opened up into the four-part shape.
 *
 * Their `_title` and `_body` keys are the ones already shipped and
 * translated; `_body` becomes the WHAT and the other three are new. No
 * topic was added that this product cannot support from its own data or
 * from a source in the knowledge base — a sixth about, say, notary
 * practice would be a plausible-sounding paragraph with nothing behind
 * it, which is exactly what §16 forbids.
 */
export const SIGNING_TOPICS: SigningTopic[] = [
  {
    id: 'early_repayment',
    titleKey: 'mortgage_hidden_early_repayment_title',
    summaryKey: 'mortgage_sign_early_repayment_summary',
    whatKey: 'mortgage_hidden_early_repayment_body',
    whyKey: 'mortgage_sign_early_repayment_why',
    askKey: 'mortgage_sign_early_repayment_ask',
    checkKey: 'mortgage_sign_early_repayment_check',
  },
  {
    id: 'fx_risk',
    titleKey: 'mortgage_hidden_fx_risk_title',
    summaryKey: 'mortgage_sign_fx_risk_summary',
    whatKey: 'mortgage_hidden_fx_risk_body',
    whyKey: 'mortgage_sign_fx_risk_why',
    askKey: 'mortgage_sign_fx_risk_ask',
    checkKey: 'mortgage_sign_fx_risk_check',
  },
  {
    id: 'closing_costs',
    titleKey: 'mortgage_hidden_closing_costs_title',
    summaryKey: 'mortgage_sign_closing_costs_summary',
    whatKey: 'mortgage_hidden_closing_costs_body',
    whyKey: 'mortgage_sign_closing_costs_why',
    askKey: 'mortgage_sign_closing_costs_ask',
    checkKey: 'mortgage_sign_closing_costs_check',
  },
  {
    id: 'insurance',
    titleKey: 'mortgage_hidden_insurance_title',
    summaryKey: 'mortgage_sign_insurance_summary',
    whatKey: 'mortgage_hidden_insurance_body',
    whyKey: 'mortgage_sign_insurance_why',
    askKey: 'mortgage_sign_insurance_ask',
    checkKey: 'mortgage_sign_insurance_check',
  },
  {
    id: 'legal_cap',
    titleKey: 'mortgage_hidden_legal_cap_title',
    summaryKey: 'mortgage_sign_legal_cap_summary',
    whatKey: 'mortgage_hidden_legal_cap_body',
    whyKey: 'mortgage_sign_legal_cap_why',
    askKey: 'mortgage_sign_legal_cap_ask',
    checkKey: 'mortgage_sign_legal_cap_check',
  },
  {
    id: 'grace_period',
    titleKey: 'mortgage_sign_grace_title',
    summaryKey: 'mortgage_sign_grace_summary',
    whatKey: 'mortgage_sign_grace_what',
    whyKey: 'mortgage_sign_grace_why',
    askKey: 'mortgage_sign_grace_ask',
    checkKey: 'mortgage_sign_grace_check',
  },
];
