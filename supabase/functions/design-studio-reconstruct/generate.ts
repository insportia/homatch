// HOMATCH DESIGN STUDIO — OPENAI-FIRST GENERATION (the customer's design).
//
//   design-spec          { projectId, versionId, mode, look, preferences, roomId?, parentRenderId?, change?, idempotencyKey, retry?, then? }
//                        → 202 { state: 'RUNNING', jobId }
//                        | { state: 'DONE', jobId, mode, dna, summary, chain? }
//                        | { state: 'FAILED', reason, retryable }
//       OpenAI sees the customer's own source (the floor plan, or the photos;
//       for ROOM / VARIANT also the approved master) with HOMATCH's structured
//       evidence beside it, and writes the Design Specification (designSpec.ts).
//       Kept as the customer's own AI_DESIGN job: the design's lineage.
//       SERVER-OWNED (durable.ts): the request records the job and answers at
//       once; the specification is written in the background, so leaving the
//       page never stops it. The same idempotencyKey is the same job (never a
//       second paid call); a job whose instance was lost is taken over; a
//       stored failure is answered as stored, and only retry: true writes again.
//       A page from before this change (no `durable: true`) still gets the old
//       answer: the specification written in the request, { jobId, mode, dna,
//       summary }, or an error code.
//       then: { quoteToken, versionName } — the customer confirmed the price
//       up front, so the server carries on by itself: the design version, the
//       render (reserved once), its picture and its edit map, each step started
//       in a fresh invocation (kick), nothing waiting for the page.
//
//   render-generate      { quoteToken, projectId, versionId, specJobId, mode, roomId?, parentRenderId?, idempotencyKey }
//                        → { render }
//       Quote checked, money reserved, ONE ds_renders row (no factory job),
//       then IMAGE and SCENE run in the background (generationFlow.ts).
//
//   render-generate-step { renderIds }   → { renders }
//       Moves each generated render on: a lapsed step is taken over, the edit
//       map (MAP) is built, the money is settled once.
//
// No factory, no RunPod, no Blender, no GLB and no 3D asset library anywhere
// on this path: the picture is OpenAI's. The rows it writes are ordinary
// ds_renders rows (kind MASTER / ROOM; READY with final_key, map_key, legend),
// so the stable edit pipeline (render-edit, PR #65) edits them unchanged.
//
// Every route acts AS THE CALLER (RLS decides what exists), refuses an
// impersonated session, and answers errors as codes. OPENAI ONLY.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { beginExecution, recordUnbilledUsage, releaseExecution, serviceClient, settleExecution, type ExecutionGrant } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { getObject, putObject } from '../_shared/objectStore.ts';
import { accountKey } from '../_shared/storage/keys.ts';
import { renderPictureKey, uuidFrom } from '../_shared/designStudio/renderKeys.ts';
import { selectProvider, type ProviderDeps } from '../_shared/designStudio/imageProviders.ts';
import {
  quoteMatches, quoteSecret, RENDER_PRICING, renderRowKey, reservationKey, sha256Hex, validIdempotencyKey, verifyQuote, type QuoteClaims,
} from '../_shared/designStudio/renderPricing.ts';
import {
  buildEvidence, directionFrom, dnaFromSpec, imageInstruction, isGenerationMode, modeContextProblem, roomFromWholeHome, specProblems, specRequest, validateSpec,
  type DesignSpec, type GenerationMode, type ModeContext, type PropertyEvidence,
} from '../_shared/designStudio/designSpec.ts';
import { sceneRequest, validateScene, type SceneElement } from '../_shared/designStudio/sceneMap.ts';
import { driveUntilMap, genNext, runMapStep, type GenIo, type ImageAnswer } from '../_shared/designStudio/generationFlow.ts';
import { dnaKey, type PropertyDesignDNA, type RenderProduct } from '../../../src/lib/designStudio/renders/contract.ts';
import { meterAiCall, priceAiCall, tokensOf } from './metering.ts';
import { failure, isFresh, kick, readFailure } from './durable.ts';
import { photoEvidence, photoOfRoom, type PhotoAnswer, type PhotoUnderstanding } from '../_shared/designStudio/photoRead.ts';
import { decodeRgba, encodePng, rgbaOf } from './rasterRgba.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string) => Deno.env.get(k) ?? undefined;
const deps: ProviderDeps = { fetch: (...a) => fetch(...a), env, encodePng };
const SPEC_MODEL = Deno.env.get('OPENAI_DS_DESIGN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
const SCENE_MODEL = Deno.env.get('OPENAI_DS_SCENE_MODEL') || SPEC_MODEL;
const SPECS_PER_HOUR = 20;
const RENDERS_PER_HOUR = 60;
const MAX_STATUS_IDS = 24;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PICTURE_BYTES = 24 * 1024 * 1024;
const SIZE = { width: 1536, height: 1024 };
const RECORD = 'id, project_id, version_id, kind, parent_id, view, status, factory_job_id, base_key, map_key, final_key, legend, finish, edit, billing, error, created_at, updated_at';

// deno-lint-ignore no-explicit-any
type Row = any;
type Ctx = { caller: Row; admin: Row; actorId: string; authorization: string };

async function callerOf(req: Request): Promise<Ctx | { error: Response }> {
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
  return { caller, admin, actorId: String(actor.id), authorization: authHeader };
}

async function billingOn(admin: Row): Promise<boolean> {
  const { data } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  return data === true;
}

/** The image model chosen for production (admin_settings); OpenAI only (selectProvider). */
async function configuredModel(admin: Row): Promise<{ provider?: unknown; model?: unknown } | null> {
  try {
    const { data } = await admin.from('admin_settings').select('value').eq('key', 'design_studio_render_model').maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    return v && typeof v === 'object' ? v as { provider?: unknown; model?: unknown } : null;
  } catch { return null; }
}

async function inBackground(work: () => Promise<unknown>): Promise<void> {
  const run = () => work().catch((e) => console.error('[ds-generate] background', String(e).slice(0, 200)));
  try {
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(run()); return; }
  } catch { /* fall through */ }
  await run();
}

