// HOMATCH DESIGN STUDIO — THE 3D WALKTHROUGH, OWNED BY THE SERVER.
//
//   POST …/design-studio-reconstruct/walkthrough-create  { designVersionId, renderId?, newRevision?, name? }
//        → 202 { walkthrough } — the same row for the same design (double click, reload, second tab)
//   POST …/design-studio-reconstruct/walkthrough-status  { walkthroughId } | { designVersionId }
//        → { walkthrough, history } — and moves it on when it is due
//   POST …/design-studio-reconstruct/walkthrough-retry   { walkthroughId } → a FAILED one, resumed from its saved work
//   POST …/design-studio-reconstruct/walkthrough-tick    (pg_cron, x-cron-token) → every due walkthrough moved on,
//        and factory jobs nobody watches any more settled against their provider
//   POST …/design-studio-reconstruct/walkthrough-geometry { designVersionId, floorplanId }
//        → a design revision on CORRECTED geometry: the same drawing read again (floorplanId, same image), built
//          by the same code the browser uses, created through the checking RPC; the design (its DNA, its Design
//          Specification job) carried onto it as a child of the approved version. Nothing earlier is changed.
//
// The lifecycle and its rules live in src/lib/designStudio/walkthrough/lifecycle.ts:
// every step is claimed with a compare-and-set on the row (its attempts
// counter), holds a bounded lease, counts its attempts, and ends by writing
// when the row is next due. The page is never needed: the request that
// creates a walkthrough works on it in the background, the reconciler picks
// it up every minute, and any status poll may move it on too.
//
//   PLAN     OpenAI scene plan (strict schema) → validateScenePlan (catalogue
//            matching, the customer's look) → buildWalkthrough (spatial
//            validation, circulation, finishes) → the walkable design saved as
//            its own version (the approved design is never touched)
//   SUBMIT   the walkable design compiled to a SceneBuildSpec → one factory
//            pass (submitPass: idempotent, the RunPod job id recorded the
//            moment RunPod accepts it)
//   POLL     the SAME RunPod job asked for its status
//   PROCESS  its outputs re-read, hashed and inspected (settlePass), the
//            factory-built pieces attached to the walkable design → READY
//
// Billing: none. Customer billing for Design Studio is off; this refuses
// rather than charge if it is ever switched on before a confirmation flow
// exists. Cost lines are internal COGS (OpenAI, GPU seconds, storage).

import { serviceClient } from '../_shared/billing.ts';
import { deleteObject } from '../_shared/objectStore.ts';
import { uuidFrom } from '../_shared/designStudio/renderKeys.ts';
import { normalizePreferences, type PlanAssetContext, type PlanContext, type PlanMaterialContext } from '../_shared/designStudio/aiPlan.ts';
import { offerFor } from '../_shared/designStudio/designIntent.ts';
import { sceneRequest, validateScenePlan, type SceneInput, type ValidatedScenePlan } from '../_shared/designStudio/walkthrough/scenePlan.ts';
import { validateSceneSpec, SpecError, type SceneBuildSpec } from '../_shared/designStudio/hybrid/sceneSpec.ts';
import { callerOf, cancelProviderJob, factoryConfig, FACTORY_STAGES, JOB_FIELDS, providerStatus, settlePass, submitPass } from './factory.ts';
import { failure, inBackground, isFresh, kick, readFailure } from './durable.ts';
import { getObject } from '../_shared/objectStore.ts';
import { SCHEMA as RECON_SCHEMA, SYSTEM as RECON_SYSTEM, validateReconstruction } from '../_shared/designStudio/reconstructRead.ts';
import { inferredSpace, mostlyInferred, WALK_SPACE_BRIEF } from '../../../src/lib/designStudio/walkthrough/inferredSpace.ts';
import { meterAiCall } from './metering.ts';
import { assetFromRow, materialFromRow, type CatalogAsset, type CatalogMaterial } from '../../../src/lib/designStudio/catalog.ts';
import { normalizeDesignState, type DesignState } from '../../../src/lib/designStudio/designState.ts';
import { buildSpaceModel, type SpaceModel } from '../../../src/lib/designStudio/space.ts';
import { buildCanonical } from '../../../src/lib/designStudio/scale.ts';
import { compileSceneSpec } from '../../../src/lib/designStudio/hybrid/compileSpec.ts';
import { buildWalkthrough, roomSketches } from '../../../src/lib/designStudio/walkthrough/build.ts';
import {
  decidePoll, identityText, isTerminal, nextStep, progressOf, PROVIDER_DEADLINE_MS, readProviderStatus, retryableFailure,
  type WalkRow,
} from '../../../src/lib/designStudio/walkthrough/lifecycle.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = Deno.env.get('OPENAI_DS_WALK_MODEL') || Deno.env.get('OPENAI_DS_DESIGN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
/** New walkthroughs one account may start per hour (a runaway client, not a price). */
const HOURLY = 6;
/** The model that reads a photo design's pictures into a walkable space (the reconstruction reader's). */
const SPACE_MODEL = Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_DS_FLOORPLAN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
/** Readings of one project's space, at most (each a paid call): a failure is retried automatically up to this. */
const SPACE_ATTEMPTS = 3;
/** Manual retries of one walkthrough after it failed (each resumes from saved work). */
const MANUAL_RETRIES = 3;
/** R2 storage, per GB-month (an estimate for the internal cost line, never a charge). */
const STORAGE_USD_PER_GB_MONTH = 0.015;
/** A factory job nobody has looked at for this long is reconciled against its provider by the tick. */
const ORPHAN_AFTER_MS = 40 * 60_000;
/** …and one the provider still runs after this long is cancelled there. */
const ORPHAN_CANCEL_AFTER_MS = 2 * 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function textOf(payload: Row): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const o of payload?.output ?? []) for (const c of o?.content ?? []) if (typeof c?.text === 'string') return c.text;
  return '';
}
async function billingOn(admin: Row): Promise<boolean> {
  const { data } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  return data === true;
}

/** What the customer's page sees of a walkthrough (no plan internals, no provider ids, no keys). */
function publicOf(row: Row) {
  const code = typeof row.error === 'string' ? row.error : null;
  return {
    id: row.id, designVersionId: row.design_version_id, revision: row.revision, state: row.state, progress: progressOf(row.state),
    stage: row.stage ?? null, walkVersionId: row.state === 'READY' ? row.walk_version_id : null, error: code,
    retryable: row.state === 'FAILED' && retryableFailure(code) && (row.timings?.manualRetries ?? 0) < MANUAL_RETRIES,
    createdAt: row.created_at, readyAt: row.ready_at ?? null,
    // The space was reconstructed from the pictures (no measured plan): the Result says so, quietly.
    inferred: row.timings?.inferred === true,
    summary: row.state === 'READY' && row.plan_report?.build?.counts ? { pieces: (row.plan_report.build.counts.planned ?? 0) + (row.plan_report.build.counts.corrected ?? 0) + (row.plan_report.build.counts.placed ?? 0), rooms: row.plan_report.rooms ?? null } : null,
  };
}

// ── Lineage: a design and its revisions on corrected geometry ────────────────

const CORRECTED = 'GEOMETRY_CORRECTED';
/** A photo design carried onto the project's measured plan, for its walkthrough (designOnPlan). */
const ON_PLAN = 'DESIGN_ON_PLAN';
const isCorrection = (v: Row) => Array.isArray(v?.change_summary) && v.change_summary.some((c: Row) => c?.kind === CORRECTED || c?.kind === ON_PLAN);

/**
 * A design made from photos, on the newest measured plan of the same project: its child version on that plan's
 * geometry with the same DNA and Design Specification job (a deterministic id: asked again, the same version; the
 * photo design itself is never touched). Null when the project has no buildable plan.
 */
