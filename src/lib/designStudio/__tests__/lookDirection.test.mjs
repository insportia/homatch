// Look direction is tested as a person sees it, not as a sign in the maths:
// a point straight ahead must slide LEFT on screen when the view turns right.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_SETTINGS, look } from '../player.ts';

/** The walk camera exactly as SceneController.placeWalkCamera places it. */
function cameraAt(yaw, pitch) {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  const pos = { x: 0, y: 0 }; const eye = 1.6; const cp = Math.cos(pitch);
  cam.position.set(pos.x, eye, -pos.y);
  cam.lookAt(pos.x + Math.cos(yaw) * cp, eye + Math.sin(pitch), -(pos.y + Math.sin(yaw) * cp));
  cam.updateMatrixWorld(true);
  return cam;
}
const screenOf = (cam, p) => new THREE.Vector3(...p).project(cam);

// A marker straight ahead of the starting view, 5 m away.
const start = { yaw: 0.4, pitch: 0 };
const ahead = [Math.cos(start.yaw) * 5, 1.6, -Math.sin(start.yaw) * 5];

test('moving the mouse (or dragging) RIGHT turns the view RIGHT', () => {
  const next = look(start.yaw, start.pitch, 120, 0, DEFAULT_SETTINGS);
  const s = screenOf(cameraAt(next.yaw, next.pitch), ahead);
  assert.ok(s.x < -0.05, `the marker should slide left when the view turns right (ndc x ${s.x.toFixed(3)})`);
});

test('moving LEFT turns the view LEFT', () => {
  const next = look(start.yaw, start.pitch, -120, 0, DEFAULT_SETTINGS);
  assert.ok(screenOf(cameraAt(next.yaw, next.pitch), ahead).x > 0.05);
});

test('moving UP looks UP, moving DOWN looks DOWN (not inverted by default)', () => {
  const up = look(start.yaw, start.pitch, 0, -120, DEFAULT_SETTINGS); // screen y grows downward
  assert.ok(screenOf(cameraAt(up.yaw, up.pitch), ahead).y < -0.05, 'looking up moves the horizon marker down the screen');
  const down = look(start.yaw, start.pitch, 0, 120, DEFAULT_SETTINGS);
  assert.ok(screenOf(cameraAt(down.yaw, down.pitch), ahead).y > 0.05);
});

test('invert settings flip only their own axis, and are off by default', () => {
  assert.equal(DEFAULT_SETTINGS.invertY, false);
  assert.equal(DEFAULT_SETTINGS.invertX ?? false, false);
});

test('Invert horizontal, when a visitor chooses it, flips only the horizontal', () => {
  const inv = { ...DEFAULT_SETTINGS, invertX: true };
  const next = look(start.yaw, start.pitch, 120, 0, inv);
  assert.ok(screenOf(cameraAt(next.yaw, next.pitch), ahead).x > 0.05, 'inverted: moving right turns left');
  const v = look(start.yaw, start.pitch, 0, -120, inv);
  assert.ok(screenOf(cameraAt(v.yaw, v.pitch), ahead).y < -0.05, 'vertical unchanged');
});
