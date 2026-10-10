// The Verify budget UI says credits used / remaining / returned — never how
// the price is made. Every new string exists in all six languages, keeps its
// {{n}} placeholder, and none mentions VAT, margin, costs or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERIFY_SCALE_STRINGS } from '../../../scripts/verify-scale-i18n-data.mjs';

const ui = readFileSync(new URL('../../components/verify/VerifyBudget.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only
const BUDGET_KEYS = Object.keys(VERIFY_SCALE_STRINGS).filter((k) => /^(verify_(budget|paused|resume|view_partial|final_cost|unused_returned|pause|pausing|ads_budget_limit|err_sign_in|extend|awaiting|limit)|vh_state_paused)/.test(k));
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

test('the extension popup uses the owner\'s exact English copy (2026-10-10)', () => {
  const en = (k) => VERIFY_SCALE_STRINGS[k][0];
  assert.equal(en('verify_budget_eyebrow').toUpperCase(), 'VERIFICATION BUDGET');
  assert.equal(en('verify_extend_title'), 'Your property deserves the full picture.');
  assert.equal(en('verify_extend_body'), "We've completed part of your investigation. A few additional checks could reveal important details and help make your report more complete.");
  assert.equal(en('verify_extend_label').toUpperCase(), 'ADDITIONAL BUDGET');
  assert.equal(en('verify_extend_amount').replace('{{n}}', '25'), 'Up to 25 credits');
  assert.equal(en('verify_extend_equiv').replace('{{v}}', '$2.50'), '$2.50 max.');
  assert.equal(en('verify_extend_note'), 'You may spend less. Only the actual cost of additional checks is charged, and unused credits return to your wallet.');
  assert.equal(en('verify_extend_saved'), "Your completed checks and findings are already saved. Nothing you've paid for needs to be repeated unnecessarily.");
  assert.equal(en('verify_extend_continue'), 'Continue My Verification');
  assert.equal(en('verify_extend_stop'), 'Stop & View Current Results');
  assert.equal(en('verify_extend_consent').replace('{{n}}', '25'), 'Continuing authorizes up to 25 additional credits. No automatic extra charges.');
});

test('the popup opens only on the server\'s word, once per screen; no authorisation milestones are shown', () => {
  const page = readFileSync(new URL('../../pages/VerifyPage.tsx', import.meta.url), 'utf8');
  const dlg = page.slice(page.indexOf('<VerifyBudgetExtendDialog'), page.indexOf('<VerifyBudgetExtendDialog') + 600);
  assert.match(dlg, /open=\{!!billing&&billing\.canExtend!==false&&billing\.hold!=='LIMIT'&&\(billing\.hold==='APPROVAL'\|\|resumeError==='BUDGET_EXHAUSTED'\)&&extendDismissedAt!==\(billing\.authorizations\?\?0\)\}/);
  // Nothing in the UI reads usage percentages to interrupt, or prints the authorisation count.
  assert.doesNotMatch(page + ui, /budgetGuard/);
  assert.doesNotMatch(ui, /\{billing\.authorizations\}|authorizations\s*\}\)/);
  for (const v of Object.values(VERIFY_SCALE_STRINGS).flat()) assert.doesNotMatch(String(v), /\b(50|75)\b.*\b(75|100)\b/, 'no 25 → 50 → 75 → 100 ladder');
});
