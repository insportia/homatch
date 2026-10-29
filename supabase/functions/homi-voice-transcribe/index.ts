// HOMI VOICE MESSAGES — a recorded message in, its text out. Free.
//
// Owner decision (2026-10-29): voice messages are free and unlimited in every
// plan. No price, no price consent, no balance check, no reservation. What
// stays: an account, the HOMI service switch, two minutes per message, the
// size limits, and a per-user burst rate (voiceLimits.ts).
//
//   POST application/json {action:'status'}   is voice on, and the limits
//                                              (old clients also read
//                                              consented/affordableSeconds;
//                                              both answer "go ahead")
//   POST application/json {action:'consent'}  kept for old clients: a no-op
//   POST multipart/form-data                   transcribe: segment0 [, segment1],
//                                              durationMs, locale, idempotencyKey
//
// COGS IS STILL RECORDED. A free message is not free to HOMATCH: each one
// writes an unbilled usage row (recordUnbilledUsage, product
// HOMI_VOICE_MESSAGE) priced from provider_price_book (GOOGLE chirp_3
// AUDIO_SECOND). A missing rate is UNPRICED, never $0. Failed and wordless
// messages are recorded too, because Google billed them.
//
// Two minutes at most: Google's unary Recognize takes one minute per request,
// so the browser records a two minute message as two independent segments.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { recordUnbilledUsage } from '../_shared/billing.ts';
import { estimatedProviderCost } from '../_shared/providerCost.ts';
import { speechWorkerOrigin } from '../_shared/comm/speechGrant.ts';
import { serviceBackendEnabled, serviceDisabledBody } from '../_shared/serviceControl.ts';
import {
  MAX_MESSAGE_SECONDS, MAX_SEGMENT_BYTES, MAX_SEGMENT_SECONDS, MAX_SEGMENTS, measuredSeconds,
  voiceRateExceeded, voiceRateLimitsFrom,
} from './voiceLimits.ts';

/** The product the COGS rows are recorded under (pricing inactive since 2026-10-29). */
const PRODUCT = 'HOMI_VOICE_MESSAGE';
const PROVIDER_MODEL = 'chirp_3';
const RATE_OPERATION = 'homi_voice_message';
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

