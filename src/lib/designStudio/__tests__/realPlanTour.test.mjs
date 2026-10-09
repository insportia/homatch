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
  for (const ref of ['ai:sofa:1', 'ai:bed:1', 'ai:bed:2', 'wardrobe:1', 'wardrobe:2', 'ai:toilet:1', 'vanity:1', 'ai:tv_unit:1', 'kitchen_cabinets:1', 'kitchen_cabinets:2', 'ai:dining_table:1']) {
    assert.ok(standing(ref), `${ref} stands`);
  }
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
  assert.match(route, /'NOT_WALKABLE' : unfaithful \? 'NOT_FAITHFUL' : null;/);
});
