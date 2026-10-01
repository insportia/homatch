// The person in the apartment: walks at a person's pace, speeds up and
// slows down like one, can't store speed against a wall, looks within a
// comfortable range, sits and stands through real transitions — and can be
// walked somewhere along a real route (never through a wall).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACCEL_M_S2, BRISK_SPEED_M_S, DEFAULT_SETTINGS, PITCH_MAX, WALK_SPEED_M_S, approachVelocity, canWalk, look,
  normalizeSettings, postureTransition, stepBody, wishVelocity,
} from '../player.ts';
import { buildWalkModel, doorsOnRoute, findPath, isFree, setDoorClosed } from '../navigation.ts';
import { validateReconstruction, planDocument } from '../reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../scale.ts';
import { buildSpaceModel } from '../space.ts';
import { buildDesign, emptyCorrections } from '../reconstruction.ts';
import { availableExperiences, planExperience, resolveStep } from '../liveHere.ts';
import { seedAssets, seedMaterials } from './seedCatalog.mjs';

const ASSETS = seedAssets();
function apartment() {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
  const { recon } = validateReconstruction(raw, 1);
  const doc = planDocument(recon, 'k');
  const dec = { rejected: [], roomKinds: {} };
  const built = buildCanonical(doc, dec, calibrate(doc, dec, [], estimateScale(doc, [])), 2.7);
  const space = buildSpaceModel(built.canonical.scene);
  const { state } = buildDesign(recon, emptyCorrections(), space, ASSETS, seedMaterials());
  return { space, state, model: buildWalkModel(space, state.objects, new Map(ASSETS.map((a) => [a.code, a]))) };
}

test('walking pace is a person’s, and Shift is a brisk walk, not a sprint', () => {
  assert.ok(WALK_SPEED_M_S >= 1.1 && WALK_SPEED_M_S <= 1.5);
  assert.ok(BRISK_SPEED_M_S > WALK_SPEED_M_S && BRISK_SPEED_M_S <= 2.4);
  const w = wishVelocity({ forward: 1, strafe: 1, brisk: false }, 0, DEFAULT_SETTINGS);
  assert.ok(Math.abs(Math.hypot(w.x, w.y) - WALK_SPEED_M_S) < 1e-9, 'diagonals are not faster');
});

test('a body speeds up and slows down; it does not start or stop dead', () => {
  let v = { x: 0, y: 0 };
  v = approachVelocity(v, { x: WALK_SPEED_M_S, y: 0 }, 1 / 60);
  assert.ok(Math.abs(v.x - ACCEL_M_S2 / 60) < 1e-9, 'one frame of acceleration');
  for (let i = 0; i < 60; i += 1) v = approachVelocity(v, { x: WALK_SPEED_M_S, y: 0 }, 1 / 60);
  assert.equal(v.x, WALK_SPEED_M_S, 'full pace within a second');
  const slowing = approachVelocity(v, { x: 0, y: 0 }, 1 / 60);
  assert.ok(slowing.x > 0 && slowing.x < WALK_SPEED_M_S, 'eases to a stop');
});

test('walking into a wall stores no speed', () => {
  const { model } = apartment();
  let pos = { x: 4.3, y: 4.0 }; // living room, next to the bedroom wall at x = 4.6 (behind the sofa? find free)
  if (!isFree(model, pos)) pos = { x: 3.2, y: 5.8 };
  let vel = { x: 0, y: 0 };
  for (let i = 0; i < 120; i += 1) ({ pos, vel } = stepBody(model, pos, vel, { x: WALK_SPEED_M_S, y: 0 }, 1 / 60));
  assert.ok(pos.x < 4.6, 'the wall held');
  assert.ok(Math.abs(vel.x) < 0.05, `no pent-up speed (${vel.x})`);
});

test('looking honours sensitivity and invert, within a comfortable range', () => {
  const a = look(0, 0, 100, 0, DEFAULT_SETTINGS);
  const b = look(0, 0, 100, 0, normalizeSettings({ lookSensitivity: 2 }));
  assert.ok(Math.abs(b.yaw - 2 * a.yaw) < 1e-9);
  const up = look(0, 0, 0, -100, DEFAULT_SETTINGS);
  const inverted = look(0, 0, 0, -100, normalizeSettings({ invertY: true }));
  assert.ok(up.pitch > 0 && inverted.pitch < 0);
  assert.equal(look(0, 0, 0, -1e6, DEFAULT_SETTINGS).pitch, PITCH_MAX);
  assert.deepEqual(normalizeSettings({ lookSensitivity: 99, speed: 5 }), { lookSensitivity: 2, speed: 1.25, invertY: false, invertX: false, reducedMotion: false });
});

test('sitting and standing are transitions, and only a standing person walks', () => {
  let p = 'STANDING';
  p = postureTransition(p, 'SIT'); assert.equal(p, 'SITTING_DOWN'); assert.equal(canWalk(p), false);
  p = postureTransition(p, 'ARRIVED'); assert.equal(p, 'SEATED');
  p = postureTransition(p, 'STAND'); assert.equal(p, 'STANDING_UP');
  p = postureTransition(p, 'ARRIVED'); assert.equal(p, 'STANDING'); assert.equal(canWalk(p), true);
  assert.equal(postureTransition('STANDING', 'LIE'), 'LYING_DOWN');
});

