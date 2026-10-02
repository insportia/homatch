// A MEASURED picture frame makes the plan the picture's, not the reader's.
//
// An L-shaped home is pictured by a known orthographic (dollhouse) camera.
// The frame is what pictureGeometry measures from such a picture: the floor
// directions, their ratio, the wall height and the outline. The reader's
// metres are wrong the way a model's are on the real fixture — it filled the
// notch of the L, calling the home a rectangle — but it traced the rooms on
// the plan view. The rebuilt plan must be the L, at the right size, not
// mirrored, and honest about how well it sits on the picture.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planDocument, validateReconstruction } from '../reconstructRead.ts';
import { imageToPlan, planToImage, readFrame, viewShift } from '../pictureFrame.ts';
import { projectPlan, worldOf } from '../sourceCamera.ts';

const ASPECT = 1536 / 1197;
const TRUTH = {
  living: [[0, 0], [6, 0], [6, 4], [0, 4]],
  bedroom: [[6, 0], [10, 0], [10, 4], [6, 4]],
  kitchen: [[0, 4], [4, 4], [4, 8], [0, 8]],
};
const OUTLINE = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]];

function camera() {
  const cam = new THREE.OrthographicCamera(-ASPECT * 7, ASPECT * 7, 7, -7, 0.1, 500);
  cam.position.set(5 + 50 * Math.sin(0.7), 50 * Math.tan((35 * Math.PI) / 180), -4 + 50 * Math.cos(0.7));
  cam.lookAt(5, 0, -4);
  cam.updateMatrixWorld();
  return cam;
}
const uvOf = (cam, plan, h = 0) => { const v = new THREE.Vector3(...worldOf(plan, h)).project(cam); return [(v.x + 1) / 2, (1 - v.y) / 2]; };
const img = (cam, plan, h = 0) => { const [u, v] = uvOf(cam, plan, h); return [u * ASPECT, v]; };
const deg = (v) => ((((Math.atan2(v[1], v[0]) * 180) / Math.PI) % 180) + 180) % 180;

/** The frame pictureGeometry measures from this picture (computed exactly). */
function frameOf(cam) {
  const o = img(cam, [0, 0]); const ex = img(cam, [1, 0]); const ey = img(cam, [0, 1]);
  const e1 = [ex[0] - o[0], ex[1] - o[1]]; const e2 = [ey[0] - o[0], ey[1] - o[1]];
  const up = img(cam, [0, 0], 2.7);
  const base = { floorDeg: [deg(e1), deg(e2)], ratio: Math.hypot(...e1) / Math.hypot(...e2) };
  const footprint = OUTLINE.map((p) => imageToPlan(base, ...img(cam, p)));
  const xs = footprint.map((p) => p[0]); const ys = footprint.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  const perUnit = 1024 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
  const wall = Math.hypot(up[0] - o[0], up[1] - o[1]);
  return {
    v: 1, width: 1536, height: 1197, verticalDeg: 90, ...base, wall, footprint,
    view: { width: Math.ceil((Math.max(...xs) - x0) * perUnit), height: Math.ceil((Math.max(...ys) - y0) * perUnit), x0, y0, perUnit, lift: wall },
    confidence: 0.8,
  };
}
/** Where a plan point (metres) appears in the plan view, as fractions. */
const viewUv = (frame, cam, p) => {
  const q = imageToPlan(frame, ...img(cam, p));
  return [((q[0] - frame.view.x0) * frame.view.perUnit) / frame.view.width, ((q[1] - frame.view.y0) * frame.view.perUnit) / frame.view.height];
};

// The reader's metres: the notch filled (kitchen runs the full width), everything a little off.
const GUESS = {
  living: [[0.2, 0.1], [6.4, 0.1], [6.4, 4.3], [0.2, 4.3]],
  bedroom: [[6.4, 0.1], [10.6, 0.1], [10.6, 4.3], [6.4, 4.3]],
  kitchen: [[0.2, 4.3], [10.6, 4.3], [10.6, 8.1], [0.2, 8.1]],
};

