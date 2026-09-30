// DOES IT FIT — the rules that keep a sofa out of a wall and a doorway clear.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel } from '../space.ts';
import {
  autoPlace, evaluatePlacement, obbOverlap, snapToWall, frontOf, rotationFacing, quantise, blocks,
} from '../placement.ts';
import { oneBedroomScene, testAssets } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const assets = testAssets();
const room = (id) => space.rooms.find((r) => r.id === id);
const ctx = (objects = []) => ({ space, assets, objects });
const codes = (issues) => issues.map((i) => i.code).sort();

test('boxes that only touch do not overlap; boxes that cross do', () => {
  const a = { cx: 0, cy: 0, hw: 1, hd: 1, angle: 0 };
  assert.equal(obbOverlap(a, { cx: 2, cy: 0, hw: 1, hd: 1, angle: 0 }), false);
  assert.equal(obbOverlap(a, { cx: 1.5, cy: 0, hw: 1, hd: 1, angle: Math.PI / 4 }), true);
});

test('front and facing agree', () => {
  const f = frontOf(rotationFacing({ x: 1, y: 0 }));
  assert.ok(Math.abs(f.x - 1) < 1e-9 && Math.abs(f.y) < 1e-9);
});

test('a sofa in the middle of the living room is fine', () => {
  assert.deepEqual(evaluatePlacement(ctx(), assets.get('dev/sofa-3'), { x: 3, y: 3.5 }, 0, 'r-living'), []);
});

test('a sofa pushed through a wall is BLOCKED, not nudged', () => {
  // The interior wall w-i1 stands at x = 6.
  const issues = evaluatePlacement(ctx(), assets.get('dev/sofa-3'), { x: 5.6, y: 3.5 }, Math.PI / 2, 'r-living');
  assert.ok(blocks(issues));
  assert.ok(codes(issues).includes('THROUGH_WALL'));
});

test('a piece outside its room is BLOCKED', () => {
  const issues = evaluatePlacement(ctx(), assets.get('dev/coffee-table'), { x: 8, y: 5.5 }, 0, 'r-living');
  assert.ok(codes(issues).includes('OUTSIDE_ROOM'));
});

test('a 3.4 m sofa cannot be placed in a 2 m bathroom at all', () => {
  assert.equal(autoPlace(ctx(), assets.get('dev/sofa-xl'), room('r-bath')), null);
});

test('a wardrobe in front of the entry door WARNS that it blocks the doorway', () => {
  const entry = space.doors.find((d) => d.id === 'd-entry');
  const issues = evaluatePlacement(
    ctx(), assets.get('dev/wardrobe'), { x: entry.centre.x - 0.5, y: entry.centre.y }, rotationFacing({ x: -1, y: 0 }), 'r-hall',
  );
  const door = issues.find((i) => i.code === 'BLOCKS_DOOR');
  assert.ok(door, JSON.stringify(issues));
  assert.equal(door.severity, 'WARN');
});

test('a rug may lie under a sofa; a table may not stand inside it', () => {
  const sofa = {
    instanceId: 's1', assetId: 'dev/sofa-3', roomId: 'r-living', position: { x: 3, y: 0, z: 3.5 },
    rotationY: 0, materialVariant: null, colorOverride: null, locked: false,
  };
  assert.deepEqual(codes(evaluatePlacement(ctx([sofa]), assets.get('dev/rug-large'), { x: 3, y: 3.5 }, 0, 'r-living')), []);
  assert.ok(codes(evaluatePlacement(ctx([sofa]), assets.get('dev/coffee-table'), { x: 3, y: 3.5 }, 0, 'r-living')).includes('OVERLAPS_OBJECT'));
});

test('a sofa facing a wall 20 cm away has TIGHT access', () => {
  // The living room north wall is at y = 7 (thickness 0.25).
  const issues = evaluatePlacement(ctx(), assets.get('dev/sofa-3'), { x: 3, y: 7 - 0.125 - 0.475 - 0.2 }, 0, 'r-living');
  assert.ok(codes(issues).includes('TIGHT_ACCESS'), JSON.stringify(issues));
});

test('auto-placement puts a bed against a bedroom wall, facing in, with no findings', () => {
  const placed = autoPlace(ctx(), assets.get('dev/bed-double'), room('r-bed'));
  assert.ok(placed, 'no place found');
  assert.deepEqual(placed.issues, []);
  assert.deepEqual(evaluatePlacement(ctx(), assets.get('dev/bed-double'), placed.at, placed.rotation, 'r-bed'), []);
});

test('auto-placement is deterministic', () => {
  assert.deepEqual(
    autoPlace(ctx(), assets.get('dev/sofa-3'), room('r-living')),
    autoPlace(ctx(), assets.get('dev/sofa-3'), room('r-living')),
  );
});

test('dragging near a wall snaps the piece flat against it, facing the room', () => {
  // The west wall of the living room is at x = 0.
  const s = snapToWall(ctx(), assets.get('dev/sofa-3'), { x: 0.75, y: 3.5 }, 0.3, 'r-living');
  assert.equal(s.snapped, true);
  assert.ok(frontOf(s.rotation).x > 0.99, 'the sofa does not face into the room');
  assert.deepEqual(evaluatePlacement(ctx(), assets.get('dev/sofa-3'), s.at, s.rotation, 'r-living'), []);
});

test('positions and angles are quantised to what a preview can honestly claim', () => {
  const q = quantise({ x: 1.2345, y: 2.0261 }, 0.3);
  assert.deepEqual(q.at, { x: 1.25, y: 2.05 });
  assert.ok(Math.abs(q.rotation - Math.PI / 12) < 1e-6);
});
