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

// ── Stairs and opening leaves (ds-read-2) ─────────────────────────────────

/** A 1.0 m x 3.0 m flight against the west wall of the living room (x 30..130 px, y 200..500 px). */
const flight = (over = {}) => ({
  id: 's-1', confidence: 0.9, state: 'VERIFIED', direction: 'UP', treads: null,
  polygon: [{ x: 30, y: 200 }, { x: 130, y: 200 }, { x: 130, y: 500 }, { x: 30, y: 500 }],
  startEdge: null, ...over,
});

test('a plan without stairs or leaves produces exactly the scene it always did (no new keys)', () => {
  const { scene } = generateScene(fixture());
  assert.equal('stairs' in scene, false, 'no stairs key when none were built');
  for (const w of scene.walls) for (const o of w.openings) {
    assert.equal('leaf' in o, false);
    assert.equal('swing' in o, false);
  }
  const none = generateScene(fixture({ stairs: [] })).scene;
  assert.equal(JSON.stringify(none), JSON.stringify(scene), 'an empty stairs list changes nothing');
  const unverified = generateScene(fixture({ stairs: [flight({ state: 'UNVERIFIED' })] })).scene;
  assert.equal(JSON.stringify(unverified), JSON.stringify(scene), 'an unverified flight is not built and changes nothing');
});

test('a verified flight with a drawn start edge: metres, footprint on the left, treads counted', () => {
  const { scene } = generateScene(fixture({ stairs: [flight({ startEdge: [{ x: 30, y: 500 }, { x: 130, y: 500 }], treads: 14 })] }));
  assert.equal(scene.stairs.length, 1);
  const st = scene.stairs[0];
  // y flips: pixel y 500 is plan y 1.0; the flight climbs north to plan y 4.0.
  assert.deepEqual([st.a, st.b].map((p) => [p.x, p.y]).sort(), [[0.3, 1], [1.3, 1]]);
  assert.equal(st.runM, 3);
  assert.equal(st.riseM, 2.7);
  assert.equal(st.treads, 14);
  assert.equal(st.direction, 'UP');
  const left = { x: -(st.b.y - st.a.y), y: st.b.x - st.a.x };
  const mid = { x: (st.a.x + st.b.x) / 2 + left.x * 0.5, y: (st.a.y + st.b.y) / 2 + left.y * 0.5 };
  assert.ok(mid.y > 1, 'the footprint lies to the left of a->b');
  assert.equal(st.polygon.length, 4);
  assert.equal(JSON.stringify(generateScene(fixture({ stairs: [flight({ startEdge: [{ x: 30, y: 500 }, { x: 130, y: 500 }], treads: 14 })] })).scene), JSON.stringify(scene), 'deterministic');
});

test('without a drawn start edge, the flight starts at the short end nearer a door (deterministic)', () => {
  // Door d-1 sits mid-way on the dividing wall at plan (4, 3): both short ends are 2.5 m and 3.5 m away.
  const { scene } = generateScene(fixture({ stairs: [flight()] }));
  const st = scene.stairs[0];
  assert.equal(st.a.y, st.b.y, 'the start edge is a short (horizontal) end');
  assert.equal(st.a.y, 4, 'the north end (plan y 4) is nearer the door at y 3 than the south end (y 1)');
  assert.equal(st.runM, 3);
  assert.equal(st.treads, 11, 'round(3.0 / 0.27) = 11');
  // No door at all: the end with more clearance from the walls (both 1 m from the south / north walls): tie -> lower coordinate.
  const noDoor = generateScene(fixture({ doors: [], stairs: [flight()] })).scene.stairs[0];
  assert.equal(noDoor.a.y, 1);
});

test('treads are clamped to 3..25, DOWN is kept and UNKNOWN builds as UP', () => {
  const many = generateScene(fixture({ stairs: [flight({ treads: 60 })] })).scene.stairs[0];
  assert.equal(many.treads, 25);
  const few = generateScene(fixture({ stairs: [flight({ treads: 1 })] })).scene.stairs[0];
  assert.equal(few.treads, 3);
  assert.equal(generateScene(fixture({ stairs: [flight({ direction: 'DOWN' })] })).scene.stairs[0].direction, 'DOWN');
  assert.equal(generateScene(fixture({ stairs: [flight({ direction: 'UNKNOWN' })] })).scene.stairs[0].direction, 'UP');
});

test('a degenerate flight is skipped with a code; the building still builds', () => {
  const bad = [
    flight({ id: 's-few', polygon: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
    flight({ id: 's-flat', polygon: [{ x: 30, y: 200 }, { x: 130, y: 200 }, { x: 230, y: 200 }] }),
    flight({ id: 's-narrow', startEdge: [{ x: 30, y: 500 }, { x: 40, y: 500 }] }),
  ];
  const { scene, validation } = generateScene(fixture({ stairs: bad }));
  assert.ok(scene);
  assert.equal('stairs' in scene, false);
  const codes = Object.fromEntries(validation.skips.map((s) => [s.elementId, s.code]));
  assert.equal(codes['s-few'], 'STAIR_TOO_FEW_POINTS');
  assert.equal(codes['s-flat'], 'STAIR_ZERO_AREA');
  assert.equal(codes['s-narrow'], 'STAIR_DEGENERATE');
});

test('stairs never move the plan: the extent and the walls are the same with or without them', () => {
  const plain = generateScene(fixture()).scene;
  const withStairs = generateScene(fixture({ stairs: [flight()] })).scene;
  assert.deepEqual(withStairs.extent, plain.extent);
  assert.deepEqual(withStairs.walls, plain.walls);
});

test('a leaf travels into the opening; FRENCH is full height; swingRoomId becomes the side', () => {
  const doors = [{
    id: 'd-1', wallId: 'w-mid', position: 0.5, widthPx: 90, sillHeightM: 0, heightM: 2.1,
    confidence: 0.9, state: 'VERIFIED', leaf: 'HINGED', swingRoomId: 'r-2',
  }, {
    id: 'd-2', wallId: 'w-s', position: 0.25, widthPx: 140, sillHeightM: null, heightM: null,
    confidence: 0.9, state: 'VERIFIED', leaf: 'FRENCH',
  }];
  const { scene } = generateScene(fixture({ doors }));
  const d1 = scene.walls.find((w) => w.id === 'w-mid').openings.find((o) => o.id === 'd-1');
  assert.equal(d1.leaf, 'HINGED');
  // w-mid runs from pixel (400,0) to (400,600): plan north to south, so its left (L) is east: r-2.
  assert.equal(d1.swing, 'L');
  const d2 = scene.walls.find((w) => w.id === 'w-s').openings.find((o) => o.id === 'd-2');
  assert.equal(d2.leaf, 'FRENCH');
  assert.equal(d2.sillM, 0);
  assert.equal(d2.heightM, 2.5, 'a French door runs to the ceiling less a 0.2 m lintel');
  assert.equal('swing' in d2, false, 'no swing without a swingRoomId');
});
