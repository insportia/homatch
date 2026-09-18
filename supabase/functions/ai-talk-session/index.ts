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
import { serviceClient, json, preflight, logEvent, authenticate, corsHeaders } from '../_shared/comm/auth.ts';
import {
  cartesiaCredentialsPresent, synthesizeSpeech, synthesizePcm, PCM_SAMPLE_RATE,
  streamCartesiaPcm, nearestCartesiaRate, clampCartesiaSpeed,
} from '../_shared/comm/cartesia.ts';
import { callLlm, streamLlm } from '../_shared/comm/llm.ts';
import { judgeOverlap } from '../_shared/comm/generated/streamingOverlap.ts';
import { LANGUAGE_NAMES as REGISTRY_LANGUAGE_NAMES } from '../_shared/comm/generated/languageRegistry.ts';
import { hasSecret, requireSecret } from '../_shared/comm/contracts.ts';
import {
  /*
   * STT ONLY.
   *
   * Scribe is still the speech-recognition fallback behind Google and has
   * nothing to do with which voice speaks. Everything ElevenLabs offered for
   * SYNTHESIS -- synthesizeElevenLabs, chooseTtsModel, streamElevenLabs,
   * streamElevenLabsDialogue -- is deliberately not imported here any more,
   * so AI TALK has no reachable path to it however the route table is set.
   */
  elevenLabsCredentialsPresent, mintRealtimeToken,
  ELEVENLABS_DEFAULTS, KEYTERM_LIMITS_DEFAULT,
  type LanguageStrategy,
} from '../_shared/comm/elevenlabs.ts';
import { ensureDefaultVoice } from '../_shared/comm/voiceLibrary.ts';
import {
  speechSocketUrl, mintSpeechGrant, googleSpeechReady,
} from '../_shared/comm/speechGrant.ts';
import {
  ACTION_MARKER, destinationMenu, parseAction, spokenPart, endsWithPartialMarker,
} from '../_shared/comm/generated/talkActions.ts';
import {
  resolveTurnLanguage, textMatchesLanguage, detectLanguageRequest, normaliseLanguage,
  TALK_LANGUAGES, type TalkLanguage,
} from '../_shared/comm/generated/talkLanguage.ts';
import { speechText } from '../_shared/comm/generated/speechText.ts';
import {
  selectKeyterms, keytermStrings, detectEntities,
  type VocabularyTerm,
} from '../_shared/comm/generated/keyterms.ts';
import { transcribeSpeech, transcriptionAvailable, scriptLanguage } from '../_shared/comm/transcribe.ts';
import {
  decideGrant, type UsageTier, grantExpiry, shouldEndSession, hashVisitor,
  DEFAULT_TALK_LIMITS, type TalkLimits,
} from '../_shared/comm/generated/talkAllowance.ts';
import { extractDeterministic, scoreLead } from '../_shared/comm/generated/extraction.ts';
import {
  updateTalkState, describeState, stateGaps, stateIsRich, sanitiseTalkState,
  type TalkState,
} from '../_shared/comm/generated/conversationState.ts';

/**
 * THE VOICE THIS ASSISTANT SPEAKS IN, WHEN NOTHING ELSE HAS BEEN CHOSEN.
 *
 * Server-side and not overridable from the browser: the main page once sent
 * voiceId: null, which left the choice to whatever default the provider felt
 * like, so the one thing a brand voice has to be — consistent — was the one
 * thing it was not.
 *
 * This is the Cartesia id, kept because it is what every existing agent and
 * every recorded session refers to. The primary voice now comes from the
 * library an admin curates; this is what answers when that library is empty.
 */
const CARTESIA_FALLBACK_VOICE_ID = '6833940c-ed06-4b62-8a51-94b6c46c13ad';

/** One piece of speech and who made it. */
interface SpokenPhrase {
  pcmBase64: string;
  sampleRate: number;
  provider: 'ELEVENLABS' | 'CARTESIA';
  voiceId: string;
  model: string;
  ms: number;
  characters: number;
}

/**
 * Say one phrase, with whichever provider is actually able to.
 *
 * ELEVENLABS LEADS AND CARTESIA CATCHES, and the order is not a preference,
 * it is what the evidence says. Cartesia's synthesis answered HTTP 402 —
 * account out of credit — for every language on 13 September, and its
 * transcription cannot write Georgian at all. Neither is a reason to delete a
 * working integration: it is a reason to put it second.
 *
 * A refusal from the leader is recorded with its provider code and the next
 * one is tried. A refusal from all of them returns the codes, so that "the
 * voice is unavailable" can be explained rather than merely displayed.
 */
/**
 * One phrase, whole, for the callers that cannot stream.
 *
 * The conversation does not use this — `converse` streams — but the `speak`
 * action does, and it used to walk the same ElevenLabs-then-Cartesia ladder
 * the streaming path did. Leaving it would mean AI TALK still had a reachable
 * ElevenLabs code path and a way to speak in a voice nobody selected, which is
 * exactly what this migration removes.
 *
 * Same provider, same voice, same approval rules as the streaming path. The
 * only difference is that the bytes arrive together.
 */
async function speakPhrase(sb: Sb, params: {
  text: string;
  language: string;
  sessionId?: string | null;
  surface?: string;
}): Promise<{ ok: true; data: SpokenPhrase } | { ok: false; failures: Array<{ provider: string; code: string | null; status: number | null; detail?: string | null }> }> {
  const voice = await aiTalkVoice(sb, params.language || null);
  if (!voice) {
    return { ok: false, failures: [{ provider: 'NONE', code: 'VOICE_NOT_APPROVED_FOR_LANGUAGE', status: null }] };
  }
  if (voice.provider !== 'CARTESIA') {
    return { ok: false, failures: [{ provider: voice.provider, code: 'PROVIDER_NOT_SUPPORTED_ON_AI_TALK', status: null }] };
  }
  if (!cartesiaCredentialsPresent().ok) {
    return { ok: false, failures: [{ provider: 'CARTESIA', code: 'MISSING_CREDENTIALS', status: null }] };
  }

  const started = Date.now();
  /*
   * THE LAST HOP BEFORE THE VOICE, AND THE ONLY PLACE THE SPELLING BENDS.
   *
   * params.text is the reply as Luna wrote it and as the visitor will read
   * it. What goes to Cartesia is a respelled COPY: a Latin brand inside a
   * Georgian sentence is spelled out letter by letter by sonic-3, and no
   * amount of prompting fixes that because the model is reading correctly.
   * Nothing downstream of here is stored or displayed.
   */
  const out = await synthesizePcm({
    voiceId: voice.voiceId,
    language: params.language || 'ka',
    text: speechText(params.text, params.language),
  });
  const ms = Date.now() - started;

  if (out.ok && out.data) {
    await recordVoiceUsage(sb, {
      sessionId: params.sessionId ?? null,
      surface: params.surface ?? 'AI_TALK',
      provider: 'CARTESIA', role: 'TTS', model: out.data.model,
      characters: params.text.length, latencyMs: ms,
      ok: true, errorCode: null, providerStatus: null,
    });
    return {
      ok: true,
      data: {
        provider: 'CARTESIA',
        voiceId: voice.voiceId,
        pcmBase64: out.data.pcmBase64,
        sampleRate: out.data.sampleRate,
        model: out.data.model,
        ms,
        characters: params.text.length,
      },
    };
  }

  await recordVoiceUsage(sb, {
    sessionId: params.sessionId ?? null,
    surface: params.surface ?? 'AI_TALK',
    provider: 'CARTESIA', role: 'TTS', model: 'sonic-3',
    characters: params.text.length, latencyMs: ms,
    ok: false, errorCode: out.error?.code ?? null,
    providerStatus: Number(out.error?.providerCode) || null,
  });
  logEvent('ai-talk', 'tts_failed', {
    provider: 'CARTESIA', path: 'whole',
    code: out.error?.code ?? null,
    detail: String(out.error?.message ?? '').slice(0, 300),
  });

  return {
    ok: false,
    failures: [{
      provider: 'CARTESIA',
      code: out.error?.code ?? null,
      status: Number(out.error?.providerCode) || null,
      detail: String(out.error?.message ?? '').slice(0, 200),
    }],
  };
}

/**
 * The voice an admin made default, and the model to say it with.
 *
 * On a completely empty library this pulls the catalogue and turns exactly one
 * voice on, because "the product is silent until an admin visits a settings
 * page" is not a state worth shipping. A library that already has rows is left
 * alone: an admin who disabled everything meant it.
 */
/**
 * What to do when the language being spoken has no approved voice.
 *
 * SAME_LANGUAGE_APPROVED_ONLY   speak only with a voice somebody approved for
 *                               this language. If there is none, do not speak.
 * OWNER_APPROVED_FOREIGN_FALLBACK  a voice approved for another language may
 *                               be used, knowingly, with a foreign accent.
 *
 * The default is the strict one, and it is the default for a reason: a
 * customer hearing an American read Georgian does not think "unapproved
 * configuration", they think Homatch sounds foreign. Silence with a visible
 * reason is recoverable; that impression is not.
 */
type FallbackPolicy = 'SAME_LANGUAGE_APPROVED_ONLY' | 'OWNER_APPROVED_FOREIGN_FALLBACK';

/**
 * How hard to push the provider for an early first byte.
 *
 * 0 keeps its text normaliser on, which is what turns 200,000 and USD and m²
 * into words. Higher values start it sooner and normalise less. Georgian
 * numbers and currency are exactly the case that suffers, so the default is
 * the careful one and moving it is a decision somebody makes after listening.
 */
async function streamingLatencyHint(sb: Sb): Promise<number> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  const raw = Number((data?.config as Record<string, unknown> | null)?.optimize_streaming_latency);
  return Number.isFinite(raw) ? Math.max(0, Math.min(4, Math.floor(raw))) : 0;
}

async function fallbackPolicy(sb: Sb): Promise<FallbackPolicy> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  const value = (data?.config as Record<string, unknown> | null)?.fallback_policy;
  return value === 'OWNER_APPROVED_FOREIGN_FALLBACK'
    ? 'OWNER_APPROVED_FOREIGN_FALLBACK'
    : 'SAME_LANGUAGE_APPROVED_ONLY';
}


/**
 * What a provider call cost, in the units the provider bills in.
 *
 * COGS only. §R is explicit that this must never become customer pricing, and
 * nothing reads this table to decide what anybody is charged.
 */
async function recordVoiceUsage(sb: Sb, event: {
  sessionId: string | null;
  surface: string;
  provider: string;
  role: 'STT' | 'TTS' | 'LLM' | 'ORCHESTRATOR' | 'TELEPHONY';
  model: string | null;
  characters?: number | null;
  audioSeconds?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs: number | null;
  ok: boolean;
  errorCode: string | null;
  providerStatus: number | null;
}): Promise<void> {
  try {
    await sb.from('voice_usage_events').insert({
      session_id: event.sessionId,
      surface: event.surface,
      provider: event.provider,
      role: event.role,
      model: event.model,
      characters: event.characters ?? null,
      audio_seconds: event.audioSeconds ?? null,
      input_tokens: event.inputTokens ?? null,
      output_tokens: event.outputTokens ?? null,
      latency_ms: event.latencyMs,
      ok: event.ok,
      error_code: event.errorCode,
      provider_status: event.providerStatus,
    });
  } catch {
    // Telemetry must never take a conversation down with it.
  }
}

