// Opening things in the walkthrough, and the capabilities that allow it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { motionAt, toggleMotion, validateCapabilities, validateInteractions } from '../interactions.ts';
import { buildWalkModel, isFree, move, setDoorClosed } from '../navigation.ts';
import { alignToNeighbours } from '../placement.ts';
import { validateOperation } from '../operations.ts';
import { emptyDesignState } from '../designState.ts';
import { buildSpaceModel, roomContaining } from '../space.ts';
import { oneBedroomScene, testAssets } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());

test('interaction specs: only bounded, well-formed parts survive', () => {
  const specs = validateInteractions([
    { id: 'door-left', kind: 'HINGED', role: 'WARDROBE', axis: 'y', open: -1.6, durationMs: 700 },
    { id: 'drawer-1', kind: 'SLIDING', role: 'DRAWER', axis: 'z', open: -0.35, durationMs: 50 },
    { id: 'spin', kind: 'HINGED', role: 'DOOR', axis: 'y', open: 7 },          // beyond a real hinge
    { id: 'far', kind: 'SLIDING', role: 'DRAWER', axis: 'z', open: 3 },        // beyond a real slide
    { id: 'door-left', kind: 'HINGED', role: 'DOOR', axis: 'y', open: 1 },     // duplicate id
    { id: 'Bad Id', kind: 'HINGED', role: 'DOOR', axis: 'y', open: 1 },
    { id: 'teleport', kind: 'TELEPORT', role: 'DOOR', axis: 'y', open: 1 },
  ]);
  assert.deepEqual(specs.map((s) => s.id), ['door-left', 'drawer-1']);
  assert.equal(specs[1].durationMs, 150, 'duration is bounded, never instant');
  assert.deepEqual(validateInteractions('nope'), []);
  assert.deepEqual(validateCapabilities(['MOVABLE', 'FLY', 'OPENABLE']), ['MOVABLE', 'OPENABLE']);
});

test('motion is time-based and eased: the same at any frame rate, never a jump', () => {
  const m = toggleMotion(0, 1, 800, 1000);
  assert.equal(motionAt(m, 1000).value, 0);
  const mid = motionAt(m, 1400);
  assert.ok(Math.abs(mid.value - 0.5) < 1e-9 && !mid.done);
  assert.ok(motionAt(m, 1100).value < 0.1, 'starts gently');
  assert.deepEqual(motionAt(m, 1800), { value: 1, done: true });
  // Reversed half-way: only the remaining distance, at the same speed.
  const back = toggleMotion(0.5, 0, 800, 2000);
  assert.equal(back.duration, 400);
  assert.equal(toggleMotion(0.3, 1, 800, 0, true).duration, 0, 'reduced motion: no animation');
});

test('a closed door blocks its doorway; opening it lets the body through', () => {
  const walk = buildWalkModel(space, [], testAssets());
  const bedDoor = [...walk.doorways.keys()].find((id) => id === 'd-bed');
  assert.ok(bedDoor, 'the bedroom door has a leaf');
  setDoorClosed(walk, 'd-bed', true);
  const blocked = move(walk, { x: 5, y: 5.0 }, { x: 2, y: 0 });
  assert.equal(roomContaining(space, blocked), 'r-living', 'walked through a closed door');
  setDoorClosed(walk, 'd-bed', false);
  const through = move(walk, { x: 5, y: 5.0 }, { x: 2, y: 0 });
  assert.equal(roomContaining(space, through), 'r-bed');
  assert.equal(isFree(walk, { x: 6, y: 5.0 }), true, 'the open doorway is free');
});

test('furniture lines up with its neighbours within a few centimetres, per axis', () => {
  const objects = [{ instanceId: 't', assetId: 'dev/coffee-table', roomId: 'r-living', position: { x: 3, y: 0, z: 2 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false }];
  const a = alignToNeighbours({ space, assets: testAssets(), objects }, { x: 3.05, y: 3.4 }, 'r-living', 'sofa');
  assert.deepEqual(a, { at: { x: 3, y: 3.4 }, alignedX: true, alignedY: false });
  const far = alignToNeighbours({ space, assets: testAssets(), objects }, { x: 3.3, y: 3.4 }, 'r-living', 'sofa');
  assert.equal(far.alignedX, false);
});

test('a piece that is not movable, rotatable or replaceable says so', () => {
  const assets = testAssets();
  const fixed = { ...assets.get('dev/kitchen-run'), capabilities: ['OPENABLE'] };
  assets.set('dev/kitchen-run', fixed);
  const state = { ...emptyDesignState(), objects: [{ instanceId: 'k', assetId: 'dev/kitchen-run', roomId: 'r-living', position: { x: 2, y: 0, z: 0.5 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false }] };
  const ctx = { space, assets, materials: new Map() };
  assert.equal(validateOperation(state, { type: 'MOVE_OBJECT', instanceId: 'k', position: { x: 2.5, y: 0, z: 0.5 }, roomId: 'r-living' }, ctx).code, 'NOT_ALLOWED_FOR_ASSET');
  assert.equal(validateOperation(state, { type: 'ROTATE_OBJECT', instanceId: 'k', rotationY: 1 }, ctx).code, 'NOT_ALLOWED_FOR_ASSET');
  assert.equal(validateOperation(state, { type: 'REPLACE_OBJECT', instanceId: 'k', assetId: 'dev/sofa-3' }, ctx).code, 'NOT_ALLOWED_FOR_ASSET');
});