async function designOnPlan(admin: Row, version: Row, projectId: string): Promise<{ version: Row; source: Row } | null> {
  const { data: plans } = await admin.from('ds_spatial_sources').select('id, kind, status, canonical, provenance, created_at').eq('project_id', projectId)
    .eq('kind', 'FLOORPLAN_SCENE').eq('status', 'READY').order('created_at', { ascending: false }).limit(5);
  // A measured plan always wins over a space reconstructed from pictures.
  const plan = (plans ?? []).filter((p: Row) => p.canonical?.scene?.floors?.length && Array.isArray(p.canonical?.scene?.walls))
    .sort((a: Row, b: Row) => Number(a.provenance?.inferred === true) - Number(b.provenance?.inferred === true))[0];
  if (!plan) return null;
  const { data: original } = await admin.from('ds_versions').select('state').eq('source_id', plan.id).eq('origin', 'ORIGINAL').limit(1).maybeSingle();
  const id = await uuidFrom(`ds-walk-photo-design:${version.id}:${plan.id}`);
  const { error } = await admin.from('ds_versions').upsert({
    id, project_id: projectId, user_id: version.user_id, source_id: plan.id, parent_id: version.id,
    name: version.name ?? 'Design', origin: 'AI', job_id: version.job_id, state: original?.state ?? {}, style_tags: version.style_tags ?? [],
    change_summary: [{ kind: ON_PLAN, fromSourceId: version.source_id, toSourceId: plan.id }],
    design_dna: version.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return null;
  const { data: made } = await admin.from('ds_versions').select('id, project_id, user_id, source_id, revision, job_id, design_dna, archived_at, parent_id, name, style_tags').eq('id', id).maybeSingle();
  return made ? { version: made, source: plan } : null;
}

/**
 * A photo design with no measured plan: its space, reconstructed from the pictures the project already has (the
 * customer's own, isolated from a screenshot where that was done, then the generated designs), by the
 * reconstruction reader, completed, built, walked and repaired (inferredSpace.ts) into an ESTIMATED floor-plan
 * source that only this walkthrough uses. One reading per photo source (the architecture's evidence): asked again,
 * the same job; a lost instance is taken over; a failure is retried automatically, at most SPACE_ATTEMPTS readings.
 * Nothing is written to the project's active source, its plans, or any property data.
 */
async function reconstructSpace(admin: Row, a: { actorId: string; authorization: string; project: Row; version: Row; photoSource: Row; renderId: string | null; body: Row }):
  Promise<{ state: 'READY' } | { state: 'RUNNING' } | { state: 'FAILED'; code: string }> {
  const key = await sha256Hex(`walk-space:v1:${a.photoSource.id}`);
  const { data: jobs } = await admin.from('ds_jobs').select('id, status, output, error, started_at, created_at').eq('user_id', a.actorId).eq('project_id', a.project.id)
    .eq('kind', 'RECONSTRUCT').eq('input->>purpose', 'WALK_SPACE').eq('input->>key', key).order('created_at', { ascending: false }).limit(10);
  const rows: Row[] = jobs ?? [];
  if (rows.some((j) => j.status === 'SUCCEEDED' && j.output?.sourceId)) return { state: 'READY' };
  const running = rows.find((j) => j.status === 'RUNNING');
  if (running && isFresh(running.started_at)) return { state: 'RUNNING' };
  if (running) {
    // Its instance was lost: exactly one request takes it over.
    const { data: won } = await admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', 'ABANDONED'), finished_at: new Date().toISOString() })
      .eq('id', running.id).eq('status', 'RUNNING').select('id');
    if (!won?.length) return { state: 'RUNNING' };
  }
  const failed = rows.filter((j) => j.status === 'FAILED');
  const terminal = failed.find((j) => readFailure(j.error)?.category === 'TERMINAL');
  if (terminal) return { state: 'FAILED', code: readFailure(terminal.error)?.code ?? 'SPACE_UNAVAILABLE' };
  if (failed.length + (running ? 1 : 0) >= SPACE_ATTEMPTS) return { state: 'FAILED', code: readFailure(failed[0]?.error)?.code ?? 'SPACE_UNAVAILABLE' };
  if (!Deno.env.get('OPENAI_API_KEY')) return { state: 'FAILED', code: 'SPACE_UNAVAILABLE' };

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: a.actorId, project_id: a.project.id, kind: 'RECONSTRUCT', status: 'RUNNING', model: SPACE_MODEL, started_at: new Date().toISOString(),
    input: { purpose: 'WALK_SPACE', key, photoSourceId: a.photoSource.id, designVersionId: a.version.id, generator: 'OPENAI_FIRST' },
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;
  if (!jobId) return { state: 'FAILED', code: 'JOB_FAILED' };
  // Two taps that raced: the earliest job stays, the other stands down before spending anything.
  const { data: first } = await admin.from('ds_jobs').select('id').eq('user_id', a.actorId).eq('project_id', a.project.id).eq('kind', 'RECONSTRUCT')
    .eq('input->>key', key).eq('status', 'RUNNING').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
  if (first?.[0]?.id && first[0].id !== jobId) {
    await admin.from('ds_jobs').update({ status: 'CANCELLED', error: 'DUPLICATE', finished_at: new Date().toISOString() }).eq('id', jobId);
    return { state: 'RUNNING' };
  }
  await inBackground('walkthrough-space', async () => {
    const done = await readSpace(admin, { ...a, jobId }).catch(async (e) => {
      await admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', `CRASHED:${String((e as Error)?.message ?? e).slice(0, 60)}`), finished_at: new Date().toISOString() })
        .eq('id', jobId).eq('status', 'RUNNING');
      return false;
    });
    // The space exists: the walkthrough starts in its own invocation, with or without the page.
    if (done) await kick(a.authorization, 'walkthrough-create', { designVersionId: a.body.designVersionId, renderId: a.renderId, name: a.body.name ?? null });
  });
  return { state: 'RUNNING' };
}

const MAX_SPACE_BYTES = 12 * 1024 * 1024;
const MAX_SPACE_TOTAL = 36 * 1024 * 1024;
function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}
function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The reading itself (background): the pictures, the reader, the completion, the ESTIMATED source. */
async function readSpace(admin: Row, a: { actorId: string; project: Row; version: Row; photoSource: Row; renderId: string | null; jobId: string }): Promise<boolean> {
  const fail = async (code: string, terminal = false, extra: Row = {}) => {
    await admin.from('ds_jobs').update({ status: 'FAILED', error: failure(terminal ? 'TERMINAL' : 'RETRYABLE', code), finished_at: new Date().toISOString(), ...extra }).eq('id', a.jobId).eq('status', 'RUNNING');
    return false;
  };
  // The customer's own pictures first (the architecture; a screenshot's isolated picture where one was made), hero first.
  const u = a.photoSource.canonical?.understanding ?? null;
  const ids: string[] = Array.isArray(a.photoSource.provenance?.referenceIds) ? a.photoSource.provenance.referenceIds.map(String) : [];
  const { data: refs } = await admin.from('ds_floorplans').select('id, object_key, user_id, project_id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const byId = new Map((refs ?? []).filter((r: Row) => r.project_id === a.project.id).map((r: Row) => [r.id, r.object_key]));
  const hero = u?.rooms?.find((r: Row) => r.id === u?.heroRoomId)?.primaryPhoto ?? 0;
  const sourceKeys = ids.map((id, i) => {
    const original = byId.get(id) as string | undefined;
    const norm = u?.photos?.[i]?.normalizedKey;
    const folder = original ? original.slice(0, original.lastIndexOf('/') + 1) : '';
    return typeof norm === 'string' && folder && norm.startsWith(folder) && !norm.includes('..') ? norm : original;
  }).map((k, i) => ({ k, i })).filter((x): x is { k: string; i: number } => !!x.k).sort((x, y) => Number(y.i === hero) - Number(x.i === hero)).map((x) => x.k).slice(0, 4);
  // Then the generated designs of this home: the one shown first, then the others and its rooms.
  const { data: renders } = await admin.from('ds_renders').select('id, kind, status, final_key, user_id, created_at').eq('project_id', a.project.id).eq('user_id', a.actorId)
    .eq('status', 'READY').not('final_key', 'is', null).order('created_at', { ascending: false }).limit(12);
  const designKeys = (renders ?? []).sort((x: Row, y: Row) => Number(y.id === a.renderId) - Number(x.id === a.renderId)).map((r: Row) => String(r.final_key)).slice(0, 3);
  const images: Array<{ url: string; source: boolean }> = [];
  let total = 0;
  for (const [i, key] of [...sourceKeys, ...designKeys].entries()) {
    const res = await getObject(key).catch(() => null);
    if (!res?.ok) { await res?.arrayBuffer().catch(() => null); continue; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || bytes.length > MAX_SPACE_BYTES || total + bytes.length > MAX_SPACE_TOTAL) continue;
    total += bytes.length;
    images.push({ url: `data:${type};base64,${b64(bytes)}`, source: i < sourceKeys.length });
  }
  // Nothing at all to read the home from: the only honest failure.
  if (!images.length) return fail('NO_PICTURES', true);
  const nSource = images.filter((x) => x.source).length;
  const rooms = (u?.rooms ?? []).map((r: Row) => `${r.label || r.kind} (${r.kind})${r.fixed?.length ? `: ${r.fixed.slice(0, 6).join('; ')}` : ''}`).slice(0, 12);
  const content: Row[] = [{
    type: 'input_text',
    text: `Here are ${images.length} pictures of the SAME home, numbered 0 to ${images.length - 1}. Pictures 0 to ${Math.max(0, nSource - 1)} are the customer's own source pictures${nSource < images.length ? `; pictures ${nSource} to ${images.length - 1} are generated designs of it` : ''}. Merge them into one home and rebuild it as structured data in the plan frame. Write labels in English; keep every code exactly as listed.\n\n${WALK_SPACE_BRIEF}${rooms.length ? `\n\nHOMATCH already read these rooms from the source pictures:\n- ${rooms.join('\n- ')}` : ''}`,
  }];
  images.forEach((img, i) => {
    content.push({ type: 'input_text', text: `Picture ${i} (${img.source ? 'source' : 'generated design'}):` });
    content.push({ type: 'input_image', image_url: img.url });
  });
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('SPACE_UNAVAILABLE');
  const started = Date.now();
  let payload: Row = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SPACE_MODEL, input: [{ role: 'system', content: RECON_SYSTEM }, { role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'ds_reconstruction', strict: false, schema: RECON_SCHEMA } }, reasoning: { effort: 'high' },
      }),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  // Answered: paid whatever the answer turns out to be, so metered before it is judged.
  const cost = payload ? await meterAiCall(admin, { userId: a.actorId, productCode: 'DS_RECONSTRUCT', jobRef: a.jobId, model: SPACE_MODEL, startedAt: started }, payload,
    { purpose: 'WALK_SPACE', pictures: images.length, source_pictures: nSource, generator: 'OPENAI_FIRST' }) : null;
  const paid = cost ? { cost_cents: cost.aiCents } : {};
  const text = payload ? textOf(payload) : '';
  if (!text) return fail('SPACE_READING_FAILED', false, paid);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('SPACE_BAD_SHAPE', false, paid); }
  const { recon } = validateReconstruction(raw, images.length);
  const space = inferredSpace(recon, `walk-space:${a.photoSource.id}`);
  if ('problems' in space) return fail(`SPACE_NOT_BUILDABLE:${space.problems.slice(0, 3).join(',')}`, false, paid);

  // An ESTIMATED floor-plan source of this project, marked inferred, used only by the walkthrough.
  const { data: made, error } = await admin.from('ds_spatial_sources').insert({
    project_id: a.project.id, user_id: a.actorId, kind: 'FLOORPLAN_SCENE', status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED',
    canonical: space.canonical, calibration: { metresPerPx: space.canonical.metresPerPx, inferred: true },
    generator_version: space.canonical.generatorVersion,
    provenance: {
      origin: 'INFERRED_FOR_WALKTHROUGH', inferred: true, verified: false, fromSourceId: a.photoSource.id, designVersionId: a.version.id, jobId: a.jobId,
      repairs: space.repairs, spawn: space.spawn, reachable: space.reachable, unreachable: space.unreachable, basis: space.basis, generator: 'OPENAI_FIRST',
    },
  }).select('id').single();
  if (error || !made?.id) return fail('SOURCE_NOT_RECORDED', false, paid);
  await admin.from('ds_jobs').update({
    status: 'SUCCEEDED', finished_at: new Date().toISOString(), ...paid,
    output: { kind: 'WALK_SPACE', sourceId: made.id, rooms: space.reachable.length + space.unreachable.length, repairs: space.repairs.length, basis: space.basis, mostlyInferred: mostlyInferred(space.basis) },
  }).eq('id', a.jobId).eq('status', 'RUNNING');
  return true;
}

