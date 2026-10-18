// Listing comparability (owner, 2026-10-17, campaign a53b3b5a): competitor listings in other
// markets — a 52 m² $74k Varketili flat, a 36 m² $42k Avlabari flat — scored 55–58 against a
// 97 m² $214k Krtsanisi flat and were shown as research opportunities. Texts are production's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSimilarity, MARKET_CAP, DEFAULT_COMMENT_GATE } from '../findBuyers/similarity.ts';
import { extractTextFacts } from '../findBuyers/textFacts.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';

const DNA = buildPropertyDna({
  transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi',
  address: 'კრწანისის ქ. 6', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, floor: 7, totalFloors: 8,
});
const score = (text) => scoreSimilarity(DNA, extractTextFacts(text), { ageDays: 1 });

test('another market is capped under the comment gate floor', () => {
  assert.ok(MARKET_CAP < DEFAULT_COMMENT_GATE.skipBelow);
  const varketili = score('🚨🔥 იყიდება სასწრაფოდ ბინა ვარკეთილში — $74,000! 📍 ადგილმდებარეობა: ვარკეთილის ხიდებთან ახლოს 📐 ფართობი: 52 მ²');
  assert.ok(varketili.score <= MARKET_CAP, `Varketili ${varketili.score}`);
  assert.deepEqual(varketili.farFrom.sort(), ['area', 'district', 'price']);
  const avlabari = score('🌟იყიდება 2-ოთახიანი ბინა ავლაბარში 📍მდებარეობა: იზაშვილის ქუჩა 📐ფართი: 36 კვ.მ 💰ფასი: 42,000$');
  assert.ok(avlabari.score <= MARKET_CAP, `Avlabari ${avlabari.score}`);
  const saburtalo = score('‼️იყიდება უკარგესი ბინა‼️218 000$ საბურთალო, ყაზბეგის გამზ.‼️120კვ ბინა. ორი ნათელი საძინებლით');
  assert.ok(saburtalo.score <= MARKET_CAP, 'a far district alone is another market');
});

test('the same or a neighbouring district with a comparable flat stays eligible', () => {
  const ortachala = score('იყიდება ბინა თბილისში📢 ორთაჭალა✅️ ვ.გორგასლის 105✅️ 85 კვადრატი✅️ 2 ნათელი საძინებელი');
  assert.ok(ortachala.score >= DEFAULT_COMMENT_GATE.skipBelow, `Ortachala ${ortachala.score}`);
  assert.deepEqual(ortachala.farFrom, []);
  const sololaki = score('🏡 იყიდება ბინა სოლოლაკში — იაშვილის ქუჩაზე! 📐 ფართობი: 65.60 მ²');
  assert.ok(sololaki.score >= DEFAULT_COMMENT_GATE.skipBelow, `Sololaki ${sololaki.score}`);
});

test('unstated facts never trigger the cap', () => {
  const r = score('იყიდება ბინა თბილისში, 2 საძინებელი');
  assert.deepEqual(r.farFrom, []);
});

test('Georgian area units: მ², კვადრატი, a bare კვ — but not კვირა (week)', () => {
  assert.equal(extractTextFacts('ფართობი: 52 მ²').areaSqm, 52);
  assert.equal(extractTextFacts('85 კვადრატი').areaSqm, 85);
  assert.equal(extractTextFacts('120კვ ბინა').areaSqm, 120);
  assert.equal(extractTextFacts('50 კვ ბინა').areaSqm, 50);
  assert.equal(extractTextFacts('10 კვირა').areaSqm, null);
});
