// CONTENT-STUDIO — the operator door for HOMATCH Content Studio assets (HOMI) on the Design Studio GPU worker.
//
// Admin only (is_admin() on the caller's OWN token, every request; impersonation refused). One POST door:
//   preflight  is the GPU free (no open customer factory job, nothing queued or running on the endpoint)?
//   dispatch   one allowlisted stage for one immutable version, typed confirmation, refused while busy
//   status     the provider job; on completion every output is checked IN R2 (exists, exact size) before it is reported
//   cancel     stop a content job
//   links      short-lived signed downloads for a version, from its manifest
//   reference  one signed PUT for a reference image that does not exist yet
//
// Nothing here changes Design Studio: no customer table is written, no billing is touched, the worker's
// scene-factory path is not used. Content jobs carry no code — the worker runs only its own HOMI build
// script — and every PUT is signed here for exactly one key under
// homatch-content/3D/characters/<ASSET>/versions/<vNNN>/. Secrets stay in this function: responses carry
// object keys, and signed GET URLs (15 minutes) only to the admin who asked.
import { createClient } from '@supabase/supabase-js';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { envReport, getObject, headObject, r2Config, signedUrl } from '../_shared/objectStore.ts';
import { presign } from '../_shared/storage/sigv4.ts';
import { serviceBackendEnabled } from '../_shared/serviceControl.ts';

const ORIGINS = new Set(['https://homatch.live', 'https://www.homatch.live', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const MAX_BODY = 4_000;
const VERSION = /^v\d{3}$/;
const PROVIDER_JOB = /^[A-Za-z0-9-]{8,80}$/;
const REFERENCE_FILE = /^HOMI_REF_[a-z0-9_]{1,40}_v\d{3}\.(png|webp|jpg)$/;
const PUT_SECONDS = 3600;
/** Factory jobs in these states are a customer's work in flight (ds_factory_jobs, factory.ts). */
const CUSTOMER_TERMINAL = '(COMPLETED,FAILED,CANCELLED)';

export const ASSETS = { HOMI: 'homatch-content/3D/characters/HOMI' } as const;
type Asset = keyof typeof ASSETS;

/** Server-chosen numbers per stage: a caller picks the stage, never the cost. */
export const STAGES = {
  PREVIEW_360: {
    render: { size: 720, samples: 32, frames: 72, fps: 18 },
    deadlineS: 900,
    estimateS: 240,
    files: (v: string) => ({
      blend: `blender/HOMI_MASTER_${v}.blend`,
      glb: `models/HOMI_MODEL_${v}.glb`,
      turntable: `previews/HOMI_TURNTABLE_360_${v}.mp4`,
      contactSheet: `previews/HOMI_CONTACT_SHEET_${v}.png`,
      face: `previews/HOMI_FACE_${v}.png`,
      manifest: `manifest/HOMI_ASSET_MANIFEST_${v}.json`,
    }),
  },
} as const;
type Stage = keyof typeof STAGES;

export const versionPrefix = (asset: Asset, version: string) => `${ASSETS[asset]}/versions/${version}/`;
export function stageKeys(asset: Asset, version: string, stage: Stage): Record<string, string> {
  const prefix = versionPrefix(asset, version);
  return Object.fromEntries(Object.entries(STAGES[stage].files(version)).map(([k, rel]) => [k, prefix + rel]));
}

interface Store {
  presignPut: (key: string, seconds: number) => Promise<string>;
  signedGet: (key: string, downloadAs?: string) => Promise<string>;
  head: (key: string) => Promise<{ exists: boolean; size: number | null }>;
  getJson: (key: string) => Promise<any | null>;
  putJson: (key: string, value: unknown) => Promise<void>;
  configured: () => boolean;
}

const r2Store: Store = {
  presignPut: async (key, seconds) => {
    const c = r2Config();
    return (await presign({ method: 'PUT', endpoint: c.endpoint, bucket: c.bucket, key, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, expiresIn: seconds })).url;
  },
  signedGet: async (key, downloadAs) => (await signedUrl({ action: 'READ', key, expiresIn: 900, downloadAs })).url,
  head: async (key) => {
    const f = await headObject(key);
    return { exists: f.exists, size: f.size };
  },
  getJson: async (key) => {
    const r = await getObject(key);
    if (r.status === 404) { await r.body?.cancel(); return null; }
    if (!r.ok) { await r.body?.cancel(); throw new Error(`read ${r.status}`); }
    return await r.json();
  },
  putJson: async (key, value) => {
    const url = await r2Store.presignPut(key, 60);
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value, null, 1) });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`write ${r.status}`);
  },
  configured: () => { try { return envReport().allPresent; } catch { return false; } },
};

