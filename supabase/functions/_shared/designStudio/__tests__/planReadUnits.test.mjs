// Plan reading v2, the small parts: printed dimensions → metres, labels →
// room kinds (six languages), the reader's v2 validation (and v1 backward
// compatibility), and the customer's answers applied as a pure function.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDimension, formatMetres } from '../planRead/dimensions.ts';
import { classifyLabel, settleKind } from '../planRead/roomKinds.ts';
import { applyAnswers, buildQuestions, MAX_QUESTIONS } from '../planRead/questions.ts';
import { solveScale } from '../planRead/solve.ts';
import { mainRectangle, medianExtents } from '../planRead/geom.ts';
import { DS_READ_VERSION, validateReading } from '../floorplanRead.ts';

const FT = 0.3048;
const IN = 0.0254;
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const vals = (t) => parseDimension(t)?.values;

// ── Dimensions ─────────────────────────────────────────────────────────────

test('feet and inches in every way plans print them', () => {
  const cases = [
    ["20'", [20 * FT]],
    ['20\'-0"', [20 * FT]],
    ["10'X14'", [10 * FT, 14 * FT]],
    ["10'×14'", [10 * FT, 14 * FT]],
    ["10' x 14'", [10 * FT, 14 * FT]],
    ['6\'-4"X4\'-3"', [6 * FT + 4 * IN, 4 * FT + 3 * IN]],
    ['3\'6"', [3 * FT + 6 * IN]],
    ['4\' 3"', [4 * FT + 3 * IN]],
    ['12\'6"x10\'', [12 * FT + 6 * IN, 10 * FT]],
    ['10ft 6in', [10 * FT + 6 * IN]],
    ['10 ft x 12 ft', [10 * FT, 12 * FT]],
    ['10′6″ × 12′', [10 * FT + 6 * IN, 12 * FT]],
    ['10’-6” x 9’', [10 * FT + 6 * IN, 9 * FT]],
    ['3\'-6"X4\'', [3 * FT + 6 * IN, 4 * FT]],
  ];
  for (const [text, expected] of cases) {
    const v = vals(text);
    assert.ok(v, `${text} parses`);
    assert.equal(v.length, expected.length, text);
    v.forEach((x, i) => assert.ok(near(x, expected[i]), `${text}: ${x} vs ${expected[i]}`));
    assert.equal(parseDimension(text).unit, 'ft', text);
  }
});

test('metric, with and without units, decimal commas and Cyrillic/Georgian units', () => {
  const cases = [
    ['3.20 x 4.10', [3.2, 4.1], 'm'],
    ['3,20×4,10', [3.2, 4.1], 'm'],
    ['3.2m x 4.1m', [3.2, 4.1], 'm'],
    ['320x410 cm', [3.2, 4.1], 'cm'],
    ['320 × 410 см', [3.2, 4.1], 'cm'],
    ['3200 mm', [3.2], 'mm'],
    ['3,200 mm', [3.2], 'mm'],
    ['3 200 mm', [3.2], 'mm'],
    ['3200x4100', [3.2, 4.1], 'mm'],
    ['4,10 м', [4.1], 'm'],
    ['3,20 მ', [3.2], 'm'],
    ['3.20 х 4.10', [3.2, 4.1], 'm'], // Cyrillic х as the sign
    ['3.20*4.10', [3.2, 4.1], 'm'],
  ];
  for (const [text, expected, unit] of cases) {
    const d = parseDimension(text);
    assert.ok(d, `${text} parses`);
    assert.equal(d.unit, unit, text);
    d.values.forEach((x, i) => assert.ok(near(x, expected[i]), `${text}: ${x} vs ${expected[i]}`));
  }
  assert.ok(parseDimension('3.20 x 4.10').confidence < parseDimension('3.20 x 4.10 m').confidence, 'an inferred unit is less certain');
});

