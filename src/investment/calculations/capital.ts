// HOMATCH INVESTMENT INTELLIGENCE — what was actually invested, and when it
// comes back.
//
// TWO DIFFERENT PAYBACKS, AND WHY BOTH ARE HERE
//
// "When do I get my money back" has two honest answers for a financed deal
// and they are years apart:
//
//   PROPERTY PAYBACK   total property capital / unlevered net income.
//                      Independent of who financed it. The question "does
//                      this asset pay for itself".
//   EQUITY PAYBACK     the investor's own cash / the cash the investor
//                      actually receives after debt service. The question
//                      "when am I whole".
//
// A $100,000 flat bought with $35,000 of equity has one property payback and
// a different equity payback, and presenting either as "the" payback is how
// a leveraged deal gets oversold. Both are computed, both are labelled, and
// neither is chosen for the reader.
//
// WHAT "INVESTED CAPITAL" MEANS HERE
//
// Not the purchase price. Purchase plus acquisition costs plus renovation
// plus furnishing — $100,000 + $10,000 + $3,000 is $113,000 invested, and a
// payback computed against $100,000 is two years short of the truth.

import type {
  Figure,
  InvestedCapital,
  InvestmentInput,
  PaybackModel,
  RecoveryPoint,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { EPSILON, isPositive, money, orZero, paybackYears } from './core.ts';

/** Forty years. Past that the timeline is a statement about compounding
 *  assumptions nobody made rather than about this property. */
export const MAX_TIMELINE_MONTHS = 480;

export function acquisitionCostsFor(input: InvestmentInput): number {
  if (typeof input.acquisitionCosts === 'number' && Number.isFinite(input.acquisitionCosts)) {
    return money(Math.max(0, input.acquisitionCosts));
  }
  if (isPositive(input.acquisitionCostPercent) && isPositive(input.purchasePrice)) {
    return money((input.purchasePrice * input.acquisitionCostPercent) / 100);
  }
  return 0;
}

export function downPaymentFor(input: InvestmentInput): number {
  const financing = input.financing;
  if (!financing) return money(input.purchasePrice);
  if (isPositive(financing.downPaymentPercent)) {
    const pct = Math.min(100, financing.downPaymentPercent);
    return money((input.purchasePrice * pct) / 100);
  }
  if (typeof financing.downPaymentAmount === 'number' && Number.isFinite(financing.downPaymentAmount)) {
    return money(Math.min(input.purchasePrice, Math.max(0, financing.downPaymentAmount)));
  }
  // Financing was declared with no equity figure. The whole price is the
  // honest fallback: assuming a conventional deposit would invent the single
  // most decision-relevant number in the scenario.
  return money(input.purchasePrice);
}

/** One-time charges the lender levies, which the investor pays in cash. */
export function financingUpfrontCostsFor(input: InvestmentInput, loanAmount: number): number {
  const f = input.financing;
  if (!f || loanAmount <= 0) return 0;
  let total = 0;
  if (isPositive(f.originationFeePercent)) total += (loanAmount * f.originationFeePercent) / 100;
  total += orZero(f.originationFeeFlat);
  total += orZero(f.valuationFeeFlat);
  return money(Math.max(0, total));
}

export function buildInvestedCapital(input: InvestmentInput): InvestedCapital {
  const purchasePrice = money(Math.max(0, input.purchasePrice));
  const acquisitionCosts = acquisitionCostsFor(input);
  const renovationCost = money(Math.max(0, orZero(input.renovationCost)));
  const furnishingCost = money(Math.max(0, orZero(input.furnishingCost)));
  const totalPropertyCapital = money(
    purchasePrice + acquisitionCosts + renovationCost + furnishingCost,
  );

  const downPayment = downPaymentFor(input);
  const loanAmount = input.financing ? money(Math.max(0, purchasePrice - downPayment)) : 0;
  const financingUpfrontCosts = financingUpfrontCostsFor(input, loanAmount);

  return {
    purchasePrice,
    acquisitionCosts,
    renovationCost,
    furnishingCost,
    totalPropertyCapital,
    investorCashInvested: money(
      downPayment + acquisitionCosts + renovationCost + furnishingCost + financingUpfrontCosts,
    ),
    financingUpfrontCosts,
    loanAmount,
  };
}

/**
 * The recovery timeline.
 *
 * Deliberately FLAT: no rent growth, no cost inflation, no appreciation.
 * Every one of those is a forecast, and this engine models what the investor
 * told it and nothing else. A curve that bends because of an assumption
 * nobody made is the most persuasive kind of wrong.
 *
 * `monthlyPrincipal` is the amortisation schedule's own per-month principal,
 * supplied by the caller so the mortgage engine stays the only thing that
 * knows how a loan amortises.
 */
export function buildRecoveryTimeline(args: {
  monthlyNetCashFlow: number | null;
  monthlyPrincipalRepaid: readonly number[];
  months: number;
}): RecoveryPoint[] {
  const months = Math.max(0, Math.min(MAX_TIMELINE_MONTHS, Math.round(args.months)));
  if (months === 0) return [];
  /*
   * NOTHING TO PLOT IS AN EMPTY TIMELINE, NOT A FLAT ONE.
   *
   * With no established cash flow and no amortisation, the loop below would
   * emit three hundred points of exactly zero — a horizontal line at the
   * axis, which renders as "this property returns nothing" rather than as
   * "nobody has told us the rent yet". Those are opposite statements and
   * the second one is the truth at this stage of a consultation.
   */
  const hasPrincipal = args.monthlyPrincipalRepaid.some((v) => Number.isFinite(v) && v !== 0);
  if (args.monthlyNetCashFlow === null && !hasPrincipal) return [];
  const points: RecoveryPoint[] = [];
  let cash = 0;
  let principal = 0;
  for (let m = 1; m <= months; m += 1) {
    if (args.monthlyNetCashFlow !== null) cash += args.monthlyNetCashFlow;
    principal += args.monthlyPrincipalRepaid[m - 1] ?? 0;
    points.push({
      month: m,
      cumulativeNetCashFlow: money(cash),
      cumulativePrincipalRepaid: money(principal),
    });
  }
  return points;
}

/** First month at which cumulative cash flow covers the cash invested. */
export function recoveryMonth(
  timeline: readonly RecoveryPoint[],
  cashInvested: number,
): Figure {
  if (!isPositive(cashInvested)) return unavailable('MISSING_INPUT', 'investorCashInvested');
  if (timeline.length === 0) return unavailable('MISSING_INPUT', 'no cash flow established');
  for (const point of timeline) {
    if (point.cumulativeNetCashFlow >= cashInvested - EPSILON) return figure(point.month);
  }
  return unavailable(
    'NEVER_RECOVERS',
    'cumulative cash flow does not cover the cash invested within the modelled horizon',
  );
}

export function buildPaybackModel(args: {
  capital: InvestedCapital;
  netOperatingIncome: number | null;
  annualNetCashFlowAfterDebt: number | null;
  monthlyPrincipalRepaid: readonly number[];
}): PaybackModel {
  const { capital } = args;

  const propertyPaybackYears = paybackYears(
    capital.totalPropertyCapital,
    args.netOperatingIncome,
    'netOperatingIncome',
  );

  const equityPaybackYears = paybackYears(
    capital.investorCashInvested,
    args.annualNetCashFlowAfterDebt,
    'annualNetCashFlowAfterDebt',
  );

  const monthlyNetCashFlow =
    args.annualNetCashFlowAfterDebt === null ? null : args.annualNetCashFlowAfterDebt / 12;

  const timeline = buildRecoveryTimeline({
    monthlyNetCashFlow,
    monthlyPrincipalRepaid: args.monthlyPrincipalRepaid,
    months: MAX_TIMELINE_MONTHS,
  });

  return {
    propertyPaybackYears,
    equityPaybackYears,
    equityRecoveryMonth: recoveryMonth(timeline, capital.investorCashInvested),
    // The stored timeline is trimmed to the point of interest plus headroom:
    // 480 monthly points is a lot of payload for a curve nobody reads past
    // its crossing, and the crossing is what the screen animates to.
    timeline: trimTimeline(timeline, capital.investorCashInvested),
  };
}

function trimTimeline(
  timeline: readonly RecoveryPoint[],
  cashInvested: number,
): RecoveryPoint[] {
  if (timeline.length === 0) return [];
  let crossing = -1;
  for (let i = 0; i < timeline.length; i += 1) {
    if (timeline[i].cumulativeNetCashFlow >= cashInvested - EPSILON) {
      crossing = i;
      break;
    }
  }
  // Twenty-five years when it never crosses: enough to show the shape and to
  // make "this does not pay back" visible rather than merely stated.
  const end = crossing >= 0 ? Math.min(timeline.length, crossing + 25) : Math.min(timeline.length, 300);
  return timeline.slice(0, end).map((p) => ({ ...p }));
}
