// HOMATCH — the homepage AI Talk demo's session broker.
//
// §28 and §90. This is the only thing standing between a public marketing demo
// and an unmetered bill, so it does three jobs and refuses to do a fourth:
//
//   1. decides whether this visitor may talk, and for how many seconds
//   2. mints a short-lived, narrowly-scoped provider grant
//   3. records consumption and ends the session when the allowance is gone
//
// The fourth job it does NOT do is trust the browser. A client timer is a
// courtesy; the allowance is a server-computed grant with a server-computed
// expiry, and the sweep at the bottom ends sessions whose page stopped
// reporting — which is exactly what a page trying to talk for free looks like.
//
// WHY verify_jwt STAYS ON
//
// It does, and an anonymous visitor still reaches it: Supabase's publishable
// anon key is a valid JWT, so the platform's own gate passes and the identity
// work happens here, against anonymous_sessions. That is deliberate. Turning
// verify_jwt off would mean anything on the internet could mint Cartesia
// grants, which is precisely the abuse §28 exists to prevent.
//
// NO PSTN, EVER. §28: browser realtime audio only. Nothing in this file can
// place a telephone call, and the grant it mints has no telephony scope.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { serviceClient, json, preflight, logEvent, authenticate } from '../_shared/comm/auth.ts';
import {
  createCartesiaProvider, cartesiaCredentialsPresent, synthesizeSpeech,
} from '../_shared/comm/cartesia.ts';
import { callLlm } from '../_shared/comm/llm.ts';
import {
  decideGrant, grantExpiry, shouldEndSession, hashVisitor,
  DEFAULT_TALK_LIMITS, type TalkLimits,
} from '../_shared/comm/generated/talkAllowance.ts';
import { extractDeterministic, scoreLead } from '../_shared/comm/generated/extraction.ts';

/**
 * THE VOICE THIS ASSISTANT SPEAKS IN.
 *
 * Fixed, server-side, and not overridable from the browser. The main page
 * used to send voiceId: null, which left the choice to whatever default the
 * provider felt like — so the one thing a brand voice has to be, consistent,
 * was the one thing it was not.
 */
const HOMATCH_TALK_VOICE_ID = '6833940c-ed06-4b62-8a51-94b6c46c13ad';

interface TalkRequest {
  action: 'start' | 'heartbeat' | 'end' | 'turn';
  sessionId?: string;
  anonSessionId?: string;
  consumedSeconds?: number;
  locale?: string;
  /** Sent on heartbeat so the hero can show live intelligence (§27). */
  transcript?: string;
  endedReason?: string;
  /** turn: the visitor's finished utterance. */
  text?: string;
  /** turn: prior turns, oldest first, so the reply is in context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: TalkRequest;
  try { body = await req.json() as TalkRequest; } catch { return json({ error: 'bad_request' }, 400); }

  const sb = serviceClient();
  const limits = await loadLimits(sb);
  const enabled = await talkEnabled(sb);

  // An authenticated visitor is identified by their token; an anonymous one by
  // their anonymous_sessions row. Either way the identity comes from the
  // server side of the exchange, never from a field in the body alone.
  const caller = await authenticate(req).catch(() => null);
  const userId = caller?.userId ?? null;

  switch (body.action) {
    case 'start':     return await start(sb, req, body, limits, enabled, userId);
    case 'turn':      return await turn(sb, body);
    case 'heartbeat': return await heartbeat(sb, body);
    case 'end':       return await end(sb, body);
    default:          return json({ error: 'unknown_action' }, 400);
  }
});

type Sb = ReturnType<typeof serviceClient>;

async function start(
  sb: Sb, req: Request, body: TalkRequest, limits: TalkLimits, enabled: boolean, userId: string | null,
): Promise<Response> {
  if (!cartesiaCredentialsPresent().ok) {
    // §134: the hero shows a graceful fallback. It is not told which secret is
    // missing, and the page must not break.
    logEvent('ai-talk', 'provider_not_configured');
    return json({ ok: false, reason: 'UNAVAILABLE', userMessage: 'UNAVAILABLE' }, 503);
  }

  const ipHash = await visitorHash(req);
  const anonSessionId = await resolveAnonSession(sb, body.anonSessionId);

  // §74/§90: the IP is only ever a salted hash and is used for nothing but
  // counting. The salt is a server secret, so the stored value cannot be
  // reversed into an address or joined to anything else Homatch holds.
  const day = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: todays }, { count: activeForVisitor }, { count: activeGlobal }] = await Promise.all([
    /*
     * A SESSION THAT NEVER HAPPENED MUST NOT COST SOMEBODY THEIR ALLOWANCE.
     *
     * ABORTED means the session row was written and then the provider,
     * or this function, failed before the visitor could say a word. Those
     * counted against the six-per-day cap, so a broken deployment quietly
     * spent every visitor's allowance and then told them they had used it up.
     *
     * That is exactly what happened here: a run of aborted sessions from a
     * provider fault left the daily limit exhausted for people who had never
     * had a conversation at all.
     */
    sb.from('comm_talk_sessions')
      .select('consumed_seconds')
      .eq('ip_hash', ipHash).gte('created_at', day)
      .neq('state', 'ABORTED')
      .limit(100),
    sb.from('comm_talk_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash).eq('state', 'ACTIVE').gt('expires_at', new Date().toISOString()),
    sb.from('comm_talk_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'ACTIVE').gt('expires_at', new Date().toISOString()),
  ]);

