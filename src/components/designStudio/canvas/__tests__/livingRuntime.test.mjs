// The living engine, run on real concept blocks with a controlled clock:
// states change by the clock (not by frames), parts move smoothly and
// reversibly, effects rise and fall, doors block and unblock, a hand can
// drag a door, and a reset leaves nothing behind.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildProcedural, slotColors } from '../procedural.ts';
import { LivingRuntime } from '../livingRuntime.ts';
import { validateInteractions } from '../../../../lib/designStudio/interactions.ts';
import { seedAssets } from '../../../../lib/designStudio/__tests__/seedCatalog.mjs';

const ASSETS = new Map(seedAssets().map((a) => [a.code, a]));

function rig(code, opts = {}) {
  const a = ASSETS.get(code);
  const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null));
  const doors = [];
  let changes = 0;
  const rt = new LivingRuntime({ reducedMotion: !!opts.reduced, maxLights: opts.maxLights ?? 8, onDoor: (id, b) => doors.push([id, b]), onChange: () => { changes += 1; } });
  rt.register('obj:x', g, validateInteractions(g.userData.interactions), a.capabilities, { objectId: 'x', doorId: opts.doorId });
  return { a, g, rt, doors, changes: () => changes };
}

const state = (rt, key) => rt.states().find((s) => s.key === key)?.state;

test('a coffee brews on the clock and is drunk: IDLE → BREWING → READY → SIPPING → IDLE', () => {
  const { rt } = rig('dev/kitchen-run');
  const key = 'obj:x:coffee';
  assert.equal(state(rt, key), 'IDLE');
  assert.equal(rt.act(key, 'DRINK', 0), false, 'nothing to drink yet');
  assert.ok(rt.act(key, 'MAKE_COFFEE', 0));
  rt.step(1000);
  assert.equal(state(rt, key), 'BREWING', 'still brewing a second in');
  rt.step(2800); // arrival in BREWING, which moves on by itself
  rt.step(2801);
  rt.step(3400);
  assert.equal(state(rt, key), 'READY');
  assert.ok(rt.act(key, 'DRINK', 3500));
  rt.step(4600);
  rt.step(5400);
  rt.step(6500);
  assert.equal(state(rt, key), 'IDLE', 'the cup goes back down, empty');
});

test('motion is time-based: the same moment gives the same pose, however many frames came before', () => {
  const a = rig('dev/wardrobe-2');
  const b = rig('dev/wardrobe-2');
  a.rt.act('obj:x:door-1', 'OPEN', 0);
  b.rt.act('obj:x:door-1', 'OPEN', 0);
  for (let t = 0; t < 300; t += 16) a.rt.step(t); // 60 fps…
  a.rt.step(300); // …arriving at the same moment
  b.rt.step(300); // one frame
  const ra = a.g.getObjectByName('ix:door-1').rotation.y;
  const rb = b.g.getObjectByName('ix:door-1').rotation.y;
  assert.ok(Math.abs(ra - rb) < 1e-9, `${ra} vs ${rb}`);
  assert.ok(ra > 0 && ra < 1.65, 'part-way, eased');
});

test('reversing half-way turns back from where it is, never jumping', () => {
  const { g, rt } = rig('dev/wardrobe-2');
  const door = g.getObjectByName('ix:door-1');
  rt.act('obj:x:door-1', 'OPEN', 0);
  rt.step(325);
  const mid = door.rotation.y;
  assert.ok(rt.act('obj:x:door-1', 'CLOSE', 325));
  rt.step(326);
  assert.ok(Math.abs(door.rotation.y - mid) < 0.05, 'continuous at the reversal');
  rt.step(2000);
  assert.ok(Math.abs(door.rotation.y) < 1e-9);
  assert.equal(state(rt, 'obj:x:door-1'), 'CLOSED');
});

test('a switch lights a real light within the budget, and a flush switches itself off', () => {
  const lamp = rig('dev/floor-lamp');
  const light = lamp.g.getObjectByName('ix:shade').children.find((c) => c.isPointLight);
  assert.ok(light, 'a point light exists from the start (switching never changes the light count)');
  assert.equal(light.intensity, 0);
  lamp.rt.act('obj:x:lamp', 'TURN_ON', 0);
  lamp.rt.step(1000);
  assert.ok(light.intensity > 1);
  const none = rig('dev/floor-lamp', { maxLights: 0 });
  assert.ok(!none.g.getObjectByName('ix:shade').children.some((c) => c.isPointLight), 'over budget: glow only');
  const wc = rig('dev/toilet');
  assert.ok(wc.rt.act('obj:x:flush', 'FLUSH', 0));
  wc.rt.step(600);
  assert.equal(state(wc.rt, 'obj:x:flush'), 'ON');
  wc.rt.step(2900);
  wc.rt.step(3500);
  assert.equal(state(wc.rt, 'obj:x:flush'), 'OFF');
});

