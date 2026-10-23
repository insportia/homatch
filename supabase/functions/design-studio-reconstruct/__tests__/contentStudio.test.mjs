// Content Studio route of design-studio-reconstruct: admin-only door, R2 lock proven before use, customers first
// (a step starts only when no Design Studio work is open), one content job at a time, plan steps verified in R2,
// retries without re-running finished steps, cancel scoped to HOMI's own job, no secret ever returned.
// Database, RunPod and R2 faked; the R2 fake implements conditional PUTs the way R2 documents them.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: () => undefined } };
const { handleContentStudio, planKeys } = await import('../contentStudio.ts');
const { resetServiceControlCache } = await import('../../_shared/serviceControl.ts');

const RUNPOD_KEY = 'rpa_SUPERSECRETRUNPODKEY';
const ORIGIN = 'https://homatch.live';
const K = planKeys('HOMI', 'v001');
const LOCK = 'homatch-content/jobs/GPU_LOCK.json';
const SELFTEST = 'homatch-content/jobs/LOCK_SELFTEST.json';
const PROVEN = { [SELFTEST]: JSON.stringify({ ok: true }) };

function world({ admin = true, customerJobs = [], renders = [], walkthroughs = [], endpoint = { inQueue: 0, inProgress: 0 }, designStudio = true,
  objects = PROVEN, statusOf = {}, runStatus = 200, honoursConditions = true } = {}) {
  resetServiceControlCache();
  const tables = {
    service_controls: [{ service_key: 'design_studio', frontend_enabled: designStudio, backend_enabled: designStudio }],
    ds_factory_jobs: customerJobs, ds_renders: renders, ds_walkthroughs: walkthroughs,
    users: [{ id: 'u-admin', auth_id: 'auth-admin' }], admin_audit_log: [], impersonation_sessions: [],
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
  const runs = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const path = url.replace(/^https:\/\/api\.runpod\.ai\/v2\/ep123abc\//, '');
    if (path === 'health') return new Response(JSON.stringify({ jobs: endpoint, workers: { idle: 0, running: 0 } }));
    if (path === 'run') {
      if (runStatus !== 200) return new Response('{}', { status: runStatus });
      const id = `rp-job-${String(runs.length + 1).padStart(4, '0')}`;
      runs.push({ id, body: JSON.parse(init.body) });
      statusOf[id] = { status: 'IN_QUEUE' };
      return new Response(JSON.stringify({ id, status: 'IN_QUEUE' }));
    }
    if (path.startsWith('status/')) {
      const id = decodeURIComponent(path.slice(7));
      return statusOf[id] ? new Response(JSON.stringify(statusOf[id])) : new Response('{}', { status: 404 });
    }
    if (path.startsWith('cancel/')) return new Response('{}');
    return new Response('nope', { status: 500 });
  };
  let writes = 0;
  const store = {
    objects: { ...objects },
    etags: {},
    presigned: [],
    presign: async (method, key, seconds) => { store.presigned.push({ method, key, seconds }); return `https://acct.r2.cloudflarestorage.com/homatch-storage/${key}?X-Amz-Signature=${method}`; },
    head: async (key) => (key in store.objects ? { exists: true, size: store.objects[key].length } : { exists: false, size: null }),
    getRecord: async (key) => (key in store.objects ? { value: JSON.parse(store.objects[key]), etag: store.etags[key] ?? 'e0' } : null),
    // R2's documented semantics: conditions evaluated atomically, 412 on failure (unless this fake "R2" ignores them)
    putRaw: async (key, body, h) => {
      if (honoursConditions) {
        if (h['if-none-match'] === '*' && key in store.objects) return 412;
        if (h['if-match'] && (!(key in store.objects) || `"${store.etags[key] ?? 'e0'}"` !== h['if-match'])) return 412;
      }
      store.objects[key] = body;
      store.etags[key] = `e${++writes}`;
      return 200;
    },
    remove: async (key) => { delete store.objects[key]; },
    configured: () => true,
  };
  const env = { RUNPOD_API_KEY: RUNPOD_KEY, RUNPOD_DS_ENDPOINT_ID: 'ep123abc', RUNPOD_DS_USD_PER_SECOND: '0.00031' };
  const deps = {
    env: (k) => env[k], db: { from },
    caller: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'auth-admin' } }, error: null }) }, rpc: async () => ({ data: admin, error: null }) }),
    fetch, store, uuid: () => '123e4567-e89b-42d3-a456-426614174000', now: () => new Date('2026-10-23T12:00:00Z'),
  };
  /** The worker finishing the latest job: its outputs land in R2 and RunPod reports them. */
  const finish = ({ ok = true, wrongSize = null } = {}) => {
    const run = runs.at(-1);
    const job = run.body.input.contentStudio;
    const outputs = {};
    for (const [name, u] of Object.entries(job.outputs)) {
      const key = u.replace(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/homatch-storage\//, '').replace(/\?.*$/, '');
      const content = key.endsWith('.json') ? '{"files":{}}' : 'x'.repeat(10);
      if (ok) store.objects[key] = name === wrongSize ? 'xxx' : content;
      outputs[name] = { bytes: content.length, sha256: 'ab' };
    }
    statusOf[run.id] = ok ? { status: 'COMPLETED', executionTime: 30_000, output: { ok: true, outputs } } : { status: 'COMPLETED', output: { ok: false, error: 'CONTENT_FAILED: blender: deadline' } };
  };
  return { deps, tables, calls, runs, store, statusOf, finish };
}

