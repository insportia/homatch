// STEP INSIDE THIS IMAGE — the reference-fidelity gate and reference-locked
// anchors. A walkthrough of a picture is READY only when it is that picture:
// its anchors stand where the picture has them, its composition keeps its
// spread (furniture packed into a corner fails EVEN WHEN IT IS WALKABLE), no
// zone migrates or empties, sizes match, the camera locates the picture.
//
// Fixture (PLAN metres): living x 0–6, y 0–7 (its frame is the plan frame);
// bedroom x 6–10, y 3–7; bath x 6–8, y 0–3; hall x 8–10, y 0–3.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWalkthrough } from '../walkthrough/build.ts';
import {
  ANCHOR_FALLBACK_M, anchorLock, CIRCULATION_MIN_M, CIRCULATION_PREFERRED_M, FIDELITY_CODES, feedbackOf, projectToImage, referenceCameraPose, referenceFidelity, VISUAL_CAMERA_MIN, visualVerdict,
} from '../walkthrough/fidelity.ts';
import { retryableFailure } from '../walkthrough/lifecycle.ts';
import { emptyDesignState } from '../designState.ts';
import { buildSpaceModel } from '../space.ts';
import { COMFORT_RADIUS_M } from '../navigation.ts';
import { assetFromRow } from '../catalog.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';
import { assetRows as lPlanAssetRows, plan as lPlanPlan } from './fixtures/correctedLPlanWalk.mjs';

const space = buildSpaceModel(oneBedroomScene());
const assets = testAssets();
const materialsById = testMaterials();
const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
const lighting = { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 };
const living = space.rooms.find((r) => r.id === 'r-living');
const ASPECT = 1.5;
const camera = { frame: 'ROOM', roomId: 'r-living', x: 3, y: 6.6, heightM: 1.5, yawDeg: 180, pitchDeg: -15, fovDeg: 60, basis: 'STRONGLY_INFERRED', confidence: 0.7 };

const ref = (key, over = {}) => ({
  key, basis: 'OBSERVED', confidence: 0.9, importance: 'ANCHOR', locked: false, zone: 'SEATING', dims: null, sizeBasis: 'UNKNOWN', sizeNote: null, againstWall: null, ...over,
});
/** A planned piece the picture shows, its imagePx where the reference camera sees its proposed pose (a consistent reading). */
const shown = (code, type, x, y, rotationDeg, r) => {
  const imagePx = projectToImage(space, camera, { x: living.bounds.minX + x, y: living.bounds.minY + y }, ASPECT);
  return { code, type, pose: { x, y, rotationDeg }, scale: 1, color: null, origin: 'PLANNED', ref: { ...r, imagePx: r.imagePx === undefined ? imagePx : r.imagePx } };
};
const roomOf = (roomId, items) => ({ roomId, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items });
const reference = (over = {}) => ({ view: 'ROOM', roomId: 'r-living', visibleRoomIds: ['r-living'], camera, cameraNote: null, room: null, facts: {}, ...over });
/** The living room as the picture shows it: a sofa on the south wall facing north, a coffee table before it, a second sofa on the west wall. */
const faithfulLiving = () => [
  shown('dev/sofa-3', 'SOFA', 3, 0.6, 0, ref('sofa-1', { locked: true, dims: { widthM: 2.2, depthM: 0.95, heightM: 0.82 }, sizeBasis: 'OBSERVED' })),
  shown('dev/coffee-table', 'COFFEE_TABLE', 3, 1.95, 0, ref('coffee_table-1', { importance: 'MAJOR' })),
  shown('dev/sofa-2', 'SOFA', 0.55, 3.6, 270, ref('sofa-2', { locked: true })),
  shown('dev/rug-large', 'RUG', 3, 1.7, 0, ref('rug-1', { importance: 'DECOR', zone: 'DECOR' })),
];
const buildFrom = (rooms) => buildWalkthrough({
  space, base: emptyDesignState(), assets, materialsByCode, materialsById, idPrefix: 'walk-ref',
  plan: {
    lighting, palette: ['#f2eee6'], styleCode: 'contemporary',
    rooms: rooms.map((pr) => ({ ...pr, items: pr.items.map((it) => ({ ...it, refKey: it.ref?.key ?? null, lock: it.ref?.locked ? anchorLock(space.rooms.find((r) => r.id === pr.roomId)) : null })) })),
  },
});
const judge = (rooms, built, refOver = {}) => referenceFidelity({ space, plan: { rooms, reference: reference(refOver) }, build: built.report, objects: built.state.objects, assets, aspect: ASPECT });

