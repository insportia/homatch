// The decomposition is only useful if it RECONCILES. A chart whose
// segments do not add up to the gap it claims to explain is worse than
// no chart: it invites the reader to trust an attribution the maths
// does not support.
//
// So the first three tests are all the same property from different
// angles, and the rest are the honesty rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRateBreakdown } from '../rateBreakdown.ts';
import { computeEffectiveRate } from '../effectiveRate.ts';

const base = {
  propertyPrice: 150_000,
  propertyCurrency: 'GEL',
  downPayment: 30_000,
  termMonths: 240,
  nominalAnnualRatePercent: 12.5,
};

const loaded = {
  ...base,
  originationFeePercent: 1,
  monthlyFeeFlat: 10,
  mandatoryInsuranceAnnualFlat: 240,
  valuationFeeFlat: 150,
};

test('the components sum exactly to the effective rate', () => {
  const breakdown = buildRateBreakdown(loaded);
  const summed = breakdown.components.reduce((total, c) => total + c.ratePoints, 0);
  assert.ok(
    Math.abs(summed - breakdown.effectiveAnnualRatePercent) < 0.02,
    `components sum to ${summed} but the effective rate is ${breakdown.effectiveAnnualRatePercent}`,
  );
});

test('interest alone already sits above the advertised rate', () => {
  // The lesson the whole view is built on: monthly compounding lifts a
  // 12.5% nominal rate before any fee exists. If this ever stopped
  // being true the first segment would be mislabelled.
  const breakdown = buildRateBreakdown(loaded);
  const interest = breakdown.components.find((c) => c.key === 'INTEREST');
  assert.ok(interest.ratePoints > base.nominalAnnualRatePercent);
  assert.ok(interest.ratePoints < base.nominalAnnualRatePercent + 1.5, 'and not by an absurd amount');
});

test('a loan with no fees has one component and no gap beyond compounding', () => {
  const breakdown = buildRateBreakdown(base);
  assert.equal(breakdown.components.length, 1);
  assert.equal(breakdown.components[0].key, 'INTEREST');
  assert.equal(breakdown.effectiveAnnualRatePercent, computeEffectiveRate(base).effectiveAnnualRatePercent);
});

test('every cost class the borrower did not enter is named, not assumed zero', () => {
  const breakdown = buildRateBreakdown(base);
  assert.deepEqual(new Set(breakdown.unknownCosts), new Set([
    'ORIGINATION_FEE',
    'VALUATION_FEE',
    'OTHER_ONE_TIME',
    'MONTHLY_FEE',
    'ANNUAL_FEE',
    'MANDATORY_INSURANCE',
    'OTHER_RECURRING',
  ]));
});

test('a class that was entered is not also reported as unknown', () => {
  const breakdown = buildRateBreakdown(loaded);
  for (const key of ['ORIGINATION_FEE', 'MONTHLY_FEE', 'MANDATORY_INSURANCE', 'VALUATION_FEE']) {
    assert.ok(!breakdown.unknownCosts.includes(key), `${key} was entered but reported unknown`);
  }
  assert.ok(breakdown.unknownCosts.includes('ANNUAL_FEE'), 'and one that was not, still is');
});

test('every fee pushes the rate up, never down', () => {
  const breakdown = buildRateBreakdown(loaded);
  for (const component of breakdown.components) {
    if (component.key === 'INTEREST') continue;
    assert.ok(component.ratePoints > 0, `${component.key} moved the rate by ${component.ratePoints}`);
  }
});

test('each component carries what it costs in money, not only in points', () => {
  const breakdown = buildRateBreakdown(loaded);
  const origination = breakdown.components.find((c) => c.key === 'ORIGINATION_FEE');
  // 1% of a 120,000 loan.
  assert.equal(origination.amount, 1200);
  const monthly = breakdown.components.find((c) => c.key === 'MONTHLY_FEE');
  assert.equal(monthly.amount, 10 * 240);
  const insurance = breakdown.components.find((c) => c.key === 'MANDATORY_INSURANCE');
  assert.equal(insurance.amount, 240 * 20);
});

test('an all-cash purchase has no effective rate and says why', () => {
  const breakdown = buildRateBreakdown({ ...base, downPayment: 150_000 - 1, propertyPrice: 150_000 });
  assert.ok(breakdown.effectiveAnnualRatePercent !== null, 'a 1-unit loan is still a loan');

  const cash = buildRateBreakdown({ ...base, propertyPrice: 150_000, downPayment: 150_000 });
  assert.equal(cash.effectiveAnnualRatePercent, null);
  assert.equal(cash.effectiveRateUnavailableReason, 'mortgage_effective_rate_unavailable_no_financing');
  assert.deepEqual(cash.components, []);
  assert.equal(cash.gapPoints, null);
});

test('a bank-stated rate is reported beside ours, never instead of it', () => {
  const breakdown = buildRateBreakdown({ ...loaded, effectiveAnnualRatePercentFromBank: 14.2 });
  assert.equal(breakdown.bankStatedEffectiveRate, 14.2);
  assert.ok(breakdown.effectiveAnnualRatePercent !== 14.2, 'ours is still computed independently');
  assert.ok(
    Math.abs(breakdown.bankStatedDifferencePoints - (14.2 - breakdown.effectiveAnnualRatePercent)) < 0.001,
  );
});

test('the order of the build-up is stable', () => {
  // The attribution is order-dependent by construction, so the order is
  // part of the contract: everything charged at signing, then everything
  // charged every month. A reshuffle would silently move points between
  // segments in a chart somebody is reading as fact.
  const breakdown = buildRateBreakdown({
    ...loaded,
    otherMandatoryOneTimeCosts: 100,
    annualFeeFlat: 50,
    otherMandatoryRecurringMonthlyCosts: 5,
  });
  assert.deepEqual(
    breakdown.components.map((c) => c.key),
    [
      'INTEREST',
      'ORIGINATION_FEE',
      'VALUATION_FEE',
      'OTHER_ONE_TIME',
      'MONTHLY_FEE',
      'ANNUAL_FEE',
      'MANDATORY_INSURANCE',
      'OTHER_RECURRING',
    ],
  );
});
