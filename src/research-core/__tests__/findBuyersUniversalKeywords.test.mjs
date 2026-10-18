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

/* ── qualification v9: the subtype a seeker states ─────────────────────── */
import { qualify, subtypeFit, QUALIFICATION_VERSION } from '../findBuyers/qualify.ts';
const ctx = { ageDays: 2, duplicate: false };
const prop = (tx, type, title) => buildPropertyDna({ transactionType: tx, propertyType: type, city: 'Tbilisi', district: 'Vake', totalPrice: 2000, currency: 'USD', area: 120, title });

test('v9: an office tenant is not a warehouse tenant; a warehouse one is', () => {
  assert.ok(QUALIFICATION_VERSION >= 9);
  const wh = prop('RENT', 'COMMERCIAL', 'საწყობი warehouse');
  const office = classifyDemand('ვეძებ ოფისს ქირით ვაკეში');
  assert.equal(subtypeFit(office, wh), 'CONFLICT');
  const q = qualify(office, wh, ctx);
  assert.equal(q.category, 'REJECTED');
  assert.ok(q.reasons.includes('PROPERTY_TYPE_MISMATCH'));
  const store = classifyDemand('сниму склад в Ваке');
  assert.equal(subtypeFit(store, wh), 'MATCH');
  assert.notEqual(qualify(store, wh, ctx).category, 'REJECTED');
});

test('v9: unstated subtype stays unknown — never a mismatch, never a confirmation', () => {
  const office = prop('RENT', 'OFFICE', null);
  const generic = classifyDemand('ვეძებ კომერციულ ფართს ქირით ვაკეში');
  assert.equal(subtypeFit(generic, office), 'UNKNOWN');
  assert.ok(!qualify(generic, office, ctx).reasons.includes('PROPERTY_TYPE_MISMATCH'));
  const genericProp = prop('RENT', 'COMMERCIAL', null);
  assert.equal(subtypeFit(classifyDemand('ищу офис в аренду Ваке'), genericProp), 'UNKNOWN');
});

test('v9: a house/land subtype difference is kept but never Strong', () => {
  const villa = prop('SALE', 'VILLA', null);
  const r = classifyDemand('куплю коттедж в Ваке до 2500$');
  assert.equal(subtypeFit(r, villa), 'SOFT');
  const q = qualify(r, villa, ctx);
  assert.notEqual(q.category, 'STRONG');
  if (q.category !== 'REJECTED') assert.ok(q.limitations.includes('SUBTYPE_DIFFERS'));
  assert.ok(!q.reasons.includes('PROPERTY_TYPE_MISMATCH'));
});

test('v9: a seeker naming several subtypes matches if one is the property\'s', () => {
  const office = prop('RENT', 'OFFICE', null);
  assert.equal(subtypeFit(classifyDemand('looking to rent an office or shop in Vake'), office), 'MATCH');
});

/* ── provenance: which phrase a lead answers ───────────────────────────── */
import { queriesMatchingText } from '../findBuyers/leadScore.ts';
test('provenance: the phrases a post answers are recorded, never invented', () => {
  const qs = ['looking to rent an office in Vake', 'сниму склад Сабуртало', 'ვეძებ საწყობს ქირით საბურთალოზე'];
  assert.deepEqual(queriesMatchingText(qs, 'Hi all, I need to rent an office in Vake, ~100 sqm'), ['looking to rent an office in Vake']);
  assert.deepEqual(queriesMatchingText(qs, 'Сниму склад на Сабуртало, 300 м2'), ['сниму склад Сабуртало']);
  assert.deepEqual(queriesMatchingText(qs, 'selling my car'), []);
});

/* ── v10: one taxonomy, tiers, family-aware group and listing searches, full DNA ───────── */
import { SUBTYPES, FAMILY_BUY as FB, FAMILY_RENT as FR, subtypeRelation } from '../findBuyers/propertyFamily.ts';
import { queriesFor } from '../findBuyers/queryPlanner.ts';
import { sanitizeListingText } from '../findBuyers/propertyDna.ts';

