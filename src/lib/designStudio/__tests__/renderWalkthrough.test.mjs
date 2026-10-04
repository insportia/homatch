// THE WALKTHROUGH FURNISHED FROM THE SELECTED RENDER: the reading made buildable (readingRepair.ts), the pieces
// carried and built as seen (renderPlan.ts), turned to their context (facing.ts), walked (build.ts anchorsAsSeen)
// and judged (renderGate.ts). Synthetic data only.
//
// Fixture (fixtures.mjs oneBedroomScene), plan metres: living x 0–6, y 0–7; bedroom x 6–10, y 3–7; bath x 6–8,
// y 0–3; hall x 8–10, y 0–3. Doors: bedroom (x = 6, y = 5), living↔bath (x = 6, y = 1.5), entry (x = 10, y = 1.5).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel } from '../space.ts';
import { emptyDesignState } from '../designState.ts';
import { evaluatePlacement } from '../placement.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { correctFacing, facingFindings } from '../walkthrough/facing.ts';
import { clearOpenings, fitOpenings } from '../walkthrough/readingRepair.ts';
import { dressBuilt, fitToWalls, joinKitchenRuns, RENDER_WALK_RADIUS_M } from '../walkthrough/renderPlan.ts';
import { renderGate } from '../walkthrough/renderGate.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const base = testAssets();
const extra = (code, category, subcategory, w, d, h, over = {}) => ({
  ...base.get('dev/coffee-table'), id: `id-${code}`, code, name: code, category, subcategory, widthM: w, depthM: d, heightM: h, ...over,
});
const assets = new Map([
  ...base,
  ...[
    extra('dev/dining-table', 'TABLE', 'DINING', 0.9, 0.9, 0.75),
    extra('dev/dining-chair', 'CHAIR', 'DINING', 0.5, 0.5, 0.85),
    extra('dev/armchair', 'ARMCHAIR', null, 0.8, 0.8, 0.8),
  ].map((a) => [a.code, a]),
]);
const materialsById = testMaterials();
const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
const lighting = { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 };
const deg = (r) => (r * 180) / Math.PI;
const front = (r) => ({ x: -Math.sin(r), y: Math.cos(r) });

const piece = (key, type, at, facingDeg, w, d, over = {}) => ({
  key, type, label: key, room: 'living', at, facingDeg, widthM: w, depthM: d, heightM: 0.9, color: null, material: null, style: null,
  confidence: 0.9, basis: 'OBSERVED', seenIn: [0], px: null, geometry: 'PIXELS', ...over,
});
const obj = (instanceId, assetId, x, y, rotationY, roomId, type, over = {}) => ({
  instanceId, assetId, roomId, position: { x, y: 0, z: y }, rotationY, materialVariant: null, colorOverride: null, locked: false,
  provenance: { source: 'IMAGE_RECONSTRUCTION', ref: instanceId, label: instanceId, detectedType: type, images: [], confidence: 0.9, basis: 'OBSERVED', match: 0.9, approximate: false, confirmed: false },
  ...over,
});
const state = (objects) => ({ ...emptyDesignState(), objects });

// ── Kitchen runs meeting in a corner ────────────────────────────────────────

test('an L kitchen read as two full-length runs: the run poking into the other is shortened, its wall end kept', () => {
  // Run A along the west wall (front east), read to the full wall length; run B along the north wall (front south).
  const a = piece('a', 'KITCHEN_RUN', [0.45, 4.75], 90, 4.5, 0.6);
  const b = piece('b', 'KITCHEN_RUN', [1.5, 6.55], 180, 2.6, 0.6);
  const [ja, jb] = joinKitchenRuns([a, b]);
  assert.deepEqual(jb, b, 'the corner belongs to one run, unchanged');
  // A ends just short of B's footprint (B spans y 6.25..6.85), its south end exactly where it was read.
  assert.ok(Math.abs((ja.at[1] + ja.widthM / 2) - 6.24) < 0.011, JSON.stringify(ja));
  assert.ok(Math.abs((ja.at[1] - ja.widthM / 2) - (a.at[1] - a.widthM / 2)) < 1e-6);
  assert.equal(ja.at[0], a.at[0]);
});

test('runs that do not meet, or are not perpendicular, are left alone', () => {
  const a = piece('a', 'KITCHEN_RUN', [0.45, 2], 90, 2, 0.6);
  const b = piece('b', 'KITCHEN_RUN', [3, 6.55], 180, 2, 0.6);
  const c = piece('c', 'KITCHEN_RUN', [3, 0.45], 0, 2, 0.6);
  assert.deepEqual(joinKitchenRuns([a, b, c]), [a, b, c]);
});

// ── Built-ins against their wall ────────────────────────────────────────────

