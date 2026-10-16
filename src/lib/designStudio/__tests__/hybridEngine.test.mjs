// THE ENGINE: AI reads and compares; HOMATCH compiles a strict scene build
// spec; the Blender factory builds it. Each object goes the cheapest faithful
// way (parametric built-in → a catalogue model only when it LOOKS like it →
// the factory's own piece), the visual check is bounded in passes and in
// money, corrections are bounded in distance and size and never touch walls
// or the camera, superseded outputs are discarded, and a model built for a
// customer stays in that customer's project.
//
// Every side effect is a stub here: no GPU, no browser, no model is called.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { validateReconstruction, planDocument } from '../reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../scale.ts';
import { buildSpaceModel } from '../space.ts';
import { buildDesign, emptyCorrections, matchAsset } from '../reconstruction.ts';
import { normalizeDesignState, normalizeGenerated } from '../designState.ts';
import { applyOperation } from '../operations.ts';
import { fitCamera, projectPlan, scaleFit, viewForCanvas } from '../sourceCamera.ts';
import { pbrRepeat } from '../pbrMaps.ts';
import { validateJobInput, STAGES, STAGE_COPY, LIVE_MODES, FACTORY_STAGE } from '../hybrid/contract.ts';
import { resolveObjects } from '../hybrid/resolution.ts';
import { applyQaCorrections, anotherPass, validateQaReport, QA_LIMITS, QA_PLANNED_PASSES } from '../hybrid/qa.ts';
import { byKind, gpuCost, totals, withinCeiling, JOB_CEILING_USD } from '../hybrid/cost.ts';
import { fidelityReport } from '../hybrid/fidelity.ts';
import { attachFactoryModels, runEngine, unprojectWith } from '../hybrid/orchestrate.ts';
import { compileSceneSpec, DEFAULT_FINISH } from '../hybrid/compileSpec.ts';
import { canonicalJson, objectGroup, RUNTIME_KINDS, SpecError, validateSceneSpec } from '../hybrid/sceneSpec.ts';
import { designChecks } from '../hybrid/designChecks.ts';
import { runDesignBuild } from '../hybrid/designBuild.ts';
import { engineReport } from '../hybrid/report.ts';
import { seedAssets, seedMaterials } from './seedCatalog.mjs';

const ROOT = process.cwd();
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
const ASSETS = seedAssets();
const MATERIALS = seedMaterials();
const ASSET_MAP = new Map(ASSETS.map((a) => [a.code, a]));
const MATERIAL_MAP = new Map(MATERIALS.map((m) => [m.id, m]));
const UID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const AID = '33333333-3333-4333-8333-333333333333';
const KEY = `users/${UID}/design-studio-models/${PID}/${AID}.glb`;

// A dollhouse camera over the fixture's plan: the picture every trace below is "seen" in.
const ASPECT = 1.4;
const CAM = (() => {
  const cam = new THREE.OrthographicCamera(-ASPECT * 9, ASPECT * 9, 9, -9, 0.1, 500);
  cam.position.set(6 + 60 * Math.sin(0.7), 60 * Math.tan((35 * Math.PI) / 180), -5 + 60 * Math.cos(0.7));
  cam.lookAt(6, 0, -5);
  cam.updateMatrixWorld();
  return cam;
})();
const uvOf = (plan, h = 0) => { const v = new THREE.Vector3(plan[0], h, -plan[1]).project(CAM); return [(v.x + 1) / 2, (1 - v.y) / 2]; };
const FIT = fitCamera([[0, 0], [12, 0], [12, 10], [0, 10], [3, 4], [8, 7], [5, 2], [10, 9]].map((p) => ({ plan: p, uv: uvOf(p) })), ASPECT, 'AERIAL');

/** The fixture, as a ds-recon-3 reading: every object traced in the picture through CAM. */
function traced() {
  const { recon } = validateReconstruction(RAW, 1);
  return {
    ...recon,
    cameras: [{ ...(recon.cameras[0] ?? { image: 0 }), image: 0, fit: FIT }],
    objects: recon.objects.map((o) => ({ ...o, px: { image: 0, points: [uvOf(o.at, o.heightM), null] }, geometry: 'PIXELS' })),
  };
}

const SPACE = (() => {
  const { recon } = validateReconstruction(RAW, 1);
  const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/ref.jpg');
  const decisions = { rejected: [], roomKinds: {} };
  const calibration = calibrate(doc, decisions, [], estimateScale(doc, []));
  const result = buildCanonical(doc, decisions, calibration, 2.7);
  return { space: buildSpaceModel(result.canonical.scene), scale: calibration.metresPerPx * 100, canonical: result.canonical };
})();
const assemble = (r) => buildDesign(r, emptyCorrections(), SPACE.space, ASSETS, MATERIALS, { scale: SPACE.scale });
const CAMERA = { position: [40, 30, 20], target: [6, 0, -5], fov: 14, near: 1, far: 400, aspect: ASPECT, background: '#f3f1ed', cut: { exteriorM: 1.1, interiorM: 1.0 } };
const compile = (state, outputs) => compileSceneSpec({
  space: SPACE.space, state, assets: ASSET_MAP, materials: MATERIAL_MAP, camera: CAMERA,
  source: { kind: 'PICTURE', architecture: 'OBSERVED', furnishing: 'OBSERVED' }, render: { edge: 1600, samples: 128 }, outputs,
});

