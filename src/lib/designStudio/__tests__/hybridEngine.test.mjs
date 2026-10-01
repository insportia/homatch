// THE HYBRID ENGINE: each object goes the cheapest faithful way (catalogue →
// HOMATCH's own drawing → a model built on the GPU), the GPU is asked only for
// what nothing else can represent, the visual check is bounded in passes and
// in money, its corrections are bounded in distance and size, and a model
// built from a customer's picture stays in that customer's project.
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
import { buildDesign, emptyCorrections } from '../reconstruction.ts';
import { normalizeDesignState, normalizeGenerated } from '../designState.ts';
import { applyOperation } from '../operations.ts';
import { fitCamera, projectPlan } from '../sourceCamera.ts';
import { validateJobInput, STAGES, STAGE_COPY, LIVE_MODES } from '../hybrid/contract.ts';
import { resolveObjects, generationRequests, likenessKey, DEFAULT_RESOLUTION } from '../hybrid/resolution.ts';
import { objectCrop } from '../hybrid/crops.ts';
import { applyQaCorrections, anotherPass, validateQaReport, QA_LIMITS } from '../hybrid/qa.ts';
import { gpuCost, totals, withinCeiling, JOB_CEILING_USD } from '../hybrid/cost.ts';
import { fidelityReport } from '../hybrid/fidelity.ts';
import { attachGenerated, runEngine, unprojectWith } from '../hybrid/orchestrate.ts';
import { seedAssets, seedMaterials } from './seedCatalog.mjs';

const ROOT = process.cwd();
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
const ASSETS = seedAssets();
const MATERIALS = seedMaterials();
const UID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const AID = '33333333-3333-4333-8333-333333333333';
const KEY = `users/${UID}/design-studio-models/${PID}/${AID}.glb`;

// A dollhouse camera over the fixture's plan: the picture every trace below is "seen" in.
const ASPECT = 1.4;
function camera() {
  const cam = new THREE.OrthographicCamera(-ASPECT * 9, ASPECT * 9, 9, -9, 0.1, 500);
  cam.position.set(6 + 60 * Math.sin(0.7), 60 * Math.tan((35 * Math.PI) / 180), -5 + 60 * Math.cos(0.7));
  cam.lookAt(6, 0, -5);
  cam.updateMatrixWorld();
  return cam;
}
const CAM = camera();
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

function space() {
  const { recon } = validateReconstruction(RAW, 1);
  const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/ref.jpg');
  const decisions = { rejected: [], roomKinds: {} };
  const calibration = calibrate(doc, decisions, [], estimateScale(doc, []));
  const result = buildCanonical(doc, decisions, calibration, 2.7);
  return { space: buildSpaceModel(result.canonical.scene), scale: calibration.metresPerPx * 100 };
}
const SPACE = space();
const assemble = (r) => buildDesign(r, emptyCorrections(), SPACE.space, ASSETS, MATERIALS, { scale: SPACE.scale });

function deps(over = {}) {
  const calls = { start: 0, status: 0, render: 0, qa: 0, assemble: 0 };
  let clock = 0;
  const d = {
    startGeneration: async (keys) => { calls.start += 1; calls.keys = keys; return { jobId: 'job-1', state: 'QUEUED', error: null }; },
    generationStatus: async () => { calls.status += 1; return { state: 'COMPLETED', assets: [], cost: [{ usd: 0.12, basis: 'ESTIMATED', detail: 'gpu' }] }; },
    assemble: (r) => { calls.assemble += 1; return assemble(r); },
    render: async () => { calls.render += 1; return 'data:image/jpeg;base64,AAAA'; },
    visualQa: async () => { calls.qa += 1; return { report: { errors: [], scores: { layout: 9, furniture: 9, materials: 9, lighting: 9, overall: 9 } }, cost: { usd: 0.02, basis: 'MEASURED' } }; },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    ...over,
  };
  return { d, calls };
}

// ── Contract ─────────────────────────────────────────────────────────