function base64(bytes: Uint8Array): string {
  let s = ''; const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
// deno-lint-ignore no-explicit-any
function textOf(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const o of payload?.output ?? []) for (const c of o?.content ?? []) if (typeof c?.text === 'string') return c.text;
  return '';
}
function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return null;
}
async function readImage(key: string, max: number): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const r = await getObject(key).catch(() => null);
  if (!r || !r.ok) { await r?.arrayBuffer().catch(() => null); return null; }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const mime = sniff(bytes);
  return bytes.length > 0 && bytes.length <= max && mime ? { bytes, mime } : null;
}
const dataUrl = (img: { bytes: Uint8Array; mime: string }) => `data:${img.mime};base64,${base64(img.bytes)}`;

/** The project the caller owns and is not deleting, and a version of it (read as the caller). */
async function ownedVersion(ctx: Ctx, projectId: string, versionId: string) {
  const { data: project } = await ctx.admin.from('ds_projects').select('id, user_id, deleting_at').eq('id', projectId).maybeSingle();
  if (!project || project.deleting_at || String(project.user_id) !== ctx.actorId) return null;
  const { data: version } = await ctx.caller.from('ds_versions').select('id, project_id, source_id, archived_at, design_dna').eq('id', versionId).maybeSingle();
  if (!version || version.project_id !== project.id || version.archived_at) return null;
  return { project, version };
}

/** The customer's source behind this version's space (read as the caller): a floor plan, or the project's photos. */
type Source =
  | { kind: 'FLOOR_PLAN'; plan: Row; answers: Row[]; ceilingM: number | null }
  | { kind: 'PHOTO'; understanding: PhotoUnderstanding; answers: PhotoAnswer[]; keys: string[] };

async function sourceOf(ctx: Ctx, version: Row): Promise<Source | null> {
  const { data: source } = await ctx.caller.from('ds_spatial_sources').select('id, kind, floorplan_id, canonical, provenance').eq('id', version.source_id).maybeSingle();
  if (source?.kind === 'PHOTO_SET') {
    const understanding = source.canonical?.understanding as PhotoUnderstanding | undefined;
    const ids: string[] = Array.isArray(source.provenance?.referenceIds) ? source.provenance.referenceIds.map(String) : [];
    if (understanding?.kind !== 'PHOTO_UNDERSTANDING' || !ids.length) return null;
    const { data: refs } = await ctx.caller.from('ds_floorplans').select('id, object_key').in('id', ids);
    const byId = new Map((refs ?? []).map((r: Row) => [r.id, r.object_key]));
    const keys = ids.map((id) => byId.get(id)).filter(Boolean) as string[];
    if (keys.length !== ids.length) return null;
    const reconId = String(source.provenance?.reconstructionId ?? '');
    const { data: recon } = UUID.test(reconId)
      ? await ctx.caller.from('ds_reconstructions').select('corrections').eq('id', reconId).maybeSingle()
      : { data: null };
    const answers: PhotoAnswer[] = (Array.isArray(recon?.corrections?.flow?.answers) ? recon.corrections.flow.answers : [])
      .filter((x: Row) => typeof x?.questionId === 'string' && typeof x?.value === 'string')
      .slice(0, 10).map((x: Row) => ({ questionId: x.questionId.slice(0, 8), value: x.value.slice(0, 24) }));
    return { kind: 'PHOTO', understanding, answers, keys };
  }
  if (!source?.floorplan_id) return null;
  const { data: plan } = await ctx.caller.from('ds_floorplans').select('id, object_key, interpretation, corrections').eq('id', source.floorplan_id).maybeSingle();
  if (!plan?.object_key || !plan.interpretation?.doc) return null;
  const last = Array.isArray(plan.corrections) ? plan.corrections[plan.corrections.length - 1] : null;
  return { kind: 'FLOOR_PLAN', plan, answers: Array.isArray(last?.flow?.answers) ? last.flow.answers : [], ceilingM: typeof last?.ceilingM === 'number' ? last.ceilingM : null };
}

/** An approved render to continue from (ROOM / VARIANT): the caller's own, READY, with its picture and spec. */
async function approvedRender(ctx: Ctx, projectId: string, renderId: unknown) {
  if (!UUID.test(String(renderId))) return null;
  const { data: row } = await ctx.caller.from('ds_renders').select('id, project_id, user_id, kind, status, final_key, finish').eq('id', String(renderId)).maybeSingle();
  if (!row || row.project_id !== projectId || String(row.user_id) !== ctx.actorId || row.status !== 'READY' || !row.final_key) return null;
  return row;
}

async function specJob(admin: Row, actorId: string, projectId: string, jobId: unknown) {
  if (!UUID.test(String(jobId))) return null;
  const { data } = await admin.from('ds_jobs').select('id, user_id, project_id, kind, status, output').eq('id', String(jobId)).maybeSingle();
  if (!data || String(data.user_id) !== actorId || data.project_id !== projectId || data.kind !== 'AI_DESIGN' || data.status !== 'SUCCEEDED') return null;
  return data.output?.kind === 'DESIGN_SPEC' ? data : null;
}

// ── design-spec ──────────────────────────────────────────────────────────

const productOf = (mode: GenerationMode): RenderProduct => (mode === 'ROOM' ? 'DS_ROOM_RENDER' : 'DS_MASTER_RENDER');
// Only a room that does not exist is final; an invalid or missing specification is a technical failure worth asking again.
const SPEC_TERMINAL = new Set(['ROOM_UNKNOWN']);
const specFailure = (code: string) => failure(SPEC_TERMINAL.has(code) ? 'TERMINAL' : 'RETRYABLE', code);

