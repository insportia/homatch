// Imports the REAL source module directly — Node 22's built-in TypeScript
// type-stripping makes this possible for plain .ts files with no
// React/Deno dependency (see src/mortgage/types.ts header comment for why
// this is preferable to the "copy verbatim" pattern used elsewhere in this
// repo for Deno-only code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMortgageInput, computeLoanAmount, computeMonthlyPayment,
  buildAmortizationSchedule, calculateMortgage, roundCurrency,
} from '../amortization.ts';

function baseInput(overrides = {}) {
  return {
    propertyPrice: 160000,
    propertyCurrency: 'USD',
    downPayment: 40000,
    termMonths: 240,
    nominalAnnualRatePercent: 10.5,
    ...overrides,
  };
}

test('validateMortgageInput: a clean minimal input produces zero errors', () => {
  assert.deepEqual(validateMortgageInput(baseInput()), []);
});

test('validateMortgageInput: down payment >= price is rejected, never silently clamped', () => {
  const errors = validateMortgageInput(baseInput({ downPayment: 160000 }));
  assert.ok(errors.some(e => e.messageKey === 'mortgage_error_down_payment_exceeds_price'));
});

test('validateMortgageInput: negative/zero/NaN/huge values are all rejected', () => {
  assert.ok(validateMortgageInput(baseInput({ propertyPrice: 0 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ propertyPrice: -5 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ propertyPrice: NaN })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ termMonths: 0 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ termMonths: 1.5 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ termMonths: 601 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ nominalAnnualRatePercent: -1 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ nominalAnnualRatePercent: 101 })).length > 0);
});

test('validateMortgageInput: grace period must be a non-negative integer strictly less than the term', () => {
  assert.ok(validateMortgageInput(baseInput({ gracePeriodMonths: -1 })).length > 0);
  assert.ok(validateMortgageInput(baseInput({ gracePeriodMonths: 240 })).length > 0);
  assert.deepEqual(validateMortgageInput(baseInput({ gracePeriodMonths: 6 })), []);
});

test('computeLoanAmount: price minus down payment, never negative', () => {
  assert.equal(computeLoanAmount({ propertyPrice: 160000, downPayment: 40000 }), 120000);
  assert.equal(computeLoanAmount({ propertyPrice: 100000, downPayment: 100000 }), 0);
});

test('computeMonthlyPayment: matches the standard annuity formula for a known case', () => {
  // 120000 principal, 10.5% nominal annual, 240 months — cross-checked
  // against the closed-form annuity formula independently.
  const payment = computeMonthlyPayment(120000, 10.5, 240);
  const r = 10.5 / 100 / 12;
  const expected = (120000 * r * Math.pow(1 + r, 240)) / (Math.pow(1 + r, 240) - 1);
  assert.ok(Math.abs(payment - roundCurrency(expected)) < 0.01);
});

test('computeMonthlyPayment: a zero rate degrades to straight-line principal, never divides by zero', () => {
  assert.equal(computeMonthlyPayment(120000, 0, 120), 1000);
});

test('computeMonthlyPayment: zero principal or zero term returns 0, never NaN', () => {
  assert.equal(computeMonthlyPayment(0, 10.5, 240), 0);
  assert.equal(computeMonthlyPayment(120000, 10.5, 0), 0);
});

test('buildAmortizationSchedule: total principal repaid across the schedule equals the loan amount exactly (no rounding drift)', () => {
  const schedule = buildAmortizationSchedule({ principal: 120000, annualRatePercent: 10.5, termMonths: 240 });
  const totalPrincipal = schedule.reduce((s, r) => s + r.principalPortion, 0);
  assert.ok(Math.abs(totalPrincipal - 120000) < 0.01, `expected ~120000, got ${totalPrincipal}`);
  assert.equal(schedule[schedule.length - 1].remainingPrincipal, 0);
});

test('buildAmortizationSchedule: grace period months are interest-only — principal never reduces during grace', () => {
  const schedule = buildAmortizationSchedule({ principal: 120000, annualRatePercent: 10.5, termMonths: 240, gracePeriodMonths: 6 });
  for (let i = 0; i < 6; i++) {
    assert.equal(schedule[i].principalPortion, 0, `month ${i + 1} should be interest-only`);
    assert.equal(schedule[i].remainingPrincipal, 120000, `principal must not shrink during grace at month ${i + 1}`);
  }
  assert.ok(schedule[6].principalPortion > 0, 'amortization should begin the month right after grace ends');
});

test('buildAmortizationSchedule: recurring known costs (monthly fee, annual fee, insurance) are folded into every row', () => {
  const schedule = buildAmortizationSchedule({
    principal: 100000, annualRatePercent: 8, termMonths: 12,
    monthlyFeeFlat: 5, annualFeeFlat: 120, mandatoryInsuranceAnnualFlat: 240,
  });
  // 5 + 120/12 + 240/12 = 5 + 10 + 20 = 35
  assert.equal(schedule[0].recurringKnownCosts, 35);
});

test('buildAmortizationSchedule: empty for non-positive principal or term, never throws', () => {
  assert.deepEqual(buildAmortizationSchedule({ principal: 0, annualRatePercent: 10, termMonths: 120 }), []);
  assert.deepEqual(buildAmortizationSchedule({ principal: 100000, annualRatePercent: 10, termMonths: 0 }), []);
});

test('calculateMortgage: throws on invalid input rather than ever producing NaN/Infinity in a result', () => {
  assert.throws(() => calculateMortgage(baseInput({ propertyPrice: -1 })));
});

test('calculateMortgage: no field in the result is ever NaN or Infinity for a realistic scenario with every optional fee populated', () => {
  const result = calculateMortgage(baseInput({
    originationFeePercent: 1, originationFeeFlat: 200, monthlyFeeFlat: 10, annualFeeFlat: 60,
    valuationFeeFlat: 150, mandatoryInsuranceAnnualFlat: 300, otherMandatoryOneTimeCosts: 50,
    otherMandatoryRecurringMonthlyCosts: 5, gracePeriodMonths: 3,
  }));
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must be finite, got ${value}`);
  }
  assert.equal(result.loanAmount, 120000);
  assert.ok(result.totalRepayment > result.totalPrincipal);
  assert.equal(result.ltvPercent, 75);
  assert.equal(result.downPaymentPercent, 25);
});

test('calculateMortgage: a 100% cash purchase (down payment intentionally left just under price) still produces a tiny but sane loan, never a broken value', () => {
  const result = calculateMortgage(baseInput({ downPayment: 159999 }));
  assert.equal(result.loanAmount, 1);
  assert.ok(Number.isFinite(result.monthlyPayment));
});

test('calculateMortgage: effectiveAnnualRatePercent is left null here by design — populated only by runFullMortgageCalculation via effectiveRate.ts', () => {
  const result = calculateMortgage(baseInput());
  assert.equal(result.effectiveAnnualRatePercent, null);
});
