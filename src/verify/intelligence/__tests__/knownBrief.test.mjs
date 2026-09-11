// What the research is told we already know.
//
// This is how the saving is actually taken, so it is also where a saving
// could quietly buy a worse report. The tests below are mostly about what
// must NOT be in the brief.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnownBrief, briefFactsForStage, briefable } from '../knownBrief.ts';

const fresh = (factKey) => ({ factKey, state: 'FRESH', ageHours: 1, maxAgeHours: 8760, freshnessClass: 'LOW_VOLATILITY', reason: 'fresh' });
const stale = (factKey) => ({ factKey, state: 'STALE', ageHours: 900, maxAgeHours: 24, freshnessClass: 'HIGH_VOLATILITY', reason: 'old' });
const conflicting = (factKey) => ({ factKey, state: 'CONFLICTING', ageHours: 1, maxAgeHours: 24, freshnessClass: 'HIGH_VOLATILITY', reason: 'contradicted' });

const FACTS = [
  { fact_key: 'project.floors', value_number: 7 },
  { fact_key: 'project.identity', value_text: 'Kristian Stiven St, 18' },
  { fact_key: 'amenities.list', value_json: ['Elevator', 'Ground-level parking'] },
  { fact_key: 'building.structure', value_text: 'Monolithic frame' },
];

/* ── what is never briefed ───────────────────────────────────────────── */

test('the registry families are never briefed, however fresh', () => {
  // These are what a buyer is exposed to between agreeing a price and
  // signing. A model told "we last saw no mortgage" is a model with a reason
  // to look less hard, and that saving is not worth the failure mode.
  for (const k of ['ownership.owner', 'encumbrance.mortgage', 'rights.restrictions', 'registry.state']) {
    assert.equal(briefable(k), false, `${k} would be handed to the model as established`);
  }
  const brief = buildKnownBrief(
    [{ fact_key: 'ownership.owner', value_text: 'Somebody' }],
    [fresh('ownership.owner')]
  );
  assert.equal(brief.text, '', 'an ownership fact reached the brief');
  assert.deepEqual(brief.briefed, []);
});

test('a stale fact is never briefed as established', () => {
  // Handing a stale fact over as established is exactly how a report comes to
  // state last month's ownership as current.
  const brief = buildKnownBrief(FACTS, [stale('project.floors'), stale('project.identity')]);
  assert.equal(brief.text, '');
});

test('a contradicted fact is never briefed', () => {
  const brief = buildKnownBrief(FACTS, [conflicting('project.floors')]);
  assert.equal(brief.text, '');
});

test('a fact the planner never assessed is not briefed', () => {
  // The brief and the plan share one verdict on freshness. Two sources of
  // truth about what is usable is how they come to disagree.
  const brief = buildKnownBrief(FACTS, []);
  assert.equal(brief.text, '');
});

/* ── what is briefed ─────────────────────────────────────────────────── */

test('fresh, evidenced facts are handed over with their values', () => {
  const brief = buildKnownBrief(FACTS, FACTS.map((f) => fresh(f.fact_key)));
  assert.match(brief.text, /project\.floors = 7/);
  assert.match(brief.text, /project\.identity = Kristian Stiven St, 18/);
  assert.match(brief.text, /amenities\.list = Elevator; Ground-level parking/);
  assert.equal(brief.briefed.length, 4);
});

test('the instruction is to spend searches elsewhere, not to stop looking', () => {
  const brief = buildKnownBrief(FACTS, FACTS.map((f) => fresh(f.fact_key)));
  assert.match(brief.text, /Do NOT spend searches rediscovering them/);
  assert.match(brief.text, /spend them on what is missing/);
});

test('the model is told to restate them, because the report is written from its output', () => {
  // The whole reason nothing is skipped: a stage that simply did not run
  // would leave its fields empty and the buyer's report would lose a section.
  const brief = buildKnownBrief(FACTS, FACTS.map((f) => fresh(f.fact_key)));
  assert.match(brief.text, /Restate any of them that belongs in your\nanswer/);
  assert.match(brief.text, /the report is written from your output/);
});

test('the model may contradict the brief, and is told so', () => {
  // This list is what we knew, not what must be true. Without this a cached
  // fact could outrank fresh evidence.
  const brief = buildKnownBrief(FACTS, FACTS.map((f) => fresh(f.fact_key)));
  assert.match(brief.text, /prefer\nwhat you actually found/);
  assert.match(brief.text, /this list is what we knew, not what must be true/);
});

