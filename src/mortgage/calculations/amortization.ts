// src/mortgage/calculations/amortization.ts — DETERMINISTIC MATH ONLY.
//
// This module (and every other file under src/mortgage/calculations/) is
// the ONLY place mortgage arithmetic may happen. React components call
// into these functions and render their output; the AI Mortgage Assistant
// (src/mortgage/ai/*) calls into these SAME functions for any number it
// needs to state and never computes a number itself. No file in this
// directory imports React, Supabase, or an AI client — that separation is
// what makes "AI must never calculate mortgage payments" enforceable by
// review rather than by convention alone.
//
// Grace period assumption (stated explicitly here because it is a real
// modeling choice, not an obvious fact): a `gracePeriodMonths` window is
// treated as INTEREST-ONLY, not full deferral — the borrower pays accruing
// interest every month of the grace period but the principal does not
// reduce and does not capitalize. This is the safer of the two common
// conventions (it never silently grows the loan) and is surfaced to the
// user via `MortgageCalculationResult` metadata / the human-explanation
// layer rather than assumed silently.
//
// Payment-frequency assumption: interest is modelled as compounding
// monthly against the entered nominal ANNUAL rate regardless of the
// selected paymentFrequency (this matches standard Georgian bank practice
// for GEL/USD retail mortgages). `paymentFrequency` changes only how the
// schedule is grouped for display (see groupScheduleByFrequency below), not
// the underlying interest compounding period.
import type { AmortizationRow, MortgageCalculationResult, MortgageInput, PaymentFrequency } from '../types';

export const EPSILON = 1e-9;

/** Rounds to cents and guarantees a finite, non-negative-zero number. Never
 * returns NaN/Infinity — callers get 0 instead, which a validated input
 * should never actually trigger (see validateMortgageInput), but this is
 * the last line of defense the mandate explicitly requires. */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export interface MortgageInputValidationError {
  field: keyof MortgageInput | 'general';
  messageKey: string; // i18n key, resolved by the UI layer — this module never renders text
}

/** Validates raw user input BEFORE any calculation runs. Every calculation
 * function in this directory assumes it is only ever called with input
 * that already passed this check — that assumption is what lets the
 * calculators stay simple and still guarantee no NaN/Infinity reaches the
 * UI, per the mandate's explicit requirement. */
export function validateMortgageInput(input: MortgageInput): MortgageInputValidationError[] {
  const errors: MortgageInputValidationError[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

  if (!num(input.propertyPrice) || input.propertyPrice <= 0) errors.push({ field: 'propertyPrice', messageKey: 'mortgage_error_property_price_invalid' });
  if (!input.propertyCurrency) errors.push({ field: 'propertyCurrency', messageKey: 'mortgage_error_currency_required' });
  if (!num(input.downPayment) || input.downPayment < 0) errors.push({ field: 'downPayment', messageKey: 'mortgage_error_down_payment_invalid' });
  if (num(input.propertyPrice) && num(input.downPayment) && input.downPayment >= input.propertyPrice) {
    errors.push({ field: 'downPayment', messageKey: 'mortgage_error_down_payment_exceeds_price' });
  }
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0 || input.termMonths > 600) {
    errors.push({ field: 'termMonths', messageKey: 'mortgage_error_term_invalid' });
  }
  if (!num(input.nominalAnnualRatePercent) || input.nominalAnnualRatePercent < 0 || input.nominalAnnualRatePercent > 100) {
    errors.push({ field: 'nominalAnnualRatePercent', messageKey: 'mortgage_error_rate_invalid' });
  }
  if (input.gracePeriodMonths !== undefined) {
    if (!Number.isInteger(input.gracePeriodMonths) || input.gracePeriodMonths < 0 || input.gracePeriodMonths >= input.termMonths) {
      errors.push({ field: 'gracePeriodMonths', messageKey: 'mortgage_error_grace_period_invalid' });
    }
  }
  const nonNegativeOptional: (keyof MortgageInput)[] = [
    'originationFeePercent', 'originationFeeFlat', 'monthlyFeeFlat', 'annualFeeFlat',
    'valuationFeeFlat', 'mandatoryInsuranceAnnualFlat', 'otherMandatoryOneTimeCosts',
    'otherMandatoryRecurringMonthlyCosts',
  ];
  for (const field of nonNegativeOptional) {
    const v = input[field];
    if (v !== undefined && (!num(v) || (v as number) < 0)) errors.push({ field, messageKey: 'mortgage_error_fee_invalid' });
  }
  if (input.effectiveAnnualRatePercentFromBank !== undefined && (!num(input.effectiveAnnualRatePercentFromBank) || (input.effectiveAnnualRatePercentFromBank as number) < 0)) {
    errors.push({ field: 'effectiveAnnualRatePercentFromBank', messageKey: 'mortgage_error_rate_invalid' });
  }
  return errors;
}

