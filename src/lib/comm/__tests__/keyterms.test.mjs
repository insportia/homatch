// What the transcriber is told about, before a word is spoken.
//
// The corpus is over a thousand terms and the provider takes a few dozen. The
// obvious implementation — send them all — is wrong twice: the provider caps
// it, and a thousand biases is not a bias, it is noise.
//
// So these tests protect the things that make the selection worth having:
// the brand always survives, context beats alphabetical luck, a term is never
// truncated into a different word, another tenant's vocabulary is not merely
// ranked lower but never considered, and profanity is not sent by default to
// a transcriber that would then start hearing it everywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectKeyterms, keytermStrings, normalizeTerm, keytermLength, detectEntities,
} from '../keyterms.ts';

const LIMITS = { maxTerms: 8, maxCharsPerTerm: 20 };

let seq = 0;
const term = (over = {}) => ({
  id: `t${++seq}`,
  term: 'ბინა',
  category: 'property_types',
  languageHint: 'ka',
  scope: 'GLOBAL',
  priority: 50,
  providerEligible: true,
  enabled: true,
  ...over,
});

test('the brand survives a corpus that is trying to crowd it out', () => {
  // A transcriber that writes "Ho match" has failed at the one word the
  // product is named after. No ranking may push it out.
  const corpus = [
    term({ term: 'Homatch', category: 'brand_product', languageHint: 'en' }),
    ...Array.from({ length: 40 }, (_, i) => term({ term: `ტერმინი${i}`, priority: 90 })),
  ];

  const out = selectKeyterms(corpus, { language: 'ka' }, LIMITS);
  assert.ok(keytermStrings(out).includes('Homatch'), 'the brand was dropped');
  assert.equal(out.selected.length, LIMITS.maxTerms, 'the allowance should be filled');
  assert.equal(out.selected[0].term, 'Homatch', 'the brand should rank first');
});

test('a term too long for the provider is dropped, never truncated', () => {
  /*
   * "საჯარო რეესტრის ეროვნული სააგენტო" cut to twenty characters is a
   * different string that means nothing, and biasing a transcriber toward a
   * fragment is worse than not biasing it at all.
   */
  const long = 'საჯარო რეესტრის ეროვნული სააგენტო';
  assert.ok(keytermLength(long) > LIMITS.maxCharsPerTerm);

  const out = selectKeyterms([term({ term: long, category: 'legal_registry_georgia' })], {}, LIMITS);
  assert.deepEqual(out.selected, []);
  assert.equal(out.dropped[0].reason, 'TOO_LONG');
  for (const s of out.selected) {
    assert.ok(keytermLength(s.term) <= LIMITS.maxCharsPerTerm);
  }
});

test('the limits are arguments, because the provider has already changed them', () => {
  const corpus = Array.from({ length: 200 }, (_, i) => term({ term: `ტერმ${i}` }));

  assert.equal(selectKeyterms(corpus, {}, { maxTerms: 50, maxCharsPerTerm: 20 }).selected.length, 50);
  assert.equal(selectKeyterms(corpus, {}, { maxTerms: 150, maxCharsPerTerm: 20 }).selected.length, 150);
  assert.equal(selectKeyterms(corpus, {}, { maxTerms: 0, maxCharsPerTerm: 20 }).selected.length, 0);

  // A longer per-term allowance admits terms that were previously impossible.
  const long = 'წინასწარი ნასყიდობა';
  const tight = selectKeyterms([term({ term: long })], {}, { maxTerms: 10, maxCharsPerTerm: 10 });
  const loose = selectKeyterms([term({ term: long })], {}, { maxTerms: 10, maxCharsPerTerm: 40 });
  assert.equal(tight.selected.length, 0);
  assert.equal(loose.selected.length, 1);
});

test('what the conversation is about beats what the corpus happens to contain', () => {
  const corpus = [
    term({ term: 'კრწანისი', category: 'georgia_locations' }),
    term({ term: 'გლდანი', category: 'georgia_locations' }),
    term({ term: 'ისანი', category: 'georgia_locations' }),
    term({ term: 'დიდუბე', category: 'georgia_locations' }),
  ];

  const out = selectKeyterms(corpus, { language: 'ka', locations: ['კრწანისი'] }, { maxTerms: 2, maxCharsPerTerm: 20 });
  assert.equal(out.selected[0].term, 'კრწანისი');
  assert.ok(out.selected[0].reasons.includes('location'));
});

