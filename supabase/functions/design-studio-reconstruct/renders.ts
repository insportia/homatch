// HOMATCH DESIGN STUDIO — renders: quoted, paid for, drawn by Blender, finished, checked, edited.
//
//   POST …/render-quote   { projectId, versionId, product, views }                 → RenderQuote
//   POST …/render-start   { quoteToken, projectId, versionId, views: SpecView[],
//                           spec (SceneBuildSpec with views), idempotencyKey,
//                           provider? (admin only) }                                → { renders: RenderRecord[] }
//   POST …/render-status  { renderIds }                                            → { renders: RenderRecord[] }
//   POST …/render-edit    { renderId, targetId, edit (APPEARANCE), newVersionId,
//                           quoteToken, idempotencyKey, provider? (admin only) }   → { render: RenderRecord }
//
// Money (docs/claude/BILLING.md): a quote is computed HERE from the render
// price table (renderPricing.ts, proposed figures, pricing inactive in the
// database) and signed; a start presents it unchanged within ten minutes.
// While Design Studio billing is on, every render reserves its own credits
// through the wallet gateway (beginExecution → wallet_reserve) before
// anything runs, settles on READY with a usable picture (the finished one, or
// Blender's when a finish was refused) and releases on FAILED. While billing
// is off nothing is reserved and the measured COGS is recorded unbilled.
// Unknown COGS is recorded as unknown (null, UNPRICED), never zero.
//
// Idempotency: one row per (caller, request key, view) — a retried start or
// edit returns the same rows and never reserves twice (the reservation's own
// key is derived from the row's). Finishing is claimed atomically (lease_at
// compare-and-set, five-minute lapse), so two polling tabs never finish, store
// or settle the same render twice.
//
// Every route acts AS THE CALLER (RLS decides what exists), refuses an
// impersonated session, and answers errors as codes.

import { beginExecution, recordUnbilledUsage, releaseExecution, settleExecution, type ExecutionGrant } from '../_shared/billing.ts';
import { getObject, putObject } from '../_shared/objectStore.ts';
import { checkFinish, checkEdit, compositeInsideMask, maskFromIds, resizeMask, rgbToGray, type CheckResult, type RgbPixels } from '../_shared/designStudio/renderCheck.ts';
import { selectProvider, type ImageProvider, type ImageResult, type ProviderDeps } from '../_shared/designStudio/imageProviders.ts';
import { editPrompt, finishPrompt, validateLegend, validateSpecView } from '../_shared/designStudio/renderPrompt.ts';
import {
  isRenderProduct, productForView, QUOTE_TTL_MS, quoteCredits, quoteMatches, quoteSecret, RENDER_PRICING, renderRowKey, reservationKey,
  sha256Hex, signQuote, validIdempotencyKey, verifyQuote, type QuoteClaims,
} from '../_shared/designStudio/renderPricing.ts';
import { SpecError, validateSceneSpec } from '../_shared/designStudio/hybrid/sceneSpec.ts';
import { dnaKey, type PropertyDesignDNA, type RenderEdit, type RenderProduct, type SpecView } from '../../../src/lib/designStudio/renders/contract.ts';
import { callerOf, handleFactory, handleFactoryStatus } from './factory.ts';
import { decodeRgba, encodePng, rgbaOf } from './rasterRgba.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Renders one account may start per hour (a runaway client, not a price). */
const RENDERS_PER_HOUR = 60;
const LEASE_MS = 5 * 60_000;
const MAX_STATUS_IDS = 24;
/** Provider finishes one poll may run (each can take up to a minute; the edge request is bounded). */
const FINISHES_PER_POLL = 1;
const MAX_PICTURE_BYTES = 24 * 1024 * 1024;
const MAX_LEGEND_BYTES = 256 * 1024;
const env = (k: string) => Deno.env.get(k) ?? undefined;
const deps: ProviderDeps = { fetch: (...a) => fetch(...a), env, encodePng };

/** What the browser reads: never the idempotency key, the quote token or the lease. */
const RECORD = 'id, project_id, version_id, kind, parent_id, view, status, factory_job_id, base_key, map_key, final_key, legend, finish, edit, billing, error, created_at, updated_at';

// deno-lint-ignore no-explicit-any
type Row = any;
type Ctx = { caller: Row; admin: Row; actorId: string };

async function billingOn(admin: Row): Promise<boolean> {
  const { data } = await admin.rpc('billing_setting_bool', { p_key: 'design_studio_billing_enabled', p_default: false });
  return data === true;
}

/** The project the caller owns and is not deleting, and a version of it (read as the caller). */
async function ownedVersion(ctx: Ctx, projectId: string, versionId: string) {
  const { data: project } = await ctx.admin.from('ds_projects').select('id, user_id, deleting_at').eq('id', projectId).maybeSingle();
  if (!project || project.deleting_at || String(project.user_id) !== ctx.actorId) return null;
  const { data: version } = await ctx.caller.from('ds_versions').select('id, project_id, archived_at, design_dna').eq('id', versionId).maybeSingle();
  if (!version || version.project_id !== project.id || version.archived_at) return null;
  return { project, version };
}

