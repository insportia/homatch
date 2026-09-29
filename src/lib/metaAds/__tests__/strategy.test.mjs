// The strategy engine is the wall between a human goal and Meta JSON.
// These tests pin the deterministic behavior the whole product relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGY_VERSION, META_API_VERSION, GOAL_TO_OBJECTIVE,
  classifySpecialAdCategories, buildPlan, validatePlanInput,
  computeTotals, CAMPAIGN_TRANSITIONS, canTransition,
} from '../strategy.ts';

const creative = (id, ready = true) => ({ id, kind: 'IMAGE', ready });
const baseInput = (over = {}) => ({
  goal: 'LEADS_ON_META',
  dailyBudgetCents: 500,
  durationDays: 3,
  currency: 'USD',
  specialAdCategories: ['HOUSING'],
  creatives: [creative('c1')],
  destination: { type: 'META_FORM' },
  placementsMode: 'RECOMMENDED',
  ...over,
});
const LIMITS = { minDurationDays: 2, minDailyCents: 200, maxDailyCents: 100000000 };

test('housing classification comes from the offer, never the customer', () => {
  assert.deepEqual(classifySpecialAdCategories({ isProperty: true, dealKind: 'SALE' }), ['HOUSING']);
  assert.deepEqual(classifySpecialAdCategories({ isProperty: true, dealKind: 'RENT_LONG' }), ['HOUSING']);
  assert.deepEqual(classifySpecialAdCategories({ isProperty: true, dealKind: null }), ['HOUSING']);
  assert.deepEqual(classifySpecialAdCategories({ isProperty: true, dealKind: 'COMMERCIAL' }), []);
  assert.deepEqual(classifySpecialAdCategories({ isProperty: false }), []);
});

test('small budgets are never fragmented: one ad set', () => {
  const plan = buildPlan(baseInput({ creatives: [creative('a'), creative('b'), creative('c'), creative('d')], dailyBudgetCents: 1500 }));
  assert.equal(plan.adSets.length, 1);
  assert.equal(plan.adSets[0].dailyBudgetCents, 1500);
  assert.deepEqual(plan.adSets[0].creativeIds, ['a', 'b', 'c', 'd']);
});

test('split happens only with >=4 ready creatives AND >=$20/day, budget conserved', () => {
  const plan = buildPlan(baseInput({
    creatives: [creative('a'), creative('b'), creative('c'), creative('d'), creative('e', false)],
    dailyBudgetCents: 2100,
  }));
  assert.equal(plan.adSets.length, 2);
  const sum = plan.adSets.reduce((n, s) => n + s.dailyBudgetCents, 0);
  assert.equal(sum, 2100); // integer cents, nothing lost to rounding
  const ids = plan.adSets.flatMap((s) => s.creativeIds);
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd']); // not-ready creative excluded
});

test('v26 requirements are always in the plan', () => {
  const plan = buildPlan(baseInput());
  assert.equal(plan.adsetBudgetSharing, false);
  assert.ok(plan.adSets.every((s) => s.advantageAudience === true));
  assert.equal(plan.apiVersion, META_API_VERSION);
  assert.equal(plan.version, STRATEGY_VERSION);
});

test('every goal maps to a real outcome objective', () => {
  for (const obj of Object.values(GOAL_TO_OBJECTIVE)) {
    assert.match(obj, /^OUTCOME_(LEADS|ENGAGEMENT|TRAFFIC)$/);
  }
});

test('validation catches every gate in front of money', () => {
  const codes = (input) => validatePlanInput(input, LIMITS).map((i) => i.code);
  assert.deepEqual(codes(baseInput()), []);
  assert.ok(codes(baseInput({ durationDays: 1 })).includes('DURATION_BELOW_MINIMUM'));
  assert.ok(codes(baseInput({ dailyBudgetCents: 100 })).includes('BUDGET_BELOW_MINIMUM'));
  assert.ok(codes(baseInput({ dailyBudgetCents: 100000001 })).includes('BUDGET_ABOVE_MAXIMUM'));
  assert.ok(codes(baseInput({ creatives: [creative('x', false)] })).includes('CREATIVE_REQUIRED'));
  assert.ok(codes(baseInput({ goal: 'LEADS_ON_WEBSITE', destination: { type: 'WEBSITE', url: 'http://x.ge' } }))
    .includes('DESTINATION_URL_INVALID'));
  assert.ok(codes(baseInput({ destination: { type: 'WEBSITE', url: 'https://x.ge' } }))
    .includes('DESTINATION_GOAL_MISMATCH'));
});

test('totals: media + fee = total, integer cents, fee is a parameter (never hardcoded)', () => {
  const t = computeTotals(500, 4, 9);
  assert.deepEqual(t, { mediaCents: 2000, feeCents: 180, totalCents: 2180, feePercent: 9 });
  const zero = computeTotals(500, 4, 0);
  assert.equal(zero.feeCents, 0);
  assert.equal(zero.totalCents, zero.mediaCents);
  const odd = computeTotals(333, 3, 9); // 999 * 9% = 89.91 → 90
  assert.equal(odd.feeCents, 90);
  assert.equal(odd.totalCents, 999 + 90);
});

test('lifecycle map is closed and sane', () => {
  const states = Object.keys(CAMPAIGN_TRANSITIONS);
  for (const [from, tos] of Object.entries(CAMPAIGN_TRANSITIONS)) {
    for (const to of tos) assert.ok(states.includes(to), `${from}→${to} targets a known state`);
  }
  assert.ok(canTransition('READY', 'LAUNCHING'));
  assert.ok(canTransition('ACTIVE', 'PAUSED'));
  assert.ok(canTransition('PAUSED', 'ACTIVE'));
  assert.ok(!canTransition('DRAFT', 'ACTIVE'));      // no launch shortcut
  assert.ok(!canTransition('ARCHIVED', 'ACTIVE'));   // archive is terminal
  assert.ok(!canTransition('ACTIVE', 'DRAFT'));      // running money never re-drafts
  assert.ok(!canTransition('LAUNCHING', 'ACTIVE'));  // Meta review is never skipped
});
