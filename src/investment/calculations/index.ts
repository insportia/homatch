// HOMATCH INVESTMENT INTELLIGENCE — the single entry point.
//
// UI code, the Consultant edge function and the tests all call
// `runInvestmentModel`. Nothing outside this directory composes the pieces
// itself, so there is exactly one order in which the model is assembled and
// exactly one place a new capability gets wired in.
//
// THE ORDER MATTERS AND IS NOT ARBITRARY
//
//   capital   what went in; needed before any yield has a denominator
//   income    rent, vacancy, operating costs, net operating income
//   debt      the mortgage engine's answer, sliced to the hold period
//   yields    income over capital, and cash-on-cash which needs debt
//   payback   both kinds, which need income AND debt
//   hold      the exit, which needs every one of the above
//   breakeven the sign changes, which re-run the whole thing internally
//   flow      the picture, which is a projection of the finished model
//
// WHAT `missingInputs` IS FOR
//
// The Consultant's next question. Rather than letting a language model
// decide what it would like to know, the engine reports exactly which
// inputs it needed and did not have, as i18n keys, and the model is asked
// about those. That is why the consultation converges instead of wandering.

import type {
  InvestmentInput,
  InvestmentModel,
  InvestmentValidationError,
} from '../types.ts';
import { isPositive } from './core.ts';
import { buildIncomeModel, buildYieldModel } from './income.ts';
import { buildInvestedCapital, buildPaybackModel } from './capital.ts';
import { buildDebtLeg, buildLeverageModel } from './leverage.ts';
import { buildHoldAndExitModel, holdMonthsFor } from './hold.ts';
import { buildBreakEvenModel } from './breakEven.ts';
import { buildImpliedValuations } from './valuation.ts';
import { buildCapitalFlow } from './flow.ts';

export * from './core.ts';
export * from './income.ts';
export * from './valuation.ts';
export * from './capital.ts';
export * from './leverage.ts';
export * from './hold.ts';
export * from './breakEven.ts';
export * from './sensitivity.ts';
export * from './flow.ts';

/**
 * The bar for running the engine at all.
 *
 * Deliberately low: a purchase price and a currency. Everything else
 * produces a partial model with named gaps, because the product's promise is
 * that typing one sentence gives you something immediately, and a validator
 * that demands twenty fields first would break that promise at the door.
 */
