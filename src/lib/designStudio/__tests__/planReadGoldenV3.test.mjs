// Plan reading v3 on the golden plan — the 1-bit PNG a customer uploaded
// (production 2026-10-03, project 149f8b85) with its real ds-read-2 reading
// (tests/fixtures/design-studio/golden-floorplan.read-v3.json).
//
// Production got it wrong in a chain this file pins down:
//   - the edge's general PNG decoder returned the 1-bit rows inverted and
//     broken into dots, so fusion worked on a picture that was nearly all ink;
//   - on that "ink" both bedroom doorways were bridged shut (the wall carried
//     across them, the gaps never found again) and two flights of "stairs"
//     were found filling the bedrooms;
//   - the reading itself calls the two bedroom doors, whose swings meet at the
//     partition's end, "a double door between the bedrooms" — so the bedrooms
//     opened only into each other.
// Now: the PNG is read by the specification (planRead/png.ts); ink that
// confirms little of the walls is not trusted (rasterRejected); and a door
// read on a partition's end where the wall line is open is that doorway.
//
// Coordinates are this drawing's ground truth, read off it by a person
// (shared with planReadGoldenV2.test.mjs); production code never sees them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { understand } from '../../../../supabase/functions/_shared/designStudio/planRead/understand.ts';
import { prepareRaster, toGray } from '../../../../supabase/functions/_shared/designStudio/planRead/raster.ts';
import { decodeLowDepthPng, lowDepthGray, pngHeader } from '../../../../supabase/functions/_shared/designStudio/planRead/png.ts';
import { buildCanonical } from '../scale.ts';
import { buildSpaceModel } from '../space.ts';
import { buildWalkModel, findPath, nearestFree } from '../navigation.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
const TRUE_DOORS = [
  [361, 115], [419, 115], [361, 357], [419, 357], [329, 395],
  [257, 435], [305, 435], [374, 658], [520, 702],
];
const TRUE_WINDOWS = [[266, 115], [498, 115], [490, 357], [295, 837], [432, 702], [374, 733]];

const bytes = new Uint8Array(fs.readFileSync(path.join(FIX, 'golden-floorplan.1bit.png')));
// Exactly what production's decoder does (rasterDecode.decodeGray), with zlib in place of pako.
const low = decodeLowDepthPng(bytes, (z) => new Uint8Array(zlib.inflateSync(z)));
const gray = toGray(lowDepthGray(low), low.width, low.height, 1);
const v3 = JSON.parse(fs.readFileSync(path.join(FIX, 'golden-floorplan.read-v3.json'), 'utf8'));
const fresh = () => JSON.parse(JSON.stringify(v3.rawDoc));
let cached;
const run = () => (cached ??= understand({ doc: fresh(), dimensionStrings: v3.dimensionStrings, gray }));
const near = (p, [x, y], m, tol = 0.35) => Math.hypot(p.x - x, p.y - y) * m <= tol;
const edgesOf = (u) => u.understanding.connectivity.edges.map((e) => [e.a, e.b].sort().join('-'));

function walkable(u, from, to) {
  const { doc, understanding } = u;
  const cal = { metresPerPx: understanding.constraints?.metresPerPx ?? doc.detectedScale, geometryState: 'ESTIMATED', uncertainty: null, conflict: false, implied: [] };
  const built = buildCanonical(doc, { rejected: [], roomKinds: {} }, cal, 2.7, 'TYPICAL');
  assert.ok(built.ok, JSON.stringify(built.problems));
  const space = buildSpaceModel(built.canonical.scene);
  const model = buildWalkModel(space, [], new Map());
  const centre = (id) => nearestFree(model, space.rooms.find((r) => r.id === id).centroid, 1.5);
  // Doors are walked through as they are drawn; nothing is "opened on the way" here.
  return { ok: !!findPath(model, centre(from), centre(to), { throughDoors: false, maxCells: 60000 }), space };
}

test('golden v3: the 1-bit PNG is read by the specification — a clean drawing, mostly paper', () => {
  assert.equal(pngHeader(bytes).depth, 1);
  const r = prepareRaster(gray);
  let ink = 0;
  for (const v of r.line) ink += v;
  assert.ok(ink / r.line.length < 0.1, `${Math.round((ink / r.line.length) * 100)}% of the drawing read as ink`);
});

test('golden v3: the clean drawing is trusted (its ink confirms the reading\'s walls)', () => {
  const { fusion } = run();
  assert.equal(fusion.rasterUsed, true);
  assert.equal(fusion.rasterRejected, null);
  assert.ok(fusion.rasterQuality >= 0.9, String(fusion.rasterQuality));
});

test('golden v3: only the real staircase; no flight in the bedrooms', () => {
  assert.deepEqual((run().doc.stairs ?? []).map((s) => s.id), ['s1']);
});