test('circulation as the brief sets it: 0.9 m preferred, 0.8 m the hard minimum; the comfort walk keeps 0.7 m at least', () => {
  assert.equal(CIRCULATION_PREFERRED_M, 0.9);
  assert.equal(CIRCULATION_MIN_M, 0.8);
  assert.ok(COMFORT_RADIUS_M * 2 >= 0.7);
});

test('TEST 1 — a faithful reconstruction passes: anchors where the picture has them, walkable, the composition kept', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  assert.equal(built.report.gate.ok, true, JSON.stringify(built.report.gate));
  const sofa = built.report.items.find((i) => i.refKey === 'sofa-1');
  assert.equal(sofa.locked, true);
  assert.notEqual(sofa.outcome, 'DROPPED');
  assert.ok(sofa.movedM <= anchorLock(living).maxShiftM, `the anchor moved ${sofa.movedM} m`);
  const report = judge(rooms, built);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.metrics.anchors, 2);
  assert.equal(report.metrics.anchorsPresent, 2);
  assert.equal(report.metrics.objectRecall, 1);
  assert.ok(report.metrics.imageChecks >= 2 && report.metrics.imageError < 0.05, 'the plan seen from the reference camera lands where the picture shows it');
  assert.ok(report.score > 0.9);
});

test('TEST 2 (production regression) — everything compressed into a corner, the living area empty: FAILS even though it is walkable', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  // What production showed: the same pieces, all pushed into the north-east corner; the walk itself is fine.
  const corner = [{ x: 5.0, y: 6.4 }, { x: 5.3, y: 5.6 }, { x: 4.4, y: 6.3 }, { x: 5.2, y: 5.2 }];
  let k = 0;
  const objects = built.state.objects.map((o) => (o.roomId === 'r-living' ? { ...o, position: { ...o.position, x: corner[k % 4].x, z: corner[k++ % 4].y } } : o));
  const report = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects, assets, aspect: ASPECT });
  assert.equal(built.report.gate.ok, true, 'walkable');
  assert.equal(report.ok, false);
  assert.ok(report.codes.includes('REFERENCE_LAYOUT_MISMATCH'), JSON.stringify(report.findings));
  assert.ok(report.findings.some((f) => /packed/.test(f.detail)), 'the corner cluster is named');
  assert.ok(!report.codes.includes('NOT_WALKABLE'));
});

test('TEST 3 — the plan itself bunched into a corner while the picture spreads the pieces out: fails against the picture', () => {
  // The picture shows the pieces across the room (imagePx spread); the plan put them all in one corner.
  const spreadPx = [[0.15, 0.85], [0.5, 0.62], [0.88, 0.75], [0.5, 0.95]];
  const bunched = [[4.8, 0.6, 0], [4.9, 1.75, 0], [5.45, 2.9, 90], [4.9, 1.6, 0]];
  const items = faithfulLiving().map((it, i) => ({ ...it, pose: { x: bunched[i][0], y: bunched[i][1], rotationDeg: bunched[i][2] }, ref: { ...it.ref, imagePx: spreadPx[i] } }));
  const rooms = [roomOf('r-living', items)];
  const built = buildFrom(rooms);
  const report = judge(rooms, built);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'REFERENCE_LAYOUT_MISMATCH' && /bunch together/.test(f.detail)), JSON.stringify(report.findings));
});

