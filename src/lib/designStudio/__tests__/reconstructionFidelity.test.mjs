// Reconstruct means REPRODUCE: the plan follows the picture, not a guess.
//
// A two-room flat that is not a pair of rectangles (a 30° wall between the
// rooms, and the living room cut on the diagonal) is pictured by a known
// isometric camera. The reader's metres are deliberately squared off and a
// little wrong, as a model's are; its pixel traces are what it saw. The
// rebuilt plan must follow the pixels, keep the angles, and keep the camera.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateReconstruction, planDocument, snapRooms, deriveWalls } from '../reconstructRead.ts';
import { projectPlan, worldOf } from '../sourceCamera.ts';

const ASPECT = 1536 / 1197;

// Truth: living room with a 30° cut; bedroom beside it sharing the 30° wall.
const TRUTH = {
  living: [[0, 0], [5, 0], [7, 3.4641], [7, 6], [0, 6]],
  bedroom: [[5, 0], [10, 0], [10, 6], [7, 6], [7, 3.4641]],
};

function camera() {
  const cam = new THREE.OrthographicCamera(-ASPECT * 6, ASPECT * 6, 6, -6, 0.1, 500);
  cam.position.set(5 + 50 * Math.sin(0.65), 50 * Math.tan((33 * Math.PI) / 180), -3 + 50 * Math.cos(0.65));
  cam.lookAt(5, 0, -3);
  cam.updateMatrixWorld();
  return cam;
}
const uvOf = (cam, plan) => {
  const v = new THREE.Vector3(...worldOf(plan)).project(cam);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
};
// The reader's metres: squared off (the cut ignored) and slightly off.
const guess = ([x, y]) => [Math.round(x) + 0.12, Math.round(y) - 0.08];

function reading(cam) {
  const room = (key, kind, poly) => ({
    key, kind, label: null, polygon: poly.map(guess), polygonPx: poly.map((p) => uvOf(cam, p)), pxImage: 0,
    outdoor: false, confidence: 0.8, basis: 'OBSERVED',
  });
  return {
    view: 'AERIAL', scaleConfidence: 0.5, scaleEvidence: 'doors and beds', ceilingHeightM: null,
    rooms: [room('living', 'LIVING', TRUTH.living), room('bedroom', 'BEDROOM', TRUTH.bedroom)],
    openings: [{ key: 'd1', kind: 'DOOR', at: guess([6, 1.7321]), atPx: uvOf(cam, [6, 1.7321]), pxImage: 0, widthM: 0.9, heightM: null, sillM: null, confidence: 0.7, basis: 'OBSERVED' }],
    objects: [{
      key: 'bed', type: 'BED_DOUBLE', label: 'double bed', room: 'bedroom', at: guess([8.5, 3]), atPx: uvOf(cam, [8.5, 3]), pxImage: 0,
      facingDeg: 180, widthM: 1.6, depthM: 2, heightM: 0.5, color: null, material: null, style: null, confidence: 0.9, basis: 'OBSERVED', seenIn: [0],
    }],
    surfaces: [], palette: [], styleWords: [],
    cameras: [{ image: 0, kind: 'AERIAL', at: [15, -10], heightM: 20, yawDeg: 330, pitchDeg: -40, fovDeg: 50, confidence: 0.5 }],
    unknowns: [],
  };
}

const angleOf = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 180;

