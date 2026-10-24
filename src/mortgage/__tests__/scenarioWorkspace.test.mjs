// "ჩემი იპოთეკები": immutable rows grouped into scenarios, stale-rule detection, whole-chain delete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MORTGAGE_ENGINE_VERSION, appliedRuleIds, chainRowIds, scenarioFreshness, toChains } from '../workspace.ts';

const row = (id, { v = 1, sup = null, at = '2026-10-01T10:00:00Z', label = null, rules = ['pti-1', 'ltv-1'] } = {}) => ({
  id, userId: 'u', input: { propertyPrice: 1, downPayment: 0, termMonths: 12, nominalAnnualRatePercent: 1, propertyCurrency: 'GEL' },
  result: { monthlyPayment: v }, ruleVersionIds: rules, calculatedAt: at, version: v, supersedesScenarioId: sup, label,
});

test('versions of one scenario form one chain, newest first, keyed by the first version', () => {
  const rows = [
    row('a1', { label: 'Vake' }),
    row('a2', { v: 2, sup: 'a1', at: '2026-10-03T10:00:00Z' }),
    row('a3', { v: 3, sup: 'a2', at: '2026-10-05T10:00:00Z' }),
    row('b1', { label: 'Saburtalo', at: '2026-10-04T10:00:00Z' }),
  ];
  const chains = toChains(rows);
  assert.equal(chains.length, 2);
  assert.equal(chains[0].rootId, 'a1', 'most recently changed scenario first');
  assert.deepEqual(chains[0].versions.map((r) => r.id), ['a3', 'a2', 'a1']);
  assert.equal(chains[0].latest.id, 'a3');
  assert.equal(chains[0].name, 'Vake', 'the name survives versions saved without one');
  assert.deepEqual(chainRowIds(chains[0]).sort(), ['a1', 'a2', 'a3']);
});

test('a cycle or a missing parent never loops or loses a row', () => {
  const chains = toChains([row('x', { sup: 'y' }), row('y', { sup: 'x', v: 2 }), row('z', { sup: 'gone' })]);
  assert.equal(chains.reduce((n, c) => n + c.versions.length, 0), 3);
});

test('stale only when a rule that applies to its numbers today is not the one it was checked against', () => {
  const r = row('a', { rules: ['pti-1', 'ltv-1'] });
  assert.equal(scenarioFreshness(r, ['pti-1', 'ltv-1']), 'CURRENT');
  assert.equal(scenarioFreshness(r, ['pti-2', 'ltv-1']), 'STALE');
  assert.equal(scenarioFreshness(r, null), 'UNKNOWN', 'rules not loaded is never reported as stale');
  assert.equal(scenarioFreshness(r, []), 'UNKNOWN');
  assert.equal(scenarioFreshness(row('b', { rules: [] }), ['pti-1', 'ltv-1']), 'UNKNOWN', 'saved before rules loaded: unknown, not stale');
  // Rows saved before this change recorded every rule in force; they stay current while the applied ones are among them.
  assert.equal(scenarioFreshness(row('c', { rules: ['pti-1', 'pti-9', 'ltv-1', 'ltv-9'] }), ['pti-1', 'ltv-1']), 'CURRENT');
  assert.equal(scenarioFreshness({ ...r, engineVersion: 'mortgage-engine-0' }, ['pti-1', 'ltv-1']), 'STALE', 'another engine');
  assert.equal(scenarioFreshness({ ...r, engineVersion: MORTGAGE_ENGINE_VERSION }, ['pti-1', 'ltv-1']), 'CURRENT');
});