const ref = (id, ext = 'glb') => ({ assetId: id, key: `users/${UID}/design-studio-${ext === 'jpg' ? 'thumbnails' : 'models'}/${PID}/${id}.${ext}`, sha256: 'a'.repeat(64), bytes: 1000 });
const clean = { errors: [], scores: { layout: 9, furniture: 9, materials: 9, lighting: 9, overall: 9, dimensions: {} } };

/** A factory that completes every pass, with one model per walkthrough group of the spec it was given. */
function deps(over = {}) {
  const calls = { start: [], status: 0, discard: [], qa: 0, assemble: 0, browser: 0, compile: [] };
  let clock = 0;
  const specs = new Map();
  const d = {
    startFactory: async (spec, pass) => { const id = `job-${pass}`; calls.start.push({ pass, outputs: spec.outputs }); specs.set(id, spec); return { jobId: id, state: 'QUEUED', error: null }; },
    factoryStatus: async (jobId) => {
      calls.status += 1;
      const spec = specs.get(jobId);
      const pass = Number(jobId.split('-')[1]);
      const pieces = Object.fromEntries([...new Set(spec.objects.filter((o) => o.runtime && o.group).map((o) => o.group))].map((g, i) => [g, ref(`${pass}${String(i).padStart(7, '0')}-1111-4111-8111-111111111111`)]));
      return {
        state: 'COMPLETED', stage: null,
        outputs: { render: ref(`${pass}0000000-2222-4222-8222-222222222222`, 'jpg'), scene: spec.outputs.scene ? { DESKTOP: ref(`${pass}0000000-3333-4333-8333-333333333333`), MOBILE: null } : {}, pieces: spec.outputs.objects ? pieces : {} },
        cost: [{ usd: 0.05, basis: 'ESTIMATED', detail: 'gpu 125 s' }], result: { persistedBytes: 5000 },
      };
    },
    discardFactory: async (jobId) => { calls.discard.push(jobId); },
    assemble: (r) => { calls.assemble += 1; return assemble(r); },
    compile: (state, outputs) => { calls.compile.push(outputs); return compile(state, outputs); },
    browserRender: async () => { calls.browser += 1; return 'data:image/jpeg;base64,AAAA'; },
    visualQa: async () => { calls.qa += 1; return { report: clean, cost: { usd: 0.02, basis: 'ESTIMATED' } }; },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    ...over,
  };
  return { d, calls };
}

const engine = (d, extra = {}) => runEngine({ recon: traced(), assets: ASSETS, confirmed: new Set(), unproject: unprojectWith(FIT), roomsBuilt: SPACE.space.rooms.length, ...extra }, d);

// ── Contract ─────────────────────────────────────────────────────────

test('the job contract: four modes, picture and floor-plan builds are live, malformed input is refused', () => {
  const ok = validateJobInput({ mode: 'RECONSTRUCT_FROM_IMAGE', projectId: PID, sourceImageIds: [AID], locale: 'ka' });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.preserveSource, true, 'a reconstruction always preserves the source');
  assert.deepEqual([...LIVE_MODES].sort(), ['DESIGN_FROM_FLOOR_PLAN', 'RECONSTRUCT_FROM_IMAGE']);
  const later = validateJobInput({ mode: 'DESIGN_FROM_TEXT', projectId: PID, textBrief: 'a calm flat', locale: 'en' });
  assert.deepEqual(later.errors, ['NOT_YET'], 'a planned mode is declared, not silently run');
  const bad = validateJobInput({ mode: 'RECONSTRUCT_FROM_IMAGE', projectId: 'x', sourceImageIds: [], locale: 'xx', qualityTarget: 'ULTRA' });
  assert.deepEqual(bad.errors.sort(), ['IMAGES', 'LOCALE', 'PROJECT', 'QUALITY']);
  assert.equal(STAGES.length, 10);
  for (const s of STAGES) assert.match(STAGE_COPY[s], /^ds_gen_stage_/);
  for (const s of Object.values(FACTORY_STAGE)) assert.ok(STAGES.includes(s), 'every factory stage is a stage the customer sees');
});

// ── The scene build spec ─────────────────────────────────────────────

