// Plan reading v2 is general, not tuned to one drawing: synthetic plans in
// metres are drawn into rasters (solid poché walls, outlined hollow walls,
// rotated, noisy, without printed sizes, with a wall the reading missed,
// with stairs and a tiled floor), read "the way a model reads", and fused.

import test from 'node:test';
import assert from 'node:assert/strict';
import { understand } from '../planRead/understand.ts';
import { prepareRaster, snapWall, scanWall } from '../planRead/raster.ts';
import { roomSizeM } from '../planRead/solve.ts';
import { centroid, pointInPoly } from '../planRead/geom.ts';
import { flat, reading, render } from './fixtures/synthPlan.mjs';

const along = (w, m) => {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return [w.a[0] + ((w.b[0] - w.a[0]) * m) / L, w.a[1] + ((w.b[1] - w.a[1]) * m) / L];
};

function fuseFlat(renderOpts = {}, readOpts = {}, mutate = (p) => p) {
  const plan = mutate(flat());
  const r = render(plan, { mpp: 0.01, ...renderOpts });
  const read = reading(plan, r, readOpts);
  return { plan, r, read, u: understand({ doc: read.doc, dimensionStrings: read.dimensionStrings, gray: r.gray }) };
}

/** Every true opening has exactly one fused opening of its type within `tolM`. */
function assertOpenings(plan, r, doc, mpp, tolM) {
  for (const kind of ['DOOR', 'WINDOW']) {
    const truth = plan.openings.filter((o) => o.kind === kind).map((o) => r.toPx(along(plan.walls.find((w) => w.id === o.wall), o.at)));
    const found = kind === 'DOOR' ? doc.doors : doc.windows;
    assert.equal(found.length, truth.length, `${kind} count`);
    const used = new Set();
    for (const o of found) {
      let best = -1;
      let bd = Infinity;
      truth.forEach((p, i) => { if (!used.has(i)) { const d = Math.hypot(p.x - o.centerPx.x, p.y - o.centerPx.y); if (d < bd) { bd = d; best = i; } } });
      assert.ok(bd * mpp <= tolM, `${o.id} is ${(bd * mpp).toFixed(3)} m from a real ${kind.toLowerCase()}`);
      used.add(best);
    }
  }
}

function assertRooms(plan, u, tolPct) {
  for (const rm of plan.rooms) {
    const c = u.understanding.constraints.checks.find((k) => k.elementId === rm.id);
    assert.ok(c, `${rm.id} checked`);
    assert.ok(c.residualPct <= tolPct, `${rm.id} ${rm.dims}: ${c.residualPct}%`);
  }
}

test('a metric plan with solid walls: exact openings, scale and room sizes, nothing to ask', () => {
  const { plan, r, u } = fuseFlat({ style: 'solid' }, { openings: 'center' });
  assert.ok(Math.abs(u.doc.detectedScale / 0.01 - 1) < 0.01, `scale ${u.doc.detectedScale}`);
  assertOpenings(plan, r, u.doc, 0.01, 0.1);
  assertRooms(plan, u, 3);
  assert.equal(u.doc.rooms.find((x) => x.id === 'R5').kind, 'BATHROOM');
  assert.deepEqual(u.understanding.issues.filter((i) => i.severity !== 'INFO'), []);
  assert.equal(u.understanding.questions.length, 0);
  assert.ok(u.understanding.adjacency.R4.includes('R5'), 'hall → bathroom through its door');
});

test('outlined (hollow, hatched) walls and a v1 reading with every opening at a wall end', () => {
  const { plan, r, u } = fuseFlat({ style: 'hollow' }, { openings: 'ends' });
  assert.ok(Math.abs(u.doc.detectedScale / 0.01 - 1) < 0.015);
  assertOpenings(plan, r, u.doc, 0.01, 0.25);
  assertRooms(plan, u, 4);
  assert.ok([...u.doc.doors, ...u.doc.windows].every((o) => o.position > 0.02 && o.position < 0.98));
});

test('a rotated scan: walls are squared to the plan\'s own axis and rooms measured along it', () => {
  const { plan, r, u } = fuseFlat({ angleDeg: 15 }, { openings: 'center' });
  assert.ok(Math.abs(u.fusion.axisDeg - 15) < 0.5, `axis ${u.fusion.axisDeg}`);
  assert.ok(Math.abs(u.doc.detectedScale / 0.01 - 1) < 0.015);
  assertOpenings(plan, r, u.doc, 0.01, 0.1);
  assertRooms(plan, u, 4);
  const size = roomSizeM(u.doc.rooms.find((x) => x.id === 'R2'), u.doc.detectedScale, u.fusion.axisDeg);
  assert.ok(Math.abs(size.w - 3.8) < 0.08 && Math.abs(size.d - 3.4) < 0.08, JSON.stringify(size));
});

test('a noisy scan (grain and specks) reads the same', () => {
  const { plan, r, u } = fuseFlat({ noise: 0.6, seed: 11 }, { openings: 'center', seed: 5 });
  assertOpenings(plan, r, u.doc, 0.01, 0.12);
  assertRooms(plan, u, 4);
  assert.ok(u.understanding.questions.length <= 2);
});