test('the job contract: four modes, only picture reconstruction is live, malformed input is refused', () => {
  const ok = validateJobInput({ mode: 'RECONSTRUCT_FROM_IMAGE', projectId: PID, sourceImageIds: [AID], locale: 'ka' });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.preserveSource, true, 'a reconstruction always preserves the source');
  assert.deepEqual([...LIVE_MODES], ['RECONSTRUCT_FROM_IMAGE']);
  const later = validateJobInput({ mode: 'DESIGN_FROM_TEXT', projectId: PID, textBrief: 'a calm flat', locale: 'en' });
  assert.deepEqual(later.errors, ['NOT_YET'], 'a planned mode is declared, not silently run');
  const bad = validateJobInput({ mode: 'RECONSTRUCT_FROM_IMAGE', projectId: 'x', sourceImageIds: [], locale: 'xx', qualityTarget: 'ULTRA' });
  assert.deepEqual(bad.errors.sort(), ['IMAGES', 'LOCALE', 'PROJECT', 'QUALITY']);
  assert.equal(validateJobInput({ mode: 'RECONSTRUCT_FROM_IMAGE', projectId: PID, sourceImageIds: [AID, AID], locale: 'en' }).ok, false, 'no duplicate pictures');
  assert.equal(STAGES.length, 9);
  for (const s of STAGES) assert.match(STAGE_COPY[s], /^ds_gen_stage_/);
});

// ── Resolution ───────────────────────────────────────────────────────

test('routing: built-ins are drawn, a distinctive high-impact piece is generated, an untraced one is approximate', () => {
  const recon = traced();
  const by = new Map(resolveObjects(recon, ASSETS).map((d) => [d.key, d]));
  assert.equal(by.get('kitchen-run').route, 'PARAMETRIC', 'parametric avoids the GPU');
  assert.equal(by.get('hall-wardrobe').route, 'PARAMETRIC');
  assert.equal(by.get('sofa').route, 'GENERATE', 'an important piece nothing else represents goes to the GPU');
  assert.equal(by.get('bed1x').route, 'GENERATE');
  const untraced = resolveObjects({ ...recon, objects: recon.objects.map((o) => ({ ...o, px: null })) }, ASSETS);
  assert.ok(untraced.every((d) => d.route !== 'GENERATE'), 'nothing traced, nothing to build from');
  const noGpu = resolveObjects(recon, ASSETS, { ...DEFAULT_RESOLUTION, gpuAvailable: false });
  assert.ok(noGpu.every((d) => d.route !== 'GENERATE'));
  assert.ok(noGpu.filter((d) => d.reason === 'generation unavailable').length > 0);
});

test('routing: a catalogue model that genuinely looks like the piece avoids the GPU', () => {
  const recon = traced();
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  const model = {
    ...ASSETS.find((a) => a.code === 'dev/sofa-3'), code: 'imp/sofa-lookalike', procedural: null, active: true, provider: 'POLYHAVEN',
    widthM: sofa.widthM, depthM: sofa.depthM, heightM: sofa.heightM, dominantColors: [sofa.color ?? '#808080'],
  };
  const flat = { ...recon, objects: recon.objects.map((o) => (o.key === 'sofa' ? { ...o, form: null, color: sofa.color ?? '#808080' } : o)) };
  const d = resolveObjects(flat, [...ASSETS, model]).find((x) => x.key === 'sofa');
  assert.equal(d.route, 'CATALOGUE', d.reason);
});

test('routing: the same piece seen several times is one model; the per-job ceiling holds', () => {
  const recon = traced();
  const chairs = resolveObjects(recon, ASSETS).filter((d) => d.key.startsWith('dining-chair'));
  const generated = chairs.filter((d) => d.route === 'GENERATE');
  if (generated.length > 1) assert.equal(new Set(generated.map((d) => d.group)).size, 1, 'identical chairs share one model');
  const a = recon.objects.find((o) => o.key === 'dining-chair-1');
  assert.equal(likenessKey(a), likenessKey({ ...a, widthM: a.widthM + 0.02 }), 'a couple of centimetres is the same piece');
  const capped = resolveObjects(recon, ASSETS, { ...DEFAULT_RESOLUTION, maxGenerated: 2 });
  assert.equal(capped.filter((d) => d.route === 'GENERATE' && d.group === d.key).length, 2);
  assert.ok(capped.some((d) => d.reason === 'over the per-job generation ceiling'));
  const requests = generationRequests(recon, capped);
  assert.equal(requests.length, 2, 'one request per model, not per instance');
  assert.ok(requests.every((r) => r.image === 0 && Array.isArray(r.at)));
});

