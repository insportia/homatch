// HOMATCH INVESTMENT INTELLIGENCE — what is this worth FOR MY STRATEGY?
//
// THE QUESTION THIS ANSWERS, AND THE ONE IT DOES NOT
//
// Not "what is the market price". That is a question about other people's
// transactions, and the Market Evidence section answers it as far as public
// listings honestly can.
//
// This answers: given how the investor intends to make money from this
// property, what can they pay and still make it work? It is solved
// BACKWARDS from the business objective — the rent it produces, the resale
// it supports, the completed value it will reach — rather than forwards
// from a price somebody is asking.
//
// The two answers are different on purpose, and a property where they are
// far apart is the most interesting thing this product can show somebody.
//
// FOUR PRICES, NOT ONE
//
//   BREAK-EVEN        pay this and the strategy returns nothing.
//   MAXIMUM           pay this and it returns exactly what was required.
//   TARGET ENTRY      maximum, less a deliberate cushion.
//   PROPOSED          whatever the investor is actually considering, scored
//                     against the other three.
//
// A single "the property is worth X" would be a fabrication with a decimal
// point. Every output here is a boundary with a reason attached.

import type { Figure } from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { isPositive, money, orZero, rate } from './core.ts';

export type ValueStrategy = 'RENOVATE_RESELL' | 'CONSTRUCTION_RESALE' | 'RENTAL_INVESTMENT';

/** How much below the maximum a target entry price sits, by default. */
export const DEFAULT_SAFETY_CUSHION_PERCENT = 10;

export interface AcquisitionValueResult {
  strategy: ValueStrategy;
  currency: string;
  /** Pay this and the strategy exactly breaks even. */
  breakEvenPrice: Figure;
  /** Pay this and the strategy exactly meets the required return. */
  maximumPrice: Figure;
  /** Maximum, less the cushion. Where an investor should aim to buy. */
  targetEntryPrice: Figure;
  maximumPricePerSqm: Figure;
  targetEntryPricePerSqm: Figure;
  /** Profit at the price the investor is actually considering. */
  profitAtProposedPrice: Figure;
  returnAtProposedPricePercent: Figure;
  /** How far the proposed price sits below the maximum, as a share of it. */
  marginOfSafetyPercent: Figure;
  /** The single sentence the UI leads with, as an i18n key. */
  verdictKey: ValueVerdict;
}

export type ValueVerdict =
  /** The proposed price is at or under the target entry price. */
  | 'inv_value_verdict_comfortable'
  /** Between target and maximum: it works, with little room for error. */
  | 'inv_value_verdict_tight'
  /** Above maximum but below break-even: it works, below requirement. */
  | 'inv_value_verdict_below_requirement'
  /** At or above break-even: the strategy does not make money. */
  | 'inv_value_verdict_does_not_work'
  /** No proposed price to score. */
  | 'inv_value_verdict_no_price';

/* ── Rental: price from income ──────────────────────────────────────── */

export interface RentalValueInput {
  currency: string;
  /** Net operating income: collected rent less operating costs. */
  netOperatingIncome: number;
  /** The yield this investor requires on the price they pay. */
  targetYieldPercent: number;
  /** Costs of buying, as a share of the price. Folded into the solve. */
  acquisitionCostPercent?: number;
  acquisitionCostsFlat?: number;
  /** Renovation needed before it can be let. */
  upfrontWorks?: number;
  areaSqm?: number;
  proposedPrice?: number;
  safetyCushionPercent?: number;
}

/**
 * Maximum price for a rental, solved from the income.
 *
 * The naive form is NOI / yield. That is the price of the INCOME STREAM, not
 * the price of the property: an investor also pays acquisition costs and any
 * work needed before a tenant moves in, and those are part of what the yield
 * has to be earned on. So:
 *
 *   yield = NOI / (P + P·pct + flat + works)
 *
 * which rearranges to P = (NOI/yield − flat − works) / (1 + pct).
 *
 * Break-even for a rental is not a price — at any price the rent still
 * arrives — so it is reported as the price at which the yield falls to zero,
 * which only happens when NOI itself is zero. Where NOI is positive, the
 * meaningful floor is the required-yield maximum, and break-even is
 * explicitly not meaningful rather than silently omitted.
 */
