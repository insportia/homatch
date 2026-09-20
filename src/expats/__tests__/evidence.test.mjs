// The rules FOR EXPATS is not allowed to break about what it knows.
//
// Every test here corresponds to a way the product could tell a foreigner
// something untrue while every other gate stayed green. They are written
// against the engines rather than the screens on purpose: a screen can be
// redesigned, and these properties have to survive the redesign.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORITY_REGISTERS,
  appliesTo,
  factFreshness,
  isWorldClaim,
  judgeFreshness,
  mayOverride,
  outranks,
  strongestSource,
  midpoint,
  isWideRange,
  REVIEW_INTERVAL_DAYS,
} from '../types.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const source = (over = {}) => ({
  sourceId: 's1',
  publisher: 'Public Service Development Agency',
  url: 'https://sda.gov.ge/',
  official: true,
  publishedOn: null,
  effectiveFrom: null,
  observedAt: daysAgo(1),
  language: 'ka',
  ...over,
});

const fact = (over = {}) => ({
  id: 'f1',
  factClass: 'LEGAL',
  register: 'OFFICIAL_REQUIREMENT',
  availability: 'ESTABLISHED',
  valueKey: 'k',
  sources: [source()],
  appliesToNationalities: null,
  needsReview: false,
  ...over,
});

/* ── Authority ────────────────────────────────────────────────────────── */

test('official requirement outranks every other register', () => {
  for (const other of AUTHORITY_REGISTERS.slice(1)) {
    assert.equal(outranks('OFFICIAL_REQUIREMENT', other), true, other);
  }
});

test('a community report can never displace an official rule', () => {
  assert.equal(mayOverride('COMMUNITY_EXPERIENCE', 'OFFICIAL_REQUIREMENT'), false);
  assert.equal(mayOverride('PRACTICAL_CONTEXT', 'OFFICIAL_REQUIREMENT'), false);
  assert.equal(mayOverride('HOMATCH_ANALYSIS', 'OFFICIAL_REQUIREMENT'), false);
  // Only a newer official statement may.
  assert.equal(mayOverride('OFFICIAL_REQUIREMENT', 'OFFICIAL_REQUIREMENT'), true);
});

test('a practical note may refine a community report but not the reverse', () => {
  assert.equal(mayOverride('PRACTICAL_CONTEXT', 'COMMUNITY_EXPERIENCE'), true);
  assert.equal(mayOverride('COMMUNITY_EXPERIENCE', 'PRACTICAL_CONTEXT'), false);
});

/* ── Coverage gap is not a finding ────────────────────────────────────── */

test('only the two established forms may be stated as facts about the world', () => {
  assert.equal(isWorldClaim('ESTABLISHED'), true);
  assert.equal(isWorldClaim('ESTABLISHED_NEGATIVE'), true);
  assert.equal(isWorldClaim('UNKNOWN'), false);
  assert.equal(isWorldClaim('COVERAGE_GAP'), false);
  assert.equal(isWorldClaim('STALE'), false);
});

/* ── Freshness ────────────────────────────────────────────────────────── */

test('legal information goes stale faster than general information', () => {
  assert.ok(REVIEW_INTERVAL_DAYS.LEGAL < REVIEW_INTERVAL_DAYS.GENERAL);
  assert.ok(REVIEW_INTERVAL_DAYS.FEE < REVIEW_INTERVAL_DAYS.GENERAL);
  assert.ok(REVIEW_INTERVAL_DAYS.MARKET < REVIEW_INTERVAL_DAYS.LEGAL);
});

test('a legal fact read 100 days ago is stale, the same read yesterday is fresh', () => {
  assert.equal(judgeFreshness(daysAgo(100), 'LEGAL', NOW), 'STALE');
  assert.equal(judgeFreshness(daysAgo(1), 'LEGAL', NOW), 'FRESH');
  assert.equal(judgeFreshness(daysAgo(70), 'LEGAL', NOW), 'AGEING');
});

test('a fact with no source has unknown freshness, never fresh', () => {
  assert.equal(factFreshness(fact({ sources: [] }), NOW), 'UNKNOWN');
  assert.equal(judgeFreshness(null, 'LEGAL', NOW), 'UNKNOWN');
  assert.equal(judgeFreshness('not a date', 'LEGAL', NOW), 'UNKNOWN');
});

test('freshness follows the newest source, not the first', () => {
  const f = fact({
    sources: [source({ sourceId: 'old', observedAt: daysAgo(200) }), source({ sourceId: 'new', observedAt: daysAgo(2) })],
  });
  assert.equal(factFreshness(f, NOW), 'FRESH');
});

test('an official source is preferred over a newer unofficial one', () => {
  const f = fact({
    sources: [
      source({ sourceId: 'blog', official: false, publisher: 'A blog', observedAt: daysAgo(1) }),
      source({ sourceId: 'gov', official: true, publisher: 'Ministry', observedAt: daysAgo(30) }),
    ],
  });
  assert.equal(strongestSource(f).sourceId, 'gov');
});

/* ── Nationality applicability ────────────────────────────────────────── */

test('a universal rule applies to everyone including someone who has not said', () => {
  assert.equal(appliesTo(fact(), null), 'YES');
  assert.equal(appliesTo(fact(), 'DE'), 'YES');
});

test('a nationality-specific rule is DEPENDS, never NO, when nationality is unknown', () => {
  const f = fact({ appliesToNationalities: ['DE', 'FR'] });
  assert.equal(appliesTo(f, null), 'DEPENDS');
  assert.equal(appliesTo(f, 'de'), 'YES');
  assert.equal(appliesTo(f, 'IN'), 'NO');
});

/* ── Money ────────────────────────────────────────────────────────────── */

test('a range whose top is half again its bottom is flagged as wide', () => {
  const m = (low, high) => ({
    low,
    high,
    currency: 'GEL',
    unit: 'PER_MONTH',
    sampleSize: 4,
    sourceCount: 2,
    observedAt: daysAgo(3),
    locality: 'Tbilisi',
  });
  assert.equal(isWideRange(m(1000, 1400)), false);
  assert.equal(isWideRange(m(1000, 1500)), true);
  assert.equal(midpoint(m(1000, 1500)), 1250);
});
