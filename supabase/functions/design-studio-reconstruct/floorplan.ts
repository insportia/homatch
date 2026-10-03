// HOMATCH DESIGN STUDIO — read a customer's floor plan.
//
// POST …/design-studio-reconstruct/floorplan { floorplanId }  (the caller's JWT; they must own the plan)
//
// 1. The plan row is read AS THE CALLER, so RLS decides whose it is.
// 2. The file is read from R2 by its key and checked by its BYTES: it must
//    really be a PNG, JPEG or WebP within the size limit, whatever the
//    browser declared. Its pixel size comes from its own header.
// 3. The same picture already read for this customer (same sha256, same
//    reader version) is reused: no model call, no cost.
// 4. Otherwise the drawing is read by the model into a structured PROPOSAL
//    (every element UNVERIFIED, nothing invented), and HOMATCH fuses it with
//    the drawing's own pixels (planRead/understand.ts): walls snapped to
//    their ink, openings placed in their gaps, rooms bounded by the walls,
//    the scale solved from every printed size, topology checked, and only
//    the questions worth asking prepared.
// 5. The reading (fused AND raw, so every change is auditable) is written
//    onto ds_floorplans; the customer reviews it and HOMATCH's deterministic
//    generator builds geometry from what they keep.
//
// DURABLE: the request claims the plan (compare-and-set) and answers at once
// { state: 'RUNNING' }; the reading continues in the background, so leaving
// the page never stops it. Asking again is safe: a reading in progress answers
// RUNNING, a finished one INTERPRETED, an abandoned one (lease lapsed) is
// taken over, and a failure is stored with its category (durable.ts).
//
// It never writes geometry, never creates a spatial source and never marks
// anything verified. Money: DS_FLOORPLAN_READ is registered, measured and
// NOT priced (see 20260930093000). While design_studio_billing_enabled is
// false the run is recorded as unbilled usage; if the switch is turned on
// before the confirmation flow is wired, this refuses rather than charging.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/billing.ts';
import { meterAiCall } from './metering.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { getObject, headObject } from '../_shared/objectStore.ts';
import { cachedModelReading, DS_READ_VERSION, imageSize, SCHEMA, sniffType, SYSTEM, validateReading } from '../_shared/designStudio/floorplanRead.ts';
import { understand } from '../_shared/designStudio/planRead/understand.ts';
import { decodeGray } from './rasterDecode.ts';
import { categoryOf, failure, inBackground, isFresh, readFailure } from './durable.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const PRODUCT = 'DS_FLOORPLAN_READ';
const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MODEL = Deno.env.get('OPENAI_DS_FLOORPLAN_MODEL') || Deno.env.get('OPENAI_FLOORPLAN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

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

export async function handleFloorplan(req: Request): Promise<Response> {
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

  let body: { floorplanId?: string; retry?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!body.floorplanId || typeof body.floorplanId !== 'string') return json({ error: 'BAD_REQUEST' }, 400);

  // RLS decides ownership: a plan that is not the caller's reads as not found.
  const { data: plan } = await caller.from('ds_floorplans')
    .select('id, project_id, user_id, object_key, status, updated_at, interpretation_error').eq('id', body.floorplanId).maybeSingle();
  if (!plan) return json({ error: 'NOT_FOUND' }, 404);
  if (plan.status === 'INTERPRETED') return json({ state: 'INTERPRETED' });
  // A reading in progress is answered, never started twice.
  if (plan.status === 'INTERPRETING' && isFresh(plan.updated_at)) return json({ state: 'RUNNING' }, 202);
  const failed = plan.status === 'FAILED' ? readFailure(plan.interpretation_error) : null;
  // A failure is answered as stored; only an explicit retry (the customer's tap) reads again.
  if (failed && (failed.category === 'TERMINAL' || !body.retry)) return json({ state: 'FAILED', reason: failed.code, retryable: failed.category !== 'TERMINAL' });
  const expectedPrefix = `users/${plan.user_id}/design-studio-floorplans/${plan.project_id}/`;
  if (!String(plan.object_key).startsWith(expectedPrefix)) return json({ error: 'INVALID_KEY' }, 400);

  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true) {
    // Pricing is a product decision still to be made; the confirmation flow
    // is wired with it. Until then an enabled switch must not become a charge.
    return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);
  }

  // The claim: UPLOADED, a retryable failure, or an abandoned reading — exactly one request wins.
  const { data: claimed } = await admin.from('ds_floorplans').update({ status: 'INTERPRETING', interpretation_error: null })
    .eq('id', plan.id).eq('status', plan.status).eq('updated_at', plan.updated_at).select('id');
  if (!claimed?.length) return json({ state: 'RUNNING' }, 202);

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: plan.user_id, project_id: plan.project_id, kind: 'FLOORPLAN_INTERPRET', status: 'RUNNING',
    input: { floorplanId: plan.id, attempt: plan.status === 'UPLOADED' ? 1 : 2 }, model: MODEL, started_at: new Date().toISOString(),
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id;

  await inBackground('floorplan', async () => {
    try {
      await readPlan(admin, plan, jobId);
    } catch (e) {
      await admin.from('ds_floorplans').update({ status: 'FAILED', interpretation_error: failure('RETRYABLE', 'CRASHED') }).eq('id', plan.id).eq('status', 'INTERPRETING');
      if (jobId) await admin.from('ds_jobs').update({ status: 'FAILED', error: failure('RETRYABLE', `CRASHED:${String((e as Error)?.message ?? e).slice(0, 80)}`), finished_at: new Date().toISOString() }).eq('id', jobId);
    }
  });
  return json({ state: 'RUNNING' }, 202);
}

