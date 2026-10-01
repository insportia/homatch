// HOMATCH DESIGN STUDIO — building objects on the GPU, and checking the result against the picture.
//
//   POST …/design-studio-reconstruct/generate         { reconstructionId, keys[] }  → a GPU job (idempotent)
//   POST …/design-studio-reconstruct/generate-status  { jobId }                     → its state; on completion
//                                                                                     every model is verified
//   POST …/design-studio-reconstruct/qa               { reconstructionId, render, objects, rooms } → a
//                                                                                     structured comparison
//
// The browser only NAMES the objects (by their reading keys). Everything the
// GPU worker is given is derived here from the server's own copy of the
// reading: each crop is the object's box projected through the picture's
// measured camera (hybrid/crops.ts), its size is the reading's. The worker gets
// one signed GET for the picture and one signed PUT per object, for the exact
// key its model will live at — it holds no storage credentials and chooses no
// paths. Nothing is trusted on arrival: every uploaded model is re-read,
// hashed and inspected before it is READY; anything that fails is deleted.
//
// Provider-neutral at the edges: the GPU provider is configured (endpoint,
// key, price per second) by environment, and named only here.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { deleteObject, getObject, headObject, r2Config } from '../_shared/objectStore.ts';
import { presign } from '../_shared/storage/sigv4.ts';
import { inspectModel } from '../_shared/designStudio/modelInspect.ts';
import { objectCrop } from '../_shared/designStudio/hybrid/crops.ts';
import { ENGINE_VERSION } from '../_shared/designStudio/hybrid/contract.ts';
import { gpuCost } from '../_shared/designStudio/hybrid/cost.ts';
import { QA_SCHEMA, QA_SYSTEM, validateQaReport } from '../_shared/designStudio/hybrid/qa.ts';
import { scaleFit } from '../_shared/designStudio/sourceCamera.ts';
import { meterAiCall } from './metering.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** What may be sent to the GPU in one job (the cost ceiling's first line). */
const MAX_OBJECTS = 10;
/** Kinds a generated model may stand for (hybrid/resolution.GENERATABLE). */
const GENERATABLE = new Set([
  'SOFA', 'ARMCHAIR', 'CHAIR', 'OFFICE_CHAIR', 'BAR_STOOL', 'BED_DOUBLE', 'BED_SINGLE', 'PLANT', 'PLANTER', 'FLOOR_LAMP',
  'OUTDOOR_CHAIR', 'OUTDOOR_SOFA', 'DECOR', 'COFFEE_TABLE', 'DINING_TABLE', 'SIDE_TABLE', 'OUTDOOR_TABLE', 'BEDSIDE',
]);
const MAX_MODEL_BYTES = 12 * 1024 * 1024;
const URL_SECONDS = 3600;
const PROVIDER = 'runpod';
const QA_MODEL = Deno.env.get('OPENAI_DS_QA_MODEL') || Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