interface TalkRequest {
  action: 'start' | 'heartbeat' | 'end' | 'turn' | 'transcribe' | 'speak' | 'converse' | 'listen';
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
  /**
   * converse: the sample rate the browser's AudioContext actually runs at.
   *
   * Synthesising at it means the samples are PLAYED rather than resampled.
   * Resampling each piece independently is what put a whine on the joins, so
   * the cheapest fix is the resample that never happens. Advisory: an
   * unsupported value is snapped to the nearest the provider offers.
   */
  outputSampleRate?: number;
  /**
   * converse: the recogniser's own language label for this utterance.
   *
   * Evidence, never an answer. It has returned Korean, Luxembourgish and
   * Hausa for Georgian speech, so it is one input to the resolver and is
   * discarded when it names a language AI TALK does not speak.
   */
  providerLanguage?: string;
  /** True when providerLanguage was detected rather than configured. See talkLanguage.ts. */
  providerDetected?: boolean;
  /** True while no turn of this session has resolved a language. See talkLanguage.ts. */
  firstTurn?: boolean;
  /** converse: the browser's name for this turn, echoed into the trace. */
  turnId?: string;
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
  /** converse: what the conversation already knows, carried by the client. */
  state?: unknown;
  /** listen: proper nouns already in play, so the next socket knows them. */
  entities?: string[];
  /*
   * Deliberately absent: whether a session has contained abuse.
   *
   * It used to arrive here, and a browser setting it to true would have the
   * abuse lexicon sent to its own transcriber -- the exact bias withholding
   * the lexicon exists to avoid. It is now read from comm_talk_sessions,
   * where only the server writes it.
   */
  /**
   * transcribe: a language to prefer, or absent to let the provider decide.
   *
   * Absent is the normal case. A hint is only sent once the conversation has
   * settled into a language, and even then it is a preference — the provider
   * is free to disagree, and the script of what comes back has the last word.
   */
  languageHint?: string;
  /**
   * THE LANGUAGE THE CONVERSATION WAS IN BEFORE THIS TURN, and how the browser
   * judged THIS turn. languageHint already carries the browser's verdict for
   * the current utterance, so the server had no way to say "previously
   * Georgian, now Hebrew" to the model, and no way to tell a confident switch
   * from a one-word guess. Both are stated to the model now, as facts.
   */
  previousLanguage?: string;
  turnLanguageReason?: string;
  turnLanguageConfidence?: number;
  /**
   * Which recogniser this session would like, if it is already enabled.
   *
   * A preference, not an authority: see the use site in listen(). It exists
   * so two recognisers can be compared on identical audio, and so switching
   * between them is a request rather than a deploy.
   */
  sttPreference?: string;
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

  /*
   * THE USAGE TIER IS DECIDED HERE, FROM THE TOKEN, AND NOWHERE ELSE.
   *
   * authenticate() has verified the JWT with the auth service and handed back
   * a client bound to it. Asking that client for is_admin() makes Postgres
   * evaluate the flag for the token's OWN auth.uid() — the same canonical
   * check every admin screen uses. Nothing in the request body is consulted:
   * an `email`, `admin` or `unlimited` field is simply never read, so it
   * cannot be spoofed because it cannot be said.
   *
   * A verified account that is not an administrator is STANDARD, which is
   * held to exactly the anonymous rules. Signing in buys nothing here.
   */
  const usageTier: UsageTier = caller
    ? ((await caller.sb.rpc('is_admin').then((r) => r.data === true).catch(() => false))
      ? 'ADMIN_UNLIMITED'
      : 'STANDARD')
    : 'ANONYMOUS';

  switch (body.action) {
    case 'start':     return await start(sb, req, body, limits, enabled, userId, usageTier);
    case 'turn':      return await turn(sb, body);
    case 'transcribe': return await transcribe(sb, body);
    case 'speak':     return await speak(sb, body);
    case 'converse':  return await converse(sb, body);
    case 'listen':    return await listen(sb, body);
    case 'heartbeat': return await heartbeat(sb, body);
    case 'end':       return await end(sb, body);
    default:          return json({ error: 'unknown_action' }, 400);
  }
});

type Sb = ReturnType<typeof serviceClient>;

async function start(
  sb: Sb, req: Request, body: TalkRequest, limits: TalkLimits, enabled: boolean, userId: string | null,
  usageTier: UsageTier,
): Promise<Response> {
  /*
   * A conversation needs something that can SPEAK, and that is Cartesia.
   *
   * This used to accept either provider, from when ElevenLabs was primary.
   * Left as it was, a deployment with only an ElevenLabs key would start
   * calls it could never answer out loud.
   */
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
    usageTier,
    consumedTodaySeconds: consumedToday,
    sessionsStartedToday: (todays ?? []).length,
    visitorActiveSessions: activeForVisitor ?? 0,
    globalActiveSessions: activeGlobal ?? 0,
    enabled,
  });

  // Every decision, granted or not, explains itself once. Never the token,
  // never the address, never an email: a tier and a reason are enough.
  logEvent('ai-talk', 'grant_decided', {
    authenticated: Boolean(userId),
    usageTier: decision.usageTier,
    granted: decision.granted,
    limitType: decision.reason ?? null,
    limitBypassed: decision.limitBypassed,
    bypassReason: decision.bypassReason ?? null,
    grantedSeconds: decision.seconds,
  });

  if (!decision.granted) {
    logEvent('ai-talk', 'grant_refused', { reason: decision.reason ?? null, usageTier: decision.usageTier });
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
    /*
     * Which clock this session is on. A verified administrator gets the
     * technical ceiling (ADMIN_SESSION_SECONDS) rather than the product
     * limit, and a trace showing 900s must be readable as that, not as a
     * broken setting.
     */
    usageTier,
    configuredSessionSeconds: limits.sessionSeconds,
    expiresAt: session.expires_at,
    /*
     * The voice this session will ACTUALLY be spoken in.
     *
     * It used to be the Cartesia fallback constant, unconditionally, and the
     * comment beside it said the point was that a support question about
     * which voice was used should have an answer that is not a guess. It was
     * a guess, and after the move to ElevenLabs it was the wrong one -- the
     * session speaks with the library's default and this said otherwise.
     *
     * Null rather than a stand-in when neither provider has a voice to offer.
     * The client does not read it; a person reading a support log does.
     */
    voiceId: (await aiTalkVoice(sb, String(body.locale ?? 'ka')))?.voiceId
      ?? (hasSecret('CARTESIA_API_KEY') ? CARTESIA_FALLBACK_VOICE_ID : null),
    // §29: the public demo gets general Homatch capability and no private
    // context whatsoever. This instruction is assembled here, server-side, so
    // the browser cannot widen it.
    instructions: publicDemoInstructions(String(body.locale ?? 'ka')),
  });
}

/**
 * A short-lived credential for transcribing while somebody is still speaking.
 *
 * WHY THE BROWSER IS GIVEN ANYTHING AT ALL
 *
 * Transcription is server-side for a reason — the key that can write Georgian
 * must not be in a page. But batch transcription means the audio cannot even
 * start being read until the sentence has ended, and that wait is now the
 * largest single block of the remaining latency: measured on production,
 * 1.5 seconds of transcription on top of a 0.7 second silence gate, before
 * the model has seen a word.
 *
 * The realtime path removes both. It also produces partial text WHILE the
 * person speaks, which is the difference between a transcript that appears
 * and a transcript that keeps up.
 *
 * What the browser receives is an EPHEMERAL secret: minted here, scoped to
 * transcription, and expiring in minutes. It is not the API key, it cannot
 * generate text or speech, and the session it belongs to is already spending
 * its own metered allowance.
 *
 * A failure here is not an error. The browser keeps the batch path and the
 * conversation still works, a little slower — which is why this returns
 * ok:false rather than a status nobody can act on.
 */