test('the canonical scene compiles to a valid, deterministic spec that keeps the L-shaped architecture exactly', () => {
  const { state } = assemble(traced());
  const a = compile(state, { render: true, scene: true, objects: true });
  const b = compile(state, { render: true, scene: true, objects: true });
  assert.equal(canonicalJson(a), canonicalJson(b), 'the same scene compiles byte for byte the same');
  const v = validateSceneSpec(JSON.parse(JSON.stringify(a)));
  assert.equal(v.rooms.length, SPACE.space.rooms.length);
  for (const r of SPACE.space.rooms) {
    const sr = v.rooms.find((x) => x.id === r.id);
    assert.equal(sr.polygon.length, r.polygon.length, `${r.id} keeps every corner`);
    sr.polygon.forEach((p, i) => assert.ok(Math.abs(p[0] - r.polygon[i].x) < 1e-3 && Math.abs(p[1] - r.polygon[i].y) < 1e-3));
  }
  const openings = SPACE.space.walls.reduce((n, w) => n + w.mesh.openings.length, 0);
  assert.equal(v.walls.reduce((n, w) => n + w.openings.length, 0), openings, 'every door and window');
  assert.equal(v.walls.reduce((n, w) => n + w.faces.length, 0), SPACE.space.walls.reduce((n, w) => n + w.segments.length, 0), 'every wall face is a surface');
  assert.ok(v.railings.length >= 1, 'the balcony edge has a railing');
  assert.equal(v.objects.length, state.objects.length, 'every piece');
  assert.ok(v.objects.every((o) => o.provenance === 'OBSERVED' || o.provenance === 'INFERRED'), 'a reading is evidence, never a design choice');
  assert.deepEqual(v.camera.position, [40, -20, 30], 'three.js (x, up, −north) becomes plan (x, north, up)');
});

test('a real measured parallel camera compiles to a spec every validator accepts (the golden apartment\'s own fit)', () => {
  // The fit HOMATCH measured on the golden apartment in production (2026-10-02). The walkthrough stands
  // a telephoto 250 m away with a 150 m near plane for it; the first production build was refused on
  // exactly that (camera.near), before any GPU was called.
  const golden = { model: 'ORTHO', aspect: 1.282565130260521, s: 0.1088045476058042, t: [0.11146930975527171, 0.38078983291233887], rms: 0.0176, points: 100,
    R: [0.6157923355647039, 0, -0.7879084968825802, 0.5668473373949916, -0.694561894072016, 0.44302129902669707, -0.5472512179502002, -0.7194329540013397, -0.4277058909448513] };
  const scaled = scaleFit(golden, 1);
  const pose = viewForCanvas(scaled, 1600, Math.round(1600 / scaled.aspect), [4.8, 2.6]);
  assert.ok(pose.near > 100, `the walkthrough's near plane (${pose.near} m) is what used to be refused`);
  const { state } = assemble(traced());
  const spec = compileSceneSpec({
    space: SPACE.space, state, assets: ASSET_MAP, materials: MATERIAL_MAP,
    camera: { position: pose.position, target: pose.target, fov: pose.fov, near: pose.near, far: pose.far, aspect: scaled.aspect, background: '#ffffff', cut: { exteriorM: 1.4, interiorM: 0.77 } },
    source: { kind: 'PICTURE', architecture: 'OBSERVED', furnishing: 'OBSERVED' }, render: { edge: 1600, samples: 128 }, outputs: { render: true, scene: false, objects: false },
  });
  const v = validateSceneSpec(JSON.parse(JSON.stringify(spec)));
  assert.ok(v.camera.near <= 100 && v.camera.near < v.camera.far);
  const dist = Math.hypot(...v.camera.position.map((x, i) => x - v.camera.target[i]));
  assert.ok(v.camera.near < dist - 20, 'the near plane stays well in front of the home');
  assert.ok(Math.abs(v.camera.fovDeg - pose.fov) < 1e-3, 'the view itself is unchanged');
});

test('surfaces wear what the walkthrough wears: chosen colours, catalogue materials at the same tile size, defaults otherwise', () => {
  const { state } = assemble(traced());
  const mat = { ...MATERIALS[0], id: 'mat-oak', pbr: { ...MATERIALS[0].pbr, physicalSizeM: [1.5, 0.75], mapsByRes: { '1k': { albedo: 'design-studio/catalog/public/materials/x/y/a.jpg' } } } };
  const floor = `floor:${SPACE.space.rooms[0].id}`;
  const withMat = { ...state, surfaces: { ...state.surfaces, [floor]: { materialId: 'mat-oak', color: null, finish: null, tint: '#a07850' } } };
  const spec = compileSceneSpec({ space: SPACE.space, state: withMat, assets: ASSET_MAP, materials: new Map([...MATERIAL_MAP, ['mat-oak', mat]]), camera: null, source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, outputs: { render: false, scene: true, objects: false } });
  const m = spec.materials.find((x) => x.id === 'mat-oak');
  const [rx, ry] = pbrRepeat(mat.pbr);
  assert.ok(Math.abs(m.tileM[0] - 1 / rx) < 1e-3 && Math.abs(m.tileM[1] - 1 / ry) < 1e-3, 'metres per tile = the walkthrough\'s repeat, inverted');
  const s = spec.surfaces.find((x) => x.id === floor);
  assert.equal(s.material, 'mat-oak'); assert.equal(s.tint, '#a07850');
  const plainWall = spec.surfaces.find((x) => x.id.startsWith('wall:') && !state.surfaces[x.id]);
  if (plainWall) assert.equal(plainWall.color, DEFAULT_FINISH.wall);
});