/** The job a request names (its idempotency key): a success first, then one in progress, then the latest. */
async function jobFor(ctx: Ctx, projectId: string, key: string): Promise<Row | null> {
  const { data } = await ctx.admin.from('ds_jobs').select('id, status, input, output, error, started_at, created_at')
    .eq('user_id', ctx.actorId).eq('project_id', projectId).eq('kind', 'AI_DESIGN').eq('input->>idempotencyKey', key)
    .neq('status', 'CANCELLED').order('created_at', { ascending: false }).limit(10);
  const rows: Row[] = data ?? [];
  return rows.find((r) => r.status === 'SUCCEEDED' && r.output?.kind === 'DESIGN_SPEC') ?? rows.find((r) => r.status === 'RUNNING') ?? rows[0] ?? null;
}

export async function handleDesignSpec(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await callerOf(req);
  if ('error' in res) return res.error;
  const ctx = res;
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.projectId)) || !UUID.test(String(body.versionId)) || !isGenerationMode(body.mode) || !validIdempotencyKey(body.idempotencyKey)) return json({ error: 'BAD_REQUEST' }, 400);
  const mode = body.mode as GenerationMode;
  const owned = await ownedVersion(ctx, body.projectId, body.versionId);
  if (!owned) return json({ error: 'NOT_FOUND' }, 404);

  // The same request is the same specification (no second paid call), wherever it got to.
  const prior = await jobFor(ctx, owned.project.id, String(body.idempotencyKey));
  if (prior?.status === 'SUCCEEDED') {
    const chain = prior.input?.then ? await advanceChain(ctx, owned, prior, String(body.idempotencyKey)) : null;
    return json({ state: 'DONE', ...answerOf(prior.id, prior.output), ...(chain ? { chain } : {}) });
  }
  if (prior?.status === 'RUNNING') {
    if (isFresh(prior.started_at)) return body.durable ? json({ state: 'RUNNING', jobId: prior.id }, 202) : json({ error: 'SPEC_RUNNING' }, 409);
    // Its instance was lost (the lease lapsed): exactly one request takes it over.
    const { data: won } = await ctx.admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', 'ABANDONED'), finished_at: new Date().toISOString() })
      .eq('id', prior.id).eq('status', 'RUNNING').select('id');
    if (!won?.length) return json({ state: 'RUNNING', jobId: prior.id }, 202);
  } else if (prior?.status === 'FAILED' && body.durable) {
    const f = readFailure(prior.error);
    if (f?.category === 'TERMINAL' || !body.retry) return json({ state: 'FAILED', reason: f?.code ?? 'UNKNOWN', retryable: f?.category !== 'TERMINAL' });
  }

  // The price the customer confirmed, checked now: the chain will spend it without asking again.
  let then: Row = null;
  if (body.then && typeof body.then === 'object') {
    const secret = await quoteSecret(env);
    if (!secret) return json({ error: 'QUOTE_NOT_CONFIGURED' }, 503);
    const q = await verifyQuote(body.then.quoteToken, secret);
    if (!q.ok) return json({ error: q.reason }, q.reason === 'QUOTE_EXPIRED' ? 410 : 400);
    if (!quoteMatches(q.claims, { userId: ctx.actorId, projectId: owned.project.id, versionId: owned.version.id, product: productOf(mode), views: 1 })) return json({ error: 'QUOTE_MISMATCH' }, 409);
    if ((await billingOn(ctx.admin)) !== q.claims.charged) return json({ error: 'QUOTE_STALE' }, 409);
    const name = typeof body.then.versionName === 'string' ? body.then.versionName.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : '';
    then = { claims: q.claims, versionName: name || 'Design' };
  }

  const src = await sourceOf(ctx, owned.version);
  if (!src) return json({ error: 'SOURCE_MISSING' }, 409);
  const evidence: PropertyEvidence = src.kind === 'PHOTO'
    ? photoEvidence(src.understanding, src.answers)
    : buildEvidence({ doc: src.plan.interpretation.doc, understanding: src.plan.interpretation.understanding ?? null, answers: src.answers, sourceKind: 'FLOOR_PLAN', ceilingM: src.ceilingM });
  const direction = directionFrom({ look: body.look, preferences: body.preferences });
  let approved: Row = null; let approvedSpec: DesignSpec | null = null;
  if (mode !== 'MASTER') {
    approved = await approvedRender(ctx, owned.project.id, body.parentRenderId);
    const parentJob = approved ? await specJob(ctx.admin, ctx.actorId, owned.project.id, approved.finish?.specJobId) : null;
    approvedSpec = parentJob ? validateSpec(parentJob.output.spec, evidence) : null;
  }
  const room = mode === 'ROOM' && typeof body.roomId === 'string'
    ? { id: body.roomId, name: evidence.rooms.find((r) => r.id === body.roomId)?.label ?? null } : null;
  // A variant's change; a photo room may also be asked in another style ("სხვა სტილი").
  const change = (mode === 'VARIANT' || (mode === 'ROOM' && evidence.sourceKind === 'PHOTO')) && body.change && typeof body.change === 'object' ? {
    style: typeof body.change.style === 'string' && /^[A-Z_]{2,20}$/.test(body.change.style) ? body.change.style : null,
    quality: typeof body.change.quality === 'string' && /^[A-Z_]{2,20}$/.test(body.change.quality) ? body.change.quality : null,
    note: typeof body.change.note === 'string' ? body.change.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 600) || null : null,
  } : null;
  const modeCtx: ModeContext = { mode, evidence, direction, room, change, approvedSpec };

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await ctx.admin.from('ds_jobs').select('id', { count: 'exact', head: true }).eq('user_id', ctx.actorId).eq('kind', 'AI_DESIGN').gte('created_at', since);
  if ((count ?? 0) >= SPECS_PER_HOUR) return json({ error: 'RATE_LIMITED' }, 429);
  if (!Deno.env.get('OPENAI_API_KEY')) return json({ error: 'DESIGN_UNAVAILABLE' }, 503);

  const { data: job } = await ctx.admin.from('ds_jobs').insert({
    user_id: ctx.actorId, project_id: owned.project.id, kind: 'AI_DESIGN', status: 'RUNNING', model: SPEC_MODEL, started_at: new Date().toISOString(),
    input: {
      idempotencyKey: body.idempotencyKey, mode, versionId: owned.version.id, parentRenderId: approved?.id ?? null, roomId: room?.id ?? null,
      sourceKind: evidence.sourceKind, generator: 'OPENAI_FIRST', ...(then ? { then } : {}),
    },
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;
  if (!jobId) return json({ error: 'JOB_FAILED' }, 500);
  // Two identical requests that raced: the earliest stays, the other stands down before spending anything.
  const { data: first } = await ctx.admin.from('ds_jobs').select('id').eq('user_id', ctx.actorId).eq('project_id', owned.project.id).eq('kind', 'AI_DESIGN')
    .eq('input->>idempotencyKey', body.idempotencyKey).eq('status', 'RUNNING').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
  if (first?.[0]?.id && first[0].id !== jobId) {
    await ctx.admin.from('ds_jobs').update({ status: 'CANCELLED', error: 'DUPLICATE', finished_at: new Date().toISOString() }).eq('id', jobId);
    return json({ state: 'RUNNING', jobId: first[0].id }, 202);
  }

  if (!body.durable) {
    // A page from before this change waits for the specification in the request, as it always did.
    const done = await writeSpec(ctx, { jobId, modeCtx, src, approved }).catch(() => false);
    const { data: after } = await ctx.admin.from('ds_jobs').select('status, output, error').eq('id', jobId).maybeSingle();
    if (done && after?.status === 'SUCCEEDED') return json(answerOf(jobId, after.output));
    return json({ error: readFailure(after?.error)?.code ?? 'SPEC_FAILED' }, 422);
  }
  const chainBody = { ...body, retry: false };
  await inBackground(async () => {
    try {
      const done = await writeSpec(ctx, { jobId, modeCtx, src, approved });
      // The customer confirmed the price: the next step starts in its own invocation.
      if (done && then) await kick(ctx.authorization, 'design-spec', chainBody);
    } catch (e) {
      await ctx.admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', `CRASHED:${String((e as Error)?.message ?? e).slice(0, 60)}`), finished_at: new Date().toISOString() })
        .eq('id', jobId).eq('status', 'RUNNING');
    }
  });
  return json({ state: 'RUNNING', jobId }, 202);
}

/** The specification itself (background): the source pictures, OpenAI, validation, the cost, the job. */
async function writeSpec(ctx: Ctx, a: { jobId: string; modeCtx: ModeContext; src: Source; approved: Row }): Promise<boolean> {
  const { jobId, modeCtx, src, approved } = a;
  const fail = async (code: string, extra: Row = {}) => {
    await ctx.admin.from('ds_jobs').update({ status: 'FAILED', error: specFailure(code), finished_at: new Date().toISOString(), ...extra }).eq('id', jobId).eq('status', 'RUNNING');
    return false;
  };
  // The picture this design is drawn over: the plan, or the photo of the room asked for (the hero room for the master).
  let sourceKey: string; let contextKeys: string[] = [];
  if (src.kind === 'PHOTO') {
    const roomId = modeCtx.mode === 'ROOM' ? modeCtx.room?.id : modeCtx.mode === 'VARIANT' ? approved?.finish?.roomId ?? null : null;
    const index = photoOfRoom(src.understanding, roomId) ?? 0;
    sourceKey = src.keys[index];
    contextKeys = src.keys.filter((_, i) => i !== index).slice(0, 5);
  } else {
    sourceKey = src.plan.object_key;
  }
  const [source, master, ...context] = await Promise.all([
    readImage(sourceKey, MAX_SOURCE_BYTES),
    approved ? readImage(approved.final_key, MAX_PICTURE_BYTES) : Promise.resolve(null),
    ...contextKeys.map((k) => readImage(k, MAX_SOURCE_BYTES)),
  ]);
  const problem = modeContextProblem(modeCtx, { source: !!source, master: !!master });
  if (problem) return fail(problem);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('DESIGN_UNAVAILABLE');

  const started = Date.now();
  let payload: Row = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(specRequest(SPEC_MODEL, modeCtx, {
        source: dataUrl(source!), master: master ? dataUrl(master) : null,
        context: context.filter(Boolean).map((img) => dataUrl(img!)),
      })),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  // OpenAI answered: the call is paid whatever the answer turns out to be, so it is metered before it is judged.
  const cost = payload
    ? await meterAiCall(ctx.admin, { userId: ctx.actorId, productCode: 'DS_AI_DESIGN', jobRef: jobId, model: SPEC_MODEL, startedAt: started }, payload, { step: 'design_spec', mode: modeCtx.mode, source: modeCtx.evidence.sourceKind })
    : null;
  const paid = cost ? { cost_cents: cost.aiCents } : {};
  const text = payload ? textOf(payload) : '';
  if (!text) return fail('SPEC_FAILED', paid);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('SPEC_BAD_SHAPE', paid); }
  const spec = validateSpec(raw, modeCtx.evidence);
  // Why it was refused stays with the job (codes only, never the customer's content), so a failure is diagnosable.
  if (!spec) return fail('SPEC_INVALID', { ...paid, output: { kind: 'SPEC_REJECTED', problems: specProblems(raw, modeCtx.evidence), model: SPEC_MODEL, ms: Date.now() - started } });
  const dna = dnaFromSpec(spec, modeCtx.direction.preferences, jobId);
  const output = {
    kind: 'DESIGN_SPEC', mode: modeCtx.mode, spec, evidence: modeCtx.evidence, direction: modeCtx.direction, room: modeCtx.room ?? null, change: modeCtx.change ?? null, dna, sourceKey,
    parentRenderId: approved?.id ?? null, approvedSpecJobId: approved?.finish?.specJobId ?? null, model: SPEC_MODEL, ms: Date.now() - started,
  };
  const { data: saved } = await ctx.admin.from('ds_jobs').update({ status: 'SUCCEEDED', output, cost_cents: cost?.aiCents ?? null, finished_at: new Date().toISOString() })
    .eq('id', jobId).eq('status', 'RUNNING').select('id');
  return !!saved?.length;
}