test('room names, areas and nonsense are not dimensions; a mistyped foot mark is read, with less confidence', () => {
  for (const t of ['BEDROOM', '12.5 m²', '18 m2', '120 sq ft', '', null, 'KITCHEN 14,5 кв.м', 'x']) assert.equal(parseDimension(t), null, String(t));
  const typo = parseDimension("10''X14'"); // the golden plan prints MASTERBEDROOM 10''X14'
  assert.ok(near(typo.values[0], 10 * FT) && near(typo.values[1], 14 * FT));
  assert.ok(typo.confidence < 0.75);
  assert.ok(near(vals("MASTERBEDROOM 10'X14'")[1], 14 * FT), 'a label before the size is ignored');
  const unknown = parseDimension('12 x 10');
  assert.equal(unknown.unit, 'unknown');
  assert.ok(unknown.confidence <= 0.3);
  assert.deepEqual(parseDimension(formatMetres([3.05, 4.27])).values, [3.05, 4.27], 'a confirmed size round-trips');
});

// ── Room kinds ─────────────────────────────────────────────────────────────

test('labels classify in six languages and in plan shorthand', () => {
  const cases = {
    'MASTER BEDROOM': 'BEDROOM', MASTERBEDROOM: 'BEDROOM', 'BED 2': 'BEDROOM', 'Living Room': 'LIVING', LOUNGE: 'LIVING',
    'KITCHEN+DINING': 'KITCHEN', BATH: 'BATHROOM', 'Toilet': 'WC', LET: 'WC', 'W.C.': 'WC', LAUNDRY: 'STORAGE', CLOSET: 'STORAGE',
    CORRIDOR: 'CORRIDOR', 'ENTRANCE HALL': 'HALL', BALCONY: 'BALCONY', PORCH: 'TERRACE', VERANDAH: 'TERRACE',
    'საძინებელი': 'BEDROOM', 'მისაღები': 'LIVING', 'სამზარეულო': 'KITCHEN', 'აბაზანა': 'BATHROOM', 'ბალკონი': 'BALCONY',
    'спальня': 'BEDROOM', 'Гостиная': 'LIVING', 'кухня': 'KITCHEN', 'ванная': 'BATHROOM', 'санузел': 'BATHROOM', 'балкон': 'BALCONY',
    'yatak odası': 'BEDROOM', 'salon': 'LIVING', 'mutfak': 'KITCHEN', 'banyo': 'BATHROOM',
    'غرفة نوم': 'BEDROOM', 'مطبخ': 'KITCHEN', 'حمام': 'BATHROOM',
    'חדר שינה': 'BEDROOM', 'מטבח': 'KITCHEN', 'מרפסת': 'BALCONY',
  };
  for (const [label, kind] of Object.entries(cases)) assert.equal(classifyLabel(label)?.kind, kind, label);
  assert.equal(classifyLabel('TOILET')?.kind, 'WC');
  assert.equal(classifyLabel('PALLET STORE')?.kind, 'STORAGE', '"let" inside a word is not a latrine');
  assert.equal(classifyLabel('A1'), null);
  assert.equal(classifyLabel('PORCH').outdoor, true);
});

test('the dictionary settles what the reading left unknown; disagreement lowers confidence', () => {
  assert.equal(settleKind('MASTERBEDROOM', 'UNKNOWN', 0.98).kind, 'BEDROOM');
  const wash = settleKind('WASH', 'UNKNOWN', 0.78);
  assert.equal(wash.kind, 'STORAGE');
  assert.ok(wash.confidence < 0.75, 'a wash area is asked about');
  const clash = settleKind('KITCHEN', 'BEDROOM', 0.9);
  assert.equal(clash.kind, 'KITCHEN');
  assert.ok(clash.confidence < 0.75);
  assert.equal(settleKind(null, 'LIVING', 0.9).kind, 'LIVING');
  assert.ok(settleKind(null, 'UNKNOWN', 0.9).confidence < 0.5);
});

// ── Geometry measures ──────────────────────────────────────────────────────