test('TEST 4 — an anchor with no room at the picture\'s spot falls back in its OWN part of the room; one the room is defined by, missing, fails', () => {
  // A locked wardrobe read onto the sofa's place: no safe pose within its lock, so it takes the nearest clean place
  // in the same part of the room (never a room-wide search), and the walkthrough is still the picture.
  const twin = shown('dev/wardrobe', 'WARDROBE', 3.1, 0.6, 0, ref('wardrobe-1', { locked: true, zone: 'STORAGE' }));
  const rooms = [roomOf('r-living', [...faithfulLiving(), twin])];
  const built = buildFrom(rooms);
  const entry = built.report.items.find((i) => i.refKey === 'wardrobe-1');
  assert.notEqual(entry.outcome, 'DROPPED', JSON.stringify(entry));
  const reach = Math.max(ANCHOR_FALLBACK_M, 0.25 * Math.hypot(6, 7));
  assert.ok(entry.movedM > anchorLock(living).maxShiftM && entry.movedM <= reach + 1e-6, `fell back ${entry.movedM} m`);
  const obj = built.state.objects.find((o) => o.instanceId === entry.instanceId);
  const cell = (x, y) => [Math.floor((x / 6) * 3), Math.floor((y / 7) * 3)];
  const [c0, c1] = [cell(3.1, 0.6), cell(obj.position.x, obj.position.z)];
  assert.ok(Math.abs(c0[0] - c1[0]) <= 1 && Math.abs(c0[1] - c1[1]) <= 1, 'stays in its part of the room');
  const report = judge(rooms, built);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.warnings.some((w) => w.key === 'wardrobe-1'), 'the fallback is recorded');
  // The sofa the living room is defined by, missing: a failure.
  const sofaGone = { ...built.report, items: built.report.items.map((i) => (i.refKey === 'sofa-1' ? { ...i, outcome: 'DROPPED', reason: 'ANCHOR_NO_SAFE_PLACE', instanceId: null } : i)) };
  const objects = built.state.objects.filter((o) => o.instanceId !== built.report.items.find((i) => i.refKey === 'sofa-1').instanceId);
  const failed = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: sofaGone, objects, assets, aspect: ASPECT });
  assert.equal(failed.code, 'REFERENCE_OBJECT_MISSING');
  // One secondary anchor missing is recorded, not a failure.
  const tvGone = { ...built.report, items: built.report.items.map((i) => (i.refKey === 'wardrobe-1' ? { ...i, outcome: 'DROPPED', reason: 'ANCHOR_NO_SAFE_PLACE', instanceId: null } : i)) };
  const soft = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: tvGone, objects: built.state.objects.filter((o) => o.instanceId !== entry.instanceId), assets, aspect: ASPECT });
  assert.ok(!soft.codes.includes('REFERENCE_OBJECT_MISSING'), JSON.stringify(soft.findings));
  assert.ok(soft.warnings.some((w) => w.code === 'REFERENCE_OBJECT_MISSING' && w.key === 'wardrobe-1'));
});

test('TEST 5 — a locked anchor proposed slightly into the wall is NUDGED within its lock (fidelity first, then safety)', () => {
  const items = faithfulLiving();
  items[0] = { ...items[0], pose: { x: 3, y: 0.35, rotationDeg: 0 } };
  const built = buildFrom([roomOf('r-living', items)]);
  const sofa = built.report.items.find((i) => i.refKey === 'sofa-1');
  assert.notEqual(sofa.outcome, 'DROPPED', JSON.stringify(sofa));
  assert.ok(sofa.movedM > 0 && sofa.movedM <= anchorLock(living).maxShiftM, `nudged ${sofa.movedM} m`);
});

test('TEST 6 — an anchor migrated to another part of its room fails; a minor piece moved or a zone left empty is recorded', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const sofa2 = built.report.items.find((i) => i.refKey === 'sofa-2').instanceId;
  const objects = built.state.objects.map((o) => (o.instanceId === sofa2 ? { ...o, position: { ...o.position, x: 5.2, z: 0.6 } } : o));
  const moved = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects, assets, aspect: ASPECT });
  assert.ok(moved.codes.includes('REFERENCE_ZONE_MISMATCH'), JSON.stringify(moved.findings));
  const tableId = built.report.items.find((i) => i.refKey === 'coffee_table-1').instanceId;
  const minor = built.state.objects.map((o) => (o.instanceId === tableId ? { ...o, position: { ...o.position, x: 5.2, z: 6.2 } } : o));
  const soft = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects: minor, assets, aspect: ASPECT });
  assert.ok(!soft.codes.includes('REFERENCE_ZONE_MISMATCH'));
  assert.ok(soft.warnings.some((w) => w.code === 'REFERENCE_ZONE_MISMATCH' && w.key === 'coffee_table-1'));
  // The dining zone the picture shows, with nothing built in it: recorded.
  const dining = shown('dev/coffee-table', 'DINING_TABLE', 4.5, 5.5, 0, ref('dining_table-1', { importance: 'MAJOR', zone: 'DINING' }));
  const report = { ...built.report, items: [...built.report.items, { roomId: 'r-living', code: 'dev/coffee-table', type: 'DINING_TABLE', instanceId: null, outcome: 'DROPPED', reason: 'NO_SAFE_PLACE', movedM: null, warnings: [], refKey: 'dining_table-1' }] };
  const empty = referenceFidelity({ space, plan: { rooms: [roomOf('r-living', [...faithfulLiving(), dining])], reference: reference() }, build: report, objects: built.state.objects, assets, aspect: ASPECT });
  assert.ok(empty.warnings.some((f) => f.code === 'REFERENCE_ZONE_MISMATCH' && /dining area is empty/.test(f.detail)), JSON.stringify(empty.warnings));
});