/**
 * The confirmed chain after the specification, idempotent at every step: the
 * design version (MASTER / VARIANT; a deterministic id, made once), then the
 * render (startGenerated: one row, one reservation). Asked again, it only
 * makes sure the picture keeps moving. A step that cannot go on is answered
 * as chain.error; the page then finishes it the ordinary way (quote → render).
 */
async function advanceChain(ctx: Ctx, owned: { project: Row; version: Row }, job: Row, idempotencyKey: string): Promise<Row> {
  const then = job.input.then; const mode = job.output.mode as GenerationMode;
  const chain: Row = { ...(job.output.chain ?? {}) };
  const keep = () => ctx.admin.from('ds_jobs').update({ output: { ...job.output, chain } }).eq('id', job.id);
  if (!chain.versionId) {
    if (mode === 'ROOM') chain.versionId = owned.version.id;
    else {
      const id = await uuidFrom(`ds-chain:${job.id}:version`);
      const { data: base } = await ctx.admin.from('ds_versions').select('state').eq('id', owned.version.id).maybeSingle();
      const style = job.output.direction?.preferences?.style;
      const { error } = await ctx.admin.from('ds_versions').upsert({
        id, project_id: owned.project.id, user_id: ctx.actorId, source_id: owned.version.source_id, parent_id: owned.version.id,
        name: then.versionName, origin: 'AI', job_id: job.id, state: base?.state ?? {}, style_tags: typeof style === 'string' ? [style] : [],
        change_summary: [{ kind: 'AI_DESIGN_SPEC', generator: 'OPENAI_FIRST', jobId: job.id, mode, look: job.output.direction?.look ?? null, conflicts: job.output.spec?.architecture?.conflicts?.length ?? 0 }],
        design_dna: job.output.dna,
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) return { ...chain, error: 'VERSION_NOT_RECORDED' };
      chain.versionId = id;
      await ctx.admin.from('ds_projects').update({ head_version_id: id }).eq('id', owned.project.id);
    }
    await keep();
  }
  const { data: version } = await ctx.admin.from('ds_versions').select('id, project_id, source_id, archived_at, design_dna').eq('id', chain.versionId).maybeSingle();
  if (!version || version.project_id !== owned.project.id) return { ...chain, error: 'VERSION_NOT_RECORDED' };
  const parent = mode === 'MASTER' ? null : await approvedRender(ctx, owned.project.id, job.output.parentRenderId);
  if (mode !== 'MASTER' && !parent) return { ...chain, error: 'MASTER_MISSING' };
  // Billing switched since the customer confirmed: they confirmed something else.
  if (!chain.renderId && (await billingOn(ctx.admin)) !== then.claims.charged) return { ...chain, error: 'QUOTE_STALE' };
  const started = await startGenerated(ctx, {
    projectId: owned.project.id, version, job, parent, mode, roomId: mode === 'ROOM' ? job.output.room?.id ?? null : null, claims: then.claims, idempotencyKey,
  });
  if ('error' in started) return { ...chain, error: started.error };
  if (!chain.renderId && started.render?.id) { chain.renderId = started.render.id; await keep(); }
  return { ...chain, render: started.render ?? null };
}

function answerOf(jobId: string, output: Row) {
  const spec = output.spec as DesignSpec;
  return {
    jobId, mode: output.mode, dna: output.dna as PropertyDesignDNA,
    summary: { style: spec.design.styleInterpretation, quality: spec.design.qualityInterpretation, palette: spec.design.palette, conflicts: spec.architecture.conflicts.length },
  };
}

// ── Billing (the render's reservation: quote → reserve → settle / release) ──

function grantOf(row: Row): ExecutionGrant {
  const b = row.billing ?? {}; const credits = Number(b.credits) || 0;
  return {
    ok: true, funding: 'PAYG', productCode: String(b.productCode), userId: String(row.user_id), planCode: (b.planCode ?? 'FREE'),
    qualityTier: 'STANDARD', reservationId: b.reservationId ?? null, allowanceId: null, reservedCredits: credits,
    authorizedMaxCredits: credits, estimateMinCredits: credits, estimateMaxCredits: credits, resultCeiling: null,
    providerBudgetCeilingCents: null, priorityLevel: 0, pricingVersion: Number(b.pricingVersion) || 1, partialBudget: false, minViableBudgetCredits: 0,
  };
}
const cents = (usd: number | null) => (usd == null ? undefined : Math.round(usd * 100 * 10000) / 10000);

/** Settle (READY) or release (FAILED), or record the unbilled COGS; unknown stays unknown. Stores the result. Never throws. */
async function closeGenerated(admin: Row, row: Row, outcome: 'SETTLE' | 'RELEASE', m: { aiUsd: number | null; aiKnown: boolean; provider: string | null; model: string | null; ms: number; detail: Record<string, unknown> }): Promise<Row> {
  const b = row.billing ?? {};
  const usage = {
    provider: (m.provider ?? 'openai').toLowerCase(), providerOperation: 'image_generation', model: m.model ?? undefined, durationMs: m.ms,
    aiCostCents: cents(m.aiUsd), pricingState: (m.aiKnown ? 'ESTIMATED' : 'UNPRICED') as 'ESTIMATED' | 'UNPRICED',
    metadata: { ...m.detail, ds_render_id: row.id, cost_known: m.aiKnown, image_model_usd: m.aiUsd, generator: 'OPENAI_FIRST' },
  };
  let next: Row = b;
  try {
    if (b.state === 'RESERVED' && b.reservationId) {
      const grant = grantOf(row);
      if (outcome === 'SETTLE') { const s = await settleExecution(admin, grant, usage, 'SUCCESS'); next = { ...b, state: 'SETTLED', chargedCredits: s.chargedCredits, releasedCredits: s.releasedCredits }; }
      else { await releaseExecution(admin, grant, row.error ?? 'GENERATION_FAILED', usage); next = { ...b, state: 'RELEASED' }; }
    } else if (b.state === 'NOT_CHARGED' && !b.metered) {
      const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: row.user_id });
      const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
      await recordUnbilledUsage(admin, { userId: row.user_id, productCode: String(b.productCode), planCode, jobRef: row.id }, usage);
      next = { ...b, metered: true };
    }
  } catch (e) { next = { ...b, billingError: String((e as Error)?.message ?? e).slice(0, 160) }; }
  await admin.from('ds_renders').update({ billing: next, updated_at: new Date().toISOString() }).eq('id', row.id);
  return next;
}

