// THE SURFACES A DESIGN CAN ADDRESS, AND WHICH ROOM EACH ONE FACES.
//
// A wall between the living room and the bedroom has two faces; painting the
// living room must paint only the living-room face. These tests pin that
// relationship, and the orientation mapping the renderer relies on.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpaceModel, wallFrame, parseSurfaceId, surfacesOfRoom, roomContaining, pointInPolygon,
  floorSurfaceId, wallSurfaceId,
} from '../space.ts';
import { oneBedroomScene } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const wall = (id) => space.walls.find((w) => w.id === id);

test('every room of the plan becomes a room of the space, with bounds', () => {
  assert.deepEqual(space.rooms.map((r) => r.id).sort(), ['r-bath', 'r-bed', 'r-hall', 'r-living']);
  const living = space.rooms.find((r) => r.id === 'r-living');
  assert.equal(Math.round(living.areaM2), 42);
  assert.deepEqual(living.bounds, { minX: 0, minY: 0, maxX: 6, maxY: 7 });
});

test('an interior wall is split into one face segment per room it borders', () => {
  // w-i1 separates the living room from the bedroom AND the bathroom.
  const w = wall('w-i1');
  const bySide = { L: [], R: [] };
  for (const seg of w.segments) bySide[seg.side].push(seg.roomId);
  const livingSide = bySide.L.includes('r-living') ? 'L' : 'R';
  const otherSide = livingSide === 'L' ? 'R' : 'L';
  assert.deepEqual(bySide[livingSide], ['r-living']);
  assert.deepEqual([...bySide[otherSide]].sort(), ['r-bath', 'r-bed']);
  const segs = w.segments.filter((s) => s.side === otherSide).sort((x, y) => x.from - y.from);
  assert.ok(segs[0].to <= segs[1].from + 1e-9, 'segments overlap');
});

test('the outside face of an exterior wall is not a design surface', () => {
  const south = wall('w-s');
  assert.equal(new Set(south.segments.map((s) => s.side)).size, 1, 'segments on both faces of an exterior wall');
  assert.deepEqual([...new Set(south.segments.map((s) => s.roomId))].sort(), ['r-bath', 'r-hall', 'r-living']);
});

test('a room owns its floor, its ceiling and the wall faces looking into it — nothing else', () => {
  const bath = surfacesOfRoom(space, 'r-bath');
  assert.ok(bath.some((s) => s.id === floorSurfaceId('r-bath')));
  assert.ok(bath.some((s) => s.kind === 'CEILING'));
  const bathWalls = bath.filter((s) => s.kind === 'WALL');
  assert.equal(bathWalls.length, 4, `bath sees ${bathWalls.length} wall faces`);
  assert.ok(bathWalls.every((s) => s.roomId === 'r-bath'));
});

test('surface ids round-trip', () => {
  assert.deepEqual(parseSurfaceId(floorSurfaceId('r-1')), { kind: 'FLOOR', roomId: 'r-1' });
  assert.deepEqual(parseSurfaceId(wallSurfaceId('w-9', 'L', 'r-2')), { kind: 'WALL', wallId: 'w-9', side: 'L', roomId: 'r-2' });
  assert.equal(parseSurfaceId('wall:w-9:X:r-2'), null);
  assert.equal(parseSurfaceId('wall:w-9:L'), null);
  assert.equal(parseSurfaceId('nonsense'), null);
});

test('doors are located on their wall in plan metres', () => {
  const entry = space.doors.find((d) => d.id === 'd-entry');
  assert.ok(entry);
  assert.ok(Math.abs(entry.centre.x - 10) < 1e-6, `entry x ${entry.centre.x}`);
  assert.ok(entry.centre.y > 0 && entry.centre.y < 3, `entry y ${entry.centre.y}`);
});

test('wall frame: L is the left-hand normal walking start to end', () => {
  const f = wallFrame({ start: { x: 0, y: 0 }, end: { x: 2, y: 0 } });
  assert.deepEqual(f.normalL, { x: -0, y: 1 });
  assert.deepEqual(f.normalR, { x: 0, y: -1 });
  const diag = wallFrame({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
  assert.ok(Math.abs(diag.angle - Math.PI / 4) < 1e-12);
});

test('a point is placed in the smallest room that contains it', () => {
  assert.equal(roomContaining(space, { x: 3, y: 3 }), 'r-living');
  assert.equal(roomContaining(space, { x: 50, y: 50 }), null);
  assert.equal(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]), true, 'a vertex is inside');
});

test('the renderer mapping keeps diagonal walls pointing the right way', async () => {
  const { wallSlabPlacement, rotateY } = await import('../space.ts');
  const wall = { start: { x: 0, y: 0 }, end: { x: 3, y: 4 } };
  const { rotationY, position } = wallSlabPlacement(wall, 0, 0, 5, 2.7);
  const localX = rotateY({ x: 1, y: 0, z: 0 }, rotationY);
  // Plan direction (0.6, 0.8) is world (0.6, 0, -0.8).
  assert.ok(Math.abs(localX.x - 0.6) < 1e-9 && Math.abs(localX.z + 0.8) < 1e-9, JSON.stringify(localX));
  // Local +z is the R side: plan normal (0.8, -0.6) -> world (0.8, 0, 0.6).
  const localZ = rotateY({ x: 0, y: 0, z: 1 }, rotationY);
  assert.ok(Math.abs(localZ.x - 0.8) < 1e-9 && Math.abs(localZ.z - 0.6) < 1e-9, JSON.stringify(localZ));
  assert.deepEqual(position, { x: 1.5, y: 1.35, z: -2 });
});