/* ── nothing to say ──────────────────────────────────────────────────── */

test('an empty graph produces no brief at all', () => {
  // A first verification must look exactly as it does today.
  for (const facts of [null, undefined, []]) {
    assert.equal(buildKnownBrief(facts, [fresh('project.floors')]).text, '');
  }
});

test('a fact with no value is not briefed', () => {
  const brief = buildKnownBrief(
    [{ fact_key: 'project.floors', value_text: '  ' }, { fact_key: 'amenities.list', value_json: [] }],
    [fresh('project.floors'), fresh('amenities.list')]
  );
  assert.equal(brief.text, '');
});

test('a long value is truncated rather than flooding the prompt', () => {
  const brief = buildKnownBrief(
    [{ fact_key: 'project.identity', value_text: 'x'.repeat(5000) }],
    [fresh('project.identity')]
  );
  assert.ok(brief.text.length < 1000, 'one fact was allowed to dominate the prompt');
});

/* ── a fact key is not an identity ───────────────────────────────────
 *
 * All of these are regressions from one production run. The graph held the
 * subject unit (4 facts) and eleven comparable listings (~90 facts). Because
 * the brief matched facts to freshness verdicts by fact_key alone, one fresh
 * `listing.price` admitted every `listing.price` in the graph, and the brief
 * introduced five strangers' asking prices as established fact about this
 * flat. It was also more expensive: handed five contradictory prices for one
 * property, the market stage searched harder, not less.
 */

const SUBJECT = 'entity-subject';
const PROJECT = 'entity-project';
const OTHER_FLAT = 'entity-comparable';

const scope = {
  subjectEntityId: SUBJECT,
  related: [{ id: PROJECT, entityType: 'PROJECT', naturalKey: 'p', relation: 'PART_OF_PROJECT' }],
};

const freshOf = (entityId, factKey) => ({ factKey, entityId, state: 'FRESH', ageHours: 1, maxAgeHours: 24, freshnessClass: 'HIGH_VOLATILITY', reason: 'fresh' });
const staleOf = (entityId, factKey) => ({ factKey, entityId, state: 'STALE', ageHours: 99, maxAgeHours: 24, freshnessClass: 'HIGH_VOLATILITY', reason: 'stale' });

test('one fresh listing does not vouch for another listing of the same key', () => {
  const brief = buildKnownBrief(
    [
      { entity_id: SUBJECT, fact_key: 'listing.price', value_number: 114985 },
      { entity_id: OTHER_FLAT, fact_key: 'listing.price', value_number: 85000 },
    ],
    [freshOf(SUBJECT, 'listing.price'), staleOf(OTHER_FLAT, 'listing.price')],
    scope
  );
  assert.match(brief.text, /114985/);
  assert.doesNotMatch(brief.text, /85000/, "another property's asking price was briefed as this one's");
});

test("a comparable's facts are never briefed at all", () => {
  // Not the subject, not lineage — somebody else's flat.
  const brief = buildKnownBrief(
    [{ entity_id: OTHER_FLAT, fact_key: 'listing.price', value_number: 85000 }],
    [freshOf(OTHER_FLAT, 'listing.price')],
    scope
  );
  assert.equal(brief.text, '');
  assert.deepEqual(brief.briefed, []);
});

test('a project fact is briefed as the project\'s, never as the unit\'s', () => {
  const brief = buildKnownBrief(
    [{ entity_id: PROJECT, fact_key: 'project.floors', value_text: '14' }],
    [freshOf(PROJECT, 'project.floors')],
    scope
  );
  assert.match(brief.text, /ESTABLISHED ABOUT WHAT THIS PROPERTY BELONGS TO/);
  assert.match(brief.text, /the development this property is part of\) project\.floors/);
  assert.doesNotMatch(brief.text, /ABOUT THIS EXACT PROPERTY[\s\S]*project\.floors/);
});

test('the two blocks stay separate when both are present', () => {
  const brief = buildKnownBrief(
    [
      { entity_id: SUBJECT, fact_key: 'parcel.code', value_text: '01.72.14.040.030' },
      { entity_id: PROJECT, fact_key: 'project.floors', value_text: '14' },
    ],
    [freshOf(SUBJECT, 'parcel.code'), freshOf(PROJECT, 'project.floors')],
    scope
  );
  const mine = brief.text.indexOf('parcel.code');
  const theirs = brief.text.indexOf('project.floors');
  const header = brief.text.indexOf('ESTABLISHED ABOUT WHAT THIS PROPERTY BELONGS TO');
  assert.ok(mine < header && header < theirs, 'the unit\'s facts and its project\'s were interleaved');
  assert.match(brief.text, /NOT of this unit unless your own research shows it is/);
});

