// src/mortgage/readiness.ts — "how ready am I for a mortgage?", answered from
// published rules and what the person tells us. DETERMINISTIC, NO MODEL.
//
// TWO DIFFERENT QUESTIONS, NEVER BLENDED
//
//   Readiness  — which published conditions the scenario meets, by how much,
//                and what would change the picture. Transparent: every input
//                and every limit is shown with its source.
//   Approval   — a bank's decision. A probability would need a model trained
//                and calibrated on real approval and decline outcomes, and
//                HOMATCH has no such data. So this module returns NO
//                percentage of approval, ever; the UI says so in one line.
//
// The tiers are a summary of the checks below, not a score: HIGH means every
// checked condition is met with room to spare, MEDIUM means met but thin or
// with something a bank will look at closely, CONDITIONS means at least one
// published limit is not met as entered.
//
// Limits come only from mortgage_rules rows, date-effective (rules/ptiLtv.ts).
// Nothing is converted between currencies: income is asked for in the loan's
// currency, and for a foreign-currency loan the income band question is asked
// directly ("at least X GEL or equivalent?") instead of being computed.

import type { LtvLimitRuleData, MortgageInput, MortgageRule, PtiLimitRuleData } from './types';
import { calculateMortgage, computeMonthlyPayment, roundCurrency } from './calculations/amortization.ts';
import { COMFORT_MARGIN_POINTS } from './calculations/financingPicture.ts';
import { classifyCurrency, nextRuleChange, ptiCurrencyClass, selectActiveLtvRule, selectActivePtiRule } from './rules/ptiLtv.ts';

export const INCOME_SOURCES = ['SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER', 'FREELANCER', 'RENTAL', 'EMIGRANT', 'FOREIGN_NATIONAL'] as const;
export type IncomeSource = typeof INCOME_SOURCES[number];
export const INCOME_HISTORY = ['UNDER_6', 'M6_12', 'M12_24', 'OVER_24'] as const;
export type IncomeHistory = typeof INCOME_HISTORY[number];
export const CREDIT_HISTORY = ['CLEAN', 'MINOR_LATE', 'SERIOUS', 'NONE'] as const;
export type CreditHistory = typeof CREDIT_HISTORY[number];

export interface ReadinessInput {
  price: number;
  currency: string;
  downPayment: number;
  termMonths: number;
  ratePercent: number;
  /** Net monthly income, in the LOAN's currency. */
  netMonthlyIncome: number | null;
  /** Whether that income is actually earned in the loan's currency (hedged). */
  incomeInLoanCurrency: boolean | null;
  /** Foreign-currency loans only: is income at or above the band threshold (GEL or equivalent)? */
  incomeAtLeastBand: boolean | null;
  existingMonthlyDebt: number;
  source: IncomeSource | null;
  history: IncomeHistory | null;
  credit: CreditHistory | null;
  coBorrower: { netMonthlyIncome: number; monthlyDebt: number } | null;
  /** Market value of additional property offered as collateral. */
  additionalCollateralValue: number | null;
}

export type CheckStatus = 'OK' | 'ATTENTION' | 'NOT_MET' | 'UNKNOWN';
export interface ReadinessCheck {
  key: 'PTI' | 'LTV' | 'INCOME_HISTORY' | 'CREDIT' | 'INCOME_PROOF' | 'CURRENCY';
  status: CheckStatus;
  vars?: Record<string, string | number>;
}

export type ReadinessTier = 'HIGH' | 'MEDIUM' | 'CONDITIONS' | 'INCOMPLETE';

export interface RuleRef { id: string; sourceUrl: string; authority: string; verifiedAt: string; effectiveFrom: string | null }

export interface ReadinessResult {
  tier: ReadinessTier;
  monthlyPayment: number;
  loanAmount: number;
  totalIncome: number | null;
  totalDebt: number;
  ptiPercent: number | null;
  ptiLimit: number | null;
  ltvPercent: number | null;
  /** LTV against property plus additional collateral — what a bank MAY count. */
  ltvWithCollateralPercent: number | null;
  ltvLimit: number | null;
  /** The largest monthly payment the PTI limit allows after existing debts. */
  maxPayment: number | null;
  /** The largest loan that payment supports at the entered rate and term. */
  maxLoan: number | null;
  checks: ReadinessCheck[];
  gaps: Array<{ key: 'INCOME' | 'LOAN' | 'DOWN_PAYMENT'; amount: number }>;
  ptiRule: RuleRef | null;
  ltvRule: RuleRef | null;
  /** The band threshold to ask about for a foreign-currency loan (from the rule rows). */
  bandThreshold: number | null;
  upcomingChange: { effectiveFrom: string; threshold: number | null; ruleId: string } | null;
}

