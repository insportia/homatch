// A REAL FLOOR PLAN'S TOUR, END TO END (no model call): the geometry HOMATCH read from a customer's two-bedroom plan
// (labels removed) and the design graph made from its generated render, built by the same code the server runs
// (designGraph.ts graphToBuildPlan → build.ts buildWalkthrough → fidelityOf) and walked by the tour (tour.ts).
// It reproduces the first real tour's failures — the sofa, armchairs and coffee table removed, a 1.2 m bathroom
// without its toilet, a wardrobe dropped — and holds what was fixed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSpaceModel } from '../space.ts';
import { buildWalkModel } from '../navigation.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { applyGraphLook, fidelityOf, graphToBuildPlan, READY_MIN_RECALL } from '../walkthrough/designGraph.ts';
import { planTour } from '../tour.ts';
import { emptyDesignState } from '../designState.ts';
import { doorKeepOut, evaluateInWorld, placementWorld } from '../placement.ts';
import { prodAssets } from './fixtures/devCatalogue.mjs';
import { distanceToObb } from '../navigation.ts';
import { frontOf } from '../placement.ts';
import { entryShot, STANCE_CLEAR_M } from '../cameraDirector.ts';
import { backGap, plausibility, WALL_BACK_GAP_M } from '../walkthrough/plausibility.ts';
import { planFidelity } from '../walkthrough/planFidelity.ts';
import { TV_VIEW_MAX_M, TV_VIEW_MIN_M } from '../walkthrough/seatingGroup.ts';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const space = buildSpaceModel(read('two-bed-small-wet-rooms.scene.json'));
const graph = read('two-bed-small-wet-rooms.graph.json');
const assets = prodAssets();

function build() {
  const plan = { ...graphToBuildPlan(graph, space, [], assets), styleCode: null };
  const built = buildWalkthrough({ space, base: emptyDesignState(), assets, materialsByCode: new Map(), materialsById: new Map(), idPrefix: 'w', plan });
  const state = applyGraphLook(graph, space, built.state, built.report, assets);
  return { built, state, promotion: fidelityOf(graph, state, built.report, built.report.gate?.ok !== false) };
}

test('the real plan\'s tour: walkable everywhere, every room with its essential piece, most of the design kept', () => {
  const { built, state, promotion } = build();
  assert.equal(built.report.gate.ok, true, JSON.stringify(built.report.gate));
  assert.deepEqual(built.report.gate.missingEssential, []);
  const standing = (ref) => built.report.items.find((i) => i.refKey === ref)?.instanceId;
  // What the first real tour lost and must keep now: the sofa, both beds, both wardrobes, the toilet, the vanity.
  for (const ref of ['ai:sofa:1', 'ai:bed:1', 'ai:bed:2', 'wardrobe:1', 'wardrobe:2', 'ai:toilet:1', 'vanity:1', 'ai:tv_unit:1', 'kitchen_cabinets:2', 'ai:dining_table:1']) {
    assert.ok(standing(ref), `${ref} stands`);
  }
  // The render's kitchen run was read twice (kitchen_cabinets:1 and :2): ONE run stands, the plan's own, and the
  // render's run counts as shown by it.
  const twin = built.report.items.find((i) => i.refKey === 'kitchen_cabinets:1');
  assert.deepEqual([twin.outcome, twin.reason], ['DROPPED', 'REDUNDANT']);
  assert.ok(!promotion.metrics.unresolvedImportant.includes('kitchen_cabinets:1'));
  assert.ok(promotion.metrics.importantRecall >= READY_MIN_RECALL, `recall ${promotion.metrics.importantRecall}`);
  // The visitor's tour reaches every room, the balcony and the porch included.
  const tour = planTour(space, buildWalkModel(space, state.objects, assets));
  assert.deepEqual([...tour.reachable].sort(), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);
});