// ── Geometry ─────────────────────────────────────────────────────────

test('a crop is the object projected through the measured camera, with a margin', () => {
  const recon = traced();
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  const crop = objectCrop(FIT, sofa.at, sofa.facingDeg, { width: sofa.widthM, depth: sofa.depthM, height: sofa.heightM });
  assert.ok(crop);
  const [l, t, r, b] = crop.box; const [tl, tt, tr, tb] = crop.tight;
  assert.ok(l <= tl && t <= tt && r >= tr && b >= tb, 'the crop contains the object');
  assert.ok(crop.box.every((v) => v >= 0 && v <= 1));
  const centre = uvOf(sofa.at, sofa.heightM / 2);
  assert.ok(centre[0] > tl && centre[0] < tr && centre[1] > tt && centre[1] < tb, 'the object is where the camera says');
});

test('a point on top of a piece unprojects to the floor point under it', () => {
  const un = unprojectWith(FIT);
  for (const [p, h] of [[[3, 4], 0], [[7.5, 6], 0.75], [[10, 2], 2.1]]) {
    const back = un(projectPlan(FIT, p, h), h);
    assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 0.02, `${p} at ${h} m → ${back}`);
  }
});

// ── Visual check ─────────────────────────────────────────────────────

test('the visual check answer is validated; junk never reaches the scene', () => {
  const r = validateQaReport({ errors: [{ code: 'rm -rf', target: 'sofa' }, { code: 'wrongColor', target: 'sofa', confidence: 3, severity: 'HUGE', fix: { color: 'red', sizeM: { width: 900 } } }], scores: { overall: 42 } });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].confidence, 1);
  assert.equal(r.errors[0].severity, 'LOW');
  assert.equal(r.errors[0].fix.color, null);
  assert.equal(r.errors[0].fix.sizeM, null);
  assert.ok(r.scores.overall <= 10);
});

test('corrections are bounded: never far, never huge, never a piece the customer confirmed, never walls or camera', () => {
  const recon = traced();
  const un = unprojectWith(FIT);
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  const bed = recon.objects.find((o) => o.key === 'bed1x');
  const near = [sofa.at[0] + 0.6, sofa.at[1]];
  const report = {
    scores: { layout: 6, furniture: 6, materials: 6, lighting: 6, overall: 6 },
    errors: [
      { code: 'wrongPosition', target: 'sofa', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf(near, sofa.heightM) } },
      { code: 'wrongPosition', target: 'bed1x', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf([bed.at[0] + 6, bed.at[1]], bed.heightM) } },
      { code: 'wrongScale', target: 'armchair-1', confidence: 0.9, severity: 'MEDIUM', evidence: '', fix: { sizeM: { width: 7, depth: 7, height: 7 } } },
      { code: 'wrongColor', target: 'armchair-2', confidence: 0.9, severity: 'MEDIUM', evidence: '', fix: { color: '#112233' } },
      { code: 'wrongColor', target: 'plant-living', confidence: 0.3, severity: 'HIGH', evidence: '', fix: { color: '#112233' } },
      { code: 'wallMissing', target: 'living', confidence: 0.95, severity: 'HIGH', evidence: '', fix: {} },
      { code: 'cameraMismatch', target: 'camera', confidence: 0.95, severity: 'HIGH', evidence: '', fix: {} },
    ],
  };
  const out = applyQaCorrections(recon, report, un, new Set(['armchair-2']));
  const by = new Map(out.recon.objects.map((o) => [o.key, o]));
  assert.ok(Math.hypot(by.get('sofa').at[0] - near[0], by.get('sofa').at[1] - near[1]) < 0.05, 'moved to where the picture shows it');
  assert.deepEqual(by.get('bed1x').at, bed.at, `a ${6} m jump is refused (limit ${QA_LIMITS.maxShiftM} m)`);
  const arm = recon.objects.find((o) => o.key === 'armchair-1');
  assert.ok(by.get('armchair-1').widthM <= arm.widthM * QA_LIMITS.maxScale + 0.01, 'never scaled into a caricature');
  assert.notEqual(by.get('armchair-2').color, '#112233', 'a confirmed piece is never touched');
  assert.notEqual(by.get('plant-living').color, '#112233', 'a low-confidence claim is not acted on');
  assert.ok(out.skipped.some((s) => s.code === 'wallMissing') && out.skipped.some((s) => s.code === 'cameraMismatch'), 'architecture and camera are reported, not rewritten');
  assert.deepEqual(out.recon.rooms, recon.rooms);
  assert.deepEqual(out.recon.cameras, recon.cameras);
});

