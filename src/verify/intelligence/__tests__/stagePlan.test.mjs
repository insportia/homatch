// Which stages a verification would have to run, given what we already know.
//
// Computed and recorded; acted on by nothing yet. That order is the point.
// You cannot benchmark a routing decision you have not measured, and a plan
// that turns out to propose skipping something a report needed should show up
// in a log rather than in somebody's due diligence.
//
// So these tests check the DECISION, and check hardest that it refuses to skip
// the things a wrong answer actually harms somebody over.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planVerification, STAGES, STAGE_FACTS, STAGE_REPORT_FACTS, ALWAYS_VERIFY } from '../stagePlan.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-11T12:00:00Z');
const agoHours = (h) => new Date(NOW - h * HOUR).toISOString();

const POLICIES = [
  { fact_key_pattern: 'ownership.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'encumbrance.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'rights.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'registry.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'listing.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'company.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'commissioning.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'construction.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'permit.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 720 },
  { fact_key_pattern: 'amenities.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 2160 },
  { fact_key_pattern: 'project.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'building.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'address.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'location.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 4320 },
  { fact_key_pattern: 'parcel.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
  { fact_key_pattern: 'market.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
];

const known = (key, hoursAgo) => ({
  fact_key: key, status: 'CURRENT', last_verified_at: agoHours(hoursAgo),
});

const decisionFor = (plan, stage) => plan.decisions.find((d) => d.stage === stage);

/* ── knowing nothing ─────────────────────────────────────────────────── */

test('a property we have never seen researches everything', () => {
  const plan = planVerification([], POLICIES, NOW);
  assert.equal(plan.wouldSkip.length, 0, 'a stage was skipped for a property we know nothing about');
  assert.equal(plan.reusableFacts, 0);
  assert.ok(plan.requiredFacts > 0);
  for (const s of STAGES) assert.equal(decisionFor(plan, s).wouldRun, true, `${s} would not run`);
});

test('a stage that has never run counts as missing, not as having nothing to do', () => {
  const plan = planVerification([], POLICIES, NOW);
  const pr = decisionFor(plan, 'public_research');
  assert.ok(pr.missing.length > 0, 'a stage with no facts at all reported nothing missing');
});

/* ── knowing everything ──────────────────────────────────────────────── */

test('a property fully known and fresh still verifies the registry', () => {
  // The whole safety property of the design. Ownership, mortgages and
  // seizures are what a buyer is exposed to between agreeing a price and
  // signing, and no amount of cached knowledge justifies not looking again.
  const held = [
    known('parcel.code', 1), known('address.full', 1), known('project.identity', 1),
    known('ownership.owner', 0.5), known('encumbrance.mortgage', 0.5), known('registry.state', 0.5),
    known('project.floors', 1), known('building.structure', 1), known('amenities.list', 1),
    known('commissioning.status', 1), known('construction.status', 1), known('permit.building', 1),
    known('location.district', 1), known('listing.price', 1), known('market.median', 1),
  ];
  const plan = planVerification(held, POLICIES, NOW);
  assert.ok(!plan.wouldSkip.includes('official_collection'), 'the registry check was skipped');
  assert.ok(!plan.wouldSkip.includes('synthesis'), 'the report was skipped');
  assert.match(decisionFor(plan, 'official_collection').reason, /always verified/);
});

test('everything else can be skipped when it is known and fresh', () => {
  const held = [
    known('parcel.code', 1), known('address.full', 1), known('project.identity', 1),
    known('project.floors', 1), known('building.structure', 1), known('amenities.list', 1),
    known('commissioning.status', 1), known('construction.status', 1), known('permit.building', 1),
    known('location.district', 1),
    known('listing.price', 1), known('market.median', 1),
  ];
  const plan = planVerification(held, POLICIES, NOW);
  assert.deepEqual(plan.wouldSkip.sort(), ['identity', 'market', 'public_research']);
  assert.ok(plan.reusableFacts > 0);
  assert.match(plan.summary, /would skip/);
});

/* ── knowing some of it ──────────────────────────────────────────────── */

test('one stale domain is paid for, and the rest is not', () => {
  // The mandate's own target: "one changed domain — pay mainly for that
  // domain".
  const held = [
    known('parcel.code', 1), known('address.full', 1), known('project.identity', 1),
    known('project.floors', 1), known('building.structure', 1), known('amenities.list', 1),
    known('commissioning.status', 1), known('construction.status', 1), known('permit.building', 1),
    known('location.district', 1),
    // The market went stale: an asking price is only current while it is asked.
    known('listing.price', 48), known('market.median', 48),
  ];
  const plan = planVerification(held, POLICIES, NOW);
  assert.ok(plan.wouldSkip.includes('identity'));
  assert.ok(plan.wouldSkip.includes('public_research'));
  assert.ok(!plan.wouldSkip.includes('market'), 'a stale market was reused');
  const market = decisionFor(plan, 'market');
  assert.deepEqual(market.stale.sort(), ['listing.price', 'market.median']);
  assert.match(market.reason, /stale/);
});

test('a building fact from last year is still good; an asking price from yesterday is not', () => {
  // The reason freshness is per fact kind rather than one TTL.
  const held = [
    known('building.structure', 300 * 24),
    known('project.floors', 300 * 24),
    known('listing.price', 30),
  ];
  const plan = planVerification(held, POLICIES, NOW);
  const pr = decisionFor(plan, 'public_research');
  assert.ok(pr.reused.includes('building.structure'), 'a year-old floor count was re-researched');
  const market = decisionFor(plan, 'market');
  assert.ok(market.stale.includes('listing.price'), 'a day-old asking price was reused');
});

test('a contradicted fact is always re-researched, however recent', () => {
  const held = [
    { fact_key: 'project.floors', status: 'CONFLICTING', last_verified_at: agoHours(0.1) },
  ];
  const plan = planVerification(held, POLICIES, NOW);
  assert.ok(decisionFor(plan, 'public_research').conflicting.includes('project.floors'));
  assert.ok(!plan.wouldSkip.includes('public_research'));
});

/* ── the decision explains itself ────────────────────────────────────── */

test('every stage says why it would or would not run', () => {
  const plan = planVerification([known('project.floors', 1)], POLICIES, NOW);
  for (const d of plan.decisions) {
    assert.ok(d.reason && d.reason.length > 3, `${d.stage} gives no reason`);
  }
  assert.ok(plan.summary.length > 0);
});

test('the plan counts what could be reused against what was needed', () => {
  const plan = planVerification([known('project.floors', 1), known('building.structure', 1)], POLICIES, NOW);
  assert.ok(plan.requiredFacts >= plan.reusableFacts);
  assert.ok(plan.reusableFacts >= 2);
});

/* ── the rules that must not quietly change ──────────────────────────── */

test('the registry and the report are never skippable', () => {
  assert.ok(ALWAYS_VERIFY.includes('official_collection'), 'the registry stage became skippable');
  assert.ok(ALWAYS_VERIFY.includes('synthesis'), 'the report stage became skippable');
});

test('the transaction-critical facts belong to the stage that is always verified', () => {
  // If ownership or encumbrances ever moved to a skippable stage, the
  // ALWAYS_VERIFY rule would still pass while protecting nothing.
  const official = STAGE_FACTS.official_collection;
  for (const critical of ['ownership.', 'encumbrance.', 'rights.', 'registry.']) {
    assert.ok(official.includes(critical), `${critical} is no longer covered by the always-verified stage`);
  }
});

test('every stage is accounted for', () => {
  for (const s of STAGES) {
    assert.ok(Array.isArray(STAGE_FACTS[s]), `${s} has no fact coverage declared`);
  }
});

/* ── nothing acts on it yet ──────────────────────────────────────────── */

test('the plan is recorded, not executed', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const agent = readFileSync(
    join(process.cwd(), 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8'
  );
  // Shadow mode: the orchestrator may compute and store the plan, and must
  // not yet branch on it. Shipping cheaper routing before a benchmark is
  // exactly what §17 forbids.
  assert.ok(!/wouldSkip\.includes\(/.test(agent), 'the pipeline is already skipping stages on an unbenchmarked plan');
  assert.ok(!/if \(plan\.wouldSkip/.test(agent), 'the pipeline branches on the shadow plan');
});

/* ── a stage is briefed on what it writes, judged on what it finds ───
 *
 * These are different maps and conflating them cost a real report its project
 * block. identity ESTABLISHES the parcel code, the address and the project
 * name; it WRITES the project's floors, buildings, unit counts, aliases and
 * amenities as well. Briefed off the first list and throttled because that
 * list was satisfied, it returned floors: null, buildings: null, unitCounts:
 * null on a property whose graph held 7, 1 and 48.
 */

test('identity is briefed on the whole project block it writes', () => {
  for (const needed of ['project.', 'amenities.', 'building.']) {
    assert.ok(
      STAGE_REPORT_FACTS.identity.includes(needed),
      `identity writes ${needed} into the report but is not briefed on it, so it will be asked for a field it was never given`
    );
  }
});

test('what a stage is judged on stays narrower than what it is briefed on', () => {
  // The judging list decides whether a stage still has work to do. Widening it
  // to everything a stage writes would mean a property with no amenities could
  // never satisfy identity, and identity could never be reused at all.
  for (const stage of STAGES) {
    for (const family of STAGE_FACTS[stage]) {
      assert.ok(
        STAGE_REPORT_FACTS[stage].some((p) => family === p || family.startsWith(p) || p.startsWith(family)),
        `${stage} is judged on ${family} but never briefed on it`
      );
    }
  }
});
