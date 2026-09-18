// HOMATCH INVESTMENT INTELLIGENCE — the income-implied valuation lens.
//
// WHAT THIS COMPUTES
//
//   income-implied value = annual income / required yield
//
// $8,000 a year at a 6% requirement implies about $133,333. That sentence is
// the whole of it, and the sentence it is NOT is "the property is worth
// $133,333". It is one lens: what a buyer who requires 6% would pay for this
// income stream. Whether the market agrees is a question only market
// evidence can answer, and this file has no access to any and makes no claim
// about it. The comparison against asking price, purchase price and
// researched comparables is assembled in positionAgainstEvidence() below,
// and that function REFUSES to produce a verdict when there is no evidence
// to compare against, rather than quietly comparing the property to itself.
//
// THE INVERSE, WHICH IS WHERE PEOPLE GET LOST
//
// At a FIXED income, a HIGHER required yield implies a LOWER value:
//
//   $6,000 at 4% -> $150,000       $6,000 at 7% -> ~$85,714
//   $6,000 at 5% -> $120,000       $6,000 at 8% -> $75,000
//   $6,000 at 6% -> $100,000
//
// which is the opposite direction from income.ts's "more income is a higher
// yield", and both are true at once because they hold different things
// fixed. The spectrum below exists so a reader can see that rather than be
// told it.

import type {
  Figure,
  ImpliedValuation,
  ImpliedValuePoint,
  IncomeBasis,
  IncomeModel,
  InvestmentInput,
} from '../types.ts';
import { figure, unavailable } from '../types.ts';
import { isPositive, money, rate } from './core.ts';

/** The yields the spectrum is drawn at when the caller names none. */
export const DEFAULT_YIELD_SPECTRUM = [4, 5, 6, 7, 8, 9, 10] as const;

/**
 * annual income / required yield.
 *
 * Refuses a non-positive yield: dividing by zero produces infinity, and a
 * negative required yield describes an investor who wants to lose money.
 */
export function incomeImpliedValue(
  annualIncome: number,
  requiredYieldPercent: number,
): number | null {
  if (!Number.isFinite(annualIncome) || annualIncome < 0) return null;
  if (!isPositive(requiredYieldPercent)) return null;
  return money(annualIncome / (requiredYieldPercent / 100));
}

/** The whole curve, so the inverse relationship is visible at a glance. */
export function impliedValueSpectrum(
  annualIncome: number,
  yields: readonly number[] = DEFAULT_YIELD_SPECTRUM,
): ImpliedValuePoint[] {
  const points: ImpliedValuePoint[] = [];
  for (const y of yields) {
    const value = incomeImpliedValue(annualIncome, y);
    if (value === null) continue;
    points.push({ requiredYieldPercent: rate(y), impliedValue: value });
  }
  return points;
}

function valuationFor(
  basis: IncomeBasis,
  annualIncome: number | null,
  benchmarkYieldPercent: number | undefined,
  spectrum: readonly number[],
): ImpliedValuation | null {
  if (annualIncome === null || !Number.isFinite(annualIncome)) return null;
  const atBenchmark: Figure = (() => {
    if (!isPositive(benchmarkYieldPercent)) {
      return unavailable('MISSING_INPUT', 'benchmarkYieldPercent');
    }
    const value = incomeImpliedValue(annualIncome, benchmarkYieldPercent);
    return value === null ? unavailable('NOT_MEANINGFUL', 'benchmark yield') : figure(value);
  })();

  return {
    basis,
    annualIncome: money(annualIncome),
    atBenchmark,
    spectrum: impliedValueSpectrum(annualIncome, spectrum),
  };
}

/**
 * One valuation per income basis. Never one blended figure.
 *
 * A value implied by gross potential rent and a value implied by net
 * operating income are answers to different questions, and averaging them
 * produces an answer to neither. The caller picks which to show; the engine
 * refuses to pick for them.
 */
export function buildImpliedValuations(
  input: InvestmentInput,
  income: IncomeModel,
  spectrum: readonly number[] = DEFAULT_YIELD_SPECTRUM,
): ImpliedValuation[] {
  const out: ImpliedValuation[] = [];
  const add = (v: ImpliedValuation | null) => {
    if (v) out.push(v);
  };
  add(
    valuationFor(
      'GROSS_POTENTIAL',
      income.grossPotentialAnnualIncome.value,
      input.benchmarkYieldPercent,
      spectrum,
    ),
  );
  add(
    valuationFor(
      'EFFECTIVE_GROSS',
      income.effectiveGrossIncome.value,
      input.benchmarkYieldPercent,
      spectrum,
    ),
  );
  add(
    valuationFor(
      'NET_OPERATING',
      income.netOperatingIncome.value,
      input.benchmarkYieldPercent,
      spectrum,
    ),
  );
  return out;
}

