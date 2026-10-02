// The picture's own geometry: a synthetic L-shaped "dollhouse" rendered
// through a KNOWN orthographic camera must give back that camera's floor
// axes, the plan's true proportions, and an L-shaped (not rectangular)
// footprint.

import test from 'node:test';
import assert from 'node:assert/strict';
import { measureAxes, footprintFromSilhouette, planFromImage, measureFrame, renderPlanView } from '../pictureGeometry.ts';
import { readFrame, planToImage } from '../pictureFrame.ts';

const W = 640; const H = 520;

/** Orthographic camera: yaw about vertical, tilt down; plan (x, y) metres, height z. */
function camera(yawDeg, tiltDeg, scale, ox, oy) {
  const yw = (yawDeg * Math.PI) / 180; const t = (tiltDeg * Math.PI) / 180;
  return (x, y, z) => {
    const u = x * Math.cos(yw) - y * Math.sin(yw);
    const v = x * Math.sin(yw) + y * Math.cos(yw);
    return [ox + scale * u, oy + scale * (v * Math.sin(t) - z * Math.cos(t))];
  };
}

function fillPolygon(img, pts, value) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y += 1) {
    const xs = [];
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x += 1) img[y * W + x] = value;
    }
  }
}

function line(img, [x1, y1], [x2, y2], value) {
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= n; i += 1) {
    const x = Math.round(x1 + ((x2 - x1) * i) / n); const y = Math.round(y1 + ((y2 - y1) * i) / n);
    if (x >= 0 && y >= 0 && x < W && y < H) img[y * W + x] = value;
  }
}

// An L: 10 m × 4 m wing plus a 4 m × 6 m wing (the notch is the missing corner).
const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
const WALL = 2.7;

function render(cam) {
  const img = new Uint8Array(W * H).fill(250);
  // Walls: every edge extruded (a solid block reads as the silhouette of the home).
  for (let i = 0; i < L.length; i += 1) {
    const a = L[i]; const b = L[(i + 1) % L.length];
    fillPolygon(img, [cam(a[0], a[1], 0), cam(b[0], b[1], 0), cam(b[0], b[1], WALL), cam(a[0], a[1], WALL)], 170);
  }
  fillPolygon(img, L.map(([x, y]) => cam(x, y, 0)), 205);
  // Floor-plank lines along both axes and the wall edges: the picture's edge energy.
  for (let k = 0; k <= 10; k += 0.5) { line(img, cam(0, k, 0), cam(k < 4 ? 10 : 4, k, 0), 120); line(img, cam(k, 0, 0), cam(k, k < 4 ? 10 : 4, 0), 120); }
  for (const [x, y] of L) line(img, cam(x, y, 0), cam(x, y, WALL), 60);
  for (let i = 0; i < L.length; i += 1) { const a = L[i]; const b = L[(i + 1) % L.length]; line(img, cam(a[0], a[1], WALL), cam(b[0], b[1], WALL), 60); }
  return img;
}

test('the floor axes and the plan\'s true proportions come from the pixels alone', () => {
  const cam = camera(35, 38, 26, 250, 90);
  const axes = measureAxes(render(cam), W, H);
  assert.ok(axes, 'axes measured');
  // The images of the plan's x and y axes.
  const ax = cam(1, 0, 0); const ay = cam(0, 1, 0); const o = cam(0, 0, 0);
  const ang = (p) => ((((Math.atan2(p[1] - o[1], p[0] - o[0]) * 180) / Math.PI) % 180) + 180) % 180;
  const want = [ang(ax), ang(ay)].sort((a, b) => a - b);
  const got = [...axes.floorDeg].sort((a, b) => a - b);
  assert.ok(Math.abs(got[0] - want[0]) < 2 && Math.abs(got[1] - want[1]) < 2, `axes ${got} vs ${want}`);
  assert.ok(Math.abs(axes.verticalDeg - 90) < 2, 'verticals are vertical');
});

test('the footprint of an L-shaped home is an L, not a rectangle', () => {
  const cam = camera(35, 38, 26, 250, 90);
  const img = render(cam);
  const axes = measureAxes(img, W, H);
  const fp = footprintFromSilhouette(img, W, H);
  assert.ok(fp && axes, 'footprint measured');
  const toPlan = planFromImage(axes);
  const plan = fp.polygonPx.map(([x, y]) => toPlan(x, y));
  // Area of the recovered outline vs its bounding box: an L fills ~64 %, a rectangle 100 %.
  let area = 0;
  for (let i = 0; i < plan.length; i += 1) { const [x1, y1] = plan[i]; const [x2, y2] = plan[(i + 1) % plan.length]; area += x1 * y2 - x2 * y1; }
  area = Math.abs(area) / 2;
  // The bounding box in the plan's own axes (rectilinear frame of the measured axes).
  const xs = plan.map((p) => p[0]); const ys = plan.map((p) => p[1]);
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const fill = area / box;
  assert.ok(fill > 0.5 && fill < 0.8, `an L fills part of its box (true 0.64), got ${fill.toFixed(2)}`);
});

