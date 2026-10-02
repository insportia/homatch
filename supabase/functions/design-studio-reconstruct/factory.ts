// HOMATCH DESIGN STUDIO — the Blender scene factory, and the visual check against the source.
//
//   POST …/design-studio-reconstruct/factory         { projectId, reconstructionId?, versionId?, pass, spec }
//                                                     → one factory pass (idempotent per spec and pass)
//   POST …/design-studio-reconstruct/factory-status  { jobId } → its state; on completion every output is
//                                                     re-read, hashed and inspected before it is READY
//   POST …/design-studio-reconstruct/qa              { reconstructionId | floorplanId, renderAssetId | render, … }
//                                                     → a structured comparison (never edits anything)
//
// The browser sends a SceneBuildSpec: data, validated here with the same code
// the browser compiled it with (hybrid/sceneSpec.ts) and again in the worker.
// Everything the worker may touch is decided here: the catalogue maps and
// models the spec names are looked up in the catalogue (the browser never
// names a storage key), and every output gets one signed PUT for the exact key
// it will live at. The worker holds no storage credentials and chooses no
// paths. Provider-neutral at the edges: the provider (endpoint, key, price per
// second) is configured by environment and named only here.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { deleteObject, getObject, headObject, r2Config } from '../_shared/objectStore.ts';
import { presign } from '../_shared/storage/sigv4.ts';
import { inspectModel } from '../_shared/designStudio/modelInspect.ts';
import { ENGINE_VERSION } from '../_shared/designStudio/hybrid/contract.ts';
import { gpuCost } from '../_shared/designStudio/hybrid/cost.ts';
import { PLAN_QA_SYSTEM, QA_SCHEMA, QA_SYSTEM, validateQaReport } from '../_shared/designStudio/hybrid/qa.ts';
import { canonicalJson, SpecError, validateSceneSpec, type SceneBuildSpec } from '../_shared/designStudio/hybrid/sceneSpec.ts';
import { meterAiCall } from './metering.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_SECONDS = 3600;
const PROVIDER = 'runpod';
const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const MAX_SCENE_BYTES = 100 * 1024 * 1024;
const MAX_PIECE_BYTES = 12 * 1024 * 1024;
/** A planned view (spec.views): its picture (JPEG), id image (PNG) and legend (JSON) — worker schema.py limits. */
const MAX_VIEW_BYTES = 6 * 1024 * 1024;
const MAX_VIEW_IDS_BYTES = 8 * 1024 * 1024;
const MAX_VIEW_LEGEND_BYTES = 1024 * 1024;
const VIEW_ROLES = ['VIEW', 'VIEW_IDS', 'VIEW_LEGEND'] as const;
type ViewRole = typeof VIEW_ROLES[number];
const isViewRole = (r: unknown): r is ViewRole => (VIEW_ROLES as readonly unknown[]).includes(r);
const VIEW_PART: Record<ViewRole, 'image' | 'ids' | 'legend'> = { VIEW: 'image', VIEW_IDS: 'ids', VIEW_LEGEND: 'legend' };
const VIEW_EXT: Record<ViewRole, string> = { VIEW: 'jpg', VIEW_IDS: 'png', VIEW_LEGEND: 'json' };
const MAP_KINDS = new Set(['OBJECT', 'FLOOR', 'WALL', 'CEILING', 'STAIRS', 'DOOR', 'WINDOW', 'OTHER']);
/** Factory passes one account may start per hour (a runaway client, not a price). */
const HOURLY_JOBS = 30;
/** Catalogue files the worker may read: public or licensed delivery classes only. */
const CATALOG_READABLE = /^design-studio\/catalog\/(public|licensed)\/(materials|models)\/hma_[0-9a-z]{26}\/hmv_[0-9a-z]{26}\/[A-Za-z0-9_./-]+$/;
const FACTORY_STAGES = new Set(['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING', 'RENDERING', 'EXPORTING', 'OPTIMIZING']);
const QA_MODEL = Deno.env.get('OPENAI_DS_QA_MODEL') || Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

