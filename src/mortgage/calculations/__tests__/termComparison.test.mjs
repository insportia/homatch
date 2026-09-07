import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateTermsMonths, compareTerms } from '../termComparison.ts';

function baseInput(overrides = {}) {
  return {
    propertyPrice: 160000, propertyCurrency: 'USD', downPayment: 40000,
    termMonths: 240, nominalAnnualRatePercent: 10.5, ...overrides,
  };
}

test('candidateTermsMonths: always includes the selected term plus nearby standard markers, deduplicated and sorted', () => {
  const months = candidateTermsMonths(240); // 20 years
  assert.ok(months.includes(240));
  assert.equal(months.length, new Set(months).size, 'no duplicates');
  assert.deepEqual(months, [...months].sort((a, b) => a - b));
});

test('candidateTermsMonths: an exact standard term (15y) does not produce a duplicate 180-month entry', () => {
  const months = candidateTermsMonths(180);
  assert.equal(months.filter(m => m === 180).length, 1);
});

test('compareTerms: exactly one row is flagged isSelected, matching the input term', () => {
  const rows = compareTerms(baseInput());
  const selected = rows.filter(r => r.isSelected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].termMonths, 240);
  assert.equal(selected[0].monthlyPaymentDeltaVsSelected, 0);
  assert.equal(selected[0].totalCostDeltaVsSelected, 0);
});

test('compareTerms: the mandate\'s stated trade-off holds — a shorter term raises the monthly payment but lowers total interest/cost', () => {
  const rows = compareTerms(baseInput({ termMonths: 240 }));
  const shorter = rows.find(r => r.termMonths === 120);
  const selected = rows.find(r => r.isSelected);
  assert.ok(shorter, 'expected a 10-year alternative to be generated');
  assert.ok(shorter.monthlyPayment > selected.monthlyPayment, 'shorter term should cost more per month');
  assert.ok(shorter.totalRepayment < selected.totalRepayment, 'shorter term should cost less over its lifetime');
});

test('compareTerms: a longer term lowers the monthly payment but raises total cost', () => {
  const rows = compareTerms(baseInput({ termMonths: 120 }));
  const longer = rows.find(r => r.termMonths === 240);
  const selected = rows.find(r => r.isSelected);
  assert.ok(longer.monthlyPayment < selected.monthlyPayment);
  assert.ok(longer.totalRepayment > selected.totalRepayment);
});

test('compareTerms: throws on an invalid base input rather than silently computing garbage rows', () => {
  assert.throws(() => compareTerms(baseInput({ propertyPrice: -1 })));
});
