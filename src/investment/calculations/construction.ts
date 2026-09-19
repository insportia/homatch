// HOMATCH INVESTMENT INTELLIGENCE — buying during construction and selling
// on completion.
//
// WHY THIS IS NOT THE RENOVATION MODEL WITH DIFFERENT LABELS
//
// A renovation flip deploys its capital at the start and adds value by
// spending on the building. An off-plan purchase does neither. The money
// goes in over a payment schedule, part of the price is typically still
// OWED to the developer at completion, and the value change comes from the
// project finishing rather than from anything the investor does to it.
//
// Three consequences the arithmetic has to respect:
//
//   1. TOTAL CAPITAL AND CASH DEPLOYED ARE DIFFERENT NUMBERS.
//      An investor who has paid 30% of the price and owes the rest has
//      committed the whole price and deployed a third of it. Returning one
//      figure for both is the mistake this model exists to avoid — it is
//      what makes an off-plan deal look either far better or far worse than
//      it is, depending on which one you pick.
//
//   2. THE REMAINING BALANCE BEHAVES LIKE DEBT AT THE EXIT.
//      It is settled out of the sale proceeds, exactly as a mortgage payoff
//      is. So net proceeds are completed value less selling costs less
//      whatever is still owed, and the investor's return is measured against
//      the cash they actually put in.
//
//   3. A DELAY IS NOT FREE AND IS NOT A DISASTER EITHER.
//      It costs more months of holding and financing and pushes the exit
//      out, which lowers the ANNUALISED return without changing the total
//      one. Both are reported, because an investor comparing this against
//      other uses of the money needs the annualised figure and an investor
//      asking "what do I walk away with" needs the total.
//
// NOTHING HERE FORECASTS. The completed value is the investor's own figure,
// labelled as theirs everywhere it is shown, exactly as the resale price is
// in the renovation model.

import type { Figure } from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { annualize, isPositive, money, orZero, rate } from './core.ts';

export interface ConstructionInput {
  currency: string;
  /** The contract price agreed with the developer. */
  purchasePrice: number;
  areaSqm?: number;
  /** Notary, registration, agency. Paid by the investor, not the developer. */
  acquisitionCosts?: number;

  /** Paid at signing. */
  upfrontPayment?: number;
  /** A level instalment, and how many of them are paid before the exit. */
  installmentMonthly?: number;
  installmentCount?: number;
  /**
   * Anything still owed at completion that the schedule above does not
   * cover. When omitted it is DERIVED as price less what has been paid, so
   * the three numbers always reconcile to the contract price.
   */
  remainingDeveloperBalance?: number;

  /** Months from now until the project is expected to complete. */
  monthsToCompletion?: number;
  /** Months the investor expects to wait beyond completion before selling. */
  additionalMonthsToSale?: number;

  /** The investor's own figure for what the finished unit is worth. */
  expectedCompletedPrice?: number;
  expectedCompletedPricePerSqm?: number;

  /** Ongoing cost of carrying the position: interest, fees, anything monthly. */
  monthlyHoldingCosts?: number;
  /** One-off financing charges on money borrowed to fund the instalments. */
  financingCosts?: number;

  sellingCostPercent?: number;
  sellingCostAmount?: number;

  /** The return the investor requires, for the "what price do I need" answer. */
  targetReturnPercent?: number;
}

export interface CapitalDeploymentPoint {
  month: number;
  paidThisMonth: number;
  cumulativePaid: number;
  remainingObligation: number;
}

export interface ConstructionModel {
  currency: string;
  /** Contract price plus the investor's own acquisition costs. */
  totalCapitalCommitted: Figure;
  /** What the investor has actually paid out by the exit. */
  investorCashDeployed: Figure;
  /** Still owed to the developer at the exit. Settled from the proceeds. */
  remainingObligation: Figure;
  /** Month by month, so the schedule can be drawn rather than described. */
  deployment: CapitalDeploymentPoint[];

  expectedCompletedValue: Figure;
  /** Completed value less the contract price. The project's own contribution. */
  expectedAppreciation: Figure;
  appreciationPercent: Figure;

  holdingCostsToExit: Figure;
  sellingCosts: Figure;
  /** Completed value, less selling costs, less what is still owed. */
  expectedSaleProceeds: Figure;

  netProfit: Figure;
  /** Against everything committed, whether or not it was paid in cash. */
  returnOnTotalCapitalPercent: Figure;
  /** Against the cash the investor actually deployed. The truer figure. */
  returnOnInvestorCashPercent: Figure;
  annualizedReturnPercent: Figure;

