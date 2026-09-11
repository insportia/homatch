// The benchmark that decides whether reuse routing may be switched on.
//
// §17 forbids shipping cheaper routing unless quality is materially
// equivalent or better. "Quality" for a routing decision is not the prose of
// the report — that is the synthesis model's job and synthesis always runs.
// It is narrower and answerable:
//
//   DOES THE REPORT STILL REST ON THE SAME FACTS?
//
// A stage may be skipped only if every fact it would have established is
// already held, fresh, uncontradicted, and applicable to this kind of
// property. If that holds, the synthesis receives the same inputs and the
// Buyer Intelligence is equivalent by construction rather than by hope.
//
// So this file runs the six archetypes through the planner at four states of
// knowledge and asserts, for each, that:
//
//   1. nothing transaction-critical is ever skipped;
//   2. a stage is only skipped when its facts are genuinely all in hand;
//   3. the saving is real when it is claimed.
//
// Where quality does not justify skipping a stage, the stage stays and the
// reason is asserted rather than assumed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planVerification, STAGE_FACTS, ALWAYS_VERIFY } from '../stagePlan.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-11T12:00:00Z');
const at = (h) => new Date(NOW - h * HOUR).toISOString();

/** The policy exactly as the migration seeds it. */
const POLICIES = [
  { fact_key_pattern: 'ownership.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'encumbrance.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'rights.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'registry.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'listing.price', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'listing.status', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'listing.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'market.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'company.representation', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'company.status', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'company.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'commissioning.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'construction.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'permit.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'amenities.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 2160 },
  { fact_key_pattern: 'project.identity', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'project.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'building.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'address.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'location.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 4320 },
  { fact_key_pattern: 'parcel.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
];

const ASSET_CLASS = {
  'A development apartment': 'APARTMENT_IN_PROJECT',
  'B resale apartment': 'PRIVATE_RESALE',
  'C land': 'LAND',
  'D private house': 'PRIVATE_HOUSE',
  'E commercial': 'COMMERCIAL',
  'F unknown': 'MIXED_OR_UNKNOWN',
};

/** Every fact family a given archetype can actually have, fully populated. */
function completeGraphFor(archetype) {
  const cls = ASSET_CLASS[archetype];
  const keys = [];
  for (const [stage, families] of Object.entries(STAGE_FACTS)) {
    void stage;
    for (const fam of families) {
      // Mirrors the planner's own applicability rule, so "complete" means
      // complete for THIS kind of property rather than for an apartment.
      const excluded = {
        LAND: ['building.', 'amenities.', 'commissioning.', 'construction.', 'project.'],
        PRIVATE_RESALE: ['commissioning.', 'permit.', 'project.', 'amenities.'],
        RENTAL: ['commissioning.', 'permit.', 'project.', 'amenities.'],
        PRIVATE_HOUSE: ['commissioning.', 'project.', 'amenities.'],
      }[cls] ?? [];
      if (excluded.some((e) => fam === e || fam.startsWith(e))) continue;
      keys.push(fam.endsWith('.') ? `${fam}value` : fam);
    }
  }
  return [...new Set(keys)];
}

const held = (keys, hoursAgo) =>
  keys.map((k) => ({ fact_key: k, status: 'CURRENT', last_verified_at: at(hoursAgo) }));

/* ── the four states of knowledge ────────────────────────────────────── */

const STATES = {
  'nothing known': () => [],
  'everything known and fresh': (a) => held(completeGraphFor(a), 0.5),
  'everything known but a day old': (a) => held(completeGraphFor(a), 25),
  'everything known but a year old': (a) => held(completeGraphFor(a), 400 * 24),
};

for (const archetype of Object.keys(ASSET_CLASS)) {
  for (const [state, build] of Object.entries(STATES)) {
    test(`${archetype} / ${state}: the registry is never skipped`, () => {
      // The invariant that decides whether any of this may ship. A stale
      // market comparable costs a buyer a worse negotiation; a stale mortgage
      // record costs them the flat.
      const plan = planVerification(build(archetype), POLICIES, NOW, ASSET_CLASS[archetype]);
      assert.ok(!plan.wouldSkip.includes('official_collection'),
        `${archetype} would skip the registry when ${state}`);
      assert.ok(!plan.wouldSkip.includes('synthesis'),
        `${archetype} would not write a report when ${state}`);
    });

    test(`${archetype} / ${state}: a skipped stage has nothing left to find`, () => {
      // This is the quality argument, stated as a check rather than a hope:
      // a stage is skipped only when every applicable fact it establishes is
      // already held and fresh, so the synthesis receives the same inputs.
      const plan = planVerification(build(archetype), POLICIES, NOW, ASSET_CLASS[archetype]);
      for (const stage of plan.wouldSkip) {
        const d = plan.decisions.find((x) => x.stage === stage);
        assert.equal(d.missing.length, 0, `${stage} skipped with ${d.missing.length} facts missing`);
        assert.equal(d.stale.length, 0, `${stage} skipped with ${d.stale.length} facts stale`);
        assert.equal(d.conflicting.length, 0, `${stage} skipped with contradicted facts`);
        assert.ok(d.reused.length > 0, `${stage} skipped while reusing nothing`);
      }
    });
  }

  test(`${archetype}: knowing nothing researches everything`, () => {
    const plan = planVerification([], POLICIES, NOW, ASSET_CLASS[archetype]);
    assert.equal(plan.wouldSkip.length, 0, `${archetype} skipped a stage knowing nothing`);
  });

  test(`${archetype}: a year-old graph researches everything again`, () => {
    // Old is not wrong, but it is not usable without re-checking either.
    const plan = planVerification(held(completeGraphFor(archetype), 400 * 24), POLICIES, NOW, ASSET_CLASS[archetype]);
    assert.equal(plan.wouldSkip.length, 0, `${archetype} reused a year-old graph`);
  });

  test(`${archetype}: a complete fresh graph does save something`, () => {
    // The other direction: an invariant that never skipped anything would
    // satisfy every safety check above and deliver nothing.
    const plan = planVerification(held(completeGraphFor(archetype), 0.5), POLICIES, NOW, ASSET_CLASS[archetype]);
    assert.ok(plan.reusableFacts > 0, `${archetype} reuses nothing when fully known`);
    assert.ok(plan.wouldSkip.length > 0, `${archetype} saves nothing when fully known`);
  });
}

/* ── what the ladder is allowed to do ────────────────────────────────── */

test('the always-verified set is exactly the registry and the report', () => {
  assert.deepEqual([...ALWAYS_VERIFY].sort(), ['official_collection', 'synthesis']);
});

test('the transaction-critical families belong to the always-verified stage', () => {
  // Were ownership or encumbrances ever to move to a skippable stage, the
  // rule above would keep passing while protecting nothing.
  for (const critical of ['ownership.', 'encumbrance.', 'rights.', 'registry.']) {
    assert.ok(STAGE_FACTS.official_collection.includes(critical),
      `${critical} is no longer covered by a stage that always runs`);
  }
});

test('a day-old market is re-researched even when everything else is reusable', () => {
  // An asking price is only current while it is being asked. This is the
  // case that keeps a repeat Verify honest rather than merely cheap.
  const keys = completeGraphFor('A development apartment');
  const facts = keys.map((k) => ({
    fact_key: k,
    status: 'CURRENT',
    last_verified_at: k.startsWith('listing.') || k.startsWith('market.') ? at(30) : at(0.5),
  }));
  const plan = planVerification(facts, POLICIES, NOW, 'APARTMENT_IN_PROJECT');
  assert.ok(!plan.wouldSkip.includes('market'), 'a day-old market was reused');
  assert.ok(plan.wouldSkip.includes('public_research'), 'nothing else was reused either');
});