test('a room is measured by its main rectangle, not its bounding box', () => {
  // An L: a 100×200 body with a 40×50 alcove.
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 120 }, { x: -40, y: 120 }, { x: -40, y: 70 }, { x: 0, y: 70 }];
  const r = mainRectangle(L);
  assert.ok(near(r.w, 100, 1) && near(r.d, 200, 1), JSON.stringify(r));
  const m = medianExtents([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 0, y: 30 }]);
  assert.ok(near(m.w, 80, 1) && near(m.d, 30, 1));
  const rotated = mainRectangle([{ x: 0, y: 0 }, { x: 86.6, y: 50 }, { x: 61.6, y: 93.3 }, { x: -25, y: 43.3 }], 30);
  assert.ok(near(rotated.w, 100, 2) && near(rotated.d, 50, 2), JSON.stringify(rotated));
});

// ── The reader's v2 validation ─────────────────────────────────────────────

test('v2 readings: centre → position, leaf, stairs, texts, ignored regions, footprint and north are validated', () => {
  const { doc, dimensionStrings, readVersion } = validateReading({
    walls: [{ id: 'w1', start: { x: 0, y: 10 }, end: { x: 200, y: 10 }, kind: 'EXTERIOR', thicknessPx: 8, confidence: 0.9 }],
    doors: [
      { id: 'd1', wallId: 'w1', centerPx: { x: 50, y: 11 }, widthPx: 30, leaf: 'HINGED', confidence: 0.9 },
      { id: 'd2', wallId: 'w1', centerPx: { x: 150, y: 10 }, widthPx: 30, leaf: 'BANANA', confidence: 0.9 },
    ],
    rooms: [{ id: 'r1', kind: 'UNKNOWN', label: 'BED', dimensionText: " 10'X14' ", polygon: [{ x: 0, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 150 }], confidence: 0.9 }],
    stairs: [
      { id: 's1', polygon: [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 90 }, { x: 10, y: 90 }], startEdge: [{ x: 10, y: 90 }, { x: 60, y: 90 }], direction: 'UP', treads: 12, confidence: 0.8 },
      { id: 's2', polygon: [{ x: 1, y: 1 }], direction: 'SIDEWAYS', confidence: 1 },
    ],
    texts: [
      { id: 't1', text: 'BED', role: 'ROOM_LABEL', box: { x: 80, y: 60, w: 30, h: 10 }, roomId: 'r1', confidence: 0.9 },
      { id: 't2', text: 'Call 555-0100', role: 'CONTACT', box: { x: 10, y: 180, w: 90, h: 12 }, confidence: 0.9 },
      { id: 't3', text: 'x', role: 'WHATEVER', box: { x: 10, y: 10, w: 5, h: 5 }, confidence: 0.5 },
      { id: 't4', text: 'off', role: 'NOTE', box: { x: 9000, y: 10, w: 5, h: 5 }, confidence: 0.5 },
    ],
    ignored: [{ id: 'i1', role: 'LOGO', box: { x: 0, y: 170, w: 50, h: 30 } }],
    dimensionStrings: [{ text: "20'-0\"", valueM: 6.2, from: { x: 0, y: 2 }, to: { x: 200, y: 2 }, confidence: 0.9 }],
    footprint: [{ x: 0, y: 6 }, { x: 204, y: 6 }, { x: 204, y: 150 }, { x: 0, y: 150 }],
    northDeg: -90,
  }, 220, 200, 'k');
  assert.equal(readVersion, DS_READ_VERSION);
  assert.equal(DS_READ_VERSION, 'ds-read-2');
  assert.ok(near(doc.doors[0].position, 0.25, 1e-9), 'position follows the drawn centre');
  assert.deepEqual(doc.doors[0].centerPx, { x: 50, y: 11 });
  assert.equal(doc.doors[0].leaf, 'HINGED');
  assert.equal(doc.doors[1].leaf, null, 'an unknown leaf is null, not guessed');
  assert.equal(doc.rooms[0].dimensionText, "10'X14'");
  assert.equal(doc.stairs.length, 1);
  assert.equal(doc.stairs[0].direction, 'UP');
  assert.equal(doc.stairs[0].treads, 12);
  assert.deepEqual(doc.texts.map((t) => [t.id, t.role]), [['t1', 'ROOM_LABEL'], ['t2', 'CONTACT'], ['t3', 'OTHER']]);
  assert.equal(doc.ignored[0].role, 'LOGO');
  assert.equal(doc.footprint.length, 4);
  assert.equal(doc.northDeg, 270);
  assert.ok(near(dimensionStrings[0].valueM, 20 * FT), 'the printed text wins over the model\'s arithmetic');
  assert.equal(dimensionStrings[0].text, '20\'-0"');
  assert.ok([...doc.doors, ...doc.rooms, ...doc.stairs].every((e) => e.state === 'UNVERIFIED'));
});

