// src/mortgage/calculations/earlyRepayment.ts — DETERMINISTIC MATH ONLY.
//
// "What if I pay extra?" — simulates the SAME amortization mechanics as
// amortization.ts (interest-only grace period, monthly-compounding on the
// nominal annual rate, the same recurring known-cost handling) but injects
// one extra one-time payment and/or a recurring extra payment from a given
// month onward, applied entirely to principal. The regular scheduled
// payment amount is held constant (the common real-world product: paying
// extra shortens the term rather than lowering the required payment).
//
// Early-repayment fee honesty rule (mandate requirement, enforced here in
// code, not just prose): if the caller has not supplied a
// knownEarlyRepaymentFeeFlat, the result's earlyRepaymentFeeIncluded is
// false and NO fee is silently assumed to be zero-cost — the UI layer must
// render this as "a contractual early-repayment fee, if any, is not
// included" rather than implying the comparison already accounts for one.
import type { EarlyRepaymentInput, EarlyRepaymentResult, MortgageInput } from '../types';
import { computeLoanAmount, computeMonthlyPayment, roundCurrency, validateMortgageInput } from './amortization.ts';

interface SimResult {
  payoffMonth: number;
  totalInterest: number;
  totalKnownRecurringCosts: number;
}

function simulate(input: MortgageInput, loanAmount: number, extra?: EarlyRepaymentInput): SimResult {
  const monthlyRate = input.nominalAnnualRatePercent / 100 / 12;
  const gracePeriodMonths = input.gracePeriodMonths ?? 0;
  const amortizingMonths = input.termMonths - gracePeriodMonths;
  const regularPayment = amortizingMonths > 0 ? computeMonthlyPayment(loanAmount, input.nominalAnnualRatePercent, amortizingMonths) : 0;
  const recurringKnownMonthly = (input.monthlyFeeFlat ?? 0) + (input.annualFeeFlat ?? 0) / 12 + (input.mandatoryInsuranceAnnualFlat ?? 0) / 12 + (input.otherMandatoryRecurringMonthlyCosts ?? 0);

  let remaining = loanAmount;
  let totalInterest = 0;
  let totalKnownRecurringCosts = 0;
  let month = 0;

  while (remaining > 0.005 && month < input.termMonths) {
    month += 1;
    const opening = remaining;
    const interest = roundCurrency(opening * monthlyRate);
    totalInterest = roundCurrency(totalInterest + interest);
    totalKnownRecurringCosts = roundCurrency(totalKnownRecurringCosts + recurringKnownMonthly);

    const isGrace = month <= gracePeriodMonths;
    let principalPortion = isGrace ? 0 : Math.min(regularPayment - interest, opening);
    if (extra) {
      if (month === extra.extraPaymentMonth) principalPortion += extra.extraPaymentAmount;
      if (extra.recurringMonthlyExtra && month >= extra.extraPaymentMonth) principalPortion += extra.recurringMonthlyExtra;
    }
    principalPortion = Math.max(0, Math.min(principalPortion, opening));
    remaining = roundCurrency(Math.max(0, opening - principalPortion));
  }

  return { payoffMonth: month, totalInterest, totalKnownRecurringCosts };
}

/** Compares "pay as originally scheduled" vs. "apply this extra payment"
 * using the identical simulator for both sides, so every difference in the
 * result is attributable purely to the extra payment, not to a
 * methodology mismatch between two different calculators. */
export function calculateEarlyRepayment(baseInput: MortgageInput, extra: EarlyRepaymentInput): EarlyRepaymentResult {
  const errors = validateMortgageInput(baseInput);
  if (errors.length) throw new Error(`calculateEarlyRepayment called with invalid base input: ${errors.map(e => e.messageKey).join(', ')}`);
  if (!Number.isInteger(extra.extraPaymentMonth) || extra.extraPaymentMonth < 1 || extra.extraPaymentMonth > baseInput.termMonths) {
    throw new Error('calculateEarlyRepayment: extraPaymentMonth out of range');
  }
  if (!Number.isFinite(extra.extraPaymentAmount) || extra.extraPaymentAmount < 0) {
    throw new Error('calculateEarlyRepayment: extraPaymentAmount invalid');
  }

  const loanAmount = computeLoanAmount(baseInput);
  const baseline = simulate(baseInput, loanAmount);
  const withExtra = simulate(baseInput, loanAmount, extra);

  const feeIncluded = typeof extra.knownEarlyRepaymentFeeFlat === 'number' && Number.isFinite(extra.knownEarlyRepaymentFeeFlat);
  const fee = feeIncluded ? (extra.knownEarlyRepaymentFeeFlat as number) : 0;

  const totalCostWithExtra = roundCurrency(loanAmount + withExtra.totalInterest + withExtra.totalKnownRecurringCosts + fee);

  return {
    newPayoffMonth: withExtra.payoffMonth,
    monthsSaved: Math.max(0, baseline.payoffMonth - withExtra.payoffMonth),
    interestSaved: roundCurrency(baseline.totalInterest - withExtra.totalInterest),
    totalCostWithExtra,
    earlyRepaymentFeeIncluded: feeIncluded,
  };
}
