// EVIDENCE IS NOT A PROFILE.
//
// `intent_signals` keeps everything anybody ever said, because that is what provenance
// means. The matcher must never read it: handed the raw table it would treat Monday's
// budget and Thursday's budget as two live requirements and satisfy neither, keep matching
// a flat somebody rejected in March, and read a preference and a rule as equals.
//
// resolveEffectiveIntent() is the layer in between, and these are the four failures it
// exists to prevent — each written as the sentence that causes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEffectiveIntent } from '../intent/effective.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PROPERTY = '33333333-3333-4333-8333-333333333333';

let counter = 0;
/** A signal, with the boring fields filled in. */
const signal = (over = {}) => ({
  id: `sig-${(counter += 1)}`,
  actorUserId: USER,
  side: 'DEMAND',
  act: 'REQUIREMENT',
  dimension: null,
  polarity: 'POSITIVE',
  attribution: 'SELF',
  scope: 'GENERAL',
  explicit: true,
  confidence: 0.9,
  sourceAt: '2026-09-01T10:00:00.000Z',
  propertyId: null,
  intentProfileId: null,
  constraints: {},
  strength: {},
  supersededBy: null,
  withdrawnAt: null,
  ...over,
});

/* ────────────────────────────────────────────────────────────────────────
 * A later statement refines, per dimension
 * ──────────────────────────────────────────────────────────────────────── */

test('a new budget changes the budget and nothing else', () => {
  /*
   * THE BUG THIS PREVENTS. "I could go to 180" names one number. A resolver that rebuilt
   * the requirement from that sentence would blank the city, the bedrooms and the
   * transaction — and the customer would watch their search widen to the whole market
   * because they mentioned a figure.
   */
  const { demands } = resolveEffectiveIntent([
    signal({
      sourceAt: '2026-09-01T10:00:00.000Z',
      constraints: { transactionType: 'BUY', city: 'Tbilisi', district: 'Vake', bedroomsMin: 2, budgetMax: 150000 },
      strength: { CITY: 'REQUIRED', DISTRICT: 'PREFERRED' },
    }),
    signal({
      sourceAt: '2026-09-04T10:00:00.000Z',
      constraints: { transactionType: 'BUY', budgetMax: 180000 },
    }),
  ]);

  assert.equal(demands.length, 1, 'one person changing one number produced two requirements');
  const [demand] = demands;
  assert.equal(demand.constraints.budgetMax, 180000, 'the newer figure did not win');
  assert.equal(demand.constraints.city, 'Tbilisi', 'the city was erased by a budget message');
  assert.equal(demand.constraints.district, 'Vake', 'the district was erased');
  assert.equal(demand.constraints.bedroomsMin, 2, 'the bedrooms were erased');
  assert.equal(demand.strength.DISTRICT, 'PREFERRED', 'the firmness was erased');
  assert.equal(demand.evidence.length, 2, 'both statements should remain as provenance');
});

test('the order rows arrive in does not change the answer', () => {
  const earlier = signal({
    sourceAt: '2026-09-01T10:00:00.000Z',
    constraints: { transactionType: 'BUY', budgetMax: 150000 },
  });
  const later = signal({
    sourceAt: '2026-09-04T10:00:00.000Z',
    constraints: { transactionType: 'BUY', budgetMax: 180000 },
  });
  const forwards = resolveEffectiveIntent([earlier, later]).demands[0];
  const backwards = resolveEffectiveIntent([later, earlier]).demands[0];
  assert.equal(forwards.constraints.budgetMax, 180000);
  assert.equal(backwards.constraints.budgetMax, 180000,
    'the result depends on the order the database happened to return rows in');
});

test('a refined preference replaces the old one without becoming a rule', () => {
  const { demands } = resolveEffectiveIntent([
    signal({
      sourceAt: '2026-09-01T10:00:00.000Z',
      constraints: { transactionType: 'BUY', bedroomsMin: 2 },
      strength: { BEDROOMS: 'REQUIRED' },
    }),
    signal({
      sourceAt: '2026-09-05T10:00:00.000Z',
      constraints: { transactionType: 'BUY', bedroomsMin: 3 },
      strength: { BEDROOMS: 'PREFERRED' },
    }),
  ]);
  assert.equal(demands[0].constraints.bedroomsMin, 3);
  assert.equal(demands[0].strength.BEDROOMS, 'PREFERRED',
    'a softened requirement stayed hard');
});

