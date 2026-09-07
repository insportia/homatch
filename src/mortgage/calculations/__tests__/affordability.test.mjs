import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAffordability } from '../affordability.ts';
import { calculateMortgage } from '../amortization.ts';

function scenario() {
  return calculateMortgage({
    propertyPrice: 160000, propertyCurrency: 'GEL', downPayment: 40000,
    termMonths: 240, nominalAnnualRatePercent: 10.5,
  });
}

const ptiRuleGel = { id: 'pti-gel-high', type: 'PTI_LIMIT', status: 'ACTIVE', data: { incomeTierMaxMonthlyNet: null, currencyClass: 'LOCAL', maxPtiPercent: 50 } };
const ltvRuleGel = { id: 'ltv-gel', type: 'LTV_LIMIT', status: 'ACTIVE', data: { currencyClass: 'LOCAL', maxLtvPercent: 90 } };

test('computeAffordability: PTI includes existing debt obligations alongside the mortgage payment', () => {
  const result = calculateMortgage({
    propertyPrice: 160000, propertyCurrency: 'GEL', downPayment: 40000,
    termMonths: 240, nominalAnnualRatePercent: 10.5,
  });
  const afford = computeAffordability(result, { monthlyNetIncome: 5000, incomeCurrency: 'GEL', existingMonthlyDebtObligations: 300 }, 'GEL', [ptiRuleGel], [ltvRuleGel]);
  const expectedPti = ((result.monthlyPayment + 300) / 5000) * 100;
  assert.ok(Math.abs(afford.ptiPercent - expectedPti) < 0.01);
});

test('computeAffordability: reports within/outside the matched rule\'s published limit, never a bare pass/fail without a rule id', () => {
  const result = scenario();
  const withinLimit = computeAffordability(result, { monthlyNetIncome: 20000, incomeCurrency: 'GEL' }, 'GEL', [ptiRuleGel], [ltvRuleGel]);
  assert.equal(withinLimit.ptiWithinPublishedLimit, true);
  assert.equal(withinLimit.matchedPtiRuleId, 'pti-gel-high');

  const outsideLimit = computeAffordability(result, { monthlyNetIncome: 1000, incomeCurrency: 'GEL' }, 'GEL', [ptiRuleGel], [ltvRuleGel]);
  assert.equal(outsideLimit.ptiWithinPublishedLimit, false);
});

test('computeAffordability: with no matching ACTIVE rule at all, within-limit is null (not silently true or false) and never fabricated', () => {
  const result = scenario();
  const afford = computeAffordability(result, { monthlyNetIncome: 5000, incomeCurrency: 'GEL' }, 'GEL', [], []);
  assert.equal(afford.ptiWithinPublishedLimit, null);
  assert.equal(afford.ltvWithinPublishedLimit, null);
  assert.equal(afford.matchedPtiRuleId, null);
  assert.equal(afford.matchedLtvRuleId, null);
});

test('computeAffordability: LTV is passed through unchanged from the calculation result, never recomputed differently here', () => {
  const result = scenario();
  const afford = computeAffordability(result, { monthlyNetIncome: 5000, incomeCurrency: 'GEL' }, 'GEL', [ptiRuleGel], [ltvRuleGel]);
  assert.equal(afford.ltvPercent, result.ltvPercent);
});
