// Qualification v7 (owner, 2026-10-17, live campaign 510dff8b): posts about 40–60 m² flats,
// smaller apartments and a developer's article were still shown for a 97 m², 3-room
// Krtsanisi apartment. Fixtures are the production texts (and close variants).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDemand, boundModelReading, statedArea } from '../findBuyers/demandClassifier.ts';
import { qualify, areaLevel, QUALIFICATION_VERSION } from '../findBuyers/qualify.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';

const DNA = buildPropertyDna({
  transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi',
  address: 'კრწანისის ქ. 6', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, floor: 7, totalFloors: 8,
});
const Q = (text) => qualify(classifyDemand(text, { kind: 'POST' }), DNA, { ageDays: 2 });

test('version 7 rules still hold under version 8', () => assert.ok(QUALIFICATION_VERSION >= 7));

test('stated size is read as a range in every language the campaigns read', () => {
  assert.deepEqual(statedArea('ვარანცოვზე 60 კვადრატამდე სურათები ჩამიყარეთ'), { min: null, max: 60, approx: false });
  assert.deepEqual(statedArea('ვყიდულობ 40 კვ.მ-მდე ბინას'), { min: null, max: 40, approx: false });
  assert.deepEqual(statedArea('Рассмотрю квартиры площадью от 60 до 70 м²'), { min: 60, max: 70, approx: false });
  assert.deepEqual(statedArea('კრწანისში 90-100 კვ.მ'), { min: 90, max: 100, approx: false });
  assert.deepEqual(statedArea('2 საძინებლით- 50კვ/მ ზე მეტი'), { min: 50, max: null, approx: false });
  assert.deepEqual(statedArea('an apartment with an area of about 80 square meters'), { min: 80, max: 80, approx: true });
  assert.equal(statedArea('ბიუჯეტი 60 ათასამდე'), null, 'money is never a size');
  assert.equal(statedArea('3 ოთახიანი ბინა'), null);
});

test('a size outside the property band is rejected; a fitting one is kept', () => {
  for (const t of [
    'გამარჯობათ ბინა ვის აქვს გასაყიდი იტალიურ ეზოში მარჯანიშვილზე , აღმაშენებელზე ორთაჭალაში , ვარანცოვზე 60 კვადრატამდე სურათები ჩამიყარეთ',
    'ვყიდულობ 40 კვ.მ-მდე ბინას კრწანისში',
    'Куплю квартиру в Крцаниси от 60 до 70 м²',
  ]) {
    const q = Q(t);
    assert.equal(q.category, 'REJECTED', t);
    assert.ok(q.reasons.includes('AREA_MISMATCH'), t);
  }
  const fit = Q('ვყიდულობ ბინას კრწანისში 90-100 კვ.მ, ბიუჯეტი 220 000$');
  assert.equal(fit.category, 'STRONG');
  assert.notEqual(Q('Hello. I’m looking to buy a property in Tbilisi, an apartment of about 80 square meters. Price is not an issue.').category, 'REJECTED', '80 m² approx overlaps 78–117');
  assert.equal(areaLevel(classifyDemand('buying a flat in krtsanisi around 100 sqm', { kind: 'POST' }), DNA), 'WITHIN');
});

test('a smaller home is not this property\'s buyer; one room more is near, two+ is not', () => {
  const small = Q('Need an apartment near goodwill 1bhk');
  assert.equal(small.category, 'REJECTED');
  assert.ok(small.reasons.includes('ROOMS_MISMATCH'));
  assert.ok(Q('ვეძებ დასრულებულ ბინას კრწანისში ორ ოთახიანს').reasons.includes('ROOMS_MISMATCH'), '2 rooms for a 3-room flat');
  assert.notEqual(Q('ვეძებ 4 ოთახიან ბინას კრწანისში').category, 'REJECTED', 'one room more is near');
  assert.ok(Q('ვეძებ 5 ოთახიან ბინას კრწანისში').reasons.includes('ROOMS_MISMATCH'));
  assert.notEqual(Q('2 საძინებლით ბინას ვინც ყიდით დამიკავშირდით').category, 'REJECTED', 'same bedrooms, asks sellers: a buyer');
});

test('the model never makes a seeker of a text with no wish to buy (developer article)', () => {
  const text = '🏙 Biograpi Living: что строит застройщик в Тбилиси? У Biograpi нет одного «типового» комплекса. Проекты разные: от камерного дома на 44 квартиры до высотных комплексов с бассейном.';
  const rule = classifyDemand(text, { kind: 'POST' });
  assert.equal(rule.role, 'UNCLEAR');
  const bound = boundModelReading(rule, { role: 'BUY_SEEKER', transaction: 'BUY' });
  assert.equal(bound.role, 'UNCLEAR');
  assert.equal(qualify(bound, DNA, { ageDays: 2 }).category, 'REJECTED');
  /* A first-person seeker whose buy-or-rent the model settles is still resolved. */
  const seeker = classifyDemand('ვეძებ ბინას 3ოთახიანს კრწანისში', { kind: 'POST' });
  assert.notEqual(boundModelReading(seeker, { role: 'BUY_SEEKER', transaction: 'BUY' }).role, 'UNCLEAR');
});
