// FIND BUYERS — offline precision / recall on the labelled evaluation set (fixtures/
// findBuyersEvalSet.mjs: 6 reference properties, 6 languages, every family). The set was used
// while fixing the rules, so its score is optimistic; the floors below guard against regression,
// they are not a claim of field accuracy. Rules only — no model call, no Actor run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './fixtures/findBuyersEvalRunner.mjs';
import { CASES, PROPERTIES } from './fixtures/findBuyersEvalSet.mjs';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';

const r = evaluate();

test('evaluation set covers every family, both transactions and all six languages', () => {
  assert.ok(r.size >= 80);
  const families = new Set(Object.values(PROPERTIES).map((p) => buildPropertyDna(p).family));
  for (const f of ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL']) assert.ok(families.has(f), f);
  const scripts = { ka: /[Ⴀ-ჿ]/u, ru: /[Ѐ-ӿ]/u, ar: /[؀-ۿ]/u, he: /[֐-׿]/u, tr: /(ğ|ş|ı|istiyorum|arıyorum)/iu, en: /\b(looking|buy|rent)\b/i };
  for (const [lang, re] of Object.entries(scripts)) assert.ok(CASES.some((c) => re.test(c.text)), lang);
  for (const why of ['seller', 'landlord', 'wrong-transaction', 'wrong-budget', 'wrong-location', 'wrong-subtype', 'wrong-family', 'duplicate', 'stale', 'job', 'service', 'broker-inventory', 'broker-solicits-sellers'])
    assert.ok(CASES.some((c) => c.why === why), why);
});

test(`precision and recall stay above their floors (measured: P=${r.precision.toFixed(3)} R=${r.recall.toFixed(3)} on ${r.size})`, () => {
  assert.ok(r.precision >= 0.95, `precision ${r.precision} misses=${JSON.stringify(r.misses.map((m) => m.text))}`);
  assert.ok(r.recall >= 0.9, `recall ${r.recall} misses=${JSON.stringify(r.misses.map((m) => m.text))}`);
});

test('STRONG is earned: never a rejected-label case, never one marked not-strong (keyword overlap is not enough)', () => {
  assert.equal(r.strongPrecision, 1, JSON.stringify(r.rows.filter((x) => x.category === 'STRONG' && (x.label !== 'accept' || x.strongOk === false)).map((x) => x.text)));
});

test('a broker for a named client is kept, labelled, never Strong; a "no agents" buyer is a buyer', () => {
  for (const c of r.rows.filter((x) => x.case === 'broker-for-buyer')) {
    assert.ok(c.accepted, c.text);
    assert.notEqual(c.category, 'STRONG');
    assert.ok(c.limitations.includes('BUYER_VIA_BROKER'), c.text);
  }
  for (const c of r.rows.filter((x) => x.case === 'no-agents')) assert.ok(c.accepted && c.role === 'BUY_SEEKER', c.text);
});

test('every rejection carries a reason', () => {
  for (const c of r.rows.filter((x) => !x.accepted)) assert.ok(c.reasons.length > 0, c.text);
});