export function factoryConfig() {
  const key = Deno.env.get('RUNPOD_API_KEY') ?? '';
  const endpoint = Deno.env.get('RUNPOD_DS_ENDPOINT_ID') ?? '';
  const rate = Number(Deno.env.get('RUNPOD_DS_USD_PER_SECOND') ?? '');
  return key && /^[a-z0-9]{6,40}$/i.test(endpoint) ? { key, endpoint, usdPerSecond: Number.isFinite(rate) && rate > 0 ? rate : null } : null;
}

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signed(method: 'GET' | 'PUT', key: string): Promise<string> {
  const cfg = r2Config();
  const { url } = await presign({ method, endpoint: cfg.endpoint, bucket: cfg.bucket, key, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expiresIn: URL_SECONDS });
  return url;
}

export async function callerOf(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: json({ error: 'UNAUTHENTICATED' }, 401) };
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return { error: json({ error: 'UNAUTHENTICATED' }, 401) };
  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return { error: refused };
  const { data: actor } = await admin.from('users').select('id').eq('auth_id', auth.user.id).maybeSingle();
  if (!actor?.id) return { error: json({ error: 'UNAUTHENTICATED' }, 401) };
  return { caller, admin, actorId: String(actor.id) };
}

// deno-lint-ignore no-explicit-any
type Row = any;

/** The maps a catalogue material renders with: 2k, else 1k, else the smallest set with an albedo. */
function mapsOf(pbr: Row): { albedo: string; normal: string | null; orm: string | null } | null {
  const byRes = pbr?.mapsByRes;
  if (!byRes || typeof byRes !== 'object') return null;
  const order = ['2k', '1k', ...Object.keys(byRes).filter((k) => k !== '2k' && k !== '1k').sort()];
  for (const res of order) {
    const set = byRes[res];
    if (set?.albedo && CATALOG_READABLE.test(set.albedo)) {
      const ok = (k: unknown) => (typeof k === 'string' && CATALOG_READABLE.test(k) ? k : null);
      return { albedo: set.albedo, normal: ok(set.normal), orm: ok(set.orm) };
    }
  }
  return null;
}

/**
 * `billedBy: 'RENDER'` — called by render-start, which has already confirmed and
 * reserved the customer's money for this pass (renders.ts): the "billing is on,
 * confirmation required" refusal does not apply to it.
 */
