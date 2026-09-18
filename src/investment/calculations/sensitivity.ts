// HOMATCH INVESTMENT INTELLIGENCE — stress testing and the cost of time.
//
// WHAT MAKES THIS HONEST RATHER THAN A SPREADSHEET
//
// Every cell is a COMPLETE re-run of the engine at the modified input. Not
// an elasticity, not a linear approximation around the base case, not a
// gradient. That matters because the relationships here are genuinely not
// linear: the interest rate moves the whole amortisation schedule, the
// hold period moves both the rent collected and the debt remaining, and a
// longer hold at a fixed exit price is a different deal rather than the
// same deal scaled.
//
// EXIT DELAY IS THE SAME MACHINERY POINTED AT ONE AXIS
//
// "What does it cost me if the sale slips six months" is the hold axis with
// the exit price held constant, and it is reported as a DELTA against the
// on-time exit so the answer is the cost of the delay rather than a second
// absolute number to compare by eye.

import type {
  ExitDelayRow,
  Figure,
  InvestmentInput,
  SensitivityAxis,
  SensitivityCell,
  SensitivityGrid,
  SensitivityMetric,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { money } from './core.ts';
import { buildIncomeModel } from './income.ts';
import { buildInvestedCapital } from './capital.ts';
import { buildDebtLeg, sliceSchedule } from './leverage.ts';
import { buildHoldAndExitModel, holdMonthsFor, operatingOverHold } from './hold.ts';
import { buildYieldModel } from './income.ts';
import { buildPaybackModel } from './capital.ts';

/** Apply one axis value to a copy of the input. Never mutates. */
export function applyAxis(
  input: InvestmentInput,
  axis: SensitivityAxis,
  value: number,
): InvestmentInput {
  switch (axis) {
    case 'EXIT_PRICE':
      return { ...input, exitPriceAssumption: value };
    case 'HOLD_MONTHS':
      return { ...input, holdMonths: Math.max(1, Math.round(value)) };
    case 'VACANT_MONTHS':
      return { ...input, vacantMonthsPerYear: Math.min(12, Math.max(0, value)) };
    case 'MONTHLY_RENT':
      return { ...input, monthlyRent: Math.max(0, value) };
    case 'INTEREST_RATE':
      return input.financing
        ? { ...input, financing: { ...input.financing, annualRatePercent: Math.max(0, value) } }
        : input;
    case 'RENOVATION_COST':
      return { ...input, renovationCost: Math.max(0, value) };
    default:
      return input;
  }
}

/** Evaluate one metric at one fully re-run input. */
export function evaluateMetric(input: InvestmentInput, metric: SensitivityMetric): Figure {
  const capital = buildInvestedCapital(input);
  const income = buildIncomeModel(input);
  const debt = buildDebtLeg(input, capital);

  switch (metric) {
    case 'NET_YIELD': {
      const yields = buildYieldModel(income, capital, capital.purchasePrice, debt.annualDebtService);
      return yields.netYieldOnPurchasePrice;
    }
    case 'ANNUAL_NET_CASH_FLOW': {
      const noi = income.netOperatingIncome.value;
      if (noi === null) return unavailable('MISSING_INPUT', 'netOperatingIncome');
      return figure(money(noi - (debt.annualDebtService ?? 0)));
    }
    case 'EQUITY_PAYBACK_YEARS': {
      const noi = income.netOperatingIncome.value;
      const annualCashFlow = noi === null ? null : money(noi - (debt.annualDebtService ?? 0));
      const payback = buildPaybackModel({
        capital,
        netOperatingIncome: noi,
        annualNetCashFlowAfterDebt: annualCashFlow,
        monthlyPrincipalRepaid: debt.schedule.map((r) => r.principalPortion),
      });
      return payback.equityPaybackYears;
    }
    default: {
      const hold = buildHoldAndExitModel({ input, capital, income, debt });
      if (!hold) return unavailable('MISSING_INPUT', 'hold scenario');
      if (metric === 'PROFIT') return hold.profit;
      if (metric === 'RETURN_ON_INVESTED_CASH') return hold.returnOnInvestedCashPercent;
      return hold.annualizedReturnPercent;
    }
  }
}

export interface SensitivityRequest {
  input: InvestmentInput;
  metric: SensitivityMetric;
  rowAxis: SensitivityAxis;
  rowValues: number[];
  columnAxis?: SensitivityAxis | null;
  columnValues?: number[];
}

/** Bound so a client cannot ask for a grid that costs a second of CPU. */
export const MAX_GRID_CELLS = 144;

export function buildSensitivityGrid(request: SensitivityRequest): SensitivityGrid {
  const rowValues = request.rowValues.slice(0, 12);
  const columnAxis = request.columnAxis ?? null;
  const columnValues = columnAxis ? (request.columnValues ?? []).slice(0, 12) : [];

  const cells: SensitivityCell[] = [];
  let produced = 0;

  for (const rowValue of rowValues) {
    if (columnAxis && columnValues.length) {
      for (const columnValue of columnValues) {
        if (produced >= MAX_GRID_CELLS) break;
        const modified = applyAxis(applyAxis(request.input, request.rowAxis, rowValue), columnAxis, columnValue);
        cells.push({ rowValue, columnValue, metric: evaluateMetric(modified, request.metric) });
        produced += 1;
      }
    } else {
      if (produced >= MAX_GRID_CELLS) break;
      const modified = applyAxis(request.input, request.rowAxis, rowValue);
      cells.push({ rowValue, columnValue: null, metric: evaluateMetric(modified, request.metric) });
      produced += 1;
    }
  }

  return {
    metric: request.metric,
    rowAxis: request.rowAxis,
    columnAxis,
    rowValues,
    columnValues,
    cells,
    baseline: evaluateMetric(request.input, request.metric),
  };
}

/* ── Exit delay ─────────────────────────────────────────────────────── */

export const DEFAULT_EXIT_DELAYS = [0, 3, 6, 12] as const;

/**
 * What waiting costs.
 *
 * The exit price is deliberately held constant across the ladder: the point
 * of the question is the cost of TIME, and letting the price drift would
 * mix in a second scenario the investor did not ask about. If they want to
 * vary both, that is the two-axis sensitivity grid.
 */
export function buildExitDelayLadder(
  input: InvestmentInput,
  delays: readonly number[] = DEFAULT_EXIT_DELAYS,
): ExitDelayRow[] {
  const baseHold = holdMonthsFor(input);
  const rows: ExitDelayRow[] = [];

  const runFor = (holdMonths: number) => {
    const scenario = { ...input, holdMonths };
    const capital = buildInvestedCapital(scenario);
    const income = buildIncomeModel(scenario);
    const debt = buildDebtLeg(scenario, capital);
    const hold = buildHoldAndExitModel({ input: scenario, capital, income, debt });
    const slice =
      debt.financed && !debt.refusalMessageKey ? sliceSchedule(debt.schedule, holdMonths) : null;
    const operating = operatingOverHold(income, holdMonths);
    return { hold, slice, operating };
  };

  const base = runFor(baseHold);
  const baseProfit = base.hold?.profit.value ?? null;

  for (const raw of delays) {
    const delayMonths = Math.max(0, Math.round(raw));
    const holdMonths = baseHold + delayMonths;
    const run = runFor(holdMonths);

    const additionalInterest: Figure =
      run.slice && base.slice
        ? figure(money(run.slice.interest - base.slice.interest))
        : unavailable('NOT_FINANCED', 'no financing in this scenario');

    const additionalOperatingCosts: Figure =
      run.operating.operatingCosts === null || base.operating.operatingCosts === null
        ? unavailable('MISSING_INPUT', 'operating costs')
        : figure(money(run.operating.operatingCosts - base.operating.operatingCosts));

    const additionalRentCollected: Figure =
      run.operating.rentCollected === null || base.operating.rentCollected === null
        ? unavailable('MISSING_INPUT', 'monthlyRent')
        : figure(money(run.operating.rentCollected - base.operating.rentCollected));

    const profit = run.hold?.profit ?? unavailable('MISSING_INPUT', 'exitPriceAssumption');

    rows.push({
      delayMonths,
      holdMonths,
      additionalInterest,
      additionalOperatingCosts,
      additionalRentCollected,
      remainingDebtAtExit: run.slice
        ? figure(run.slice.remainingPrincipal)
        : unavailable('NOT_FINANCED'),
      profit,
      returnOnInvestedCashPercent:
        run.hold?.returnOnInvestedCashPercent ?? unavailable('MISSING_INPUT', 'exitPriceAssumption'),
      profitDelta:
        profit.value === null || baseProfit === null
          ? unavailable('MISSING_INPUT', 'profit')
          : figure(money(profit.value - baseProfit)),
    });
  }

  return rows;
}
