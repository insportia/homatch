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
import { PHOTO_READ_VERSION, photoOfRoom, photoReadRequest, validatePhotoReading, type PhotoUnderstanding } from '../_shared/designStudio/photoRead.ts';
import { uuidFrom } from '../_shared/designStudio/renderKeys.ts';
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

type Image = { dataUrl: string; width: number; height: number };

/** The project's photos, checked byte by byte, as the reading sees them; or the reason they cannot be read. */
async function loadImages(admin: Row, ordered: Row[]): Promise<{ images: Image[] } | { code: string }> {
  const images: Image[] = [];
  let total = 0;
  for (const ref of ordered) {
    const facts = await headObject(ref.object_key);
    if (!facts.exists) return { code: 'FILE_MISSING' };
    if ((facts.size ?? 0) > MAX_BYTES) return { code: 'FILE_TOO_LARGE' };
    const res = await getObject(ref.object_key);
    if (!res.ok) return { code: 'FILE_UNREADABLE' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.length;
    if (bytes.length > MAX_BYTES || total > MAX_TOTAL) return { code: 'FILE_TOO_LARGE' };
    const type = sniffType(bytes.subarray(0, 64));
    if (!type || !IMAGE_TYPES.has(type)) return { code: 'NOT_A_SUPPORTED_IMAGE' };
    const size = imageSize(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    if (!size || size.width < 64 || size.height < 64 || size.width > 20000 || size.height > 20000) return { code: 'IMAGE_SIZE_UNREADABLE' };
    images.push({ dataUrl: `data:${type};base64,${base64(bytes)}`, width: size.width, height: size.height });
    await admin.from('ds_floorplans').update({ image_width: size.width, image_height: size.height }).eq('id', ref.id);
  }
  return { images };
}

/** One OpenAI reading of every photo: the understanding and the payload (to meter), or the reason it failed. */
async function askReading(images: Image[], language: string): Promise<{ u: PhotoUnderstanding; payload: Row; started: number } | { code: string; payload: Row; started: number }> {
  const started = Date.now();
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { code: 'READING_UNAVAILABLE', payload: null, started };
  let payload: Row = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(photoReadRequest(MODEL, images, language)),
    });
    payload = r.ok ? await r.json() : null;
  } catch { payload = null; }
  const text = payload ? textOf(payload) : '';
  if (!text) return { code: 'READING_FAILED', payload, started };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { code: 'READING_BAD_SHAPE', payload, started }; }
  const u = validatePhotoReading(raw, images.length);
  return u ? { u, payload, started } : { code: 'READING_BAD_SHAPE', payload, started };
}