export function rentalAcquisitionValue(input: RentalValueInput): AcquisitionValueResult {
  const pct = Math.max(0, orZero(input.acquisitionCostPercent)) / 100;
  const flat = Math.max(0, orZero(input.acquisitionCostsFlat));
  const works = Math.max(0, orZero(input.upfrontWorks));
  const cushion = input.safetyCushionPercent ?? DEFAULT_SAFETY_CUSHION_PERCENT;

  const solveFor = (yieldPercent: number): number | null => {
    if (!isPositive(yieldPercent)) return null;
    if (!Number.isFinite(input.netOperatingIncome)) return null;
    const capitalised = input.netOperatingIncome / (yieldPercent / 100);
    const price = (capitalised - flat - works) / (1 + pct);
    return Number.isFinite(price) ? money(price) : null;
  };

  const maximum = solveFor(input.targetYieldPercent);
  const maximumFigure =
    maximum === null
      ? unavailable('MISSING_INPUT', 'netOperatingIncome and targetYieldPercent')
      : maximum <= 0
        ? unavailable(
            'NOT_MEANINGFUL',
            'the income does not support any positive price at this required yield',
          )
        : figure(maximum);

  const target =
    maximumFigure.value === null
      ? maximumFigure
      : figure(money((maximumFigure.value * (100 - cushion)) / 100));

  const totalInvested = (price: number) => money(price * (1 + pct) + flat + works);

  const profitAtProposed: Figure = (() => {
    if (!isPositive(input.proposedPrice)) return unavailable('MISSING_INPUT', 'proposedPrice');
    // For a rental the "profit" at a price is the annual income it yields
    // against what that price actually costs to acquire.
    return figure(money(input.netOperatingIncome));
  })();

  const returnAtProposed: Figure = (() => {
    if (!isPositive(input.proposedPrice)) return unavailable('MISSING_INPUT', 'proposedPrice');
    const invested = totalInvested(input.proposedPrice);
    if (!isPositive(invested)) return unavailable('MISSING_INPUT', 'invested capital');
    return figure(rate((input.netOperatingIncome / invested) * 100));
  })();

  return {
    strategy: 'RENTAL_INVESTMENT',
    currency: input.currency,
    breakEvenPrice: unavailable(
      'NOT_MEANINGFUL',
      'a let property does not stop earning at a price; the meaningful floor is the required yield',
    ),
    maximumPrice: maximumFigure,
    targetEntryPrice: target,
    maximumPricePerSqm: perSqm(maximumFigure, input.areaSqm),
    targetEntryPricePerSqm: perSqm(target, input.areaSqm),
    profitAtProposedPrice: profitAtProposed,
    returnAtProposedPricePercent: returnAtProposed,
    marginOfSafetyPercent: cushionAgainst(maximumFigure.value, input.proposedPrice),
    verdictKey: verdictFor({
      proposed: input.proposedPrice,
      maximum: maximumFigure.value,
      target: target.value,
      breakEven: null,
    }),
  };
}

/* ── Renovate and resell: price from the resale ─────────────────────── */

export interface RenovationValueInput {
  currency: string;
  /** What the finished property is expected to sell for. The investor's figure. */
  expectedResalePrice: number;
  renovationCost?: number;
  furnishingCost?: number;
  holdingCosts?: number;
  sellingCostPercent?: number;
  sellingCostAmount?: number;
  acquisitionCostPercent?: number;
  acquisitionCostsFlat?: number;
  /** The profit the investor requires for taking the risk. */
  requiredProfit?: number;
  /** Or the same requirement as a return on what they put in. */
  targetReturnPercent?: number;
  areaSqm?: number;
  proposedPrice?: number;
  safetyCushionPercent?: number;
}

/**
 * Maximum purchase price for a flip, solved from the resale.
 *
 *   resale − sellingCosts − reno − furnishing − holding
 *     − acquisitionCosts(P) − P = requiredProfit
 *
 * With acquisition costs affine in P this gives
 *
 *   P = (available − requiredProfit) / (1 + pct)
 *
 * A target RETURN rather than a flat profit makes the requirement itself
 * depend on P, since the return is measured on total cash in. Solving that
 * properly rather than approximating:
 *
 *   requiredProfit = r · (P(1+pct) + flat + reno + furn + holding)
 *
 * which stays linear in P and rearranges cleanly. Doing it any other way
 * would mean an iterative guess reported to the nearest currency unit, and
 * the exact answer is two lines of algebra.
 */
