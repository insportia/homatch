// The safety half of the reuse benchmark.
//
// §17 of the mandate says not to ship cheaper routing unless quality is
// materially equivalent. Half of that is a measurement against real
// verifications, which is being collected in shadow. The other half can be
// stated as an invariant right now, and should be, because it is the half
// where being wrong harms somebody:
//
//   NO AMOUNT OF CACHED KNOWLEDGE MAY CAUSE A VERIFICATION TO STOP CHECKING
//   WHO OWNS THE PROPERTY AND WHAT IS REGISTERED AGAINST IT.
//
// A stale market comparable costs a buyer a slightly worse negotiation. A
// stale mortgage record costs them the flat. Those are not the same risk and
// the planner must never trade one for the other, whatever the cost target
// says.
//
// Every archetype is exercised, because a rule that holds for an apartment in
// a development and quietly fails for land is not a rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planVerification, STAGES } from '../stagePlan.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-11T12:00:00Z');
const agoHours = (h) => new Date(NOW - h * HOUR).toISOString();

const POLICIES = [
  { fact_key_pattern: 'ownership.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'encumbrance.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'rights.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'registry.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'company.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'listing.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'market.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'commissioning.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'construction.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'permit.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'amenities.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 2160 },
  { fact_key_pattern: 'project.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'building.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'address.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'location.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 4320 },
  { fact_key_pattern: 'parcel.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
];

const fresh = (key) => ({ fact_key: key, status: 'CURRENT', last_verified_at: agoHours(0.5) });

/*
 * What kind of property each archetype is.
 *
 * The planner needs it for the same reason the report does: a private resale
 * has no commissioning status to establish, and counting that as MISSING on
 * every run means public research can never be reused for one.
 */
const ASSET_CLASS = {
  'A development apartment': 'APARTMENT_IN_PROJECT',
  'B resale apartment': 'PRIVATE_RESALE',
  'C land': 'LAND',
  'D private house': 'PRIVATE_HOUSE',
  'E commercial': 'COMMERCIAL',
  'F unknown': 'MIXED_OR_UNKNOWN',
};

/**
 * The six archetypes, each with the graph as full and as fresh as it could
 * possibly be — the most favourable case reuse will ever see. If a stage can
 * be skipped unsafely, it happens here.
 */
const ARCHETYPES = {
  'A development apartment': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'encumbrance.mortgage', 'rights.restrictions', 'registry.state',
    'company.name', 'company.status', 'company.representation',
    'project.floors', 'project.units', 'building.structure', 'amenities.list',
    'commissioning.status', 'construction.status', 'permit.building', 'location.district',
    'listing.price', 'listing.status', 'market.median',
  ],
  'B resale apartment': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'encumbrance.mortgage', 'registry.state',
    'building.structure', 'construction.status', 'location.district',
    'listing.price', 'market.median',
  ],
  'C land': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'encumbrance.mortgage', 'rights.restrictions', 'registry.state',
    'permit.building', 'location.district',
    'listing.price', 'market.median',
  ],
  'D private house': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'encumbrance.mortgage', 'registry.state',
    'building.structure', 'construction.status', 'permit.building', 'location.district',
    'listing.price', 'market.median',
  ],
  'E commercial': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'encumbrance.mortgage', 'rights.restrictions', 'registry.state',
    'company.name', 'project.floors', 'building.structure', 'amenities.list',
    'commissioning.status', 'construction.status', 'permit.building', 'location.district',
    'listing.price', 'market.median',
  ],
  'F unknown': [
    'parcel.code', 'address.full', 'project.identity',
    'ownership.owner', 'registry.state',
    'location.district', 'market.median',
  ],
};

/* ── the invariant that must hold for every archetype ────────────────── */

for (const [archetype, keys] of Object.entries(ARCHETYPES)) {
  const assetClass = ASSET_CLASS[archetype];

  test(`${archetype}: the registry is re-checked even when everything is known and fresh`, () => {
    const plan = planVerification(keys.map(fresh), POLICIES, NOW, assetClass);
    assert.ok(
      !plan.wouldSkip.includes('official_collection'),
      `${archetype} would skip the registry check on cached knowledge`
    );
    assert.ok(
      !plan.wouldSkip.includes('synthesis'),
      `${archetype} would not produce a report`
    );
  });

  test(`${archetype}: reuse is possible at all`, () => {
    // The other direction. An invariant that made every stage always run
    // would pass the test above and deliver nothing.
    const plan = planVerification(keys.map(fresh), POLICIES, NOW, assetClass);
    assert.ok(plan.reusableFacts > 0, `${archetype} reuses nothing even when fully known`);
    assert.ok(
      plan.wouldSkip.length > 0,
      `${archetype} cannot skip anything even with a complete fresh graph`
    );
  });
}

