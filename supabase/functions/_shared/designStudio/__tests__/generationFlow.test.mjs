// OpenAI-first generation, step by step, against an in-memory store with real
// compare-and-set semantics: one image call per render, an interrupted request
// never paid twice, the money settled once, no factory anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { driveUntilMap, GEN_LEASE_MS, genNext, MAX_MAP_ATTEMPTS, MAX_SCENE_ATTEMPTS, runImageStep, runMapStep, runSceneStep } from '../generationFlow.ts';

const W = 120; const H = 80;
function picture() {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3; const sofa = x >= 30 && x < 90 && y >= 40 && y < 70;
    data[i] = sofa ? 90 : 200; data[i + 1] = sofa ? 110 : 180; data[i + 2] = sofa ? 95 : 150;
  }
  return { width: W, height: H, data, channels: 3 };
}
const SCENE = [
  { label: 'FLOOR', kind: 'FLOOR', room: 'R1', outline: [[0, 0.4], [1, 0.4], [1, 1], [0, 1]], inside: [[0.05, 0.95]] },
  { label: 'SOFA', kind: 'OBJECT', room: 'R1', outline: [[0.25, 0.5], [0.75, 0.5], [0.75, 0.87], [0.5, 0.9], [0.25, 0.87]], inside: [[0.5, 0.7]] },
];

function harness(opts = {}) {
  let clock = Date.parse('2026-10-02T10:00:00Z');
  const rows = new Map();
  const calls = { image: 0, scene: 0, factory: 0, runpod: 0, blender: 0, assets: 0, settle: 0, release: 0, putPicture: 0, putIds: 0 };
  const row0 = {
    id: 'r1', user_id: 'u1', project_id: 'p1', kind: 'MASTER', status: 'QUEUED', factory_job_id: null, final_key: null, map_key: null, legend: null,
    lease_at: null, finish: { generator: 'OPENAI_FIRST', mode: 'MASTER' }, billing: { state: 'RESERVED', credits: 6 },
    timings: { requestedAt: new Date(clock).toISOString(), ai: { step: 'IMAGE', mode: 'MASTER', specJobId: 'spec-1' } },
  };
  rows.set('r1', structuredClone(row0));
  const leaseLive = (r) => r.lease_at && Date.parse(r.lease_at) > clock - GEN_LEASE_MS;
  const io = {
    now: () => clock,
    async claim(row, from, patch) {
      const r = rows.get(row.id);
      if (!from.includes(r.status)) return null;
      if (r.status !== 'QUEUED' && leaseLive(r)) return null;
      Object.assign(r, structuredClone(patch)); return structuredClone(r);
    },
    async reload(row) { return structuredClone(rows.get(row.id)); },
    async save(row, lease, patch) {
      const r = rows.get(row.id);
      if (r.lease_at !== lease) return null;
      Object.assign(r, structuredClone(patch)); return structuredClone(r);
    },
    async reference() { return opts.noReference ? null : { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }; },
    async instruction() { return 'IMMUTABLE… CREATIVE…'; },
    size: () => ({ width: 1536, height: 1024 }),
    async image() {
      calls.image += 1;
      if (opts.crashAfterAsk) { opts.crashAfterAsk = false; throw new Error('worker killed'); }
      if (opts.imageRefused) return { ok: false, provider: 'OPENAI', model: 'gpt-image-2', error: 'PROVIDER_REFUSED_400', ms: 5, cost: { usd: null, basis: 'UNPRICED' } };
      return { ok: true, provider: 'OPENAI', model: 'gpt-image-2', bytes: new Uint8Array([9]), mime: 'image/png', ms: 40, cost: { usd: opts.unpriced ? null : 0.19, basis: opts.unpriced ? 'UNPRICED' : 'ESTIMATED' } };
    },
    async putPicture() { calls.putPicture += 1; return 'users/u1/design-studio-thumbnails/p1/final.png'; },
    async readPicture() { return new Uint8Array([9]); },
    async scene() { calls.scene += 1; return opts.sceneFails ? null : { elements: SCENE, usd: 0.012 }; },
    async storeScene() { return 'scene-job-1'; },
    async loadScene() { return SCENE; },
    async rooms() { return new Set(['R1']); },
    decode: () => ({ ok: true, img: picture() }),
    encodeIds: (ids) => new Uint8Array(ids.data.length ? [1] : []),
    async putIds() { calls.putIds += 1; return 'users/u1/design-studio-thumbnails/p1/ids.png'; },
    async close(row, outcome, m) { calls[outcome === 'SETTLE' ? 'settle' : 'release'] += 1; rows.get(row.id).billing = { ...row.billing, state: outcome === 'SETTLE' ? 'SETTLED' : 'RELEASED', measured: m }; return rows.get(row.id).billing; },
    async fail(row, code, lease) {
      const r = rows.get(row.id);
      if (!['QUEUED', 'RENDERING', 'FINISHING'].includes(r.status)) return false;
      if (lease && r.lease_at !== lease) return false;
      Object.assign(r, { status: 'FAILED', error: code, lease_at: null });
      await io.close(r, 'RELEASE', { aiUsd: null, aiKnown: false });
      return true;
    },
  };
  return { io, rows, calls, row: () => structuredClone(rows.get('r1')), tick: (ms) => { clock += ms; } };
}

