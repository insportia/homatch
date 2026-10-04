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
  anchorLock, CIRCULATION_MIN_M, CIRCULATION_PREFERRED_M, FIDELITY_CODES, feedbackOf, projectToImage, referenceCameraPose, referenceFidelity, visualVerdict,
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

test('TEST 4 — a reference-locked anchor that cannot stand is MISSING, never silently moved across the room', () => {
  // A locked wardrobe read onto the sofa's place: it has no safe place within its lock.
  const twin = shown('dev/wardrobe', 'WARDROBE', 3.1, 0.6, 0, ref('wardrobe-1', { locked: true, zone: 'STORAGE' }));
  const rooms = [roomOf('r-living', [...faithfulLiving(), twin])];
  const built = buildFrom(rooms);
  const entry = built.report.items.find((i) => i.refKey === 'wardrobe-1');
  assert.equal(entry.outcome, 'DROPPED');
  assert.equal(entry.reason, 'ANCHOR_NO_SAFE_PLACE');
  const report = judge(rooms, built);
  assert.equal(report.code, 'REFERENCE_OBJECT_MISSING');
  // The same piece unlocked is searched for room-wide and moved far (what used to happen to anchors).
  const loose = { ...twin, ref: { ...twin.ref, locked: false } };
  const free = buildFrom([roomOf('r-living', [...faithfulLiving(), loose])]).report.items.find((i) => i.refKey === 'wardrobe-1');
  assert.ok(free.outcome !== 'DROPPED' && free.movedM > anchorLock(living).maxShiftM, `unlocked: ${JSON.stringify(free)}`);
});

test('TEST 5 — a locked anchor proposed slightly into the wall is NUDGED within its lock (fidelity first, then safety)', () => {
  const items = faithfulLiving();
  items[0] = { ...items[0], pose: { x: 3, y: 0.35, rotationDeg: 0 } };
  const built = buildFrom([roomOf('r-living', items)]);
  const sofa = built.report.items.find((i) => i.refKey === 'sofa-1');
  assert.notEqual(sofa.outcome, 'DROPPED', JSON.stringify(sofa));
  assert.ok(sofa.movedM > 0 && sofa.movedM <= anchorLock(living).maxShiftM, `nudged ${sofa.movedM} m`);
});

test('TEST 6 — a piece migrated to another part of its room, or a furnished zone left empty: ZONE mismatch', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const tableId = built.report.items.find((i) => i.refKey === 'coffee_table-1').instanceId;
  const objects = built.state.objects.map((o) => (o.instanceId === tableId ? { ...o, position: { ...o.position, x: 5.2, z: 6.2 } } : o));
  const moved = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects, assets, aspect: ASPECT });
  assert.ok(moved.codes.includes('REFERENCE_ZONE_MISMATCH'), JSON.stringify(moved.findings));
  // The dining zone the picture shows, with nothing built in it.
  const dining = shown('dev/coffee-table', 'DINING_TABLE', 4.5, 5.5, 0, ref('dining_table-1', { importance: 'MAJOR', zone: 'DINING' }));
  const report = { ...built.report, items: [...built.report.items, { roomId: 'r-living', code: 'dev/coffee-table', type: 'DINING_TABLE', instanceId: null, outcome: 'DROPPED', reason: 'NO_SAFE_PLACE', movedM: null, warnings: [], refKey: 'dining_table-1' }] };
  const empty = referenceFidelity({ space, plan: { rooms: [roomOf('r-living', [...faithfulLiving(), dining])], reference: reference() }, build: report, objects: built.state.objects, assets, aspect: ASPECT });
  assert.ok(empty.findings.some((f) => f.code === 'REFERENCE_ZONE_MISMATCH' && /dining area is empty/.test(f.detail)), JSON.stringify(empty.findings));
});

test('TEST 7 — scale: an anchor built far from the size the picture shows, or a piece taking an unreal share of its room', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  const sofaId = built.report.items.find((i) => i.refKey === 'sofa-1').instanceId;
  const objects = built.state.objects.map((o) => (o.instanceId === sofaId ? { ...o, shape: { widthM: 1.2, depthM: 0.6, heightM: 0.8 } } : o));
  const small = referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects, assets, aspect: ASPECT });
  assert.ok(small.codes.includes('REFERENCE_SCALE_MISMATCH'), JSON.stringify(small.findings));
  const huge = built.state.objects.map((o) => (o.instanceId === sofaId ? { ...o, shape: { widthM: 6, depthM: 4, heightM: 0.8 } } : o));
  assert.ok(referenceFidelity({ space, plan: { rooms, reference: reference() }, build: built.report, objects: huge, assets, aspect: ASPECT }).codes.includes('REFERENCE_SCALE_MISMATCH'));
});

test('TEST 8 — camera: a picture not located in the plan, or a camera that does not see the pieces where the picture shows them', () => {
  const rooms = [roomOf('r-living', faithfulLiving())];
  const built = buildFrom(rooms);
  assert.equal(judge(rooms, built, { camera: null, cameraNote: 'OUTSIDE_ROOM' }).code, 'REFERENCE_CAMERA_MISMATCH');
  // Looking north instead of south: every piece is behind the camera.
  const wrong = judge(rooms, built, { camera: { ...camera, yawDeg: 0 } });
  assert.ok(wrong.codes.includes('REFERENCE_CAMERA_MISMATCH'), JSON.stringify(wrong.findings));
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

test('TEST 12 — the visual check fails only gross differences, and never on a missing answer', () => {
  const pass = visualVerdict({ errors: [{ code: 'wrongColor', severity: 'HIGH', confidence: 0.9 }], scores: { layout: 7, furniture: 6, overall: 6, dimensions: { placement: 7, camera: 7, scale: 6, inventory: 7 } } });
  assert.equal(pass.ok, true);
  const corner = visualVerdict({ errors: [], scores: { layout: 2, furniture: 5, overall: 3, dimensions: { placement: 2, camera: 6 } } });
  assert.equal(corner.code, 'REFERENCE_LAYOUT_MISMATCH');
  const missing = visualVerdict({ errors: Array.from({ length: 3 }, () => ({ code: 'objectMissing', severity: 'HIGH', confidence: 0.8 })), scores: { layout: 5, furniture: 2, overall: 4, dimensions: { inventory: 2 } } });
  assert.equal(missing.code, 'REFERENCE_OBJECT_MISSING');
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