/* ────────────────────────────────────────────────────────────────────────
 * A property is not a search
 * ──────────────────────────────────────────────────────────────────────── */

test('rejecting one property does not cancel the search', () => {
  /*
   * "I'm not interested in this one any more" ends one relationship. A customer who says
   * it about a flat in Vake has not stopped wanting to buy — and a resolver that let this
   * reach the general demand would cancel their search for them.
   */
  const { demands, properties } = resolveEffectiveIntent([
    signal({
      constraints: { transactionType: 'BUY', city: 'Tbilisi', district: 'Vake', bedroomsMin: 2, budgetMax: 200000 },
    }),
    signal({
      sourceAt: '2026-09-10T10:00:00.000Z',
      act: 'REJECTION', polarity: 'NEGATIVE', scope: 'PROPERTY', propertyId: PROPERTY,
    }),
  ]);

  assert.equal(demands.length, 1, 'the search disappeared');
  assert.equal(demands[0].constraints.city, 'Tbilisi');
  assert.equal(demands[0].constraints.bedroomsMin, 2);
  assert.equal(demands[0].constraints.budgetMax, 200000);

  assert.equal(properties.length, 1);
  assert.equal(properties[0].state, 'REJECTED');
  assert.equal(properties[0].propertyId, PROPERTY);
});

test('a property-scoped requirement refines no search', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'BUY', budgetMax: 200000 } }),
    signal({
      sourceAt: '2026-09-11T10:00:00.000Z',
      scope: 'PROPERTY', propertyId: PROPERTY,
      constraints: { transactionType: 'BUY', budgetMax: 120000 },
    }),
  ]);
  assert.equal(demands[0].constraints.budgetMax, 200000,
    'a figure mentioned about one flat rewrote the whole search');
});

/* ────────────────────────────────────────────────────────────────────────
 * An objection is neither
 * ──────────────────────────────────────────────────────────────────────── */

test('calling a property expensive is not interest and not a rejection', () => {
  /*
   * THE CORRECTION THIS VOCABULARY EXISTS FOR. Read as POSITIVE, a grumble becomes
   * evidence of interest and strengthens a relationship. Read as NEGATIVE, it quietly
   * ends one that is still live. It is neither, and it is recorded.
   */
  const { properties } = resolveEffectiveIntent([
    signal({
      act: 'OBJECTION', polarity: 'NEGATIVE', dimension: 'PRICE',
      scope: 'PROPERTY', propertyId: PROPERTY,
    }),
  ]);
  assert.equal(properties.length, 1);
  assert.notEqual(properties[0].state, 'REJECTED', 'a complaint ended the relationship');
  assert.notEqual(properties[0].state, 'INTERESTED', 'a complaint became evidence of interest');
  assert.deepEqual(properties[0].objections, ['PRICE'], 'the complaint was not recorded at all');
});

test('liking something and objecting to its price are both true', () => {
  const { properties } = resolveEffectiveIntent([
    signal({ act: 'INTEREST', scope: 'PROPERTY', propertyId: PROPERTY }),
    signal({
      act: 'OBJECTION', polarity: 'NEGATIVE', dimension: 'PRICE',
      scope: 'PROPERTY', propertyId: PROPERTY, sourceAt: '2026-09-01T10:00:01.000Z',
    }),
  ]);
  assert.equal(properties[0].state, 'INTERESTED', 'the interest was lost to the complaint');
  assert.deepEqual(properties[0].objections, ['PRICE'], 'the complaint was lost to the interest');
});

test('an objection never builds a requirement', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ act: 'OBJECTION', polarity: 'NEGATIVE', dimension: 'PRICE' }),
    signal({ act: 'INQUIRY', polarity: 'NEUTRAL' }),
  ]);
  assert.deepEqual(demands, [],
    'a complaint or a question created a search that states no requirements');
});

