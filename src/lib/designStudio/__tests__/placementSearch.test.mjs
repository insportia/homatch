// WHERE SHOULD IT GO — the "+" button never drops a sofa on the dining table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceModel } from '../space.ts';
import {
  autoPlace, blocks, evaluatePlacement, footprint, frontOf, frontZone, hitsWall, obbOverlap, placementWorld, rotationFacing,
  solidBox,
} from '../placement.ts';
import { DEFAULT_MAX_EVALUATIONS, findPlacement, pieceRole, searchPlacement } from '../placementSearch.ts';
import { oneBedroomScene, testAssets } from './fixtures.mjs';

const space = buildSpaceModel(oneBedroomScene());
const room = (id) => space.rooms.find((r) => r.id === id);

// The shared fixture catalogue, plus the pieces this suite needs.
const assets = testAssets();
const base = assets.get('dev/sofa-3');
const extra = (code, category, w, d, h, over = {}) => ({
  ...base, id: `id-${code}`, code, name: code, category, widthM: w, depthM: d, heightM: h, clearanceM: 0, anchor: 'FREE',
  variants: [], ...over,
});
for (const a of [
  extra('dev/armchair', 'ARMCHAIR', 0.85, 0.85, 0.8, { clearanceM: 0.7 }),
  extra('dev/sofa-free', 'SOFA', 1.7, 0.9, 0.82),
  extra('dev/tv-unit', 'STORAGE', 1.6, 0.4, 0.5, { subcategory: 'TV_UNIT', anchor: 'WALL' }),
  extra('dev/dining-table', 'TABLE', 1.6, 0.9, 0.75, { subcategory: 'DINING_TABLE', anchor: 'CENTRE' }),
  extra('dev/plant', 'DECOR', 0.5, 0.5, 1.2, { subcategory: 'PLANT', anchor: 'CORNER' }),
  extra('dev/stool', 'CHAIR', 0.35, 0.35, 0.45),
  extra('dev/block', 'STORAGE', 1.8, 2.7, 1.0, { anchor: 'CENTRE' }),
  extra('dev/pendant', 'LIGHTING', 0.5, 0.5, 0.6, { subcategory: 'PENDANT', placement: 'CEILING' }),
]) assets.set(a.code, a);

const obj = (instanceId, assetId, roomId, x, y, rotationY = 0) => ({
  instanceId, assetId, roomId, position: { x, y: 0, z: y }, rotationY, materialVariant: null, colorOverride: null, locked: false,
});
const ctx = (objects = []) => ({ space, assets, objects });

// The production layout: a sofa on the west wall facing the TV on the east
// wall, a dining table by the south wall. (Living room faces: x 0.125–5.95, y 0.125–6.875; doors on x = 6 at y 1.5 and 5.)
const livingRoom = () => [
  obj('sofa-1', 'dev/sofa-3', 'r-living', 0.125 + 0.475 + 0.01, 3.5, rotationFacing({ x: 1, y: 0 })),
  obj('tv-1', 'dev/tv-unit', 'r-living', 5.95 - 0.2 - 0.01, 3.5, rotationFacing({ x: -1, y: 0 })),
  obj('table-1', 'dev/dining-table', 'r-living', 3, 1.2, 0),
];

const boxOf = (o) => solidBox(footprint(assets.get(o.assetId), { x: o.position.x, y: o.position.z }, o.rotationY));
const placedBox = (code, p) => solidBox(footprint(assets.get(code), p.at, p.rotation));
const grown = (b, m) => solidBox({ ...b.obb, hw: b.obb.hw + m, hd: b.obb.hd + m });
const codes = (issues) => issues.map((i) => i.code);

function assertTurnable(c, code, roomId, p) {
  const ok = [Math.PI / 12, -Math.PI / 12, Math.PI / 2, -Math.PI / 2]
    .some((d) => !blocks(evaluatePlacement(c, assets.get(code), p.at, p.rotation + d, roomId)));
  assert.ok(ok, `${code} at ${JSON.stringify(p.at)} cannot be turned at all`);
}

function assertBackedToWall(c, code, roomId, p) {
  const world = placementWorld(c, room(roomId));
  assert.ok(hitsWall(world, frontZone(assets.get(code), p.at, p.rotation + Math.PI, 0.06)), `${code} is not backed to a wall`);
}

