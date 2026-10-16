// THE WHOLE-HOME TOUR: one continuous interior, navigated through its real
// doorways. A deterministic eight-room fixture (fixtures.mjs tourApartmentDoc:
// Entrance, Corridor, Living, Kitchen, Bedroom 1, Bedroom 2, Bathroom,
// Balcony) proves the start, the door graph, reachability, collision-safe
// routes through every doorway, and walkability after furnishing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWalkModel, EYE_HEIGHT_M, findPath, isFree } from '../navigation.ts';
import { doorPointsFrom, landingThrough, planTour } from '../tour.ts';
import { buildSpaceModel, roomContaining } from '../space.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { emptyDesignState } from '../designState.ts';
import { tourApartmentScene, testAssets, testMaterials } from './fixtures.mjs';

const space = buildSpaceModel(tourApartmentScene());
const bare = buildWalkModel(space, [], new Map());
const ALL = ['r-entry', 'r-corr', 'r-living', 'r-kitchen', 'r-bed1', 'r-bed2', 'r-bath', 'r-balcony'];

/** Every step of a route is free floor (a body never passes through a wall or a piece). */
function routeIsFree(model, from, route) {
  let a = from;
  for (const b of route) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
    for (let i = 1; i <= n; i += 1) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      // Doors in the way are opened on the route (as the walker does): judge with every door open.
      const closed = model.closedDoors; model.closedDoors = new Set();
      const free = isFree(model, p);
      model.closedDoors = closed;
      if (!free) return false;
    }
    a = b;
  }
  return true;
}

test('the fixture is the eight-room home the acceptance names', () => {
  assert.deepEqual(space.rooms.map((r) => r.id).sort(), [...ALL].sort());
  assert.equal(space.rooms.find((r) => r.id === 'r-balcony').outdoor, true);
});

test('the tour starts INSIDE the entrance, at eye level, facing into the home', () => {
  const plan = planTour(space, bare);
  assert.equal(plan.graph.entryRoomId, 'r-entry');
  assert.equal(plan.graph.entryDoorId, 'd-entry');
  assert.ok(plan.entry, 'an entry pose');
  assert.equal(roomContaining(space, plan.entry.position), 'r-entry');
  assert.ok(isFree(bare, plan.entry.position));
  assert.ok(plan.entry.height >= 1.55 && plan.entry.height <= 1.7, String(plan.entry.height));
  assert.equal(plan.entry.height, EYE_HEIGHT_M);
  // Facing away from the front door, into the flat (the door is on the east wall: facing west).
  assert.ok(plan.entry.target.x < plan.entry.position.x);
});

test('every room is reachable from the entrance through real doorways', () => {
  const plan = planTour(space, bare);
  assert.deepEqual([...plan.reachable].sort(), [...ALL].sort());
});

test('door navigation points: one per real doorway, both ways, named by the room behind it', () => {
  const plan = planTour(space, bare);
  const from = (id) => doorPointsFrom(plan, id).map((d) => d.toRoom).sort();
  assert.deepEqual(from('r-entry'), ['r-corr']);
  assert.deepEqual(from('r-corr'), ['r-bath', 'r-bed1', 'r-bed2', 'r-entry', 'r-living']);
  assert.deepEqual(from('r-living'), ['r-corr', 'r-kitchen']);
  assert.deepEqual(from('r-kitchen'), ['r-balcony', 'r-living']);
  assert.deepEqual(from('r-balcony'), ['r-kitchen']);
  assert.deepEqual(from('r-bath'), ['r-corr']);
  // The front door leads outside: never a navigation point.
  assert.ok(!plan.doors.some((d) => d.doorId === 'd-entry'));
  assert.equal(plan.doors.length, 14);
  for (const d of plan.doors) {
    const door = space.doors.find((x) => x.id === d.doorId);
    assert.deepEqual(d.at, door.centre, 'anchored at the real doorway');
    // The landing is through that doorway: inside the room behind it, on free floor, close to the door.
    assert.equal(roomContaining(space, d.landing.position), d.toRoom, `${d.fromRoom}->${d.toRoom}`);
    assert.ok(isFree(bare, d.landing.position));
    assert.ok(Math.hypot(d.landing.position.x - d.at.x, d.landing.position.y - d.at.y) < 1.6);
    // Heading preserved: the view carries on in the direction of the step through the door.
    const step = { x: d.landing.position.x - d.at.x, y: d.landing.position.y - d.at.y };
    const look = { x: d.landing.target.x - d.landing.position.x, y: d.landing.target.y - d.landing.position.y };
    assert.ok(step.x * look.x + step.y * look.y > 0, `${d.doorId} looks back`);
    assert.equal(d.landing.height, EYE_HEIGHT_M);
  }
});

test('a door transition is a collision-safe route THROUGH that doorway (no teleport, no wall)', () => {
  const plan = planTour(space, bare);
  for (const d of plan.doors) {
    // From the middle of the room the visitor stands in.
    const start = landingThrough(space, bare, d.doorId, d.toRoom, d.fromRoom)?.position;
    assert.ok(start, `${d.doorId} a standing point in ${d.fromRoom}`);
    const route = findPath(bare, start, d.landing.position, { throughDoors: true });
    assert.ok(route?.length, `${d.fromRoom}->${d.toRoom}: a route`);
    assert.ok(routeIsFree(bare, start, route), `${d.fromRoom}->${d.toRoom}: collision-free`);
    // And it passes through the door's opening (within half its width of the centre).
    const door = space.doors.find((x) => x.id === d.doorId);
    let near = Infinity; let a = start;
    for (const b of route) {
      for (let t = 0; t <= 1; t += 0.02) near = Math.min(near, Math.hypot(a.x + (b.x - a.x) * t - door.centre.x, a.y + (b.y - a.y) * t - door.centre.y));
      a = b;
    }
    assert.ok(near < door.widthM / 2, `${d.doorId}: ${near.toFixed(2)} m from the opening`);
  }
});

