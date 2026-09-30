// DEMAND FRESHNESS — a 2009 post must never be sold as a current opportunity.
//
// Policy tests run the pure module on a fixed clock; the source-contract
// tests then pin the three matchers to actually using it, the same way
// freshnessDelivery.test.mjs pins the delivery gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  judgeDemandFreshness, demandAgeCeilingDays, UNDATED_DEMAND_FACTOR,
} from '../match/demand-freshness.ts';

const T0 = Date.parse('2026-09-01T10:00:00.000Z');
const DAY = 86_400_000;
const at = (daysAgo) => new Date(T0 - daysAgo * DAY).toISOString();

test('recent explicit demand qualifies at full strength', () => {
  const v = judgeDemandFreshness(at(3), { now: T0, transaction: 'SALE' });
  assert.equal(v.eligible, true);
  assert.equal(v.factor, 1.0);
  assert.equal(v.reason, 'FRESH');
  assert.equal(v.ageDays, 3);
});

test('age decays in steps, monotonically', () => {
  const f = (d) => judgeDemandFreshness(at(d), { now: T0, transaction: 'SALE' }).factor;
  assert.equal(f(10), 1.0);
  assert.equal(f(45), 0.92);
  assert.equal(f(120), 0.8);
  assert.equal(f(300), 0.6);
  assert.ok(f(10) >= f(45) && f(45) >= f(120) && f(120) >= f(300), 'never increases with age');
});

test('a very old signal cannot come out a strong active match', () => {
  // v2 tiers: VERY_STRONG needs >= 80. A perfect 100 at 300 days lands at 60.
  const v = judgeDemandFreshness(at(300), { now: T0, transaction: 'SALE' });
  assert.equal(v.eligible, true);
  assert.ok(Math.round(100 * v.factor) < 80, 'decayed perfection sits below the strong tiers');
});

test('a 2009-like post is ineligible for an active match, in every transaction', () => {
  const ancient = '2009-05-14T00:00:00.000Z';
  for (const transaction of ['SALE', 'RENT', null]) {
    const v = judgeDemandFreshness(ancient, { now: T0, transaction });
    assert.equal(v.eligible, false, `${transaction} must reject 2009`);
    assert.equal(v.factor, 0);
    assert.equal(v.reason, 'ANCIENT');
  }
});

test('rental demand expires faster than purchase demand', () => {
  assert.equal(demandAgeCeilingDays('RENT'), 180);
  assert.equal(demandAgeCeilingDays('SALE'), 365);
  const twoHundredDays = at(200);
  assert.equal(judgeDemandFreshness(twoHundredDays, { now: T0, transaction: 'RENT' }).eligible, false);
  assert.equal(judgeDemandFreshness(twoHundredDays, { now: T0, transaction: 'SALE' }).eligible, true);
});

test('an unknown publication date is never treated as fresh', () => {
  for (const missing of [null, undefined, '', 'not-a-date']) {
    const v = judgeDemandFreshness(missing, { now: T0 });
    assert.equal(v.eligible, true, 'absence of a date is not evidence of age');
    assert.equal(v.reason, 'UNDATED');
    assert.equal(v.factor, UNDATED_DEMAND_FACTOR);
    assert.ok(v.factor < 1.0, 'unknown must not receive the fresh factor');
    assert.equal(v.ageDays, null);
  }
});

test('a future publication date is a data error, not freshness', () => {
  const v = judgeDemandFreshness(at(-3), { now: T0 });
  assert.equal(v.reason, 'UNDATED');
  assert.equal(v.factor, UNDATED_DEMAND_FACTOR);
});

test('the judgment reads publication time, so ingestion date cannot launder age', () => {
  // The 2009 trap: the row was INSERTED today. The policy only ever sees
  // published_at, so "inserted today" changes nothing.
  const v = judgeDemandFreshness('2009-05-14T00:00:00.000Z', { now: T0 });
  assert.equal(v.eligible, false);
});

/* ── Source contracts: the matchers actually enforce this policy ───────── */

const v2 = readFileSync(new URL('../../../supabase/functions/run-matching-v2/index.ts', import.meta.url), 'utf8');
const v1 = readFileSync(new URL('../../../supabase/functions/run-matching/index.ts', import.meta.url), 'utf8');
const supply = readFileSync(new URL('../../../supabase/functions/supply-matching/index.ts', import.meta.url), 'utf8');

/* The matchers moved from this module's 365/180-day decay to the canonical
   30-day active-demand GATE (discovery/freshness-policy.ts, setting
   discovery_freshness_policy). What must hold is unchanged: the policy is fed
   the PUBLICATION date, never ingestion time, and it decides eligibility. */
test('run-matching-v2 gates and weights on the PUBLICATION date', () => {
  assert.match(v2, /judgeActiveDemand\(signal\.published_at/);
  assert.match(v2, /if \(!demandFreshness\.eligible\)/);
  assert.match(v2, /match_score: finalScore/);
  assert.ok(!/judgeActiveDemand\([^)]*created_at/.test(v2), 'ingestion time must never feed the policy');
});

test('run-matching v1 no longer invents a 72-hour age for undated posts', () => {
  assert.ok(!/:\s*72;/.test(v1), 'the fabricated default is gone');
  assert.match(v1, /judgeActiveDemand\(signal\?\.published_at/);
  assert.match(v1, /Number\.POSITIVE_INFINITY/);
  assert.match(v1, /Number\.isFinite\(recencyHours\) \? formatRecency\(recencyHours\) : null/);
});

test('supply-matching reads newest first, records real age, and decays rank', () => {
  assert.match(supply, /\.order\('published_at', \{ ascending: false, nullsFirst: false \}\)/);
  assert.match(supply, /ageDays: listingAgeDays/);
  assert.match(supply, /rankedScore/);
  assert.ok(!/ageDays: ceiling\.days/.test(supply), 'the ceiling is a limit, not the listing age');
});

test('rejection means skipping match creation, never deleting history', () => {
  for (const src of [v1, v2, supply]) {
    assert.ok(!/raw_signals'\)\s*\.delete\(/.test(src));
    assert.ok(!/supply_observations'\)\s*\.delete\(/.test(src));
  }
});
