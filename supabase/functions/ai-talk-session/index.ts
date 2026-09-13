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
import { createCartesiaProvider, cartesiaCredentialsPresent, ensureBaseAgent } from '../_shared/comm/cartesia.ts';
import {
  decideGrant, grantExpiry, shouldEndSession, hashVisitor,
  DEFAULT_TALK_LIMITS, type TalkLimits,
} from '../_shared/comm/generated/talkAllowance.ts';
import { extractDeterministic, scoreLead } from '../_shared/comm/generated/extraction.ts';

interface TalkRequest {
  action: 'start' | 'heartbeat' | 'end';
  sessionId?: string;
  anonSessionId?: string;
  consumedSeconds?: number;
  locale?: string;
  /** Sent on heartbeat so the hero can show live intelligence (§27). */
  transcript?: string;
  endedReason?: string;
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
    sb.from('comm_talk_sessions')
      .select('consumed_seconds')
      .eq('ip_hash', ipHash).gte('created_at', day).limit(100),
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

  // The agent to stream against. Provisioned once and cached; the real
  // instructions travel in the websocket start frame, not in the provider's
  // stored agent.
  const baseAgent = await ensureBaseAgent(sb as never, { language: String(body.locale ?? 'ka') });
  if (!baseAgent.ok || !baseAgent.data) {
    await sb.from('comm_talk_sessions')
      .update({ state: 'ABORTED', ended_at: new Date().toISOString(), ended_reason: 'no_base_agent' })
      .eq('id', session.id);
    logEvent('ai-talk', 'base_agent_unavailable', {
      code: baseAgent.error?.code ?? null,
      status: baseAgent.error?.providerCode ?? null,
      detail: baseAgent.error?.message ?? null,
    });
    return json({ ok: false, reason: 'PROVIDER_ERROR', userMessage: 'UNAVAILABLE' }, 502);
  }

  // The grant's TTL is the wall-clock window, not the talk allowance, and the
  // adapter caps it. The browser never sees CARTESIA_API_KEY (§139).
  const provider = createCartesiaProvider();
  const grant = await provider.mintGrant({
    ttlSeconds: Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
    // `agent` to hold the conversation, `stt` for the second socket that
    // produces the visible transcript — the agents socket carries no
    // transcript events, and §24 makes visible partial transcription a gate.
    // `tts` is deliberately NOT granted: a leaked token must not be usable to
    // synthesise arbitrary audio on Homatch's account.
    scopes: ['agent', 'stt'],
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
    agentId: baseAgent.data.agentId,
    provider: 'CARTESIA',
    // §29: the public demo gets general Homatch capability and no private
    // context whatsoever. This instruction is assembled here, server-side, so
    // the browser cannot widen it.
    instructions: publicDemoInstructions(String(body.locale ?? 'ka')),
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

  await sb.from('comm_talk_sessions').update({
    state: 'ENDED',
    ended_at: new Date().toISOString(),
    ended_reason: String(body.endedReason ?? 'user_ended').slice(0, 80),
    consumed_seconds: Math.max(0, Number(body.consumedSeconds ?? 0)),
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