test('pieces are recognised by what they are for', () => {
  assert.equal(pieceRole(assets.get('dev/sofa-3')), 'SOFA');
  assert.equal(pieceRole(assets.get('dev/armchair')), 'ARMCHAIR');
  assert.equal(pieceRole(assets.get('dev/tv-unit')), 'TV');
  assert.equal(pieceRole(assets.get('dev/dining-table')), 'TABLE');
  assert.equal(pieceRole(assets.get('dev/plant')), 'PLANT');
  assert.equal(pieceRole(assets.get('dev/rug-large')), 'RUG');
  assert.equal(pieceRole(assets.get('dev/coffee-table')), 'COFFEE_TABLE');
});

test('a new sofa in a furnished living room overlaps nothing, has its back to a wall and faces into the room', () => {
  const c = ctx(livingRoom());
  const p = findPlacement(c, assets.get('dev/sofa-3'), room('r-living'));
  assert.ok(p, 'no place found');
  const issues = evaluatePlacement(c, assets.get('dev/sofa-3'), p.at, p.rotation, 'r-living');
  assert.ok(!codes(issues).includes('OVERLAPS_OBJECT'), JSON.stringify(issues));
  assert.ok(!blocks(issues));
  assert.ok(!codes(issues).includes('BLOCKS_DOOR'));
  for (const o of livingRoom()) assert.equal(obbOverlap(placedBox('dev/sofa-3', p).obb, boxOf(o).obb), false, `on top of ${o.instanceId}`);
  assertBackedToWall(c, 'dev/sofa-3', 'r-living', p);
  const f = frontOf(p.rotation);
  const centre = room('r-living').centroid;
  assert.ok(f.x * (centre.x - p.at.x) + f.y * (centre.y - p.at.y) > 0, 'the sofa faces the wall');
});

test('the old first-fit search is what put the sofa somewhere poor; the new one keeps clear of the table', () => {
  const c = ctx(livingRoom());
  const p = findPlacement(c, assets.get('dev/sofa-3'), room('r-living'));
  const table = boxOf(livingRoom()[2]);
  assert.equal(obbOverlap(grown(placedBox('dev/sofa-3', p), 0.3).obb, table.obb), false, 'the sofa is jammed against the dining table');
  // autoPlace stays as it was for the AI plan; it is not what "+" uses any more.
  assert.ok(autoPlace(c, assets.get('dev/sofa-3'), room('r-living')));
});

test('an armchair gets walking room and is never put on top of the sofa', () => {
  const c = ctx(livingRoom());
  const p = findPlacement(c, assets.get('dev/armchair'), room('r-living'));
  assert.ok(p, 'no place found');
  assert.deepEqual(evaluatePlacement(c, assets.get('dev/armchair'), p.at, p.rotation, 'r-living'), [], 'not a clean spot');
  const sofa = boxOf(livingRoom()[0]);
  assert.equal(obbOverlap(grown(placedBox('dev/armchair', p), 0.3).obb, sofa.obb), false, 'squeezed against the sofa');
  assertTurnable(c, 'dev/armchair', 'r-living', p);
});

test('a plant goes into a free corner', () => {
  const c = ctx(livingRoom());
  const p = findPlacement(c, assets.get('dev/plant'), room('r-living'));
  assert.ok(p, 'no place found');
  assert.deepEqual(codes(evaluatePlacement(c, assets.get('dev/plant'), p.at, p.rotation, 'r-living')), []);
  const world = placementWorld(c, room('r-living'));
  const halo = grown(placedBox('dev/plant', p), 0.25);
  const walls = world.walls.filter((w) => obbOverlap(halo.obb, w.box.obb));
  assert.ok(walls.length >= 2, `not in a corner: ${JSON.stringify(p.at)}`);
  assertTurnable(c, 'dev/plant', 'r-living', p);
});

test('a dining chair goes to the table, facing it', () => {
  assets.set('dev/chair', extra('dev/chair', 'CHAIR', 0.45, 0.5, 0.9, { subcategory: 'DINING_CHAIR' }));
  const c = ctx(livingRoom());
  const p = findPlacement(c, assets.get('dev/chair'), room('r-living'));
  assert.ok(p);
  assert.deepEqual(codes(evaluatePlacement(c, assets.get('dev/chair'), p.at, p.rotation, 'r-living')), []);
  const table = boxOf(livingRoom()[2]);
  assert.ok(obbOverlap(grown(placedBox('dev/chair', p), 0.5).obb, table.obb), `not at the table: ${JSON.stringify(p.at)}`);
  const f = frontOf(p.rotation);
  assert.ok(f.x * (3 - p.at.x) + f.y * (1.2 - p.at.y) > 0, 'the chair turns its back on the table');
});