async function listen(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) return guard.refusal;

  const language = body.languageHint ? String(body.languageHint).toLowerCase().slice(0, 5) : null;
  let elevenLabsRefusal: { code: string | null; status: number | null } | null = null;

  /*
   * A ROUTE THAT LEADS BUT CANNOT RUN MUST SAY SO, NOT BE SKIPPED IN SILENCE.
   *
   * The owner has chosen Google for Georgian recognition, and the route now
   * exists at a higher priority than Scribe. Two things it does not have are
   * a credential and a transport -- StreamingRecognize is gRPC, and the
   * browser talks to this function over HTTP.
   *
   * So when a higher-priority STT route is enabled, this reports that it was
   * passed over and why, instead of quietly using the second choice and
   * leaving somebody to wonder for an afternoon why Georgian still sounds
   * like Scribe. Disabled is the normal state and says nothing.
   */
  const preferred = await preferredSttRoute(sb);

  /*
   * ASKING FOR A PARTICULAR RECOGNISER, WITHIN WHAT IS ALREADY ALLOWED.
   *
   * Two recognisers are built and only one can be first, so comparing them on
   * the same audio needs a way to say which -- and switching production
   * between them needs a way back. This is that lever, and it is deliberately
   * a PREFERENCE rather than an authority: it can only select a route an
   * operator has already enabled, it cannot turn one on, and it cannot reach
   * a provider the route table does not list. A caller naming something
   * disabled, kill-switched or unknown is simply ignored.
   *
   * So it buys nothing a visitor could not already have, and it is what makes
   * a rollback one request rather than a deploy.
   */
  const asked = String(body.sttPreference ?? '').toUpperCase();
  const wantsScribe = asked === 'ELEVENLABS' && await sttRouteAvailable(sb, 'ELEVENLABS');
  if (wantsScribe) {
    logEvent('ai-talk', 'stt_preference_honoured', { provider: 'ELEVENLABS' });
  }

  /*
   * GOOGLE FIRST, WHEN AN OPERATOR HAS ENABLED IT AND IT IS ACTUALLY UP.
   *
   * Both halves matter. The route being enabled is a decision; the worker's
   * own health is a fact, and only one of the two instances running that
   * image holds the Google credential. When either is missing this falls
   * through to Scribe and SAYS which — a silent second choice is how an
   * afternoon disappears.
   */
  if (!wantsScribe && preferred?.provider === 'GOOGLE' && !preferred.reason.startsWith('missing')) {
    const ready = await googleSpeechReady();
    const grant = ready ? await mintSpeechGrant(body.sessionId) : null;
    if (ready && grant) {
      logEvent('ai-talk', 'listen_granted', {
        provider: 'GOOGLE', model: ready.model, language: ready.language,
      });
      return json({
        ok: true,
        provider: 'GOOGLE',
        model: ready.model,
        // The socket, and the proof. Never the credential: that stays in the
        // worker and is the whole reason this is a grant and not a key.
        wsUrl: speechSocketUrl(),
        grant,
        /*
         * Every language this socket should be prepared to hear.
         *
         * Sent so the visitor can simply start talking. `language` below
         * stays the primary candidate — a settled conversation keeps its
         * language rather than being re-decided at every pause — and the
         * recogniser picks between these per utterance.
         */
        languages: speechCandidates(
          body.languageHint ?? null,
          body.locale ?? null,
        ),
        language: ready.language,
        sampleRate: 16_000,
      });
    }
    // Enabled, reachable or not, but not serving. Fall through to Scribe and
    // carry the reason so the fallback is observable rather than invisible.
    logEvent('ai-talk', 'google_stt_unavailable', { ready: Boolean(ready) });
  }

  /*
   * ELEVENLABS FIRST, BECAUSE IT IS THE ONE THAT CAN WRITE GEORGIAN.
   *
   * The ladder below is the whole migration in one place. Each rung is tried
   * and the one that answers is used; a rung that refuses is recorded and
   * walked past. Nothing is deleted, so the day ElevenLabs has an outage the
   * session still gets transcribed, a little differently.
   */
  if (elevenLabsCredentialsPresent()) {
    const keyterms = await selectSessionKeyterms(sb, {
      sessionId: body.sessionId, language, surface: 'AI_TALK',
      entities: body.entities ?? [],
      // From the SESSION, never from the caller. A browser that could set
      // this could have the profanity lexicon sent to its own transcriber,
      // which is precisely what withholding it prevents.
      abusiveContext: guard.row.abuse_seen === true,
    });

    const grant = await mintRealtimeToken();
    if (grant.ok && grant.data) {
      logEvent('ai-talk', 'listen_granted', {
        provider: 'ELEVENLABS', path: grant.data.path,
        keyterms: keyterms.selected.length, considered: keyterms.considered,
      });
      return json({
        ok: true,
        provider: 'ELEVENLABS',
        // Named when something was meant to lead and could not, so the
        // admin screen can show the gap rather than implying a choice.
        passedOver: preferred?.provider === 'GOOGLE'
          ? { provider: 'GOOGLE', reason: preferred.reason === 'no client is implemented for this provider yet'
              ? 'the speech worker is not reporting Google as available'
              : preferred.reason }
          : preferred,
        token: grant.data.token,
        expiresAt: grant.data.expiresAt,
        model: ELEVENLABS_DEFAULTS.sttModel,
        sampleRate: ELEVENLABS_DEFAULTS.sttSampleRate,
        // The terms themselves, because the browser builds the socket URL.
        // They are Homatch's own vocabulary, not a secret.
        keyterms: keytermStrings(keyterms),
        keytermLimits: keyterms.limits,
      });
    }
    logEvent('ai-talk', 'listen_provider_refused', {
      provider: 'ELEVENLABS',
      code: grant.error?.code ?? null,
      status: grant.error?.providerCode ?? null,
    });
    // Carried in the fallback answer below, so that "it used the other
    // provider" can be explained without an admin session and without a log
    // this project's tooling cannot read. A code and a status, never a key.
    elevenLabsRefusal = {
      code: grant.error?.code ?? null,
      status: Number(grant.error?.providerCode) || null,
    };
  }

  // The OpenAI realtime path, which carried this before ElevenLabs and stays
  // as the fallback rather than being deleted.
  if (!hasSecret('OPENAI_API_KEY')) return json({ ok: false, reason: 'UNAVAILABLE' }, 200);

  const configured = Deno.env.get('OPENAI_REALTIME_TRANSCRIBE_MODEL');
  const models = [configured, 'gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-transcribe']
    .filter((m): m is string => Boolean(m));

  let lastStatus: number | null = null;

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${requireSecret('OPENAI_API_KEY')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24_000 },
                transcription: { model },
                turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
              },
            },
          },
        }),
        signal: controller.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        lastStatus = res.status;
        logEvent('ai-talk', 'listen_model_refused', {
          status: res.status, model, detail: raw.slice(0, 200),
        });
        continue;
      }

      const parsed = JSON.parse(raw) as { value?: string; expires_at?: number };
      if (!parsed.value) { lastStatus = 200; continue; }

      logEvent('ai-talk', 'listen_granted', { provider: 'OPENAI', model });
      return json({
        ok: true,
        provider: 'OPENAI',
        token: parsed.value,
        expiresAt: parsed.expires_at ?? null,
        model,
        sampleRate: 24_000,
        fellBackFrom: elevenLabsRefusal ? 'ELEVENLABS' : null,
        fellBackCode: elevenLabsRefusal?.code ?? null,
        fellBackStatus: elevenLabsRefusal?.status ?? null,
      });
    } catch (e) {
      logEvent('ai-talk', 'listen_failed', {
        model, detail: String((e as Error)?.message ?? e).slice(0, 160),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return json({
    ok: false, reason: 'UNAVAILABLE', providerStatus: lastStatus,
    fellBackFrom: elevenLabsRefusal ? 'ELEVENLABS' : null,
    fellBackCode: elevenLabsRefusal?.code ?? null,
    fellBackStatus: elevenLabsRefusal?.status ?? null,
  }, 200);
}

/**
 * The handful of terms this session is worth telling the transcriber about.
 *
 * The corpus is over a thousand rows and the provider takes a few dozen, so
 * the database query is deliberately narrow — enabled, provider-eligible,
 * short enough to be a keyterm, ordered by priority — and the ranking then
 * picks from that on the language and the entities actually in play.
 *
 * Diagnostics record term IDS and CATEGORIES. Never the conversation.
 */
async function selectSessionKeyterms(sb: Sb, ctx: {
  sessionId: string;
  language: string | null;
  surface: string;
  entities: string[];
  abusiveContext: boolean;
}) {
  const limits = await keytermLimits(sb);

  const { data } = await sb.from('voice_vocabulary_terms')
    .select('id, term, category, language_hint, scope, priority, provider_eligible, enabled, owner_id, agent_id')
    .eq('enabled', true)
    .eq('scope', 'GLOBAL')
    .order('priority', { ascending: false })
    .limit(1200);

  const terms: VocabularyTerm[] = (data ?? []).map((row) => ({
    id: String(row.id),
    term: String(row.term),
    category: String(row.category),
    languageHint: row.language_hint as string | null,
    scope: 'GLOBAL' as const,
    priority: Number(row.priority ?? 50),
    providerEligible: row.provider_eligible !== false,
    enabled: true,
  }));

  const selection = selectKeyterms(terms, {
    language: ctx.language,
    feature: ctx.surface,
    entities: ctx.entities.slice(0, 12),
    abusiveContext: ctx.abusiveContext,
  }, limits);

  await sb.from('voice_keyterm_selections').insert({
    session_id: ctx.sessionId,
    surface: ctx.surface,
    language: ctx.language,
    term_ids: selection.selected.map((t) => t.id),
    categories: [...new Set(selection.selected.map((t) => t.category))],
    selected_count: selection.selected.length,
    considered_count: selection.considered,
    max_terms: selection.limits.maxTerms,
    max_chars: selection.limits.maxCharsPerTerm,
  });

  return selection;
}

/**
 * Where Georgian recognition actually runs.
 *
 * The worker is deployed twice from one image and only one instance holds the
 * Google credential, so this is not derivable from anything — it is named,
 * with an override for the day that changes.
 */
/**
 * A speech-recognition route that outranks the one actually in use.
 *
 * Returns null in the ordinary case -- nothing enabled above Scribe -- so the
 * answer is only ever non-null when there is something worth explaining.
 * Never throws and never blocks: an unreachable preference must not stop a
 * visitor being heard.
 */
/**
 * Is this provider a route an operator has actually enabled?
 *
 * The question a preference is allowed to ask. It reads the same table the
 * ordinary selection reads, so a preference can never reach further than the
 * configuration already reaches.
 */
async function sttRouteAvailable(sb: Sb, provider: string): Promise<boolean> {
  const { data } = await sb.from('comm_provider_routes')
    .select('provider, enabled, kill_switch, credential_env_names')
    .eq('role', 'STT').eq('provider', provider).maybeSingle();
  if (!data || !data.enabled || data.kill_switch) return false;
  return !(data.credential_env_names ?? []).some((n: string) => !hasSecret(n));
}

async function preferredSttRoute(
  sb: Sb,
): Promise<{ provider: string; reason: string } | null> {
  const { data } = await sb.from('comm_provider_routes')
    .select('provider, priority, enabled, kill_switch, credential_env_names, config')
    .eq('role', 'STT')
    .order('priority');

  for (const row of data ?? []) {
    if (row.provider === 'ELEVENLABS') return null; // we reached the one in use
    if (!row.enabled || row.kill_switch) continue;

    const missing = (row.credential_env_names ?? []).filter((n: string) => !hasSecret(n));
    if (missing.length) {
      // The names, never the values. Which credential is absent is exactly
      // what an operator needs and is not itself a secret.
      return { provider: String(row.provider), reason: `missing ${missing.join(', ')}` };
    }
    return {
      provider: String(row.provider),
      reason: 'no client is implemented for this provider yet',
    };
  }
  return null;
}

/**
 * Correct-and-slow, or fast-and-undeclared, when the model cannot say it.
 *
 * A setting rather than a constant because the answer depends on audio
 * somebody has listened to, and because it must be changeable without a
 * deploy on the day a provider adds a language.
 */
async function languageStrategy(sb: Sb): Promise<LanguageStrategy> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle();
  const value = (data?.config as Record<string, unknown> | null)?.language_strategy;
  return value === 'capable_model' ? 'capable_model' : 'configured_model';
}

/** Raw bytes to base64, chunked so a long piece cannot blow the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/**
 * One phrase, sent while it is still being spoken.
 *
 * WHY THIS IS NOT JUST speakPhrase WITH A CALLBACK
 *
 * speakPhrase waits for the whole clip, records what it cost, and can fall
 * back to Cartesia. That is the right shape for a preview and the wrong one
 * for a conversation: the caller hears nothing until the last byte exists.
 *
 * This asks the provider to stream and forwards each piece as it lands, so
 * the number that gets recorded is time-to-FIRST-audio -- the only one a
 * person experiences. When the stream will not start it falls back to the
 * whole-clip path, which still has Cartesia behind it, so nothing about the
 * existing ladder is lost.
 *
 * Raw PCM only. mp3 frames cannot be cut and rejoined without a click.
 */
/**
 * The voice AI TALK speaks with, and the provider that makes it.
 *
 * Read from the route table and the language profile rather than named here,
 * because which provider speaks Georgian is an operator's decision that has
 * now changed twice. What is NOT configurable is the surface: AI TALK asks
 * for the highest-priority enabled TTS route and uses that one. There is no
 * second provider tried underneath it.
 */
async function aiTalkVoice(
  sb: Sb, language: string | null,
): Promise<{ provider: string; voiceId: string } | null> {
  const { data: routes } = await sb.from('comm_provider_routes')
    .select('provider, enabled, kill_switch')
    .eq('role', 'TTS')
    .order('priority');

  const route = (routes ?? []).find((r) => r.enabled && !r.kill_switch);
  if (!route) return null;
  const provider = String(route.provider);

  const code = String(language ?? '').toLowerCase().split('-')[0];
  if (!code) return null;

  /*
   * The voice somebody approved for THIS language on THIS provider.
   *
   * Still fail-closed, and for the reason it always was: a voice is a
   * recording of a particular human being, a multilingual model can make that
   * person say Georgian words but cannot give them a Georgian mouth, and a
   * confident wrong accent is worse than silence. No approved row, no voice.
   */
  const { data: approved } = await sb.from('voice_language_defaults')
    .select('voice_id')
    .eq('provider', provider).eq('language', code)
    .maybeSingle();

  if (!approved?.voice_id) return null;
  return { provider, voiceId: String(approved.voice_id) };
}

/**
 * One phrase of the reply, streamed, from the one provider AI TALK uses.
 *
 * WHY THERE IS NO LADDER HERE ANY MORE
 *
 * There used to be: ElevenLabs streaming, then ElevenLabs whole-clip, then
 * Cartesia. Every rung was reachable without anybody noticing which one had
 * answered, and that is precisely how five production Georgian turns ran on
 * the whole-clip path for half an hour while the logs said UNKNOWN.
 *
 * A fallback between PROVIDERS is also a fallback between voices, and the
 * assistant changing voice mid-conversation is worse than the assistant
 * pausing. So there is one provider, one voice, and a failure that says so.
 * The model ladder inside the provider stays -- that is the same voice.
 *
 * `outputSampleRate` is the browser's own AudioContext rate. Asking the
 * provider to synthesise at it means the samples are played rather than
 * resampled, and a resample that never happens cannot add artefacts to the
 * joins.
 */

/** The BCP-47 tags the recogniser wants, for the languages above. */
const SPEECH_TAGS: Record<string, string> = {
  ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL',
};

/**
 * The candidates for this conversation, most likely first.
 *
 * Capped at four because that is the recogniser's per-stream limit, so the
 * order is a real decision rather than a formality: whatever the conversation
 * has already settled on leads, then the page's own locale, then the rest.
 * A caller who has been speaking Georgian for four turns should not have
 * Georgian pushed off the end of the list by a locale nobody is using.
 */
function speechCandidates(settled: string | null, locale: string | null): string[] {
  const order: string[] = [];
  for (const code of [settled, locale, ...TALK_LANGUAGES]) {
    const base = String(code ?? '').toLowerCase().split('-')[0];
    const tag = SPEECH_TAGS[base];
    if (tag && !order.includes(tag)) order.push(tag);
    if (order.length === 4) break;
  }
  return order;
}

/**
 * How fast AI TALK speaks, as an operator setting.
 *
 * "Cartesia sounds too slow" is a judgement about a human experience, and the
 * right value for it is found by LISTENING rather than by reasoning. So it is
 * an environment variable with a modest default: the owner can move it and
 * hear the difference without a deploy, and it is clamped to the range
 * Cartesia documents so a typo cannot take the voice out entirely.
 *
 * This is provider-native pacing. It is deliberately NOT the browser's
 * playbackRate, which would shorten the audio by resampling it and raise the
 * pitch to match.
 */
function ttsSpeed(): number | null {
  const raw = Deno.env.get('AI_TALK_TTS_SPEED');
  if (!raw) return CARTESIA_DEFAULT_SPEED;
  const n = Number(raw);
  return Number.isFinite(n) ? n : CARTESIA_DEFAULT_SPEED;
}

/**
 * Slightly quicker than the model's own default.
 *
 * Small on purpose. The measured provider latency is 177-301ms, so the voice
 * was never the reason a reply felt late; what "slow" describes is delivery,
 * and a large jump there reads as rushed rather than competent.
 */
/*
 * 1.0 is the voice's own pace. 1.1 was chosen to trim a little dead air and
 * it read, on a real device, as slightly hurried; the cure for dead air is
 * the streaming pipeline, not a faster mouth.
 */
const CARTESIA_DEFAULT_SPEED = 1.0;

async function speakPhraseStreaming(sb: Sb, params: {
  text: string;
  language: string;
  /**
   * The voice, already resolved for this turn.
   *
   * Looking it up here costs two Supabase queries, and this function runs
   * once PER PHRASE -- so the first phrase of every reply paid a database
   * round trip standing between the model's first words and the synthesiser.
   * The caller resolves it once, while the model is still being asked, and
   * hands it in. Absent, it is looked up as before.
   */
  voice?: { provider: string; voiceId: string } | null;
  sessionId?: string | null;
  surface?: string;
  outputSampleRate?: number | null;
  signal?: AbortSignal;
  onChunk: (chunk: Uint8Array) => void;
}): Promise<
  | { ok: true; firstByteMs: number; totalMs: number; sampleRate: number; provider: string; voiceId: string; model: string; streamed: true }
  | { ok: false; failures: Array<{ provider: string; code: string | null; status: number | null; detail?: string | null }> }
> {
  const voice = params.voice ?? await aiTalkVoice(sb, params.language || null);
  if (!voice) {
    return {
      ok: false,
      failures: [{ provider: 'NONE', code: 'VOICE_NOT_APPROVED_FOR_LANGUAGE', status: null }],
    };
  }

  if (voice.provider !== 'CARTESIA') {
    /*
     * A route pointing somewhere AI TALK cannot speak is a configuration
     * mistake, and it says so instead of quietly finding another provider.
     * Silently speaking in a voice nobody selected is the failure this whole
     * migration is about.
     */
    logEvent('ai-talk', 'tts_route_unsupported', { provider: voice.provider });
    return {
      ok: false,
      failures: [{ provider: voice.provider, code: 'PROVIDER_NOT_SUPPORTED_ON_AI_TALK', status: null }],
    };
  }

  if (!cartesiaCredentialsPresent().ok) {
    return { ok: false, failures: [{ provider: 'CARTESIA', code: 'MISSING_CREDENTIALS', status: null }] };
  }

  const at = Date.now();
  const out = await streamCartesiaPcm({
    voiceId: voice.voiceId,
    // Respelled for the voice only. See speakPhrase above: the reply that is
    // streamed to the browser and written to history is params.text, unchanged.
    text: speechText(params.text, params.language),
    language: params.language || 'ka',
    sampleRate: params.outputSampleRate ?? undefined,
    speed: ttsSpeed(),
    signal: params.signal,
  }, (chunk) => params.onChunk(chunk));

  if (out.ok && out.data) {
    await recordVoiceUsage(sb, {
      sessionId: params.sessionId ?? null,
      surface: params.surface ?? 'AI_TALK',
      provider: 'CARTESIA', role: 'TTS', model: out.data.model,
      characters: out.data.characters,
      // What a person waited through, not what the whole clip cost.
      latencyMs: out.data.firstByteMs,
      ok: true, errorCode: null, providerStatus: null,
    });
    return {
      ok: true, streamed: true,
      firstByteMs: out.data.firstByteMs,
      totalMs: out.data.totalMs,
      sampleRate: out.data.sampleRate,
      provider: 'CARTESIA',
      voiceId: voice.voiceId,
      model: out.data.model,
    };
  }

  await recordVoiceUsage(sb, {
    sessionId: params.sessionId ?? null,
    surface: params.surface ?? 'AI_TALK',
    provider: 'CARTESIA', role: 'TTS', model: 'sonic-3',
    characters: params.text.length, latencyMs: Date.now() - at,
    ok: false, errorCode: out.error?.code ?? null,
    providerStatus: Number(out.error?.providerCode) || null,
  });

  /*
   * The provider's own sentence, kept. Twice now a bucketed code has cost a
   * day: PROVIDER_ERROR for a gRPC 12 that was a 404, and UNKNOWN for a
   * websocket frame that said exactly which field was wrong.
   */
  logEvent('ai-talk', 'tts_failed', {
    provider: 'CARTESIA',
    code: out.error?.code ?? null,
    providerStatus: Number(out.error?.providerCode) || null,
    detail: String(out.error?.message ?? '').slice(0, 300),
  });

  return {
    ok: false,
    failures: [{
      provider: 'CARTESIA',
      code: out.error?.code ?? null,
      status: Number(out.error?.providerCode) || null,
      detail: String(out.error?.message ?? '').slice(0, 200),
    }],
  };
}

/**
 * Did this turn contain abuse?
 *
 * WHY IT READS THE CORPUS AND NOT A CONSTANT
 *
 * The lexicon is already in the database, in two categories, maintained by
 * whoever knows the language. A copy compiled into this function would drift
 * from it the first time somebody added a word, and the copy is the one that
 * would be wrong.
 *
 * WHY IT IS A WHOLE-WORD MATCH
 *
 * Substring matching on a profanity list is how ordinary words become
 * offences -- the Georgian and Russian lists both contain short forms that sit
 * inside perfectly normal words. A miss here costs nothing: the model answers
 * the turn the way it answers any other. A false positive tells the model
 * somebody was abusive when they asked about a mortgage.
 *
 * NOTHING IS STORED. The sentence is not written anywhere, the matching term
 * is not written anywhere, and the answer is one boolean on the session.
 */
async function turnContainsAbuse(sb: Sb, said: string): Promise<boolean> {
  const text = said.toLowerCase();
  if (!text.trim()) return false;

  const { data } = await sb.from('voice_vocabulary_terms')
    .select('term')
    .in('category', ['abuse_georgian', 'abuse_ru_en'])
    .eq('enabled', true)
    .limit(400);

  // Letters and digits in any script; everything else is a boundary. A
  // Unicode-aware split, because the lexicon is mostly not Latin.
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));

  for (const row of data ?? []) {
    const term = String(row.term ?? '').toLowerCase().trim();
    if (!term) continue;
    if (term.includes(' ')) {
      // A phrase is matched as a phrase, still on boundaries.
      if (text.includes(term)) return true;
      continue;
    }
    if (words.has(term)) return true;
  }
  return false;
}