test('golden v3: each bedroom opens to the living room through its own door; no door between the bedrooms', () => {
  const u = run();
  const m = u.doc.detectedScale;
  for (const truth of [[361, 357], [419, 357]]) {
    assert.ok(u.doc.doors.some((d) => near(d.centerPx, truth, m)), `no door at ${truth}`);
  }
  const edges = edgesOf(u);
  assert.ok(edges.includes('r1-r2') && edges.includes('r1-r3'), edges.join(' '));
  assert.ok(!edges.includes('r2-r3'), 'a door between the two bedrooms');
  assert.ok(!u.understanding.connectivity.signals.some((s) => s.code === 'PRIVATE_ROOM_VIA_PRIVATE_ONLY'));
});

test('golden v3: nothing invented — every door and every window found is a real one', () => {
  const { doc } = run();
  const m = doc.detectedScale;
  const used = new Set();
  for (const d of doc.doors) {
    const i = TRUE_DOORS.findIndex((t, k) => !used.has(k) && near(d.centerPx, t, m));
    assert.ok(i >= 0, `${d.id} at (${d.centerPx.x},${d.centerPx.y}) is not a real door`);
    used.add(i);
  }
  // The reading's own windows are kept as read; anything the drawing added is a real window.
  for (const id of ['win1', 'win2', 'win3', 'win4', 'win5']) assert.ok(doc.windows.some((w) => w.id === id), `${id} lost`);
  for (const w of doc.windows.filter((x) => x.id.startsWith('hm-'))) {
    assert.ok(TRUE_WINDOWS.some((t) => near(w.centerPx, t, m)), `${w.id} at (${w.centerPx.x},${w.centerPx.y}) is not a real window`);
  }
});

test('golden v3: every wall the reading drew is kept (or merged into the wall it continues, on record)', () => {
  const { doc, fusion } = run();
  for (const w of v3.rawDoc.walls) assert.ok(doc.walls.some((x) => x.id === w.id) || fusion.mergedWalls.some((mm) => mm.from === w.id), `${w.id} lost`);
  // Provenance: every opening the reading had is accounted for.
  for (const o of [...v3.rawDoc.doors, ...v3.rawDoc.windows]) assert.ok(fusion.openingProvenance[o.id], `${o.id} has no provenance`);
});

test('golden v3: in the generated 3D space a person walks from the living room into each bedroom', () => {
  const u = run();
  for (const id of ['r2', 'r3']) assert.ok(walkable(u, 'r1', id).ok, `cannot walk from the living room into ${id}`);
  assert.deepEqual(walkable(u, 'r1', 'r2').space.stairs.map((s) => s.id), ['s1']);
});

// ── The safety nets, on the same drawing degraded to dots (what the old decoder produced) ──

test('golden v3, dotted ink: not trusted; the reading\'s walls stand; the junction door becomes the two bedroom doorways', () => {
  const dotted = { width: gray.width, height: gray.height, data: new Uint8Array(gray.data) };
  for (let y = 0; y < dotted.height; y += 1) {
    for (let x = 0; x < dotted.width; x += 1) {
      const i = y * dotted.width + x;
      if (dotted.data[i] < 128 && (x + y) % 5 !== 0) dotted.data[i] = 255; // keep one ink pixel in five
    }
  }
  const u = understand({ doc: fresh(), dimensionStrings: v3.dimensionStrings, gray: dotted });
  assert.equal(u.fusion.rasterRejected, 'WEAK_INK');
  assert.deepEqual((u.doc.stairs ?? []).map((s) => s.id), ['s1'], 'no stairs found in dots');
  assert.equal(u.fusion.junctionDoorways.length, 1);
  assert.equal(u.fusion.openingProvenance.d2.outcome, 'JUNCTION_DOORWAY');
  const edges = edgesOf(u);
  assert.ok(edges.includes('r1-r2') && edges.includes('r1-r3') && !edges.includes('r2-r3'), edges.join(' '));
  for (const id of ['r2', 'r3']) assert.ok(walkable(u, 'r1', id).ok, `cannot walk from the living room into ${id}`);
  // Nothing beyond the reading: its doors, the one double door now its two doorways.
  assert.equal(u.doc.doors.length, v3.rawDoc.doors.length + 1);
});

test('a negative drawing (light lines on dark) is read the right way round', () => {
  const inv = { width: gray.width, height: gray.height, data: gray.data.map((v) => 255 - v) };
  const a = prepareRaster(gray); const b = prepareRaster(inv);
  let same = 0;
  for (let i = 0; i < a.line.length; i += 1) if (a.line[i] === b.line[i]) same += 1;
  assert.ok(same / a.line.length > 0.99, `${same / a.line.length}`);
});