/** The admin-only provider override for the benchmark: honoured only after is_admin() says yes. */
async function providerOverride(ctx: Ctx, raw: unknown): Promise<{ provider: string; model: string | null } | null | 'FORBIDDEN'> {
  if (raw == null) return null;
  const { data: isAdmin } = await ctx.caller.rpc('is_admin');
  if (isAdmin !== true) return 'FORBIDDEN';
  const o = raw as Record<string, unknown>;
  return { provider: String(o?.provider ?? '').toUpperCase(), model: typeof o?.model === 'string' ? o.model : null };
}

async function recentRenders(admin: Row, actorId: string): Promise<number> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('ds_renders').select('id', { count: 'exact', head: true }).eq('user_id', actorId).gte('created_at', since);
  return count ?? 0;
}

async function dnaHash(dna: unknown): Promise<string | null> {
  return dna && typeof dna === 'object' && (dna as PropertyDesignDNA).version === 'ds-dna-1' ? sha256Hex(dnaKey(dna as PropertyDesignDNA)) : null;
}

// ── Billing helpers ──────────────────────────────────────────────────────

/** The grant a stored reservation stands for (settle/release need nothing else). */
function grantOf(row: Row): ExecutionGrant {
  const b = row.billing ?? {};
  const credits = Number(b.credits) || 0;
  return {
    ok: true, funding: 'PAYG', productCode: String(b.productCode), userId: String(row.user_id), planCode: (b.planCode ?? 'FREE'),
    qualityTier: 'STANDARD', reservationId: b.reservationId ?? null, allowanceId: null, reservedCredits: credits,
    authorizedMaxCredits: credits, estimateMinCredits: credits, estimateMaxCredits: credits, resultCeiling: null,
    providerBudgetCeilingCents: null, priorityLevel: 0, pricingVersion: Number(b.pricingVersion) || 1, partialBudget: false, minViableBudgetCredits: 0,
  };
}

interface Measured { gpuUsd: number | null; aiUsd: number | null; aiKnown: boolean; provider: string | null; model: string | null; ms: number; detail: Record<string, unknown> }

const cents = (usd: number | null) => (usd == null ? undefined : Math.round(usd * 100 * 10000) / 10000);

/** Settle (READY) or release (FAILED) a reserved render, or record its unbilled COGS. Never throws. */
async function closeBilling(admin: Row, row: Row, outcome: 'SETTLE' | 'RELEASE', m: Measured): Promise<Row> {
  const b = row.billing ?? {};
  const known = m.aiKnown && (m.gpuUsd != null || !row.factory_job_id);
  const usage = {
    provider: m.provider ?? 'blender', providerOperation: row.kind === 'EDIT' ? 'image_edit' : 'render_finish', model: m.model ?? undefined,
    durationMs: m.ms, rawProviderCostCents: cents(m.gpuUsd), aiCostCents: cents(m.aiUsd),
    pricingState: (known ? 'ESTIMATED' : 'UNPRICED') as 'ESTIMATED' | 'UNPRICED',
    metadata: { ...m.detail, ds_render_id: row.id, cost_known: known, gpu_usd: m.gpuUsd, image_model_usd: m.aiUsd },
  };
  try {
    if (b.state === 'RESERVED' && b.reservationId) {
      const grant = grantOf(row);
      if (outcome === 'SETTLE') {
        const s = await settleExecution(admin, grant, usage, 'SUCCESS');
        return { ...b, state: 'SETTLED', chargedCredits: s.chargedCredits, releasedCredits: s.releasedCredits };
      }
      await releaseExecution(admin, grant, row.error ?? 'RENDER_FAILED', usage);
      return { ...b, state: 'RELEASED' };
    }
    if (b.state === 'NOT_CHARGED' && !b.metered) {
      const { data: ent } = await admin.rpc('billing_entitlements', { p_user_id: row.user_id });
      const planCode = String((ent as { plan_code?: string } | null)?.plan_code ?? 'FREE').toUpperCase();
      await recordUnbilledUsage(admin, { userId: row.user_id, productCode: String(b.productCode), planCode, jobRef: row.id }, usage);
      return { ...b, metered: true };
    }
  } catch (e) {
    return { ...b, billingError: String((e as Error)?.message ?? e).slice(0, 160) };
  }
  return b;
}

// ── render-quote ─────────────────────────────────────────────────────────

export async function handleRenderQuote(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const ctx = await callerOf(req);
  if ('error' in ctx) return ctx.error!;
  let body: { projectId?: string; versionId?: string; product?: unknown; views?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.projectId)) || !UUID.test(String(body.versionId)) || !isRenderProduct(body.product)) return json({ error: 'BAD_REQUEST' }, 400);
  const views = typeof body.views === 'number' ? body.views : Array.isArray(body.views) ? body.views.length : NaN;
  const credits = quoteCredits(body.product, views);
  if (credits == null) return json({ error: 'BAD_VIEWS', max: RENDER_PRICING.maxViews[body.product] }, 422);
  if (!(await ownedVersion(ctx as Ctx, body.projectId!, body.versionId!))) return json({ error: 'NOT_FOUND' }, 404);
  const secret = await quoteSecret(env);
  if (!secret) return json({ error: 'QUOTE_NOT_CONFIGURED' }, 503);
  const charged = await billingOn(ctx.admin);
  const claims: QuoteClaims = {
    v: 1, u: ctx.actorId, p: body.projectId!, ver: body.versionId!, product: body.product, views, credits, charged,
    exp: Date.now() + QUOTE_TTL_MS, n: crypto.randomUUID(),
  };
  return json({ token: await signQuote(claims, secret), product: claims.product, views, credits, expiresAt: new Date(claims.exp).toISOString(), charged });
}