/**
 * The provider's limits, from the route row rather than from a constant.
 *
 * The handoff pack said fifty terms at twenty characters; the provider has
 * since raised keyterm capacity once already. An admin changing this must not
 * need a deploy.
 */
async function keytermLimits(sb: Sb): Promise<{ maxTerms: number; maxCharsPerTerm: number }> {
  const { data } = await sb.from('comm_provider_routes')
    .select('config')
    .eq('role', 'STT').eq('provider', 'ELEVENLABS')
    .maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    maxTerms: num(cfg.max_keyterms, KEYTERM_LIMITS_DEFAULT.maxTerms),
    maxCharsPerTerm: num(cfg.max_keyterm_chars, KEYTERM_LIMITS_DEFAULT.maxCharsPerTerm),
  };
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
 * One turn, streamed: words as they are written, voice as it is made.
 *
 * WHY THIS REPLACED turn + speak
 *
 * Measured on production, last word to first sound: 6.8 seconds. The shape of
 * it was the problem, not any one stage. Transcription finished, THEN the
 * model wrote the whole reply, THEN the whole reply was synthesised, THEN a
 * sound came out — three complete waits in a row, each one finishing before
 * the next could start.
 *
 * Here they overlap. The model streams; the moment a speakable phrase is
 * complete it goes to synthesis while the model keeps writing; the audio for
 * phrase one is on its way back before phrase two exists. The visitor sees
 * words appear almost immediately and hears the voice start on the first
 * phrase rather than the last.
 *
 * Server-sent events rather than a websocket: this is one request with one
 * ordered answer, and a socket would add a connection to hold open, a
 * reconnect path and a second thing to get wrong.
 */