test('water appears and disappears; a steak browns as it cooks', () => {
  const { g, rt } = rig('dev/kitchen-run');
  const water = g.getObjectByName('ix:tap-water');
  assert.equal(water.visible, false);
  rt.act('obj:x:tap', 'WASH_HANDS', 0);
  rt.step(400);
  assert.equal(water.visible, true);
  rt.step(4000);
  rt.step(4500);
  assert.equal(water.visible, false, 'a hand wash turns the tap off by itself');
  const steak = g.getObjectByName('ix:steak');
  assert.equal(steak.visible, false);
  rt.act('obj:x:cook', 'COOK', 0);
  rt.step(500); rt.step(501);
  const raw = steak.children[0].material.color.clone();
  rt.step(3000);
  rt.step(6000); rt.step(6001); rt.step(7000);
  assert.equal(state(rt, 'obj:x:cook'), 'DONE');
  const cooked = steak.children[0].material.color;
  assert.ok(cooked.r < raw.r, 'browner than it went in');
});

test('a door blocks when closed, frees the way when opened, and can be dragged by hand', () => {
  const g = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.name = 'ix:d1';
  pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.04), new THREE.MeshStandardMaterial()));
  g.add(pivot);
  const doors = [];
  const rt = new LivingRuntime({ reducedMotion: false, maxLights: 0, onDoor: (id, b) => doors.push([id, b]), onChange: () => {} });
  rt.register('door', pivot, [{ id: 'd1', kind: 'HINGED', role: 'DOOR', axis: 'y', open: 1.5, durationMs: 900, initiallyOpen: true }], null, { objectId: null, doorId: () => 'd1' });
  assert.deepEqual(doors.at(-1), ['d1', false], 'starts open: passable');
  rt.act('door:d1', 'CLOSE', 0);
  assert.deepEqual(doors.at(-1), ['d1', true], 'closing blocks at once');
  rt.step(2000);
  const e = rt.get('door:d1');
  assert.ok(rt.canScrub(e));
  rt.scrubTo('door:d1', 0.3);
  assert.ok(Math.abs(pivot.rotation.y - 0.45) < 1e-6, 'follows the hand exactly');
  assert.deepEqual(doors.at(-1), ['d1', true], 'a door a hand-width open still blocks a body');
  rt.scrubTo('door:d1', 0.8);
  assert.deepEqual(doors.at(-1), ['d1', false]);
  rt.scrubEnd('door:d1', 0, 5000);
  rt.step(6000);
  assert.equal(state(rt, 'door:d1'), 'OPEN', 'released past half-way: finishes opening');
});

test('reduced motion: every change is immediate', () => {
  const { g, rt } = rig('dev/wardrobe-2', { reduced: true });
  rt.act('obj:x:door-1', 'OPEN', 0);
  assert.equal(state(rt, 'obj:x:door-1'), 'OPEN');
  assert.ok(Math.abs(g.getObjectByName('ix:door-1').rotation.y - 1.65) < 1e-9);
});

test('a reset puts everything back as the design has it', () => {
  const { g, rt } = rig('dev/bed-double');
  const duvet = g.getObjectByName('ix:duvet');
  const before = duvet.scale.y;
  rt.act('obj:x:bedding', 'MESS_BED', 0);
  rt.step(2000);
  assert.ok(duvet.scale.y > before * 1.5, 'a slept-in duvet');
  rt.reset();
  assert.equal(duvet.scale.y, before);
  assert.equal(state(rt, 'obj:x:bedding'), 'MADE');
});

test('seats are anchors, in the piece’s own frame, facing its front', () => {
  const { g, rt } = rig('dev/sofa-3');
  g.position.set(2, 0, -3);
  g.rotation.y = Math.PI / 2;
  g.updateMatrixWorld(true);
  const set = rt.seatsOf('x');
  assert.equal(set.seats.length, 3);
  const s = rt.worldSeat(set, set.seats[1]);
  assert.ok(Math.abs(s.eye - 1.12) < 1e-9);
  // Rotated a quarter turn, the front (local −z) faces world −x: plan yaw π.
  assert.ok(Math.abs(Math.abs(s.yaw) - Math.PI) < 1e-6, String(s.yaw));
});

test('a piece without the capability does not get the interaction', () => {
  const a = ASSETS.get('dev/floor-lamp');
  const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null));
  const rt = new LivingRuntime({ reducedMotion: false, maxLights: 4, onDoor: () => {}, onChange: () => {} });
  rt.register('obj:y', g, validateInteractions(g.userData.interactions), ['MOVABLE'], { objectId: 'y' });
  assert.equal(rt.size, 0);
});