  const consumedToday = (todays ?? []).reduce((s, r) => s + Number(r.consumed_seconds ?? 0), 0);

  const decision = decideGrant({
    limits,
    consumedTodaySeconds: consumedToday,
    sessionsStartedToday: (todays ?? []).length,
    visitorActiveSessions: activeForVisitor ?? 0,
    globalActiveSessions: activeGlobal ?? 0,
    enabled,
  });

  if (!decision.granted) {
    logEvent('ai-talk', 'grant_refused', { reason: decision.reason ?? null });
    return json({ ok: false, reason: decision.reason, userMessage: decision.userMessage }, 429);
  }

  const expiresAt = grantExpiry(decision.seconds);

  const { data: session, error } = await sb.from('comm_talk_sessions').insert({
    anon_session_id: anonSessionId,
    user_id: userId,
    granted_seconds: decision.seconds,
    expires_at: expiresAt.toISOString(),
    ip_hash: ipHash,
    locale: String(body.locale ?? 'ka').slice(0, 8),
  }).select('id, granted_seconds, expires_at').maybeSingle();

  if (error || !session) {
    logEvent('ai-talk', 'session_insert_failed', { error: error?.message });
    return json({ ok: false, reason: 'ERROR', userMessage: 'UNAVAILABLE' }, 500);
  }

  /*
   * THE BROWSER GETS ONE CAPABILITY: LISTENING.
   *
   * This used to provision a Cartesia "agent" and hand the browser an `agent`
   * scope so it could hold the whole conversation over the agents websocket.
   * That socket carries AUDIO ONLY — it has no transcript events at all — so
   * an assistant transcript was not merely unimplemented, it was unobtainable,
   * and the voice was whatever the provider defaulted to.
   *
   * The conversation is now assembled here instead: the browser transcribes,
   * this function thinks and speaks. So the token needs `stt` and nothing
   * else. No `agent`, and still no `tts` — a leaked token must not be usable
   * to synthesise arbitrary audio on Homatch's account, and it no longer
   * needs to be, because synthesis happens server-side.
   */
  const provider = createCartesiaProvider();
  const grant = await provider.mintGrant({
    ttlSeconds: Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
    scopes: ['stt'],
  });