async function finish(h) {
  await driveUntilMap(h.io, h.row());
  await runMapStep(h.io, h.row());
  return h.row();
}

test('MASTER: one image call, the scene, the edit map, READY, the money settled once — and no factory at all', async () => {
  const h = harness();
  const done = await finish(h);
  assert.equal(done.status, 'READY');
  assert.equal(h.calls.image, 1);
  assert.equal(h.calls.scene, 1);
  assert.ok(done.final_key && done.map_key, 'the picture and its id picture are stored');
  assert.ok(done.legend.entries.some((e) => /^ai:sofa:\d$/.test(e.id)) && done.legend.entries.some((e) => e.kind === 'FLOOR'));
  assert.equal(done.factory_job_id, null);
  assert.deepEqual([h.calls.factory, h.calls.runpod, h.calls.blender, h.calls.assets], [0, 0, 0, 0]);
  assert.equal(h.calls.settle, 1); assert.equal(h.calls.release, 0);
  assert.equal(done.billing.measured.aiKnown, true);
  assert.ok(Math.abs(done.billing.measured.aiUsd - 0.202) < 1e-9, 'image + scene');
  assert.equal(done.finish.editMap.state, 'READY');
  assert.equal(done.finish.provider, 'OPENAI');
  // Polling a READY row does nothing.
  assert.equal(genNext(done, h.io.now()).action, 'NONE');
  await driveUntilMap(h.io, done); await runMapStep(h.io, done);
  assert.equal(h.calls.image, 1); assert.equal(h.calls.settle, 1);
});

test('two pollers at once: one image call (the lease)', async () => {
  const h = harness();
  const [a, b] = await Promise.all([runImageStep(h.io, h.row()), runImageStep(h.io, h.row())]);
  assert.deepEqual([a, b].sort(), ['BUSY', 'STORED']);
  assert.equal(h.calls.image, 1);
});

test('a worker killed after asking for the picture: never asked again — FAILED and released, cost unknown', async () => {
  const h = harness({ crashAfterAsk: true });
  await assert.rejects(runImageStep(h.io, h.row()));
  assert.ok(h.row().timings.ai.imageRequestedAt, 'the request was recorded before it was made');
  assert.equal(genNext(h.row(), h.io.now()).action, 'WAIT', 'the lease is still live');
  h.tick(GEN_LEASE_MS + 1000);
  assert.deepEqual(genNext(h.row(), h.io.now()), { action: 'FAIL', code: 'GENERATION_INTERRUPTED' });
  await driveUntilMap(h.io, h.row());
  assert.equal(h.row().status, 'FAILED');
  assert.equal(h.calls.image, 1, 'no second paid request');
  assert.equal(h.calls.release, 1); assert.equal(h.calls.settle, 0);
});

