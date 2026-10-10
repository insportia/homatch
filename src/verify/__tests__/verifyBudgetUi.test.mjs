// The Verify budget UI says credits used / remaining / returned — never how
// the price is made. Every new string exists in all six languages, keeps its
// {{n}} placeholder, and none mentions VAT, margin, costs or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERIFY_SCALE_STRINGS } from '../../../scripts/verify-scale-i18n-data.mjs';

const ui = readFileSync(new URL('../../components/verify/VerifyBudget.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only
const BUDGET_KEYS = Object.keys(VERIFY_SCALE_STRINGS).filter((k) => /^(verify_(budget|paused|resume|view_partial|final_cost|unused_returned|pause|pausing|ads_budget_limit|err_sign_in)|vh_state_paused)/.test(k));
const FORBIDDEN = /\b(vat|margin|cogs|provider|captcha|token|api|worker|contingency)\b|დღგ|маржа|НДС|KDV|marj|ضريبة|هامش|מע"מ|מרווח/i;

test('every budget string exists in six languages with its placeholders', () => {
  assert.ok(BUDGET_KEYS.length >= 25, `only ${BUDGET_KEYS.length} keys`);
  for (const k of BUDGET_KEYS) {
    const v = VERIFY_SCALE_STRINGS[k];
    assert.equal(v.length, 6, k);
    const ph = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
    for (const s of v) {
      assert.ok(s && s.trim(), `${k} empty`);
      assert.equal(ph(s), ph(v[0]), `${k}: placeholder lost in "${s}"`);
    }
  }
});

test('no customer string explains the price', () => {
  for (const k of BUDGET_KEYS) for (const s of VERIFY_SCALE_STRINGS[k]) assert.ok(!FORBIDDEN.test(s), `${k}: "${s}"`);
});

test('the component renders server numbers only; conversion is display-only and needs a configured rate', () => {
  for (const field of ['landed', 'cogs', 'margin', 'vat', 'contingency', 'rawUsd']) assert.ok(!ui.toLowerCase().includes(field.toLowerCase()), field);
  assert.match(ui, /usdPerUnit/);
  assert.match(ui, /if \(!rate \|\| !\(Number\(rate\) > 0\)\) return null;/, 'no rate, no conversion');
  // RTL: logical spacing, isolated numbers.
  assert.ok(!/\b(ml|mr)-\d/.test(ui), 'physical margins break RTL');
  assert.match(ui, /<bdi/);
});