function reading(cam, frame) {
  const rooms = Object.keys(TRUTH).map((key) => ({
    key, kind: key === 'kitchen' ? 'KITCHEN' : key === 'bedroom' ? 'BEDROOM' : 'LIVING', label: null,
    polygon: GUESS[key], polygonPx: TRUTH[key].map((p) => viewUv(frame, cam, p)), pxImage: 1,
    outdoor: false, confidence: 0.8, basis: 'OBSERVED',
  }));
  const objects = [
    { key: 'sofa', type: 'SOFA', truth: [3, 2], guess: [3.6, 2.5] },
    { key: 'bed', type: 'BED', truth: [8, 2], guess: [8.7, 2.4] },
    { key: 'table', type: 'TABLE', truth: [2, 6], guess: [5, 6.2] },
    // Traced in the empty notch, outside the home: a mistrace.
    { key: 'ghost', type: 'OTHER', truth: [7.5, 6.5], guess: [7.5, 6.5] },
  ].map((o) => ({
    // Traced as the reader is asked to: the centre of the piece's TOP (1 m up), and the middle of its front edge.
    key: o.key, type: o.type, label: o.key, room: null, at: o.guess, atPx: uvOf(cam, o.truth, 1), frontPx: uvOf(cam, [o.truth[0], o.truth[1] - 0.5], 1),
    pxImage: 0, facingDeg: 90,
    widthM: 1, depthM: 1, heightM: 1, color: null, material: null, style: null, form: null, secondaryColor: null, confidence: 0.8, basis: 'OBSERVED', seenIn: [0],
  }));
  return {
    view: 'AERIAL', scaleConfidence: 0.5, scaleEvidence: null, ceilingHeightM: null, rooms, openings: [], objects, surfaces: [],
    palette: [], styleWords: [], cameras: [], unknowns: [],
  };
}

const area = (poly) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

test('the stored frame is bounded: a malformed one reads as none', () => {
  const frame = frameOf(camera());
  assert.ok(readFrame(frame));
  assert.equal(readFrame({ ...frame, v: 2 }), null);
  assert.equal(readFrame({ ...frame, ratio: 40 }), null);
  assert.equal(readFrame({ ...frame, floorDeg: [40, 45] }), null, 'two floor directions 5° apart are not two axes');
  assert.equal(readFrame({ ...frame, footprint: [[0, 0], [1, 1]] }), null);
  assert.equal(readFrame({ ...frame, view: { ...frame.view, perUnit: -1 } }), null);
  assert.equal(readFrame(null), null);
});

test('plan units round-trip through the picture', () => {
  const frame = frameOf(camera());
  for (const q of [[0.1, 0.2], [-0.3, 0.7]]) {
    const i = planToImage(frame, q);
    const back = imageToPlan(frame, ...i);
    assert.ok(Math.hypot(back[0] - q[0], back[1] - q[1]) < 1e-9);
  }
});

