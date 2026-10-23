// Content Studio edge function: admin-only door, GPU-busy refusal (customer jobs first), immutable versions,
// server-chosen render numbers, outputs verified in R2, no secret ever returned. Database, RunPod and R2 faked.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: () => undefined } };
const { handler, stageKeys } = await import('../index.ts');
const { resetServiceControlCache } = await import('../../_shared/serviceControl.ts');

const RUNPOD_KEY = 'rpa_SUPERSECRETRUNPODKEY';
const ORIGIN = 'https://homatch.live';
const KEYS = stageKeys('HOMI', 'v001', 'PREVIEW_360');

function world({ admin = true, customerJobs = [], renders = [], walkthroughs = [], endpoint = { inQueue: 0, inProgress: 0 }, designStudio = true, objects = {}, statusOf = {}, runStatus = 200 } = {}) {
  resetServiceControlCache();
  const tables = {
    service_controls: [{ service_key: 'design_studio', frontend_enabled: designStudio, backend_enabled: designStudio }],
    ds_factory_jobs: customerJobs,
    ds_renders: renders,
    ds_walkthroughs: walkthroughs,
    users: [{ id: 'u-admin', auth_id: 'auth-admin' }],
    admin_audit_log: [],
    impersonation_sessions: [],
  };
  const from = (table) => {
    const filters = [];
    let head = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: (_c, opts) => { head = Boolean(opts?.head); return q; },
      eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
      not: (k, op, list) => { const vs = list.replace(/[()]/g, '').split(','); filters.push((r) => !vs.includes(r[k])); return q; },
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: async (row) => { tables[table].push(row); return { error: null }; },
      then: (ok, ko) => Promise.resolve({ data: head ? null : rows(), count: rows().length, error: null }).then(ok, ko),
    };
    return q;
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const path = url.replace(/^https:\/\/api\.runpod\.ai\/v2\/ep123abc\//, '');
    if (path === 'health') return new Response(JSON.stringify({ jobs: endpoint, workers: { idle: 0, running: 0 } }));
    if (path === 'run') return runStatus === 200 ? new Response(JSON.stringify({ id: 'rp-job-0001', status: 'IN_QUEUE' })) : new Response('{}', { status: runStatus });
    if (path.startsWith('status/')) {
      const id = decodeURIComponent(path.slice(7));
      return statusOf[id] ? new Response(JSON.stringify(statusOf[id])) : new Response('{}', { status: 404 });
    }
    if (path.startsWith('cancel/')) return new Response('{}');
    return new Response('nope', { status: 500 });
  };
  const store = {
    objects: { ...objects },
    presigned: [],
    presignPut: async (key, seconds) => { store.presigned.push({ key, seconds }); return `https://acct.r2.cloudflarestorage.com/homatch-storage/${key}?X-Amz-Signature=sig`; },
    signedGet: async (key) => `https://acct.r2.cloudflarestorage.com/homatch-storage/${key}?X-Amz-Signature=get`,
    head: async (key) => (key in store.objects ? { exists: true, size: store.objects[key].length } : { exists: false, size: null }),
    getJson: async (key) => (key in store.objects ? JSON.parse(store.objects[key]) : null),
    // etag = the stored text's length + a write counter: enough to model R2's compare-and-swap
    etags: {},
    writes: 0,
    getRecord: async (key) => (key in store.objects ? { value: JSON.parse(store.objects[key]), etag: store.etags[key] ?? 'e0' } : null),
    putJson: async (key, value, cond) => {
      if (cond?.ifNoneMatch && key in store.objects) return false;
      if (cond?.ifMatch !== undefined && (store.etags[key] ?? 'e0') !== cond.ifMatch) return false;
      store.objects[key] = JSON.stringify(value);
      store.etags[key] = `e${++store.writes}`;
      return true;
    },
    configured: () => true,
  };
  const env = { RUNPOD_API_KEY: RUNPOD_KEY, RUNPOD_DS_ENDPOINT_ID: 'ep123abc', RUNPOD_DS_USD_PER_SECOND: '0.00031' };
  const deps = {
    env: (k) => env[k],
    db: { from },
    caller: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-admin' } }, error: null }) }, rpc: async () => ({ data: admin, error: null }) }),
    fetch, store, uuid: () => '123e4567-e89b-42d3-a456-426614174000', now: () => new Date('2026-10-23T12:00:00Z'),
  };
  return { deps, tables, calls, store };
}