test('a kitchen run read longer than its wall is cut to the wall; a wardrobe overrunning it moves along instead', () => {
  // Living north wall runs x 0..6 (inner faces at x ≈ 0.125 and 5.95): a 6.4 m run centred at 3 overruns both ends.
  const run = piece('run', 'KITCHEN_RUN', [3, 6.55], 180, 6.4, 0.6);
  // A 1.2 m wardrobe centred 0.4 m from the west wall overruns it by ~0.3 m.
  const ward = piece('ward', 'WARDROBE', [0.4, 4], 90, 1.2, 0.6, { facingDeg: 0, at: [0.4 + 0.2, 6.6] });
  const { objects, fitted } = fitToWalls([run, ward], space);
  const [r, w] = objects;
  assert.ok(r.widthM < 6 && r.widthM > 5.6, `run cut to the wall: ${r.widthM}`);
  assert.equal(w.widthM, 1.2, 'the wardrobe keeps its size');
  assert.ok(w.at[0] - 0.6 >= 0.12, `and stands clear of the west wall: ${w.at}`);
  assert.deepEqual(fitted.map((f) => f.key).sort(), ['run', 'ward']);
});

// ── Doors made doors again ──────────────────────────────────────────────────

const recon = (openings, objects = []) => ({
  version: 't', view: 'AERIAL', scaleConfidence: 1, scaleEvidence: null, ceilingHeightM: null,
  rooms: [
    { key: 'hall', kind: 'HALL', label: 'hall', polygon: [[0, 3], [6, 3], [6, 5], [0, 5]], outdoor: false, confidence: 0.9, basis: 'OBSERVED' },
    { key: 'wc', kind: 'BATHROOM', label: 'wc', polygon: [[2, 0], [3, 0], [3, 3], [2, 3]], outdoor: false, confidence: 0.9, basis: 'OBSERVED' },
    { key: 'bath', kind: 'BATHROOM', label: 'bath', polygon: [[0, 0], [2, 0], [2, 3], [0, 3]], outdoor: false, confidence: 0.9, basis: 'OBSERVED' },
  ],
  openings, objects, surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [], usesPlan: false, fidelity: null,
});
const door = (key, at, widthM, over = {}) => ({ key, kind: 'DOOR', at, widthM, heightM: 2.05, sillM: 0, confidence: 0.8, basis: 'OBSERVED', geometry: 'PIXELS', ...over });

test('a door read across the end of a partition is moved along its wall until it fits between the partitions', () => {
  // The 1 m wide WC (x 2..3) has a 0.8 m door read at x 2.35: it reaches x 1.95, into the bath partition.
  const { recon: out, repairs } = fitOpenings(recon([door('wcdoor', [2.35, 3.02], 0.8)]));
  const d = out.openings[0];
  assert.ok(d.at[0] - d.widthM / 2 >= 2.1 - 1e-9 && d.at[0] + d.widthM / 2 <= 2.9 + 1e-9, JSON.stringify(d));
  assert.equal(repairs[0].code, 'DOOR_FITTED');
});

test('a traced door slides out of a piece standing in its passage (at most 0.6 m); a piece beside it does not move it', () => {
  const ward = { ...piece('ward', 'WARDROBE', [4.8, 3.3], 0, 0.6, 0.6), room: 'hall' };
  const inPassage = clearOpenings(recon([door('d', [4.5, 3.0], 0.9)], [ward]));
  assert.equal(inPassage.repairs[0]?.code, 'DOOR_SLID');
  const moved = inPassage.recon.openings[0];
  assert.ok(Math.abs(moved.at[0] - 4.5) <= 0.6 + 1e-9 && moved.at[0] < 4.5, JSON.stringify(moved));
  // Beside the passage (its keep-out only): the traced door stays where it was seen.
  const beside = { ...ward, at: [5.45, 3.3], widthM: 0.5 };
  const kept = clearOpenings(recon([door('d', [4.5, 3.0], 0.9)], [beside]));
  assert.deepEqual(kept.recon.openings[0].at, [4.5, 3.0]);
  assert.equal(kept.repairs.length, 0);
});

// ── A chair drawn up to its table ───────────────────────────────────────────

test('a chair tucked under its table is not a collision; a chair inside the table is', () => {
  const table = obj('t', 'dev/dining-table', 3, 3.5, 0, 'r-living', 'DINING_TABLE');
  const ctx = { space, assets, objects: [table] };
  const chair = assets.get('dev/dining-chair');
  const tucked = evaluatePlacement(ctx, chair, { x: 3, y: 2.8 }, 0, 'r-living');
  assert.ok(!tucked.some((i) => i.code === 'OVERLAPS_OBJECT'), JSON.stringify(tucked));
  const inside = evaluatePlacement(ctx, chair, { x: 3, y: 3.4 }, 0, 'r-living');
  assert.ok(inside.some((i) => i.code === 'OVERLAPS_OBJECT'));
});