/* ── Positioning a price against everything we actually know ─────────── */

/** A price point on the comparison rail, and where it came from. */
export interface PricePoint {
  key:
    | 'ASKING_PRICE'
    | 'PURCHASE_PRICE'
    | 'INCOME_IMPLIED'
    | 'MARKET_COMPARABLE_LOW'
    | 'MARKET_COMPARABLE_MEDIAN'
    | 'MARKET_COMPARABLE_HIGH';
  amount: number;
  /** ASKING and TRANSACTION are different claims and are never pooled. */
  basis: 'ASKING' | 'TRANSACTION' | 'MODELLED' | 'USER';
}

export interface MarketComparableRange {
  low: number;
  median: number;
  high: number;
  currency: string;
  /** How many independent publishers stand behind it. */
  independentSourceCount: number;
  observationCount: number;
  /** Always stated: an asking range is not a transaction range. */
  basis: 'ASKING' | 'TRANSACTION';
}

export type PricePositionVerdict =
  /** Below every reference point we have. */
  | 'BELOW_RANGE'
  | 'WITHIN_RANGE'
  | 'ABOVE_RANGE'
  /** There is nothing honest to compare against. */
  | 'NO_EVIDENCE';

export interface PricePosition {
  verdict: PricePositionVerdict;
  points: PricePoint[];
  /** The subject price being positioned. */
  subject: number;
  /**
   * Where the subject sits inside the comparable range, 0 at the low bound
   * and 1 at the high bound. Null when there is no range.
   */
  positionInRange: number | null;
  /**
   * Difference between the subject price and the income-implied value.
   *
   * POTENTIAL and UNREALISED. It is not a profit, it is not a valuation,
   * and it becomes neither until market evidence supports the higher figure
   * and somebody actually sells. Named this way so no renderer can
   * accidentally print it as a gain.
   */
  differenceVsIncomeImplied: number | null;
}

/**
 * Assemble the comparison rail.
 *
 * Returns NO_EVIDENCE rather than a verdict when neither an income-implied
 * value nor a researched range exists — which is the honest answer to "is
 * this expensive?" when nobody has looked yet, and the state the interface
 * starts in.
 */
export function positionAgainstEvidence(args: {
  purchasePrice: number;
  askingPrice?: number;
  incomeImpliedValue?: number | null;
  comparableRange?: MarketComparableRange | null;
}): PricePosition {
  const points: PricePoint[] = [];
  if (isPositive(args.askingPrice)) {
    points.push({ key: 'ASKING_PRICE', amount: money(args.askingPrice), basis: 'ASKING' });
  }
  if (isPositive(args.purchasePrice)) {
    points.push({ key: 'PURCHASE_PRICE', amount: money(args.purchasePrice), basis: 'USER' });
  }
  const implied = args.incomeImpliedValue;
  if (typeof implied === 'number' && Number.isFinite(implied) && implied > 0) {
    points.push({ key: 'INCOME_IMPLIED', amount: money(implied), basis: 'MODELLED' });
  }
  const range = args.comparableRange ?? null;
  if (range) {
    points.push({ key: 'MARKET_COMPARABLE_LOW', amount: money(range.low), basis: range.basis });
    points.push({
      key: 'MARKET_COMPARABLE_MEDIAN',
      amount: money(range.median),
      basis: range.basis,
    });
    points.push({ key: 'MARKET_COMPARABLE_HIGH', amount: money(range.high), basis: range.basis });
  }

  const subject = money(args.purchasePrice);
  const differenceVsIncomeImplied =
    typeof implied === 'number' && Number.isFinite(implied) && isPositive(args.purchasePrice)
      ? money(implied - args.purchasePrice)
      : null;

  if (!range) {
    return {
      verdict: 'NO_EVIDENCE',
      points,
      subject,
      positionInRange: null,
      differenceVsIncomeImplied,
    };
  }

  const span = range.high - range.low;
  const positionInRange =
    span > 0 ? rate((subject - range.low) / span) : subject === range.low ? 0 : null;

  const verdict: PricePositionVerdict =
    subject < range.low ? 'BELOW_RANGE' : subject > range.high ? 'ABOVE_RANGE' : 'WITHIN_RANGE';

  return { verdict, points, subject, positionInRange, differenceVsIncomeImplied };
}

/**
 * The yield the subject's own price implies, given an income.
 *
 * The other direction of the same arithmetic, offered so the interface can
 * put "what you are paying" and "what you would pay at 6%" on one axis.
 */
export function yieldImpliedByPrice(annualIncome: number, price: number): Figure {
  if (!Number.isFinite(annualIncome) || annualIncome < 0) {
    return unavailable('MISSING_INPUT', 'annual income');
  }
  if (!isPositive(price)) return unavailable('MISSING_INPUT', 'price');
  return figure(rate((annualIncome / price) * 100));
}
