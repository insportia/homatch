// GEOMETRY BEFORE FURNITURE (walkthrough/geometryCheck.ts): a space read from pictures is checked against the
// evidence it came from — the rooms the customer's own picture shows, the pieces the reading put in each room, the
// home's wall directions, a bed's fit, reach — and fails with exactly what is missing, before any placement or GPU.
// Synthetic plans; the first one reproduces, rounded and without identifiers, the failure of a real reading
// (an open-plan kitchen-living and a terrace deleted, slanted rooms, pieces scattered, bedrooms too small).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkGeometry, expectedOfUnderstanding, rectangleFits, roomsOfScene, selfIntersecting } from '../walkthrough/geometryCheck.ts';
import { inferredSpace } from '../walkthrough/inferredSpace.ts';

const code = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const floor = (id, kind, pts, outdoor = false) => ({ id, kind, outdoor, polygon: pts.map(([x, y]) => ({ x, y })) });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const piece = (room, type, at, w, d) => ({ room, type, at, widthM: w, depthM: d, basis: 'OBSERVED' });
const codes = (c) => [...new Set(c.issues.filter((x) => x.blocking).map((x) => x.code))].sort();

// The customer's picture: an open-plan kitchen-living, two bedrooms, a bathroom, a terrace and a hall.
const PICTURE = [
  { kind: 'KITCHEN_LIVING', label: 'kitchen-living', confidence: 0.99 }, { kind: 'BATHROOM', confidence: 0.96 },
  { kind: 'BEDROOM', confidence: 0.97 }, { kind: 'BEDROOM', confidence: 0.97 }, { kind: 'TERRACE', confidence: 0.99 }, { kind: 'HALL', confidence: 0.91 },
];

test('the failed reading: missing kitchen-living and terrace, slanted rooms, scattered pieces — FAIL, saying exactly that', () => {
  const rooms = [
    floor('r-bath', 'BATHROOM', [[0, 15.3], [0, 10.9], [3.6, 11.2], [3.9, 14.6]]),
    floor('r-hall', 'HALL', [[3.9, 5.7], [5.2, 3.8], [8, 2.4], [9.1, 5.7]]),
    floor('r-bed2', 'BEDROOM', [[3.9, 2.2], [5, 0], [6.4, 0.2], [5.6, 3.8]]),
    floor('r-bed1', 'BEDROOM', [[6.4, 2.4], [8, 0.6], [9.1, 1.7], [8.8, 5.2]]),
    floor('r-extra', 'HALL', rect(6.4, 5.2, 8.8, 7.6)),
  ];
  const pieces = [
    piece('bed1', 'BED_DOUBLE', [5.7, 4.4], 1.65, 2.05), piece('bed1', 'BEDSIDE', [4.7, 4.7], 0.5, 0.4), piece('bed1', 'WARDROBE', [4.3, 5.7], 1.1, 0.65), piece('bed1', 'BEDSIDE', [6.7, 2.6], 0.5, 0.4),
    piece('bed2', 'BED_DOUBLE', [4.9, 1.6], 1.65, 2.05), piece('bed2', 'BEDSIDE', [8.1, 7.7], 0.5, 0.4), piece('bed2', 'WARDROBE', [6.5, 7.3], 1.05, 0.65), piece('bed2', 'BEDSIDE', [4.9, 0.6], 0.5, 0.4),
    piece('kitchen_living', 'SOFA', [1.2, 5.1], 2.8, 1.05), piece('kitchen_living', 'KITCHEN_RUN', [2.6, 9.4], 4, 0.62), piece('kitchen_living', 'KITCHEN_ISLAND', [3.9, 7.4], 1.8, 0.85),
    piece('kitchen_living', 'DINING_TABLE', [0.5, 7.9], 1.15, 1.15), piece('kitchen_living', 'FRIDGE', [4.4, 7.1], 0.75, 0.7),
    piece('terrace', 'OUTDOOR_CHAIR', [3.8, 5.1], 0.55, 0.6), piece('terrace', 'OUTDOOR_CHAIR', [7.2, 0.9], 0.65, 0.8), piece('terrace', 'OUTDOOR_TABLE', [2.6, 7.1], 0.9, 0.9),
    piece('bath', 'TOILET', [2.2, 13], 0.38, 0.62), piece('bath', 'SHOWER', [0.4, 11.4], 1.35, 1.25), piece('bath', 'VANITY', [1.3, 14.2], 1.25, 0.52),
  ];
  const c = checkGeometry({ rooms, pieces, expected: PICTURE, unreachable: ['r-bath', 'r-bed2', 'r-bed1', 'r-extra'] });
  assert.equal(c.verdict, 'FAIL');
  assert.deepEqual(codes(c), ['ESSENTIAL_DOES_NOT_FIT', 'EXPECTED_ROOM_MISSING', 'PIECES_OUTSIDE_ROOM', 'ROOM_DROPPED', 'ROOM_SHAPE_INVALID', 'ROOM_UNREACHABLE']);
  assert.deepEqual(c.missing.map((m) => m.space).sort(), ['LIVING_KITCHEN', 'OUTDOOR']);
  const lk = c.missing.find((m) => m.space === 'LIVING_KITCHEN');
  assert.ok(lk.evidence.some((e) => /original picture: KITCHEN_LIVING/.test(e)) && lk.evidence.some((e) => /5 pieces read in "kitchen_living"/.test(e)), JSON.stringify(lk));
  for (const id of ['r-hall', 'r-bed2', 'r-bed1']) assert.ok(c.issues.some((x) => x.code === 'ROOM_SHAPE_INVALID' && x.room === id), id);
  for (const id of ['r-bed1', 'r-bed2']) {
    assert.ok(c.issues.some((x) => x.code === 'ESSENTIAL_DOES_NOT_FIT' && x.room === id), id);
    assert.ok(c.issues.some((x) => x.code === 'PIECES_OUTSIDE_ROOM' && x.room === id), id);
  }
  assert.ok(c.rooms.every((r) => r.status === 'UNCERTAIN'), JSON.stringify(c.rooms));
});

