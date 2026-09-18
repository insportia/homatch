// HOMATCH INVESTMENT INTELLIGENCE — DETERMINISTIC MATH ONLY.
//
// Every file under src/investment/calculations/ is the only place investment
// arithmetic may happen. The AI Consultant calls into these functions for any
// number it states and computes nothing itself; no file here imports React,
// Supabase, or an AI client, which is what makes that rule reviewable rather
// than aspirational.
//
// TWO ROUNDING RULES, AND WHY THEY DIFFER
//
// Money rounds to cents at the point it becomes a reported figure. Ratios do
// not round at all inside the engine — a yield rounded to 6.0% and then used
// to derive an implied value produces a different number than the same
// calculation carried at full precision, and the customer sees the second one
// beside the first. Display rounding is the UI's job and happens once.

import { EPSILON } from '../../mortgage/calculations/amortization.ts';
import type { Figure } from '../types.ts';
import { figure, unavailable } from '../types.ts';

export { EPSILON };

/** Money, to cents. Never NaN, never Infinity, never negative zero. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** A percentage or ratio, to four decimals. Enough for basis points. */
export function rate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return rounded === 0 ? 0 : rounded;
}

export function isPositive(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > EPSILON;
}

export function isNonNegative(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A number the caller supplied, or zero. Used only where zero is the real default. */
export function orZero(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * a / b as a percentage, or a named unavailability.
 *
 * A denominator of zero is never quietly turned into Infinity or 0%: a yield
 * on a purchase price of nothing is not a large yield, it is not a yield.
 */
export function percentOf(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  detail: string,
): Figure {
  if (numerator === null || numerator === undefined || !Number.isFinite(numerator)) {
    return unavailable('MISSING_INPUT', detail);
  }
  if (!isPositive(denominator)) return unavailable('MISSING_INPUT', detail);
  return figure(rate((numerator / denominator) * 100));
}

/** Years to recover `capital` at `annualIncome` a year. */
export function paybackYears(
  capital: number | null | undefined,
  annualIncome: number | null | undefined,
  detail: string,
): Figure {
  if (!isPositive(capital)) return unavailable('MISSING_INPUT', detail);
  if (annualIncome === null || annualIncome === undefined || !Number.isFinite(annualIncome)) {
    return unavailable('MISSING_INPUT', detail);
  }
  if (annualIncome <= EPSILON) return unavailable('NO_POSITIVE_INCOME', detail);
  // Two decimals: the difference between 16.67 and 16.7 years is four weeks,
  // and the customer asked "when do I get my money back".
  return figure(Math.round((capital / annualIncome) * 100) / 100);
}

/**
 * Compound an over-the-period return to an annual rate.
 *
 * Refuses rather than produces a complex number: a total return of -100% or
 * worse cannot be annualised, and the honest output is a named gap. It also
 * refuses for very short holds, where annualising a one-month result produces
 * a figure that is arithmetically correct and rhetorically dishonest.
 */
export function annualize(
  totalReturnPercent: number | null,
  holdMonths: number,
): Figure {
  if (totalReturnPercent === null || !Number.isFinite(totalReturnPercent)) {
    return unavailable('MISSING_INPUT', 'total return unknown');
  }
  if (!isPositive(holdMonths)) return unavailable('MISSING_INPUT', 'hold period unknown');
  const growth = 1 + totalReturnPercent / 100;
  if (growth <= 0) {
    return unavailable('NOT_MEANINGFUL', 'a total loss of the invested cash cannot be annualised');
  }
  if (holdMonths < 3) {
    return unavailable(
      'NOT_MEANINGFUL',
      'a hold shorter than three months annualises into a figure nobody could earn',
    );
  }
  return figure(rate((Math.pow(growth, 12 / holdMonths) - 1) * 100));
}

/**
 * Solve a strictly monotonic function for zero by bisection.
 *
 * Used for the break-even points that are not closed-form because the
 * mortgage schedule sits inside them. Bisection rather than Newton on
 * purpose: it cannot diverge, and a break-even the customer can act on is
 * worth more than four extra significant figures.
 */
export function bisect(
  f: (x: number) => number,
  low: number,
  high: number,
  iterations = 80,
): number | null {
  let a = low;
  let b = high;
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa > 0 === fb > 0) return null;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7 || (b - a) / 2 < 1e-7) return mid;
    if (fm > 0 === fa > 0) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
      fb = fm;
    }
  }
  return (a + b) / 2;
}