export interface Deps {
  env: (k: string) => string | undefined;
  db?: any;
  caller?: (authorization: string) => any;
  fetch?: typeof fetch;
  store?: Store;
  uuid?: () => string;
  now?: () => Date;
}

const defaultDeps: Deps = { env: (k) => Deno.env.get(k) };

export async function handler(req: Request, deps: Deps = defaultDeps): Promise<Response> {
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
  const caller = deps.caller ? deps.caller(auth) : createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: authError } = await caller.auth.getUser();
  if (authError || !who?.user) return reply({ code: 'AUTH_REQUIRED' }, 401);
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
  if (adminError || isAdmin !== true) return reply({ code: 'ADMIN_REQUIRED' }, 403);
  const db = deps.db ?? createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
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
  const key = env('RUNPOD_API_KEY') ?? '';
  const endpoint = env('RUNPOD_DS_ENDPOINT_ID') ?? '';
  const rate = Number(env('RUNPOD_DS_USD_PER_SECOND') ?? '');
  const gpuConfigured = key.length > 0 && /^[a-z0-9]{6,40}$/i.test(endpoint);
  const usd = (s: number) => (Number.isFinite(rate) && rate > 0 ? Math.round(s * rate * 10000) / 10000 : null);
  const runpod = (path: string, init?: RequestInit) => http(`https://api.runpod.ai/v2/${endpoint}/${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } });

  const asset = String(input.asset ?? 'HOMI') as Asset;
  if (!(asset in ASSETS)) return reply({ code: 'UNKNOWN_ASSET' }, 400);
  const version = String(input.version ?? '');
  const providerJobId = String(input.providerJobId ?? '');

  /** The GPU is free only when no customer factory job is open and the endpoint has nothing queued or running. */
  const busy = async () => {
    const { count, error } = await db.from('ds_factory_jobs').select('id', { count: 'exact', head: true }).not('state', 'in', CUSTOMER_TERMINAL);
    const customerJobsOpen = error ? null : (count ?? 0);
    let endpointJobs: { inQueue: number; inProgress: number } | null = null;
    let workers: Record<string, number> | null = null;
    const r = await runpod('health').catch(() => null);
    if (r?.ok) {
      const h = await r.json().catch(() => null);
      if (h?.jobs) endpointJobs = { inQueue: Number(h.jobs.inQueue ?? 0), inProgress: Number(h.jobs.inProgress ?? 0) };
      if (h?.workers) workers = h.workers;
    } else {
      await r?.body?.cancel();
    }
    const free = customerJobsOpen === 0 && endpointJobs !== null && endpointJobs.inQueue === 0 && endpointJobs.inProgress === 0;
    return { free, customerJobsOpen, endpointJobs, workers };
  };
  const providerStatus = async (id: string) => {
    const r = await runpod(`status/${encodeURIComponent(id)}`).catch(() => null);
    if (!r?.ok) { await r?.body?.cancel(); return null; }
    return await r.json().catch(() => null);
  };
  const adminId = async () => {
    const { data } = await db.from('users').select('id').eq('auth_id', who.user.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };
  const audit = async (action: string, entityId: string, metadata: Record<string, unknown>) => {
    try {
      await db.from('admin_audit_log').insert({ admin_id: await adminId(), action, entity_type: 'CONTENT_STUDIO', entity_id: entityId, metadata });
    } catch { /* the R2 dispatch record is the durable trail; an audit row is best effort */ }
  };

  try {
    switch (String(input.action || '')) {
      case 'preflight': {
        const b = gpuConfigured ? await busy() : { free: false, customerJobsOpen: null, endpointJobs: null, workers: null };
        const designStudio = await serviceBackendEnabled(db, 'design_studio');
        return reply({
          asset, prefix: ASSETS[asset] + '/', stages: Object.fromEntries(Object.entries(STAGES).map(([k, s]) => [k, { render: s.render, deadlineS: s.deadlineS, estimateUsd: usd(s.estimateS) }])),
          gpuConfigured, r2Configured: store.configured(), designStudioBackend: designStudio, ...b,
          ready: gpuConfigured && store.configured() && designStudio && b.free,
        });
      }

      case 'dispatch': {
        const stage = String(input.stage ?? '') as Stage;
        if (!(stage in STAGES)) return reply({ code: 'UNKNOWN_STAGE' }, 400);
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        if (input.confirm !== `${asset} ${version} ${stage}`) return reply({ code: 'CONFIRMATION_REQUIRED', expected: `${asset} ${version} ${stage}` }, 400);
        if (!gpuConfigured) return reply({ code: 'GPU_NOT_CONFIGURED' }, 503);
        if (!store.configured()) return reply({ code: 'STORAGE_NOT_CONFIGURED' }, 503);
        if (!(await serviceBackendEnabled(db, 'design_studio'))) return reply({ code: 'SERVICE_DISABLED' }, 503);
        const b = await busy();
        if (!b.free) return reply({ code: 'GPU_BUSY', customerJobsOpen: b.customerJobsOpen, endpointJobs: b.endpointJobs }, 409);

        const keys = stageKeys(asset, version, stage);
        const recordKey = versionPrefix(asset, version) + `jobs/${stage}.json`;
        if ((await store.head(keys.manifest)).exists) return reply({ code: 'VERSION_EXISTS' }, 409);
        const previous = await store.getJson(recordKey);
        if (previous?.providerJobId) {
          const s = await providerStatus(previous.providerJobId);
          if (!s || !['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(s.status)) return reply({ code: 'VERSION_IN_PROGRESS', providerJobId: previous.providerJobId }, 409);
        } else if (previous && now().getTime() - Date.parse(previous.claimedAt ?? '') < 120_000) {
          return reply({ code: 'VERSION_IN_PROGRESS' }, 409); // another dispatch is between its claim and the provider
        }

        const s = STAGES[stage];
        const jobId = (deps.uuid ?? (() => crypto.randomUUID()))();
        const by = await adminId();
        // Claim first: a second dispatch now sees a record without a provider job and must wait for it.
        const claim = { asset, version, stage, jobId, providerJobId: null, claimedAt: now().toISOString(), dispatchedBy: by, keys, previous: previous ?? null };
        await store.putJson(recordKey, claim);
        const outputs = Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([name, k]) => [name, await store.presignPut(k, PUT_SECONDS)])));
        const r = await runpod('run', {
          method: 'POST',
          body: JSON.stringify({
            input: { contentStudio: { jobId, asset, version, stage, render: s.render, outputs, limits: { deadlineS: s.deadlineS, device: 'AUTO' } } },
            policy: { executionTimeout: (s.deadlineS + 60) * 1000, ttl: (s.deadlineS + 900) * 1000 },
          }),
        }).catch(() => null);
        if (!r?.ok) { await r?.body?.cancel(); return reply({ code: 'PROVIDER_REFUSED', status: r?.status ?? null }, 502); }
        const run = await r.json().catch(() => null);
        if (!run?.id || !PROVIDER_JOB.test(String(run.id))) return reply({ code: 'PROVIDER_REFUSED' }, 502);
        const record = { ...claim, providerJobId: String(run.id), dispatchedAt: now().toISOString(), render: s.render, deadlineS: s.deadlineS };
        await store.putJson(recordKey, record);
        await audit('CONTENT_STUDIO_DISPATCH', `${asset}/${version}/${stage}`, { providerJobId: record.providerJobId, jobId });
        return reply({ providerJobId: record.providerJobId, jobId, keys, estimateUsd: usd(s.estimateS) }, 202);
      }

      case 'status': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        if (!PROVIDER_JOB.test(providerJobId)) return reply({ code: 'BAD_JOB' }, 400);
        const stage = String(input.stage ?? 'PREVIEW_360') as Stage;
        if (!(stage in STAGES)) return reply({ code: 'UNKNOWN_STAGE' }, 400);
        const record = await store.getJson(versionPrefix(asset, version) + `jobs/${stage}.json`);
        if (record?.providerJobId !== providerJobId) return reply({ code: 'NOT_FOUND' }, 404);
        const st = await providerStatus(providerJobId);
        if (!st) return reply({ code: 'PROVIDER_UNREACHABLE' }, 502);
        const seconds = Number(st.executionTime ?? 0) / 1000;
        const base = { status: st.status, delaySeconds: Number(st.delayTime ?? 0) / 1000, executionSeconds: seconds, estimatedUsd: usd(seconds) };
        if (st.status !== 'COMPLETED') return reply({ ...base, stage: st.output?.stage ?? null });
        const out = st.output ?? {};
        if (out.ok !== true) return reply({ ...base, ok: false, error: String(out.error ?? 'FAILED').slice(0, 300) });
        // Believe R2, not the worker: every output must exist with exactly the size the worker measured.
        const keys = stageKeys(asset, version, stage);
        const verified: Record<string, unknown> = {};
        let allOk = true;
        for (const [name, k] of Object.entries(keys)) {
          const want = out.outputs?.[name];
          const h = await store.head(k);
          const ok = h.exists && want && h.size === want.bytes;
          allOk &&= Boolean(ok);
          verified[name] = { key: k, exists: h.exists, bytes: h.size, expectedBytes: want?.bytes ?? null, sha256: want?.sha256 ?? null, ok: Boolean(ok),
            url: ok ? await store.signedGet(k, k.split('/').pop()) : null };
        }
        return reply({ ...base, ok: allOk, verified, geometry: out.geometry ?? null, timings: out.timings ?? null, device: out.device ?? null, gpu: out.gpu ?? null, worker: out.worker ?? null });
      }

      case 'cancel': {
        if (!PROVIDER_JOB.test(providerJobId)) return reply({ code: 'BAD_JOB' }, 400);
        const r = await runpod(`cancel/${encodeURIComponent(providerJobId)}`, { method: 'POST' }).catch(() => null);
        await r?.body?.cancel();
        await audit('CONTENT_STUDIO_CANCEL', providerJobId, {});
        return reply({ cancelled: Boolean(r?.ok) });
      }

      case 'links': {
        if (!VERSION.test(version)) return reply({ code: 'BAD_VERSION' }, 400);
        const stage = String(input.stage ?? 'PREVIEW_360') as Stage;
        if (!(stage in STAGES)) return reply({ code: 'UNKNOWN_STAGE' }, 400);
        const keys = stageKeys(asset, version, stage);
        const manifest = await store.getJson(keys.manifest);
        if (!manifest) return reply({ code: 'NOT_FOUND' }, 404);
        const files = await Promise.all(Object.entries(keys).map(async ([name, k]) => {
          const h = await store.head(k);
          const want = name === 'manifest' ? null : manifest.files?.[name];
          return { name, key: k, bytes: h.size, sha256: want?.sha256 ?? null, ok: h.exists && (want ? h.size === want.bytes : true), url: h.exists ? await store.signedGet(k, k.split('/').pop()) : null };
        }));
        return reply({ asset, version, stage, files, expiresInSeconds: 900 });
      }

      case 'reference': {
        const file = String(input.file ?? '');
        if (asset !== 'HOMI' || !REFERENCE_FILE.test(file)) return reply({ code: 'BAD_REFERENCE' }, 400);
        const k = `${ASSETS[asset]}/references/${file}`;
        if ((await store.head(k)).exists) return reply({ code: 'REFERENCE_EXISTS', key: k }, 409);
        await audit('CONTENT_STUDIO_REFERENCE', k, {});
        return reply({ key: k, url: await store.presignPut(k, 300), expiresInSeconds: 300 });
      }

      default:
        return reply({ code: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    console.error('content-studio', String(input.action || ''), e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    return reply({ code: 'REQUEST_FAILED' }, 500);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') Deno.serve((req) => handler(req));
