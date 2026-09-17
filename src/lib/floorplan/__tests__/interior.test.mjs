// FURNITURE THAT REFUSES TO BE WRONG.
//
// The rule these prove is the one that decides whether a generated apartment
// can be shown to a buyer at all: a piece that does not fit CLEANLY is not
// nudged, shrunk or rotated until it does — the room fails and a person looks
// at it. A sofa through a wall costs more trust than an empty living room.

import test from 'node:test';
import assert from 'node:assert/strict';
import { furnish, placeRoom, MODERN_WARM, PRESETS } from '../interior.ts';

const room = (id, kind, w, d, areaOverride) => ({
  id, kind, label: null, outdoor: false,
  polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
  areaM2: areaOverride ?? w * d,
  centroid: { x: w / 2, y: d / 2 },
});

const scene = (floors, walls = []) => ({
  generatorVersion: 'test', ceilingHeightM: 2.7, walls, floors,
  extent: { width: 10, depth: 10 },
  built: { walls: walls.length, doors: 0, windows: 0, rooms: floors.length, balconies: 0 },
  skipped: { walls: 0, doors: 0, windows: 0, rooms: 0, balconies: 0 },
});

const recipeFor = (kind) => MODERN_WARM.rooms.find((r) => r.kind === kind);

test('a generous living room takes the whole recipe, inside its own polygon', () => {
  const living = room('r1', 'LIVING', 6, 5);
  const outcome = placeRoom(living, recipeFor('LIVING'), []);
  assert.equal(outcome.state, 'PLACED');
  for (const piece of outcome.placements) {
    assert.ok(piece.position.x > 0 && piece.position.x < 6, `${piece.assetId} left the room`);
    assert.ok(piece.position.y > 0 && piece.position.y < 5, `${piece.assetId} left the room`);
  }
});

test('placed furniture never overlaps, though a table may stand on a rug', () => {
  const outcome = placeRoom(room('r1', 'LIVING', 6, 5), recipeFor('LIVING'), []);
  // Floor coverings are two centimetres tall and are MEANT to be stood on;
  // treating them as obstacles is what makes every composed living room fail.
  const rects = outcome.placements
    .filter((p) => p.heightM > 0.05)
    .map((p) => ({
      x: p.position.x - p.widthM / 2, y: p.position.y - p.depthM / 2, w: p.widthM, d: p.depthM,
    }));
  assert.ok(
    outcome.placements.some((p) => p.heightM <= 0.05),
    'the fixture should include a rug, or this test proves nothing',
  );
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
      assert.ok(!hit, 'two pieces of furniture occupy the same floor');
    }
  }
});

test('a room too small for anything is skipped, not crammed', () => {
  const outcome = placeRoom(room('tiny', 'LIVING', 2, 2), recipeFor('LIVING'), []);
  assert.equal(outcome.state, 'SKIPPED_TOO_SMALL');
});

test('A DOOR IS NEVER BLOCKED: a piece that lands in the swing fails the room', () => {
  const bedroom = room('b1', 'BEDROOM', 3.2, 3.2);
  // A keep-out square over the whole room: nothing can be placed anywhere.
  const blocked = placeRoom(bedroom, recipeFor('BEDROOM'), [
    { x: -1, y: -1, w: 10, d: 10 },
  ]);
  assert.equal(blocked.state, 'MANUAL_REVIEW_REQUIRED');
  assert.match(blocked.reason, /does not fit/);
});

test('a piece wider than the room fails rather than being shrunk', () => {
  // 11 m² clears the bed's minimum, but a 1.8m wardrobe cannot stand in 1.6m.
  const narrow = room('n1', 'BEDROOM', 1.6, 7, 11.2);
  const outcome = placeRoom(narrow, recipeFor('BEDROOM'), []);
  assert.equal(outcome.state, 'MANUAL_REVIEW_REQUIRED');
});

test('a room with no recipe is reported, not furnished with something else', () => {
  const result = furnish(scene([room('c1', 'CORRIDOR', 6, 1.4)]), 'MODERN_WARM', new Set());
  assert.equal(result.rooms[0].state, 'NO_RECIPE');
});

test('a balcony is never furnished by an indoor preset', () => {
  const balcony = { ...room('bal', 'BALCONY', 4, 1.5), outdoor: true };
  const result = furnish(scene([balcony]), 'MODERN_WARM', new Set());
  assert.equal(result.rooms.length, 0, 'an outdoor floor must not be furnished indoors');
});

test('MISSING ASSETS BLOCK PUBLICATION, however well the placement went', () => {
  const result = furnish(scene([room('r1', 'LIVING', 6, 5)]), 'MODERN_WARM', new Set());
  assert.equal(result.rooms[0].state, 'PLACED', 'placement itself should succeed');
  assert.ok(result.missingAssets.length > 0, 'the library does not exist yet');
  assert.equal(
    result.publishable, false,
    'a scene naming geometry nobody authored would render as invisible furniture',
  );
});

test('a preset with no recipes is declared and places nothing', () => {
  for (const id of ['LUXURY_LIGHT', 'MINIMAL']) {
    assert.equal(PRESETS[id].state, 'FOUNDATION');
    const result = furnish(scene([room('r1', 'LIVING', 6, 5)]), id, new Set());
    assert.equal(result.rooms[0].state, 'NO_RECIPE');
    assert.equal(result.publishable, false);
  }
});

test('every preset declares itself FOUNDATION until its assets exist', () => {
  for (const preset of Object.values(PRESETS)) {
    assert.equal(
      preset.state, 'FOUNDATION',
      `${preset.id} claims READY — no asset library has been authored yet`,
    );
  }
});
