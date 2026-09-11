// What the research is told we already know.
//
// This is how the saving is actually taken, so it is also where a saving
// could quietly buy a worse report. The tests below are mostly about what
// must NOT be in the brief.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnownBrief, briefable } from '../knownBrief.ts';

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