test('another pass only when the first one justified it, within budget, never a third', () => {
  const s = (overall) => ({ layout: overall, furniture: overall, materials: overall, lighting: overall, overall });
  assert.equal(anotherPass({ passesDone: 0, before: null, after: s(6), remainingHigh: 2, spentUsd: 0.2, ceilingUsd: 2, nextPassUsd: 0.03 }), true);
  assert.equal(anotherPass({ passesDone: 0, before: null, after: s(9), remainingHigh: 0, spentUsd: 0.2, ceilingUsd: 2, nextPassUsd: 0.03 }), false, 'good enough: stop');
  assert.equal(anotherPass({ passesDone: 0, before: null, after: s(5), remainingHigh: 3, spentUsd: 1.99, ceilingUsd: 2, nextPassUsd: 0.03 }), false, 'over budget: stop');
  assert.equal(anotherPass({ passesDone: 1, before: s(6), after: s(6.1), remainingHigh: 3, spentUsd: 0.2, ceilingUsd: 2, nextPassUsd: 0.03 }), false, 'no real gain: stop');
  assert.equal(anotherPass({ passesDone: QA_LIMITS.maxPasses, before: s(3), after: s(7), remainingHigh: 3, spentUsd: 0, ceilingUsd: 2, nextPassUsd: 0 }), false);
});

// ── Cost ─────────────────────────────────────────────────────────────

test('cost lines say what they are: measured, estimated or not available — never a silent zero', () => {
  assert.equal(gpuCost(null, 0.0004, 'x').basis, 'NOT_AVAILABLE');
  assert.equal(gpuCost(30000, null, 'x').usd, null, 'seconds without a price are not $0');
  const g = gpuCost(30000, 0.0004, 'x');
  assert.equal(g.basis, 'ESTIMATED');
  assert.equal(g.usd, 0.012);
  const lines = [g, { stage: 'CHECKING', kind: 'VISION', usd: 0.02, basis: 'MEASURED', detail: '' }, gpuCost(null, null, 'y')];
  assert.deepEqual(totals(lines), { measured: 0.02, estimated: 0.012, unavailable: 1 });
  assert.equal(withinCeiling(lines, 0.5, JOB_CEILING_USD.DRAFT), true);
  assert.equal(withinCeiling(lines, 0.6, JOB_CEILING_USD.DRAFT), false);
});

// ── Orchestration ────────────────────────────────────────────────────

test('nothing to generate: the GPU is never called, and no AI runs for deterministic work', async () => {
  const recon = { ...traced(), objects: traced().objects.map((o) => ({ ...o, px: null })) };
  const { d, calls } = deps();
  const r = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: null, roomsBuilt: SPACE.space.rooms.length }, d);
  assert.equal(calls.start, 0);
  assert.equal(calls.qa, 0, 'no camera, no check');
  assert.equal(calls.render, 0);
  assert.equal(r.gpu.state, 'NOT_NEEDED');
  assert.ok(r.state.objects.length > 10, 'the home is still built');
  assert.equal(r.timings.find((t) => t.stage === 'BUILDING_OBJECTS').ms, 0);
});

