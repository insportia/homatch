// WHOSE INTENT, HOW FIRMLY, AND WHICH WAY ROUND.
//
// Four readings decide whether a signal is safe to act on, and each has a specific victim
// when it is wrong:
//
//   ATTRIBUTION  an owner is told a person is interested who was talking about their
//                brother
//   POLARITY     a dead relationship stays alive, or a live search is cancelled
//   FIRMNESS     a preference becomes a filter and quietly hides the right flat
//   SCOPE        a sentence about one property becomes a rule about every property
//
// These are all failures a customer experiences and cannot diagnose, which is why the
// readings are structural rather than inferred, and why the structure is tested in the
// languages the product is actually used in.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attributionOf,
  firmnessOf,
  polarityFor,
  polarityOf,
  propertyReferenceCandidates,
  readingsOf,
  scopeOf,
  validate,
} from '../intent/interpret.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const PROPERTY = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-27T09:00:00.000Z';

/* ────────────────────────────────────────────────────────────────────────
 * Attribution
 * ──────────────────────────────────────────────────────────────────────── */

test('a first-person statement is the author speaking, in every language', () => {
  /* Georgian marks the first person in the verb and drops the pronoun, so "ვეძებ" alone
     is the whole of "I am looking" — a pronoun-hunting reading would find nothing. */
  assert.equal(attributionOf('ვეძებ 2 საძინებლიან ბინას ვაკეში'), 'SELF');
  assert.equal(attributionOf('Ищу двухкомнатную квартиру в Ваке'), 'SELF');
  assert.equal(attributionOf("I'm looking for a two-bedroom in Vake"), 'SELF');
  assert.equal(attributionOf('Vake\'de iki odalı daire arıyorum'), 'SELF');
});

test('a sentence about somebody else is not the author speaking', () => {
  /*
   * THE FAILURE THIS PREVENTS, stated as the sentence that causes it. Read as SELF, an
   * owner is told this person is personally interested in their property. They said
   * their brother was looking.
   */
  assert.equal(attributionOf('ჩემი მეგობარი ეძებს ბინას ვაკეში'), 'THIRD_PARTY');
  assert.equal(attributionOf('ჩემი ძმა ეძებს ბინას'), 'THIRD_PARTY');
  assert.equal(attributionOf('Мой друг ищет квартиру в Ваке'), 'THIRD_PARTY');
  assert.equal(attributionOf('My friend is looking for a flat in Vake'), 'THIRD_PARTY');
});

test('an ambiguous sentence is read the safe way round', () => {
  /*
   * "My brother is looking and I want to help" carries both markers. The safe reading is
   * the one that does not claim a person is personally interested: a missed signal costs
   * a lead, a false one costs a customer's trust.
   */
  assert.equal(
    attributionOf('ჩემი ძმა ეძებს ბინას და მინდა დავეხმარო'),
    'THIRD_PARTY',
  );
  assert.equal(attributionOf('My friend is looking and I want to help him'), 'THIRD_PARTY');
});

test('quoting somebody is a structural fact, not a linguistic one', () => {
  /*
   * A live chat message carries reply_to_id. Whether B quoted C is a column, and reading
   * the quoted text would attribute C's requirement to B — which is precisely how a
   * conversation about somebody else's search becomes that person's search.
   */
  assert.equal(attributionOf('ვეძებ ბინას ვაკეში', { isQuoted: true }), 'QUOTED');
  assert.equal(attributionOf('Ищу квартиру', { isQuoted: true }), 'QUOTED');
});

test('a sentence with no marker either way says so', () => {
  assert.equal(attributionOf('კარგი ამინდია დღეს'), 'UNKNOWN');
  assert.equal(attributionOf(''), 'UNKNOWN');
});

/* ────────────────────────────────────────────────────────────────────────
 * Polarity
 * ──────────────────────────────────────────────────────────────────────── */

