// HOMATCH INVESTMENT INTELLIGENCE — the points where the answer changes sign.
//
// A break-even is the most actionable number this product can produce: "rent
// below $410 and this stops covering itself" is a decision, where "net yield
// 4.9%" is a reading. So each of these is computed exactly where the
// arithmetic allows a closed form, and by bisection where the mortgage
// schedule sits inside the expression, and is refused with a named reason
// where it genuinely does not exist.
//
// A BREAK-EVEN THAT DOES NOT EXIST IS NOT ZERO
//
// If the scenario is profitable at every exit price down to nothing, there
// is no break-even exit price; if cash flow is positive from month one,
// there is no occupancy floor. Both return an explicit NOT_MEANINGFUL
// rather than a number, because a break-even rent of $0 rendered on a card
// reads as "this can never fail".

import type {
  BreakEvenModel,
  Figure,
  IncomeModel,
  InvestedCapital,
  InvestmentInput,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { bisect, isPositive, money, orZero, rate } from './core.ts';
import { MONTHS_PER_YEAR, buildIncomeModel } from './income.ts';
import type { DebtLeg } from './leverage.ts';
import { buildDebtLeg, sliceSchedule } from './leverage.ts';
import { buildInvestedCapital } from './capital.ts';
import { buildHoldAndExitModel, holdMonthsFor, sellingCostsFor } from './hold.ts';

export interface BreakEvenInputs {
  input: InvestmentInput;
  capital: InvestedCapital;
  income: IncomeModel;
  debt: DebtLeg;
}

/**
 * The monthly rent at which a target annual figure reaches zero.
 *
 * Rent enters the model in two places at once — it is the income, and it is
 * also the base of a percentage management fee — so the relationship is
 * linear but not a simple division, and re-running the income model at a
 * candidate rent is both exact and cheap.
 */
function rentForZero(
  inputs: BreakEvenInputs,
  includeDebtService: boolean,
): Figure {
  const { input, income, debt } = inputs;
  if (income.operatingExpenses === null) {
    return unavailable(
      'MISSING_INPUT',
      'no operating cost supplied, so there is nothing for rent to break even against',
    );
  }
  const debtService = includeDebtService ? orZero(debt.annualDebtService) : 0;

  const at = (monthlyRent: number): number => {
    const model = buildIncomeModel({ ...input, monthlyRent });
    const noi = model.netOperatingIncome.value;
    if (noi === null) return Number.NaN;
    return noi - debtService;
  };

  // A rent of zero always produces a negative (or zero) result, so the only
  // question is the upper bracket. Ten times the current rent, or a
  // generous absolute ceiling when there is no current rent to scale from.
  const current = isPositive(input.monthlyRent) ? input.monthlyRent : 1000;
  const high = Math.max(current * 20, 100000);
  const solved = bisect(at, 0, high);
  if (solved === null) {
    return unavailable(
      'NOT_MEANINGFUL',
      includeDebtService
        ? 'no monthly rent inside a plausible range makes this scenario cash-flow neutral'
        : 'no monthly rent inside a plausible range makes operating income zero',
    );
  }
  return figure(money(solved));
}

/** Occupied months a year needed for cash flow after debt to reach zero. */
function occupancyForZero(inputs: BreakEvenInputs): Figure {
  const { input, income, debt } = inputs;
  if (!isPositive(input.monthlyRent)) return unavailable('MISSING_INPUT', 'monthlyRent');
  if (income.operatingExpenses === null) {
    return unavailable('MISSING_INPUT', 'no operating cost supplied');
  }
  const debtService = orZero(debt.annualDebtService);

  const at = (occupiedMonths: number): number => {
    const model = buildIncomeModel({
      ...input,
      vacantMonthsPerYear: MONTHS_PER_YEAR - occupiedMonths,
    });
    const noi = model.netOperatingIncome.value;
    if (noi === null) return Number.NaN;
    return noi - debtService;
  };

  if (at(MONTHS_PER_YEAR) < 0) {
    return unavailable(
      'NOT_MEANINGFUL',
      'even fully let for twelve months the scenario does not cover its costs',
    );
  }
  if (at(0) >= 0) {
    return unavailable(
      'NOT_MEANINGFUL',
      'the scenario covers its costs with no rent at all, so there is no occupancy floor',
    );
  }
  const solved = bisect(at, 0, MONTHS_PER_YEAR);
  if (solved === null) return unavailable('NOT_MEANINGFUL', 'no occupancy solves to zero');
  return figure(Math.round(solved * 100) / 100);
}

/**
 * The exit price at which the whole hold-and-sell scenario breaks even.
 *
 * Closed form. profit(P) = operatingCashFlow + P - sellingCosts(P)
 * - remainingDebt - cashInvested, and sellingCosts is affine in P, so:
 *
 *   P * (1 - pct) = cashInvested + remainingDebt + flatSellingCost
 *                   - operatingCashFlow
 */
function breakEvenExitPrice(inputs: BreakEvenInputs): Figure {
  const { input, capital, income, debt } = inputs;
  const holdMonths = holdMonthsFor(input);

  const model = buildHoldAndExitModel({
    input,
    capital,
    income,
    debt,
    // A break-even exit price must exist even before the investor has named
    // an exit price of their own, so a probe value drives the operating
    // half; it cancels out of the arithmetic below.
    exitPriceOverride: capital.purchasePrice > 0 ? capital.purchasePrice : 1,
  });
  if (!model) return unavailable('MISSING_INPUT', 'hold scenario');

  const operatingCashFlow = model.netCashFlowOverHold.value;
  if (operatingCashFlow === null) {
    return unavailable(
      'MISSING_INPUT',
      'rent and operating costs are needed before an exit break-even exists',
    );
  }

  const remainingDebt =
    debt.financed && !debt.refusalMessageKey
      ? sliceSchedule(debt.schedule, holdMonths).remainingPrincipal
      : 0;

  const pct = isPositive(input.sellingCostPercent) ? input.sellingCostPercent / 100 : 0;
  if (pct >= 1) {
    return unavailable('NOT_MEANINGFUL', 'selling costs consume the entire sale price');
  }
  const flat = orZero(input.sellingCostAmount);

  const numerator =
    capital.investorCashInvested + remainingDebt + flat - operatingCashFlow;
  const price = numerator / (1 - pct);
  if (!Number.isFinite(price)) return unavailable('NOT_MEANINGFUL', 'no solution');
  if (price < 0) {
    return unavailable(
      'NOT_MEANINGFUL',
      'the rent alone already returns the invested cash, so any sale price breaks even',
    );
  }
  return figure(money(price));
}

/** First month at which cumulative cash flow after debt turns positive. */
function cashFlowBreakEvenMonth(inputs: BreakEvenInputs): Figure {
  const { income, debt } = inputs;
  const noi = income.netOperatingIncome.value;
  if (noi === null) return unavailable('MISSING_INPUT', 'netOperatingIncome');
  const annual = noi - orZero(debt.annualDebtService);
  if (annual > 0) return figure(1);
  return unavailable(
    'NEVER_RECOVERS',
    'the scenario is cash-flow negative every month at these assumptions',
  );
}

export function buildBreakEvenModel(inputs: BreakEvenInputs): BreakEvenModel {
  const { input, capital, income, debt } = inputs;
  const exitPrice = breakEvenExitPrice(inputs);
  const areaSqm = input.subject?.areaSqm;

  const maximumRenovationBudget: Figure = (() => {
    const model = buildHoldAndExitModel({ input, capital, income, debt });
    if (!model || model.profit.value === null) {
      return unavailable(
        'MISSING_INPUT',
        'an exit scenario is needed before a renovation ceiling exists',
      );
    }
    const headroom = money(capital.renovationCost + model.profit.value);
    if (headroom < 0) {
      return unavailable(
        'NOT_MEANINGFUL',
        'the scenario does not break even even with no renovation at all',
      );
    }
    return figure(headroom);
  })();

  return {
    minimumRentForZeroNoi: rentForZero(inputs, false),
    minimumRentForZeroCashFlow: rentForZero(inputs, true),
    minimumOccupiedMonths: occupancyForZero(inputs),
    breakEvenExitPrice: exitPrice,
    breakEvenExitPricePerSqm:
      exitPrice.value !== null && isPositive(areaSqm)
        ? figure(money(exitPrice.value / areaSqm))
        : unavailable('MISSING_INPUT', 'areaSqm'),
    maximumRenovationBudget,
    cashFlowBreakEvenMonth: cashFlowBreakEvenMonth(inputs),
  };
}

/**
 * Re-run the whole engine at a modified input.
 *
 * Shared by the break-even solvers above, the sensitivity grid and the
 * exit-delay ladder so that "what if" is always answered by the same code
 * path that answered the base case — never by an approximation of it.
 */
export function recomputeFor(input: InvestmentInput): {
  input: InvestmentInput;
  capital: InvestedCapital;
  income: IncomeModel;
  debt: DebtLeg;
} {
  const capital = buildInvestedCapital(input);
  const income = buildIncomeModel(input);
  const debt = buildDebtLeg(input, capital);
  return { input, capital, income, debt };
}

/** Convenience for the sensitivity grid: a percentage, cleanly rounded. */
export function asPercent(value: number): number {
  return rate(value);
}

/** Convenience so the break-even module owns the selling-cost convention too. */
export { sellingCostsFor };