test('an identified key never falls back to key-only matching', () => {
  // The fallback exists for callers that carry no entity at all. It must not
  // become a way back into the bug for a fact whose key is identified.
  const brief = buildKnownBrief(
    [{ entity_id: OTHER_FLAT, fact_key: 'listing.price', value_number: 85000 }],
    [freshOf(SUBJECT, 'listing.price')],
    scope
  );
  assert.equal(brief.text, '');
});

/* ── a brief is not free, and an irrelevant one is expensive ─────────
 *
 * The brief was built once per run and given to every stage. Market — whose
 * job is comparables and asking prices — was handed the developer's directors
 * and the project's amenities, followed by "spend your searches on what is
 * missing". For market everything it cares about WAS missing, so that reads
 * as an instruction to search harder. It did: 56,017 tokens and 4 searches
 * with no brief, 86,206 and 8 the first run it got one.
 */

test('a stage is briefed only on facts within its own remit', () => {
  const facts = [
    { fact_key: 'parcel.code', value_text: '01.72.14.040.030' },
    { fact_key: 'project.floors', value_number: 7 },
    { fact_key: 'listing.price', value_number: 102000 },
  ];
  assert.deepEqual(briefFactsForStage(facts, 'market').map((f) => f.fact_key), ['listing.price']);
  assert.deepEqual(briefFactsForStage(facts, 'public_research').map((f) => f.fact_key), ['project.floors']);
  // identity gets project.floors too, because identity is the stage that
  // WRITES the project block. Scoped to what it merely establishes, it
  // returned floors: null on a property whose graph held 7.
  assert.deepEqual(
    briefFactsForStage(facts, 'identity').map((f) => f.fact_key),
    ['parcel.code', 'project.floors']
  );
});

test('identity is briefed on every part of the project block it writes', () => {
  // The exact regression: identity's schema carries the project's floors,
  // buildings, unit counts, aliases and amenities. Brief it on only the three
  // facts it is responsible for establishing and the report loses the rest.
  const facts = [
    { fact_key: 'project.floors', value_number: 7 },
    { fact_key: 'project.buildings', value_number: 1 },
    { fact_key: 'project.units', value_number: 48 },
    { fact_key: 'project.aliases', value_json: ['a'] },
    { fact_key: 'amenities.list', value_json: ['Elevator'] },
    { fact_key: 'address.full', value_text: '18 Kristian Stiven Street' },
    { fact_key: 'building.structure', value_text: 'concrete' },
  ];
  const got = briefFactsForStage(facts, 'identity').map((f) => f.fact_key).sort();
  assert.deepEqual(got, facts.map((f) => f.fact_key).sort(),
    'identity was starved of a field it is about to be asked to produce');
});

test('a stage we know nothing useful for is briefed on nothing', () => {
  // Not an empty heading, not a list of somebody else's facts — nothing. That
  // is the honest representation of "we hold nothing that helps you", and it
  // is what market gets on a property whose own listing facts we do not hold.
  const facts = [
    { fact_key: 'project.floors', value_number: 7 },
    { fact_key: 'company.name', value_text: 'LLC Geo City Digomi' },
  ];
  assert.deepEqual(briefFactsForStage(facts, 'market'), []);
});

test('scoping never lets a stage lose a fact it is meant to have', () => {
  // The inverse failure: over-tight scoping would quietly starve a stage of
  // reuse and put the cost straight back.
  const facts = [
    { fact_key: 'listing.price', value_number: 1 },
    { fact_key: 'listing.status', value_text: 'ACTIVE' },
    { fact_key: 'market.medianPricePerSqm', value_number: 2 },
  ];
  assert.equal(briefFactsForStage(facts, 'market').length, 3);
});

test('synthesis is briefed on nothing at all', () => {
  // It reasons over the evidence this run gathered. A separate list of
  // remembered facts would be a second, unciteable source.
  const facts = [{ fact_key: 'parcel.code', value_text: 'x' }, { fact_key: 'listing.price', value_number: 1 }];
  assert.deepEqual(briefFactsForStage(facts, 'synthesis'), []);
});
