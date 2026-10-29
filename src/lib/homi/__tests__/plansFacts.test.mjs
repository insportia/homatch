/* HOMI quotes the real plans: lines come from the admin-editable rows, never constants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanTrials, parsePublicPlans, plansAnswerLines, plansAnswerText, plansPromptBlock } from '../plansFacts.ts';
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
  assert.match(text, /Standard\*\*: 9\.90 ₾ თვეში, 5 ქონების შემოწმება, 10 ხელშეკრულების ანალიზი/);
  assert.match(text, /VIP\*\*: 29 ₾ თვეში, 15 ქონების შემოწმება, 30 ხელშეკრულების ანალიზი/);
  assert.match(text, /Unlimited\*\*: 99 ₾ თვეში, ქონების შეუზღუდავი შემოწმება, ხელშეკრულებების შეუზღუდავი ანალიზი/);
  assert.ok(!/[–—]/.test(text), 'no dashes as punctuation');
  assert.ok(!/ხმ/.test(text), 'voice is not promised');
});

test('the opening is the owner sentence, with count, names and the cheapest price read from the rows', () => {
  const opts = { trials: parsePlanTrials({ ...RPC, trials: ['VERIFY', 'CONTRACT_ANALYSIS'] }), paymentsConnected: false };
  const text = plansAnswerText(parsePublicPlans(RPC), 'ka', opts);
  assert.ok(text.startsWith('გვაქვს სამი გამოწერის გეგმა: Standard, VIP და Unlimited. ფასები იწყება 9.90 ლარიდან თვეში. თითოეული გეგმა განსხვავდება ქონების შემოწმებისა და ხელშეკრულების ანალიზის ლიმიტებით.'), text);
  assert.match(text, /პირველი ქონების შემოწმება და პირველი ხელშეკრულების ანალიზი უფასოა/);
  assert.match(text, /ონლაინ გადახდის დამატებაზე ვმუშაობთ/);
  assert.ok(!/ყოველთვიურად პირველი|ყოველ თვე პირველი/.test(text), 'the free first use is once, not monthly');
  // A price edit and a removed plan change the opening without code.
  const edited = parsePublicPlans({ plans: [{ ...RPC.plans[1], priceTetri: 1990 }, RPC.plans[2]] });
  assert.ok(plansAnswerText(edited, 'ka').startsWith('გვაქვს ორი გამოწერის გეგმა: VIP და Unlimited. ფასები იწყება 19.90 ლარიდან'));
  // Payment is never claimed open when it is not.
  assert.ok(!/ვმუშაობთ/.test(plansAnswerText(parsePublicPlans(RPC), 'ka', { paymentsConnected: true })));
  for (const lang of ['en', 'ru', 'tr', 'ar', 'he']) {
    const other = plansAnswerText(parsePublicPlans(RPC), lang, opts);
    assert.match(other, /9\.90/, lang);
    assert.ok(!/[–—]/.test(other), `${lang}: no dashes`);
  }
});

test('the model is told the first use is once per account and that payment is pending', () => {
  const block = plansPromptBlock(parsePublicPlans(RPC), { paymentsConnected: false });
  assert.match(block, /once per account \(NOT every month\)/);
  assert.match(block, /Online payment is not available yet/);
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
