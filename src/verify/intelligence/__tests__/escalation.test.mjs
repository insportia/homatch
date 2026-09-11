// How hard a stage works, given what is already known.
//
// This is where the web-search bill actually falls, and also where a saving
// could quietly buy a worse report. The tests are weighted accordingly: most
// of them are about refusing to throttle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { effortFor, knownFraction, planEscalation, searchBudgetInstruction } from '../escalation.ts';

const decision = (stage, over = {}) => ({
  stage,
  wouldRun: true,
  reason: '',
  missing: [],
  stale: [],
  conflicting: [],
  reused: [],
  ...over,
});

/* ── the stage that never eases off ──────────────────────────────────── */

test('the registry stage works at full effort however much is known', () => {
  // It establishes ownership, mortgages, seizures and restrictions, and is
  // re-read every run by design. Throttling its searching would throttle
  // exactly the check a buyer is exposed to.
  const e = effortFor(decision('official_collection', { reused: ['a', 'b', 'c', 'd', 'e'] }));
  assert.equal(e.level, 'FULL');
  assert.ok(e.searchBudget >= 4);
  assert.match(e.reason, /transaction-critical/);
});

test('knowing everything never reduces a budget to zero', () => {
  // A budget of zero turns "we already know this" into "do not look", and
  // those are different instructions. A contradiction is worth finding.
  const e = effortFor(decision('public_research', { reused: ['a', 'b', 'c'] }));
  assert.equal(e.level, 'KNOWN');
  assert.ok(e.searchBudget >= 1, 'a fully known stage was told not to look at all');
});

test('a stale fact still buys a search', () => {
  const e = effortFor(decision('market', { reused: ['a', 'b', 'c'], stale: ['listing.price'] }));
  assert.notEqual(e.level, 'KNOWN', 'a stale market was treated as settled');
  assert.ok(e.searchBudget >= 2);
});

test('a contradicted fact is never treated as known', () => {
  const e = effortFor(decision('public_research', { reused: ['a', 'b', 'c'], conflicting: ['project.floors'] }));
  assert.notEqual(e.level, 'KNOWN');
});

/* ── the budget actually falls ───────────────────────────────────────── */

test('knowing nothing gets full effort', () => {
  const e = effortFor(decision('public_research', { missing: ['a', 'b', 'c', 'd'] }));
  assert.equal(e.level, 'FULL');
  assert.equal(e.searchBudget, 8);
});

test('knowing most of it searches for the gaps instead of sweeping', () => {
  const e = effortFor(decision('public_research', {
    reused: ['a', 'b', 'c', 'd', 'e', 'f'],
    missing: ['g'],
  }));
  assert.equal(e.level, 'TARGETED');
  assert.ok(e.searchBudget < 8, 'a nearly complete stage still ran a full sweep');
  assert.ok(e.searchBudget >= 2, 'the gap was given no room to be researched');
});

test('the budget scales with what is outstanding, not with the stage size', () => {
  const few = effortFor(decision('market', { reused: ['a', 'b', 'c', 'd'], missing: ['e'] }));
  const many = effortFor(decision('market', { reused: ['a', 'b', 'c', 'd'], missing: ['e', 'f', 'g', 'h'] }));
  assert.ok(many.searchBudget > few.searchBudget, 'more outstanding work bought no more searching');
});

test('a stage that does not search is never given a budget', () => {
  const e = effortFor(decision('synthesis', { reused: ['a'] }));
  assert.equal(e.searchBudget, 0);
});

/* ── what a run is allowed overall ───────────────────────────────────── */

test('a run with a complete graph is authorised for fewer searches than one without', () => {
  const cold = planEscalation([
    decision('identity', { missing: ['a', 'b'] }),
    decision('official_collection', { missing: ['c'] }),
    decision('public_research', { missing: ['d', 'e', 'f'] }),
    decision('market', { missing: ['g', 'h'] }),
    decision('synthesis'),
  ]);
  const warm = planEscalation([
    decision('identity', { reused: ['a', 'b'] }),
    decision('official_collection', { reused: ['c'] }),
    decision('public_research', { reused: ['d', 'e', 'f'] }),
    decision('market', { reused: ['g'], stale: ['h'] }),
    decision('synthesis'),
  ]);
  assert.ok(warm.totalBudget < cold.totalBudget, 'a known property was authorised just as much searching');
  assert.equal(cold.totalBudget, cold.fullBudget, 'a cold run was throttled');
  assert.match(warm.summary, /eased off on/);
});

