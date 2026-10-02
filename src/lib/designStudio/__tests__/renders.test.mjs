// Renders: the camera planner and PropertyDesignDNA, on the golden floor plan as HOMATCH reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { understand } from '../../../../supabase/functions/_shared/designStudio/planRead/understand.ts';
import { buildCanonical } from '../scale.ts';
import { buildSpaceModel, pointInPolygon } from '../space.ts';
import { emptyDesignState } from '../designState.ts';
import { planMasterView, planRoomViews, maxRoomViews, occludedShare, tallPieces, MAX_OCCLUSION } from '../renders/cameras.ts';
import { deriveDNA } from '../renders/dna.ts';
import { dnaKey } from '../renders/contract.ts';
import { DEFAULT_PREFERENCES } from '../planToHome.ts';

const FIX = path.join(process.cwd(), 'tests/fixtures/design-studio');
function loadPgm(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const m = buf.subarray(0, 64).toString('latin1').match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  return { width: Number(m[1]), height: Number(m[2]), data: new Uint8Array(buf.buffer, buf.byteOffset + m[0].length, Number(m[1]) * Number(m[2])) };
}

let cached;
function golden() {
  if (cached) return cached;
  const v1 = JSON.parse(fs.readFileSync(path.join(FIX, 'golden-floorplan.read-v1.json'), 'utf8'));
  const out = understand({ doc: v1.doc, dimensionStrings: v1.dimensionStrings, gray: loadPgm(path.join(FIX, 'golden-floorplan.pgm.gz')) });
  const mpp = out.understanding.constraints.metresPerPx;
  const built = buildCanonical(out.doc, { rejected: [], roomKinds: {} }, { metresPerPx: mpp, geometryState: 'ESTIMATED', uncertainty: 0.01, conflict: false, implied: [] }, 2.7, 'TYPICAL');
  assert.ok(built.ok, JSON.stringify(built.problems));
  cached = buildSpaceModel(built.canonical.scene);
  return cached;
}

const asset = (code, category, w, d, h) => ({ code, category, widthM: w, depthM: d, heightM: h, procedural: { kind: category } });

test('master: one dollhouse view that frames the whole plan, ceilings off, walls cut', () => {
  const space = golden();
  const v = planMasterView(space);
  assert.equal(v.kind, 'MASTER');
  assert.equal(v.hideCeilings, true);
  assert.ok(v.cut && v.cut.exteriorM > 1 && v.cut.exteriorM < 1.6);
  assert.ok(v.orthoScale > 6 && v.orthoScale < 30, String(v.orthoScale));
  assert.ok(v.position[2] > 20, 'from above');
  assert.equal(JSON.stringify(planMasterView(space)), JSON.stringify(v), 'deterministic');
});

test('room views: N different views inside the room at eye level, never duplicates', () => {
  const space = golden();
  const living = space.rooms.find((r) => r.kind === 'LIVING');
  const design = { state: emptyDesignState(), assets: new Map() };
  for (const n of [1, 3, 5]) {
    const views = planRoomViews(space, living.id, n, design);
    assert.ok(views.length >= 1 && views.length <= n, `${n} → ${views.length}`);
    assert.equal(new Set(views.map((v) => v.id)).size, views.length);
    for (const v of views) {
      assert.ok(pointInPolygon({ x: v.position[0], y: v.position[1] }, living.polygon), `${v.id} stands in the room`);
      assert.ok(v.position[2] > 1.3 && v.position[2] < 1.8, 'eye level');
      assert.equal(v.cut, null);
    }
  }
  const max = maxRoomViews(space, living.id, design);
  assert.ok(max >= 3, `a 3 × 6 m living room offers several views (${max})`);
});