test('TEST 7 — scale: half (or twice) the size the picture shows, or an unreal share of the room, fails; the catalogue\'s nearest size is recorded', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const sofaId = built.report.items.find((i) => i.refKey === 'sofa-1').instanceId;
  const withShape = (shape) => built.state.objects.map((o) => (o.instanceId === sofaId ? { ...o, shape } : o));
  const judgeObjects = (objects) => referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects, assets, aspect: ASPECT });
  const near = judgeObjects(withShape({ widthM: 1.4, depthM: 0.8, heightM: 0.8 }));
  assert.ok(!near.codes.includes('REFERENCE_SCALE_MISMATCH'));
  assert.ok(near.warnings.some((w) => w.code === 'REFERENCE_SCALE_MISMATCH'));
  assert.ok(judgeObjects(withShape({ widthM: 0.9, depthM: 0.6, heightM: 0.8 })).codes.includes('REFERENCE_SCALE_MISMATCH'));
  assert.ok(judgeObjects(withShape({ widthM: 6, depthM: 4, heightM: 0.8 })).codes.includes('REFERENCE_SCALE_MISMATCH'));
});

test('TEST 8 — the camera is HOMATCH\'s own estimate: a picture it could not locate, or a camera that is off, is recorded, never a failure on its own', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const lost = judge(rooms, built, { camera: null, cameraNote: 'OUTSIDE_ROOM' });
  assert.equal(lost.ok, true);
  assert.ok(lost.warnings.some((w) => w.code === 'REFERENCE_CAMERA_MISMATCH'));
  // Looking north instead of south: every piece is behind the camera.
  const wrong = judge(rooms, built, { camera: { ...camera, yawDeg: 0 } });
  assert.equal(wrong.ok, true, JSON.stringify(wrong.findings));
  assert.ok(wrong.warnings.some((w) => w.code === 'REFERENCE_CAMERA_MISMATCH'));
});

test('TEST 9 — safety stays first: an unwalkable build is NOT_WALKABLE before anything else; balance is judged in the pictured rooms', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const blocked = { ...built.report, gate: { ok: false, unreachable: ['r-bed'], traps: [], crowded: ['r-living'], missingEssential: [], spawnValid: true } };
  const r = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: blocked, objects: built.state.objects, assets, aspect: ASPECT });
  assert.equal(r.code, 'NOT_WALKABLE');
  assert.ok(r.codes.includes('OVERFURNISHED'));
  assert.deepEqual(FIDELITY_CODES.slice(0, 1), ['NOT_WALKABLE']);
  const bare = { ...built.report, gate: { ...built.report.gate, missingEssential: ['r-living'] } };
  assert.ok(referenceFidelity({ space, plan: { rooms, reference: reference() }, build: bare, objects: built.state.objects, assets, aspect: ASPECT }).codes.includes('UNDERFURNISHED'));
});

test('TEST 10 — the replan is told what failed in HOMATCH\'s own words: codes, room ids, keys and numbers only', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const r = judge(rooms, built, { camera: null, cameraNote: 'OUTSIDE_ROOM' });
  const fb = feedbackOf(r);
  // Warnings are told too (the replan may fix them), after the failures.
  assert.ok(fb.length >= 1 && fb.length <= 12);
  assert.match(fb[0], /^REFERENCE_CAMERA_MISMATCH in room r-living: /);
});

