// src/mortgage/calculations/rateSensitivity.ts — DETERMINISTIC MATH ONLY.
//
// "What if the rate were a little higher or lower?" The same loan, the same
// term, the same engine, with only the nominal rate moved by whole
// percentage points. Not a forecast of where rates go: a way to see how much
// the payment depends on the one number a bank is most likely to change.

import type { MortgageInput } from '../types';
import { calculateMortgage, roundCurrency } from './amortization.ts';

/** The rate moves shown, in percentage points. */
export const RATE_STEPS_PP = [-2, -1, 1, 2] as const;

export interface RateSensitivityRow {
  deltaPoints: number;
  ratePercent: number;
  monthlyPayment: number;
  /** Against the payment at the entered rate; negative when it falls. */
  monthlyChange: number;
  totalInterest: number;
}

export function rateSensitivity(input: MortgageInput, steps: readonly number[] = RATE_STEPS_PP): RateSensitivityRow[] {
  const base = calculateMortgage(input);
  const rows: RateSensitivityRow[] = [];
  for (const delta of steps) {
    const ratePercent = roundCurrency(input.nominalAnnualRatePercent + delta);
    // A rate at or below zero is not something a bank offers; leave that step out rather than invent it.
    if (ratePercent <= 0) continue;
    try {
      const r = calculateMortgage({ ...input, nominalAnnualRatePercent: ratePercent });
      rows.push({
        deltaPoints: delta,
        ratePercent,
        monthlyPayment: r.monthlyPayment,
        monthlyChange: roundCurrency(r.monthlyPayment - base.monthlyPayment),
        totalInterest: r.totalInterest,
      });
    } catch {
      /* an input the engine rejects at this rate is skipped, never estimated */
    }
  }
  return rows;
}