async function checkQuote(token: unknown, want: Parameters<typeof quoteMatches>[1], admin: Row): Promise<{ claims: QuoteClaims } | { error: Response }> {
  const secret = await quoteSecret(env);
  if (!secret) return { error: json({ error: 'QUOTE_NOT_CONFIGURED' }, 503) };
  const q = await verifyQuote(token, secret);
  if (!q.ok) return { error: json({ error: q.reason }, q.reason === 'QUOTE_EXPIRED' ? 410 : 400) };
  if (!quoteMatches(q.claims, want)) return { error: json({ error: 'QUOTE_MISMATCH' }, 409) };
  // Billing switched between the quote and the start: the customer confirmed something else.
  if ((await billingOn(admin)) !== q.claims.charged) return { error: json({ error: 'QUOTE_STALE' }, 409) };
  return { claims: q.claims };
}

/** Reserve one render's credits (charged) or mark it not charged. */
async function reserveFor(admin: Row, userId: string, product: RenderProduct, credits: number, rowKey: string, charged: boolean, meta: Record<string, unknown>) {
  if (!charged) return { ok: true as const, billing: { credits, reservationId: null, state: 'NOT_CHARGED', productCode: product } };
  const grant = await beginExecution(admin, {
    userId, productCode: product, idempotencyKey: reservationKey(rowKey), jobRef: rowKey,
    authorizedMaxCredits: credits, requireFullBudget: true, allowIncluded: false, metadata: { ...meta, quoted_credits: credits },
  });
  if (!grant.ok || !grant.reservationId) return { ok: false as const, reason: grant.reason ?? 'ERROR', grant };
  return {
    ok: true as const, grant,
    billing: { credits, reservationId: grant.reservationId, state: 'RESERVED', productCode: product, planCode: grant.planCode, pricingVersion: grant.pricingVersion },
  };
}

// ── render-start ─────────────────────────────────────────────────────────

