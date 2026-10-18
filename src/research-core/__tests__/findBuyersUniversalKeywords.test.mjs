// FIND BUYERS — universal keyword intelligence (owner, 2026-10-18): every property type and
// subtype gets its own buyer/tenant phrases in six languages — never apartment words for a
// house, land plot, office or warehouse, never a seller phrasing. Pure: no network, no Actor run.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPropertyDna, dnaKeyOf } from '../findBuyers/propertyDna.ts';
import { buildQueryPlan } from '../findBuyers/queryPlanner.ts';
import { buildBuyerStrategy } from '../findBuyers/buyerStrategy.ts';
import { classifyDemand } from '../findBuyers/demandClassifier.ts';
import { keywordSearchPhrases } from '../findBuyers/campaignPlan.ts';
import { propertySubtype, propertyNoun, SUBTYPE_NOUN } from '../findBuyers/propertyFamily.ts';

const SIX = ['ka', 'ru', 'en', 'ar', 'he', 'tr'];
const APARTMENT_WORDS = /ბინ|квартир|apartment|flat\b|شقة|דיר|daire/iu;
const CASES = [
  ['SALE', 'HOUSE', null, null, 'HOUSE'],
  ['SALE', 'VILLA', null, 'VILLA', 'HOUSE'],
  ['SALE', 'HOUSE', 'აგარაკი / cottage', 'COTTAGE', 'HOUSE'],
  ['SALE', 'LAND', null, null, 'LAND'],
  ['SALE', 'LAND', 'სასოფლო-სამეურნეო მიწის ნაკვეთი', 'AGRICULTURAL', 'LAND'],
  ['RENT', 'OFFICE', null, 'OFFICE', 'COMMERCIAL'],
  ['RENT', 'COMMERCIAL', 'მაღაზია / retail shop', 'RETAIL', 'COMMERCIAL'],
  ['RENT', 'COMMERCIAL', 'საწყობი warehouse', 'WAREHOUSE', 'COMMERCIAL'],
  ['SALE', 'COMMERCIAL', null, null, 'COMMERCIAL'],
];
const phrasesFor = (tx, type, title, withStrategy = true) => {
  const dna = buildPropertyDna({ transactionType: tx, propertyType: type, city: 'Tbilisi', district: 'Vake', totalPrice: 300000, currency: 'USD', area: 400, title });
  const strategy = withStrategy ? buildBuyerStrategy({ dna, segment: null, providerBudgetMicros: 6_300_000, targetLanguages: null }) : undefined;
  return { dna, phrases: keywordSearchPhrases(buildQueryPlan(dna, undefined, strategy), tx, SIX) };
};

for (const [tx, type, title, subtype, family] of CASES) {
  test(`${tx} ${type}${title ? ` (${subtype})` : ''}: seeker phrases in all six languages, no apartment words`, () => {
    for (const withStrategy of [true, false]) {
      const { dna, phrases } = phrasesFor(tx, type, title, withStrategy);
      assert.equal(dna.family, family);
      assert.equal(dna.subtype ?? null, subtype);
      for (const lang of SIX) assert.ok(phrases.some((p) => p.language === lang), `${lang} missing (strategy=${withStrategy})`);
      for (const { query } of phrases) {
        assert.doesNotMatch(query, APARTMENT_WORDS, query);
        assert.equal(classifyDemand(query).role, tx === 'RENT' ? 'RENT_SEEKER' : 'BUY_SEEKER', query);
        assert.doesNotMatch(query, /^(looking to buy|looking to rent|want to buy|want to rent|need|ვეძებ|ვყიდულობ|куплю|сниму|ищу)\s+(looking|want|need|ვეძებ|ვყიდულობ|куплю|сниму|ищу)\b/iu, query);
        assert.doesNotMatch(query, /\ba [aeiou]/i, query);
      }
      if (subtype) for (const lang of SIX) assert.ok(phrases.some((p) => p.language === lang && p.query.includes(SUBTYPE_NOUN[subtype][lang])), `${lang} lacks the ${subtype} noun`);
      assert.equal(new Set(phrases.map((p) => `${p.language}:${p.query.toLowerCase()}`)).size, phrases.length, 'duplicate phrase');
    }
  });
}

test('every subtype noun still reads as its family to the demand classifier', () => {
  const expected = { VILLA: 'HOUSE', COTTAGE: 'HOUSE', OFFICE: 'COMMERCIAL', RETAIL: 'COMMERCIAL', WAREHOUSE: 'COMMERCIAL', INDUSTRIAL: 'COMMERCIAL', AGRICULTURAL: 'LAND' };
  for (const [subtype, fam] of Object.entries(expected)) {
    assert.equal(propertyNoun(fam, subtype, 'en'), SUBTYPE_NOUN[subtype].en);
    for (const [lang, verb] of [['ka', 'ვყიდულობ'], ['ru', 'куплю'], ['en', 'looking to buy']]) {
      const r = classifyDemand(`${verb} ${SUBTYPE_NOUN[subtype][lang]} Tbilisi`);
      assert.equal(r.propertyType, fam, `${subtype} ${lang}`);
    }
  }
});

test('a subtype only narrows the words: the stored type, family matching and existing DNA keys stay', () => {
  assert.equal(propertySubtype('APARTMENT', 'ბინა ვაკეში'), null);
  assert.equal(propertySubtype('HOUSE', 'საწყობი'), null, 'a house titled "warehouse" stays a house');
  const apt = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', totalPrice: 100000, currency: 'USD', area: 60 });
  assert.doesNotMatch(dnaKeyOf(apt), /:VILLA|:OFFICE|:WAREHOUSE/);
  const villa = buildPropertyDna({ transactionType: 'SALE', propertyType: 'VILLA', city: 'Tbilisi', totalPrice: 900000, currency: 'USD', area: 400 });
  assert.doesNotMatch(dnaKeyOf(villa), /VILLA:VILLA/);
});

test('apartments are unchanged: still apartment seekers, still capped per language', () => {
  const { phrases } = phrasesFor('SALE', 'APARTMENT', null);
  assert.ok(phrases.length > 0 && phrases.length <= 3 * 3 + 2 * 3);
  for (const { query } of phrases) assert.equal(classifyDemand(query).role, 'BUY_SEEKER', query);
});