  if (!grant.ok || !grant.data) {
    await sb.from('comm_talk_sessions')
      .update({ state: 'ABORTED', ended_at: new Date().toISOString(), ended_reason: 'provider_unavailable' })
      .eq('id', session.id);
    logEvent('ai-talk', 'mint_failed', {
      code: grant.error?.code ?? null,
      status: grant.error?.providerCode ?? null,
      detail: grant.error?.message ?? null,
    });
    return json({ ok: false, reason: 'PROVIDER_ERROR', userMessage: 'UNAVAILABLE' }, 502);
  }

  logEvent('ai-talk', 'granted', { sessionId: session.id, seconds: decision.seconds });

  return json({
    ok: true,
    sessionId: session.id,
    grantedSeconds: session.granted_seconds,
    expiresAt: session.expires_at,
    token: grant.data.token,
    provider: 'CARTESIA',
    // Returned so the client can assert it, and so a support question about
    // which voice was used has an answer that is not a guess.
    voiceId: HOMATCH_TALK_VOICE_ID,
    // §29: the public demo gets general Homatch capability and no private
    // context whatsoever. This instruction is assembled here, server-side, so
    // the browser cannot widen it.
    instructions: publicDemoInstructions(String(body.locale ?? 'ka')),
  });
}

/**
 * One conversational turn: their sentence in, our sentence and our voice out.
 *
 * WHY THE SERVER DOES THIS AND NOT THE BROWSER
 *
 * The browser transcribes, because streaming microphone audio has to start
 * where the microphone is. Everything after that happens here, for three
 * reasons that were each a real failure before:
 *
 *   the assistant's TEXT exists, because we generate it — the provider's
 *   agents socket returns audio and nothing else, so there was never anything
 *   to put in a transcript;
 *
 *   the VOICE is ours, because we pass the id — the browser used to send
 *   null and the provider chose;
 *
 *   the Cartesia key stays here, and the browser receives bytes.
 *
 * Returns text and audio together so the UI can show the sentence at the same
 * moment it starts speaking it, rather than after.
 */
async function turn(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const said = String(body.text ?? '').trim();
  if (!said) return json({ ok: false, reason: 'EMPTY' }, 400);

  // The session is the authorisation. An expired or ended one cannot spend
  // another model call or another second of synthesis.
  const { data: session } = await sb.from('comm_talk_sessions')
    .select('id, state, granted_seconds, consumed_seconds, expires_at, created_at, turns')
    .eq('id', body.sessionId).maybeSingle();

  if (!session || session.state !== 'ACTIVE') {
    return json({ ok: false, ended: true, reason: 'SESSION_NOT_ACTIVE' }, 409);
  }
  if (Date.parse(String(session.expires_at)) <= Date.now()) {
    await sb.from('comm_talk_sessions')
      .update({ state: 'ENDED', ended_at: new Date().toISOString(), ended_reason: 'expired' })
      .eq('id', session.id);
    return json({ ok: false, ended: true, reason: 'SESSION_EXPIRED' }, 409);
  }

  const locale = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);

  // Prior turns, bounded. A demo conversation that keeps its whole history
  // would grow the prompt without bound on a path anyone can call.
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const conversation = history
    .map((h) => `${h.role === 'assistant' ? 'Homatch' : 'Visitor'}: ${String(h.content ?? '').slice(0, 500)}`)
    .join('\n');

  const reply = await callLlm({
    system: publicDemoInstructions(locale),
    user: [
      conversation ? `Conversation so far:\n${conversation}\n` : '',
      `Visitor just said: "${said.slice(0, 1000)}"`,
      '',
      'Reply as Homatch, out loud, in one or two short spoken sentences.',
      'Plain words only: no markdown, no lists, no emoji, nothing that cannot be said aloud.',
    ].filter(Boolean).join('\n'),
    maxTokens: 220,
    timeoutMs: 20_000,
  });

  if (!reply.ok || !reply.text?.trim()) {
    logEvent('ai-talk', 'turn_llm_failed', {
      reason: reply.error ?? 'empty', status: reply.status ?? null,
    });
    return json({ ok: false, reason: 'ASSISTANT_FAILED' }, 502);
  }

  const text = reply.text.trim().slice(0, 800);

  const spoken = await synthesizeSpeech({
    voiceId: HOMATCH_TALK_VOICE_ID,
    language: locale,
    text,
  });

  if (!spoken.ok || !spoken.data) {
    logEvent('ai-talk', 'turn_tts_failed', {
      code: spoken.error?.code ?? null,
      status: spoken.error?.providerCode ?? null,
      detail: spoken.error?.message ?? null,
    });
    // The sentence still exists and is still worth showing. A silent reply is
    // a degraded conversation; a blank one is a broken product.
    return json({ ok: true, text, audioBase64: null, voiceId: HOMATCH_TALK_VOICE_ID, spoken: false });
  }

  await sb.from('comm_talk_sessions')
    .update({ turns: Number(session.turns ?? 0) + 1 })
    .eq('id', session.id);

  logEvent('ai-talk', 'turn_ok', { sessionId: session.id, model: spoken.data.model });

  return json({
    ok: true,
    text,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId: HOMATCH_TALK_VOICE_ID,
    spoken: true,
  });
}

