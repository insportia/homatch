// SIGNAL CLASSIFICATION BY RULES (classify-signals-v2, owner 2026-10-29): what the six-language
// rules decide without a model, what they leave AMBIGUOUS, and the intent profile they write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleSignalVerdict, RULE_DEMAND_MIN_CONFIDENCE, SIGNAL_RULES_VERSION } from '../discovery/signalRules.ts';
import { discoveryLabelFor, DEMAND_LABELS } from '../discovery/signal-taxonomy.ts';

const demand = (text) => {
  const v = ruleSignalVerdict(text);
  assert.equal(v.decision, 'DEMAND', `${text} → ${JSON.stringify(v)}`);
  return v.profile;
};

test('a confident seeker in each of the six languages is demand, with facts read in canonical spellings', () => {
  const ka = demand('ვეძებ 2 საძინებლიან ბინას ვაკეში $200,000-მდე');
  assert.equal(ka.intentType, 'BUY');
  assert.equal(ka.transactionType, 'SALE');
  assert.equal(ka.city, 'Tbilisi');
  assert.equal(ka.district, 'Vake');
  assert.equal(ka.bedroomsMin, 2);
  assert.equal(ka.budgetMax, 200000);
  assert.equal(ka.currency, 'USD');
  assert.deepEqual(ka.propertyTypes, ['APARTMENT']);
  const ru = demand('Ищу квартиру в аренду в Батуми до 600$');
  assert.equal(ru.intentType, 'RENT');
  assert.equal(ru.transactionType, 'RENT');
  assert.equal(ru.city, 'Batumi');
  assert.equal(demand('Looking to buy a house in Tbilisi, budget 150k USD').propertyTypes[0], 'HOUSE');
  assert.equal(demand('أبحث عن شقة للإيجار في تبليسي').intentType, 'RENT');
  assert.equal(demand('Kiralık daire arıyorum Batum').city, 'Batumi');
  const he = demand('אני רוצה לקנות דירה בבטומי עד 100,000 דולר');
  assert.equal(he.intentType, 'BUY');
  assert.equal(he.budgetMax, 100000);
  for (const p of [ka, ru]) {
    assert.ok(p.intentConfidence >= RULE_DEMAND_MIN_CONFIDENCE);
    assert.ok(p.specificityScore >= 0 && p.specificityScore <= 1);
    assert.ok(p.actionabilityScore >= 0 && p.actionabilityScore <= 1);
  }
});

test('a rule demand profile lands on a demand label that routes to matching', () => {
  const p = demand('ვეძებ 2 საძინებლიან ბინას ვაკეში $200,000-მდე');
  const label = discoveryLabelFor({ intentType: p.intentType, transactionType: p.transactionType, confidence: p.intentConfidence, agencyVoice: false, direction: null });
  assert.ok(DEMAND_LABELS.has(label), label);
});

test('offers, agencies and off-topic posts are decided as not demand — never sent to a model', () => {
  const offer = ruleSignalVerdict('Сдаётся 2-комнатная квартира в Ваке, 700$');
  assert.equal(offer.decision, 'NOT_DEMAND');
  assert.equal(offer.intentType, 'PROPERTY_AD');
  assert.equal(offer.transactionType, 'RENT');
  assert.equal(ruleSignalVerdict('იყიდება 3 ოთახიანი ბინა კრწანისში').intentType, 'PROPERTY_AD');
  const broker = ruleSignalVerdict('I have a client who wants to buy a 3-room apartment in Krtsanisi');
  assert.equal(broker.decision, 'NOT_DEMAND');
  assert.equal(broker.intentType, 'AGENT_AD', 'an intermediary is a broker lead, never demand');
  assert.equal(ruleSignalVerdict('Куплю U.S.D.T за наличные').intentType, 'NOISE');
  assert.equal(ruleSignalVerdict('How do I pass the AWS certification?').intentType, 'NOISE');
  assert.equal(ruleSignalVerdict('').decision, 'NOT_DEMAND');
});

test('what the rules cannot decide is AMBIGUOUS — never promoted to demand', () => {
  for (const text of ['3 ოთახიანი ბინა კრწანისში', 'Квартира в Крцаниси, 3 комнаты', 'ვეძებ ბინას კრწანისში', 'My brother is looking to buy an apartment in Tbilisi']) {
    const v = ruleSignalVerdict(text);
    assert.equal(v.decision, 'AMBIGUOUS', `${text} → ${JSON.stringify(v)}`);
    assert.equal(v.version, SIGNAL_RULES_VERSION);
    assert.ok(v.evidence.length > 0, 'the reason is kept');
  }
});

test('deterministic: the same text gives the same verdict', () => {
  const t = 'Ищу квартиру в аренду в Батуми до 600$';
  assert.deepEqual(ruleSignalVerdict(t), ruleSignalVerdict(t));
});
