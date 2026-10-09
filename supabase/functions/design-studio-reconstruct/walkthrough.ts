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
//            its own version (the approved design is never touched).
//            REFERENCE-LOCKED when the walkthrough was asked for from a
//            selected design picture (render_id): that picture is the ground
//            truth. It is loaded and hashed (its provenance kept on the row),
//            shown to OpenAI with its scene map, reconstructed (room, camera,
//            every visible piece with its real size and basis), built with its
//            anchors locked, and judged against it (walkthrough/fidelity.ts);
//            a failed judgement gets ONE replan told exactly what failed, then
//            fails with its REFERENCE_* / NOT_WALKABLE code — never READY.
//   SUBMIT   the walkable design compiled to a SceneBuildSpec → one factory
//            pass (submitPass: idempotent, the RunPod job id recorded the
//            moment RunPod accepts it)
//   POLL     the SAME RunPod job asked for its status
//   PROCESS  its outputs re-read, hashed and inspected (settlePass), the
//            factory-built pieces attached to the walkable design; for a
//            reference-locked walkthrough the factory also rendered the
//            picture's own viewpoint, and a vision check compares the two
//            (gross failures fail; the check's answer is kept) → READY
//
// Billing: none. Customer billing for Design Studio is off; this refuses
// rather than charge if it is ever switched on before a confirmation flow
// exists. Cost lines are internal COGS (OpenAI, GPU seconds, storage).