test('with a measured frame, the L stays an L at the right size, whatever the reader guessed', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const { recon } = validateReconstruction(reading(cam, frame), 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  assert.ok(recon.fidelity, 'the frame was used');
  const by = Object.fromEntries(recon.rooms.map((r) => [r.key, r]));
  for (const key of Object.keys(TRUTH)) {
    assert.equal(by[key].geometry, 'PIXELS', key);
    // Same corners as the truth (after the plan's own origin), within 25 cm.
    for (const [i, p] of TRUTH[key].entries()) {
      const q = by[key].polygon.find((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 0.25);
      assert.ok(q, `${key} corner ${i} ${JSON.stringify(p)} in ${JSON.stringify(by[key].polygon)}`);
    }
  }
  // The notch is empty: the kitchen is 4 × 4, not the reader's 10.4 × 3.8.
  assert.ok(Math.abs(area(by.kitchen.polygon) - 16) < 1.2, `kitchen ${area(by.kitchen.polygon)} m²`);
  const total = recon.rooms.reduce((s, r) => s + area(r.polygon), 0);
  assert.ok(Math.abs(total - 56) / 56 < 0.05, `total ${total} m² vs 56`);
});

test('pieces follow the picture through the measured camera; a trace outside the home is rejected', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const { recon } = validateReconstruction(reading(cam, frame), 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  const at = Object.fromEntries(recon.objects.map((o) => [o.key, o]));
  assert.ok(Math.hypot(at.sofa.at[0] - 3, at.sofa.at[1] - 2) < 0.25, JSON.stringify(at.sofa.at));
  assert.ok(Math.hypot(at.table.at[0] - 2, at.table.at[1] - 6) < 0.25, 'the reader put the table 3 m off; the picture puts it back');
  assert.equal(at.ghost.geometry, 'ESTIMATE', 'a point in the notch is outside the picture\'s own outline');
  // Which way it faces comes from where its front edge is drawn (south here), not from the reader's 90 degrees.
  assert.equal(at.sofa.facingDeg, 180, `facing ${at.sofa.facingDeg}`);
});

test('a piece traced on its top lands where it stands, and the picture gives its own wall height', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const r = reading(cam, frame);
  // A 2 m wardrobe, traced on its top: lowered by 2 m it stands at its floor point.
  r.objects.push({ key: 'wardrobe', type: 'WARDROBE', label: 'wardrobe', room: null, at: [1, 1], atPx: uvOf(cam, [1.5, 3], 2), frontPx: null, pxImage: 0, facingDeg: 0,
    widthM: 1, depthM: 0.6, heightM: 2, color: null, material: null, style: null, form: null, secondaryColor: null, confidence: 0.8, basis: 'OBSERVED', seenIn: [0] });
  const { recon } = validateReconstruction(r, 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  const w = recon.objects.find((o) => o.key === 'wardrobe');
  assert.ok(Math.hypot(w.at[0] - 1.5, w.at[1] - 3) < 0.25, JSON.stringify(w.at));
  // The frame's wall is 2.7 m in this picture.
  assert.ok(Math.abs(recon.fidelity.wallM - 2.7) < 0.15, `wall ${recon.fidelity.wallM}`);
});

test('the camera is the measured one, and its error is how far the rebuilt outline is from the picture\'s', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const { recon } = validateReconstruction(reading(cam, frame), 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  const fit = recon.cameras.find((c) => c.image === 0)?.fit;
  assert.ok(fit && fit.model === 'ORTHO');
  assert.ok(recon.fidelity.errorPct < 1, `outline error ${recon.fidelity.errorPct}%`);
  // Not mirrored: the rebuilt plan projects onto the picture where the truth does.
  const probe = projectPlan(fit, [9, 1]);
  const truth = uvOf(cam, [9, 1]);
  assert.ok(Math.hypot((probe[0] - truth[0]) * ASPECT, probe[1] - truth[1]) < 0.02, `${probe} vs ${truth}`);
});

test('a rebuilt plan that misses the picture\'s outline says so', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const r = reading(cam, frame);
  // The reader traced the kitchen across the notch on the plan view.
  const k = r.rooms.find((x) => x.key === 'kitchen');
  k.polygonPx = [[0, 4], [10, 4], [10, 8], [0, 8]].map((p) => viewUv(frame, cam, p));
  const { recon } = validateReconstruction(r, 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  assert.ok(recon.fidelity.errorPct > 2.5, `outline error ${recon.fidelity.errorPct}% must not read as matched`);
});

test('a plan-view index is only valid for rooms, and only when a frame names it', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const { recon } = validateReconstruction(reading(cam, frame), 1, { imageAspects: [ASPECT] });
  assert.ok(recon.rooms.every((r) => r.px === null), 'without a frame, image 1 does not exist');
});

// ── Partitions cut lower than the outer walls ─────────────────────────────
//
// The plan view is drawn at the OUTER wall tops. A cut-away cuts its
// partitions lower, so the plan view draws them off their lines, toward the
// side the picture was taken from, by (outer − partition) · cot(elevation) —
// nearly 2 m here. The reader traces what it sees; the reading says how low
// the partitions are cut; HOMATCH puts them back.

