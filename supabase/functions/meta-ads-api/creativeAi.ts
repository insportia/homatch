// META ADS — HOMATCH AI CREATIVE INTELLIGENCE (server side).
//
// Nothing here runs on upload. Every operation is a customer's explicit click:
//
//   creative_ai_analyze   read ONE of the customer's images + the campaign and
//                         return 2–3 concepts. Cached by fingerprint
//                         (meta_creative_ai_jobs, kind ANALYSIS); `force` is the
//                         explicit "Re-analyse". Free to the customer, metered
//                         as HOMATCH cost (cost_events), rate-limited.
//   creative_ai_quote     what N variations will cost, from the canonical
//                         price (billing_price_quote) — never from the client.
//   creative_ai_generate  PAID: quote → (client confirmation) → wallet reserve
//                         (_shared/billing.ts beginExecution, idempotent per
//                         job) → generate → validate → settle on the measured
//                         provider cost of the images actually delivered, or
//                         release when none were. Runs in the background; the
//                         job row carries the real stage.
//   creative_ai_job       poll one job (stage, outcome, signed previews).
//   creative_ai_use       turn chosen generated images into NEW creatives with
//                         lineage. The original upload is never written to.
//   creative_ai_discard   hide one variation from the gallery (lineage kept).
//
// Provider: OpenAI (the platform's existing AI provider) — vision through the
// Responses API, images through gpt-image-1 edits. Keys stay in the function
// environment; prompts are built server-side (src/lib/metaAds/creativeAi.ts)
// and never returned to the client.

import {
  ANALYSIS_SCHEMA, analysisFingerprint, analysisSystemPrompt, analysisUserText, clampVariations, generationPrompt,
  roleToCreative, sanitizeInstruction, sizeForAspect, tokenCostCents, validateAnalysis, validGeneratedImage,
  type AiStage, type AssetRole, type CreativeAnalysis, type CreativeContext,
} from '../../../src/lib/metaAds/creativeAi.ts';
import type { ExecutionGrant } from '../_shared/billing.ts';
import { estimatedProviderCost } from '../_shared/providerCost.ts';
import type { ActionCtx } from './actions.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type Sb = any;
const BUCKET = 'meta-ads-media';
const PRODUCT = 'META_AD_IMAGE_GEN';
const IMAGE_MODEL = Deno.env.get('OPENAI_META_IMAGE_MODEL') || 'gpt-image-1';
const VISION_MODEL = Deno.env.get('OPENAI_META_CREATIVE_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const ANALYSES_PER_HOUR = 20;
const RUNNING_LIMIT = 2;
/** An edge background task cannot outlive ~400 s; a RUNNING job older than this died. */
const STALE_MS = 8 * 60_000;
/** gpt-image-1 medium-quality output tokens per size (OpenAI's published table) — used only if a response omits usage. */
const OUTPUT_TOKENS_BY_SIZE: Record<string, number> = { '1024x1024': 1056, '1024x1536': 1584, '1536x1024': 1568 };
const LANGS: Record<string, string> = { en: 'English', ka: 'Georgian', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew' };
const UUID = /^[0-9a-f-]{36}$/i;

/* The wallet gateway is loaded on first paid use: it pulls the Supabase client
   from a URL, and the action router (and its Node tests) must not load it eagerly. */
const billing = () => import('../_shared/billing.ts');

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ tag: 'meta_creative_ai', event, ...data }));