test('saying no is read as no', () => {
  /* აღარ is Georgian for "no longer" and is the retraction this has to catch. */
  assert.equal(polarityOf('ეს ბინა აღარ მაინტერესებს'), 'NEGATIVE');
  assert.equal(polarityOf('არ მაინტერესებს'), 'NEGATIVE');
  assert.equal(polarityOf('Больше не интересует'), 'NEGATIVE');
  assert.equal(polarityOf('No longer interested'), 'NEGATIVE');
  assert.equal(polarityOf('Artık ilgilenmiyorum'), 'NEGATIVE');
});

test('saying yes is read as yes', () => {
  assert.equal(polarityOf('ეს ბინა მაინტერესებს'), 'POSITIVE');
  assert.equal(polarityOf('Меня интересует эта квартира'), 'POSITIVE');
  assert.equal(polarityOf('I am interested in this flat'), 'POSITIVE');
});

test('a complaint about the price is an objection, and nothing else', () => {
  /*
   * THE CORRECTION THIS VOCABULARY EXISTS FOR, and it was wrong in BOTH directions.
   *
   * NEGATIVE would read a grumble as a withdrawal and end a live relationship — people
   * buy things they call expensive. POSITIVE, which is what this originally returned, is
   * worse the other way: a complaint became evidence of interest and strengthened a
   * native relationship on the strength of somebody disliking the price.
   *
   * It is an OBJECTION about the PRICE, it carries no verdict on interest, and the
   * resolver treats it accordingly.
   */
  for (const text of ['ეს ძვირია', 'Дорого', 'That is expensive', 'Çok pahalı']) {
    const readings = readingsOf(text);
    const objection = readings.find((r) => r.act === 'OBJECTION');
    assert.ok(objection, `no objection read from ${text}`);
    assert.equal(objection.dimension, 'PRICE');
    assert.equal(objection.polarity, 'NEGATIVE');
    assert.ok(!readings.some((r) => r.act === 'INTEREST'),
      `a complaint became evidence of interest: ${text}`);
    assert.ok(!readings.some((r) => r.act === 'REJECTION'),
      `a complaint became a withdrawal: ${text}`);
  }
});

test('one message can say two things, and both are kept', () => {
  /* "I like it, but it is expensive" is an interest AND a price objection. A reading
     that returned one act would drop half the sentence. */
  const readings = readingsOf('ეს მომწონს, მაგრამ ძვირია');
  assert.ok(readings.some((r) => r.act === 'INTEREST'), 'the interest was lost');
  assert.ok(readings.some((r) => r.act === 'OBJECTION' && r.dimension === 'PRICE'),
    'the objection was lost');
});

test('a withdrawal in the same message ends the interest clause', () => {
  /* "It is expensive, I am no longer interested" is a complaint and a rejection — and
     NOT an interest, because the sentence ends by withdrawing. */
  const readings = readingsOf('ეს ძვირია, აღარ მაინტერესებს');
  assert.ok(readings.some((r) => r.act === 'OBJECTION' && r.dimension === 'PRICE'));
  assert.ok(readings.some((r) => r.act === 'REJECTION'));
  assert.ok(!readings.some((r) => r.act === 'INTEREST'));
});

test('a question is a question, not a buyer', () => {
  /* "How much is it?" is engagement and says nothing about what somebody wants. Stored
     as demand it would create a search that states no requirements. */
  for (const text of ['რა ღირს?', 'Сколько стоит?', 'How much is it?']) {
    const readings = readingsOf(text);
    const inquiry = readings.find((r) => r.act === 'INQUIRY');
    assert.ok(inquiry, `no inquiry read from ${text}`);
    assert.equal(inquiry.polarity, 'NEUTRAL');
    assert.ok(!readings.some((r) => r.act === 'TRANSACTION_INTENT'),
      `a question became an intent to transact: ${text}`);
  }
});

