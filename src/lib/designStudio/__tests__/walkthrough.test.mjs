// Walking the real geometry, and a camera that reads the plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWalkModel, isFree, move, BODY_RADIUS_M } from '../navigation.ts';
import { clearSight, entryShot, roomGraph, roomShot, tourOrder } from '../cameraDirector.ts';
import { buildSpaceModel, roomContaining } from '../space.ts';
import { generateScene } from '../../floorplan/geometry.ts';
import { oneBedroomDoc, oneBedroomScene, testAssets } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const assets = testAssets();
const empty = buildWalkModel(space, [], assets);

// Fixture in PLAN metres (y up; the drawing's y is flipped by the generator):
// living x 0–6; bedroom x 6–10, y 3–7; bath x 6–8, y 0–3; hall x 8–10,
// y 0–3. Interior wall at x = 6 with doors at y = 5.0 (bedroom) and y = 1.5
// (bath); the entry door is on the east wall at y = 1.5.

test('a wall stops the body; it does not pass through', () => {
  const end = move(empty, { x: 3, y: 3.5 }, { x: 5, y: 0 });
  assert.ok(end.x < 6 - 0.05 - BODY_RADIUS_M + 0.01 && end.x > 5.5, `stopped at ${end.x}`);
  assert.equal(roomContaining(space, end), 'r-living');
});

test('a door lets the body through', () => {
  const end = move(empty, { x: 5, y: 5.0 }, { x: 2, y: 0 });
  assert.equal(roomContaining(space, end), 'r-bed', JSON.stringify(end));
});

test('the exterior wall keeps the body inside', () => {
  const end = move(empty, { x: 1, y: 3.5 }, { x: -3, y: 0 });
  assert.ok(end.x >= 0.125 + BODY_RADIUS_M - 0.01, `left the apartment: ${end.x}`);
});

test('a blocked move slides along the wall instead of stopping', () => {
  const end = move(empty, { x: 5.5, y: 3.0 }, { x: 1, y: 1 });
  assert.ok(end.y > 3.9, `did not slide: ${JSON.stringify(end)}`);
  assert.ok(end.x < 6, 'went through the wall');
});

test('one huge step cannot tunnel through a wall', () => {
  const end = move(empty, { x: 5.6, y: 3.5 }, { x: 40, y: 0 });
  assert.equal(roomContaining(space, end), 'r-living');
});

test('furniture from the current design is in the way; a rug is not', () => {
  const sofa = { instanceId: 's', assetId: 'dev/sofa-3', roomId: 'r-living', position: { x: 3, y: 0, z: 3.5 }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false };
  const rug = { ...sofa, instanceId: 'r', assetId: 'dev/rug-large', position: { x: 3, y: 0, z: 5.5 } };
  const walk = buildWalkModel(space, [sofa, rug], assets);
  assert.equal(isFree(walk, { x: 3, y: 3.5 }), false);
  assert.equal(isFree(walk, { x: 3, y: 5.5 }), true);
  const end = move(walk, { x: 3, y: 1.5 }, { x: 0, y: 4 });
  assert.ok(end.y < 3.5 - 0.47, `walked through the sofa: ${end.y}`);
});

test('the room graph finds the entry and which doors join which rooms', () => {
  const g = roomGraph(space);
  assert.equal(g.entryRoomId, 'r-hall');
  assert.equal(g.entryDoorId, 'd-entry');
  const pairs = g.links.filter((l) => l.b).map((l) => [l.a, l.b].sort().join('~')).sort();
  assert.ok(pairs.includes('r-bed~r-living'), pairs.join(' '));
  assert.ok(pairs.length >= 3, pairs.join(' '));
});

test('the tour starts at the entry and visits every room', () => {
  const order = tourOrder(space);
  assert.equal(order[0], 'r-hall');
  assert.deepEqual([...order].sort(), ['r-bath', 'r-bed', 'r-hall', 'r-living']);
});

test('every room gets a shot from a free spot inside it, with a clear view', () => {
  for (const room of space.rooms) {
    const shot = roomShot(space, empty, room.id);
    assert.ok(shot, room.id);
    assert.equal(roomContaining(space, shot.position), room.id, `${room.id} shot stands in ${roomContaining(space, shot.position)}`);
    assert.ok(isFree(empty, shot.position), `${room.id} shot is inside something`);
    assert.ok(clearSight(empty, shot.position, shot.target), `${room.id} shot looks through a wall`);
    assert.ok(shot.fov > 30 && shot.fov < 80, `${room.id} fov ${shot.fov}`);
  }
});

test('the entry shot stands inside the entry door, looking in', () => {
  const shot = entryShot(space, empty);
  assert.equal(shot.kind, 'ENTRY');
  assert.equal(shot.roomId, 'r-hall');
  assert.ok(shot.target.x < shot.position.x, 'looking back out of the door');
});

test('a different plan gets different shots (nothing is hard-coded)', () => {
  const doc = oneBedroomDoc();
  const flip = (p) => ({ x: 1000 - p.x, y: p.y });
  const mirrored = {
    ...doc,
    walls: doc.walls.map((w) => ({ ...w, start: flip(w.end), end: flip(w.start) })),
    rooms: doc.rooms.map((r) => ({ ...r, polygon: r.polygon.map(flip).reverse() })),
  };
  const other = buildSpaceModel(generateScene(mirrored).scene);
  const walk = buildWalkModel(other, [], assets);
  const a = roomShot(space, empty, 'r-living');
  const b = roomShot(other, walk, 'r-living');
  assert.ok(Math.abs(a.position.x - (10 - b.position.x)) < 0.8, 'the mirrored plan is not shot as a mirror');
  assert.notDeepEqual(a.position, b.position);
});