const ref = (r: MortgageRule<unknown> | null): RuleRef | null => r && ({
  id: r.id, sourceUrl: r.officialSourceUrl, authority: r.sourceAuthority, verifiedAt: r.lastVerifiedAt, effectiveFrom: r.effectiveFrom,
});

/** The bounded (lower-income) PTI band ceiling in force for a currency class. */
export function bandThresholdFor(rules: MortgageRule<PtiLimitRuleData>[], cls: 'LOCAL' | 'FOREIGN', asOf: Date = new Date()): number | null {
  const bounded = rules
    .filter((r) => r.type === 'PTI_LIMIT' && r.data.currencyClass === cls && r.data.incomeTierMaxMonthlyNet !== null)
    .filter((r) => selectActivePtiRule([r], 0, cls, asOf) !== null)
    .map((r) => r.data.incomeTierMaxMonthlyNet as number);
  return bounded.length ? Math.max(...bounded) : null;
}

/** The loan a given monthly payment supports, via the engine's own payment formula. */
export function loanForPayment(payment: number, ratePercent: number, termMonths: number): number {
  if (payment <= 0 || termMonths <= 0) return 0;
  const perUnit = computeMonthlyPayment(1_000_000, ratePercent, termMonths) / 1_000_000;
  return perUnit > 0 ? roundCurrency(payment / perUnit) : 0;
}