async function heartbeat(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const { data: session } = await sb.from('comm_talk_sessions')
    .select('id, state, granted_seconds, consumed_seconds, expires_at, created_at, extracted, turns')
    .eq('id', body.sessionId).maybeSingle();

  if (!session || session.state !== 'ACTIVE') {
    return json({ ok: false, ended: true, reason: 'SESSION_NOT_ACTIVE' }, 409);
  }

  // The reported figure is clamped to what the clock allows. A browser
  // reporting 3 seconds after 60 have elapsed is either broken or lying, and
  // either way the wall clock is the ceiling.
  const elapsed = (Date.now() - new Date(session.created_at).getTime()) / 1000;
  const reported = Math.max(0, Number(body.consumedSeconds ?? 0));
  const consumed = Math.min(Math.max(reported, Number(session.consumed_seconds ?? 0)), Math.ceil(elapsed));

  const verdict = shouldEndSession({
    grantedSeconds: session.granted_seconds,
    consumedSeconds: consumed,
    startedAt: session.created_at,
    expiresAt: session.expires_at,
  });

  // §27: live intelligence, extracted deterministically. No model is called on
  // a heartbeat — this is a free regex pass over the transcript so far, which
  // is both cheaper and faster than the alternative and is all the hero needs.
  let intelligence: Record<string, unknown> | null = null;
  if (body.transcript && body.transcript.trim().length > 8) {
    const e = extractDeterministic(body.transcript.slice(0, 4000));
    const { score } = scoreLead(e);
    intelligence = {
      transactionType: e.transactionType,
      locations: e.locations,
      budgetMax: e.budgetMax,
      currency: e.currency,
      bedrooms: e.bedrooms,
      intentScore: score,
    };
  }

  await sb.from('comm_talk_sessions').update({
    consumed_seconds: consumed,
    turns: Math.max(Number(session.turns ?? 0), Number(body.transcript ? 1 : 0)),
    // Anonymous and short-lived. Purged by comm_purge_expired (§29, §132).
    extracted: intelligence ?? session.extracted,
    ...(verdict.end ? { state: 'ENDED', ended_at: new Date().toISOString(), ended_reason: verdict.reason } : {}),
  }).eq('id', session.id);

  return json({
    ok: true,
    ended: verdict.end,
    reason: verdict.reason,
    remainingSeconds: verdict.remainingSeconds,
    intelligence,
  });
}

