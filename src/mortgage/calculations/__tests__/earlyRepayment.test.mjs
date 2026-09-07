import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateEarlyRepayment } from '../earlyRepayment.ts';

function baseInput(overrides = {}) {
  return {
    propertyPrice: 160000, propertyCurrency: 'USD', downPayment: 40000,
    termMonths: 240, nominalAnnualRatePercent: 10.5, ...overrides,
  };
}

test('calculateEarlyRepayment: a one-time extra payment shortens the payoff month and saves real interest', () => {
  const result = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 10000, extraPaymentMonth: 12 });
  assert.ok(result.monthsSaved > 0, 'expected the term to shorten');
  assert.ok(result.interestSaved > 0, 'expected some interest to be saved');
  assert.equal(result.newPayoffMonth, 240 - result.monthsSaved);
});

test('calculateEarlyRepayment: a bigger extra payment saves at least as much interest as a smaller one', () => {
  const small = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 5000, extraPaymentMonth: 12 });
  const big = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 20000, extraPaymentMonth: 12 });
  assert.ok(big.interestSaved > small.interestSaved);
  assert.ok(big.monthsSaved >= small.monthsSaved);
});

test('calculateEarlyRepayment: an unstated early-repayment fee is reported as NOT included, never silently assumed zero-cost', () => {
  const result = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 10000, extraPaymentMonth: 12 });
  assert.equal(result.earlyRepaymentFeeIncluded, false);
});

test('calculateEarlyRepayment: a confirmed fee is included in the total cost and flagged as included', () => {
  const withoutFee = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 10000, extraPaymentMonth: 12 });
  const withFee = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 10000, extraPaymentMonth: 12, knownEarlyRepaymentFeeFlat: 500 });
  assert.equal(withFee.earlyRepaymentFeeIncluded, true);
  assert.ok(Math.abs((withFee.totalCostWithExtra - withoutFee.totalCostWithExtra) - 500) < 0.01);
});

test('calculateEarlyRepayment: a recurring monthly extra compounds savings beyond a single one-time payment of the same first-month size', () => {
  const oneTime = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 200, extraPaymentMonth: 12 });
  const recurring = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 200, extraPaymentMonth: 12, recurringMonthlyExtra: 200 });
  assert.ok(recurring.interestSaved > oneTime.interestSaved);
  assert.ok(recurring.monthsSaved >= oneTime.monthsSaved);
});

test('calculateEarlyRepayment: rejects an out-of-range extraPaymentMonth rather than silently clamping it', () => {
  assert.throws(() => calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 1000, extraPaymentMonth: 0 }));
  assert.throws(() => calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 1000, extraPaymentMonth: 999 }));
});