/** The reading itself (background): bytes checked, cache, the model, fusion, the row, the cost. */
// deno-lint-ignore no-explicit-any
async function readPlan(admin: any, plan: { id: string; project_id: string; user_id: string; object_key: string }, jobId: string | undefined): Promise<void> {
  const fail = async (code: string, id?: string) => {
    const stored = failure(categoryOf(code), code);
    await admin.from('ds_floorplans').update({ status: 'FAILED', interpretation_error: stored }).eq('id', plan.id);
    if (id) await admin.from('ds_jobs').update({ status: 'FAILED', error: stored, finished_at: new Date().toISOString() }).eq('id', id);
  };

  // ── The bytes, checked ─────────────────────────────────────────────
  const facts = await headObject(plan.object_key);
  if (!facts.exists) return fail('FILE_MISSING', jobId);
  if ((facts.size ?? 0) > MAX_BYTES) return fail('FILE_TOO_LARGE', jobId);
  const res = await getObject(plan.object_key);
  if (!res.ok) return fail('FILE_UNREADABLE', jobId);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return fail('FILE_TOO_LARGE', jobId);
  const type = sniffType(bytes.subarray(0, 64));
  if (!type || !IMAGE_TYPES.has(type)) return fail('NOT_A_SUPPORTED_IMAGE', jobId);
  const size = imageSize(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
  if (!size || size.width < 64 || size.height < 64 || size.width > 20000 || size.height > 20000) return fail('IMAGE_SIZE_UNREADABLE', jobId);

  const sha256 = await sha256Hex(bytes);
  await admin.from('ds_floorplans').update({
    status: 'INTERPRETING', interpretation_error: null, image_width: size.width, image_height: size.height, sha256,
  }).eq('id', plan.id);

  // ── Fusion: the reading checked against the drawing's own pixels ───
  // A picture that cannot be decoded here (WebP, or too large) is fused
  // without its raster; a failure in fusion itself keeps the plain reading.
  const fuse = (reading: { doc: ReturnType<typeof validateReading>['doc']; dimensionStrings: ReturnType<typeof validateReading>['dimensionStrings']; readVersion: string }, modelMs: number) => {
    const fuseStarted = Date.now();
    const decoded = decodeGray(bytes, type, size);
    try {
      const u = understand({ doc: reading.doc as any, dimensionStrings: reading.dimensionStrings, gray: decoded.ok ? decoded.gray : null });
      return {
        doc: u.doc as typeof reading.doc,
        interpretation: {
          doc: u.doc, rawDoc: reading.doc, dimensionStrings: u.dimensionStrings, rawDimensionStrings: reading.dimensionStrings,
          understanding: u.understanding, fusion: u.fusion, readVersion: reading.readVersion,
          timings: { modelMs, fuseMs: Date.now() - fuseStarted, rasterMs: u.timings.rasterMs, raster: decoded.ok ? 'USED' : decoded.reason },
        } as Record<string, unknown>,
      };
    } catch (e) {
      console.error('floorplan fusion failed', e instanceof Error ? e.message : String(e));
      return {
        doc: reading.doc,
        interpretation: {
          doc: reading.doc, rawDoc: reading.doc, dimensionStrings: reading.dimensionStrings, rawDimensionStrings: reading.dimensionStrings,
          understanding: null, readVersion: reading.readVersion,
          timings: { modelMs, fuseMs: Date.now() - fuseStarted, raster: 'FUSION_FAILED' },
        } as Record<string, unknown>,
      };
    }
  };

  // ── The same picture, already read for this customer: reuse the MODEL's reading ─
  // Same owner, same bytes, same reader version: the model's reading is a pure
  // function of those, so it is not paid for again. Fusion is NOT reused: it is
  // deterministic code that changes between deployments, so it runs again here.
  const { data: cached } = await admin.from('ds_floorplans')
    .select('id, interpretation, interpretation_model')
    .eq('user_id', plan.user_id).eq('sha256', sha256).eq('status', 'INTERPRETED').eq('purpose', 'PLAN')
    .eq('interpretation->>readVersion', DS_READ_VERSION).neq('id', plan.id)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const reuse = (cached as { id: string; interpretation: Record<string, unknown> | null; interpretation_model: string | null } | null);
  const cachedReading = reuse ? cachedModelReading(reuse.interpretation, plan.object_key) : null;
  if (reuse && cachedReading) {
    const { interpretation, doc: d } = fuse(cachedReading, 0);
    interpretation.cachedFrom = reuse.id;
    await admin.from('ds_floorplans').update({
      status: 'INTERPRETED', interpretation, interpretation_model: reuse.interpretation_model, interpretation_error: null,
    }).eq('id', plan.id);
    if (jobId) {
      await admin.from('ds_jobs').update({
        // A reused reading made no model call: its cost is zero because nothing was spent, not because it is unknown.
        status: 'SUCCEEDED', finished_at: new Date().toISOString(), cost_cents: 0,
        output: { cached: true, cachedFrom: reuse.id, walls: d.walls.length, rooms: d.rooms.length, doors: d.doors.length, windows: d.windows.length, timings: interpretation.timings },
      }).eq('id', jobId);
    }
    return;
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('READING_UNAVAILABLE', jobId);

  const started = Date.now();
  let payload: any = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: `Read this floor plan. The image is ${size.width} by ${size.height} pixels; give every coordinate in those pixels. Give each door and window its drawn centre, copy every printed text and size exactly, and report only what the drawing shows.` },
              { type: 'input_image', image_url: `data:${type};base64,${base64(bytes)}` },
            ],
          },
        ],
        text: { format: { type: 'json_schema', name: 'ds_floor_plan', strict: false, schema: SCHEMA } },
        reasoning: { effort: 'medium' },
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

  const modelMs = Date.now() - started;
  const reading = validateReading(raw, size.width, size.height, plan.object_key);

  const { interpretation, doc } = fuse(reading, modelMs);
  await admin.from('ds_floorplans').update({
    status: 'INTERPRETED',
    interpretation,
    interpretation_model: MODEL,
    interpretation_error: null,
  }).eq('id', plan.id);

  // ── What it cost: priced from the book, never charged ──────────────
  const { aiCents: cents } = await meterAiCall(admin,
    { userId: plan.user_id, productCode: PRODUCT, jobRef: jobId ?? plan.id, model: MODEL, startedAt: started },
    payload, { floorplan_id: plan.id });
  if (jobId) {
    await admin.from('ds_jobs').update({
      status: 'SUCCEEDED', finished_at: new Date().toISOString(), cost_cents: cents,
      output: { walls: doc.walls.length, rooms: doc.rooms.length, doors: doc.doors.length, windows: doc.windows.length, dimensions: reading.dimensionStrings.length, dropped: reading.dropped, timings: interpretation.timings },
    }).eq('id', jobId);
  }

}