test('room views: a person stands clear of the furniture, and the defining piece is framed', () => {
  const space = golden();
  const bed = space.rooms.find((r) => r.kind === 'BEDROOM');
  const c = bed.polygon.reduce((s, p) => ({ x: s.x + p.x / bed.polygon.length, y: s.y + p.y / bed.polygon.length }), { x: 0, y: 0 });
  const state = { ...emptyDesignState(), objects: [{ instanceId: 'b1', assetId: 'bed', roomId: bed.id, position: { x: c.x, y: 0, z: c.y }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false }] };
  const assets = new Map([['bed', asset('bed', 'BED', 1.6, 2.05, 0.95)]]);
  const views = planRoomViews(space, bed.id, 3, { state, assets });
  for (const v of views) assert.ok(Math.hypot(v.position[0] - c.x, v.position[1] - c.y) > 1.2, `${v.id} is not standing in the bed`);
  assert.ok(views.some((v) => v.purpose === 'FUNCTION' || v.purpose === 'MAIN'));
});

test('occlusion: a tall piece in front of the subject blocks the frame; beside it, behind it, or as the subject it does not', () => {
  const eye = [0, 0, 1.55]; const look = [5, 0, 1.25];
  const box = (cx, cy, h = 2.2, rot = 0) => ({ cx, cy, hw: 0.6, hd: 0.3, rot, z0: 0, z1: h });
  assert.ok(occludedShare(eye, look, 55, 1.5, [box(1.0, 0)]) > MAX_OCCLUSION, 'a wardrobe a metre ahead fills the picture');
  assert.equal(occludedShare(eye, look, 55, 1.5, [box(1.0, 4)]), 0, 'beside the view');
  assert.equal(occludedShare(eye, look, 55, 1.5, [box(7.0, 0)]), 0, 'behind the subject');
  assert.equal(occludedShare(eye, look, 55, 1.5, [box(5.0, 0)]), 0, 'the subject itself');
  // Three metres off, broadside (turned: its 1.2 m width across the view) blocks more than end-on: rotation is honoured.
  const broadside = occludedShare(eye, look, 55, 1.5, [box(3.0, 0, 2.2, Math.PI / 2)]);
  const endOn = occludedShare(eye, look, 55, 1.5, [box(3.0, 0)]);
  assert.ok(broadside > endOn && endOn > 0, `${broadside} > ${endOn}`);
  assert.equal(occludedShare(eye, look, 55, 1.5, []), 0);
});

test('room views: no view is taken from behind a wardrobe (tall pieces > 1.8 m checked against every candidate)', () => {
  const space = golden();
  const living = space.rooms.find((r) => r.kind === 'LIVING');
  const c = living.polygon.reduce((s, p) => ({ x: s.x + p.x / living.polygon.length, y: s.y + p.y / living.polygon.length }), { x: 0, y: 0 });
  const plain = planRoomViews(space, living.id, 5, { state: emptyDesignState(), assets: new Map() });
  // A wardrobe right in front of where the first view stood, facing its subject.
  const v0 = plain[0];
  const dx = v0.target[0] - v0.position[0]; const dy = v0.target[1] - v0.position[1]; const n = Math.hypot(dx, dy);
  const at = { x: v0.position[0] + (dx / n) * 1.0, y: v0.position[1] + (dy / n) * 1.0 };
  const state = { ...emptyDesignState(), objects: [{ instanceId: 'w1', assetId: 'wardrobe', roomId: living.id, position: { x: at.x, y: 0, z: at.y }, rotationY: Math.atan2(dy, dx) + Math.PI / 2, materialVariant: null, colorOverride: null, locked: false }] };
  const assets = new Map([['wardrobe', asset('wardrobe', 'WARDROBE', 1.6, 0.6, 2.2)]]);
  const tall = tallPieces(living, state, assets);
  assert.equal(tall.length, 1);
  assert.ok(occludedShare([v0.position[0], v0.position[1], v0.position[2]], v0.target, v0.fovDeg, v0.aspect, tall) > MAX_OCCLUSION, 'the old first view would be blocked');
  const views = planRoomViews(space, living.id, 5, { state, assets });
  assert.ok(views.length >= 1);
  for (const v of views) assert.ok(occludedShare(v.position, v.target, v.fovDeg, v.aspect, tall) <= MAX_OCCLUSION, `${v.id} sees past the wardrobe`);
  // A low piece in the same place blocks nothing.
  const low = new Map([['wardrobe', asset('wardrobe', 'SOFA', 1.6, 0.6, 0.9)]]);
  assert.equal(tallPieces(living, state, low).length, 0);
  assert.ok(c);
});