test('a ceiling light goes to the middle of the room, even above the table', () => {
  const c = ctx([obj('t', 'dev/dining-table', 'r-living', 3, 3.5, 0)]);
  const p = findPlacement(c, assets.get('dev/pendant'), room('r-living'));
  assert.ok(p);
  const centre = room('r-living').centroid;
  assert.ok(Math.hypot(p.at.x - centre.x, p.at.y - centre.y) < 0.2, JSON.stringify(p.at));
});

test('a bed goes against a bedroom wall, clean, its head away from the door', () => {
  const p = findPlacement(ctx(), assets.get('dev/bed-double'), room('r-bed'));
  assert.ok(p);
  assert.deepEqual(p.issues, []);
  assertBackedToWall(ctx(), 'dev/bed-double', 'r-bed', p);
  const f = frontOf(p.rotation);
  const head = { x: p.at.x - f.x * 1.025, y: p.at.y - f.y * 1.025 };
  const door = space.doors.find((d) => d.id === 'd-bed');
  assert.ok(Math.hypot(head.x - door.centre.x, head.y - door.centre.y) > 2, 'the head of the bed is by the door');
});

test('a full room says no rather than forcing the piece somewhere poor', () => {
  const c = ctx([obj('b', 'dev/block', 'r-bath', 7, 1.5, 0)]);
  assert.equal(findPlacement(c, assets.get('dev/armchair'), room('r-bath')), null);
  assert.equal(findPlacement(c, assets.get('dev/plant'), room('r-bath')), null);
  assert.equal(findPlacement(ctx(), assets.get('dev/sofa-xl'), room('r-bath')), null);
});

test('a piece added to a narrow room can still be turned where it lands', () => {
  for (const code of ['dev/armchair', 'dev/sofa-free', 'dev/stool']) {
    for (const r of ['r-hall', 'r-bath', 'r-bed', 'r-living']) {
      const p = findPlacement(ctx(), assets.get(code), room(r));
      if (!p) continue;
      assertTurnable(ctx(), code, r, p);
    }
  }
  // The hall is 1.8 m wide: an armchair must fit there, and turn.
  assert.ok(findPlacement(ctx(), assets.get('dev/armchair'), room('r-hall')), 'nothing found in the hall');
});

test('a drop on a blocked spot falls back to the best spot near the drop', () => {
  const c = ctx(livingRoom());
  const drop = { x: 5.2, y: 6.2 };
  const p = findPlacement(c, assets.get('dev/armchair'), room('r-living'), { near: drop });
  assert.ok(p);
  assert.ok(Math.hypot(p.at.x - drop.x, p.at.y - drop.y) < 1.5, JSON.stringify(p.at));
  assert.ok(!blocks(evaluatePlacement(c, assets.get('dev/armchair'), p.at, p.rotation, 'r-living')));
});

test('the search is deterministic and never moves what is already there', () => {
  const objects = livingRoom();
  const before = JSON.stringify(objects);
  for (const code of ['dev/sofa-3', 'dev/armchair', 'dev/plant', 'dev/rug-large', 'dev/coffee-table']) {
    assert.deepEqual(
      findPlacement(ctx(objects), assets.get(code), room('r-living')),
      findPlacement(ctx(objects), assets.get(code), room('r-living')),
    );
  }
  assert.equal(JSON.stringify(objects), before);
});

test('a furnished room with 30 pieces is searched within the budget, inside a frame', () => {
  const objects = livingRoom();
  for (let i = 0; i < 27; i += 1) {
    objects.push(obj(`stool-${i}`, 'dev/stool', 'r-living', 1.6 + (i % 9) * 0.42, 4.6 + Math.floor(i / 9) * 0.6));
  }
  assert.equal(objects.length, 30);
  const c = ctx(objects);
  const runs = [];
  for (const code of ['dev/sofa-3', 'dev/armchair', 'dev/plant']) {
    const r = searchPlacement(c, assets.get(code), room('r-living'));
    assert.ok(r.evaluations <= DEFAULT_MAX_EVALUATIONS, `${code}: ${r.evaluations} evaluations`);
    if (r.choice) assert.ok(!codes(r.choice.issues).includes('OVERLAPS_OBJECT'));
  }
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now();
    searchPlacement(c, assets.get('dev/sofa-3'), room('r-living'));
    searchPlacement(c, assets.get('dev/armchair'), room('r-living'));
    runs.push((performance.now() - t0) / 2);
  }
  runs.sort((a, b) => a - b);
  const median = runs[3];
  const best = runs[0];
  console.log(`[placementSearch] best ${best.toFixed(2)} ms, median ${median.toFixed(2)} ms per search (30 pieces)`);
  // Best-of-seven: an algorithmic regression shows; a busy CI machine does not.
  assert.ok(best < 30, `search took ${best.toFixed(1)} ms at best`);
});
