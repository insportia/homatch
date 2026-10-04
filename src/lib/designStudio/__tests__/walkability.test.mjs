// WALKABILITY AND THE MOBILE WALK: the production failure shapes.
//
//   1  a bedroom whose bed and wardrobe leave a narrow strip → detected, repaired by moving, no trap left
//   2  a kitchen/living area with redundant tables and an empty living zone → one table, a sofa, open circulation
//   3  walking up to something without tapping → nothing happens
//   4  walking up and tapping it → it is used exactly once
//   5  a drag that begins over a door or drawer → looking, never using
//   6  walking diagonally into furniture → a smooth slide, not a sticky stop
//   7  a room shortcut → a spot with a comfortable margin, inside the room
//   8  a body somewhere it cannot be → the nearest free floor; a free body is never moved

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildWalkthrough, circulationStart, reachableRooms, stranded } from '../walkthrough/build.ts';
import { DENSITY_MAX, essentialRole, isFixture, redundantPieces, repairRank, servesRole } from '../walkthrough/walkability.ts';
import { inferredSpace } from '../walkthrough/inferredSpace.ts';
import { emptyDesignState } from '../designState.ts';
import { BODY_RADIUS_M, COMFORT_RADIUS_M, buildWalkModel, freeWith, isFree, move, recoverPosition, softPiece } from '../navigation.ts';
import { isTap, stickInput, STICK_DEAD_ZONE, stepBody } from '../player.ts';
import { roomShot } from '../cameraDirector.ts';
import { buildSpaceModel, pointInPolygon } from '../space.ts';
import { oneBedroomScene, testAssets, testMaterials } from './fixtures.mjs';

const code = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const space = buildSpaceModel(oneBedroomScene());
const base = testAssets();
const clone = (from, over) => ({ ...base.get(from), id: `id-${over.code}`, ...over });
const assets = new Map([
  ...base,
  ['dev/dining-table', clone('dev/coffee-table', { code: 'dev/dining-table', category: 'TABLE', subcategory: 'DINING_TABLE', widthM: 1.6, depthM: 0.9, heightM: 0.75 })],
  ['dev/dining-table-2', clone('dev/coffee-table', { code: 'dev/dining-table-2', category: 'TABLE', subcategory: 'DINING_TABLE', widthM: 1.4, depthM: 0.8, heightM: 0.75 })],
  ['dev/kitchen-island', clone('dev/coffee-table', { code: 'dev/kitchen-island', category: 'TABLE', subcategory: 'KITCHEN_ISLAND', widthM: 1.8, depthM: 0.9, heightM: 0.9 })],
  ['dev/plant', clone('dev/coffee-table', { code: 'dev/plant', category: 'PLANT', subcategory: null, widthM: 0.35, depthM: 0.35, heightM: 1.1, anchor: 'CORNER' })],
]);
const materialsById = testMaterials();
const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
const lighting = { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 };
const room = (roomId, items) => ({ roomId, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items });
const item = (c, pose) => ({ code: c, type: 'X', pose, scale: 1, color: null, origin: pose ? 'PLANNED' : 'PROGRAMME' });
const build = (rooms) => buildWalkthrough({ space, base: emptyDesignState(), plan: { lighting, palette: [], styleCode: null, rooms }, assets, materialsByCode, materialsById, idPrefix: 'w' });
const bed = space.rooms.find((r) => r.id === 'r-bed');
const living = space.rooms.find((r) => r.id === 'r-living');
const obj = (id, assetId, roomId, x, y, rot = 0) => ({ instanceId: id, assetId, roomId, position: { x, y: 0, z: y }, rotationY: rot, materialVariant: null, colorOverride: null, locked: false });

// The production bedroom: a hall to the west, the bedroom east of it (door in the middle of the shared wall).
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const bedroomSpace = (() => {
  const reading = {
    version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.8, scaleEvidence: null, ceilingHeightM: 2.7, objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [], usesPlan: false,
    rooms: [
      { key: 'hall', kind: 'HALL', label: null, polygon: rect(0, 0, 3, 4), outdoor: false, confidence: 0.9, basis: 'OBSERVED' },
      { key: 'bed', kind: 'BEDROOM', label: null, polygon: rect(3, 0, 7, 4), outdoor: false, confidence: 0.9, basis: 'OBSERVED' },
    ],
    openings: [
      { key: 'front', kind: 'DOOR', at: [1.5, 0], widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.9, basis: 'OBSERVED' },
      { key: 'd', kind: 'DOOR', at: [3, 2], widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.9, basis: 'OBSERVED' },
    ],
  };
  const out = inferredSpace(reading, 'k');
  return buildSpaceModel(out.canonical.scene);
})();

