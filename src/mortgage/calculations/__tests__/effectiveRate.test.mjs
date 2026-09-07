import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectiveRate } from '../effectiveRate.ts';

function baseInput(overrides = {}) {
  return {
    propertyPrice: 160000, propertyCurrency: 'USD', downPayment: 40000,
    termMonths: 240, nominalAnnualRatePercent: 10.5, ...overrides,
  };
}

test('computeEffectiveRate: with zero fees, the effective annual rate is still slightly ABOVE nominal (pure monthly-compounding effect) — never equal by coincidence and never below', () => {
  const { effectiveAnnualRatePercent, unavailableReasonKey } = computeEffectiveRate(baseInput());
  assert.equal(unavailableReasonKey, null);
  assert.ok(effectiveAnnualRatePercent > 10.5, `expected >10.5, got ${effectiveAnnualRatePercent}`);
  assert.ok(effectiveAnnualRatePercent < 12, 'sanity ceiling for this input');
});

test('computeEffectiveRate: adding one-time fees strictly increases the effective rate versus the zero-fee case', () => {
  const withoutFees = computeEffectiveRate(baseInput()).effectiveAnnualRatePercent;
  const withFees = computeEffectiveRate(baseInput({ originationFeePercent: 2, valuationFeeFlat: 500 })).effectiveAnnualRatePercent;
  assert.ok(withFees > withoutFees, `expected fees to raise the effective rate: ${withFees} vs ${withoutFees}`);
});

test('computeEffectiveRate: adding recurring monthly/insurance costs also increases the effective rate', () => {
  const withoutFees = computeEffectiveRate(baseInput()).effectiveAnnualRatePercent;
  const withRecurring = computeEffectiveRate(baseInput({ monthlyFeeFlat: 15, mandatoryInsuranceAnnualFlat: 300 })).effectiveAnnualRatePercent;
  assert.ok(withRecurring > withoutFees);
});

test('computeEffectiveRate: a 100%-cash scenario (no financing) returns null with a reason, never a fabricated 0% or NaN', () => {
  const { effectiveAnnualRatePercent, unavailableReasonKey } = computeEffectiveRate(baseInput({ downPayment: 160000 }));
  assert.equal(effectiveAnnualRatePercent, null);
  assert.equal(unavailableReasonKey, 'mortgage_effective_rate_unavailable_no_financing');
});

test('computeEffectiveRate: a zero nominal rate with zero fees still resolves (no financing cost at all) and is never negative', () => {
  const { effectiveAnnualRatePercent, unavailableReasonKey } = computeEffectiveRate(baseInput({ nominalAnnualRatePercent: 0 }));
  assert.equal(unavailableReasonKey, null);
  assert.ok(effectiveAnnualRatePercent >= 0);
});