/** Voice is on unless the product row is switched off (kill switch or disabled). Pricing state is irrelevant now. */
async function voiceEnabled(sb: Svc): Promise<boolean> {
  const { data } = await sb.from('billable_products').select('enabled, kill_switch').eq('code', PRODUCT).maybeSingle();
  const row = data as { enabled?: boolean; kill_switch?: boolean } | null;
  return !row || (row.enabled !== false && row.kill_switch !== true);
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
  // Free, but not anonymous: an account is what the burst rate and the COGS row are counted against.
  if (!user || (user as any).is_anonymous) return json({ error: 'sign in required', code: 'UNAUTHORIZED' }, 401);

  const { data: profile } = await sb.from('users').select('id, is_admin').eq('auth_id', user.id).maybeSingle();
  const profileId = (profile as any)?.id as string | undefined;
  if (!profileId) return json({ error: 'profile not found', code: 'PROFILE_NOT_FOUND' }, 404);

  // HOMI chat's own pause switch also pauses its voice messages (admins exempt, as in homatch-ai).
  if ((profile as any)?.is_admin !== true && !(await serviceBackendEnabled(sb, 'ai_assistant'))) {
    return json(serviceDisabledBody('ai_assistant'), 503);
  }

  const enabled = await voiceEnabled(sb);
  const contentType = req.headers.get('content-type') ?? '';

  // ── status / consent (consent kept only so an old client never breaks) ──
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { action?: string };
    if (body.action === 'consent') return json({ ok: true, consented: true });
    if (body.action === 'status') {
      return json({
        ok: true,
        available: enabled,
        free: true,
        consented: true,
        creditsPerMinute: 0,
        maxSeconds: MAX_MESSAGE_SECONDS,
        balance: null,
        affordableSeconds: null,
      });
    }
    return json({ error: 'unknown action', code: 'BAD_REQUEST' }, 400);
  }

  // ── transcribe ─────────────────────────────────────────────────────────
  if (!enabled) return json({ error: 'voice messages are unavailable', code: 'UNAVAILABLE' }, 503);
  if (!contentType.includes('multipart/form-data')) return json({ error: 'expected multipart', code: 'BAD_REQUEST' }, 400);

  // Per-user burst rate: an abuse safeguard, never a quota the person sees counted.
  {
    const now = Date.now();
    const count = async (ms: number) => {
      const { count: c } = await sb.from('rate_limit_events').select('id', { count: 'exact', head: true })
        .eq('user_id', profileId).eq('operation', RATE_OPERATION).gte('created_at', new Date(now - ms).toISOString());
      return c ?? 0;
    };
    const setting = async (key: string, d: number) => (await sb.rpc('billing_setting_num', { p_key: key, p_default: d })).data;
    const [minute, hour, perMinute, perHour] = await Promise.all([
      count(60_000), count(3_600_000), setting('homi_voice_per_minute', 6), setting('homi_voice_per_hour', 60),
    ]);
    if (voiceRateExceeded({ minute, hour }, voiceRateLimitsFrom({ perMinute, perHour }))) {
      return json({ error: 'slow down', code: 'RATE_LIMITED' }, 429);
    }
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
  if (recordedSeconds > MAX_MESSAGE_SECONDS + 3 || recordedSeconds > segments.length * MAX_SEGMENT_SECONDS + 3) {
    return json({ error: 'message too long', code: 'TOO_LONG' }, 413);
  }

  const localeRaw = String(form.get('locale') ?? 'ka').slice(0, 2).toLowerCase();
  const locale = LOCALES.has(localeRaw) ? localeRaw : 'ka';
  const clientKey = String(form.get('idempotencyKey') ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);

  // Counted before the provider is called: a script cannot outrun the burst rate by failing.
  await sb.from('rate_limit_events').insert({ user_id: profileId, ip_address: null, operation: RATE_OPERATION });

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

  /** The COGS row: free to the person, never free to HOMATCH. Best-effort; never costs them the text. */
  const recordCogs = async (outcome: string, extra: Record<string, unknown> = {}) => {
    if (googleSeconds <= 0) return;
    try {
      const { data: ent } = await sb.rpc('billing_entitlements', { p_user_id: profileId });
      await recordUnbilledUsage(sb as any, {
        userId: profileId, productCode: PRODUCT, planCode: String((ent as any)?.plan_code ?? 'FREE').toUpperCase(),
      }, {
        ...costUsage,
        metadata: {
          surface: 'homi-voice', outcome, segments: segments.length, locale, pricing_state: costUsage.pricingState,
          recorded_seconds: Math.round(recordedSeconds * 10) / 10, idempotency_key: clientKey || null, free: true, ...extra,
        },
      });
    } catch (e) {
      console.error('[homi-voice] cogs not recorded', e instanceof Error ? e.message : String(e));
    }
  };

  const failed = results.find((r) => !r.ok);
  if (failed) {
    await recordCogs('FAILED', { failed_reason: failed.reason ?? null });
    return json({ error: 'could not transcribe', code: 'TRANSCRIBE_FAILED', reason: failed.reason ?? null }, 502);
  }

  const transcript = results.map((r) => String(r.transcript ?? '').trim()).filter(Boolean).join(' ').trim();
  const languageCode = results.find((r) => r.transcript)?.languageCode ?? null;
  const detectedLocale = results.find((r) => r.transcript)?.locale ?? null;
  const measured = measuredSeconds(results.map((r) => (typeof r.billedSeconds === 'number' ? r.billedSeconds : null)), recordedSeconds);

  if (!transcript) {
    await recordCogs('NO_SPEECH');
    return json({ ok: true, transcript: '', noSpeech: true, chargedCredits: 0, durationSeconds: measured.seconds });
  }

  await recordCogs('SUCCESS', { duration_seconds: measured.seconds, duration_source: measured.source, language: languageCode });
  return json({
    ok: true,
    transcript,
    languageCode,
    locale: detectedLocale,
    durationSeconds: measured.seconds,
    chargedCredits: 0,
  });
});