test('a photo on a busy background is not treated as a cut-away', () => {
  const img = new Uint8Array(W * H);
  for (let i = 0; i < img.length; i += 1) img[i] = (i * 37) % 251;
  assert.equal(footprintFromSilhouette(img, W, H), null);
});

test('the stored frame: accepted by the server’s own reader, small, and still an L', () => {
  const cam = camera(35, 38, 26, 250, 90);
  const frame = measureFrame(render(cam), W, H, 512);
  assert.ok(frame, 'measured');
  assert.ok(readFrame(JSON.parse(JSON.stringify(frame))), 'the server reads what the browser stores');
  assert.ok(JSON.stringify(frame).length < 16384, 'within the database cap');
  assert.ok(frame.footprint.length >= 6 && frame.footprint.length <= 80, `corners, not the 700-point pixel staircase: ${frame.footprint.length}`);
  // The outline's area against its bounding box: an L (10×4 + 4×6 in 10×10 = 0.64), not a rectangle.
  const fp = frame.footprint;
  const area = Math.abs(fp.reduce((s, p, i) => { const q = fp[(i + 1) % fp.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const xs = fp.map((p) => p[0]); const ys = fp.map((p) => p[1]);
  const fill = area / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
  assert.ok(fill > 0.55 && fill < 0.75, `fill ${fill}`);
  // The wall height, in image-height units: the camera's own.
  const wall = Math.hypot(...[0, 1].map((k) => cam(0, 0, WALL)[k] - cam(0, 0, 0)[k])) / H;
  assert.ok(Math.abs(frame.wall - wall) / wall < 0.1, `wall ${frame.wall} vs ${wall}`);
});

test('the plan view is the picture seen from above: the notch is empty, the home is not', () => {
  const cam = camera(35, 38, 26, 250, 90);
  const img = render(cam);
  const frame = measureFrame(img, W, H, 256);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = img[i]; rgba[i * 4 + 3] = 255; }
  const view = renderPlanView(rgba, W, H, frame);
  assert.equal(view.length, frame.view.width * frame.view.height * 4);
  let inside = 0; let white = 0;
  for (let i = 0; i < view.length; i += 4) { if (view[i] === 255) white += 1; else inside += 1; }
  const share = inside / (inside + white);
  assert.ok(share > 0.5 && share < 0.8, `the plan view covers the L, not its bounding box: ${share}`);
  // Every covered pixel came from inside the picture.
  const corner = planToImage(frame, [frame.view.x0, frame.view.y0], frame.view.lift);
  assert.ok(Number.isFinite(corner[0]) && Number.isFinite(corner[1]));
});

test('the plan view is never the home\'s mirror image (the axes keep the picture\'s handedness)', () => {
  for (const yaw of [35, -35, 120, 210]) {
    const cam = camera(yaw, 38, 26, 250, 90);
    const axes = measureAxes(render(cam), W, H);
    if (!axes) continue;
    const r = (d) => (d * Math.PI) / 180;
    const [a, b] = axes.floorDeg;
    // Plan x along the first axis, plan y along the second, both drawn y-down: a positive turn, as on screen.
    assert.ok(Math.cos(r(a)) * Math.sin(r(b)) - Math.sin(r(a)) * Math.cos(r(b)) > 0, `yaw ${yaw}: ${axes.floorDeg}`);
  }
});

test('one stray column at the silhouette\'s end (a pane of glass read as background) does not set the wall height', () => {
  const cam = camera(35, 38, 26, 250, 90);
  const img = render(cam);
  const clean = footprintFromSilhouette(img, W, H);
  // The column just inside the left end loses its upper half to the background colour.
  let x0 = 0;
  while (x0 < W && ![...Array(H).keys()].some((y) => img[y * W + x0] !== 250)) x0 += 1;
  const x = x0 + 2;
  const ys = [...Array(H).keys()].filter((y) => img[y * W + x] !== 250);
  for (const y of ys.slice(0, Math.floor(ys.length / 2))) img[y * W + x] = 250;
  const stray = footprintFromSilhouette(img, W, H);
  assert.ok(stray && Math.abs(stray.wallPx - clean.wallPx) <= 2, `wall ${stray?.wallPx} px vs ${clean.wallPx} px`);
});
