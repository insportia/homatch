// marketBrief.test.mjs — V2 MARKET does not ask the model to write back the code-gathered comparables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marketLaneBrief } from '../../marketLane.ts';

const lane = {
  comparables: [
    { area: 80, rooms: 3, price: 120000, currency: 'USD', pricePerSqm: 1500, comparableType: 'SAME_PROJECT', url: 'https://example.test/a' },
    { area: 75, rooms: 3, price: 110000, currency: 'USD', pricePerSqm: 1467, comparableType: 'MICRO_LOCATION', url: 'https://example.test/b' },
  ],
  summary: { advertisements: 2, uniqueProperties: 2, crossPosted: 0, uncertainDuplicates: 0, independentSourceCount: 1, portals: ['x'], widened: false },
  conflicts: [],
};

test('V1 (the default) still asks the model to restate the gathered comparables — byte-identical brief', () => {
  assert.equal(marketLaneBrief(lane), marketLaneBrief(lane, { restate: true }));
  assert.match(marketLaneBrief(lane), /restate and interpret these/);
});

test('V2 lists the same comparables but asks only for listings at new URLs', () => {
  const v1 = marketLaneBrief(lane);
  const v2 = marketLaneBrief(lane, { restate: false });
  assert.doesNotMatch(v2, /restate/);
  assert.match(v2, /do NOT repeat any of them in comparables\[\]/);
  assert.match(v2, /URLs NOT listed below/);
  for (const url of ['https://example.test/a', 'https://example.test/b']) assert.ok(v1.includes(url) && v2.includes(url));
  // Everything else the model is told is unchanged.
  const strip = (s) => s.split('\n').filter((l) => !/COMPARABLES ALREADY GATHERED/.test(l)).join('\n');
  assert.equal(strip(v2), strip(v1));
});

test('an empty lane reads the same on both engines', () => {
  const empty = { comparables: [], summary: { advertisements: 0, uniqueProperties: 0, portals: [] }, conflicts: [] };
  assert.equal(marketLaneBrief(empty, { restate: false }), marketLaneBrief(empty));
});