  breakEvenExitPrice: Figure;
  breakEvenExitPricePerSqm: Figure;
  requiredExitForTargetReturn: Figure;
  /** How far the expected exit sits above break-even, as a share of it. */
  marginOfSafetyPercent: Figure;

  monthsToExit: number;
}

/** Months from purchase to sale: completion plus any wait after it. */
export function monthsToExitFor(input: ConstructionInput): number {
  const toCompletion = isPositive(input.monthsToCompletion) ? input.monthsToCompletion : 0;
  const after = Math.max(0, orZero(input.additionalMonthsToSale));
  return Math.max(1, Math.round(toCompletion + after));
}

/** The completed value: the investor's figure, or their per-m² figure × area. */
export function completedValueFor(input: ConstructionInput): number | null {
  if (isPositive(input.expectedCompletedPrice)) return money(input.expectedCompletedPrice);
  if (isPositive(input.expectedCompletedPricePerSqm) && isPositive(input.areaSqm)) {
    return money(input.expectedCompletedPricePerSqm * input.areaSqm);
  }
  return null;
}

/**
 * The payment schedule, and what is still owed after each month.
 *
 * Instalments stop when the contract price is reached — an investor whose
 * stated schedule over-pays the price has described something inconsistent,
 * and silently letting the total exceed the price would produce a negative
 * remaining balance that then flatters the exit.
 */
export function buildDeployment(input: ConstructionInput): CapitalDeploymentPoint[] {
  const price = money(Math.max(0, input.purchasePrice));
  const upfront = Math.min(price, Math.max(0, orZero(input.upfrontPayment)));
  const monthly = Math.max(0, orZero(input.installmentMonthly));
  const count = Math.max(0, Math.round(orZero(input.installmentCount)));
  const months = monthsToExitFor(input);

  const points: CapitalDeploymentPoint[] = [];
  let paid = upfront;
  points.push({
    month: 0,
    paidThisMonth: money(upfront),
    cumulativePaid: money(paid),
    remainingObligation: money(Math.max(0, price - paid)),
  });

  for (let month = 1; month <= months; month += 1) {
    const due = month <= count ? Math.min(monthly, Math.max(0, price - paid)) : 0;
    paid += due;
    points.push({
      month,
      paidThisMonth: money(due),
      cumulativePaid: money(paid),
      remainingObligation: money(Math.max(0, price - paid)),
    });
  }
  return points;
}

