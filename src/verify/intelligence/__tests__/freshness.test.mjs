// Whether what we already know is good enough to lean on.
//
// This is the decision that makes a verification cheap or expensive, and it
// is also the decision that can quietly make one WRONG. Reusing a mortgage
// record from three weeks ago is not a saving, it is a report that says a
// property is unencumbered when it may no longer be.
//
// So the tests below are as much about refusing to reuse as about reusing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  policyFor,
  assessFact,
  planRefresh,
  compareSource,
} from '../freshness.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-11T12:00:00Z');
const agoHours = (h) => new Date(NOW - h * HOUR).toISOString();

/** The policy as the migration actually seeds it. */
const POLICIES = [
  { fact_key_pattern: 'ownership.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'encumbrance.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'listing.price', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 24 },
  { fact_key_pattern: 'listing.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'commissioning.', freshness_class: 'MEDIUM_VOLATILITY', max_age_hours: 336 },
  { fact_key_pattern: 'building.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
];

const fact = (over = {}) => ({
  fact_key: 'ownership.owner',
  status: 'CURRENT',
  last_verified_at: agoHours(1),
  ...over,
});

/* ── which policy governs a fact ─────────────────────────────────────── */

test('a prefix covers every fact of that kind', () => {
  assert.equal(policyFor('encumbrance.mortgage', POLICIES).max_age_hours, 6);
  assert.equal(policyFor('encumbrance.seizure', POLICIES).max_age_hours, 6);
});

test('an exact rule beats the prefix it sits inside', () => {
  // 'listing.price' can be governed more tightly than 'listing.' without the
  // general rule having to know it exists.
  assert.equal(policyFor('listing.price', POLICIES).max_age_hours, 24);
  assert.equal(policyFor('listing.condition', POLICIES).max_age_hours, 336);
});

test('the more specific prefix wins', () => {
  const p = [
    { fact_key_pattern: 'a.', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
    { fact_key_pattern: 'a.b.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 1 },
  ];
  assert.equal(policyFor('a.b.c', p).max_age_hours, 1);
  assert.equal(policyFor('a.x', p).max_age_hours, 8760);
});

test('a fact kind nobody has written a policy for has none', () => {
  assert.equal(policyFor('something.nobody.considered', POLICIES), null);
  assert.equal(policyFor('ownership.owner', []), null);
  assert.equal(policyFor('', POLICIES), null);
});

/* ── judging one fact ────────────────────────────────────────────────── */

test('a recently verified high-volatility fact is fresh', () => {
  const a = assessFact('ownership.owner', fact({ last_verified_at: agoHours(2) }), POLICIES, NOW);
  assert.equal(a.state, 'FRESH');
  assert.equal(a.freshnessClass, 'HIGH_VOLATILITY');
});

test('ownership from yesterday is not fresh, and a floor count from last year is', () => {
  // The whole reason freshness is per fact kind rather than one TTL.
  const owner = assessFact('ownership.owner', fact({ last_verified_at: agoHours(30) }), POLICIES, NOW);
  const floors = assessFact('building.floors', fact({ fact_key: 'building.floors', last_verified_at: agoHours(30 * 24) }), POLICIES, NOW);
  assert.equal(owner.state, 'STALE');
  assert.match(owner.reason, /policy allows 6h/);
  assert.equal(floors.state, 'FRESH');
});

test('a fact we do not hold is missing, not stale', () => {
  // Different reasons, and later the same distinction decides whether a whole
  // stage runs or only part of one.
  assert.equal(assessFact('ownership.owner', null, POLICIES, NOW).state, 'MISSING');
  assert.equal(assessFact('ownership.owner', undefined, POLICIES, NOW).state, 'MISSING');
});

test('a superseded fact is history, not knowledge', () => {
  assert.equal(assessFact('ownership.owner', fact({ status: 'SUPERSEDED' }), POLICIES, NOW).state, 'MISSING');
});

test('a contradicted fact is never reused, however recent', () => {
  const a = assessFact('ownership.owner', fact({ status: 'CONFLICTING', last_verified_at: agoHours(0.1) }), POLICIES, NOW);
  assert.equal(a.state, 'CONFLICTING');
});

test('a fact with no policy is treated as stale, not as fresh', () => {
  // The safe direction, deliberately. An unknown fact kind is one nobody has
  // thought about; assuming it ages slowly would silently reuse something
  // that might change hourly. One re-check is the cost of being wrong here.
  const a = assessFact('something.nobody.considered', fact({ fact_key: 'something.nobody.considered' }), POLICIES, NOW);
  assert.equal(a.state, 'STALE');
  assert.match(a.reason, /no freshness policy/);
});

test('a fact that was never verified is stale, not fresh', () => {
  const a = assessFact('ownership.owner', fact({ last_verified_at: null }), POLICIES, NOW);
  assert.equal(a.state, 'STALE');
  assert.match(a.reason, /never verified/);
});

test('the boundary is exclusive: exactly at the limit is still fresh', () => {
  assert.equal(assessFact('ownership.owner', fact({ last_verified_at: agoHours(6) }), POLICIES, NOW).state, 'FRESH');
  assert.equal(assessFact('ownership.owner', fact({ last_verified_at: agoHours(6.01) }), POLICIES, NOW).state, 'STALE');
});

/* ── deciding what to pay for ────────────────────────────────────────── */

test('a verification pays only for what it does not already know', () => {
  const held = [
    { fact_key: 'building.floors', status: 'CURRENT', last_verified_at: agoHours(200 * 24) },
    { fact_key: 'commissioning.status', status: 'CURRENT', last_verified_at: agoHours(100) },
    { fact_key: 'ownership.owner', status: 'CURRENT', last_verified_at: agoHours(72) },
  ];
  const plan = planRefresh(
    ['building.floors', 'commissioning.status', 'ownership.owner', 'encumbrance.mortgage'],
    held, POLICIES, NOW
  );
  assert.deepEqual(plan.reuse.map((a) => a.factKey), ['building.floors', 'commissioning.status']);
  assert.deepEqual(
    plan.refresh.map((a) => `${a.factKey}:${a.state}`).sort(),
    ['encumbrance.mortgage:MISSING', 'ownership.owner:STALE']
  );
  assert.equal(plan.needsResearch, true);
  assert.match(plan.reason, /1 missing/);
  assert.match(plan.reason, /1 stale/);
  assert.match(plan.reason, /2 reused/);
});

test('knowing everything, freshly, means paying for nothing', () => {
  const held = [
    { fact_key: 'ownership.owner', status: 'CURRENT', last_verified_at: agoHours(1) },
    { fact_key: 'building.floors', status: 'CURRENT', last_verified_at: agoHours(24) },
  ];
  const plan = planRefresh(['ownership.owner', 'building.floors'], held, POLICIES, NOW);
  assert.equal(plan.needsResearch, false);
  assert.equal(plan.refresh.length, 0);
  assert.equal(plan.reason, '2 reused');
});

test('knowing nothing means researching everything', () => {
  const plan = planRefresh(['ownership.owner', 'encumbrance.mortgage'], [], POLICIES, NOW);
  assert.equal(plan.needsResearch, true);
  assert.equal(plan.reuse.length, 0);
  assert.ok(plan.refresh.every((a) => a.state === 'MISSING'));
});

test('a repeated required key is asked about once', () => {
  const plan = planRefresh(['ownership.owner', 'ownership.owner'], [], POLICIES, NOW);
  assert.equal(plan.refresh.length, 1);
});

test('the plan explains itself, for the record rather than for the customer', () => {
  const plan = planRefresh(['ownership.owner'], [], POLICIES, NOW);
  assert.ok(plan.reason.length > 0);
  assert.ok(plan.refresh[0].reason.length > 0, 'a refreshed fact does not say why it is being paid for');
});

/* ── has the source itself changed ───────────────────────────────────── */

test('the same hash means nothing to re-interpret', () => {
  assert.equal(compareSource({ content_hash: 'abc' }, { content_hash: 'abc' }), 'UNCHANGED');
  assert.equal(compareSource({ content_hash: 'abc' }, { content_hash: 'def' }), 'CHANGED');
});

test('a document revision is as good as a hash', () => {
  // Often the only thing an official source exposes.
  assert.equal(compareSource({ source_ref: 'extract-2025-07-14' }, { source_ref: 'extract-2025-07-14' }), 'UNCHANGED');
  assert.equal(compareSource({ source_ref: 'extract-2025-07-14' }, { source_ref: 'extract-2026-09-11' }), 'CHANGED');
});

test('a hash beats a reference when both are present', () => {
  assert.equal(compareSource(
    { content_hash: 'abc', source_ref: 'v1' },
    { content_hash: 'abc', source_ref: 'v2' }
  ), 'UNCHANGED');
});

test('not being able to tell is never the same as unchanged', () => {
  // The first source that stops exposing a version would otherwise silently
  // freeze its facts for ever.
  assert.equal(compareSource(null, { content_hash: 'abc' }), 'UNKNOWN');
  assert.equal(compareSource({ content_hash: 'abc' }, null), 'UNKNOWN');
  assert.equal(compareSource({}, {}), 'UNKNOWN');
  assert.equal(compareSource({ content_hash: '  ' }, { content_hash: 'abc' }), 'UNKNOWN');
});

/* ── the policy in the database matches the policy in the tests ──────── */

test('the seeded policy covers every volatility class the mandate names', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260911230000_intelligence_graph.sql'),
    'utf8'
  );
  // High volatility: the facts a buyer is actually exposed to between
  // agreeing a price and signing.
  for (const key of ['ownership.', 'encumbrance.', 'rights.', 'registry.', 'listing.price', 'listing.status', 'company.representation']) {
    assert.match(sql, new RegExp(`'${key.replace('.', '\\.')}'[^\\n]*HIGH_VOLATILITY`), `${key} is not treated as high volatility`);
  }
  for (const key of ['commissioning.', 'construction.', 'permit.', 'company.status']) {
    assert.match(sql, new RegExp(`'${key.replace('.', '\\.')}'[^\\n]*MEDIUM_VOLATILITY`), `${key} is not medium volatility`);
  }
  for (const key of ['building.', 'address.', 'parcel.']) {
    assert.match(sql, new RegExp(`'${key.replace('.', '\\.')}'[^\\n]*LOW_VOLATILITY`), `${key} is not low volatility`);
  }
  // And it is a table, so the thresholds are a business judgement rather than
  // a deploy.
  assert.match(sql, /create table if not exists public\.intelligence_freshness_policy/);
});

test('private sources have no way into the fact layer', () => {
  // Enforced by a CHECK rather than by a convention: there is deliberately no
  // source_kind for an uploaded contract, a private note, a chat message, an
  // unverified user claim or a model's prose.
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260911230000_intelligence_graph.sql'),
    'utf8'
  );
  const block = sql.slice(sql.indexOf('source_kind text not null check'), sql.indexOf('source_kind text not null check') + 500);
  for (const f of ['USER_UPLOAD', 'PRIVATE_DOCUMENT', 'DEAL_ROOM', 'CHAT', 'USER_CLAIM', 'MODEL_PROSE']) {
    assert.ok(!block.includes(f), `${f} can be written into shared intelligence`);
  }
  assert.ok(block.includes('OFFICIAL_REGISTRY'));
  assert.ok(block.includes('DETERMINISTIC_DERIVATION'));
});
