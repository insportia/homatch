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
  /** Set only under keepTermRecast: the recast required payment. */
  recastPayment?: number;
}

function simulate(
  input: MortgageInput,
  loanAmount: number,
  extra?: EarlyRepaymentInput,
  /** Scenario A: after the one-time extra, the TERM is kept and the required
   * payment is recast on the reduced principal over the months that remain.
   * The one-time extra only — a recurring extra under a monthly recast is
   * not a product offered here, and the type documents that. */
  keepTermRecast = false,
): SimResult {
  const monthlyRate = input.nominalAnnualRatePercent / 100 / 12;
  const gracePeriodMonths = input.gracePeriodMonths ?? 0;
  const amortizingMonths = input.termMonths - gracePeriodMonths;
  let regularPayment = amortizingMonths > 0 ? computeMonthlyPayment(loanAmount, input.nominalAnnualRatePercent, amortizingMonths) : 0;
  const recurringKnownMonthly = (input.monthlyFeeFlat ?? 0) + (input.annualFeeFlat ?? 0) / 12 + (input.mandatoryInsuranceAnnualFlat ?? 0) / 12 + (input.otherMandatoryRecurringMonthlyCosts ?? 0);

  let remaining = loanAmount;
  let totalInterest = 0;
  let totalKnownRecurringCosts = 0;
  let month = 0;
  let recastPayment: number | undefined;

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
      if (!keepTermRecast && extra.recurringMonthlyExtra && month >= extra.extraPaymentMonth) principalPortion += extra.recurringMonthlyExtra;
    }
    principalPortion = Math.max(0, Math.min(principalPortion, opening));
    remaining = roundCurrency(Math.max(0, opening - principalPortion));

    if (keepTermRecast && extra && month === extra.extraPaymentMonth && remaining > 0.005) {
      const monthsLeft = input.termMonths - Math.max(month, gracePeriodMonths);
      if (monthsLeft > 0) {
        regularPayment = computeMonthlyPayment(remaining, input.nominalAnnualRatePercent, monthsLeft);
        recastPayment = regularPayment;
      }
    }
  }

  return { payoffMonth: month, totalInterest, totalKnownRecurringCosts, recastPayment };
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
  /* Scenario A, from the SAME simulator with a recast at the extra's month,
   * so the two options can never disagree by methodology. */
  const keepTermSim = simulate(baseInput, loanAmount, extra, true);

  const feeIncluded = typeof extra.knownEarlyRepaymentFeeFlat === 'number' && Number.isFinite(extra.knownEarlyRepaymentFeeFlat);
  const fee = feeIncluded ? (extra.knownEarlyRepaymentFeeFlat as number) : 0;

  const totalCostWithExtra = roundCurrency(loanAmount + withExtra.totalInterest + withExtra.totalKnownRecurringCosts + fee);

  const gracePeriodMonths = baseInput.gracePeriodMonths ?? 0;
  const amortizingMonths = baseInput.termMonths - gracePeriodMonths;
  const baselineMonthlyPayment = amortizingMonths > 0
    ? roundCurrency(computeMonthlyPayment(loanAmount, baseInput.nominalAnnualRatePercent, amortizingMonths))
    : 0;

  const keepTerm = typeof keepTermSim.recastPayment === 'number'
    ? {
      newMonthlyPayment: roundCurrency(keepTermSim.recastPayment),
      monthlySaved: roundCurrency(baselineMonthlyPayment - keepTermSim.recastPayment),
      totalInterest: keepTermSim.totalInterest,
      interestSaved: roundCurrency(baseline.totalInterest - keepTermSim.totalInterest),
      totalCost: roundCurrency(loanAmount + keepTermSim.totalInterest + keepTermSim.totalKnownRecurringCosts + fee),
    }
    : null;

  return {
    newPayoffMonth: withExtra.payoffMonth,
    monthsSaved: Math.max(0, baseline.payoffMonth - withExtra.payoffMonth),
    interestSaved: roundCurrency(baseline.totalInterest - withExtra.totalInterest),
    totalCostWithExtra,
    earlyRepaymentFeeIncluded: feeIncluded,
    keepTerm,
    baselineMonthlyPayment,
    baselinePayoffMonth: baseline.payoffMonth,
    baselineTotalInterest: baseline.totalInterest,
    baselineTotalCost: roundCurrency(loanAmount + baseline.totalInterest + baseline.totalKnownRecurringCosts),
    totalInterestWithExtra: withExtra.totalInterest,
  };
}
