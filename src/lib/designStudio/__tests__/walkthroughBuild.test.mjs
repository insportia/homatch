// THE 3D WALKTHROUGH: the design HOMATCH builds from a validated scene plan,
// and the server-owned lifecycle that gets it to READY without a page.
//
// Fixture in PLAN metres: living x 0–6, y 0–7; bedroom x 6–10, y 3–7; bath
// x 6–8, y 0–3; hall x 8–10, y 0–3. Doors on the x = 6 wall at y = 5.0
// (bedroom) and y = 1.5 (bath).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWalkthrough, reachableRooms, roomSketches } from '../walkthrough/build.ts';
import {
  decidePoll, identityText, LEASE_MS, MAX_ATTEMPTS, MAX_PLAN_ATTEMPTS, MAX_RESULT_ATTEMPTS, MAX_SUBMIT_ATTEMPTS, nextStep, progressOf,
  PROVIDER_DEADLINE_MS, readProviderStatus,
} from '../walkthrough/lifecycle.ts';
import { emptyDesignState } from '../designState.ts';
import { buildWalkModel } from '../navigation.ts';
import { evaluatePlacement, footprint, obbCorners } from '../placement.ts';
import { shapedAsset } from '../objectShape.ts';
import { buildSpaceModel, pointInPolygon } from '../space.ts';
import { compileSceneSpec } from '../hybrid/compileSpec.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const assets = testAssets();
const materialsById = testMaterials();
const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
const lighting = { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 };

const room = (roomId, over = {}) => ({
  roomId, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items: [], ...over,
});
const item = (code, pose, over = {}) => ({ code, type: 'X', pose, scale: 1, color: null, origin: pose ? 'PLANNED' : 'PROGRAMME', ...over });
const build = (rooms, over = {}) => buildWalkthrough({
  space, base: emptyDesignState(), plan: { lighting, palette: ['#f2eee6', '#232323'], styleCode: 'contemporary', rooms, ...over },
  assets, materialsByCode, materialsById, idPrefix: 'walk-t',
});
const living = space.rooms.find((r) => r.id === 'r-living');

// ── Spatial validation ──────────────────────────────────────────────────────

test('a clean planned pose is kept exactly (room frame → plan)', () => {
  const { state, report } = build([room('r-living', { items: [item('dev/coffee-table', { x: 3, y: 3.5, rotationDeg: 0 })] })]);
  assert.equal(report.items[0].outcome, 'PLANNED');
  const o = state.objects[0];
  assert.equal(o.position.x, living.bounds.minX + 3);
  assert.equal(o.position.z, living.bounds.minY + 3.5);
  assert.equal(o.rotationY, 0);
});

test('every placed piece is inside its room, through no wall, blocks no door and overlaps nothing', () => {
  const { state, report } = build([
    room('r-living', { items: [
      item('dev/sofa-3', { x: 0.5, y: 3.5, rotationDeg: 270 }),
      item('dev/coffee-table', { x: 1.6, y: 3.5, rotationDeg: 90 }),
      item('dev/rug-large', { x: 1.6, y: 3.5, rotationDeg: 90 }),
      item('dev/sofa-2', { x: 5.5, y: 5.0, rotationDeg: 90 }), // in front of the bedroom door: must move
    ] }),
    room('r-bed', { items: [item('dev/bed-double', { x: 2, y: 1.2, rotationDeg: 0 }), item('dev/wardrobe', null)] }),
  ]);
  assert.ok(state.objects.length >= 5, JSON.stringify(report.items));
  for (const o of state.objects) {
    const a = shapedAsset(assets.get(o.assetId), o);
    const issues = evaluatePlacement({ space, assets, objects: state.objects }, a, { x: o.position.x, y: o.position.z }, o.rotationY, o.roomId, o.instanceId)
      .filter((i) => i.code !== 'TIGHT_ACCESS');
    assert.deepEqual(issues, [], `${o.assetId} ${JSON.stringify(issues)}`);
    const r = space.rooms.find((x) => x.id === o.roomId);
    for (const c of obbCorners(footprint(a, { x: o.position.x, y: o.position.z }, o.rotationY))) assert.ok(pointInPolygon(c, r.polygon), `${o.assetId} corner outside`);
  }
  assert.notEqual(report.items.find((i) => i.code === 'dev/sofa-2').outcome, 'PLANNED');
});

