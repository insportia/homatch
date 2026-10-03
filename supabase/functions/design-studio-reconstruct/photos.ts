// HOMATCH DESIGN STUDIO — UNDERSTAND THE CUSTOMER'S PHOTOS (server-owned).
//
// POST …/design-studio-reconstruct/photos { reconstructionId, language?, originalName?, retry? }
//   → 202 { state: 'RUNNING' }                         the reading is under way (started now, or already)
//   → 200 { state: 'READ', sourceId, versionId }       understood; the project's photo source exists
//   → 200 { state: 'FAILED', reason, retryable }       stored failure (retry: true asks again)
//
// The photos were uploaded (ds_floorplans rows, purpose REFERENCE) and
// grouped into a ds_reconstructions row by the browser. This route claims that
// row (compare-and-set), answers at once and reads in the background
// (durable.ts): navigating away, refreshing or a phone sleeping never stops
// it, and asking again never starts a second paid reading.
//
// ALL photos go to OpenAI in ONE reading (photoRead.ts): same room from
// several angles vs different rooms, fixed architecture, only the questions
// that matter. Nothing is reconstructed: no 3D home, no catalogue, no Blender,
// no RunPod. On success the project gets a PHOTO_SET spatial source (the
// photos + the understanding) and its Original version, so the OpenAI-first
// generation (generate.ts) designs over the photos directly.
//
// Money: metered as DS_RECONSTRUCT usage, never charged while
// design_studio_billing_enabled is false (and refused if it is switched on
// before a confirmation flow exists).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { getObject, headObject } from '../_shared/objectStore.ts';
import { imageSize, sniffType } from '../_shared/designStudio/floorplanRead.ts';
import { PHOTO_READ_VERSION, photoReadRequest, validatePhotoReading, type PhotoUnderstanding } from '../_shared/designStudio/photoRead.ts';
import { meterAiCall } from './metering.ts';
import { categoryOf, failure, inBackground, isFresh, readFailure } from './durable.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT = 'DS_RECONSTRUCT';
const LANGUAGES: Record<string, string> = { en: 'English', ka: 'Georgian', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew' };
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL = 36 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MODEL = Deno.env.get('OPENAI_DS_PHOTO_MODEL') || Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

// deno-lint-ignore no-explicit-any
type Row = any;

// deno-lint-ignore no-explicit-any
function textOf(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = payload?.output?.flatMap((o: any) => o?.content ?? []) ?? [];
  return parts.map((p: any) => p?.text ?? '').join('').trim();
}
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function handlePhotos(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);
  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { reconstructionId?: string; language?: string; originalName?: string; retry?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.reconstructionId))) return json({ error: 'BAD_REQUEST' }, 400);

  // RLS decides ownership: someone else's photos read as not found.
  const { data: recon } = await caller.from('ds_reconstructions')
    .select('id, project_id, user_id, reference_ids, plan_source_id, status, error, analysis, updated_at, built_source_id, built_version_id')
    .eq('id', body.reconstructionId).maybeSingle();
  if (!recon) return json({ error: 'NOT_FOUND' }, 404);
  if (recon.plan_source_id) return json({ error: 'NOT_A_PHOTO_PROJECT' }, 409);

  const understood = recon.analysis?.kind === 'PHOTO_UNDERSTANDING';
  if ((recon.status === 'READ' || recon.status === 'BUILT') && understood) {
    // Read before; make sure the project's source exists (an instance may have stopped between the two writes).
    const made = await ensurePhotoSource(admin, recon, recon.analysis as PhotoUnderstanding, body.originalName);
    return made ? json({ state: 'READ', ...made }) : json({ state: 'FAILED', reason: 'SOURCE_NOT_RECORDED', retryable: true });
  }
  if (recon.status === 'READ' || recon.status === 'BUILT') return json({ error: 'NOT_A_PHOTO_PROJECT' }, 409);
  if (recon.status === 'READING' && isFresh(recon.updated_at)) return json({ state: 'RUNNING' }, 202);
  if (recon.status === 'FAILED') {
    const f = readFailure(recon.error);
    if (f?.category === 'TERMINAL' || !body.retry) return json({ state: 'FAILED', reason: f?.code ?? 'UNKNOWN', retryable: f?.category !== 'TERMINAL' });
  }

  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  const ids: string[] = recon.reference_ids ?? [];
  const { data: refs } = await caller.from('ds_floorplans').select('id, object_key, purpose').in('id', ids);
  const byId = new Map((refs ?? []).map((r: Row) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Row[];
  if (ordered.length !== ids.length) return json({ error: 'NOT_FOUND' }, 404);
  const prefix = `users/${recon.user_id}/design-studio-floorplans/${recon.project_id}/`;
  if (ordered.some((r) => r.purpose !== 'REFERENCE' || !String(r.object_key).startsWith(prefix) || String(r.object_key).includes('..'))) {
    return json({ error: 'INVALID_KEY' }, 400);
  }

  // The claim: QUEUED, a failure asked again, or an abandoned reading — exactly one request wins.
  const { data: claimed } = await admin.from('ds_reconstructions').update({ status: 'READING', error: null })
    .eq('id', recon.id).eq('status', recon.status).eq('updated_at', recon.updated_at).select('id');
  if (!claimed?.length) return json({ state: 'RUNNING' }, 202);

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: recon.user_id, project_id: recon.project_id, kind: 'RECONSTRUCT', status: 'RUNNING', model: MODEL, started_at: new Date().toISOString(),
    input: { reconstructionId: recon.id, pictures: ids.length, purpose: 'PHOTO_UNDERSTANDING', generator: 'OPENAI_FIRST', retry: recon.status === 'FAILED' },
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;
  const language = LANGUAGES[String(body.language ?? 'en')] ?? 'English';

  await inBackground('photos', async () => {
    try {
      await readPhotos(admin, recon, ordered, jobId, language, body.originalName);
    } catch (e) {
      await admin.from('ds_reconstructions').update({ status: 'FAILED', error: failure('RETRYABLE', 'CRASHED') }).eq('id', recon.id).eq('status', 'READING');
      if (jobId) await admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', `CRASHED:${String((e as Error)?.message ?? e).slice(0, 80)}`), finished_at: new Date().toISOString() }).eq('id', jobId);
    }
  });
  return json({ state: 'RUNNING' }, 202);
}

/** The reading itself (background): bytes checked, one OpenAI reading of every photo, the source, the cost. */
async function readPhotos(admin: Row, recon: Row, ordered: Row[], jobId: string | undefined, language: string, originalName: unknown): Promise<void> {
  const fail = async (code: string, analysis?: PhotoUnderstanding) => {
    const stored = failure(categoryOf(code), code);
    await admin.from('ds_reconstructions').update({ status: 'FAILED', error: stored, ...(analysis ? { analysis, model: MODEL } : {}) }).eq('id', recon.id);
    if (jobId) await admin.from('ds_jobs').update({ status: 'FAILED', error: stored, finished_at: new Date().toISOString() }).eq('id', jobId);
  };

  const images: Array<{ dataUrl: string; width: number; height: number }> = [];
  let total = 0;
  for (const ref of ordered) {
    const facts = await headObject(ref.object_key);
    if (!facts.exists) return fail('FILE_MISSING');
    if ((facts.size ?? 0) > MAX_BYTES) return fail('FILE_TOO_LARGE');
    const res = await getObject(ref.object_key);
    if (!res.ok) return fail('FILE_UNREADABLE');
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.length;
    if (bytes.length > MAX_BYTES || total > MAX_TOTAL) return fail('FILE_TOO_LARGE');
    const type = sniffType(bytes.subarray(0, 64));
    if (!type || !IMAGE_TYPES.has(type)) return fail('NOT_A_SUPPORTED_IMAGE');
    const size = imageSize(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    if (!size || size.width < 64 || size.height < 64 || size.width > 20000 || size.height > 20000) return fail('IMAGE_SIZE_UNREADABLE');
    images.push({ dataUrl: `data:${type};base64,${base64(bytes)}`, width: size.width, height: size.height });
    await admin.from('ds_floorplans').update({ image_width: size.width, image_height: size.height }).eq('id', ref.id);
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('READING_UNAVAILABLE');
  const started = Date.now();
  let payload: Row = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(photoReadRequest(MODEL, images, language)),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  const text = payload ? textOf(payload) : '';
  if (!text) return fail('READING_FAILED');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('READING_BAD_SHAPE'); }
  const u = validatePhotoReading(raw, images.length);
  if (!u) return fail('READING_BAD_SHAPE');

  // What it cost: priced from the book, recorded as unbilled usage; unknown stays unknown.
  const cost = await meterAiCall(admin, { userId: recon.user_id, productCode: PRODUCT, jobRef: jobId ?? recon.id, model: MODEL, startedAt: started },
    payload, { reconstruction_id: recon.id, pictures: images.length, purpose: 'PHOTO_UNDERSTANDING', generator: 'OPENAI_FIRST' });
  const finish = (status: string, error: string | null) => jobId
    ? admin.from('ds_jobs').update({ status, error, cost_cents: cost.aiCents, finished_at: new Date().toISOString(), output: { kind: 'PHOTO_UNDERSTANDING', rooms: u.rooms.length, questions: u.questions.length, usable: u.usable } }).eq('id', jobId)
    : Promise.resolve();

  // Nothing here can be designed over: say so truthfully (another photo), never "could not read".
  if (!u.usable) { await fail('UNSUPPORTED_PHOTOS', u); await finish('FAILED', failure('TERMINAL', 'UNSUPPORTED_PHOTOS')); return; }

  await admin.from('ds_reconstructions').update({ status: 'READ', analysis: u, model: MODEL, error: null }).eq('id', recon.id);
  const made = await ensurePhotoSource(admin, { ...recon, analysis: u }, u, originalName);
  if (!made) { await fail('SOURCE_NOT_RECORDED'); return; }
  await finish('SUCCEEDED', null);
}

/**
 * The project's PHOTO_SET source and its Original version, made once
 * (looked up by the reconstruction first), and the project pointed at them.
 */
async function ensurePhotoSource(admin: Row, recon: Row, u: PhotoUnderstanding, originalName: unknown): Promise<{ sourceId: string; versionId: string } | null> {
  let sourceId: string | null = recon.built_source_id ?? null;
  if (!sourceId) {
    const { data: found } = await admin.from('ds_spatial_sources').select('id').eq('project_id', recon.project_id).eq('kind', 'PHOTO_SET')
      .eq('provenance->>reconstructionId', recon.id).limit(1);
    sourceId = found?.[0]?.id ?? null;
  }
  if (!sourceId) {
    const { data: made, error } = await admin.from('ds_spatial_sources').insert({
      project_id: recon.project_id, user_id: recon.user_id, kind: 'PHOTO_SET', status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED',
      floorplan_id: recon.reference_ids[0], canonical: { kind: 'PHOTO_SET', understanding: u }, generator_version: PHOTO_READ_VERSION,
      provenance: { origin: 'CUSTOMER_PHOTOS', reconstructionId: recon.id, referenceIds: recon.reference_ids, generator: 'OPENAI_FIRST' },
    }).select('id').single();
    if (error || !made?.id) return null;
    sourceId = made.id;
  }
  let versionId: string | null = recon.built_version_id ?? null;
  if (!versionId) {
    const { data: found } = await admin.from('ds_versions').select('id').eq('source_id', sourceId).eq('origin', 'ORIGINAL').limit(1);
    versionId = found?.[0]?.id ?? null;
  }
  if (!versionId) {
    const name = typeof originalName === 'string' && originalName.trim() ? originalName.trim().slice(0, 80) : 'Original';
    const { data: made, error } = await admin.from('ds_versions').insert({
      project_id: recon.project_id, user_id: recon.user_id, source_id: sourceId, name, origin: 'ORIGINAL', state: {},
      change_summary: [{ kind: 'PHOTOS_UNDERSTOOD', reconstructionId: recon.id, rooms: u.rooms.length }],
    }).select('id').single();
    if (error || !made?.id) return null;
    versionId = made.id;
  }
  await admin.from('ds_reconstructions').update({ built_source_id: sourceId, built_version_id: versionId }).eq('id', recon.id)
    .or(`built_source_id.is.null,built_version_id.is.null`);
  await admin.from('ds_projects').update({ active_source_id: sourceId, head_version_id: versionId }).eq('id', recon.project_id).is('active_source_id', null);
  return { sourceId: sourceId!, versionId: versionId! };
}
