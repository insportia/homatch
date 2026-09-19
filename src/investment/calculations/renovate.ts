// HOMATCH INVESTMENT INTELLIGENCE — buy, renovate, resell.
//
// The hold-and-exit engine already models money going in, time passing and
// a sale happening. What a flip needs on top of it is the set of figures an
// investor in this specific business actually works from:
//
//   ALL-IN COST PER m²   the number a flipper compares against the market,
//                        because it is the one that says whether the deal
//                        was ever possible at the resale they are assuming.
//   BREAK-EVEN RESALE    and the same per m².
//   REQUIRED RESALE      what the sale has to reach to hit their return.
//   MARGIN OF SAFETY     how far the resale can fall before it stops working.
//
// The sale itself — the exit price, the cost of selling, the debt payoff and
// the net proceeds — comes straight from buildHoldAndExitModel, so those
// figures cannot disagree with the ledger below them.
//
// The POSITION does not, and that is deliberate. A flip carries two costs
// the rental engine has no concept of — the monthly cost of holding the
// property while the works run, and a one-off "other works" line — and they
// are the investor's money just as much as the renovation is. They are
// stated once, below, and every return and break-even here is measured
// against that one figure.

import type { Figure, IncomeModel, InvestedCapital, InvestmentInput } from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { annualize, isPositive, money, orZero, rate } from './core.ts';
import { buildHoldAndExitModel, holdMonthsFor, sellingCostsFor } from './hold.ts';
import type { DebtLeg } from './leverage.ts';

export interface RenovationCostBreakdown {
  purchasePrice: number;
  acquisitionCosts: number;
  renovation: number;
  furnishing: number;
  otherRenovationCosts: number;
  holdingCosts: number;
  /** Everything in, before the sale. */
  totalInvestedCapital: number;
  /** The investor's own cash, which differs once there is a loan. */
  investorCashInvested: number;
}

export interface RenovateResellModel {
  currency: string;
  costs: RenovationCostBreakdown;
  /** Total invested capital divided by the area. The flipper's yardstick. */
  allInCostPerSqm: Figure;
  renovationCostPerSqm: Figure;

  expectedSalePrice: Figure;
  expectedSalePricePerSqm: Figure;
  sellingCosts: Figure;
  netSaleProceeds: Figure;

  netProfit: Figure;
  returnOnInvestedCashPercent: Figure;
  annualizedReturnPercent: Figure;

  breakEvenSalePrice: Figure;
  breakEvenSalePricePerSqm: Figure;
  requiredSalePriceForTargetReturn: Figure;
  requiredSalePricePerSqmForTargetReturn: Figure;
  /** How far the sale can fall from the expectation before profit hits zero. */
  marginOfSafetyPercent: Figure;
  maximumRenovationBudget: Figure;

  monthsToSale: number;
}

export interface RenovateResellInputs {
  input: InvestmentInput;
  capital: InvestedCapital;
  income: IncomeModel;
  debt: DebtLeg;
  /** Costs of carrying the property while the works run, per month. */
  monthlyHoldingCosts?: number;
  /** Renovation spend the investor entered per m² rather than as a total. */
  renovationCostPerSqm?: number;
  otherRenovationCosts?: number;
  targetReturnPercent?: number;
}

/**
 * Renovation spend, however the investor chose to express it.
 *
 * A per-m² figure is multiplied by the area; a total is taken as given. When
 * both are present the TOTAL wins — it is the more specific statement, and a
 * per-m² rate is usually a rule of thumb the investor used to reach it.
 */
export function renovationSpendFor(
  input: InvestmentInput,
  renovationCostPerSqm?: number,
): number {
  if (isPositive(input.renovationCost)) return money(input.renovationCost);
  const area = input.subject?.areaSqm;
  if (isPositive(renovationCostPerSqm) && isPositive(area)) {
    return money(renovationCostPerSqm * area);
  }
  return 0;
}

