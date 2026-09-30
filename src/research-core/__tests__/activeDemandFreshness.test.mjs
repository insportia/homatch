// THE ONE ACTIVE-DEMAND FRESHNESS POLICY: 30 days, a gate, by publication date.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeActiveDemand, parseActiveDemandPolicy, effectiveMaxDays, activeWindowStart, DEFAULT_ACTIVE_DEMAND_POLICY,
} from '../discovery/freshness-policy.ts';

const T0 = Date.parse('2026-09-29T12:00:00Z');
const at = (days) => new Date(T0 - days * 86_400_000).toISOString();

test('bands: 0–7 strongest, 8–14 very fresh, 15–30 eligible and weaker, >30 not eligible', () => {
  const j = (d) => judgeActiveDemand(at(d), { now: T0 });
  assert.equal(j(0).band, 'STRONGEST');
  assert.equal(j(7).band, 'STRONGEST');
  assert.equal(j(8).band, 'VERY_FRESH');
  assert.equal(j(14).band, 'VERY_FRESH');
  assert.equal(j(15).band, 'ELIGIBLE');
  assert.equal(j(30).band, 'ELIGIBLE');
  assert.equal(j(30).eligible, true);
  assert.equal(j(31).eligible, false);
  assert.equal(j(31).band, 'STALE');
  assert.ok(j(15).weight > j(29).weight, 'weaker as it ages');
  assert.ok(j(29).weight >= 0.5);
});

test('it is a gate, not a penalty: stale demand has weight zero whatever else is true', () => {
  for (const days of [31, 90, 365, 6000]) {
    const v = judgeActiveDemand(at(days), { now: T0 });
    assert.equal(v.eligible, false);
    assert.equal(v.weight, 0);
  }
});

test('the 2009 forum post that reached a customer is not eligible under any policy', () => {
  const widest = parseActiveDemandPolicy({ customerMayWiden: true, customerMaxDays: 365, hardMaxDays: 365, activeMaxDays: 365 });
  assert.equal(judgeActiveDemand('2009-06-18T00:00:00Z', { now: T0, policy: widest }).eligible, false);
});

test('undated is uncertain and not active by default; future dates are invalid', () => {
  const u = judgeActiveDemand(null, { now: T0 });
  assert.equal(u.band, 'UNDATED');
  assert.equal(u.eligible, false);
  assert.match(u.reason, /uncertain/);
  const f = judgeActiveDemand(at(-3), { now: T0 });
  assert.equal(f.band, 'INVALID_DATE');
  assert.equal(f.eligible, false);
  assert.equal(judgeActiveDemand(at(-0.5), { now: T0 }).eligible, true, 'within tolerated clock skew');
});

test('policy coherence: nothing may exceed the hard ceiling; bands stay ordered; garbage falls back to 30', () => {
  const p = parseActiveDemandPolicy({ activeMaxDays: 400, hardMaxDays: 50, strongestDays: 90, veryFreshDays: 3 });
  assert.equal(p.hardMaxDays, 50);
  assert.equal(p.activeMaxDays, 50);
  assert.ok(p.strongestDays <= p.veryFreshDays && p.veryFreshDays <= p.activeMaxDays);
  assert.equal(parseActiveDemandPolicy('{not json').activeMaxDays, 30);
  assert.equal(parseActiveDemandPolicy(null).activeMaxDays, DEFAULT_ACTIVE_DEMAND_POLICY.activeMaxDays);
});

test('campaigns may narrow freely, widen only when allowed and only to the customer max; sources only narrow', () => {
  const p = parseActiveDemandPolicy({ sourceMaxDays: { telegram: 21, forum: 999 } });
  assert.equal(effectiveMaxDays(p, { campaignMaxDays: 14 }), 14);
  assert.equal(effectiveMaxDays(p, { campaignMaxDays: 90 }), 30, 'widening refused by default');
  const w = parseActiveDemandPolicy({ customerMayWiden: true, customerMaxDays: 45 });
  const v = judgeActiveDemand(at(40), { now: T0, policy: w, campaignMaxDays: 90 });
  assert.equal(v.maxDays, 45);
  assert.equal(v.eligible, true);
  assert.equal(v.widened, true, 'a widened window is explicit state');
  assert.equal(effectiveMaxDays(p, { source: 'TELEGRAM' }), 21);
  assert.equal(effectiveMaxDays(p, { source: 'FORUM' }), 30, 'a source value above the ceiling is clamped');
});

test('activeWindowStart is the publication floor', () => {
  assert.equal(activeWindowStart(DEFAULT_ACTIVE_DEMAND_POLICY, { now: T0 }).toISOString(), at(30));
});