test('TEST 11 — the reference camera for the factory\'s QA render: three.js pose, moved off a piece; a dollhouse sees cut walls', () => {
  const pose = referenceCameraPose(space, camera, ASPECT);
  assert.deepEqual(pose.position, [3, 1.5, -6.6]);
  assert.ok(pose.target[2] > pose.position[2], 'looks south (three.js +z)');
  assert.equal(pose.cut, null);
  const moved = referenceCameraPose(space, camera, ASPECT, () => ({ x: 3, y: 6.2 }));
  assert.equal(moved.moved, 0.4);
  const doll = referenceCameraPose(space, { ...camera, frame: 'HOME', roomId: null, x: 5, y: -6, heightM: 14, pitchDeg: -50, yawDeg: 0 }, ASPECT);
  assert.deepEqual(doll.cut, { exteriorM: 1.2, interiorM: 1.2 });
  assert.equal(doll.position[1], 14);
});

test('TEST 12 — the visual check fails only gross differences seen from the same viewpoint; from a wrong one it is UNRELIABLE, never a failure', () => {
  const pass = visualVerdict({ errors: [{ code: 'wrongColor', severity: 'HIGH', confidence: 0.9 }], scores: { layout: 7, furniture: 6, overall: 6, dimensions: { placement: 7, camera: 7, scale: 6, inventory: 7 } } });
  assert.equal(pass.ok, true);
  assert.equal(pass.reliable, true);
  const corner = visualVerdict({ errors: [], scores: { layout: 2, furniture: 5, overall: 3, dimensions: { placement: 2, camera: 6 } } });
  assert.equal(corner.code, 'REFERENCE_LAYOUT_MISMATCH');
  const missing = visualVerdict({ errors: Array.from({ length: 3 }, () => ({ code: 'objectMissing', severity: 'HIGH', confidence: 0.8 })), scores: { layout: 5, furniture: 2, overall: 4, dimensions: { inventory: 2, camera: 7 } } });
  assert.equal(missing.code, 'REFERENCE_OBJECT_MISSING');
  // Production, walkthrough abaa98de: built, every piece attached, then judged from HOMATCH's estimated camera
  // (camera 2/10). Not the same view: recorded, not a failure.
  const prod = visualVerdict({
    errors: [...Array(3).fill({ code: 'wrongScale', severity: 'MEDIUM', confidence: 0.7 }), { code: 'wrongCamera', severity: 'HIGH', confidence: 0.9 }, ...Array(4).fill({ code: 'wrongObject', severity: 'MEDIUM', confidence: 0.7 }), ...Array(2).fill({ code: 'wrongPosition', severity: 'MEDIUM', confidence: 0.7 })],
    scores: { layout: 4, furniture: 4, overall: 4, dimensions: { camera: 2, placement: 4, scale: 4, inventory: 5 } },
  });
  assert.equal(prod.ok, true);
  assert.equal(prod.reliable, false);
  assert.equal(visualVerdict({ errors: [], scores: { layout: 1, furniture: 1, overall: 1, dimensions: { camera: 1, placement: 1 } } }).ok, true);
  assert.equal(VISUAL_CAMERA_MIN, 5);
});

test('TEST 13 — failures unlike the picture are retryable (a new plan, told what failed); an unwalkable design is not', () => {
  for (const c of ['REFERENCE_LAYOUT_MISMATCH', 'REFERENCE_OBJECT_MISSING', 'REFERENCE_SCALE_MISMATCH', 'REFERENCE_ZONE_MISMATCH', 'REFERENCE_CAMERA_MISMATCH', 'OVERFURNISHED', 'UNDERFURNISHED']) assert.equal(retryableFailure(c), true, c);
  assert.equal(retryableFailure('NOT_WALKABLE'), false);
  assert.equal(retryableFailure('REFERENCE_NOT_FOUND'), false);
});