export async function handleFactory(req: Request, opts: { billedBy?: 'RENDER' } = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  const gpu = factoryConfig();
  if (!gpu) return json({ error: 'FACTORY_NOT_CONFIGURED' }, 503);
  let body: { projectId?: string; reconstructionId?: string | null; versionId?: string | null; pass?: number; spec?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const pass = Number(body.pass);
  if (!UUID.test(String(body.projectId)) || !Number.isInteger(pass) || pass < 1 || pass > 3) return json({ error: 'BAD_REQUEST' }, 400);
  if (body.reconstructionId != null && !UUID.test(String(body.reconstructionId))) return json({ error: 'BAD_REQUEST' }, 400);
  if (body.versionId != null && !UUID.test(String(body.versionId))) return json({ error: 'BAD_REQUEST' }, 400);
  let spec: SceneBuildSpec;
  try { spec = validateSceneSpec(body.spec); } catch (e) { return json({ error: 'BAD_SPEC', path: e instanceof SpecError ? e.path : null }, 422); }

  // Only the project's owner builds (an administrator may read it, never spend for it).
  const { data: project } = await admin.from('ds_projects').select('id, user_id, deleting_at').eq('id', body.projectId).maybeSingle();
  if (!project || project.deleting_at || String(project.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (body.reconstructionId) {
    const { data: r } = await caller.from('ds_reconstructions').select('id, project_id').eq('id', body.reconstructionId).maybeSingle();
    if (!r || r.project_id !== project.id) return json({ error: 'NOT_FOUND' }, 404);
  }
  if (body.versionId) {
    const { data: v } = await caller.from('ds_versions').select('id, project_id').eq('id', body.versionId).maybeSingle();
    if (!v || v.project_id !== project.id) return json({ error: 'NOT_FOUND' }, 404);
  }
  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true && opts.billedBy !== 'RENDER') return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  // Idempotent: the same spec at the same pass is the same job (a retry never pays twice).
  const specSha = await sha256Hex(canonicalJson(spec));
  const idem = await sha256Hex(`${ENGINE_VERSION}|${project.id}|${pass}|${specSha}`);
  const { data: existing } = await admin.from('ds_factory_jobs').select('id, state').eq('project_id', project.id).eq('idempotency_key', idem).maybeSingle();
  if (existing && existing.state !== 'FAILED' && existing.state !== 'CANCELLED') {
    // The same pass is reused — unless an output of it failed verification: then it is built again,
    // and the old rows (kept for the record) are detached so the new outputs are never mixed with them.
    const { count: broken } = await admin.from('ds_factory_assets').select('id', { count: 'exact', head: true }).eq('job_id', existing.id).eq('state', 'FAILED');
    if (!broken) return json({ jobId: existing.id, state: existing.state, reused: true });
    await admin.from('ds_factory_assets').update({ job_id: null, updated_at: new Date().toISOString() }).eq('job_id', existing.id);
  }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('ds_factory_jobs').select('id', { count: 'exact', head: true }).eq('user_id', actorId).gte('created_at', since);
  if ((count ?? 0) >= HOURLY_JOBS) return json({ error: 'RATE_LIMITED' }, 429);

  // The catalogue files the spec names, resolved from the catalogue itself.
  const materialIds = spec.materials.map((m) => m.id).filter((id) => UUID.test(id));
  const textures: Record<string, { albedo: string; normal: string | null; orm: string | null }> = {};
  if (materialIds.length) {
    const { data: rows } = await admin.from('ds_catalog_materials').select('id, pbr, active').in('id', materialIds);
    for (const m of rows ?? []) {
      const maps = m.active ? mapsOf(m.pbr) : null;
      if (!maps) continue;
      textures[m.id] = { albedo: await signed('GET', maps.albedo), normal: maps.normal ? await signed('GET', maps.normal) : null, orm: maps.orm ? await signed('GET', maps.orm) : null };
    }
  }
  const codes = [...new Set(spec.objects.filter((o) => o.kind === 'MODEL' && o.model).map((o) => o.model as string))];
  const models: Record<string, string> = {};
  if (codes.length) {
    const { data: rows } = await admin.from('ds_catalog_assets').select('code, model_key, active').in('code', codes);
    for (const a of rows ?? []) if (a.active && typeof a.model_key === 'string' && CATALOG_READABLE.test(a.model_key)) models[a.code] = await signed('GET', a.model_key);
  }
  // A MODEL the catalogue cannot provide is drawn as HOMATCH's own piece of that size (never silently dropped).
  for (const o of spec.objects) if (o.kind === 'MODEL' && (!o.model || !models[o.model])) { o.kind = 'CABINET'; o.model = null; }

  const { data: job, error: jobErr } = await admin.from('ds_factory_jobs').upsert({
    project_id: project.id, user_id: actorId, reconstruction_id: body.reconstructionId ?? null, version_id: body.versionId ?? null,
    source_kind: spec.source.kind, pass, idempotency_key: idem, spec_sha256: specSha, engine_version: ENGINE_VERSION,
    state: 'QUEUED', provider: PROVIDER, spec, timings: { requestedAt: new Date().toISOString() }, cost: [], error: null, result: null,
  }, { onConflict: 'project_id,idempotency_key' }).select('id').single();
  if (jobErr || !job) return json({ error: 'JOB_NOT_RECORDED' }, 500);

  const base = `users/${actorId}`;
  const rows: Row[] = [];
  const add = (role: 'RENDER' | 'SCENE' | 'PIECE' | ViewRole, tier: string, group: string | null) => {
    const id = crypto.randomUUID();
    const key = role === 'RENDER' ? `${base}/design-studio-thumbnails/${project.id}/${id}.jpg`
      : isViewRole(role) ? `${base}/design-studio-thumbnails/${project.id}/${id}.${VIEW_EXT[role]}`
      : `${base}/design-studio-models/${project.id}/${id}.glb`;
    rows.push({ id, project_id: project.id, user_id: actorId, job_id: job.id, role, tier, group_key: group, object_key: key, provider: PROVIDER, state: 'PENDING' });
    return key;
  };
  const outputs: Row = {};
  if (spec.outputs.render) outputs.render = await signed('PUT', add('RENDER', 'QA', null));
  if (spec.outputs.scene) outputs.scene = { DESKTOP: await signed('PUT', add('SCENE', 'DESKTOP', null)), MOBILE: await signed('PUT', add('SCENE', 'MOBILE', null)) };
  if (spec.outputs.objects) {
    outputs.objects = {};
    for (const g of new Set(spec.objects.filter((o) => o.runtime && o.group).map((o) => o.group as string))) outputs.objects[g] = await signed('PUT', add('PIECE', 'RUNTIME', g));
  }
  if (spec.views?.length) {
    // Every planned view: its picture, and (with an object map) the id image and legend, keyed by the view's id.
    outputs.views = {};
    for (const v of spec.views) {
      outputs.views[v.id] = {
        image: await signed('PUT', add('VIEW', 'VIEW', v.id)),
        ids: v.objectMap ? await signed('PUT', add('VIEW_IDS', 'VIEW', v.id)) : null,
        legend: v.objectMap ? await signed('PUT', add('VIEW_LEGEND', 'VIEW', v.id)) : null,
      };
    }
  }
  if (rows.length) await admin.from('ds_factory_assets').insert(rows);

  const input = {
    jobId: job.id, spec, inputs: { textures, models }, outputs,
    limits: { deadlineS: spec.views?.length ? 1800 : 900, textureSize: { DESKTOP: 2048, MOBILE: 1024 }, objectTextureSize: 1024, device: 'AUTO' },
  };
  const r = await fetch(`https://api.runpod.ai/v2/${gpu.endpoint}/run`, {
    method: 'POST', headers: { authorization: `Bearer ${gpu.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ input }),
  }).catch(() => null);
  const run: Row = r && r.ok ? await r.json().catch(() => null) : null;
  if (!run?.id) {
    await admin.from('ds_factory_jobs').update({ state: 'FAILED', error: `PROVIDER_REFUSED_${r?.status ?? 'NETWORK'}`, updated_at: new Date().toISOString() }).eq('id', job.id);
    await admin.from('ds_factory_assets').update({ state: 'FAILED' }).eq('job_id', job.id);
    return json({ error: 'FACTORY_UNAVAILABLE' }, 502);
  }
  await admin.from('ds_factory_jobs').update({ state: 'RUNNING', provider_job_id: String(run.id), updated_at: new Date().toISOString() }).eq('id', job.id);
  return json({ jobId: job.id, state: 'RUNNING', textured: Object.keys(textures).length, models: Object.keys(models).length });
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => b.length > 8 && PNG_MAGIC.every((x, i) => b[i] === x);
const LEGEND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

/**
 * A view's legend as the worker wrote it (renders/contract.ts ObjectMap), or null: the id image's own
 * size, and every entry a target of a known kind with a unique #rrggbb colour, its coverage and a box
 * inside the picture; coverage sums to at most the whole picture.
 */
export function readLegend(bytes: Uint8Array, width: number | null, height: number | null): { width: number; height: number; entries: number } | null {
  let raw: Row;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.width) || !Number.isInteger(raw.height) || !Array.isArray(raw.entries) || raw.entries.length > 4000) return null;
  if ((width != null && raw.width !== width) || (height != null && raw.height !== height)) return null;
  const unit = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
  const colours = new Set<string>();
  let total = 0;
  for (const e of raw.entries) {
    if (!e || typeof e.color !== 'string' || !/^#[0-9a-f]{6}$/.test(e.color) || e.color === '#000000' || colours.has(e.color)) return null;
    if (!MAP_KINDS.has(e.kind) || typeof e.id !== 'string' || !LEGEND_ID.test(e.id)) return null;
    if (e.roomId != null && (typeof e.roomId !== 'string' || !LEGEND_ID.test(e.roomId))) return null;
    if (!unit(e.coverage) || !Array.isArray(e.box) || e.box.length !== 4 || !e.box.every(unit)) return null;
    colours.add(e.color);
    total += e.coverage;
  }
  return total <= 1 + 1e-4 ? { width: raw.width, height: raw.height, entries: raw.entries.length } : null;
}

/** What the client may use: each output's effective asset (a deduplicated one points at the copy that is kept). */
async function resolved(admin: Row, jobId: string) {
  const { data } = await admin.from('ds_factory_assets').select('id, role, tier, group_key, object_key, sha256, bytes, state, facts').eq('job_id', jobId);
  const rows: Row[] = data ?? [];
  const byId = new Map<string, Row>();
  const twins = rows.map((a) => a.facts?.sameAs).filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x));
  if (twins.length) for (const t of (await admin.from('ds_factory_assets').select('id, object_key, sha256, bytes, state').in('id', twins)).data ?? []) byId.set(t.id, t);
  const eff = (a: Row) => {
    const twin = a.facts?.sameAs ? byId.get(a.facts.sameAs) ?? rows.find((x) => x.id === a.facts.sameAs) : null;
    const use = twin && twin.state === 'READY' ? twin : a.state === 'READY' ? a : null;
    return use ? { assetId: use.id, key: use.object_key, sha256: use.sha256, bytes: use.bytes } : null;
  };
  const views: Record<string, { image: Row; ids: Row; legend: Row }> = {};
  for (const a of rows.filter((x) => isViewRole(x.role))) {
    const v = views[a.group_key] ?? (views[a.group_key] = { image: null, ids: null, legend: null });
    v[VIEW_PART[a.role as ViewRole]] = eff(a);
  }
  return {
    render: rows.filter((a) => a.role === 'RENDER').map(eff)[0] ?? null,
    scene: Object.fromEntries(rows.filter((a) => a.role === 'SCENE').map((a) => [a.tier, eff(a)])),
    pieces: Object.fromEntries(rows.filter((a) => a.role === 'PIECE').map((a) => [a.group_key, eff(a)])),
    // Only when the pass planned views: a status without them is exactly what it was.
    ...(Object.keys(views).length ? { views } : {}),
  };
}

export async function handleFactoryStatus(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin } = ctx;
  let body: { jobId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.jobId))) return json({ error: 'BAD_REQUEST' }, 400);
  // RLS decides who may see it.
  const { data: job } = await caller.from('ds_factory_jobs').select('id, project_id, state, provider_job_id, timings, cost, result, error').eq('id', body.jobId).maybeSingle();
  if (!job) return json({ error: 'NOT_FOUND' }, 404);
  const done = (state: string, extra: Row = {}) => resolved(admin, job.id).then((outputs) => json({ state, outputs, ...extra }));
  if (job.state === 'COMPLETED' || job.state === 'FAILED' || job.state === 'CANCELLED') return done(job.state, { timings: job.timings, cost: job.cost, result: job.result, error: job.error });
  const gpu = factoryConfig();
  if (!gpu || !job.provider_job_id) return json({ state: job.state });
  const r = await fetch(`https://api.runpod.ai/v2/${gpu.endpoint}/status/${encodeURIComponent(job.provider_job_id)}`, { headers: { authorization: `Bearer ${gpu.key}` } }).catch(() => null);
  const st: Row = r && r.ok ? await r.json().catch(() => null) : null;
  if (!st) return json({ state: job.state });
  const status = String(st.status ?? '');
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
    // The worker's real stage while it runs (progress_update), from a fixed set — never free text.
    const stage = typeof st.output?.stage === 'string' && FACTORY_STAGES.has(st.output.stage) ? st.output.stage : null;
    return json({ state: status === 'IN_QUEUE' ? 'QUEUED' : 'RUNNING', stage });
  }

  const now = new Date().toISOString();
  // Exactly one caller verifies a finished pass (two tabs, a reload or a retry may poll at once):
  // a concurrent verifier would see files the first one is checking, or has just deleted, as broken.
  // The claim is a compare-and-set on the row; a claim older than five minutes (a verifier that died) lapses.
  const lapsed = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: claimed } = await admin.from('ds_factory_jobs')
    .update({ timings: { ...job.timings, verifyingAt: now } })
    .eq('id', job.id).eq('state', 'RUNNING')
    .or(`timings->>verifyingAt.is.null,timings->>verifyingAt.lt.${lapsed}`)
    .select('id');
  if (!claimed?.length) return json({ state: 'RUNNING', stage: null });
  const delayMs = Number(st.delayTime ?? NaN); const execMs = Number(st.executionTime ?? NaN);
  const out = st.output ?? {};
  const timings = { ...job.timings, finishedAt: now, queueAndColdStartMs: Number.isFinite(delayMs) ? delayMs : null, executionMs: Number.isFinite(execMs) ? execMs : null, worker: out.timings ?? null, factory: out.build?.timings ?? null };
  const cost = [{ ...gpuCost(Number.isFinite(execMs) ? execMs : null, gpu.usdPerSecond, `factory pass ${job.provider_job_id}`), kind: 'GPU' }];
  const { data: pendingRows } = await admin.from('ds_factory_assets').select('id, role, tier, group_key, object_key').eq('job_id', job.id).eq('state', 'PENDING');
  const pending: Row[] = pendingRows ?? [];
  const fail = async (a: Row, why: string) => {
    await deleteObject(a.object_key).catch(() => null);
    await admin.from('ds_factory_assets').update({ state: 'FAILED', facts: { error: why.slice(0, 200) }, updated_at: now }).eq('id', a.id);
  };
  if (status !== 'COMPLETED' || !out.ok) {
    // A failed or cancelled pass leaves nothing behind in storage.
    for (const a of pending) await fail(a, status || 'FAILED');
    const error = String(out.error ?? status ?? 'UNKNOWN').slice(0, 300);
    await admin.from('ds_factory_jobs').update({ state: 'FAILED', error, timings, cost, updated_at: now }).eq('id', job.id);
    return done('FAILED', { error, timings, cost });
  }

  let persisted = 0;
  const keep = async (a: Row, bytes: Uint8Array, sha: string, facts: Row) => {
    // The same bytes already stored for this project: keep one, point at it.
    const { data: twin } = await admin.from('ds_factory_assets').select('id').eq('project_id', job.project_id).eq('sha256', sha).eq('state', 'READY').neq('id', a.id).maybeSingle();
    if (twin) {
      await deleteObject(a.object_key).catch(() => null);
      await admin.from('ds_factory_assets').update({ state: 'DELETED', sha256: sha, facts: { ...facts, sameAs: twin.id }, updated_at: now }).eq('id', a.id);
      return;
    }
    persisted += bytes.length;
    await admin.from('ds_factory_assets').update({ state: 'READY', sha256: sha, bytes: bytes.length, facts, updated_at: now }).eq('id', a.id);
  };
  const desktopId = pending.find((a) => a.role === 'SCENE' && a.tier === 'DESKTOP')?.id ?? null;
  for (const a of pending) {
    // A view reports its three files together; a view that did not render ({ ok: false }) fails all three.
    const view: Row = isViewRole(a.role) ? out.outputs?.views?.[a.group_key] : null;
    const o: Row = a.role === 'RENDER' ? out.outputs?.render : a.role === 'SCENE' ? out.outputs?.scene?.[a.tier]
      : isViewRole(a.role) ? (view && view.ok !== false ? view[VIEW_PART[a.role]] : view) : out.outputs?.objects?.[a.group_key];
    if (a.role === 'SCENE' && o?.sameAs === 'DESKTOP' && desktopId) {
      // Identical tiers: one file, the other row points at it.
      await deleteObject(a.object_key).catch(() => null);
      await admin.from('ds_factory_assets').update({ state: 'DELETED', facts: { sameAs: desktopId }, updated_at: now }).eq('id', a.id);
      continue;
    }
    if (!o || o.ok === false || !o.sha256) { await fail(a, o?.error ?? 'NOT_BUILT'); continue; }
    const limit = a.role === 'RENDER' ? MAX_RENDER_BYTES : a.role === 'SCENE' ? MAX_SCENE_BYTES : a.role === 'VIEW' ? MAX_VIEW_BYTES
      : a.role === 'VIEW_IDS' ? MAX_VIEW_IDS_BYTES : a.role === 'VIEW_LEGEND' ? MAX_VIEW_LEGEND_BYTES : MAX_PIECE_BYTES;
    // Re-read what arrived: size, hash, and a full inspection, before anything uses it.
    const head = await headObject(a.object_key);
    if (!head.exists || !head.size || head.size > limit || head.size !== o.bytes) { await fail(a, 'SIZE'); continue; }
    const bytes = new Uint8Array(await (await getObject(a.object_key)).arrayBuffer());
    const sha = await sha256Hex(bytes);
    if (sha !== o.sha256) { await fail(a, 'HASH'); continue; }
    if (a.role === 'RENDER') {
      if (!isJpeg(bytes)) { await fail(a, 'NOT_JPEG'); continue; }
      await keep(a, bytes, sha, { width: o.width ?? null, height: o.height ?? null });
      continue;
    }
    if (a.role === 'VIEW' || a.role === 'VIEW_IDS') {
      if (a.role === 'VIEW' ? !isJpeg(bytes) : !isPng(bytes)) { await fail(a, a.role === 'VIEW' ? 'NOT_JPEG' : 'NOT_PNG'); continue; }
      await keep(a, bytes, sha, { width: o.width ?? null, height: o.height ?? null, ms: (a.role === 'VIEW' ? view?.ms : view?.idMs) ?? null });
      continue;
    }
    if (a.role === 'VIEW_LEGEND') {
      const legend = readLegend(bytes, view?.ids?.width ?? null, view?.ids?.height ?? null);
      if (!legend) { await fail(a, 'BAD_LEGEND'); continue; }
      await keep(a, bytes, sha, legend);
      continue;
    }
    const inspected = inspectModel(bytes);
    if (!inspected.ok) { await fail(a, `INSPECT_${inspected.reason}`); continue; }
    await keep(a, bytes, sha, { triangles: o.triangles ?? null, textures: o.textures ?? null, meshopt: o.meshopt ?? null, validatorErrors: o.validator?.errors ?? null });
  }
  const result = {
    build: out.build ?? null, attempts: out.attempts ?? null, coldStart: out.coldStart ?? null, gpu: out.gpu ?? null,
    temporaryBytesDeleted: out.temporaryBytesDeleted ?? null, temporaryDirRemoved: out.temporaryDirRemoved ?? null, persistedBytes: persisted,
  };
  await admin.from('ds_factory_jobs').update({ state: 'COMPLETED', result, timings, cost, updated_at: now }).eq('id', job.id);
  return done('COMPLETED', { timings, cost, result });
}

/**
 * A superseded pass's outputs are deleted (a later pass replaced them). A file
 * another pass deduplicated onto (facts.sameAs) is kept: it is still in use.
 */
export async function handleFactoryDiscard(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  let body: { jobId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.jobId))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: job } = await caller.from('ds_factory_jobs').select('id, user_id, project_id, state').eq('id', body.jobId).maybeSingle();
  if (!job || String(job.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (job.state !== 'COMPLETED' && job.state !== 'FAILED') return json({ error: 'NOT_FINISHED' }, 409);
  const { data: rows } = await admin.from('ds_factory_assets').select('id, object_key').eq('job_id', job.id).eq('state', 'READY');
  let deleted = 0; let kept = 0;
  for (const a of rows ?? []) {
    const { count } = await admin.from('ds_factory_assets').select('id', { count: 'exact', head: true }).eq('project_id', job.project_id).eq('facts->>sameAs', a.id);
    if ((count ?? 0) > 0) { kept += 1; continue; }
    await deleteObject(a.object_key).catch(() => null);
    await admin.from('ds_factory_assets').update({ state: 'DELETED', updated_at: new Date().toISOString() }).eq('id', a.id);
    deleted += 1;
  }
  return json({ deleted, kept });
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function textOf(payload: Row): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output?.flatMap((o: Row) => o?.content ?? []) ?? []).map((p: Row) => p?.text ?? '').join('').trim();
}

/**
 * Source vs render from the same camera → a structured, validated difference list.
 * The source is the reconstruction's picture, or (a floor-plan build) the plan drawing.
 * The render is a factory render (by asset id) or, without the factory, a browser still.
 */
export async function handleQa(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  let body: { reconstructionId?: string; floorplanId?: string; image?: number; render?: string; renderAssetId?: string; objects?: unknown; rooms?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  let source: { key: string; projectId: string; userId: string; jobRef: string; plan: boolean } | null = null;
  if (body.reconstructionId && UUID.test(body.reconstructionId)) {
    const { data: recon } = await caller.from('ds_reconstructions').select('id, project_id, user_id, reference_ids').eq('id', body.reconstructionId).maybeSingle();
    if (!recon) return json({ error: 'NOT_FOUND' }, 404);
    const refId = recon.reference_ids?.[Number.isInteger(body.image) ? body.image! : 0];
    const { data: ref } = await caller.from('ds_floorplans').select('object_key').eq('id', refId).maybeSingle();
    if (ref) source = { key: ref.object_key, projectId: recon.project_id, userId: recon.user_id, jobRef: recon.id, plan: false };
  } else if (body.floorplanId && UUID.test(body.floorplanId)) {
    const { data: fp } = await caller.from('ds_floorplans').select('id, project_id, user_id, object_key, mime').eq('id', body.floorplanId).maybeSingle();
    if (fp && String(fp.mime ?? '').startsWith('image/')) source = { key: fp.object_key, projectId: fp.project_id, userId: fp.user_id, jobRef: fp.id, plan: true };
  }
  if (!source || source.userId !== actorId || !String(source.key).startsWith(`users/${source.userId}/design-studio-floorplans/${source.projectId}/`)) return json({ error: 'NOT_FOUND' }, 404);
  let render: string | null = null;
  if (body.renderAssetId && UUID.test(body.renderAssetId)) {
    const { data: asset } = await admin.from('ds_factory_assets').select('object_key, project_id, role, state').eq('id', body.renderAssetId).maybeSingle();
    if (!asset || asset.project_id !== source.projectId || asset.role !== 'RENDER' || asset.state !== 'READY') return json({ error: 'NOT_FOUND' }, 404);
    const bytes = new Uint8Array(await (await getObject(asset.object_key)).arrayBuffer());
    if (!isJpeg(bytes) || bytes.length > MAX_RENDER_BYTES) return json({ error: 'BAD_RENDER' }, 422);
    render = `data:image/jpeg;base64,${base64(bytes)}`;
  } else if (typeof body.render === 'string' && body.render.startsWith('data:image/jpeg;base64,') && body.render.length < 4_500_000) {
    render = body.render;
  }
  if (!render) return json({ error: 'BAD_REQUEST' }, 400);
  const src = new Uint8Array(await (await getObject(source.key)).arrayBuffer());
  if (src.length > 12 * 1024 * 1024) return json({ error: 'FILE_TOO_LARGE' }, 422);
  const mime = src[0] === 0x89 ? 'image/png' : src[0] === 0x52 ? 'image/webp' : 'image/jpeg';
  const listed = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.slice(0, 220) : []).slice(0, 24000);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'AI_NOT_CONFIGURED' }, 503);
  const startedAt = Date.now();
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: QA_MODEL,
      input: [{ role: 'system', content: source.plan ? PLAN_QA_SYSTEM : QA_SYSTEM }, { role: 'user', content: [
        { type: 'input_text', text: `Objects in the rebuild (key, type, label): ${listed(body.objects)}\nRooms (key, kind): ${listed(body.rooms)}` },
        { type: 'input_text', text: 'SOURCE:' }, { type: 'input_image', image_url: `data:${mime};base64,${base64(src)}` },
        { type: 'input_text', text: 'RENDER:' }, { type: 'input_image', image_url: render },
      ] }],
      text: { format: { type: 'json_schema', name: 'ds_qa', strict: false, schema: QA_SCHEMA } },
      reasoning: { effort: 'medium' },
    }),
  }).catch(() => null);
  const payload = r && r.ok ? await r.json().catch(() => null) : null;
  const text = payload ? textOf(payload) : '';
  if (!text) return json({ error: 'QA_FAILED' }, 502);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return json({ error: 'QA_FAILED' }, 502); }
  const report = validateQaReport(raw);
  const cost = await meterAiCall(admin, { userId: source.userId, productCode: 'DS_RECONSTRUCT', jobRef: source.jobRef, model: QA_MODEL, startedAt }, payload, { step: 'visual_qa', errors: report.errors.length });
  return json({ report, ms: Date.now() - startedAt, cost: { usd: cost.aiCents === null ? null : cost.aiCents / 100, basis: cost.aiCents === null ? 'NOT_AVAILABLE' : 'ESTIMATED' }, tokens: payload?.usage ?? null });
}