/** A square-walled two-bedroom home that is what its picture shows. */
const GOOD = [
  floor('r-living', 'LIVING', rect(0, 0, 6, 5)), floor('r-hall', 'HALL', rect(6, 0, 8, 5)),
  floor('r-bed1', 'BEDROOM', rect(8, 0, 11.5, 3.5)), floor('r-bed2', 'BEDROOM', rect(8, 3.5, 11.5, 7)),
  floor('r-bath', 'BATHROOM', rect(6, 5, 8, 7)), floor('r-terrace', 'TERRACE', rect(0, 5, 6, 6.6), true),
];
const GOOD_PIECES = [
  piece('living', 'SOFA', [2, 4.2], 2.4, 0.95), piece('living', 'KITCHEN_RUN', [3, 0.4], 3, 0.6), piece('living', 'DINING_TABLE', [4.5, 2.2], 1.4, 0.9),
  piece('bed1', 'BED_DOUBLE', [9.75, 1.6], 1.6, 2.05), piece('bed1', 'WARDROBE', [10.8, 3.1], 1.2, 0.6),
  piece('bed2', 'BED_DOUBLE', [9.75, 5.3], 1.6, 2.05), piece('bed2', 'BEDSIDE', [8.6, 6.4], 0.45, 0.4),
  piece('bath', 'TOILET', [6.4, 6.5], 0.38, 0.62), piece('bath', 'SHOWER', [7.4, 6.4], 0.9, 0.9),
  piece('terrace', 'OUTDOOR_TABLE', [3, 5.8], 0.8, 0.8), piece('terrace', 'OUTDOOR_CHAIR', [2.2, 5.8], 0.55, 0.55),
];