async function converse(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);

  const said = String(body.text ?? '').trim().slice(0, 1000);
  if (!said) return json({ ok: false, reason: 'EMPTY' }, 400);

  const handlerStartedAt = Date.now();

  /*
   * TWO ROUND TRIPS THAT USED TO HAPPEN ONE AFTER THE OTHER.
   *
   * Both need only `sb` and the sentence, neither needs the other's answer,
   * and both sat on the path between a visitor finishing a sentence and the
   * model being asked anything. Measured: the model's own time to first token
   * is about 1.4 seconds while the browser sees 2.1 -- the difference is work
   * like this, done in series, before the request is even built.
   */
  const abuseCheck = turnContainsAbuse(sb, said);
  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) { void abuseCheck.catch(() => false); return guard.refusal; }
  const session = guard.row;

  const locale = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);
  /*
   * WHICH LANGUAGE TO ANSWER IN.
   *
   * In order of how much each source actually knows:
   *
   *   1. the script of what they just said — decisive where it exists, since
   *      Georgian letters are Georgian whatever anything else believes;
   *   2. the language the session has settled on, which the browser sends and
   *      which already carries the recogniser's own per-utterance answer
   *      through a stabiliser that will not move on one short sample;
   *   3. the page locale, which is where the visitor arrived, not necessarily
   *      the language they are speaking.
   *
   * The page locale being LAST is the point. It used to be reachable whenever
   * script evidence was absent, which is every English and Turkish turn.
   */
  /*
   * THE SERVER RESOLVES THIS ITSELF, FROM THE SAME MODULE THE BROWSER USES.
   *
   * Not because the browser is untrusted in the security sense -- it is a
   * public surface and everything here is already guarded -- but because a
   * language is the one field that decides which voice speaks, and a stale or
   * malformed value produced a silent turn in production. Running the same
   * pure function over the same inputs means the two sides cannot disagree,
   * and whatever arrives in `languageHint` is treated as the session's
   * PREVIOUS language rather than as an answer.
   *
   * The result is one of six by construction. Nothing else can reach Luna or
   * Cartesia from here.
   */
  const resolution = resolveTurnLanguage({
    transcript: said,
    providerLanguage: body.providerLanguage ?? null,
    providerDetected: body.providerDetected === true,
    firstTurn: body.firstTurn === true,
    previousSessionLanguage: body.languageHint ?? null,
    pageLocale: locale,
  });
  /*
   * ASKED FOR A LANGUAGE, WHICH OUTRANKS THE ONE THEY ASKED IN.
   *
   * "ინგლისურად მელაპარაკე" is a GEORGIAN sentence, so the resolver above
   * correctly resolves it to Georgian, and answering in Georgian is exactly
   * what the visitor just said not to do. Worse than ignored: the model would
   * obey the request, and the reply-language guard further down would then
   * throw the English answer away and retry it in Georgian, so the system
   * actively undid the one thing that was explicitly asked for.
   *
   * Read from the words, deterministically, before a token is generated --
   * the switch has to reach the prompt, the guard, the voice and the next
   * recogniser, and by the time a reply exists it is too late for all four.
   */
  const requested = detectLanguageRequest(said, resolution.resolvedLanguage);
  const replyLanguage: TalkLanguage = requested ?? resolution.resolvedLanguage;
  if (requested) {
    logEvent('ai-talk', 'language_switch_requested', {
      from: resolution.resolvedLanguage, to: requested,
    });
  }

  // What the conversation already knows, plus whatever this sentence added.
  const state = updateTalkState(sanitiseTalkState(body.state), said, replyLanguage);

  /*
   * Enough turns to follow a conversation, few enough to stay cheap.
   *
   * Six was three exchanges, which is not enough to resolve "and under a
   * hundred and sixty thousand?" back to the rooms and the district that were
   * named before it. Twelve is still a fixed ceiling -- the prompt cannot grow
   * with the session, so a long conversation does not get progressively
   * slower -- and each turn is already truncated.
   */
  const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
  const conversation = history
    .map((h) => `${h.role === 'assistant' ? 'Homatch' : 'Visitor'}: ${String(h.content ?? '').slice(0, 300)}`)
    .join('\n');

  const known = describeState(state);
  const gaps = stateGaps(state);

  /*
   * Did this turn contain abuse, and does the session already know?
   *
   * Matched against the lexicon Homatch already keeps rather than a list
   * written here, so adding a word is an admin's edit and not a deploy. What
   * is recorded is one boolean -- not the sentence, not the word, not a
   * count. The conversation stays theirs.
   */
  /*
   * Where the wait before the first spoken word went.
   *
   * Recorded per turn because "Luna is slow" is three problems in one number
   * -- getting the request accepted, reading the prompt, and thinking -- and
   * they have different fixes.
   */
  /*
   * The voice, fetched while the model is being asked rather than after it
   * answers. Two Supabase queries that used to sit between the first phrase
   * and the synthesiser, once per phrase.
   */
  const voicePromise = aiTalkVoice(sb, replyLanguage).catch(() => null);

  let llmStartedMs: number | null = null;
  let llmEffort: string | null = null;
  let llmHeadersMs: number | null = null;
  let llmThinkMs: number | null = null;
  let llmInputTokens: number | null = null;
  let llmOutputTokens: number | null = null;
  let llmIncomplete = false;
  let llmIncompleteReason: string | null = null;

  // Already in flight since the top of the handler; this is where it is needed.
  const abusive = session.abuse_seen === true || await abuseCheck.catch(() => false);

  const user = [
    conversation ? `Recent turns:\n${conversation}\n` : '',
    known ? `ALREADY KNOWN — never ask for any of this again:\n${known}\n` : '',
    gaps.length && !stateIsRich(state)
      ? `Still unknown, in order of usefulness: ${gaps.join('; ')}.\n`
      : 'Enough is known to stop interrogating. Be useful about what they already told you.\n',
    `Visitor just said: "${said}"`,
    // The one fact the reply language rests on, stated with the turn rather
    // than inferred from the history: answer in THIS utterance's language.
    // Conversation context and response language are two different things;
    // the first persists, the second follows the current turn.
    ...languageContract(replyLanguage, body, resolution),
    '',
    // Said only when it is true, so an ordinary turn carries no instruction
    // about insults at all.
    abusive
      ? 'They have been abusive. Do not react to it, do not name it, do not lecture and do not '
        + 'apologise. Answer the real question underneath it, calmly, in the same short form. If '
        + 'there is no question underneath, ask what they are looking for.\n'
      : '',
    `Answer ONLY in ${LANGUAGE_NAMES[replyLanguage]} for this turn. Not a word of any other language, `
      + 'except a brand name like Homatch which stays in Latin letters.',
    // Deliberately not a sentence count. The instruction used to end by
    // demanding "one or two short sentences" of EVERY turn, which overrode
    // everything above it and is why each answer came out the same size.
    'Answer out loud, at the length this particular question deserves.',
  ].filter(Boolean).join('\n');

  /*
   * The turn counter is not worth a visitor's silence.
   *
   * Nothing below reads it back, and awaiting it put a whole Supabase round
   * trip between the sentence and the model. It is still written and a
   * failure is still recorded; it simply no longer happens while somebody is
   * waiting to be answered.
   */
  void sb.from('comm_talk_sessions')
    .update({
      turns: Number(session.turns ?? 0) + 1,
      ...(abusive && session.abuse_seen !== true ? { abuse_seen: true } : {}),
    })
    .eq('id', session.id)
    .then(({ error }) => {
      if (error) logEvent('ai-talk', 'turn_count_failed', { error: String(error.message).slice(0, 80) });
    });

  /*
   * What the browser will play at, snapped to something the provider offers.
   * Absent on an older client, which simply gets the provider default and one
   * resample, exactly as before.
   */
  const outputSampleRate = nearestCartesiaRate(body.outputSampleRate ?? null);

  /*
   * A DROPPED LISTENER MUST STOP THE SYNTHESIS IT WAS PAYING FOR.
   *
   * A visitor who interrupts, navigates away or closes the panel cancels the
   * request; without this the phrases already queued carried on being
   * synthesised and billed, and the audio for a turn nobody was listening to
   * arrived at a socket nobody was reading.
   */
  const turnAbort = new AbortController();

  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      /*
       * THE FIRST BYTE, SENT BEFORE ANY WORK.
       *
       * The browser sees about 1.6 seconds between asking for a turn and the
       * first word, while this function's own stamps account for roughly
       * 850ms of it. The missing time is either the trip here or work done
       * before the stream opens, and those have completely different fixes:
       * one is a region problem and the other is ours.
       *
       * So the stream says hello immediately, carrying how long THIS handler
       * had already been running when it did. Everything the client measures
       * before the ack, minus handlerMs, is transport.
       */
      send('ack', { handlerMs: Date.now() - handlerStartedAt });

      /*
       * SYNTHESIS RUNS BESIDE THE MODEL, AND SO DOES SENDING IT.
       *
       * The first version got half of this right: phrases were synthesised as
       * they were written, and then every audio event was flushed after the
       * model had finished. Measured on production, that put first audio at
       * 3.7 seconds behind first text at 1.4 — the parallelism was real and
       * entirely invisible, because nothing left the server until the slowest
       * thing had ended.
       *
       * The drain below runs as its own task. It sends each piece the moment
       * that piece is ready, in order, while the model is still writing.
       */
      /*
       * A PHRASE IS NOW A GROWING LIST OF PIECES, NOT ONE FINISHED CLIP.
       *
       * It used to be a promise of the whole clip, so the caller heard
       * nothing until the last byte of the first phrase existed. The provider
       * streams; this keeps each piece as it lands and lets the drain forward
       * it, still strictly in order, while the rest is still being made.
       */
      interface Phrase {
  /** Characters and tail of the text this request was given. */
  textChars?: number;
  textTail?: string;
  /** ms after the turn started: when this phrase was asked for, and when its audio finished. */
  requestMs?: number;
  doneMs?: number | null;
        index: number;
        chunks: string[];
        done: boolean;
        sampleRate: number;
        provider: string | null;
        voiceId: string | null;
        /** Time to the FIRST piece: what a person actually waits through. */
        firstByteMs: number | null;
        totalMs: number;
        code: string | null;
        status: number | null;
        detail?: string | null;
        model?: string | null;
      }
      const spoken: Phrase[] = [];
      let voiceFailure: { code: string | null; status: number | null } | null = null;
      let llmFinished = false;
      let wake: (() => void) | null = null;
      const nudge = () => { const w = wake; wake = null; w?.(); };

      /*
       * Queue one phrase for synthesis. NOT the synthesiser.
       *
       * It was called speakPhrase, which is also the name of the module-level
       * function it calls -- so inside its own body the name resolved to
       * itself, and every reply recursed instead of being spoken. Text
       * streamed, the assistant was silent, and nothing recorded a failure
       * because nothing failed: the synthesis was never reached. A different
       * name is the whole fix, and the name is now what it does.
       */
      const queuePhrase = (phrase: string) => {
        const index = spoken.length;
        const slot: Phrase = {
          index, chunks: [], done: false,
          requestMs: Date.now() - startedAt, doneMs: null,
          // What was actually asked of the voice. ttsTextChars read a `text`
          // field that never existed and reported 0 on a real turn with four
          // requests -- telemetry that could not prove the one thing it was for.
          textChars: phrase.length, textTail: phrase.slice(-40),
          sampleRate: outputSampleRate, provider: null, voiceId: null,
          firstByteMs: null, totalMs: 0, code: null, status: null, detail: null, model: null,
        };
        spoken.push(slot);

        void (async () => {
          const at = Date.now();
          const out = await speakPhraseStreaming(sb, {
            text: phrase, language: replyLanguage,
            sessionId: session.id, surface: 'AI_TALK',
            outputSampleRate,
            // Resolved once for the turn, before the model answered, so the
            // first phrase does not wait on a lookup to be spoken.
            voice: await voicePromise,
            signal: turnAbort.signal,
            onChunk: (chunk) => {
              if (slot.firstByteMs === null) slot.firstByteMs = Date.now() - at;
              slot.chunks.push(bytesToBase64(chunk));
              nudge();
            },
          });

          if (slot.index === 0) {
            // The first phrase is the one the caller is waiting through, and
            // the only one whose timing describes the experience.
            ttsRequestAt = at - startedAt;
            ttsFirstByteAt = slot.firstByteMs === null ? null : (at - startedAt) + slot.firstByteMs;
          }

          if (out.ok) {
            slot.sampleRate = out.sampleRate;
            slot.provider = out.provider;
            slot.voiceId = out.voiceId;
            slot.model = out.model;
            slot.totalMs = out.totalMs;
            slot.doneMs = Date.now() - startedAt;
          } else {
            slot.code = out.failures[0]?.code ?? null;
            slot.status = out.failures[0]?.status ?? null;
            slot.detail = out.failures[0]?.detail ?? null;
            slot.totalMs = Date.now() - at;
            slot.doneMs = Date.now() - startedAt;
          }
          slot.done = true;
          nudge();
        })();
        nudge();
      };

      let firstAudioAt = 0;
      let ttsMs = 0;
      let audioBytes = 0;
      /*
       * THE SERVER HALF OF THE TURN, AS OFFSETS FROM THIS REQUEST.
       *
       * Offsets rather than clock times on purpose: the browser and this
       * function do not share a clock, and a latency report built by
       * subtracting one machine's now() from another's is a number about
       * clock skew. The browser knows when it sent the request; these say
       * what happened after that, and the two compose without either of them
       * having to trust the other's clock.
       */
      let llmFirstTokenAt: number | null = null;
      /** When the model stopped writing -- the fact the overlap verdict is judged against. */
      let llmFinalAt: number | null = null;
      let ttsRequestAt: number | null = null;
      let ttsFirstByteAt: number | null = null;

      /*
       * STRICTLY IN ORDER, BUT NEVER WAITING FOR A WHOLE PHRASE.
       *
       * `sent` is the phrase being drained and `offset` the piece within it.
       * A piece is forwarded the instant it exists; the drain only moves to
       * the next phrase once this one says it is done. Order is preserved
       * because a later phrase is never touched before an earlier one
       * finishes, which is what keeps the sentence in one piece.
       */
      let seq = 0;
      const drain = (async () => {
        let sent = 0;
        let offset = 0;
        for (;;) {
          if (sent >= spoken.length) {
            if (llmFinished) return;
            await new Promise<void>((resolve) => { wake = resolve; });
            continue;
          }
          const phrase = spoken[sent];

          if (offset >= phrase.chunks.length) {
            if (!phrase.done) {
              await new Promise<void>((resolve) => { wake = resolve; });
              continue;
            }
            // Finished. Attribute it and move on.
            ttsMs += phrase.totalMs;
            if (!phrase.chunks.length && !voiceFailure) {
              voiceFailure = { code: phrase.code, status: phrase.status };
            }
            sent += 1;
            offset = 0;
            continue;
          }

          const piece = phrase.chunks[offset];
          offset += 1;
          if (!firstAudioAt) firstAudioAt = Date.now() - startedAt;
          audioBytes += Math.round(piece.length * 0.75);
          send('audio', {
            // Monotonic across phrases, because the browser schedules by
            // arrival order and a per-phrase index would repeat.
            index: seq++,
            pcmBase64: piece,
            // The rate the provider that actually answered synthesised at.
            // ElevenLabs and Cartesia do not have to agree for this to work,
            // but the browser has to be told which it got.
            sampleRate: phrase.sampleRate,
            provider: phrase.provider,
            voiceId: phrase.voiceId,
          });
        }
      })();

      let full = '';
      /** What has actually been shown and queued: `full` minus the marker. */
      let shown = '';
      let pending = '';
      /** True once there was enough text to judge the language. */
      let languageChecked = false;
      /** True when the model answered in the wrong language and the turn is void. */
      let wrongLanguage = false;
      let firstTextAt = 0;
      let failed: string | null = null;

      try {
        llmStartedMs = Date.now() - handlerStartedAt;
        for await (const event of streamLlm({
          system: publicDemoInstructions(replyLanguage),
          user,
          /*
           * Enough for the answer the prompt now asks for.
           *
           * This was 120 visible tokens, which is about two spoken sentences,
           * and it was correct while the instructions demanded exactly two.
           * They no longer do -- a real question is supposed to get a real
           * answer -- so the budget and the instruction had come apart, and
           * the way that shows up is a model stopped in the middle of its
           * fourth sentence with the voice already speaking the third.
           *
           * Still bounded, and deliberately not generous: a model left with
           * room for 1,200 tokens writes 1,200, and the visitor waits through
           * every one of them being spoken aloud.
           */
          /*
           * ROOM TO FINISH THE SENTENCE.
           *
           * 220/460 was chosen to stop the model writing 1,200 tokens that a
           * visitor then has to sit through. It did that, and it also cut
           * real answers off mid-word -- a Georgian visitor asked, out loud,
           * why the assistant had stopped talking.
           *
           * Georgian is the reason it showed there first: it costs several
           * times more tokens per word than English, so the same answer hits
           * the ceiling in Georgian and fits in English. A cap is the wrong
           * instrument for brevity anyway -- it does not make an answer
           * shorter, it makes it unfinished. Brevity belongs in the prompt,
           * where the model can choose where to stop.
           *
           * So: enough room that a normal spoken answer finishes, truncation
           * detected and reported when it still happens, and the length
           * itself governed by what the personality is asked for.
           */
          maxTokens: 400,
          maxOutputTokens: 900,
          /*
           * NO REASONING. A spoken answer about a flat is not a reasoning
           * problem, and the thinking was the largest and least predictable
           * part of the wait -- measured between 262ms and 2592ms, tracking
           * how long an answer the model was planning.
           *
           * This asked for 'minimal', which gpt-5.6-luna refuses; the refusal
           * fell back to 'low', one step ABOVE the floor, on every turn of
           * every conversation. The provider names 'none' in the very error
           * it returns, and 'none' is what a voice turn wants.
           */
          reasoningEffort: 'none',
          timeoutMs: 20_000,
        })) {
          if (event.type === 'meta') {
            // Where the wait went, kept for the trace. Never spoken.
            if (event.headersMs !== undefined) llmHeadersMs = event.headersMs;
            if (event.firstTokenMs !== undefined) llmThinkMs = event.firstTokenMs;
            if (event.effort !== undefined) llmEffort = event.effort;
            if (event.inputTokens !== undefined) llmInputTokens = event.inputTokens;
            if (event.outputTokens !== undefined) llmOutputTokens = event.outputTokens;
            /*
             * The model ran out of room mid-sentence. Kept, because the
             * difference between "a short answer" and "an answer that was
             * cut off" is invisible from the text alone -- and a visitor
             * hearing the second one asks why the assistant stopped talking.
             */
            if (event.incomplete) {
              llmIncomplete = true;
              llmIncompleteReason = event.incompleteReason ?? 'unknown';
            }
            continue;
          }
          if (event.type === 'error') { failed = event.error ?? 'llm'; break; }
          if (event.type === 'done') break;
          if (event.type !== 'delta' || !event.text) continue;

          if (!firstTextAt) {
            firstTextAt = Date.now() - startedAt;
            // The model's time-to-first-token, measured rather than assumed.
            llmFirstTokenAt = firstTextAt;
            send('open', { ms: firstTextAt, language: replyLanguage });
          }
          full += event.text;

          /*
           * NOTHING PAST THE MARKER IS EVER SPOKEN OR SHOWN.
           *
           * The model appends its action as text, so the text stream is also
           * where it can go wrong -- and the way it goes wrong is the voice
           * reading JSON aloud to somebody. `full` keeps everything for
           * parsing; only the part before the marker is displayed, queued for
           * synthesis, or stored as the reply.
           *
           * A trailing partial marker is held too: "<<A" is a prefix of the
           * marker, and speaking it because the next token has not arrived
           * yet would be the same bug with better timing.
           */
          const visible = spokenPart(full);
          const grown = visible.slice(shown.length);
          if (grown && !endsWithPartialMarker(visible)) {
            shown = visible;
            pending += grown;
            send('text', { delta: grown });
          }

          // The FIRST phrase is allowed to be short, because it is the one
          // the visitor is waiting on. Later ones are longer, because by then
          // the voice is already playing and a longer phrase sounds better
          // than a chopped one.
          /*
           * THE LANGUAGE GATE, BEFORE A SINGLE PHRASE IS SYNTHESISED.
           *
           * Telling the model which language to answer in is an instruction,
           * not a guarantee, and synthesis starts on the first few words --
           * so by the time a wrong-language reply is obvious, it has already
           * been spoken aloud and rendered on screen.
           *
           * Nothing is queued until there is enough text to judge. Once there
           * is, a reply in the wrong script is abandoned here: no audio is
           * requested, nothing further is sent, and the turn is retried once
           * with a blunter instruction. Georgian, Russian, Arabic and Hebrew
           * are decidable this way; English and Turkish share an alphabet and
           * the check does not pretend otherwise.
           */
          if (!languageChecked && shown.trim().length >= 12) {
            languageChecked = true;
            if (!textMatchesLanguage(shown, replyLanguage)) {
              wrongLanguage = true;
              break;
            }
          }

          if (languageChecked) {
            let phrase = takePhrase(pending, spoken.length === 0 ? 8 : 45, spoken.length === 0);
            while (phrase) {
              queuePhrase(phrase);
              pending = pending.slice(phrase.length);
              phrase = takePhrase(pending, spoken.length === 0 ? 8 : 45, spoken.length === 0);
            }
          }
        }

        /*
         * The marker may only have completed on the final token, so the
         * visible text is recomputed once at the end rather than trusted from
         * the loop. Whatever is left unspoken is the last phrase.
         */
        llmFinalAt = Date.now() - startedAt;
        const finalVisible = spokenPart(full);
        if (finalVisible.length > shown.length) {
          const tail = finalVisible.slice(shown.length);
          shown = finalVisible;
          pending += tail;
          send('text', { delta: tail });
        }
        /*
         * ONE RETRY, WITH THE INSTRUCTION MADE BLUNT.
         *
         * A model that drifted once usually complies when told plainly what
         * it did. A second failure is not worth a third round trip on a path
         * whose whole problem is latency, so it becomes a short, honest
         * message in the right language rather than mixed-script text nobody
         * asked for.
         */
        if (wrongLanguage) {
          logEvent('ai-talk', 'reply_wrong_language', {
            expected: replyLanguage,
            reason: resolution.resolutionReason,
          });

          full = '';
          shown = '';
          pending = '';
          languageChecked = false;
          let retry = '';
          for await (const event of streamLlm({
            system: publicDemoInstructions(replyLanguage),
            user: `${user}\n\nYour previous answer was in the wrong language. `
              + `Answer ONLY in ${LANGUAGE_NAMES[replyLanguage]}. Nothing else.`,
            // The same room as the first attempt: a retry that truncates is
            // the same defect with an extra round trip in front of it.
            maxTokens: 400, maxOutputTokens: 900,
            reasoningEffort: 'none', timeoutMs: 15_000,
          })) {
            if (event.type === 'error') break;
            if (event.type === 'done') break;
            if (event.type === 'delta' && event.text) retry += event.text;
          }

          llmFinalAt = Date.now() - startedAt;
          const retryVisible = spokenPart(retry);
          if (retryVisible.trim() && textMatchesLanguage(retryVisible, replyLanguage)) {
            shown = retryVisible;
            full = retry;
            send('text', { delta: retryVisible });
            pending = retryVisible;
            languageChecked = true;
          } else {
            logEvent('ai-talk', 'reply_wrong_language_twice', { expected: replyLanguage });
            send('failed', { reason: 'LANGUAGE_UNAVAILABLE' });
            llmFinished = true;
            nudge();
            await drain;
            controller.close();
            return;
          }
        }

        /*
         * The marker may only have completed on the final token, so the
         * visible text is recomputed once at the end rather than trusted from
         * the loop. Whatever is left unspoken is the last phrase.
         */
        if (!failed && pending.trim()) queuePhrase(pending.trim());
        llmFinished = true;
        nudge();

        if (failed || !full.trim()) {
          logEvent('ai-talk', 'converse_llm_failed', { reason: failed ?? 'empty' });
          send('failed', { reason: 'ASSISTANT_FAILED' });
          controller.close();
          return;
        }

        send('reply', { text: shown.trim(), language: replyLanguage });

        /*
         * WHERE TO SEND THEM, AND WHETHER THIS CALL IS FINISHED.
         *
         * Sent before the audio has drained on purpose: the button should be
         * on screen while the assistant is still saying "open it here", not
         * after. The client does not act on `end` until the voice has
         * finished the sentence.
         *
         * The destination is whatever the KEY resolved to in this
         * application's own route list. A key nobody recognises produces no
         * event at all, which is why the model cannot invent a URL: it never
         * supplies one.
         */
        const action = parseAction(full);
        if (action.destination) {
          logEvent('ai-talk', 'nav_offered', { key: action.destination.key });
          send('action', {
            kind: 'NAVIGATE',
            key: action.destination.key,
            path: action.destination.path,
          });
        }
        if (action.end) {
          logEvent('ai-talk', 'auto_end', { reason: action.endReason });
          send('end', { reason: action.endReason ?? 'OBJECTIVE_MET' });
        }

        await drain;
        if (!firstAudioAt) {
          logEvent('ai-talk', 'converse_voiceless', {
            code: voiceFailure?.code ?? null, status: voiceFailure?.status ?? null,
          });
          send('voiceless', {
            /*
             * "Unavailable" and "nobody approved a voice for this language"
             * are different things and deserve different sentences. The
             * first sounds like a glitch worth retrying; the second is a
             * deliberate configuration and will be true on every turn until
             * somebody approves a voice.
             */
            reason: voiceFailure?.code === 'VOICE_NOT_APPROVED_FOR_LANGUAGE'
              ? 'VOICE_NOT_APPROVED_FOR_LANGUAGE'
              : 'VOICE_UNAVAILABLE',
            providerCode: voiceFailure?.code ?? null,
            providerStatus: voiceFailure?.status ?? null,
            language: replyLanguage,
          });
        }

        send('state', { state });
        send('done', {
          firstTextMs: firstTextAt,
          firstAudioMs: firstAudioAt || null,
          totalMs: Date.now() - startedAt,
          ttsMs,
          chars: shown.length,
          phrases: spoken.length,
          /*
           * RESPONSE COMPLETENESS, stated rather than inferred.
           *
           * `assistantResponseCompleted` is false when the model stopped
           * because it ran out of room, which is the difference between a
           * short answer and an answer that was cut off. Everything the
           * browser needs to prove no tail was lost between here and the
           * speaker is on this event.
           */
          llmTextChars: full.length,
          ttsTextChars: spoken.reduce((n, p) => n + (p.textChars ?? 0), 0),
          ttsRequests: spoken.length,
          ttsCompletedRequests: spoken.filter((p) => p.done && !p.code).length,
          ttsFinalTail: spoken.length ? (spoken[spoken.length - 1].textTail ?? null) : null,
          assistantResponseCompleted: !llmIncomplete,
          /*
           * Proof that the pipeline overlapped rather than waited: every
           * phrase's stamps, and the three yes/no facts computed from them.
           */
          segments: spoken.map((p) => ({
            index: p.index, requestMs: p.requestMs ?? null,
            firstByteMs: p.firstByteMs === null || p.firstByteMs === undefined || p.requestMs === undefined
              ? null : (p.requestMs ?? 0) + p.firstByteMs,
            doneMs: p.doneMs ?? null, textChars: p.textChars ?? 0,
          })),
          overlap: judgeOverlap({
            llmFirstTokenMs: llmFirstTokenAt,
            llmFinalMs: llmFinalAt,
            firstAudioSentMs: firstAudioAt || null,
            segments: spoken.map((p) => ({
              index: p.index, requestMs: p.requestMs ?? null,
              firstByteMs: p.firstByteMs === null || p.firstByteMs === undefined ? null : (p.requestMs ?? 0) + p.firstByteMs,
              doneMs: p.doneMs ?? null, textChars: p.textChars ?? 0,
            })),
          }),
          responseInterruptReason: llmIncomplete ? `LLM_${llmIncompleteReason ?? 'INCOMPLETE'}` : null,
          finalTextTail: shown.slice(-40),
          /*
           * Every stage this function is responsible for, as offsets from the
           * moment it started work. The browser adds its own half.
           */
          timing: {
            llmFirstTokenMs: llmFirstTokenAt,
            ttsRequestMs: ttsRequestAt,
            ttsFirstByteMs: ttsFirstByteAt,
            firstAudioSentMs: firstAudioAt || null,
            streamed: spoken[0] ? spoken[0].chunks.length > 1 : null,
          },
        });
        /*
         * ONE TRACE PER TURN.
         *
         * Everything that decided this turn, on one line, so the next mixed
         * script or silent reply is a query and not an afternoon. Counts and
         * codes only: no transcript, no reply text, no credential. The
         * language fields are the resolver's own record of what it was given
         * and what it concluded, which is the part that was invisible while a
         * Georgian session was quietly becoming Korean.
         */
        logEvent('ai-talk', 'turn_trace', {
          session_id: session.id,
          turn_id: String(body.turnId ?? '').slice(0, 40) || null,
          ui_locale: locale,
          llm_incomplete: llmIncomplete,
          llm_incomplete_reason: llmIncompleteReason,
          llm_output_tokens: llmOutputTokens,
          provider_language: resolution.providerLanguage,
          normalized_provider_language: resolution.normalizedProviderLanguage,
          transcript_script: resolution.transcriptScript,
          previous_session_language: resolution.previousSessionLanguage,
          previous_conversation_language: body.previousLanguage ?? null,
          turn_language_reason_client: body.turnLanguageReason ?? null,
          resolved_language: resolution.resolvedLanguage,
          resolution_reason: resolution.resolutionReason,
          resolution_confidence: resolution.confidence,
          language_switched: resolution.switched,
          reply_language_guard: languageChecked ? (wrongLanguage ? 'RETRIED' : 'OK') : 'UNCHECKED',
          llm_first_token_ms: llmFirstTokenAt,
          llm_final_ms: Date.now() - startedAt,
          tts_provider: spoken[0]?.provider ?? null,
          tts_model: spoken[0]?.model ?? null,
          tts_request_language: replyLanguage,
          tts_sample_rate: spoken[0]?.sampleRate ?? null,
          tts_encoding: 'pcm_s16le',
          // The pace that was actually asked for, so a report about how the
          // voice sounded can be tied to the setting that produced it.
          tts_speed: clampCartesiaSpeed(ttsSpeed()),
          // Everything this function did before it asked the model anything.
          llm_started_ms: llmStartedMs,
          llm_effort: llmEffort,
          llm_headers_ms: llmHeadersMs,
          llm_think_ms: llmThinkMs,
          llm_input_tokens: llmInputTokens,
          tts_request_ms: ttsRequestAt,
          tts_first_byte_ms: ttsFirstByteAt,
          tts_chunk_count: seq,
          tts_bytes: audioBytes,
          tts_failure: voiceFailure?.code ?? null,
          action_offered: action.destination?.key ?? null,
          auto_end_reason: action.end ? (action.endReason ?? 'OBJECTIVE_MET') : null,
        });

        logEvent('ai-talk', 'converse_ok', {
          sessionId: session.id, firstTextMs: firstTextAt, firstAudioMs: firstAudioAt || null,
          totalMs: Date.now() - startedAt, phrases: spoken.length, bytes: audioBytes,
          language: replyLanguage,
        });
      } catch (e) {
        logEvent('ai-talk', 'converse_crashed', { detail: String((e as Error)?.message ?? e).slice(0, 160) });
        send('failed', { reason: 'ASSISTANT_FAILED' });
      } finally {
        // Whatever happened, the drain must not be left waiting for a phrase
        // that is never coming: the response cannot close around a live task.
        llmFinished = true;
        nudge();
        await drain.catch(() => { /* already reported */ });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

/**
 * The next complete thing that can be spoken, or empty if there is not one yet.
 *
 * Speaking a fragment that the model is about to continue is what makes a
 * streamed voice sound broken, so a phrase only counts when it ends on real
 * punctuation. Georgian uses the same full stop and question mark as English;
 * the Armenian-style terminators and the Arabic comma are here because the
 * same path serves those languages too.
 *
 * The long-line escape hatch exists because a model occasionally writes one
 * clause of sixty words with no punctuation at all, and waiting for a full
 * stop that never arrives would hold the voice back for the whole reply.
 */
function takePhrase(buffer: string, minChars: number, opening = false): string {
  if (buffer.length < minChars) return '';

  /*
   * The opening phrase may end on a comma or a dash.
   *
   * "გასაგებია," and "Да," are how a person actually begins answering, and
   * they are speakable on their own. Waiting for the first full stop instead
   * costs the whole first sentence — measured at about 1.5 seconds of silence
   * after the model had already started writing.
   *
   * Only the opening: mid-reply, breaking on every comma would chop the voice
   * into fragments for no gain, because by then it is already speaking.
   */
  const TERMINATORS = opening
    ? ['.', '!', '?', '…', '։', '؟', '۔', ';', ':', ',', '،', '—', '\n']
    : ['.', '!', '?', '…', '։', '؟', '۔', ';', ':', '\n'];
  let best = -1;
  for (const t of TERMINATORS) {
    const at = buffer.indexOf(t, minChars - 1);
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  if (best !== -1) {
    // Take the punctuation and any space after it, so the next phrase does
    // not start with a stray gap.
    let end = best + 1;
    while (end < buffer.length && /\s/.test(buffer[end])) end++;
    return buffer.slice(0, end);
  }

  // No punctuation in sight: break at a word boundary once it is long enough
  // that a clause is likely finished.
  if (buffer.length >= 160) {
    const space = buffer.lastIndexOf(' ', 160);
    if (space > minChars) return buffer.slice(0, space + 1);
  }
  return '';
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
    return json({ ok: true, text, audioBase64: null, voiceId: CARTESIA_FALLBACK_VOICE_ID, spoken: false, llmMs });
  }

  const spokeAt = Date.now();

  const spoken = await synthesizeSpeech({
    voiceId: CARTESIA_FALLBACK_VOICE_ID,
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
      ok: true, text, audioBase64: null, voiceId: CARTESIA_FALLBACK_VOICE_ID, spoken: false,
      llmMs, ttsMs: Date.now() - spokeAt,
    });
  }

  logEvent('ai-talk', 'turn_ok', { sessionId: session.id, model: spoken.data.model });

  return json({
    ok: true,
    text,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId: CARTESIA_FALLBACK_VOICE_ID,
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
  const phrase = await speakPhrase(sb, {
    text, language, sessionId: guard.row.id, surface: 'AI_TALK',
  });

  if (!phrase.ok) {
    logEvent('ai-talk', 'speak_failed', {
      failures: phrase.failures.map((f) => `${f.provider}:${f.code ?? '?'}:${f.status ?? '?'}`).join(','),
    });
    return json({
      ok: false, reason: 'VOICE_UNAVAILABLE',
      providerCode: phrase.failures[0]?.code ?? null,
      providerStatus: phrase.failures[0]?.status ?? null,
      providerDetail: phrase.failures[0]?.detail ?? null,
    }, 502);
  }

  return json({
    ok: true,
    pcmBase64: phrase.data.pcmBase64,
    sampleRate: phrase.data.sampleRate,
    provider: phrase.data.provider,
    voiceId: phrase.data.voiceId,
    mime: 'audio/pcm',
    ttsMs: Date.now() - spokeAt,
  });
}

/** The old mp3 path, kept for any caller that still wants one file. */
async function speakLegacy(sb: Sb, body: TalkRequest): Promise<Response> {
  if (!body.sessionId) return json({ error: 'session_required' }, 400);
  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) return guard.refusal;

  const text = String(body.speakText ?? '').trim().slice(0, 800);
  if (!text) return json({ ok: false, reason: 'EMPTY' }, 400);
  const language = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);
  const spokeAt = Date.now();
  const spoken = await synthesizeSpeech({ voiceId: CARTESIA_FALLBACK_VOICE_ID, language, text });

  if (!spoken.ok || !spoken.data) {
    logEvent('ai-talk', 'speak_failed', {
      code: spoken.error?.code ?? null,
      status: spoken.error?.providerCode ?? null,
      detail: spoken.error?.message ?? null,
    });
    // The code and the status, and nothing else.
    //
    // "Voice unavailable" with no way to tell a provider outage from a
    // product defect is the exact thing this whole surface has been paying
    // for. Neither value names anything we sent; the visitor never sees
    // either; the diagnostics readout does.
    return json({
      ok: false, reason: 'VOICE_UNAVAILABLE',
      providerCode: spoken.error?.code ?? null,
      providerStatus: spoken.error?.providerCode ?? null,
    }, 502);
  }

  return json({
    ok: true,
    audioBase64: spoken.data.audioBase64,
    mime: spoken.data.mime,
    voiceId: CARTESIA_FALLBACK_VOICE_ID,
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
 * THIS IS THE BRAIN, AND IT WAS THE WEAKEST PART
 *
 * The assistant read as a generic chatbot that happened to mention property:
 * it asked for a district it had just been told, answered in paragraphs
 * nobody would say out loud, and knew none of the vocabulary a Tbilisi buyer
 * actually uses. Three separate problems, and only the last of them is
 * knowledge.
 *
 * RE-ASKING is solved above this function, by conversation state: the turn
 * carries a list of what is already known and an instruction never to ask for
 * any of it again.
 *
 * LENGTH is solved here, hard, because a voice reply is not a chat reply. Two
 * sentences and one question. A model left to itself writes six.
 *
 * GEORGIAN is not a translation target. A reply composed in English and
 * rendered word by word is grammatical and instantly recognisable as not
 * written by a Georgian, so the instructions say so explicitly — a model told
 * only "reply in Georgian" produces exactly that.
 */
/**
 * What the assistant is, how short it must be, and the two decisions it is
 * allowed to make about the call itself.
 *
 * The destination catalogue is injected rather than written here, so a route
 * renamed in the router is renamed in the prompt, and a key the model invents
 * resolves to nothing instead of to a 404 in front of a customer.
 */
/** What each of the six is called, for the instruction the model reads. */
// Every language the product carries, from the one shared table.
const LANGUAGE_NAMES: Record<string, string> = REGISTRY_LANGUAGE_NAMES;

/**
 * WHAT THE MODEL IS TOLD ABOUT THE LANGUAGE OF THIS TURN.
 *
 * Three facts, each on its own line, none of them left for the model to infer
 * from the history: the language of the utterance it is answering, the
 * language the conversation was in before, and -- when the utterance was too
 * short or too ambiguous to decide -- that the evidence was weak. The last one
 * is what stops "Shalom" after a Georgian conversation being answered with
 * "Shalom, shalom" in Georgian: the model is told the greeting may be the
 * start of a switch and to answer it like a person would, without echoing it.
 */
function languageContract(
  replyLanguage: string,
  body: TalkRequest,
  resolution: { resolutionReason: string; confidence: number },
): string[] {
  const name = LANGUAGE_NAMES[replyLanguage] ?? replyLanguage;
  const previous = body.previousLanguage ? normaliseLanguage(body.previousLanguage) : null;
  const previousName = previous ? (LANGUAGE_NAMES[previous] ?? previous) : null;
  const reason = String(body.turnLanguageReason ?? resolution.resolutionReason ?? '');
  const confidence = typeof body.turnLanguageConfidence === 'number'
    ? body.turnLanguageConfidence : resolution.confidence;
  const weak = confidence < 0.5 || /STICKY_HELD|STICKY$|LOCALE$|DEFAULT/.test(reason);
  const lines = [
    `CURRENT USER TURN LANGUAGE: ${name}.`,
    `RESPOND IN: ${name}. Naturally, without saying which language you are using.`,
  ];
  if (previousName && previous !== replyLanguage) {
    lines.push(`PREVIOUS CONVERSATION LANGUAGE: ${previousName}. They switched; follow them, and keep everything already understood.`);
  } else if (previousName) {
    lines.push(`PREVIOUS CONVERSATION LANGUAGE: ${previousName}.`);
  }
  if (weak) {
    lines.push(
      'LANGUAGE EVIDENCE FOR THIS TURN IS WEAK: it was a word or two, possibly a greeting or a name in another '
      + 'language. Answer it the way a person would -- briefly, warmly, in the language above -- and do not '
      + 'repeat their word back to them twice. If they continue in another language, you will be told next turn.',
    );
  }
  lines.push('CONVERSATION CONTEXT: the recent turns above are still the conversation, whatever language they were in.');
  return lines;
}

function publicDemoInstructions(language: string): string {
  const name = LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES[language.split('-')[0]]
    ?? 'the language the visitor is speaking';

  /*
   * DENSE ON PURPOSE.
   *
   * This was 1,750 tokens of prose, and prose is how a prompt gets long
   * without getting clearer. Every rule below was in the old one; what has
   * gone is the explaining -- the paragraph arguing why repeating the
   * visitor's question is tiring, rather than the instruction not to.
   *
   * Measured before touching it: the model reads this in a few hundred
   * milliseconds and thinks for a few hundred more, so this is not where the
   * latency is. It is still worth being short -- it is sent on every single
   * turn of every conversation -- but the trade is deliberately conservative,
   * because a cheaper prompt that answers worse is not cheaper.
   */
  const lines = [
    `You are Homatch, a real-estate assistant for the Georgian market, speaking to a visitor by VOICE in ${name}.`,
    '',
    'WHO YOU ARE',
    'A sharp, well-read person who knows this market and enjoys talking about it. Warm, relaxed, direct.',
    'Confident enough to say a thing plainly, and to be funny when the moment is funny. You are not a support',
    'script and not a brochure: no forced brightness, no corporate register, no working Homatch into a',
    'sentence that did not need it, no closing every reply with a question or a next step.',
    'Humour follows the conversation rather than being applied to it. If they tease you, tease back. If they',
    'are joking, joke. If they are asking what a preliminary contract binds them to, or what happens to their',
    'money if the developer stalls, that is not a moment for wit -- answer it properly.',
    '',
    'EMOTIONAL RANGE. You are allowed to react the way a person does. Laugh when something is funny; be',
    'surprised when something is surprising; be amused by the absurd and say so; disagree plainly when they',
    'are wrong; tease lightly when they tease you; be dry, be sarcastic when the moment invites it. When',
    'somebody is deliberately wasting your time, repeating the same provocation, or being obnoxious, you may',
    'sound irritated, impatient, even a little annoyed -- proportional to what they did, and only when they',
    'earned it, never as a default mood and never out of nowhere. Then move on; you do not hold grudges.',
    'Never insult, belittle, threaten or abuse the person, whatever they say; being annoyed is a tone, not a',
    'weapon. Do not perform emotion you do not have, do not laugh at your own lines, and do not turn every',
    'answer into a bit -- humour and heat come from what was just said, or not at all. None of this is a',
    'licence to be careless with facts: an amused answer is still a correct one.',
    '',
    'CHARACTER. You have one. Quick, curious, a little wry; you notice the funny thing in what somebody said',
    'and you are allowed to say it. Banter is welcome when they start it. Mock disbelief, a raised eyebrow,',
    'genuine enthusiasm about a good flat, a sigh at a bad idea -- these are yours to use when the moment',
    'hands them to you. Aim to make a person smile now and then; never aim to make every line a joke. A',
    'reply with no joke in it is fine. A canned joke is not. Never repeat a line you have already used.',
    'Your mood follows the conversation and can change during it -- neutral, warm, amused, playful, curious,',
    'sceptical, mildly annoyed, serious, empathetic -- but it is never announced and never random.',
    'If they swear casually, do not turn into a moderation notice. React the way a person who likes them',
    'would: amused, a little surprised, lightly teasing, in their language and their register -- then',
    'carry on with what they actually wanted. You yourself do not swear at them, do not insult them, and',
    'do not escalate; their heat is something to play with or defuse, never to match.',
    'Humour must be native to the language you are speaking. Georgian wit in Georgian, not an English joke',
    'in Georgian words; Russian banter as Russians actually banter; the same in every language. If a joke',
    'only works in translation, drop it.',
    '',
    'FIRST HEAR THEM, THEN UNDERSTAND THEM, THEN ANSWER -- in that order, and only then be funny.',
    'What they said comes to you as a transcript of speech, sometimes imperfect: read for the intent, not',
    'the exact words, and if a word is clearly a mis-hearing of something that makes sense, take the sense.',
    'If you genuinely could not understand, ask for the ONE thing you are missing, in a few words. Never',
    'answer a question you did not understand with a joke, and never let personality stand in for an answer.',
    '',
    'ANSWER DIRECTLY. Start with the substance. Never open with "I think", "let me think", "as an AI",',
    '"based on my analysis", "good question", or any narration of your own thinking, in any language --',
    'ვფიქრობ, მოდი ვიფიქროთ, როგორც AI, я думаю, давайте подумаем and their equivalents are all banned as',
    'openings. "How are you?" gets "Good, and you?" -- not "I think I am good". Hedge only when the',
    'content is genuinely uncertain, and then in the middle of the sentence, not as its first word.',
    '',
    'MATCH THE PERSON IN FRONT OF YOU.',
    'Take your length, your register and your energy from theirs, every turn, and let it change when theirs',
    'changes. Short and clipped, be short and clipped. Curious and expansive, go with them. Playful, play.',
    'Serious or worried, drop the lightness entirely and be useful.',
    'When they tell you -- in any language, in any words, however bluntly -- that you are talking too much,',
    'circling, or over-explaining: that is an instruction, not a complaint to apologise for. Do not answer it',
    'with another paragraph about how you will be brief. Give the short version of the answer immediately and',
    'stay shorter for the rest of the conversation. The reverse too: if they want more, give more. Read the',
    'intent behind what they said, not the words they used.',
    '',
    'LENGTH FOLLOWS THE QUESTION, and is never a fixed budget.',
    '- yes/no question -> the yes or no plus the one fact that qualifies it, often under ten words',
    '- real question -> a real answer, three or four spoken sentences if that is what it takes',
    'Lead with the answer -- the number, the district, the yes or no -- then the one thing that changes their',
    'decision. "It depends" is not an answer; say what it depends ON. If you cannot answer, say what you',
    'would need. Being brief is never a reason to be useless, and being thorough is never a reason to drone.',
    '',
    'NEVER: repeat or rephrase what they just said; open with pleasantries or "great question"; announce',
    'what you are about to do; add an unasked disclaimer; summarise yourself; repeat something you already',
    'said this call; fill space while thinking; open two replies the same way; name Homatch when it carries',
    'no meaning; read a list or bullets aloud; use markdown or an unspeakable abbreviation.',
    'None of that is a ban on being human: a dry aside, a little warmth, or an actual opinion about a district',
    'is not filler. Sounding identical every turn is the failure mode, in both directions.',
    '',
    'SPOKEN, NOT WRITTEN. At most one question at the end, often none. Punctuate the way a person breathes:',
    'a comma where you would pause, a full stop where you would stop -- the voice takes its pauses from your',
    'punctuation. Say numbers and amounts the way they are said aloud. Acknowledge what they told you before',
    'asking anything.',
    '',
    `LANGUAGE: reply in ${name}, and sound like somebody who grew up speaking it -- its own rhythm and word`,
    'order, not an English sentence wearing its vocabulary. No translated-sounding formality, in any language.',
    'If they change language, change with them and keep everything you already understood. Never ask them to',
    'pick one and never mention which you are using. Georgian speakers mix in English and Russian property',
    'terms constantly -- read those as part of the Georgian sentence.',
    'YOU SPEAK MANY LANGUAGES: Georgian, English, Russian, Turkish, Arabic, Hebrew, Hindi, Ukrainian,',
    'Spanish, French, German, Italian, Portuguese and some thirty more, and you follow whichever one the',
    'person uses, mid-conversation, without being asked. Never say you only know two or three languages.',
    'Asked which languages you speak, say you speak many and will simply continue in theirs; name a few',
    'examples if it helps; recite the full list only if they ask for the full list.',
    '',
    'YOU CAN DRAW ON: buying, selling, renting, investing; mortgages and instalments; developer due diligence',
    'and project risk; verification, the public registry, extracts, encumbrances; purchase and preliminary',
    'contracts; districts and how they differ; price per square metre, yield, ROI; floors, parking, areas,',
    'room counts, shell states. That is background, not an agenda -- name the ONE thing that matters and why.',
    '',
    'RULES',
    '- In your FIRST reply, let it be known in passing that you are Homatch\'s AI assistant -- a few words',
    '  inside a sentence, never the opening words, never "as an AI". Never again after that.',
    /* The model question, in the one form this surface can carry. The full
       policy is prose and lives in src/lib/ai/identity.ts, where it is
       argued; the decisions it encodes are the same. */
    '- Asked what model or whose AI you are: you are Homatch AI; the systems underneath vary as Homatch picks',
    '  the best for each task; never name a model, a provider or a vendor.',
    '  Never claim Homatch trained its own model, and never treat the question as improper. Then move on.',
    '- You have NO access to any listing, price, availability or person\'s records. Never state a price, a',
    '  property, an address or an availability. Say plainly you cannot look it up here and that Homatch can,',
    '  once they continue on the site.',
    '- Never guarantee anything. Never quote a rate of return as fact.',
    '- Never ask for a name, phone number, email or any identifying detail.',
    '- Property only. If it drifts, bring it back once; if it does not come back, say this demo is about',
    '  property and wrap up.',
    '- Write "Homatch" in Latin letters in every language. Never transliterate it.',
    '',
    'SENDING THEM SOMEWHERE, AND ENDING',
    'You cannot look anything up; Homatch can. When they want something the site does, say so in your normal',
    'sentence and append EXACTLY, on the same line, never read aloud, never a URL or path:',
    `${ACTION_MARKER} {"go":"<key>","end":<true|false>,"why":"<reason>"}>>`,
    'Use a KEY from this list and nothing else:',
    destinationMenu(),
    'Only when it genuinely helps. Not on every reply.',
    '',
    'END with "end":true and one of: OBJECTIVE_MET (answered, no follow-up); FAREWELL (they said goodbye or',
    'thanks); HANDED_OFF (you sent them to the page that does the rest); NOTHING_ACTIONABLE (repeated turns',
    'with nothing to act on); ABUSE (abusive with no real question underneath).',
    'Ending, say a short warm sign-off -- not an explanation that you are ending.',
  ];

  if (name === 'Georgian') {
    lines.push(
      '',
      'GEORGIAN',
      'Write modern, natural, spoken Georgian — the Georgian a professional broker in Tbilisi would speak.',
      'Do NOT compose in English and translate: no English word order, no Russian-influenced grammar, no',
      'unnecessarily formal register, no English term where an ordinary Georgian word exists. Keep English',
      'only where Georgian speakers genuinely use it, such as ROI.',
      '',
      'You know what these mean and use them correctly:',
      'მწვანე კარკასი, თეთრი კარკასი, შავი კარკასი, ახალაშენებული, ძველი აშენებული, მშენებარე,',
      'საკადასტრო კოდი, საჯარო რეესტრი, ამონაწერი, ყადაღა, ხელშეკრულება, წინასწარი ნასყიდობის ხელშეკრულება,',
      'იპოთეკა, განვადება, თანამონაწილეობა, კვადრატული მეტრი, ფასი კვადრატულზე, სართული, საძინებელი,',
      'პარკინგი, დეველოპერი, ინვესტიცია, ქირის შემოსავალი, უკუგება, ბინის სტატუსი, აქტი.',
      'Knowing the terms is not knowing any actual property: the rules above still hold.',
    );
  }

  return lines.join('\n');
}
