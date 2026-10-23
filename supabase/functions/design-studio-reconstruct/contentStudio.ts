// CONTENT STUDIO — HOMATCH's own character assets (HOMI) on the Design Studio GPU worker, as one more route of this
// function (POST …/design-studio-reconstruct/content-studio). No new edge function: the project is at its plan's cap.
//
// Admin only (is_admin() on the caller's OWN token, every request; impersonation refused). One POST door:
//   preflight      is the GPU free, is storage locking proven, what would a preview cost?
//   lock-selftest  proves on real R2 that conditional PUTs are atomic (If-None-Match / If-Match → 412) — no GPU
//   start          creates a version's plan (typed confirmation); nothing runs yet
//   advance        settles the running step (outputs checked IN R2) and, only if no customer work is open or
//                  queued, starts the next one
//   plan           the plan's state, read only
//   cancel         the step HOMI itself is running — the provider job id comes from the plan, never from the caller
//   links          short-lived signed downloads of an approved version, from its manifest
//   reference      one signed PUT for a reference image that does not exist yet
//
// CUSTOMERS FIRST. The endpoint is shared and runs one worker. A preview is many SHORT jobs (build, frame chunks,
// assemble; each bounded by its own executionTimeout), and a step starts only when no Design Studio job, render or
// walkthrough is open and RunPod has nothing queued or running. A customer arriving mid-step waits at most one step.
//
// ONE CONTENT JOB AT A TIME, ATOMICALLY. A GPU lock object in R2 is claimed with a conditional PUT; R2 evaluates
// If-None-Match / If-Match atomically (412 for the loser). Whether that holds through our presigned URLs is proven
// on the real bucket by lock-selftest; until it has passed, start and advance refuse (fail closed).
//
// APPROVED IS IMMUTABLE. Once a version's manifest exists nothing more is signed for it. A finished step is never
// dispatched again, so a retry re-runs only the failed step (no double GPU spend), at most MAX_ATTEMPTS times.
//
// Nothing here touches Design Studio's customer tables (read-only counts), billing, or design-studio/ keys. Content
// jobs carry no code — the worker runs only its own HOMI build script. Responses carry object keys, and signed GET
// URLs (15 minutes) only to the admin who asked; never a secret.
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { deleteObject, envReport, getObject, headObject, normaliseEtag, r2Config } from '../_shared/objectStore.ts';
import { presign } from '../_shared/storage/sigv4.ts';
import { serviceBackendEnabled } from '../_shared/serviceControl.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const MAX_BODY = 4_000;
const VERSION = /^v\d{3}$/;
const PROVIDER_JOB = /^[A-Za-z0-9-]{8,80}$/;
const REFERENCE_FILE = /^HOMI_REF_[a-z0-9_]{1,40}_v\d{3}\.(png|webp|jpg)$/;
const GPU_LOCK = 'homatch-content/jobs/GPU_LOCK.json';
const LOCK_SELFTEST = 'homatch-content/jobs/LOCK_SELFTEST.json';
const CLAIM_SECONDS = 120;
const MAX_ATTEMPTS = 3;
const SETTLED = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
const own = (o: object, k: string) => Object.hasOwn(o, k);

/**
 * Design Studio work in flight, as Service Control counts it (service-control RUNNING.design_studio): open renders
 * and walkthroughs too, not only submitted factory jobs — a walkthrough still planning has no factory row yet but
 * will submit one, and would then queue behind a content step.
 */
const CUSTOMER_WORK = [
  { label: 'gpuJobsOpen', table: 'ds_factory_jobs', column: 'state', terminal: '(COMPLETED,FAILED,CANCELLED)' },
  { label: 'rendersOpen', table: 'ds_renders', column: 'status', terminal: '(READY,FAILED,CANCELLED)' },
  { label: 'walkthroughsOpen', table: 'ds_walkthroughs', column: 'state', terminal: '(READY,FAILED,CANCELLED)' },
] as const;

export const ASSETS = { HOMI: 'homatch-content/3D/characters/HOMI' } as const;
type Asset = keyof typeof ASSETS;