test('a home that is what its picture shows passes, every room CONFIRMED; a corrected room is RECOVERED', () => {
  const c = checkGeometry({ rooms: GOOD, pieces: GOOD_PIECES, expected: PICTURE, unreachable: [], footprint: rect(0, 0, 11.5, 7) });
  assert.equal(c.verdict, 'PASS', JSON.stringify(c.issues));
  assert.deepEqual(c.missing, []);
  assert.ok(c.rooms.every((r) => r.status === 'CONFIRMED'));
  const carved = checkGeometry({ rooms: GOOD, pieces: GOOD_PIECES, expected: PICTURE, repairs: [{ code: 'ROOM_CARVED', element: 'living−hall' }] });
  assert.equal(carved.verdict, 'PASS');
  assert.equal(carved.rooms.find((r) => r.id === 'r-hall').status, 'RECOVERED');
  assert.equal(carved.rooms.find((r) => r.id === 'r-living').status, 'RECOVERED');
  assert.equal(carved.rooms.find((r) => r.id === 'r-bed1').status, 'CONFIRMED');
});

test('each failure alone is caught: missing room, slanted room, a bedroom too small for its bed, an uncovered footprint', () => {
  const without = (id) => GOOD.filter((r) => r.id !== id);
  // A bedroom the picture shows is gone.
  const lost = checkGeometry({ rooms: without('r-bed2'), pieces: GOOD_PIECES, expected: PICTURE });
  assert.deepEqual(codes(lost), ['EXPECTED_ROOM_MISSING', 'ROOM_DROPPED']);
  assert.deepEqual(lost.missing, [{ space: 'BEDROOM', expected: 2, found: 1, evidence: ['original picture: BEDROOM (97%)', 'original picture: BEDROOM (97%)', '2 pieces read in "bed2"'] }]);
  // A hall that is missing is reported, never blocking (it is often read as part of the open plan).
  const noHall = checkGeometry({ rooms: without('r-hall').concat([floor('r-hall2', 'LIVING', rect(6, 0, 8, 5))]), pieces: GOOD_PIECES, expected: PICTURE });
  assert.equal(noHall.verdict, 'PASS');
  assert.ok(noHall.issues.some((x) => x.code === 'EXPECTED_ROOM_MISSING' && !x.blocking));
  // A space the picture was unsure of is not counted.
  assert.equal(checkGeometry({ rooms: without('r-terrace'), expected: [{ kind: 'TERRACE', confidence: 0.5 }] }).verdict, 'PASS');
  // A slanted outline among square ones.
  const slanted = checkGeometry({ rooms: [...without('r-bed2'), floor('r-bed2', 'BEDROOM', [[8, 3.5], [11.5, 4.6], [11, 8], [8.4, 7]])] });
  assert.ok(slanted.issues.some((x) => x.code === 'ROOM_SHAPE_INVALID' && x.room === 'r-bed2'), JSON.stringify(slanted.issues));
  assert.ok(selfIntersecting([[0, 0], [2, 2], [2, 0], [0, 2]]));
  // A bedroom of 2 × 2.2 m does not hold the double bed it was seen with; 3.5 × 3.5 m does.
  const tiny = checkGeometry({ rooms: [...without('r-bed1'), floor('r-bed1', 'BEDROOM', rect(8, 0, 10, 2.2))], pieces: GOOD_PIECES.filter((p) => p.room !== 'bed1').concat([piece('bed1', 'BED_DOUBLE', [9, 1.1], 1.6, 2.05)]) });
  assert.deepEqual(codes(tiny), ['ESSENTIAL_DOES_NOT_FIT']);
  assert.ok(rectangleFits(rect(0, 0, 3.5, 3.5), 0, 2.1, 2.05) && !rectangleFits(rect(0, 0, 2, 2.2), 0, 2.1, 2.05));
  // A footprint the rooms leave a large part of.
  const open = checkGeometry({ rooms: without('r-living'), expected: [], footprint: rect(0, 0, 11.5, 7) });
  assert.ok(open.issues.some((x) => x.code === 'FOOTPRINT_UNCOVERED'), JSON.stringify(open.issues));
  // Pieces of one room standing in another.
  const scattered = checkGeometry({ rooms: GOOD, pieces: GOOD_PIECES.map((p) => (p.room === 'bed2' ? { ...p, at: [p.at[0] - 8, p.at[1] - 4] } : p)) });
  assert.ok(scattered.issues.some((x) => x.code === 'PIECES_OUTSIDE_ROOM' && x.room === 'r-bed2'));
});