export function computeLoanAmount(input: Pick<MortgageInput, 'propertyPrice' | 'downPayment'>): number {
  return roundCurrency(Math.max(0, input.propertyPrice - input.downPayment));
}

/** Standard fixed-rate annuity monthly payment for a fully-amortizing loan.
 * Returns 0 for a zero-principal loan (down payment covers the full
 * price) rather than NaN. A zero nominal rate correctly degrades to a
 * straight-line principal-only payment (no division by zero). */
export function computeMonthlyPayment(principal: number, annualRatePercent: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate < EPSILON) return roundCurrency(principal / termMonths);
  const factor = Math.pow(1 + monthlyRate, termMonths);
  const payment = (principal * monthlyRate * factor) / (factor - 1);
  return roundCurrency(payment);
}

interface BuildScheduleOptions {
  principal: number;
  annualRatePercent: number;
  termMonths: number;
  gracePeriodMonths?: number;
  monthlyFeeFlat?: number;
  annualFeeFlat?: number;
  mandatoryInsuranceAnnualFlat?: number;
  otherMandatoryRecurringMonthlyCosts?: number;
}

/** Builds the full month-by-month amortization schedule. Interest is
 * recomputed off the ACTUAL remaining principal every month (never a
 * pre-baked table), so grace-period interest-only months and the
 * post-grace re-amortization are both exact, not approximated. */
export function buildAmortizationSchedule(opts: BuildScheduleOptions): AmortizationRow[] {
  const {
    principal, annualRatePercent, termMonths, gracePeriodMonths = 0,
    monthlyFeeFlat = 0, annualFeeFlat = 0, mandatoryInsuranceAnnualFlat = 0,
    otherMandatoryRecurringMonthlyCosts = 0,
  } = opts;
  if (principal <= 0 || termMonths <= 0) return [];

  const monthlyRate = annualRatePercent / 100 / 12;
  const recurringKnownMonthly = monthlyFeeFlat + annualFeeFlat / 12 + mandatoryInsuranceAnnualFlat / 12 + otherMandatoryRecurringMonthlyCosts;
  const amortizingMonths = termMonths - gracePeriodMonths;
  const regularPayment = amortizingMonths > 0 ? computeMonthlyPayment(principal, annualRatePercent, amortizingMonths) : 0;

  const rows: AmortizationRow[] = [];
  let remaining = principal;

  for (let month = 1; month <= termMonths; month++) {
    const opening = remaining;
    const interest = roundCurrency(opening * monthlyRate);
    const isGraceMonth = month <= gracePeriodMonths;
    let principalPortion: number;
    let totalPaymentBeforeFees: number;

    if (isGraceMonth) {
      principalPortion = 0;
      totalPaymentBeforeFees = interest;
    } else if (month === termMonths) {
      // Final month: pay off whatever remains exactly, absorbing rounding
      // drift from 100+ prior roundCurrency() calls rather than leaving a
      // stray balance or going negative.
      principalPortion = opening;
      totalPaymentBeforeFees = roundCurrency(opening + interest);
    } else {
      principalPortion = roundCurrency(Math.min(regularPayment - interest, opening));
      totalPaymentBeforeFees = roundCurrency(principalPortion + interest);
    }

    remaining = roundCurrency(Math.max(0, opening - principalPortion));
    rows.push({
      month,
      openingPrincipal: opening,
      principalPortion,
      interestPortion: interest,
      recurringKnownCosts: roundCurrency(recurringKnownMonthly),
      totalPayment: roundCurrency(totalPaymentBeforeFees + recurringKnownMonthly),
      remainingPrincipal: remaining,
    });
  }
  return rows;
}

/** Groups a monthly schedule into the user's selected display frequency —
 * a pure presentation transform, never a change to how interest actually
 * compounds (see the module header comment). */
