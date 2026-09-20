// "What can I buy" — and what it must never pretend to know.
//
// This surface is the one a foreign investor will screenshot and send to
// their accountant. Everything it says has to survive that.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPAT_CITIES,
  EXPAT_DISTRICTS,
  districtMatches,
  districtsOf,
  findCity,
  findDistrict,
} from '../geography.ts';
import {
  affordableArea,
  areaBand,
  coverage,
  rankByArea,
  readingForDistrict,
  readingsForCity,
} from '../marketContext.ts';

const snapshot = (over = {}) => ({
  scope_type: 'PROJECT',
  scope_key: 'demax-vake',
  property_type: 'RESIDENTIAL',
  room_band: 'UNKNOWN',
  currency: 'USD',
  median_price_per_sqm: 2580,
  lower_price_per_sqm: 1560,
  upper_price_per_sqm: 5850,
  sample_count: 35,
  usable_comparable_count: 35,
  source_count: 1,
  confidence: 'MEDIUM',
  basis_tier: 'WIDER_MARKET',
  last_refreshed_at: '2026-09-18T23:25:52.696Z',
  city: 'თბილისი',
  district: 'ვაკე',
  ...over,
});

const vake = findDistrict('vake');
const saburtalo = findDistrict('saburtalo');

/* ── Geography ────────────────────────────────────────────────────────── */

test('no district name is a substring of another', () => {
  // districtMatches uses substring matching; overlapping names would make
  // one district silently absorb another's evidence.
  for (const a of EXPAT_DISTRICTS) {
    for (const b of EXPAT_DISTRICTS) {
      if (a.key === b.key) continue;
      assert.ok(!a.nameKa.includes(b.nameKa), `${a.nameKa} contains ${b.nameKa}`);
      assert.ok(!a.nameEn.toLowerCase().includes(b.nameEn.toLowerCase()), `${a.nameEn} contains ${b.nameEn}`);
    }
  }
});

test('every district belongs to a city that exists', () => {
  for (const d of EXPAT_DISTRICTS) assert.ok(findCity(d.cityKey), d.key);
});

test('Georgian declined forms still match their district', () => {
  assert.ok(districtMatches(vake, 'ვაკე'));
  assert.ok(districtMatches(vake, 'ვაკეში, ჭავჭავაძის გამზირი'));
  assert.ok(districtMatches(vake, 'Vake'));
  assert.ok(!districtMatches(vake, 'საბურთალო'));
  assert.ok(!districtMatches(vake, null));
});

test('Tbilisi has the districts and Batumi has none yet', () => {
  assert.ok(districtsOf('tbilisi').length >= 5);
  assert.deepEqual(districtsOf('batumi'), []);
  assert.equal(EXPAT_CITIES.length, 3);
});

/* ── Readings ─────────────────────────────────────────────────────────── */

test('a district with no snapshot is a coverage gap, not a zero', () => {
  const r = readingForDistrict(saburtalo, [snapshot()]);
  assert.equal(r.availability, 'COVERAGE_GAP');
  assert.equal(r.pricePerSqm, null);
  assert.equal(r.sampleCount, 0);
});

test('a project snapshot is reported as a project, never as the district', () => {
  const r = readingForDistrict(vake, [snapshot()]);
  assert.equal(r.availability, 'ESTABLISHED');
  assert.equal(r.basis, 'PROJECT_IN_DISTRICT');
  assert.equal(r.scopeKey, 'demax-vake');
  assert.equal(r.pricePerSqm.median, 2580);
});

test('a district-scoped snapshot is preferred over a project one', () => {
  const r = readingForDistrict(vake, [
    snapshot(),
    snapshot({ scope_type: 'DISTRICT', scope_key: 'vake', median_price_per_sqm: 2400, usable_comparable_count: 4 }),
  ]);
  assert.equal(r.basis, 'DISTRICT');
  assert.equal(r.pricePerSqm.median, 2400, 'the district reading wins even with a smaller sample');
});

