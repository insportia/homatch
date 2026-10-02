// Plan reading v2 on the golden plan: the production ds-read-1 reading of
// tests/fixtures/design-studio/golden-floorplan.jpg, fused with the drawing's
// own pixels (a grey copy of the JPEG, so no decoder is needed here).
//
// The v1 reading is the hard case on purpose: it has no opening centres
// (every door and window sits at its wall's end), a duplicate wall, the
// stair hall merged into the kitchen, no living/porch wall, no stairs and
// three unclassified rooms. Coordinates below are this fixture's ground
// truth, read off the drawing; production code never sees them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { understand } from '../planRead/understand.ts';
import { roomSizeM } from '../planRead/solve.ts';
import { pointInPoly, centroid } from '../planRead/geom.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
const TRUE_SCALE = 0.01793; // 20'-0" (6.096 m) over the 340-pixel outer width

export function loadPgm(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const width = Number(m[1]);
  const height = Number(m[2]);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, width * height) };
}

const v1 = JSON.parse(fs.readFileSync(path.join(FIX, 'golden-floorplan.read-v1.json'), 'utf8'));
const gray = loadPgm(path.join(FIX, 'golden-floorplan.pgm.gz'));
let cached;
const run = () => (cached ??= understand({ doc: v1.doc, dimensionStrings: v1.dimensionStrings, gray }));

// Every opening on the drawing (image px): 8 doors, 1 doorless opening, 6 windows.
const TRUE_DOORS = [
  [361, 115], [419, 115], // balcony → master bedroom, balcony → bedroom
  [361, 357], [419, 357], // master bedroom → living, bedroom → living
  [329, 395], // the wash area's open side (no leaf)
  [257, 435], [305, 435], // wash → LET, wash → bath
  [374, 658], // living → kitchen
  [520, 702], // living → porch
];
const TRUE_WINDOWS = [[266, 115], [498, 115], [490, 357], [295, 837], [432, 702], [374, 733]];

test('golden: the grey fixture is the JPEG, pixel for pixel in size', () => {
  assert.equal(gray.width, 736);
  assert.equal(gray.height, 998);
  assert.equal(v1.doc.imageWidth, 736);
});

test('golden: the scale is solved from every printed size, within 1% of the truth', (t) => {
  const { doc, understanding } = run();
  const c = understanding.constraints;
  assert.ok(c, 'a plan with printed sizes has a constraint report');
  const err = Math.abs(c.metresPerPx / TRUE_SCALE - 1);
  t.diagnostic(`solved ${c.metresPerPx.toFixed(6)} m/px vs ${TRUE_SCALE} (${(err * 100).toFixed(2)}%), ±${(c.uncertainty * 100).toFixed(2)}%`);
  assert.ok(err < 0.01, `scale off by ${(err * 100).toFixed(2)}%`);
  assert.equal(doc.detectedScale, Math.round(c.metresPerPx * 1e7) / 1e7);
  assert.ok(doc.scaleConfidence >= 0.85);
  assert.equal(c.anisotropy, null, 'the scan is not stretched');
});

test('golden: the overall 20\'×46\' is within 2%, and every printed room size within 6%', (t) => {
  const { understanding } = run();
  const checks = understanding.constraints.checks;
  const byId = Object.fromEntries(checks.map((c) => [c.elementId, c]));
  assert.ok(byId.OVERALL_W && byId.OVERALL_D, 'both overall dimensions are checks');
  assert.ok(byId.OVERALL_W.residualPct <= 2, `20' off ${byId.OVERALL_W.residualPct}%`);
  assert.ok(byId.OVERALL_D.residualPct <= 2, `46' off ${byId.OVERALL_D.residualPct}%`);
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']) {
    const c = byId[id];
    assert.ok(c, `room ${id} has a printed-size check`);
    t.diagnostic(`${id.padEnd(3)} ${c.text.padEnd(12)} printed ${c.valueM.map((v) => v.toFixed(3)).join(' x ')} m  fused ${c.measuredM.map((v) => v.toFixed(3)).join(' x ')} m  residual ${c.residualPct}%`);
    assert.ok(c.residualPct <= 6, `${id} ${c.text}: residual ${c.residualPct}%`);
    assert.equal(c.used, true);
  }
});