test('saying you will buy is stronger than saying you are interested', () => {
  assert.ok(readingsOf('ვიყიდი').some((r) => r.act === 'TRANSACTION_INTENT'));
  assert.ok(readingsOf('Готов купить').some((r) => r.act === 'TRANSACTION_INTENT'));
  assert.ok(!readingsOf('მაინტერესებს').some((r) => r.act === 'TRANSACTION_INTENT'));
});

test('the sign of an act is fixed, never guessed', () => {
  /* A row whose act and polarity disagree is a row nobody meant to write, and the
     database refuses one too. */
  assert.equal(polarityFor('INQUIRY'), 'NEUTRAL');
  assert.equal(polarityFor('REJECTION'), 'NEGATIVE');
  assert.equal(polarityFor('OBJECTION'), 'NEGATIVE');
  assert.equal(polarityFor('INTEREST'), 'POSITIVE');
  assert.equal(polarityFor('REQUIREMENT'), 'POSITIVE');
  assert.equal(polarityFor('TRANSACTION_INTENT'), 'POSITIVE');
});

/* ────────────────────────────────────────────────────────────────────────
 * Firmness, which is not confidence
 * ──────────────────────────────────────────────────────────────────────── */

test('a rule is REQUIRED and a preference is PREFERRED', () => {
  assert.equal(firmnessOf('აუცილებლად 3 საძინებელი'), 'REQUIRED');
  assert.equal(firmnessOf('3 საძინებელი მირჩევნია'), 'PREFERRED');
  assert.equal(firmnessOf('სასურველია ვაკე'), 'PREFERRED');
  assert.equal(firmnessOf('Обязательно 3 спальни'), 'REQUIRED');
  assert.equal(firmnessOf('Желательно Ваке'), 'PREFERRED');
  assert.equal(firmnessOf('Must have three bedrooms'), 'REQUIRED');
  assert.equal(firmnessOf('Ideally Vake'), 'PREFERRED');
});

test('being told it does not matter is FLEXIBLE, not unknown', () => {
  /* They answered. The answer was that it does not matter, which scores differently from
     never having been asked. */
  assert.equal(firmnessOf('სართული არ მაქვს მნიშვნელობა'), 'FLEXIBLE');
  assert.equal(firmnessOf('Этаж не важно'), 'FLEXIBLE');
  assert.equal(firmnessOf('The floor does not matter'), 'FLEXIBLE');
});

test('a sentence carrying both is read as the softer one', () => {
  /* A wrong REQUIRED hides flats and nobody can see why; a wrong PREFERRED only costs
     ranking. The asymmetry decides the tie. */
  assert.equal(firmnessOf('მხოლოდ ვაკე, თუმცა საბურთალოც მირჩევნია'), 'PREFERRED');
});

test('a bare constraint is REQUIRED, because that is what the matcher assumes', () => {
  assert.equal(firmnessOf('2 საძინებელი ვაკეში'), 'REQUIRED');
});

/* ────────────────────────────────────────────────────────────────────────
 * Scope
 * ──────────────────────────────────────────────────────────────────────── */

test('a conversation that names a property outranks reading the sentence', () => {
  /*
   * conversations.property_id exists. Asking a model which property somebody meant when
   * a column already says is both wasteful and less accurate.
   */
  assert.equal(scopeOf('აღარ მაინტერესებს', { propertyId: PROPERTY }), 'PROPERTY');
  assert.equal(scopeOf('anything at all', { propertyId: PROPERTY }), 'PROPERTY');
});

test('a statement about a named search refines that search', () => {
  assert.equal(scopeOf('180-მდეც შემიძლია', { intentProfileId: EVENT }), 'SEARCH');
});

test('a general statement stays general', () => {
  assert.equal(scopeOf('ვეძებ ბინას ვაკეში'), 'GENERAL');
});

