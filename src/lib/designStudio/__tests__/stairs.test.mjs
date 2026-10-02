// STAIRS AND OPENING LEAVES — architecture end to end.
//
// A verified flight becomes a StairMesh (geometry.test.mjs proves that half);
// here: the SpaceModel carries it, the walkthrough cannot walk onto it, no
// piece is placed on it or in front of its first step, its parts are a real
// staircase (treads, risers, stringers, rails on open sides), and the factory
// spec carries it — validated, bounded, and absent when there is none, so a
// spec without stairs hashes exactly as it always did.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateScene } from '../../floorplan/geometry.ts';
import { buildSpaceModel } from '../space.ts';
import { buildDsDocument } from '../scale.ts';
import { autoPlace, evaluatePlacement, obbOverlap, stairApproach, stairObb } from '../placement.ts';
import { searchPlacement } from '../placementSearch.ts';
import { buildWalkModel, isFree, findPath } from '../navigation.ts';
import { stairParts, stairSides, partToPlan } from '../stairParts.ts';
import { compileSceneSpec } from '../hybrid/compileSpec.ts';
import { canonicalJson, SpecError, validateSceneSpec, SPEC_LIMITS } from '../hybrid/sceneSpec.ts';
import { emptyDesignState } from '../designState.ts';
import { oneBedroomDoc, testAssets } from './fixtures.mjs';

const ROOT = process.cwd();

/** The fixture with a 3 m flight along the living room's south wall, climbing east, and leaves on its doors. */
export function stairDoc(over = {}) {
  const doc = oneBedroomDoc();
  return {
    ...doc,
    doors: doc.doors.map((d) => (d.id === 'd-bed' ? { ...d, leaf: 'DOUBLE' } : d.id === 'd-bath' ? { ...d, leaf: 'SLIDING' } : d.id === 'd-hall' ? { ...d, leaf: 'HINGED', swingRoomId: 'r-living' } : d)),
    windows: doc.windows.map((w) => (w.id === 'win-bed' ? { ...w, leaf: 'FIXED' } : w)),
    stairs: [{
      id: 's-1', confidence: 1, state: 'VERIFIED', direction: 'UP', treads: 15,
      polygon: [{ x: 100, y: 585 }, { x: 400, y: 585 }, { x: 400, y: 685 }, { x: 100, y: 685 }],
      startEdge: [{ x: 100, y: 585 }, { x: 100, y: 685 }],
    }],
    ...over,
  };
}

const scene = generateScene(stairDoc()).scene;
const space = buildSpaceModel(scene);
const assets = testAssets();
const living = space.rooms.find((r) => r.id === 'r-living');

test('the space carries the flight; a scene without stairs carries none', () => {
  assert.equal(space.stairs.length, 1);
  const st = space.stairs[0];
  assert.equal(st.runM, 3);
  assert.equal(st.treads, 15);
  assert.ok(Math.abs(Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y) - 1) < 1e-6, 'a 1 m wide flight');
  assert.deepEqual(buildSpaceModel(generateScene(oneBedroomDoc()).scene).stairs, []);
});

test('buildDsDocument keeps the flights the customer kept, accepted, and drops the rejected', () => {
  const raw = stairDoc({ stairs: [{ ...stairDoc().stairs[0], state: 'UNVERIFIED' }, { ...stairDoc().stairs[0], id: 's-2', state: 'UNVERIFIED' }] });
  const kept = buildDsDocument(raw, { rejected: ['s-2'], roomKinds: {} }, 0.01, 2.7);
  assert.deepEqual(kept.stairs.map((s) => [s.id, s.state]), [['s-1', 'CORRECTED']]);
  assert.equal('stairs' in buildDsDocument(oneBedroomDoc(), { rejected: [], roomKinds: {} }, 0.01, 2.7), false);
});

test('a flight is a real staircase: a tread and riser per step, two stringers, a rail on the open side only', () => {
  const st = space.stairs[0];
  const walls = space.walls.map((w) => ({ start: w.mesh.start, end: w.mesh.end, thicknessM: w.mesh.thicknessM }));
  const sides = stairSides(st, walls);
  // The south side runs along the exterior wall; the north side is open.
  const southOpen = st.a.y < st.b.y ? sides.openA : sides.openB;
  const northOpen = st.a.y < st.b.y ? sides.openB : sides.openA;
  assert.equal(southOpen, false);
  assert.equal(northOpen, true);
  const parts = stairParts(st, sides);
  const count = (k) => parts.filter((p) => p.kind === k).length;
  assert.equal(count('TREAD'), 15);
  assert.equal(count('RISER'), 15);
  assert.equal(count('STRINGER'), 2);
  assert.equal(count('RAIL'), 1);
  assert.ok(count('BALUSTER') >= 8 && count('BALUSTER') < 15, 'a baluster per step up to where the rail meets the ceiling');
  assert.equal(count('POST'), 1, 'an UP flight has a newel at its foot only');
  assert.equal(count('WELL'), 5, 'the ceiling hole is lined on four sides and capped');
  // Treads climb evenly from the start edge to the ceiling.
  const treads = parts.filter((p) => p.kind === 'TREAD');
  assert.ok(Math.abs(treads[0].centre[2] + 0.02 - 2.7 / 15) < 1e-3);
  assert.ok(Math.abs(treads.at(-1).centre[2] + 0.02 - 2.7) < 1e-3);
  // Every tread stands inside the footprint (plan), the nosing at most 3 cm proud.
  for (const t of treads) {
    const p = partToPlan(st, t);
    assert.ok(p.x > 0.95 && p.x < 4.05 && p.y > 0.1 && p.y < 1.2, JSON.stringify(p));
  }
  assert.deepEqual(stairParts(st, sides), parts, 'deterministic');
});