test('a pose through a wall is corrected to the nearest clean one, and the move is reported', () => {
  const { state, report } = build([room('r-living', { items: [item('dev/sofa-3', { x: 0.0, y: 3.5, rotationDeg: 270 })] })]);
  const r = report.items[0];
  assert.equal(r.outcome, 'CORRECTED');
  assert.ok(r.movedM > 0 && r.movedM < 1.5, String(r.movedM));
  assert.ok(['THROUGH_WALL', 'OUTSIDE_ROOM'].includes(r.reason), r.reason);
  assert.equal(state.objects.length, 1);
});

test('two pieces asked for the same spot never overlap: the second moves or is dropped', () => {
  const { state } = build([room('r-living', { items: [
    item('dev/coffee-table', { x: 3, y: 3.5, rotationDeg: 0 }),
    item('dev/coffee-table', { x: 3, y: 3.5, rotationDeg: 0 }),
  ] })]);
  const [a, b] = state.objects;
  assert.ok(a && b);
  assert.notDeepEqual([a.position.x, a.position.z], [b.position.x, b.position.z]);
});

test('a piece with no safe place anywhere is dropped and reported, never forced in', () => {
  const { state, report } = build([room('r-bath', { items: [item('dev/sofa-xl', { x: 1, y: 1.5, rotationDeg: 0 })] })]);
  assert.equal(state.objects.length, 0);
  assert.equal(report.items[0].outcome, 'DROPPED');
  assert.equal(report.items[0].reason, 'NO_SAFE_PLACE');
});

test('a room programme piece without a pose is placed by the engine', () => {
  const { report } = build([room('r-bed', { items: [item('dev/bed-double', null)] })]);
  assert.equal(report.items[0].outcome, 'PLACED');
});

test('scale is carried as the piece\'s shape and it is collided at that size', () => {
  const { state } = build([room('r-living', { items: [item('dev/coffee-table', { x: 3, y: 3.5, rotationDeg: 0 }, { scale: 1.1 })] })]);
  assert.equal(state.objects[0].shape.widthM, 1.21);
});

test('circulation: furnishing never cuts a reachable room off', () => {
  const before = reachableRooms(space, buildWalkModel(space, [], assets));
  for (const id of ['r-living', 'r-bed', 'r-bath', 'r-hall']) assert.ok(before.has(id), `${id} not reachable on the empty plan: ${[...before]}`);
  const { state, report } = build([
    room('r-living', { items: [item('dev/sofa-3', { x: 0.5, y: 3.5, rotationDeg: 270 }), item('dev/coffee-table', { x: 1.6, y: 3.5, rotationDeg: 90 })] }),
    room('r-bed', { items: [item('dev/bed-double', { x: 2, y: 1.2, rotationDeg: 0 }), item('dev/wardrobe', null)] }),
    room('r-hall', { items: [item('dev/wardrobe', null)] }),
  ]);
  const after = reachableRooms(space, buildWalkModel(space, state.objects, assets));
  for (const id of before) assert.ok(after.has(id), `${id} cut off: ${JSON.stringify(report.circulation)}`);
});

test('finishes: floor material, wall colour with one accent wall, ceiling, lighting', () => {
  const sketch = roomSketches(space).find((r) => r.id === 'r-bed');
  const accentId = sketch.walls[0].surfaceId;
  const { state, report } = build([room('r-bed', {
    floorMaterial: 'm-oak', wallColor: '#f2eee6', accent: { surfaceId: accentId, color: '#3f4348' }, ceilingColor: '#fbfbf9',
  })]);
  assert.equal(state.surfaces['floor:r-bed'].materialId, 'm-oak');
  assert.equal(state.surfaces[accentId].color, '#3f4348');
  const others = Object.entries(state.surfaces).filter(([id]) => id.startsWith('wall:') && id.endsWith(':r-bed') && id !== accentId);
  assert.ok(others.length >= 3 && others.every(([, s]) => s.color === '#f2eee6'), JSON.stringify(others));
  assert.equal(state.surfaces['ceiling:r-bed'].color, '#fbfbf9');
  assert.ok(report.finishes.every((f) => f.applied), JSON.stringify(report.finishes));
  assert.equal(state.lighting.timeOfDay, 'DAY');
  assert.equal(state.styleCode, 'contemporary');
});

