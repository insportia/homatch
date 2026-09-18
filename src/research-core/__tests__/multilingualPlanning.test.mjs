// A job typed in English must not be researched only in English.
//
// The people a Tbilisi broker wants are writing "ვეძებ ბინას", "ищу квартиру"
// and "Tiflis'te daire arıyorum". None of those contains an English word, so
// a plan built from the job's own language finds none of them — and finds it
// silently, returning a confident, empty, plausible result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  planQueries,
  acceptancePhrases,
} from '../discovery/query-plan.ts';
import {
  RESEARCH_LANGUAGES,
  LEXICON,
  languagesForMarket,
  allPhrases,
  isResearchLanguage,
} from '../discovery/lexicon.ts';

const TBILISI = {
  countryCode: 'GE',
  city: 'Tbilisi',
  district: 'Krtsanisi',
  propertyTerms: ['apartment'],
  transaction: 'SALE',
};

test('the seven research languages are present, including Hindi for discovery', () => {
  assert.deepEqual([...RESEARCH_LANGUAGES].sort(), ['ar', 'en', 'ka', 'he', 'hi', 'ru', 'tr'].sort());
  assert.equal(isResearchLanguage('hi'), true);
  assert.equal(isResearchLanguage('zz'), false);
});

test('Hindi is discovery-only and is deliberately NOT a product locale', () => {
  // The product renders six locales; research reaches seven. `hi` is in the
  // lexicon and not in SupportedLanguage, and that asymmetry is exactly why
  // the two lists are separate rather than one derived from the other.
  const types = readFileSync(join(process.cwd(), 'src/types/types.ts'), 'utf8');
  const declared = types.match(/export type SupportedLanguage = ([^;]+);/);
  assert.ok(declared, 'SupportedLanguage is no longer declared where this test looks');

  const locales = [...declared[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]).sort();
  assert.deepEqual(locales, ['ar', 'en', 'he', 'ka', 'ru', 'tr']);
  assert.ok(!locales.includes('hi'), 'hi is a product locale now — update the note in lexicon.ts');

  // Every product locale must still be researchable, or a customer could ask
  // in a language the engine has no vocabulary to search in.
  for (const locale of locales) {
    assert.ok(
      RESEARCH_LANGUAGES.includes(locale),
      `${locale} is a UI locale with no research lexicon`,
    );
  }
});

test('every language carries every phrase bucket, with real content', () => {
  const buckets = ['wantToBuy', 'wantToRent', 'wantToInvest', 'relocating', 'forSale', 'forRent', 'budget', 'agency'];
  for (const language of RESEARCH_LANGUAGES) {
    const lexicon = LEXICON[language];
    for (const bucket of buckets) {
      assert.ok(Array.isArray(lexicon[bucket]), `${language}.${bucket} missing`);
      assert.ok(lexicon[bucket].length >= 2, `${language}.${bucket} has ${lexicon[bucket].length} entries`);
    }
    for (const term of ['apartment', 'house', 'land', 'commercial', 'property']) {
      assert.ok(lexicon.propertyTypes[term]?.length >= 1, `${language}.propertyTypes.${term} missing`);
    }
  }
});

test('every phrase is lowercase, so the matcher can stay uniform across scripts', () => {
  for (const language of RESEARCH_LANGUAGES) {
    for (const bucket of ['wantToBuy', 'wantToRent', 'forSale', 'forRent']) {
      for (const phrase of LEXICON[language][bucket]) {
        assert.equal(phrase, phrase.toLowerCase(), `${language}: "${phrase}"`);
      }
    }
  }
});

test('a Georgian market is planned in seven languages, not one', () => {
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 60 });
  const used = new Set(plan.queries.map((query) => query.language));
  assert.ok(used.size >= 6, `only ${used.size} languages were used: ${[...used].join(',')}`);
  assert.ok(used.has('ka'), 'no Georgian queries for a Georgian market');
  assert.ok(used.has('ru'), 'no Russian queries for a Georgian market');
});

test('the market decides the languages, not the job author', () => {
  assert.ok(languagesForMarket('GE').includes('ka'));
  assert.ok(languagesForMarket('IL').includes('he'));
  assert.ok(languagesForMarket('AE').includes('ar'));
  // An unknown market is not a reason to search in one language.
  assert.ok(languagesForMarket('ZZ').length >= 2);
});

test('a small budget still reaches every language rather than exhausting one', () => {
  // Losing a language completely is losing a population; losing depth in all
  // of them is losing some results. The interleave is what makes that trade.
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 7 });
  const used = new Set(plan.queries.map((query) => query.language));
  assert.equal(plan.queries.length, 7);
  assert.equal(used.size, 7, `${used.size} languages in 7 queries`);
});

