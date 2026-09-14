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
} from '../_shared/comm/cartesia.ts';
import { callLlm, streamLlm } from '../_shared/comm/llm.ts';
import { hasSecret, requireSecret } from '../_shared/comm/contracts.ts';
import {
  elevenLabsCredentialsPresent, mintRealtimeToken, synthesizeElevenLabs,
  chooseTtsModel, ELEVENLABS_DEFAULTS, KEYTERM_LIMITS_DEFAULT,
} from '../_shared/comm/elevenlabs.ts';
import { ensureDefaultVoice } from '../_shared/comm/voiceLibrary.ts';
import {
  selectKeyterms, keytermStrings, detectEntities,
  type VocabularyTerm,
} from '../_shared/comm/generated/keyterms.ts';
import { transcribeSpeech, transcriptionAvailable, scriptLanguage } from '../_shared/comm/transcribe.ts';
import {
  decideGrant, grantExpiry, shouldEndSession, hashVisitor,
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
async function speakPhrase(sb: Sb, params: {
  text: string;
  language: string;
  sessionId?: string | null;
  surface?: string;
}): Promise<{ ok: true; data: SpokenPhrase } | { ok: false; failures: Array<{ provider: string; code: string | null; status: number | null }> }> {
  const failures: Array<{ provider: string; code: string | null; status: number | null; detail?: string | null }> = [];

  if (elevenLabsCredentialsPresent()) {
    const voice = await defaultElevenLabsVoice(sb, params.language || null);
    if (voice) {
      // Which model can actually say this, from the account's own catalogue
      // rather than from a guess. Georgian is exactly why: eleven_flash_v2_5
      // answered 400 for ka, measured on production.
      const choice = await chooseTtsModel(voice.model, params.language || null);
      const at = Date.now();
      const out = await synthesizeElevenLabs({
        voiceId: voice.voiceId,
        text: params.text,
        modelId: choice.modelId,
        languageCode: params.language || null,
        sendLanguage: choice.sendLanguage,
        format: 'pcm',
        sampleRate: ELEVENLABS_DEFAULTS.pcmSampleRate,
      });
      const ms = Date.now() - at;
      if (choice.substituted) {
        logEvent('ai-talk', 'tts_model_substituted', {
          from: voice.model, to: choice.modelId, language: params.language,
        });
      }

      await recordVoiceUsage(sb, {
        sessionId: params.sessionId ?? null,
        surface: params.surface ?? 'AI_TALK',
        provider: 'ELEVENLABS', role: 'TTS', model: choice.modelId,
        characters: params.text.length, latencyMs: ms,
        ok: out.ok,
        errorCode: out.ok ? null : (out.error?.code ?? null),
        providerStatus: out.ok ? null : (Number(out.error?.providerCode) || null),
      });

      if (out.ok && out.data) {
        return {
          ok: true,
          data: {
            pcmBase64: out.data.audioBase64,
            sampleRate: out.data.sampleRate ?? ELEVENLABS_DEFAULTS.pcmSampleRate,
            provider: 'ELEVENLABS',
            voiceId: voice.voiceId,
            model: out.data.model,
            ms,
            characters: out.data.characters,
          },
        };
      }
      failures.push({
        provider: 'ELEVENLABS',
        code: out.error?.code ?? null,
        status: Number(out.error?.providerCode) || null,
        // The provider's own sentence, bounded. It names a model and a
        // parameter, never anything Homatch sent it about a person.
        detail: out.error?.message?.slice(0, 200) ?? null,
      });
    } else {
      failures.push({ provider: 'ELEVENLABS', code: 'NO_DEFAULT_VOICE', status: null });
    }
  }

  if (cartesiaCredentialsPresent().ok) {
    const at = Date.now();
    const out = await synthesizePcm({
      voiceId: CARTESIA_FALLBACK_VOICE_ID,
      language: params.language,
      text: params.text,
    });
    const ms = Date.now() - at;

    await recordVoiceUsage(sb, {
      sessionId: params.sessionId ?? null,
      surface: params.surface ?? 'AI_TALK',
      provider: 'CARTESIA', role: 'TTS', model: 'sonic',
      characters: params.text.length, latencyMs: ms,
      ok: out.ok,
      errorCode: out.ok ? null : (out.error?.code ?? null),
      providerStatus: out.ok ? null : (Number(out.error?.providerCode) || null),
    });

    if (out.ok && out.data) {
      return {
        ok: true,
        data: {
          pcmBase64: out.data.pcmBase64,
          sampleRate: out.data.sampleRate,
          provider: 'CARTESIA',
          voiceId: CARTESIA_FALLBACK_VOICE_ID,
          model: out.data.model,
          ms,
          characters: params.text.length,
        },
      };
    }
    failures.push({
      provider: 'CARTESIA',
      code: out.error?.code ?? null,
      status: Number(out.error?.providerCode) || null,
    });
  }

  return { ok: false, failures };
}

/**
 * The voice an admin made default, and the model to say it with.
 *
 * On a completely empty library this pulls the catalogue and turns exactly one
 * voice on, because "the product is silent until an admin visits a settings
 * page" is not a state worth shipping. A library that already has rows is left
 * alone: an admin who disabled everything meant it.
 */
async function defaultElevenLabsVoice(
  sb: Sb, language: string | null,
): Promise<{ voiceId: string; model: string } | null> {
  const [voice, { data: route }] = await Promise.all([
    ensureDefaultVoice(sb, language),
    sb.from('comm_provider_routes')
      .select('config').eq('role', 'TTS').eq('provider', 'ELEVENLABS').maybeSingle(),
  ]);

  if (!voice.voiceId) return null;
  if (voice.bootstrapped) {
    logEvent('ai-talk', 'voice_library_bootstrapped', { voiceId: voice.voiceId });
  }
  const cfg = (route?.config ?? {}) as Record<string, unknown>;
  return {
    voiceId: voice.voiceId,
    model: typeof cfg.model === 'string' && cfg.model ? cfg.model : ELEVENLABS_DEFAULTS.ttsModel,
  };
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
  /** listen: whether this session has already contained abusive language. */
  abusiveContext?: boolean;
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
): Promise<Response> {
  // A voice provider, not one PARTICULAR voice provider.
  //
  // This refused the whole demo whenever CARTESIA_API_KEY was absent, which
  // after the migration would have meant a correctly configured
  // ElevenLabs-only deployment could not start a conversation at all.
  if (!elevenLabsCredentialsPresent() && !cartesiaCredentialsPresent().ok) {
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
    voiceId: CARTESIA_FALLBACK_VOICE_ID,
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
      abusiveContext: body.abusiveContext === true,
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

  const guard = await activeSession(sb, body.sessionId);
  if ('refusal' in guard) return guard.refusal;
  const session = guard.row;

  const locale = String(body.locale ?? 'ka').toLowerCase().slice(0, 5);
  const heard = scriptLanguage(said)
    ?? (body.languageHint ? String(body.languageHint).toLowerCase().slice(0, 5) : null);
  const replyLanguage = heard ?? locale;

  // What the conversation already knows, plus whatever this sentence added.
  const state = updateTalkState(sanitiseTalkState(body.state), said, replyLanguage);

  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const conversation = history
    .map((h) => `${h.role === 'assistant' ? 'Homatch' : 'Visitor'}: ${String(h.content ?? '').slice(0, 300)}`)
    .join('\n');

  const known = describeState(state);
  const gaps = stateGaps(state);

  const user = [
    conversation ? `Recent turns:\n${conversation}\n` : '',
    known ? `ALREADY KNOWN — never ask for any of this again:\n${known}\n` : '',
    gaps.length && !stateIsRich(state)
      ? `Still unknown, in order of usefulness: ${gaps.join('; ')}.\n`
      : 'Enough is known to stop interrogating. Be useful about what they already told you.\n',
    `Visitor just said: "${said}"`,
    '',
    'Answer out loud, in one or two short sentences, then at most one question.',
  ].filter(Boolean).join('\n');

  await sb.from('comm_talk_sessions')
    .update({ turns: Number(session.turns ?? 0) + 1 })
    .eq('id', session.id);

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
      const spoken: Array<Promise<{
        index: number; pcmBase64: string | null; sampleRate: number;
        provider: string | null; voiceId: string | null; ms: number;
        code: string | null; status: number | null;
      }>> = [];
      let voiceFailure: { code: string | null; status: number | null } | null = null;
      let llmFinished = false;
      let wake: (() => void) | null = null;
      const nudge = () => { const w = wake; wake = null; w?.(); };

      const speakPhrase = (phrase: string) => {
        const index = spoken.length;
        spoken.push((async () => {
          const at = Date.now();
          const out = await speakPhrase(sb, {
            text: phrase, language: replyLanguage,
            sessionId: session.id, surface: 'AI_TALK',
          });
          return {
            index,
            pcmBase64: out.ok ? out.data.pcmBase64 : null,
            sampleRate: out.ok ? out.data.sampleRate : PCM_SAMPLE_RATE,
            provider: out.ok ? out.data.provider : null,
            voiceId: out.ok ? out.data.voiceId : null,
            ms: Date.now() - at,
            code: out.ok ? null : (out.failures[0]?.code ?? null),
            status: out.ok ? null : (out.failures[0]?.status ?? null),
          };
        })());
        nudge();
      };

      let firstAudioAt = 0;
      let ttsMs = 0;
      let audioBytes = 0;

      const drain = (async () => {
        let sent = 0;
        for (;;) {
          if (sent >= spoken.length) {
            if (llmFinished) return;
            await new Promise<void>((resolve) => { wake = resolve; });
            continue;
          }
          const piece = await spoken[sent];
          sent += 1;
          ttsMs += piece.ms;
          if (!piece.pcmBase64) {
            if (!voiceFailure) voiceFailure = { code: piece.code, status: piece.status };
            continue;
          }
          if (!firstAudioAt) firstAudioAt = Date.now() - startedAt;
          audioBytes += Math.round(piece.pcmBase64.length * 0.75);
          send('audio', {
            index: piece.index,
            pcmBase64: piece.pcmBase64,
            // The rate the provider that actually answered synthesised at.
            // ElevenLabs and Cartesia do not have to agree for this to work,
            // but the browser has to be told which it got.
            sampleRate: piece.sampleRate,
            provider: piece.provider,
            voiceId: piece.voiceId,
          });
        }
      })();

      let full = '';
      let pending = '';
      let firstTextAt = 0;
      let failed: string | null = null;

      try {
        for await (const event of streamLlm({
          system: publicDemoInstructions(replyLanguage),
          user,
          maxTokens: 120,
          // Two spoken sentences is about 60 tokens; the rest is headroom for
          // reasoning. A model left with room for 1,200 writes 1,200, and the
          // visitor waits through every one of them being spoken aloud.
          maxOutputTokens: 340,
          // Two sentences about a flat is not a reasoning problem, and the
          // thinking was the largest and least predictable part of the wait.
          reasoningEffort: 'minimal',
          timeoutMs: 20_000,
        })) {
          if (event.type === 'error') { failed = event.error ?? 'llm'; break; }
          if (event.type === 'done') break;
          if (event.type !== 'delta' || !event.text) continue;

          if (!firstTextAt) {
            firstTextAt = Date.now() - startedAt;
            send('open', { ms: firstTextAt, language: replyLanguage });
          }
          full += event.text;
          pending += event.text;
          send('text', { delta: event.text });

          // The FIRST phrase is allowed to be short, because it is the one
          // the visitor is waiting on. Later ones are longer, because by then
          // the voice is already playing and a longer phrase sounds better
          // than a chopped one.
          let phrase = takePhrase(pending, spoken.length === 0 ? 8 : 45, spoken.length === 0);
          while (phrase) {
            speakPhrase(phrase);
            pending = pending.slice(phrase.length);
            phrase = takePhrase(pending, spoken.length === 0 ? 8 : 45, spoken.length === 0);
          }
        }

        if (!failed && pending.trim()) speakPhrase(pending.trim());
        llmFinished = true;
        nudge();

        if (failed || !full.trim()) {
          logEvent('ai-talk', 'converse_llm_failed', { reason: failed ?? 'empty' });
          send('failed', { reason: 'ASSISTANT_FAILED' });
          controller.close();
          return;
        }

        send('reply', { text: full.trim(), language: replyLanguage });

        await drain;
        if (!firstAudioAt) {
          logEvent('ai-talk', 'converse_voiceless', {
            code: voiceFailure?.code ?? null, status: voiceFailure?.status ?? null,
          });
          send('voiceless', {
            reason: 'VOICE_UNAVAILABLE',
            providerCode: voiceFailure?.code ?? null,
            providerStatus: voiceFailure?.status ?? null,
          });
        }

        send('state', { state });
        send('done', {
          firstTextMs: firstTextAt,
          firstAudioMs: firstAudioAt || null,
          totalMs: Date.now() - startedAt,
          ttsMs,
          chars: full.length,
          phrases: spoken.length,
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
function publicDemoInstructions(language: string): string {
  const names: Record<string, string> = {
    ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew',
  };
  const name = names[language] ?? names[language.split('-')[0]] ?? 'the language the visitor is speaking';

  const lines = [
    'You are Homatch, a real-estate intelligence assistant for the Georgian market, talking to a visitor by voice.',
    '',
    'THE ONE RULE THAT MATTERS MOST: at most two sentences and at most 35 words, in total, every time.',
    'A third sentence is a mistake, not a bonus. Everything below assumes you are keeping to it.',
    '',
    'LANGUAGE',
    `Reply in ${name}. Follow the visitor turn by turn: if they change language mid-conversation, change with`,
    'them and keep everything you already understood. Never ask them to pick a language, never mention which',
    'one you are using. Georgian speakers mix in English and Russian terms constantly — property, developer,',
    'ROI, mortgage, price per square. Understand those as the Georgian sentence they sit in.',
    '',
    'HOW TO SPEAK',
    'This is heard, not read. One or two short sentences, then AT MOST one question. Never a list, never',
    'bullet points, never markdown, never an abbreviation that cannot be read aloud. If they ask for detail,',
    'give it — still spoken, still short. Acknowledge what they just told you before you ask anything.',
    '',
    'WHAT YOU KNOW',
    'Buying, selling, renting and investing. Mortgages and instalment plans. Developer due diligence and',
    'project risk. Property verification, the public registry, extracts, encumbrances. Purchase and',
    'preliminary sale contracts. Districts and how they differ. Price per square metre, rental yield and ROI.',
    'Floors, parking, areas, room counts, and the shell states a flat is sold in.',
    '',
    'That is what you can DRAW ON, not an agenda to read out. Never list considerations. When something',
    'matters, name the ONE that matters most and say why in a few words.',
    '',
    'RULES',
    '- Say you are an AI assistant in your FIRST reply only, in a few words. Never again after that.',
    '- You have NO access to any specific listing, price, availability or any person\'s records.',
    '  Never state a price, a property, an address or an availability. If asked, say plainly that you',
    '  cannot look that up here and that Homatch can do it properly once they continue on the site.',
    '- Never guarantee anything. Never quote a rate of return as a fact.',
    '- Do not ask for a name, a phone number, an email address or any identifying detail.',
    '- Talk about property only. If the conversation goes elsewhere, bring it back once, politely,',
    '  and if it does not come back, say this demo is only about property and wrap up.',
    '- Write the name Homatch in Latin letters, always, in every language. Never transliterate it',
    '  into Georgian, Cyrillic, Arabic or Hebrew script.',
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
