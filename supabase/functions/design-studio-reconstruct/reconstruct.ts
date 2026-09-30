// HOMATCH DESIGN STUDIO — read a customer's pictures of a home into a scene.
//
// POST …/design-studio-reconstruct { reconstructionId }  (the caller's JWT; they must own it)
//
// 1. The reconstruction and its pictures are read AS THE CALLER, so RLS
//    decides whose they are. Every picture is checked by its BYTES (a real
//    PNG, JPEG or WebP within the limit), whatever the browser declared.
// 2. All pictures go to the model in ONE reading, so several views of the
//    same home become one home — one sofa, not three.
// 3. The reading is validated (reconstructRead.ts): bounded, keyed, every
//    element with a confidence and OBSERVED/INFERRED, nothing repaired.
// 4. The plan becomes a standard floor-plan document on the first picture's
//    row (everything UNVERIFIED), so the customer's review, calibration and
//    the shared generator build it exactly like a drawn plan. With the
//    customer's own floor plan, its rooms are given to the model and only
//    furniture, surfaces and cameras are read.
//
// It never writes geometry, a source or a design. Money: DS_RECONSTRUCT is
// registered, measured and NOT priced; while design_studio_billing_enabled
// is false the run is unbilled usage, and if the switch is turned on before
// the confirmation flow exists this refuses rather than charging.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { recordUnbilledUsage, serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { getObject, headObject } from '../_shared/objectStore.ts';
import { imageSize, sniffType } from '../_shared/designStudio/floorplanRead.ts';
import { planContext, planDocument, RECON_VERSION, SCHEMA, SYSTEM, validateReconstruction } from '../_shared/designStudio/reconstructRead.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const PRODUCT = 'DS_RECONSTRUCT';
/** The customer's language for the plain words the reading returns (labels, room names, what could not be seen). */
const LANGUAGES: Record<string, string> = { en: 'English', ka: 'Georgian', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew' };
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL = 36 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MODEL = Deno.env.get('OPENAI_DS_RECONSTRUCT_MODEL') || Deno.env.get('OPENAI_DS_FLOORPLAN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
const USD_IN = Number(Deno.env.get('OPENAI_USD_PER_MTOK_IN') || '0');
const USD_OUT = Number(Deno.env.get('OPENAI_USD_PER_MTOK_OUT') || '0');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleReconstruct(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);

  const admin = serviceClient();
  // This function writes with the service role, so an impersonated session may not drive it.
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { reconstructionId?: string; language?: string };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!body.reconstructionId || typeof body.reconstructionId !== 'string') return json({ error: 'BAD_REQUEST' }, 400);

  // RLS decides ownership: someone else's reconstruction reads as not found.
  const { data: recon } = await caller.from('ds_reconstructions')
    .select('id, project_id, user_id, reference_ids, plan_source_id, status').eq('id', body.reconstructionId).maybeSingle();
  if (!recon) return json({ error: 'NOT_FOUND' }, 404);
  if (recon.status === 'READING') return json({ error: 'ALREADY_RUNNING' }, 409);
  if (recon.status === 'BUILT') return json({ error: 'ALREADY_BUILT' }, 409);

  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  const ids: string[] = recon.reference_ids ?? [];
  const { data: refs } = await caller.from('ds_floorplans')
    .select('id, project_id, user_id, object_key, purpose').in('id', ids);
  const byId = new Map((refs ?? []).map((r: any) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as any[];
  if (ordered.length !== ids.length) return json({ error: 'NOT_FOUND' }, 404);
  const prefix = `users/${recon.user_id}/design-studio-floorplans/${recon.project_id}/`;
  if (ordered.some((r) => r.purpose !== 'REFERENCE' || !String(r.object_key).startsWith(prefix) || String(r.object_key).includes('..'))) {
    return json({ error: 'INVALID_KEY' }, 400);
  }

  const fail = async (reason: string, jobId?: string) => {
    await admin.from('ds_reconstructions').update({ status: 'FAILED', error: reason }).eq('id', recon.id);
    if (jobId) await admin.from('ds_jobs').update({ status: 'FAILED', error: reason, finished_at: new Date().toISOString() }).eq('id', jobId);
    return json({ state: 'FAILED', reason }, 422);
  };

  await admin.from('ds_reconstructions').update({ status: 'READING', error: null }).eq('id', recon.id);
  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: recon.user_id, project_id: recon.project_id, kind: 'RECONSTRUCT', status: 'RUNNING',
    input: { reconstructionId: recon.id, pictures: ids.length, withPlan: !!recon.plan_source_id }, model: MODEL, started_at: new Date().toISOString(),
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;

  // ── The pictures, checked by their bytes ───────────────────────────
  const images: Array<{ id: string; type: string; width: number; height: number; bytes: Uint8Array }> = [];
  let total = 0;
  for (const ref of ordered) {
    const facts = await headObject(ref.object_key);
    if (!facts.exists) return fail('FILE_MISSING', jobId);
    if ((facts.size ?? 0) > MAX_BYTES) return fail('FILE_TOO_LARGE', jobId);
    const res = await getObject(ref.object_key);
    if (!res.ok) return fail('FILE_UNREADABLE', jobId);
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.length;
    if (bytes.length > MAX_BYTES || total > MAX_TOTAL) return fail('FILE_TOO_LARGE', jobId);
    const type = sniffType(bytes.subarray(0, 64));
    if (!type || !IMAGE_TYPES.has(type)) return fail('NOT_A_SUPPORTED_IMAGE', jobId);
    const size = imageSize(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    if (!size || size.width < 64 || size.height < 64 || size.width > 20000 || size.height > 20000) return fail('IMAGE_SIZE_UNREADABLE', jobId);
    images.push({ id: ref.id, type, width: size.width, height: size.height, bytes });
    await admin.from('ds_floorplans').update({ image_width: size.width, image_height: size.height, sha256: await sha256Hex(bytes) }).eq('id', ref.id);
  }

  // ── With the customer's own plan, its rooms are the frame ──────────
  let planRooms: Array<{ id: string; kind: string; polygon: Array<{ x: number; y: number }> }> = [];
  if (recon.plan_source_id) {
    const { data: src } = await caller.from('ds_spatial_sources').select('id, canonical, status').eq('id', recon.plan_source_id).maybeSingle();
    const floors = (src as any)?.canonical?.scene?.floors;
    if (!src || src.status !== 'READY' || !Array.isArray(floors)) return fail('PLAN_UNAVAILABLE', jobId);
    planRooms = floors.map((f: any) => ({ id: String(f.id), kind: String(f.kind), polygon: Array.isArray(f.polygon) ? f.polygon : [] }));
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('READING_UNAVAILABLE', jobId);

  const intro = images.length === 1
    ? 'Here is one picture of the home.'
    : `Here are ${images.length} pictures of the SAME home, numbered 0 to ${images.length - 1} in order. Merge what they show into one home.`;
  const language = LANGUAGES[String(body.language ?? 'en')] ?? 'English';
  const content: any[] = [{
    type: 'input_text',
    text: `${intro} Rebuild it as structured data in the plan frame. Write every label, room label and unknown in ${language}; keep every code (kinds, types) exactly as listed.${planRooms.length ? `\n\n${planContext(planRooms)}` : ''}`,
  }];
  images.forEach((img, i) => {
    content.push({ type: 'input_text', text: `Picture ${i} (${img.width} x ${img.height} px):` });
    content.push({ type: 'input_image', image_url: `data:${img.type};base64,${base64(img.bytes)}` });
  });

  const started = Date.now();
  let payload: any = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'ds_reconstruction', strict: false, schema: SCHEMA } },
        reasoning: { effort: 'high' },
      }),
    });
    payload = r.ok ? await r.json() : null;
  } catch {
    payload = null;
  }
  const text = payload ? textOf(payload) : '';
  if (!text) return fail('READING_FAILED', jobId);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('READING_BAD_SHAPE', jobId); }

  const { recon: reading, dropped } = validateReconstruction(raw, images.length, {
    usesPlan: planRooms.length > 0, planRoomIds: planRooms.map((r) => r.id),
    // Each picture's shape, read from its own bytes: the traced pixels are fractions of it.
    imageAspects: images.map((img) => img.width / img.height),
  });
  if (!reading.usesPlan && reading.rooms.length === 0) return fail('NOTHING_READ', jobId);

  if (!reading.usesPlan) {
    // The plan rides on the first picture's row, so the shared review and generator build it.
    const doc = planDocument(reading, ordered[0].object_key);
    await admin.from('ds_floorplans').update({
      status: 'INTERPRETED',
      interpretation: { doc, dimensionStrings: [], readVersion: RECON_VERSION },
      interpretation_model: MODEL,
      interpretation_error: null,
    }).eq('id', ordered[0].id);
  }
  await admin.from('ds_reconstructions').update({ status: 'READ', analysis: reading, model: MODEL, error: null }).eq('id', recon.id);

  // ── What it cost: measured, never charged while unpriced ───────────
  const inTok = Number(payload?.usage?.input_tokens ?? 0);
  const outTok = Number(payload?.usage?.output_tokens ?? 0);
  const ratesKnown = USD_IN > 0 && USD_OUT > 0;
  const cents = ratesKnown ? Math.ceil(((inTok / 1e6) * USD_IN + (outTok / 1e6) * USD_OUT) * 100) : null;
  try {
    const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: recon.user_id });
    const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
    await recordUnbilledUsage(admin, { userId: recon.user_id, productCode: PRODUCT, planCode, jobRef: jobId ?? recon.id }, {
      provider: 'openai', providerOperation: 'responses', model: MODEL, inputTokens: inTok, outputTokens: outTok,
      durationMs: Date.now() - started, aiCostCents: cents ?? undefined,
      // Unknown cost is recorded as unknown, not as zero.
      metadata: { reconstruction_id: recon.id, pictures: images.length, cost_known: ratesKnown },
    });
  } catch { /* a missing measurement never fails a reading that succeeded */ }
  const counts = { rooms: reading.rooms.length, openings: reading.openings.length, objects: reading.objects.length, surfaces: reading.surfaces.length, cameras: reading.cameras.length, dropped, fidelity: reading.fidelity ?? null };
  if (jobId) {
    await admin.from('ds_jobs').update({ status: 'SUCCEEDED', finished_at: new Date().toISOString(), cost_cents: cents, output: counts }).eq('id', jobId);
  }
  return json({ state: 'READ', counts });
}
