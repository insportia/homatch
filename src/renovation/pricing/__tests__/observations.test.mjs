import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizedUnitPrice,
  outlierIds,
  aggregateObservations,
  canPublish,
  DEFAULT_RULES,
} from '../observations.ts';

const NOW = new Date('2026-09-11T00:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

let seq = 0;
const obs = (over = {}) => ({
  id: `o${++seq}`,
  itemKey: 'floor.tile',
  market: 'tbilisi',
  observedValue: 45,
  observedUnit: 'm2',
  packSize: 1,
  currency: 'GEL',
  sourceType: 'RETAIL_SITE',
  sourceName: 'Shop A',
  supplier: 'Shop A',
  productName: 'Tile 60x60',
  sourceDate: day(10),
  reviewState: 'VERIFIED',
  availability: 'IN_STOCK',
  ...over,
});

/* ---------------- normalization ---------------- */

test('a box price becomes a price per square metre', () => {
  assert.equal(normalizedUnitPrice(obs({ observedValue: 72, packSize: 1.44 })), 50);
});

test('an unknown or nonsense pack size is never guessed at', () => {
  assert.equal(normalizedUnitPrice(obs({ packSize: 0 })), null);
  assert.equal(normalizedUnitPrice(obs({ packSize: -1 })), null);
  assert.equal(normalizedUnitPrice(obs({ observedValue: 0 })), null);
});

/* ---------------- outliers ---------------- */

test('a mistyped decimal point does not drag the price', () => {
  const vals = [
    { id: 'a', value: 45 }, { id: 'b', value: 47 }, { id: 'c', value: 44 },
    { id: 'd', value: 46 }, { id: 'e', value: 450 },
  ];
  assert.ok(outlierIds(vals).has('e'));
  assert.ok(!outlierIds(vals).has('a'));
});

test('outlier detection stays quiet on tiny samples', () => {
  // With three points anything can look extreme; rejecting on that basis
  // would throw away real evidence when evidence is scarcest.
  assert.equal(outlierIds([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 90 }]).size, 0);
});

/* ---------------- the gate ---------------- */

test('too few observations produces NO price at all', () => {
  const r = aggregateObservations('floor.tile', [obs(), obs()], DEFAULT_RULES, NOW);
  assert.equal(r.sufficient, false);
  assert.equal(r.price, null, 'an unusable price must not exist as a field');
  assert.equal(r.currency, null);
  assert.match(r.reasons.join(' '), /verified observations/);
});

test('one supplier is never "the market"', () => {
  const r = aggregateObservations(
    'floor.tile',
    [obs({ productName: 'A' }), obs({ productName: 'B' }), obs({ productName: 'C' })],
    DEFAULT_RULES, NOW
  );
  assert.equal(r.sufficient, false);
  assert.match(r.reasons.join(' '), /suppliers/);
});

test('enough verified evidence from enough suppliers yields a price', () => {
  const r = aggregateObservations('floor.tile', [
    obs({ supplier: 'Shop A', observedValue: 44 }),
    obs({ supplier: 'Shop B', observedValue: 46 }),
    obs({ supplier: 'Shop C', observedValue: 48 }),
  ], DEFAULT_RULES, NOW);
  assert.equal(r.sufficient, true);
  assert.deepEqual(r.price, { low: 44, base: 46, high: 48 });
  assert.equal(r.currency, 'GEL');
  assert.equal(r.suppliers.length, 3);
});

test('unverified, stale, out-of-stock and undated rows are excluded and explained', () => {
  const r = aggregateObservations('floor.tile', [
    obs({ supplier: 'A', reviewState: 'PENDING' }),
    obs({ supplier: 'B', reviewState: 'REJECTED' }),
    obs({ supplier: 'C', sourceDate: day(400) }),
    obs({ supplier: 'D', availability: 'OUT_OF_STOCK' }),
    obs({ supplier: 'E', sourceDate: null }),
  ], DEFAULT_RULES, NOW);
  assert.equal(r.sufficient, false);
  assert.equal(r.usedIds.length, 0);
  const reasons = r.dropped.map((d) => d.reason).join(' ');
  for (const why of ['not verified', 'too old', 'out of stock', 'no observation date']) {
    assert.match(reasons, new RegExp(why));
  }
});

test('mixed currencies are dropped rather than converted', () => {
  const r = aggregateObservations('floor.tile', [
    obs({ supplier: 'A' }), obs({ supplier: 'B' }),
    obs({ supplier: 'C', currency: 'USD' }),
  ], DEFAULT_RULES, NOW);
  assert.match(r.dropped.map((d) => d.reason).join(' '), /currency USD differs/);
});

test('the same shop reporting the same product twice counts once', () => {
  const dup = { supplier: 'Shop A', productName: 'Tile 60x60', sourceDate: day(5), observedValue: 45 };
  const r = aggregateObservations('floor.tile', [
    obs(dup), obs(dup),
    obs({ supplier: 'Shop B' }), obs({ supplier: 'Shop C' }),
  ], DEFAULT_RULES, NOW);
  assert.match(r.dropped.map((d) => d.reason).join(' '), /duplicate/);
  assert.equal(r.usedIds.length, 3);
});

test('an observation for another item never contributes', () => {
  const r = aggregateObservations('floor.tile', [obs({ itemKey: 'wall.paint' })], DEFAULT_RULES, NOW);
  assert.equal(r.usedIds.length, 0);
  assert.match(r.dropped[0].reason, /different item/);
});

test('freshness is judged from the observation date', () => {
  const r = aggregateObservations('floor.tile', [
    obs({ supplier: 'A', sourceDate: day(30) }),
    obs({ supplier: 'B', sourceDate: day(5) }),
    obs({ supplier: 'C', sourceDate: day(60) }),
  ], DEFAULT_RULES, NOW);
  assert.equal(r.freshestDate, day(5));
});

/* ---------------- publication ---------------- */

test('a book cannot publish while any item is unsupported', () => {
  const good = aggregateObservations('floor.tile', [
    obs({ supplier: 'A' }), obs({ supplier: 'B' }), obs({ supplier: 'C' }),
  ], DEFAULT_RULES, NOW);
  const bad = aggregateObservations('wall.paint', [
    obs({ itemKey: 'wall.paint', supplier: 'A' }),
  ], DEFAULT_RULES, NOW);

  assert.equal(canPublish([good]).ok, true);
  const mixed = canPublish([good, bad]);
  assert.equal(mixed.ok, false, 'part-published books are the failure this prevents');
  assert.match(mixed.blocking.join(' '), /wall\.paint/);
});

test('an empty book never publishes', () => {
  assert.equal(canPublish([]).ok, false);
});
