// THE GEOMETRY GENERATOR, PROVEN ON ITS OWN TERMS.
//
// These are not tests about a floor plan. They are tests about the four
// promises this layer makes, each of which is the reason it is code and not a
// model:
//
//   1. The same verified input produces byte-identical output, always.
//   2. It refuses to build without a scale, a ceiling height, an envelope or
//      a floor — it does not substitute a plausible one.
//   3. Unverified elements are NOT BUILT. Not built badly; not built.
//   4. It calls nothing. The module has no network and no three import, so
//      these run in the ordinary suite in milliseconds.
//
// The fixture below is a rectangle with one dividing wall, a door and a
// window. It is a TEST FIXTURE FOR A PURE FUNCTION, not a floor plan: it
// proves the arithmetic, and it proves nothing whatever about how well the
// model reads a real drawing. That is a separate question with its own answer
// (see REAL_FLOOR_PLAN_REQUIRED_FOR_ACCEPTANCE).

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScene, validate, totalAreaM2, GENERATOR_VERSION } from '../geometry.ts';

/** 800x600 px at 0.01 m/px = 8m x 6m. Every number below follows from that. */
function fixture(overrides = {}) {
  const V = 'VERIFIED';
  const wall = (id, x1, y1, x2, y2, kind = 'EXTERIOR') => ({
    id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
    kind, thicknessPx: kind === 'EXTERIOR' ? 30 : 10, confidence: 0.95, state: V,
  });
  return {
    sourceAssetId: 'asset-1',
    imageWidth: 800,
    imageHeight: 600,
    detectedScale: 0.01,
    scaleConfidence: 1,
    ceilingHeight: 2.7,
    ceilingHeightSource: 'DRAWING',
    walls: [
      wall('w-n', 0, 0, 800, 0),
      wall('w-e', 800, 0, 800, 600),
      wall('w-s', 800, 600, 0, 600),
      wall('w-w', 0, 600, 0, 0),
      wall('w-mid', 400, 0, 400, 600, 'INTERIOR'),
    ],
    doors: [{
      id: 'd-1', wallId: 'w-mid', position: 0.5, widthPx: 90,
      sillHeightM: 0, heightM: 2.1, confidence: 0.9, state: V,
    }],
    windows: [{
      id: 'win-1', wallId: 'w-n', position: 0.25, widthPx: 120,
      sillHeightM: 0.9, heightM: 1.4, confidence: 0.88, state: V,
    }],
    rooms: [{
      id: 'r-1', kind: 'LIVING', label: 'Living',
      polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 600 }, { x: 0, y: 600 }],
      statedAreaM2: 24, confidence: 0.97, state: V,
    }, {
      id: 'r-2', kind: 'BEDROOM', label: 'Bedroom',
      polygon: [{ x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 400, y: 600 }],
      statedAreaM2: 24, confidence: 0.97, state: V,
    }],
    balconies: [],
    unknownElements: [],
    warnings: [],
    extractionConfidence: 0.88,
    ...overrides,
  };
}

test('the same verified plan generates byte-identical geometry every time', () => {
  const a = generateScene(fixture()).scene;
  const b = generateScene(fixture()).scene;
  assert.ok(a, 'the fixture should be buildable');
  assert.equal(
    JSON.stringify(a), JSON.stringify(b),
    'two runs of the generator disagreed — the output is not deterministic, '
    + 'which would mean a published twin changes under its own cache key',
  );
  assert.equal(a.generatorVersion, GENERATOR_VERSION);
});

test('metres come out of pixels times the verified scale, and nowhere else', () => {
  const { scene } = generateScene(fixture());
  assert.equal(scene.extent.width, 8, '800px at 0.01 m/px is 8 metres');
  assert.equal(scene.extent.depth, 6);
  assert.equal(scene.ceilingHeightM, 2.7, 'the ceiling is the verified one');

  const north = scene.walls.find((w) => w.id === 'w-n');
  assert.equal(north.lengthM, 8);
  assert.equal(north.thicknessM, 0.3, '30px of drawn thickness is 0.3m');
  assert.equal(north.heightM, 2.7);

  // Two 4x6 rooms. If this is 48 the generator has double-counted a room.
  assert.equal(totalAreaM2(scene), 48);
});

test('an opening is placed along its own wall, in metres', () => {
  const { scene } = generateScene(fixture());
  const mid = scene.walls.find((w) => w.id === 'w-mid');
  const door = mid.openings.find((o) => o.id === 'd-1');
  assert.equal(door.kind, 'DOOR');
  assert.equal(door.offsetM, 3, 'half way along a 6m wall');
  assert.equal(door.widthM, 0.9);
  assert.equal(door.sillM, 0, 'a door starts at the floor');

  const north = scene.walls.find((w) => w.id === 'w-n');
  const window = north.openings.find((o) => o.id === 'win-1');
  assert.equal(window.offsetM, 2, 'a quarter along an 8m wall');
  assert.equal(window.sillM, 0.9);
});

