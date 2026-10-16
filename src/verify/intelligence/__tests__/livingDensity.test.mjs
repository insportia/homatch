import test from 'node:test';
import assert from 'node:assert/strict';
import { livingDensityFrom } from '../livingDensity.ts';

test('Villion: two 8-storey buildings, 42 homes, 2,145 m² plot → ~2.6 per floor, ~51 m² per household, boutique', () => {
  const d = livingDensityFrom({ floors: '8', buildings: '2', unitCounts: '42' }, 2145);
  assert.equal(d.unitsPerFloor, 2.6);
  assert.equal(d.landPerUnitSqm, 51);
  assert.equal(d.boutique, true);
});

test('a corridor block is not called boutique; missing scale returns nothing', () => {
  assert.equal(livingDensityFrom({ floors: '16', buildings: '1', unitCounts: '192' }, null).boutique, false);
  assert.equal(livingDensityFrom({ floors: '8' }, 2000), null);
  assert.equal(livingDensityFrom({}, null), null);
});
