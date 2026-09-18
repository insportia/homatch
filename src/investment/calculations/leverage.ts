// HOMATCH INVESTMENT INTELLIGENCE — the financing leg.
//
// THIS FILE COMPUTES NO MORTGAGE ARITHMETIC.
//
// Homatch already has a mortgage authority: src/mortgage/calculations, unit
// tested, with its own stated conventions about grace periods and
// compounding. Every payment, every interest split and every remaining
// balance below comes from calling into it. A second amortisation loop in
// this directory would be a second answer waiting to disagree with the
// first, on the screen, in the same session — the customer can open
// /mortgage in another tab.
//
// THE CALCULATION THIS PRODUCT MUST NEVER MAKE
//
//   sale price - purchase price, divided by the deposit
//
// A $100,000 flat bought with $35,000 of equity and sold a year later at
// $110,000 is NOT a 28.6% return. That figure omits twelve mortgage
// payments, the interest inside them, the principal they repaid, the
// acquisition costs, the rent collected, the months it stood empty, the
// operating costs and the selling costs — and every one of those moves the
// answer. The honest model is in hold.ts and it includes all of them; this
// file supplies the debt half of it.

import type { AmortizationRow, MortgageInput } from '../../mortgage/types.ts';
import {
  buildAmortizationSchedule,
  calculateMortgage,
  validateMortgageInput,
} from '../../mortgage/calculations/amortization.ts';
import { computeEffectiveRate } from '../../mortgage/calculations/effectiveRate.ts';
import type { Figure, InvestedCapital, InvestmentInput, LeverageModel } from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { isPositive, money, orZero, rate } from './core.ts';

/** Everything the debt leg produces, including the raw schedule the rest of
 *  the engine slices. */
export interface DebtLeg {
  financed: boolean;
  schedule: AmortizationRow[];
  monthlyPayment: number | null;
  /** Interest plus principal plus recurring known costs, per year. */
  annualDebtService: number | null;
  effectiveAnnualRatePercent: number | null;
  /** Non-null when financing was requested but could not be modelled. */
  refusalMessageKey: string | null;
}

/**
 * Translate the investment scenario into the mortgage engine's own input.
 *
 * Returns null when there is no financing leg at all, and a refusal (rather
 * than a silently corrected input) when the financing that WAS described
 * cannot be modelled — a 0% deposit on a 0-month term is not something to
 * quietly round into a 20-year loan.
 */
export function toMortgageInput(
  input: InvestmentInput,
  capital: InvestedCapital,
): MortgageInput | null {
  const f = input.financing;
  if (!f) return null;
  if (capital.loanAmount <= 0) return null;
  return {
    propertyPrice: capital.purchasePrice,
    propertyCurrency: input.currency,
    downPayment: money(capital.purchasePrice - capital.loanAmount),
    termMonths: Math.round(f.termMonths),
    nominalAnnualRatePercent: f.annualRatePercent,
    originationFeePercent: f.originationFeePercent,
    originationFeeFlat: f.originationFeeFlat,
    monthlyFeeFlat: f.monthlyFeeFlat,
    annualFeeFlat: f.annualFeeFlat,
    valuationFeeFlat: f.valuationFeeFlat,
    mandatoryInsuranceAnnualFlat: f.mandatoryInsuranceAnnualFlat,
    propertyId: input.subject?.propertyId,
  };
}

export function buildDebtLeg(input: InvestmentInput, capital: InvestedCapital): DebtLeg {
  const empty: DebtLeg = {
    financed: false,
    schedule: [],
    monthlyPayment: null,
    annualDebtService: null,
    effectiveAnnualRatePercent: null,
    refusalMessageKey: null,
  };

  const mortgageInput = toMortgageInput(input, capital);
  if (!mortgageInput) return empty;

  const errors = validateMortgageInput(mortgageInput);
  if (errors.length) {
    return { ...empty, refusalMessageKey: errors[0].messageKey };
  }

  const schedule = buildAmortizationSchedule({
    principal: capital.loanAmount,
    annualRatePercent: mortgageInput.nominalAnnualRatePercent,
    termMonths: mortgageInput.termMonths,
    monthlyFeeFlat: orZero(mortgageInput.monthlyFeeFlat),
    annualFeeFlat: orZero(mortgageInput.annualFeeFlat),
    mandatoryInsuranceAnnualFlat: orZero(mortgageInput.mandatoryInsuranceAnnualFlat),
  });

  const result = calculateMortgage(mortgageInput);
  const effective = computeEffectiveRate(mortgageInput);

  // The first twelve rows, not payment * 12: the recurring known costs a
  // schedule row carries (monthly fee, the twelfth of an annual insurance)
  // are part of what servicing the debt costs a landlord every year, and
  // leaving them out understates the coverage ratio.
  const firstYear = schedule.slice(0, 12);
  const annualDebtService = firstYear.length
    ? money(firstYear.reduce((sum, row) => sum + row.totalPayment, 0))
    : null;

  return {
    financed: true,
    schedule,
    monthlyPayment: result.monthlyPayment,
    annualDebtService,
    effectiveAnnualRatePercent: effective.effectiveAnnualRatePercent,
    refusalMessageKey: null,
  };
}