export async function handleRenderStart(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();
  const res = await callerOf(req);
  if ('error' in res) return res.error!;
  const ctx = res as Ctx;
  let body: { quoteToken?: unknown; projectId?: string; versionId?: string; views?: unknown; spec?: unknown; idempotencyKey?: unknown; provider?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.projectId)) || !UUID.test(String(body.versionId)) || !validIdempotencyKey(body.idempotencyKey)) return json({ error: 'BAD_REQUEST' }, 400);
  if (!Array.isArray(body.views) || body.views.length < 1) return json({ error: 'BAD_VIEWS' }, 422);
  const views = body.views.map(validateSpecView);
  if (views.some((v) => !v)) return json({ error: 'BAD_VIEWS' }, 422);
  const vs = views as SpecView[];
  if (new Set(vs.map((v) => v.id)).size !== vs.length) return json({ error: 'BAD_VIEWS' }, 422);
  const product = productForView(vs[0].kind);
  if (vs.some((v) => productForView(v.kind) !== product)) return json({ error: 'MIXED_VIEWS' }, 422);

  const override = await providerOverride(ctx, body.provider);
  if (override === 'FORBIDDEN') return json({ error: 'ADMIN_ONLY' }, 403);
  const owned = await ownedVersion(ctx, body.projectId!, body.versionId!);
  if (!owned) return json({ error: 'NOT_FOUND' }, 404);
  const q = await checkQuote(body.quoteToken, { userId: ctx.actorId, projectId: owned.project.id, versionId: owned.version.id, product, views: vs.length }, ctx.admin);
  if ('error' in q) return q.error;
  const perView = RENDER_PRICING.creditsPerView[product];

  // The same request is the same rows.
  const keys = await Promise.all(vs.map((v) => renderRowKey(ctx.actorId, String(body.idempotencyKey), 'START', v.id)));
  const { data: existingRows } = await ctx.admin.from('ds_renders').select('id, idempotency_key, factory_job_id, status').eq('user_id', ctx.actorId).in('idempotency_key', keys);
  const existing = new Map<string, Row>((existingRows ?? []).map((r: Row) => [r.idempotency_key, r]));
  const respond = async (status = 200, extra: Record<string, unknown> = {}) => {
    const { data } = await ctx.admin.from('ds_renders').select(RECORD).eq('user_id', ctx.actorId).in('idempotency_key', keys).order('created_at');
    return json({ renders: data ?? [], ...extra }, status);
  };
  // Every row already started (or already failed and released): the same answer again, nothing new reserved.
  if (existing.size === keys.length && [...existing.values()].every((r) => r.factory_job_id || r.status === 'FAILED')) return respond(200, { reused: true });

  // The spec must carry these cameras (the factory renders spec.views); a factory without views is refused, never guessed.
  let spec;
  try { spec = validateSceneSpec(body.spec); } catch (e) { return json({ error: 'BAD_SPEC', path: e instanceof SpecError ? e.path : null }, 422); }
  const specViews = (spec as unknown as { views?: Array<{ id?: string }> }).views;
  if (!Array.isArray(specViews)) return json({ error: 'FACTORY_VIEWS_UNSUPPORTED' }, 501);
  const specIds = new Set(specViews.map((v) => v?.id));
  if (vs.some((v) => !specIds.has(v.id))) return json({ error: 'VIEW_NOT_IN_SPEC' }, 422);

  const missing = vs.map((v, i) => ({ v, key: keys[i] })).filter((x) => !existing.has(x.key));
  if (missing.length && (await recentRenders(ctx.admin, ctx.actorId)) + missing.length > RENDERS_PER_HOUR) return json({ error: 'RATE_LIMITED' }, 429);

  // Money first: every new render's credits are held before anything runs.
  const dna = await dnaHash(owned.version.design_dna);
  const reserved: Array<{ v: SpecView; key: string; billing: Row; grant?: ExecutionGrant }> = [];
  for (const m of missing) {
    const r = await reserveFor(ctx.admin, ctx.actorId, product, perView, m.key, q.claims.charged, { ds_project_id: owned.project.id, ds_view_id: m.v.id });
    if (!r.ok) {
      for (const done of reserved) if (done.grant) await releaseExecution(ctx.admin, done.grant, 'RENDER_START_REFUSED').catch(() => null);
      return json({ error: r.reason }, r.reason === 'INSUFFICIENT_CREDITS' || r.reason === 'BELOW_MIN_VIABLE_BUDGET' ? 402 : 409);
    }
    reserved.push({ v: m.v, key: m.key, billing: r.billing, grant: 'grant' in r ? r.grant : undefined });
  }
  const now = new Date().toISOString();
  if (reserved.length) {
    const quote = { product, views: vs.length, credits: q.claims.credits, charged: q.claims.charged, expiresAt: new Date(q.claims.exp).toISOString(), override };
    const { error: insErr } = await ctx.admin.from('ds_renders').upsert(reserved.map((r) => ({
      project_id: owned.project.id, user_id: ctx.actorId, version_id: owned.version.id, kind: r.v.kind, view: r.v, status: 'QUEUED',
      idempotency_key: r.key, quote, billing: r.billing, dna_key: dna, timings: { requestedAt: now }, cost: [],
    })), { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true });
    if (insErr) {
      for (const done of reserved) if (done.grant) await releaseExecution(ctx.admin, done.grant, 'RENDER_NOT_RECORDED').catch(() => null);
      return json({ error: 'RENDER_NOT_RECORDED' }, 500);
    }
  }

  // ONE factory pass for all the views (idempotent by spec: a retry reuses it).
  const factoryReq = new Request(req.url, {
    method: 'POST', headers: { Authorization: req.headers.get('Authorization') ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: owned.project.id, versionId: owned.version.id, pass: 1, spec: body.spec }),
  });
  const fr = await handleFactory(factoryReq, { billedBy: 'RENDER' });
  const started: Row = await fr.json().catch(() => null);
  if (!fr.ok || !started?.jobId) {
    const error = String(started?.error ?? `FACTORY_${fr.status}`).slice(0, 120);
    const { data: rows } = await ctx.admin.from('ds_renders').select('*').eq('user_id', ctx.actorId).in('idempotency_key', keys).in('status', ['QUOTED', 'QUEUED']);
    for (const row of rows ?? []) await failRender(ctx.admin, row, error, null, { gpuUsd: null, aiUsd: null, aiKnown: true, provider: null, model: null, ms: Date.now() - t0, detail: { step: 'factory_start' } });
    return respond(fr.status === 503 ? 503 : 502, { error });
  }
  await ctx.admin.from('ds_renders').update({ factory_job_id: started.jobId, status: started.state === 'RUNNING' ? 'RENDERING' : 'QUEUED', updated_at: new Date().toISOString() })
    .eq('user_id', ctx.actorId).in('idempotency_key', keys).in('status', ['QUOTED', 'QUEUED', 'RENDERING']);
  return respond(200, { ms: Date.now() - t0 });
}

/** QUEUED/RENDERING/FINISHING → FAILED exactly once (compare-and-set), then the money goes back. */
async function failRender(admin: Row, row: Row, error: string, finish: Row | null, m: Measured, expectStatus?: string[]) {
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from('ds_renders').update({ status: 'FAILED', error: error.slice(0, 300), lease_at: null, updated_at: now, ...(finish ? { finish } : {}) })
    .eq('id', row.id).in('status', expectStatus ?? ['QUOTED', 'QUEUED', 'RENDERING', 'FINISHING']).select('*');
  if (!claimed?.length) return;
  const billing = await closeBilling(admin, { ...claimed[0], error }, 'RELEASE', m);
  await admin.from('ds_renders').update({ billing, timings: { ...(claimed[0].timings ?? {}), failedAt: now }, updated_at: now }).eq('id', row.id);
}

