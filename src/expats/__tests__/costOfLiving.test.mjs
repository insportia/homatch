// The budget builder: honest about what it does not know.
//
// A foreigner uses this number to decide whether they can afford to move
// country. The failure that matters is not an imprecise total — it is a
// total that LOOKS complete while silently omitting the categories we have
// no data for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_PROFILE } from '../types.ts';
import {
  COST_CATEGORIES,
  annualise,
  applicableCategories,
  budgetMidpoint,
  convertObservation,
  householdScale,
  housingShare,
  monthlyBudget,
  shareOfBudget,
  spreadRatio,
} from '../costOfLiving.ts';

const profile = (over = {}) => ({ ...EMPTY_PROFILE, ...over });

const obs = (low, high, over = {}) => ({
  low,
  high,
  currency: 'GEL',
  unit: 'PER_MONTH',
  sampleSize: 12,
  sourceCount: 3,
  observedAt: '2026-09-01T00:00:00.000Z',
  locality: 'Tbilisi',
  ...over,
});

const observations = (over = {}) => ({
  RENT: obs(1200, 2200),
  UTILITIES: obs(120, 260),
  INTERNET: obs(40, 70),
  MOBILE: obs(20, 45),
  GROCERIES: obs(400, 700),
  RESTAURANTS: obs(200, 600),
  TRANSPORT: obs(30, 120),
  HEALTHCARE: obs(50, 200),
  INSURANCE: obs(40, 150),
  GYM: obs(60, 150),
  ENTERTAINMENT: obs(100, 300),
  OTHER: obs(100, 300),
  ...over,
});

const build = (over = {}) =>
  monthlyBudget({
    profile: profile(over.profile),
    observations: over.observations ?? observations(),
    overrides: over.overrides ?? {},
    excluded: over.excluded,
    currency: 'GEL',
  });

/* ── Applicability ────────────────────────────────────────────────────── */

test('a single person is not shown a childcare line at zero', () => {
  const cats = applicableCategories(profile({ household: 'ALONE', childrenCount: 0 }));
  assert.ok(!cats.includes('CHILDCARE'));
  assert.ok(!cats.includes('SCHOOL'));
});

test('a family is shown the family lines', () => {
  const cats = applicableCategories(profile({ household: 'FAMILY', childrenCount: 2 }));
  assert.ok(cats.includes('SCHOOL'));
  assert.ok(cats.includes('CHILDCARE'));
});

test('someone who has told us nothing sees the full picture', () => {
  const cats = applicableCategories(EMPTY_PROFILE);
  assert.ok(cats.includes('SCHOOL'), 'unknown must not quietly understate the cost');
  assert.ok(cats.includes('CAR'));
  assert.equal(cats.length, COST_CATEGORIES.length);
});

test('saying there is no car removes the car line', () => {
  assert.ok(!applicableCategories(profile({ hasVehicle: false })).includes('CAR'));
});

/* ── Scaling ──────────────────────────────────────────────────────────── */

test('rent does not scale with headcount', () => {
  for (const h of ['ALONE', 'COUPLE', 'FAMILY']) {
    assert.equal(householdScale('RENT', profile({ household: h })), 1, h);
  }
});

test('groceries scale with the household and school scales per child', () => {
  assert.equal(householdScale('GROCERIES', profile({ household: 'ALONE' })), 1);
  assert.ok(householdScale('GROCERIES', profile({ household: 'COUPLE' })) > 1.5);
  assert.equal(householdScale('SCHOOL', profile({ household: 'FAMILY', childrenCount: 3 })), 3);
  assert.equal(householdScale('SCHOOL', profile({ household: 'FAMILY', childrenCount: 1 })), 1);
});

test('a scaled line is labelled as scaled, not as observed', () => {
  const b = build({ profile: { household: 'COUPLE' } });
  const groceries = b.lines.find((l) => l.category === 'GROCERIES');
  assert.equal(groceries.basis, 'SCALED');
  assert.ok(groceries.scale > 1);
  const rent = b.lines.find((l) => l.category === 'RENT');
  assert.equal(rent.basis, 'OBSERVED');
  assert.equal(rent.scale, null);
});

/* ── Totals ───────────────────────────────────────────────────────────── */

test('the total is a range, and the low total is the sum of the lows', () => {
  const b = build({ profile: { household: 'ALONE', hasVehicle: false, workStatus: 'EMPLOYED_LOCALLY' } });
  const expectedLow = b.lines.reduce((n, l) => n + (l.low ?? 0), 0);
  const expectedHigh = b.lines.reduce((n, l) => n + (l.high ?? 0), 0);
  assert.equal(b.low, expectedLow);
  assert.equal(b.high, expectedHigh);
  assert.ok(b.high > b.low);
});