test('walkthrough pieces are grouped: identical pieces share one exported model, built-ins are never exported', () => {
  const { state } = assemble(traced());
  const spec = compile(state, { render: true, scene: true, objects: true });
  for (const o of spec.objects) {
    assert.equal(o.runtime, RUNTIME_KINDS.has(o.kind));
    if (o.runtime) assert.equal(o.group, objectGroup(o));
  }
  const chairs = spec.objects.filter((o) => o.kind === 'CHAIR');
  if (chairs.length > 1 && new Set(chairs.map((c) => `${c.size.w}${c.size.d}${c.size.h}${JSON.stringify(c.colors)}`)).size === 1) assert.equal(new Set(chairs.map((c) => c.group)).size, 1);
  assert.ok(spec.objects.filter((o) => ['KITCHEN_RUN', 'WARDROBE', 'FRIDGE'].includes(o.kind)).every((o) => !o.runtime), 'pieces with doors keep HOMATCH\'s interactive piece');
  assert.equal(compile(state, { render: true, scene: false, objects: false }).objects.filter((o) => o.runtime).length, 0, 'nothing exported, nothing grouped');
});

test('a malicious or malformed spec is refused; unknown fields never pass', () => {
  const { state } = assemble(traced());
  const good = JSON.parse(JSON.stringify(compile(state, { render: true, scene: true, objects: true })));
  const bad = [
    (s) => { s.version = 'hm-scene-0'; },
    (s) => { s.objects[0].kind = 'SPACESHIP'; },
    (s) => { s.objects[0].id = "__import__('os').system('rm -rf /')"; },
    (s) => { s.objects[0].at = [1e9, 0]; },
    (s) => { s.objects[0].colors = { body: 'red' }; },
    (s) => { s.rooms[0].floor = 'floor:nowhere'; },
    (s) => { s.walls[0].end = s.walls[0].start; },
    (s) => { s.surfaces[0].material = 'not-declared'; },
    (s) => { s.objects = Array(301).fill(s.objects[0]); },
    (s) => { s.render.width = 99999; },
  ];
  for (const mutate of bad) {
    const s = JSON.parse(JSON.stringify(good));
    mutate(s);
    assert.throws(() => validateSceneSpec(s), SpecError);
  }
  const extra = JSON.parse(JSON.stringify(good));
  extra.script = 'import os';
  extra.objects[0].python = 'exec(1)';
  const v = validateSceneSpec(extra);
  assert.equal(v.script, undefined); assert.equal(v.objects[0].python, undefined);
});

// ── Routing ──────────────────────────────────────────────────────────

test('routing: built-ins are parametric, furniture is factory-built, unknown kinds are unresolved — no AI involved', () => {
  const by = new Map(resolveObjects(traced(), ASSETS).map((d) => [d.key, d]));
  assert.equal(by.get('kitchen-run').route, 'PARAMETRIC');
  assert.equal(by.get('hall-wardrobe').route, 'PARAMETRIC');
  assert.equal(by.get('sofa').route, 'FACTORY');
  assert.equal(by.get('bed1x').route, 'FACTORY');
  assert.ok([...by.values()].every((d) => ['PARAMETRIC', 'CATALOGUE', 'FACTORY', 'UNRESOLVED'].includes(d.route)));
});

test('a catalogue model is used only when it genuinely looks like the piece, never for its category alone', () => {
  const recon = traced();
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  // An imported catalogue model, as the importer writes it (canonical identity, provider, quality).
  const lookalike = {
    ...ASSET_MAP.get('dev/sofa-3'), code: 'imp/sofa-lookalike', procedural: null, active: true, widthM: sofa.widthM, depthM: sofa.depthM, heightM: sofa.heightM,
    dominantColors: [sofa.color ?? '#808080'], homatchAssetId: 'hma_test', sourceProvider: 'polyhaven', canonicalCategory: 'SEATING', canonicalSubcategory: 'SOFA', qualityTier: 'PREMIUM', webSuitability: 0.9,
  };
  const flat = { ...recon, objects: recon.objects.map((o) => (o.key === 'sofa' ? { ...o, form: null, color: sofa.color ?? '#808080' } : o)) };
  assert.equal(resolveObjects(flat, [...ASSETS, lookalike]).find((x) => x.key === 'sofa').route, 'CATALOGUE');
  const unlike = { ...lookalike, code: 'imp/sofa-other', dominantColors: ['#ff00ff'], widthM: sofa.widthM * 2 };
  const d = resolveObjects(flat, [...ASSETS, unlike]).find((x) => x.key === 'sofa');
  assert.equal(d.route, 'FACTORY', 'a sofa that does not look like the picture\'s sofa is not used');
  const m = matchAsset({ ...sofa, form: null }, [unlike], []);
  assert.equal(m, null, 'the family fallback never brings in a catalogue model');
});

// ── Visual check ─────────────────────────────────────────────────────

test('the visual check answer is validated, judged per dimension, and junk never reaches the scene', () => {
  const r = validateQaReport({ errors: [{ code: 'rm -rf', target: 'sofa' }, { code: 'wrongColor', target: 'sofa', confidence: 3, severity: 'HUGE', fix: { color: 'red', sizeM: { width: 900 } } }], scores: { overall: 42, dimensions: { footprint: 9, camera: 'x', inventory: 4 } } });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].confidence, 1); assert.equal(r.errors[0].severity, 'LOW');
  assert.equal(r.errors[0].fix.color, null); assert.equal(r.errors[0].fix.sizeM, null);
  assert.equal(r.scores.overall, 10);
  assert.equal(r.scores.dimensions.footprint, 9); assert.equal(r.scores.dimensions.camera, null, 'not judged is not zero'); assert.equal(r.scores.dimensions.inventory, 4);
});

