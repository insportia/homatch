// FIND BUYERS — the active-search network field is deterministic, bounded and
// moves only as much as the server's state allows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildField, edgeAlpha, fieldModeFor, hashSeed, headPosition, intensityFor, particleBudget, settle, stepField,
} from '../motion/searchField.ts';

const SRC = readFileSync(new URL('../motion/searchField.ts', import.meta.url), 'utf8');

test('motion follows the real lifecycle only', () => {
  for (const s of ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS']) assert.equal(fieldModeFor(s), 'searching');
  assert.equal(fieldModeFor('PAUSING'), 'pausing');
  assert.equal(fieldModeFor('PAUSED'), 'paused');
  for (const s of ['COMPLETED_WITH_RESULTS', 'COMPLETED_NO_RESULTS', 'FAILED', 'CANCELLED', null]) assert.equal(fieldModeFor(s), 'finished');
  assert.ok(intensityFor('searching') > intensityFor('pausing'));
  assert.ok(intensityFor('pausing') > intensityFor('finished'));
  assert.equal(intensityFor('paused'), 0, 'paused is a still frame');
});

test('deterministic: the same seed and steps draw the same field; no Math.random, no timers', () => {
  const run = () => { const f = buildField(hashSeed('job-1'), 2.4, particleBudget(800, 260)); for (let i = 0; i < 400; i += 1) stepField(f, 1 / 60, 1); return f; };
  const a = run(); const b = run();
  assert.deepEqual(headPosition(a), headPosition(b));
  assert.deepEqual(a.trail.slice(0, 5), b.trail.slice(0, 5));
  assert.equal(a.edges.length, b.edges.length);
  assert.notDeepEqual(headPosition(buildField(hashSeed('job-2'), 2.4, particleBudget(800, 260))), headPosition(buildField(hashSeed('job-1'), 2.4, particleBudget(800, 260))));
  assert.doesNotMatch(SRC, /Math\.random|setInterval|setTimeout|Date\.now/);
});

test('the head travels, branches and the network reconnects while searching', () => {
  const f = buildField(7, 2, particleBudget(640, 240));
  const start = headPosition(f);
  let maxPulses = 0; let rewired = false;
  for (let i = 0; i < 900; i += 1) {
    stepField(f, 1 / 60, 1);
    maxPulses = Math.max(maxPulses, f.pulses.length);
    if (f.edges.some((e) => e.born > 0)) rewired = true;
  }
  assert.notDeepEqual(headPosition(f), start, 'the search head moves');
  assert.ok(maxPulses > 0, 'pulses branch from the head');
  assert.ok(maxPulses <= f.budget.pulses, 'within budget');
  assert.ok(rewired, 'paths reconnect');
  assert.ok(f.trail.length <= f.budget.trail);
  for (const e of f.edges) { const v = edgeAlpha(f, e); assert.ok(v >= 0 && v <= 1); }
  for (const n of f.nodes) assert.ok(n.x >= 0 && n.x <= f.aspect && n.y >= 0 && n.y <= 1);
});

test('paused: nothing moves at intensity 0', () => {
  const f = buildField(3, 2, particleBudget(640, 240));
  settle(f, 2);
  const before = JSON.stringify({ h: headPosition(f), t: f.time, m: f.motes[0] });
  for (let i = 0; i < 120; i += 1) stepField(f, 1 / 60, intensityFor('paused'));
  assert.equal(JSON.stringify({ h: headPosition(f), t: f.time, m: f.motes[0] }), before);
});

test('low-power and small screens get a smaller particle budget', () => {
  const desk = particleBudget(1200, 260); const phone = particleBudget(358, 200); const low = particleBudget(1200, 260, true);
  assert.ok(phone.nodes < desk.nodes && phone.motes < desk.motes);
  assert.ok(low.nodes < desk.nodes && low.motes < desk.motes && low.pulses < desk.pulses);
  assert.ok(phone.nodes >= 26, 'never so few the field reads empty');
});
