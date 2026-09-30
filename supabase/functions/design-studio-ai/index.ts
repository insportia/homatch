// HOMATCH DESIGN STUDIO — THE AI DESIGNER.
//
//   POST { versionId, brief }   (signed-in customer, own version)
//
// Reads the version, its space and the relevant slice of the catalogue AS
// THE CALLER (RLS decides what exists), asks the model for a plan in a fixed
// schema, and returns only what validatePlan() lets through. It never writes
// a design: the plan is a proposal the customer previews and accepts in the
// browser, where every change is re-validated by the same engine that checks
// the customer's own edits.
//
// The job row is the audit trail: brief, model, what was dropped and why,
// and the measured cost. A version or operation record that says "AI" must
// name a SUCCEEDED job of this customer (enforced by the database).
//
// Billing: DS_AI_DESIGN exists with pricing inactive. Usage is measured and
// recorded unbilled. If Admin switches Design Studio billing on before the
// confirmation flow exists, this refuses rather than charge.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { recordUnbilledUsage, serviceClient } from '../_shared/billing.ts';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import {
  buildUserMessage, DS_AI_VERSION, normalizeBrief, SCHEMA, SYSTEM, validatePlan,
  type PlanAssetContext, type PlanContext, type PlanLocks, type PlanMaterialContext, type PlanRoomContext,
} from '../_shared/designStudio/aiPlan.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const PRODUCT = 'DS_AI_DESIGN';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNS_PER_HOUR = 20;
const MAX_ASSETS = 160;
const MODEL = Deno.env.get('OPENAI_DS_DESIGN_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
const USD_IN = Number(Deno.env.get('OPENAI_USD_PER_MTOK_IN') || '0');
const USD_OUT = Number(Deno.env.get('OPENAI_USD_PER_MTOK_OUT') || '0');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function textOf(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = payload?.output?.flatMap((o: any) => o?.content ?? []) ?? [];
  return parts.map((p: any) => p?.text ?? '').join('').trim();
}

const NO_LOCKS: PlanLocks = { layout: false, furniture: false, walls: false, floor: false, kitchen: false, colors: false, lighting: false };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'UNAUTHENTICATED' }, 401);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: 'UNAUTHENTICATED' }, 401);

  const admin = serviceClient();
  const refused = await refuseIfImpersonating(admin, authHeader, CORS);
  if (refused) return refused;

  let body: { versionId?: string; brief?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (typeof body.versionId !== 'string' || !UUID.test(body.versionId)) return json({ error: 'BAD_REQUEST' }, 400);

  // ── What exists, as the caller sees it ────────────────────────────
  const { data: version } = await caller.from('ds_versions')
    .select('id, project_id, user_id, source_id, state, archived_at').eq('id', body.versionId).maybeSingle();
  if (!version || version.archived_at) return json({ error: 'NOT_FOUND' }, 404);
  const { data: source } = await caller.from('ds_spatial_sources')
    .select('id, kind, status, canonical').eq('id', version.source_id).maybeSingle();
  const floors = (source?.canonical as { scene?: { floors?: unknown[] } } | null)?.scene?.floors;
  if (!source || source.status !== 'READY' || !Array.isArray(floors)) return json({ error: 'NO_SPACE_MODEL' }, 409);

  const rooms: PlanRoomContext[] = floors.flatMap((f) => {
    const r = f as { id?: unknown; kind?: unknown; areaM2?: unknown; label?: unknown };
    return typeof r.id === 'string' && typeof r.kind === 'string'
      ? [{ id: r.id, kind: r.kind, areaM2: Number(r.areaM2) || 0, label: typeof r.label === 'string' ? r.label : null }]
      : [];
  });
  const brief = normalizeBrief(body.brief, new Set(rooms.map((r) => r.id)));
  const state = (version.state ?? {}) as { objects?: Array<{ assetId?: unknown; roomId?: unknown }>; locks?: Partial<PlanLocks> };
  const locks: PlanLocks = { ...NO_LOCKS, ...Object.fromEntries(Object.entries(state.locks ?? {}).filter(([, v]) => typeof v === 'boolean')) };
  const existing: Record<string, string[]> = {};
  for (const o of state.objects ?? []) {
    if (typeof o.roomId === 'string' && typeof o.assetId === 'string') (existing[o.roomId] ??= []).push(o.assetId);
  }

  const { data: billingOn } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  if (billingOn === true) return json({ error: 'BILLING_CONFIRMATION_REQUIRED' }, 409);

  // A plain guard against runaway use; not a price, not a plan gate.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('ds_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', version.user_id).eq('kind', 'AI_DESIGN').gte('created_at', since);
  if ((count ?? 0) >= RUNS_PER_HOUR) return json({ error: 'RATE_LIMITED' }, 429);

  // ── The slice of the catalogue that fits these rooms (scales to thousands) ──
  const scopeKinds = [...new Set((brief.roomIds.length ? rooms.filter((r) => brief.roomIds.includes(r.id)) : rooms).map((r) => r.kind))];
  const assetQuery = () => caller.from('ds_catalog_assets')
    .select('code, name, category, subcategory, room_kinds, style_tags, width_m, depth_m')
    .eq('active', true).eq('placement', 'FLOOR').overlaps('room_kinds', scopeKinds).limit(MAX_ASSETS);
  let { data: assetRows } = brief.styleCode ? await assetQuery().overlaps('style_tags', [brief.styleCode]) : await assetQuery();
  if ((assetRows ?? []).length < 20) ({ data: assetRows } = await assetQuery());
  const assets: PlanAssetContext[] = (assetRows ?? []).map((a: any) => ({
    code: a.code, name: a.name, category: a.category, subcategory: a.subcategory, roomKinds: a.room_kinds ?? [],
    styleTags: a.style_tags ?? [], widthM: Number(a.width_m), depthM: Number(a.depth_m),
  }));
  const { data: materialRows } = await caller.from('ds_catalog_materials')
    .select('code, name, applies_to, style_tags, pbr').eq('active', true).limit(200);
  const materials: PlanMaterialContext[] = (materialRows ?? []).map((m: any) => ({
    code: m.code, name: m.name, appliesTo: m.applies_to ?? [], styleTags: m.style_tags ?? [],
    color: typeof m.pbr?.baseColor === 'string' ? m.pbr.baseColor : null,
  }));
  const ctx: PlanContext = { rooms, assets, materials, locks, existing };

  const { data: job } = await admin.from('ds_jobs').insert({
    user_id: version.user_id, project_id: version.project_id, kind: 'AI_DESIGN', status: 'RUNNING',
    input: { versionId: version.id, brief, locks, assets: assets.length, materials: materials.length },
    model: MODEL, started_at: new Date().toISOString(),
  }).select('id').single();
  const jobId = (job as { id?: string } | null)?.id ?? null;
  if (!jobId) return json({ error: 'JOB_FAILED' }, 500);
  const fail = async (reason: string, status = 422) => {
    await admin.from('ds_jobs').update({ status: 'FAILED', error: reason, finished_at: new Date().toISOString() }).eq('id', jobId);
    return json({ state: 'FAILED', reason }, status);
  };

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return fail('DESIGN_UNAVAILABLE', 503);

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
          { role: 'user', content: buildUserMessage(brief, ctx) },
        ],
        text: { format: { type: 'json_schema', name: 'ds_design_plan', strict: true, schema: SCHEMA } },
        reasoning: { effort: 'medium' },
      }),
    });
    payload = r.ok ? await r.json() : null;
  } catch {
    payload = null;
  }
  const text = payload ? textOf(payload) : '';
  if (!text) return fail('DESIGN_FAILED');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('DESIGN_BAD_SHAPE'); }
  const plan = validatePlan(raw, ctx, brief);
  if (!plan.alternatives.length) return fail('DESIGN_EMPTY');

  // ── What it cost: measured, never charged while unpriced ───────────
  const inTok = Number(payload?.usage?.input_tokens ?? 0);
  const outTok = Number(payload?.usage?.output_tokens ?? 0);
  const ratesKnown = USD_IN > 0 && USD_OUT > 0;
  const cents = ratesKnown ? Math.round(((inTok / 1e6) * USD_IN + (outTok / 1e6) * USD_OUT) * 100 * 10000) / 10000 : null;
  try {
    const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: version.user_id });
    const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
    await recordUnbilledUsage(admin, { userId: version.user_id, productCode: PRODUCT, planCode, jobRef: jobId }, {
      provider: 'openai', providerOperation: 'responses', model: MODEL, inputTokens: inTok, outputTokens: outTok,
      durationMs: Date.now() - started, aiCostCents: cents ?? undefined,
      metadata: { ds_version_id: version.id, cost_known: ratesKnown, plan_version: DS_AI_VERSION },
    });
  } catch { /* a missing measurement never fails a design that succeeded */ }

  await admin.from('ds_jobs').update({
    status: 'SUCCEEDED', finished_at: new Date().toISOString(), cost_cents: cents,
    output: { plan, dropped: plan.dropped },
  }).eq('id', jobId);

  return json({ state: 'READY', jobId, plan, billing: 'NOT_CHARGED' });
});
