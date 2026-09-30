// EVERY CHANGE IS AN OPERATION: validated, applied deterministically,
// undoable exactly, and refused with a reason when it is not allowed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel, floorSurfaceId, surfacesOfRoom } from '../space.ts';
import { emptyDesignState } from '../designState.ts';
import { applyOperation, applyTransaction, validateOperation } from '../operations.ts';
import { emptyHistory, record, redo, undo } from '../history.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const ctx = { space, assets: testAssets(), materials: testMaterials() };
const sofa = (over = {}) => ({
  instanceId: 'sofa-1', assetId: 'dev/sofa-3', roomId: 'r-living', position: { x: 3, y: 0, z: 3.5 },
  rotationY: 0, materialVariant: null, colorOverride: null, locked: false, ...over,
});
const withSofa = () => applyOperation(emptyDesignState(), { type: 'ADD_OBJECT', object: sofa() }).state;
const livingWalls = surfacesOfRoom(space, 'r-living').filter((s) => s.kind === 'WALL').map((s) => s.id);

test('adding a valid object is accepted and its inverse removes it', () => {
  const s0 = emptyDesignState();
  const op = { type: 'ADD_OBJECT', object: sofa() };
  assert.equal(validateOperation(s0, op, ctx), null);
  const { state, inverse } = applyOperation(s0, op);
  assert.equal(state.objects.length, 1);
  assert.deepEqual(applyOperation(state, inverse[0]).state, s0);
});

test('an object through a wall is REJECTED with the placement findings', () => {
  const r = validateOperation(emptyDesignState(), { type: 'ADD_OBJECT', object: sofa({ position: { x: 5.6, y: 0, z: 3.5 }, rotationY: Math.PI / 2 }) }, ctx);
  assert.equal(r.code, 'PLACEMENT_BLOCKED');
  assert.ok(r.placement.some((i) => i.code === 'THROUGH_WALL'));
});

test('unknown, inactive and duplicate references are rejected', () => {
  const s = withSofa();
  assert.equal(validateOperation(s, { type: 'ADD_OBJECT', object: sofa() }, ctx).code, 'DUPLICATE_OBJECT');
  assert.equal(validateOperation(s, { type: 'ADD_OBJECT', object: sofa({ instanceId: 'x', assetId: 'dev/nope' }) }, ctx).code, 'UNKNOWN_ASSET');
  assert.equal(validateOperation(s, { type: 'REPLACE_OBJECT', instanceId: 'sofa-1', assetId: 'dev/retired' }, ctx).code, 'INACTIVE_ASSET');
  assert.equal(validateOperation(s, { type: 'MOVE_OBJECT', instanceId: 'ghost', position: { x: 1, y: 0, z: 1 }, roomId: 'r-living' }, ctx).code, 'UNKNOWN_OBJECT');
  assert.equal(validateOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: ['wall:nope:L:r-living'], color: '#ffffff' }, ctx).code, 'UNKNOWN_SURFACE');
  assert.equal(validateOperation(s, { type: 'EXPLODE' }, ctx).code, 'UNKNOWN_OPERATION');
  assert.equal(validateOperation(s, { type: 'SET_OBJECT_COLOR', instanceId: 'sofa-1', color: 'red' }, ctx).code, 'BAD_COLOR');
  assert.equal(validateOperation(s, { type: 'MOVE_OBJECT', instanceId: 'sofa-1', position: { x: Number.NaN, y: 0, z: 1 }, roomId: 'r-living' }, ctx).code, 'MALFORMED');
});

test('replacing keeps the logical position; the inverse restores the old asset', () => {
  const s = withSofa();
  const op = { type: 'REPLACE_OBJECT', instanceId: 'sofa-1', assetId: 'dev/sofa-2' };
  assert.equal(validateOperation(s, op, ctx), null);
  const { state, inverse } = applyOperation(s, op);
  assert.equal(state.objects[0].assetId, 'dev/sofa-2');
  assert.deepEqual(state.objects[0].position, s.objects[0].position);
  assert.deepEqual(applyOperation(state, inverse[0]).state.objects[0].assetId, 'dev/sofa-3');
});

test('a material can only go on a surface it is made for', () => {
  const s = emptyDesignState();
  assert.equal(validateOperation(s, { type: 'ASSIGN_MATERIAL', surfaceIds: [floorSurfaceId('r-living')], materialId: 'm-oak' }, ctx), null);
  assert.equal(validateOperation(s, { type: 'ASSIGN_MATERIAL', surfaceIds: [livingWalls[0]], materialId: 'm-oak' }, ctx).code, 'MATERIAL_NOT_FOR_SURFACE');
});

test('painting a room applies to all its walls, and one undo restores every one', () => {
  const s = emptyDesignState();
  const { state, inverse } = applyOperation(s, { type: 'SET_SURFACE_COLOR', surfaceIds: livingWalls, color: '#f2eee6' });
  assert.equal(livingWalls.every((id) => state.surfaces[id].color === '#f2eee6'), true);
  assert.deepEqual(applyOperation(state, inverse[0]).state.surfaces, {});
});