export function assessReadiness(
  input: ReadinessInput,
  ptiRules: MortgageRule<PtiLimitRuleData>[],
  ltvRules: MortgageRule<LtvLimitRuleData>[],
  asOf: Date = new Date(),
): ReadinessResult {
  const calc = calculateMortgage({
    propertyPrice: input.price, propertyCurrency: input.currency, downPayment: input.downPayment,
    termMonths: input.termMonths, nominalAnnualRatePercent: input.ratePercent,
  });
  const loan = calc.loanAmount;
  const payment = calc.monthlyPayment;
  const local = classifyCurrency(input.currency) === 'LOCAL';
  const cls = ptiCurrencyClass(input.currency, input.incomeInLoanCurrency ?? undefined);

  const income = input.netMonthlyIncome !== null && input.netMonthlyIncome > 0
    ? input.netMonthlyIncome + (input.coBorrower?.netMonthlyIncome ?? 0) : null;
  const debt = Math.max(0, input.existingMonthlyDebt) + Math.max(0, input.coBorrower?.monthlyDebt ?? 0);

  /* Which band? For a GEL loan the income itself decides. Otherwise the band
     question answers it, with no currency conversion anywhere. */
  const bandThreshold = bandThresholdFor(ptiRules, cls, asOf);
  const bandIncome = income === null ? null
    : local ? income
    : input.incomeAtLeastBand === true ? Number.POSITIVE_INFINITY
    : input.incomeAtLeastBand === false ? 0
    : null;
  const ptiRule = bandIncome === null ? null : selectActivePtiRule(ptiRules, bandIncome, cls, asOf);
  const ltvRule = selectActiveLtvRule(ltvRules, classifyCurrency(input.currency), undefined, asOf);

  const ptiPercent = income ? roundCurrency(((payment + debt) / income) * 100) : null;
  const ptiLimit = ptiRule?.data.maxPtiPercent ?? null;
  const ltvPercent = calc.ltvPercent;
  const collateral = Math.max(0, input.additionalCollateralValue ?? 0);
  const ltvWithCollateralPercent = collateral > 0 && input.price > 0 ? roundCurrency((loan / (input.price + collateral)) * 100) : null;
  const ltvLimit = ltvRule?.data.maxLtvPercent ?? null;

  const maxPayment = income !== null && ptiLimit !== null ? roundCurrency(Math.max(0, (income * ptiLimit) / 100 - debt)) : null;
  const maxLoan = maxPayment !== null ? loanForPayment(maxPayment, input.ratePercent, input.termMonths) : null;

  const checks: ReadinessCheck[] = [];
  /* Repayment capacity. */
  if (ptiPercent === null || ptiLimit === null) checks.push({ key: 'PTI', status: 'UNKNOWN' });
  else if (ptiPercent > ptiLimit) checks.push({ key: 'PTI', status: 'NOT_MET', vars: { pti: ptiPercent, limit: ptiLimit } });
  else if (ptiPercent > ptiLimit - COMFORT_MARGIN_POINTS) checks.push({ key: 'PTI', status: 'ATTENTION', vars: { pti: ptiPercent, limit: ptiLimit } });
  else checks.push({ key: 'PTI', status: 'OK', vars: { pti: ptiPercent, limit: ptiLimit } });
  /* Loan against the property. Extra collateral can help here — and only here. */
  if (ltvPercent === null || ltvLimit === null) checks.push({ key: 'LTV', status: 'UNKNOWN' });
  else if (ltvPercent <= ltvLimit) {
    checks.push({ key: 'LTV', status: ltvPercent > ltvLimit - COMFORT_MARGIN_POINTS ? 'ATTENTION' : 'OK', vars: { ltv: ltvPercent, limit: ltvLimit } });
  } else if (ltvWithCollateralPercent !== null && ltvWithCollateralPercent <= ltvLimit) {
    checks.push({ key: 'LTV', status: 'ATTENTION', vars: { ltv: ltvPercent, limit: ltvLimit, withCollateral: ltvWithCollateralPercent } });
  } else checks.push({ key: 'LTV', status: 'NOT_MET', vars: { ltv: ltvPercent, limit: ltvLimit } });
  /* How long the income has been coming in. */
  if (!input.history) checks.push({ key: 'INCOME_HISTORY', status: 'UNKNOWN' });
  else if (input.history === 'UNDER_6') checks.push({ key: 'INCOME_HISTORY', status: 'NOT_MET' });
  else if (input.history === 'M6_12') checks.push({ key: 'INCOME_HISTORY', status: 'ATTENTION' });
  else checks.push({ key: 'INCOME_HISTORY', status: 'OK' });
  /* Self-reported credit history. */
  if (!input.credit) checks.push({ key: 'CREDIT', status: 'UNKNOWN' });
  else if (input.credit === 'SERIOUS') checks.push({ key: 'CREDIT', status: 'NOT_MET' });
  else if (input.credit === 'MINOR_LATE' || input.credit === 'NONE') checks.push({ key: 'CREDIT', status: 'ATTENTION' });
  else checks.push({ key: 'CREDIT', status: 'OK' });
  /* How the income is proven. Not a rejection: a different set of documents. */
  if (input.source) {
    const formal = input.source === 'SALARIED';
    checks.push({ key: 'INCOME_PROOF', status: formal ? 'OK' : 'ATTENTION', vars: { source: input.source } });
  }
  /* An unhedged foreign-currency loan carries currency risk and a lower limit. */
  if (!local && input.incomeInLoanCurrency === false) checks.push({ key: 'CURRENCY', status: 'ATTENTION' });

  const gaps: ReadinessResult['gaps'] = [];
  if (income !== null && ptiLimit !== null && ptiPercent !== null && ptiPercent > ptiLimit) {
    gaps.push({ key: 'INCOME', amount: roundCurrency(((payment + debt) * 100) / ptiLimit - income) });
    if (maxLoan !== null) gaps.push({ key: 'LOAN', amount: roundCurrency(Math.max(0, loan - maxLoan)) });
  }
  if (ltvPercent !== null && ltvLimit !== null && ltvPercent > ltvLimit) {
    gaps.push({ key: 'DOWN_PAYMENT', amount: roundCurrency(Math.max(0, loan - (input.price * ltvLimit) / 100)) });
  }

  const statuses = checks.map((c) => c.status);
  const tier: ReadinessTier = income === null ? 'INCOMPLETE'
    : statuses.includes('NOT_MET') ? 'CONDITIONS'
    : checks.find((c) => c.key === 'PTI')?.status === 'UNKNOWN' ? 'INCOMPLETE'
    : statuses.includes('ATTENTION') || statuses.includes('UNKNOWN') ? 'MEDIUM'
    : 'HIGH';

  const upcoming = nextRuleChange(ptiRules.filter((r) => r.data.currencyClass === cls), asOf);

  return {
    tier, monthlyPayment: payment, loanAmount: loan, totalIncome: income, totalDebt: debt,
    ptiPercent, ptiLimit, ltvPercent, ltvWithCollateralPercent, ltvLimit, maxPayment, maxLoan,
    checks, gaps, ptiRule: ref(ptiRule), ltvRule: ref(ltvRule), bandThreshold,
    upcomingChange: upcoming?.effectiveFrom
      ? { effectiveFrom: upcoming.effectiveFrom, threshold: upcoming.data.incomeTierMaxMonthlyNet, ruleId: upcoming.id }
      : null,
  };
}

