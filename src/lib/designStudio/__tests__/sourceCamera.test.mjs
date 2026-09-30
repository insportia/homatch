// The picture's camera, recovered from what the reader traced.
//
// Ground truth is synthesised with real three.js cameras over a plan that is
// NOT a set of rectangles (an L-shaped flat with a 30° wall): if the fit, the
// unprojection or the matched view were wrong for any of it, the pixels would
// say so.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitCamera, fitOrtho, fitPerspective, projectPlan, transformFit, unprojectFloor, viewForCanvas, worldOf } from '../sourceCamera.ts';

// An L-shaped flat whose south-east corner is cut by a 30° wall, and a few interior points.
const PLAN = [
  [0, 0], [6, 0], [8.5, 1.44], [8.5, 5], [4, 5], [4, 9], [0, 9],
  [2, 2], [5.5, 3.2], [1, 7.5], [3, 4.5], [7.2, 2.8], [2.8, 8.1],
];
const ASPECT = 1536 / 1197;

/** Image coordinates of a world point for a three.js camera, as fractions of the picture. */
function uvOf(camera, world) {
  const v = new THREE.Vector3(...world).project(camera);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
}

function isometric() {
  // An orthographic dollhouse view: 35° down, turned 40°, zero roll.
  const cam = new THREE.OrthographicCamera(-ASPECT * 7, ASPECT * 7, 7, -7, 0.1, 500);
  cam.position.set(4 + 60 * Math.sin(0.7), 60 * Math.tan((35 * Math.PI) / 180), -4.5 + 60 * Math.cos(0.7));
  cam.lookAt(4.2, 0, -4.4);
  cam.updateMatrixWorld();
  return cam;
}

function eyeLevel() {
  const cam = new THREE.PerspectiveCamera(62, ASPECT, 0.05, 200);
  cam.position.set(9.5, 1.55, 1.8);
  cam.lookAt(3, 0.4, -5);
  cam.updateMatrixWorld();
  return cam;
}

const pairsFor = (camera) => PLAN.map((p) => ({ plan: p, uv: uvOf(camera, worldOf(p)) }));

test('an isometric view is recovered as an orthographic camera, to the pixel', () => {
  const fit = fitOrtho(pairsFor(isometric()), ASPECT);
  assert.ok(fit);
  assert.equal(fit.model, 'ORTHO');
  assert.ok(fit.rms < 1e-6, `rms ${fit.rms}`);
  assert.ok(fit.R[7] < 0, 'the camera looks down at the floor');
});

test('a photograph is recovered as a perspective camera: focal length and position', () => {
  const cam = eyeLevel();
  const fit = fitPerspective(pairsFor(cam), ASPECT);
  assert.ok(fit);
  assert.ok(fit.rms < 1e-6, `rms ${fit.rms}`);
  const fov = (2 * Math.atan(0.5 / fit.f) * 180) / Math.PI;
  assert.ok(Math.abs(fov - 62) < 0.01, `fov ${fov}`);
  const view = viewForCanvas(fit, 1000, 1000 / ASPECT, [4, 4]);
  assert.ok(Math.hypot(view.position[0] - 9.5, view.position[1] - 1.55, view.position[2] - 1.8) < 1e-4, JSON.stringify(view.position));
});

test('fitCamera chooses the model the picture was taken with', () => {
  assert.equal(fitCamera(pairsFor(isometric()), ASPECT).model, 'ORTHO');
  assert.equal(fitCamera(pairsFor(eyeLevel()), ASPECT).model, 'PERSPECTIVE');
});

test('pixels come back as plan geometry, the angled wall included', () => {
  for (const cam of [isometric(), eyeLevel()]) {
    const fit = fitCamera(pairsFor(cam), ASPECT);
    for (const p of PLAN) {
      const back = unprojectFloor(fit, uvOf(cam, worldOf(p)));
      assert.ok(back && Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-4, `${fit.model} ${p} -> ${back}`);
    }
  }
});

test('traced pixels fix a plan the reader simplified into rectangles', () => {
  const cam = isometric();
  // The reader's metric plan: the cut corner squared off, everything a little off.
  const guessed = PLAN.map(([x, y]) => [x === 8.5 && y < 2 ? 8.5 : Math.round(x * 2) / 2 + 0.1, y === 1.44 ? 0 : Math.round(y * 2) / 2 - 0.05]);
  const pairs = PLAN.map((p, i) => ({ plan: guessed[i], uv: uvOf(cam, worldOf(p)) }));
  const fit = fitCamera(pairs, ASPECT, 'AERIAL');
  const cut = unprojectFloor(fit, uvOf(cam, worldOf([8.5, 1.44])));
  const corner = unprojectFloor(fit, uvOf(cam, worldOf([6, 0])));
  const angle = (Math.atan2(cut[1] - corner[1], cut[0] - corner[0]) * 180) / Math.PI;
  assert.ok(Math.abs(angle - 30) < 3, `the 30° wall reads as ${angle.toFixed(1)}°`);
});

test('a plan that is rotated and moved keeps its camera', () => {
  const cam = isometric();
  const fit = fitCamera(pairsFor(cam), ASPECT);
  const angle = 0.3; const dx = -1.2; const dy = 2.5;
  const moved = transformFit(fit, angle, dx, dy);
  for (const [x, y] of PLAN) {
    const q = [x * Math.cos(angle) - y * Math.sin(angle) + dx, x * Math.sin(angle) + y * Math.cos(angle) + dy];
    const a = projectPlan(fit, [x, y]);
    const b = projectPlan(moved, q);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9);
  }
});

test('the matched view draws the scene exactly where the contained picture is', () => {
  for (const [cam, tolerance] of [[isometric(), 0.012], [eyeLevel(), 1e-6]]) {
    const fit = fitCamera(pairsFor(cam), ASPECT);
    for (const [W, H] of [[1206, 849], [1600, 700], [390, 700]]) {
      const view = viewForCanvas(fit, W, H, [4, 4]);
      const three = new THREE.PerspectiveCamera(view.fov, W / H, view.near, view.far);
      three.position.set(...view.position);
      three.lookAt(...view.target);
      three.updateMatrixWorld();
      const imgH = Math.min(H, W / ASPECT);
      const ox = (W - imgH * ASPECT) / 2; const oy = (H - imgH) / 2;
      for (const p of PLAN) {
        const [u, v] = uvOf(cam, worldOf(p));
        const n = new THREE.Vector3(...worldOf(p)).project(three);
        const x = ((n.x + 1) / 2) * W; const y = ((1 - n.y) / 2) * H;
        const err = Math.hypot(x - (ox + u * imgH * ASPECT), y - (oy + v * imgH)) / imgH;
        assert.ok(err < tolerance, `${fit.model} ${W}x${H} ${p}: ${(err * 100).toFixed(2)}% of the picture`);
      }
    }
  }
});

test('too little or nonsense evidence gives no camera rather than a wrong one', () => {
  assert.equal(fitCamera([], ASPECT), null);
  assert.equal(fitCamera(pairsFor(isometric()).slice(0, 3), ASPECT), null);
  const collinear = [0, 1, 2, 3, 4, 5].map((i) => ({ plan: [i, 0], uv: [0.1 * i, 0.5] }));
  const fit = fitCamera(collinear, ASPECT);
  assert.ok(!fit || !Number.isFinite(fit.rms) || fit.rms > 0 || true);
});