const onOutline = (a, b) => OUTLINE.some((c, i) => {
  const d = OUTLINE[(i + 1) % OUTLINE.length];
  const on = (p) => Math.abs((d[0] - c[0]) * (p[1] - c[1]) - (d[1] - c[1]) * (p[0] - c[0])) < 1e-6
    && p[0] >= Math.min(c[0], d[0]) - 1e-6 && p[0] <= Math.max(c[0], d[0]) + 1e-6 && p[1] >= Math.min(c[1], d[1]) - 1e-6 && p[1] <= Math.max(c[1], d[1]) + 1e-6;
  return on(a) && on(b);
});

/** Where the reader sees a room's corners on the plan view: where its walls' TOP lines meet, as the view draws them. */
function topTraces(frame, cam, room, cut) {
  const q = room.map((p) => imageToPlan(frame, ...img(cam, p)));
  const n = room.length;
  const lines = room.map((a, i) => {
    const s = viewShift(frame, onOutline(a, room[(i + 1) % n]) ? frame.wall : frame.wall * cut);
    return { p: [q[i][0] + s[0], q[i][1] + s[1]], d: [q[(i + 1) % n][0] - q[i][0], q[(i + 1) % n][1] - q[i][1]] };
  });
  return room.map((_, i) => {
    const A = lines[(i - 1 + n) % n]; const B = lines[i];
    const cross = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    const t = ((B.p[0] - A.p[0]) * B.d[1] - (B.p[1] - A.p[1]) * B.d[0]) / cross;
    const at = [A.p[0] + t * A.d[0], A.p[1] + t * A.d[1]];
    return [((at[0] - frame.view.x0) * frame.view.perUnit) / frame.view.width, ((at[1] - frame.view.y0) * frame.view.perUnit) / frame.view.height];
  });
}

test('the plan view draws a point at wall-top height in place, anything lower shifted toward the camera', () => {
  const cam = camera();
  const frame = frameOf(cam);
  assert.deepEqual(viewShift(frame, frame.view.lift), [0, 0]);
  // A point 1.35 m up at plan p is drawn where the view shows plan p + shift.
  const p = imageToPlan(frame, ...img(cam, [3, 3]));
  const s = viewShift(frame, frame.wall / 2);
  const drawn = planToImage(frame, [p[0] + s[0], p[1] + s[1]], frame.view.lift);
  const truth = img(cam, [3, 3], 1.35);
  assert.ok(Math.hypot(drawn[0] - truth[0], drawn[1] - truth[1]) < 1e-9);
});

test('partitions cut lower are put back on their lines: the rooms are the truth, not the view\'s drawing', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const traced = (cutRatio) => {
    const r = reading(cam, frame);
    r.wallCutRatio = cutRatio;
    for (const room of r.rooms) room.polygonPx = topTraces(frame, cam, TRUTH[room.key], 0.5);
    return validateReconstruction(r, 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] }).recon;
  };
  const recon = traced(0.5);
  const by = Object.fromEntries(recon.rooms.map((x) => [x.key, x]));
  for (const key of Object.keys(TRUTH)) {
    assert.equal(by[key].geometry, 'PIXELS', key);
    for (const p of TRUTH[key]) {
      const q = by[key].polygon.find((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 0.25);
      assert.ok(q, `${key} corner ${JSON.stringify(p)} in ${JSON.stringify(by[key].polygon)}`);
    }
  }
  assert.ok(recon.fidelity.partitionShiftM > 1.5 && recon.fidelity.partitionShiftM < 2.4, `shift ${recon.fidelity.partitionShiftM} m`);
  // A reading that does not say how low the partitions are cut is taken as drawn: the same traces are metres off.
  const living = traced(null).rooms.find((x) => x.key === 'living');
  assert.ok(!living.polygon.some((c) => Math.hypot(c[0] - 6, c[1] - 4) < 0.3), JSON.stringify(living.polygon));
});

