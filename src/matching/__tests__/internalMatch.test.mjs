// HOMATCH INTERNAL MATCHES — the demo buyer is scored by the native engine, and the
// page counts internal members and external leads apart.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  factorLines,
  groupByPerson,
  profileFields,
  scoreDemoMatch,
  sectionCounts,
  storedFactorLines,
} from '../internalMatch.ts';
import { assessMatch } from '../../research-core/match/compatibility.ts';
import {
  NATIVE_MIN_AGREEMENTS,
  demandSideFromIntentProfile,
  strengthFromCriteria,
  supplySideFromProperty,
} from '../../research-core/match/native-pair.ts';

/* The seeded demo buyer (20261024120000_internal_match_demo.sql). */
const PROFILE = {
  id: 'd1', demo_key: 'internal-match-demo-244486', property_id: 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407', is_demo: true, display_label: 'DEMO',
  intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', districts: ['Krtsanisi', 'Ortachala'], property_types: ['APARTMENT'],
  budget_min: 190000, budget_max: 235000, currency: 'USD', bedrooms_min: 2, bedrooms_max: 2, rooms_min: null, rooms_max: null,
  area_min: 85, area_max: 115, timeline_months: 3, search_criteria: {},
};
/* HOMATCH 244486 as property_facts holds it in production (2026-10-09). PostgREST
   returns numerics as strings sometimes; the mapping must not care. */
const PROPERTY = { id: 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407', homatch_id: 244486, transaction_type: 'SALE', property_type: 'APARTMENT', listed_by_role: 'OWNER' };
const FACTS = { city: 'Tbilisi', district: 'Krtsanisi', total_price: '213840', currency: 'USD', area: '97.2', rooms: 3, bedrooms: 2 };

test('the demo buyer against HOMATCH 244486: the engine says COMPATIBLE and STRONG', () => {
  const scored = scoreDemoMatch({ profile: PROFILE, property: PROPERTY, facts: FACTS });
  assert.equal(scored.assessment.compatibility, 'COMPATIBLE');
  assert.equal(scored.band, 'STRONG');
  assert.ok(scored.percent >= 80 && scored.percent <= 100, `percent ${scored.percent}`);
  for (const d of ['TRANSACTION', 'CITY', 'DISTRICT', 'PROPERTY_TYPE', 'PRICE', 'AREA', 'BEDROOMS']) {
    assert.ok(scored.assessment.agreed.includes(d), `${d} agrees`);
  }
});

test('the score is the engine\'s, not a number written down anywhere', () => {
  /* Recompute with assessMatch directly over the worker's mapping: identical. */
  const demand = demandSideFromIntentProfile({
    intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', district: 'Krtsanisi', property_types: ['APARTMENT'],
    budget_min: 190000, budget_max: 235000, currency: 'USD', area_min: 85, area_max: 115, bedrooms_min: 2, bedrooms_max: 2,
    rooms_min: null, rooms_max: null,
  }, strengthFromCriteria({}));
  const supply = supplySideFromProperty(PROPERTY, { ...FACTS, total_price: 213840, area: 97.2 });
  const direct = assessMatch(demand, supply, { minAgreements: NATIVE_MIN_AGREEMENTS });
  const scored = scoreDemoMatch({ profile: PROFILE, property: PROPERTY, facts: FACTS });
  assert.equal(scored.assessment.score, direct.score);
  assert.deepEqual(scored.assessment.agreed, direct.agreed);
  /* And it moves with the facts: a price change the owner makes changes the result. */
  const pricier = scoreDemoMatch({ profile: PROFILE, property: PROPERTY, facts: { ...FACTS, total_price: 400000 } });
  assert.equal(pricier.assessment.compatibility, 'INCOMPATIBLE', 'a price far above the stated budget conflicts');
  assert.ok(pricier.assessment.conflicted.includes('PRICE'));
});

test('a mismatch: a rental is never a match for a purchase', () => {
  const scored = scoreDemoMatch({ profile: PROFILE, property: { ...PROPERTY, transaction_type: 'RENT' }, facts: { ...FACTS, total_price: 1200 } });
  assert.notEqual(scored.assessment.compatibility, 'COMPATIBLE');
  assert.equal(scored.band, 'NONE');
  assert.equal(scored.percent, 0);
});

test('a mismatch: a district outside the preference ranks lower, it does not disqualify', () => {
  const scored = scoreDemoMatch({ profile: PROFILE, property: PROPERTY, facts: { ...FACTS, district: 'Vake' } });
  assert.equal(scored.assessment.compatibility, 'COMPATIBLE');
  assert.ok(scored.assessment.preferenceMisses.includes('DISTRICT'));
  assert.ok(scored.assessment.score < 1);
});

test('profile fields: confirmed vs not provided, never guessed', () => {
  const fields = Object.fromEntries(profileFields(PROFILE).map((f) => [f.key, f]));
  assert.equal(fields.intent.state, 'CONFIRMED');
  assert.equal(fields.budget.state, 'CONFIRMED');
  assert.deepEqual(fields.locations.districts, ['Krtsanisi', 'Ortachala']);
  assert.equal(fields.rooms.state, 'NOT_PROVIDED', 'rooms were not stated');
  assert.equal(fields.timeline.state, 'CONFIRMED');
  const bare = Object.fromEntries(profileFields({ ...PROFILE, timeline_months: null, area_min: null, area_max: null, districts: [] }).map((f) => [f.key, f]));
  assert.equal(bare.timeline.state, 'NOT_PROVIDED');
  assert.equal(bare.area.state, 'NOT_PROVIDED');
  assert.equal(bare.locations.state, 'CONFIRMED', 'the city alone is still a stated location');
});

test('factor lines come from the engine; stored lines mark unknowns honestly', () => {
  const scored = scoreDemoMatch({ profile: PROFILE, property: PROPERTY, facts: FACTS });
  assert.equal(factorLines(scored.assessment).length, scored.assessment.dimensions.length);
  const stored = storedFactorLines(['CITY', 'PRICE'], ['DISTRICT']);
  assert.equal(stored.find((l) => l.dimension === 'CITY').verdict, 'AGREE');
  assert.equal(stored.find((l) => l.dimension === 'DISTRICT').verdict, 'PREFERENCE_MISS');
  assert.equal(stored.find((l) => l.dimension === 'AREA').verdict, 'UNKNOWN');
});

test('counts: internal and external are never summed; the demo is counted once, only when visible', () => {
  assert.deepEqual(sectionCounts({ internalPeople: 2, demoVisible: true, externalLeads: 5 }), { internal: 3, external: 5 });
  assert.deepEqual(sectionCounts({ internalPeople: 2, demoVisible: false, externalLeads: 5 }), { internal: 2, external: 5 });
  assert.deepEqual(sectionCounts({ internalPeople: 0, demoVisible: false, externalLeads: 0 }), { internal: 0, external: 0 });
});

test('one person, one card: a MATCH and a RELATIONSHIP for the same member group together', () => {
  const rows = [{ kind: 'MATCH', id: 'm1' }, { kind: 'RELATIONSHIP', id: 'r1' }, { kind: 'MATCH', id: 'm2' }];
  const keys = new Map([['MATCH:m1', 'k1'], ['RELATIONSHIP:r1', 'k1'], ['MATCH:m2', 'k2']]);
  assert.equal(groupByPerson(rows, keys).length, 2);
  /* Without keys nothing is merged: under-merging is honest, over-merging hides a person. */
  assert.equal(groupByPerson(rows, new Map()).length, 3);
});
