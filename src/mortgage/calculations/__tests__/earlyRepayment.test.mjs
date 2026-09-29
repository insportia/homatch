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

test('baseline side is exposed and consistent with the saving figures', () => {
  const r = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 20000, extraPaymentMonth: 12 });
  assert.equal(r.baselinePayoffMonth, 240);
  assert.equal(r.monthsSaved, r.baselinePayoffMonth - r.newPayoffMonth);
  assert.equal(Math.round((r.baselineTotalInterest - r.totalInterestWithExtra) * 100) / 100, r.interestSaved);
  // no fee entered -> not included, and the totals never assume zero fee silently
  assert.equal(r.earlyRepaymentFeeIncluded, false);
  assert.ok(r.baselineTotalCost > r.totalCostWithExtra, 'paying early costs less overall');
});

test('scenario A (keep the term, lower the payment) is real math, not a restyled copy of scenario B', () => {
  const r = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 20000, extraPaymentMonth: 12 });
  assert.ok(r.keepTerm, 'a mid-loan partial extra must produce a keep-term scenario');
  assert.ok(r.baselineMonthlyPayment > 0);
  assert.ok(r.keepTerm.newMonthlyPayment < r.baselineMonthlyPayment, 'the recast payment must drop');
  assert.ok(r.keepTerm.monthlySaved > 0);
  assert.ok(Math.abs((r.baselineMonthlyPayment - r.keepTerm.newMonthlyPayment) - r.keepTerm.monthlySaved) < 0.01);
  // Keeping the money longer costs more interest than shortening the term,
  // but still less than doing nothing — the ordering that makes the two
  // options a real trade-off rather than a duplicated number.
  assert.ok(r.keepTerm.totalInterest < r.baselineTotalInterest);
  assert.ok(r.keepTerm.totalInterest > r.totalInterestWithExtra);
  assert.ok(Math.abs((r.baselineTotalInterest - r.keepTerm.totalInterest) - r.keepTerm.interestSaved) < 0.01);
});

test('scenario A honors the same fee-honesty rule as scenario B', () => {
  const noFee = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 20000, extraPaymentMonth: 12 });
  const fee = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 20000, extraPaymentMonth: 12, knownEarlyRepaymentFeeFlat: 400 });
  assert.equal(Math.round((fee.keepTerm.totalCost - noFee.keepTerm.totalCost) * 100) / 100, 400);
});

test('scenario A disappears honestly when the extra clears the whole loan', () => {
  const r = calculateEarlyRepayment(baseInput(), { extraPaymentAmount: 200000, extraPaymentMonth: 12 });
  assert.equal(r.keepTerm, null);
});

test('a known fee is included in the with-plan total, and only then', () => {
  const base = baseInput();
  const noFee = calculateEarlyRepayment(base, { extraPaymentAmount: 20000, extraPaymentMonth: 12 });
  const fee = calculateEarlyRepayment(base, { extraPaymentAmount: 20000, extraPaymentMonth: 12, knownEarlyRepaymentFeeFlat: 400 });
  assert.equal(fee.earlyRepaymentFeeIncluded, true);
  assert.equal(Math.round((fee.totalCostWithExtra - noFee.totalCostWithExtra) * 100) / 100, 400);
  // the baseline is fee-free either way: the fee belongs to the plan, not to doing nothing
  assert.equal(fee.baselineTotalCost, noFee.baselineTotalCost);
});
