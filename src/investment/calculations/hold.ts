// HOMATCH INVESTMENT INTELLIGENCE — hold, exit, and what the investor
// actually ends up with.
//
// THE COMPLETE MODEL, WHICH IS THE POINT
//
//   cash in    deposit + acquisition costs + renovation + furnishing
//              + one-time financing charges
//   during     rent collected (vacancy already removed)
//              - operating costs
//              - debt service (interest AND principal AND lender fees)
//   at exit    exit price
//              - selling costs
//              - whatever is still owed on the loan
//   result     operating cash flow + net sale proceeds - cash in
//
// Every line of that is a line somebody is tempted to leave out, and each
// omission flatters the deal. Principal repayment in particular is often
// dropped on the grounds that "it comes back at the exit" — it does, and it
// comes back in `netSaleProceeds` because the debt payoff is smaller; it is
// not free money, and counting it twice is the classic error.
//
// THE EXIT PRICE IS THE USER'S SCENARIO AND IS LABELLED AS SUCH EVERYWHERE
//
// Nothing in this engine forecasts a sale price. `exitPriceAssumption` is
// whatever the investor typed, the model is honest about being a model, and
// when no exit price was supplied the whole hold-and-sell block is absent
// rather than filled in at cost.
//
// A RENOVATION IS SPENT AT THE START
//
// Modelled as day-zero cash, not spread across the hold. That is the
// conservative reading (the money is gone before any rent arrives) and it is
// what a flip actually looks like.

