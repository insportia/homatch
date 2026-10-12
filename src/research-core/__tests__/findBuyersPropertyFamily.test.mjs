// ALL PROPERTY TYPES, ONE ENGINE (2026-10-12).
//
// Every phrase the engine searched with was an apartment phrase and the type gate only
// compared HOUSE vs APARTMENT: a land plot or a shop was searched with apartment
// queries and an apartment seeker matched to it stayed a WEAK lead. Parking had no
// family at all. Each family now gets its own noun in all six languages, every search
// phrase still reads as an explicit seeker of the campaign's side, and the type gate
// rejects the wrong family.
import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyFamily, FAMILY_NOUN } from '../findBuyers/propertyFamily.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { buildBuyerStrategy } from '../findBuyers/buyerStrategy.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { qualify } from '../findBuyers/qualify.ts';

const base = { countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', currency: 'USD' };
const dnaOf = (over) => buildPropertyDna({ ...base, ...over });
const strategyOf = (dna) => buildBuyerStrategy({ dna, segment: null, providerBudgetMicros: 20_000_000, targetLanguages: null });

test('the family of every stored property type; parking is read from an OTHER listing title', () => {
  assert.equal(propertyFamily('APARTMENT'), 'APARTMENT');
  assert.equal(propertyFamily('STUDIO'), 'APARTMENT');
  assert.equal(propertyFamily('PENTHOUSE'), 'APARTMENT');
  assert.equal(propertyFamily('VILLA'), 'HOUSE');
  assert.equal(propertyFamily('TOWNHOUSE'), 'HOUSE');
  assert.equal(propertyFamily('LAND'), 'LAND');
  assert.equal(propertyFamily('OFFICE'), 'COMMERCIAL');
  assert.equal(propertyFamily('OTHER', 'იყიდება პარკინგის ადგილი ვაკეში'), 'PARKING');
  assert.equal(propertyFamily('OTHER', 'Продаётся машиноместо'), 'PARKING');
  assert.equal(propertyFamily('APARTMENT', '2-bedroom apartment with parking'), 'APARTMENT', 'an apartment with parking is an apartment');
  assert.equal(dnaOf({ transactionType: 'SALE', propertyType: 'OTHER', title: 'Garage for sale' }).family, 'PARKING');
});

for (const [family, propertyType, title] of [['LAND', 'LAND', null], ['COMMERCIAL', 'COMMERCIAL', null], ['HOUSE', 'HOUSE', null], ['PARKING', 'OTHER', 'Parking space']]) {
  for (const tx of ['SALE', 'RENT']) {
    test(`${family} ${tx}: its own noun in all six languages, and every phrase reads as a ${tx === 'SALE' ? 'buyer' : 'tenant'}`, () => {
      const dna = dnaOf({ transactionType: tx, propertyType, title, totalPrice: tx === 'SALE' ? 90000 : 900, area: 120 });
      assert.equal(dna.family, family);
      const s = strategyOf(dna);
      const langs = new Set(s.queries.map((q) => q.language));
      assert.equal(langs.size, 6, `six languages: ${[...langs]}`);
      for (const q of s.queries) {
        assert.ok(q.query.includes(FAMILY_NOUN[family][q.language]), `${q.language}: "${q.query}" names a ${family}`);
        assert.doesNotMatch(q.query, /ბინას|квартиру|apartment|שקה|דירה|daire/i, `${q.language}: "${q.query}" is not an apartment phrase`);
        const r = classifyDemand(q.query);
        assert.equal(r.role, tx === 'SALE' ? 'BUY_SEEKER' : 'RENT_SEEKER', `${q.language}: "${q.query}" → ${r.role}`);
      }
      const plan = buildQueryPlan(dna, undefined, s);
      assert.ok(plan.queries.some((q) => q.kind === 'demand'));
    });
  }
}

test('apartments keep the apartment phrasings', () => {
  const s = strategyOf(dnaOf({ transactionType: 'SALE', propertyType: 'APARTMENT', totalPrice: 213840, area: 97, rooms: 3, bedrooms: 2 }));
  assert.ok(s.queries.some((q) => q.language === 'ka' && /ბინ/.test(q.query)));
  assert.ok(s.queries.some((q) => q.language === 'ru' && /квартир/.test(q.query)));
});

test('the type gate rejects the wrong family: an apartment seeker is not a lead for land, a shop or parking', () => {
  const apartmentSeeker = classifyDemand('Куплю 2-комнатную квартиру в Тбилиси, бюджет 90 000$');
  for (const [propertyType, title] of [['LAND', null], ['COMMERCIAL', null], ['OTHER', 'Parking space']]) {
    const q = qualify(apartmentSeeker, dnaOf({ transactionType: 'SALE', propertyType, title, totalPrice: 90000, area: 120 }), { ageDays: 1 });
    assert.equal(q.category, 'REJECTED', `${propertyType}: ${JSON.stringify(q.rejectionReasons ?? q.reasons)}`);
  }
});

test('a parking seeker is a parking lead; "apartment with parking" stays an apartment seeker', () => {
  const parking = classifyDemand('Куплю парковочное место в Тбилиси');
  assert.equal(parking.role, 'BUY_SEEKER');
  assert.equal(parking.propertyType, 'PARKING');
  const q = qualify(parking, dnaOf({ transactionType: 'SALE', propertyType: 'OTHER', title: 'Parking space', totalPrice: 15000 }), { ageDays: 1 });
  assert.notEqual(q.category, 'REJECTED', JSON.stringify(q));
  assert.equal(classifyDemand('Куплю 2-комнатную квартиру с парковкой в Тбилиси').propertyType, 'APARTMENT');
});

test('a land seeker matches land, and is rejected for an apartment', () => {
  const land = classifyDemand('ვყიდულობ მიწის ნაკვეთს თბილისში');
  assert.equal(land.role, 'BUY_SEEKER');
  assert.equal(land.propertyType, 'LAND');
  assert.notEqual(qualify(land, dnaOf({ transactionType: 'SALE', propertyType: 'LAND', totalPrice: 90000 }), { ageDays: 1 }).category, 'REJECTED');
  assert.equal(qualify(land, dnaOf({ transactionType: 'SALE', propertyType: 'APARTMENT', totalPrice: 213840 }), { ageDays: 1 }).category, 'REJECTED');
});