const call = async (w, body, { origin = ORIGIN, auth = 'Bearer token' } = {}) => {
  const res = await handleContentStudio(new Request('https://x/functions/v1/design-studio-reconstruct/content-studio', { method: 'POST', headers: { origin, authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }), w.deps);
  const text = await res.text();
  assert.ok(!text.includes(RUNPOD_KEY), 'the RunPod key never leaves the function');
  assert.ok(!text.includes('X-Amz-Signature=PUT') || body.action === 'reference', 'upload URLs go only to RunPod');
  return { status: res.status, body: JSON.parse(text) };
};
const START = { action: 'start', version: 'v001', plan: 'PREVIEW_360', confirm: 'HOMI v001 PREVIEW_360' };
const ADVANCE = { action: 'advance', version: 'v001' };

test('only an admin, with a token, from a HOMATCH origin', async () => {
  assert.equal((await call(world({ admin: false }), { action: 'preflight' })).status, 403);
  assert.equal((await call(world(), { action: 'preflight' }, { auth: '' })).status, 401);
  assert.equal((await call(world(), { action: 'preflight' }, { origin: 'https://evil.example' })).status, 403);
});

test('nothing starts until the R2 lock has been proven on the real bucket', async () => {
  const w = world({ objects: {} });
  assert.equal((await call(w, START)).body.code, 'LOCK_NOT_PROVEN');
  const proof = await call(w, { action: 'lock-selftest' });
  assert.equal(proof.status, 200);
  assert.deepEqual(proof.body.steps.map((s) => s.got), [200, 412, 412, 200, 412]);
  assert.equal(JSON.parse(w.store.objects[SELFTEST]).ok, true);
  assert.ok(!Object.keys(w.store.objects).some((k) => k.includes('_selftest/')), 'the scratch object is removed');
  assert.equal((await call(w, START)).status, 201);
});

test('a storage that ignores conditions fails the self-test, and start stays closed', async () => {
  const w = world({ objects: {}, honoursConditions: false });
  const proof = await call(w, { action: 'lock-selftest' });
  assert.equal(proof.status, 409);
  assert.equal(proof.body.ok, false);
  assert.equal((await call(w, START)).body.code, 'LOCK_NOT_PROVEN');
});

test('start needs the typed confirmation, creates the plan once, and never for an approved version', async () => {
  assert.equal((await call(world(), { ...START, confirm: 'yes' })).body.code, 'CONFIRMATION_REQUIRED');
  const w = world();
  const r = await call(w, START);
  assert.deepEqual(r.body.steps.map((s) => s.id), ['BUILD', 'FRAMES_0', 'FRAMES_1', 'FRAMES_2', 'FRAMES_3', 'FRAMES_4', 'FRAMES_5', 'ASSEMBLE']);
  assert.equal(w.runs.length, 0, 'start runs nothing');
  assert.equal((await call(w, START)).body.code, 'PLAN_EXISTS');
  assert.equal((await call(world({ objects: { ...PROVEN, [K.assemble.manifest]: '{}' } }), START)).body.code, 'VERSION_EXISTS');
});

test('customers first: a step waits while any Design Studio work is open or queued — RunPod is never asked to run', async () => {
  for (const opts of [{ customerJobs: [{ id: 'j', state: 'QUEUED' }] }, { renders: [{ id: 'r', status: 'RESERVED' }] },
    { walkthroughs: [{ id: 'w', state: 'PLANNING' }, { id: 'x', state: 'READY' }] }, { endpoint: { inQueue: 1, inProgress: 0 } }]) {
    const w = world(opts);
    await call(w, START);
    const r = await call(w, ADVANCE);
    assert.equal(r.status, 202);
    assert.equal(r.body.code, 'WAITING_FOR_CUSTOMERS');
    assert.equal(w.runs.length, 0);
  }
});

test('a full preview: eight short steps, each signed only for its own keys, numbers chosen by the server', async () => {
  const w = world();
  await call(w, START);
  let r;
  for (let i = 0; i < 8; i += 1) {
    r = await call(w, { ...ADVANCE, render: { samples: 4096 } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    w.finish();
  }
  r = await call(w, ADVANCE);
  assert.equal(r.body.done, true);
  assert.equal(w.runs.length, 8);
  const stages = w.runs.map((x) => x.body.input.contentStudio.stage);
  assert.deepEqual(stages, ['PREVIEW_360_BUILD', ...Array(6).fill('PREVIEW_360_FRAMES'), 'PREVIEW_360_ASSEMBLE']);
  for (const run of w.runs) {
    assert.deepEqual(Object.keys(run.body.input), ['contentStudio']);
    assert.deepEqual(run.body.input.contentStudio.render, { size: 720, samples: 32, frames: 72, fps: 18 });
    assert.equal(run.body.policy.executionTimeout, 300_000, 'a customer waits at most one short step');
  }
  assert.deepEqual(w.runs[1].body.input.contentStudio.chunk, { start: 0, count: 12 });
  assert.equal(Object.keys(w.runs[7].body.input.contentStudio.inputs.frames).length, 72);
  for (const p of w.store.presigned) assert.ok(p.key.startsWith('homatch-content/3D/characters/HOMI/versions/v001/') && p.seconds <= 900, p.key);
  assert.ok(JSON.parse(w.store.objects[LOCK]).released, 'the GPU lock is free again');
  // approved: nothing more is ever signed or run for it
  assert.equal((await call(w, START)).body.code, 'VERSION_EXISTS');
  const links = await call(w, { action: 'links', version: 'v001' });
  assert.equal(links.body.files.length, 6);
});

test('a failed step is retried alone — finished steps never run again — and gives up after three attempts', async () => {
  const w = world();
  await call(w, START);
  await call(w, ADVANCE); w.finish(); // BUILD done
  await call(w, ADVANCE); w.finish({ ok: false }); // FRAMES_0 fails (RunPod says COMPLETED, ok:false)
  let r = await call(w, ADVANCE);
  assert.equal(r.body.failed, 'FRAMES_0');
  r = await call(w, ADVANCE);
  assert.equal(r.body.started, 'FRAMES_0');
  assert.equal(w.runs.filter((x) => x.body.input.contentStudio.stage === 'PREVIEW_360_BUILD').length, 1, 'BUILD is not paid for twice');
  w.finish({ ok: false }); await call(w, ADVANCE); await call(w, ADVANCE); w.finish({ ok: false }); await call(w, ADVANCE);
  r = await call(w, ADVANCE);
  assert.equal(r.body.code, 'STEP_FAILED_TOO_OFTEN');
  assert.equal(r.body.step, 'FRAMES_0');
});

test('a step whose outputs are not in R2 with the measured size fails', async () => {
  const w = world();
  await call(w, START);
  await call(w, ADVANCE);
  w.finish({ wrongSize: 'glb' });
  const r = await call(w, ADVANCE);
  assert.equal(r.body.failed, 'BUILD');
  assert.match(r.body.steps[0].error, /OUTPUT_UNVERIFIED: glb/);
});

test('one content job on the GPU at a time, across versions; the losing compare-and-swap never reaches RunPod', async () => {
  const running = JSON.stringify({ version: 'v002', step: 'FRAMES_3', providerJobId: 'rp-job-0900', dispatchedAt: '2026-10-23T11:59:00Z' });
  const w = world({ objects: { ...PROVEN, [LOCK]: running }, statusOf: { 'rp-job-0900': { status: 'IN_PROGRESS' } } });
  await call(w, START);
  const r = await call(w, ADVANCE);
  assert.equal(r.body.code, 'CONTENT_JOB_RUNNING');
  assert.equal(r.body.version, 'v002');
  assert.equal(w.runs.length, 0);

  const race = world();
  await call(race, START);
  const realGet = race.store.getRecord;
  race.store.getRecord = async (key) => {
    const seen = await realGet(key);
    if (key === LOCK) race.store.objects[LOCK] = JSON.stringify({ claimedAt: '2026-10-23T12:00:00Z' }); // the other side claims first
    return seen;
  };
  assert.equal((await call(race, ADVANCE)).body.code, 'CONTENT_JOB_RUNNING');
  assert.equal(race.runs.length, 0);
});

test('a refused provider call releases the GPU lock', async () => {
  const w = world({ runStatus: 500 });
  await call(w, START);
  assert.equal((await call(w, ADVANCE)).body.code, 'PROVIDER_REFUSED');
  assert.equal(JSON.parse(w.store.objects[LOCK]).released, true);
});

test('cancel reaches only the job HOMI itself is running — never an id from the caller', async () => {
  const w = world();
  await call(w, START);
  assert.equal((await call(w, { action: 'cancel', version: 'v001' })).body.code, 'NOTHING_RUNNING');
  await call(w, ADVANCE);
  const r = await call(w, { action: 'cancel', version: 'v001', providerJobId: 'customer-job-123' });
  assert.equal(r.body.cancelled, 'BUILD');
  const cancels = w.calls.filter((c) => c.url.includes('/cancel/')).map((c) => c.url.split('/cancel/')[1]);
  assert.deepEqual(cancels, ['rp-job-0001']);
  assert.ok(JSON.parse(w.store.objects[LOCK]).released);
});

test('inherited object names are not assets or plans', async () => {
  for (const asset of ['constructor', '__proto__', 'toString']) {
    assert.equal((await call(world(), { ...START, asset })).body.code, 'UNKNOWN_ASSET');
  }
  assert.equal((await call(world(), { ...START, plan: 'constructor' })).body.code, 'UNKNOWN_PLAN');
});

test('a reference image gets one short PUT, never over an existing one', async () => {
  const fresh = await call(world(), { action: 'reference', file: 'HOMI_REF_hero_v001.png' });
  assert.equal(fresh.body.key, 'homatch-content/3D/characters/HOMI/references/HOMI_REF_hero_v001.png');
  assert.equal(fresh.body.expiresInSeconds, 300);
  assert.equal((await call(world({ objects: { ...PROVEN, [fresh.body.key]: 'png' } }), { action: 'reference', file: 'HOMI_REF_hero_v001.png' })).status, 409);
  assert.equal((await call(world(), { action: 'reference', file: '../../design-studio/x.png' })).status, 400);
});