/* ── and when the property is transacting ────────────────────────────── */

test('a property about to change hands re-checks ownership however recently it was seen', () => {
  // Six hours is the policy for ownership precisely because it can change
  // between agreeing a price and signing. Even at thirty minutes old, the
  // registry stage still runs — that is the ALWAYS_VERIFY rule, not the
  // freshness window, and it is the belt to the freshness braces.
  const plan = planVerification(
    Object.values(ARCHETYPES)[0].map(fresh),
    POLICIES.map((p) => ({ ...p, max_age_hours: 99999 })),
    NOW
  );
  assert.ok(!plan.wouldSkip.includes('official_collection'),
    'a permissive freshness policy was enough to skip the registry');
});

test('an empty freshness policy never makes everything look fresh', () => {
  // A fact kind with no policy is STALE, not fresh. Losing the policy table
  // must degrade to researching more, never to researching less.
  const plan = planVerification(Object.values(ARCHETYPES)[0].map(fresh), [], NOW);
  assert.equal(plan.wouldSkip.length, 0, 'losing the policy table made everything reusable');
  assert.equal(plan.reusableFacts, 0);
});

test('a graph full of stale facts researches everything', () => {
  const old = Object.values(ARCHETYPES)[0].map((k) => ({
    fact_key: k, status: 'CURRENT', last_verified_at: agoHours(400 * 24),
  }));
  const plan = planVerification(old, POLICIES, NOW);
  assert.equal(plan.wouldSkip.length, 0, 'a two-year-old graph was treated as usable');
});

test('every stage is considered, for every archetype', () => {
  for (const [archetype, keys] of Object.entries(ARCHETYPES)) {
    const plan = planVerification(keys.map(fresh), POLICIES, NOW, ASSET_CLASS[archetype]);
    assert.equal(plan.decisions.length, STAGES.length, `${archetype} did not consider every stage`);
    for (const d of plan.decisions) {
      assert.ok(d.reason && d.reason.length > 3, `${archetype}/${d.stage} gives no reason`);
    }
  }
});

/* ── what the saving would actually be ───────────────────────────────── */

test('the best case is measured, not assumed', () => {
  // The CEILING — a complete, fresh graph for each archetype. Real
  // verifications land below it, and the shadow plan running in production is
  // what will say how far below.
  const rows = [];
  for (const [archetype, keys] of Object.entries(ARCHETYPES)) {
    const plan = planVerification(keys.map(fresh), POLICIES, NOW, ASSET_CLASS[archetype]);
    rows.push({
      archetype,
      reusable: plan.reusableFacts,
      required: plan.requiredFacts,
      skipped: plan.wouldSkip.slice().sort().join('+') || 'none',
    });
  }

  // Identity is reusable for every archetype: a property does not stop being
  // itself, so re-establishing which one it is, and which parcel it sits in,
  // is the clearest waste the graph removes.
  for (const r of rows) {
    assert.ok(r.skipped.includes('identity'), `${r.archetype} cannot reuse its own identity`);
  }

  // Public research is reusable once its applicable families are all held.
  // Deliberately NOT asserted for the unknown archetype: a property we cannot
  // classify holds little and should keep researching, which is the correct
  // behaviour rather than a gap.
  for (const r of rows.filter((x) => x.archetype !== 'F unknown')) {
    assert.ok(
      r.skipped.includes('public_research'),
      `${r.archetype} cannot reuse the building it is in (${r.skipped})`
    );
  }
  assert.ok(
    !rows.find((r) => r.archetype === 'F unknown').skipped.includes('public_research'),
    'an unclassified property stopped researching its own building'
  );

  // And the registry is skipped by none of them, in any case.
  for (const r of rows) {
    assert.ok(!r.skipped.includes('official'), `${r.archetype} would skip the registry`);
    assert.ok(r.reusable > 0 && r.reusable <= r.required);
  }
});
