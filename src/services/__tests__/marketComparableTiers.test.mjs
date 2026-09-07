// Pure-logic regression test for the 2026-09-07 market-comparable model
// (Verify mandate item 7: "finish the remaining market-comparable model").
// Before this change, MARKET-stage comparables carried only an
// undifferentiated boolean `sameProject` that nothing downstream ever
// actually read or rendered — the tier the model worked out was gathered
// and thrown away, and ComparablesCard rendered one flat, unordered list.
// This tests the two pure functions (one in
// supabase/functions/research-agent/index.ts, one in
// src/pages/VerifyPage.tsx) that now classify/normalize each comparable
// into SAME_PROJECT / MICRO_LOCATION / PEER_PROJECT, plus the grouping
// logic ComparablesCard uses to render them as three labeled sections.
// Both files are copied verbatim here per this repo's established pattern
// (a Deno edge function and a .tsx file this sandbox cannot import
// directly — see companyProfileReconciliationFallback.test.mjs and
// verifyPhaseLabels.test.mjs in this same directory). Keep all three in
// sync whenever the real functions change.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- copied verbatim from supabase/functions/research-agent/index.ts ---
const VALID_COMPARABLE_TIERS = new Set(['SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT']);
function normalizeComparableTier(c) {
  if (VALID_COMPARABLE_TIERS.has(c?.comparableType)) return c.comparableType;
  if (c?.sameProject === true) return 'SAME_PROJECT';
  return 'PEER_PROJECT';
}

// --- copied verbatim from src/pages/VerifyPage.tsx ---
function comparableTier(c) {
  if (c?.comparableType === 'SAME_PROJECT' || c?.comparableType === 'MICRO_LOCATION' || c?.comparableType === 'PEER_PROJECT') return c.comparableType;
  if (c?.sameProject === true) return 'SAME_PROJECT';
  return 'PEER_PROJECT';
}
const COMPARABLE_TIER_ORDER = ['SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT'];
function groupComparables(list) {
  return COMPARABLE_TIER_ORDER.map((tier) => ({ tier, items: list.filter((c) => comparableTier(c) === tier) })).filter((g) => g.items.length > 0);
}

for (const [label, tierFn] of [['backend normalizeComparableTier', normalizeComparableTier], ['frontend comparableTier', comparableTier]]) {
  test(`${label}: a valid model-provided comparableType always wins`, () => {
    assert.equal(tierFn({ comparableType: 'SAME_PROJECT' }), 'SAME_PROJECT');
    assert.equal(tierFn({ comparableType: 'MICRO_LOCATION' }), 'MICRO_LOCATION');
    assert.equal(tierFn({ comparableType: 'PEER_PROJECT' }), 'PEER_PROJECT');
  });

  test(`${label}: an invalid/garbage comparableType never passes through — falls back like it was never set`, () => {
    assert.equal(tierFn({ comparableType: 'NEXT_DOOR' }), 'PEER_PROJECT');
    assert.equal(tierFn({ comparableType: 123 }), 'PEER_PROJECT');
  });

  test(`${label}: a legacy report with only the old boolean sameProject still classifies correctly (mandate item 5: old reports reopen with zero rerun cost)`, () => {
    assert.equal(tierFn({ sameProject: true }), 'SAME_PROJECT');
    assert.equal(tierFn({ sameProject: false }), 'PEER_PROJECT');
  });

  test(`${label}: no tier information at all defaults to the conservative PEER_PROJECT, never SAME_PROJECT`, () => {
    assert.equal(tierFn({}), 'PEER_PROJECT');
    assert.equal(tierFn(null), 'PEER_PROJECT');
    assert.equal(tierFn(undefined), 'PEER_PROJECT');
  });
}

test('groupComparables: three tiers render as three ordered, non-empty-only groups, preserving each comparable\'s original order within its tier', () => {
  const list = [
    { source: 'myhome', comparableType: 'PEER_PROJECT', listingId: 'p1' },
    { source: 'ss.ge', comparableType: 'SAME_PROJECT', listingId: 's1' },
    { source: 'myhome', comparableType: 'MICRO_LOCATION', listingId: 'm1' },
    { source: 'ss.ge', comparableType: 'SAME_PROJECT', listingId: 's2' },
  ];
  const groups = groupComparables(list);
  assert.deepEqual(groups.map((g) => g.tier), ['SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT'], 'SAME_PROJECT first, PEER_PROJECT last, regardless of input order');
  assert.deepEqual(groups.find((g) => g.tier === 'SAME_PROJECT').items.map((i) => i.listingId), ['s1', 's2'], 'original relative order preserved within a tier');
});

test('groupComparables: a tier with zero matching comparables is omitted entirely, never rendered as an empty section', () => {
  const list = [{ source: 'myhome', comparableType: 'SAME_PROJECT', listingId: 's1' }];
  const groups = groupComparables(list);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tier, 'SAME_PROJECT');
});

test('groupComparables: an empty comparables list produces zero groups (ComparablesCard must render nothing, not an empty card)', () => {
  assert.deepEqual(groupComparables([]), []);
});