test('a proper noun already mentioned is worth a slot next turn', () => {
  const corpus = [
    term({ term: 'm2', category: 'brand_developer', languageHint: null }),
    term({ term: 'არქი', category: 'brand_developer', languageHint: null }),
  ];
  const out = selectKeyterms(corpus, { language: 'ka', entities: ['არქი'] }, { maxTerms: 1, maxCharsPerTerm: 20 });
  assert.equal(out.selected[0].term, 'არქი');
  assert.ok(out.selected[0].reasons.includes('mentioned'));
});

test('the language being spoken outranks the language on the page', () => {
  const corpus = [
    term({ term: 'квартира', category: 'global_real_estate_ru', languageHint: 'ru' }),
    term({ term: 'ბინა', category: 'property_types', languageHint: 'ka' }),
  ];

  const russian = selectKeyterms(corpus, { language: 'ru' }, { maxTerms: 1, maxCharsPerTerm: 20 });
  assert.equal(russian.selected[0].term, 'квартира');

  const georgian = selectKeyterms(corpus, { language: 'ka' }, { maxTerms: 1, maxCharsPerTerm: 20 });
  assert.equal(georgian.selected[0].term, 'ბინა');
});

test('a language-neutral term is not punished for having no hint', () => {
  const corpus = [
    term({ term: 'ROI', category: 'pricing_finance', languageHint: null }),
    term({ term: 'квартира', category: 'global_real_estate_ru', languageHint: 'ru' }),
  ];
  const out = selectKeyterms(corpus, { language: 'ka' }, { maxTerms: 1, maxCharsPerTerm: 20 });
  assert.equal(out.selected[0].term, 'ROI', 'a neutral term should beat a wrong-language one');
});

test('profanity is not sent to a transcriber that would then hear it everywhere', () => {
  const corpus = [
    term({ term: 'ყლეო', category: 'abuse_georgian' }),
    term({ term: 'идиот', category: 'abuse_ru_en', languageHint: 'ru' }),
    term({ term: 'ბინა', category: 'property_types' }),
  ];

  const normal = selectKeyterms(corpus, { language: 'ka' }, LIMITS);
  assert.deepEqual(keytermStrings(normal), ['ბინა']);
  assert.ok(normal.dropped.some((d) => d.reason === 'ABUSE_WITHHELD'));

  // Once a session has demonstrably contained abuse, recognising it correctly
  // is the difference between answering the real question and mishearing it.
  const heated = selectKeyterms(corpus, { language: 'ka', abusiveContext: true }, LIMITS);
  assert.ok(keytermStrings(heated).includes('ყლეო'));
});

test('anything marked ineligible never reaches the provider', () => {
  // The seed corpus marks 325 intent phrases as semantic test material with
  // "do not send as realtime keyterm" written on them.
  const corpus = [
    term({ term: 'მინდა ბინა ვიყიდო', category: 'intent_phrase', providerEligible: false }),
    term({ term: 'ბინა', category: 'property_types' }),
  ];
  const out = selectKeyterms(corpus, {}, LIMITS);
  assert.deepEqual(keytermStrings(out), ['ბინა']);
  assert.equal(out.dropped[0].reason, 'NOT_ELIGIBLE');
});

test('another tenant\'s vocabulary is not considered, not merely ranked lower', () => {
  const corpus = [
    term({ term: 'ალფა', scope: 'TENANT', tenantId: 'tenant-a' }),
    term({ term: 'ბეტა', scope: 'TENANT', tenantId: 'tenant-b' }),
    term({ term: 'ბინა' }),
  ];
  const out = selectKeyterms(corpus, { tenantId: 'tenant-a' }, LIMITS);
  const picked = keytermStrings(out);
  assert.ok(picked.includes('ალფა'));
  assert.ok(!picked.includes('ბეტა'), 'tenant B vocabulary reached tenant A');
  assert.ok(out.dropped.some((d) => d.term === 'ბეტა' && d.reason === 'WRONG_SCOPE'));
});