test('the whole home is one walk: from the entrance, a route reaches every room', () => {
  const plan = planTour(space, bare);
  for (const d of plan.doors) {
    const route = findPath(bare, plan.entry.position, d.landing.position, { throughDoors: true });
    assert.ok(route, `entry -> ${d.toRoom}`);
    assert.ok(routeIsFree(bare, plan.entry.position, route));
  }
});

test('a room no doorway reaches gets no navigation point and is not offered', () => {
  const s = buildSpaceModel(tourApartmentScene({ omit: ['d-bath'] }));
  const plan = planTour(s, buildWalkModel(s, [], new Map()));
  assert.ok(!plan.reachable.has('r-bath'));
  assert.ok(!plan.doors.some((d) => d.toRoom === 'r-bath' || d.fromRoom === 'r-bath'));
  assert.equal(plan.reachable.size, 7);
});

test('a doorway blocked by a piece is not offered (only passable doorways are)', () => {
  const plan0 = planTour(space, bare);
  const door = space.doors.find((d) => d.id === 'd-bed2');
  // A wardrobe standing across the bedroom 2 doorway, on the bedroom side.
  const blocked = { ...bare, furniture: [{ cx: door.centre.x, cy: door.centre.y + 0.45, hw: 0.9, hd: 0.3, angle: 0 }] };
  const plan = planTour(space, blocked);
  assert.ok(plan0.reachable.has('r-bed2'));
  assert.ok(!plan.reachable.has('r-bed2'));
  assert.ok(!doorPointsFrom(plan, 'r-corr').some((d) => d.toRoom === 'r-bed2'));
});

test('walkability after furnishing: pieces planned across doorways are moved, and every room stays reachable', () => {
  const assets = testAssets();
  const materialsById = testMaterials();
  const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
  const room = (roomId, items) => ({ roomId, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items });
  const item = (code, pose) => ({ code, type: 'X', pose, scale: 1, color: null, origin: 'PLANNED' });
  const living = space.rooms.find((r) => r.id === 'r-living');
  const bed1 = space.rooms.find((r) => r.id === 'r-bed1');
  const dLiving = space.doors.find((d) => d.id === 'd-living').centre;
  const dBed1 = space.doors.find((d) => d.id === 'd-bed1').centre;
  const { state, report } = buildWalkthrough({
    space, base: emptyDesignState(), assets, materialsByCode, materialsById, idPrefix: 'tour',
    plan: {
      lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 }, palette: ['#f2eee6'], styleCode: null,
      rooms: [
        // A sofa planned right across the corridor doorway of the living room.
        room('r-living', [
          item('dev/sofa-2', { x: dLiving.x - living.bounds.minX - 0.6, y: dLiving.y - living.bounds.minY + 0.45, rotationDeg: 90 }),
          item('dev/coffee-table', { x: 2.5, y: 2.5, rotationDeg: 0 }),
        ]),
        // A wardrobe planned in front of bedroom 1's door, and a bed.
        room('r-bed1', [
          item('dev/wardrobe', { x: dBed1.x - bed1.bounds.minX, y: dBed1.y - bed1.bounds.minY + 0.35, rotationDeg: 0 }),
          item('dev/bed-double', { x: 1.5, y: 2.8, rotationDeg: 0 }),
        ]),
        room('r-kitchen', [item('dev/kitchen-run', null)]),
        room('r-bed2', [item('dev/bed-double', null)]),
      ],
    },
  });
  assert.ok(state.objects.length >= 5, JSON.stringify(report.items));
  // The pieces in the doorways were repositioned, not left there.
  for (const code of ['dev/sofa-2', 'dev/wardrobe']) {
    const r = report.items.find((i) => i.code === code);
    assert.notEqual(r.outcome, 'PLANNED', `${code} left across a doorway`);
  }
  const furnished = buildWalkModel(space, state.objects, assets);
  const plan = planTour(space, furnished);
  assert.deepEqual([...plan.reachable].sort(), [...ALL].sort(), JSON.stringify(report.circulation));
  for (const d of plan.doors) assert.ok(isFree(furnished, d.landing.position), `${d.doorId} landing free after furnishing`);
});

test('the walkthrough offers the tour on both the editor and the public link, through one overlay', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const overlay = read('../../../components/designStudio/workspace/WalkthroughOverlay.tsx');
  assert.match(overlay, /planTour\(space, walkModel/);
  assert.match(overlay, /c\.routeTo\(d\.landing, \{ through: true \}\)/);
  assert.match(overlay, /data-testid="walk-back"/);
  assert.match(overlay, /data-testid="walk-plan-open"/);
  for (const page of ['../../../components/designStudio/workspace/DesignWorkspace.tsx', '../../../share/ShareViewer.tsx']) {
    assert.match(read(page), /space=\{space\}\s+walkModel=\{walk(Model|Ref)\.current\}/, page);
  }
  // A walkthrough link opens inside the home, at the entrance.
  assert.match(read('../../../share/ShareViewer.tsx'), /data\.shareType !== 'WALKTHROUGH'\) return;\s+autoEntered\.current = true;\s+enter\(\);/);
  // Door transitions: about a second, the same collision-safe route; reduced motion cuts.
  const scene = read('../../../components/designStudio/canvas/SceneController.ts');
  assert.match(scene, /const THROUGH_S = 1\.1;/);
  assert.match(scene, /if \(opts\.through && this\.reducedMotion\) \{/);
  // Interaction only on an explicit click, tap or E: walking, looking and hovering only highlight.
  assert.match(scene, /this\.setAim\(hit, true\);/);
});