export function validateInvestmentInput(input: InvestmentInput): InvestmentValidationError[] {
  const errors: InvestmentValidationError[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

  if (!num(input.purchasePrice) || input.purchasePrice <= 0) {
    errors.push({ field: 'purchasePrice', messageKey: 'inv_error_purchase_price_invalid' });
  }
  if (!input.currency || typeof input.currency !== 'string') {
    errors.push({ field: 'currency', messageKey: 'inv_error_currency_required' });
  }
  if (input.monthlyRent !== undefined && (!num(input.monthlyRent) || input.monthlyRent < 0)) {
    errors.push({ field: 'monthlyRent', messageKey: 'inv_error_rent_invalid' });
  }
  if (
    input.vacantMonthsPerYear !== undefined &&
    (!num(input.vacantMonthsPerYear) || input.vacantMonthsPerYear < 0 || input.vacantMonthsPerYear > 12)
  ) {
    errors.push({ field: 'vacantMonthsPerYear', messageKey: 'inv_error_vacancy_invalid' });
  }
  if (input.holdMonths !== undefined && (!num(input.holdMonths) || input.holdMonths <= 0 || input.holdMonths > 600)) {
    errors.push({ field: 'holdMonths', messageKey: 'inv_error_hold_invalid' });
  }
  if (
    input.benchmarkYieldPercent !== undefined &&
    (!num(input.benchmarkYieldPercent) || input.benchmarkYieldPercent <= 0 || input.benchmarkYieldPercent > 100)
  ) {
    errors.push({ field: 'benchmarkYieldPercent', messageKey: 'inv_error_benchmark_invalid' });
  }
  if (input.financing) {
    const f = input.financing;
    if (!num(f.annualRatePercent) || f.annualRatePercent < 0 || f.annualRatePercent > 100) {
      errors.push({ field: 'financing', messageKey: 'inv_error_rate_invalid' });
    }
    if (!Number.isInteger(f.termMonths) || f.termMonths <= 0 || f.termMonths > 600) {
      errors.push({ field: 'financing', messageKey: 'inv_error_term_invalid' });
    }
    if (
      f.downPaymentPercent !== undefined &&
      (!num(f.downPaymentPercent) || f.downPaymentPercent < 0 || f.downPaymentPercent > 100)
    ) {
      errors.push({ field: 'financing', messageKey: 'inv_error_down_payment_invalid' });
    }
  }
  const negativeForbidden: Array<[keyof InvestmentInput, unknown]> = [
    ['askingPrice', input.askingPrice],
    ['otherAnnualIncome', input.otherAnnualIncome],
    ['acquisitionCosts', input.acquisitionCosts],
    ['renovationCost', input.renovationCost],
    ['furnishingCost', input.furnishingCost],
    ['exitPriceAssumption', input.exitPriceAssumption],
    ['sellingCostAmount', input.sellingCostAmount],
  ];
  for (const [field, value] of negativeForbidden) {
    if (value !== undefined && (!num(value) || (value as number) < 0)) {
      errors.push({ field, messageKey: 'inv_error_amount_invalid' });
    }
  }
  return errors;
}

/** i18n keys naming the inputs the model wanted and did not get. */
export function missingInputsFor(input: InvestmentInput): string[] {
  const missing: string[] = [];
  if (!isPositive(input.monthlyRent)) missing.push('inv_need_monthly_rent');
  if (input.vacantMonthsPerYear === undefined) missing.push('inv_need_vacancy');
  if (!input.operating || Object.keys(input.operating).length === 0) {
    missing.push('inv_need_operating_costs');
  }
  if (input.acquisitionCosts === undefined && input.acquisitionCostPercent === undefined) {
    missing.push('inv_need_acquisition_costs');
  }
  if (!input.financing) missing.push('inv_need_financing');
  if (!isPositive(input.exitPriceAssumption)) missing.push('inv_need_exit_price');
  if (input.sellingCostPercent === undefined && input.sellingCostAmount === undefined) {
    missing.push('inv_need_selling_costs');
  }
  if (!isPositive(input.benchmarkYieldPercent)) missing.push('inv_need_benchmark_yield');
  if (!isPositive(input.subject?.areaSqm)) missing.push('inv_need_area');
  return missing;
}

/**
 * The whole model, from whatever the consultation has established so far.
 *
 * Throws only on a genuinely invalid input (a negative price), never on an
 * incomplete one — incompleteness is the normal state of a consultation and
 * is reported through `missingInputs` and per-figure `unavailable` reasons.
 */
export function runInvestmentModel(input: InvestmentInput): InvestmentModel {
  const errors = validateInvestmentInput(input);
  if (errors.length) {
    throw new Error(
      `runInvestmentModel called with invalid input: ${errors.map((e) => e.messageKey).join(', ')}`,
    );
  }

  const capital = buildInvestedCapital(input);
  const income = buildIncomeModel(input);
  const debt = buildDebtLeg(input, capital);
  const holdMonths = holdMonthsFor(input);

  const yields = buildYieldModel(income, capital, capital.purchasePrice, debt.annualDebtService);

  const leverage = buildLeverageModel({
    input,
    capital,
    debt,
    netOperatingIncome: income.netOperatingIncome.value,
    holdMonths,
  });

  const payback = buildPaybackModel({
    capital,
    netOperatingIncome: income.netOperatingIncome.value,
    annualNetCashFlowAfterDebt: leverage.annualNetCashFlowAfterDebt.value,
    monthlyPrincipalRepaid: debt.schedule.map((row) => row.principalPortion),
  });

  const holdAndExit = buildHoldAndExitModel({ input, capital, income, debt });
  const breakEven = buildBreakEvenModel({ input, capital, income, debt });

  return {
    input,
    currency: input.currency,
    income,
    yields,
    capital,
    impliedValuations: buildImpliedValuations(input, income),
    payback,
    leverage,
    holdAndExit,
    breakEven,
    capitalFlow: buildCapitalFlow({ capital, income, leverage, holdAndExit }),
    missingInputs: missingInputsFor(input),
  };
}