import { serviceClient } from '../_shared/billing.ts';
import { deleteObject } from '../_shared/objectStore.ts';
import { uuidFrom } from '../_shared/designStudio/renderKeys.ts';
import { normalizePreferences, type PlanAssetContext, type PlanContext, type PlanMaterialContext } from '../_shared/designStudio/aiPlan.ts';
import { offerFor } from '../_shared/designStudio/designIntent.ts';
import {
  imageAspect, REFERENCE_QA_SYSTEM, referenceSceneRequest, sceneRequest, validateScenePlan, type ReferenceInput, type SceneInput, type ValidatedScenePlan,
} from '../_shared/designStudio/walkthrough/scenePlan.ts';
import { validateScene } from '../_shared/designStudio/sceneMap.ts';
import { QA_SCHEMA, validateQaReport } from '../_shared/designStudio/hybrid/qa.ts';
import { validateSceneSpec, SpecError, type SceneBuildSpec } from '../_shared/designStudio/hybrid/sceneSpec.ts';
import { callerOf, cancelProviderJob, factoryConfig, FACTORY_STAGES, JOB_FIELDS, providerStatus, settlePass, submitPass } from './factory.ts';
import { failure, inBackground, isFresh, kick, readFailure } from './durable.ts';
import { getObject } from '../_shared/objectStore.ts';
import { SCHEMA as RECON_SCHEMA, SYSTEM as RECON_SYSTEM, validateReconstruction } from '../_shared/designStudio/reconstructRead.ts';
import { inferredSpace, mostlyInferred, WALK_SPACE_BRIEF } from '../../../src/lib/designStudio/walkthrough/inferredSpace.ts';
import { repairReading } from '../../../src/lib/designStudio/walkthrough/readingRepair.ts';
import { carryPoint, furnishingFromReading, readFurnishing, renderTraceBrief, sceneTransform, type RenderFurnishing } from '../../../src/lib/designStudio/walkthrough/renderFurnishing.ts';
import { checkGeometry, expectedOfUnderstanding, GEOMETRY_CHECK_VERSION, roomsOfScene, type GeometryCheck } from '../../../src/lib/designStudio/walkthrough/geometryCheck.ts';
import { dressBuilt, planFromFurnishing, RENDER_WALK_RADIUS_M } from '../../../src/lib/designStudio/walkthrough/renderPlan.ts';
import { renderGate } from '../../../src/lib/designStudio/walkthrough/renderGate.ts';
import { NEUTRAL_LIGHTING } from '../../../src/lib/designStudio/walkthrough/renderLighting.ts';
import { imageSize } from '../_shared/designStudio/floorplanRead.ts';
import { measureRender } from './renderFrame.ts';
import { meterAiCall } from './metering.ts';
import { closeWalkthroughBilling, reserveWalkthrough, WALK_PRODUCT } from './walkthroughBilling.ts';
import { assetFromRow, materialFromRow, type CatalogAsset, type CatalogMaterial } from '../../../src/lib/designStudio/catalog.ts';
import { normalizeDesignState, type DesignState } from '../../../src/lib/designStudio/designState.ts';
import { buildSpaceModel, type SpaceModel } from '../../../src/lib/designStudio/space.ts';
import { buildCanonical } from '../../../src/lib/designStudio/scale.ts';
import { compileSceneSpec } from '../../../src/lib/designStudio/hybrid/compileSpec.ts';
import { buildWalkthrough, roomSketches } from '../../../src/lib/designStudio/walkthrough/build.ts';
import { applyGraphLook, buildDesignGraph, fidelityOf, graphToBuildPlan, READY_MIN_RECALL, type Promotion, type SpatialDesignGraph } from '../../../src/lib/designStudio/walkthrough/designGraph.ts';
import { loadDesignEvidence } from './designEvidence.ts';
import { anchorLock, feedbackOf, homeOrigin, referenceCameraPose, referenceFidelity, visualVerdict, type FidelityReport } from '../../../src/lib/designStudio/walkthrough/fidelity.ts';
import { buildWalkModel, isFree, nearestFree } from '../../../src/lib/designStudio/navigation.ts';
import {
  decidePoll, identityText, isTerminal, MAX_PLAN_ATTEMPTS, nextStep, progressOf, PROVIDER_DEADLINE_MS, readProviderStatus, retryableFailure,
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
/** How often a background scene plan is asked for its answer, and how long it is waited for. */
const PLAN_RESPONSE_POLL_MS = 10_000;
const PLAN_RESPONSE_MAX_MS = 12 * 60_000;
const MODEL = Deno.env.get('OPENAI_DS_WALK_MODEL') || Deno.env.get('OPENAI_DS_DESIGN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
/** The model that compares the factory's reference-view render with the picture. */
const QA_MODEL = Deno.env.get('OPENAI_DS_QA_MODEL') || MODEL;
/** New walkthroughs one account may start per hour (a runaway client, not a price). */
const HOURLY = 6;
/** The model that reads a photo design's pictures into a walkable space (the reconstruction reader's). */
const SPACE_MODEL = Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_DS_FLOORPLAN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
/** Readings of one project's space, at most (each a paid call): a failure is retried automatically up to this. */
const SPACE_ATTEMPTS = 3;
/** Readings of the selected render, at most: one. It is the larger paid call, so a failure is reported, never re-bought. */
const RENDER_SPACE_ATTEMPTS = 1;
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

async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text));
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
    // Is it, measurably, the selected design (walkthrough/designGraph.ts PROMOTION_RULES)? null: no design to compare.
    fidelity: row.state === 'READY' && row.plan_report?.designGraph?.promotion
      ? { promoted: row.plan_report.designGraph.promotion.promoted === true && row.plan_report?.visualQa?.state !== 'FAILED', reasons: row.plan_report.designGraph.promotion.reasons ?? [] }
      : row.state === 'READY' && row.render_id ? { promoted: false, reasons: ['NO_DESIGN_GRAPH'] } : null,
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
async function designOnPlan(admin: Row, version: Row, projectId: string, renderId: string | null = null): Promise<{ version: Row; source: Row } | null> {
  const { data: plans } = await admin.from('ds_spatial_sources').select('id, kind, status, canonical, provenance, created_at').eq('project_id', projectId)
    .eq('kind', 'FLOORPLAN_SCENE').eq('status', 'READY').order('created_at', { ascending: false }).limit(5);
  // A measured plan always wins over a space reconstructed from pictures; among those, the one read from the
  // selected render (it carries that render's furnishing), then the newest.
  const plan = (plans ?? []).filter((p: Row) => p.canonical?.scene?.floors?.length && Array.isArray(p.canonical?.scene?.walls))
    .sort((a: Row, b: Row) => Number(a.provenance?.inferred === true) - Number(b.provenance?.inferred === true)
      || Number(!!renderId && b.provenance?.fromRenderId === renderId) - Number(!!renderId && a.provenance?.fromRenderId === renderId))[0];
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
  // A reading of the selected render (its pieces are the walkthrough's furnishing) is its own reading per render.
  const key = await sha256Hex(a.renderId ? `walk-space:v2:${a.photoSource.id}:${a.renderId}` : `walk-space:v1:${a.photoSource.id}`);
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
  if (failed.length + (running ? 1 : 0) >= (a.renderId ? RENDER_SPACE_ATTEMPTS : SPACE_ATTEMPTS)) return { state: 'FAILED', code: readFailure(failed[0]?.error)?.code ?? 'SPACE_UNAVAILABLE' };
  if (!Deno.env.get('OPENAI_API_KEY')) return { state: 'FAILED', code: 'SPACE_UNAVAILABLE' };

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: a.actorId, project_id: a.project.id, kind: 'RECONSTRUCT', status: 'RUNNING', model: SPACE_MODEL, started_at: new Date().toISOString(),
    input: { purpose: 'WALK_SPACE', key, photoSourceId: a.photoSource.id, designVersionId: a.version.id, renderId: a.renderId, generator: 'OPENAI_FIRST' },
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
  const designRows = (renders ?? []).sort((x: Row, y: Row) => Number(y.id === a.renderId) - Number(x.id === a.renderId)).slice(0, 3);
  const designKeys = designRows.map((r: Row) => String(r.final_key));
  const selectedKey = a.renderId ? designRows.find((r: Row) => r.id === a.renderId)?.final_key ?? null : null;
  const images: Array<{ url: string; source: boolean; aspect: number | null; selected: boolean; bytes: Uint8Array }> = [];
  let total = 0;
  for (const [i, key] of [...sourceKeys, ...designKeys].entries()) {
    const res = await getObject(key).catch(() => null);
    if (!res?.ok) { await res?.arrayBuffer().catch(() => null); continue; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || bytes.length > MAX_SPACE_BYTES || total + bytes.length > MAX_SPACE_TOTAL) continue;
    total += bytes.length;
    const size = imageSize(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    images.push({
      url: `data:${type};base64,${b64(bytes)}`, source: i < sourceKeys.length, aspect: size && size.height ? size.width / size.height : null,
      selected: i >= sourceKeys.length && !!selectedKey && key === selectedKey, bytes,
    });
  }
  // Nothing at all to read the home from: the only honest failure.
  if (!images.length) return fail('NO_PICTURES', true);
  const nSource = images.filter((x) => x.source).length;
  // The selected render: its own camera measured from its pixels and its plan view (renderFrame.ts), so the rooms
  // are traced from above and every piece where the render shows it. Without a measurable frame: read as before.
  const selected = images.findIndex((x) => x.selected);
  const measured = selected >= 0 ? (() => { try { return measureRender(images[selected].bytes); } catch { return null; } })() : null;
  const viewIndex = measured ? images.length : null;
  const rooms = (u?.rooms ?? []).map((r: Row) => `${r.label || r.kind} (${r.kind})${r.fixed?.length ? `: ${r.fixed.slice(0, 6).join('; ')}` : ''}`).slice(0, 12);
  const content: Row[] = [{
    type: 'input_text',
    text: `Here are ${images.length} pictures of the SAME home, numbered 0 to ${images.length - 1}. Pictures 0 to ${Math.max(0, nSource - 1)} are the customer's own source pictures${nSource < images.length ? `; pictures ${nSource} to ${images.length - 1} are generated designs of it` : ''}. Merge them into one home and rebuild it as structured data in the plan frame. Write labels in English; keep every code exactly as listed.\n\n${WALK_SPACE_BRIEF}${selected >= 0 ? `\n\n${renderTraceBrief(selected, viewIndex)}` : ''}${rooms.length ? `\n\nHOMATCH already read these rooms from the source pictures:\n- ${rooms.join('\n- ')}` : ''}`,
  }];
  images.forEach((img, i) => {
    content.push({ type: 'input_text', text: `Picture ${i} (${img.source ? 'source' : i === selected ? 'generated design — THE SELECTED DESIGN' : 'generated design'}):` });
    content.push({ type: 'input_image', image_url: img.url });
  });
  if (measured && viewIndex != null) {
    content.push({ type: 'input_text', text: `Plan view ${viewIndex} (${measured.viewWidth} x ${measured.viewHeight} px): picture ${selected} redrawn from directly above, from its measured camera. Trace the rooms here.` });
    content.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${b64(measured.view)}` });
  }
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
  const { recon: read } = validateReconstruction(raw, images.length, {
    // Each picture's shape (its traced pixels are fractions of it) and the selected render's measured frame.
    imageAspects: images.map((img) => img.aspect),
    frames: measured && viewIndex != null ? [{ image: selected, view: viewIndex, frame: measured.frame }] : [],
  });
  // Squared to its walls and its doors made doors (readingRepair.ts), every change recorded.
  const repaired = repairReading(read);
  const recon = repaired.recon;
  const space = inferredSpace(recon, `walk-space:${a.photoSource.id}`);
  if ('problems' in space) return fail(`SPACE_NOT_BUILDABLE:${space.problems.slice(0, 3).join(',')}`, false, paid);
  // The render's own pieces, in the built scene's metres: the walkthrough's furnishing (renderFurnishing.ts).
  const furnishing: RenderFurnishing | null = selected >= 0 && a.renderId ? furnishingFromReading(recon, space.canonical.scene.floors, a.renderId, selected, measured?.lighting ?? null) : null;
  // Is this the home? Checked against the customer's own picture, the reading's pieces and the measured outline
  // (carried into the scene's frame), before anything is placed (geometryCheck.ts). Recorded with the space.
  const toScene = sceneTransform(recon, space.canonical.scene.floors);
  const geometryCheck = checkGeometry({
    rooms: roomsOfScene(space.canonical.scene.floors),
    pieces: furnishing ? furnishing.objects : [],
    expected: expectedOfUnderstanding(u),
    unreachable: space.unreachable, repairs: space.repairs,
    footprint: toScene && recon.fidelity?.outline?.length ? recon.fidelity.outline.map((p) => carryPoint(toScene, p)) : null,
  });

  // An ESTIMATED floor-plan source of this project, marked inferred, used only by the walkthrough.
  const { data: made, error } = await admin.from('ds_spatial_sources').insert({
    project_id: a.project.id, user_id: a.actorId, kind: 'FLOORPLAN_SCENE', status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED',
    canonical: space.canonical, calibration: { metresPerPx: space.canonical.metresPerPx, inferred: true },
    generator_version: space.canonical.generatorVersion,
    provenance: {
      origin: 'INFERRED_FOR_WALKTHROUGH', inferred: true, verified: false, fromSourceId: a.photoSource.id, designVersionId: a.version.id, jobId: a.jobId,
      repairs: space.repairs, spawn: space.spawn, reachable: space.reachable, unreachable: space.unreachable, basis: space.basis, generator: 'OPENAI_FIRST',
      readingRepairs: repaired.repairs, ...(a.renderId ? { fromRenderId: a.renderId, frameMeasured: !!measured, frameFidelity: recon.fidelity ?? null } : {}),
      ...(furnishing ? { furnishing } : {}),
      geometryCheck,
    },
  }).select('id').single();
  if (error || !made?.id) return fail('SOURCE_NOT_RECORDED', false, paid);
  await admin.from('ds_jobs').update({
    status: 'SUCCEEDED', finished_at: new Date().toISOString(), ...paid,
    output: {
      kind: 'WALK_SPACE', sourceId: made.id, rooms: space.reachable.length + space.unreachable.length, repairs: space.repairs.length, basis: space.basis, mostlyInferred: mostlyInferred(space.basis),
      geometry: geometryCheck.verdict,
      // The validated reading itself (no pictures in it): the space can be rebuilt from it by better code, never bought again.
      reading: read,
      ...(a.renderId ? { renderId: a.renderId, frameMeasured: !!measured, pieces: furnishing ? { read: furnishing.read, traced: furnishing.traced } : null } : {}),
    },
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
  let body: { designVersionId?: string; renderId?: string | null; newRevision?: boolean; name?: string; reusePlanFrom?: string | null; quoteToken?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.designVersionId))) return json({ error: 'BAD_REQUEST' }, 400);
  // While Design Studio charges, a walkthrough runs only on a confirmed quote (its maximum is reserved below).
  const charging = await billingOn(admin);
  if (charging && body.quoteToken == null) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);
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
    const renderId = body.renderId ?? null;
    let onPlan = await designOnPlan(admin, version, project.id, renderId);
    // A space reconstructed from pictures but not from the selected render: that render is read once (its pieces
    // furnish the walkthrough). Should that reading fail, the space already there is walked as before.
    if (onPlan && renderId && onPlan.source.provenance?.inferred === true && onPlan.source.provenance?.fromRenderId !== renderId) {
      const { data: photo } = await admin.from('ds_spatial_sources').select('id, kind, canonical, provenance').eq('id', version.source_id).maybeSingle();
      const again = await reconstructSpace(admin, { actorId, authorization: req.headers.get('Authorization') ?? '', project, version, photoSource: photo, renderId, body });
      if (again.state === 'RUNNING') return json({ walkthrough: null, reconstructing: true }, 202);
      if (again.state === 'READY') onPlan = await designOnPlan(admin, version, project.id, renderId) ?? onPlan;
    }
    if (!onPlan) {
      const { data: photo } = await admin.from('ds_spatial_sources').select('id, kind, canonical, provenance').eq('id', version.source_id).maybeSingle();
      const space = await reconstructSpace(admin, { actorId, authorization: req.headers.get('Authorization') ?? '', project, version, photoSource: photo, renderId: body.renderId ?? null, body });
      if (space.state === 'RUNNING') return json({ walkthrough: null, reconstructing: true }, 202);
      if (space.state === 'FAILED') return json({ error: 'SPACE_UNAVAILABLE', reason: space.code }, 409);
      onPlan = await designOnPlan(admin, version, project.id, renderId);
      if (!onPlan) return json({ walkthrough: null, reconstructing: true }, 202);
    }
    ({ version, source } = onPlan);
    lineage = await lineageOf(admin, version.id);
  }
  // A walkthrough walks a floor plan's measured rooms.
  if (!source || source.kind !== 'FLOORPLAN_SCENE' || !source.canonical?.scene?.floors?.length) return json({ error: 'WALKTHROUGH_NEEDS_FLOOR_PLAN', missing: ['WALLS', 'DOORS', 'ROOM_SIZES'] }, 409);
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

  // Money first: the confirmed maximum is held before any provider work (the same key holds it once).
  const money = await reserveWalkthrough(admin, { actorId, projectId: project.id, versionId: String(body.designVersionId), quoteToken: body.quoteToken, key, charged: charging });
  if ('error' in money) return json({ error: money.error }, money.status);

  const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : '';
  const specJobId = typeof version.design_dna?.sourceJobId === 'string' && UUID.test(version.design_dna.sourceJobId) ? version.design_dna.sourceJobId : version.job_id ?? null;
  // ON CONFLICT DO NOTHING: two requests racing for the same key end on one row.
  await admin.from('ds_walkthroughs').upsert({
    project_id: project.id, user_id: actorId, design_version_id: version.id, source_id: source.id, spec_job_id: specJobId,
    render_id: body.renderId ?? null, revision, idempotency_key: key, state: 'QUEUED', billing: money.billing,
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
  let body: { walkthroughId?: string; quoteToken?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.walkthroughId))) return json({ error: 'BAD_REQUEST' }, 400);
  const { data: row } = await caller.from('ds_walkthroughs').select('*').eq('id', body.walkthroughId).maybeSingle();
  if (!row || String(row.user_id) !== actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (row.state !== 'FAILED') return json({ walkthrough: publicOf(row) });
  if (!publicOf(row).retryable) return json({ error: 'NOT_RETRYABLE', walkthrough: publicOf(row) }, 409);
  // A failed walkthrough released its credits: trying again is a new confirmed reservation (the work already
  // saved — a plan, a finished pass — is reused, and only new provider work is measured into its settlement).
  const charging = await billingOn(admin);
  if (charging && body.quoteToken == null) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);
  const money = await reserveWalkthrough(admin, {
    actorId, projectId: row.project_id, versionId: String(row.design_version_id), quoteToken: body.quoteToken,
    key: `${row.idempotency_key}:retry${(Number(row.timings?.manualRetries) || 0) + 1}`, charged: charging,
  });
  if ('error' in money) return json({ error: money.error }, money.status);

  // Resume from the work already saved: a plan is never asked for again, a live provider job is polled again,
  // a finished one is processed again; only a job proven dead is replaced.
  // The new attempt's money; the GPU already in the ledger from earlier attempts is carried, never recorded again.
  const patch: Row = { error: null, lease_at: null, next_check_at: iso(Date.now()), attempts: 0, updated_at: iso(Date.now()), billing: { ...money.billing, ledgeredGpuUsd: Number(row.billing?.ledgeredGpuUsd) || 0 }, timings: { ...row.timings, manualRetries: (row.timings?.manualRetries ?? 0) + 1, retriedAt: iso(Date.now()) } };
  // A walkthrough judged unlike its picture is planned again (told what failed), never re-judged unchanged.
  // A walkthrough built and then judged unlike its picture by the visual check is judged again (the build is kept):
  // the rules of that check may have changed since; a new plan is not needed to look again.
  const visualOnly = row.plan_report?.visualQa?.state === 'FAILED' && row.scene_plan && row.walk_version_id && row.factory_job_id;
  const unlike = !visualOnly && typeof row.error === 'string' && (row.error.startsWith('REFERENCE_') || row.error === 'OVERFURNISHED' || row.error === 'UNDERFURNISHED') && !!row.render_id;
  if (unlike) {
    Object.assign(patch, {
      state: 'QUEUED', plan_attempts: 0, scene_plan: null, walk_version_id: null, factory_job_id: null, provider_job_id: null, submit_attempts: 0, result_attempts: 0,
      timings: { ...patch.timings, replan: { attempt: (Number(row.timings?.replan?.attempt) || 0) + 1, codes: [row.error], feedback: Array.isArray(row.timings?.lastFindings) ? row.timings.lastFindings.slice(0, 12) : [row.error], at: iso(Date.now()) } },
    });
  } else if (visualOnly) {
    const { data: job } = await admin.from('ds_factory_jobs').select('id, state').eq('id', row.factory_job_id).maybeSingle();
    if (job?.state === 'COMPLETED') Object.assign(patch, { state: 'PROCESSING_RESULT', result_attempts: 0 });
    else Object.assign(patch, { state: 'PLANNING', factory_job_id: null, provider_job_id: null, submit_attempts: 0, result_attempts: 0 });
  } else if (row.scene_plan && row.walk_version_id) {
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
async function fail(admin: Row, row: Row, code: string, extra: Row = {}): Promise<void> {
  if (row.factory_job_id) {
    const { data: job } = await admin.from('ds_factory_jobs').select('id, state, provider_job_id').eq('id', row.factory_job_id).maybeSingle();
    if (job && (job.state === 'RUNNING' || job.state === 'QUEUED')) {
      const gpu = factoryConfig();
      const cancelled = gpu && job.provider_job_id ? await cancelProviderJob(gpu, job.provider_job_id) : null;
      await abandonJob(admin, job.id, code, cancelled === null ? null : `CANCEL_${cancelled}`);
    }
  }
  await release(admin, row, { ...extra, state: 'FAILED', error: code.slice(0, 120), stage: null, timings: { ...row.timings, ...(extra.timings ?? {}), failedAt: iso(Date.now()) } });
  await closeWalkthroughBilling(admin, row.id, 'RELEASE');
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
  const { data: source } = await admin.from('ds_spatial_sources').select('id, kind, canonical, provenance').eq('id', version.source_id).maybeSingle();
  const scene = source?.canonical?.scene;
  if (!scene?.floors?.length || !Array.isArray(scene.walls)) return null;
  return { version, source, space: buildSpaceModel(scene) };
}

/**
 * The geometry check of a space reconstructed from pictures: the one recorded with it, or — for a space recorded
 * before the check existed — made now from what it holds (its floors, its reading's pieces, the photo reading of the
 * customer's picture). Null for a measured plan (it is the drawing, not a reading of pictures).
 */
async function geometryOf(admin: Row, design: Loaded): Promise<GeometryCheck | null> {
  const prov = design.source?.provenance;
  if (prov?.inferred !== true) return null;
  if (prov.geometryCheck?.version === GEOMETRY_CHECK_VERSION) return prov.geometryCheck as GeometryCheck;
  const { data: photo } = prov.fromSourceId
    ? await admin.from('ds_spatial_sources').select('canonical').eq('id', prov.fromSourceId).maybeSingle()
    : { data: null };
  return checkGeometry({
    rooms: roomsOfScene(design.source.canonical.scene.floors),
    pieces: readFurnishing(prov.furnishing)?.objects ?? [],
    expected: expectedOfUnderstanding(photo?.canonical?.understanding),
    unreachable: Array.isArray(prov.unreachable) ? prov.unreachable : [],
    repairs: Array.isArray(prov.repairs) ? prov.repairs : [],
    // Its measured outline was recorded in the reading's frame, not the scene's: not compared.
    footprint: null,
  });
}

async function catalogue(admin: Row): Promise<{ assets: CatalogAsset[]; materials: CatalogMaterial[] }> {
  const { data: a } = await admin.from('ds_catalog_assets').select('*').eq('active', true).limit(2000);
  const { data: m } = await admin.from('ds_catalog_materials')
    .select('id, code, name, category, applies_to, style_tags, color_family, color_tags, color_families, search_aliases, pbr, thumbnail_key, provenance, is_placeholder, active')
    .eq('active', true).overlaps('applies_to', ['FLOOR', 'WALL']).limit(2000);
  return { assets: (a ?? []).map(assetFromRow), materials: (m ?? []).map((r: Row) => ({ ...materialFromRow(r), colorTags: Array.isArray(r.color_tags) ? r.color_tags : [] })) };
}

// ── The selected picture (reference-locked walkthroughs) ──────────────────────

interface Reference {
  /** Provenance kept on the row (timings.reference): what was reconstructed, exactly. */
  provenance: {
    referenceImageId: string; referenceAssetKey: string; referenceImageSha256: string; bytes: number; mime: string; aspect: number | null;
    renderKind: string; viewKind: 'ROOM' | 'MASTER'; viewRoomId: string | null;
    sourceDesignVersionId: string | null; generationJobId: string | null; sceneMapJobId: string | null; designVersionId: string; loadedAt: string;
  };
  dataUrl: string;
  /** The render's own bytes (its pixels are measured per region: designEvidence.ts). Never stored. */
  bytes: Uint8Array;
  sceneMap: ReferenceInput['sceneMap'];
}

/**
 * The walkthrough's selected picture: the owner's READY render of this project, its bytes (hashed: the same
 * picture, provably), what HOMATCH knows of its view, and the scene map made when it was generated.
 */
async function loadReference(admin: Row, row: Row): Promise<Reference | { code: string; transient: boolean }> {
  const { data: r } = await admin.from('ds_renders').select('id, project_id, user_id, version_id, kind, view, status, final_key, finish').eq('id', row.render_id).maybeSingle();
  if (!r || r.project_id !== row.project_id || String(r.user_id) !== String(row.user_id)) return { code: 'REFERENCE_NOT_FOUND', transient: false };
  if (r.status !== 'READY' || typeof r.final_key !== 'string') return { code: 'REFERENCE_NOT_READY', transient: false };
  const res = await getObject(r.final_key).catch(() => null);
  if (!res?.ok) { await res?.arrayBuffer().catch(() => null); return { code: 'REFERENCE_UNAVAILABLE', transient: true }; }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime || bytes.length > MAX_SPACE_BYTES) return { code: 'REFERENCE_UNREADABLE', transient: false };
  const { data: jobs } = await admin.from('ds_jobs').select('id, output, user_id').eq('project_id', row.project_id).eq('kind', 'RENDER').eq('status', 'SUCCEEDED')
    .eq('input->>renderId', r.id).order('created_at', { ascending: false }).limit(3);
  const job = (jobs ?? []).find((j: Row) => j.output?.kind === 'SCENE_MAP' && String(j.user_id) === String(row.user_id));
  // The map's own labels are a fixed vocabulary; its room ids are cleaned where they are shown.
  const sceneMap = (job ? validateScene(job.output) : []).filter((e) => e.kind === 'OBJECT').slice(0, 40).map((e) => {
    const xs = e.outline.map((p) => p[0]); const ys = e.outline.map((p) => p[1]);
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    return { label: e.label, room: e.room, at: [r3((Math.min(...xs) + Math.max(...xs)) / 2), r3(Math.max(...ys))] as [number, number], size: [r3(Math.max(...xs) - Math.min(...xs)), r3(Math.max(...ys) - Math.min(...ys))] as [number, number] };
  });
  const viewKind: 'ROOM' | 'MASTER' = r.view?.kind === 'MASTER' || (r.view?.kind !== 'ROOM' && r.kind === 'MASTER') ? 'MASTER' : 'ROOM';
  return {
    provenance: {
      referenceImageId: r.id, referenceAssetKey: r.final_key, referenceImageSha256: await sha256Hex(bytes), bytes: bytes.length, mime, aspect: imageAspect(bytes),
      renderKind: String(r.kind), viewKind, viewRoomId: typeof r.view?.roomId === 'string' ? r.view.roomId : null,
      sourceDesignVersionId: r.version_id ?? null, generationJobId: typeof r.finish?.specJobId === 'string' ? r.finish.specJobId : row.spec_job_id ?? null,
      sceneMapJobId: job?.id ?? null, designVersionId: row.design_version_id, loadedAt: iso(Date.now()),
    },
    dataUrl: `data:${mime};base64,${b64(bytes)}`,
    bytes,
    sceneMap,
  };
}

/** The home frame the model places a dollhouse camera in: its size and each room's origin in it. */
function homeOf(space: SpaceModel): ReferenceInput['home'] {
  const o = homeOrigin(space);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    widthM: r3(Math.max(...space.rooms.map((r) => r.bounds.maxX)) - o.x), depthM: r3(Math.max(...space.rooms.map((r) => r.bounds.maxY)) - o.y),
    origins: space.rooms.map((r) => ({ id: r.id, x: r3(r.bounds.minX - o.x), y: r3(r.bounds.minY - o.y) })),
  };
}

async function plan(admin: Row, row: Row): Promise<void> {
  const design = await loadDesign(admin, row);
  if (!design) { await fail(admin, row, 'NO_SPACE_MODEL'); return; }
  const { version, space } = design;
  // A space reconstructed from pictures is the home only if its geometry says so: checked before a single piece is
  // placed or a GPU second is bought. A failed check is final for this space (the same evidence gives the same
  // verdict), and says exactly what is missing (geometryCheck.ts).
  const geometry = await geometryOf(admin, design);
  if (geometry && geometry.verdict === 'FAIL') {
    await fail(admin, row, 'GEOMETRY_UNRELIABLE', {
      timings: { ...row.timings, geometryCheck: geometry, lastFindings: [...new Set(geometry.issues.filter((x) => x.blocking).map((x) => x.code))] },
      plan_report: { final: { geometry } },
    });
    return;
  }
  const dna = version.design_dna?.version === 'ds-dna-1' ? version.design_dna : null;
  const preferences = normalizePreferences(dna?.preferences ?? null);
  // A space read from the selected render carries that render's pieces: the walkthrough is furnished with exactly
  // them (no scene-plan call), walked, and promoted only on both verdicts (planFromRender).
  const furnishing = readFurnishing(design.source?.provenance?.furnishing);
  if (furnishing && row.render_id && furnishing.renderId === String(row.render_id)) { await planFromRender(admin, row, design, furnishing, preferences.style ?? null); return; }
  let spec: Row = null;
  if (row.spec_job_id) {
    const { data: job } = await admin.from('ds_jobs').select('output, status, user_id').eq('id', row.spec_job_id).maybeSingle();
    if (job?.status === 'SUCCEEDED' && String(job.user_id) === String(row.user_id)) spec = job.output?.spec ?? null;
  }
  // The selected picture: the ground truth of a reference-locked walkthrough. Never silently a generic plan instead.
  const loaded = row.render_id ? await loadReference(admin, row) : null;
  if (loaded && 'code' in loaded) {
    if (loaded.transient) await release(admin, row, { error: loaded.code, next_check_at: iso(Date.now() + 60_000) });
    else await fail(admin, row, loaded.code);
    return;
  }
  const reference = loaded;
  const provenance = reference ? { ...reference.provenance, sourceId: version.source_id } : null;
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
  const home = homeOf(space);
  const view = provenance ? { kind: provenance.viewKind, roomId: provenance.viewRoomId } : null;
  const replan = row.timings?.replan ?? null;
  // The cache key: the immutable inputs of a reference-locked plan. A plan is never reused for another picture.
  const planKey = provenance ? await sha256Hex(`ds-walk-plan:v2:${provenance.referenceImageSha256}:${row.spec_job_id ?? '-'}:${version.id}:${version.source_id}`) : null;

  const started = Date.now();
  let payload: Row = null;
  let reused: ValidatedScenePlan | null = null;
  let reusedFrom: string | null = null;
  let reuseRefused: string | null = null;
  const keepRooms = (plan0: ValidatedScenePlan) => { const ids = new Set(space.rooms.map((r) => r.id)); return { ...plan0, rooms: plan0.rooms.filter((r) => ids.has(r.roomId)) }; };
  if (typeof row.timings?.reusePlanFrom === 'string') {
    // The plan an earlier walkthrough of this design made: the same rooms, the same choices, no new model call —
    // only for the same picture (or, both without one, the same specification). Every pose is placed again below.
    const { data: w } = await admin.from('ds_walkthroughs').select('scene_plan, project_id, timings').eq('id', row.timings.reusePlanFrom).maybeSingle();
    const plan0 = w?.project_id === row.project_id ? w?.scene_plan as ValidatedScenePlan | null : null;
    if (plan0?.rooms && (w?.timings?.reference?.referenceImageSha256 ?? null) === (provenance?.referenceImageSha256 ?? null)) { reused = keepRooms(plan0); reusedFrom = row.timings.reusePlanFrom; }
    else if (plan0?.rooms) reuseRefused = 'DIFFERENT_PICTURE';
  }
  if (!reused && planKey && !replan) {
    // The same picture, the same specification, the same geometry, already planned: reused — the plan of a READY
    // walkthrough, or the paid plan a failed one kept (it failed after planning; the builder may since be fixed).
    const { data: same } = await admin.from('ds_walkthroughs').select('id, state, scene_plan, plan_report').eq('project_id', row.project_id).in('state', ['READY', 'FAILED'])
      .eq('timings->>planKey', planKey).neq('id', row.id).order('created_at', { ascending: false }).limit(3);
    const hit = (same ?? []).map((w: Row) => ({ id: w.id, plan: w.state === 'READY' ? w.scene_plan : w.plan_report?.final?.scenePlan ?? null }))
      .find((x: Row) => x.plan?.rooms && x.plan.reference);
    if (hit) { reused = keepRooms(hit.plan); reusedFrom = hit.id; }
  }
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!reused && !apiKey) { await release(admin, row, { error: 'PLAN_UNAVAILABLE', next_check_at: iso(Date.now() + 60_000) }); return; }
  const refInput: ReferenceInput | null = reference && view ? {
    imageDataUrl: reference.dataUrl, view, home, aspect: reference.provenance.aspect, sceneMap: reference.sceneMap,
    feedback: Array.isArray(replan?.feedback) ? replan.feedback.filter((f: unknown): f is string => typeof f === 'string') : null,
  } : null;
  // The plan is asked for in OpenAI's background queue and collected on a later step: a reasoning call of two
  // minutes never races the edge runtime's wall clock, and a paid answer is never lost with a killed invocation.
  // Waiting for it is not a plan attempt; a model that refuses background mode is asked as before.
  const pending = row.timings?.planResponse as { id?: string; at?: string } | undefined;
  if (!reused && pending?.id) {
    const got = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(pending.id)}`, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const waiting = !got || got.status === 'queued' || got.status === 'in_progress';
    if (waiting && Date.now() - Date.parse(pending.at ?? '') < PLAN_RESPONSE_MAX_MS) {
      await release(admin, row, { plan_attempts: Math.max(0, row.plan_attempts - 1), next_check_at: iso(Date.now() + PLAN_RESPONSE_POLL_MS) });
      return;
    }
    payload = got?.status === 'completed' ? got : null;
  } else if (!reused) try {
    const body = refInput ? referenceSceneRequest(MODEL, input, refInput) : sceneRequest(MODEL, input);
    const ask = (extra: Row) => fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }),
    });
    const queued = await ask({ background: true, store: true });
    const made = queued.ok ? await queued.json() : null;
    if (made?.id && (made.status === 'queued' || made.status === 'in_progress')) {
      await release(admin, row, { timings: { ...row.timings, planResponse: { id: made.id, at: iso(Date.now()) } }, next_check_at: iso(Date.now() + PLAN_RESPONSE_POLL_MS) });
      return;
    }
    if (made) payload = made.status === 'completed' ? made : null;
    else if (queued.status === 400) { const r = await ask({}); payload = r.ok ? await r.json() : null; }
  } catch { payload = null; }
  const text = payload ? textOf(payload) : '';
  let raw: unknown = null;
  try { raw = text ? JSON.parse(text) : null; } catch { raw = null; }
  const validated: ValidatedScenePlan | null = reused ?? (raw ? validateScenePlan(raw, input, refInput ? { reference: { view: refInput.view, home } } : {}) : null);
  const step = refInput ? (replan ? 'walkthrough_reference_replan' : 'walkthrough_reference_plan') : 'walkthrough_scene_plan';
  // Asked in the background: its time runs from when it was asked.
  const askedAt = pending?.at && !reused ? Date.parse(pending.at) || started : started;
  const aiCost = payload ? await meterAiCall(admin, { userId: row.user_id, productCode: WALK_PRODUCT, jobRef: row.id, model: MODEL, startedAt: askedAt }, payload, { step, walkthrough: row.id, ...(pending?.id ? { background: true } : {}) }) : null;
  const costLine = reused
    ? { kind: 'OPENAI_SCENE_PLAN', model: null, usd: 0, basis: 'REUSED', reusedFrom, tokens: null, ms: 0, attempt: row.plan_attempts }
    : { kind: 'OPENAI_SCENE_PLAN', model: MODEL, usd: aiCost?.aiCents == null ? null : aiCost.aiCents / 100, basis: aiCost?.aiCents == null ? 'NOT_AVAILABLE' : 'ESTIMATED', tokens: payload?.usage ?? null, ms: Date.now() - askedAt, attempt: row.plan_attempts, step };
  const cost = [...(Array.isArray(row.cost) ? row.cost : []), ...(payload || reused ? [costLine] : [])];
  const { planResponse: _answered, ...earlier } = (row.timings ?? {}) as Row;
  const timings = { ...earlier, ...(provenance ? { reference: provenance, planKey } : {}) };
  if (!validated || !validated.rooms.length) {
    await release(admin, row, { error: payload ? 'PLAN_INVALID' : 'PLAN_UNAVAILABLE', cost, timings, next_check_at: iso(Date.now() + 15_000) });
    return;
  }

  // The walkable design: HOMATCH's engine places, validates and finishes it; the picture's anchors are locked.
  const assets = new Map(cat.assets.map((a) => [a.code, a]));
  const byCode = new Map(cat.materials.map((m) => [m.code, m]));
  const byId = new Map(cat.materials.map((m) => [m.id, m]));
  const base = normalizeDesignState(version.state);
  const roomsById = new Map(space.rooms.map((r) => [r.id, r]));
  const buildStarted = Date.now();
  // THE SELECTED DESIGN AS A GRAPH (walkthrough/designGraph.ts): the render's scene map, legend and measured
  // pixels, the specification's words and the plan's poses. With it, the walkthrough is built from what the render
  // shows — nothing invented, every piece in its design form and colours; without it (no render evidence), the plan.
  const evidence = reference ? await loadDesignEvidence(admin, row, space, version.source_id, reference.bytes).catch(() => null) : null;
  const graph: SpatialDesignGraph | null = evidence && evidence.sourceRooms.length && evidence.sceneMap.some((e) => e.kind === 'OBJECT')
    ? buildDesignGraph({
      space, spec, sceneMap: evidence.sceneMap, legend: evidence.legend, sourceRooms: evidence.sourceRooms, scenePlan: validated, appearance: evidence.appearance,
      source: { renderId: String(row.render_id), sceneMapJobId: provenance?.sceneMapJobId ?? null, specJobId: row.spec_job_id ?? null },
    })
    : null;
  const graphPlan = graph ? { ...graphToBuildPlan(graph, space, cat.materials, assets), styleCode: preferences.style } : null;
  const built = buildWalkthrough({
    space, base, assets, materialsByCode: byCode, materialsById: byId, idPrefix: `walk-${row.revision}`,
    plan: graphPlan ?? {
      lighting: validated.lighting, palette: validated.palette, styleCode: preferences.style,
      rooms: validated.rooms.map((pr) => ({
        ...pr,
        items: pr.items.map((it) => ({ ...it, refKey: it.ref?.key ?? null, lock: it.ref?.locked && roomsById.has(pr.roomId) ? anchorLock(roomsById.get(pr.roomId)!) : null })),
      })),
    },
  });
  const buildMs = Date.now() - buildStarted;
  // The design's look on the built pieces, and the promotion gate: is this, measurably, the selected design?
  const walkState: DesignState = graph ? applyGraphLook(graph, space, built.state, built.report, assets) : built.state;
  const promotion: Promotion | null = graph ? fidelityOf(graph, walkState, built.report, built.report.gate?.ok !== false) : null;
  // The gates: walkability always (walkthrough/walkability.ts); against the picture when there is one (fidelity.ts)
  // — for a graph build, its own promotion gate replaces the plan-vs-anchor comparison.
  const fidelity: FidelityReport | null = validated.reference && !graph
    ? referenceFidelity({ space, plan: validated, build: built.report, objects: built.state.objects, assets, aspect: provenance?.aspect ?? null })
    : null;
  // READY only when it is the design too: every room has what makes it that room (a bed, the sofa, the kitchen),
  // and most of what the design shows stands in it (designGraph.ts READY_MIN_RECALL); else it fails, honestly.
  const unfaithful = promotion && (built.report.gate?.missingEssential?.length || (promotion.metrics?.importantRecall ?? 1) < READY_MIN_RECALL);
  const failing = fidelity ? fidelity.code : built.report.gate && !built.report.gate.ok ? 'NOT_WALKABLE' : unfaithful ? 'NOT_FAITHFUL' : null;
  const referenceReport = validated.reference ? {
    mode: 'REFERENCE_LOCKED', view: validated.reference.view, roomId: validated.reference.roomId, visibleRoomIds: validated.reference.visibleRoomIds,
    camera: validated.reference.camera, cameraNote: validated.reference.cameraNote, facts: validated.reference.facts, fidelity,
    replans: replan ? Number(replan.attempt) || 1 : 0, reusedFrom, reuseRefused, sceneMapElements: reference?.sceneMap.length ?? 0, buildMs,
  } : { mode: 'SPECIFICATION', reusedFrom, reuseRefused, buildMs };
  if (failing) {
    // The paid plan is kept with the failure: the same picture is never planned (and paid for) twice, and the
    // build can be reproduced exactly.
    const summary = { build: { counts: built.report.counts, gate: built.report.gate, relocated: built.report.relocated }, reference: referenceReport, dropped: validated.dropped, scenePlan: validated };
    // One replan, told exactly what failed (codes and numbers made here), in its own invocation; then the failure stands.
    if (fidelity && !replan && row.plan_attempts < MAX_PLAN_ATTEMPTS) {
      await release(admin, row, {
        state: 'PLANNING', error: failing, cost, plan_report: { firstAttempt: summary }, next_check_at: iso(Date.now()),
        timings: { ...timings, replan: { attempt: 1, codes: fidelity.codes, feedback: feedbackOf(fidelity), at: iso(Date.now()) } },
      });
      return;
    }
    await fail(admin, row, failing, {
      cost, plan_report: { ...(row.plan_report?.firstAttempt ? { firstAttempt: row.plan_report.firstAttempt } : {}), final: summary },
      timings: { ...timings, lastFindings: fidelity ? feedbackOf(fidelity) : [failing] },
    });
    return;
  }

  // Saved as its own version of the design (the approved one is never touched); the same id on a re-plan.
  const walkId = await uuidFrom(`ds-walk:${row.id}:version`);
  const name = (typeof row.timings?.name === 'string' && row.timings.name) || `3D ${row.revision}`;
  const { error: insertErr } = await admin.from('ds_versions').upsert({
    id: walkId, project_id: version.project_id, user_id: version.user_id, source_id: version.source_id, parent_id: version.id,
    name, origin: 'AI', job_id: version.job_id, state: walkState, style_tags: version.style_tags ?? [],
    change_summary: [{ kind: 'WALKTHROUGH', walkthroughId: row.id, revision: row.revision, plan: validated.version, ...(provenance ? { referenceImageId: provenance.referenceImageId, referenceImageSha256: provenance.referenceImageSha256 } : {}) }],
    design_dna: version.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (insertErr) { await release(admin, row, { error: 'VERSION_NOT_RECORDED', cost, timings, next_check_at: iso(Date.now() + 15_000) }); return; }
  await admin.from('ds_versions').update({ state: walkState }).eq('id', walkId);

  const report = {
    build: built.report, dropped: validated.dropped, filled: validated.filled, approximations: validated.approximations, omitted: validated.omitted,
    rooms: validated.rooms.length, model: reused ? null : MODEL, offer: offered.offer, planMs: Date.now() - started, reusedFrom,
    reference: referenceReport, ...(row.plan_report?.firstAttempt ? { firstAttempt: row.plan_report.firstAttempt } : {}),
    // The selected design as built: its graph (for audit), what was read, the promotion verdict, and the pieces it
    // binds (the factory never swaps them for generic models).
    designGraph: graph ? {
      version: graph.version, source: graph.source, roomMap: graph.roomMap, evidence: evidence?.report ?? null, promotion,
      bound: built.report.items.filter((i) => i.refKey && i.instanceId).map((i) => i.instanceId), graph,
    } : (reference ? { version: null, promotion: { promoted: false, reasons: ['NO_DESIGN_GRAPH'], metrics: null }, evidence: evidence?.report ?? null } : null),
  };
  await release(admin, row, {
    state: 'PLANNING', scene_plan: validated, plan_report: report, walk_version_id: walkId, cost, error: null, next_check_at: iso(Date.now()), timings,
  });
}

/**
 * The walkthrough of the selected render, furnished from its own pieces (renderPlan.ts): matched or drawn at their
 * seen size and form, settled where the render shows them, turned to their context, walked by the walker's body
 * (pieces in a required way pushed off it as little as clears it, every correction recorded), and promoted only
 * when it is both the render (VISUAL) and walkable (NAVIGATION) — renderGate.ts. No model call is made here.
 */
async function planFromRender(admin: Row, row: Row, design: Loaded, furnishing: RenderFurnishing, styleCode: string | null): Promise<void> {
  const { version, space } = design;
  const started = Date.now();
  const cat = await catalogue(admin);
  const assets = new Map(cat.assets.map((a) => [a.code, a]));
  const materialsByCode = new Map(cat.materials.map((m) => [m.code, m]));
  const materialsById = new Map(cat.materials.map((m) => [m.id, m]));
  // Lit as the render is (its measured light); without a measurement, the light every walkthrough had before.
  const rp = planFromFurnishing(furnishing, space, cat.assets, cat.materials, { lighting: furnishing.lighting ?? NEUTRAL_LIGHTING, styleCode });
  const built = buildWalkthrough({
    space, base: normalizeDesignState(version.state), assets, materialsByCode, materialsById, idPrefix: `walk-${row.revision}`, plan: rp.plan,
    walkRadiusM: RENDER_WALK_RADIUS_M, anchorsAsSeen: true,
  });
  const dressed = dressBuilt(built.state, built.report.items, rp, space, assets);
  const gate = renderGate({ space, state: dressed.state, assets, build: built.report, plan: rp, walkRadiusM: RENDER_WALK_RADIUS_M, corrections: dressed.corrections });
  const costLine = { kind: 'RENDER_FURNISHING', model: null, usd: 0, basis: 'NO_MODEL_CALL', tokens: null, ms: Date.now() - started, attempt: row.plan_attempts };
  const cost = [...(Array.isArray(row.cost) ? row.cost : []), costLine];
  const reference = {
    mode: 'RENDER_FURNISHED', renderId: furnishing.renderId, read: furnishing.read, traced: furnishing.traced,
    unmatched: rp.unmatched, unplaced: rp.unplaced, gate, buildMs: Date.now() - started,
  };
  const timings = { ...row.timings, renderFurnishing: { version: furnishing.version, renderId: furnishing.renderId, sourceId: version.source_id } };
  if (!gate.promoted) {
    const code = !gate.navigation.pass ? 'NOT_WALKABLE' : 'NOT_FAITHFUL';
    await fail(admin, row, code, {
      cost, timings: { ...timings, lastFindings: [...gate.visual.reasons, ...gate.navigation.reasons] },
      plan_report: { final: { build: { counts: built.report.counts, gate: built.report.gate, relocated: built.report.relocated }, reference } },
    });
    return;
  }
  const walkId = await uuidFrom(`ds-walk:${row.id}:version`);
  const name = (typeof row.timings?.name === 'string' && row.timings.name) || `3D ${row.revision}`;
  const { error: insertErr } = await admin.from('ds_versions').upsert({
    id: walkId, project_id: version.project_id, user_id: version.user_id, source_id: version.source_id, parent_id: version.id,
    name, origin: 'AI', job_id: version.job_id, state: dressed.state, style_tags: version.style_tags ?? [],
    change_summary: [{ kind: 'WALKTHROUGH', walkthroughId: row.id, revision: row.revision, plan: furnishing.version, renderId: furnishing.renderId }],
    design_dna: version.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (insertErr) { await release(admin, row, { error: 'VERSION_NOT_RECORDED', cost, timings, next_check_at: iso(Date.now() + 15_000) }); return; }
  await admin.from('ds_versions').update({ state: dressed.state }).eq('id', walkId);
  await release(admin, row, {
    state: 'PLANNING',
    // The plan of record: the render's pieces as built (no camera: the render's own frame is not a perspective view).
    scene_plan: { version: furnishing.version, renderId: furnishing.renderId, rooms: rp.plan.rooms, reference: null },
    plan_report: { build: built.report, reference, planMs: Date.now() - started, model: null },
    walk_version_id: walkId, cost, error: null, next_check_at: iso(Date.now()), timings,
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
  // A reference-locked walkthrough is also rendered from the picture's own (estimated) camera, for the visual check;
  // an eye inside a piece is moved to the nearest free spot.
  const cam = (row.scene_plan as ValidatedScenePlan | null)?.reference?.camera ?? null;
  const model = cam && cam.frame !== 'HOME' ? buildWalkModel(design.space, state.objects, assets) : null;
  const pose = cam ? referenceCameraPose(design.space, cam, Number(row.timings?.reference?.aspect) || 16 / 9, model ? (p) => (isFree(model, p) ? p : nearestFree(model, p, 0.6)) : undefined) : null;
  const camera = pose ? { position: pose.position, target: pose.target, fov: pose.fov, near: pose.near, far: pose.far, aspect: pose.aspect, background: pose.background, cut: pose.cut } : null;
  const compiled = compileSceneSpec({
    space: design.space, state, assets, materials,
    source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' },
    camera, ...(camera ? { render: { edge: 1024, samples: 48 } } : {}), outputs: { render: !!camera, scene: false, objects: true },
  });
  try { return { spec: validateSceneSpec(JSON.parse(JSON.stringify(compiled))), state }; } catch (e) { return { error: `BAD_SPEC_${e instanceof SpecError ? e.path : 'UNKNOWN'}`.slice(0, 120) }; }
}

async function submit(admin: Row, row: Row): Promise<void> {
  const gpu = factoryConfig();
  if (!gpu) { await release(admin, row, { error: 'FACTORY_NOT_CONFIGURED', next_check_at: iso(Date.now() + 120_000) }); return; }
  // Charging on: provider work starts only on a held reservation (a walkthrough made before charging was switched on has none).
  if ((await billingOn(admin)) && row.billing?.state !== 'RESERVED') { await fail(admin, row, 'BILLING_CONFIRMATION_REQUIRED'); return; }
  const built = await walkableSpec(admin, row);
  if ('error' in built) { await fail(admin, row, built.error); return; }
  // Nothing for the factory to build (every piece is drawn by the walkthrough itself): ready as it is.
  if (!built.spec.objects.some((o) => o.runtime && o.group) && !built.spec.outputs.render) {
    await release(admin, row, { state: 'READY', stage: 'NO_FACTORY_PIECES', ready_at: iso(Date.now()), error: null, timings: { ...row.timings, readyAt: iso(Date.now()) } });
    await closeWalkthroughBilling(admin, row.id, 'SETTLE');
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
  // Pieces built from the selected design are drawn by HOMATCH in their design form: never a generic factory model.
  const bound = new Set<string>(Array.isArray(row.plan_report?.designGraph?.bound) ? row.plan_report.designGraph.bound : []);
  for (const obj of state.objects) {
    const g = groupOf.get(obj.instanceId);
    if (!g || bound.has(obj.instanceId)) continue;
    const ref = pieces[g];
    if (ref?.assetId && ref.key) { obj.generated = { assetId: ref.assetId, key: ref.key, sha256: ref.sha256 ?? null }; attached += 1; } else { delete obj.generated; missing += 1; }
  }
  await admin.from('ds_versions').update({ state }).eq('id', walk.id);

  // A reference-locked walkthrough: the picture's viewpoint, rendered, against the picture.
  const visual = (row.scene_plan as ValidatedScenePlan | null)?.reference ? await referenceViewQa(admin, row, settled.outputs?.render ?? null, state) : null;

  const persisted = Number(settled.result?.persistedBytes ?? 0) || 0;
  const gpuLines = (Array.isArray(settled.cost) ? settled.cost : []).map((c: Row) => ({ kind: 'RUNPOD_GPU', usd: c.usd ?? null, basis: c.basis ?? 'NOT_AVAILABLE', detail: c.detail ?? null, executionMs: settled.timings?.executionMs ?? null, queueMs: settled.timings?.queueAndColdStartMs ?? null }));
  const storage = { kind: 'STORAGE', bytes: persisted, usdPerMonth: Math.round((persisted / 1e9) * STORAGE_USD_PER_GB_MONTH * 1e6) / 1e6, basis: 'ESTIMATED' };
  // Every factory pass that ran is a GPU cost (a resubmitted one too): only this pass's own lines are replaced.
  const cost = [...(Array.isArray(row.cost) ? row.cost.filter((c: Row) => (c.kind !== 'RUNPOD_GPU' || !String(c.detail ?? '').includes(String(job.id))) && c.kind !== 'STORAGE' && c.kind !== 'OPENAI_REFERENCE_QA') : []), ...gpuLines, storage, ...(visual?.costLine ? [visual.costLine] : [])];
  const factoryReport = { pieces: Object.keys(pieces).length, attached, missing, persistedBytes: persisted };
  if (visual?.summary.state === 'FAILED' && visual.summary.code) {
    await fail(admin, row, visual.summary.code, {
      cost, plan_report: { ...(row.plan_report ?? {}), factory: factoryReport, visualQa: visual.summary },
      timings: { lastFindings: [`${visual.summary.code}: the reconstruction rendered from the picture's viewpoint does not match it (layout ${visual.summary.scores?.layout ?? '?'}/10, ${visual.summary.missingHigh ?? 0} clearly missing pieces)`] },
    });
    return;
  }
  await release(admin, row, {
    state: 'READY', stage: null, error: null, cost, ready_at: iso(Date.now()),
    plan_report: { ...(row.plan_report ?? {}), factory: factoryReport, ...(visual ? { visualQa: visual.summary } : {}) },
    timings: { ...row.timings, readyAt: iso(Date.now()), factory: settled.timings ?? null },
  });
  await closeWalkthroughBilling(admin, row.id, 'SETTLE');
}

/**
 * The reference view, checked: the factory's render from the picture's camera against the picture itself (bytes
 * re-read and proven the same by their hash). One metered vision call; its structured answer is kept. Never
 * faked: no render, no key or no answer is recorded as what it is (NOT_RUN / UNAVAILABLE), not as a pass.
 */
async function referenceViewQa(admin: Row, row: Row, render: Row | null, state: DesignState): Promise<{ summary: Row; costLine: Row | null }> {
  const prov = row.timings?.reference;
  if (!render?.key) return { summary: { state: 'NOT_RUN', reason: 'NO_RENDER' }, costLine: null };
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey || typeof prov?.referenceAssetKey !== 'string') return { summary: { state: 'UNAVAILABLE', reason: apiKey ? 'NO_REFERENCE' : 'NO_AI' }, costLine: null };
  const read = async (key: string) => {
    const res = await getObject(key).catch(() => null);
    if (!res?.ok) { await res?.arrayBuffer().catch(() => null); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = sniffImage(bytes);
    return mime && bytes.length <= MAX_SPACE_BYTES ? { bytes, mime } : null;
  };
  const src = await read(prov.referenceAssetKey);
  if (!src || await sha256Hex(src.bytes) !== prov.referenceImageSha256) return { summary: { state: 'UNAVAILABLE', reason: 'REFERENCE_CHANGED' }, costLine: null };
  const img = await read(String(render.key));
  if (!img) return { summary: { state: 'UNAVAILABLE', reason: 'RENDER_UNREADABLE', renderAssetId: render.assetId ?? null }, costLine: null };
  const objects = state.objects.slice(0, 120).map((o) => [o.instanceId, o.assetId, o.roomId]);
  const started = Date.now();
  let payload: Row = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: QA_MODEL,
        input: [{ role: 'system', content: REFERENCE_QA_SYSTEM }, { role: 'user', content: [
          { type: 'input_text', text: `Objects in the reconstruction (key, catalogue code, room): ${JSON.stringify(objects).slice(0, 20000)}` },
          { type: 'input_text', text: 'SOURCE (the approved design picture):' }, { type: 'input_image', image_url: `data:${src.mime};base64,${b64(src.bytes)}` },
          { type: 'input_text', text: 'RENDER (the reconstruction from the same viewpoint):' }, { type: 'input_image', image_url: `data:${img.mime};base64,${b64(img.bytes)}` },
        ] }],
        text: { format: { type: 'json_schema', name: 'ds_qa', strict: false, schema: QA_SCHEMA } },
        reasoning: { effort: 'medium' },
      }),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  const cost = payload ? await meterAiCall(admin, { userId: row.user_id, productCode: WALK_PRODUCT, jobRef: row.id, model: QA_MODEL, startedAt: started }, payload, { step: 'walkthrough_reference_qa', walkthrough: row.id }) : null;
  const costLine = payload ? { kind: 'OPENAI_REFERENCE_QA', model: QA_MODEL, usd: cost?.aiCents == null ? null : cost.aiCents / 100, basis: cost?.aiCents == null ? 'NOT_AVAILABLE' : 'ESTIMATED', tokens: payload?.usage ?? null, ms: Date.now() - started } : null;
  const text = payload ? textOf(payload) : '';
  let raw: unknown = null;
  try { raw = text ? JSON.parse(text) : null; } catch { raw = null; }
  if (!raw) return { summary: { state: 'UNAVAILABLE', reason: payload ? 'BAD_ANSWER' : 'NO_ANSWER', renderAssetId: render.assetId ?? null }, costLine };
  const qa = validateQaReport(raw);
  const verdict = visualVerdict(qa);
  const byCode: Record<string, number> = {};
  for (const e of qa.errors) byCode[e.code] = (byCode[e.code] ?? 0) + 1;
  return {
    summary: {
      state: !verdict.reliable ? 'UNRELIABLE' : verdict.ok ? 'PASSED' : 'FAILED', code: verdict.code, codes: verdict.codes, missingHigh: verdict.missingHigh,
      scores: qa.scores, errors: byCode, renderAssetId: render.assetId ?? null, renderSha256: render.sha256 ?? null, model: QA_MODEL, ms: Date.now() - started,
    },
    costLine,
  };
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