export function buildRenovateResellModel(args: RenovateResellInputs): RenovateResellModel {
  const { input, capital, income, debt } = args;
  const area = input.subject?.areaSqm;
  const months = holdMonthsFor(input);
  const holdingCosts = money(Math.max(0, orZero(args.monthlyHoldingCosts)) * months);
  const otherRenovationCosts = money(Math.max(0, orZero(args.otherRenovationCosts)));

  const hold = buildHoldAndExitModel({ input, capital, income, debt });

  const totalInvestedCapital = money(capital.totalPropertyCapital + holdingCosts + otherRenovationCosts);
  const investorCashInvested = money(
    capital.investorCashInvested + holdingCosts + otherRenovationCosts,
  );

  const costs: RenovationCostBreakdown = {
    purchasePrice: capital.purchasePrice,
    acquisitionCosts: capital.acquisitionCosts,
    renovation: capital.renovationCost,
    furnishing: capital.furnishingCost,
    otherRenovationCosts,
    holdingCosts,
    totalInvestedCapital,
    investorCashInvested,
  };

  const expectedSalePrice = hold?.exitPrice ?? unavailable('MISSING_INPUT', 'expectedResalePrice');

  /*
   * A FLIP'S CASH POSITION IS NOT THE HOLD LEDGER'S.
   *
   * buildHoldAndExitModel measures the profit against `capital`, which is
   * what the PROPERTY cost — purchase, buying costs, works, furnishing. A
   * flip has two further lines the rental engine has no place for: the
   * monthly cost of carrying the property while the works run, and the
   * one-off "other works" line. Both are real money out of the investor's
   * pocket before the sale, so both belong in the denominator of the
   * return and in the amount the sale has to clear.
   *
   * This was originally attempted by folding those two into the operating
   * costs and re-running the hold. It silently did nothing: the hold reads
   * its operating figures from the IncomeModel it is handed, not from the
   * input, and a flip with no tenant has no operating leg for them to join
   * anyway. The result was a break-even that included the holding costs
   * and a profit that did not — the two most load-bearing figures on the
   * screen disagreeing by exactly the carry.
   *
   * So the flip states its own position, once, and every figure below is
   * derived from it. The operating cash flow is still added where it
   * exists, because a flip with a tenant in place during the works is
   * unusual but not imaginary.
   */
  const operatingCashFlow = hold?.netCashFlowOverHold.value ?? 0;

  const netProfit: Figure =
    hold === null || hold.netSaleProceeds.value === null
      ? unavailable('MISSING_INPUT', 'expectedResalePrice')
      : figure(money(hold.netSaleProceeds.value + operatingCashFlow - investorCashInvested));

  const returnOnInvestedCashPercent: Figure =
    netProfit.value === null
      ? unavailable('MISSING_INPUT', 'expectedResalePrice')
      : !isPositive(investorCashInvested)
        ? unavailable('MISSING_INPUT', 'investorCashInvested')
        : figure(rate((netProfit.value / investorCashInvested) * 100));

  /*
   * BREAK-EVEN AND REQUIRED RESALE, IN CLOSED FORM.
   *
   * profit(S) = S − sellingCosts(S) − investorCashInvested + operatingCashFlow
   * and selling costs are affine in S, so both solve directly. The engine's
   * own break-even solver is not reused here because it is expressed against
   * the operating model's cash flow, and a flip with no rent has none — the
   * two would agree, and this one says what it means in this context.
   */
  const pct = isPositive(input.sellingCostPercent) ? input.sellingCostPercent / 100 : 0;
  const flat = orZero(input.sellingCostAmount);
  const debtAtExit = hold?.debtPayoff.value ?? 0;

  const solveSale = (requiredProfit: number): Figure => {
    if (pct >= 1) {
      return unavailable('NOT_MEANINGFUL', 'selling costs consume the whole sale price');
    }
    const value =
      (investorCashInvested + debtAtExit + flat + requiredProfit - operatingCashFlow) / (1 - pct);
    if (!Number.isFinite(value) || value < 0) return unavailable('NOT_MEANINGFUL', 'no solution');
    return figure(money(value));
  };

  const breakEvenSalePrice = solveSale(0);
  const requiredSalePrice = isPositive(args.targetReturnPercent)
    ? solveSale(money((investorCashInvested * args.targetReturnPercent) / 100))
    : unavailable('MISSING_INPUT', 'targetReturnPercent');

  const marginOfSafetyPercent: Figure = (() => {
    const expected = expectedSalePrice.value;
    const floor = breakEvenSalePrice.value;
    if (expected === null || floor === null) {
      return unavailable('MISSING_INPUT', 'an expected resale price');
    }
    if (!isPositive(expected)) return unavailable('MISSING_INPUT', 'expected resale price');
    return figure(rate(((expected - floor) / expected) * 100));
  })();

  return {
    currency: input.currency,
    costs,
    allInCostPerSqm: isPositive(area)
      ? figure(money(totalInvestedCapital / area))
      : unavailable('MISSING_INPUT', 'areaSqm'),
    renovationCostPerSqm:
      isPositive(area) && capital.renovationCost > 0
        ? figure(money(capital.renovationCost / area))
        : unavailable('MISSING_INPUT', 'areaSqm and renovation cost'),

    expectedSalePrice,
    expectedSalePricePerSqm:
      expectedSalePrice.value !== null && isPositive(area)
        ? figure(money(expectedSalePrice.value / area))
        : unavailable('MISSING_INPUT', 'areaSqm'),
    sellingCosts:
      expectedSalePrice.value === null
        ? unavailable('MISSING_INPUT', 'expectedResalePrice')
        : figure(sellingCostsFor(input, expectedSalePrice.value)),
    netSaleProceeds: hold?.netSaleProceeds ?? unavailable('MISSING_INPUT', 'expectedResalePrice'),

    netProfit,
    returnOnInvestedCashPercent,
    annualizedReturnPercent: annualize(returnOnInvestedCashPercent.value, months),

    breakEvenSalePrice,
    breakEvenSalePricePerSqm:
      breakEvenSalePrice.value !== null && isPositive(area)
        ? figure(money(breakEvenSalePrice.value / area))
        : unavailable('MISSING_INPUT', 'areaSqm'),
    requiredSalePriceForTargetReturn: requiredSalePrice,
    requiredSalePricePerSqmForTargetReturn:
      requiredSalePrice.value !== null && isPositive(area)
        ? figure(money(requiredSalePrice.value / area))
        : unavailable('MISSING_INPUT', 'areaSqm and a target return'),
    marginOfSafetyPercent,
    maximumRenovationBudget: (() => {
      const profit = netProfit.value;
      if (profit === null || profit === undefined) {
        return unavailable('MISSING_INPUT', 'an expected resale price');
      }
      const headroom = money(capital.renovationCost + profit);
      if (headroom < 0) {
        return unavailable(
          'NOT_MEANINGFUL',
          'the resale does not cover the purchase and costs even with no renovation',
        );
      }
      return figure(headroom);
    })(),

    monthsToSale: months,
  };
}