test('the registry keeps its full budget inside a warm run', () => {
  const warm = planEscalation([
    decision('identity', { reused: ['a'] }),
    decision('official_collection', { reused: ['b', 'c'] }),
    decision('public_research', { reused: ['d'] }),
  ]);
  const registry = warm.efforts.find((e) => e.stage === 'official_collection');
  assert.equal(registry.level, 'FULL');
  assert.equal(registry.searchBudget, 4);
});

test('the fraction known means what the plan means', () => {
  assert.equal(knownFraction(decision('market', { reused: ['a', 'b'], missing: ['c', 'd'] })), 0.5);
  assert.equal(knownFraction(decision('market', {})), 0);
});

/* ── what the stage is actually told ─────────────────────────────────── */

test('a throttled stage is told it is a budget, not a prohibition', () => {
  // Being right outranks being cheap. A stage that hits its budget and still
  // needs a search to avoid stating something wrong must take it.
  const text = searchBudgetInstruction(effortFor(decision('public_research', {
    reused: ['a', 'b', 'c', 'd', 'e', 'f'], missing: ['g'],
  })));
  assert.match(text, /SEARCH BUDGET/);
  assert.match(text, /This is a budget, not a prohibition/);
  assert.match(text, /Being right outranks being cheap/);
});

test('a stage at full effort is told nothing at all', () => {
  // No instruction is the honest representation of no constraint.
  assert.equal(searchBudgetInstruction(effortFor(decision('public_research', { missing: ['a', 'b'] }))), '');
  assert.equal(searchBudgetInstruction(effortFor(decision('official_collection', { reused: ['a'] }))), '');
  assert.equal(searchBudgetInstruction(null), '');
});

/* ── market's ceiling is a measurement, not a trim ───────────────────
 *
 * A market web search costs about $0.04 all-in: OpenAI bills the
 * search-content tokens at model rates on top of the $10/1k call fee, and
 * those tokens arrive inside usage.input_tokens — roughly 8,000 per search.
 * Across thirteen production market stages the implied non-search tokens held
 * at 20,717–31,600 whatever the count, while stage cost tracked it almost
 * linearly: $0.198 at four searches, $0.396 at nine.
 *
 * The extra searching bought nothing measurable. Usable comparables per run —
 * ACTIVE, RESIDENTIAL, priced, which is what the deterministic maths can use:
 * four searches gave 4.0 across 3 tiers, five gave 6.2 across 3, eight gave
 * 6.0 across 2.
 */

test('market cannot authorise the nine-search runs that bought nothing', () => {
  const cold = effortFor(decision('market', { missing: ['a', 'b', 'c', 'd'] }));
  assert.equal(cold.level, 'FULL');
  assert.ok(cold.searchBudget <= 6, `market may still spend ${cold.searchBudget} searches`);
  assert.ok(cold.searchBudget >= 5, 'market was cut below what has been seen to work');
});

test('the registry is not cheapened while market is bounded', () => {
  // Only market had evidence for a lower ceiling. Nothing here licenses
  // trimming the stage a buyer is actually exposed to.
  const registry = effortFor(decision('official_collection', { missing: ['a', 'b'] }));
  assert.equal(registry.searchBudget, 4);
  assert.equal(registry.level, 'FULL');
});

test('a cold run is still authorised for real discovery across every stage', () => {
  const cold = planEscalation([
    decision('identity', { missing: ['a'] }),
    decision('official_collection', { missing: ['b'] }),
    decision('public_research', { missing: ['c'] }),
    decision('market', { missing: ['d'] }),
    decision('synthesis'),
  ]);
  assert.equal(cold.totalBudget, cold.fullBudget, 'a cold run was throttled');
  assert.ok(cold.totalBudget >= 20, `a cold verification may only spend ${cold.totalBudget} searches`);
});
