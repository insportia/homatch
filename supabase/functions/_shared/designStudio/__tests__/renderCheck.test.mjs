// The structure check on synthetic pictures: the same picture is accepted, a
// moved wall is refused, a recolour inside a target's own mask is accepted.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_DEFAULTS, checkEdit, checkFinish, compositeInsideMask, edgeAgreement, edgeMap, maskFromIds, resizeGray,
} from '../renderCheck.ts';

const W = 320; const H = 240;
const WALL = '#ff0000'; const FLOOR = '#00ff00'; const SOFA = '#0000ff'; const BACK = '#202020';

/** A room: a wall band on the left, a floor below a horizon, a sofa block. Returns grey + id image. */
function scene({ wallEdge = 110, sofaGrey = 40, sofaX = 180, noise = 0 } = {}) {
  const gray = new Uint8Array(W * H); const ids = new Uint8Array(W * H * 3);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const put = (i, hex) => { const c = parseInt(hex.slice(1), 16); ids[i * 3] = c >> 16; ids[i * 3 + 1] = (c >> 8) & 255; ids[i * 3 + 2] = c & 255; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    let g; let id;
    if (x >= sofaX && x < sofaX + 80 && y >= 140 && y < 200) { g = sofaGrey; id = SOFA; }
    else if (x < wallEdge) { g = 90; id = WALL; }
    else if (y >= 120) { g = 170; id = FLOOR; }
    else { g = 220; id = BACK; }
    gray[i] = Math.max(0, Math.min(255, Math.round(g + (rnd() - 0.5) * 2 * noise)));
    put(i, id);
  }
  return { gray: { width: W, height: H, data: gray }, ids: { width: W, height: H, data: ids, channels: 3 } };
}

const coverage = (ids, hex) => { const m = maskFromIds(ids, hex, 0); return m.pixels / (W * H); };
const targets = (ids) => [WALL, FLOOR, SOFA, BACK].map((c, k) => ({ color: c, id: ['wall:w-1', 'floor:r-1', 'sofa-1', 'other'][k], kind: ['WALL', 'FLOOR', 'OBJECT', 'OTHER'][k], coverage: coverage(ids, c) }));

test('the same picture is accepted with full agreement', () => {
  const s = scene();
  const r = checkFinish(s.gray, s.gray, { ids: s.ids, targets: targets(s.ids) });
  assert.equal(r.accepted, true, r.reason ?? '');
  assert.equal(r.edgeAgreement, 1);
  assert.equal(r.maskAgreement, 1);
});

test('a finish that only adds texture and shifts brightness is accepted', () => {
  const base = scene();
  const finished = scene({ noise: 6 });
  for (let i = 0; i < finished.gray.data.length; i += 1) finished.gray.data[i] = Math.min(255, finished.gray.data[i] + 10);
  const r = checkFinish(base.gray, finished.gray, { ids: base.ids, targets: targets(base.ids) });
  assert.equal(r.accepted, true, `${r.reason} ${r.edgeAgreement} ${r.maskAgreement}`);
});

test('a moved wall is refused', () => {
  const base = scene();
  const moved = scene({ wallEdge: 150 });
  const r = checkFinish(base.gray, moved.gray, { ids: base.ids, targets: targets(base.ids) });
  assert.equal(r.accepted, false);
  assert.ok(r.reason, 'a reason is given');
});

test('a moved sofa alone is refused (one moved piece is enough)', () => {
  const base = scene();
  const moved = scene({ sofaX: 230 });
  const r = checkFinish(base.gray, moved.gray, { ids: base.ids, targets: targets(base.ids) });
  assert.equal(r.accepted, false);
});

test('a reframed picture (different aspect) is refused before anything else', () => {
  const s = scene();
  const crop = resizeGray(s.gray, 320, 180);
  const r = checkFinish(s.gray, crop, null);
  assert.deepEqual([r.accepted, r.reason], [false, 'FRAMING_CHANGED']);
});

test('a larger finished picture of the same aspect is compared at the working size', () => {
  const s = scene();
  const big = resizeGray(s.gray, 640, 480);
  assert.equal(checkFinish(s.gray, big, { ids: s.ids, targets: targets(s.ids) }).accepted, true);
});

test('recolouring inside the sofa mask is accepted as an edit and as a finish', () => {
  const base = scene();
  const recoloured = scene({ sofaGrey: 120 });
  const mask = maskFromIds(base.ids, SOFA, 2);
  assert.ok(mask.pixels > 80 * 60, 'dilated mask is larger than the sofa');
  const edit = checkEdit(base.gray, recoloured.gray, mask);
  assert.equal(edit.accepted, true, `${edit.reason} ${edit.meanOutsideDiff}`);
  assert.equal(edit.meanOutsideDiff, 0);
  const finish = checkFinish(base.gray, recoloured.gray, { ids: base.ids, targets: targets(base.ids) });
  assert.equal(finish.accepted, true, `${finish.reason}`);
});

test('an edit that changed the picture outside its mask is refused', () => {
  const base = scene();
  const drifted = scene({ sofaGrey: 120, wallEdge: 150 });
  const r = checkEdit(base.gray, drifted.gray, maskFromIds(base.ids, SOFA, 2));
  assert.equal(r.accepted, false);
  assert.match(String(r.reason), /OUTSIDE/);
});

test('an edit whose whole picture is brighter outside the mask is refused', () => {
  const base = scene();
  const after = scene({ sofaGrey: 120 });
  for (let i = 0; i < after.gray.data.length; i += 1) after.gray.data[i] = Math.min(255, after.gray.data[i] + 30);
  assert.equal(checkEdit(base.gray, after.gray, maskFromIds(base.ids, SOFA, 2)).reason, 'OUTSIDE_CHANGED');
});

test('an unknown target colour gives an empty mask, and a mask over everything cannot be checked', () => {
  const base = scene();
  assert.equal(maskFromIds(base.ids, '#123456', 2).pixels, 0);
  const all = { width: W, height: H, data: new Uint8Array(W * H).fill(1) };
  assert.equal(checkEdit(base.gray, base.gray, all).reason, 'MASK_COVERS_PICTURE');
});

test('compositing keeps every pixel outside the mask exactly', () => {
  const rgb = (v) => ({ width: 4, height: 2, channels: 3, data: new Uint8Array(24).fill(v) });
  const mask = { width: 4, height: 2, data: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 1]) };
  const out = compositeInsideMask(rgb(10), rgb(200), mask);
  assert.deepEqual([...out.data.subarray(0, 6)], [10, 10, 10, 200, 200, 200]);
  assert.deepEqual([...out.data.subarray(21, 24)], [200, 200, 200]);
  assert.equal(out.data[6], 10);
});

test('edge agreement: identical maps agree fully; disjoint far maps do not', () => {
  const s = scene();
  const g = resizeGray(s.gray, 256, 192);
  const e = edgeMap(g, CHECK_DEFAULTS.edgeThreshold);
  assert.equal(edgeAgreement(e, e, 256, 192, 2, 2).f, 1);
  const empty = new Uint8Array(e.length);
  assert.equal(edgeAgreement(e, empty, 256, 192, 2, 2).f, 0);
});