test('NO SCALE MEANS NO BUILDING: the generator refuses rather than guessing', () => {
  const { scene, validation } = generateScene(fixture({ detectedScale: null }));
  assert.equal(scene, null, 'a plan with no scale must not produce geometry');
  assert.ok(validation.problems.some((p) => p.code === 'NO_SCALE'));
});

test('no ceiling height means no building either', () => {
  const { scene, validation } = generateScene(
    fixture({ ceilingHeight: null, ceilingHeightSource: null }));
  assert.equal(scene, null);
  assert.ok(validation.problems.some((p) => p.code === 'NO_CEILING_HEIGHT'));
});

test('an unverified wall is NOT BUILT — not guessed, not approximated', () => {
  const doc = fixture();
  doc.walls[4] = { ...doc.walls[4], state: 'UNVERIFIED' };
  const { scene } = generateScene(doc);
  assert.equal(scene.walls.length, 4, 'the unverified dividing wall must be absent');
  assert.equal(scene.skipped.walls, 1, 'and the scene must report that it is absent');
  assert.ok(
    !scene.walls.some((w) => w.id === 'w-mid'),
    'an unverified wall appeared in the output',
  );
});

test('an unverified window leaves a blank wall, never an invented one', () => {
  const doc = fixture();
  doc.windows[0] = { ...doc.windows[0], state: 'UNVERIFIED' };
  const { scene } = generateScene(doc);
  assert.equal(scene.built.windows, 0);
  assert.equal(scene.skipped.windows, 1);
  const north = scene.walls.find((w) => w.id === 'w-n');
  assert.equal(north.openings.length, 0, 'a window nobody verified was built anyway');
});

test('a door on a wall that does not exist is skipped, and the rest still builds', () => {
  const doc = fixture();
  doc.doors.push({
    id: 'd-orphan', wallId: 'w-nowhere', position: 0.5, widthPx: 90,
    sillHeightM: 0, heightM: 2.1, confidence: 0.9, state: 'VERIFIED',
  });
  const { scene, validation } = generateScene(doc);
  assert.ok(scene, 'one bad opening must not stop the building');
  assert.ok(validation.skips.some((s) => s.code === 'OPENING_WITHOUT_WALL'));
  assert.equal(scene.built.doors, 1, 'only the real door');
});

test('an opening wider than its wall is refused', () => {
  const doc = fixture();
  doc.doors[0] = { ...doc.doors[0], widthPx: 900 };
  const { validation } = generateScene(doc);
  assert.ok(validation.skips.some((s) => s.code === 'OPENING_WIDER_THAN_WALL'));
});

test('a room polygon comes out counter-clockwise however it was traced', () => {
  const doc = fixture();
  // Trace the same room the other way round.
  doc.rooms[0] = { ...doc.rooms[0], polygon: [...doc.rooms[0].polygon].reverse() };
  const { scene } = generateScene(doc);
  const room = scene.floors.find((f) => f.id === 'r-1');
  let twiceArea = 0;
  for (let i = 0; i < room.polygon.length; i += 1) {
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % room.polygon.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  assert.ok(twiceArea > 0, 'the winding was not normalised, so faces would flip');
  assert.equal(room.areaM2, 24, 'and the area is the same either way round');
});

test('a balcony is built as an outdoor floor, so nothing roofs it', () => {
  const doc = fixture();
  doc.balconies.push({
    id: 'b-1', kind: 'BALCONY', label: 'Balcony',
    polygon: [{ x: 0, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 700 }, { x: 0, y: 700 }],
    statedAreaM2: 4, confidence: 0.7, state: 'VERIFIED',
  });
  const { scene } = generateScene(doc);
  const balcony = scene.floors.find((f) => f.id === 'b-1');
  assert.equal(balcony.outdoor, true);
  assert.equal(totalAreaM2(scene), 48, 'a balcony is not internal area');
  assert.equal(totalAreaM2(scene, true), 52, 'and is counted when asked for');
});

test('a plan with no rooms and no envelope names both, rather than one', () => {
  const { validation } = generateScene(fixture({ walls: [], rooms: [] }));
  const codes = validation.problems.map((p) => p.code);
  assert.ok(codes.includes('NO_EXTERIOR_WALLS'));
  assert.ok(codes.includes('NO_ROOMS'));
});

test('validate() alone never throws on a malformed document', () => {
  const doc = fixture({
    walls: [{ id: 'bad', start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, kind: 'INTERIOR', thicknessPx: null, confidence: 0.5, state: 'VERIFIED' }],
    rooms: [{ id: 'flat', kind: 'UNKNOWN', label: null, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }], statedAreaM2: null, confidence: 0.4, state: 'VERIFIED' }],
  });
  const result = validate(doc);
  assert.ok(result.skips.some((s) => s.code === 'DEGENERATE_WALL'));
  assert.ok(result.skips.some((s) => s.code === 'ROOM_TOO_FEW_POINTS'));
});