test('asking a question does not undo a rejection', () => {
  const { properties } = resolveEffectiveIntent([
    signal({ act: 'REJECTION', polarity: 'NEGATIVE', scope: 'PROPERTY', propertyId: PROPERTY }),
    signal({
      act: 'INQUIRY', polarity: 'NEUTRAL', scope: 'PROPERTY', propertyId: PROPERTY,
      sourceAt: '2026-09-02T10:00:00.000Z',
    }),
  ]);
  assert.equal(properties[0].state, 'REJECTED');
});

/* ────────────────────────────────────────────────────────────────────────
 * Two requirements are two requirements
 * ──────────────────────────────────────────────────────────────────────── */

test('buying a flat and renting an office are not one impossible requirement', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'BUY', city: 'Tbilisi', propertyTypes: ['APARTMENT'] } }),
    signal({
      sourceAt: '2026-09-02T10:00:00.000Z',
      constraints: { transactionType: 'RENT', city: 'Tbilisi', propertyTypes: ['COMMERCIAL'] },
    }),
  ]);
  assert.equal(demands.length, 2, 'two different transactions were merged into one');
  const buy = demands.find((d) => d.constraints.transactionType === 'BUY');
  const rent = demands.find((d) => d.constraints.transactionType === 'RENT');
  assert.deepEqual(buy.constraints.propertyTypes, ['APARTMENT']);
  assert.deepEqual(rent.constraints.propertyTypes, ['COMMERCIAL']);
});

test('a persisted search is its own requirement', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ intentProfileId: 'aaaa1111-1111-4111-8111-111111111111', constraints: { transactionType: 'BUY', budgetMax: 100000 } }),
    signal({ intentProfileId: 'bbbb2222-2222-4222-8222-222222222222', constraints: { transactionType: 'BUY', budgetMax: 300000 }, sourceAt: '2026-09-02T10:00:00.000Z' }),
  ]);
  assert.equal(demands.length, 2,
    'two named searches with the same transaction were merged');
});

/* ────────────────────────────────────────────────────────────────────────
 * What does not count
 * ──────────────────────────────────────────────────────────────────────── */

test('somebody else words never reach the effective state', () => {
  for (const attribution of ['THIRD_PARTY', 'QUOTED', 'UNKNOWN']) {
    const { demands } = resolveEffectiveIntent([
      signal({ attribution, constraints: { transactionType: 'BUY', city: 'Tbilisi' } }),
    ]);
    assert.deepEqual(demands, [], `${attribution} became this person's requirement`);
  }
});

test('an edited or deleted source stops counting and stays on record', () => {
  const withdrawn = signal({
    constraints: { transactionType: 'BUY', budgetMax: 150000 },
    withdrawnAt: '2026-09-03T10:00:00.000Z',
  });
  const { demands } = resolveEffectiveIntent([withdrawn]);
  assert.deepEqual(demands, [],
    'a requirement derived from a deleted message is still driving matching');
});

test('a superseded signal stops counting', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'BUY', budgetMax: 150000 }, supersededBy: 'sig-later' }),
  ]);
  assert.deepEqual(demands, []);
});

test('confidence is the least certain thing still holding the state up', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ confidence: 0.95, constraints: { transactionType: 'BUY', city: 'Tbilisi' } }),
    signal({ confidence: 0.6, constraints: { transactionType: 'BUY', budgetMax: 180000 }, sourceAt: '2026-09-04T10:00:00.000Z' }),
  ]);
  assert.equal(demands[0].confidence, 0.6,
    'a shaky later reading inherited the certainty of a firm earlier one');
});

test('two people are two people', () => {
  const { demands, properties } = resolveEffectiveIntent([
    signal({ actorUserId: USER, constraints: { transactionType: 'BUY', city: 'Tbilisi' } }),
    signal({ actorUserId: OTHER, constraints: { transactionType: 'BUY', city: 'Batumi' }, sourceAt: '2026-09-02T10:00:00.000Z' }),
    signal({ actorUserId: USER, act: 'INTEREST', scope: 'PROPERTY', propertyId: PROPERTY }),
    signal({ actorUserId: OTHER, act: 'REJECTION', polarity: 'NEGATIVE', scope: 'PROPERTY', propertyId: PROPERTY }),
  ]);
  /* One demand each, keyed apart by actor as well as transaction. */
  assert.equal(demands.filter((d) => d.actorUserId === USER).length, 1);
  assert.equal(demands.filter((d) => d.actorUserId === OTHER).length, 1);
  /* And two independent opinions about the same property. */
  assert.equal(properties.length, 2);
  assert.equal(properties.find((p) => p.actorUserId === USER).state, 'INTERESTED');
  assert.equal(properties.find((p) => p.actorUserId === OTHER).state, 'REJECTED');
});

