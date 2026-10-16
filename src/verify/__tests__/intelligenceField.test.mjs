import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  formationFor, particleBudget, createParticles, step, targetFor, FEEL,
} from '../motion/intelligenceField.ts';
import { networkState } from '../researchNetwork.ts';

/*
 * The research animation follows REAL research state. Each research-agent
 * stage maps to its own formation; nothing here can show progress that the
 * server did not report.
 */
test('formations follow the real research-agent stage', () => {
  const at = (stage, extra = {}) => formationFor(networkState({ status: 'RUNNING', stage, ...extra }));
  assert.equal(at('IDENTITY_WAITING'), 'GATHER');
  assert.equal(at('BROWSER_WAITING'), 'LATTICE');
  assert.equal(at('PUBLIC_RESEARCH_WAITING'), 'WAVE');
  assert.equal(at('MARKET_WAITING'), 'STREAMS');
  assert.equal(at('SYNTHESIS_WAITING'), 'CONVERGE');
  assert.equal(formationFor(networkState({ status: 'COMPLETE', stage: 'COMPLETE', reportReady: true })), 'REST');
  assert.equal(formationFor(networkState({ status: 'FAILED', stage: 'OFFICIAL_READY' })), 'DIM');
  // Every formation the mapping can produce has a defined feel.
  for (const f of ['GATHER', 'LATTICE', 'ORBIT', 'WAVE', 'STREAMS', 'WEAVE', 'CONVERGE', 'REST', 'DIM']) assert.ok(FEEL[f]);
});

test('particle budget scales with the surface, trims on low-power devices, stays bounded', () => {
  const phone = particleBudget(320, 200);
  const desk = particleBudget(1100, 300);
  assert.ok(desk.dust > phone.dust);
  assert.ok(particleBudget(1100, 300, true).dust < desk.dust);
  const huge = particleBudget(4000, 2000);
  assert.ok(huge.dust <= 90 && huge.motes <= 46, 'never clutter');
  assert.ok(particleBudget(10, 10).dust >= 18, 'never empty');
});

test('particles vary individually and are deterministic across remounts', () => {
  const b = particleBudget(800, 300);
  const a1 = createParticles(b, 2.6);
  const a2 = createParticles(b, 2.6);
  assert.deepEqual(a1, a2, 'same seed, same field');
  const sizes = new Set(a1.filter((p) => p.fam === 'MOTE').map((p) => p.size.toFixed(2)));
  assert.ok(sizes.size > 10, 'motes are not identical circles');
  assert.deepEqual([...new Set(a1.map((p) => p.fam))].sort(), ['ANCHOR', 'CARRIER', 'DUST', 'MOTE']);
});

test('the simulation stays finite and inside the field through every formation and frame rate', () => {
  for (const fps of [30, 60, 120]) {
    const b = particleBudget(800, 300);
    const ps = createParticles(b, 2.6);
    let t = 0;
    for (const f of ['GATHER', 'LATTICE', 'ORBIT', 'WAVE', 'STREAMS', 'WEAVE', 'CONVERGE', 'REST', 'DIM']) {
      for (let i = 0; i < fps * 3; i++) {
        t += 1 / fps;
        step(ps, f, t, 1 / fps, 2.6, { motes: b.motes, anchors: b.anchors });
      }
      for (const p of ps) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${f}@${fps}`);
        assert.ok(Math.abs(p.x) < 2.6 * 1.6 && Math.abs(p.y) < 1.6, `${f}@${fps} escaped: ${p.fam} ${p.x},${p.y}`);
      }
    }
  }
});

test('targets are smooth in time (no jumps a spring would have to chase)', () => {
  for (const f of ['GATHER', 'LATTICE', 'ORBIT', 'WAVE', 'STREAMS', 'WEAVE', 'CONVERGE', 'REST']) {
    for (let slot = 0; slot < 20; slot++) {
      const [x0, y0] = targetFor(f, 'MOTE', slot, 20, 10, 2.4);
      const [x1, y1] = targetFor(f, 'MOTE', slot, 20, 10.016, 2.4);
      // Wrap-around lanes (WAVE/STREAMS) may jump once per long cycle; allow that edge.
      const d = Math.hypot(x1 - x0, y1 - y0);
      assert.ok(d < 0.05 || d > 3, `${f} slot ${slot} jumped ${d}`);
    }
  }
});

test('the renderer cleans up, respects reduced motion, pauses when hidden, and draws no progress value', () => {
  const src = fs.readFileSync(new URL('../../components/verify/ResearchNetwork.tsx', import.meta.url), 'utf8');
  assert.match(src, /cancelAnimationFrame/);
  assert.match(src, /ro\.disconnect\(\)/);
  assert.match(src, /io\.disconnect\(\)/);
  assert.match(src, /removeEventListener\('visibilitychange'/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /aria-hidden="true"/);
  assert.ok(!/shadowBlur|filter\s*=/.test(src), 'glows are sprites, not per-frame blur');
  assert.ok(!/percent|aria-valuenow|estimateProgress/.test(src));
});