test('generated models go to every placed member of their group; a group without a model stays drawn and approximate', async () => {
  const recon = traced();
  const decisions = resolveObjects(recon, ASSETS);
  const firstGroup = decisions.find((d) => d.route === 'GENERATE').group;
  const { d, calls } = deps({
    generationStatus: async () => ({
      state: 'COMPLETED',
      assets: [{ id: AID, source_ref: firstGroup, object_key: KEY, sha256: 'a'.repeat(64), bytes: 1_200_000, state: 'READY' }],
      cost: [{ usd: 0.05, basis: 'ESTIMATED', detail: 'gpu 125 s' }],
      result: { temporaryDirRemoved: true },
    }),
  });
  const r = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: null, roomsBuilt: SPACE.space.rooms.length }, d);
  assert.equal(calls.start, 1);
  assert.ok(calls.keys.length >= 1 && calls.keys.length <= DEFAULT_RESOLUTION.maxGenerated);
  const withModel = r.state.objects.filter((o) => o.generated);
  assert.ok(withModel.length >= 1);
  assert.ok(withModel.every((o) => o.generated.key === KEY && o.generated.assetId === AID));
  const other = r.decisions.filter((x) => x.group && x.group !== firstGroup);
  assert.ok(other.every((x) => x.route === 'APPROXIMATE'), 'a model that did not arrive is reported, not pretended');
  assert.equal(r.gpu.persistedBytes, 1_200_000);
  assert.ok(r.cost.some((c) => c.kind === 'GPU' && c.basis === 'ESTIMATED'));
  const saved = normalizeDesignState(JSON.parse(JSON.stringify(r.state)));
  assert.equal(saved.objects.filter((o) => o.generated).length, withModel.length, 'the reference survives save and reload');
});

test('the GPU unavailable or slow: the job continues with drawn pieces, bounded in time', async () => {
  const recon = traced();
  const off = deps({ startGeneration: async () => ({ jobId: null, state: 'UNAVAILABLE', error: 'GPU_NOT_CONFIGURED' }) });
  const a = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: null, roomsBuilt: 1 }, off.d);
  assert.equal(a.gpu.state, 'UNAVAILABLE');
  assert.ok(a.decisions.every((x) => x.route !== 'GENERATE'));
  assert.ok(a.cost.some((c) => c.basis === 'NOT_AVAILABLE'));
  const slow = deps({ generationStatus: async () => ({ state: 'RUNNING' }) });
  const b = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: null, roomsBuilt: 1, pollMs: 5000, gpuTimeoutMs: 60_000 }, slow.d);
  assert.equal(b.gpu.error, 'TIMEOUT');
  assert.ok(slow.calls.status <= 13, `polled ${slow.calls.status} times in a minute`);
  assert.ok(b.state.objects.length > 10);
});

test('the visual check is bounded: at most two checks, even when every answer finds problems', async () => {
  const recon = traced();
  const sofa = recon.objects.find((o) => o.key === 'sofa');
  let n = 0;
  const { d } = deps({
    startGeneration: async () => ({ jobId: null, state: 'UNAVAILABLE', error: null }),
    visualQa: async () => {
      n += 1;
      return {
        report: { scores: { layout: 4, furniture: 4, materials: 4, lighting: 4, overall: 4 }, errors: [{ code: 'wrongPosition', target: 'sofa', confidence: 0.9, severity: 'HIGH', evidence: '', fix: { sourcePx: uvOf([sofa.at[0] + 0.3 * n, sofa.at[1]], sofa.heightM) } }] },
        cost: { usd: 0.02, basis: 'MEASURED' },
      };
    },
  });
  const r = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: unprojectWith(FIT), roomsBuilt: 1 }, d);
  assert.equal(n, QA_LIMITS.maxPasses);
  assert.equal(r.qaCalls, QA_LIMITS.maxPasses);
  assert.ok(r.correctionPasses <= QA_LIMITS.maxPasses);
  assert.equal(r.cost.filter((c) => c.stage === 'CHECKING').length, QA_LIMITS.maxPasses);
  assert.ok(r.applied.some((a) => a.code === 'wrongPosition'));
});

test('the visual check stops at the money ceiling', async () => {
  const recon = traced();
  const { d, calls } = deps({
    startGeneration: async () => ({ jobId: 'j', state: 'QUEUED', error: null }),
    generationStatus: async () => ({ state: 'COMPLETED', assets: [], cost: [{ usd: 1.99, basis: 'ESTIMATED', detail: 'gpu' }] }),
  });
  const r = await runEngine({ recon, assets: ASSETS, confirmed: new Set(), unproject: unprojectWith(FIT), roomsBuilt: 1, quality: 'HIGH', qaUsd: 0.03 }, d);
  assert.equal(calls.qa, 0, 'a check that would cross the ceiling is not run');
  assert.equal(r.qa, null);
});