test('DNA: the applied design read back once; the same design is the same DNA', () => {
  const space = golden();
  const state = emptyDesignState();
  const living = space.rooms.find((r) => r.kind === 'LIVING');
  state.surfaces[`floor:${living.id}`] = { materialId: 'mat-oak', color: null, finish: null };
  for (const s of space.surfaces.filter((x) => x.kind === 'WALL' && x.roomId === living.id)) state.surfaces[s.id] = { materialId: null, color: '#efe6d8', finish: null };
  const materials = new Map([['mat-oak', { id: 'mat-oak', pbr: { baseColor: '#c9a77c' } }]]);
  const a = deriveDNA({ preferences: { ...DEFAULT_PREFERENCES, style: 'japandi' }, state, space, materials, sourceJobId: 'job-1' });
  assert.equal(a.finishes.floor.materialId, 'mat-oak');
  assert.equal(a.finishes.floor.color, '#c9a77c');
  assert.equal(a.finishes.walls.color, '#efe6d8');
  assert.ok(a.look.some((w) => /japandi/i.test(w)));
  assert.ok(!a.look.some((w) => /\b(wall|room|window|door)s? (moved|larger|wider)\b/i.test(w)), 'no geometry in the look');
  const b = deriveDNA({ preferences: { ...DEFAULT_PREFERENCES, style: 'japandi' }, state, space, materials, sourceJobId: 'job-1' });
  assert.equal(dnaKey(a), dnaKey(b));
});

import { actionsFor, applyEdit, affectedViews, isAppearance } from '../renders/edits.ts';
import { validateOperation } from '../operations.ts';

function sofaDesign() {
  const space = golden();
  const living = space.rooms.find((r) => r.kind === 'LIVING');
  const c = living.polygon.reduce((s, p) => ({ x: s.x + p.x / living.polygon.length, y: s.y + p.y / living.polygon.length }), { x: 0, y: 0 });
  const sofa = { code: 'dev/sofa-3', category: 'SOFA', widthM: 2.0, depthM: 0.9, heightM: 0.8, procedural: { kind: 'SOFA' }, active: true,
    capabilities: ['MOVABLE', 'ROTATABLE', 'REPLACEABLE'], materialSlots: [{ id: 'body', defaultColor: '#cfc6b8' }], variants: [], clearanceM: 0, placement: 'FLOOR', anchor: 'WALL', roomKinds: [] };
  const assets = new Map([[sofa.code, sofa]]);
  const ctx = { space, assets, materials: new Map() };
  const make = (x, y) => ({ instanceId: 's1', assetId: sofa.code, roomId: living.id, position: { x, y: 0, z: y }, rotationY: 0, materialVariant: null, colorOverride: null, locked: false });
  // A spot the engine itself accepts, with room to move 0.3 m north (the room is L-shaped; its centroid is on the stairs).
  const xs = living.polygon.map((p) => p.x); const ys = living.polygon.map((p) => p.y);
  let spot = null;
  for (let y = Math.min(...ys) + 0.6; y < Math.max(...ys) - 0.6 && !spot; y += 0.25) {
    for (let x = Math.min(...xs) + 0.6; x < Math.max(...xs) - 0.6 && !spot; x += 0.25) {
      const ok = (yy) => !validateOperation(emptyDesignState(), { type: 'ADD_OBJECT', object: make(x, yy) }, ctx);
      if (ok(y) && ok(y + 0.3)) spot = { x, y };
    }
  }
  assert.ok(spot, 'a legal spot for a sofa in the living room');
  const state = { ...emptyDesignState(), objects: [make(spot.x, spot.y)] };
  return { space, living, state, assets, c: spot, ctx };
}

