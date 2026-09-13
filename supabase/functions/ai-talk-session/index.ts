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
import { cartesiaCredentialsPresent, synthesizeSpeech } from '../_shared/comm/cartesia.ts';
import { callLlm } from '../_shared/comm/llm.ts';
import { transcribeSpeech, transcriptionAvailable, scriptLanguage } from '../_shared/comm/transcribe.ts';
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
  action: 'start' | 'heartbeat' | 'end' | 'turn' | 'transcribe' | 'speak';
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
  /** transcribe: one finished utterance, base64 WAV, 16 kHz mono PCM. */
  audioBase64?: string;
  /**
   * turn: return the sentence without waiting for it to be synthesised.
   *
   * Thinking and speaking are sequential and cost about the same. Held
   * together, the visitor sees nothing for the sum of both. Split, the
   * sentence is on screen while the voice is still being made — which is how
   * a real conversation behaves, where you see somebody draw breath.
   */
  textOnly?: boolean;
  /** speak: the sentence to synthesise, from the turn that just returned it. */
  speakText?: string;
  /**
   * transcribe: a language to prefer, or absent to let the provider decide.
   *
   * Absent is the normal case. A hint is only sent once the conversation has
   * settled into a language, and even then it is a preference — the provider
   * is free to disagree, and the script of what comes back has the last word.
   */
  languageHint?: string;
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
    case 'transcribe': return await transcribe(sb, body);
    case 'speak':     return await speak(sb, body);
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
   * THE BROWSER GETS NO PROVIDER CAPABILITY AT ALL.
   *
   * Three designs, in order. First the browser was given an `agent` scope and
   * held the whole conversation over Cartesia's agents websocket — a socket
   * that carries audio and no transcript, so an assistant transcript was not
   * merely unimplemented, it was unobtainable. Then it was given an `stt`
   * scope and streamed the microphone itself, which works in English and
   * Russian and cannot transcribe Georgian at all.
   *
   * Now it holds nothing. It captures audio, posts it here, and receives
   * words, a sentence and bytes of speech. That is not only a smaller
   * exposure, it is also one fewer provider call standing between a visitor
   * and the Start button: this function used to mint a grant before the
   * session could begin, so a Cartesia hiccup meant the demo would not open
   * even though the conversation itself would have worked.
   */
  logEvent('ai-talk', 'granted', { sessionId: session.id, seconds: decision.seconds });

  return json({
    ok: true,
    sessionId: session.id,
    grantedSeconds: session.granted_seconds,
    expiresAt: session.expires_at,
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
 * One finished utterance, turned into words.
 *
 * WHY THE AUDIO COMES HERE INSTEAD OF GOING STRAIGHT TO A PROVIDER
 *
 * It used to stream from the browser to Cartesia's STT socket on a scoped
 * grant. That is a good design and it has one fatal property for this
 * product: Cartesia will not transcribe Georgian. Asked for language=ka it
 * drops the socket with no error frame (ink-whisper) or answers
 * language_not_supported (ink-2), and left to itself it writes Georgian in
 * Latin letters. Homatch is a Georgia-first product, so the transcription
 * moves here, to a provider that returns Georgian in Georgian script and
 * works out the language on its own.
 *
 * The audio is transcribed and dropped. Nothing is stored, and the words are
 * never written to a log.
 */
async function transcribe(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const session = await activeSession(sb, body.sessionId);
  if ('refusal' in session) return session.refusal;

  if (!transcriptionAvailable()) {
    logEvent('ai-talk', 'transcribe_not_configured');
    return json({ ok: false, reason: 'UNAVAILABLE' }, 503);
  }

  const b64 = String(body.audioBase64 ?? '');
  if (!b64) return json({ ok: false, reason: 'EMPTY' }, 400);
  // Roughly a minute of 16 kHz mono PCM. An utterance longer than that is not
  // an utterance, and this endpoint is reachable by anyone with a session.
  if (b64.length > 2_800_000) return json({ ok: false, reason: 'TOO_LONG' }, 413);

  let audio: Uint8Array;
  try {
    const bin = atob(b64);
    audio = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i);
  } catch {
    return json({ ok: false, reason: 'BAD_AUDIO' }, 400);
  }

  const result = await transcribeSpeech({
    audio,
    mime: 'audio/wav',
    languageHint: body.languageHint ? String(body.languageHint).slice(0, 5) : null,
  });

  if (!result.ok) {
    // Sizes and codes, never audio and never words.
    logEvent('ai-talk', 'transcribe_failed', {
      sessionId: session.row.id, bytes: audio.byteLength,
      model: result.model, status: result.status ?? null, detail: result.error ?? null,
      ms: result.latencyMs,
    });
    return json({ ok: false, reason: 'TRANSCRIBE_FAILED' }, 502);
  }

  // The script of the transcript outranks whatever the provider labelled it.
  // Georgian is the only thing written in Mkhedruli, and a provider that says
  // "en" over a line of it is simply wrong.
  const language = (result.text ? scriptLanguage(result.text) : null) ?? result.language ?? null;

  logEvent('ai-talk', 'transcribe_ok', {
    sessionId: session.row.id, bytes: audio.byteLength, model: result.model,
    chars: result.text?.length ?? 0, language, ms: result.latencyMs,
  });

  return json({
    ok: true,
    text: result.text,
    language,
    model: result.model,
    ms: result.latencyMs,
  });
}

/**
 * The session, or the refusal to hand back instead.
 *
 * Shared by transcribe and turn so the two cannot drift into disagreeing
 * about what an expired session is.
 */
async function activeSession(
  sb: Sb, sessionId: string,
): Promise<{ row: { id: string; turns: number | null } } | { refusal: Response }> {
  const { data: session } = await sb.from('comm_talk_sessions')
    .select('id, state, granted_seconds, consumed_seconds, expires_at, created_at, turns')
    .eq('id', sessionId).maybeSingle();

  if (!session || session.state !== 'ACTIVE') {
    return { refusal: json({ ok: false, ended: true, reason: 'SESSION_NOT_ACTIVE' }, 409) };
  }
  if (Date.parse(String(session.expires_at)) <= Date.now()) {
    await sb.from('comm_talk_sessions')
      .update({ state: 'ENDED', ended_at: new Date().toISOString(), ended_reason: 'expired' })
      .eq('id', session.id);
    return { refusal: json({ ok: false, ended: true, reason: 'SESSION_EXPIRED' }, 409) };
  }
  return { row: { id: String(session.id), turns: session.turns as number | null } };
}

/**
 * One conversational turn: their sentence in, our sentence and our voice out.
 *
 * WHY ALL OF THIS IS SERVER-SIDE
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
  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) return guard.refusal;
  const session = guard.row;

  /*
   * TWO LANGUAGES, AND ONLY ONE OF THEM DECIDES THE REPLY.
   *
   * `locale` is the page the visitor happens to be reading. `spokenLanguage`
   * is what just came out of their mouth, as the script of the transcript
   * settles it. A Russian speaker on the Georgian homepage must be answered
   * in Russian, and must be able to switch back mid-conversation without
   * touching a selector — so the spoken language wins, every turn, and the
   * page locale is only the fallback for the very first words.
   */
  const locale = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);
  const heardLanguage = scriptLanguage(said) ?? (body.languageHint
    ? String(body.languageHint).toLowerCase().slice(0, 5)
    : null);
  const replyLanguage = heardLanguage ?? locale;

  // Prior turns, bounded. A demo conversation that keeps its whole history
  // would grow the prompt without bound on a path anyone can call.
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const conversation = history
    .map((h) => `${h.role === 'assistant' ? 'Homatch' : 'Visitor'}: ${String(h.content ?? '').slice(0, 500)}`)
    .join('\n');

  const thoughtAt = Date.now();
  const reply = await callLlm({
    system: publicDemoInstructions(replyLanguage),
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

  const llmMs = Date.now() - thoughtAt;
  const text = reply.text.trim().slice(0, 800);

  await sb.from('comm_talk_sessions')
    .update({ turns: Number(session.turns ?? 0) + 1 })
    .eq('id', session.id);

  if (body.textOnly) {
    // The caller will ask for the voice next. Counted as a turn here, so a
    // caller that never asks cannot get free turns by omitting the second half.
    logEvent('ai-talk', 'turn_text_ok', { sessionId: session.id, llmMs });
    return json({ ok: true, text, audioBase64: null, voiceId: HOMATCH_TALK_VOICE_ID, spoken: false, llmMs });
  }

  const spokeAt = Date.now();

  const spoken = await synthesizeSpeech({
    voiceId: HOMATCH_TALK_VOICE_ID,
    // The language the reply was WRITTEN in, not the page it will be read on.
    // Georgian text announced as English is how a voice ends up spelling its
    // way through a Georgian sentence.
    language: replyLanguage,
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
    return json({
      ok: true, text, audioBase64: null, voiceId: HOMATCH_TALK_VOICE_ID, spoken: false,
      llmMs, ttsMs: Date.now() - spokeAt,
    });
  }

  logEvent('ai-talk', 'turn_ok', { sessionId: session.id, model: spoken.data.model });

  return json({
    ok: true,
    text,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId: HOMATCH_TALK_VOICE_ID,
    spoken: true,
    // Where the time actually went, so a slow turn can be attributed to the
    // half that was slow instead of guessed at.
    llmMs,
    ttsMs: Date.now() - spokeAt,
  });
}

/**
 * Say a sentence the assistant has already written.
 *
 * The second half of a split turn. It takes the text back from the browser
 * rather than holding it server-side between two requests, which is fine
 * because the only thing that can be smuggled in here is a sentence to read
 * aloud in Homatch's own voice, bounded in length, on a live session that is
 * already spending its own allowance.
 */
async function speak(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) return guard.refusal;

  const text = String(body.speakText ?? '').trim().slice(0, 800);
  if (!text) return json({ ok: false, reason: 'EMPTY' }, 400);

  const language = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);
  const spokeAt = Date.now();
  const spoken = await synthesizeSpeech({ voiceId: HOMATCH_TALK_VOICE_ID, language, text });

  if (!spoken.ok || !spoken.data) {
    logEvent('ai-talk', 'speak_failed', {
      code: spoken.error?.code ?? null,
      status: spoken.error?.providerCode ?? null,
      detail: spoken.error?.message ?? null,
    });
    return json({ ok: false, reason: 'VOICE_UNAVAILABLE' }, 502);
  }

  return json({
    ok: true,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId: HOMATCH_TALK_VOICE_ID,
    ttsMs: Date.now() - spokeAt,
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
/**
 * What Homatch is, said to a model, in the language the visitor is speaking.
 *
 * GEORGIAN IS NOT A TRANSLATION TARGET HERE, IT IS THE DEFAULT
 *
 * The failure this guards against is a reply composed in English and rendered
 * into Georgian word by word: grammatical, and immediately recognisable as
 * not written by a Georgian. The instructions name that explicitly, because a
 * model told only "reply in Georgian" produces exactly that.
 *
 * The vocabulary block is not decoration. A visitor who says "მწვანე
 * კარკასი" has named a specific construction stage with a specific price
 * consequence, and an assistant that treats it as a colour is not a
 * real-estate assistant.
 */
function publicDemoInstructions(language: string): string {
  const names: Record<string, string> = {
    ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew',
  };
  const name = names[language] ?? names[language.split('-')[0]] ?? 'the language the visitor is speaking';

  const lines = [
    'You are Homatch, a real-estate intelligence assistant for the Georgian market, speaking to a visitor on a public website.',
    '',
    'LANGUAGE',
    `Reply in ${name}. Reply in whatever language the visitor is actually speaking, turn by turn:`,
    'if they switch language mid-conversation, switch with them and keep everything you already understood.',
    'Never ask them to choose a language and never mention which one you are using.',
    '',
    'HOW TO SOUND',
    'This is spoken aloud, so keep every reply to one or two short sentences. Ask one question at a time.',
    'Plain words only: no markdown, no lists, no emoji, no abbreviations that cannot be read out.',
    '',
    'WHAT YOU ARE FOR',
    'Understand what kind of property they want: buy, sell, rent or invest; roughly where; roughly what budget; how many rooms.',
    '',
    'RULES',
    '- Say at the start that you are an AI assistant.',
    '- You have NO access to any specific listing, price, availability or any person\'s records.',
    '  Never state a price, a property, an address or an availability. If asked, say plainly that you',
    '  cannot look that up here and that Homatch can do it properly once they continue on the site.',
    '- Never guarantee anything. Never mention a rate of return.',
    '- Do not ask for a name, a phone number, an email address or any identifying detail.',
    '- Talk about property only. If the conversation goes elsewhere, bring it back once, politely,',
    '  and if it does not come back, say this demo is only about property and wrap up.',
    '- People pause mid-sentence. Wait for them to finish rather than answering into a gap.',
    '- Write the name Homatch in Latin letters, always, in every language. Never transliterate it',
    '  into Georgian, Cyrillic, Arabic or Hebrew script.',
  ];

  if (name === 'Georgian') {
    lines.push(
      '',
      'GEORGIAN',
      'Write modern, natural, spoken Georgian — the Georgian a professional broker in Tbilisi would actually speak.',
      'Do NOT compose in English and translate: no English word order, no Russian-influenced grammar,',
      'no unnecessarily formal register, no English terms where an ordinary Georgian word exists.',
      'Keep English only where Georgian speakers genuinely use it, such as ROI.',
      '',
      'You know what these mean and can use them correctly:',
      'მწვანე კარკასი, თეთრი კარკასი, შავი კარკასი, ახალაშენებული, ძველი აშენებული, მშენებარე,',
      'საკადასტრო კოდი, საჯარო რეესტრი, ამონაწერი, ხელშეკრულება, წინასწარი ნასყიდობის ხელშეკრულება,',
      'იპოთეკა, განვადება, კვადრატული მეტრი, ფასი კვადრატულზე, სართული, საძინებელი, პარკინგი,',
      'დეველოპერი, ინვესტიცია, ქირის შემოსავალი, ბინის სტატუსი.',
      'Knowing the terms is not knowing any actual property: the rules above still hold.',
    );
  }

  return lines.join('\n');
}