export function buildConstructionModel(input: ConstructionInput): ConstructionModel {
  const price = money(Math.max(0, input.purchasePrice));
  const acquisitionCosts = money(Math.max(0, orZero(input.acquisitionCosts)));
  const financingCosts = money(Math.max(0, orZero(input.financingCosts)));
  const months = monthsToExitFor(input);
  const deployment = buildDeployment(input);
  const last = deployment[deployment.length - 1];

  const paidToDeveloper = last.cumulativePaid;
  /*
   * A stated remaining balance wins over the derived one — the developer's
   * contract is the authority on what is owed, and a schedule the investor
   * half-remembers is not. When both are present and disagree, the stated
   * figure is used and the schedule is still drawn, so the disagreement is
   * visible rather than resolved behind the scenes.
   */
  const remainingObligation = isPositive(input.remainingDeveloperBalance)
    ? money(Math.min(price, input.remainingDeveloperBalance))
    : last.remainingObligation;

  const holdingCostsToExit = money(Math.max(0, orZero(input.monthlyHoldingCosts)) * months);

  const investorCashDeployed = money(
    paidToDeveloper + acquisitionCosts + financingCosts + holdingCostsToExit,
  );
  const totalCapitalCommitted = money(price + acquisitionCosts + financingCosts);

  const completedValue = completedValueFor(input);

  const sellingCostsFor = (exitValue: number) =>
    money(
      Math.max(
        0,
        (isPositive(input.sellingCostPercent) ? (exitValue * input.sellingCostPercent) / 100 : 0) +
          orZero(input.sellingCostAmount),
      ),
    );

  const missingExit = (): Figure => unavailable('MISSING_INPUT', 'expectedCompletedPrice');

  if (completedValue === null) {
    return {
      currency: input.currency,
      totalCapitalCommitted: figure(totalCapitalCommitted),
      investorCashDeployed: figure(investorCashDeployed),
      remainingObligation: figure(remainingObligation),
      deployment,
      expectedCompletedValue: missingExit(),
      expectedAppreciation: missingExit(),
      appreciationPercent: missingExit(),
      holdingCostsToExit: figure(holdingCostsToExit),
      sellingCosts: missingExit(),
      expectedSaleProceeds: missingExit(),
      netProfit: missingExit(),
      returnOnTotalCapitalPercent: missingExit(),
      returnOnInvestorCashPercent: missingExit(),
      annualizedReturnPercent: missingExit(),
      breakEvenExitPrice: breakEvenExitPriceFor(input, {
        investorCashDeployed,
        remainingObligation,
      }),
      breakEvenExitPricePerSqm: perSqm(
        breakEvenExitPriceFor(input, { investorCashDeployed, remainingObligation }),
        input.areaSqm,
      ),
      requiredExitForTargetReturn: requiredExitFor(input, {
        investorCashDeployed,
        remainingObligation,
      }),
      marginOfSafetyPercent: missingExit(),
      monthsToExit: months,
    };
  }

  const sellingCosts = sellingCostsFor(completedValue);
  const expectedSaleProceeds = money(completedValue - sellingCosts - remainingObligation);
  const netProfit = money(expectedSaleProceeds - investorCashDeployed);

  const breakEven = breakEvenExitPriceFor(input, { investorCashDeployed, remainingObligation });

  return {
    currency: input.currency,
    totalCapitalCommitted: figure(totalCapitalCommitted),
    investorCashDeployed: figure(investorCashDeployed),
    remainingObligation: figure(remainingObligation),
    deployment,
    expectedCompletedValue: figure(completedValue),
    expectedAppreciation: figure(money(completedValue - price)),
    appreciationPercent: isPositive(price)
      ? figure(rate(((completedValue - price) / price) * 100))
      : unavailable('MISSING_INPUT', 'purchasePrice'),
    holdingCostsToExit: figure(holdingCostsToExit),
    sellingCosts: figure(sellingCosts),
    expectedSaleProceeds: figure(expectedSaleProceeds),
    netProfit: figure(netProfit),
    returnOnTotalCapitalPercent: isPositive(totalCapitalCommitted)
      ? figure(rate((netProfit / totalCapitalCommitted) * 100))
      : unavailable('MISSING_INPUT', 'totalCapitalCommitted'),
    returnOnInvestorCashPercent: isPositive(investorCashDeployed)
      ? figure(rate((netProfit / investorCashDeployed) * 100))
      : unavailable('MISSING_INPUT', 'investorCashDeployed'),
    annualizedReturnPercent: annualize(
      isPositive(investorCashDeployed) ? rate((netProfit / investorCashDeployed) * 100) : null,
      months,
    ),
    breakEvenExitPrice: breakEven,
    breakEvenExitPricePerSqm: perSqm(breakEven, input.areaSqm),
    requiredExitForTargetReturn: requiredExitFor(input, {
      investorCashDeployed,
      remainingObligation,
    }),
    marginOfSafetyPercent: marginOfSafety(completedValue, breakEven.value),
    monthsToExit: months,
  };
}

/**
 * The completed value at which the deal exactly breaks even.
 *
 * Closed form: proceeds(V) = V − sellingCosts(V) − owed, and selling costs
 * are affine in V, so V(1 − pct) = cashDeployed + owed + flat.
 */
export function breakEvenExitPriceFor(
  input: ConstructionInput,
  totals: { investorCashDeployed: number; remainingObligation: number },
): Figure {
  const pct = isPositive(input.sellingCostPercent) ? input.sellingCostPercent / 100 : 0;
  if (pct >= 1) return unavailable('NOT_MEANINGFUL', 'selling costs consume the whole sale');
  const flat = orZero(input.sellingCostAmount);
  const value =
    (totals.investorCashDeployed + totals.remainingObligation + flat) / (1 - pct);
  if (!Number.isFinite(value) || value < 0) return unavailable('NOT_MEANINGFUL', 'no solution');
  return figure(money(value));
}

/** The completed value needed to hit the investor's required return. */
export function requiredExitFor(
  input: ConstructionInput,
  totals: { investorCashDeployed: number; remainingObligation: number },
): Figure {
  if (!isPositive(input.targetReturnPercent)) {
    return unavailable('MISSING_INPUT', 'targetReturnPercent');
  }
  const pct = isPositive(input.sellingCostPercent) ? input.sellingCostPercent / 100 : 0;
  if (pct >= 1) return unavailable('NOT_MEANINGFUL', 'selling costs consume the whole sale');
  const flat = orZero(input.sellingCostAmount);
  const requiredProfit = (totals.investorCashDeployed * input.targetReturnPercent) / 100;
  const value =
    (totals.investorCashDeployed + requiredProfit + totals.remainingObligation + flat) / (1 - pct);
  if (!Number.isFinite(value) || value < 0) return unavailable('NOT_MEANINGFUL', 'no solution');
  return figure(money(value));
}