// ── render-status ────────────────────────────────────────────────────────

interface ViewRefs { image: Row | null; ids: Row | null; legend: Row | null }

async function factoryState(req: Request, jobId: string): Promise<Row> {
  const r = await handleFactoryStatus(new Request(req.url, {
    method: 'POST', headers: { Authorization: req.headers.get('Authorization') ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }),
  }));
  return r.ok ? await r.json().catch(() => null) : null;
}

async function readBytes(key: string, max: number): Promise<Uint8Array | null> {
  const r = await getObject(key).catch(() => null);
  if (!r || !r.ok) { await r?.arrayBuffer().catch(() => null); return null; }
  const b = new Uint8Array(await r.arrayBuffer());
  return b.length > 0 && b.length <= max ? b : null;
}

const finalKeyFor = (row: Row, suffix: string, mime: string) =>
  `users/${row.user_id}/design-studio-thumbnails/${row.project_id}/${row.id}-${suffix}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'}`;

const blenderFinish = (reason: string | null, check: CheckResult | null = null, r?: ImageResult) => ({
  provider: r ? r.provider : 'BLENDER', model: r ? r.model : null,
  check: check ? { accepted: check.accepted, edgeAgreement: check.edgeAgreement, maskAgreement: check.maskAgreement, reason: check.reason } : reason ? { accepted: false, edgeAgreement: null, maskAgreement: null, reason } : null,
  ms: r ? r.ms : null, usd: r ? r.cost.usd : null,
});

/** The finish: provider over the Blender picture, the structure check, the final picture, the money. */
async function finishRender(ctx: Ctx, row: Row, lease: string, refs: ViewRefs, gpuUsd: number | null): Promise<void> {
  const t0 = Date.now();
  const now = () => new Date().toISOString();
  const base = refs.image?.key ? await readBytes(refs.image.key, MAX_PICTURE_BYTES) : null;
  let legend: Row = null;
  if (refs.legend?.key) {
    const raw = await readBytes(refs.legend.key, MAX_LEGEND_BYTES);
    try { legend = raw ? validateLegend(JSON.parse(new TextDecoder().decode(raw))) : null; } catch { legend = null; }
  }
  const measured = (r?: ImageResult): Measured => ({
    gpuUsd, aiUsd: r ? r.cost.usd : 0, aiKnown: r ? r.cost.basis === 'ESTIMATED' : true, provider: r?.provider ?? null, model: r?.model ?? null,
    ms: Date.now() - t0, detail: { step: 'finish', view_id: row.view?.id ?? null, cost_detail: r?.cost.detail ?? null },
  });
  if (!base) {
    await failRender(ctx.admin, row, 'BASE_UNREADABLE', null, measured(), ['FINISHING']);
    return;
  }
  const decoded = decodeRgba(base);
  let finish: Row = blenderFinish('NO_FINISH');
  let finalKey: string = refs.image!.key;
  let result: ImageResult | undefined;
  let checkMs: number | null = null;
  const override = row.quote?.override ?? null;
  const provider: ImageProvider | null = decoded.ok ? selectProvider(deps, override) : null;
  if (!decoded.ok) finish = blenderFinish(`BASE_${decoded.reason}`);
  else if (!provider) finish = blenderFinish('FINISH_NOT_CONFIGURED');
  else {
    const { data: ver } = await ctx.caller.from('ds_versions').select('design_dna').eq('id', row.version_id).maybeSingle();
    let roomKind: string | null = null;
    if (row.view?.roomId && row.factory_job_id) {
      const { data: job } = await ctx.admin.from('ds_factory_jobs').select('spec').eq('id', row.factory_job_id).maybeSingle();
      roomKind = (job?.spec?.rooms ?? []).find((r: Row) => r?.id === row.view.roomId)?.kind ?? null;
    }
    const prompt = finishPrompt({ dna: (ver?.design_dna ?? null) as PropertyDesignDNA | null, viewKind: row.view.kind, roomKind });
    const mime = base[0] === 0x89 ? 'image/png' as const : 'image/jpeg' as const;
    result = await provider.finish({ base: { bytes: base, mime }, prompt, size: { width: decoded.img.width, height: decoded.img.height } });
    if (!result.ok) finish = blenderFinish(result.error, null, result);
    else {
      const out = decodeRgba(result.bytes);
      if (!out.ok) finish = blenderFinish(`FINISH_${out.reason}`, null, result);
      else {
        const c0 = Date.now();
        let map: { ids: RgbPixels; targets: Row[] } | null = null;
        if (refs.ids?.key && legend) {
          const idBytes = await readBytes(refs.ids.key, MAX_PICTURE_BYTES);
          const ids = idBytes ? decodeRgba(idBytes) : null;
          if (ids?.ok) map = { ids: ids.img, targets: legend.entries };
        }
        const check = checkFinish(rgbToGray(decoded.img), rgbToGray(out.img), map);
        checkMs = Date.now() - c0;
        finish = blenderFinish(null, check, result);
        if (check.accepted) {
          const key = finalKeyFor(row, 'final', result.mime);
          const stored = await putObject(key, result.bytes, result.mime).then(() => true).catch(() => false);
          if (stored) finalKey = key; else finish.check.reason = 'FINAL_NOT_STORED';
        }
      }
    }
  }
  const m = measured(result);
  const cost = [
    { stage: 'RENDERING', kind: 'GPU', usd: gpuUsd, basis: gpuUsd == null ? 'NOT_AVAILABLE' : 'MEASURED', detail: `share of factory pass ${row.factory_job_id}` },
    ...(result ? [{ stage: 'RENDERING', kind: 'IMAGE_MODEL', usd: result.cost.usd, basis: result.cost.basis === 'ESTIMATED' ? 'ESTIMATED' : 'NOT_AVAILABLE', detail: result.cost.detail }] : []),
  ];
  // READY exactly once: only the holder of this lease writes it.
  const { data: done } = await ctx.admin.from('ds_renders').update({
    status: 'READY', final_key: finalKey, legend, finish, cost, lease_at: null, error: null, updated_at: now(),
    timings: { ...(row.timings ?? {}), readyAt: now(), finishMs: result?.ms ?? null, checkMs, finishTotalMs: Date.now() - t0 },
  }).eq('id', row.id).eq('status', 'FINISHING').eq('lease_at', lease).select('*');
  if (!done?.length) return;
  const billing = await closeBilling(ctx.admin, done[0], 'SETTLE', m);
  await ctx.admin.from('ds_renders').update({ billing, updated_at: now() }).eq('id', row.id);
}

