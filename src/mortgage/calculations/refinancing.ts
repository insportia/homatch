// src/mortgage/calculations/refinancing.ts — DETERMINISTIC MATH ONLY.
// "Would refinancing reduce my cost?" — compares the remaining cost of the
// CURRENT loan (as entered — no fees re-derived, since those are sunk) to
// a NEW loan sized at the current remaining principal, over the new
// offer's rate/term, plus the new loan's refinancing fees. Never predicts
// future rates and never assumes a fee is zero when unstated (the fee is a
// required, explicit input here — see RefinancingInput.refinancingFeesFlat
// — there is no "unknown fee" branch to guess through, unlike early
// repayment's optional fee).
import type { RefinancingInput, RefinancingResult } from '../types';
import { buildAmortizationSchedule, computeMonthlyPayment, roundCurrency } from './amortization.ts';

export function calculateRefinancing(input: RefinancingInput): RefinancingResult {
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!num(input.currentRemainingPrincipal) || input.currentRemainingPrincipal <= 0) throw new Error('calculateRefinancing: currentRemainingPrincipal invalid');
  if (!Number.isInteger(input.currentRemainingTermMonths) || input.currentRemainingTermMonths <= 0) throw new Error('calculateRefinancing: currentRemainingTermMonths invalid');
  if (!num(input.currentNominalAnnualRatePercent) || input.currentNominalAnnualRatePercent < 0) throw new Error('calculateRefinancing: currentNominalAnnualRatePercent invalid');
  if (!num(input.newNominalAnnualRatePercent) || input.newNominalAnnualRatePercent < 0) throw new Error('calculateRefinancing: newNominalAnnualRatePercent invalid');
  if (!Number.isInteger(input.newTermMonths) || input.newTermMonths <= 0) throw new Error('calculateRefinancing: newTermMonths invalid');
  if (!num(input.refinancingFeesFlat) || input.refinancingFeesFlat < 0) throw new Error('calculateRefinancing: refinancingFeesFlat invalid');

  const currentSchedule = buildAmortizationSchedule({
    principal: input.currentRemainingPrincipal,
    annualRatePercent: input.currentNominalAnnualRatePercent,
    termMonths: input.currentRemainingTermMonths,
  });
  const newSchedule = buildAmortizationSchedule({
    principal: input.currentRemainingPrincipal,
    annualRatePercent: input.newNominalAnnualRatePercent,
    termMonths: input.newTermMonths,
  });

  const currentRemainingTotalCost = roundCurrency(currentSchedule.reduce((s, r) => s + r.totalPayment, 0));
  const newTotalCost = roundCurrency(newSchedule.reduce((s, r) => s + r.totalPayment, 0) + input.refinancingFeesFlat);

  const monthlyPaymentBefore = computeMonthlyPayment(input.currentRemainingPrincipal, input.currentNominalAnnualRatePercent, input.currentRemainingTermMonths);
  const monthlyPaymentAfter = computeMonthlyPayment(input.currentRemainingPrincipal, input.newNominalAnnualRatePercent, input.newTermMonths);
  const monthlySaving = roundCurrency(monthlyPaymentBefore - monthlyPaymentAfter);

  return {
    currentRemainingTotalCost,
    newTotalCost,
    lifetimeSavings: roundCurrency(currentRemainingTotalCost - newTotalCost),
    monthlyPaymentBefore,
    monthlyPaymentAfter,
    breakEvenMonths: monthlySaving > 0.005 ? Math.ceil(input.refinancingFeesFlat / monthlySaving) : null,
  };
}
