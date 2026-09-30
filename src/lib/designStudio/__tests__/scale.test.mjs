// ESTIMATED, CALIBRATED, VERIFIED — the truth state follows the evidence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonical, calibrate, estimateScale, rebaseDesign, scaleFromAnchor } from '../scale.ts';
import { emptyDesignState } from '../designState.ts';
import { oneBedroomDoc } from './fixtures.mjs';

const TRUE_SCALE = 0.01; // the fixture is 1 px = 1 cm
const noDecisions = { rejected: [], roomKinds: {} };

/** The fixture as a customer upload: no scale, nothing verified. */
function unscaled() {
  const d = oneBedroomDoc();
  const un = (e) => ({ ...e, state: 'UNVERIFIED' });
  return {
    ...d, detectedScale: null, scaleConfidence: 0, ceilingHeight: null, ceilingHeightSource: null,
    walls: d.walls.map(un), doors: d.doors.map(un), windows: d.windows.map(un),
    rooms: d.rooms.map((r) => ({ ...un(r), statedAreaM2: null })), balconies: [],
  };
}

test('no scale evidence and no anchor: no estimate, no geometry — ask instead', () => {
  const doc = { ...unscaled(), doors: [] };
  assert.equal(estimateScale(doc), null);
  assert.equal(calibrate(doc, noDecisions, [], null), null);
});

test('door symbols alone give a weak ESTIMATE with a wide uncertainty', () => {
  const doc = unscaled();
  const e = estimateScale(doc);
  assert.ok(e);
  assert.ok(e.uncertainty >= 0.15, `uncertainty ${e.uncertainty}`);
  assert.ok(Math.abs(e.metresPerPx - TRUE_SCALE) / TRUE_SCALE < 0.1, `door estimate ${e.metresPerPx}`);
  assert.equal(calibrate(doc, noDecisions, [], e).geometryState, 'ESTIMATED');
});

test('printed room areas and dimensions tighten the estimate', () => {
  const doc = { ...unscaled(), rooms: unscaled().rooms.map((r) => ({ ...r, statedAreaM2: r.id === 'r-living' ? 42 : r.id === 'r-bed' ? 16 : null })) };
  const e = estimateScale(doc, [{ valueM: 10, from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, confidence: 0.9 }]);
  assert.ok(Math.abs(e.metresPerPx - TRUE_SCALE) < 1e-9, `strong estimate ${e.metresPerPx}`);
  assert.ok(e.uncertainty <= 0.06);
});

test('calibration by the total area recovers the true scale — CALIBRATED', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [{ kind: 'TOTAL_AREA', valueM2: 70 }], estimateScale(doc));
  assert.equal(c.geometryState, 'CALIBRATED');
  assert.ok(Math.abs(c.metresPerPx - TRUE_SCALE) < 1e-9);
});

test('calibration by one known wall — CALIBRATED', () => {
  const doc = unscaled();
  assert.ok(Math.abs(scaleFromAnchor(doc, noDecisions, { kind: 'WALL_LENGTH', wallId: 'w-n', valueM: 10 }) - TRUE_SCALE) < 1e-12);
  assert.equal(calibrate(doc, noDecisions, [{ kind: 'WALL_LENGTH', wallId: 'w-n', valueM: 10 }], null).geometryState, 'CALIBRATED');
});

test('two agreeing anchors — VERIFIED', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [
    { kind: 'TOTAL_AREA', valueM2: 70 },
    { kind: 'WALL_LENGTH', wallId: 'w-w', valueM: 7.05 },
  ], null);
  assert.equal(c.geometryState, 'VERIFIED');
  assert.equal(c.conflict, false);
});

test('two anchors that disagree stay CALIBRATED and say so', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [
    { kind: 'TOTAL_AREA', valueM2: 70 },
    { kind: 'WALL_LENGTH', wallId: 'w-n', valueM: 12 },
  ], null);
  assert.equal(c.geometryState, 'CALIBRATED');
  assert.equal(c.conflict, true);
});

test('the kept reading builds deterministic geometry at the calibrated scale', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [{ kind: 'TOTAL_AREA', valueM2: 70 }], null);
  const r = buildCanonical(doc, noDecisions, c, 2.7);
  assert.equal(r.ok, true);
  assert.equal(r.canonical.geometryState, 'CALIBRATED');
  assert.equal(r.canonical.scene.floors.length, 4);
  assert.ok(Math.abs(r.canonical.scene.extent.width - 10) < 0.01);
  const again = buildCanonical(doc, noDecisions, c, 2.7);
  assert.deepEqual(again, r, 'not deterministic');
});

test('a misread element the customer rejected is not built; corrected room kinds are', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [{ kind: 'TOTAL_AREA', valueM2: 70 }], null);
  const r = buildCanonical(doc, { rejected: ['r-hall', 'win-bed'], roomKinds: { 'r-bath': 'WC' } }, c, 2.7);
  assert.equal(r.canonical.scene.floors.length, 3);
  assert.equal(r.canonical.scene.floors.find((f) => f.id === 'r-bath').kind, 'WC');
  assert.equal(r.canonical.scene.built.windows, 2);
});

test('a plan with no exterior walls left does not build, and says why', () => {
  const doc = unscaled();
  const c = calibrate(doc, noDecisions, [{ kind: 'TOTAL_AREA', valueM2: 70 }], null);
  const r = buildCanonical(doc, { rejected: ['w-n', 'w-e', 'w-s', 'w-w'], roomKinds: {} }, c, 2.7);
  assert.equal(r.ok, false);
  assert.ok(r.problems.includes('NO_EXTERIOR_WALLS'));
});

test('recalibration carries positions with the plan, not furniture sizes', () => {
  const s = { ...emptyDesignState(), objects: [{ instanceId: 'a', assetId: 'x', roomId: 'r', position: { x: 2, y: 0, z: 3 }, rotationY: 1, materialVariant: null, colorOverride: null, locked: false }] };
  const r = rebaseDesign(s, 1.1);
  assert.deepEqual(r.objects[0].position, { x: 2.2, y: 0, z: 3.3 });
  assert.equal(r.objects[0].rotationY, 1);
  assert.equal(rebaseDesign(s, 1), s);
});