test('an accent on another room\'s wall is never painted', () => {
  const other = roomSketches(space).find((r) => r.id === 'r-living').walls[0].surfaceId;
  const { state } = build([room('r-bed', { wallColor: '#f2eee6', accent: { surfaceId: other, color: '#3f4348' } })]);
  assert.notEqual(state.surfaces[other]?.color, '#3f4348');
});

test('the floor plan is never touched: the compiled walls, openings and rooms are the source plan\'s', () => {
  const { state } = build([room('r-living', { items: [item('dev/sofa-3', { x: 0.5, y: 3.5, rotationDeg: 270 })] })]);
  const compile = (s) => compileSceneSpec({ space, state: s, assets, materials: materialsById, source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, camera: null, outputs: { render: false, scene: false, objects: true } });
  const a = compile(emptyDesignState()); const b = compile(state);
  assert.deepEqual(b.walls.map((w) => [w.id, w.start, w.end, w.openings]), a.walls.map((w) => [w.id, w.start, w.end, w.openings]));
  assert.deepEqual(b.rooms.map((r) => [r.id, r.polygon]), a.rooms.map((r) => [r.id, r.polygon]));
  assert.ok(b.objects.length === 1);
});

test('the same plan on the same design builds the same design, byte for byte', () => {
  const rooms = [room('r-living', { items: [item('dev/sofa-3', { x: 0.0, y: 3.5, rotationDeg: 270 }), item('dev/rug-large', { x: 1.6, y: 3.5, rotationDeg: 90 })] })];
  assert.equal(JSON.stringify(build(rooms).state), JSON.stringify(build(rooms).state));
});