test('CASE 1: a bed and a wardrobe leaving only a narrow gap to the far side are a trap — detected, then repaired by moving', () => {
  const sp = bedroomSpace;
  const br = sp.rooms.find((r) => r.kind === 'BEDROOM');
  const { minX, minY, maxX, maxY } = br.bounds;
  // Across the room: the bed from one wall, a 0.6 m gap, the wardrobe, a 0.5 m gap to the other wall. The far side
  // of the room (a metre of floor by the window) is reached only by squeezing through.
  const cx = minX + 1.6;
  const bedAt = { x: cx, y: minY + 0.125 + 1.025 };
  const wardAt = { x: cx, y: bedAt.y + 1.025 + 0.6 + 0.3 };
  const objs = [obj('b', 'dev/bed-double', br.id, bedAt.x, bedAt.y, 0), obj('w', 'dev/wardrobe', br.id, wardAt.x, wardAt.y, 0)];
  assert.ok(maxY - (wardAt.y + 0.3) < 0.7, 'the second gap is narrow too');
  const empty = buildWalkModel(sp, [], assets);
  const start = circulationStart(sp, empty);
  const { state, report } = buildWalkthrough({
    space: sp, base: emptyDesignState(), assets, materialsByCode, materialsById, idPrefix: 'c1',
    plan: { lighting, palette: [], styleCode: null, rooms: [room(br.id, [
      item('dev/bed-double', { x: bedAt.x - minX, y: bedAt.y - minY, rotationDeg: 0 }),
      item('dev/wardrobe', { x: wardAt.x - minX, y: wardAt.y - minY, rotationDeg: 0 }),
    ])] },
  });
  // Detected on the planned geometry: comfortable floor beyond the line that the comfortable walk does not reach.
  const strands = stranded(sp, objs, assets, start, br.id);
  assert.ok(strands.length >= 1 && strands[0].areaM2 >= 0.6, `stranded floor beyond the bed and the wardrobe: ${JSON.stringify(strands.map((x) => x.areaM2))}`);
  // A legroom gap (a sofa and its coffee table) strands nothing: no false trap, no living room emptied.
  const hall = sp.rooms.find((r) => r.kind === 'HALL');
  const sofaY = hall.bounds.maxY - 0.125 - 0.45; // against the north wall, facing south
  const tableY = sofaY - 0.45 - 0.45 - 0.3; // 0.45 m of legroom between the sofa's front and the table
  assert.deepEqual(stranded(sp, [obj('s', 'dev/sofa-2', hall.id, hall.centroid.x, sofaY, Math.PI), obj('t', 'dev/coffee-table', hall.id, hall.centroid.x, tableY, 0)], assets, start, hall.id), []);
  // Repaired: no stranded floor, the gate passes, the bed and the wardrobe both stay (moved, not dropped).
  assert.equal(report.gate.ok, true, JSON.stringify(report.gate));
  assert.deepEqual(report.gate.traps, []);
  assert.ok(state.objects.some((o) => o.assetId === 'dev/bed-double'), 'the bed stays');
  assert.ok(state.objects.some((o) => o.assetId === 'dev/wardrobe'), 'the wardrobe stays');
  const after = buildWalkModel(sp, state.objects, assets); after.radius = COMFORT_RADIUS_M;
  assert.ok(reachableRooms(sp, after, { start }).has(br.id), 'the bedroom is walked comfortably');
});

test('CASE 2: redundant tables and an empty living zone → one table, the missing sofa, open circulation', () => {
  const W = living.bounds.maxX - living.bounds.minX; const D = living.bounds.maxY - living.bounds.minY;
  const { state, report } = build([room('r-living', [
    item('dev/dining-table', { x: W / 2, y: D * 0.7, rotationDeg: 0 }),
    item('dev/dining-table-2', { x: W / 2 + 1.8, y: D * 0.7, rotationDeg: 0 }),
    item('dev/kitchen-island', { x: W / 2 - 1.8, y: D * 0.7, rotationDeg: 0 }),
    item('dev/dining-table', null),
    item('dev/coffee-table', { x: W / 2, y: D * 0.3, rotationDeg: 0 }),
  ])]);
  const tables = state.objects.filter((o) => /dining|island/.test(o.assetId));
  assert.equal(tables.length, 1, `one dining solution, not several blocks: ${tables.map((t) => t.assetId)}`);
  assert.ok(report.items.filter((i) => i.reason === 'REDUNDANT').length >= 2);
  assert.ok(state.objects.some((o) => o.assetId.startsWith('dev/sofa')), 'the living room gets its sofa (ESSENTIAL)');
  assert.ok(report.items.some((i) => i.reason === 'ESSENTIAL' && i.outcome === 'PLACED'));
  assert.equal(report.gate.ok, true, JSON.stringify(report.gate));
  assert.deepEqual(report.gate.missingEssential, []);
  for (const id of report.circulation.reachableBefore) assert.ok(report.circulation.reachableAfter.includes(id), `${id} cut off`);
});

