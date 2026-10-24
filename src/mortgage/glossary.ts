// HOMATCH HOME FINANCING — the words, explained where they appear.
//
// A first-time borrower meets "effective rate", "PTI" and "amortisation"
// in the first minute. Each term here has a short explanation (always
// shown when opened) and, for the terms that are about money, a worked
// example. The example uses the person's own scenario when one exists,
// and a stated sample loan otherwise. Every number in an example comes
// out of the existing engine (calculations/amortization.ts and
// effectiveRate.ts): nothing here is a second formula.

import { buildAmortizationSchedule, computeMonthlyPayment, roundCurrency } from './calculations/amortization.ts';
import { annualizeFromSchedule } from './calculations/effectiveRate.ts';

export const GLOSSARY_TERMS = [
  'NOMINAL_RATE', 'EFFECTIVE_RATE', 'FIXED_RATE', 'VARIABLE_RATE', 'REFERENCE_INDEX',
  'PRINCIPAL', 'INTEREST_PAYMENT', 'MONTHLY_INSTALLMENT', 'AMORTIZATION', 'DOWN_PAYMENT',
  'PTI', 'LTV', 'COLLATERAL', 'ADDITIONAL_COLLATERAL', 'CO_BORROWER', 'GUARANTOR',
  'CREDIT_HISTORY', 'ORIGINATION_FEE', 'APPRAISAL', 'INSURANCE', 'EARLY_REPAYMENT',
  'REFINANCING', 'TOTAL_REPAYMENT', 'TOTAL_COST', 'CURRENCY_RISK',
] as const;
export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];

const slug = (term: GlossaryTerm) => term.toLowerCase();
export const termTitleKey = (term: GlossaryTerm) => `mortgage_term_${slug(term)}_title`;
export const termBodyKey = (term: GlossaryTerm) => `mortgage_term_${slug(term)}_body`;
export const termExampleKey = (term: GlossaryTerm) => `mortgage_term_${slug(term)}_example`;

/** Which explanation sits beside which existing label. Labels not listed get none. */
export const TERM_FOR_LABEL: Record<string, GlossaryTerm> = {
  mortgage_label_nominal_rate: 'NOMINAL_RATE',
  mortgage_rate_ours: 'NOMINAL_RATE',
  mortgage_label_effective_rate_bank: 'EFFECTIVE_RATE',
  mortgage_offer_effective_rate: 'EFFECTIVE_RATE',
  mortgage_pic_effective: 'EFFECTIVE_RATE',
  mortgage_label_rate_type: 'VARIABLE_RATE',
  mortgage_rate_type_fixed: 'FIXED_RATE',
  mortgage_rate_type_variable: 'VARIABLE_RATE',
  mortgage_rate_type_indexed: 'REFERENCE_INDEX',
  mortgage_result_loan_amount: 'PRINCIPAL',
  mortgage_pic_loan: 'PRINCIPAL',
  mortgage_label_own_principal: 'PRINCIPAL',
  mortgage_result_total_interest: 'INTEREST_PAYMENT',
  mortgage_result_monthly_label: 'MONTHLY_INSTALLMENT',
  mortgage_metric_monthly_payment: 'MONTHLY_INSTALLMENT',
  mortgage_pic_payment: 'MONTHLY_INSTALLMENT',
  mortgage_label_down_payment: 'DOWN_PAYMENT',
  mortgage_pic_down: 'DOWN_PAYMENT',
  mortgage_pic_pti: 'PTI',
  mortgage_pic_ltv: 'LTV',
  mortgage_rd_q_collateral_value: 'ADDITIONAL_COLLATERAL',
  mortgage_rd_q_co_income: 'CO_BORROWER',
  mortgage_label_origination_fee_percent: 'ORIGINATION_FEE',
  mortgage_offer_initial_costs: 'ORIGINATION_FEE',
  mortgage_label_valuation_fee: 'APPRAISAL',
  mortgage_label_insurance_annual: 'INSURANCE',
  mortgage_label_early_fee: 'EARLY_REPAYMENT',
  mortgage_label_extra_amount: 'EARLY_REPAYMENT',
  mortgage_label_refi_rate: 'REFINANCING',
  mortgage_result_total_repayment: 'TOTAL_REPAYMENT',
  mortgage_metric_total_repayment: 'TOTAL_REPAYMENT',
  mortgage_offer_total_financing_cost: 'TOTAL_COST',
  mortgage_pic_total_cost: 'TOTAL_COST',
};

