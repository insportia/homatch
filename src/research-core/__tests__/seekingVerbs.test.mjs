// FOUR OF SIX LANGUAGES COULD NOT RECOGNISE THEIR OWN WAY OF ASKING TO BUY A FLAT.
//
// Found while building the Telegram fixtures, which is the point of having
// fixtures written by somebody thinking about the language rather than about
// the code. Six realistic messages, one per supported language, and only two
// classified:
//
//   ka  "ვეძებ ბინას ქირით საბურთალოზე"        UNKNOWN
//   ru  "Ищу квартиру в Тбилиси для инвестиций" UNKNOWN
//   he  "מחפש דירה להשקעה בטביליסי"             UNKNOWN
//   ar  "أبحث عن شقة للاستثمار في تبليسي"        UNKNOWN
//   tr  "Tiflis'te satılık daire arıyorum"      SUPPLY   ← a buyer, filed as a seller
//
// THE CAUSE
//
// The lexicon matches phrases CONTIGUOUSLY, and it held the joined-up forms:
// 'ищу для инвестиций', 'daire arıyorum satılık'. In every one of these
// languages the object of the verb sits between the two halves — you say "ищу
// КВАРТИРУ ... для инвестиций" — so the phrase never appeared and nothing
// matched. Turkish was worse than nothing: `satılık` (for sale) matched as
// SUPPLY while the demand verb `arıyorum` at the end of the sentence matched
// nothing at all, so a buyer was recorded as a seller.
//
// THE SECOND BUG, FOUND BY THE FIRST
//
// The fix — count a bare seeking verb when a property noun is present — put
// weight on property-noun matching for the first time, and that immediately
// surfaced `дом` matching inside `ряДОМ`. "ищу сантехника рядом с Руставели"
// is somebody looking for a plumber, and it named a house.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirection, phraseMatches } from '../signals/direction.ts';
import { LEXICON, RESEARCH_LANGUAGES } from '../discovery/lexicon.ts';

const L = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const direction = (text) => classifyDirection(text, { languages: L }).direction;

/* ── the six that started it ───────────────────────────────────────────── */

test('every supported language recognises a buyer written naturally', () => {
  const buyers = {
    ka: 'ვეძებ საყიდლად 2 ოთახიან ბინას ვაკეში, ბიუჯეტი 150000 დოლარამდე.',
    en: 'Looking for a 2 bedroom apartment in Vake, budget up to 150000.',
    ru: 'Ищу квартиру в Тбилиси для инвестиций, бюджет до 120000 долларов.',
    he: 'מחפש דירה להשקעה בטביליסי, תקציב עד 150 אלף דולר.',
    ar: 'أبحث عن شقة للاستثمار في تبليسي، الميزانية حتى 130 ألف دولار.',
    tr: 'Tiflis\'te satılık daire arıyorum, yatırım için.',
  };
  for (const [language, text] of Object.entries(buyers)) {
    assert.equal(direction(text), 'DEMAND', `${language} does not recognise its own buyers`);
  }
});

test('a Turkish buyer is not filed as a seller', () => {
  /*
   * The inversion, on its own, because it is the worst of the five: the other
   * four produced nothing, and this one produced the opposite. "satılık daire
   * arıyorum" is "I am looking for an apartment that is for sale" — the word
   * `satılık` describes what they WANT, not what they HAVE.
   */
  assert.equal(direction('Tiflis\'te satılık daire arıyorum'), 'DEMAND');
  assert.equal(direction('أبحث عن شقة للبيع'), 'DEMAND');
  assert.equal(direction('Ищу квартиру, рассматриваю варианты продается'), 'DEMAND');
});

test('every supported language still recognises a seller', () => {
  const sellers = {
    ka: 'იყიდება 2 ოთახიანი ბინა ვაკეში, ფასი 165000 დოლარი.',
    en: 'Apartment for sale in Vake, 68 sqm, 165000 USD, direct from owner.',
    ru: 'Продается квартира в Ваке, 68 кв.м, 165000 долларов.',
    he: 'דירה למכירה בטביליסי, 68 מר.',
    ar: 'شقة للبيع في تبليسي، 68 متر مربع.',
    tr: 'Tiflis Vake\'de satılık daire, 68 m2, sahibinden.',
  };
  for (const [language, text] of Object.entries(sellers)) {
    assert.equal(direction(text), 'SUPPLY', `${language} no longer recognises a listing`);
  }
});

/* ── the side of the market the verb is pointing at ────────────────────── */

test('a landlord looking for a tenant is supply, not a renter', () => {
  /*
   * "Looking for a tenant" and "looking for a flat" open with the same verb
   * and are opposite sides of the market. Reading the first as demand files
   * every landlord as somebody who needs somewhere to live — and they would
   * then be matched against other landlords.
   */
  const landlords = [
    'Ищу арендатора на квартиру в Сабуртало, 900 лари в месяц.',
    'Kiracı arıyorum, 2+1 daire Tiflis merkez.',
    'מחפש שוכר לדירה בתל אביב',
    'ვეძებ მდგმურს ბინაში საბურთალოზე',
    'Looking for a tenant for my apartment in Vake.',
  ];
  for (const text of landlords) {
    assert.equal(direction(text), 'SUPPLY', `filed as demand: ${text}`);
  }
});