export function renovationAcquisitionValue(
  input: RenovationValueInput,
): AcquisitionValueResult {
  const pct = Math.max(0, orZero(input.acquisitionCostPercent)) / 100;
  const flat = Math.max(0, orZero(input.acquisitionCostsFlat));
  const reno = Math.max(0, orZero(input.renovationCost));
  const furn = Math.max(0, orZero(input.furnishingCost));
  const holding = Math.max(0, orZero(input.holdingCosts));
  const cushion = input.safetyCushionPercent ?? DEFAULT_SAFETY_CUSHION_PERCENT;

  const sellingCosts = money(
    Math.max(
      0,
      (isPositive(input.sellingCostPercent)
        ? (input.expectedResalePrice * input.sellingCostPercent) / 100
        : 0) + orZero(input.sellingCostAmount),
    ),
  );

  /** Everything the resale has to cover before any price is paid. */
  const available = input.expectedResalePrice - sellingCosts - reno - furn - holding - flat;

  const solve = (requiredProfitFlat: number, requiredReturn: number): number | null => {
    // available − P(1+pct) = requiredProfitFlat + r·(P(1+pct) + flat + reno + furn + holding)
    const r = requiredReturn / 100;
    const otherCash = flat + reno + furn + holding;
    const numerator = available - requiredProfitFlat - r * otherCash;
    const denominator = (1 + pct) * (1 + r);
    if (denominator <= 0) return null;
    const price = numerator / denominator;
    return Number.isFinite(price) ? money(price) : null;
  };

  const breakEvenValue = solve(0, 0);
  const maximumValue = isPositive(input.targetReturnPercent)
    ? solve(0, input.targetReturnPercent)
    : isPositive(input.requiredProfit)
      ? solve(input.requiredProfit, 0)
      : null;

  const breakEven =
    breakEvenValue === null || breakEvenValue <= 0
      ? unavailable(
          'NOT_MEANINGFUL',
          'the resale does not cover the works and costs at any purchase price',
        )
      : figure(breakEvenValue);

  const maximum =
    maximumValue === null
      ? unavailable('MISSING_INPUT', 'a required profit or target return')
      : maximumValue <= 0
        ? unavailable('NOT_MEANINGFUL', 'the requirement cannot be met at any purchase price')
        : figure(maximumValue);

  const target =
    maximum.value === null ? maximum : figure(money((maximum.value * (100 - cushion)) / 100));

  const cashIn = (price: number) => money(price * (1 + pct) + flat + reno + furn + holding);

  const profitAtProposed: Figure = isPositive(input.proposedPrice)
    ? figure(money(input.expectedResalePrice - sellingCosts - cashIn(input.proposedPrice)))
    : unavailable('MISSING_INPUT', 'proposedPrice');

  const returnAtProposed: Figure = (() => {
    if (!isPositive(input.proposedPrice) || profitAtProposed.value === null) {
      return unavailable('MISSING_INPUT', 'proposedPrice');
    }
    const invested = cashIn(input.proposedPrice);
    if (!isPositive(invested)) return unavailable('MISSING_INPUT', 'invested capital');
    return figure(rate((profitAtProposed.value / invested) * 100));
  })();

  return {
    strategy: 'RENOVATE_RESELL',
    currency: input.currency,
    breakEvenPrice: breakEven,
    maximumPrice: maximum,
    targetEntryPrice: target,
    maximumPricePerSqm: perSqm(maximum, input.areaSqm),
    targetEntryPricePerSqm: perSqm(target, input.areaSqm),
    profitAtProposedPrice: profitAtProposed,
    returnAtProposedPricePercent: returnAtProposed,
    marginOfSafetyPercent: cushionAgainst(maximum.value, input.proposedPrice),
    verdictKey: verdictFor({
      proposed: input.proposedPrice,
      maximum: maximum.value,
      target: target.value,
      breakEven: breakEven.value,
    }),
  };
}

/* ── Construction resale: price from the completed value ────────────── */

export interface ConstructionValueInput {
  currency: string;
  /** What the finished unit is expected to be worth. The investor's figure. */
  expectedCompletedPrice: number;
  /** Payments still to be made to the developer beyond the entry price. */
  remainingPayments?: number;
  holdingCosts?: number;
  financingCosts?: number;
  sellingCostPercent?: number;
  sellingCostAmount?: number;
  acquisitionCostPercent?: number;
  acquisitionCostsFlat?: number;
  requiredProfit?: number;
  targetReturnPercent?: number;
  areaSqm?: number;
  proposedPrice?: number;
  safetyCushionPercent?: number;
}

/**
 * Maximum entry price for an off-plan purchase.
 *
 * Structurally the same solve as the flip, with the renovation replaced by
 * the payments still owed and the carrying cost of waiting for the project
 * to finish. Kept as its own function rather than a shared one with a
 * relabelled argument, because the two models diverge everywhere else and a
 * shared helper would invite someone to "simplify" them into one.
 */