test('golden: every door and window lands within 0.35 m of a real opening, one to one, and none is missed', (t) => {
  const { doc } = run();
  const m = doc.detectedScale;
  const tol = 0.35 / m;
  const assign = (found, truth, kind) => {
    const used = new Set();
    for (const o of found) {
      let best = -1;
      let bd = Infinity;
      truth.forEach(([x, y], i) => {
        if (used.has(i)) return;
        const d = Math.hypot(o.centerPx.x - x, o.centerPx.y - y);
        if (d < bd) { bd = d; best = i; }
      });
      t.diagnostic(`${kind} ${o.id.padEnd(9)} on ${o.wallId.padEnd(6)} error ${(bd * m).toFixed(3)} m`);
      assert.ok(bd <= tol, `${o.id} is ${(bd * m).toFixed(2)} m from the nearest real ${kind.toLowerCase()}`);
      used.add(best);
    }
    assert.equal(used.size, truth.length, `every real ${kind.toLowerCase()} is in the plan`);
  };
  assign(doc.doors, TRUE_DOORS, 'DOOR');
  assign(doc.windows, TRUE_WINDOWS, 'WINDOW');
  // Positions are on the wall, not at its ends any more.
  for (const o of [...doc.doors, ...doc.windows]) assert.ok(o.position > 0.02 && o.position < 0.98, `${o.id} position ${o.position}`);
});

test('golden: duplicate walls are merged and the living/porch wall the reading missed is found', () => {
  const { doc, understanding, fusion } = run();
  assert.ok(fusion.mergedWalls.some((m) => m.from === 'W16' && m.into === 'W5'), 'W16 duplicates W5');
  assert.ok(!doc.walls.some((w) => w.id === 'W16'));
  assert.ok(!understanding.issues.some((i) => i.code === 'DUPLICATE_WALL'));
  // A wall between the living room and the porch (y ≈ 702 on the drawing).
  const between = doc.walls.find((w) => Math.abs(w.start.y - 702) <= 6 && Math.abs(w.end.y - 702) <= 6 && Math.min(w.start.x, w.end.x) <= 400 && Math.max(w.start.x, w.end.x) >= 500);
  assert.ok(between, 'the living/porch boundary is a wall');
  assert.ok(fusion.inferredWalls.includes(between.id));
  assert.ok(understanding.adjacency.R4.includes('R9'), 'the porch is reached from the living room');
});

test('golden: the stairs are found and carved out of the kitchen', () => {
  const { doc } = run();
  assert.equal(doc.stairs.length, 1);
  const s = doc.stairs[0];
  const c = centroid(s.polygon);
  assert.ok(c.x > 216 && c.x < 372 && c.y > 512 && c.y < 628, `the flight is in the stair hall (${c.x}, ${c.y})`);
  assert.ok(s.treads >= 6);
  const kitchen = doc.rooms.find((r) => r.id === 'R3');
  assert.ok(!pointInPoly(c, kitchen.polygon), 'the stairs are not inside the kitchen');
  const size = roomSizeM(kitchen, doc.detectedScale);
  assert.ok(Math.abs(size.d - 3.658) / 3.658 < 0.06, `kitchen depth ${size.d}`);
});

test('golden: rooms are classified from their labels; the porch is an outdoor terrace', () => {
  const { doc } = run();
  const kind = (id) => [...doc.rooms, ...doc.balconies].find((r) => r.id === id)?.kind;
  assert.equal(kind('R1'), 'BEDROOM', 'MASTERBEDROOM');
  // "WASH" on an Indian plan is a washing / utility area (a sink, a washing
  // machine), not a bathroom: a service room, and asked about.
  assert.equal(kind('R5'), 'STORAGE', 'WASH');
  assert.equal(kind('R6'), 'WC', 'LET (latrine)');
  assert.equal(kind('R9'), 'TERRACE', 'PORCH');
  assert.ok(doc.balconies.some((r) => r.id === 'R9'), 'the porch is built as an outdoor space');
  assert.ok(doc.balconies.some((r) => r.id === 'R8' && r.kind === 'BALCONY'));
});

test('golden: the porch reaches the building edge and the living room is the space the walls enclose', () => {
  const { doc } = run();
  const porch = doc.balconies.find((r) => r.id === 'R9');
  const living = doc.rooms.find((r) => r.id === 'R4');
  assert.ok(Math.max(...porch.polygon.map((p) => p.y)) >= 835, 'the porch is open to the building edge, not cut at the end of the wall');
  // The living room's body is 10' wide: from the kitchen wall to the east wall, not the reading's sketch.
  const size = roomSizeM(living, doc.detectedScale);
  assert.ok(Math.abs(size.w - 3.048) / 3.048 < 0.06 && Math.abs(size.d - 6.096) / 6.096 < 0.06, `living ${size.w} x ${size.d}`);
  assert.ok(!doc.rooms.some((r) => r.polygon.some((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length];
    return Math.abs(p.x - q.x) > 2 && Math.abs(p.y - q.y) > 2;
  })), 'outlines are square to the plan (no diagonal corner cuts)');
});