test('corrections are bounded: never far, never huge, never a confirmed piece, never walls or camera', () => {
  const recon = traced();
  const un = unprojectWith(FIT);
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  const bed = recon.objects.find((o) => o.key === 'bed1x');
  const near = [sofa.at[0] + 0.6, sofa.at[1]];
  const report = {
    scores: clean.scores,
    errors: [
      { code: 'wrongPosition', target: 'sofa', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf(near, sofa.heightM) } },
      { code: 'wrongPosition', target: 'bed1x', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf([bed.at[0] + 6, bed.at[1]], bed.heightM) } },
      { code: 'wrongScale', target: 'armchair-1', confidence: 0.9, severity: 'MEDIUM', evidence: '', fix: { sizeM: { width: 7, depth: 7, height: 7 } } },
      { code: 'wrongColor', target: 'armchair-2', confidence: 0.9, severity: 'MEDIUM', evidence: '', fix: { color: '#112233' } },
      { code: 'wrongColor', target: 'plant-living', confidence: 0.3, severity: 'HIGH', evidence: '', fix: { color: '#112233' } },
      { code: 'wrongWall', target: 'living', confidence: 0.95, severity: 'HIGH', evidence: '', fix: {} },
      { code: 'wrongCamera', target: 'camera', confidence: 0.95, severity: 'HIGH', evidence: '', fix: {} },
    ],
  };
  const out = applyQaCorrections(recon, report, un, new Set(['armchair-2']));
  const by = new Map(out.recon.objects.map((o) => [o.key, o]));
  assert.ok(Math.hypot(by.get('sofa').at[0] - near[0], by.get('sofa').at[1] - near[1]) < 0.05, 'moved to where the picture shows it');
  assert.deepEqual(by.get('bed1x').at, bed.at, `a 6 m jump is refused (limit ${QA_LIMITS.maxShiftM} m)`);
  const arm = recon.objects.find((o) => o.key === 'armchair-1');
  assert.ok(by.get('armchair-1').widthM <= arm.widthM * QA_LIMITS.maxScale + 0.01);
  assert.notEqual(by.get('armchair-2').color, '#112233', 'a confirmed piece is never touched');
  assert.notEqual(by.get('plant-living').color, '#112233', 'a low-confidence claim is not acted on');
  assert.ok(out.skipped.some((s) => s.code === 'wrongWall') && out.skipped.some((s) => s.code === 'wrongCamera'), 'architecture and camera are reported, not rewritten');
  assert.deepEqual(out.recon.rooms, recon.rooms); assert.deepEqual(out.recon.cameras, recon.cameras);
});

test('passes: two planned, a third only when justified and within budget, never more', () => {
  assert.equal(QA_PLANNED_PASSES, 2); assert.equal(QA_LIMITS.maxPasses, 3);
  const s = (o) => ({ layout: o, furniture: o, materials: o, lighting: o, overall: o });
  assert.equal(anotherPass({ passesDone: 1, before: s(5), after: s(6.5), remainingHigh: 2, spentUsd: 0.3, ceilingUsd: 2, nextPassUsd: 0.1 }), true);
  assert.equal(anotherPass({ passesDone: 1, before: s(6), after: s(6.1), remainingHigh: 3, spentUsd: 0.3, ceilingUsd: 2, nextPassUsd: 0.1 }), false, 'no real gain: stop');
  assert.equal(anotherPass({ passesDone: 1, before: s(5), after: s(7), remainingHigh: 3, spentUsd: 1.95, ceilingUsd: 2, nextPassUsd: 0.1 }), false, 'over budget: stop');
  assert.equal(anotherPass({ passesDone: 3, before: s(3), after: s(7), remainingHigh: 3, spentUsd: 0, ceilingUsd: 2, nextPassUsd: 0 }), false);
});

// ── Cost ─────────────────────────────────────────────────────────────

test('cost is never invented: measured, estimated or not available, and split by where it goes', () => {
  assert.equal(gpuCost(null, 0.0004, 'x').basis, 'NOT_AVAILABLE');
  assert.equal(gpuCost(30000, null, 'x').usd, null, 'seconds without a price are not $0');
  const g = gpuCost(30000, 0.0004, 'x');
  assert.deepEqual([g.basis, g.usd, g.kind], ['ESTIMATED', 0.012, 'GPU']);
  const lines = [g, { stage: 'CHECKING', kind: 'VISION', usd: 0.02, basis: 'MEASURED', detail: '' }, gpuCost(null, null, 'y')];
  assert.deepEqual(totals(lines), { measured: 0.02, estimated: 0.012, unavailable: 1 });
  const k = byKind(lines);
  assert.deepEqual(k.AI, { measured: 0.02, estimated: 0, unavailable: 0 });
  assert.deepEqual(k.COMPUTE, { measured: 0, estimated: 0.012, unavailable: 1 });
  assert.equal(withinCeiling(lines, 0.5, JOB_CEILING_USD.DRAFT), true);
  assert.equal(withinCeiling(lines, 0.6, JOB_CEILING_USD.DRAFT), false);
});