export interface ExampleScenario {
  propertyPrice: number;
  downPayment: number;
  termMonths: number;
  nominalAnnualRatePercent: number;
  currency: string;
  monthlyNetIncome: number | null;
  originationFeePercent: number | null;
}

/** The loan an example uses when the person has not entered one yet. Shown as a sample, never as theirs. */
export const SAMPLE_SCENARIO: ExampleScenario = {
  propertyPrice: 125_000,
  downPayment: 25_000,
  termMonths: 240,
  nominalAnnualRatePercent: 12,
  currency: 'GEL',
  monthlyNetIncome: 4_000,
  originationFeePercent: 1,
};

export type ExampleVar = { value: number; kind: 'money' | 'percent' | 'years' };
export interface TermExample { key: string; vars: Record<string, ExampleVar>; sample: boolean }

/** A worked example for the money terms; null for terms that are explained in words only. */
export function termExample(term: GlossaryTerm, own: ExampleScenario | null): TermExample | null {
  const s = own ?? SAMPLE_SCENARIO;
  const sample = own === null;
  const loan = roundCurrency(s.propertyPrice - s.downPayment);
  if (loan <= 0 || s.termMonths <= 0) return null;
  const payment = computeMonthlyPayment(loan, s.nominalAnnualRatePercent, s.termMonths);
  const schedule = buildAmortizationSchedule({ principal: loan, annualRatePercent: s.nominalAnnualRatePercent, termMonths: s.termMonths });
  const first = schedule[0];
  const last = schedule[schedule.length - 1];
  const totalInterest = roundCurrency(schedule.reduce((sum, r) => sum + r.interestPortion, 0));
  const money = (value: number): ExampleVar => ({ value, kind: 'money' });
  const pct = (value: number): ExampleVar => ({ value, kind: 'percent' });
  const base = { loan: money(loan), rate: pct(s.nominalAnnualRatePercent), payment: money(payment) };
  const make = (vars: Record<string, ExampleVar>): TermExample => ({ key: termExampleKey(term), vars: { ...base, ...vars }, sample });

  switch (term) {
    case 'NOMINAL_RATE':
    case 'INTEREST_PAYMENT':
    case 'PRINCIPAL':
    case 'MONTHLY_INSTALLMENT':
      return make({ interest: money(first.interestPortion), principal: money(first.principalPortion) });
    case 'AMORTIZATION':
      return make({ interest: money(first.interestPortion), lastInterest: money(last.interestPortion) });
    case 'EFFECTIVE_RATE':
    case 'ORIGINATION_FEE': {
      const feePct = s.originationFeePercent ?? SAMPLE_SCENARIO.originationFeePercent ?? 1;
      const fee = roundCurrency((feePct / 100) * loan);
      const effective = annualizeFromSchedule(roundCurrency(loan - fee), schedule);
      if (effective === null) return null;
      return make({ fee: money(fee), feePct: pct(feePct), effective: pct(roundCurrency(effective)) });
    }
    case 'VARIABLE_RATE':
    case 'FIXED_RATE':
      return make({ shocked: money(computeMonthlyPayment(loan, s.nominalAnnualRatePercent + 2, s.termMonths)) });
    case 'DOWN_PAYMENT':
      return make({ price: money(s.propertyPrice), down: money(s.downPayment), downPct: pct(roundCurrency((s.downPayment / s.propertyPrice) * 100)) });
    case 'LTV':
      return make({ price: money(s.propertyPrice), ltv: pct(roundCurrency((loan / s.propertyPrice) * 100)) });
    case 'PTI': {
      const income = s.monthlyNetIncome ?? SAMPLE_SCENARIO.monthlyNetIncome!;
      return { ...make({ income: money(income), pti: pct(roundCurrency((payment / income) * 100)) }), sample: sample || s.monthlyNetIncome === null };
    }
    case 'TOTAL_REPAYMENT':
      return make({ total: money(roundCurrency(loan + totalInterest)), years: { value: s.termMonths / 12, kind: 'years' } });
    case 'TOTAL_COST':
      return make({ cost: money(totalInterest), years: { value: s.termMonths / 12, kind: 'years' } });
    case 'CURRENCY_RISK':
      return make({ shocked: money(roundCurrency(payment * 1.1)) });
    default:
      return null;
  }
}