test('v1 readings stay valid: the new collections are empty and nothing is invented', () => {
  const { doc } = validateReading({
    walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, kind: 'EXTERIOR', confidence: 0.9 }],
    doors: [{ id: 'd1', wallId: 'w1', position: 1, widthPx: 20, confidence: 0.9 }],
    rooms: [{ id: 'r1', kind: 'LIVING', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }], confidence: 0.8 }],
  }, 200, 200, 'k');
  assert.equal(doc.doors[0].position, 1);
  assert.equal(doc.doors[0].centerPx, null);
  assert.equal(doc.doors[0].leaf, null);
  assert.deepEqual(doc.stairs, []);
  assert.deepEqual(doc.texts, []);
  assert.deepEqual(doc.ignored, []);
  assert.equal(doc.footprint, null);
  assert.equal(doc.northDeg, null);
  assert.equal(doc.rooms[0].dimensionText, null);
});

// ── Answers ────────────────────────────────────────────────────────────────

const baseDoc = () => ({
  sourceAssetId: 'k', imageWidth: 400, imageHeight: 300, detectedScale: 0.02, scaleConfidence: 0.9, ceilingHeight: null, ceilingHeightSource: null,
  walls: [
    { id: 'w1', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, kind: 'EXTERIOR', thicknessPx: 10, confidence: 0.9, state: 'UNVERIFIED' },
    { id: 'w2', start: { x: 150, y: 0 }, end: { x: 150, y: 200 }, kind: 'INTERIOR', thicknessPx: 10, confidence: 0.4, state: 'UNVERIFIED' },
  ],
  doors: [{ id: 'd1', wallId: 'w2', position: 0.5, widthPx: 40, centerPx: { x: 150, y: 100 }, leaf: 'HINGED', confidence: 0.5, state: 'UNVERIFIED' }],
  windows: [{ id: 'g1', wallId: 'w1', position: 0.3, widthPx: 60, centerPx: { x: 90, y: 0 }, leaf: null, confidence: 0.6, state: 'UNVERIFIED' }],
  rooms: [
    { id: 'r1', kind: 'STORAGE', label: 'WASH', polygon: [{ x: 5, y: 5 }, { x: 145, y: 5 }, { x: 145, y: 195 }, { x: 5, y: 195 }], statedAreaM2: null, dimensionText: null, confidence: 0.7, state: 'UNVERIFIED' },
    { id: 'r2', kind: 'TERRACE', label: 'PORCH', polygon: [{ x: 155, y: 5 }, { x: 295, y: 5 }, { x: 295, y: 195 }, { x: 155, y: 195 }], statedAreaM2: null, dimensionText: null, confidence: 0.8, state: 'UNVERIFIED' },
  ],
  balconies: [], unknownElements: [], warnings: [], extractionConfidence: 0.4,
  stairs: [{ id: 's1', polygon: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 60 }], startEdge: null, direction: 'UNKNOWN', treads: null, confidence: 0.5, state: 'UNVERIFIED' }],
});