test('taxonomy: every subtype noun, in every language and both transactions, reads as a seeker of that family and subtype', () => {
  const place = { ka: 'თბილისში', ru: 'Тбилиси', en: 'Tbilisi', ar: 'تبليسي', he: 'טביליסי', tr: 'Tiflis' };
  let n = 0;
  for (const d of SUBTYPES) for (const lang of SIX) for (const [tx, T] of [['BUY', FB], ['RENT', FR]]) for (const f of T[lang]) {
    const q = f({ noun: d.noun[lang], place: place[lang], city: place[lang] }); n++;
    const r = classifyDemand(q);
    assert.equal(r.role, tx === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER', q);
    assert.equal(r.propertyType, d.family, q);
    assert.ok((r.subtypes ?? []).includes(d.key), `${q} → ${r.subtypes}`);
  }
  assert.ok(SUBTYPES.length >= 20 && n >= 480);
});

test('taxonomy: material contradictions are hard only where they are material', () => {
  assert.equal(subtypeRelation('WAREHOUSE', ['OFFICE']), 'CONFLICT');
  assert.equal(subtypeRelation('WAREHOUSE', ['INDUSTRIAL']), 'MATCH');
  assert.equal(subtypeRelation('RETAIL', ['FOOD']), 'SOFT', 'street-level premises are near');
  assert.equal(subtypeRelation('HOTEL', ['RETAIL']), 'CONFLICT');
  assert.equal(subtypeRelation('AGRICULTURAL', ['INDUSTRIAL_LAND']), 'CONFLICT');
  assert.equal(subtypeRelation('VILLA', ['COTTAGE']), 'SOFT');
  assert.equal(subtypeRelation('PENTHOUSE', ['STUDIO']), 'SOFT');
  assert.equal(subtypeRelation('OFFICE', []), 'UNKNOWN');
  assert.equal(subtypeRelation(null, ['OFFICE']), 'UNKNOWN');
  assert.equal(propertySubtype('PENTHOUSE', null), 'PENTHOUSE');
  assert.equal(propertySubtype('COMMERCIAL', 'სასტუმრო 12 ნომრით'), 'HOTEL');
  assert.equal(propertySubtype('COMMERCIAL', 'Помещение под кафе на Руставели'), 'FOOD');
  assert.equal(propertySubtype('LAND', 'Commercial land plot near the highway'), 'COMMERCIAL_LAND');
});

const plan3 = (tx, type, title, area = 300) => {
  const dna = buildPropertyDna({ transactionType: tx, propertyType: type, city: 'Tbilisi', district: 'Saburtalo', totalPrice: 2500, currency: 'USD', area, title });
  const strategy = buildBuyerStrategy({ dna, segment: null, providerBudgetMicros: 20_000_000, targetLanguages: null });
  return { dna, strategy, plan: buildQueryPlan(dna, undefined, strategy) };
};

test('search tiers: EXACT first, then semantic / near / size; a warehouse is never broadened to "commercial space"', () => {
  const { strategy } = plan3('RENT', 'COMMERCIAL', 'საწყობი warehouse');
  for (const lang of SIX) {
    const own = strategy.queries.filter((q) => q.language === lang);
    assert.ok(own.length > 0, lang);
    assert.equal(own[0].tier, 'EXACT', lang);
    for (const q of own) assert.doesNotMatch(q.query, /კომერციულ ფართ|коммерческое помещение|commercial space|שטח מסחרי|işyeri/iu, q.query);
  }
  assert.ok(strategy.queries.some((q) => q.tier === 'SIZE' && /300/.test(q.query)), 'a size-tier phrase for a sized warehouse');
  assert.ok(strategy.queries.every((q) => q.tier), 'every strategy phrase has a tier');
});

test('group and comparable-listing searches name the property\'s own market, never apartments', () => {
  for (const [tx, type, title] of [['RENT', 'COMMERCIAL', 'საწყობი'], ['SALE', 'LAND', 'სასოფლო-სამეურნეო მიწა'], ['SALE', 'VILLA', null], ['RENT', 'OFFICE', null]]) {
    const { plan } = plan3(tx, type, title);
    for (const lang of SIX) {
      const qs = [...queriesFor(plan, 'community', lang), ...queriesFor(plan, 'listing', lang)];
      assert.ok(qs.length > 0, `${type} ${lang}`);
      for (const q of qs) assert.doesNotMatch(q.query, APARTMENT_WORDS, `${type} ${lang}: ${q.query}`);
    }
  }
  const apt = plan3('SALE', 'APARTMENT', null, 80).plan;
  assert.ok(queriesFor(apt, 'community', 'ka').some((q) => /ბინ/.test(q.query)), 'apartments keep their groups');
});

test('a studio or penthouse is asked for by name first; more phrases never mean more per-language queries', () => {
  const { strategy } = plan3('SALE', 'PENTHOUSE', null, 180);
  const ka = strategy.queries.filter((q) => q.language === 'ka');
  assert.match(ka[0].query, /პენტჰაუს/);
  for (const lang of SIX) assert.ok(strategy.queries.filter((q) => q.language === lang).length <= strategy.depth.queriesPerLanguage);
});

test('Property DNA keeps every stored attribute it is given, unknown stays unknown, contact never survives', () => {
  const dna = buildPropertyDna({
    transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', title: 'ბინა ვაკეში', bathrooms: 2, totalFloors: 12, constructionStatus: 'NEW',
    heating: 'CENTRAL', security: true, yard: false, airConditioning: true, features: ['view', 'view', 'storage'], sourceLanguage: 'KA',
    description: 'მშვენიერი ბინა, დარეკეთ +995 555 12 34 56 ან mail@x.ge, www.example.ge',
  });
  assert.equal(dna.bathrooms, 2); assert.equal(dna.totalFloors, 12); assert.equal(dna.constructionStatus, 'NEW');
  assert.deepEqual(dna.features, ['view', 'storage']);
  assert.ok(dna.amenities.includes('security') && dna.amenities.includes('air_conditioning') && !dna.amenities.includes('yard'));
  assert.equal(dna.sourceLanguage, 'ka');
  assert.doesNotMatch(dna.descriptionExcerpt, /555|mail@|example/);
  const bare = buildPropertyDna({ transactionType: 'SALE', propertyType: 'LAND', city: 'Tbilisi' });
  assert.equal(bare.bathrooms, null); assert.equal(bare.descriptionExcerpt, null); assert.deepEqual(bare.features, []);
  assert.equal(sanitizeListingText('call 599123456 now'), 'call now');
});