test('TEST 14 — the route: the picture reaches the model, its hash keys the plan, a plan for another picture is never reused, a failure is never READY', () => {
  const route = readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(route, /const loaded = row\.render_id \? await loadReference\(admin, row\) : null;/);
  assert.match(route, /referenceImageSha256: await sha256Hex\(bytes\)/);
  assert.match(route, /referenceSceneRequest\(MODEL, input, refInput\)/);
  assert.match(route, /ds-walk-plan:v2:\$\{provenance\.referenceImageSha256\}/);
  assert.match(route, /\(w\?\.timings\?\.reference\?\.referenceImageSha256 \?\? null\) === \(provenance\?\.referenceImageSha256 \?\? null\)/);
  // One replan at most, in its own invocation, then the failure stands.
  assert.match(route, /if \(fidelity && !replan && row\.plan_attempts < MAX_PLAN_ATTEMPTS\)/);
  // The QA render uses the reference camera; the visual check reads the picture back and proves it by its hash.
  assert.match(route, /outputs: \{ render: !!camera, scene: false, objects: true \}/);
  assert.match(route, /await sha256Hex\(src\.bytes\) !== prov\.referenceImageSha256/);
  assert.match(route, /if \(visual\?\.summary\.state === 'FAILED' && visual\.summary\.code\) \{\n    await fail\(/);
  assert.match(route, /state: !verdict\.reliable \? 'UNRELIABLE' : verdict\.ok \? 'PASSED' : 'FAILED'/);
  // A retry of a visual-check failure judges the kept build again (no new plan, no new GPU pass).
  assert.match(route, /const visualOnly = row\.plan_report\?\.visualQa\?\.state === 'FAILED'/);
  assert.match(route, /\} else if \(visualOnly\) \{\n[^\n]*\n    if \(job\?\.state === 'COMPLETED'\) Object\.assign\(patch, \{ state: 'PROCESSING_RESULT', result_attempts: 0 \}\);/);
  // Never a key in what the page sees.
  assert.doesNotMatch(route.slice(route.indexOf('function publicOf'), route.indexOf('// ── Lineage')), /timings\?\.reference|apiKey|OPENAI/);
});

test('TEST 15 — speed: a fully locked build of the real corrected plan stays inside the edge CPU budget', () => {
  const lScene = JSON.parse(readFileSync(new URL('./fixtures/correctedLPlanScene.json', import.meta.url), 'utf8'));
  const lSpace = buildSpaceModel(lScene);
  const lAssets = new Map(lPlanAssetRows.map((r) => { const a = assetFromRow(r); return [a.code, a]; }));
  const none = new Map();
  const locked = {
    ...lPlanPlan,
    rooms: lPlanPlan.rooms.map((pr) => ({ ...pr, items: pr.items.map((it, i) => ({ ...it, refKey: `p-${i}`, lock: it.pose ? anchorLock(lSpace.rooms.find((r) => r.id === pr.roomId)) : null })) })),
  };
  const t0 = performance.now();
  const { report } = buildWalkthrough({ space: lSpace, base: emptyDesignState(), plan: locked, assets: lAssets, materialsByCode: none, materialsById: none, idPrefix: 'walk-l' });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
  assert.ok(report.items.length > 0);
});

test('TEST 16 (production regression, walkthrough abaa98de) — a dollhouse picture of an estimated space: a camera 40% off and one secondary anchor without a place do not fail a walkable, faithful build', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const tv = { roomId: 'r-living', code: 'dev/wardrobe', type: 'MEDIA', instanceId: null, outcome: 'DROPPED', reason: 'PLACEMENT_BLOCKED', movedM: null, warnings: [], refKey: 'media-1', locked: true };
  const media = shown('dev/wardrobe', 'MEDIA', 3, 6.6, 180, ref('media-1', { locked: true, zone: 'MEDIA' }));
  const plan = {
    rooms: [roomOf('r-living', [...faithfulLiving(), media])],
    reference: reference({ view: 'MASTER', roomId: null, visibleRoomIds: ['r-living', 'r-bed', 'r-bath'], camera: { ...camera, frame: 'HOME', roomId: null, x: 5, y: -6, heightM: 14, pitchDeg: -50, yawDeg: 90 } }),
  };
  const report = referenceFidelity({ space, plan, build: { ...built.report, items: [...built.report.items, tv] }, objects: built.state.objects, assets, aspect: ASPECT });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.warnings.length >= 1, 'what was off is recorded');
  // The production failure itself still fails: the same build packed into a corner.
  const corner = [{ x: 5.0, y: 6.4 }, { x: 5.3, y: 5.6 }, { x: 4.4, y: 6.3 }, { x: 5.2, y: 5.2 }];
  let k = 0;
  const packed = built.state.objects.map((o) => (o.roomId === 'r-living' ? { ...o, position: { ...o.position, x: corner[k % 4].x, z: corner[k++ % 4].y } } : o));
  assert.equal(referenceFidelity({ space, plan, build: built.report, objects: packed, assets, aspect: ASPECT }).code, 'REFERENCE_LAYOUT_MISMATCH');
});