// ── Facing ──────────────────────────────────────────────────────────────────

const dining = (chairRot) => state([
  obj('t', 'dev/dining-table', 3, 3.5, 0, 'r-living', 'DINING_TABLE'),
  // Four chairs round a round table, each at 0.68 m.
  ...[[0, -0.68], [0.68, 0], [0, 0.68], [-0.68, 0]].map(([dx, dy], i) => obj(`c${i}`, 'dev/dining-chair', 3 + dx, 3.5 + dy, chairRot(dx, dy), 'r-living', 'CHAIR')),
]);
const toward = (dx, dy) => Math.atan2(-dy, -dx) - Math.PI / 2;

test('dining chairs read facing away from their table are found REVERSED and turned to face it', () => {
  const backwards = dining((dx, dy) => toward(dx, dy) + Math.PI);
  const found = facingFindings(backwards, space, assets);
  assert.equal(found.filter((f) => f.code === 'REVERSED' && f.role === 'SEAT_AT_TABLE').length, 4);
  const { state: fixed, corrections } = correctFacing(backwards, space, assets);
  assert.equal(corrections.length, 4);
  for (const c of fixed.objects.filter((o) => o.assetId === 'dev/dining-chair')) {
    const f = front(c.rotationY);
    const to = { x: 3 - c.position.x, y: 3.5 - c.position.z };
    assert.ok(f.x * to.x + f.y * to.y > 0.67 * Math.hypot(to.x, to.y), `${c.instanceId} faces the table`);
  }
  assert.deepEqual(facingFindings(fixed, space, assets), []);
});

test('a chair set a little askew stays as read; one side-on to its table is turned', () => {
  const askew = dining((dx, dy) => toward(dx, dy) + (20 * Math.PI) / 180);
  assert.deepEqual(facingFindings(askew, space, assets), []);
  const sideOn = dining((dx, dy) => toward(dx, dy) + Math.PI / 2);
  assert.equal(facingFindings(sideOn, space, assets).length, 4);
});

test('an armchair beside its coffee table, turned side-on, is turned to face the table', () => {
  const s = state([
    obj('ct', 'dev/coffee-table', 3, 3.5, 0, 'r-living', 'COFFEE_TABLE'),
    obj('a', 'dev/armchair', 4.4, 3.5, 0, 'r-living', 'ARMCHAIR'), // faces north (+y): side-on to the table
  ]);
  const { state: fixed } = correctFacing(s, space, assets);
  const a = fixed.objects.find((o) => o.instanceId === 'a');
  assert.ok(Math.abs(deg(a.rotationY) - 90) < 1, `faces west, toward the table: ${deg(a.rotationY)}`);
});

// ── The build, as seen ──────────────────────────────────────────────────────

const room = (roomId, items) => ({ roomId, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items });
const seen = (code, refKey, pose, over = {}) => ({ code, type: 'X', pose, scale: 1, color: null, origin: 'PLANNED', refKey, lock: { maxShiftM: 0.35, maxTurnDeg: 12 }, ...over });
const buildSeen = (rooms) => buildWalkthrough({
  space, base: emptyDesignState(), plan: { lighting, palette: [], styleCode: null, rooms },
  assets, materialsByCode, materialsById, idPrefix: 'walk-t', walkRadiusM: RENDER_WALK_RADIUS_M, anchorsAsSeen: true,
});

test('a picture\'s home gets nothing it does not show: no essential piece is added', () => {
  const { state: s, report } = buildSeen([room('r-living', [seen('dev/coffee-table', 'ct', { x: 3, y: 3.5, rotationDeg: 0 })]), room('r-bed', [])]);
  assert.equal(s.objects.length, 1);
  assert.ok(!report.items.some((i) => i.reason === 'ESSENTIAL'));
});

test('a piece seen standing in the bedroom doorway is pushed off the way (recorded), never turned, never dropped', () => {
  // An armchair read right in front of the bedroom door on the living side (x = 6, y = 5).
  const { state: s, report } = buildSeen([room('r-living', [seen('dev/armchair', 'arm', { x: 5.5, y: 5, rotationDeg: 90 })])]);
  const it = report.items.find((i) => i.refKey === 'arm');
  assert.ok(it.instanceId, JSON.stringify(it));
  assert.equal(it.outcome, 'CORRECTED');
  assert.ok(it.movedM > 0 && it.movedM <= 1.05, JSON.stringify(it));
  const a = s.objects.find((o) => o.instanceId === it.instanceId);
  assert.ok(Math.abs(deg(a.rotationY) - 90) <= 20.5, `kept its way of facing: ${deg(a.rotationY)}`);
  assert.equal(report.gate.ok, true, JSON.stringify(report.gate));
});