test('a DOWN flight descends from the floor at its start edge, guarded round its well', () => {
  const st = { ...space.stairs[0], direction: 'DOWN' };
  const parts = stairParts(st, { openA: true, openB: true });
  const treads = parts.filter((p) => p.kind === 'TREAD');
  const top = treads.reduce((m, t) => (t.centre[2] > m.centre[2] ? t : m));
  assert.ok(Math.abs(top.centre[2] + 0.02) < 1e-3, 'the top tread is level with the floor');
  assert.ok(top.centre[1] < 0.3, '... at the start edge');
  assert.ok(treads.every((t) => t.centre[2] <= 0), 'every step is below the floor');
  assert.ok(parts.some((p) => p.kind === 'GUARD' && p.centre[2] > 0.5), 'a guard at floor level');
  assert.equal(parts.filter((p) => p.kind === 'POST').length, 4);
});

test('the walkthrough walks around a flight, never onto it, and still reaches the far side', () => {
  const model = buildWalkModel(space, [], assets);
  const st = space.stairs[0];
  const box = stairObb(st);
  assert.equal(isFree(model, { x: box.cx, y: box.cy }), false, 'not on the flight');
  assert.equal(isFree(model, { x: 2.5, y: 1.25 }), false, 'not brushing its open side');
  assert.equal(isFree(model, { x: 2.5, y: 1.6 }), true, 'free beside it');
  const route = findPath(model, { x: 0.6, y: 0.6 }, { x: 4.6, y: 0.6 });
  assert.ok(route, 'a way round exists');
  for (const p of route) assert.ok(isFree(model, p), 'every waypoint is free');
});

test('placement: nothing stands on a flight or in front of its first step; a rug may lie before it', () => {
  const st = space.stairs[0];
  const codes = (issues) => issues.map((i) => i.code);
  const on = evaluatePlacement({ space, assets, objects: [] }, assets.get('dev/coffee-table'), { x: 2.5, y: 0.65 }, 0, 'r-living');
  assert.ok(codes(on).includes('ON_STAIRS'));
  assert.ok(on.some((i) => i.severity === 'BLOCK'));
  const approach = stairApproach(st);
  const before = evaluatePlacement({ space, assets, objects: [] }, assets.get('dev/coffee-table'), { x: approach.cx, y: approach.cy + 0.1 }, Math.PI / 2, 'r-living');
  assert.ok(codes(before).includes('BLOCKS_STAIRS'));
  const rug = evaluatePlacement({ space, assets, objects: [] }, assets.get('dev/rug-large'), { x: 0.6 + 0.0, y: 3.0 }, 0, 'r-living');
  assert.ok(!codes(rug).includes('BLOCKS_STAIRS'));
  const keepOut = [stairObb(st), stairApproach(st)];
  for (const code of ['dev/sofa-3', 'dev/sofa-2', 'dev/coffee-table', 'dev/wardrobe', 'dev/kitchen-run']) {
    const auto = autoPlace({ space, assets, objects: [] }, assets.get(code), living);
    if (auto) {
      const fp = { cx: auto.at.x, cy: auto.at.y, hw: assets.get(code).widthM / 2, hd: assets.get(code).depthM / 2, angle: auto.rotation };
      for (const k of keepOut) assert.equal(obbOverlap(fp, k), false, `${code} autoPlace clear of the stairs`);
    }
    const found = searchPlacement({ space, assets, objects: [] }, assets.get(code), living).choice;
    if (found) {
      const fp = { cx: found.at.x, cy: found.at.y, hw: assets.get(code).widthM / 2, hd: assets.get(code).depthM / 2, angle: found.rotation };
      for (const k of keepOut) assert.equal(obbOverlap(fp, k), false, `${code} search clear of the stairs`);
    }
  }
});