// ── The flow's I/O on this database, storage and OpenAI ─────────────────

function genIo(admin: Row): GenIo {
  const LEASE = 5 * 60_000;
  const scenes = new Map<string, SceneElement[]>();
  const specs = new Map<string, Row>();
  const specOf = async (row: Row) => {
    const id = row.timings?.ai?.specJobId;
    if (!specs.has(id)) {
      const { data } = await admin.from('ds_jobs').select('id, user_id, project_id, kind, status, output').eq('id', id).maybeSingle();
      specs.set(id, data && data.user_id === row.user_id && data.project_id === row.project_id && data.output?.kind === 'DESIGN_SPEC' ? data.output : null);
    }
    return specs.get(id);
  };
  return {
    now: () => Date.now(),
    async claim(row, from, patch) {
      const lapsed = new Date(Date.now() - LEASE).toISOString();
      const { data } = await admin.from('ds_renders').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', row.id).in('status', from).or(`lease_at.is.null,lease_at.lt.${lapsed},status.eq.QUEUED`).select('*');
      return data?.[0] ?? null;
    },
    async reload(row) { const { data } = await admin.from('ds_renders').select('*').eq('id', row.id).maybeSingle(); return data ?? null; },
    async save(row, lease, patch) {
      const { data } = await admin.from('ds_renders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id).eq('lease_at', lease).select('*');
      return data?.[0] ?? null;
    },
    async reference(row) {
      const out = await specOf(row);
      // The customer's own picture: always for photos (each room drawn over its own photo), the plan for a plan's master.
      // ...except a room seen only in a whole-home view: it is drawn from the approved design, like a plan's room.
      const fromDesign = out?.mode === 'ROOM' && !!out?.evidence && roomFromWholeHome({ evidence: out.evidence, room: out.room });
      const key = !fromDesign && (row.timings?.ai?.mode === 'MASTER' || out?.evidence?.sourceKind === 'PHOTO') ? out?.sourceKey : null;
      if (key) return readImage(key, MAX_SOURCE_BYTES);
      // The approved picture it continues from (recorded in finish; parent_id belongs to edits).
      const parentId = row.parent_id ?? row.finish?.parentRenderId ?? null;
      if (!parentId) return null;
      const { data: parent } = await admin.from('ds_renders').select('final_key, user_id, project_id').eq('id', parentId).maybeSingle();
      return parent?.final_key && parent.user_id === row.user_id && parent.project_id === row.project_id ? readImage(parent.final_key, MAX_PICTURE_BYTES) : null;
    },
    async instruction(row) {
      const out = await specOf(row);
      if (!out) return null;
      const spec = validateSpec(out.spec, out.evidence);
      let approvedSpec: DesignSpec | null = null;
      if (out.approvedSpecJobId) {
        const { data } = await admin.from('ds_jobs').select('output, user_id').eq('id', out.approvedSpecJobId).maybeSingle();
        approvedSpec = data?.user_id === row.user_id ? validateSpec(data?.output?.spec, out.evidence) : null;
      }
      return spec ? imageInstruction(spec, { mode: out.mode, evidence: out.evidence, direction: out.direction, room: out.room, change: out.change, approvedSpec }) : null;
    },
    size: () => SIZE,
    async image(input): Promise<ImageAnswer> {
      const provider = selectProvider(deps, null, await configuredModel(admin));
      if (!provider) return { ok: false, provider: 'OPENAI', model: '', error: 'PROVIDER_NOT_CONFIGURED', ms: 0, cost: { usd: null, basis: 'UNPRICED' } };
      const r = await provider.finish({ base: { bytes: input.base.bytes, mime: input.base.mime as 'image/png' }, prompt: input.prompt, size: input.size });
      return r.ok ? { ok: true, provider: r.provider, model: r.model, bytes: r.bytes, mime: r.mime, ms: r.ms, cost: r.cost } : { ok: false, provider: r.provider, model: r.model, error: r.error, ms: r.ms, cost: r.cost };
    },
    async putPicture(row, bytes, mime) {
      const key = await renderPictureKey(row, 'final', mime);
      return putObject(key, new Uint8Array(bytes), mime).then(() => key).catch(() => null);
    },
    async readPicture(key) { return (await readImage(key, MAX_PICTURE_BYTES))?.bytes ?? null; },
    async scene(row, picture) {
      const apiKey = Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) return null;
      const out = await specOf(row);
      const rooms = (out?.evidence?.rooms ?? []).map((r: Row) => ({ id: r.id, name: r.label ?? r.kind }));
      try {
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sceneRequest(SCENE_MODEL, dataUrl({ bytes: picture.bytes, mime: sniff(picture.bytes) ?? picture.mime }), rooms)),
        });
        const payload = r.ok ? await r.json() : null;
        const text = payload ? textOf(payload) : '';
        if (!text) return null;
        const elements = validateScene(JSON.parse(text));
        const priced = await priceAiCall(admin, SCENE_MODEL, tokensOf(payload));
        return { elements, usd: priced.aiCents == null ? null : priced.aiCents / 100 };
      } catch { return null; }
    },
    async storeScene(row, elements) {
      const { data } = await admin.from('ds_jobs').insert({
        user_id: row.user_id, project_id: row.project_id, kind: 'RENDER', status: 'SUCCEEDED', model: SCENE_MODEL,
        input: { renderId: row.id, generator: 'OPENAI_FIRST' }, output: { kind: 'SCENE_MAP', renderId: row.id, elements },
        started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      }).select('id').single();
      if (data?.id) scenes.set(data.id, elements);
      return data?.id ?? null;
    },
    async loadScene(jobId) {
      if (scenes.has(jobId)) return scenes.get(jobId)!;
      const { data } = await admin.from('ds_jobs').select('output').eq('id', jobId).maybeSingle();
      return data?.output?.kind === 'SCENE_MAP' ? validateScene(data.output) : null;
    },
    async rooms(row) { const out = await specOf(row); return new Set<string>((out?.evidence?.rooms ?? []).map((r: Row) => String(r.id))); },
    decode: (bytes) => decodeRgba(bytes),
    encodeIds: (ids) => encodePng(rgbaOf(ids), ids.width, ids.height),
    async putIds(row, png) {
      const key = accountKey({ accountId: row.user_id, category: 'design-studio-thumbnails', entityId: row.project_id, objectId: await uuidFrom(`ds-render:${row.id}:ai-ids`), contentType: 'image/png' });
      return putObject(key, new Uint8Array(png), 'image/png').then(() => key).catch(() => null);
    },
    close: (row, outcome, m) => closeGenerated(admin, row, outcome, m),
    async fail(row, code, lease) {
      let q = admin.from('ds_renders').update({ status: 'FAILED', error: code.slice(0, 300), lease_at: null, updated_at: new Date().toISOString() })
        .eq('id', row.id).in('status', ['QUOTED', 'QUEUED', 'RENDERING', 'FINISHING']);
      if (lease) q = q.eq('lease_at', lease);
      const { data } = await q.select('*');
      if (!data?.length) return false;
      const ai = data[0].timings?.ai ?? {};
      // Asked and unanswered, or answered at an unknown price: unknown, never zero.
      const known = !ai.imageRequestedAt || (ai.imageKnown === true);
      await closeGenerated(admin, { ...data[0], error: code }, 'RELEASE', {
        aiUsd: known ? (ai.imageUsd ?? 0) : null, aiKnown: known, provider: 'OPENAI', model: data[0].finish?.model ?? null, ms: 0, detail: { step: 'failed', code },
      });
      return true;
    },
  };
}