function textOf(p: any): string {
  if (typeof p?.output_text === 'string') return p.output_text;
  for (const o of p?.output ?? []) for (const c of o?.content ?? []) if (typeof c?.text === 'string') return c.text;
  return '';
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function ownCreative(sb: Sb, uid: string, id: unknown) {
  if (!UUID.test(String(id ?? ''))) return null;
  const { data } = await sb.from('meta_creatives').select('*').eq('id', String(id)).eq('user_id', uid).maybeSingle();
  return data ?? null;
}

/** The creative's own image (never a video, never another user's path). */
function sourceOf(uid: string, cr: any): { path: string; mime: string; width: number | null; height: number | null } | null {
  const m = Array.isArray(cr?.media) ? cr.media[0] : null;
  if (!m?.path || !String(m.mime ?? '').startsWith('image/')) return null;
  if (!String(m.path).startsWith(`${uid}/`)) return null;
  return { path: String(m.path), mime: String(m.mime), width: m.width ?? null, height: m.height ?? null };
}

async function contextOf(sb: Sb, uid: string, cr: any, locale: string): Promise<CreativeContext> {
  const ctx: CreativeContext = { headline: cr.headline ?? null, primaryText: cr.primary_text ?? null, language: LANGS[locale] ?? 'English' };
  if (!cr.campaign_id) return ctx;
  const { data: c } = await sb.from('meta_campaigns').select('goal,offer,targeting,property_id').eq('id', cr.campaign_id).eq('user_id', uid).maybeSingle();
  if (!c) return ctx;
  ctx.goal = c.goal ?? null;
  ctx.offer = c.offer ?? null;
  ctx.locations = (Array.isArray(c.targeting?.locations) ? c.targeting.locations : []).map((l: any) => String(l?.name ?? '')).filter(Boolean).slice(0, 6);
  if (c.property_id) {
    const byHomatchId = /^\d{6}$/.test(String(c.property_id));
    const { data: prop } = await sb.from('properties').select('id,transaction_type,property_type,user_id')
      .eq(byHomatchId ? 'homatch_id' : 'id', byHomatchId ? Number(c.property_id) : c.property_id).maybeSingle();
    if (prop && prop.user_id === uid) {
      const { data: facts } = await sb.from('property_facts').select('city').eq('property_id', prop.id).maybeSingle();
      // Never the address or the contact phone.
      ctx.propertyType = prop.property_type ?? null; ctx.dealKind = prop.transaction_type ?? null; ctx.city = facts?.city ?? null;
    }
  }
  return ctx;
}

async function download(sb: Sb, path: string): Promise<Uint8Array | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  return buf.length && buf.length <= MAX_SOURCE_BYTES ? buf : null;
}

async function signed(sb: Sb, path: string): Promise<string | null> {
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** The customer-safe view of a job: no prompt, no reservation id, no provider detail. */
async function publicJob(sb: Sb, j: any) {
  const images = Array.isArray(j.result?.images) ? j.result.images : [];
  return {
    id: j.id, kind: j.kind, status: j.status, stage: j.stage, error: j.status === 'FAILED' ? (j.error ?? 'FAILED') : null,
    creativeId: j.creative_id, conceptId: j.input?.conceptId ?? null, requested: j.input?.variations ?? null,
    quotedCredits: j.quoted_credits != null ? Number(j.quoted_credits) : null,
    chargedCredits: j.charged_credits != null ? Number(j.charged_credits) : null,
    analysis: j.kind === 'ANALYSIS' && j.status === 'DONE' ? j.result : null,
    images: j.kind === 'ANALYSIS' ? [] : await Promise.all(images.map(async (im: any) => ({
      index: im.index, width: im.width, height: im.height, discarded: !!im.discarded, url: im.discarded ? null : await signed(sb, im.path),
    }))),
    createdAt: j.created_at, updatedAt: j.updated_at,
  };
}

async function quoteFor(sb: Sb, uid: string, variations: number) {
  const { data: ent } = await sb.rpc('billing_entitlements', { p_user_id: uid });
  const plan = String(ent?.plan_code ?? 'FREE');
  const product = (ent?.products ?? []).find((p: any) => p.product_code === PRODUCT);
  const { data: q, error } = await sb.rpc('billing_price_quote', { p_product_code: PRODUCT, p_plan_code: plan, p_landed_cogs_cents: null });
  if (error || !q?.[0]) return null;
  const { data: prod } = await sb.from('billable_products').select('config').eq('code', PRODUCT).maybeSingle();
  const spread = Number(prod?.config?.estimate_spread_bps ?? 2500) / 10000;
  const unit = Number(q[0].credits);
  const expected = Math.round(unit * variations * 100) / 100;
  // Exactly what beginExecution will hold (estimate × (1 + spread)); settlement charges the measured cost.
  const max = Math.round(expected * (1 + spread) * 100) / 100;
  const balance = Number(ent?.wallet?.balance ?? 0);
  return { variations, unitCredits: unit, expectedCredits: expected, maxCredits: max, balanceCredits: balance,
    enough: balance >= max, available: !!product?.payg_available };
}

async function imagePriced(sb: Sb): Promise<boolean> {
  const [i, o] = await Promise.all([
    estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: 1_000_000, model: IMAGE_MODEL }),
    estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: 1_000_000, model: IMAGE_MODEL }),
  ]);
  return i != null && o != null && o > 0;
}