/* ── What actually moves a flip ─────────────────────────────────────── */

/**
 * The flip re-run at a different resale price, or a different time to sale.
 *
 * WHY THIS EXISTS RATHER THAN THE SHARED SCENARIO GRID
 *
 * The shared grid runs the RENTAL engine, whose profit does not know about
 * a flip's monthly carry — the two figures come from different positions,
 * and on one screen that reads as the product contradicting itself. Every
 * row here is a complete re-run of the flip's own model, so the numbers in
 * the table and the numbers above it are the same arithmetic.
 *
 * Two axes, no matrix. A flip has one assumption that dominates everything
 * (the resale) and one that quietly erodes the annualised return (how long
 * it takes). A grid crossing them would imply they interact more than they
 * do.
 */
export interface RenovateScenarioRow {
  /** The change from the investor's own assumption, as a percentage. */
  changePercent: number;
  salePrice: number;
  netProfit: Figure;
  returnOnInvestedCashPercent: Figure;
  annualizedReturnPercent: Figure;
}

export interface RenovateTimingRow {
  monthsToSale: number;
  netProfit: Figure;
  annualizedReturnPercent: Figure;
}

export const DEFAULT_RESALE_MOVES = [15, 10, 5, 0, -5, -10, -15] as const;

export function buildRenovateScenarios(
  args: RenovateResellInputs,
  moves: readonly number[] = DEFAULT_RESALE_MOVES,
): RenovateScenarioRow[] {
  const base = args.input.exitPriceAssumption;
  if (!isPositive(base)) return [];

  return moves.map((changePercent) => {
    const salePrice = money((base * (100 + changePercent)) / 100);
    const model = buildRenovateResellModel({
      ...args,
      input: { ...args.input, exitPriceAssumption: salePrice },
    });
    return {
      changePercent,
      salePrice,
      netProfit: model.netProfit,
      returnOnInvestedCashPercent: model.returnOnInvestedCashPercent,
      annualizedReturnPercent: model.annualizedReturnPercent,
    };
  });
}

/**
 * The same deal, finished later.
 *
 * The profit barely moves — only the carry does — and the annualised return
 * moves a great deal. That gap is the whole argument for getting a flip
 * back on the market, and it is invisible in a single headline.
 */
export function buildRenovateTimings(
  args: RenovateResellInputs,
  extraMonths: readonly number[] = [0, 3, 6, 12],
): RenovateTimingRow[] {
  const baseMonths = holdMonthsFor(args.input);
  if (!isPositive(baseMonths)) return [];

  return extraMonths.map((extra) => {
    const monthsToSale = baseMonths + extra;
    const model = buildRenovateResellModel({
      ...args,
      input: { ...args.input, holdMonths: monthsToSale },
    });
    return {
      monthsToSale,
      netProfit: model.netProfit,
      annualizedReturnPercent: model.annualizedReturnPercent,
    };
  });
}