// ── render-generate ──────────────────────────────────────────────────────

const VIEW = (mode: GenerationMode, roomId: string | null, photo = false) => ({
  id: mode === 'ROOM' ? `room-${roomId}` : 'master', kind: mode === 'ROOM' ? 'ROOM' : 'MASTER', purpose: mode === 'ROOM' ? 'MAIN' : 'DOLLHOUSE', roomId,
  position: [0, 0, 0], target: [0, 0, 0], fovDeg: null, orthoScale: null, aspect: SIZE.width / SIZE.height, width: SIZE.width, height: SIZE.height,
  samples: 0, cut: null, hideCeilings: !photo && mode !== 'ROOM', objectMap: true, generator: 'OPENAI', mode, ...(photo ? { source: 'PHOTO' } : {}),
});

export async function handleRenderGenerate(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await callerOf(req);
  if ('error' in res) return res.error;
  const ctx = res;
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.projectId)) || !UUID.test(String(body.versionId)) || !isGenerationMode(body.mode) || !validIdempotencyKey(body.idempotencyKey)) return json({ error: 'BAD_REQUEST' }, 400);
  const mode = body.mode as GenerationMode;
  const owned = await ownedVersion(ctx, body.projectId, body.versionId);
  if (!owned) return json({ error: 'NOT_FOUND' }, 404);
  const job = await specJob(ctx.admin, ctx.actorId, owned.project.id, body.specJobId);
  if (!job || job.output.mode !== mode) return json({ error: 'SPEC_MISSING' }, 409);
  const roomId = mode === 'ROOM' ? job.output.room?.id ?? null : null;
  if (mode === 'ROOM' && !roomId) return json({ error: 'ROOM_UNKNOWN' }, 422);
  const parent = mode === 'MASTER' ? null : await approvedRender(ctx, owned.project.id, job.output.parentRenderId);
  if (mode !== 'MASTER' && !parent) return json({ error: 'MASTER_MISSING' }, 409);

  const product: RenderProduct = mode === 'ROOM' ? 'DS_ROOM_RENDER' : 'DS_MASTER_RENDER';
  const secret = await quoteSecret(env);
  if (!secret) return json({ error: 'QUOTE_NOT_CONFIGURED' }, 503);
  const q = await verifyQuote(body.quoteToken, secret);
  if (!q.ok) return json({ error: q.reason }, q.reason === 'QUOTE_EXPIRED' ? 410 : 400);
  const claims: QuoteClaims = q.claims;
  if (!quoteMatches(claims, { userId: ctx.actorId, projectId: owned.project.id, versionId: owned.version.id, product, views: 1 })) return json({ error: 'QUOTE_MISMATCH' }, 409);
  if ((await billingOn(ctx.admin)) !== claims.charged) return json({ error: 'QUOTE_STALE' }, 409);

  const out = await startGenerated(ctx, { projectId: owned.project.id, version: owned.version, job, parent, mode, roomId, claims, idempotencyKey: String(body.idempotencyKey) });
  return 'error' in out ? json({ error: out.error }, out.status) : json({ render: out.render, ...(out.reused ? { reused: true } : {}) });
}