const call = async (w, body, { origin = ORIGIN, auth = 'Bearer token' } = {}) => {
  const res = await handler(new Request('https://x/functions/v1/content-studio', { method: 'POST', headers: { origin, authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }), w.deps);
  const text = await res.text();
  assert.ok(!text.includes(RUNPOD_KEY), 'the RunPod key never leaves the function');
  return { status: res.status, body: JSON.parse(text), text };
};
const DISPATCH = { action: 'dispatch', asset: 'HOMI', version: 'v001', stage: 'PREVIEW_360', confirm: 'HOMI v001 PREVIEW_360' };

test('only an admin, with a token, from a HOMATCH origin', async () => {
  assert.equal((await call(world({ admin: false }), { action: 'preflight' })).status, 403);
  assert.equal((await call(world(), { action: 'preflight' }, { auth: '' })).status, 401);
  assert.equal((await call(world(), { action: 'preflight' }, { origin: 'https://evil.example' })).status, 403);
});

test('preflight says the GPU is free only with no customer job open and nothing on the endpoint', async () => {
  const free = await call(world(), { action: 'preflight' });
  assert.equal(free.body.ready, true);
  assert.equal(free.body.stages.PREVIEW_360.estimateUsd, 0.0744);
  const customer = await call(world({ customerJobs: [{ id: 'j', state: 'RUNNING' }, { id: 'k', state: 'COMPLETED' }] }), { action: 'preflight' });
  assert.equal(customer.body.ready, false);
  assert.equal(customer.body.customerJobsOpen, 1);
  const queued = await call(world({ endpoint: { inQueue: 1, inProgress: 0 } }), { action: 'preflight' });
  assert.equal(queued.body.ready, false);
});

test('dispatch is refused while a customer job is open or the endpoint is busy — RunPod is never asked to run', async () => {
  for (const w of [
    world({ customerJobs: [{ id: 'j', state: 'QUEUED' }] }),
    world({ endpoint: { inQueue: 0, inProgress: 1 } }),
    // a walkthrough still planning (no factory job yet) and an open render count as customer work too
    world({ walkthroughs: [{ id: 'w', state: 'PLANNING' }, { id: 'x', state: 'READY' }] }),
    world({ renders: [{ id: 'r', status: 'RESERVED' }] }),
  ]) {
    const r = await call(w, DISPATCH);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'GPU_BUSY');
    assert.ok(!w.calls.some((c) => c.url.endsWith('/run')));
  }
});

test('dispatch needs the typed confirmation, a known stage and asset, a vNNN version, and Design Studio switched on', async () => {
  assert.equal((await call(world(), { ...DISPATCH, confirm: 'yes' })).body.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await call(world(), { ...DISPATCH, stage: 'FINAL_4K' })).body.code, 'UNKNOWN_STAGE');
  assert.equal((await call(world(), { ...DISPATCH, asset: 'HUMAN' })).body.code, 'UNKNOWN_ASSET');
  assert.equal((await call(world(), { ...DISPATCH, version: '../v1', confirm: 'HOMI ../v1 PREVIEW_360' })).body.code, 'BAD_VERSION');
  assert.equal((await call(world({ designStudio: false }), DISPATCH)).body.code, 'SERVICE_DISABLED');
});

test('an approved version is immutable', async () => {
  const w = world({ objects: { [KEYS.manifest]: '{}' } });
  const r = await call(w, DISPATCH);
  assert.equal(r.body.code, 'VERSION_EXISTS');
  assert.ok(!w.calls.some((c) => c.url.endsWith('/run')));
});

test('a running version cannot be dispatched twice; a failed one can be retried', async () => {
  const record = { providerJobId: 'rp-job-0000', claimedAt: '2026-10-23T11:00:00Z' };
  const rec = { 'homatch-content/3D/characters/HOMI/versions/v001/jobs/PREVIEW_360.json': JSON.stringify(record) };
  assert.equal((await call(world({ objects: rec, statusOf: { 'rp-job-0000': { status: 'IN_PROGRESS' } } }), DISPATCH)).body.code, 'VERSION_IN_PROGRESS');
  assert.equal((await call(world({ objects: rec, statusOf: { 'rp-job-0000': { status: 'FAILED' } } }), DISPATCH)).status, 202);
});