test('golden: the plan holds together and only useful questions are asked', (t) => {
  const { understanding } = run();
  t.diagnostic(`issues: ${JSON.stringify(understanding.issues)}`);
  t.diagnostic(`questions: ${understanding.questions.map((q) => q.id).join(', ')}`);
  assert.ok(understanding.questions.length <= 6);
  assert.ok(understanding.questions.some((q) => q.id === 'ROOM_TYPE:R5'), 'the uncertain "WASH" is asked about');
  assert.ok(!understanding.issues.some((i) => i.code === 'NO_ENTRANCE'));
  assert.ok(!understanding.issues.some((i) => i.code === 'ROOM_UNREACHABLE' && i.severity !== 'INFO'));
  assert.ok(!understanding.issues.some((i) => i.code === 'UNCOVERED_AREA'));
  assert.ok(!understanding.issues.some((i) => i.code === 'ROOMS_OVERLAP'));
  assert.equal(understanding.readVersion, 'ds-read-2');
});

test('golden: ids survive fusion, and the raw reading is kept untouched', () => {
  const { doc, rawDoc } = run();
  assert.equal(rawDoc, v1.doc);
  for (const id of ['W1', 'W2', 'W5', 'R1', 'R9', 'D1', 'WIN4']) {
    assert.ok([...doc.walls, ...doc.rooms, ...doc.balconies, ...doc.doors, ...doc.windows].some((e) => e.id === id), id);
  }
  assert.equal(v1.doc.doors[0].position, 1, 'the input reading is not mutated');
  assert.ok([...doc.walls, ...doc.doors, ...doc.windows, ...doc.rooms].every((e) => e.state === 'UNVERIFIED'), 'fusion never verifies anything');
});

test('golden as ds-read-2 would read it: drawn centres (jittered, two on the wrong wall), the stairs and the footprint', (t) => {
  // The v1 reading upgraded with what the v2 prompt asks for. Centres are
  // off by up to 9 px; D1 and D2 still name the wrong wall (W6), as v1 did.
  const v2 = JSON.parse(JSON.stringify(v1.doc));
  const centres = {
    D1: [355, 121], D2: [366, 350], D3: [424, 352], D4: [262, 430], D5: [300, 441], D6: [380, 650], D7: [368, 666],
    WIN1: [503, 111], WIN2: [260, 119], WIN3: [485, 362], WIN4: [300, 832], WIN5: [427, 707],
  };
  for (const o of [...v2.doors, ...v2.windows]) {
    const c = centres[o.id];
    o.centerPx = { x: c[0], y: c[1] };
  }
  v2.doors = v2.doors.filter((d) => d.id !== 'D6'); // v2 reads the kitchen door once
  v2.stairs = [{ id: 'S1', polygon: [{ x: 218, y: 515 }, { x: 370, y: 515 }, { x: 370, y: 625 }, { x: 218, y: 625 }], startEdge: null, direction: 'UP', treads: null, confidence: 0.8, state: 'UNVERIFIED' }];
  v2.footprint = [{ x: 213, y: 61 }, { x: 552, y: 61 }, { x: 552, y: 840 }, { x: 213, y: 840 }];
  const u = understand({ doc: v2, dimensionStrings: v1.dimensionStrings, gray });
  const m = u.doc.detectedScale;
  for (const o of [...u.doc.doors, ...u.doc.windows]) {
    if (!centres[o.id]) continue;
    const truth = [...TRUE_DOORS, ...TRUE_WINDOWS].reduce((best, p) => (Math.hypot(p[0] - o.centerPx.x, p[1] - o.centerPx.y) < Math.hypot(best[0] - o.centerPx.x, best[1] - o.centerPx.y) ? p : best));
    const err = Math.hypot(truth[0] - o.centerPx.x, truth[1] - o.centerPx.y) * m;
    t.diagnostic(`${o.id.padEnd(5)} ${u.fusion.openingSource[o.id]} on ${o.wallId} error ${err.toFixed(3)} m`);
    assert.ok(err <= 0.1, `${o.id}: ${err.toFixed(3)} m`);
    assert.equal(u.fusion.openingSource[o.id], 'CENTER');
  }
  assert.equal(u.doc.doors.find((d) => d.id === 'D1').wallId, 'W2', 'a centre on the top wall re-picks the top wall');
  assert.equal(u.doc.stairs.length, 1, 'the reading\'s flight is kept, not doubled');
  assert.equal(u.doc.stairs[0].id, 'S1');
  assert.ok(u.doc.stairs[0].treads >= 6, 'treads counted from the drawing');
  assert.equal(u.fusion.footprintSource, 'MODEL');
  assert.ok(Math.abs(m / TRUE_SCALE - 1) < 0.01);
  assert.ok(u.understanding.questions.length <= 6);
});