test('edits: a sofa offers colour, replace, move, rotate, remove; a wall offers paint; locks remove choices', () => {
  const { state, assets, living } = sofaDesign();
  const sofa = { color: '#010203', kind: 'OBJECT', id: 's1', roomId: living.id, coverage: 0.02, box: [0, 0, 1, 1] };
  assert.deepEqual(actionsFor(sofa, state, assets), ['COLOR', 'REPLACE', 'MOVE', 'ROTATE', 'REMOVE']);
  const wall = { color: '#040506', kind: 'WALL', id: 'wall:w1:L:r1', roomId: living.id, coverage: 0.1, box: [0, 0, 1, 1] };
  assert.deepEqual(actionsFor(wall, state, assets), ['PAINT', 'MATERIAL']);
  assert.deepEqual(actionsFor(wall, { ...state, locks: { ...state.locks, walls: true } }, assets), []);
  assert.deepEqual(actionsFor({ ...sofa, id: 'nope' }, state, assets), []);
  assert.ok(isAppearance('COLOR') && !isAppearance('MOVE'));
});

test('edits: a colour edit changes the design itself (what the walkthrough is built from)', () => {
  const { state, ctx, living } = sofaDesign();
  const r = applyEdit({ color: '#010203', kind: 'OBJECT', id: 's1', roomId: living.id, coverage: 0.02, box: [0, 0, 1, 1] }, { action: 'COLOR', color: '#2f4f3a' }, state, ctx, 'dark green');
  assert.ok(r.ok);
  assert.equal(r.kind, 'APPEARANCE');
  assert.equal(r.state.objects[0].colorOverride, '#2f4f3a');
  assert.equal(state.objects[0].colorOverride, null, 'the previous version is not mutated');
});

test('edits: a move is validated like any edit — through a wall is refused, inside the room is accepted', () => {
  const { state, ctx, living, c } = sofaDesign();
  const entry = { color: '#010203', kind: 'OBJECT', id: 's1', roomId: living.id, coverage: 0.02, box: [0, 0, 1, 1] };
  const far = applyEdit(entry, { action: 'MOVE', to: { x: c.x + 40, y: c.y }, roomId: null }, state, ctx, '');
  assert.equal(far.ok, false);
  const near = applyEdit(entry, { action: 'MOVE', to: { x: c.x, y: c.y + 0.3 }, roomId: living.id }, state, ctx, '');
  assert.ok(near.ok, JSON.stringify(near.rejection ?? null));
  assert.equal(near.kind, 'SPATIAL');
  assert.ok(Math.abs(near.state.objects[0].position.z - (c.y + 0.3)) < 1e-9);
});

test('edits: only the views that show the target are redone; a move also redoes the master', () => {
  const legendWith = (id) => ({ width: 10, height: 10, entries: [{ color: '#000001', kind: 'OBJECT', id, roomId: null, coverage: 0.05, box: [0, 0, 1, 1] }] });
  const views = [
    { view: { id: 'master', kind: 'MASTER', roomId: null }, legend: legendWith('other') },
    { view: { id: 'r1-v1', kind: 'ROOM', roomId: 'r1' }, legend: legendWith('s1') },
    { view: { id: 'r2-v1', kind: 'ROOM', roomId: 'r2' }, legend: legendWith('other') },
  ];
  assert.deepEqual(affectedViews({ type: 'APPEARANCE', targetId: 's1', targetKind: 'OBJECT', color: '#000', materialId: null, label: '' }, views), ['r1-v1']);
  assert.deepEqual(affectedViews({ type: 'SPATIAL', targetId: 's1', op: 'MOVE', detail: {} }, views, 'r2').sort(), ['master', 'r1-v1', 'r2-v1']);
});

test('edits: a recoloured piece drops its baked factory model; a moved one keeps it', () => {
  const { state, ctx, living, c } = sofaDesign();
  const baked = { ...state, objects: state.objects.map((o) => ({ ...o, generated: { assetId: 'a', key: 'k', sha256: null } })) };
  const entry = { color: '#010203', kind: 'OBJECT', id: 's1', roomId: living.id, coverage: 0.02, box: [0, 0, 1, 1] };
  const recol = applyEdit(entry, { action: 'COLOR', color: '#2f4f3a' }, baked, ctx, '');
  assert.ok(recol.ok && !recol.state.objects[0].generated);
  const moved = applyEdit(entry, { action: 'MOVE', to: { x: c.x, y: c.y + 0.3 }, roomId: living.id }, baked, ctx, '');
  assert.ok(moved.ok && moved.state.objects[0].generated);
});