import type {
  Figure,
  HoldAndExitModel,
  IncomeModel,
  InvestedCapital,
  InvestmentInput,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { annualize, isPositive, money, orZero, rate } from './core.ts';
import type { DebtLeg } from './leverage.ts';
import { sliceSchedule } from './leverage.ts';
import { MONTHS_PER_YEAR } from './income.ts';

export const DEFAULT_HOLD_MONTHS = 12;

export function holdMonthsFor(input: InvestmentInput): number {
  const raw = input.holdMonths;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_HOLD_MONTHS;
  return Math.min(600, Math.round(raw));
}

export function sellingCostsFor(input: InvestmentInput, exitPrice: number): number {
  let total = 0;
  if (isPositive(input.sellingCostPercent)) total += (exitPrice * input.sellingCostPercent) / 100;
  total += orZero(input.sellingCostAmount);
  return money(Math.max(0, total));
}

/** Rent collected and costs incurred across an arbitrary number of months.
 *  Annual figures are pro-rated; nothing is compounded, because nothing in
 *  this engine grows unless the investor said it does. */
export function operatingOverHold(
  income: IncomeModel,
  holdMonths: number,
): { rentCollected: number | null; operatingCosts: number | null } {
  const years = holdMonths / MONTHS_PER_YEAR;
  const egi = income.effectiveGrossIncome.value;
  const opex = income.operatingExpenses?.totalAnnual ?? null;
  return {
    rentCollected: egi === null ? null : money(egi * years),
    operatingCosts: opex === null ? null : money(opex * years),
  };
}

export interface HoldInputs {
  input: InvestmentInput;
  capital: InvestedCapital;
  income: IncomeModel;
  debt: DebtLeg;
  /** Overrides the input's own hold, for the exit-delay and sensitivity runs. */
  holdMonthsOverride?: number;
  /** Overrides the input's own exit price, for the sensitivity runs. */
  exitPriceOverride?: number;
}

/**
 * The full hold-and-exit result, or null when there is no exit scenario.
 *
 * Null rather than a zero-filled object: "the investor has not said what
 * they would sell for" is a real state of the consultation, and rendering a
 * profit of zero for it would be a fabrication.
 */
export function buildHoldAndExitModel(args: HoldInputs): HoldAndExitModel | null {
  const { input, capital, income, debt } = args;
  const holdMonths = args.holdMonthsOverride ?? holdMonthsFor(input);
  const exitPrice = args.exitPriceOverride ?? input.exitPriceAssumption;

  const operating = operatingOverHold(income, holdMonths);
  const slice = debt.financed && !debt.refusalMessageKey
    ? sliceSchedule(debt.schedule, holdMonths)
    : null;

  const debtServiceOverHold = slice ? slice.payments : 0;
  const remainingDebt = slice ? slice.remainingPrincipal : 0;

  const netCashFlowOverHold: Figure =
    operating.rentCollected === null
      ? unavailable('MISSING_INPUT', 'monthlyRent')
      : operating.operatingCosts === null
        ? unavailable(
            'MISSING_INPUT',
            'no operating cost supplied, so cash flow would be rent minus debt alone',
          )
        : figure(money(operating.rentCollected - operating.operatingCosts - debtServiceOverHold));

  if (!isPositive(exitPrice)) {
    // No exit scenario. Everything about the hold is still true and is
    // returned; the exit half is explicitly unavailable rather than zero.
    const missingExit = (): Figure => unavailable('MISSING_INPUT', 'exitPriceAssumption');
    return {
      holdMonths,
      rentCollectedOverHold:
        operating.rentCollected === null
          ? unavailable('MISSING_INPUT', 'monthlyRent')
          : figure(operating.rentCollected),
      operatingCostsOverHold:
        operating.operatingCosts === null
          ? unavailable('MISSING_INPUT', 'operating costs')
          : figure(operating.operatingCosts),
      debtServiceOverHold: slice ? figure(debtServiceOverHold) : unavailable('NOT_FINANCED'),
      netCashFlowOverHold,
      exitPrice: missingExit(),
      sellingCosts: missingExit(),
      debtPayoff: slice ? figure(remainingDebt) : unavailable('NOT_FINANCED'),
      netSaleProceeds: missingExit(),
      totalCashInvested: figure(capital.investorCashInvested),
      totalCashReturned: missingExit(),
      profit: missingExit(),
      returnOnInvestedCashPercent: missingExit(),
      annualizedReturnPercent: missingExit(),
      capitalGainComponent: missingExit(),
      incomeComponent: netCashFlowOverHold,
    };
  }

  const sellingCosts = sellingCostsFor(input, exitPrice);
  const netSaleProceeds = money(exitPrice - sellingCosts - remainingDebt);
  const totalCashInvested = capital.investorCashInvested;

  const operatingCashFlow = netCashFlowOverHold.value;
  const totalCashReturned: Figure =
    operatingCashFlow === null
      ? figure(netSaleProceeds)
      : figure(money(operatingCashFlow + netSaleProceeds));

  const profit: Figure =
    totalCashReturned.value === null
      ? unavailable('MISSING_INPUT', 'total cash returned')
      : figure(money(totalCashReturned.value - totalCashInvested));

  const roi: Figure = (() => {
    if (profit.value === null) return unavailable('MISSING_INPUT', 'profit');
    if (!isPositive(totalCashInvested)) {
      return unavailable('MISSING_INPUT', 'investorCashInvested');
    }
    return figure(rate((profit.value / totalCashInvested) * 100));
  })();

  return {
    holdMonths,
    rentCollectedOverHold:
      operating.rentCollected === null
        ? unavailable('MISSING_INPUT', 'monthlyRent')
        : figure(operating.rentCollected),
    operatingCostsOverHold:
      operating.operatingCosts === null
        ? unavailable('MISSING_INPUT', 'operating costs')
        : figure(operating.operatingCosts),
    debtServiceOverHold: slice ? figure(debtServiceOverHold) : unavailable('NOT_FINANCED'),
    netCashFlowOverHold,
    exitPrice: figure(money(exitPrice)),
    sellingCosts: figure(sellingCosts),
    debtPayoff: slice ? figure(remainingDebt) : unavailable('NOT_FINANCED'),
    netSaleProceeds: figure(netSaleProceeds),
    totalCashInvested: figure(totalCashInvested),
    totalCashReturned,
    profit,
    returnOnInvestedCashPercent: roi,
    annualizedReturnPercent: annualize(roi.value, holdMonths),
    /*
     * SPLITTING THE PROFIT INTO ITS TWO SOURCES.
     *
     * The capital component is what the price did, net of the cost of
     * selling and of every currency unit that went into the property
     * (renovation included — a flat sold for more because it was renovated
     * did not gain that; the renovation bought it).
     *
     * The income component is the operating cash flow, and the two sum to
     * the profit exactly. Reported separately because "I made $10,000" and
     * "I made $10,000 and $8,000 of it was rent" are different investments.
     */
    capitalGainComponent: figure(
      money(exitPrice - sellingCosts - capital.totalPropertyCapital),
    ),
    /*
     * THE INCOME COMPONENT IS NOT THE CASH FLOW, AND THE DIFFERENCE IS THE
     * PRINCIPAL.
     *
     * Taken as the residual so the two halves always reconcile to the profit
     * exactly rather than to the profit plus a rounding artefact. Doing that
     * makes it identically equal to:
     *
     *     rent collected - operating costs - interest - lender fees
     *
     * which is cash flow with the PRINCIPAL REPAYMENT ADDED BACK — verified
     * on the worked scenario: cash flow -4,128.52, income component
     * -3,295.16, difference 833.36, which is exactly the principal repaid.
     *
     * That is correct rather than a discrepancy. Principal is not a cost: it
     * comes back at the exit as a smaller debt payoff, and counting it as a
     * cost here would be counting it twice. But it does mean the label on
     * this figure must say "after interest", never "after the bank" — the
     * first is true and the second reads as after the whole payment.
     */
    incomeComponent: (() => {
      if (operatingCashFlow === null) return unavailable('MISSING_INPUT', 'operating cash flow');
      const capitalPart = money(exitPrice - sellingCosts - capital.totalPropertyCapital);
      const p = profit.value;
      return p === null ? figure(operatingCashFlow) : figure(money(p - capitalPart));
    })(),
  };
}

/* ── Renovate and sell ──────────────────────────────────────────────── */

export interface RenovationModel {
  renovationSpend: number;
  furnishingSpend: number;
  /** Everything that went in before a single month of rent. */
  capitalDeployedUpFront: number;
  /** Exit price at which the flip exactly breaks even. */
  breakEvenExitPrice: Figure;
  breakEvenExitPricePerSqm: Figure;
  /** The largest renovation spend the scenario tolerates at zero profit. */
  maximumRenovationBudget: Figure;
  /** Where each currency unit of the deployed capital went. */
  allocation: Array<{ key: string; amount: number }>;
}

export function buildRenovationModel(args: {
  input: InvestmentInput;
  capital: InvestedCapital;
  income: IncomeModel;
  debt: DebtLeg;
  breakEvenExitPrice: Figure;
}): RenovationModel {
  const { input, capital } = args;
  const areaSqm = input.subject?.areaSqm;

  const allocation: Array<{ key: string; amount: number }> = [
    { key: 'purchasePrice', amount: capital.purchasePrice },
    { key: 'acquisitionCosts', amount: capital.acquisitionCosts },
    { key: 'renovation', amount: capital.renovationCost },
    { key: 'furnishing', amount: capital.furnishingCost },
    { key: 'financingUpfront', amount: capital.financingUpfrontCosts },
  ].filter((entry) => entry.amount > 0);

  /*
   * MAXIMUM RENOVATION BUDGET.
   *
   * Renovation is pure day-zero cash and appears in the result exactly once
   * (inside investorCashInvested), so the profit moves one-for-one against
   * it. The headroom is therefore the current profit plus whatever is
   * already budgeted — no search needed, and no room for a solver to drift.
   */
  const maximumRenovationBudget: Figure = (() => {
    const model = buildHoldAndExitModel({
      input: args.input,
      capital: args.capital,
      income: args.income,
      debt: args.debt,
    });
    if (!model || model.profit.value === null) {
      return unavailable('MISSING_INPUT', 'a profit figure is needed before headroom exists');
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
    renovationSpend: capital.renovationCost,
    furnishingSpend: capital.furnishingCost,
    capitalDeployedUpFront: capital.investorCashInvested,
    breakEvenExitPrice: args.breakEvenExitPrice,
    breakEvenExitPricePerSqm:
      args.breakEvenExitPrice.value !== null && isPositive(areaSqm)
        ? figure(money(args.breakEvenExitPrice.value / areaSqm))
        : unavailable('MISSING_INPUT', 'areaSqm'),
    maximumRenovationBudget,
    allocation,
  };
}