export type ScenarioKey = 'AS_ENTERED' | 'MORE_DOWN' | 'LESS_DEBT' | 'LONGER_TERM' | 'LOWER_PRICE' | 'NO_CO_BORROWER' | 'COLLATERAL';
export interface ReadinessScenario { key: ScenarioKey; result: ReadinessResult; vars: Record<string, number> }

/**
 * "Compare the possible options." Each variant changes ONE thing and is run
 * through the same assessment. Collateral is shown separately because it can
 * only move the loan-to-value check — it never repairs repayment capacity.
 */
export function readinessScenarios(
  input: ReadinessInput,
  ptiRules: MortgageRule<PtiLimitRuleData>[],
  ltvRules: MortgageRule<LtvLimitRuleData>[],
  asOf: Date = new Date(),
): ReadinessScenario[] {
  const run = (key: ScenarioKey, next: ReadinessInput, vars: Record<string, number> = {}) =>
    ({ key, result: assessReadiness(next, ptiRules, ltvRules, asOf), vars });
  const out: ReadinessScenario[] = [run('AS_ENTERED', input)];
  const extraDown = roundCurrency(input.price * 0.1);
  if (input.downPayment + extraDown < input.price) {
    out.push(run('MORE_DOWN', { ...input, downPayment: input.downPayment + extraDown }, { amount: extraDown }));
  }
  if (input.existingMonthlyDebt > 0) out.push(run('LESS_DEBT', { ...input, existingMonthlyDebt: 0 }, { amount: input.existingMonthlyDebt }));
  if (input.termMonths + 60 <= 360) out.push(run('LONGER_TERM', { ...input, termMonths: input.termMonths + 60 }, { years: (input.termMonths + 60) / 12 }));
  const lower = roundCurrency(input.price * 0.9);
  if (lower > input.downPayment) out.push(run('LOWER_PRICE', { ...input, price: lower }, { price: lower }));
  /* What the co-borrower contributes: the same scenario without them. */
  if (input.coBorrower) out.push(run('NO_CO_BORROWER', { ...input, coBorrower: null }));
  if ((input.additionalCollateralValue ?? 0) > 0) out.push(run('COLLATERAL', input, { value: input.additionalCollateralValue as number }));
  return out;
}

/* ── The guided questionnaire's answers (kept on the device) ───────────── */

export interface ReadinessAnswers {
  income: number | null;
  incomeInLoanCurrency: boolean | null;
  incomeAtLeastBand: boolean | null;
  source: IncomeSource | null;
  history: IncomeHistory | null;
  hasDebt: boolean | null;
  debt: number | null;
  hasCoBorrower: boolean | null;
  coIncome: number | null;
  coDebt: number | null;
  hasCollateral: boolean | null;
  collateral: number | null;
  credit: CreditHistory | null;
}

export const EMPTY_ANSWERS: ReadinessAnswers = {
  income: null, incomeInLoanCurrency: null, incomeAtLeastBand: null, source: null, history: null,
  hasDebt: null, debt: null, hasCoBorrower: null, coIncome: null, coDebt: null,
  hasCollateral: null, collateral: null, credit: null,
};

/** Answers + the calculator's scenario → the assessment input. */
export function toReadinessInput(a: ReadinessAnswers, input: MortgageInput): ReadinessInput {
  return {
    price: input.propertyPrice, currency: input.propertyCurrency, downPayment: input.downPayment,
    termMonths: input.termMonths, ratePercent: input.nominalAnnualRatePercent,
    netMonthlyIncome: a.income,
    incomeInLoanCurrency: classifyCurrency(input.propertyCurrency) === 'LOCAL' ? true : a.incomeInLoanCurrency,
    incomeAtLeastBand: a.incomeAtLeastBand,
    existingMonthlyDebt: a.hasDebt ? a.debt ?? 0 : 0,
    source: a.source, history: a.history, credit: a.credit,
    coBorrower: a.hasCoBorrower && a.coIncome ? { netMonthlyIncome: a.coIncome, monthlyDebt: a.coDebt ?? 0 } : null,
    additionalCollateralValue: a.hasCollateral ? a.collateral : null,
  };
}