/** Server-chosen numbers per plan: a caller picks the plan, never the cost. */
export const PLANS = {
  PREVIEW_360: { render: { size: 720, samples: 32, frames: 72, fps: 18 }, chunk: 12, stepDeadlineS: 240, estimateS: 300 },
} as const;
type PlanName = keyof typeof PLANS;

export const versionPrefix = (asset: Asset, version: string) => `${ASSETS[asset]}/versions/${version}/`;
const pad = (i: number) => String(i).padStart(4, '0');

/** Every object key of a plan, per step. */
export function planKeys(asset: Asset, version: string) {
  const p = versionPrefix(asset, version);
  const frames = Array.from({ length: PLANS.PREVIEW_360.render.frames }, (_, i) => [`f${pad(i)}`, `${p}previews/frames/HOMI_TT_${version}_f${pad(i)}.png`]);
  return {
    build: {
      blend: `${p}blender/HOMI_MASTER_${version}.blend`,
      glb: `${p}models/HOMI_MODEL_${version}.glb`,
      face: `${p}previews/HOMI_FACE_${version}.png`,
      build: `${p}manifest/HOMI_BUILD_${version}.json`,
    },
    frames: Object.fromEntries(frames) as Record<string, string>,
    assemble: {
      turntable: `${p}previews/HOMI_TURNTABLE_360_${version}.mp4`,
      contactSheet: `${p}previews/HOMI_CONTACT_SHEET_${version}.png`,
      manifest: `${p}manifest/HOMI_ASSET_MANIFEST_${version}.json`,
    },
  };
}

interface Step { id: string; state: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; attempts: number; providerJobId: string | null; jobId: string | null; error?: string | null; outputs?: Record<string, { key: string; bytes: number; sha256: string | null }> }

function newSteps(): Step[] {
  const { frames, chunk } = { frames: PLANS.PREVIEW_360.render.frames, chunk: PLANS.PREVIEW_360.chunk };
  const ids = ['BUILD', ...Array.from({ length: Math.ceil(frames / chunk) }, (_, i) => `FRAMES_${i}`), 'ASSEMBLE'];
  return ids.map((id) => ({ id, state: 'PENDING', attempts: 0, providerJobId: null, jobId: null }));
}

/** The output keys a step writes (name → key). */
function stepOutputs(asset: Asset, version: string, id: string): Record<string, string> {
  const k = planKeys(asset, version);
  if (id === 'BUILD') return k.build;
  if (id === 'ASSEMBLE') return k.assemble;
  const i = Number(id.split('_')[1]);
  const { chunk, render } = PLANS.PREVIEW_360;
  const names = Array.from({ length: Math.min(chunk, render.frames - i * chunk) }, (_, j) => `f${pad(i * chunk + j)}`);
  return Object.fromEntries(names.map((n) => [n, k.frames[n]]));
}

export interface Store {
  presign: (method: 'GET' | 'PUT', key: string, seconds: number, downloadAs?: string) => Promise<string>;
  head: (key: string) => Promise<{ exists: boolean; size: number | null }>;
  /** The object and its etag (for a compare-and-swap write), or null. */
  getRecord: (key: string) => Promise<{ value: any; etag: string | null } | null>;
  /** One PUT; returns the HTTP status (412 = a condition failed). */
  putRaw: (key: string, body: string, headers: Record<string, string>) => Promise<number>;
  remove: (key: string) => Promise<void>;
  configured: () => boolean;
}

export const r2Store: Store = {
  presign: async (method, key, seconds, downloadAs) => {
    const c = r2Config();
    const query = downloadAs ? { 'response-content-disposition': `attachment; filename="${downloadAs.replace(/["\\]/g, '')}"` } : undefined;
    return (await presign({ method, endpoint: c.endpoint, bucket: c.bucket, key, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, expiresIn: seconds, query })).url;
  },
  head: async (key) => {
    const f = await headObject(key);
    return { exists: f.exists, size: f.size };
  },
  getRecord: async (key) => {
    const r = await getObject(key);
    if (r.status === 404) { await r.body?.cancel(); return null; }
    if (!r.ok) { await r.body?.cancel(); throw new Error(`read ${r.status}`); }
    return { value: await r.json(), etag: normaliseEtag(r.headers.get('etag')) };
  },
  putRaw: async (key, body, headers) => {
    const url = await r2Store.presign('PUT', key, 60);
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body });
    await r.body?.cancel();
    return r.status;
  },
  remove: async (key) => { await deleteObject(key); },
  configured: () => { try { return envReport().allPresent; } catch { return false; } },
};