test('a tenant looking for a flat is still demand', () => {
  // The other half. Fixing the landlord case must not cost the tenant case.
  assert.equal(direction('ვეძებ ბინას ქირით საბურთალოზე, ბიუჯეტი 900 ლარამდე'), 'DEMAND');
  assert.equal(direction('Ищу квартиру в аренду в Сабуртало до 900 лари'), 'DEMAND');
});

/* ── the bare verb needs a noun ────────────────────────────────────────── */

test('a seeking verb with no property noun is not a property lead', () => {
  /*
   * The condition that makes a bucket this broad safe. Without it, every
   * "looking for" in a busy group becomes a housing lead — including the ones
   * looking for a plumber, a dentist or a lift to the airport.
   */
  const notLeads = [
    'ищу сантехника рядом с Руставели',
    'Does anyone know a good plumber near Rustaveli?',
    'Tiflis\'te iyi bir diş hekimi arıyorum',
    'מחפש המלצה על מסעדה טובה',
  ];
  for (const text of notLeads) {
    assert.notEqual(direction(text), 'DEMAND', `treated as a property lead: ${text}`);
  }
});

test('a bare verb does not inflate a text that already said it plainly', () => {
  /*
   * "ვეძებ საყიდლად" is both an explicit want-to-buy phrase and contains the
   * bare verb "ვეძებ". Counting both would give a text credit twice for
   * saying one thing once, which is how confidence scores stop meaning
   * anything.
   */
  const verdict = classifyDirection('ვეძებ საყიდლად ბინას ვაკეში', { languages: L });
  assert.equal(verdict.matched.filter((m) => m === 'ვეძებ').length, 0,
    'the bare verb was counted alongside the phrase that contains it');
});

/* ── the matcher ───────────────────────────────────────────────────────── */

test('a word is not matched inside a longer word, where the script allows the check', () => {
  // ряДОМ. The Russian for "nearby" contains the Russian for "house".
  assert.equal(phraseMatches('ищу сантехника рядом с руставели', 'дом'), false);
  assert.equal(phraseMatches('продается дом в ваке', 'дом'), true);
  assert.equal(phraseMatches('продается домик', 'дом'), true, 'a suffix must still match');
});

test('prefixing scripts keep containment, because their grammar is on the front', () => {
  /*
   * Hebrew attaches ל, ב, ה, מ and ו to the front of a word, and Arabic
   * attaches ال and ل. Requiring a leading boundary in those scripts would
   * refuse the most ordinary way of writing them: `לדירה` IS `דירה`.
   */
  assert.equal(phraseMatches('מחפש שוכר לדירה בתל אביב', 'דירה'), true);
  assert.equal(phraseMatches('أبحث عن شقة للبيع', 'بيع'), true);
});

test('Latin word boundaries hold without breaking suffixes', () => {
  assert.equal(phraseMatches('a nice place to live', 'flat'), false);
  assert.equal(phraseMatches('conflating two things', 'flat'), false, 'matched inside conFLATing');
  assert.equal(phraseMatches('tiflis daireyi gezdim', 'daire'), true, 'a Turkish suffix must match');
});

/* ── the table stays reviewable ────────────────────────────────────────── */

test('every language has every bucket, so adding one cannot half-land', () => {
  const buckets = ['wantToBuy', 'wantToRent', 'wantToInvest', 'relocating',
    'seeking', 'seekingCounterparty', 'forSale', 'forRent', 'budget', 'agency'];
  for (const language of RESEARCH_LANGUAGES) {
    for (const bucket of buckets) {
      const phrases = LEXICON[language][bucket];
      assert.ok(Array.isArray(phrases) && phrases.length > 0,
        `${language}.${bucket} is empty, so that language is silently weaker`);
    }
  }
});

test('every phrase is lowercase, because the matcher lowercases the text', () => {
  // A capital in the table is a phrase that can never match anything.
  for (const language of RESEARCH_LANGUAGES) {
    for (const bucket of ['seeking', 'seekingCounterparty']) {
      for (const phrase of LEXICON[language][bucket]) {
        assert.equal(phrase, phrase.toLowerCase(), `${language}.${bucket}: "${phrase}"`);
      }
    }
  }
});

test('no counterparty phrase is also a plain seeking phrase', () => {
  /*
   * They are checked in order and the counterparty reading wins, so an entry
   * in both would be dead text in one of them — and the kind of dead text
   * that looks like coverage.
   */
  for (const language of RESEARCH_LANGUAGES) {
    const seeking = new Set(LEXICON[language].seeking);
    for (const phrase of LEXICON[language].seekingCounterparty) {
      assert.equal(seeking.has(phrase), false, `${language}: "${phrase}" is in both buckets`);
    }
  }
});
