import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCurrency, selectActivePtiRule, selectActiveLtvRule } from '../../rules/ptiLtv.ts';

function ptiRule(id, { incomeTierMaxMonthlyNet, currencyClass, maxPtiPercent, status = 'ACTIVE' }) {
  return { id, type: 'PTI_LIMIT', status, data: { incomeTierMaxMonthlyNet, currencyClass, maxPtiPercent } };
}
function ltvRule(id, { currencyClass, maxLtvPercent, propertyUse, status = 'ACTIVE' }) {
  return { id, type: 'LTV_LIMIT', status, data: { currencyClass, maxLtvPercent, propertyUse } };
}

test('classifyCurrency: GEL is LOCAL, everything else (including lowercase) is FOREIGN', () => {
  assert.equal(classifyCurrency('GEL'), 'LOCAL');
  assert.equal(classifyCurrency('gel'), 'LOCAL');
  assert.equal(classifyCurrency('USD'), 'FOREIGN');
  assert.equal(classifyCurrency('EUR'), 'FOREIGN');
  assert.equal(classifyCurrency(undefined), 'FOREIGN');
});

test('selectActivePtiRule: picks the narrowest bounded tier that still covers the borrower\'s income, mirroring the real NBG two-tier structure', () => {
  const rules = [
    ptiRule('low-gel', { incomeTierMaxMonthlyNet: 1500, currencyClass: 'LOCAL', maxPtiPercent: 25 }),
    ptiRule('high-gel', { incomeTierMaxMonthlyNet: null, currencyClass: 'LOCAL', maxPtiPercent: 50 }),
    ptiRule('low-fx', { incomeTierMaxMonthlyNet: 1500, currencyClass: 'FOREIGN', maxPtiPercent: 20 }),
    ptiRule('high-fx', { incomeTierMaxMonthlyNet: null, currencyClass: 'FOREIGN', maxPtiPercent: 30 }),
  ];
  assert.equal(selectActivePtiRule(rules, 1200, 'LOCAL').id, 'low-gel');
  assert.equal(selectActivePtiRule(rules, 1500, 'LOCAL').id, 'low-gel', 'the boundary itself belongs to the lower tier (<=)');
  assert.equal(selectActivePtiRule(rules, 1501, 'LOCAL').id, 'high-gel');
  assert.equal(selectActivePtiRule(rules, 5000, 'FOREIGN').id, 'high-fx');
});

test('selectActivePtiRule: a SUPERSEDED or CANDIDATE rule is never selected, even if it would otherwise match', () => {
  const rules = [
    ptiRule('old', { incomeTierMaxMonthlyNet: null, currencyClass: 'LOCAL', maxPtiPercent: 40, status: 'SUPERSEDED' }),
  ];
  assert.equal(selectActivePtiRule(rules, 5000, 'LOCAL'), null);
});

test('selectActivePtiRule: no matching ACTIVE rule at all returns null rather than a guessed fallback', () => {
  assert.equal(selectActivePtiRule([], 3000, 'LOCAL'), null);
});

test('selectActiveLtvRule: matches by currency class; a property-use-specific row wins over a generic one when both exist', () => {
  const rules = [
    ltvRule('generic-local', { currencyClass: 'LOCAL', maxLtvPercent: 90 }),
    ltvRule('commercial-local', { currencyClass: 'LOCAL', maxLtvPercent: 70, propertyUse: 'COMMERCIAL' }),
  ];
  assert.equal(selectActiveLtvRule(rules, 'LOCAL').id, 'generic-local');
  assert.equal(selectActiveLtvRule(rules, 'LOCAL', 'COMMERCIAL').id, 'commercial-local');
  assert.equal(selectActiveLtvRule(rules, 'LOCAL', 'RESIDENTIAL').id, 'generic-local', 'falls back to the generic row when no residential-specific row exists');
});