const compile = (sp) => compileSceneSpec({
  space: sp, state: emptyDesignState(), assets: new Map(), materials: new Map(),
  source: { kind: 'FLOOR_PLAN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, camera: null,
  outputs: { render: true, scene: true, objects: false },
});

test('the factory spec carries stairs and leaves; without them it is exactly what it was', () => {
  const spec = compile(space);
  assert.equal(spec.stairs.length, 1);
  assert.deepEqual(Object.keys(spec.stairs[0]).sort(), ['a', 'b', 'direction', 'id', 'riseM', 'runM', 'treads']);
  const v = validateSceneSpec(JSON.parse(JSON.stringify(spec)));
  assert.deepEqual(v.stairs, spec.stairs);
  const leaves = Object.fromEntries(v.walls.flatMap((w) => w.openings).filter((o) => o.leaf).map((o) => [o.id, o.leaf]));
  assert.deepEqual(leaves, { 'd-bed': 'DOUBLE', 'd-bath': 'SLIDING', 'd-hall': 'HINGED', 'win-bed': 'FIXED' });
  assert.ok(v.walls.flatMap((w) => w.openings).find((o) => o.id === 'd-hall').swing, 'the drawn swing travels');

  const plain = compile(buildSpaceModel(generateScene(oneBedroomDoc()).scene));
  assert.equal('stairs' in plain, false);
  const vp = validateSceneSpec(JSON.parse(JSON.stringify(plain)));
  assert.equal('stairs' in vp, false, 'absent stays absent: the spec hash is unchanged');
  assert.ok(vp.walls.flatMap((w) => w.openings).every((o) => !('leaf' in o) && !('swing' in o)));
  assert.equal(canonicalJson(vp), canonicalJson(validateSceneSpec(JSON.parse(canonicalJson(plain)))));
});

test('a malformed stair or leaf is refused', () => {
  const good = JSON.parse(JSON.stringify(compile(space)));
  const bad = [
    (s) => { s.stairs[0].treads = 2; },
    (s) => { s.stairs[0].treads = 26; },
    (s) => { s.stairs[0].treads = 12.5; },
    (s) => { s.stairs[0].runM = 0.2; },
    (s) => { s.stairs[0].riseM = 9; },
    (s) => { s.stairs[0].direction = 'SIDEWAYS'; },
    (s) => { s.stairs[0].b = s.stairs[0].a; },
    (s) => { s.stairs[0].id = 'x y'; },
    (s) => { s.stairs = Array(SPEC_LIMITS.stairs + 1).fill(0).map((_, i) => ({ ...s.stairs[0], id: `s-${i}` })); },
    (s) => { s.stairs.push({ ...s.stairs[0] }); },
    (s) => { s.stairs = 'many'; },
    (s) => { s.walls.find((w) => w.openings.length).openings[0].leaf = 'REVOLVING'; },
    (s) => { s.walls.find((w) => w.openings.length).openings[0].swing = 'UP'; },
  ];
  for (const mutate of bad) {
    const s = JSON.parse(JSON.stringify(good));
    mutate(s);
    assert.throws(() => validateSceneSpec(s), SpecError, mutate.toString());
  }
});

test('the worker\'s stairs fixture is what the browser compiles today (Python reads the same spec)', () => {
  const file = path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures/stairs.spec.json');
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(canonicalJson(validateSceneSpec(fixture)), canonicalJson(validateSceneSpec(JSON.parse(JSON.stringify(compile(space))))));
});

test('TS and Python spec readers share the stair bounds', () => {
  const py = fs.readFileSync(path.join(ROOT, 'infra/design-studio-gpu-worker/worker/spec.py'), 'utf8');
  assert.match(py, new RegExp(`"stairs": ${SPEC_LIMITS.stairs}\\b`));
  assert.match(py, new RegExp(`"treads": \\(${SPEC_LIMITS.treads[0]}, ${SPEC_LIMITS.treads[1]}\\)`));
  assert.match(py, new RegExp(`"stair_run": \\(${SPEC_LIMITS.stairRunM[0]}, ${SPEC_LIMITS.stairRunM[1]}(\\.0)?\\)`));
  assert.match(py, new RegExp(`"stair_width": \\(${SPEC_LIMITS.stairWidthM[0]}, ${SPEC_LIMITS.stairWidthM[1]}(\\.0)?\\)`));
  for (const leaf of ['HINGED', 'DOUBLE', 'SLIDING', 'NONE', 'FRENCH', 'FIXED', 'CASEMENT']) assert.ok(py.includes(`"${leaf}"`), leaf);
});

test('the worker\'s stair parts fixture is what stairParts builds today (Python must match it)', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures/stairs.spec.json'), 'utf8'));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures/stairs.parts.json'), 'utf8'));
  const walls = spec.walls.map((w) => ({ start: { x: w.start[0], y: w.start[1] }, end: { x: w.end[0], y: w.end[1] }, thicknessM: w.thicknessM }));
  const s = spec.stairs[0];
  const st = { ...s, a: { x: s.a[0], y: s.a[1] }, b: { x: s.b[0], y: s.b[1] } };
  const sides = stairSides(st, walls);
  assert.deepEqual(fixture, JSON.parse(JSON.stringify({
    sides,
    up: stairParts(st, sides),
    down: stairParts({ ...st, direction: 'DOWN' }, { openA: true, openB: true }),
    walled: stairParts(st, { openA: false, openB: false }),
  })));
});