test('end to end: a reading with a hall drawn inside its open plan builds a space that passes (it used to lose the kitchen-living)', () => {
  const room = (key, kind, poly, over = {}) => ({ key, kind, label: null, polygon: poly, outdoor: kind === 'TERRACE', confidence: 0.8, basis: 'OBSERVED', ...over });
  const door = (key, at, kind = 'DOOR') => ({ key, kind, at, widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.8, basis: 'OBSERVED' });
  const reading = {
    version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.5, scaleEvidence: null, ceilingHeightM: 2.8, objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [], usesPlan: false,
    rooms: [
      room('kitchen_living', 'LIVING', rect(0, 0, 8, 5), { confidence: 0.7 }), room('hall', 'HALL', rect(6, 0, 8, 5), { confidence: 0.9 }),
      room('bed1', 'BEDROOM', rect(8, 0, 11.5, 3.5)), room('bed2', 'BEDROOM', rect(8, 3.5, 11.5, 7)), room('bath', 'BATHROOM', rect(6, 5, 8, 7)),
      room('terrace', 'TERRACE', rect(0, 5, 6, 6.6)),
    ],
    openings: [door('entry', [7, 0]), door('h_l', [6, 2.5]), door('h_b1', [8, 1.5]), door('h_b2', [8, 4.2]), door('h_bath', [7, 5]), door('l_t', [3, 5], 'BALCONY_DOOR')],
  };
  const space = inferredSpace(reading, 'k');
  assert.ok(!('problems' in space));
  const pieces = GOOD_PIECES.map((p) => (p.room === 'living' ? { ...p, room: 'kitchen_living' } : p));
  const c = checkGeometry({ rooms: roomsOfScene(space.canonical.scene.floors), pieces, expected: PICTURE, unreachable: space.unreachable, repairs: space.repairs });
  assert.equal(c.verdict, 'PASS', JSON.stringify(c.issues));
  assert.equal(c.rooms.find((r) => r.id === 'r-kitchen_living').status, 'RECOVERED');
  assert.deepEqual(expectedOfUnderstanding({ rooms: [{ kind: 'BEDROOM', label: 'x', confidence: 0.9 }, { kind: null }] }), [{ kind: 'BEDROOM', label: 'x', confidence: 0.9 }]);
});

test('the server checks the geometry before placing anything, and a failed check is final (no furniture, no GPU)', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(route, /const geometry = await geometryOf\(admin, design\);\s*if \(geometry && geometry\.verdict === 'FAIL'\) \{/);
  assert.match(route, /await fail\(admin, row, 'GEOMETRY_UNRELIABLE'/);
  // The reading's own check is recorded with the space it made.
  assert.match(route, /const geometryCheck = checkGeometry\(/);
  assert.match(route, /\.\.\.\(furnishing \? \{ furnishing \} : \{\}\),\s*geometryCheck,/);
  // The validated reading is kept with its job: rebuilding the space never buys it again.
  assert.match(route, /reading: read,/);
});

test('a pixel trace that makes a square room a diamond is a mistrace: the reader\'s own outline stands', async () => {
  const { rightAngleShare } = await import('../reconstructRead.ts');
  // Diamonds and kites of the failed reading (four corners, not a rectangle) against real outlines.
  assert.equal(rightAngleShare([[3.9, 2.2], [5, 0], [6.4, 0.2], [5.65, 3.8]]), 0.25);
  assert.equal(rightAngleShare([[6.4, 2.4], [8, 0.6], [9.1, 1.7], [8.75, 5.2]]), 0.5);
  assert.equal(rightAngleShare([[0, 0], [3, 0.15], [2.9, 3], [0, 2.9]]), 1, 'a rectangle a few degrees off is a rectangle');
  assert.equal(rightAngleShare([[0, 0], [4, 0], [4, 2], [3, 3], [0, 3]]), 1, 'a 45° wall is architecture');
  for (const f of ['src/lib/designStudio/reconstructRead.ts', 'supabase/functions/_shared/designStudio/reconstructRead.ts']) {
    assert.match(code(f), /if \(rightAngleShare\(ring as Point2\[\]\) < 0\.75 && rightAngleShare\(kept\.polygon\) >= 0\.75\) return kept;/, f);
  }
});
