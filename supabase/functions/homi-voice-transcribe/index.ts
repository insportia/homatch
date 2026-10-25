// HOMI VOICE MESSAGES — a recorded message in, its text out, paid PAYG.
//
// Three actions, one function:
//
//   POST application/json {action:'status'}   price, consent, what the balance
//                                              can pay for (asked before the
//                                              microphone opens)
//   POST application/json {action:'consent'}  the person accepted the price once
//   POST multipart/form-data                   transcribe: segment0 [, segment1],
//                                              durationMs, locale, idempotencyKey
//
// THE MONEY PATH (docs/claude/BILLING.md: reserve → settle → release)
//
//   1. reserve the price of the recorded length plus one step of slack
//      (beginExecution, product HOMI_VOICE_MESSAGE)
//   2. send each segment to homatch-official-worker /speech/transcribe
//      (Google chirp_3; the credential never leaves the worker)
//   3. settle the FIXED per-minute price (0.3 credits/min, per started 10 s)
//      of the duration Google billed, with the COGS priced from
//      provider_price_book (GOOGLE chirp_3 AUDIO_SECOND). A missing rate is
//      UNPRICED, never $0.
//   4. anything HOMATCH-side failing, or a message with no words in it,
//      releases the whole hold: the customer pays only for text they got.
//
// Two minutes at most: Google's unary Recognize takes one minute per request,
// so the browser records a two minute message as two independent segments.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { beginExecution, releaseExecution, settleExecution } from '../_shared/billing.ts';
import { estimatedProviderCost } from '../_shared/providerCost.ts';
import { speechWorkerOrigin } from '../_shared/comm/speechGrant.ts';
import { serviceBackendEnabled, serviceDisabledBody } from '../_shared/serviceControl.ts';
import {
  affordableSeconds, billableSeconds, chargedSeconds, MAX_SEGMENT_BYTES, MAX_SEGMENT_SECONDS, MAX_SEGMENTS,
  minimumCredits, priceForSeconds, voicePricingFrom, type VoicePricing,
} from './voicePricing.ts';