test('a demonstrative with no context is not promoted to general', () => {
  /*
   * "This flat no longer interests me" with nothing saying which flat is about SOMETHING
   * specific we cannot name. Calling it GENERAL would turn it into "I no longer want to
   * buy", which is not what anybody said.
   */
  assert.equal(scopeOf('ეს ბინა აღარ მაინტერესებს'), 'PROPERTY');
  assert.equal(scopeOf('this flat is not for me'), 'PROPERTY');
});

/* ────────────────────────────────────────────────────────────────────────
 * Property references
 * ──────────────────────────────────────────────────────────────────────── */

test('a six-digit number is a candidate and never a resolution', () => {
  assert.deepEqual(propertyReferenceCandidates('482731 მაინტერესებს'), [482731]);
  /* A budget is six digits too. The caller checks the registry; this only finds the
     shapes worth checking. */
  assert.deepEqual(propertyReferenceCandidates('ბიუჯეტი 220000 დოლარი'), [220000]);
  /* Not five, not seven, and not part of a longer run of digits. */
  assert.deepEqual(propertyReferenceCandidates('12345 and 1234567 and 99999'), []);
  assert.deepEqual(propertyReferenceCandidates('no numbers here'), []);
});

test('the candidate list is bounded and deduplicated', () => {
  const many = propertyReferenceCandidates('100001 100002 100003 100004 100005 100001');
  assert.equal(many.length, 4, 'a message of digits turns into an unbounded lookup');
  assert.equal(new Set(many).size, many.length);
});

/* ────────────────────────────────────────────────────────────────────────
 * The gate
 * ──────────────────────────────────────────────────────────────────────── */

const base = {
  actorUserId: USER,
  sourceSurface: 'LIVE_CHAT',
  sourceEventId: EVENT,
  sourceAt: NOW,
  side: 'DEMAND',
  act: 'REQUIREMENT',
  dimension: null,
  polarity: 'POSITIVE',
  attribution: 'SELF',
  explicit: true,
  confidence: 0.9,
  scope: 'GENERAL',
  constraints: { city: 'Tbilisi', bedroomsMin: 2, budgetMax: 220000, currency: 'USD' },
  strength: { CITY: 'REQUIRED', DISTRICT: 'PREFERRED' },
};

test('a well-formed candidate passes and keeps what it said', () => {
  const { intent, rejected } = validate(base);
  assert.deepEqual(rejected, []);
  assert.equal(intent.actorUserId, USER);
  assert.equal(intent.side, 'DEMAND');
  assert.equal(intent.strength.DISTRICT, 'PREFERRED');
  assert.equal(intent.constraints.budgetMax, 220000);
});

test('somebody else words never become this person requirements', () => {
  /*
   * THE ONE THE WHOLE LAYER EXISTS FOR. A third-party sentence is real market
   * intelligence and it is not this person's demand. The gate refuses it as demand rather
   * than downgrading it quietly, so the rejection is visible in a log.
   */
  for (const attribution of ['THIRD_PARTY', 'QUOTED', 'UNKNOWN']) {
    for (const side of ['DEMAND', 'SUPPLY']) {
      const { intent, rejected } = validate({ ...base, attribution, side });
      assert.equal(intent, null, `${attribution} became ${side}`);
      assert.ok(rejected.some((r) => r.includes('attributed to somebody other')));
    }
  }
});

test('a property-scoped signal that names no property is refused', () => {
  const { intent, rejected } = validate({ ...base, scope: 'PROPERTY' });
  assert.equal(intent, null);
  assert.ok(rejected.some((r) => r.includes('names no property')));
});

test('interest in a property that did not resolve is refused', () => {
  const { intent, rejected } = validate({
    ...base, side: 'PROPERTY_INTEREST', scope: 'PROPERTY', propertyId: null,
  });
  assert.equal(intent, null);
  assert.ok(rejected.some((r) => r.includes('was not resolved')));
});