test('answers are applied purely: types, kinds, outdoor, walls, stairs and sizes', () => {
  const doc = baseDoc();
  const frozen = JSON.stringify(doc);
  const out = applyAnswers(doc, [
    { questionId: 'OPENING_TYPE:g1', kind: 'OPENING_TYPE', value: 'DOOR' },
    { questionId: 'ROOM_TYPE:r1', kind: 'ROOM_TYPE', value: 'BATHROOM' },
    { questionId: 'OUTDOOR:r2', kind: 'OUTDOOR', value: true },
    { questionId: 'STAIRS:s1', kind: 'STAIRS', value: false },
    { questionId: 'DIMENSION:r1', kind: 'DIMENSION', value: [2.8, 3.8] },
    { questionId: 'ROOM_TYPE:nope', kind: 'ROOM_TYPE', value: 'KITCHEN' },
  ]);
  assert.equal(JSON.stringify(doc), frozen, 'the input is not changed');
  assert.ok(out.doors.some((d) => d.id === 'g1' && d.state === 'CORRECTED' && d.confidence === 1));
  assert.ok(!out.windows.some((d) => d.id === 'g1'));
  assert.equal(out.rooms.find((r) => r.id === 'r1').kind, 'BATHROOM');
  assert.equal(out.rooms.find((r) => r.id === 'r1').dimensionText, '2.800 x 3.800 m');
  assert.ok(out.balconies.some((r) => r.id === 'r2' && r.kind === 'TERRACE' && r.state === 'VERIFIED'));
  assert.deepEqual(out.stairs, []);
  const removed = applyAnswers(doc, [{ questionId: 'IS_WALL:w2', kind: 'IS_WALL', value: false }, { questionId: 'OPENING_TYPE:g1', kind: 'OPENING_TYPE', value: 'WALL' }]);
  assert.deepEqual(removed.walls.map((w) => w.id), ['w1']);
  assert.deepEqual(removed.doors, [], 'an opening goes with its wall');
  assert.deepEqual(removed.windows, []);
  const opening = applyAnswers(doc, [{ questionId: 'OPENING_TYPE:d1', kind: 'OPENING_TYPE', value: 'OPENING' }]);
  assert.equal(opening.doors[0].leaf, 'NONE');
  const none = applyAnswers(doc, [{ questionId: 'ROOM_TYPE:r1', kind: 'ROOM_TYPE', value: 'NONE' }]);
  assert.ok(!none.rooms.some((r) => r.id === 'r1'), 'a placeholder room can be dismissed');
});

test('a confirmed size re-solves the scale; questions are few, ordered and stable', () => {
  const doc = baseDoc();
  assert.equal(solveScale(doc, []), null, 'no printed size, no scale');
  const answered = applyAnswers(doc, [{ questionId: 'DIMENSION:r1', kind: 'DIMENSION', value: [2.8, 3.8] }]);
  const report = solveScale(answered, [], { answers: [{ questionId: 'DIMENSION:r1', kind: 'DIMENSION', value: [2.8, 3.8] }] });
  assert.ok(report);
  assert.ok(near(report.metresPerPx, 0.02, 0.0002), `${report.metresPerPx}`);
  assert.equal(report.checks[0].ocrConfidence, 1);

  const qs = buildQuestions(doc, null, {
    roomKind: { r1: { confidence: 0.7, outdoor: false, modelKind: 'UNKNOWN' }, r2: { confidence: 0.85, outdoor: true, modelKind: 'TERRACE' } },
    openingTypeAgreement: { d1: 0.4, g1: 1 }, openingSource: { d1: 'GAP', g1: 'GAP' }, wallInk: { w1: 0.9, w2: 0.05 },
    stairEvidence: { s1: { model: true, treads: null, strength: 0 } },
  });
  assert.ok(qs.length <= MAX_QUESTIONS);
  assert.equal(qs[0].kind, 'DIMENSION', 'no scale: the size is the first question');
  const ids = qs.map((q) => q.id);
  for (const id of ['ROOM_TYPE:r1', 'OPENING_TYPE:d1', 'IS_WALL:w2', 'STAIRS:s1']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('OPENING_TYPE:g1'), 'a window the ink agrees with is not asked about');
  assert.ok(!ids.includes('ROOM_TYPE:r2'), 'a confident porch is not asked about');
  assert.deepEqual(buildQuestions(doc, null, {}).map((q) => q.id), buildQuestions(doc, null, {}).map((q) => q.id), 'deterministic');
});
