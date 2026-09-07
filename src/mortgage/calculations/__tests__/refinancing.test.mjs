import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRefinancing } from '../refinancing.ts';

test('calculateRefinancing: a materially lower new rate produces positive lifetime savings net of fees', () => {
  const result = calculateRefinancing({
    currentRemainingPrincipal: 100000, currentRemainingTermMonths: 180, currentNominalAnnualRatePercent: 12,
    newNominalAnnualRatePercent: 8, newTermMonths: 180, refinancingFeesFlat: 1000,
  });
  assert.ok(result.lifetimeSavings > 0);
  assert.ok(result.monthlyPaymentAfter < result.monthlyPaymentBefore);
});

test('calculateRefinancing: a break-even month is only computed when the new monthly payment is actually lower', () => {
  const savingsCase = calculateRefinancing({
    currentRemainingPrincipal: 100000, currentRemainingTermMonths: 180, currentNominalAnnualRatePercent: 12,
    newNominalAnnualRatePercent: 8, newTermMonths: 180, refinancingFeesFlat: 1000,
  });
  assert.ok(savingsCase.breakEvenMonths > 0);

  const noMonthlySavingCase = calculateRefinancing({
    currentRemainingPrincipal: 100000, currentRemainingTermMonths: 180, currentNominalAnnualRatePercent: 8,
    newNominalAnnualRatePercent: 8, newTermMonths: 60, refinancingFeesFlat: 1000,
  });
  // Same rate, much shorter new term -> higher monthly payment -> no monthly saving to break even against.
  assert.equal(noMonthlySavingCase.breakEvenMonths, null);
});

test('calculateRefinancing: a worse new rate produces negative lifetime savings rather than being hidden/clamped', () => {
  const result = calculateRefinancing({
    currentRemainingPrincipal: 100000, currentRemainingTermMonths: 180, currentNominalAnnualRatePercent: 6,
    newNominalAnnualRatePercent: 14, newTermMonths: 180, refinancingFeesFlat: 500,
  });
  assert.ok(result.lifetimeSavings < 0);
});

test('calculateRefinancing: rejects invalid input rather than computing garbage', () => {
  assert.throws(() => calculateRefinancing({
    currentRemainingPrincipal: -1, currentRemainingTermMonths: 180, currentNominalAnnualRatePercent: 6,
    newNominalAnnualRatePercent: 8, newTermMonths: 180, refinancingFeesFlat: 500,
  }));
});