test('among projects the larger sample wins', () => {
  const r = readingForDistrict(vake, [
    snapshot({ scope_key: 'small', usable_comparable_count: 3, median_price_per_sqm: 9999, last_refreshed_at: '2026-09-19T00:00:00Z' }),
    snapshot({ scope_key: 'big', usable_comparable_count: 35, median_price_per_sqm: 2580 }),
  ]);
  assert.equal(r.scopeKey, 'big');
});

test('a city snapshot is never promoted into a district slot', () => {
  const r = readingForDistrict(vake, [
    snapshot({ scope_type: 'CITY', scope_key: 'tbilisi', district: 'ვაკე' }),
  ]);
  assert.equal(r.availability, 'COVERAGE_GAP');
});

test('districts with evidence come first and the gaps are still returned', () => {
  const readings = readingsForCity('tbilisi', [snapshot()]);
  assert.equal(readings.length, districtsOf('tbilisi').length);
  assert.equal(readings[0].district.key, 'vake');
  assert.ok(readings.slice(1).every((r) => r.availability === 'COVERAGE_GAP'));
  assert.deepEqual(coverage(readings), { covered: 1, total: districtsOf('tbilisi').length });
});

/* ── Affordability ────────────────────────────────────────────────────── */

test('cheaper metres buy more of them', () => {
  const reading = readingForDistrict(vake, [snapshot()]);
  const a = affordableArea({ budget: 150_000, currency: 'USD', reading });
  assert.equal(a.availability, 'ESTABLISHED');
  // low price 1560 -> the most area; high price 5850 -> the least.
  assert.ok(Math.abs(a.sqm.high - 150_000 / 1560) < 1e-6);
  assert.ok(Math.abs(a.sqm.low - 150_000 / 5850) < 1e-6);
  assert.ok(a.sqm.low < a.sqm.typical && a.sqm.typical < a.sqm.high);
});

test('a coverage gap stays a coverage gap rather than becoming zero area', () => {
  const reading = readingForDistrict(saburtalo, [snapshot()]);
  const a = affordableArea({ budget: 150_000, currency: 'USD', reading });
  assert.equal(a.availability, 'COVERAGE_GAP');
  assert.equal(a.sqm, null);
});

test('a currency mismatch without a rate refuses to guess', () => {
  const reading = readingForDistrict(vake, [snapshot()]);
  const a = affordableArea({ budget: 400_000, currency: 'GEL', reading });
  assert.equal(a.availability, 'COVERAGE_GAP');
  assert.equal(a.sqm, null);
});

test('a supplied rate is used and the result is stated in the budget currency', () => {
  const reading = readingForDistrict(vake, [snapshot()]);
  const a = affordableArea({ budget: 400_000, currency: 'GEL', reading, fxToBudgetCurrency: 2.7 });
  assert.equal(a.availability, 'ESTABLISHED');
  assert.equal(a.pricePerSqm.currency, 'GEL');
  assert.ok(Math.abs(a.pricePerSqm.median - 2580 * 2.7) < 1e-9);
});

test('a nonsensical budget produces no answer', () => {
  const reading = readingForDistrict(vake, [snapshot()]);
  for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(affordableArea({ budget, currency: 'USD', reading }).sqm, null, String(budget));
  }
});

test('area bands are bands, and nonsense has no band', () => {
  assert.equal(areaBand(30), 'STUDIO');
  assert.equal(areaBand(58), 'ONE_TWO');
  assert.equal(areaBand(95), 'TWO_THREE');
  assert.equal(areaBand(140), 'THREE_PLUS');
  assert.equal(areaBand(0), null);
  assert.equal(areaBand(Number.NaN), null);
});

test('the ranking contains only districts we have evidence for', () => {
  const readings = readingsForCity('tbilisi', [
    snapshot(),
    snapshot({ scope_key: 'villion', district: 'კრწანისი', median_price_per_sqm: 2200, lower_price_per_sqm: 1900, upper_price_per_sqm: 2300, usable_comparable_count: 6 }),
  ]);
  const ranked = rankByArea(150_000, 'USD', readings);
  assert.equal(ranked.length, 2);
  // Krtsanisi is cheaper, so the same money goes further there.
  assert.equal(ranked[0].reading.district.key, 'krtsanisi');
  assert.ok(ranked[0].sqm.typical > ranked[1].sqm.typical);
});