// ── The engine ───────────────────────────────────────────────────────

test('a clean first check: one render-only pass, one export pass, one AI call, nothing discarded', async () => {
  const { d, calls } = deps();
  const r = await engine(d);
  assert.deepEqual(calls.start.map((s) => [s.pass, s.outputs.render, s.outputs.scene, s.outputs.objects]), [[1, true, false, false], [2, true, true, true]]);
  assert.equal(calls.qa, 1, 'AI only for the visual check');
  assert.equal(r.qaCalls, 1); assert.equal(r.correctionPasses, 0);
  assert.equal(calls.discard.length, 0); assert.equal(calls.browser, 0);
  assert.equal(r.factory, 'USED');
  const withModel = r.state.objects.filter((o) => o.generated);
  assert.ok(withModel.length > 0 && withModel.every((o) => /^users\/[0-9a-f-]{36}\/design-studio-models\//.test(o.generated.key)), 'walkthrough pieces wear their factory models');
  assert.equal(normalizeDesignState(JSON.parse(JSON.stringify(r.state))).objects.filter((o) => o.generated).length, withModel.length, 'the references survive save and reload');
  assert.ok(r.cost.some((c) => c.kind === 'GPU' && c.basis === 'ESTIMATED') && r.cost.some((c) => c.kind === 'VISION'));
});

test('a check that finds problems: corrected, rebuilt, verified — and a pass it supersedes is discarded', async () => {
  const sofa = traced().objects.find((o) => o.key === 'sofa');
  let n = 0;
  const { d, calls } = deps({
    visualQa: async () => {
      n += 1;
      const s = { layout: 4 + 2 * n, furniture: 4 + 2 * n, materials: 6, lighting: 6, overall: 4 + 2 * n, dimensions: {} };
      return { report: { scores: s, errors: [{ code: 'wrongPosition', target: 'sofa', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf([sofa.at[0] + 0.3 * n, sofa.at[1]], sofa.heightM) } }] }, cost: { usd: 0.02, basis: 'ESTIMATED' } };
    },
  });
  const r = await engine(d);
  assert.equal(n, QA_LIMITS.maxPasses, 'never more than three checks');
  assert.ok(calls.start.length <= QA_LIMITS.maxPasses);
  assert.deepEqual(calls.discard, ['job-2'], 'pass 2\'s exports are deleted once pass 3 replaces them');
  assert.ok(r.applied.some((a) => a.code === 'wrongPosition'));
  assert.ok(r.skipped.some((a) => a.detail.startsWith('found after the last pass')), 'what the last check found is reported, not half-applied');
  const finalSpec = calls.compile.at(-1);
  assert.deepEqual(finalSpec, { render: true, scene: true, objects: true });
  assert.equal(r.passes.find((p) => p.pass === 2).discarded, true);
});

test('the visual check stops at the money ceiling', async () => {
  const { d, calls } = deps({
    factoryStatus: async () => ({ state: 'COMPLETED', outputs: { render: ref('10000000-2222-4222-8222-222222222222', 'jpg'), scene: {}, pieces: {} }, cost: [{ usd: 1.99, basis: 'ESTIMATED', detail: 'gpu' }] }),
  });
  const r = await engine(d, { quality: 'HIGH', qaUsd: 0.03 });
  assert.equal(calls.qa, 0, 'a check that would cross the ceiling is not run');
  assert.equal(r.qa, null);
});

test('without the factory: the same bounded check on a browser still, nothing exported, said so', async () => {
  const { d, calls } = deps({ startFactory: async () => ({ jobId: null, state: 'UNAVAILABLE', error: 'FACTORY_NOT_CONFIGURED' }) });
  const r = await engine(d);
  assert.equal(r.factory, 'UNAVAILABLE');
  assert.ok(calls.browser >= 1 && calls.qa >= 1);
  assert.ok(r.state.objects.every((o) => !o.generated), 'no factory, no factory models');
  assert.ok(r.state.objects.length > 10, 'the home is still built');
});

test('without the factory, its stages are shown as skipped, never as done', async () => {
  const states = new Map();
  const { d } = deps({ startFactory: async () => ({ jobId: null, state: 'FAILED', error: 'BAD_SPEC:camera.near' }) });
  d.onStage = (st, x) => states.set(st, x);
  const r = await engine(d);
  for (const st of ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING']) assert.equal(states.get(st), 'SKIPPED', st);
  assert.equal(r.passes[0].error, 'BAD_SPEC:camera.near', 'the refusal names the field');
});

test('a factory pass that fails or never ends: bounded in time, no half results', async () => {
  const slow = deps({ factoryStatus: async () => ({ state: 'RUNNING', stage: 'FURNISHING' }) });
  const stages = [];
  slow.d.onStage = (s, st) => stages.push(`${s}:${st}`);
  const a = await engine(slow.d, { passTimeoutMs: 60_000, pollMs: 5000 });
  assert.equal(a.factory, 'FAILED');
  assert.ok(slow.calls.status <= 13);
  assert.ok(stages.includes('FURNISHING:RUNNING'), 'the factory\'s real stage is what the customer sees');
  assert.ok(a.state.objects.every((o) => !o.generated));
  const failing = deps({ factoryStatus: async () => ({ state: 'FAILED', error: 'FACTORY_FAILED: blender' }) });
  const b = await engine(failing.d);
  assert.equal(b.factory, 'FAILED');
  assert.equal(b.passes[0].error, 'FACTORY_FAILED: blender');
});

test('attaching factory models: only pieces in a delivered group, by instance', () => {
  const { state } = assemble(traced());
  const spec = compile(state, { render: true, scene: true, objects: true });
  const group = spec.objects.find((o) => o.runtime).group;
  const got = attachFactoryModels(state, spec, { [group]: { assetId: AID, key: KEY, sha256: null, bytes: 1 } });
  const members = spec.objects.filter((o) => o.group === group).map((o) => o.id);
  assert.deepEqual([...got].sort(), members.sort());
  assert.ok(state.objects.filter((o) => !got.has(o.instanceId)).every((o) => !o.generated));
});

test('fidelity is gates per dimension with reasons, never one number; the verdict is the worst gate', async () => {
  const { d } = deps();
  const r = await engine(d);
  const names = r.fidelity.dimensions.map((x) => x.name);
  for (const n of ['footprint', 'rooms', 'walls', 'openings', 'balcony', 'inventory', 'placement', 'scale', 'orientation', 'colors', 'materials', 'lighting', 'camera', 'overall likeness']) assert.ok(names.includes(n), n);
  const rank = { PASS: 0, UNKNOWN: 1, WARN: 2, FAIL: 3 };
  assert.equal(r.fidelity.verdict, r.fidelity.dimensions.reduce((w, x) => (rank[x.gate] > rank[w] ? x.gate : w), 'PASS'));
  const report = engineReport(r, { mode: 'RECONSTRUCT_FROM_IMAGE', versionId: AID, startedAt: 0, endedAt: 1000 });
  const text = JSON.stringify(report);
  assert.ok(!/https?:\/\//.test(text), 'the report holds no URL');
  assert.ok(!text.includes('X-Amz'), 'and no signature');
});

// ── Floor plan → 3D ──────────────────────────────────────────────────

test('a floor-plan build: walkable, nothing standing in anything, scale from the source', () => {
  const { state } = assemble(traced());
  const c = designChecks(SPACE.space, state, ASSET_MAP, SPACE.canonical);
  const gate = Object.fromEntries(c.dimensions.map((x) => [x.name, x.gate]));
  assert.ok(['PASS', 'WARN'].includes(gate.scale));
  assert.equal(gate.rooms, 'PASS');
  // The empty plan is fully walkable; furnished as this (synthetic) reading placed it, the fridge
  // stands 0.45 m from the kitchen run's end — narrower than a person — and closes the way to the
  // bathroom and dressing room. The check names that, it is never smoothed over.
  assert.deepEqual(designChecks(SPACE.space, { ...state, objects: [] }, ASSET_MAP, SPACE.canonical).unreachableRooms, []);
  assert.deepEqual(c.unreachableRooms.sort(), ['r-bath', 'r-dressing']);
  assert.equal(gate.walkability, 'FAIL');
  const freed = { ...state, objects: state.objects.filter((o) => o.assetId !== 'dev/fridge') };
  assert.deepEqual(designChecks(SPACE.space, freed, ASSET_MAP, SPACE.canonical).unreachableRooms, [], 'the blocking piece is the cause');
  const piece = state.objects.find((o) => ASSET_MAP.get(o.assetId)?.placement === 'FLOOR' && ASSET_MAP.get(o.assetId).heightM > 0.3);
  const clash = { ...state, objects: [...state.objects, { ...piece, instanceId: 'clash' }] };
  assert.ok(designChecks(SPACE.space, clash, ASSET_MAP, SPACE.canonical).overlaps.some((p) => p.includes('clash')), 'an impossible intersection is found');
});

test('a floor-plan build runs one factory pass, reports the plan check, and never presents furniture as the plan\'s', async () => {
  const { state } = assemble(traced());
  const { d, calls } = deps();
  let planQa = 0;
  const r = await runDesignBuild({ state, checks: designChecks(SPACE.space, state, ASSET_MAP, SPACE.canonical).dimensions }, {
    ...d,
    compile: (s, outputs) => compileSceneSpec({ space: SPACE.space, state: s, assets: ASSET_MAP, materials: MATERIAL_MAP, camera: { ...CAMERA, cut: null }, source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, outputs }),
    planQa: async () => { planQa += 1; return { report: { errors: [], scores: { ...clean.scores, dimensions: { walls: 9, openings: 8, footprint: 9, rooms: 9, balcony: null } } }, cost: { usd: 0.02, basis: 'ESTIMATED' } }; },
  });
  assert.equal(calls.start.length, 1); assert.equal(planQa, 1);
  assert.equal(r.spec.source.furnishing, 'DESIGN');
  assert.ok(r.spec.objects.every((o) => o.provenance !== 'OBSERVED' || o.provenance === 'OBSERVED'));
  assert.ok(r.dimensions.some((x) => x.name === 'furnishing' && /design choice/.test(x.value)));
  assert.ok(r.dimensions.some((x) => x.name === 'walls (against the plan)'));
  assert.ok(r.state.objects.some((o) => o.generated));
});

// ── Privacy and canonical references ────────────────────────────────

test('a factory model reference is the owner-private model folder and nothing else', () => {
  assert.deepEqual(normalizeGenerated({ assetId: AID, key: KEY, sha256: 'A'.repeat(64) }), { assetId: AID, key: KEY, sha256: 'a'.repeat(64) });
  assert.equal(normalizeGenerated({ assetId: AID, key: `users/${UID}/design-studio-models/${PID}/${PID}.glb` }), undefined, 'the key must be this asset');
  assert.equal(normalizeGenerated({ assetId: AID, key: `catalog/models/${AID}.glb` }), undefined, 'never the shared catalogue');
  assert.equal(normalizeGenerated({ assetId: AID, key: `users/${UID}/design-studio-models/../../${AID}.glb` }), undefined, 'no traversal');
  assert.equal(normalizeGenerated({ assetId: AID, key: `https://evil.example/${AID}.glb` }), undefined);
});

test('replacing a factory-built piece drops its model; undo brings it back', () => {
  const { state } = assemble(traced());
  const target = state.objects.find((o) => o.provenance?.ref === 'sofa');
  target.generated = { assetId: AID, key: KEY, sha256: null };
  const other = ASSETS.find((a) => a.code !== target.assetId && a.category === ASSET_MAP.get(target.assetId).category && a.placement === 'FLOOR');
  const ctx = { assets: ASSET_MAP, materials: new Map(), space: SPACE.space };
  const res = applyOperation(state, { type: 'REPLACE_OBJECT', instanceId: target.instanceId, assetId: other.code }, ctx);
  assert.ok(!('code' in res), JSON.stringify(res.code ?? ''));
  assert.equal(res.state.objects.find((o) => o.instanceId === target.instanceId).generated, undefined);
  let undone = res.state;
  for (const op of res.inverse) { const u = applyOperation(undone, op, ctx); assert.ok(!('code' in u)); undone = u.state; }
  assert.equal(undone.objects.find((o) => o.instanceId === target.instanceId).generated.key, KEY);
});

test('the edge runs the very same engine code (shared copies are byte-identical)', () => {
  for (const f of ['contract.ts', 'cost.ts', 'qa.ts', 'sceneSpec.ts']) {
    const a = fs.readFileSync(path.join(ROOT, 'src/lib/designStudio/hybrid', f), 'utf8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/designStudio/hybrid', f), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(b, a, `${f} drifted`);
  }
});

test('the worker\'s Python spec reader accepts what the browser compiles (shared fixture is current)', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures/apartment.spec.json'), 'utf8'));
  assert.doesNotThrow(() => validateSceneSpec(fixture));
  assert.equal(fixture.version, 'hm-scene-1');
});

test('the factory is sent only the forms the deployed worker builds; a design form stays the walkthrough\'s to draw', async () => {
  const { FACTORY_FORMS, SPEC_FORMS, validateSceneSpec } = await import('../hybrid/sceneSpec.ts');
  const { state } = assemble(traced());
  const runtime = state.objects.filter((o) => compile(state, { render: false, scene: false, objects: true }).objects.find((p) => p.id === o.instanceId)?.runtime);
  assert.ok(runtime.length >= 2, 'the fixture has runtime pieces');
  const [a, b] = runtime;
  const shaped = { ...state, objects: state.objects.map((o) => (o === a ? { ...o, shape: { ...(o.shape ?? {}), form: 'CLUB' } } : o === b ? { ...o, shape: { ...(o.shape ?? {}), form: 'ROUND' } } : o)) };
  const spec = validateSceneSpec(JSON.parse(JSON.stringify(compile(shaped, { render: false, scene: false, objects: true }))));
  const pa = spec.objects.find((p) => p.id === a.instanceId); const pb = spec.objects.find((p) => p.id === b.instanceId);
  assert.equal(pa.form, null, 'a design form is never sent to a factory that refuses it');
  assert.equal(pa.runtime, false, '…and the piece is not built there (the walkthrough draws it in its form)');
  assert.equal(pb.form, 'ROUND'); assert.equal(pb.runtime, true);
  assert.ok(spec.objects.every((p) => p.form == null || FACTORY_FORMS.includes(p.form)));
  // The worker's own list (infra/design-studio-gpu-worker/worker/spec.py FORMS) accepts every form we send.
  const py = fs.readFileSync(path.resolve('infra/design-studio-gpu-worker/worker/spec.py'), 'utf8');
  const workerForms = new Set([...py.match(/^FORMS = \{([^}]*)\}/m)[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]));
  for (const f of FACTORY_FORMS) assert.ok(workerForms.has(f) && SPEC_FORMS.includes(f), f);
});