/**
 * How much room there is between the expected exit and break-even.
 *
 * Expressed against the EXPECTED value, so it reads as "the price could fall
 * this far before the deal stops making money" — which is the question an
 * investor is actually asking when they ask how risky it is.
 */
export function marginOfSafety(expected: number | null, breakEvenValue: number | null): Figure {
  if (expected === null || breakEvenValue === null) {
    return unavailable('MISSING_INPUT', 'expected and break-even values');
  }
  if (!isPositive(expected)) return unavailable('MISSING_INPUT', 'expected value');
  return figure(rate(((expected - breakEvenValue) / expected) * 100));
}

function perSqm(value: Figure, areaSqm: number | undefined): Figure {
  if (value.value === null) return value;
  if (!isPositive(areaSqm)) return unavailable('MISSING_INPUT', 'areaSqm');
  return figure(money(value.value / areaSqm));
}

/* ── What a delay costs ─────────────────────────────────────────────── */

export interface ConstructionDelayRow {
  delayMonths: number;
  monthsToExit: number;
  additionalHoldingCosts: Figure;
  netProfit: Figure;
  returnOnInvestorCashPercent: Figure;
  annualizedReturnPercent: Figure;
  /** Against the on-time case. Negative is what the wait cost. */
  annualizedDelta: Figure;
}

export const DEFAULT_CONSTRUCTION_DELAYS = [0, 3, 6, 12] as const;

/**
 * A delay at the SAME completed value.
 *
 * Holding the value constant is deliberate: the question is what time costs,
 * and letting the price drift would answer a different one. The total return
 * barely moves and the annualised return falls — which is the real shape of
 * the risk and the reason both are shown.
 */
export function buildConstructionDelayLadder(
  input: ConstructionInput,
  delays: readonly number[] = DEFAULT_CONSTRUCTION_DELAYS,
): ConstructionDelayRow[] {
  const base = buildConstructionModel(input);
  const rows: ConstructionDelayRow[] = [];

  for (const raw of delays) {
    const delayMonths = Math.max(0, Math.round(raw));
    const delayed = buildConstructionModel({
      ...input,
      additionalMonthsToSale: orZero(input.additionalMonthsToSale) + delayMonths,
    });
    rows.push({
      delayMonths,
      monthsToExit: delayed.monthsToExit,
      additionalHoldingCosts:
        delayed.holdingCostsToExit.value === null || base.holdingCostsToExit.value === null
          ? unavailable('MISSING_INPUT', 'holding costs')
          : figure(money(delayed.holdingCostsToExit.value - base.holdingCostsToExit.value)),
      netProfit: delayed.netProfit,
      returnOnInvestorCashPercent: delayed.returnOnInvestorCashPercent,
      annualizedReturnPercent: delayed.annualizedReturnPercent,
      annualizedDelta:
        delayed.annualizedReturnPercent.value === null || base.annualizedReturnPercent.value === null
          ? unavailable('MISSING_INPUT', 'annualised return')
          : figure(
              rate(delayed.annualizedReturnPercent.value - base.annualizedReturnPercent.value),
            ),
    });
  }
  return rows;
}

/* ── What the completed price being wrong costs ─────────────────────── */

export interface CompletedPriceScenario {
  changePercent: number;
  completedValue: number;
  netProfit: Figure;
  returnOnInvestorCashPercent: Figure;
}

export const DEFAULT_PRICE_MOVES = [10, 5, 0, -5, -10, -15] as const;

export function buildCompletedPriceScenarios(
  input: ConstructionInput,
  moves: readonly number[] = DEFAULT_PRICE_MOVES,
): CompletedPriceScenario[] {
  const base = completedValueFor(input);
  if (base === null) return [];
  const out: CompletedPriceScenario[] = [];
  for (const move of moves) {
    const completedValue = money((base * (100 + move)) / 100);
    const model = buildConstructionModel({
      ...input,
      expectedCompletedPrice: completedValue,
      expectedCompletedPricePerSqm: undefined,
    });
    out.push({
      changePercent: rate(move),
      completedValue,
      netProfit: model.netProfit,
      returnOnInvestorCashPercent: model.returnOnInvestorCashPercent,
    });
  }
  return out;
}