test('a category we have no observation for is reported, not hidden', () => {
  const b = build({
    profile: { household: 'ALONE', hasVehicle: false, workStatus: 'EMPLOYED_LOCALLY' },
    observations: { RENT: obs(1200, 2200) },
  });
  assert.ok(b.missing.length > 0);
  assert.ok(b.missing.includes('GROCERIES'));
  const groceries = b.lines.find((l) => l.category === 'GROCERIES');
  assert.equal(groceries.basis, 'NO_DATA');
  assert.equal(groceries.low, null);
  // The line exists on screen even though it adds nothing to the total.
  assert.ok(b.lines.some((l) => l.category === 'GROCERIES'));
});

test('a typed number wins over the observation and is labelled as the user’s', () => {
  const b = build({ overrides: { RENT: 3000 } });
  const rent = b.lines.find((l) => l.category === 'RENT');
  assert.equal(rent.basis, 'USER');
  assert.equal(rent.low, 3000);
  assert.equal(rent.high, 3000);
  assert.equal(rent.observation, null, 'our observation is not blended with theirs');
  assert.equal(b.hasUserValues, true);
});

test('a typed zero is respected rather than treated as missing', () => {
  const b = build({ overrides: { GYM: 0 } });
  const gym = b.lines.find((l) => l.category === 'GYM');
  assert.equal(gym.basis, 'USER');
  assert.equal(gym.low, 0);
  assert.ok(!b.missing.includes('GYM'));
});

test('a nonsensical override falls back to the observation', () => {
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const b = build({ overrides: { RENT: bad } });
    assert.equal(b.lines.find((l) => l.category === 'RENT').basis, 'OBSERVED', String(bad));
  }
});

test('excluding a category removes it entirely', () => {
  const b = build({ excluded: ['RESTAURANTS'] });
  assert.ok(!b.lines.some((l) => l.category === 'RESTAURANTS'));
  assert.ok(!b.missing.includes('RESTAURANTS'));
});

test('the oldest observation behind the total is reported', () => {
  const b = build({
    observations: observations({ RENT: obs(1200, 2200, { observedAt: '2026-01-05T00:00:00.000Z' }) }),
  });
  assert.equal(b.oldestObservedAt, '2026-01-05T00:00:00.000Z');
});

test('an empty budget has no spread and no housing share', () => {
  const b = monthlyBudget({
    profile: EMPTY_PROFILE,
    observations: {},
    overrides: {},
    currency: 'GEL',
  });
  assert.equal(b.low, 0);
  assert.equal(spreadRatio(b), 1);
  assert.equal(housingShare(b), null);
  assert.equal(shareOfBudget(b.lines[0], b), 0);
});

test('spread reports how far apart the two months are', () => {
  const b = build();
  assert.ok(spreadRatio(b) > 1);
  assert.equal(budgetMidpoint(b), (b.low + b.high) / 2);
});

test('housing is reported as a share of the month', () => {
  const b = build({ profile: { household: 'ALONE', hasVehicle: false, workStatus: 'EMPLOYED_LOCALLY' } });
  const share = housingShare(b);
  assert.ok(share > 0 && share < 1);
});

test('the year is twelve months and nothing else', () => {
  const b = build();
  assert.deepEqual(annualise(b), { low: b.low * 12, high: b.high * 12 });
});

/* ── Currency ─────────────────────────────────────────────────────────── */

test('converting a price does not make it newer or better attested', () => {
  const original = obs(1200, 2200);
  const converted = convertObservation(original, 'USD', 1 / 2.7);
  assert.equal(converted.currency, 'USD');
  assert.equal(converted.observedAt, original.observedAt);
  assert.equal(converted.sampleSize, original.sampleSize);
  assert.equal(converted.sourceCount, original.sourceCount);
  assert.ok(Math.abs(converted.low - 1200 / 2.7) < 1e-9);
});

test('a conversion refuses an impossible rate rather than producing a number', () => {
  assert.throws(() => convertObservation(obs(1, 2), 'USD', 0), RangeError);
  assert.throws(() => convertObservation(obs(1, 2), 'USD', -1), RangeError);
  assert.throws(() => convertObservation(obs(1, 2), 'USD', Number.NaN), RangeError);
});

/* ── The §27 separation ───────────────────────────────────────────────── */

test('no monthly category is a capital cost', () => {
  // A purchase price must never become a line in a month. The category list
  // is the enforcement point, so it is asserted directly.
  for (const c of COST_CATEGORIES) {
    assert.ok(!/PURCHASE|PROPERTY_PRICE|DEPOSIT|DOWN_PAYMENT/.test(c), c);
  }
});