export function groupScheduleByFrequency(schedule: AmortizationRow[], frequency: PaymentFrequency = 'MONTHLY'): AmortizationRow[] {
  const monthsPerGroup = frequency === 'ANNUAL' ? 12 : frequency === 'QUARTERLY' ? 3 : 1;
  if (monthsPerGroup === 1) return schedule;
  const grouped: AmortizationRow[] = [];
  for (let i = 0; i < schedule.length; i += monthsPerGroup) {
    const chunk = schedule.slice(i, i + monthsPerGroup);
    if (!chunk.length) continue;
    grouped.push({
      month: chunk[chunk.length - 1].month,
      openingPrincipal: chunk[0].openingPrincipal,
      principalPortion: roundCurrency(chunk.reduce((s, r) => s + r.principalPortion, 0)),
      interestPortion: roundCurrency(chunk.reduce((s, r) => s + r.interestPortion, 0)),
      recurringKnownCosts: roundCurrency(chunk.reduce((s, r) => s + r.recurringKnownCosts, 0)),
      totalPayment: roundCurrency(chunk.reduce((s, r) => s + r.totalPayment, 0)),
      remainingPrincipal: chunk[chunk.length - 1].remainingPrincipal,
    });
  }
  return grouped;
}

function oneTimeKnownCosts(input: MortgageInput, loanAmount: number): number {
  const originationFromPercent = ((input.originationFeePercent ?? 0) / 100) * loanAmount;
  return roundCurrency(
    originationFromPercent +
    (input.originationFeeFlat ?? 0) +
    (input.valuationFeeFlat ?? 0) +
    (input.otherMandatoryOneTimeCosts ?? 0)
  );
}

/** The single entry point the UI should call for a full calculation.
 * Assumes `input` already passed validateMortgageInput — throws otherwise,
 * deliberately, so an invalid state can never silently produce a
 * NaN/Infinity result the UI would have to guard against separately. */
export function calculateMortgage(input: MortgageInput): MortgageCalculationResult {
  const errors = validateMortgageInput(input);
  if (errors.length) {
    throw new Error(`calculateMortgage called with invalid input: ${errors.map(e => `${e.field}:${e.messageKey}`).join(', ')}`);
  }

  const loanAmount = computeLoanAmount(input);
  const schedule = buildAmortizationSchedule({
    principal: loanAmount,
    annualRatePercent: input.nominalAnnualRatePercent,
    termMonths: input.termMonths,
    gracePeriodMonths: input.gracePeriodMonths,
    monthlyFeeFlat: input.monthlyFeeFlat,
    annualFeeFlat: input.annualFeeFlat,
    mandatoryInsuranceAnnualFlat: input.mandatoryInsuranceAnnualFlat,
    otherMandatoryRecurringMonthlyCosts: input.otherMandatoryRecurringMonthlyCosts,
  });

  const totalPrincipal = roundCurrency(schedule.reduce((s, r) => s + r.principalPortion, 0));
  const totalInterest = roundCurrency(schedule.reduce((s, r) => s + r.interestPortion, 0));
  const totalRecurringKnownCosts = roundCurrency(schedule.reduce((s, r) => s + r.recurringKnownCosts, 0));
  const oneTime = oneTimeKnownCosts(input, loanAmount);
  const totalKnownFees = roundCurrency(oneTime + totalRecurringKnownCosts);
  const totalRepayment = roundCurrency(totalPrincipal + totalInterest + totalKnownFees);

  const firstRegularRow = schedule.find(r => r.month === (input.gracePeriodMonths ?? 0) + 1) ?? schedule[0];
  const monthlyPayment = firstRegularRow ? firstRegularRow.totalPayment : 0;

  const ltvPercent = input.propertyPrice > 0 ? roundCurrency((loanAmount / input.propertyPrice) * 100) : null;
  const downPaymentPercent = input.propertyPrice > 0 ? roundCurrency((input.downPayment / input.propertyPrice) * 100) : 0;

  return {
    loanAmount,
    downPaymentPercent,
    monthlyPayment,
    totalPrincipal,
    totalInterest,
    totalKnownFees,
    totalRepayment,
    // Effective-rate calculation lives in effectiveRate.ts (kept separate
    // because it has its own, stricter "insufficient input -> null" rule,
    // per the mandate: "If insufficient input exists, DO NOT invent an
    // effective rate; ask for the missing details."). Populated by the
    // caller (see src/mortgage/calculations/index.ts) rather than here, so
    // this function stays a pure, always-succeeding core calculator.
    effectiveAnnualRatePercent: null,
    effectiveRateUnavailableReason: null,
    ltvPercent,
    amortizationSchedule: schedule,
    currency: input.propertyCurrency,
  };
}