/** A JSON write; with a condition, false when R2 refuses it because someone else wrote first. */
async function putJson(store: Store, key: string, value: unknown, cond?: { ifNoneMatch?: true; ifMatch?: string | null }): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (cond?.ifNoneMatch) headers['if-none-match'] = '*';
  if (cond?.ifMatch) headers['if-match'] = `"${cond.ifMatch}"`;
  const status = await store.putRaw(key, JSON.stringify(value, null, 1), headers);
  if (status === 412 && cond) return false;
  if (status < 200 || status >= 300) throw new Error(`write ${status}`);
  return true;
}

export interface Deps {
  env: (k: string) => string | undefined;
  createClient?: (url: string, key: string, opts: unknown) => any;
  db?: any;
  caller?: (authorization: string) => any;
  fetch?: typeof fetch;
  store?: Store;
  uuid?: () => string;
  now?: () => Date;
}

export async function handleContentStudio(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    ...(ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}),
  };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (!ORIGINS.has(origin)) return reply({ code: 'ORIGIN_DENIED' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ code: 'METHOD_DENIED' }, 405);
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return reply({ code: 'AUTH_REQUIRED' }, 401);

  const env = deps.env;
  const caller = deps.caller ? deps.caller(auth) : deps.createClient!(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: authError } = await caller.auth.getUser();
  if (authError || !who?.user) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
  if (adminError || isAdmin !== true) return reply({ code: 'ADMIN_REQUIRED' }, 403);
  const db = deps.db ?? deps.createClient!(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const refused = await refuseIfImpersonating(db, auth, headers);
  if (refused) return refused;

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  let input: Record<string, any>;
  try { input = JSON.parse(raw || '{}'); } catch { return reply({ code: 'INVALID_JSON' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ code: 'INVALID_JSON' }, 400);

  const http = deps.fetch ?? fetch;
  const store = deps.store ?? r2Store;
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const key = env('RUNPOD_API_KEY') ?? '';
  const endpoint = env('RUNPOD_DS_ENDPOINT_ID') ?? '';
  const rate = Number(env('RUNPOD_DS_USD_PER_SECOND') ?? '');
  const gpuConfigured = key.length > 0 && /^[a-z0-9]{6,40}$/i.test(endpoint);
  const usd = (s: number) => (Number.isFinite(rate) && rate > 0 ? Math.round(s * rate * 10000) / 10000 : null);
  const runpod = (path: string, init?: RequestInit) => http(`https://api.runpod.ai/v2/${endpoint}/${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } });

  const asset = String(input.asset ?? 'HOMI') as Asset;
  if (!own(ASSETS, asset)) return reply({ code: 'UNKNOWN_ASSET' }, 400);
  const version = String(input.version ?? '');
  const planName = String(input.plan ?? 'PREVIEW_360') as PlanName;
  if (!own(PLANS, planName)) return reply({ code: 'UNKNOWN_PLAN' }, 400);
  const planKey = versionPrefix(asset, version) + `jobs/${planName}.json`;

  /** The GPU is free only when no Design Studio work is open and the endpoint has nothing queued or running. Unreadable = busy. */
  const busy = async () => {
    const customerWork: Record<string, number | null> = {};
    for (const w of CUSTOMER_WORK) {
      const { count, error } = await db.from(w.table).select('id', { count: 'exact', head: true }).not(w.column, 'in', w.terminal);
      customerWork[w.label] = error ? null : (count ?? 0);
    }
    const counts = Object.values(customerWork);
    const customerJobsOpen = counts.some((c) => c === null) ? null : counts.reduce((a: number, c) => a + (c ?? 0), 0);
    let endpointJobs: { inQueue: number; inProgress: number } | null = null;
    const r = await runpod('health').catch(() => null);
    if (r?.ok) {
      const h = await r.json().catch(() => null);
      if (h?.jobs) endpointJobs = { inQueue: Number(h.jobs.inQueue ?? 0), inProgress: Number(h.jobs.inProgress ?? 0) };
    } else {
      await r?.body?.cancel();
    }
    const free = customerJobsOpen === 0 && endpointJobs !== null && endpointJobs.inQueue === 0 && endpointJobs.inProgress === 0;
    return { free, customerJobsOpen, customerWork, endpointJobs };
  };
  const providerStatus = async (id: string) => {
    const r = await runpod(`status/${encodeURIComponent(id)}`).catch(() => null);
    if (!r?.ok) { await r?.body?.cancel(); return null; }
    return await r.json().catch(() => null);
  };
  /** Is a lock holder finished with the GPU? Any terminal status (a worker failure is COMPLETED with ok:false),
   *  a job RunPod has forgotten after its ttl, or a claim that never reached RunPod after CLAIM_SECONDS. */
  const lockSettled = async (rec: any) => {
    if (!rec || rec.released) return true;
    const t = now().getTime();
    if (!rec.providerJobId) return t - Date.parse(rec.claimedAt ?? '') > CLAIM_SECONDS * 1000;
    const st = await providerStatus(String(rec.providerJobId));
    if (st) return SETTLED.includes(st.status);
    return t - Date.parse(rec.dispatchedAt ?? rec.claimedAt ?? '') > ((rec.deadlineS ?? 300) + 900) * 1000;
  };
  const lockProven = async () => (await store.getRecord(LOCK_SELFTEST))?.value?.ok === true;
  const adminId = async () => {
    const { data } = await db.from('users').select('id').eq('auth_id', who.user.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const audit = async (action: string, entityId: string, metadata: Record<string, unknown>) => {
    try {
      await db.from('admin_audit_log').insert({ admin_id: await adminId(), action, entity_type: 'CONTENT_STUDIO', entity_id: entityId, metadata });
    } catch { /* the R2 plan record is the durable trail; an audit row is best effort */ }
  };
  const releaseLock = async (providerJobId: string | null) => {
    const lock = await store.getRecord(GPU_LOCK);
    if (lock?.value && !lock.value.released && lock.value.providerJobId === providerJobId) {
      await putJson(store, GPU_LOCK, { ...lock.value, released: true, releasedAt: now().toISOString() }, { ifMatch: lock.etag });
    }
  };
  const view = (plan: any) => ({
    asset: plan.asset, version: plan.version, plan: plan.plan, createdAt: plan.createdAt,
    steps: plan.steps.map((s: Step) => ({ id: s.id, state: s.state, attempts: s.attempts, providerJobId: s.providerJobId, error: s.error ?? null })),
    done: plan.steps.every((s: Step) => s.state === 'DONE'),
  });

  try {
    switch (String(input.action || '')) {
      case 'preflight': {
        const b = gpuConfigured ? await busy() : { free: false, customerJobsOpen: null, endpointJobs: null };
        const designStudio = await serviceBackendEnabled(db, 'design_studio');
        const proven = store.configured() ? await lockProven() : false;
        const p = PLANS[planName];
        return reply({
          asset, prefix: ASSETS[asset] + '/', plan: planName, render: p.render, steps: newSteps().length, stepDeadlineS: p.stepDeadlineS,
          estimateUsd: usd(p.estimateS), gpuConfigured, r2Configured: store.configured(), lockProven: proven, designStudioBackend: designStudio, ...b,
          ready: gpuConfigured && store.configured() && proven && designStudio && b.free,
        });
      }

      case 'lock-selftest': {
        // Real R2, a scratch key, no GPU: the conditional writes the GPU lock relies on must behave atomically.
        if (!store.configured()) return reply({ code: 'STORAGE_NOT_CONFIGURED' }, 503);
        const k = `homatch-content/jobs/_selftest/cas-${uuid()}.json`;
        const steps: Array<{ step: string; expected: number; got: number }> = [];
        const put = async (step: string, expected: number, h: Record<string, string>) => {
          steps.push({ step, expected, got: await store.putRaw(k, JSON.stringify({ step, at: now().toISOString() }), h) });
        };
        await put('create if absent', 200, { 'if-none-match': '*' });
        await put('create again (must lose)', 412, { 'if-none-match': '*' });
        const etag = (await store.getRecord(k))?.etag ?? '';
        await put('swap with a wrong etag (must lose)', 412, { 'if-match': '"00000000000000000000000000000000"' });
        await put('swap with the current etag', 200, { 'if-match': `"${etag}"` });
        await put('swap with the stale etag (must lose)', 412, { 'if-match': `"${etag}"` });
        await store.remove(k).catch(() => undefined);
        const ok = etag.length > 0 && steps.every((s) => s.got === s.expected);
        const result = { ok, at: now().toISOString(), by: await adminId(), steps, scratchKey: k };
        await putJson(store, LOCK_SELFTEST, result);
        await audit('CONTENT_STUDIO_LOCK_SELFTEST', LOCK_SELFTEST, { ok });
        return reply(result, ok ? 200 : 409);
      }

      case 'start': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        if (input.confirm !== `${asset} ${version} ${planName}`) return reply({ code: 'CONFIRMATION_REQUIRED', expected: `${asset} ${version} ${planName}` }, 400);
        if (!store.configured()) return reply({ code: 'STORAGE_NOT_CONFIGURED' }, 503);
        if (!(await lockProven())) return reply({ code: 'LOCK_NOT_PROVEN' }, 409);
        if ((await store.head(planKeys(asset, version).assemble.manifest)).exists) return reply({ code: 'VERSION_EXISTS' }, 409);
        const plan = { asset, version, plan: planName, createdAt: now().toISOString(), createdBy: await adminId(), render: PLANS[planName].render, steps: newSteps() };
        if (!(await putJson(store, planKey, plan, { ifNoneMatch: true }))) return reply({ code: 'PLAN_EXISTS' }, 409);
        await audit('CONTENT_STUDIO_START', `${asset}/${version}/${planName}`, {});
        return reply({ ...view(plan), estimateUsd: usd(PLANS[planName].estimateS) }, 201);
      }

      case 'plan': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        const rec = await store.getRecord(planKey);
        return rec ? reply(view(rec.value)) : reply({ code: 'NOT_FOUND' }, 404);
      }

      case 'advance': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        if (!gpuConfigured) return reply({ code: 'GPU_NOT_CONFIGURED' }, 503);
        if (!store.configured()) return reply({ code: 'STORAGE_NOT_CONFIGURED' }, 503);
        if (!(await lockProven())) return reply({ code: 'LOCK_NOT_PROVEN' }, 409);
        const rec = await store.getRecord(planKey);
        if (!rec) return reply({ code: 'NOT_FOUND' }, 404);
        const plan = rec.value;
        const steps: Step[] = plan.steps;
        const save = async () => (await putJson(store, planKey, plan, { ifMatch: rec.etag })) || Promise.reject(new Error('PLAN_CONFLICT'));

        // 1. Settle the running step, if any: believe R2, not the worker.
        const running = steps.find((s) => s.state === 'RUNNING');
        if (running) {
          const st = await providerStatus(running.providerJobId!);
          if (st && !SETTLED.includes(st.status)) return reply({ ...view(plan), running: running.id, status: st.status });
          let error: string | null = null;
          if (!st) error = 'PROVIDER_UNREACHABLE';
          else if (st.status !== 'COMPLETED') error = `PROVIDER_${st.status}`;
          else if (st.output?.ok !== true) error = String(st.output?.error ?? 'FAILED').slice(0, 300);
          const outputs: Step['outputs'] = {};
          if (!error) {
            for (const [name, k] of Object.entries(stepOutputs(asset, version, running.id))) {
              const want = st.output?.outputs?.[name];
              const h = await store.head(k);
              if (!h.exists || !want || h.size !== want.bytes) { error = `OUTPUT_UNVERIFIED: ${name}`; break; }
              outputs[name] = { key: k, bytes: h.size!, sha256: want.sha256 ?? null };
            }
          }
          if (!st) {
            // RunPod no longer answers for it: wait for its ttl before calling it failed
            if (!(await lockSettled({ providerJobId: running.providerJobId, dispatchedAt: (running as any).dispatchedAt, deadlineS: PLANS[planName].stepDeadlineS }))) {
              return reply({ ...view(plan), running: running.id, status: 'UNKNOWN' });
            }
          }
          Object.assign(running, error ? { state: 'FAILED', error } : { state: 'DONE', error: null, outputs },
            { seconds: Number(st?.executionTime ?? 0) / 1000 });
          await save();
          await releaseLock(running.providerJobId);
          if (error) return reply({ ...view(plan), failed: running.id }, 200);
          rec.etag = (await store.getRecord(planKey))?.etag ?? null; // the plan was just rewritten
        }

        // 2. Done?
        const next = steps.find((s) => s.state !== 'DONE');
        if (!next) return reply({ ...view(plan), estimatedUsd: usd(steps.reduce((a, s: any) => a + (s.seconds ?? 0), 0)) });
        if ((await store.head(planKeys(asset, version).assemble.manifest)).exists) return reply({ code: 'VERSION_EXISTS' }, 409);
        if (next.attempts >= MAX_ATTEMPTS) return reply({ ...view(plan), code: 'STEP_FAILED_TOO_OFTEN', step: next.id }, 409);

        // 3. Customers first, then one content job at a time.
        if (!(await serviceBackendEnabled(db, 'design_studio'))) return reply({ code: 'SERVICE_DISABLED' }, 503);
        const b = await busy();
        if (!b.free) return reply({ ...view(plan), code: 'WAITING_FOR_CUSTOMERS', customerJobsOpen: b.customerJobsOpen, endpointJobs: b.endpointJobs }, 202);
        const lock = await store.getRecord(GPU_LOCK);
        if (lock && !(await lockSettled(lock.value))) return reply({ code: 'CONTENT_JOB_RUNNING', version: lock.value?.version ?? null, step: lock.value?.step ?? null }, 409);
        const deadlineS = PLANS[planName].stepDeadlineS;
        const claim = { asset, version, plan: planName, step: next.id, providerJobId: null as string | null, claimedAt: now().toISOString(), deadlineS };
        if (!(await putJson(store, GPU_LOCK, claim, lock ? { ifMatch: lock.etag } : { ifNoneMatch: true }))) return reply({ code: 'CONTENT_JOB_RUNNING' }, 409);

        // 4. The step's job: signed for exactly its own outputs (and, for ASSEMBLE, its inputs), for its own lifetime.
        const seconds = deadlineS + 300;
        const sign = async (m: Record<string, string>, method: 'GET' | 'PUT') =>
          Object.fromEntries(await Promise.all(Object.entries(m).map(async ([n, k]) => [n, await store.presign(method, k, seconds)])));
        const k = planKeys(asset, version);
        const p = PLANS[planName];
        const jobId = uuid();
        const job: Record<string, unknown> = { jobId, asset, version, render: p.render, limits: { deadlineS, device: 'AUTO' } };
        if (next.id === 'BUILD') Object.assign(job, { stage: 'PREVIEW_360_BUILD', outputs: await sign(k.build, 'PUT') });
        else if (next.id === 'ASSEMBLE') {
          Object.assign(job, { stage: 'PREVIEW_360_ASSEMBLE', outputs: await sign(k.assemble, 'PUT'),
            inputs: { build: await store.presign('GET', k.build.build, seconds), face: await store.presign('GET', k.build.face, seconds), frames: await sign(k.frames, 'GET') } });
        } else {
          const outs = stepOutputs(asset, version, next.id);
          const names = Object.keys(outs);
          Object.assign(job, { stage: 'PREVIEW_360_FRAMES', chunk: { start: Number(names[0].slice(1)), count: names.length }, outputs: await sign(outs, 'PUT') });
        }
        const r = await runpod('run', {
          method: 'POST',
          body: JSON.stringify({ input: { contentStudio: job }, policy: { executionTimeout: (deadlineS + 60) * 1000, ttl: (deadlineS + 900) * 1000 } }),
        }).catch(() => null);
        if (r && !r.ok) await r.body?.cancel();
        const run = r?.ok ? await r.json().catch(() => null) : null;
        if (!run?.id || !PROVIDER_JOB.test(String(run.id))) {
          await putJson(store, GPU_LOCK, { ...claim, released: true, error: `PROVIDER_REFUSED_${r?.status ?? 'NETWORK'}` });
          return reply({ code: 'PROVIDER_REFUSED', status: r?.status ?? null }, 502);
        }
        const dispatchedAt = now().toISOString();
        Object.assign(next, { state: 'RUNNING', attempts: next.attempts + 1, providerJobId: String(run.id), jobId, error: null, dispatchedAt });
        await putJson(store, GPU_LOCK, { ...claim, providerJobId: String(run.id), dispatchedAt });
        await save();
        await audit('CONTENT_STUDIO_STEP', `${asset}/${version}/${planName}/${next.id}`, { providerJobId: String(run.id), jobId, attempt: next.attempts });
        return reply({ ...view(plan), started: next.id, providerJobId: String(run.id) }, 202);
      }

      case 'cancel': {
        // Only the step this plan is running: the provider job id is read from the plan, never taken from the caller.
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        const rec = await store.getRecord(planKey);
        const step: Step | undefined = rec?.value?.steps?.find((s: Step) => s.state === 'RUNNING');
        if (!rec || !step?.providerJobId) return reply({ code: 'NOTHING_RUNNING' }, 404);
        const r = await runpod(`cancel/${encodeURIComponent(step.providerJobId)}`, { method: 'POST' }).catch(() => null);
        await r?.body?.cancel();
        if (!r?.ok) return reply({ code: 'PROVIDER_REFUSED', status: r?.status ?? null }, 502);
        Object.assign(step, { state: 'FAILED', error: 'CANCELLED_BY_OPERATOR' });
        if (!(await putJson(store, planKey, rec.value, { ifMatch: rec.etag }))) return reply({ code: 'PLAN_CONFLICT' }, 409);
        await releaseLock(step.providerJobId);
        await audit('CONTENT_STUDIO_CANCEL', `${asset}/${version}/${planName}/${step.id}`, { providerJobId: step.providerJobId });
        return reply({ ...view(rec.value), cancelled: step.id });
      }

      case 'links': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        const k = planKeys(asset, version);
        const manifest = (await store.getRecord(k.assemble.manifest))?.value;
        if (!manifest) return reply({ code: 'NOT_FOUND' }, 404);
        const keys: Record<string, string> = { blend: k.build.blend, glb: k.build.glb, face: k.build.face, turntable: k.assemble.turntable, contactSheet: k.assemble.contactSheet, manifest: k.assemble.manifest };
        const files = await Promise.all(Object.entries(keys).map(async ([name, key]) => {
          const h = await store.head(key);
          const want = name === 'manifest' ? null : manifest.files?.[name];
          const ok = h.exists && (want ? h.size === want.bytes : true);
          return { name, key, bytes: h.size, sha256: want?.sha256 ?? null, ok, url: ok ? await store.presign('GET', key, 900, key.split('/').pop()) : null };
        }));
        return reply({ asset, version, plan: planName, files, expiresInSeconds: 900 });
      }

      case 'reference': {
        const file = String(input.file ?? '');
        if (asset !== 'HOMI' || !REFERENCE_FILE.test(file)) return reply({ code: 'BAD_REFERENCE' }, 400);
        const k = `${ASSETS[asset]}/references/${file}`;
        if ((await store.head(k)).exists) return reply({ code: 'REFERENCE_EXISTS', key: k }, 409);
        await audit('CONTENT_STUDIO_REFERENCE', k, {});
        return reply({ key: k, url: await store.presign('PUT', k, 300), expiresInSeconds: 300 });
      }

      default:
        return reply({ code: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'PLAN_CONFLICT') return reply({ code: 'PLAN_CONFLICT' }, 409);
    // The class only: a network error's message can carry a signed URL.
    console.error('content-studio', String(input.action || ''), e instanceof Error ? e.name : 'unknown');
    return reply({ code: 'REQUEST_FAILED' }, 500);
  }
}