test('DEMAND and SUPPLY are different searches, not one search filtered later', () => {
  const demand = planQueries(TBILISI, 'DEMAND', { maxQueries: 40 });
  const supply = planQueries(TBILISI, 'SUPPLY', { maxQueries: 40 });

  const demandTexts = new Set(demand.queries.map((q) => q.text));
  for (const query of supply.queries) {
    assert.ok(!demandTexts.has(query.text), `"${query.text}" appears in both plans`);
  }
  // And each is built from its own side's vocabulary.
  assert.ok(demand.queries.some((q) => q.text.includes('looking to buy')));
  assert.ok(supply.queries.some((q) => q.text.includes('for sale')));
  assert.ok(supply.queries.some((q) => q.text.includes('იყიდება')));
});

test('the plan is semantic, not a literal translation of one phrase', () => {
  // "looking to buy" in Georgian is not a word-for-word rendering, and a
  // planner that produced one would find nothing.
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 200 });
  const georgian = plan.queries.filter((q) => q.language === 'ka').map((q) => q.text);
  assert.ok(georgian.some((text) => text.includes('ვეძებ საყიდლად')));
  assert.ok(georgian.some((text) => text.includes('ბინა')));
});

test('a rent job plans rent phrasings and a sale job does not', () => {
  const rent = planQueries({ ...TBILISI, transaction: 'RENT' }, 'DEMAND', { maxQueries: 60 });
  const intents = new Set(rent.queries.map((q) => q.intent));
  assert.ok(intents.has('WANT_TO_RENT'));
  assert.ok(!intents.has('WANT_TO_BUY'), 'a rent job planned purchase queries');
});

test('a land job plans land nouns and never apartment nouns', () => {
  const land = planQueries({ ...TBILISI, propertyTerms: ['land'] }, 'SUPPLY', { maxQueries: 60 });
  assert.ok(land.queries.every((q) => q.propertyTerm === 'land'));
  assert.ok(land.queries.some((q) => q.text.includes('ნაკვეთი') || q.text.includes('მიწა')));
  assert.ok(!land.queries.some((q) => q.text.includes('ბინა')));
});

test('the narrowest location is planned first', () => {
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 60 });
  const first = plan.queries[0];
  assert.match(first.locationTerm, /Krtsanisi/);
});

test('the same job produces the same plan, twice', () => {
  // A plan that changes by itself cannot be cached, coalesced or tested — the
  // previous discovery function rotated on Date.now() and had all three
  // problems at once.
  const a = planQueries(TBILISI, 'DEMAND', { maxQueries: 30 });
  const b = planQueries(TBILISI, 'DEMAND', { maxQueries: 30 });
  assert.deepEqual(a.queries.map((q) => q.id), b.queries.map((q) => q.id));
  assert.deepEqual(a.queries.map((q) => q.text), b.queries.map((q) => q.text));
});

test('rotation is an explicit seed, so coverage grows without losing reproducibility', () => {
  const first = planQueries(TBILISI, 'DEMAND', { maxQueries: 20, rotationSeed: 0 });
  const later = planQueries(TBILISI, 'DEMAND', { maxQueries: 20, rotationSeed: 5 });
  assert.notDeepEqual(first.queries.map((q) => q.id), later.queries.map((q) => q.id));
  // ...and each seed is itself stable.
  const again = planQueries(TBILISI, 'DEMAND', { maxQueries: 20, rotationSeed: 5 });
  assert.deepEqual(later.queries.map((q) => q.id), again.queries.map((q) => q.id));
});

test('query ids are deterministic and unique within a plan', () => {
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 100 });
  const ids = plan.queries.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate query ids');
});

test('a REFERENCE or UNKNOWN direction gets no plan rather than a guessed one', () => {
  assert.equal(planQueries(TBILISI, 'REFERENCE').queries.length, 0);
  assert.equal(planQueries(TBILISI, 'UNKNOWN').queries.length, 0);
});

test('acceptance is wider than the plan, because posts were not written to match our query', () => {
  const plan = planQueries(TBILISI, 'DEMAND', { maxQueries: 10 });
  const accepted = acceptancePhrases('DEMAND', 'SALE', ['ka', 'en', 'ru', 'tr', 'ar', 'he', 'hi']);
  assert.ok(accepted.length > plan.queries.length, 'acceptance is no wider than the plan');
  assert.ok(accepted.includes('ვიყიდი'));
  assert.ok(accepted.includes('куплю'));
});

test('a language can be added without touching the planner', () => {
  // The planner iterates the lexicon's keys and knows no language names. This
  // asserts the shape that makes that true rather than the claim.
  const planner = readFileSync(join(process.cwd(), 'src/research-core/discovery/query-plan.ts'), 'utf8');
  for (const language of RESEARCH_LANGUAGES) {
    assert.ok(
      !new RegExp(`['"]${language}['"]`).test(planner),
      `query-plan.ts names the language "${language}" directly`,
    );
  }
});

test('the whole lexicon is reachable for classification, in every language', () => {
  const demand = allPhrases('wantToBuy');
  assert.ok(demand.includes('looking to buy'));
  assert.ok(demand.includes('ვეძებ საყიდლად'));
  assert.ok(demand.includes('أبحث عن شقة للشراء'));
  assert.ok(demand.includes('खरीदना चाहता हूं'));
});
