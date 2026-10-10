// A LIVING ROOM'S SEATING GROUP, ARRANGED AS ONE (seatingGroup.ts): a sofa that faces the television across the
// coffee table, armchairs at the table's sides, all clean by the same rules as any piece, and never at the cost of
// a way through the room.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel } from '../space.ts';
import { frontOf } from '../placement.ts';
import { arrangeSeating, seatRole, TV_VIEW_MAX_M, TV_VIEW_MIN_M } from '../walkthrough/seatingGroup.ts';
import { prodAssets } from './fixtures/devCatalogue.mjs';

// One 5 × 4 m living room, a door in the middle of its south wall.
const wall = (id, sx, sy, ex, ey, openings = []) => ({ id, kind: 'EXTERIOR', start: { x: sx, y: sy }, end: { x: ex, y: ey }, heightM: 2.7, lengthM: Math.hypot(ex - sx, ey - sy), thicknessM: 0.2, openings });
const scene = {
  walls: [
    wall('S', 0, 0, 5, 0, [{ id: 'D', kind: 'DOOR', offsetM: 2.5, widthM: 0.9, heightM: 2.1, sillM: 0 }]),
    wall('E', 5, 0, 5, 4), wall('N', 5, 4, 0, 4), wall('W', 0, 4, 0, 0),
  ],
  floors: [{ id: 'L', kind: 'LIVING', label: 'LIVING', areaM2: 20, outdoor: false, polygon: [{ x: 0.1, y: 0.1 }, { x: 4.9, y: 0.1 }, { x: 4.9, y: 3.9 }, { x: 0.1, y: 3.9 }], centroid: { x: 2.5, y: 2 } }],
  stairs: [], extent: { width: 5, depth: 4 }, ceilingHeightM: 2.7,
};
const space = buildSpaceModel(scene);
const room = space.rooms[0];
const assets = prodAssets();
const piece = (code, type, planned = null) => ({ item: { code, type }, role: seatRole(type, assets.get(code)), asset: assets.get(code), planned });

test('the sofa faces the television, the table between them, an armchair at its side', () => {
  const pieces = [piece('dev/sofa-3', 'SOFA', { at: { x: 2.5, y: 2 }, rotation: 0 }), piece('dev/tv-unit', 'TV_UNIT'), piece('dev/coffee-table', 'COFFEE_TABLE'), piece('dev/armchair', 'ARMCHAIR')];
  const got = arrangeSeating(space, assets, room, pieces, [], () => true);
  assert.ok(got);
  const pose = (type) => got.poses.find((p) => p.item.type === type);
  const sofa = pose('SOFA'); const tv = pose('TV_UNIT'); const table = pose('COFFEE_TABLE');
  const f = frontOf(sofa.rotation);
  const along = (p) => (p.at.x - sofa.at.x) * f.x + (p.at.y - sofa.at.y) * f.y;
  assert.ok(along(tv) >= TV_VIEW_MIN_M && along(tv) <= TV_VIEW_MAX_M);
  assert.ok(Math.abs(Math.cos(tv.rotation - sofa.rotation - Math.PI) - 1) < 0.01, 'the TV is turned back toward the sofa');
  assert.ok(along(table) > 0 && along(table) < along(tv));
  assert.ok(pose('ARMCHAIR'), 'an armchair beside the table');
});

test('a group that would close the way gives up its armchair first, and a room with no way at all gets no group', () => {
  const pieces = [piece('dev/sofa-3', 'SOFA'), piece('dev/tv-unit', 'TV_UNIT'), piece('dev/coffee-table', 'COFFEE_TABLE'), piece('dev/armchair', 'ARMCHAIR')];
  const noChair = arrangeSeating(space, assets, room, pieces, [], (objects) => objects.length <= 3);
  assert.ok(noChair && !noChair.poses.some((p) => p.item.type === 'ARMCHAIR'));
  assert.equal(arrangeSeating(space, assets, room, pieces, [], () => false), null);
});

test('a sofa alone is not a group (nothing to face): the plan stands as planned', () => {
  assert.equal(arrangeSeating(space, assets, room, [piece('dev/sofa-3', 'SOFA')], [], () => true), null);
});