function gpuConfig() {
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

async function callerOf(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return { error: json({ error: 'UNAUTHENTICATED' }, 401) };
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return { error: json({ error: 'UNAUTHENTICATED' }, 401) };
  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return { error: refused };
  return { caller, admin };
}

/** The reading's own camera for picture `image`, scaled to the built space (ReferencePanel.pictureCamera does the same in the browser). */
// deno-lint-ignore no-explicit-any
function fitFor(analysis: any, image: number) {
  const fit = analysis?.cameras?.find((c: any) => c.image === image)?.fit ?? null;
  return fit ? scaleFit(fit, 1) : null;
}

export async function handleGenerate(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin } = ctx;
  const gpu = gpuConfig();
  if (!gpu) return json({ error: 'GPU_NOT_CONFIGURED' }, 503);
  let body: { reconstructionId?: string; keys?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const keys = Array.isArray(body.keys) ? [...new Set(body.keys.filter((k): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(k)))] : [];
  if (!body.reconstructionId || !keys.length || keys.length > MAX_OBJECTS) return json({ error: 'BAD_REQUEST' }, 400);

  const { data: recon } = await caller.from('ds_reconstructions').select('id, project_id, user_id, reference_ids, analysis').eq('id', body.reconstructionId).maybeSingle();
  if (!recon?.analysis) return json({ error: 'NOT_FOUND' }, 404);
  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  // Idempotent: the same reading and the same objects never start a second paid job.
  const idem = await sha256Hex(`${ENGINE_VERSION}|${recon.id}|${[...keys].sort().join(',')}`);
  const { data: existing } = await admin.from('ds_generation_jobs').select('id, state').eq('project_id', recon.project_id).eq('idempotency_key', idem).maybeSingle();
  if (existing && existing.state !== 'FAILED' && existing.state !== 'CANCELLED') return json({ jobId: existing.id, state: existing.state, reused: true });

  // deno-lint-ignore no-explicit-any
  const analysis = recon.analysis as any;
  // deno-lint-ignore no-explicit-any
  const objects: any[] = [];
  for (const key of keys) {
    // deno-lint-ignore no-explicit-any
    const o = analysis.objects?.find((x: any) => x.key === key);
    if (!o || !GENERATABLE.has(o.type) || !o.px) return json({ error: 'NOT_GENERATABLE', key }, 422);
    const fit = fitFor(analysis, o.px.image);
    if (!fit) return json({ error: 'NO_CAMERA', key }, 422);
    const crop = objectCrop(fit, o.at, o.facingDeg, { width: o.widthM, depth: o.depthM, height: o.heightM });
    if (!crop) return json({ error: 'NO_CROP', key }, 422);
    objects.push({ key, type: o.type, image: o.px.image, crop: crop.box, tight: crop.tight, sizeM: { width: o.widthM, depth: o.depthM, height: o.heightM }, assetId: crypto.randomUUID() });
  }
  const images = new Set(objects.map((o) => o.image));
  if (images.size !== 1) return json({ error: 'ONE_PICTURE_PER_JOB' }, 422);
  const refId = recon.reference_ids?.[objects[0].image];
  const { data: ref } = await caller.from('ds_floorplans').select('object_key, sha256').eq('id', refId).maybeSingle();
  const prefix = `users/${recon.user_id}/design-studio-floorplans/${recon.project_id}/`;
  if (!ref || !String(ref.object_key).startsWith(prefix)) return json({ error: 'NOT_FOUND' }, 404);

  const { data: job, error: jobErr } = await admin.from('ds_generation_jobs').upsert({
    project_id: recon.project_id, user_id: recon.user_id, reconstruction_id: recon.id, idempotency_key: idem, engine_version: ENGINE_VERSION,
    state: 'QUEUED', provider: PROVIDER, request: { keys, objects: objects.map(({ key, type, crop, tight, sizeM, assetId }) => ({ key, type, crop, tight, sizeM, assetId })) },
    timings: { requestedAt: new Date().toISOString() }, cost: [], error: null, result: null,
  }, { onConflict: 'project_id,idempotency_key' }).select('id').single();
  if (jobErr || !job) return json({ error: 'JOB_NOT_RECORDED' }, 500);

  const keyOf = (assetId: string) => `users/${recon.user_id}/design-studio-models/${recon.project_id}/${assetId}.glb`;
  await admin.from('ds_generated_assets').insert(objects.map((o) => ({
    id: o.assetId, project_id: recon.project_id, user_id: recon.user_id, job_id: job.id, object_key: keyOf(o.assetId), source_ref: o.key,
    provider: PROVIDER, model_version: 'pending', license_status: 'COMMERCIAL_OK', state: 'PENDING',
  })));
  const input = {
    jobId: job.id, model: 'trellis2',
    image: { url: await signed('GET', ref.object_key), sha256: ref.sha256 ?? null },
    objects: await Promise.all(objects.map(async (o) => ({ key: o.key, type: o.type, crop: o.crop, tight: o.tight, sizeM: o.sizeM, outputs: { glb: await signed('PUT', keyOf(o.assetId)) } }))),
    limits: { maxTriangles: 40000, textureSize: 1024, deadlineS: 900 },
  };
  const r = await fetch(`https://api.runpod.ai/v2/${gpu.endpoint}/run`, {
    method: 'POST', headers: { authorization: `Bearer ${gpu.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ input }),
  }).catch(() => null);
  // deno-lint-ignore no-explicit-any
  const run: any = r && r.ok ? await r.json().catch(() => null) : null;
  if (!run?.id) {
    await admin.from('ds_generation_jobs').update({ state: 'FAILED', error: `PROVIDER_REFUSED_${r?.status ?? 'NETWORK'}`, updated_at: new Date().toISOString() }).eq('id', job.id);
    await admin.from('ds_generated_assets').update({ state: 'FAILED' }).eq('job_id', job.id);
    return json({ error: 'GPU_UNAVAILABLE' }, 502);
  }
  await admin.from('ds_generation_jobs').update({ state: 'RUNNING', provider_job_id: String(run.id), updated_at: new Date().toISOString() }).eq('id', job.id);
  return json({ jobId: job.id, state: 'RUNNING', objects: objects.length });
}

export async function handleGenerateStatus(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin } = ctx;
  let body: { jobId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  // RLS decides ownership.
  const { data: job } = await caller.from('ds_generation_jobs').select('*').eq('id', body.jobId ?? '').maybeSingle();
  if (!job) return json({ error: 'NOT_FOUND' }, 404);
  const assetsOf = async () => (await admin.from('ds_generated_assets').select('id, source_ref, object_key, sha256, bytes, triangles, textures, dims_m, state, model_version').eq('job_id', job.id)).data ?? [];
  if (job.state === 'COMPLETED' || job.state === 'FAILED' || job.state === 'CANCELLED') return json({ state: job.state, assets: await assetsOf(), timings: job.timings, cost: job.cost, error: job.error });
  const gpu = gpuConfig();
  if (!gpu || !job.provider_job_id) return json({ state: job.state });
  const r = await fetch(`https://api.runpod.ai/v2/${gpu.endpoint}/status/${encodeURIComponent(job.provider_job_id)}`, { headers: { authorization: `Bearer ${gpu.key}` } }).catch(() => null);
  // deno-lint-ignore no-explicit-any
  const st: any = r && r.ok ? await r.json().catch(() => null) : null;
  if (!st) return json({ state: job.state });
  const status = String(st.status ?? '');
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') return json({ state: 'RUNNING', provider: status });

  const now = new Date().toISOString();
  const delayMs = Number(st.delayTime ?? NaN); const execMs = Number(st.executionTime ?? NaN);
  const timings = { ...job.timings, finishedAt: now, queueAndColdStartMs: Number.isFinite(delayMs) ? delayMs : null, executionMs: Number.isFinite(execMs) ? execMs : null, worker: st.output?.timings ?? null };
  const cost = [gpuCost(Number.isFinite(execMs) ? execMs : null, gpu.usdPerSecond, `GPU job ${job.provider_job_id}`)];
  const pending = await assetsOf();
  if (status !== 'COMPLETED' || !st.output?.ok) {
    // A failed or cancelled job leaves nothing behind in storage.
    for (const a of pending) await deleteObject(a.object_key).catch(() => null);
    await admin.from('ds_generated_assets').update({ state: 'FAILED', updated_at: now }).eq('job_id', job.id);
    await admin.from('ds_generation_jobs').update({ state: 'FAILED', error: status || 'UNKNOWN', timings, cost, updated_at: now }).eq('id', job.id);
    return json({ state: 'FAILED', error: status, assets: await assetsOf(), timings, cost });
  }
  // deno-lint-ignore no-explicit-any
  const results = new Map<string, any>((st.output.objects ?? []).map((o: any) => [o.key, o]));
  let persisted = 0;
  for (const a of pending) {
    const out = results.get(a.source_ref);
    const failed = async (why: string) => {
      await deleteObject(a.object_key).catch(() => null);
      await admin.from('ds_generated_assets').update({ state: 'FAILED', model_version: String(st.output.model ?? 'unknown').slice(0, 80), updated_at: now }).eq('id', a.id);
      return why;
    };
    if (!out?.ok) { await failed(out?.error ?? 'NOT_BUILT'); continue; }
    // Re-read what arrived: size, hash and a full glTF inspection, before anything uses it.
    const head = await headObject(a.object_key);
    if (!head.exists || !head.size || head.size > MAX_MODEL_BYTES || head.size !== out.bytes) { await failed('SIZE'); continue; }
    const bytes = new Uint8Array(await (await getObject(a.object_key)).arrayBuffer());
    const sha = await sha256Hex(bytes);
    const inspected = inspectModel(bytes);
    if (sha !== out.sha256 || !inspected.ok) { await failed(inspected.ok ? 'HASH' : `INSPECT_${inspected.reason}`); continue; }
    // The same bytes already stored for this project: keep one.
    const { data: twin } = await admin.from('ds_generated_assets').select('id').eq('project_id', job.project_id).eq('sha256', sha).eq('state', 'READY').neq('id', a.id).maybeSingle();
    if (twin) {
      await deleteObject(a.object_key).catch(() => null);
      await admin.from('ds_generated_assets').update({ state: 'DELETED', sha256: sha, updated_at: now }).eq('id', a.id);
      continue;
    }
    persisted += bytes.length;
    await admin.from('ds_generated_assets').update({
      state: 'READY', sha256: sha, bytes: bytes.length, triangles: out.triangles, textures: out.textures, dims_m: out.dims_m,
      model_version: String(st.output.model ?? 'unknown').slice(0, 80), updated_at: now,
    }).eq('id', a.id);
  }
  const result = { objects: st.output.objects, model: st.output.model, segmenter: st.output.segmenter, coldStart: st.output.coldStart, temporaryBytesDeleted: st.output.temporaryBytesDeleted, persistedBytes: persisted };
  await admin.from('ds_generation_jobs').update({ state: 'COMPLETED', result, timings, cost, updated_at: now }).eq('id', job.id);
  return json({ state: 'COMPLETED', assets: await assetsOf(), timings, cost, result });
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function textOf(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output?.flatMap((o: any) => o?.content ?? []) ?? []).map((p: any) => p?.text ?? '').join('').trim();
}

/** Source vs render from the same camera → a structured, validated difference list. Never edits anything. */
export async function handleQa(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin } = ctx;
  let body: { reconstructionId?: string; image?: number; render?: string; objects?: unknown; rooms?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const render = typeof body.render === 'string' && body.render.startsWith('data:image/jpeg;base64,') && body.render.length < 4_500_000 ? body.render : null;
  if (!body.reconstructionId || !render) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: recon } = await caller.from('ds_reconstructions').select('id, project_id, user_id, reference_ids').eq('id', body.reconstructionId).maybeSingle();
  if (!recon) return json({ error: 'NOT_FOUND' }, 404);
  const refId = recon.reference_ids?.[Number.isInteger(body.image) ? body.image! : 0];
  const { data: ref } = await caller.from('ds_floorplans').select('object_key').eq('id', refId).maybeSingle();
  const prefix = `users/${recon.user_id}/design-studio-floorplans/${recon.project_id}/`;
  if (!ref || !String(ref.object_key).startsWith(prefix)) return json({ error: 'NOT_FOUND' }, 404);
  const src = new Uint8Array(await (await getObject(ref.object_key)).arrayBuffer());
  if (src.length > 12 * 1024 * 1024) return json({ error: 'FILE_TOO_LARGE' }, 422);
  const listed = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.slice(0, 220) : []).slice(0, 24000);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'AI_NOT_CONFIGURED' }, 503);
  const startedAt = Date.now();
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: QA_MODEL,
      input: [{ role: 'system', content: QA_SYSTEM }, { role: 'user', content: [
        { type: 'input_text', text: `Objects in the rebuild (key, type, label): ${listed(body.objects)}\nRooms (key, kind): ${listed(body.rooms)}` },
        { type: 'input_text', text: 'SOURCE:' }, { type: 'input_image', image_url: `data:image/jpeg;base64,${base64(src)}` },
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
  const cost = await meterAiCall(admin, { userId: recon.user_id, productCode: 'DS_RECONSTRUCT', jobRef: recon.id, model: QA_MODEL, startedAt }, payload, { step: 'visual_qa', errors: report.errors.length });
  return json({ report, ms: Date.now() - startedAt, cost: { usd: cost.aiCents === null ? null : cost.aiCents / 100, basis: cost.aiCents === null ? 'NOT_AVAILABLE' : 'ESTIMATED' }, tokens: payload?.usage ?? null });
}
