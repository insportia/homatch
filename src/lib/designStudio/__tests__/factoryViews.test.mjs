// Planned views in the factory spec: additive (absent = the spec it always was, same hash),
// bounded the same way in TS, on the edge and in the worker, and carried by the compiler.
//
// The worker renders them (infra/design-studio-gpu-worker/worker/factory/views.py) and its
// pytest proves the pictures and object maps; this file proves the spec half.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateScene } from '../../floorplan/geometry.ts';
import { buildSpaceModel } from '../space.ts';
import { compileSceneSpec } from '../hybrid/compileSpec.ts';
import { canonicalJson, SpecError, SPEC_LIMITS, validateSceneSpec, VIEW_KINDS, VIEW_PURPOSES } from '../hybrid/sceneSpec.ts';
import { emptyDesignState } from '../designState.ts';
import { oneBedroomDoc } from './fixtures.mjs';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures');
const APARTMENT = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'apartment.spec.json'), 'utf8'));
const VIEWS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'apartment.views.json'), 'utf8'));
const space = buildSpaceModel(generateScene(oneBedroomDoc()).scene);
const roomId = space.rooms?.[0]?.id ?? null;

const compile = (views) => compileSceneSpec({
  space, state: emptyDesignState(), assets: new Map(), materials: new Map(),
  source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, camera: null,
  outputs: { render: false, scene: true, objects: false }, ...(views === undefined ? {} : { views }),
});

const roomView = (over = {}) => ({
  id: 'v-room', kind: 'ROOM', purpose: 'MAIN', roomId, position: [1, 1, 1.5], target: [3, 3, 1.2],
  fovDeg: 60, orthoScale: null, aspect: 1.5, width: 1536, height: 1024, samples: 256, cut: null, hideCeilings: false, objectMap: true, ...over,
});

test('the worker\'s planned views are valid here too (TS and Python read the same views)', () => {
  const v = validateSceneSpec({ ...APARTMENT, views: VIEWS });
  assert.deepEqual(JSON.parse(JSON.stringify(v.views)), VIEWS);
  assert.equal('views' in validateSceneSpec(APARTMENT), false);
});

test('without views the spec is exactly what it was: same keys, same hash', () => {
  const plain = compile(undefined);
  assert.equal('views' in plain, false);
  assert.equal(canonicalJson(compile([])), canonicalJson(plain), 'an empty plan is no plan');
  const vp = validateSceneSpec(JSON.parse(JSON.stringify(plain)));
  assert.equal('views' in vp, false);
  assert.equal(canonicalJson(vp), canonicalJson(validateSceneSpec(JSON.parse(canonicalJson(plain)))));
  assert.equal('views' in validateSceneSpec({ ...JSON.parse(JSON.stringify(plain)), views: [] }), false);
});

test('the compiler carries planned views as given (a copy), and they validate', () => {
  assert.ok(roomId, 'the fixture has a room');
  const planned = [roomView(), { ...roomView({ id: 'v-master', kind: 'MASTER', purpose: 'DOLLHOUSE', roomId: null, fovDeg: null, orthoScale: 14, position: [20, -20, 20], target: [3, 3, 0] }), cut: { exteriorM: 1.1, interiorM: 1 }, hideCeilings: true }];
  const spec = compile(planned);
  assert.deepEqual(spec.views, planned);
  assert.notEqual(spec.views[0], planned[0]);
  assert.notEqual(spec.views[0].position, planned[0].position);
  const v = validateSceneSpec(JSON.parse(JSON.stringify(spec)));
  assert.deepEqual(v.views, planned);
  assert.notEqual(canonicalJson(v), canonicalJson(validateSceneSpec(JSON.parse(JSON.stringify(compile(undefined))))), 'views are part of the job');
});

test('a malformed view is refused', () => {
  const good = JSON.parse(JSON.stringify(compile([roomView()])));
  const bad = [
    (s) => { s.views[0].fovDeg = null; },
    (s) => { s.views[0].orthoScale = 10; },
    (s) => { s.views[0].fovDeg = SPEC_LIMITS.viewFovDeg[1] + 1; },
    (s) => { s.views[0].fovDeg = null; s.views[0].orthoScale = SPEC_LIMITS.viewOrthoM[1] + 1; },
    (s) => { s.views[0].width = SPEC_LIMITS.viewEdge[1] + 1; },
    (s) => { s.views[0].height = 255; },
    (s) => { s.views[0].height = 512.5; },
    (s) => { s.views[0].samples = SPEC_LIMITS.viewSamples[1] + 1; },
    (s) => { s.views[0].aspect = 5; },
    (s) => { s.views[0].position = [Number.NaN, 0, 0]; },
    (s) => { s.views[0].position = [SPEC_LIMITS.viewCoord + 1, 0, 0]; },
    (s) => { s.views[0].target = [...s.views[0].position]; },
    (s) => { s.views[0].kind = 'DRONE'; },
    (s) => { s.views[0].purpose = 'ART'; },
    (s) => { s.views[0].roomId = 'r-nowhere'; },
    (s) => { s.views[0].cut = { exteriorM: 0.1, interiorM: 1 }; },
    (s) => { s.views[0].hideCeilings = 'yes'; },
    (s) => { s.views[0].objectMap = 1; },
    (s) => { s.views[0].id = 'v room'; },
    (s) => { s.views.push({ ...s.views[0] }); },
    (s) => { s.views = Array(SPEC_LIMITS.views + 1).fill(0).map((_, i) => ({ ...s.views[0], id: `v-${i}` })); },
    (s) => { s.views = 'many'; },
  ];
  for (const mutate of bad) {
    const s = JSON.parse(JSON.stringify(good));
    mutate(s);
    assert.throws(() => validateSceneSpec(s), SpecError, mutate.toString());
  }
});

test('TS and Python spec readers share the view bounds and enums', () => {
  const py = fs.readFileSync(path.join(ROOT, 'infra/design-studio-gpu-worker/worker/spec.py'), 'utf8');
  const pair = (name, [a, b]) => assert.match(py, new RegExp(`"${name}": \\(${a}(\\.0)?, ${b}(\\.0)?\\)`), name);
  assert.match(py, new RegExp(`"views": ${SPEC_LIMITS.views}\\b`));
  pair('view_edge', SPEC_LIMITS.viewEdge);
  pair('view_samples', SPEC_LIMITS.viewSamples);
  pair('view_fov', SPEC_LIMITS.viewFovDeg);
  pair('view_ortho', SPEC_LIMITS.viewOrthoM);
  pair('view_aspect', SPEC_LIMITS.viewAspect);
  assert.match(py, new RegExp(`"view_coord": ${SPEC_LIMITS.viewCoord}(\\.0)?\\b`));
  for (const k of [...VIEW_KINDS, ...VIEW_PURPOSES]) assert.ok(py.includes(`"${k}"`), k);
});

test('the edge signs, verifies and returns every view\'s three files', () => {
  const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/design-studio-reconstruct/factory.ts'), 'utf8');
  assert.match(src, /add\('VIEW', 'VIEW', v\.id\)/);
  assert.match(src, /v\.objectMap \? await signed\('PUT', add\('VIEW_IDS'/);
  assert.match(src, /v\.objectMap \? await signed\('PUT', add\('VIEW_LEGEND'/);
  assert.match(src, /readLegend\(bytes/);
  assert.match(src, /NOT_PNG/);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261007110000_design_studio_factory_views.sql'), 'utf8');
  for (const role of ['VIEW', 'VIEW_IDS', 'VIEW_LEGEND']) assert.ok(sql.includes(`'${role}'`), role);
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/im, 'the runner owns the transaction');
});