/**
 * One generated render, started once: the same idempotency key is the same
 * row (never a second picture, never a second reservation). Money first, then
 * the row, then IMAGE → SCENE in the background, then the edit map in a fresh
 * invocation (kick), so the whole picture is made without the page.
 */
async function startGenerated(ctx: Ctx, a: {
  projectId: string; version: Row; job: Row; parent: Row; mode: GenerationMode; roomId: string | null; claims: QuoteClaims; idempotencyKey: string;
}): Promise<{ render: Row; reused?: boolean } | { error: string; status: number }> {
  const { mode, roomId, parent, job, claims } = a;
  const product = productOf(mode);
  const view = VIEW(mode, roomId, job.output?.evidence?.sourceKind === 'PHOTO');
  const key = await renderRowKey(ctx.actorId, a.idempotencyKey, 'START', view.id);
  const record = async () => (await ctx.admin.from('ds_renders').select(RECORD).eq('user_id', ctx.actorId).eq('idempotency_key', key).maybeSingle()).data ?? null;
  const drive = (row: Row) => inBackground(async () => {
    await driveUntilMap(genIo(ctx.admin), row);
    // The edit map takes a whole invocation's CPU: its own request, as the same customer.
    await kick(ctx.authorization, 'render-generate-step', { renderIds: [row.id] });
  });
  const { data: existing } = await ctx.admin.from('ds_renders').select('*').eq('user_id', ctx.actorId).eq('idempotency_key', key).maybeSingle();
  if (existing) {
    // The same Generate again (a double tap, a reload, the chain asked twice): the same row, never a second picture.
    const step = genNext(existing, Date.now()).action;
    if (step === 'IMAGE' || step === 'SCENE') await drive(existing);
    return { render: await record(), reused: true };
  }
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await ctx.admin.from('ds_renders').select('id', { count: 'exact', head: true }).eq('user_id', ctx.actorId).gte('created_at', since);
  if ((count ?? 0) + 1 > RENDERS_PER_HOUR) return { error: 'RATE_LIMITED', status: 429 };

  // Money first.
  const credits = RENDER_PRICING.creditsPerView[product];
  let billing: Row = { credits, reservationId: null, state: 'NOT_CHARGED', productCode: product };
  let grant: ExecutionGrant | null = null;
  if (claims.charged) {
    grant = await beginExecution(ctx.admin, {
      userId: ctx.actorId, productCode: product, idempotencyKey: reservationKey(key), jobRef: key,
      authorizedMaxCredits: credits, requireFullBudget: true, allowIncluded: false, metadata: { ds_project_id: a.projectId, ds_view_id: view.id, quoted_credits: credits, generator: 'OPENAI_FIRST' },
    });
    if (!grant.ok || !grant.reservationId) return { error: grant.reason ?? 'ERROR', status: grant.reason === 'INSUFFICIENT_CREDITS' || grant.reason === 'BELOW_MIN_VIABLE_BUDGET' ? 402 : 409 };
    billing = { credits, reservationId: grant.reservationId, state: 'RESERVED', productCode: product, planCode: grant.planCode, pricingVersion: grant.pricingVersion };
  }
  const dna = a.version.design_dna?.version === 'ds-dna-1' ? await sha256Hex(dnaKey(a.version.design_dna)) : null;
  const now = new Date().toISOString();
  const { error: insErr } = await ctx.admin.from('ds_renders').upsert({
    // parent_id is an EDIT's own column (the table holds kind = EDIT exactly when parent_id is set): a variant or a
    // room records the approved picture it continues from in finish.parentRenderId instead.
    project_id: a.projectId, user_id: ctx.actorId, version_id: a.version.id, kind: view.kind, view, status: 'QUEUED', parent_id: null,
    idempotency_key: key, billing, dna_key: dna, cost: [],
    quote: { product, views: 1, credits: claims.credits, charged: claims.charged, expiresAt: new Date(claims.exp).toISOString(), override: null },
    finish: { generator: 'OPENAI_FIRST', mode, specJobId: job.id, sourceKey: job.output.sourceKey, parentRenderId: parent?.id ?? null, roomId, look: job.output.direction?.look ?? null, provider: 'OPENAI', model: null, check: null },
    timings: { requestedAt: now, ai: { step: 'IMAGE', mode, specJobId: job.id } },
  }, { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true });
  if (insErr) {
    if (grant) await releaseExecution(ctx.admin, grant, 'RENDER_NOT_RECORDED').catch(() => null);
    return { error: 'RENDER_NOT_RECORDED', status: 500 };
  }
  const { data: row } = await ctx.admin.from('ds_renders').select('*').eq('user_id', ctx.actorId).eq('idempotency_key', key).maybeSingle();
  if (row) await drive(row);
  return { render: await record() };
}