test('dispatch sends only the content job, with server-chosen numbers and one PUT per key inside the version prefix', async () => {
  const w = world();
  const r = await call(w, { ...DISPATCH, render: { size: 1080, samples: 4096, frames: 9999 }, outputs: { blend: 'https://evil' } });
  assert.equal(r.status, 202);
  assert.equal(r.body.providerJobId, 'rp-job-0001');
  assert.ok(!r.text.includes('X-Amz-Signature'), 'the dispatch answer carries keys, not signed URLs');
  const run = w.calls.find((c) => c.url.endsWith('/run'));
  const sent = JSON.parse(run.init.body);
  assert.deepEqual(Object.keys(sent.input), ['contentStudio']);
  const job = sent.input.contentStudio;
  assert.deepEqual(job.render, { size: 720, samples: 32, frames: 72, fps: 18 });
  assert.equal(sent.policy.executionTimeout, 960_000);
  assert.deepEqual(Object.keys(job.outputs).sort(), Object.keys(KEYS).sort());
  for (const p of w.store.presigned) assert.ok(p.key.startsWith('homatch-content/3D/characters/HOMI/versions/v001/') && p.seconds <= 3600);
  const record = JSON.parse(w.store.objects['homatch-content/3D/characters/HOMI/versions/v001/jobs/PREVIEW_360.json']);
  assert.equal(record.providerJobId, 'rp-job-0001');
  assert.equal(w.tables.admin_audit_log[0].action, 'CONTENT_STUDIO_DISPATCH');
});

test('status reports success only when every output is in R2 with the exact size the worker measured', async () => {
  const record = { providerJobId: 'rp-job-0001' };
  const sizes = { blend: 11, glb: 7, turntable: 5, contactSheet: 4, face: 3, manifest: 2 };
  const objects = { 'homatch-content/3D/characters/HOMI/versions/v001/jobs/PREVIEW_360.json': JSON.stringify(record) };
  for (const [name, k] of Object.entries(KEYS)) objects[k] = 'x'.repeat(sizes[name]);
  const output = { ok: true, outputs: Object.fromEntries(Object.entries(sizes).map(([n, b]) => [n, { bytes: b, sha256: 'ab' }])), geometry: { objects: 138 } };
  const done = { status: 'COMPLETED', executionTime: 200_000, delayTime: 30_000, output };
  const ok = await call(world({ objects, statusOf: { 'rp-job-0001': done } }), { action: 'status', version: 'v001', providerJobId: 'rp-job-0001' });
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.estimatedUsd, 0.062);
  assert.ok(ok.body.verified.blend.url.includes('X-Amz-Signature=get'));
  const short = { ...objects, [KEYS.glb]: 'x' };
  const bad = await call(world({ objects: short, statusOf: { 'rp-job-0001': done } }), { action: 'status', version: 'v001', providerJobId: 'rp-job-0001' });
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.verified.glb.url, null);
  const other = await call(world({ objects, statusOf: { 'rp-job-9999': done } }), { action: 'status', version: 'v001', providerJobId: 'rp-job-9999' });
  assert.equal(other.status, 404, 'only the job recorded for this version');
});

test('a reference image gets one short PUT, never over an existing one', async () => {
  const fresh = await call(world(), { action: 'reference', asset: 'HOMI', file: 'HOMI_REF_hero_v001.png' });
  assert.equal(fresh.body.key, 'homatch-content/3D/characters/HOMI/references/HOMI_REF_hero_v001.png');
  assert.equal(fresh.body.expiresInSeconds, 300);
  const exists = await call(world({ objects: { [fresh.body.key]: 'png' } }), { action: 'reference', asset: 'HOMI', file: 'HOMI_REF_hero_v001.png' });
  assert.equal(exists.status, 409);
  assert.equal((await call(world(), { action: 'reference', asset: 'HOMI', file: '../../design-studio/x.png' })).status, 400);
});