test('no printed size: the scale stays null and its question comes first', () => {
  const { plan, r, u } = fuseFlat({}, { noDims: true });
  assert.equal(u.doc.detectedScale, null);
  assert.equal(u.understanding.constraints, null);
  const q = u.understanding.questions[0];
  assert.equal(q.kind, 'DIMENSION');
  assert.equal(q.confidence, 0);
  assert.equal(q.elementId, 'R1', 'the biggest room');
  // Geometry is still fused (walls as a ruler for thresholds only).
  assertOpenings(plan, r, u.doc, 0.01, 0.1);
});

test('a wall the reading missed between two rooms is found in the ink', () => {
  const { u } = fuseFlat({}, { omitWalls: ['I2'] });
  assert.equal(u.fusion.inferredWalls.length, 1);
  const w = u.doc.walls.find((x) => x.id === u.fusion.inferredWalls[0]);
  // I2 runs at y = 3.6 m between the two bedrooms.
  const y = (w.start.y + w.end.y) / 2;
  assert.ok(Math.abs(y - (80 + 360)) < 3, `inferred wall at y=${y}`);
  assert.ok(u.understanding.adjacency.R2.every((id) => id !== 'R3'), 'the bedrooms are separated by it');
});

test('stairs are found from their treads and carved out of the room around them; a tiled floor is not stairs', () => {
  const { u } = fuseFlat({}, {}, (p) => ({
    ...p,
    stairs: [{ box: [5.4, 4.0, 8.4, 5.0], treads: 12, vertical: true }],
    tiles: [{ box: [0.3, 5.1, 2.3, 6.7], step: 0.3 }],
  }));
  assert.equal(u.doc.stairs.length, 1, 'one flight');
  const s = u.doc.stairs[0];
  const c = centroid(s.polygon);
  const bedroom2 = u.doc.rooms.find((x) => x.id === 'R3');
  assert.ok(!pointInPoly(c, bedroom2.polygon), 'carved out of the bedroom');
  assert.ok(s.treads >= 10);
  const bath = u.doc.rooms.find((x) => x.id === 'R5');
  assert.ok(!u.doc.stairs.some((x) => pointInPoly(centroid(x.polygon), bath.polygon)), 'tiles are a grid, not a flight');
});

test('room labels decide which space is the room, even when the reading\'s outline is wrong', () => {
  const plan = flat();
  const r = render(plan, { mpp: 0.01 });
  const read = reading(plan, r, {});
  // The reading sketched the hall over the bathroom, but its (rotated, vertical) label sits in the hall.
  const hall = read.doc.rooms.find((x) => x.id === 'R4');
  const bath = read.doc.rooms.find((x) => x.id === 'R5');
  hall.polygon = bath.polygon.map((p) => ({ ...p }));
  const hallCentre = r.toPx([3.8, 5.9]);
  read.doc.texts = [{ id: 't1', text: 'HALL', role: 'ROOM_LABEL', box: { x: hallCentre.x - 6, y: hallCentre.y - 25, w: 12, h: 50 }, roomId: 'R4', confidence: 0.9 }];
  const u = understand({ doc: read.doc, dimensionStrings: read.dimensionStrings, gray: r.gray });
  const fusedHall = u.doc.rooms.find((x) => x.id === 'R4');
  assert.ok(pointInPoly(hallCentre, fusedHall.polygon), 'the hall is where its label is');
});

test('raster primitives are fast enough for a 3000-pixel scan', (t) => {
  // A large plan: the same flat at 0.0033 m/px (≈3000 px wide).
  const plan = flat();
  const r = render(plan, { mpp: 0.0033, marginPx: 60 });
  assert.ok(r.gray.width >= 2800, `width ${r.gray.width}`);
  const t0 = performance.now();
  const raster = prepareRaster(r.gray);
  const t1 = performance.now();
  for (const w of plan.walls) {
    const a = r.toPx(w.a);
    const b = r.toPx(w.b);
    const s = snapWall(raster, { x: a.x + 6, y: a.y + 6 }, { x: b.x + 6, y: b.y + 6 }, { priorPx: 60, searchPx: 80, maxThickPx: 120 });
    assert.ok(s, w.id);
    scanWall(raster, s.start, s.end, s.thicknessPx, 30);
  }
  const t2 = performance.now();
  const read = reading(plan, r, {});
  const u = understand({ doc: read.doc, dimensionStrings: read.dimensionStrings, raster });
  const t3 = performance.now();
  t.diagnostic(`${r.gray.width}×${r.gray.height}: prepare ${(t1 - t0).toFixed(0)} ms, snap+scan 8 walls ${(t2 - t1).toFixed(0)} ms, fuse+solve ${(t3 - t2).toFixed(0)} ms`);
  assert.ok(raster.factor >= 2, 'downscaled for analysis');
  // Generous bounds: CI machines vary; the diagnostic carries the real numbers.
  assert.ok(t1 - t0 < 1500, 'raster preparation');
  assert.ok(t2 - t1 < 500, 'wall snapping and scanning');
  assert.ok(Math.abs(u.doc.detectedScale / 0.0033 - 1) < 0.02);
});