async function setStage(sb: Sb, jobId: string, stage: AiStage, extra: Record<string, unknown> = {}) {
  await sb.from('meta_creative_ai_jobs').update({ stage, updated_at: new Date().toISOString(), ...extra }).eq('id', jobId);
}

/* ── ANALYSIS ──────────────────────────────────────────────────────── */
async function runAnalysis(sb: Sb, uid: string, jobId: string, src: { path: string; mime: string }, ctx: CreativeContext): Promise<CreativeAnalysis | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return null;
  const bytes = await download(sb, src.path);
  if (!bytes) return null;
  const started = Date.now();
  let payload: any = null;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        input: [
          { role: 'system', content: analysisSystemPrompt(ctx.language ?? 'English') },
          { role: 'user', content: [
            { type: 'input_text', text: analysisUserText(ctx) },
            { type: 'input_image', image_url: `data:${src.mime};base64,${b64(bytes)}` },
          ] },
        ],
        text: { format: { type: 'json_schema', name: 'meta_creative_analysis', strict: false, schema: ANALYSIS_SCHEMA } },
      }),
    });
    payload = r.ok ? await r.json() : null;
    if (!r.ok) log('analysis_provider_error', { jobId, status: r.status });
  } catch {
    payload = null;
  }
  const inTok = Number(payload?.usage?.input_tokens ?? 0);
  const outTok = Number(payload?.usage?.output_tokens ?? 0);
  if (payload) {
    const inCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: inTok, model: VISION_MODEL });
    const outCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: outTok, model: VISION_MODEL });
    const raw = inCost != null && outCost != null ? inCost + outCost : null;
    await sb.from('cost_events').insert({
      provider: 'OPENAI', operation_type: 'meta_ads_creative_analysis', source: 'meta-ads-api',
      units: inTok + outTok, cost_usd: raw ?? 0, success: true, cache_hit: false,
      pricing_state: raw == null ? 'UNPRICED' : 'ESTIMATED',
    });
    log('analysis_done', { jobId, ms: Date.now() - started, inTok, outTok, priced: raw != null });
  }
  let parsed: unknown = null;
  try { parsed = JSON.parse(textOf(payload)); } catch { parsed = null; }
  return validateAnalysis(parsed);
}