/** Moves one render forward as far as it can go in this poll. */
async function advance(req: Request, ctx: Ctx, row: Row, jobs: Map<string, Row>, budget: { finishes: number }): Promise<void> {
  if (String(row.user_id) !== ctx.actorId) return; // an administrator reads; only the owner's poll spends
  const lapsed = new Date(Date.now() - LEASE_MS).toISOString();
  const leaseStale = row.status === 'FINISHING' && (!row.lease_at || row.lease_at < lapsed);
  if (row.kind === 'EDIT') {
    if (leaseStale) await failRender(ctx.admin, row, 'EDIT_INTERRUPTED', null, { gpuUsd: null, aiUsd: null, aiKnown: false, provider: null, model: null, ms: 0, detail: { step: 'edit_lapsed' } }, ['FINISHING']);
    return;
  }
  if (!['QUEUED', 'RENDERING'].includes(row.status) && !leaseStale) return;
  if (!row.factory_job_id) return;
  if (!jobs.has(row.factory_job_id)) jobs.set(row.factory_job_id, await factoryState(req, row.factory_job_id));
  const st = jobs.get(row.factory_job_id);
  if (!st) return;
  const noCost: Measured = { gpuUsd: null, aiUsd: null, aiKnown: true, provider: null, model: null, ms: 0, detail: { step: 'factory' } };
  if (st.state === 'QUEUED' || st.state === 'RUNNING') {
    if (row.status === 'QUEUED' && st.state === 'RUNNING') await ctx.admin.from('ds_renders').update({ status: 'RENDERING', updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'QUEUED');
    return;
  }
  if (st.state !== 'COMPLETED') { await failRender(ctx.admin, row, `FACTORY_${st.state}`, null, noCost); return; }
  const refs: ViewRefs = st.outputs?.views?.[row.view?.id] ?? { image: null, ids: null, legend: null };
  if (!refs.image?.key) { await failRender(ctx.admin, row, 'VIEW_NOT_BUILT', null, noCost); return; }

  // One finish per poll (a provider call takes up to a minute; the next poll takes the next view).
  if (budget.finishes <= 0) return;
  // Exactly one poller finishes: compare-and-set on status (and a lapsed lease).
  const lease = new Date().toISOString();
  const { data: claimed } = await ctx.admin.from('ds_renders')
    .update({ status: 'FINISHING', lease_at: lease, base_key: refs.image.key, map_key: refs.ids?.key ?? null, updated_at: lease, timings: { ...(row.timings ?? {}), renderedAt: lease } })
    .eq('id', row.id)
    .or(`status.in.(QUEUED,RENDERING),and(status.eq.FINISHING,lease_at.lt.${lapsed}),and(status.eq.FINISHING,lease_at.is.null)`)
    .select('*');
  if (!claimed?.length) return;
  budget.finishes -= 1;
  // The pass's GPU cost, shared across the renders it drew (unknown stays unknown).
  const gpuTotal = Array.isArray(st.cost) ? st.cost.filter((c: Row) => c?.kind === 'GPU').reduce((s: number | null, c: Row) => (s == null || c.usd == null ? null : s + Number(c.usd)), 0) : null;
  const { count } = await ctx.admin.from('ds_renders').select('id', { count: 'exact', head: true }).eq('factory_job_id', row.factory_job_id);
  const gpuUsd = gpuTotal == null ? null : Math.round((gpuTotal / Math.max(1, count ?? 1)) * 1e6) / 1e6;
  try {
    await finishRender(ctx, claimed[0], lease, refs, gpuUsd);
  } catch (e) {
    await failRender(ctx.admin, claimed[0], `FINISH_CRASHED:${String((e as Error)?.message ?? '').slice(0, 80)}`, null, { ...noCost, gpuUsd, aiKnown: false }, ['FINISHING']);
  }
}

export async function handleRenderStatus(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const res = await callerOf(req);
  if ('error' in res) return res.error!;
  const ctx = res as Ctx;
  let body: { renderIds?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const ids = Array.isArray(body.renderIds) ? [...new Set(body.renderIds.map(String))] : [];
  if (!ids.length || ids.length > MAX_STATUS_IDS || ids.some((id) => !UUID.test(id))) return json({ error: 'BAD_REQUEST' }, 400);
  // RLS decides what exists.
  const { data: rows } = await ctx.caller.from('ds_renders').select('*').in('id', ids);
  const jobs = new Map<string, Row>();
  const budget = { finishes: FINISHES_PER_POLL };
  for (const row of rows ?? []) await advance(req, ctx, row, jobs, budget);
  const { data: out } = await ctx.caller.from('ds_renders').select(RECORD).in('id', ids);
  return json({ renders: out ?? [] });
}

// ── render-edit ──────────────────────────────────────────────────────────

const TARGET_KINDS = ['OBJECT', 'FLOOR', 'WALL', 'CEILING', 'STAIRS', 'DOOR', 'WINDOW', 'OTHER'];
function validateAppearance(raw: unknown, targetId: string): Extract<RenderEdit, { type: 'APPEARANCE' }> | null {
  const e = raw as Record<string, unknown>;
  if (!e || e.type !== 'APPEARANCE' || e.targetId !== targetId || !TARGET_KINDS.includes(String(e.targetKind))) return null;
  const color = e.color == null ? null : typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color.toLowerCase() : undefined;
  const materialId = e.materialId == null ? null : typeof e.materialId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$/.test(e.materialId) ? e.materialId : undefined;
  if (color === undefined || materialId === undefined || (color === null && materialId === null)) return null;
  if (typeof e.label !== 'string' || e.label.length > 80) return null;
  return { type: 'APPEARANCE', targetId, targetKind: e.targetKind as Extract<RenderEdit, { type: 'APPEARANCE' }>['targetKind'], color, materialId, label: e.label };
}

export async function handleRenderEdit(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();
  const res = await callerOf(req);
  if ('error' in res) return res.error!;
  const ctx = res as Ctx;
  let body: { renderId?: string; targetId?: unknown; edit?: unknown; newVersionId?: string; quoteToken?: unknown; idempotencyKey?: unknown; provider?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  if (!UUID.test(String(body.renderId)) || !UUID.test(String(body.newVersionId)) || !validIdempotencyKey(body.idempotencyKey)) return json({ error: 'BAD_REQUEST' }, 400);
  if (typeof body.targetId !== 'string' || body.targetId.length < 1 || body.targetId.length > 160) return json({ error: 'BAD_REQUEST' }, 400);
  const edit = validateAppearance(body.edit, body.targetId);
  if (!edit) return json({ error: 'BAD_EDIT' }, 422);
  const override = await providerOverride(ctx, body.provider);
  if (override === 'FORBIDDEN') return json({ error: 'ADMIN_ONLY' }, 403);

  const { data: parent } = await ctx.caller.from('ds_renders').select('*').eq('id', body.renderId).maybeSingle();
  if (!parent || String(parent.user_id) !== ctx.actorId) return json({ error: 'NOT_FOUND' }, 404);
  if (parent.status !== 'READY' || !parent.map_key || !parent.legend) return json({ error: 'RENDER_NOT_EDITABLE' }, 409);
  const entry = (parent.legend.entries ?? []).find((e: Row) => e?.id === body.targetId);
  if (!entry) return json({ error: 'TARGET_NOT_FOUND' }, 404);
  const owned = await ownedVersion(ctx, parent.project_id, body.newVersionId!);
  if (!owned) return json({ error: 'NOT_FOUND' }, 404);
  const q = await checkQuote(body.quoteToken, { userId: ctx.actorId, projectId: parent.project_id, versionId: owned.version.id, product: 'DS_RENDER_EDIT', views: 1 }, ctx.admin);
  if ('error' in q) return q.error;

  const key = await renderRowKey(ctx.actorId, String(body.idempotencyKey), 'EDIT', `${parent.id}:${body.targetId}`);
  const again = async () => (await ctx.admin.from('ds_renders').select(RECORD).eq('user_id', ctx.actorId).eq('idempotency_key', key).maybeSingle()).data;
  const prior = await again();
  if (prior) return json({ render: prior, reused: true });
  if ((await recentRenders(ctx.admin, ctx.actorId)) >= RENDERS_PER_HOUR) return json({ error: 'RATE_LIMITED' }, 429);

  const credits = RENDER_PRICING.creditsPerView.DS_RENDER_EDIT;
  const r = await reserveFor(ctx.admin, ctx.actorId, 'DS_RENDER_EDIT', credits, key, q.claims.charged, { ds_project_id: parent.project_id, ds_parent_render: parent.id });
  if (!r.ok) return json({ error: r.reason }, r.reason === 'INSUFFICIENT_CREDITS' || r.reason === 'BELOW_MIN_VIABLE_BUDGET' ? 402 : 409);
  const lease = new Date().toISOString();
  const { data: inserted } = await ctx.admin.from('ds_renders').upsert({
    project_id: parent.project_id, user_id: ctx.actorId, version_id: owned.version.id, kind: 'EDIT', parent_id: parent.id, view: parent.view,
    status: 'FINISHING', lease_at: lease, base_key: parent.final_key ?? parent.base_key, map_key: parent.map_key, legend: parent.legend, edit,
    idempotency_key: key, quote: { product: 'DS_RENDER_EDIT', views: 1, credits, charged: q.claims.charged, override }, billing: r.billing,
    dna_key: await dnaHash(owned.version.design_dna), timings: { requestedAt: lease }, cost: [],
  }, { onConflict: 'user_id,idempotency_key', ignoreDuplicates: true }).select('*');
  const row = inserted?.[0];
  if (!row) {
    // A concurrent identical request recorded it first; its reservation is the same one (same key).
    return json({ render: await again(), reused: true });
  }

  const m = (res2?: ImageResult): Measured => ({
    gpuUsd: null, aiUsd: res2 ? res2.cost.usd : 0, aiKnown: res2 ? res2.cost.basis === 'ESTIMATED' : true, provider: res2?.provider ?? null, model: res2?.model ?? null,
    ms: Date.now() - t0, detail: { step: 'edit', target_id: edit.targetId, target_kind: edit.targetKind },
  });
  const fail = async (code: string, status: number, finish: Row | null = null, res2?: ImageResult) => {
    await failRender(ctx.admin, row, code, finish, m(res2), ['FINISHING']);
    return json({ render: await again(), error: code }, status);
  };
  const provider = selectProvider(deps, override);
  if (!provider) return fail('EDIT_NOT_CONFIGURED', 503);
  const [imgBytes, idBytes] = await Promise.all([readBytes(row.base_key, MAX_PICTURE_BYTES), readBytes(row.map_key, MAX_PICTURE_BYTES)]);
  const img = imgBytes ? decodeRgba(imgBytes) : null; const ids = idBytes ? decodeRgba(idBytes) : null;
  if (!img?.ok || !ids?.ok) return fail('PICTURE_UNREADABLE', 422);
  const raw = maskFromIds(ids.img, entry.color, 2);
  if (!raw.pixels) return fail('TARGET_NOT_VISIBLE', 422);
  const mask = raw.width === img.img.width && raw.height === img.img.height ? raw : { width: img.img.width, height: img.img.height, data: resizeMask(raw, img.img.width, img.img.height) };
  // The image goes as PNG: OpenAI requires the image and its mask in the same format and size.
  const png = encodePng(rgbaOf(img.img), img.img.width, img.img.height);
  const result = await provider.edit({ image: { bytes: png, mime: 'image/png' }, mask, prompt: editPrompt(edit), size: { width: img.img.width, height: img.img.height } });
  if (!result.ok) return fail(result.error, 502, blenderFinish(result.error, null, result), result);
  const out = decodeRgba(result.bytes);
  if (!out.ok) return fail(`EDIT_${out.reason}`, 502, blenderFinish(`EDIT_${out.reason}`, null, result), result);
  const c0 = Date.now();
  const check = checkEdit(rgbToGray(img.img), rgbToGray(out.img), mask);
  const checkMs = Date.now() - c0;
  const finish = blenderFinish(null, check, result);
  if (!check.accepted) return fail('EDIT_REFUSED', 422, finish, result);
  // Outside the mask the original pixels are kept exactly.
  const merged = compositeInsideMask(img.img, out.img, mask);
  const finalKey = finalKeyFor(row, 'edit', 'image/png');
  const stored = await putObject(finalKey, encodePng(rgbaOf(merged), merged.width, merged.height), 'image/png').then(() => true).catch(() => false);
  if (!stored) return fail('FINAL_NOT_STORED', 502, finish, result);
  const cost = [{ stage: 'RENDERING', kind: 'IMAGE_MODEL', usd: result.cost.usd, basis: result.cost.basis === 'ESTIMATED' ? 'ESTIMATED' : 'NOT_AVAILABLE', detail: result.cost.detail }];
  const nowIso = new Date().toISOString();
  const { data: done } = await ctx.admin.from('ds_renders').update({
    status: 'READY', final_key: finalKey, finish, cost, lease_at: null, updated_at: nowIso,
    timings: { requestedAt: lease, readyAt: nowIso, editMs: result.ms, checkMs, totalMs: Date.now() - t0 },
  }).eq('id', row.id).eq('status', 'FINISHING').eq('lease_at', lease).select('*');
  if (done?.length) {
    const billing = await closeBilling(ctx.admin, done[0], 'SETTLE', m(result));
    await ctx.admin.from('ds_renders').update({ billing, updated_at: new Date().toISOString() }).eq('id', row.id);
  }
  return json({ render: await again() });
}