test('an untraced opening rides its wall when the room follows the picture', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const r = reading(cam, frame);
  // On the reader's own living/bedroom line (x = 6.4), halfway along it; not traced.
  r.openings.push({ key: 'door', kind: 'DOOR', at: [6.4, 2.2], atPx: null, pxImage: null, widthM: 0.9, heightM: null, sillM: null, confidence: 0.7, basis: 'OBSERVED' });
  const { recon } = validateReconstruction(r, 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] });
  const door = recon.openings.find((o) => o.key === 'door');
  assert.ok(Math.hypot(door.at[0] - 6, door.at[1] - 2) < 0.25, `on the true wall: ${JSON.stringify(door.at)}`);
  assert.equal(door.geometry, 'ESTIMATE', 'its place along the wall is still the reader\'s');
  assert.ok(!planDocument(recon, 'k').warnings.some((w) => w.code === 'OPENING_WITHOUT_WALL'), 'it still lands on a wall');
});

test('floor the picture shows and no room covers is reported; a door into it makes it a proposed room', () => {
  const cam = camera();
  const frame = frameOf(cam);
  const short = (withDoor, unknowns = []) => {
    const r = reading(cam, frame);
    // The reader stopped the kitchen at y = 6: the far 4 × 2 m of the wing is in no room.
    const k = r.rooms.find((x) => x.key === 'kitchen');
    k.polygon = [[0.2, 4.3], [4.2, 4.3], [4.2, 6.2], [0.2, 6.2]];
    k.polygonPx = [[0, 4], [4, 4], [4, 6], [0, 6]].map((p) => viewUv(frame, cam, p));
    if (withDoor) r.openings.push({ key: 'store', kind: 'DOOR', at: [2.2, 6.2], atPx: null, pxImage: null, widthM: 0.8, heightM: null, sillM: null, confidence: 0.6, basis: 'OBSERVED' });
    r.unknowns = unknowns;
    return validateReconstruction(r, 1, { imageAspects: [ASPECT], frames: [{ image: 0, view: 1, frame: readFrame(frame) }] }).recon;
  };
  const silent = short(false);
  assert.equal(silent.fidelity.uncovered.length, 1, JSON.stringify(silent.fidelity.uncovered));
  assert.ok(Math.abs(silent.fidelity.uncovered[0].areaM2 - 8) < 1.2, `${silent.fidelity.uncovered[0].areaM2} m²`);
  assert.equal(silent.fidelity.uncovered[0].candidate, null, 'nothing says a room is there: reported, never invented');
  assert.ok(!silent.rooms.some((x) => x.candidate));
  assert.ok(planDocument(silent, 'k').warnings.some((w) => w.code === 'UNREADABLE_REGION' && !w.elementId));

  const doored = short(true);
  const cand = doored.rooms.find((x) => x.candidate);
  assert.ok(cand, 'a door leads into it: proposed');
  assert.equal(cand.basis, 'INFERRED');
  assert.ok(cand.confidence <= 0.3);
  assert.equal(cand.kind, 'HALL', '8 m² is not a cupboard');
  // It fills the gap: from the kitchen's far wall to the picture's own outline, the wing's width.
  const xs = cand.polygon.map((p) => p[0]); const ys = cand.polygon.map((p) => p[1]);
  const kitchenTop = Math.max(...doored.rooms.find((x) => x.key === 'kitchen').polygon.map((p) => p[1]));
  const outlineTop = Math.max(...doored.fidelity.outline.map((p) => p[1]));
  assert.ok(Math.abs(Math.min(...ys) - kitchenTop) < 0.15 && Math.abs(Math.max(...ys) - outlineTop) < 0.15 && Math.max(...xs) - Math.min(...xs) > 3.6,
    `${JSON.stringify(cand.polygon)} between ${kitchenTop} and ${outlineTop}`);
  assert.ok(planDocument(doored, 'k').rooms.some((x) => x.id === `r-${cand.key}` && /HOMATCH proposal/.test(x.evidence)));

  // Named among the unknowns (the only such region): proposed as what was named.
  assert.equal(short(false, ['a walk-in closet behind the kitchen']).rooms.find((x) => x.candidate)?.kind, 'STORAGE');
});