test('nothing said produces nothing claimed', () => {
  assert.deepEqual(resolveEffectiveIntent([]), { demands: [], properties: [] });
});

/* ────────────────────────────────────────────────────────────────────────
 * Ending a search, and keeping two apart
 * ──────────────────────────────────────────────────────────────────────── */

test('"I am not looking any more" ends the conversational search it names', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi', budgetMax: 150000 } }),
    signal({
      act: 'REJECTION', polarity: 'NEGATIVE', sourceAt: '2026-09-05T10:00:00.000Z',
      constraints: { transactionType: 'SALE' },
    }),
  ]);
  assert.equal(demands.length, 0);
});

test('a withdrawal that names no transaction ends every conversational search, and no plan', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi' } }),
    signal({ constraints: { transactionType: 'RENT', city: 'Batumi' } }),
    signal({ intentProfileId: 'plan-1', scope: 'SEARCH', constraints: { transactionType: 'SALE', city: 'Tbilisi' } }),
    signal({ act: 'REJECTION', polarity: 'NEGATIVE', sourceAt: '2026-09-09T10:00:00.000Z', constraints: {} }),
  ]);
  assert.deepEqual(demands.map((d) => d.intentProfileId), ['plan-1'],
    'a chat sentence reached into a plan the customer confirmed on a screen');
});

test('a later requirement after a withdrawal starts a new search', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi', budgetMax: 150000 } }),
    signal({ act: 'REJECTION', polarity: 'NEGATIVE', sourceAt: '2026-09-05T10:00:00.000Z', constraints: {} }),
    signal({ sourceAt: '2026-09-10T10:00:00.000Z', constraints: { transactionType: 'SALE', city: 'Batumi' } }),
  ]);
  assert.equal(demands.length, 1);
  assert.equal(demands[0].constraints.city, 'Batumi');
  assert.equal(demands[0].constraints.budgetMax, undefined, 'the withdrawn search leaked into the new one');
});

test('buying a flat and renting a shop are two searches for one person', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi', propertyTypes: ['APARTMENT'] } }),
    signal({ constraints: { transactionType: 'RENT', city: 'Tbilisi', propertyTypes: ['COMMERCIAL'] } }),
  ]);
  assert.equal(demands.length, 2);
  assert.deepEqual(demands.map((d) => d.constraints.transactionType).sort(), ['RENT', 'SALE']);
});

test('rejecting one property does not end the search', () => {
  const { demands, properties } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi' } }),
    signal({
      side: 'PROPERTY_INTEREST', act: 'REJECTION', polarity: 'NEGATIVE', scope: 'PROPERTY',
      propertyId: PROPERTY, sourceAt: '2026-09-05T10:00:00.000Z',
    }),
  ]);
  assert.equal(demands.length, 1);
  assert.equal(properties[0].state, 'REJECTED');
});

test('a budget raised in chat refines the budget and keeps the rooms and the place', () => {
  const { demands } = resolveEffectiveIntent([
    signal({ constraints: { transactionType: 'SALE', city: 'Tbilisi', districts: ['Vake'], roomsMin: 3, budgetMax: 150000, currency: 'USD' } }),
    signal({ sourceAt: '2026-09-03T10:00:00.000Z', constraints: { transactionType: 'SALE', budgetMax: 180000, currency: 'USD' } }),
  ]);
  assert.equal(demands.length, 1);
  assert.equal(demands[0].constraints.budgetMax, 180000);
  assert.deepEqual(demands[0].constraints.districts, ['Vake']);
  assert.equal(demands[0].constraints.roomsMin, 3);
});