const RECORD = 'homatch-content/3D/characters/HOMI/versions/v001/jobs/PREVIEW_360.json';
const LOCK = 'homatch-content/jobs/GPU_LOCK.json';

test('a worker failure (RunPod COMPLETED with ok:false) frees the version for a retry', async () => {
  const rec = JSON.stringify({ providerJobId: 'rp-job-0000', dispatchedAt: '2026-10-23T11:50:00Z' });
  const failed = { status: 'COMPLETED', output: { ok: false, error: 'CONTENT_FAILED: blender: deadline' } };
  const r = await call(world({ objects: { [RECORD]: rec, [LOCK]: rec }, statusOf: { 'rp-job-0000': failed } }), DISPATCH);
  assert.equal(r.status, 202);
});

test('a job RunPod has forgotten blocks only until its ttl has passed', async () => {
  const recent = JSON.stringify({ providerJobId: 'rp-job-0000', dispatchedAt: '2026-10-23T11:50:00Z', deadlineS: 900 });
  assert.equal((await call(world({ objects: { [RECORD]: recent } }), DISPATCH)).body.code, 'VERSION_IN_PROGRESS');
  const old = JSON.stringify({ providerJobId: 'rp-job-0000', dispatchedAt: '2026-10-23T11:00:00Z', deadlineS: 900 });
  assert.equal((await call(world({ objects: { [RECORD]: old } }), DISPATCH)).status, 202);
});

test('one content job on the GPU at a time, across versions', async () => {
  const running = JSON.stringify({ version: 'v002', stage: 'PREVIEW_360', providerJobId: 'rp-job-0002', dispatchedAt: '2026-10-23T11:58:00Z' });
  const w = world({ objects: { [LOCK]: running }, statusOf: { 'rp-job-0002': { status: 'IN_PROGRESS' } } });
  const r = await call(w, DISPATCH);
  assert.equal(r.body.code, 'CONTENT_JOB_RUNNING');
  assert.equal(r.body.version, 'v002');
  assert.ok(!w.calls.some((c) => c.url.endsWith('/run')));
});

test('of two dispatches racing for the GPU, the losing compare-and-swap never reaches RunPod', async () => {
  const w = world();
  const realGet = w.store.getRecord;
  // the other dispatch claims the lock between our read and our write
  w.store.getRecord = async (key) => {
    const seen = await realGet(key);
    if (key === LOCK) w.store.objects[LOCK] = JSON.stringify({ claimedAt: '2026-10-23T12:00:00Z' });
    return seen;
  };
  const r = await call(w, DISPATCH);
  assert.equal(r.body.code, 'CONTENT_JOB_RUNNING');
  assert.ok(!w.calls.some((c) => c.url.endsWith('/run')));
});

test('a refused provider call releases the GPU lock', async () => {
  const w = world({ runStatus: 500 });
  assert.equal((await call(w, DISPATCH)).body.code, 'PROVIDER_REFUSED');
  assert.equal(JSON.parse(w.store.objects[LOCK]).released, true);
});

test('cancel reaches only the content job recorded for that version', async () => {
  const w = world({ objects: { [RECORD]: JSON.stringify({ providerJobId: 'rp-job-0001' }) } });
  const stranger = await call(w, { action: 'cancel', version: 'v001', providerJobId: 'customer-job-123' });
  assert.equal(stranger.status, 404);
  assert.equal((await call(w, { action: 'cancel', providerJobId: 'rp-job-0001' })).body.code, 'BAD_VERSION');
  assert.ok(!w.calls.some((c) => c.url.includes('/cancel/')));
  assert.equal((await call(w, { action: 'cancel', version: 'v001', providerJobId: 'rp-job-0001' })).body.cancelled, true);
});

test('inherited object names are not assets or stages', async () => {
  for (const asset of ['constructor', '__proto__', 'toString']) {
    assert.equal((await call(world(), { ...DISPATCH, asset, confirm: `${asset} v001 PREVIEW_360` })).body.code, 'UNKNOWN_ASSET');
  }
  assert.equal((await call(world(), { ...DISPATCH, stage: 'constructor', confirm: 'HOMI v001 constructor' })).body.code, 'UNKNOWN_STAGE');
});
