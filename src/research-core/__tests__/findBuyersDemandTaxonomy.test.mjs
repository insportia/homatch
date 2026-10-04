// FIND BUYERS — freshness buckets, date provenance, market side, hard gates and
// disposition reconciliation. Includes the 2026-10-04 real run: two fresh
// Russian rental offers under a SALE search are supply AND the wrong
// transaction; they never qualify.
import test from 'node:test';
import assert from 'node:assert/strict';

import { freshnessBucket, PROMOTABLE_BUCKETS, dateProvenance, publicIntent, hardGate, emptyDispositions, reconciles, DISPOSITIONS } from '../findBuyers/demandTaxonomy.ts';
import { classifyByRules } from '../findBuyers/intent.ts';
import { extractTextFacts } from '../findBuyers/textFacts.ts';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();

test('freshness buckets cover 0–24h … 31d+; unknown age is never fresh', () => {
  assert.equal(freshnessBucket(ago(2), NOW), 'ULTRA_FRESH');
  assert.equal(freshnessBucket(ago(24), NOW), 'ULTRA_FRESH');
  assert.equal(freshnessBucket(ago(48), NOW), 'VERY_FRESH');
  assert.equal(freshnessBucket(ago(24 * 5), NOW), 'FRESH');
  assert.equal(freshnessBucket(ago(24 * 10), NOW), 'RECENT');
  assert.equal(freshnessBucket(ago(24 * 30), NOW), 'AGING');
  assert.equal(freshnessBucket(ago(24 * 31), NOW), 'EXPIRED');
  for (const bad of [null, '', 'yesterday', new Date(NOW + 3 * 86400e3).toISOString()]) {
    assert.equal(freshnessBucket(bad, NOW), 'FRESHNESS_UNKNOWN');
  }
  assert.ok(!PROMOTABLE_BUCKETS.has('FRESHNESS_UNKNOWN') && !PROMOTABLE_BUCKETS.has('EXPIRED'));
});

test('date provenance: own date is HIGH; parent date is INFERRED; none is NONE', () => {
  assert.deepEqual(dateProvenance(ago(1), ago(5)), { dateSource: 'PUBLISHED', dateConfidence: 'HIGH', evidenceAt: ago(1) });
  assert.deepEqual(dateProvenance(null, ago(5)), { dateSource: 'PARENT_PUBLISHED', dateConfidence: 'INFERRED', evidenceAt: ago(5) });
  assert.deepEqual(dateProvenance(null, null), { dateSource: 'NONE', dateConfidence: 'NONE', evidenceAt: null });
});

test('market side follows the text, not the campaign', () => {
  assert.equal(publicIntent('BUYER_HIGH', 'RENT'), 'TENANT_DEMAND');
  assert.equal(publicIntent('TENANT_HIGH', 'SALE'), 'BUYER_DEMAND');
  assert.equal(publicIntent('BUYER_MEDIUM', null), 'BUYER_DEMAND');
  assert.equal(publicIntent('SELLER', 'RENT'), 'LANDLORD_SUPPLY');
  assert.equal(publicIntent('SELLER', 'SALE'), 'SELLER_SUPPLY');
  assert.equal(publicIntent('AGENT', null), 'AGENT_PROMOTION');
  assert.equal(publicIntent('QUESTION', null), 'GENERAL_DISCUSSION');
  assert.equal(publicIntent('UNCERTAIN', null), 'UNKNOWN');
});

test('hard gate: a "will rent" request under a SALE search is WRONG_TRANSACTION, not a buyer', () => {
  const text = 'Сниму квартиру в Ваке на долгий срок, 2 комнаты';
  const facts = extractTextFacts(text);
  const v = classifyByRules(text, { campaign: 'SALE', kind: 'POST', parentSimilarity: null, parentStance: null });
  assert.equal(facts.transaction, 'RENT');
  /* The rule classifier relabels the request as a BUYER under SALE (tenantize); the gate reads the text's own transaction. */
  if (['BUYER_HIGH', 'BUYER_MEDIUM'].includes(v.intentClass)) {
    assert.equal(hardGate({ campaign: 'SALE', intentClass: v.intentClass, method: v.method, statedTransaction: facts.transaction }), 'WRONG_TRANSACTION');
  }
  assert.equal(hardGate({ campaign: 'SALE', intentClass: 'BUYER_HIGH', method: 'RULE', statedTransaction: 'RENT' }), 'WRONG_TRANSACTION');
  assert.equal(hardGate({ campaign: 'RENT', intentClass: 'TENANT_HIGH', method: 'RULE', statedTransaction: 'SALE' }), 'WRONG_TRANSACTION');
  assert.equal(hardGate({ campaign: 'SALE', intentClass: 'BUYER_HIGH', method: 'RULE', statedTransaction: 'SALE' }), null);
  assert.equal(hardGate({ campaign: 'RENT', intentClass: 'TENANT_MEDIUM', method: 'RULE', statedTransaction: null }), null);
});

test('real run 2026-10-04: two fresh Russian rental offers under SALE never qualify', () => {
  for (const text of ['Сдаётся 2-комнатная квартира в Сабуртало, 600$ в месяц', 'Сдам квартиру посуточно, центр Тбилиси']) {
    const facts = extractTextFacts(text);
    const intent = facts.stance === 'OFFER' ? 'SELLER' : classifyByRules(text, { campaign: 'SALE', kind: 'MESSAGE', parentSimilarity: null, parentStance: null }).intentClass;
    assert.equal(publicIntent(intent, facts.transaction), 'LANDLORD_SUPPLY', text);
    assert.equal(hardGate({ campaign: 'SALE', intentClass: intent, method: 'RULE', statedTransaction: facts.transaction }), 'WRONG_INTENT', text);
  }
});

test('undecided and supply/agent candidates are gated before ranking', () => {
  assert.equal(hardGate({ campaign: 'SALE', intentClass: null }), 'UNDECIDED');
  assert.equal(hardGate({ campaign: 'SALE', intentClass: 'UNCERTAIN', method: 'MODEL' }), 'UNDECIDED');
  assert.equal(hardGate({ campaign: 'SALE', intentClass: 'BUYER_HIGH', method: 'UNDECIDED' }), 'UNDECIDED');
  for (const c of ['AGENT', 'SELLER', 'OWNER', 'SERVICE_PROVIDER', 'NOISE', 'QUESTION']) {
    assert.equal(hardGate({ campaign: 'SALE', intentClass: c, method: 'RULE', statedTransaction: null }), 'WRONG_INTENT', c);
  }
});

test('dispositions reconcile: exactly one per candidate', () => {
  const d = emptyDispositions();
  assert.deepEqual(Object.keys(d), [...DISPOSITIONS]);
  d.WRONG_INTENT = 2; d.QUALIFIED = 1; d.STALE = 3;
  assert.ok(reconciles(d, 6));
  assert.ok(!reconciles(d, 7));
});