test('the outlines follow the picture, not the squared-off metres', () => {
  const { recon } = validateReconstruction(reading(camera()), 1, { imageAspects: [ASPECT] });
  assert.ok(recon.fidelity, 'a fidelity record');
  assert.equal(recon.fidelity.model, 'ORTHO');
  assert.ok(recon.fidelity.errorPct < 5, `error ${recon.fidelity.errorPct}%`);
  assert.ok(recon.rooms.every((r) => r.geometry === 'PIXELS'), 'both outlines are the picture\'s');
  // The living room is a pentagon with a 30° edge again, not the rectangle the metres said.
  const living = recon.rooms.find((r) => r.key === 'living');
  const angles = living.polygon.map((p, i) => angleOf(p, living.polygon[(i + 1) % living.polygon.length]));
  assert.ok(angles.some((a) => Math.abs(a - 60) < 2 || Math.abs(a - 30) < 2 || Math.abs(a - 120) < 2 || Math.abs(a - 150) < 2),
    `an angled edge survives: ${angles.map((a) => a.toFixed(1)).join(', ')}`);
  // Proportions: the plan is 10 × 6 in truth; the rebuilt one keeps the 5:3 shape.
  const xs = recon.rooms.flatMap((r) => r.polygon.map((p) => p[0]));
  const ys = recon.rooms.flatMap((r) => r.polygon.map((p) => p[1]));
  const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  assert.ok(Math.abs(ratio - 10 / 6) < 0.12, `proportions ${ratio.toFixed(3)}`);
});

test('the angled wall between the rooms is ONE interior wall, not two exterior ones', () => {
  const { recon } = validateReconstruction(reading(camera()), 1, { imageAspects: [ASPECT] });
  const walls = deriveWalls(snapRooms(recon.rooms));
  const slanted = walls.filter((w) => {
    const a = angleOf(w.from, w.to);
    return a > 5 && a < 85 || a > 95 && a < 175;
  });
  assert.equal(slanted.length, 1, JSON.stringify(slanted));
  assert.equal(slanted[0].kind, 'INTERIOR');
});

test('openings and pieces are placed where the picture shows them', () => {
  const { recon } = validateReconstruction(reading(camera()), 1, { imageAspects: [ASPECT] });
  const bed = recon.objects.find((o) => o.key === 'bed');
  const door = recon.openings.find((o) => o.key === 'd1');
  assert.equal(bed.geometry, 'PIXELS');
  assert.equal(door.geometry, 'PIXELS');
  const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/x.jpg');
  assert.equal(doc.doors.length, 1, 'the door sits on a wall (the angled one)');
});

test('the fitted camera is kept, in the final plan frame', () => {
  const cam = camera();
  const { recon } = validateReconstruction(reading(cam), 1, { imageAspects: [ASPECT] });
  const fit = recon.cameras[0].fit;
  assert.ok(fit && fit.model === 'ORTHO');
  // Every rebuilt corner projects back onto the pixel it was traced at.
  const raw = reading(cam);
  for (const room of recon.rooms) {
    const traced = raw.rooms.find((r) => r.key === room.key).polygonPx;
    for (const [i, p] of room.polygon.entries()) {
      const q = projectPlan(fit, p);
      const e = Math.min(...traced.map((t) => Math.hypot((q[0] - t[0]) * ASPECT, q[1] - t[1])));
      assert.ok(e < 0.01, `${room.key}[${i}] is ${(e * 100).toFixed(2)}% of the picture away from its trace`);
    }
  }
});

test('with nothing traced the reader\'s estimate stands, and says so', () => {
  const raw = reading(camera());
  for (const r of raw.rooms) { r.polygonPx = []; r.pxImage = null; }
  for (const o of [...raw.openings, ...raw.objects]) { o.atPx = null; o.pxImage = null; }
  const { recon } = validateReconstruction(raw, 1, { imageAspects: [ASPECT] });
  assert.equal(recon.fidelity, null);
  assert.ok(recon.rooms.every((r) => r.geometry === 'ESTIMATE'));
});

test('a mistraced point does not drag the plan: the camera fit drops it', () => {
  const raw = reading(camera());
  raw.rooms[0].polygonPx[2] = [0.95, 0.05]; // nowhere near that corner
  const { recon } = validateReconstruction(raw, 1, { imageAspects: [ASPECT] });
  assert.ok(recon.fidelity && recon.fidelity.errorPct < 5, JSON.stringify(recon.fidelity));
});