test('a question or a complaint is never stored as a requirement', () => {
  /*
   * "How much is it?" states no requirements and "it's expensive" states one fact about
   * one dimension. Either arriving as DEMAND would create a search out of a sentence
   * that asked for nothing — and that search would then match things and notify people.
   */
  for (const act of ['INQUIRY', 'OBJECTION']) {
    const { intent, rejected } = validate({
      ...base, act, dimension: act === 'OBJECTION' ? 'PRICE' : null,
    });
    assert.equal(intent, null, `${act} became a statement of requirements`);
    assert.ok(rejected.some((r) => r.includes('question or a complaint')));
  }
});

test('a complaint about nothing in particular is refused', () => {
  const { intent, rejected } = validate({
    ...base, side: 'PROPERTY_INTEREST', scope: 'PROPERTY',
    propertyId: '44444444-4444-4444-8444-444444444444',
    act: 'OBJECTION', dimension: null,
  });
  assert.equal(intent, null);
  assert.ok(rejected.some((r) => r.includes('names no dimension')));
});

test('the stored sign follows the act, whatever the caller sent', () => {
  const { intent } = validate({ ...base, act: 'INTEREST', polarity: 'NEGATIVE',
    side: 'PROPERTY_INTEREST', scope: 'PROPERTY',
    propertyId: '44444444-4444-4444-8444-444444444444' });
  assert.equal(intent.polarity, 'POSITIVE',
    'a caller was allowed to store an interest that points the wrong way');
});

test('a vocabulary nobody uses does not enter matching', () => {
  /*
   * A model asked for structure returns structure, including when it has invented a
   * side, a scope or a strength. Downstream of the gate a signal is trusted, so the gate
   * fails closed on every taxonomy at once.
   */
  assert.equal(validate({ ...base, side: 'MAYBE_BUYING' }).intent, null);
  assert.equal(validate({ ...base, scope: 'EVERYTHING' }).intent, null);
  assert.equal(validate({ ...base, attribution: 'PROBABLY_THEM' }).intent, null);
  assert.equal(validate({ ...base, sourceSurface: 'TELEPATHY' }).intent, null);
  assert.equal(validate({ ...base, act: 'VIBING' }).intent, null);
  assert.equal(validate({ ...base, dimension: 'FENG_SHUI' }).intent, null);

  const bad = validate({ ...base, strength: { CITY: 'VERY_IMPORTANT' } });
  assert.equal(bad.intent, null);
  assert.ok(bad.rejected.some((r) => r.includes('VERY_IMPORTANT')));
});

test('an identity that is not an identity is refused', () => {
  assert.equal(validate({ ...base, actorUserId: 'me' }).intent, null);
  assert.equal(validate({ ...base, actorUserId: undefined }).intent, null);
  assert.equal(validate({ ...base, sourceEventId: '42' }).intent, null);
});

test('confidence is clamped rather than trusted', () => {
  /* A model that returns 7 for a probability has not returned a probability. */
  assert.equal(validate({ ...base, confidence: 7 }).intent.confidence, 1);
  assert.equal(validate({ ...base, confidence: -3 }).intent.confidence, 0);
  assert.equal(validate({ ...base, confidence: 'high' }).intent, null);
});

test('confidence and firmness are separate columns and stay separate', () => {
  /*
   * We can be almost certain somebody said "I'd prefer Vake" — and Vake is still
   * PREFERRED. A pipeline that let one become the other would turn a confident reading of
   * a soft preference into a hard filter, and the customer would never learn why the
   * right flats stopped appearing.
   */
  const { intent } = validate({
    ...base, confidence: 0.99, strength: { DISTRICT: 'PREFERRED' },
  });
  assert.equal(intent.confidence, 0.99);
  assert.equal(intent.strength.DISTRICT, 'PREFERRED');
});

test('every rejection is reported rather than silently dropped', () => {
  const { intent, rejected } = validate({});
  assert.equal(intent, null);
  assert.ok(rejected.length >= 4,
    'a validator that returns null with no reasons is indistinguishable from an empty model response');
});
