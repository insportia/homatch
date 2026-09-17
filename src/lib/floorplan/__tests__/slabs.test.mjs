// A DOOR IS A HOLE. These prove the hole is actually there.
//
// The renderer cuts openings by arithmetic rather than by mesh booleans, so
// the correctness of every door and window in the product is the correctness
// of this one pure function. It is cheap to test and expensive to get wrong:
// an off-by-one here is a wall with a doorway you cannot walk through, or a
// window opening into the floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceWall, wallSolidAreaM2 } from '../slabs.ts';

const wall = (openings = [], lengthM = 4, heightM = 2.7) => ({
  id: 'w', kind: 'INTERIOR',
  start: { x: 0, y: 0 }, end: { x: lengthM, y: 0 },
  lengthM, thicknessM: 0.1, heightM, openings,
});

test('a wall with no openings is one solid piece', () => {
  const slabs = sliceWall(wall());
  assert.equal(slabs.length, 1);
  assert.deepEqual(slabs[0], { u: 0, v: 0, lengthM: 4, heightM: 2.7, role: 'SOLID' });
});

test('a door leaves solid either side and a lintel over it, and nothing under', () => {
  const slabs = sliceWall(wall([
    { id: 'd', kind: 'DOOR', offsetM: 2, widthM: 0.9, sillM: 0, heightM: 2.1 },
  ]));
  const solid = slabs.filter((s) => s.role === 'SOLID');
  assert.equal(solid.length, 2, 'a door in the middle leaves two solid returns');
  assert.equal(solid[0].lengthM, 1.55);
  assert.equal(solid[1].u, 2.45);

  assert.ok(
    !slabs.some((s) => s.role === 'UNDER_OPENING'),
    'a door starts at the floor, so nothing may be built under it',
  );
  const over = slabs.find((s) => s.role === 'OVER_OPENING');
  assert.equal(over.v, 2.1, 'the lintel starts at the door head');
  assert.ok(Math.abs(over.heightM - 0.6) < 0.001, 'the lintel reaches the ceiling');
});

test('a window leaves a spandrel under it as well as a lintel over it', () => {
  const slabs = sliceWall(wall([
    { id: 'win', kind: 'WINDOW', offsetM: 2, widthM: 1.2, sillM: 0.9, heightM: 1.4 },
  ]));
  const under = slabs.find((s) => s.role === 'UNDER_OPENING');
  const over = slabs.find((s) => s.role === 'OVER_OPENING');
  assert.equal(under.v, 0);
  assert.equal(under.heightM, 0.9, 'the wall under the sill');
  assert.equal(over.v, 2.3, 'sill plus window height');
  assert.ok(Math.abs(over.heightM - 0.4) < 0.001);
  assert.equal(under.lengthM, 1.2);
});

test('an opening at the very start of a wall leaves no phantom return', () => {
  const slabs = sliceWall(wall([
    { id: 'd', kind: 'DOOR', offsetM: 0.45, widthM: 0.9, sillM: 0, heightM: 2.1 },
  ]));
  assert.ok(
    !slabs.some((s) => s.role === 'SOLID' && s.lengthM === 0),
    'a zero-length slab would be an invisible degenerate mesh',
  );
  const solid = slabs.filter((s) => s.role === 'SOLID');
  assert.equal(solid.length, 1, 'only the run after the door');
  assert.equal(solid[0].u, 0.9);
});

test('a full-height full-width opening removes the wall entirely', () => {
  const slabs = sliceWall(wall([
    { id: 'big', kind: 'DOOR', offsetM: 2, widthM: 4, sillM: 0, heightM: 2.7 },
  ]));
  assert.equal(slabs.length, 0, 'nothing is left of the wall, and nothing is drawn');
  assert.equal(wallSolidAreaM2(wall([
    { id: 'big', kind: 'DOOR', offsetM: 2, widthM: 4, sillM: 0, heightM: 2.7 },
  ])), 0);
});

test('two openings on one wall both cut, and the pieces never overlap', () => {
  const w = wall([
    { id: 'a', kind: 'WINDOW', offsetM: 1, widthM: 0.8, sillM: 0.9, heightM: 1.4 },
    { id: 'b', kind: 'DOOR', offsetM: 3, widthM: 0.9, sillM: 0, heightM: 2.1 },
  ]);
  const slabs = sliceWall(w);
  // Solid area must equal the wall minus both holes, exactly.
  const holes = 0.8 * 1.4 + 0.9 * 2.1;
  assert.ok(
    Math.abs(wallSolidAreaM2(w) - (4 * 2.7 - holes)) < 0.02,
    `solid area ${wallSolidAreaM2(w)} does not match the wall minus its holes`,
  );
  // And no two slabs may occupy the same rectangle.
  for (let i = 0; i < slabs.length; i += 1) {
    for (let j = i + 1; j < slabs.length; j += 1) {
      const a = slabs[i];
      const b = slabs[j];
      const overlapU = a.u < b.u + b.lengthM && b.u < a.u + a.lengthM;
      const overlapV = a.v < b.v + b.heightM && b.v < a.v + a.heightM;
      assert.ok(!(overlapU && overlapV), 'two wall pieces overlap, so the wall is doubled');
    }
  }
});

test('an opening running past the end of a wall is clamped, not extrapolated', () => {
  const slabs = sliceWall(wall([
    { id: 'd', kind: 'DOOR', offsetM: 3.9, widthM: 1.2, sillM: 0, heightM: 2.1 },
  ]));
  for (const slab of slabs) {
    assert.ok(slab.u >= 0, 'a slab started before the wall');
    assert.ok(slab.u + slab.lengthM <= 4.0001, 'a slab ran past the end of the wall');
    assert.ok(slab.v + slab.heightM <= 2.7001, 'a slab ran through the ceiling');
  }
});

test('a degenerate wall produces nothing rather than throwing', () => {
  assert.deepEqual(sliceWall(wall([], 0)), []);
  assert.deepEqual(sliceWall(wall([], 4, 0)), []);
});