// ── The gate ────────────────────────────────────────────────────────────────

const lookOf = (type) => ({ shape: null, colorOverride: null, provenance: { source: 'IMAGE_RECONSTRUCTION', ref: 'x', label: 'x', detectedType: type, images: [], confidence: 0.9, basis: 'OBSERVED', match: 0.9, approximate: false, confirmed: false } });
const plan = (looks, over = {}) => ({ plan: { lighting, palette: [], styleCode: null, rooms: [] }, looks: new Map(looks), surfaces: {}, frames: null, corrections: [], fitted: [], unmatched: [], unplaced: [], read: looks.length, traced: looks.length, ...over });
const report = (objects) => ({
  items: objects.map((o) => ({ roomId: o.roomId, code: o.assetId, type: 'X', instanceId: o.instanceId, outcome: 'PLANNED', reason: null, movedM: 0, warnings: [], refKey: o.instanceId })),
  finishes: [], circulation: { checked: [], reachableBefore: [], reachableAfter: [], repaired: [] }, counts: { planned: objects.length, corrected: 0, placed: 0, dropped: 0 },
});
const gate = (objects, looks) => renderGate({ space, state: state(objects), assets, build: report(objects), plan: plan(looks), walkRadiusM: RENDER_WALK_RADIUS_M, corrections: [] });

test('the gate promotes a faithful, walkable home', () => {
  const s = dining((dx, dy) => toward(dx, dy)).objects;
  const g = gate(s, s.map((o) => [o.instanceId, lookOf(o.provenance.detectedType)]));
  assert.equal(g.visual.pass, true, JSON.stringify(g.visual));
  assert.equal(g.navigation.pass, true, JSON.stringify(g.navigation));
  assert.equal(g.promoted, true);
});

test('the gate rejects reversed furniture', () => {
  const s = dining((dx, dy) => toward(dx, dy) + Math.PI).objects;
  const g = gate(s, s.map((o) => [o.instanceId, lookOf(o.provenance.detectedType)]));
  assert.equal(g.promoted, false);
  assert.ok(g.visual.reasons.includes('FURNITURE_REVERSED'), JSON.stringify(g.visual));
});

test('the gate rejects a blocked doorway and an unreachable room', () => {
  // Wardrobes standing across both bedroom doorways, on the bedroom side.
  const s = [obj('w', 'dev/wardrobe', 6.35, 5, -Math.PI / 2, 'r-bed', 'WARDROBE'), obj('w2', 'dev/wardrobe', 9, 3.35, 0, 'r-bed', 'WARDROBE')];
  const g = gate(s, [['w', lookOf('WARDROBE')], ['w2', lookOf('WARDROBE')]]);
  assert.equal(g.navigation.pass, false);
  assert.ok(g.navigation.reasons.includes('DOOR_BLOCKED'), JSON.stringify(g.navigation));
  assert.ok(g.navigation.unreachable.includes('r-bed'), JSON.stringify(g.navigation));
  assert.equal(g.promoted, false);
});

test('the gate rejects a home whose important pieces are missing', () => {
  const s = dining((dx, dy) => toward(dx, dy)).objects.slice(0, 2);
  const looks = [...s.map((o) => [o.instanceId, lookOf(o.provenance.detectedType)]), ['bed', lookOf('BED_DOUBLE')], ['sofa', lookOf('SOFA')], ['c9', lookOf('CHAIR')]];
  const g = gate(s, looks);
  assert.ok(g.visual.reasons.includes('IMPORTANT_PIECES_MISSING'), JSON.stringify(g.visual));
  assert.equal(g.promoted, false);
});

// ── Dressing ────────────────────────────────────────────────────────────────

test('dressing a built piece keeps the size its walk was proven at, with the render\'s form and colour', () => {
  const built = state([obj('walk-1', 'dev/armchair', 3, 3.5, 0, 'r-living', 'ARMCHAIR', { provenance: undefined, shape: { widthM: 0.68, depthM: 0.68, heightM: 0.8, form: null, secondary: null } })]);
  const rp = plan([['arm', { shape: { widthM: 0.8, depthM: 0.8, heightM: 0.8, form: 'ROUNDED', secondary: '#123456' }, colorOverride: '#4b4a2c', provenance: lookOf('ARMCHAIR').provenance }]]);
  const { state: dressed } = dressBuilt(built, [{ refKey: 'arm', instanceId: 'walk-1' }], rp, space, assets);
  const a = dressed.objects[0];
  assert.equal(a.shape.widthM, 0.68);
  assert.equal(a.shape.form, 'ROUNDED');
  assert.equal(a.colorOverride, '#4b4a2c');
});