/** The reading itself (background): bytes checked, one OpenAI reading of every photo, the source, the cost. */
async function readPhotos(admin: Row, recon: Row, ordered: Row[], jobId: string | undefined, language: string, originalName: unknown): Promise<void> {
  const fail = async (code: string, analysis?: PhotoUnderstanding) => {
    const stored = failure(categoryOf(code), code);
    await admin.from('ds_reconstructions').update({ status: 'FAILED', error: stored, ...(analysis ? { analysis, model: MODEL } : {}) }).eq('id', recon.id);
    if (jobId) await admin.from('ds_jobs').update({ status: 'FAILED', error: stored, finished_at: new Date().toISOString() }).eq('id', jobId);
  };

  const loaded = await loadImages(admin, ordered);
  if ('code' in loaded) return fail(loaded.code);
  const images = loaded.images;
  const read = await askReading(images, language);
  if ('code' in read) return fail(read.code);
  const { u, payload, started } = read;

  // What it cost: priced from the book, recorded as unbilled usage; unknown stays unknown.
  const cost = await meterAiCall(admin, { userId: recon.user_id, productCode: PRODUCT, jobRef: jobId ?? recon.id, model: MODEL, startedAt: started },
    payload, { reconstruction_id: recon.id, pictures: images.length, purpose: 'PHOTO_UNDERSTANDING', generator: 'OPENAI_FIRST' });
  const finish = (status: string, error: string | null) => jobId
    ? admin.from('ds_jobs').update({ status, error, cost_cents: cost.aiCents, finished_at: new Date().toISOString(), output: { kind: 'PHOTO_UNDERSTANDING', rooms: u.rooms.length, questions: u.questions.length, usable: u.usable } }).eq('id', jobId)
    : Promise.resolve();

  // A floor plan sent as a photo: not unusable — the page hands it to the floor-plan reading (IS_FLOOR_PLAN).
  if (!u.usable && u.unusable === 'FLOOR_PLAN') { await fail('IS_FLOOR_PLAN', u); await finish('FAILED', failure('TERMINAL', 'IS_FLOOR_PLAN')); return; }
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

// ── Rooms of a whole-home photo, found again (the dashboard's "find rooms") ──
//
// POST …/design-studio-reconstruct/photo-rooms { projectId, language? }
//
// A project read before whole-home views were understood has one room for a
// picture that shows the whole flat. Its source is immutable, so the same
// photos (nothing uploaded again) are read once more and, when the reading
// finds more rooms, the result is a NEW photo source and a child of the design
// shown (the same design, its DNA and specification) on it; the project's
// head and active source move to them. Earlier designs and pictures are
// untouched. Asked again: the same child (a deterministic id), never a second
// reading.
//   → 200 { state: 'DONE', rooms, versionId }   (rooms: the rooms the dashboard now has)
//   → 200 { state: 'SAME', rooms }               (the reading found nothing more; nothing changed)
export async function handlePhotoRooms(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);
  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;
  let body: { projectId?: string; language?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.projectId))) return json({ error: 'BAD_REQUEST' }, 400);

  // The project and the design it shows, as the caller may see them (RLS: only the owner's).
  const { data: project } = await caller.from('ds_projects').select('id, user_id, head_version_id').eq('id', String(body.projectId)).maybeSingle();
  if (!project?.head_version_id) return json({ error: 'NOT_FOUND' }, 404);
  const { data: head } = await caller.from('ds_versions').select('id, project_id, user_id, source_id, name, origin, state, style_tags, design_dna, job_id').eq('id', project.head_version_id).maybeSingle();
  if (!head || head.project_id !== project.id) return json({ error: 'NOT_FOUND' }, 404);
  const { data: source } = await caller.from('ds_spatial_sources').select('id, kind, status, floorplan_id, canonical, provenance').eq('id', head.source_id).maybeSingle();
  const before = source?.canonical?.understanding as PhotoUnderstanding | undefined;
  if (source?.kind !== 'PHOTO_SET' || before?.kind !== 'PHOTO_UNDERSTANDING') return json({ error: 'NOT_A_PHOTO_PROJECT' }, 409);
  if (before.rooms.length > 1 || before.version === PHOTO_READ_VERSION) return json({ state: 'SAME', rooms: before.rooms.length });

  const childId = await uuidFrom(`ds-photo-rooms:${head.id}`);
  const { data: done } = await admin.from('ds_versions').select('id').eq('id', childId).maybeSingle();
  if (done?.id) return json({ state: 'DONE', rooms: null, versionId: done.id });

  const ids: string[] = Array.isArray(source.provenance?.referenceIds) ? source.provenance.referenceIds.map(String) : [];
  const { data: refs } = await caller.from('ds_floorplans').select('id, object_key, purpose').in('id', ids);
  const byId = new Map((refs ?? []).map((r: Row) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Row[];
  const prefix = `users/${head.user_id}/design-studio-floorplans/${project.id}/`;
  if (!ordered.length || ordered.length !== ids.length || ordered.some((r) => r.purpose !== 'REFERENCE' || !String(r.object_key).startsWith(prefix) || String(r.object_key).includes('..'))) {
    return json({ error: 'NOT_FOUND' }, 404);
  }

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: head.user_id, project_id: project.id, kind: 'RECONSTRUCT', status: 'RUNNING', model: MODEL, started_at: new Date().toISOString(),
    input: { purpose: 'PHOTO_ROOMS', fromSourceId: source.id, headVersionId: head.id, pictures: ids.length, generator: 'OPENAI_FIRST' },
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id ?? null;
  const finish = (status: string, error: string | null, extra: Row = {}) => (jobId
    ? admin.from('ds_jobs').update({ status, error, finished_at: new Date().toISOString(), ...extra }).eq('id', jobId)
    : Promise.resolve());

  const loaded = await loadImages(admin, ordered);
  if ('code' in loaded) { await finish('FAILED', failure(categoryOf(loaded.code), loaded.code)); return json({ error: loaded.code }, 422); }
  const read = await askReading(loaded.images, LANGUAGES[String(body.language ?? 'en')] ?? 'English');
  const cost = read.payload
    ? await meterAiCall(admin, { userId: head.user_id, productCode: PRODUCT, jobRef: jobId ?? source.id, model: MODEL, startedAt: read.started }, read.payload,
      { purpose: 'PHOTO_ROOMS', source_id: source.id, pictures: ids.length, generator: 'OPENAI_FIRST' })
    : null;
  const paid = cost ? { cost_cents: cost.aiCents } : {};
  if ('code' in read) { await finish('FAILED', failure(categoryOf(read.code), read.code), paid); return json({ error: read.code }, 422); }
  const u = read.u;
  // Only more rooms, and the design's own picture kept: the photo the shown design was drawn over is still its hero's.
  const heroPhoto = photoOfRoom(before, before.heroRoomId);
  const keeps = u.usable && u.rooms.length > before.rooms.length && heroPhoto != null && u.rooms.some((r) => r.photos.includes(heroPhoto));
  if (!keeps) {
    await finish('SUCCEEDED', null, { ...paid, output: { kind: 'PHOTO_ROOMS', rooms: before.rooms.length, found: u.rooms.length, kept: false } });
    return json({ state: 'SAME', rooms: before.rooms.length });
  }
  const hero = u.rooms.find((r) => r.primaryPhoto === heroPhoto && r.id === u.heroRoomId) ?? u.rooms.find((r) => r.primaryPhoto === heroPhoto)!;
  const understanding: PhotoUnderstanding = { ...u, heroRoomId: hero.id, questions: [] };

  const { data: made, error } = await admin.from('ds_spatial_sources').insert({
    project_id: project.id, user_id: head.user_id, kind: 'PHOTO_SET', status: 'READY', geometry_state: 'ESTIMATED', editability: 'GENERATED',
    floorplan_id: source.floorplan_id, canonical: { kind: 'PHOTO_SET', understanding }, generator_version: PHOTO_READ_VERSION, supersedes_id: source.id,
    provenance: { ...(source.provenance ?? {}), roomsOf: source.id, generator: 'OPENAI_FIRST' },
  }).select('id').single();
  if (error || !made?.id) { await finish('FAILED', failure('RETRYABLE', 'SOURCE_NOT_RECORDED'), paid); return json({ error: 'SOURCE_NOT_RECORDED' }, 500); }
  const { error: verr } = await admin.from('ds_versions').upsert({
    id: childId, project_id: project.id, user_id: head.user_id, source_id: made.id, parent_id: head.id,
    name: head.name, origin: head.origin, job_id: head.job_id, state: head.state ?? {}, style_tags: head.style_tags ?? [],
    change_summary: [{ kind: 'ROOMS_FOUND', fromSourceId: source.id, toSourceId: made.id, rooms: understanding.rooms.length }],
    design_dna: head.design_dna ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (verr) { await finish('FAILED', failure('RETRYABLE', 'VERSION_NOT_RECORDED'), paid); return json({ error: 'VERSION_NOT_RECORDED' }, 500); }
  await admin.from('ds_projects').update({ head_version_id: childId, active_source_id: made.id }).eq('id', project.id);
  await finish('SUCCEEDED', null, { ...paid, output: { kind: 'PHOTO_ROOMS', rooms: understanding.rooms.length, kept: true, sourceId: made.id, versionId: childId } });
  return json({ state: 'DONE', rooms: understanding.rooms.length, versionId: childId });
}