test('applied rules: the PTI tier for this income and currency, and the LTV for the currency', () => {
  const rule = (id, type, data, extra = {}) => ({ id, type, status: 'ACTIVE', data, effectiveFrom: null, effectiveTo: null, ...extra });
  const pti = [
    rule('pti-low', 'PTI_LIMIT', { currencyClass: 'LOCAL', incomeTierMaxMonthlyNet: 1500, maxPtiPercent: 25 }),
    rule('pti-high', 'PTI_LIMIT', { currencyClass: 'LOCAL', incomeTierMaxMonthlyNet: null, maxPtiPercent: 50 }),
    rule('pti-fx', 'PTI_LIMIT', { currencyClass: 'FOREIGN', incomeTierMaxMonthlyNet: null, maxPtiPercent: 30 }),
  ];
  const ltv = [rule('ltv-gel', 'LTV_LIMIT', { currencyClass: 'LOCAL', maxLtvPercent: 90 }), rule('ltv-fx', 'LTV_LIMIT', { currencyClass: 'FOREIGN', maxLtvPercent: 70 })];
  assert.deepEqual(appliedRuleIds({ monthlyNetIncome: 1200, currency: 'GEL' }, pti, ltv), ['pti-low', 'ltv-gel']);
  assert.deepEqual(appliedRuleIds({ monthlyNetIncome: 4000, currency: 'GEL' }, pti, ltv), ['pti-high', 'ltv-gel']);
  assert.deepEqual(appliedRuleIds({ monthlyNetIncome: 4000, currency: 'USD' }, pti, ltv), ['pti-fx', 'ltv-fx']);
  assert.deepEqual(appliedRuleIds({ monthlyNetIncome: null, currency: 'GEL' }, pti, ltv), ['ltv-gel'], 'no income: only the LTV applies');
});

test('saved rows are never updated in place: the service only inserts and deletes', () => {
  const api = fs.readFileSync('src/services/mortgageApi.ts', 'utf8');
  const block = api.slice(api.indexOf('SAVED / VERSIONED SCENARIOS'), api.indexOf('BANK OFFERS'));
  assert.ok(!/\.update\(/.test(block), 'mortgage_scenarios must never be updated');
  const ui = fs.readFileSync('src/components/mortgage/MortgageWorkspace.tsx', 'utf8');
  assert.ok(/supersedesScenarioId: mode === 'changes'/.test(ui), '"save changes" adds a version');
  assert.ok(/AlertDialog/.test(ui), 'delete asks first');
  assert.ok(/engineVersion: MORTGAGE_ENGINE_VERSION/.test(ui), 'the engine version is recorded');
  assert.ok(ui.includes('propertyId: propertyId ??'), 'the listing it came from is saved');
  assert.ok(ui.includes('offers } as StoredInput'), 'the compared offers are saved with it');
  assert.ok(ui.includes('deleteMortgageScenario(chainRowIds(chain))'), 'a chain is deleted in one call');
  assert.ok(api.includes(".delete().in('id', ids)"), 'one statement deletes the chain');
});

test('mortgage interest is recorded with no extra step and never carries mortgage figures', () => {
  assert.ok(!fs.existsSync('src/components/mortgage/MortgageLeadOptIn.tsx'), 'no opt-in panel');
  assert.ok(!fs.existsSync('src/services/mortgageLeads.ts'), 'no consent service');
  const svc = fs.readFileSync('src/services/mortgageInterest.ts', 'utf8');
  assert.match(svc, /record_my_mortgage_interest', \{ p_property_id: propertyId, p_budget: price, p_currency: currency \}/, 'only the listing, the price and its currency');
  for (const banned of ['monthlyNetIncome', 'existingMonthlyDebt', 'nominalAnnualRatePercent', 'monthlyPayment', 'readiness', 'mortgage_scenarios']) {
    assert.ok(!svc.includes(banned), `the interest call must not touch ${banned}`);
  }
  const page = fs.readFileSync('src/pages/MortgagePage.tsx', 'utf8');
  assert.match(page, /recordMortgageInterest\(prefill\.propertyId as string, interestPrice, draft\.currency\)/);
  assert.ok(!/sharePhone|shareEmail|consent/i.test(page), 'no consent questions on the page');
});