export function constructionAcquisitionValue(
  input: ConstructionValueInput,
): AcquisitionValueResult {
  const pct = Math.max(0, orZero(input.acquisitionCostPercent)) / 100;
  const flat = Math.max(0, orZero(input.acquisitionCostsFlat));
  const remaining = Math.max(0, orZero(input.remainingPayments));
  const holding = Math.max(0, orZero(input.holdingCosts));
  const financing = Math.max(0, orZero(input.financingCosts));
  const cushion = input.safetyCushionPercent ?? DEFAULT_SAFETY_CUSHION_PERCENT;

  const sellingCosts = money(
    Math.max(
      0,
      (isPositive(input.sellingCostPercent)
        ? (input.expectedCompletedPrice * input.sellingCostPercent) / 100
        : 0) + orZero(input.sellingCostAmount),
    ),
  );

  const otherCash = flat + remaining + holding + financing;
  const available = input.expectedCompletedPrice - sellingCosts - otherCash;

  const solve = (requiredProfitFlat: number, requiredReturn: number): number | null => {
    const r = requiredReturn / 100;
    const numerator = available - requiredProfitFlat - r * otherCash;
    const denominator = (1 + pct) * (1 + r);
    if (denominator <= 0) return null;
    const price = numerator / denominator;
    return Number.isFinite(price) ? money(price) : null;
  };

  const breakEvenValue = solve(0, 0);
  const maximumValue = isPositive(input.targetReturnPercent)
    ? solve(0, input.targetReturnPercent)
    : isPositive(input.requiredProfit)
      ? solve(input.requiredProfit, 0)
      : null;

  const breakEven =
    breakEvenValue === null || breakEvenValue <= 0
      ? unavailable(
          'NOT_MEANINGFUL',
          'the completed value does not cover the remaining payments and costs at any entry price',
        )
      : figure(breakEvenValue);

  const maximum =
    maximumValue === null
      ? unavailable('MISSING_INPUT', 'a required profit or target return')
      : maximumValue <= 0
        ? unavailable('NOT_MEANINGFUL', 'the requirement cannot be met at any entry price')
        : figure(maximumValue);

  const target =
    maximum.value === null ? maximum : figure(money((maximum.value * (100 - cushion)) / 100));

  const cashIn = (price: number) => money(price * (1 + pct) + otherCash);

  const profitAtProposed: Figure = isPositive(input.proposedPrice)
    ? figure(money(input.expectedCompletedPrice - sellingCosts - cashIn(input.proposedPrice)))
    : unavailable('MISSING_INPUT', 'proposedPrice');

  const returnAtProposed: Figure = (() => {
    if (!isPositive(input.proposedPrice) || profitAtProposed.value === null) {
      return unavailable('MISSING_INPUT', 'proposedPrice');
    }
    const invested = cashIn(input.proposedPrice);
    if (!isPositive(invested)) return unavailable('MISSING_INPUT', 'invested capital');
    return figure(rate((profitAtProposed.value / invested) * 100));
  })();

  return {
    strategy: 'CONSTRUCTION_RESALE',
    currency: input.currency,
    breakEvenPrice: breakEven,
    maximumPrice: maximum,
    targetEntryPrice: target,
    maximumPricePerSqm: perSqm(maximum, input.areaSqm),
    targetEntryPricePerSqm: perSqm(target, input.areaSqm),
    profitAtProposedPrice: profitAtProposed,
    returnAtProposedPricePercent: returnAtProposed,
    marginOfSafetyPercent: cushionAgainst(maximum.value, input.proposedPrice),
    verdictKey: verdictFor({
      proposed: input.proposedPrice,
      maximum: maximum.value,
      target: target.value,
      breakEven: breakEven.value,
    }),
  };
}

/* ── Shared ─────────────────────────────────────────────────────────── */

function perSqm(value: Figure, areaSqm: number | undefined): Figure {
  if (value.value === null) return value;
  if (!isPositive(areaSqm)) return unavailable('MISSING_INPUT', 'areaSqm');
  return figure(money(value.value / areaSqm));
}

/** How far the proposed price sits below the maximum, as a share of it. */
function cushionAgainst(maximum: number | null, proposed: number | undefined): Figure {
  if (maximum === null || !isPositive(maximum)) {
    return unavailable('MISSING_INPUT', 'maximum price');
  }
  if (!isPositive(proposed)) return unavailable('MISSING_INPUT', 'proposedPrice');
  return figure(rate(((maximum - proposed) / maximum) * 100));
}

function verdictFor(args: {
  proposed: number | undefined;
  maximum: number | null;
  target: number | null;
  breakEven: number | null;
}): ValueVerdict {
  if (!isPositive(args.proposed)) return 'inv_value_verdict_no_price';
  const { proposed } = args;
  if (args.breakEven !== null && proposed >= args.breakEven) {
    return 'inv_value_verdict_does_not_work';
  }
  if (args.maximum === null) return 'inv_value_verdict_no_price';
  if (proposed > args.maximum) return 'inv_value_verdict_below_requirement';
  if (args.target !== null && proposed <= args.target) return 'inv_value_verdict_comfortable';
  return 'inv_value_verdict_tight';
}