/* ── GENERATION (background) ───────────────────────────────────────── */
async function runGeneration(sb: Sb, args: {
  uid: string; jobId: string; grant: ExecutionGrant; src: { path: string; mime: string; width: number | null; height: number | null };
  analysis: CreativeAnalysis; analysisJobId: string; conceptId: string; ctx: CreativeContext; instruction: string; variations: number; refine: boolean;
}) {
  const { uid, jobId, grant, src, analysis, ctx, instruction, variations, refine } = args;
  const concept = analysis.concepts.find((c) => c.id === args.conceptId)!;
  const size = sizeForAspect(src.width, src.height);
  const [w, h] = size.split('x').map(Number);
  let settled = false;
  const usage = { inputTokens: 0, outputTokens: 0, estimated: false };
  const { settleExecution, releaseExecution } = await billing();
  try {
    await setStage(sb, jobId, 'PREPARING');
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    const bytes = await download(sb, src.path);
    if (!apiKey || !bytes) throw new Error('SOURCE_UNAVAILABLE');
    const prompts = Array.from({ length: variations }, (_, i) => generationPrompt({ analysis, concept, ctx, instruction, variation: i, refine }));

    await setStage(sb, jobId, 'GENERATING');
    const started = Date.now();
    const calls = await Promise.allSettled(prompts.map(async (prompt) => {
      const form = new FormData();
      form.append('model', IMAGE_MODEL);
      form.append('image', new Blob([bytes], { type: src.mime }), `source.${src.mime.split('/')[1] || 'png'}`);
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', size);
      form.append('quality', 'medium');
      const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      const p = await r.json().catch(() => null);
      if (!r.ok) { log('image_provider_error', { jobId, status: r.status, code: p?.error?.code ?? null }); return null; }
      return p;
    }));

    await setStage(sb, jobId, 'CHECKING');
    const good: Array<{ bytes: Uint8Array; inTok: number; outTok: number; estimated: boolean }> = [];
    for (const c of calls) {
      const p = c.status === 'fulfilled' ? c.value : null;
      const b = p?.data?.[0]?.b64_json ? unb64(String(p.data[0].b64_json)) : null;
      if (!b || !validGeneratedImage(b, { width: w, height: h })) continue;
      const hasUsage = Number.isFinite(Number(p?.usage?.output_tokens)) && Number(p.usage.output_tokens) > 0;
      good.push({
        bytes: b,
        inTok: hasUsage ? Number(p.usage.input_tokens ?? 0) : 0,
        outTok: hasUsage ? Number(p.usage.output_tokens) : OUTPUT_TOKENS_BY_SIZE[size] ?? 1584,
        estimated: !hasUsage,
      });
    }

    await setStage(sb, jobId, 'SAVING');
    const images: Array<{ index: number; path: string; width: number; height: number; size: number }> = [];
    for (const g of good) {
      const index = images.length + 1;
      const path = `${uid}/ai/${jobId}/${index}.png`;
      const { error } = await sb.storage.from(BUCKET).upload(path, g.bytes, { contentType: 'image/png', upsert: false });
      if (error) continue;
      images.push({ index, path, width: w, height: h, size: g.bytes.length });
      usage.inputTokens += g.inTok; usage.outputTokens += g.outTok; usage.estimated ||= g.estimated;
    }

    // Partial policy: the customer pays only for images delivered (generated, valid, saved).
    const [inRate, outRate] = await Promise.all([
      estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: 1_000_000, model: IMAGE_MODEL }),
      estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: 1_000_000, model: IMAGE_MODEL }),
    ]);
    const costCents = tokenCostCents(usage, { input: inRate ?? 0, output: outRate ?? 0, perUnits: 1_000_000 });
    const actual = {
      provider: 'OPENAI', providerOperation: refine ? 'meta_ad_image_refine' : 'meta_ad_image_generate', model: IMAGE_MODEL,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, providerUnits: images.length, durationMs: Date.now() - started,
      aiCostCents: costCents, pricingState: usage.estimated ? 'ESTIMATED' as const : 'ACTUAL' as const,
      metadata: { jobId, requested: variations, delivered: images.length, size, conceptId: concept.id },
    };

    if (!images.length) {
      await releaseExecution(sb, grant, 'NO_USABLE_IMAGES', { ...actual, failureReason: 'NO_USABLE_IMAGES' });
      settled = true;
      await sb.from('meta_creative_ai_jobs').update({ status: 'FAILED', stage: 'FAILED', error: 'GENERATION_FAILED', charged_credits: 0, updated_at: new Date().toISOString() }).eq('id', jobId);
      log('generation_released', { jobId, requested: variations });
      return;
    }
    const s = await settleExecution(sb, grant, actual, images.length < variations ? 'PARTIAL' : 'SUCCESS');
    settled = true;
    await sb.from('meta_creative_ai_jobs').update({
      status: 'DONE', stage: 'DONE', charged_credits: s.chargedCredits, updated_at: new Date().toISOString(),
      result: { images, requested: variations, delivered: images.length, conceptId: concept.id, sourcePath: src.path, analysisJobId: args.analysisJobId },
    }).eq('id', jobId);
    log('generation_settled', { jobId, requested: variations, delivered: images.length, costCents, charged: s.chargedCredits, released: s.releasedCredits });
  } catch (e) {
    log('generation_failed', { jobId, error: String((e as Error)?.message ?? e).slice(0, 120) });
    if (!settled) await releaseExecution(sb, grant, 'GENERATION_ERROR').catch(() => undefined);
    await sb.from('meta_creative_ai_jobs').update({ status: 'FAILED', stage: 'FAILED', error: 'GENERATION_FAILED', charged_credits: 0, updated_at: new Date().toISOString() }).eq('id', jobId);
  }
}

/** A RUNNING job whose worker died: give the hold back and say so (never leave credits held). */
async function recoverStale(sb: Sb, uid: string, j: any) {
  if (j.status !== 'RUNNING' || Date.now() - new Date(j.updated_at).getTime() < STALE_MS) return j;
  if (j.reservation_id) {
    const { releaseExecution } = await billing();
    const grant = { ok: true, funding: 'PAYG', productCode: PRODUCT, userId: uid, reservationId: j.reservation_id, allowanceId: null } as unknown as ExecutionGrant;
    await releaseExecution(sb, grant, 'STALE_JOB').catch(() => undefined);
  }
  const patch = { status: 'FAILED', stage: 'FAILED', error: 'TIMED_OUT', updated_at: new Date().toISOString() };
  await sb.from('meta_creative_ai_jobs').update(patch).eq('id', j.id).eq('status', 'RUNNING');
  log('job_stale_released', { jobId: j.id });
  return { ...j, ...patch };
}

