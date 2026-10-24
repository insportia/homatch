// "ჩემი იპოთეკები": immutable rows grouped into scenarios, stale-rule detection, whole-chain delete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chainRowIds, isStale, toChains } from '../workspace.ts';

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

test('stale only when a rule it was checked against is no longer in force', () => {
  const r = row('a', { rules: ['pti-1', 'ltv-1'] });
  assert.equal(isStale(r, ['pti-1', 'ltv-1', 'pti-2']), false);
  assert.equal(isStale(r, ['pti-2', 'ltv-1']), true);
  assert.equal(isStale(r, null), false, 'rules not loaded is never reported as stale');
  assert.equal(isStale(r, []), false);
});

test('saved rows are never updated in place: the service only inserts and deletes', () => {
  const api = fs.readFileSync('src/services/mortgageApi.ts', 'utf8');
  const block = api.slice(api.indexOf('SAVED / VERSIONED SCENARIOS'), api.indexOf('BANK OFFERS'));
  assert.ok(!/\.update\(/.test(block), 'mortgage_scenarios must never be updated');
  const ui = fs.readFileSync('src/components/mortgage/MortgageWorkspace.tsx', 'utf8');
  assert.ok(/supersedesScenarioId: mode === 'changes'/.test(ui), '"save changes" adds a version');
  assert.ok(/AlertDialog/.test(ui), 'delete asks first');
  assert.ok(/engineVersion: MORTGAGE_ENGINE_VERSION/.test(ui), 'the engine version is recorded');
});

test('the lead opt-in is never pre-ticked and never sends mortgage figures', () => {
  const src = fs.readFileSync('src/components/mortgage/MortgageLeadOptIn.tsx', 'utf8');
  assert.ok(/sharePhone: false, shareEmail: false/.test(src), 'channels start unticked');
  for (const banned of ['monthlyNetIncome', 'existingMonthlyDebt', 'nominalAnnualRatePercent', 'monthlyPayment', 'readiness']) {
    assert.ok(!src.includes(banned), `opt-in must not touch ${banned}`);
  }
  const svc = fs.readFileSync('src/services/mortgageLeads.ts', 'utf8');
  assert.ok(!svc.includes(".from('mortgage_scenarios')"), 'the lead service never reads saved scenarios');
});