// ── render-generate-step ─────────────────────────────────────────────────

export async function handleRenderGenerateStep(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await callerOf(req);
  if ('error' in res) return res.error;
  const ctx = res;
  let body: Row;
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const ids: string[] = Array.isArray(body.renderIds) ? [...new Set<string>(body.renderIds.map(String))] : [];
  if (!ids.length || ids.length > MAX_STATUS_IDS || ids.some((id) => !UUID.test(id))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: rows } = await ctx.caller.from('ds_renders').select('*').in('id', ids);
  const io = genIo(ctx.admin);
  // One map per poll: decoding a picture is the whole of an invocation's CPU budget.
  let maps = 1;
  const work: Array<() => Promise<unknown>> = [];
  for (const row of rows ?? []) {
    if (String(row.user_id) !== ctx.actorId) continue; // an administrator reads; only the owner's poll spends
    const next = genNext(row, Date.now());
    if (next.action === 'IMAGE' || next.action === 'SCENE' || next.action === 'FAIL') work.push(() => driveUntilMap(io, row));
    else if (next.action === 'MAP' && maps > 0) { maps -= 1; work.push(() => runMapStep(io, row)); }
  }
  if (work.length) await inBackground(async () => { for (const w of work) await w(); });
  const { data: out } = await ctx.caller.from('ds_renders').select(RECORD).in('id', ids);
  return json({ renders: out ?? [] });
}