export async function handleCreativeAi(x: ActionCtx): Promise<Response | null> {
  const { sb, uid, me, body, action, settings, json } = x;
  const locale = String(body.locale ?? 'en').slice(0, 2);
  const enabled = settings.aiCreativeEnabled && !!Deno.env.get('OPENAI_API_KEY');

  switch (action) {
    case 'creative_ai_analyze': {
      if (!enabled) return json({ error: 'AI_UNAVAILABLE', code: 'AI_UNAVAILABLE' }, 503);
      const cr = await ownCreative(sb, uid, body.creativeId);
      if (!cr) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const src = sourceOf(uid, cr);
      if (!src) return json({ error: 'IMAGE_REQUIRED', code: 'IMAGE_REQUIRED' }, 400);
      const ctx = await contextOf(sb, uid, cr, locale);
      const fp = analysisFingerprint(src.path, ctx);
      if (!body.force) {
        const { data: hit } = await sb.from('meta_creative_ai_jobs').select('*').eq('user_id', uid).eq('kind', 'ANALYSIS')
          .eq('fingerprint', fp).eq('status', 'DONE').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (hit) return json({ cached: true, job: await publicJob(sb, hit) });
      }
      const { count } = await sb.from('meta_creative_ai_jobs').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('kind', 'ANALYSIS').gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
      if ((count ?? 0) >= ANALYSES_PER_HOUR) return json({ error: 'RATE_LIMITED', code: 'RATE_LIMITED' }, 429);
      const key = UUID.test(String(body.idempotencyKey ?? '')) ? `an:${body.idempotencyKey}` : `an:${crypto.randomUUID()}`;
      const { data: job, error } = await sb.from('meta_creative_ai_jobs').insert({
        user_id: uid, campaign_id: cr.campaign_id, creative_id: cr.id, kind: 'ANALYSIS', fingerprint: fp, idempotency_key: key,
        stage: 'ANALYZING', input: { sourcePath: src.path, locale },
      }).select('*').single();
      if (error) {
        // The same click twice: answer with the first request's job.
        const { data: same } = await sb.from('meta_creative_ai_jobs').select('*').eq('user_id', uid).eq('idempotency_key', key).maybeSingle();
        return same ? json({ cached: false, job: await publicJob(sb, same) }) : json({ error: 'FAILED', code: 'FAILED' }, 500);
      }
      const analysis = await runAnalysis(sb, uid, job.id, src, ctx);
      const patch = analysis
        ? { status: 'DONE', stage: 'DONE', result: analysis, updated_at: new Date().toISOString() }
        : { status: 'FAILED', stage: 'FAILED', error: 'ANALYSIS_FAILED', updated_at: new Date().toISOString() };
      await sb.from('meta_creative_ai_jobs').update(patch).eq('id', job.id);
      return json({ cached: false, job: await publicJob(sb, { ...job, ...patch }) }, analysis ? 200 : 502);
    }

    case 'creative_ai_quote': {
      if (!enabled) return json({ error: 'AI_UNAVAILABLE', code: 'AI_UNAVAILABLE' }, 503);
      const refine = !!body.refine;
      const quote = await quoteFor(sb, uid, clampVariations(body.variations, refine));
      if (!quote || !(await imagePriced(sb))) return json({ error: 'PRICING_UNAVAILABLE', code: 'PRICING_UNAVAILABLE' }, 503);
      return json({ quote });
    }

    case 'creative_ai_generate': {
      if (!enabled) return json({ error: 'AI_UNAVAILABLE', code: 'AI_UNAVAILABLE' }, 503);
      if (me.suspended_at) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN' }, 403);
      if (!UUID.test(String(body.idempotencyKey ?? ''))) return json({ error: 'IDEMPOTENCY_KEY_REQUIRED', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
      const key = `gen:${body.idempotencyKey}`;
      // Retry / refresh / double click with the same key: the first job, never a second charge.
      const { data: prior } = await sb.from('meta_creative_ai_jobs').select('*').eq('user_id', uid).eq('idempotency_key', key).maybeSingle();
      if (prior) return json({ job: await publicJob(sb, await recoverStale(sb, uid, prior)), replay: true });

      const cr = await ownCreative(sb, uid, body.creativeId);
      if (!cr) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const refine = UUID.test(String(body.fromJobId ?? ''));
      let src = sourceOf(uid, cr);
      if (refine) {
        const { data: from } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', String(body.fromJobId)).eq('user_id', uid).eq('status', 'DONE').maybeSingle();
        const im = (from?.result?.images ?? []).find((i: any) => i.index === Number(body.fromIndex));
        if (!from || from.kind === 'ANALYSIS' || from.creative_id !== cr.id || !im || !String(im.path).startsWith(`${uid}/`)) {
          return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
        }
        src = { path: im.path, mime: 'image/png', width: im.width, height: im.height };
      }
      if (!src) return json({ error: 'IMAGE_REQUIRED', code: 'IMAGE_REQUIRED' }, 400);
      const { data: an } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', String(body.analysisJobId ?? '')).eq('user_id', uid)
        .eq('kind', 'ANALYSIS').eq('status', 'DONE').maybeSingle();
      const analysis = an?.result as CreativeAnalysis | undefined;
      if (!an || an.creative_id !== cr.id || !analysis?.concepts?.some((c) => c.id === body.conceptId)) {
        return json({ error: 'ANALYSIS_REQUIRED', code: 'ANALYSIS_REQUIRED' }, 400);
      }
      const ins = sanitizeInstruction(body.instruction);
      if (ins.rejected) return json({ error: 'INSTRUCTION_NOT_ALLOWED', code: 'INSTRUCTION_NOT_ALLOWED' }, 400);
      const variations = clampVariations(body.variations, refine);
      const { count: running } = await sb.from('meta_creative_ai_jobs').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).eq('status', 'RUNNING').neq('kind', 'ANALYSIS').gte('updated_at', new Date(Date.now() - STALE_MS).toISOString());
      if ((running ?? 0) >= RUNNING_LIMIT) return json({ error: 'BUSY', code: 'BUSY' }, 429);
      if (!(await imagePriced(sb))) return json({ error: 'PRICING_UNAVAILABLE', code: 'PRICING_UNAVAILABLE' }, 503);

      const { data: job, error } = await sb.from('meta_creative_ai_jobs').insert({
        user_id: uid, campaign_id: cr.campaign_id, creative_id: cr.id, kind: refine ? 'REFINE' : 'GENERATION', idempotency_key: key, stage: 'QUEUED',
        input: { sourcePath: src.path, analysisJobId: an.id, conceptId: body.conceptId, instruction: ins.text, variations,
          ...(refine ? { fromJobId: body.fromJobId, fromIndex: Number(body.fromIndex) } : {}) },
      }).select('*').single();
      if (error) {
        const { data: same } = await sb.from('meta_creative_ai_jobs').select('*').eq('user_id', uid).eq('idempotency_key', key).maybeSingle();
        return same ? json({ job: await publicJob(sb, same), replay: true }) : json({ error: 'FAILED', code: 'FAILED' }, 500);
      }
      // The hold: keyed by the job, so a retried reserve returns the same reservation.
      const { beginExecution } = await billing();
      const grant = await beginExecution(sb, {
        userId: uid, productCode: PRODUCT, idempotencyKey: `meta-ai:${job.id}`, jobRef: job.id,
        expectedUnits: variations, requireFullBudget: true, allowIncluded: false,
        metadata: { surface: 'meta_ads_creative', kind: job.kind, creativeId: cr.id },
      });
      if (!grant.ok) {
        await sb.from('meta_creative_ai_jobs').update({ status: 'FAILED', stage: 'FAILED', error: grant.reason ?? 'BILLING', updated_at: new Date().toISOString() }).eq('id', job.id);
        log('generation_refused', { jobId: job.id, reason: grant.reason });
        if (grant.reason === 'INSUFFICIENT_CREDITS' || grant.reason === 'BELOW_MIN_VIABLE_BUDGET') {
          return json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS', balance: grant.budget?.availableCredits ?? null, needed: grant.estimateMaxCredits }, 402);
        }
        return json({ error: 'PRICING_UNAVAILABLE', code: 'PRICING_UNAVAILABLE' }, 503);
      }
      await sb.from('meta_creative_ai_jobs').update({ reservation_id: grant.reservationId, quoted_credits: grant.reservedCredits, updated_at: new Date().toISOString() }).eq('id', job.id);
      log('generation_reserved', { jobId: job.id, variations, reserved: grant.reservedCredits });

      const ctx = await contextOf(sb, uid, cr, locale);
      const work = runGeneration(sb, { uid, jobId: job.id, grant, src, analysis, conceptId: String(body.conceptId), ctx, instruction: ins.text, variations, refine, analysisJobId: an.id });
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
      const { data: now } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', job.id).single();
      return json({ job: await publicJob(sb, now), replay: false }, 202);
    }

    case 'creative_ai_job': {
      if (!UUID.test(String(body.jobId ?? ''))) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const { data: j } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', String(body.jobId)).eq('user_id', uid).maybeSingle();
      if (!j) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      return json({ job: await publicJob(sb, await recoverStale(sb, uid, j)) });
    }

    case 'creative_ai_jobs': {
      // The creative's history: latest analysis + its generations (re-opening the panel costs nothing).
      const cr = await ownCreative(sb, uid, body.creativeId);
      if (!cr) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const { data: rows } = await sb.from('meta_creative_ai_jobs').select('*').eq('user_id', uid).eq('creative_id', cr.id)
        .order('created_at', { ascending: false }).limit(12);
      const jobs = await Promise.all((rows ?? []).map(async (j: any) => publicJob(sb, await recoverStale(sb, uid, j))));
      return json({ jobs });
    }

    case 'creative_ai_discard': {
      const { data: j } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', String(body.jobId ?? '')).eq('user_id', uid).eq('status', 'DONE').maybeSingle();
      if (!j || j.kind === 'ANALYSIS') return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const images = (j.result?.images ?? []).map((im: any) => (im.index === Number(body.index) ? { ...im, discarded: !body.restore } : im));
      await sb.from('meta_creative_ai_jobs').update({ result: { ...j.result, images }, updated_at: new Date().toISOString() }).eq('id', j.id);
      return json({ ok: true });
    }

    case 'creative_ai_use': {
      const { data: j } = await sb.from('meta_creative_ai_jobs').select('*').eq('id', String(body.jobId ?? '')).eq('user_id', uid).eq('status', 'DONE').maybeSingle();
      if (!j || j.kind === 'ANALYSIS') return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const cr = await ownCreative(sb, uid, j.creative_id);
      if (!cr || !cr.campaign_id) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, 404);
      const picks = (Array.isArray(body.picks) ? body.picks : []).slice(0, 3)
        .map((p: any) => ({ index: Number(p?.index), role: (['PRIMARY', 'SECONDARY', 'TEST'].includes(p?.role) ? p.role : 'SECONDARY') as AssetRole }));
      const { data: existing } = await sb.from('meta_creatives').select('id,media').eq('campaign_id', cr.campaign_id).eq('user_id', uid);
      const used = new Set((existing ?? []).map((e: any) => String(e.media?.[0]?.path ?? '')));
      const created: string[] = [];
      for (const p of picks) {
        const im = (j.result?.images ?? []).find((i: any) => i.index === p.index && !i.discarded);
        if (!im || used.has(im.path)) continue;
        const role = roleToCreative(p.role);
        const { data: row, error } = await sb.from('meta_creatives').insert({
          user_id: uid, campaign_id: cr.campaign_id, kind: 'IMAGE', sort: Number(cr.sort ?? 0) + role.sortBias + p.index,
          media: [{ path: im.path, mime: 'image/png', size: im.size ?? null, width: im.width, height: im.height,
            ai: { jobId: j.id, analysisJobId: j.input?.analysisJobId ?? null, conceptId: j.input?.conceptId ?? null, sourcePath: j.input?.sourcePath ?? null, sourceCreativeId: cr.id, index: im.index, role: p.role } }],
          headline: cr.headline, primary_text: cr.primary_text, description: cr.description ?? '', cta: cr.cta, destination_url: cr.destination_url ?? null,
          priority: role.priority,
        }).select('id').single();
        if (!error && row) { created.push(row.id); used.add(im.path); }
      }
      log('variations_used', { jobId: j.id, created: created.length });
      return json({ created });
    }

    default:
      return null;
  }
}