test('an agent only gets its own agent-scoped words', () => {
  const corpus = [
    term({ term: 'ერთი', scope: 'AGENT', agentId: 'agent-1' }),
    term({ term: 'ორი', scope: 'AGENT', agentId: 'agent-2' }),
  ];
  const out = selectKeyterms(corpus, { agentId: 'agent-1' }, LIMITS);
  assert.deepEqual(keytermStrings(out), ['ერთი']);
});

test('the same word spelled twice takes one slot, and the better spelling wins', () => {
  const corpus = [
    term({ term: 'Homatch', category: 'brand_product', languageHint: 'en', priority: 60 }),
    term({ term: 'homatch', category: 'brand_product', languageHint: 'en', priority: 99 }),
    term({ term: 'ბინა' }),
  ];
  const out = selectKeyterms(corpus, { language: 'en' }, LIMITS);
  const brand = out.selected.filter((s) => normalizeTerm(s.term) === 'homatch');
  assert.equal(brand.length, 1, 'both spellings took a slot');
  assert.equal(brand[0].term, 'homatch', 'the higher-priority spelling should win');
  assert.ok(out.dropped.some((d) => d.reason === 'DUPLICATE'));
});

test('the same context always produces the same terms', () => {
  // A transcription problem that cannot be reproduced cannot be fixed, and
  // the Admin preview must show what would actually be sent.
  const corpus = Array.from({ length: 60 }, (_, i) =>
    term({ term: `ტერმ${i}`, priority: 50 }));

  const a = keytermStrings(selectKeyterms(corpus, { language: 'ka' }, LIMITS));
  const b = keytermStrings(selectKeyterms([...corpus].reverse(), { language: 'ka' }, LIMITS));
  assert.deepEqual(a, b, 'the order of the corpus changed the answer');
});

test('normalisation folds case and punctuation but never the script', () => {
  assert.equal(normalizeTerm('  Homatch! '), 'homatch');
  assert.equal(normalizeTerm('Homatch-ის'), 'homatch-ის');
  assert.equal(normalizeTerm('საკადასტრო  კოდი'), 'საკადასტრო კოდი');
  // Georgian and Latin are not the same term, however similar they look.
  assert.notEqual(normalizeTerm('ჰომაჩი'), normalizeTerm('homatch'));
});

test('character length is counted the way a provider counts it', () => {
  // Georgian is multi-byte; a byte length would reject terms that fit.
  assert.equal(keytermLength('ბინა'), 4);
  assert.equal(keytermLength('საკადასტრო კოდი'), 15);
  assert.equal(keytermLength('Homatch'), 7);
});

test('entities are taken from what was said, conservatively', () => {
  // Georgian has no capitalisation, so length is the only cheap signal a
  // proper noun leaves behind — and the commonest verbs are long enough to
  // pass it, so they are named and excluded.
  assert.deepEqual(
    detectEntities('მინდა ბინა კრწანისში, დეველოპერი არქი'),
    ['კრწანისში', 'დეველოპერი'],
  );
  assert.deepEqual(detectEntities('გამარჯობა, ინფორმაცია მაინტერესებს'), []);
  assert.ok(detectEntities('I looked at Green Diamond in Batumi').includes('Green Diamond'));
  // Short words and lowercase runs are not proper nouns.
  assert.deepEqual(detectEntities('the flat is ok'), []);
});

test('nothing selected can exceed the allowance, whatever the corpus looks like', () => {
  const corpus = Array.from({ length: 500 }, (_, i) => term({
    term: i % 3 === 0 ? 'ძალიან გრძელი ტერმინი რომელიც არ ჯდება' : `ტერმ${i}`,
    category: i % 7 === 0 ? 'brand_product' : 'property_types',
  }));
  const out = selectKeyterms(corpus, { language: 'ka' }, { maxTerms: 50, maxCharsPerTerm: 20 });

  assert.ok(out.selected.length <= 50);
  assert.ok(out.selected.every((s) => keytermLength(s.term) <= 20));
  assert.equal(new Set(out.selected.map((s) => normalizeTerm(s.term))).size, out.selected.length);
});
