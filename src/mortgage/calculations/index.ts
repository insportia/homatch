// src/mortgage/calculations/index.ts — the single entry point UI code
// should import from for a full calculation. Composes the core amortization
// calculator with the effective-rate estimator (kept as separate modules
// because each has its own testable responsibility and its own
// "insufficient input -> null" rule).
import type { MortgageCalculationResult, MortgageInput } from '../types';
import { calculateMortgage, validateMortgageInput } from './amortization.ts';
import { computeEffectiveRate } from './effectiveRate.ts';

export * from './amortization.ts';
export * from './effectiveRate.ts';
export * from './termComparison.ts';
export * from './affordability.ts';
export * from './earlyRepayment.ts';
export * from './refinancing.ts';
export * from './offerComparison.ts';

export function runFullMortgageCalculation(input: MortgageInput): MortgageCalculationResult {
  const errors = validateMortgageInput(input);
  if (errors.length) throw new Error(`runFullMortgageCalculation called with invalid input: ${errors.map(e => e.messageKey).join(', ')}`);
  const base = calculateMortgage(input);
  const effective = computeEffectiveRate(input);
  return { ...base, effectiveAnnualRatePercent: effective.effectiveAnnualRatePercent, effectiveRateUnavailableReason: effective.unavailableReasonKey };
}