test('a clean first check ends the loop after one call', async () => {
  const { d, calls } = deps({ startGeneration: async () => ({ jobId: null, state: 'UNAVAILABLE', error: null }) });
  const r = await runEngine({ recon: traced(), assets: ASSETS, confirmed: new Set(), unproject: unprojectWith(FIT), roomsBuilt: 1 }, d);
  assert.equal(calls.qa, 1);
  assert.equal(r.correctionPasses, 0);
  assert.deepEqual(r.timings.map((t) => t.stage), STAGES.filter((s) => r.timings.some((t) => t.stage === s)), 'stages in the contract order');
});

// ── Fidelity ─────────────────────────────────────────────────────────

test('fidelity is a set of gates, not one magic score; the verdict is the worst gate', () => {
  const recon = traced();
  const built = assemble(recon);
  const decisions = resolveObjects(recon, ASSETS);
  const f = fidelityReport({ recon, state: built.state, build: built.report, decisions, generatedOk: new Set(), qa: null, roomsBuilt: SPACE.space.rooms.length });
  assert.ok(f.dimensions.length >= 8);
  const rank = { PASS: 0, UNKNOWN: 1, WARN: 2, FAIL: 3 };
  assert.equal(f.verdict, f.dimensions.reduce((w, d) => (rank[d.gate] > rank[w] ? d.gate : w), 'PASS'));
  assert.ok(f.unresolvedHighImpact.length > 0, 'high-impact pieces that were meant to be generated and were not are named');
});

// ── Privacy and canonical references ────────────────────────────────

test('a generated model reference is the owner-private model folder and nothing else', () => {
  assert.deepEqual(normalizeGenerated({ assetId: AID, key: KEY, sha256: 'A'.repeat(64) }), { assetId: AID, key: KEY, sha256: 'a'.repeat(64) });
  assert.equal(normalizeGenerated({ assetId: AID, key: `users/${UID}/design-studio-models/${PID}/${PID}.glb` }), undefined, 'the key must be this asset');
  assert.equal(normalizeGenerated({ assetId: AID, key: `catalog/models/${AID}.glb` }), undefined, 'never the shared catalogue');
  assert.equal(normalizeGenerated({ assetId: AID, key: `users/${UID}/design-studio-models/../../${AID}.glb` }), undefined, 'no traversal');
  assert.equal(normalizeGenerated({ assetId: AID, key: `https://evil.example/${AID}.glb` }), undefined);
});

test('replacing a generated piece drops its model; undo brings it back', () => {
  const recon = traced();
  const built = assemble(recon);
  const target = built.state.objects.find((o) => o.provenance?.ref === 'sofa');
  attachGenerated(built.state, built.report, [{ key: 'sofa', type: 'SOFA', route: 'GENERATE', impact: 1, group: 'sofa', reason: '' }], new Map([['sofa', { assetId: AID, key: KEY, sha256: null }]]));
  assert.equal(target.generated.key, KEY);
  const assets = new Map(ASSETS.map((a) => [a.code, a]));
  const other = ASSETS.find((a) => a.code !== target.assetId && a.category === assets.get(target.assetId).category && a.placement === 'FLOOR');
  const res = applyOperation(built.state, { type: 'REPLACE_OBJECT', instanceId: target.instanceId, assetId: other.code }, { assets, materials: new Map(), space: SPACE.space });
  assert.ok(!('code' in res), JSON.stringify(res.code ?? ''));
  assert.equal(res.state.objects.find((o) => o.instanceId === target.instanceId).generated, undefined);
  let undone = res.state;
  for (const op of res.inverse) {
    const u = applyOperation(undone, op, { assets, materials: new Map(), space: SPACE.space });
    assert.ok(!('code' in u));
    undone = u.state;
  }
  assert.equal(undone.objects.find((o) => o.instanceId === target.instanceId).generated.key, KEY);
});

test('the edge runs the very same engine code (shared copies are byte-identical)', () => {
  for (const f of ['contract.ts', 'crops.ts', 'cost.ts', 'qa.ts']) {
    const a = fs.readFileSync(path.join(ROOT, 'src/lib/designStudio/hybrid', f), 'utf8');
    const b = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/designStudio/hybrid', f), 'utf8');
    assert.equal(b, a, `${f} drifted`);
  }
});