async function end(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const reason = String(body.endedReason ?? 'user_ended').slice(0, 80);
  const consumed = Math.max(0, Number(body.consumedSeconds ?? 0));

  /*
   * A CONVERSATION THAT NEVER STARTED IS ABORTED, NOT ENDED.
   *
   * The browser reports `failed_mic_denied`, `failed_mic_unavailable` or
   * `failed_provider_error` when start() could not open a microphone or a
   * transcription socket. Nobody spoke, so the row must not read as a
   * conversation that happened: ABORTED is excluded from the daily
   * allowance, and ENDED is not.
   *
   * The zero-seconds condition is what keeps this honest. A session that
   * carried speech stays ENDED whatever the browser calls it.
   */
  const aborted = consumed === 0 && reason.startsWith('failed_');

  await sb.from('comm_talk_sessions').update({
    state: aborted ? 'ABORTED' : 'ENDED',
    ended_at: new Date().toISOString(),
    ended_reason: reason,
    consumed_seconds: consumed,
  }).eq('id', body.sessionId).eq('state', 'ACTIVE');

  return json({ ok: true });
}

// ── Configuration ───────────────────────────────────────────────────────────

async function loadLimits(sb: Sb): Promise<TalkLimits> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', 'ai_talk_limits').maybeSingle();
  const v = (data?.value ?? {}) as Record<string, unknown>;
  const num = (k: string, d: number) => (Number.isFinite(Number(v[k])) ? Number(v[k]) : d);
  return {
    sessionSeconds: num('session_seconds', DEFAULT_TALK_LIMITS.sessionSeconds),
    dailySeconds: num('daily_seconds', DEFAULT_TALK_LIMITS.dailySeconds),
    globalConcurrent: num('global_concurrent', DEFAULT_TALK_LIMITS.globalConcurrent),
    perVisitorConcurrent: num('per_visitor_concurrent', DEFAULT_TALK_LIMITS.perVisitorConcurrent),
    dailySessions: num('daily_sessions', DEFAULT_TALK_LIMITS.dailySessions),
  };
}

async function talkEnabled(sb: Sb): Promise<boolean> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', 'ai_talk_enabled').maybeSingle();
  // Default ON: the demo is the point of the hero. An admin turning it off is
  // a deliberate act, recorded in admin_settings and audited like any other.
  return data?.value !== false;
}

async function visitorHash(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('cf-connecting-ip')
    ?? 'unknown';
  const salt = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'homatch';
  return await hashVisitor(ip, salt);
}

/** Only accept an anonymous session id that actually exists and has not expired. */
async function resolveAnonSession(sb: Sb, candidate: string | undefined): Promise<string | null> {
  if (!candidate || !/^[0-9a-f-]{36}$/i.test(candidate)) return null;
  const { data } = await sb.from('anonymous_sessions')
    .select('id, expires_at').eq('id', candidate).maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.id;
}

/**
 * What the public demo agent is allowed to be.
 *
 * §29: no private user data, no CRM, no authenticated context, general
 * Homatch real-estate capability only. Assembled here rather than in the
 * browser so that a modified page cannot widen the agent's remit, and kept
 * deliberately short so it is easy to audit.
 */
function publicDemoInstructions(locale: string): string {
  const names: Record<string, string> = {
    ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew',
  };
  return [
    'You are Homatch, a real-estate intelligence assistant, speaking to a visitor on a public website.',
    `Open in ${names[locale] ?? 'Georgian'}. If they speak another language, switch to it and stay there.`,
    '',
    'Your job in this short conversation is to understand what kind of property they are interested in:',
    'whether they want to buy, sell, rent or invest, roughly where, roughly what budget, and how many rooms.',
    'Ask one question at a time. Keep every reply to one or two spoken sentences.',
    '',
    'Rules:',
    '- Say at the start that you are an AI assistant.',
    '- You have NO access to any specific listing, price, availability or any person\'s records.',
    '  Never state a price, a property, an address or an availability. If asked, say plainly that you',
    '  cannot look that up here and that Homatch can do it properly once they continue on the site.',
    '- Never guarantee anything. Never mention a rate of return.',
    '- Do not ask for a name, a phone number, an email address or any identifying detail.',
    '- Talk about property only. If the conversation goes elsewhere, bring it back once, politely,',
    '  and if it does not come back, say this demo is only about property and wrap up.',
    '- People pause mid-sentence. Wait for them to finish rather than answering into a gap.',
  ].join('\n');
}