test('a locked object refuses to move, change or disappear', () => {
  const s = applyOperation(withSofa(), { type: 'LOCK_OBJECT', instanceId: 'sofa-1' }).state;
  for (const op of [
    { type: 'MOVE_OBJECT', instanceId: 'sofa-1', position: { x: 2, y: 0, z: 3 }, roomId: 'r-living' },
    { type: 'ROTATE_OBJECT', instanceId: 'sofa-1', rotationY: 1 },
    { type: 'REPLACE_OBJECT', instanceId: 'sofa-1', assetId: 'dev/sofa-2' },
    { type: 'REMOVE_OBJECT', instanceId: 'sofa-1' },
    { type: 'SET_OBJECT_COLOR', instanceId: 'sofa-1', color: '#000000' },
  ]) {
    assert.equal(validateOperation(s, op, ctx)?.code, 'OBJECT_LOCKED', op.type);
  }
  assert.equal(validateOperation(s, { type: 'UNLOCK_OBJECT', instanceId: 'sofa-1' }, ctx), null);
});

test('category locks protect the floor, the walls, the layout, colours and lighting', () => {
  const locked = (locks) => applyOperation(withSofa(), { type: 'SET_LOCKS', locks }).state;
  assert.equal(validateOperation(locked({ floor: true }), { type: 'ASSIGN_MATERIAL', surfaceIds: [floorSurfaceId('r-living')], materialId: 'm-oak' }, ctx).detail, 'floor');
  assert.equal(validateOperation(locked({ walls: true }), { type: 'SET_SURFACE_COLOR', surfaceIds: [livingWalls[0]], color: '#ffffff' }, ctx).detail, 'walls');
  assert.equal(validateOperation(locked({ layout: true }), { type: 'MOVE_OBJECT', instanceId: 'sofa-1', position: { x: 2, y: 0, z: 3 }, roomId: 'r-living' }, ctx).detail, 'layout');
  assert.equal(validateOperation(locked({ colors: true }), { type: 'APPLY_PALETTE', palette: ['#ffffff'] }, ctx).detail, 'colors');
  assert.equal(validateOperation(locked({ lighting: true }), { type: 'SET_LIGHTING', lighting: { timeOfDay: 'NIGHT' } }, ctx).detail, 'lighting');
});

test('a transaction is all or nothing', () => {
  const ops = [
    { type: 'ADD_OBJECT', object: sofa() },
    { type: 'SET_SURFACE_COLOR', surfaceIds: livingWalls, color: '#f2eee6' },
    { type: 'ADD_OBJECT', object: sofa({ instanceId: 'bad', position: { x: 5.6, y: 0, z: 3.5 }, rotationY: Math.PI / 2 }) },
  ];
  const r = applyTransaction(emptyDesignState(), ops, ctx, { id: 't1', label: 'plan', origin: 'AI' });
  assert.equal(r.ok, false);
  assert.equal(r.index, 2);
  assert.equal(r.rejection.code, 'PLACEMENT_BLOCKED');
});

test('a grouped change undoes as ONE step and redoes exactly', () => {
  const s0 = emptyDesignState();
  const r = applyTransaction(s0, [
    { type: 'ADD_OBJECT', object: sofa() },
    { type: 'SET_OBJECT_COLOR', instanceId: 'sofa-1', color: '#d8c8b0' },
    { type: 'SET_SURFACE_COLOR', surfaceIds: livingWalls, color: '#f2eee6' },
    { type: 'SET_LIGHTING', lighting: { temperature: 'WARM', timeOfDay: 'EVENING' } },
  ], ctx, { id: 't1', label: 'Warmer', origin: 'AI' });
  assert.equal(r.ok, true);
  let h = record(emptyHistory(), r.transaction);
  const back = undo(h, r.state);
  assert.deepEqual(back.state, s0, 'one undo did not restore the original state');
  h = back.history;
  const forward = redo(h, back.state);
  assert.deepEqual(forward.state, r.state);
  assert.equal(forward.history.future.length, 0);
});

test('a new change after undo discards the redo branch', () => {
  const r1 = applyTransaction(emptyDesignState(), [{ type: 'ADD_OBJECT', object: sofa() }], ctx, { id: 'a', label: 'a', origin: 'USER' });
  let h = record(emptyHistory(), r1.transaction);
  const u = undo(h, r1.state);
  const r2 = applyTransaction(u.state, [{ type: 'APPLY_PALETTE', palette: ['#111111'] }], ctx, { id: 'b', label: 'b', origin: 'USER' });
  h = record(u.history, r2.transaction);
  assert.equal(h.future.length, 0);
  assert.equal(redo(h, r2.state), null);
});

test('application is deterministic and never mutates its input', () => {
  const s = withSofa();
  const frozen = JSON.stringify(s);
  const op = { type: 'MOVE_OBJECT', instanceId: 'sofa-1', position: { x: 2.5, y: 0, z: 3 }, roomId: 'r-living' };
  const a = applyOperation(s, op).state;
  const b = applyOperation(s, op).state;
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), frozen);
});