test('room sketches are in each room\'s own frame with its doors, windows and wall faces', () => {
  const s = roomSketches(space).find((r) => r.id === 'r-living');
  assert.equal(s.widthM, 6); assert.equal(s.depthM, 7);
  assert.ok(s.doors.length >= 2 && s.windows.length >= 2, JSON.stringify(s));
  assert.ok(s.walls.length >= 4 && s.walls.every((w) => ['N', 'E', 'S', 'W'].includes(w.facing)));
  assert.ok(s.polygon.every(([x, y]) => x >= 0 && y >= 0 && x <= 6.001 && y <= 7.001));
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-03T12:00:00Z');
const row = (over = {}) => ({
  state: 'QUEUED', attempts: 0, plan_attempts: 0, submit_attempts: 0, result_attempts: 0, lease_at: null, next_check_at: null,
  deadline_at: null, scene_plan: null, walk_version_id: null, factory_job_id: null, provider_job_id: null, ...over,
});
const iso = (ms) => new Date(ms).toISOString();

test('a leased row is never worked on twice at once; a lapsed lease is taken over', () => {
  assert.deepEqual(nextStep(row({ lease_at: iso(NOW - 1000) }), NOW), { kind: 'WAIT', reason: 'LEASED' });
  assert.deepEqual(nextStep(row({ lease_at: iso(NOW - LEASE_MS - 1) }), NOW), { kind: 'PLAN' });
});

test('steps follow the saved work: plan → submit → poll → process; a saved plan is never asked for again', () => {
  assert.equal(nextStep(row(), NOW).kind, 'PLAN');
  assert.equal(nextStep(row({ state: 'PLANNING', scene_plan: {}, walk_version_id: 'v' }), NOW).kind, 'SUBMIT');
  assert.equal(nextStep(row({ state: 'PLANNING', scene_plan: {}, walk_version_id: 'v', factory_job_id: 'f' }), NOW).kind, 'POLL');
  assert.equal(nextStep(row({ state: 'RUNNING', factory_job_id: 'f' }), NOW).kind, 'POLL');
  assert.equal(nextStep(row({ state: 'PROCESSING_RESULT', factory_job_id: 'f' }), NOW).kind, 'PROCESS');
  assert.deepEqual(nextStep(row({ state: 'READY' }), NOW), { kind: 'WAIT', reason: 'TERMINAL' });
});

test('bounded retries: plan, submit, result processing and the overall backstop', () => {
  assert.deepEqual(nextStep(row({ plan_attempts: MAX_PLAN_ATTEMPTS }), NOW), { kind: 'FAIL', code: 'PLAN_FAILED' });
  assert.deepEqual(nextStep(row({ state: 'SUBMITTED', submit_attempts: MAX_SUBMIT_ATTEMPTS }), NOW), { kind: 'FAIL', code: 'SUBMIT_FAILED' });
  assert.deepEqual(nextStep(row({ state: 'PROCESSING_RESULT', factory_job_id: 'f', result_attempts: MAX_RESULT_ATTEMPTS }), NOW), { kind: 'FAIL', code: 'RESULT_PROCESSING_FAILED' });
  assert.deepEqual(nextStep(row({ state: 'RUNNING', factory_job_id: 'f', attempts: MAX_ATTEMPTS }), NOW), { kind: 'FAIL', code: 'TOO_MANY_ATTEMPTS' });
});

test('a row is not worked before it is due, unless a driver forces it', () => {
  assert.deepEqual(nextStep(row({ state: 'RUNNING', factory_job_id: 'f', next_check_at: iso(NOW + 5000) }), NOW), { kind: 'WAIT', reason: 'NOT_DUE' });
  assert.equal(nextStep(row({ state: 'RUNNING', factory_job_id: 'f', next_check_at: iso(NOW + 5000) }), NOW, { force: true }).kind, 'POLL');
});

test('provider statuses: running keeps polling; completed processes; never RUNNING forever', () => {
  const live = { submit_attempts: 1, deadline_at: iso(NOW + 60_000) };
  assert.deepEqual(decidePoll(live, { kind: 'QUEUED' }, NOW), { kind: 'CONTINUE', state: 'SUBMITTED', stage: null, nextInMs: 20_000 });
  assert.equal(decidePoll(live, { kind: 'RUNNING', stage: 'FURNISHING' }, NOW).stage, 'FURNISHING');
  assert.deepEqual(decidePoll(live, { kind: 'COMPLETED' }, NOW), { kind: 'PROCESS' });
  const late = { submit_attempts: 1, deadline_at: iso(NOW - 1) };
  assert.deepEqual(decidePoll(late, { kind: 'RUNNING', stage: null }, NOW), { kind: 'FAIL', code: 'PROVIDER_TIMEOUT', cancelProvider: true });
});

test('an unknown provider answer is asked again until the deadline, then recorded truthfully', () => {
  const live = { submit_attempts: 1, deadline_at: iso(NOW + 60_000) };
  assert.equal(decidePoll(live, { kind: 'UNKNOWN', httpStatus: 404 }, NOW).kind, 'CONTINUE');
  const late = { submit_attempts: 1, deadline_at: iso(NOW - 1) };
  assert.deepEqual(decidePoll(late, { kind: 'UNKNOWN', httpStatus: 404 }, NOW), { kind: 'FAIL', code: 'PROVIDER_LOST', cancelProvider: false });
  assert.deepEqual(decidePoll(late, { kind: 'UNKNOWN', httpStatus: null }, NOW), { kind: 'FAIL', code: 'PROVIDER_UNREACHABLE', cancelProvider: true });
});

test('a provider failure resubmits only when the infrastructure failed and attempts remain', () => {
  assert.deepEqual(decidePoll({ submit_attempts: 1, deadline_at: null }, { kind: 'FAILED', status: 'TIMED_OUT', error: null }, NOW), { kind: 'RESUBMIT', reason: 'PROVIDER_TIMED_OUT' });
  assert.equal(decidePoll({ submit_attempts: MAX_SUBMIT_ATTEMPTS, deadline_at: null }, { kind: 'FAILED', status: 'TIMED_OUT', error: null }, NOW).kind, 'FAIL');
  assert.equal(decidePoll({ submit_attempts: 1, deadline_at: null }, { kind: 'FAILED', status: 'FAILED', error: 'BAD_SPEC' }, NOW).kind, 'FAIL');
});

test('RunPod answers are read strictly (a worker that reported failure is not a result)', () => {
  const stages = new Set(['FURNISHING']);
  assert.deepEqual(readProviderStatus(200, { status: 'IN_QUEUE' }, stages), { kind: 'QUEUED' });
  assert.deepEqual(readProviderStatus(200, { status: 'IN_PROGRESS', output: { stage: 'FURNISHING' } }, stages), { kind: 'RUNNING', stage: 'FURNISHING' });
  assert.deepEqual(readProviderStatus(200, { status: 'IN_PROGRESS', output: { stage: 'rm -rf' } }, stages), { kind: 'RUNNING', stage: null });
  assert.deepEqual(readProviderStatus(200, { status: 'COMPLETED', output: { ok: true } }, stages), { kind: 'COMPLETED' });
  assert.equal(readProviderStatus(200, { status: 'COMPLETED', output: { ok: false, error: 'x' } }, stages).kind, 'FAILED');
  assert.deepEqual(readProviderStatus(404, null, stages), { kind: 'UNKNOWN', httpStatus: 404 });
  assert.deepEqual(readProviderStatus(null, null, stages), { kind: 'UNKNOWN', httpStatus: null });
});

test('identity: the same design at the same state is the same walkthrough; a new one only on request', () => {
  const a = identityText({ projectId: 'p', designVersionId: 'v', designRevision: 3, revision: 1 });
  assert.equal(a, identityText({ projectId: 'p', designVersionId: 'v', designRevision: 3, revision: 1 }));
  assert.notEqual(a, identityText({ projectId: 'p', designVersionId: 'v', designRevision: 3, revision: 2 }));
  assert.notEqual(a, identityText({ projectId: 'p', designVersionId: 'v', designRevision: 4, revision: 1 }));
});

test('progress is the real server state, never a percentage', () => {
  assert.deepEqual(['QUEUED', 'PLANNING', 'SUBMITTED', 'RUNNING', 'PROCESSING_RESULT', 'READY', 'FAILED', 'CANCELLED'].map(progressOf),
    ['PLANNING', 'PLANNING', 'BUILDING', 'BUILDING', 'FINISHING', 'READY', 'FAILED', 'CANCELLED']);
  assert.ok(PROVIDER_DEADLINE_MS >= 30 * 60_000);
});

// ── A real one-staircase plan (production 2026-10-03), read with two phantom flights ──

import { readFileSync } from 'node:fs';
import { credibleStairs } from '../space.ts';

const realScene = JSON.parse(readFileSync(new URL('./fixtures/oneStairPlanScene.json', import.meta.url), 'utf8'));

test('a "flight" filling a bedroom is a misreading: the real staircase stays, the phantom ones go', () => {
  const real = buildSpaceModel(realScene);
  assert.deepEqual(real.stairs.map((s) => s.id), ['s1']);
  // The rule itself: a flight that fills a lived-in room goes; one in its own compartment, or partly in a living room, stays.
  const rooms = [{ kind: 'BEDROOM', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] }, { kind: 'LIVING', polygon: [{ x: 4, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 5 }, { x: 4, y: 5 }] }];
  const flight = (id, poly) => ({ id, a: poly[0], b: poly[1], runM: 3, riseM: 2.7, treads: 12, direction: 'UP', polygon: poly });
  const kept = credibleStairs([
    flight('fills-bed', [{ x: 0.1, y: 0.1 }, { x: 3.9, y: 0.1 }, { x: 3.9, y: 2.9 }, { x: 0.1, y: 2.9 }]),
    flight('in-living', [{ x: 7, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 3 }, { x: 7, y: 3 }]),
    flight('own-space', [{ x: 10, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 3 }, { x: 10, y: 3 }]),
  ], rooms);
  assert.deepEqual(kept.map((s) => s.id), ['in-living', 'own-space']);
});

test('the real plan furnishes both bedrooms, keeps every room reachable, and builds fast enough for an edge step', () => {
  const real = buildSpaceModel(realScene);
  const plan = [
    room('r1', { items: [item('dev/sofa-3', { x: 3.0, y: 3.0, rotationDeg: 90 }), item('dev/coffee-table', { x: 2.0, y: 3.0, rotationDeg: 90 }), item('dev/rug-large', { x: 2.2, y: 3.0, rotationDeg: 90 })] }),
    room('r2', { items: [item('dev/bed-double', { x: 1.6, y: 3.2, rotationDeg: 180 }), item('dev/wardrobe', null)] }),
    room('r3', { items: [item('dev/bed-double', { x: 1.5, y: 3.2, rotationDeg: 180 })] }),
    room('r4', { items: [item('dev/kitchen-run', null)] }),
  ];
  const t0 = performance.now();
  const { state, report } = buildWalkthrough({ space: real, base: emptyDesignState(), plan: { lighting, palette: [], styleCode: null, rooms: plan }, assets, materialsByCode, materialsById, idPrefix: 'walk-r' });
  const ms = performance.now() - t0;
  const beds = state.objects.filter((o) => o.assetId === 'dev/bed-double').map((o) => o.roomId).sort();
  assert.deepEqual(beds, ['r2', 'r3'], JSON.stringify(report.items));
  const before = reachableRooms(real, buildWalkModel(real, [], assets));
  const after = reachableRooms(real, buildWalkModel(real, state.objects, assets));
  for (const id of before) assert.ok(after.has(id), `${id} cut off`);
  // This reading joined the two bedroom doors into one door between the bedrooms (the drawing has one from each
  // bedroom to the living room): the walkthrough walks the plan as read, and never cuts off what it could reach.
  for (const id of ['r1', 'r4']) assert.ok(before.has(id), `${id} not reachable on the bare plan: ${[...before]}`);
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
});

import { validateSceneSpec } from '../hybrid/sceneSpec.ts';
import { retryableFailure } from '../walkthrough/lifecycle.ts';

test('the real plan compiles to a spec the factory accepts (an opening read past its wall stays on the wall)', () => {
  const real = buildSpaceModel(realScene);
  const compile = () => compileSceneSpec({ space: real, state: emptyDesignState(), assets, materials: materialsById, source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, camera: null, outputs: { render: false, scene: false, objects: true } });
  const spec = compile();
  assert.doesNotThrow(() => validateSceneSpec(JSON.parse(JSON.stringify(spec))));
  const d1 = spec.walls.find((w) => w.id === 'w7').openings.find((o) => o.id === 'd1');
  assert.ok(d1.offsetM >= d1.widthM / 2 && Math.abs(d1.offsetM - 0.4163) < 0.1, JSON.stringify(d1));
  // A valid opening is untouched.
  const d3 = spec.walls.find((w) => w.id === 'w14').openings.find((o) => o.id === 'd3');
  assert.deepEqual([d3.offsetM, d3.widthM], [2.893, 0.954]);
});

test('a refused spec is HOMATCH\'s failure: the customer may try again once it is fixed', () => {
  assert.equal(retryableFailure('BAD_SPEC_walls[5].openings[0].offsetM'), true);
  assert.equal(retryableFailure('PROVIDER_LOST'), true);
  assert.equal(retryableFailure('NO_SPACE_MODEL'), false);
  assert.equal(retryableFailure(null), false);
});

import { roomShot } from '../cameraDirector.ts';

test('a room jump into the notched living room of the real plan faces open space, not a wall', () => {
  const real = buildSpaceModel(realScene);
  const model = buildWalkModel(real, [], assets);
  const shot = roomShot(real, model, 'r1');
  assert.ok(shot);
  const ahead = Math.hypot(shot.target.x - shot.position.x, shot.target.y - shot.position.y) / 0.6;
  assert.ok(ahead >= 2, `sees ${ahead.toFixed(2)} m ahead`);
});