/** Interest, principal and payments across an arbitrary window of months. */
export function sliceSchedule(
  schedule: readonly AmortizationRow[],
  months: number,
): {
  interest: number;
  principal: number;
  payments: number;
  remainingPrincipal: number;
  monthsCounted: number;
} {
  const n = Math.max(0, Math.min(schedule.length, Math.round(months)));
  // `rows`, not `window`. This file is bundled into a Deno Edge Function and
  // also runs under the Node test runner; shadowing a browser global in code
  // that lives in three runtimes is confusing to read and trips any check
  // that greps for DOM access — which is how this was noticed.
  const rows = schedule.slice(0, n);
  const interest = money(rows.reduce((sum, row) => sum + row.interestPortion, 0));
  const principal = money(rows.reduce((sum, row) => sum + row.principalPortion, 0));
  const payments = money(rows.reduce((sum, row) => sum + row.totalPayment, 0));
  const remainingPrincipal =
    n === 0
      ? schedule.length
        ? schedule[0].openingPrincipal
        : 0
      : rows[rows.length - 1].remainingPrincipal;
  return { interest, principal, payments, remainingPrincipal, monthsCounted: n };
}

export function buildLeverageModel(args: {
  input: InvestmentInput;
  capital: InvestedCapital;
  debt: DebtLeg;
  netOperatingIncome: number | null;
  holdMonths: number;
}): LeverageModel {
  const { capital, debt } = args;

  if (!debt.financed) {
    const notFinanced = (): Figure => unavailable('NOT_FINANCED', 'no financing in this scenario');
    return {
      financed: false,
      loanAmount: figure(0),
      downPayment: figure(capital.purchasePrice),
      loanToValuePercent: figure(0),
      monthlyPayment: notFinanced(),
      annualDebtService: notFinanced(),
      interestPaidOverHold: notFinanced(),
      principalRepaidOverHold: notFinanced(),
      remainingDebtAtExit: notFinanced(),
      debtServiceCoverageRatio: notFinanced(),
      annualNetCashFlowAfterDebt:
        args.netOperatingIncome === null
          ? unavailable('MISSING_INPUT', 'netOperatingIncome')
          : figure(money(args.netOperatingIncome)),
      effectiveAnnualRatePercent: notFinanced(),
    };
  }

  if (debt.refusalMessageKey) {
    const refused = (): Figure => unavailable('MISSING_INPUT', debt.refusalMessageKey ?? undefined);
    return {
      financed: true,
      loanAmount: figure(capital.loanAmount),
      downPayment: figure(money(capital.purchasePrice - capital.loanAmount)),
      loanToValuePercent: refused(),
      monthlyPayment: refused(),
      annualDebtService: refused(),
      interestPaidOverHold: refused(),
      principalRepaidOverHold: refused(),
      remainingDebtAtExit: refused(),
      debtServiceCoverageRatio: refused(),
      annualNetCashFlowAfterDebt: refused(),
      effectiveAnnualRatePercent: refused(),
    };
  }

  const slice = sliceSchedule(debt.schedule, args.holdMonths);
  const annualDebtService = debt.annualDebtService;

  const dscr = (() => {
    if (args.netOperatingIncome === null) {
      return unavailable('MISSING_INPUT', 'netOperatingIncome');
    }
    if (!isPositive(annualDebtService)) return unavailable('NOT_FINANCED', 'no debt service');
    return figure(rate(args.netOperatingIncome / annualDebtService));
  })();

  const netCashFlow = (() => {
    if (args.netOperatingIncome === null) {
      return unavailable('MISSING_INPUT', 'netOperatingIncome');
    }
    return figure(money(args.netOperatingIncome - orZero(annualDebtService)));
  })();

  return {
    financed: true,
    loanAmount: figure(capital.loanAmount),
    downPayment: figure(money(capital.purchasePrice - capital.loanAmount)),
    loanToValuePercent: isPositive(capital.purchasePrice)
      ? figure(rate((capital.loanAmount / capital.purchasePrice) * 100))
      : unavailable('MISSING_INPUT', 'purchasePrice'),
    monthlyPayment:
      debt.monthlyPayment === null
        ? unavailable('MISSING_INPUT', 'monthlyPayment')
        : figure(debt.monthlyPayment),
    annualDebtService:
      annualDebtService === null
        ? unavailable('MISSING_INPUT', 'annualDebtService')
        : figure(annualDebtService),
    interestPaidOverHold: figure(slice.interest),
    principalRepaidOverHold: figure(slice.principal),
    remainingDebtAtExit: figure(slice.remainingPrincipal),
    debtServiceCoverageRatio: dscr,
    annualNetCashFlowAfterDebt: netCashFlow,
    effectiveAnnualRatePercent:
      debt.effectiveAnnualRatePercent === null
        ? unavailable(
            'MISSING_INPUT',
            'the mortgage engine needs the full fee picture before it will state an effective rate',
          )
        : figure(debt.effectiveAnnualRatePercent),
  };
}