test('a flight\'s approach never reaches through a wall; a door in a shallow room keeps its step clear, not the whole room', () => {
  // The stair here starts against the WC/bath wall: its approach would be their floor. It is not kept.
  const bath = space.rooms.find((r) => r.id === 'R6');
  const world = placementWorld({ space, assets, objects: [] }, bath);
  assert.ok(world.stairs.every((st) => st.approach === null));
  const toilet = assets.get('dev/toilet');
  assert.ok(!evaluateInWorld(world, toilet, { x: 1.87, y: 6.35 }, 0).some((i) => i.code === 'BLOCKS_STAIRS'));
  // The bath door in a 1.19 m deep room keeps 0.54 m clear inside it; a deep room keeps the full 0.9 m.
  const door = space.doors.find((d) => d.id === 'hm-door3');
  assert.equal(doorKeepOut(space, door.id, bath).hd.toFixed(2), '0.54');
  assert.equal(doorKeepOut(space, door.id, space.rooms.find((r) => r.id === 'R7')).hd, 0.9);
  assert.equal(doorKeepOut(space, door.id).hd, 0.9);
});

test('the server publishes only a walkthrough that is the design too (READY_MIN_RECALL, every room\'s essential piece)', () => {
  const route = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(route, /const unfaithful = promotion && \(built\.report\.gate\?\.missingEssential\?\.length \|\| \(promotion\.metrics\?\.importantRecall \?\? 1\) < READY_MIN_RECALL\);/);
  assert.match(route, /'NOT_WALKABLE' : unfaithful \? 'NOT_FAITHFUL' : implausible;/);
  // ... and one a person would believe (plausibility.ts), and that does not contradict the plan (planFidelity.ts).
  assert.match(route, /const implausible = built\.report\.gate\?\.implausible\?\.length \? 'NOT_PLAUSIBLE' : null;/);
  assert.match(route, /if \(planCheck\?\.some\(\(f\) => f\.severity === 'BLOCK'\)\) \{\n\s+await fail\(admin, row, 'GEOMETRY_UNRELIABLE'/);
});

// ── The second real tour (published before the plausibility gate): what the customer walked, measured ──────────
// Both beds stood 0.45 m off their walls, the sofa floated 0.85 m from any wall and faced away from the television
// (the plan's own coffee table and an armchair were dropped one by one, the other armchair pushed against the TV).

test('the published tour fails the plausibility the gate now asks for — four findings, measured', () => {
  const published = read('two-bed-small-wet-rooms.published.json').objects;
  const found = plausibility(space, published, assets, buildWalkModel(space, published, assets));
  assert.deepEqual(found.map((f) => `${f.code}:${f.roomId}`).sort(), [
    'SOFA_FACES_AWAY:R7', 'WALL_PIECE_FREE_STANDING:R2', 'WALL_PIECE_FREE_STANDING:R3', 'WALL_PIECE_FREE_STANDING:R7',
  ]);
});

test('the rebuilt tour: no finding, the living room a group, every way kept as pieces stand (no repair needed)', () => {
  const { built, state } = build();
  assert.deepEqual(built.report.gate.implausible, [], JSON.stringify(built.report.gate.implausible));
  // Wall pieces against their walls.
  for (const o of state.objects) {
    const a = assets.get(o.assetId);
    if (!a || a.anchor !== 'WALL' || a.heightM < 0.3) continue;
    assert.ok(backGap(space, a, { x: o.position.x, y: o.position.z }, o.rotationY) <= WALL_BACK_GAP_M, `${o.assetId} in ${o.roomId} against its wall`);
  }
  // The living room: the sofa faces the television, the coffee table between them.
  const at = (code) => state.objects.find((o) => o.roomId === 'R7' && o.assetId === code);
  const sofa = at('dev/sofa-3'); const tv = at('dev/tv-unit'); const table = at('dev/coffee-table');
  assert.ok(sofa && tv && table, 'sofa, television and coffee table stand');
  const f = frontOf(sofa.rotationY);
  const along = (o) => (o.position.x - sofa.position.x) * f.x + (o.position.z - sofa.position.z) * f.y;
  assert.ok(along(tv) >= TV_VIEW_MIN_M && along(tv) <= TV_VIEW_MAX_M, `TV ${along(tv).toFixed(2)} m ahead`);
  assert.ok(along(table) > 0 && along(table) < along(tv), 'the table between the sofa and the TV');
  for (const ref of ['ai:sofa:1', 'ai:tv_unit:1', 'ai:coffee_table:1']) {
    assert.equal(built.report.items.find((i) => i.refKey === ref)?.reason, 'GROUP_ARRANGED', ref);
  }
  // Walkways first: no piece had to be removed afterwards to reopen a way.
  assert.deepEqual(built.report.circulation.repaired, []);
  // Both bedrooms keep their wardrobe (the first-come nightstand never wins a way over it).
  for (const ref of ['wardrobe:1', 'wardrobe:2']) assert.ok(built.report.items.find((i) => i.refKey === ref)?.instanceId, ref);
  // The visitor arrives in open floor.
  const walk = buildWalkModel(space, state.objects, assets);
  const shot = entryShot(space, walk);
  assert.ok(Math.min(...walk.furniture.map((b) => distanceToObb(shot.position, b))) >= STANCE_CLEAR_M);
});

test('the plan says what the 3D shows: no contradiction, and the drawing\'s ambiguities reported, not "fixed"', () => {
  const scene = read('two-bed-small-wet-rooms.scene.json');
  // The reading's own evidence for this plan (fusion wall ink; written dimensions vs measured).
  const wallInk = { E1: 1, E2: 0.7, E3: 1, E4: 0.97, E5: 0.69, E6: 0.74, I1: 1, I2: 0.69, I3: 0.4, I4: 0.31, I5: 0.98, I6: 0.98, I7: 0.39, I8: 0.99 };
  const found = planFidelity(scene, { wallInk, dimensionChecks: [{ elementId: 'R9', residualPct: 37.5, text: "10'X8'" }, { elementId: 'R2', residualPct: 1.2 }] });
  assert.deepEqual(found.filter((f) => f.severity === 'BLOCK'), []);
  assert.deepEqual(found.map((f) => `${f.code}:${f.elementIds[0]}`).sort(), [
    'DIMENSION_MISMATCH:R9', 'STAIR_ENCLOSED:S1', 'WALL_WEAK_EVIDENCE:I3', 'WALL_WEAK_EVIDENCE:I4', 'WALL_WEAK_EVIDENCE:I7',
  ]);
  // A doorway crossed by a partition, and an opening past its wall's end, contradict the plan: they block.
  const broken = structuredClone(scene);
  const i2 = broken.walls.find((w) => w.id === 'I2');
  i2.openings.find((o) => o.id === 'D2').offsetM = 3.15 - i2.start.x; // centred on I1, the bedrooms' partition
  broken.walls.find((w) => w.id === 'E5').openings.find((o) => o.id === 'D6').offsetM = 3.0; // past E5's end
  const blocks = planFidelity(broken).filter((f) => f.severity === 'BLOCK').map((f) => `${f.code}:${f.elementIds.join('/')}`).sort();
  assert.deepEqual(blocks, ['DOOR_HITS_WALL:D2/I1', 'OPENING_OUTSIDE_WALL:D6/E5']);
});

test('a reused plan brings the graph it was built with; a failed evidence load is recorded, never swallowed', () => {
  // Production (2026-10-10): a tour reusing a READY tour's plan rebuilt the graph from the picture's pixels, the load
  // failed silently (.catch(() => null)), and the walk fell back to the plan-only path: 11 pieces dropped, 3 rooms cut off.
  const route = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(route, /graph:plan_report->designGraph->graph/);
  assert.match(route, /reusedGraph = w\?\.state === 'READY' \? graphOf\(/);
  assert.match(route, /const graph: SpatialDesignGraph \| null = reusedGraph && reused \? reusedGraph :/);
  assert.match(route, /\.catch\(\(e\) => \{ evidenceError = /);
  assert.doesNotMatch(route, /loadDesignEvidence\([^)]*\)\.catch\(\(\) => null\)/);
  assert.match(route, /\.\.\.\(designGraphError \? \{ designGraphError \} : \{\}\)/);
  assert.match(route, /\.sort\(\(p: Row, q: Row\) => Number\(!!q\.graph\) - Number\(!!p\.graph\)\)\[0\]/);
});

// ── The third real tour (2026-10-10): what the customer still could not walk or believe ─────────────────────────
// The WC ("LET.") stood empty and the bath ("BATH") held the toilet and lost its shower; the render's kitchen run,
// read twice, stood on both walls (two sinks, two hobs) with the table pushed against both counters; the second
// bedroom's wardrobe stood 5 cm from the bed.

import { frontZone, footprint, solidBox, solidOverlap } from '../placement.ts';
import { isFlat } from '../catalog.ts';
import { shapedAsset } from '../objectShape.ts';

/** Free floor before a piece (m): the deepest front zone, in 5 cm steps, that no other standing piece enters. */
function freeFront(objects, o) {
  const pieces = objects.map((x) => ({ x, a: shapedAsset(assets.get(x.assetId), x) })).filter((p) => p.a && !isFlat(p.a));
  const own = shapedAsset(assets.get(o.assetId), o);
  let free = 0;
  for (let r = 0.05; r <= 1.5 + 1e-9; r += 0.05) {
    const z = frontZone(own, { x: o.position.x, y: o.position.z }, o.rotationY, r);
    if (pieces.some((p) => p.x !== o && solidOverlap(z, solidBox(footprint(p.a, { x: p.x.position.x, y: p.x.position.z }, p.x.rotationY))))) break;
    free = r;
  }
  return free;
}

test('the wet rooms are the plan\'s: the toilet in the WC, the shower in the bath (a tray fitted to its 1.2 m room)', () => {
  const { built, state } = build();
  const at = (ref) => state.objects.find((o) => o.instanceId === built.report.items.find((i) => i.refKey === ref)?.instanceId);
  assert.equal(at('ai:toilet:1')?.roomId, 'R5');
  const shower = at('shower:1');
  assert.equal(shower?.roomId, 'R6');
  assert.ok(Math.min(shower.shape?.widthM ?? 0.9, shower.shape?.depthM ?? 0.9) >= 0.7 - 1e-9);
});

test('a kitchen has one run, worked with a metre before it; wardrobes open; a chair stands only at its table', () => {
  const { state } = build();
  const runs = state.objects.filter((o) => o.assetId === 'dev/kitchen-run');
  assert.equal(runs.length, 1);
  assert.ok(freeFront(state.objects, runs[0]) >= 1.0, `run ${freeFront(state.objects, runs[0])}`);
  for (const w of state.objects.filter((o) => o.assetId.startsWith('dev/wardrobe'))) {
    assert.ok(freeFront(state.objects, w) >= 0.8, `${w.roomId} wardrobe ${freeFront(state.objects, w)}`);
  }
  const table = state.objects.find((o) => o.assetId.startsWith('dev/dining-table'));
  const tableBox = footprint(shapedAsset(assets.get(table.assetId), table), { x: table.position.x, y: table.position.z }, table.rotationY);
  for (const c of state.objects.filter((o) => o.assetId === 'dev/dining-chair')) {
    assert.ok(distanceToObb({ x: c.position.x, y: c.position.z }, tableBox) <= 0.4, `chair ${c.instanceId} away from the table`);
  }
});

test('the double-click mouse look: on and off by a double click, the single click held while it may be one', () => {
  const ctl = fs.readFileSync(new URL('../../../components/designStudio/canvas/SceneController.ts', import.meta.url), 'utf8');
  assert.match(ctl, /if \(now - this\.lastMouseTap < DOUBLE_CLICK_MS\) \{[\s\S]{0,160}if \(g\.locked\) this\.releasePointer\(\); else this\.lockPointer\(\);/);
  assert.match(ctl, /this\.pendingTap = window\.setTimeout\(/);
  assert.doesNotMatch(ctl, /if \(g\.mouse && !g\.locked\) this\.lockPointer\(\);/);
  const overlay = fs.readFileSync(new URL('../../../components/designStudio/workspace/WalkthroughOverlay.tsx', import.meta.url), 'utf8');
  assert.match(overlay, /tr\(locked \? 'ds_ctrl_dbl_to_release' : 'ds_ctrl_dbl_to_look'\)/);
});