test('a route from the living room to the second bedroom goes through the doors, never a wall', () => {
  const { model } = apartment();
  const from = { x: 3.2, y: 5.9 };
  const to = { x: 9.9, y: 3.6 };
  assert.ok(isFree(model, from));
  const route = findPath(model, from, to);
  assert.ok(route && route.length >= 2, 'a route exists');
  // Every straight run of the route is free.
  let a = from;
  for (const b of route) {
    for (let i = 0; i <= 40; i += 1) assert.ok(isFree(model, { x: a.x + ((b.x - a.x) * i) / 40, y: a.y + ((b.y - a.y) * i) / 40 }), 'walks through free space only');
    a = b;
  }
});

test('with a door closed the route is found through it, and the walker knows to open it', () => {
  const { model, space } = apartment();
  const lobbyDoor = space.doors.find((d) => Math.abs(d.centre.x - 4.6) < 0.2 && Math.abs(d.centre.y - 7.4) < 0.3);
  setDoorClosed(model, lobbyDoor.id, true);
  // The balcony doors (closed in the live walkthrough by default) too: every way to the bedroom is a closed door.
  const closed = new Set([lobbyDoor.id]);
  for (const d of space.doors) if (Math.abs(d.centre.y - 1.8) < 0.05) { setDoorClosed(model, d.id, true); closed.add(d.id); }
  const from = { x: 3.2, y: 5.9 };
  assert.equal(findPath(model, from, { x: 9.9, y: 3.6 }), null, 'a closed door stops a walker who cannot open doors');
  const route = findPath(model, from, { x: 9.9, y: 3.6 }, { throughDoors: true });
  assert.ok(route);
  // Which closed door the route takes depends on where the rebuilt furniture stands; whichever
  // it is, the walker knows it has to open it.
  const passed = doorsOnRoute(model, from, route);
  assert.ok(passed.length > 0 && passed.every((id) => closed.has(id)), JSON.stringify(passed));
});

test('Live Here offers what this reconstructed apartment can do, and nothing it cannot', () => {
  // Facts as the scene reports them, from the built design's matched assets.
  const { state } = apartment();
  const by = new Map(ASSETS.map((a) => [a.code, a]));
  const roleOf = { 'dev/kitchen-run': ['COFFEE', 'STOVE', 'FAUCET', 'OVEN', 'CABINET'], 'dev/fridge': ['APPLIANCE'], 'dev/tv-unit': ['TV'] };
  const actions = { COFFEE: ['MAKE_COFFEE', 'DRINK'], STOVE: ['COOK', 'SERVE', 'TURN_ON', 'TURN_OFF'], FAUCET: ['TURN_ON', 'WASH_HANDS', 'TURN_OFF'], OVEN: ['OPEN', 'CLOSE'], CABINET: ['OPEN', 'CLOSE'], APPLIANCE: ['OPEN', 'CLOSE'], TV: ['TURN_ON', 'TURN_OFF'] };
  const machines = [];
  for (const o of state.objects) for (const role of roleOf[o.assetId] ?? []) {
    machines.push({ key: `obj:${o.instanceId}:${role}`, role, objectId: o.instanceId, state: 'X', actions: [], allActions: actions[role], at: { x: o.position.x, y: o.position.z }, outdoor: false });
  }
  machines.push({ key: 'door:d-living-balcony', role: 'BALCONY_DOOR', objectId: null, state: 'CLOSED', actions: ['OPEN'], allActions: ['OPEN', 'CLOSE'], at: { x: 2.8, y: 1.8 }, outdoor: false });
  const seats = state.objects.filter((o) => ['SITTABLE', 'LIEABLE'].some((c) => by.get(o.assetId).capabilities.includes(c))).map((o) => ({
    objectId: o.instanceId, postures: by.get(o.assetId).capabilities.includes('LIEABLE') ? ['SIT', 'LIE'] : ['SIT'],
    at: { x: o.position.x, y: o.position.z }, outdoor: o.position.z < 1.8,
  }));
  const facts = { machines, seats };
  const ids = availableExperiences(facts, { x: 3, y: 5 }).map((x) => x.id).sort();
  assert.deepEqual(ids, ['balcony', 'coffee', 'dinner', 'evening', 'kitchen', 'rest', 'tv']);
  // Relax on the balcony: open the balcony door, then an OUTDOOR chair.
  const balcony = planExperience(availableExperiences(facts, { x: 3, y: 5 }).find((x) => x.id === 'balcony'), facts, { x: 3, y: 5 });
  const seat = resolveStep(balcony[1], facts, { x: 3, y: 5 });
  assert.ok(seats.find((s) => s.objectId === seat.objectId).outdoor);
  // A home with nothing to cook on offers no dinner.
  const bare = { machines: machines.filter((m) => m.role !== 'STOVE'), seats };
  assert.ok(!availableExperiences(bare, { x: 3, y: 5 }).some((x) => x.id === 'dinner'));
});