test('a refused image: FAILED and released, its unknown cost stays unknown', async () => {
  const h = harness({ imageRefused: true });
  await driveUntilMap(h.io, h.row());
  assert.equal(h.row().status, 'FAILED');
  assert.match(h.row().error, /^IMAGE_PROVIDER_REFUSED_400/);
  assert.equal(h.calls.release, 1);
  assert.equal(h.row().timings.ai.imageKnown, false);
});

test('an unpriced image is never settled as free', async () => {
  const h = harness({ unpriced: true });
  const done = await finish(h);
  assert.equal(done.status, 'READY');
  assert.equal(done.billing.measured.aiKnown, false);
  assert.equal(done.billing.measured.aiUsd, null);
});

test('the scene fails twice: the design is still READY, honestly not object-editable', async () => {
  const h = harness({ sceneFails: true });
  await driveUntilMap(h.io, h.row());
  assert.equal(h.row().timings.ai.step, 'SCENE');
  await driveUntilMap(h.io, h.row());
  assert.equal(h.row().timings.ai.step, 'MAP');
  assert.equal(h.calls.scene, MAX_SCENE_ATTEMPTS);
  await runMapStep(h.io, h.row());
  const done = h.row();
  assert.equal(done.status, 'READY');
  assert.equal(done.map_key, null);
  assert.deepEqual(done.finish.editMap, { state: 'UNAVAILABLE', reason: 'NO_SCENE' });
  assert.equal(h.calls.image, 1); assert.equal(h.calls.settle, 1);
});

test('no reference picture: failed before anything is asked or paid', async () => {
  const h = harness({ noReference: true });
  await driveUntilMap(h.io, h.row());
  assert.equal(h.row().status, 'FAILED');
  assert.equal(h.row().error, 'REFERENCE_MISSING');
  assert.equal(h.calls.image, 0);
});

test('a factory render row is never touched by the generation flow', () => {
  assert.equal(genNext({ status: 'QUEUED', factory_job_id: 'job-1', timings: { ai: { step: 'IMAGE' } } }, Date.now()).action, 'NONE');
  assert.equal(genNext({ status: 'QUEUED', factory_job_id: null, timings: {} }, Date.now()).action, 'NONE');
});

test('a map step whose invocation keeps dying is not tried forever: the picture is finished and shown without its edit map', async () => {
  // Production 2026-10-03: the map step was killed by the edge CPU budget; the lease lapsed and it was claimed again, forever.
  const h = harness();
  await driveUntilMap(h.io, h.row());
  const decode = h.io.decode;
  h.io.decode = () => { throw new Error('worker killed (CPU budget)'); };
  for (let i = 0; i < MAX_MAP_ATTEMPTS; i += 1) {
    await assert.rejects(runMapStep(h.io, h.row()));
    assert.equal(h.row().status, 'FINISHING', 'still finishing while attempts remain');
    h.tick(GEN_LEASE_MS + 1000); // the dead invocation's lease lapses
  }
  h.io.decode = decode;
  await runMapStep(h.io, h.row());
  const done = h.row();
  assert.equal(done.status, 'READY', 'the picture is the result');
  assert.ok(done.final_key);
  assert.equal(done.map_key, null);
  assert.deepEqual(done.finish.editMap, { state: 'UNAVAILABLE', reason: 'MAP_BUDGET' });
  assert.equal(done.timings.ai.mapAttempts, MAX_MAP_ATTEMPTS + 1);
  assert.equal(h.calls.settle, 1, 'settled once');
  assert.equal(h.calls.image, 1, 'never a second picture');
});