/** The design and every geometry correction of it (newest first): one walkthrough history across them. */
async function lineageOf(admin: Row, designVersionId: string): Promise<string[]> {
  const { data: self } = await admin.from('ds_versions').select('id, parent_id, change_summary').eq('id', designVersionId).maybeSingle();
  const root = self && isCorrection(self) && self.parent_id ? self.parent_id : designVersionId;
  const { data: kids } = await admin.from('ds_versions').select('id, change_summary, created_at').eq('parent_id', root).order('created_at', { ascending: false });
  return [...(kids ?? []).filter(isCorrection).map((k: Row) => k.id), root];
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * A design revision on corrected geometry. The same drawing read again (a new
 * plan row of the same image, re-fused by the current reader at no model cost)
 * becomes a new spatial source through the checking RPC, built by the same code
 * the browser builds with; the approved design is carried onto it — same DNA,
 * same Design Specification job — as its child. The approved design, its
 * picture, its walkthroughs and the project's active geometry are not touched.
 */
export async function handleWalkthroughGeometry(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  let body: { designVersionId?: string; floorplanId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.designVersionId)) || !UUID.test(String(body.floorplanId))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: version } = await caller.from('ds_versions').select('id, project_id, user_id, source_id, name, state, style_tags, job_id, design_dna, archived_at, change_summary').eq('id', body.designVersionId).maybeSingle();
  if (!version || version.archived_at || String(version.user_id) !== actorId || isCorrection(version)) return json({ error: 'NOT_FOUND' }, 404);
  const { data: source } = await admin.from('ds_spatial_sources').select('id, kind, floorplan_id, canonical, geometry_state').eq('id', version.source_id).maybeSingle();
  if (!source || source.kind !== 'FLOORPLAN_SCENE' || !source.floorplan_id) return json({ error: 'WALKTHROUGH_NEEDS_FLOOR_PLAN' }, 409);
  const { data: plans } = await admin.from('ds_floorplans').select('id, project_id, user_id, status, sha256, interpretation, corrections').in('id', [source.floorplan_id, body.floorplanId]);
  const before = (plans ?? []).find((f: Row) => f.id === source.floorplan_id);
  const again = (plans ?? []).find((f: Row) => f.id === body.floorplanId);
  // The same drawing (by its bytes), read again, in this project, by this customer.
  if (!before || !again || again.id === before.id || again.project_id !== version.project_id || String(again.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (again.status !== 'INTERPRETED' || !again.interpretation?.doc) return json({ error: 'FLOORPLAN_NOT_INTERPRETED' }, 409);
  if (!before.sha256 || before.sha256 !== again.sha256) return json({ error: 'NOT_THE_SAME_DRAWING' }, 409);

  // Built exactly as the browser builds it (scale.buildCanonical): the customer's decisions on that drawing, its ceiling.
  const last = Array.isArray(before.corrections) ? before.corrections[before.corrections.length - 1] : null;
  const decisions = last?.decisions && Array.isArray(last.decisions.rejected) ? last.decisions : { rejected: [], roomKinds: {} };
  const constraints = again.interpretation.understanding?.constraints ?? null;
  const metresPerPx = Number(constraints?.metresPerPx ?? again.interpretation.doc.detectedScale);
  if (!Number.isFinite(metresPerPx) || metresPerPx <= 0) return json({ error: 'NO_SCALE' }, 409);
  const old = source.canonical ?? {};
  const ceilingM = Number(old.scene?.ceilingHeightM) || 2.7;
  const built = buildCanonical(again.interpretation.doc, decisions, { metresPerPx, geometryState: 'ESTIMATED', uncertainty: constraints?.uncertainty ?? null, conflict: false, implied: [] },
    ceilingM, old.ceilingSource === 'CUSTOMER' || old.ceilingSource === 'DRAWING' ? old.ceilingSource : 'TYPICAL');
  if (!built.ok) return json({ error: 'PLAN_NOT_BUILDABLE', problems: built.problems }, 409);

  // One corrected source per re-read (asked again, the same one).
  const { data: existing } = await admin.from('ds_spatial_sources').select('id').eq('floorplan_id', again.id).eq('status', 'READY').order('created_at', { ascending: false }).limit(1).maybeSingle();
  let sourceId: string | null = existing?.id ?? null;
  if (!sourceId) {
    const { data: created, error } = await caller.rpc('ds_create_floorplan_source', {
      p_floorplan_id: again.id, p_canonical: built.canonical, p_geometry_state: 'ESTIMATED',
      p_calibration: { anchors: [], metresPerPx: built.canonical.metresPerPx, uncertainty: built.canonical.scaleUncertainty }, p_generator_version: built.canonical.generatorVersion,
    });
    if (error || !created) return json({ error: 'SOURCE_NOT_RECORDED' }, 500);
    sourceId = String(created);
  }
  const id = await uuidFrom(`ds-walk-geometry:${version.id}:${sourceId}`);
  const { error: verr } = await admin.from('ds_versions').upsert({
    id, project_id: version.project_id, user_id: version.user_id, source_id: sourceId, parent_id: version.id,
    name: version.name, origin: 'AI', job_id: version.job_id, state: version.state, style_tags: version.style_tags ?? [],
    change_summary: [{ kind: CORRECTED, fromSourceId: source.id, toSourceId: sourceId, floorplanId: again.id, readFrom: again.interpretation.cachedFrom ?? null }],
    design_dna: version.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (verr) return json({ error: 'VERSION_NOT_RECORDED' }, 500);
  return json({ sourceId, designVersionId: id, fromSourceId: source.id, floorplanId: again.id });
}

export async function handleWalkthroughCreate(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  let body: { designVersionId?: string; renderId?: string | null; newRevision?: boolean; name?: string; reusePlanFrom?: string | null };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.designVersionId))) return json({ error: 'BAD_REQUEST' }, 400);
  if (body.renderId != null && !UUID.test(String(body.renderId))) return json({ error: 'BAD_REQUEST' }, 400);
  if (body.reusePlanFrom != null && !UUID.test(String(body.reusePlanFrom))) return json({ error: 'BAD_REQUEST' }, 400);

  // The design, as the caller may see it; only its owner builds a walkthrough of it. A design with a revision
  // on corrected geometry is walked on the newest one (the drawing as it really is).
  let lineage = await lineageOf(admin, String(body.designVersionId));
  const target = lineage[0] ?? body.designVersionId;
  let { data: version } = await caller.from('ds_versions').select('id, project_id, user_id, source_id, revision, job_id, design_dna, archived_at, parent_id, name, style_tags').eq('id', target).maybeSingle();
  if (!version || version.archived_at || String(version.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  const { data: project } = await admin.from('ds_projects').select('id, user_id, deleting_at').eq('id', version.project_id).maybeSingle();
  if (!project || project.deleting_at || String(project.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  let { data: source } = await admin.from('ds_spatial_sources').select('id, kind, status, canonical, provenance').eq('id', version.source_id).maybeSingle();
  // A design made from photos: walked on the measured plan this project already has (nothing uploaded again),
  // carrying the design — its DNA and Design Specification — onto that geometry. Without one, its space is
  // reconstructed from the pictures the project already has (reconstructSpace): never a request to upload again.
  if (source?.kind === 'PHOTO_SET') {
    let onPlan = await designOnPlan(admin, version, project.id);
    if (!onPlan) {
      if (await billingOn(admin)) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);
      const { data: photo } = await admin.from('ds_spatial_sources').select('id, kind, canonical, provenance').eq('id', version.source_id).maybeSingle();
      const space = await reconstructSpace(admin, { actorId, authorization: req.headers.get('Authorization') ?? '', project, version, photoSource: photo, renderId: body.renderId ?? null, body });
      if (space.state === 'RUNNING') return json({ walkthrough: null, reconstructing: true }, 202);
      if (space.state === 'FAILED') return json({ error: 'SPACE_UNAVAILABLE', reason: space.code }, 409);
      onPlan = await designOnPlan(admin, version, project.id);
      if (!onPlan) return json({ walkthrough: null, reconstructing: true }, 202);
    }
    ({ version, source } = onPlan);
    lineage = await lineageOf(admin, version.id);
  }
  // A walkthrough walks a floor plan's measured rooms.
  if (!source || source.kind !== 'FLOORPLAN_SCENE' || !source.canonical?.scene?.floors?.length) return json({ error: 'WALKTHROUGH_NEEDS_FLOOR_PLAN', missing: ['WALLS', 'DOORS', 'ROOM_SIZES'] }, 409);
  if (await billingOn(admin)) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);
  if (!factoryConfig()) return json({ error: 'FACTORY_NOT_CONFIGURED' }, 503);

  // A plan already made for this design (an earlier walkthrough of it): reused as it is, never asked for again.
  let reuse: Row = null;
  if (body.reusePlanFrom) {
    const { data: w } = await caller.from('ds_walkthroughs').select('id, project_id, design_version_id, scene_plan').eq('id', body.reusePlanFrom).maybeSingle();
    if (!w || w.project_id !== version.project_id || !w.scene_plan || !lineage.includes(w.design_version_id)) return json({ error: 'PLAN_NOT_REUSABLE' }, 409);
    reuse = w;
  }
  // Identity: this design at this state, at the walkthrough revision asked for (counted across its geometry revisions).
  const { data: latestOwn } = await admin.from('ds_walkthroughs').select('*').eq('design_version_id', version.id).order('revision', { ascending: false }).limit(1).maybeSingle();
  const { data: latestAny } = await admin.from('ds_walkthroughs').select('*').in('design_version_id', lineage).order('revision', { ascending: false }).limit(1).maybeSingle();
  const latest = latestOwn ?? (latestAny ? { ...latestAny, revision: latestAny.revision } : null);
  if (latest && body.newRevision && !isTerminal(latest.state)) return json({ walkthrough: publicOf(latest), created: false }, 202);
  const keyOf = (revision: number) => sha256Hex(identityText({ projectId: project.id, designVersionId: version.id, designRevision: Number(version.revision) || 0, revision }));
  // The latest walkthrough is answered again for the same design state; a changed design (or an explicit request) gets the next one.
  let revision = body.newRevision || (!latestOwn && latestAny) ? (latestAny?.revision ?? 0) + 1 : (latestOwn?.revision ?? 1);
  let key = await keyOf(revision);
  let { data: same } = await admin.from('ds_walkthroughs').select('*').eq('project_id', project.id).eq('idempotency_key', key).maybeSingle();
  if (!same && latestOwn && !body.newRevision) {
    revision = (latestAny?.revision ?? latestOwn.revision) + 1;
    key = await keyOf(revision);
    ({ data: same } = await admin.from('ds_walkthroughs').select('*').eq('project_id', project.id).eq('idempotency_key', key).maybeSingle());
  }
  if (same) {
    if (!isTerminal(same.state)) await inBackground('walkthrough-create', () => drive(admin, same.id, 30_000, { singlePass: true }));
    return json({ walkthrough: publicOf(same), created: false }, 202);
  }
  const since = iso(Date.now() - 3600_000);
  const { count } = await admin.from('ds_walkthroughs').select('id', { count: 'exact', head: true }).eq('user_id', actorId).gte('created_at', since);
  if ((count ?? 0) >= HOURLY) return json({ error: 'RATE_LIMITED' }, 429);

  const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : '';
  const specJobId = typeof version.design_dna?.sourceJobId === 'string' && UUID.test(version.design_dna.sourceJobId) ? version.design_dna.sourceJobId : version.job_id ?? null;
  // ON CONFLICT DO NOTHING: two requests racing for the same key end on one row.
  await admin.from('ds_walkthroughs').upsert({
    project_id: project.id, user_id: actorId, design_version_id: version.id, source_id: source.id, spec_job_id: specJobId,
    render_id: body.renderId ?? null, revision, idempotency_key: key, state: 'QUEUED',
    timings: {
      requestedAt: iso(Date.now()), name: name || null, designRevision: Number(version.revision) || 0, ...(reuse ? { reusePlanFrom: reuse.id } : {}),
      // Walked on a space reconstructed from the pictures (never a measured plan): kept, so the Result can say so.
      ...(source.provenance?.inferred === true ? { inferred: true } : {}),
    },
  }, { onConflict: 'project_id,idempotency_key', ignoreDuplicates: true });
  const { data: row } = await admin.from('ds_walkthroughs').select('*').eq('project_id', project.id).eq('idempotency_key', key).maybeSingle();
  if (!row) return json({ error: 'NOT_RECORDED' }, 500);
  await inBackground('walkthrough-create', () => drive(admin, row.id, 100_000));
  return json({ walkthrough: publicOf(row), created: true }, 202);
}

export async function handleWalkthroughStatus(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin } = ctx;
  let body: { walkthroughId?: string; designVersionId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  // RLS decides who may see it.
  let row: Row = null;
  if (UUID.test(String(body.walkthroughId))) row = (await caller.from('ds_walkthroughs').select('*').eq('id', body.walkthroughId).maybeSingle()).data;
  else if (UUID.test(String(body.designVersionId))) {
    const lineage = await lineageOf(admin, String(body.designVersionId));
    row = (await caller.from('ds_walkthroughs').select('*').in('design_version_id', lineage).order('revision', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  }
  else return json({ error: 'BAD_REQUEST' }, 400);
  if (!row) return json({ walkthrough: null, history: [] });
  // A poll is a driver too: a due step is taken (in the background, under the same lease rules).
  if (!isTerminal(row.state) && nextStep(row as WalkRow, Date.now()).kind !== 'WAIT') await inBackground('walkthrough-status', () => drive(admin, row.id, 60_000, { singlePass: true }));
  const lineage = await lineageOf(admin, row.design_version_id);
  const { data: all } = await caller.from('ds_walkthroughs').select('*').in('design_version_id', lineage).order('revision', { ascending: false }).limit(10);
  return json({ walkthrough: publicOf(row), history: (all ?? []).map(publicOf) });
}

export async function handleWalkthroughRetry(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  const { caller, admin, actorId } = ctx;
  let body: { walkthroughId?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.walkthroughId))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: row } = await caller.from('ds_walkthroughs').select('*').eq('id', body.walkthroughId).maybeSingle();
  if (!row || String(row.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (row.state !== 'FAILED') return json({ walkthrough: publicOf(row) });
  if (!publicOf(row).retryable) return json({ error: 'NOT_RETRYABLE', walkthrough: publicOf(row) }, 409);
  if (await billingOn(admin)) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  // Resume from the work already saved: a plan is never asked for again, a live provider job is polled again,
  // a finished one is processed again; only a job proven dead is replaced.
  const patch: Row = { error: null, lease_at: null, next_check_at: iso(Date.now()), attempts: 0, updated_at: iso(Date.now()), timings: { ...row.timings, manualRetries: (row.timings?.manualRetries ?? 0) + 1, retriedAt: iso(Date.now()) } };
  if (row.scene_plan && row.walk_version_id) {
    const { data: job } = row.factory_job_id ? await admin.from('ds_factory_jobs').select('id, state').eq('id', row.factory_job_id).maybeSingle() : { data: null };
    if (job?.state === 'COMPLETED') Object.assign(patch, { state: 'PROCESSING_RESULT', result_attempts: 0 });
    else if (job && (job.state === 'RUNNING' || job.state === 'QUEUED')) Object.assign(patch, { state: 'RUNNING', deadline_at: iso(Date.now() + PROVIDER_DEADLINE_MS) });
    else Object.assign(patch, { state: 'PLANNING', factory_job_id: null, provider_job_id: null, submit_attempts: 0, result_attempts: 0 });
  } else Object.assign(patch, { state: 'QUEUED', plan_attempts: 0 });
  const { data: updated } = await admin.from('ds_walkthroughs').update(patch).eq('id', row.id).eq('state', 'FAILED').select('*').maybeSingle();
  if (!updated) return json({ walkthrough: publicOf(row) });
  await inBackground('walkthrough-retry', () => drive(admin, row.id, 100_000));
  return json({ walkthrough: publicOf(updated) }, 202);
}

/** pg_cron, every minute. Answers yes/no only through ds_walkthrough_token_ok; never echoes anything secret. */
export async function handleWalkthroughTick(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = req.headers.get('x-cron-token');
  const admin = serviceClient();
  const { data: ok } = token ? await admin.rpc('ds_walkthrough_token_ok', { p_token: token }) : { data: false };
  if (ok !== true) return json({ error: 'FORBIDDEN' }, 403);
  const started = Date.now();
  const budget = 40_000;
  const now = iso(Date.now());
  const { data: due } = await admin.from('ds_walkthroughs').select('id')
    .in('state', ['QUEUED', 'PLANNING', 'SUBMITTED', 'RUNNING', 'PROCESSING_RESULT']).lte('next_check_at', now)
    .order('next_check_at', { ascending: true }).limit(8);
  let moved = 0;
  for (const w of due ?? []) {
    if (Date.now() - started > budget - 8000) break;
    const steps = await drive(admin, w.id, Math.min(25_000, budget - (Date.now() - started)), { singlePass: true });
    moved += steps;
  }
  const orphans = Date.now() - started < budget - 5000 ? await reconcileOrphans(admin, 5) : [];
  return json({ due: (due ?? []).length, steps: moved, orphans, ms: Date.now() - started });
}

// ── The driver ──────────────────────────────────────────────────────────────

/**
 * Take due steps of one walkthrough until it ends or the budget runs out. With
 * `singlePass` it stops at the first step that is not due yet (a status poll, the
 * reconciler); without, it waits for it (the request that created the walkthrough).
 * Returns the steps taken.
 */
async function drive(admin: Row, id: string, budgetMs: number, opts: { singlePass?: boolean } = {}): Promise<number> {
  const until = Date.now() + budgetMs;
  let steps = 0;
  for (let guard = 0; guard < 40 && Date.now() < until; guard += 1) {
    const r = await advance(admin, id);
    if (r === 'STEPPED') { steps += 1; continue; }
    if (r !== 'NOT_DUE' || opts.singlePass) break;
    const { data: row } = await admin.from('ds_walkthroughs').select('next_check_at, state').eq('id', id).maybeSingle();
    if (!row || isTerminal(row.state)) break;
    const wait = Date.parse(row.next_check_at) - Date.now();
    if (wait > until - Date.now() - 2000) break;
    await sleep(Math.max(250, wait));
  }
  return steps;
}

type Advance = 'STEPPED' | 'NOT_DUE' | 'BUSY' | 'DONE' | 'GONE';

/** One claimed step of one walkthrough. */
async function advance(admin: Row, id: string): Promise<Advance> {
  const { data: row } = await admin.from('ds_walkthroughs').select('*').eq('id', id).maybeSingle();
  if (!row) return 'GONE';
  const now = Date.now();
  const step = nextStep(row as WalkRow, now);
  if (step.kind === 'WAIT') return step.reason === 'TERMINAL' ? 'DONE' : step.reason === 'NOT_DUE' ? 'NOT_DUE' : 'BUSY';
  // The claim: compare-and-set on the attempts counter (every claim increments it), with a lease.
  const counters: Row = { attempts: row.attempts + 1, lease_at: iso(now), updated_at: iso(now) };
  if (step.kind === 'PLAN') Object.assign(counters, { plan_attempts: row.plan_attempts + 1, state: 'PLANNING' });
  if (step.kind === 'SUBMIT') counters.submit_attempts = row.submit_attempts + 1;
  if (step.kind === 'PROCESS') counters.result_attempts = row.result_attempts + 1;
  const { data: claimed } = await admin.from('ds_walkthroughs').update(counters).eq('id', id).eq('attempts', row.attempts).eq('state', row.state).select('*').maybeSingle();
  if (!claimed) return 'BUSY';
  try {
    if (step.kind === 'FAIL') await fail(admin, claimed, step.code);
    else if (step.kind === 'PLAN') await plan(admin, claimed);
    else if (step.kind === 'SUBMIT') await submit(admin, claimed);
    else if (step.kind === 'POLL') await poll(admin, claimed);
    else if (step.kind === 'PROCESS') await processResult(admin, claimed, null);
  } catch (e) {
    // An exception is a failed attempt of this step: released, due again shortly (the attempt counters bound it).
    console.error('[ds-walkthrough] step', step.kind, String((e as Error)?.message ?? e).slice(0, 200));
    await admin.from('ds_walkthroughs').update({ lease_at: null, next_check_at: iso(Date.now() + 20_000), error: `STEP_${step.kind}_ERROR`, updated_at: iso(Date.now()) }).eq('id', id).eq('attempts', claimed.attempts);
  }
  return 'STEPPED';
}

/** Release the claim with what the step decided. Only the holder of this claim may write (its attempts value). */
async function release(admin: Row, row: Row, patch: Row): Promise<void> {
  await admin.from('ds_walkthroughs').update({ ...patch, lease_at: null, updated_at: iso(Date.now()) }).eq('id', row.id).eq('attempts', row.attempts);
}

/**
 * The walkthrough ends FAILED with its reason. A provider job of its own that is
 * still alive is stopped at the provider first (GPU time nobody will use), and
 * the factory pass is recorded as failed with the same reason.
 */
async function fail(admin: Row, row: Row, code: string): Promise<void> {
  if (row.factory_job_id) {
    const { data: job } = await admin.from('ds_factory_jobs').select('id, state, provider_job_id').eq('id', row.factory_job_id).maybeSingle();
    if (job && (job.state === 'RUNNING' || job.state === 'QUEUED')) {
      const gpu = factoryConfig();
      const cancelled = gpu && job.provider_job_id ? await cancelProviderJob(gpu, job.provider_job_id) : null;
      await abandonJob(admin, job.id, code, cancelled === null ? null : `CANCEL_${cancelled}`);
    }
  }
  await release(admin, row, { state: 'FAILED', error: code.slice(0, 120), stage: null, timings: { ...row.timings, failedAt: iso(Date.now()) } });
}

/** A factory job that will never be processed: failed, its unwritten outputs released. */
async function abandonJob(admin: Row, jobId: string, reason: string, providerStatus: string | null): Promise<void> {
  const now = iso(Date.now());
  const { data: changed } = await admin.from('ds_factory_jobs').update({ state: 'FAILED', error: reason.slice(0, 300), provider_status: providerStatus, reconciled_at: now, updated_at: now })
    .eq('id', jobId).in('state', ['QUEUED', 'RUNNING']).select('id');
  if (!changed?.length) return;
  const { data: pending } = await admin.from('ds_factory_assets').select('id, object_key').eq('job_id', jobId).eq('state', 'PENDING');
  for (const a of pending ?? []) {
    await deleteObject(a.object_key).catch(() => null);
    await admin.from('ds_factory_assets').update({ state: 'FAILED', facts: { error: reason.slice(0, 200) }, updated_at: now }).eq('id', a.id);
  }
}

// ── PLAN ────────────────────────────────────────────────────────────────────

interface Loaded { version: Row; space: SpaceModel; source: Row }

async function loadDesign(admin: Row, row: Row): Promise<Loaded | null> {
  const { data: version } = await admin.from('ds_versions').select('id, project_id, user_id, source_id, state, design_dna, job_id, revision, style_tags').eq('id', row.design_version_id).maybeSingle();
  if (!version) return null;
  const { data: source } = await admin.from('ds_spatial_sources').select('id, kind, canonical').eq('id', version.source_id).maybeSingle();
  const scene = source?.canonical?.scene;
  if (!scene?.floors?.length || !Array.isArray(scene.walls)) return null;
  return { version, source, space: buildSpaceModel(scene) };
}

async function catalogue(admin: Row): Promise<{ assets: CatalogAsset[]; materials: CatalogMaterial[] }> {
  const { data: a } = await admin.from('ds_catalog_assets').select('*').eq('active', true).limit(2000);
  const { data: m } = await admin.from('ds_catalog_materials')
    .select('id, code, name, category, applies_to, style_tags, color_family, color_tags, color_families, search_aliases, pbr, thumbnail_key, provenance, is_placeholder, active')
    .eq('active', true).overlaps('applies_to', ['FLOOR', 'WALL']).limit(2000);
  return { assets: (a ?? []).map(assetFromRow), materials: (m ?? []).map((r: Row) => ({ ...materialFromRow(r), colorTags: Array.isArray(r.color_tags) ? r.color_tags : [] })) };
}

async function plan(admin: Row, row: Row): Promise<void> {
  const design = await loadDesign(admin, row);
  if (!design) { await fail(admin, row, 'NO_SPACE_MODEL'); return; }
  const { version, space } = design;
  const dna = version.design_dna?.version === 'ds-dna-1' ? version.design_dna : null;
  const preferences = normalizePreferences(dna?.preferences ?? null);
  let spec: Row = null;
  if (row.spec_job_id) {
    const { data: job } = await admin.from('ds_jobs').select('output, status, user_id').eq('id', row.spec_job_id).maybeSingle();
    if (job?.status === 'SUCCEEDED' && String(job.user_id) === String(row.user_id)) spec = job.output?.spec ?? null;
  }
  const cat = await catalogue(admin);
  const floorAssets = cat.assets.filter((a) => a.placement === 'FLOOR');
  const ctx: PlanContext = {
    rooms: space.rooms.map((r) => ({ id: r.id, kind: r.kind, areaM2: r.areaM2, label: r.label })),
    assets: floorAssets.map((a): PlanAssetContext & { heightM: number; colors: string[] } => ({
      code: a.code, name: a.name, category: a.category, subcategory: a.subcategory, roomKinds: a.roomKinds, styleTags: a.styleTags,
      widthM: a.widthM, depthM: a.depthM, heightM: a.heightM, colors: a.dominantColors,
    })),
    materials: cat.materials.map((m): PlanMaterialContext => ({
      code: m.code, name: m.name, appliesTo: m.appliesTo, styleTags: m.styleTags,
      color: typeof m.pbr?.baseColor === 'string' ? m.pbr.baseColor : null,
      category: m.category ?? null, colorFamily: m.colorFamily ?? null, colorTags: (m as CatalogMaterial & { colorTags?: string[] }).colorTags ?? [],
      textured: !!(m.pbr as Row)?.mapsByRes || !!(m.pbr as Row)?.maps?.albedo,
    })),
    locks: { layout: false, furniture: false, walls: false, floor: false, kitchen: false, colors: false, lighting: false },
    existing: {},
  };
  const offered = offerFor(ctx, preferences);
  const input: SceneInput = {
    preferences, spec, finishes: dna?.finishes ?? null, palette: Array.isArray(dna?.palette) ? dna.palette : [],
    ctx: offered.ctx, rooms: roomSketches(space),
  };

  const started = Date.now();
  let payload: Row = null;
  let reused: ValidatedScenePlan | null = null;
  if (typeof row.timings?.reusePlanFrom === 'string') {
    // The plan an earlier walkthrough of this design made: the same rooms, the same choices, no new model call.
    // Only rooms this geometry has are kept; every pose is placed again by HOMATCH's engine below.
    const { data: w } = await admin.from('ds_walkthroughs').select('scene_plan, project_id').eq('id', row.timings.reusePlanFrom).maybeSingle();
    const plan0 = w?.project_id === row.project_id ? w?.scene_plan as ValidatedScenePlan | null : null;
    if (plan0?.rooms) {
      const ids = new Set(space.rooms.map((r) => r.id));
      reused = { ...plan0, rooms: plan0.rooms.filter((r) => ids.has(r.roomId)) };
    }
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!reused && !apiKey) { await release(admin, row, { error: 'PLAN_UNAVAILABLE', next_check_at: iso(Date.now() + 60_000) }); return; }
  if (!reused) try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sceneRequest(MODEL, input)),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  const text = payload ? textOf(payload) : '';
  let raw: unknown = null;
  try { raw = text ? JSON.parse(text) : null; } catch { raw = null; }
  const validated: ValidatedScenePlan | null = reused ?? (raw ? validateScenePlan(raw, input) : null);
  const aiCost = payload ? await meterAiCall(admin, { userId: row.user_id, productCode: 'DS_AI_DESIGN', jobRef: row.id, model: MODEL, startedAt: started }, payload, { step: 'walkthrough_scene_plan', walkthrough: row.id }) : null;
  const costLine = reused
    ? { kind: 'OPENAI_SCENE_PLAN', model: null, usd: 0, basis: 'REUSED', reusedFrom: row.timings.reusePlanFrom, tokens: null, ms: 0, attempt: row.plan_attempts }
    : { kind: 'OPENAI_SCENE_PLAN', model: MODEL, usd: aiCost?.aiCents == null ? null : aiCost.aiCents / 100, basis: aiCost?.aiCents == null ? 'NOT_AVAILABLE' : 'ESTIMATED', tokens: payload?.usage ?? null, ms: Date.now() - started, attempt: row.plan_attempts };
  const cost = [...(Array.isArray(row.cost) ? row.cost : []), ...(payload || reused ? [costLine] : [])];
  if (!validated || !validated.rooms.length) {
    await release(admin, row, { error: payload ? 'PLAN_INVALID' : 'PLAN_UNAVAILABLE', cost, next_check_at: iso(Date.now() + 15_000) });
    return;
  }

  // The walkable design: HOMATCH's engine places, validates and finishes it.
  const assets = new Map(cat.assets.map((a) => [a.code, a]));
  const byCode = new Map(cat.materials.map((m) => [m.code, m]));
  const byId = new Map(cat.materials.map((m) => [m.id, m]));
  const base = normalizeDesignState(version.state);
  const built = buildWalkthrough({
    space, base, assets, materialsByCode: byCode, materialsById: byId, idPrefix: `walk-${row.revision}`,
    plan: { lighting: validated.lighting, palette: validated.palette, styleCode: preferences.style, rooms: validated.rooms },
  });
  // The walkability gate (walkthrough/walkability.ts): a walkthrough nobody can walk comfortably is never READY.
  if (built.report.gate && !built.report.gate.ok) { await fail(admin, row, 'NOT_WALKABLE'); return; }

  // Saved as its own version of the design (the approved one is never touched); the same id on a re-plan.
  const walkId = await uuidFrom(`ds-walk:${row.id}:version`);
  const name = (typeof row.timings?.name === 'string' && row.timings.name) || `3D ${row.revision}`;
  const { error: insertErr } = await admin.from('ds_versions').upsert({
    id: walkId, project_id: version.project_id, user_id: version.user_id, source_id: version.source_id, parent_id: version.id,
    name, origin: 'AI', job_id: version.job_id, state: built.state, style_tags: version.style_tags ?? [],
    change_summary: [{ kind: 'WALKTHROUGH', walkthroughId: row.id, revision: row.revision, plan: validated.version }],
    design_dna: version.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (insertErr) { await release(admin, row, { error: 'VERSION_NOT_RECORDED', cost, next_check_at: iso(Date.now() + 15_000) }); return; }
  await admin.from('ds_versions').update({ state: built.state }).eq('id', walkId);

  const report = {
    build: built.report, dropped: validated.dropped, filled: validated.filled, approximations: validated.approximations, omitted: validated.omitted,
    rooms: validated.rooms.length, model: reused ? null : MODEL, offer: offered.offer, planMs: Date.now() - started, reusedFrom: reused ? row.timings.reusePlanFrom : null,
  };
  await release(admin, row, {
    state: 'PLANNING', scene_plan: validated, plan_report: report, walk_version_id: walkId, cost, error: null, next_check_at: iso(Date.now()),
  });
}

// ── SUBMIT ──────────────────────────────────────────────────────────────────

async function walkableSpec(admin: Row, row: Row): Promise<{ spec: SceneBuildSpec; state: DesignState } | { error: string }> {
  const design = await loadDesign(admin, row);
  if (!design) return { error: 'NO_SPACE_MODEL' };
  const { data: walk } = await admin.from('ds_versions').select('id, state').eq('id', row.walk_version_id).maybeSingle();
  if (!walk) return { error: 'WALK_VERSION_MISSING' };
  const state = normalizeDesignState(walk.state);
  const codes = [...new Set(state.objects.map((o) => o.assetId))];
  const { data: assetRows } = codes.length ? await admin.from('ds_catalog_assets').select('*').in('code', codes) : { data: [] };
  const matIds = [...new Set(Object.values(state.surfaces).map((s) => s.materialId).filter((x): x is string => !!x))];
  const { data: matRows } = matIds.length ? await admin.from('ds_catalog_materials').select('*').in('id', matIds) : { data: [] };
  const assets = new Map<string, CatalogAsset>((assetRows ?? []).map((r: Row) => { const a = assetFromRow(r); return [a.code, a] as [string, CatalogAsset]; }));
  const materials = new Map<string, CatalogMaterial>((matRows ?? []).map((r: Row) => { const m = materialFromRow(r); return [m.id, m] as [string, CatalogMaterial]; }));
  const compiled = compileSceneSpec({
    space: design.space, state, assets, materials,
    source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' },
    camera: null, outputs: { render: false, scene: false, objects: true },
  });
  try { return { spec: validateSceneSpec(JSON.parse(JSON.stringify(compiled))), state }; } catch (e) { return { error: `BAD_SPEC_${e instanceof SpecError ? e.path : 'UNKNOWN'}`.slice(0, 120) }; }
}

async function submit(admin: Row, row: Row): Promise<void> {
  const gpu = factoryConfig();
  if (!gpu) { await release(admin, row, { error: 'FACTORY_NOT_CONFIGURED', next_check_at: iso(Date.now() + 120_000) }); return; }
  if (await billingOn(admin)) { await fail(admin, row, 'BILLING_CONFIRMATION_REQUIRED'); return; }
  const built = await walkableSpec(admin, row);
  if ('error' in built) { await fail(admin, row, built.error); return; }
  // Nothing for the factory to build (every piece is drawn by the walkthrough itself): ready as it is.
  if (!built.spec.objects.some((o) => o.runtime && o.group)) {
    await release(admin, row, { state: 'READY', stage: 'NO_FACTORY_PIECES', ready_at: iso(Date.now()), error: null, timings: { ...row.timings, readyAt: iso(Date.now()) } });
    return;
  }
  const out = await submitPass(admin, gpu, { projectId: row.project_id, actorId: row.user_id, reconstructionId: null, versionId: row.walk_version_id, pass: 1, spec: built.spec });
  if (out.status !== 200 || !out.body?.jobId) {
    const code = String(out.body?.error ?? 'SUBMIT_FAILED');
    await release(admin, row, { error: code, next_check_at: iso(Date.now() + (code === 'RATE_LIMITED' ? 300_000 : 30_000)) });
    return;
  }
  const { data: job } = await admin.from('ds_factory_jobs').select('id, state, provider_job_id').eq('id', out.body.jobId).maybeSingle();
  await release(admin, row, {
    state: 'SUBMITTED', factory_job_id: out.body.jobId, provider_job_id: job?.provider_job_id ?? null, error: null, stage: null,
    deadline_at: iso(Date.now() + PROVIDER_DEADLINE_MS), next_check_at: iso(Date.now() + 15_000),
    timings: { ...row.timings, submittedAt: iso(Date.now()), reusedFactoryJob: !!out.body.reused },
  });
}

// ── POLL / PROCESS ──────────────────────────────────────────────────────────

async function poll(admin: Row, row: Row): Promise<void> {
  const gpu = factoryConfig();
  const { data: job } = await admin.from('ds_factory_jobs').select(`${JOB_FIELDS}, user_id`).eq('id', row.factory_job_id).maybeSingle();
  if (!job) { await resubmitOrFail(admin, row, 'FACTORY_JOB_MISSING'); return; }
  if (job.state === 'COMPLETED') { await toProcess(admin, row, null); return; }
  if (job.state === 'FAILED' || job.state === 'CANCELLED') { await resubmitOrFail(admin, row, `PROVIDER_${job.state}`, job.error); return; }
  if (!gpu || !job.provider_job_id) { await release(admin, row, { next_check_at: iso(Date.now() + 30_000) }); return; }
  const answer = await providerStatus(gpu, job.provider_job_id);
  const reading = readProviderStatus(answer.http, answer.body, FACTORY_STAGES);
  await admin.from('ds_factory_jobs').update({ provider_status: `${answer.http ?? 'NETWORK'}:${answer.body?.status ?? '-'}`.slice(0, 60), reconciled_at: iso(Date.now()) }).eq('id', job.id);
  const d = decidePoll(row, reading, Date.now());
  if (d.kind === 'CONTINUE') { await release(admin, row, { state: d.state, stage: d.stage ?? row.stage ?? null, next_check_at: iso(Date.now() + d.nextInMs), error: null }); return; }
  if (d.kind === 'PROCESS') { await toProcess(admin, row, answer); return; }
  if (d.kind === 'RESUBMIT') {
    // The provider's own failure is settled first (the pass FAILED, its unwritten files deleted).
    await settlePass(admin, job, answer).catch(() => null);
    await resubmitOrFail(admin, row, d.reason, null);
    return;
  }
  if (reading.kind === 'FAILED') await settlePass(admin, job, answer).catch(() => null);
  await fail(admin, row, d.code);
}

async function toProcess(admin: Row, row: Row, answer: { http: number | null; body: Row } | null): Promise<void> {
  // The same claim moves on to processing (counted as a result attempt).
  const { data: next } = await admin.from('ds_walkthroughs').update({ state: 'PROCESSING_RESULT', result_attempts: row.result_attempts + 1, stage: null, updated_at: iso(Date.now()) })
    .eq('id', row.id).eq('attempts', row.attempts).select('*').maybeSingle();
  if (!next) return;
  await processResult(admin, next, answer);
}

async function resubmitOrFail(admin: Row, row: Row, reason: string, detail: string | null = null): Promise<void> {
  const d = decidePoll(row, { kind: 'FAILED', status: reason.replace(/^PROVIDER_/, ''), error: detail }, Date.now());
  if (d.kind !== 'RESUBMIT') { await fail(admin, row, reason); return; }
  // A fresh job: the dead one's files are detached so the new outputs are never mixed with them.
  if (row.factory_job_id) await admin.from('ds_factory_assets').update({ job_id: null, updated_at: iso(Date.now()) }).eq('job_id', row.factory_job_id).neq('state', 'READY');
  await release(admin, row, { state: 'SUBMITTED', factory_job_id: null, provider_job_id: null, error: reason, next_check_at: iso(Date.now()) });
}

async function processResult(admin: Row, row: Row, answer: { http: number | null; body: Row } | null): Promise<void> {
  const { data: job } = await admin.from('ds_factory_jobs').select(`${JOB_FIELDS}, spec`).eq('id', row.factory_job_id).maybeSingle();
  if (!job) { await fail(admin, row, 'FACTORY_JOB_MISSING'); return; }
  const settled: Row = await settlePass(admin, job, answer ?? undefined);
  if (settled.state === 'QUEUED' || settled.state === 'RUNNING') {
    // Another verifier holds the pass, or the provider answered nothing usable: due again shortly.
    await release(admin, row, { next_check_at: iso(Date.now() + 15_000) });
    return;
  }
  if (settled.state !== 'COMPLETED') { await resubmitOrFail(admin, row, 'RESULT_INVALID', settled.error ?? null); return; }

  // The factory's pieces, attached to the walkable design (by the spec's own groups).
  const pieces: Record<string, Row> = settled.outputs?.pieces ?? {};
  const groupOf = new Map<string, string>(((job.spec?.objects ?? []) as Row[]).filter((o) => o.runtime && o.group).map((o) => [o.id, o.group]));
  const { data: walk } = await admin.from('ds_versions').select('id, state').eq('id', row.walk_version_id).maybeSingle();
  if (!walk) { await fail(admin, row, 'WALK_VERSION_MISSING'); return; }
  const state = normalizeDesignState(walk.state);
  let attached = 0; let missing = 0;
  for (const obj of state.objects) {
    const g = groupOf.get(obj.instanceId);
    if (!g) continue;
    const ref = pieces[g];
    if (ref?.assetId && ref.key) { obj.generated = { assetId: ref.assetId, key: ref.key, sha256: ref.sha256 ?? null }; attached += 1; } else { delete obj.generated; missing += 1; }
  }
  await admin.from('ds_versions').update({ state }).eq('id', walk.id);

  const persisted = Number(settled.result?.persistedBytes ?? 0) || 0;
  const gpuLines = (Array.isArray(settled.cost) ? settled.cost : []).map((c: Row) => ({ kind: 'RUNPOD_GPU', usd: c.usd ?? null, basis: c.basis ?? 'NOT_AVAILABLE', detail: c.detail ?? null, executionMs: settled.timings?.executionMs ?? null, queueMs: settled.timings?.queueAndColdStartMs ?? null }));
  const storage = { kind: 'STORAGE', bytes: persisted, usdPerMonth: Math.round((persisted / 1e9) * STORAGE_USD_PER_GB_MONTH * 1e6) / 1e6, basis: 'ESTIMATED' };
  const cost = [...(Array.isArray(row.cost) ? row.cost.filter((c: Row) => c.kind !== 'RUNPOD_GPU' && c.kind !== 'STORAGE') : []), ...gpuLines, storage];
  await release(admin, row, {
    state: 'READY', stage: null, error: null, cost, ready_at: iso(Date.now()),
    plan_report: { ...(row.plan_report ?? {}), factory: { pieces: Object.keys(pieces).length, attached, missing, persistedBytes: persisted } },
    timings: { ...row.timings, readyAt: iso(Date.now()), factory: settled.timings ?? null },
  });
}

// ── Factory jobs nobody watches any more ────────────────────────────────────

/**
 * A factory pass left RUNNING by a page that went away (the browser-driven
 * builds) is settled against its provider: a finished one is verified exactly
 * as factory-status would, a failed one is recorded, one the provider no
 * longer knows is recorded as lost, and one still running long after any
 * deadline is cancelled there. Never marks a live job failed without proof.
 */
async function reconcileOrphans(admin: Row, limit: number): Promise<Array<{ jobId: string; provider: string; outcome: string }>> {
  const gpu = factoryConfig();
  if (!gpu) return [];
  const before = iso(Date.now() - ORPHAN_AFTER_MS);
  const { data: jobs } = await admin.from('ds_factory_jobs').select(`${JOB_FIELDS}, updated_at, created_at, reconciled_at`)
    .in('state', ['QUEUED', 'RUNNING']).lt('updated_at', before).order('updated_at', { ascending: true }).limit(limit * 3);
  const out: Array<{ jobId: string; provider: string; outcome: string }> = [];
  for (const job of jobs ?? []) {
    if (out.length >= limit) break;
    if (job.reconciled_at && Date.parse(job.reconciled_at) > Date.now() - 10 * 60_000) continue;
    // A walkthrough still owns it: its own driver decides.
    const { count } = await admin.from('ds_walkthroughs').select('id', { count: 'exact', head: true }).eq('factory_job_id', job.id).in('state', ['SUBMITTED', 'RUNNING', 'PROCESSING_RESULT']);
    if ((count ?? 0) > 0) continue;
    const now = iso(Date.now());
    if (!job.provider_job_id) {
      await abandonJob(admin, job.id, 'NEVER_SUBMITTED', null);
      out.push({ jobId: job.id, provider: 'NONE', outcome: 'FAILED' });
      continue;
    }
    const answer = await providerStatus(gpu, job.provider_job_id);
    const reading = readProviderStatus(answer.http, answer.body, FACTORY_STAGES);
    const provider = `${answer.http ?? 'NETWORK'}:${answer.body?.status ?? '-'}`.slice(0, 60);
    await admin.from('ds_factory_jobs').update({ provider_status: provider, reconciled_at: now }).eq('id', job.id);
    if (reading.kind === 'COMPLETED' || reading.kind === 'FAILED') {
      const settled: Row = await settlePass(admin, job, answer);
      out.push({ jobId: job.id, provider, outcome: String(settled.state) });
    } else if (reading.kind === 'UNKNOWN' && answer.http === 404) {
      // The provider no longer knows the job (its results are kept for a limited time): it cannot finish now.
      await abandonJob(admin, job.id, 'PROVIDER_LOST', provider);
      out.push({ jobId: job.id, provider, outcome: 'FAILED_PROVIDER_LOST' });
    } else if ((reading.kind === 'RUNNING' || reading.kind === 'QUEUED') && Date.parse(job.created_at) < Date.now() - ORPHAN_CANCEL_AFTER_MS) {
      const cancelled = await cancelProviderJob(gpu, job.provider_job_id);
      await abandonJob(admin, job.id, 'STALE_CANCELLED', `CANCEL_${cancelled ?? 'NETWORK'}`);
      out.push({ jobId: job.id, provider, outcome: 'CANCELLED_STALE' });
    } else {
      out.push({ jobId: job.id, provider, outcome: 'LEFT_RUNNING' });
    }
  }
  return out;
}