test('planning rules: one coherent solution per room, a rank for what gives way, essentials, soft decor', () => {
  const a = (c) => assets.get(c);
  const items = ['dev/dining-table', 'dev/dining-table-2', 'dev/kitchen-island', 'dev/coffee-table', 'dev/sofa-3'].map((c, i) => ({ item: c, asset: a(c), planned: i !== 1 }));
  const gone = redundantPieces('KITCHEN_LIVING', 18, items);
  assert.ok(gone.has('dev/dining-table-2') && gone.has('dev/kitchen-island') && !gone.has('dev/dining-table'), [...gone].join());
  assert.equal(redundantPieces('KITCHEN_LIVING', 30, items).has('dev/kitchen-island'), false, 'a large open room may keep a table AND an island');
  assert.ok(repairRank(a('dev/plant')) < repairRank(a('dev/coffee-table')) && repairRank(a('dev/coffee-table')) < repairRank(a('dev/dining-table')) && repairRank(a('dev/dining-table')) < repairRank(a('dev/bed-double')));
  assert.ok(isFixture({ category: 'BATHROOM', subcategory: 'TOILET', code: 'x/toilet', heightM: 0.8 }) && repairRank({ category: 'BATHROOM', subcategory: 'TOILET', code: 'x/toilet', heightM: 0.8 }) === 5, 'a toilet is never decor');
  assert.equal(essentialRole('LIVING'), 'SOFA'); assert.equal(essentialRole('BEDROOM'), 'BED'); assert.equal(essentialRole('KITCHEN'), 'KITCHEN');
  assert.ok(servesRole(a('dev/kitchen-run'), 'KITCHEN') && !servesRole(a('dev/kitchen-island'), 'TABLE'));
  assert.ok(DENSITY_MAX > 0.3 && DENSITY_MAX < 0.5);
  assert.equal(softPiece(a('dev/plant')), true, 'a small plant never traps the body');
  assert.equal(softPiece(a('dev/wardrobe')), false);
  // A plant does not block: the body stands where its pot is.
  const p = { x: living.centroid.x, y: living.centroid.y };
  assert.ok(isFree(buildWalkModel(space, [obj('p', 'dev/plant', 'r-living', p.x, p.y)], assets), p));
  // The scene plan asks the designer for exactly this (server-internal prompt).
  const plan = code('supabase/functions/_shared/designStudio/walkthrough/scenePlan.ts');
  assert.match(plan, /ONE dining solution per kitchen or dining area/);
  assert.match(plan, /Follow the approved design's composition/);
  // A walkthrough that fails the gate is never READY: without a picture the walkability gate decides (NOT_WALKABLE);
  // with one, the fidelity gate (which puts NOT_WALKABLE first) does; a failure ends in a replan or fail(), and
  // the version is only saved after it.
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(route, /const failing = fidelity \? fidelity\.code : built\.report\.gate && !built\.report\.gate\.ok \? 'NOT_WALKABLE' : null;/);
  const gateAt = route.indexOf('const failing = fidelity');
  const failAt = route.indexOf('await fail(admin, row, failing', gateAt);
  const saveAt = route.indexOf("const walkId = await uuidFrom(`ds-walk:${row.id}:version`)", gateAt);
  assert.ok(gateAt > 0 && failAt > gateAt && saveAt > failAt, 'the gate is decided before the walkable version is saved');
  assert.match(route.slice(gateAt, saveAt), /if \(failing\) \{[\s\S]*return;\n    \}\n    await fail\(admin, row, failing,[\s\S]*return;\n  \}/);
});

test('CASES 3–5: walking near something never uses it; a tap uses it once; a drag that starts on it only looks', () => {
  // 3: nothing on the walking path can act — a step only aims (and on touch, quietly: a highlight, no card).
  const sc = code('src/components/designStudio/canvas/SceneController.ts');
  const step = sc.slice(sc.indexOf('private stepWalk(now: number)'), sc.indexOf('// ── Teardown'));
  assert.doesNotMatch(step, /performAimed|living\.act\(|toggleAimed|sitOn\(/, 'no action while walking');
  assert.match(sc, /this\.setAim\(hit, this\.touchInput && !this\.lastPointer\);/);
  assert.match(sc, /this\.onAimChange\?\.\(quiet \? null : this\.hintFor\(this\.aimed\)\);/);
  // 4: an explicit tap — short and still — uses the thing under the finger, once.
  assert.equal(isTap(180, 2, false), true);
  const end = sc.slice(sc.indexOf('private endGesture('), sc.indexOf('private onLookDown'));
  assert.equal((end.match(/this\.performAimed\(\)/g) ?? []).length, 1, 'one tap, one action');
  assert.match(sc, /const quick = isTap\(performance\.now\(\) - g\.t, g\.moved, g\.mouse\);/);
  // 5: a finger that moved (looking) never uses anything, and never drags a door or drawer by hand.
  assert.equal(isTap(180, 12, false), false); assert.equal(isTap(600, 2, false), false);
  assert.match(sc, /if \(mouse && hit\?\.entry && this\.living\.canScrub\(hit\.entry\)\)/);
  // The thumb stick: any movement is walking; only a quick, still touch taps.
  const overlay = code('src/components/designStudio/workspace/WalkthroughOverlay.tsx');
  assert.match(overlay, /if \(a\.moved < 6 && performance\.now\(\) - a\.t < 300\) controller\?\.tapAt/);
  assert.deepEqual(stickInput(STICK_DEAD_ZONE * 0.9, 0), { x: 0, y: 0 }, 'a resting thumb does not walk');
  const half = stickInput(0.55, 0).x; const full = stickInput(1, 0).x;
  assert.ok(half > 0 && half < 0.5 && Math.abs(full - 1) < 1e-9, 'gentle near the centre, a walk at full push');
  assert.doesNotMatch(sc, /Math\.hypot\(w\.stick\.x, w\.stick\.y\) > 0\.96/, 'the stick never runs');
});

test('CASE 6: walking diagonally into furniture slides along it instead of sticking', () => {
  // A sofa across the room; the body walks at 45° into its long side.
  const c = living.centroid;
  const sofa = [obj('s', 'dev/sofa-3', 'r-living', c.x, c.y, 0)];
  const model = buildWalkModel(space, sofa, assets);
  const from = { x: c.x - 0.6, y: c.y - 0.95 };
  assert.ok(isFree(model, from));
  const to = move(model, from, { x: 0.25, y: 0.25 });
  const progressed = Math.hypot(to.x - from.x, to.y - from.y);
  assert.ok(progressed > 0.15, `slid ${progressed.toFixed(3)} m`);
  assert.ok(isFree(model, to));
  // Head-on into a wall: no drift sideways, no penetration.
  const wallFrom = { x: living.bounds.minX + 0.125 + BODY_RADIUS_M + 0.12, y: c.y };
  const head = move(model, wallFrom, { x: -0.3, y: 0 });
  assert.ok(isFree(model, head) && Math.abs(head.y - wallFrom.y) < 0.02);
  // A step at walking pace keeps its speed along the obstacle (no stop-start).
  const body = stepBody(model, from, { x: 1, y: 1 }, { x: 1, y: 1 }, 0.05);
  assert.ok(Math.hypot(body.vel.x, body.vel.y) > 0.5, JSON.stringify(body.vel));
});

test('CASE 7: a room shortcut lands on a comfortable spot inside the room, never pressed into furniture', () => {
  const W = bed.bounds.maxX - bed.bounds.minX; const D = bed.bounds.maxY - bed.bounds.minY;
  const { state } = build([room('r-bed', [item('dev/bed-double', { x: W / 2, y: D / 2, rotationDeg: 0 }), item('dev/wardrobe', null)])]);
  const model = buildWalkModel(space, state.objects, assets);
  const shot = roomShot(space, model, 'r-bed');
  assert.ok(shot, 'a shot exists');
  assert.ok(pointInPolygon(shot.position, bed.polygon), 'inside the room');
  assert.ok(freeWith(model, shot.position, COMFORT_RADIUS_M), 'with the comfort margin all round');
  assert.equal(model.radius, BODY_RADIUS_M, 'the model is left as it was');
});

test('CASE 8: a body somewhere it cannot be recovers to the nearest free floor; a free body is never moved', () => {
  const c = living.centroid;
  const model = buildWalkModel(space, [obj('s', 'dev/sofa-3', 'r-living', c.x, c.y, 0)], assets);
  const stuck = { x: c.x, y: c.y };
  assert.equal(isFree(model, stuck), false);
  const safe = recoverPosition(model, stuck);
  assert.ok(safe && isFree(model, safe) && Math.hypot(safe.x - stuck.x, safe.y - stuck.y) < 2);
  const free = { x: c.x, y: c.y - 1.5 };
  assert.deepEqual(recoverPosition(model, free), free);
  assert.match(code('src/components/designStudio/canvas/SceneController.ts'), /if \(wantsToMove && !isFree\(w\.model, w\.pos\)\) \{\s*const safe = recoverPosition\(w\.model, w\.pos\);/);
});