const PRODUCT = 'HOMI_VOICE_MESSAGE';
const PROVIDER_MODEL = 'chirp_3';
const WORKER_TIMEOUT_MS = 75_000;
const LOCALES = new Set(['ka', 'en', 'ru', 'tr', 'ar', 'he']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Svc = ReturnType<typeof createClient>;

async function pricingOf(sb: Svc): Promise<{ pricing: VoicePricing; enabled: boolean }> {
  const { data } = await sb.from('billable_products')
    .select('config, enabled, pricing_active, kill_switch').eq('code', PRODUCT).maybeSingle();
  const row = data as { config?: unknown; enabled?: boolean; pricing_active?: boolean; kill_switch?: boolean } | null;
  return {
    pricing: voicePricingFrom(row?.config),
    enabled: !!row && row.enabled !== false && row.pricing_active !== false && row.kill_switch !== true,
  };
}

async function balanceOf(sb: Svc, profileId: string): Promise<number | null> {
  const { data, error } = await sb.rpc('billing_entitlements', { p_user_id: profileId });
  if (error || !data) return null;
  const n = Number((data as any)?.wallet?.balance);
  return Number.isFinite(n) ? n : null;
}

/** The worker's answer for one segment. */
interface SegmentResult {
  ok: boolean;
  transcript?: string;
  languageCode?: string;
  locale?: string | null;
  billedSeconds?: number | null;
  attempts?: number;
  reason?: string;
}

async function transcribeSegment(audio: Uint8Array, contentType: string, locale: string): Promise<SegmentResult> {
  const token = Deno.env.get('WORKER_TOKEN');
  if (!token) return { ok: false, reason: 'WORKER_NOT_CONFIGURED' };
  try {
    const res = await fetch(`${speechWorkerOrigin()}/speech/transcribe?locale=${encodeURIComponent(locale)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType || 'application/octet-stream' },
      body: audio,
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({})) as SegmentResult;
    if (!res.ok || body?.ok !== true) return { ok: false, reason: String(body?.reason ?? `HTTP_${res.status}`).slice(0, 40) };
    return body;
  } catch (e) {
    return { ok: false, reason: e instanceof DOMException && e.name === 'TimeoutError' ? 'TIMEOUT' : 'WORKER_UNREACHABLE' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: auth } = await sb.auth.getUser(token);
  const user = auth?.user;
  // An anonymous visitor has no wallet, so a paid voice message needs an account.
  if (!user || (user as any).is_anonymous) return json({ error: 'sign in required', code: 'UNAUTHORIZED' }, 401);

  const { data: profile } = await sb.from('users').select('id, is_admin').eq('auth_id', user.id).maybeSingle();
  const profileId = (profile as any)?.id as string | undefined;
  if (!profileId) return json({ error: 'profile not found', code: 'PROFILE_NOT_FOUND' }, 404);

  // HOMI chat's own pause switch also pauses its voice messages (admins exempt, as in homatch-ai).
  if ((profile as any)?.is_admin !== true && !(await serviceBackendEnabled(sb, 'ai_assistant'))) {
    return json(serviceDisabledBody('ai_assistant'), 503);
  }

  const { pricing, enabled } = await pricingOf(sb);
  const contentType = req.headers.get('content-type') ?? '';

  // ── status / consent ───────────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { action?: string };
    if (body.action === 'consent') {
      const { error } = await sb.from('homi_voice_consents').upsert(
        { user_id: user.id, accepted_at: new Date().toISOString(), price_credits_per_minute: pricing.creditsPerMinute },
        { onConflict: 'user_id' },
      );
      if (error) return json({ error: 'could not save', code: 'CONSENT_FAILED' }, 500);
      return json({ ok: true, consented: true });
    }
    if (body.action === 'status') {
      const [{ data: consent }, balance] = await Promise.all([
        sb.from('homi_voice_consents').select('price_credits_per_minute').eq('user_id', user.id).maybeSingle(),
        balanceOf(sb, profileId),
      ]);
      // A price that rose since they accepted is a new decision for them.
      const consented = !!consent && Number((consent as any).price_credits_per_minute) >= pricing.creditsPerMinute;
      return json({
        ok: true,
        available: enabled,
        consented,
        creditsPerMinute: pricing.creditsPerMinute,
        incrementSeconds: pricing.incrementSeconds,
        maxSeconds: pricing.maxSeconds,
        minimumCredits: minimumCredits(pricing),
        balance,
        affordableSeconds: balance == null ? null : affordableSeconds(balance, pricing),
      });
    }
    return json({ error: 'unknown action', code: 'BAD_REQUEST' }, 400);
  }

  // ── transcribe ─────────────────────────────────────────────────────────
  if (!enabled) return json({ error: 'voice messages are unavailable', code: 'UNAVAILABLE' }, 503);
  if (!contentType.includes('multipart/form-data')) return json({ error: 'expected multipart', code: 'BAD_REQUEST' }, 400);

  const { data: consent } = await sb.from('homi_voice_consents')
    .select('price_credits_per_minute').eq('user_id', user.id).maybeSingle();
  if (!consent || Number((consent as any).price_credits_per_minute) < pricing.creditsPerMinute) {
    return json({ error: 'consent required', code: 'CONSENT_REQUIRED' }, 409);
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: 'bad form', code: 'BAD_REQUEST' }, 400); }

  const segments: File[] = [];
  for (let i = 0; i < MAX_SEGMENTS + 1; i++) {
    const f = form.get(`segment${i}`);
    if (f instanceof File) segments.push(f);
  }
  if (segments.length === 0) return json({ error: 'no audio', code: 'EMPTY' }, 422);
  if (segments.length > MAX_SEGMENTS) return json({ error: 'too many segments', code: 'TOO_LONG' }, 413);
  if (segments.some((s) => s.size > MAX_SEGMENT_BYTES)) return json({ error: 'segment too large', code: 'TOO_LARGE' }, 413);
  if (segments.some((s) => s.size < 256)) return json({ error: 'segment empty', code: 'EMPTY' }, 422);

  const recordedSeconds = Number(form.get('durationMs')) / 1000;
  if (!Number.isFinite(recordedSeconds) || recordedSeconds <= 0) return json({ error: 'duration required', code: 'BAD_REQUEST' }, 400);
  // A small tolerance for the timer and the encoder disagreeing.
  if (recordedSeconds > pricing.maxSeconds + 3 || recordedSeconds > segments.length * MAX_SEGMENT_SECONDS + 3) {
    return json({ error: 'message too long', code: 'TOO_LONG' }, 413);
  }

  const localeRaw = String(form.get('locale') ?? 'ka').slice(0, 2).toLowerCase();
  const locale = LOCALES.has(localeRaw) ? localeRaw : 'ka';
  const clientKey = String(form.get('idempotencyKey') ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
  if (clientKey.length < 8) return json({ error: 'idempotency key required', code: 'BAD_REQUEST' }, 400);

  // Reserve what the recorded length costs plus one step: Google's billed
  // duration can run a fraction past the browser's timer.
  const needed = priceForSeconds(recordedSeconds, pricing);
  const ceiling = priceForSeconds(Math.min(pricing.maxSeconds, recordedSeconds + pricing.incrementSeconds), pricing);
  const grant = await beginExecution(sb as any, {
    userId: profileId,
    productCode: PRODUCT,
    idempotencyKey: `${PRODUCT}:${profileId}:${clientKey}`,
    // The cost-based quote only sizes the hold (see the migration); two
    // minutes of it always exceeds the fixed price of a two minute message.
    expectedUnits: Math.max(1, pricing.maxSeconds / 60),
    authorizedMaxCredits: ceiling,
    allowIncluded: false,
    metadata: { surface: 'homi-voice', locale, recorded_seconds: Math.round(recordedSeconds * 10) / 10 },
  });
  if (!grant.ok) {
    if (grant.reason === 'INSUFFICIENT_CREDITS' || grant.reason === 'BELOW_MIN_VIABLE_BUDGET') {
      return json({ error: 'insufficient credits', code: 'INSUFFICIENT_CREDITS', neededCredits: needed }, 402);
    }
    return json({ error: 'billing unavailable', code: 'BILLING_UNAVAILABLE' }, 503);
  }
  if (grant.reservedCredits + 1e-9 < needed) {
    await releaseExecution(sb as any, grant, 'HOMI_VOICE_BALANCE_SHORT').catch(() => {});
    return json({ error: 'insufficient credits', code: 'INSUFFICIENT_CREDITS', neededCredits: needed }, 402);
  }

  // Segments in order: the text must read in the order it was spoken.
  const started = Date.now();
  const results: SegmentResult[] = [];
  for (const seg of segments) {
    const r = await transcribeSegment(new Uint8Array(await seg.arrayBuffer()), seg.type, locale);
    results.push(r);
    if (!r.ok) break;
  }

  // Google bills every request it answered, refused-language retries included.
  // A segment whose response carried no billed duration is counted at its
  // share of the recorded length: an estimate, never an assumed zero.
  const share = recordedSeconds / segments.length;
  const googleSeconds = results.reduce(
    (s, r) => s + (r.ok ? (typeof r.billedSeconds === 'number' ? r.billedSeconds : share) * (r.attempts ?? 1) : 0), 0);
  const costUsd = googleSeconds > 0
    ? await estimatedProviderCost(sb as any, { provider: 'GOOGLE', unit: 'AUDIO_SECOND', units: googleSeconds, model: PROVIDER_MODEL })
    : null;
  const costUsage = {
    provider: 'GOOGLE',
    providerOperation: 'HOMI_VOICE_TRANSCRIBE',
    model: PROVIDER_MODEL,
    providerUnits: googleSeconds,
    durationMs: Date.now() - started,
    rawProviderCostCents: costUsd != null ? Math.round(costUsd * 100 * 10000) / 10000 : 0,
    pricingState: (costUsd != null ? 'ESTIMATED' : googleSeconds > 0 ? 'UNPRICED' : 'ZERO_REAL') as 'ESTIMATED' | 'UNPRICED' | 'ZERO_REAL',
  };

  const failed = results.find((r) => !r.ok);
  if (failed) {
    // HOMATCH-side failure: the customer pays nothing; any Google spend is still recorded.
    await releaseExecution(sb as any, grant, `HOMI_VOICE_${failed.reason ?? 'FAILED'}`, {
      ...costUsage, metadata: { segments: segments.length, failed_reason: failed.reason ?? null, pricing_state: costUsage.pricingState },
    }).catch((e) => console.error('[homi-voice] release failed', e instanceof Error ? e.message : String(e)));
    return json({ error: 'could not transcribe', code: 'TRANSCRIBE_FAILED', reason: failed.reason ?? null }, 502);
  }

  const transcript = results.map((r) => String(r.transcript ?? '').trim()).filter(Boolean).join(' ').trim();
  const languageCode = results.find((r) => r.transcript)?.languageCode ?? null;
  const detectedLocale = results.find((r) => r.transcript)?.locale ?? null;
  const charged = chargedSeconds(results.map((r) => (typeof r.billedSeconds === 'number' ? r.billedSeconds : null)), recordedSeconds, pricing);

  if (!transcript) {
    // Nothing intelligible: no text to send to HOMI, so nothing is charged.
    await releaseExecution(sb as any, grant, 'HOMI_VOICE_NO_SPEECH', {
      ...costUsage, metadata: { segments: segments.length, pricing_state: costUsage.pricingState },
    }).catch(() => {});
    return json({ ok: true, transcript: '', noSpeech: true, chargedCredits: 0, durationSeconds: charged.seconds });
  }

  const priceCredits = priceForSeconds(charged.seconds, pricing);
  let settled: { chargedCredits: number };
  try {
    settled = await settleExecution(sb as any, grant, {
      ...costUsage,
      priceCredits,
      metadata: {
        surface: 'homi-voice',
        segments: segments.length,
        charged_seconds: charged.seconds,
        billable_seconds: billableSeconds(charged.seconds, pricing),
        duration_source: charged.source,
        recorded_seconds: Math.round(recordedSeconds * 10) / 10,
        language: languageCode,
        credits_per_minute: pricing.creditsPerMinute,
      },
    });
  } catch (e) {
    console.error('[homi-voice] settle failed', e instanceof Error ? e.message : String(e));
    await releaseExecution(sb as any, grant, 'HOMI_VOICE_SETTLE_FAILED').catch(() => {});
    return json({ error: 'billing failed', code: 'BILLING_UNAVAILABLE' }, 503);
  }

  return json({
    ok: true,
    transcript,
    languageCode,
    locale: detectedLocale,
    durationSeconds: charged.seconds,
    chargedCredits: settled.chargedCredits,
  });
});
