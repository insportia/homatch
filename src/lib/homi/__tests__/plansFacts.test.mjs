/* HOMI quotes the real plans: lines come from the admin-editable rows, never constants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPlans, plansAnswerLines, plansPromptBlock } from '../plansFacts.ts';
import { routeHomiTurn } from '../router.ts';

const RPC = {
  currency: 'GEL',
  plans: [
    { code: 'STANDARD', name: 'Standard', priceTetri: 990, entitlements: { VERIFY: { enabled: true, limit: 5, unlimited: false }, CONTRACT_ANALYSIS: { enabled: true, limit: 10, unlimited: false } } },
    { code: 'VIP', name: 'VIP', priceTetri: 2900, entitlements: { VERIFY: { enabled: true, limit: 15, unlimited: false }, CONTRACT_ANALYSIS: { enabled: true, limit: 30, unlimited: false } } },
    { code: 'UNLIMITED', name: 'Unlimited', priceTetri: 9900, entitlements: { VERIFY: { enabled: true, limit: null, unlimited: true }, CONTRACT_ANALYSIS: { enabled: true, limit: null, unlimited: true } } },
  ],
};

test('the answer lists every plan with its real price and allowances, in Georgian', () => {
  const text = plansAnswerLines(parsePublicPlans(RPC), 'ka');
  assert.match(text, /Standard\*\*: 9\.90 ₾ თვეში, 5 Verify, 10 ხელშეკრულების ანალიზი/);
  assert.match(text, /VIP\*\*: 29 ₾ თვეში, 15 Verify, 30 ხელშეკრულების ანალიზი/);
  assert.match(text, /Unlimited\*\*: 99 ₾ თვეში, შეუზღუდავი Verify, შეუზღუდავი ხელშეკრულების ანალიზი/);
  assert.ok(!/[–—]/.test(text), 'no dashes as punctuation');
  assert.ok(!/ხმ/.test(text), 'voice is not promised');
});

test('the model is given the same numbers, and a price edit reaches it without code', () => {
  const edited = { ...RPC, plans: [{ ...RPC.plans[0], priceTetri: 1290 }] };
  assert.match(plansPromptBlock(parsePublicPlans(RPC)), /Standard \(STANDARD\): 9\.90 GEL a month/);
  assert.match(plansPromptBlock(parsePublicPlans(edited)), /12\.90 GEL a month/);
});

test('a malformed or failed answer shows no plans rather than invented ones', () => {
  assert.deepEqual(parsePublicPlans(null), []);
  assert.deepEqual(parsePublicPlans({ plans: [{ code: 'X' }] }), []);
  assert.equal(plansAnswerLines([], 'ka'), '');
  assert.equal(plansPromptBlock([]), '');
});

test('everyday ways of asking about plans reach the plans answer', () => {
  for (const q of ['რა გეგმები გაქვთ და რა ღირს?', 'what plans do you have?', 'какие у вас тарифы?']) {
    const r = routeHomiTurn(q, {});
    assert.equal(r.kind === 'DETERMINISTIC' && r.intent, 'PLANS', q);
  }
});
