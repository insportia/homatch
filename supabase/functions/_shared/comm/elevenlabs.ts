// HOMATCH — ElevenLabs, the primary voice provider.
//
// WHY THIS EXISTS AND WHAT IT REPLACES
//
// Cartesia was primary for both halves of voice and failed at both, for
// different reasons, both measured against production:
//
//   STT   it will not write Georgian. Asked for language=ka, ink-whisper
//         accepted the socket and dropped it at ~5s with close code 1006 and
//         no error frame; ink-2 answered language_not_supported; left to
//         itself it wrote Georgian in Latin letters.
//   TTS   HTTP 402. The account ran out of credit, and every synthesis in
//         every language stopped, with nothing in the product able to say why.
//
// Homatch is a global product with Georgia as its hardest case, so the voice
// provider has to be one that handles both. This module is the whole of the
// ElevenLabs surface Homatch uses, and it is deliberately shaped like
// cartesia.ts so the existing provider plumbing — ProviderResult, the route
// table, the health page — takes it without a second architecture.
//
// WHAT THIS FILE NEVER DOES
//
// It never returns, logs or embeds ELEVENLABS_API_KEY. The browser is handed
// either audio bytes or a SINGLE-USE realtime token minted here, never the
// key. Nothing here logs a transcript: what somebody said is theirs.

import { hasSecret, requireSecret, type ProviderResult } from './contracts.ts';

const API = 'https://api.elevenlabs.io';

/**
 * Defaults, not constants.
 *
 * Every one of these is overridable from the provider route config, because
 * §21 makes the model an admin-configurable abstraction and because a model
 * id baked into application logic is how a provider's roadmap becomes an
 * outage. They are the values to start from, not the values forever.
 */
export const ELEVENLABS_DEFAULTS = {
  ttsModel: 'eleven_flash_v2_5',
  sttModel: 'scribe_v2_realtime',
  /** What streamed playback is synthesised at. Raw PCM joins without a seam. */
  pcmSampleRate: 24_000,
  /** What the microphone is streamed to the realtime socket at. */
  sttSampleRate: 16_000,
} as const;

/**
 * Provider limits, as configuration rather than as fact.
 *
 * The handoff pack states 50 keyterms at 20 characters. That was true when it
 * was written and ElevenLabs has since raised keyterm capacity, so treating
 * either number as a constant would either waste the allowance or break the
 * day it moves again. The selector reads these; an admin can change them
 * without a deploy; and nothing in the ranking logic assumes a particular
 * value.
 */
export const KEYTERM_LIMITS_DEFAULT = {
  maxTerms: 50,
  maxCharsPerTerm: 20,
} as const;

export function elevenLabsCredentialsPresent(): boolean {
  return hasSecret('ELEVENLABS_API_KEY');
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'xi-api-key': requireSecret('ELEVENLABS_API_KEY'), ...extra };
}

/**
 * One provider status, in the vocabulary the Admin page speaks.
 *
 * MISSING and AUTH_FAILED are deliberately different answers: one is an owner
 * action in the Supabase dashboard, the other is a key that exists and is
 * wrong, and telling an owner to "check the key is set" when it is set has
 * wasted more time on this product than any other single message.
 */
export type ElevenLabsStatus =
  | 'MISSING' | 'AUTH_FAILED' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED'
  | 'PROVIDER_ERROR' | 'HEALTHY';

export interface ElevenLabsHealth {
  status: ElevenLabsStatus;
  /** Counts and capabilities. Never a key, never a customer's audio. */
  voiceCount: number | null;
  modelCount: number | null;
  /** Whether the account can reach each surface Homatch actually uses. */
  canListVoices: boolean;
  canListModels: boolean;
  canSynthesise: boolean;
  canMintRealtimeToken: boolean;
  canUsePronunciationDictionaries: boolean;
  /** Remaining character allowance, when the account reports one. */
  charactersRemaining: number | null;
  charactersLimit: number | null;
  tier: string | null;
  latencyMs: number | null;
  /** A short, bounded provider message for an admin. Never shown to a visitor. */
  detail: string | null;
  providerStatus: number | null;
}

/** The provider's own reason, bounded, or nothing. Never anything we sent. */
function providerReason(body: string): string {
  let detail = '';
  try {
    const j = JSON.parse(body) as { detail?: { message?: string; status?: string } | string };
    const d = j?.detail;
    detail = typeof d === 'string' ? d : [d?.status, d?.message].filter(Boolean).join(': ');
  } catch {
    detail = body.slice(0, 200);
  }
  return detail ? ` — ${detail.slice(0, 200)}` : '';
}

export function classifyElevenLabs(status: number, body: string): ProviderResult<never>['error'] {
  if (status === 401 || status === 403) {
    /*
     * WHICH auth problem, because they need opposite actions.
     *
     * "the provider rejected our credentials" was all this said, and it is
     * wrong often enough to be misleading: the same 401 is returned when the
     * key is fine and the VOICE is not available to this subscription. Both
     * Georgian-labelled cloned voices on this account answer 401 in the same
     * batch where a stock voice on the same key succeeds -- which is not a
     * credential problem at all, and somebody reading "rejected our
     * credentials" would go and rotate a working key.
     *
     * The provider's own reason is appended. It is an error status string,
     * never anything we sent, so nothing about the key travels with it.
     */
    return {
      code: 'AUTH',
      message: `the provider refused this call (${status})${providerReason(body)}`,
      retryable: false,
      providerCode: status,
    };
  }
  // 402 is the one Cartesia taught us to name: the credential is valid and
  // the account cannot pay. "Unavailable" for that costs hours.
  if (status === 402) {
    return { code: 'POLICY', message: 'the provider account is out of credit', retryable: false, providerCode: status };
  }
  if (status === 429) {
    return { code: 'RATE_LIMIT', message: 'the provider is rate limiting us', retryable: true, providerCode: status };
  }
  if (status >= 500) {
    return { code: 'TRANSIENT', message: `provider returned ${status}`, retryable: true, providerCode: status };
  }
  let detail = '';
  try {
    const j = JSON.parse(body) as { detail?: { message?: string; status?: string } | string };
    const d = j?.detail;
    detail = typeof d === 'string' ? d : [d?.status, d?.message].filter(Boolean).join(': ');
  } catch { detail = body.slice(0, 200); }
  return {
    code: 'UNKNOWN',
    message: `provider returned ${status}${detail ? ` — ${detail.slice(0, 240)}` : ''}`,
    retryable: false,
    providerCode: status,
  };
}

async function call(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string; json: unknown; bytes?: Uint8Array; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  const started = Date.now();
  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: headers(init.headers),
      body: init.body,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, text, json, latencyMs: Date.now() - started };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, status: aborted ? 0 : -1,
      text: aborted ? 'timeout' : String((e as Error)?.message ?? e).slice(0, 200),
      json: null, latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the account actually usable, and for which of the things Homatch needs?
 *
 * Every probe here is a GET that generates nothing and costs nothing —
 * except the synthesis capability check, which is deliberately NOT performed
 * by synthesising. Voice listing succeeding with a valid key is what tells us
 * the TTS surface is reachable; a real synthesis is what the Admin preview
 * button is for, where a person asked for it.
 */
export async function checkElevenLabs(): Promise<ElevenLabsHealth> {
  const empty: ElevenLabsHealth = {
    status: 'MISSING', voiceCount: null, modelCount: null,
    canListVoices: false, canListModels: false, canSynthesise: false,
    canMintRealtimeToken: false, canUsePronunciationDictionaries: false,
    charactersRemaining: null, charactersLimit: null, tier: null,
    latencyMs: null, detail: null, providerStatus: null,
  };
  if (!elevenLabsCredentialsPresent()) return empty;

  const voices = await call('/v1/voices?page_size=1', { timeoutMs: 10_000 });
  if (!voices.ok) {
    const error = classifyElevenLabs(voices.status, voices.text);
    return {
      ...empty,
      status: error?.code === 'AUTH' ? 'AUTH_FAILED'
        : error?.code === 'POLICY' ? 'QUOTA_EXHAUSTED'
          : error?.code === 'RATE_LIMIT' ? 'RATE_LIMITED'
            : 'PROVIDER_ERROR',
      latencyMs: voices.latencyMs,
      detail: error?.message ?? null,
      providerStatus: voices.status,
    };
  }

  const [models, subscription, dictionaries] = await Promise.all([
    call('/v1/models', { timeoutMs: 10_000 }),
    call('/v1/user/subscription', { timeoutMs: 10_000 }),
    call('/v1/pronunciation-dictionaries?page_size=1', { timeoutMs: 10_000 }),
  ]);

  const sub = subscription.json as {
    character_count?: number; character_limit?: number; tier?: string;
  } | null;

  const voiceBody = voices.json as { voices?: unknown[] } | null;
  const modelBody = models.json as unknown[] | null;

  const remaining = sub && typeof sub.character_limit === 'number'
    ? Math.max(0, sub.character_limit - (sub.character_count ?? 0))
    : null;

  return {
    // Reachable and paid up. Whether a specific voice works is a different
    // question and is answered by using it.
    status: remaining === 0 ? 'QUOTA_EXHAUSTED' : 'HEALTHY',
    voiceCount: Array.isArray(voiceBody?.voices) ? voiceBody.voices.length : null,
    modelCount: Array.isArray(modelBody) ? modelBody.length : null,
    canListVoices: true,
    canListModels: models.ok,
    canSynthesise: true,
    canMintRealtimeToken: false,   // decided by mintRealtimeToken, which tries
    canUsePronunciationDictionaries: dictionaries.ok,
    charactersRemaining: remaining,
    charactersLimit: typeof sub?.character_limit === 'number' ? sub.character_limit : null,
    tier: typeof sub?.tier === 'string' ? sub.tier : null,
    latencyMs: voices.latencyMs,
    detail: null,
    providerStatus: voices.status,
  };
}

// ── Voice library ───────────────────────────────────────────────────────────

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string | null;
  /** Only metadata the provider actually returns. Nothing is invented. */
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
  languages: string[];
}

/**
 * Every voice this account can actually use.
 *
 * Paged, because an account with a large library would otherwise be
 * silently truncated to the first page — and a voice a customer selected
 * yesterday vanishing from the picker today is indistinguishable from a bug.
 */
export async function listElevenLabsVoices(
  limit = 300,
): Promise<ProviderResult<{ voices: ElevenLabsVoice[] }>> {
  const out: ElevenLabsVoice[] = [];
  let nextToken: string | null = null;
  const started = Date.now();

  for (let page = 0; page < 10 && out.length < limit; page++) {
    const query = new URLSearchParams({ page_size: '100' });
    if (nextToken) query.set('next_page_token', nextToken);
    const res = await call(`/v2/voices?${query}`, { timeoutMs: 15_000 });

    // v2 is the paged surface; an account or plan without it falls back to v1,
    // which returns everything at once.
    if (res.status === 404 || res.status === 405) {
      const legacy = await call('/v1/voices', { timeoutMs: 15_000 });
      if (!legacy.ok) {
        return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(legacy.status, legacy.text) };
      }
      const body = legacy.json as { voices?: unknown[] } | null;
      return {
        ok: true, sideEffect: 'NONE', latencyMs: Date.now() - started,
        data: { voices: (body?.voices ?? []).map(toVoice).slice(0, limit) },
      };
    }

    if (!res.ok) {
      return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, res.text) };
    }

    const body = res.json as { voices?: unknown[]; next_page_token?: string | null; has_more?: boolean } | null;
    for (const raw of body?.voices ?? []) out.push(toVoice(raw));
    nextToken = body?.next_page_token ?? null;
    if (!nextToken || body?.has_more === false) break;
  }

  return {
    ok: true, sideEffect: 'NONE', latencyMs: Date.now() - started,
    data: { voices: out.slice(0, limit) },
  };
}

function toVoice(raw: unknown): ElevenLabsVoice {
  const v = (raw ?? {}) as Record<string, unknown>;
  const labels = (v.labels ?? {}) as Record<string, unknown>;
  const verified = v.verified_languages as Array<{ language?: string }> | undefined;
  return {
    voiceId: String(v.voice_id ?? ''),
    name: String(v.name ?? '').slice(0, 120),
    category: typeof v.category === 'string' ? v.category : null,
    description: typeof v.description === 'string' ? v.description.slice(0, 400) : null,
    previewUrl: typeof v.preview_url === 'string' ? v.preview_url : null,
    labels: Object.fromEntries(
      Object.entries(labels)
        .filter(([, val]) => typeof val === 'string')
        .map(([k, val]) => [k.slice(0, 40), String(val).slice(0, 60)]),
    ),
    languages: Array.isArray(verified)
      ? [...new Set(verified.map((l) => String(l?.language ?? '')).filter(Boolean))].slice(0, 40)
      : [],
  };
}

export interface ElevenLabsModel {
  modelId: string;
  name: string | null;
  canDoTts: boolean;
  languages: string[];
}

export async function listElevenLabsModels(): Promise<ProviderResult<{ models: ElevenLabsModel[] }>> {
  const res = await call('/v1/models', { timeoutMs: 12_000 });
  if (!res.ok) return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, res.text) };
  const raw = Array.isArray(res.json) ? res.json as Array<Record<string, unknown>> : [];
  return {
    ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs,
    data: {
      models: raw.map((m) => ({
        modelId: String(m.model_id ?? ''),
        name: typeof m.name === 'string' ? m.name : null,
        canDoTts: m.can_do_text_to_speech === true,
        languages: Array.isArray(m.languages)
          ? (m.languages as Array<{ language_id?: string }>)
            .map((l) => String(l?.language_id ?? '')).filter(Boolean)
          : [],
      })).filter((m) => m.modelId),
    },
  };
}

/**
 * Which models this account has, and what each of them can actually speak.
 *
 * Cached per instance because it is the same answer for every request and it
 * is the difference between a model chosen on evidence and one chosen on a
 * blog post. Refreshed when the cache is older than an hour, so a model
 * ElevenLabs adds is picked up without a deploy.
 */
let modelCache: { at: number; models: ElevenLabsModel[] } | null = null;

export async function ttsModelsCached(): Promise<ElevenLabsModel[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const out = await listElevenLabsModels();
  if (!out.ok || !out.data) return modelCache?.models ?? [];
  const models = out.data.models.filter((m) => m.canDoTts);
  modelCache = { at: Date.now(), models };
  return models;
}

/**
 * What to do when the configured model does not list the language.
 *
 * There is a real trade here and it is not obvious which way it goes, so it
 * is a setting rather than a decision baked into the code:
 *
 *   'configured_model'   keep the configured model and send no language_code
 *                        at all. The 400 came from the PARAMETER, not from an
 *                        inability to speak.
 *
 *   'capable_model'      substitute a model that lists the language. Correct
 *                        by the provider's own declaration.
 *
 * IT WAS MEASURED RATHER THAN ARGUED, AND THE ANSWER WAS NOT THE OBVIOUS ONE.
 *
 * The same Georgian sentence was spoken on production under each strategy and
 * the audio sent straight back through transcription:
 *
 *   capable_model     eleven_v3           4.7s, 9.5s
 *                     "...მე ხომაჩის AI ასისტენტი ვარ. რაგუშიemislia..."
 *   configured_model  eleven_flash_v2_5   2.0s, 4.9s, 1.2s
 *                     "...მე ჰომაჩეს AI ასისტენტი ვარ. როგორ შემიძლია დაგეხმაროთ?"
 *
 * Faster by roughly three times, and the round trip came back as the sentence
 * that was said rather than a mangled one. The declared-capable model was
 * worse on both counts, which is why the default is the other one now: a
 * language list is a declaration, and this is a measurement.
 *
 * What a measurement cannot settle is whether the brand name SOUNDS right --
 * that needs an ear, and the pronunciation screen is where somebody uses one.
 */
export type LanguageStrategy = 'capable_model' | 'configured_model';

export interface ModelChoice {
  modelId: string;
  /** Whether to send language_code at all. */
  sendLanguage: boolean;
  /** True when the preferred model could not speak this language. */
  substituted: boolean;
  /** Every model this account has that lists the language, for diagnostics. */
  capable: string[];
}

/**
 * The model to say this in, decided by what the models actually support.
 *
 * THIS IS THE GEORGIAN PROBLEM AGAIN, IN THE OTHER DIRECTION.
 *
 * Asked to speak Georgian, eleven_flash_v2_5 answered 400 — measured on
 * production. Its language list does not include ka. Guessing a different
 * model id would be the same mistake in a new hat, so the account's own model
 * catalogue is read and the answer comes from it:
 *
 *   the configured model, if it lists the language
 *   otherwise the first model that does, preferring the low-latency ones
 *   otherwise the configured model with NO language_code at all, which is
 *   the provider's own multilingual behaviour rather than a refusal
 *
 * A language nobody can speak is reported rather than silently dropped, so
 * Admin can see which of them this account actually covers instead of
 * Homatch claiming a number.
 */
export async function chooseTtsModel(
  preferred: string, language: string | null,
  strategy: LanguageStrategy = 'configured_model',
): Promise<ModelChoice> {
  const code = String(language ?? '').toLowerCase().split('-')[0];
  if (!code) return { modelId: preferred, sendLanguage: false, substituted: false, capable: [] };

  const models = await ttsModelsCached();
  if (!models.length) {
    // No catalogue to reason about. Send no language rather than a claim.
    return { modelId: preferred, sendLanguage: false, substituted: false, capable: [] };
  }

  const speaks = (m: ElevenLabsModel) => m.languages.some((l) => l.toLowerCase().split('-')[0] === code);
  const capable = models.filter(speaks).map((m) => m.modelId);

  const chosen = models.find((m) => m.modelId === preferred);
  if (chosen && speaks(chosen)) {
    return { modelId: preferred, sendLanguage: true, substituted: false, capable };
  }

  // The configured model, silent about the language. Chosen deliberately by
  // an operator who has listened to both and decided the seconds matter more
  // than the declaration.
  if (strategy === 'configured_model') {
    return { modelId: preferred, sendLanguage: false, substituted: false, capable };
  }

  // Prefer the quick ones, because this is a spoken turn somebody is waiting
  // through, then anything at all that can say the words.
  const ranked = [...models].sort((a, b) => rank(a.modelId) - rank(b.modelId));
  const substitute = ranked.find(speaks);
  if (substitute) {
    return { modelId: substitute.modelId, sendLanguage: true, substituted: true, capable };
  }

  return { modelId: preferred, sendLanguage: false, substituted: false, capable };
}

function rank(modelId: string): number {
  const m = modelId.toLowerCase();
  if (m.includes('flash')) return 0;
  if (m.includes('turbo')) return 1;
  if (m.includes('multilingual')) return 2;
  return 3;
}

// ── Speech ──────────────────────────────────────────────────────────────────

export interface SynthesiseOptions {
  voiceId: string;
  text: string;
  modelId?: string;
  /** ISO-639-1. Omitted when unknown rather than guessed. */
  languageCode?: string | null;
  /**
   * Whether to actually send it.
   *
   * False when the chosen model does not list the language: the provider
   * answers 400 rather than ignoring it, and its own multilingual behaviour
   * with no language_code is better than a refusal.
   */
  sendLanguage?: boolean;
  /** Only the settings the selected model actually supports. */
  settings?: {
    stability?: number; similarityBoost?: number; style?: number;
    useSpeakerBoost?: boolean; speed?: number;
  } | null;
  /** Pronunciation dictionaries to apply, newest last. */
  dictionaries?: Array<{ id: string; versionId: string }> | null;
  /** 'pcm' for streamed playback, 'mp3' for a preview a browser can play. */
  format?: 'pcm' | 'mp3';
  sampleRate?: number;
  timeoutMs?: number;
}

export interface SynthesisResult {
  audioBase64: string;
  mime: string;
  /** Present for raw PCM, because the browser has to schedule it. */
  sampleRate: number | null;
  model: string;
  characters: number;
}

/**
 * One piece of speech.
 *
 * Raw PCM by default because the streamed player schedules pieces to abut:
 * mp3 cannot be joined without a click, since every frame boundary carries
 * encoder padding. mp3 is for previews, where one file is played whole.
 */
export async function synthesizeElevenLabs(
  opts: SynthesiseOptions,
): Promise<ProviderResult<SynthesisResult>> {
  const text = String(opts.text ?? '').slice(0, 2500);
  if (!text.trim()) {
    return {
      ok: false, sideEffect: 'NONE',
      error: { code: 'UNKNOWN', message: 'nothing to speak', retryable: false },
    };
  }
  if (!opts.voiceId) {
    return {
      ok: false, sideEffect: 'NONE',
      error: { code: 'UNKNOWN', message: 'no voice selected', retryable: false },
    };
  }

  const model = opts.modelId || ELEVENLABS_DEFAULTS.ttsModel;
  const wantsPcm = (opts.format ?? 'pcm') === 'pcm';
  const rate = opts.sampleRate ?? ELEVENLABS_DEFAULTS.pcmSampleRate;
  const outputFormat = wantsPcm ? `pcm_${rate}` : 'mp3_44100_128';

  const body: Record<string, unknown> = { text, model_id: model };
  // Only when the caller has established the model can speak it. A
  // language_code a model does not list is a 400, not a graceful ignore.
  if (opts.languageCode && opts.sendLanguage !== false) body.language_code = opts.languageCode;
  if (opts.settings) {
    const s = opts.settings;
    body.voice_settings = {
      ...(s.stability !== undefined ? { stability: s.stability } : {}),
      ...(s.similarityBoost !== undefined ? { similarity_boost: s.similarityBoost } : {}),
      ...(s.style !== undefined ? { style: s.style } : {}),
      ...(s.useSpeakerBoost !== undefined ? { use_speaker_boost: s.useSpeakerBoost } : {}),
      ...(s.speed !== undefined ? { speed: s.speed } : {}),
    };
  }
  if (opts.dictionaries?.length) {
    body.pronunciation_dictionary_locators = opts.dictionaries.slice(0, 3).map((d) => ({
      pronunciation_dictionary_id: d.id,
      version_id: d.versionId,
    }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  const started = Date.now();

  try {
    const res = await fetch(
      `${API}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json', accept: wantsPcm ? 'audio/*' : 'audio/mpeg' }),
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, detail) };
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) {
      return {
        ok: false, sideEffect: 'NONE',
        error: { code: 'UNKNOWN', message: 'provider returned no audio', retryable: false },
      };
    }

    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }

    return {
      ok: true, sideEffect: 'COMMITTED', latencyMs: Date.now() - started,
      data: {
        audioBase64: btoa(binary),
        mime: wantsPcm ? 'audio/pcm' : 'audio/mpeg',
        sampleRate: wantsPcm ? rate : null,
        model,
        characters: text.length,
      },
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, sideEffect: 'MAYBE',
      error: {
        code: aborted ? 'TIMEOUT' : 'TRANSIENT',
        message: String((e as Error)?.message ?? e).slice(0, 200),
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Realtime transcription ──────────────────────────────────────────────────

export const SCRIBE_REALTIME_WS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/**
 * A single-use token so a browser can hold the realtime socket itself.
 *
 * The alternative is proxying every audio frame through an edge function,
 * which doubles the hops on the one leg where latency is felt most. A
 * single-use, short-lived token is the provider's own answer to that, and it
 * is not the API key: it cannot list voices, cannot synthesise, and expires.
 *
 * The path is discovered rather than pinned. Provider token endpoints move,
 * this one is documented only as "the token endpoint", and a 404 on a
 * hardcoded path would take realtime transcription down silently. Each
 * candidate is tried once and the one that works is reported.
 */
const TOKEN_PATHS: Array<{ method: 'GET' | 'POST'; path: string }> = [
  // The documented one: POST /v1/single-use-token/:token_type, where the type
  // for this socket is realtime_scribe. Fifteen minutes, one use.
  { method: 'POST', path: '/v1/single-use-token/realtime_scribe' },
  { method: 'GET', path: '/v1/speech-to-text/realtime/token' },
  { method: 'POST', path: '/v1/speech-to-text/realtime/token' },
];

export interface RealtimeGrant {
  token: string;
  /** Which path produced it, so the ladder can be pruned once it is known. */
  path: string;
  expiresAt: string | null;
}

export async function mintRealtimeToken(): Promise<ProviderResult<RealtimeGrant>> {
  if (!elevenLabsCredentialsPresent()) {
    return {
      ok: false, sideEffect: 'NONE',
      error: { code: 'AUTH', message: 'no credential', retryable: false },
    };
  }

  let last: ProviderResult<never>['error'] | undefined;
  for (const candidate of TOKEN_PATHS) {
    const res = await call(candidate.path, {
      method: candidate.method,
      timeoutMs: 8_000,
      ...(candidate.method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
    });

    if (res.ok) {
      const body = res.json as { token?: string; value?: string; expires_at?: string } | null;
      const token = body?.token ?? body?.value ?? null;
      if (token) {
        return {
          ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs,
          data: { token, path: candidate.path, expiresAt: body?.expires_at ?? null },
        };
      }
    }

    last = classifyElevenLabs(res.status, res.text);
    // A credential problem is the same on every path; only a missing route is
    // worth walking past.
    if (last?.code === 'AUTH' || last?.code === 'POLICY') break;
  }

  return {
    ok: false, sideEffect: 'NONE',
    error: last ?? { code: 'NOT_SUPPORTED', message: 'no realtime token endpoint answered', retryable: false },
  };
}

/**
 * The socket URL for a browser holding a single-use token.
 *
 * Keyterms are placed here rather than in a later message because the socket
 * is configured at connect time — which is exactly why the selection has to
 * be made before the first word is spoken, and why it is worth doing well.
 */
export function scribeRealtimeUrl(params: {
  token: string;
  model?: string;
  languageCode?: string | null;
  sampleRate?: number;
  keyterms?: string[];
  vadSilenceSecs?: number;
}): string {
  const query = new URLSearchParams({
    token: params.token,
    model_id: params.model || ELEVENLABS_DEFAULTS.sttModel,
    audio_format: `pcm_${params.sampleRate ?? ELEVENLABS_DEFAULTS.sttSampleRate}`,
    commit_strategy: 'vad',
    include_language_detection: 'true',
  });
  // A language is sent only when the conversation has actually settled into
  // one. Naming it from the page locale is how a Russian speaker reading a
  // Georgian page gets Georgian letters back.
  if (params.languageCode) query.set('language_code', params.languageCode);
  if (params.vadSilenceSecs) query.set('vad_silence_threshold_secs', String(params.vadSilenceSecs));
  for (const term of params.keyterms ?? []) query.append('keyterms', term);
  return `${SCRIBE_REALTIME_WS}?${query}`;
}

/**
 * Voices from the provider's SHARED library, filtered by the language their
 * speaker actually speaks.
 *
 * WHY THIS EXISTS, AND IT IS THE WHOLE GEORGIAN PROBLEM
 *
 * Every stock voice on this account is labelled `language: en` with an
 * american, british or australian accent. A multilingual MODEL renders those
 * speakers saying Georgian words -- it does not give them a Georgian mouth.
 * The result is English phonology mapped onto Georgian letters, which is
 * exactly what a native listener hears and rejects.
 *
 * A voice list saying "this voice supports 24 languages" is a statement about
 * the model's reach, not about the speaker's accent. The two were conflated
 * here once already and it put an American voice in front of Georgian
 * customers. The shared library is where speakers of other languages actually
 * live, and this is how they are found rather than guessed at.
 */
export interface SharedVoice {
  voiceId: string;
  publicOwnerId: string;
  name: string;
  accent: string | null;
  language: string | null;
  /** Every language the speaker is tagged as speaking, not the model's reach. */
  verifiedLanguages: Array<{ language: string; accent: string | null; locale: string | null }>;
  description: string | null;
  previewUrl: string | null;
  category: string | null;
  usageCount: number | null;
}

export async function listSharedVoices(params: {
  language?: string | null;
  search?: string | null;
  pageSize?: number;
}): Promise<ProviderResult<{ voices: SharedVoice[] }>> {
  const query = new URLSearchParams({
    page_size: String(Math.min(100, Math.max(1, params.pageSize ?? 40))),
  });
  if (params.language) query.set('language', params.language);
  if (params.search) query.set('search', params.search);

  const res = await call(`/v1/shared-voices?${query}`, { timeoutMs: 20_000 });
  if (!res.ok) {
    return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, res.text) };
  }

  const body = res.json as { voices?: Array<Record<string, unknown>> } | null;
  const voices: SharedVoice[] = (body?.voices ?? []).map((v) => {
    const verified = Array.isArray(v.verified_languages) ? v.verified_languages : [];
    return {
      voiceId: String(v.voice_id ?? ''),
      publicOwnerId: String(v.public_owner_id ?? ''),
      name: String(v.name ?? ''),
      accent: v.accent ? String(v.accent) : null,
      language: v.language ? String(v.language) : null,
      verifiedLanguages: verified.map((l) => {
        const row = l as Record<string, unknown>;
        return {
          language: String(row.language ?? ''),
          accent: row.accent ? String(row.accent) : null,
          locale: row.locale ? String(row.locale) : null,
        };
      }).filter((l) => l.language),
      description: v.description ? String(v.description).slice(0, 400) : null,
      previewUrl: v.preview_url ? String(v.preview_url) : null,
      category: v.category ? String(v.category) : null,
      usageCount: Number.isFinite(Number(v.cloned_by_count)) ? Number(v.cloned_by_count) : null,
    };
  }).filter((v) => v.voiceId);

  return { ok: true, data: { voices } };
}

/**
 * Add a shared voice to this account, which is the only way to speak with it.
 *
 * A change to the owner's provider account, so it is never done on a whim:
 * the caller has to have decided to audition this specific voice. It is
 * reversible from the ElevenLabs dashboard, and nothing here removes voices.
 */
export async function addSharedVoice(params: {
  publicOwnerId: string; voiceId: string; name: string;
}): Promise<ProviderResult<{ voiceId: string }>> {
  const res = await call(
    `/v1/voices/add/${encodeURIComponent(params.publicOwnerId)}/${encodeURIComponent(params.voiceId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_name: params.name.slice(0, 60) }),
      timeoutMs: 20_000,
    },
  );
  if (!res.ok) {
    return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, res.text) };
  }
  const body = res.json as { voice_id?: string } | null;
  return { ok: true, data: { voiceId: String(body?.voice_id ?? params.voiceId) } };
}

/**
 * The same speech, but sent while it is still being made.
 *
 * WHY THIS EXISTS BESIDE THE ONE ABOVE
 *
 * synthesizeElevenLabs waits for arrayBuffer(): the whole clip has to exist
 * before a single byte leaves for the browser. For a preview that is right --
 * one file, played whole. For a conversation it is the difference between
 * hearing the reply and waiting for it. The provider documents ~280ms for
 * v3 Conversational; measured against the non-streaming endpoint the same
 * model took 1.0 to 2.0 seconds, because that number is time-to-FIRST-audio
 * and we were asking for the last.
 *
 * Raw PCM, so chunks abut without a click and the browser can schedule each
 * one the moment it arrives. mp3 cannot be cut this way -- every frame
 * boundary carries encoder padding -- which is why the preview path keeps the
 * whole-file endpoint and this one does not offer mp3.
 *
 * onChunk is called with each piece as it lands, and with the elapsed
 * milliseconds to the FIRST piece, which is the only latency number that
 * describes what a person experiences.
 */
export interface StreamResult {
  /** Time from request to the first audio byte. The number that matters. */
  firstByteMs: number;
  totalMs: number;
  bytes: number;
  sampleRate: number;
  model: string;
  characters: number;
}

export async function streamElevenLabs(
  opts: SynthesiseOptions & {
    /**
     * 0-4. The provider trades text normalisation for latency as this rises;
     * 3 disables the normaliser, which is wrong for a language whose numbers
     * and currency have to be spoken properly, so the default stays low and
     * the caller decides.
     */
    optimizeLatency?: number;
  },
  onChunk: (chunk: Uint8Array, index: number) => void,
): Promise<ProviderResult<StreamResult>> {
  const text = String(opts.text ?? '').slice(0, 2500);
  if (!text.trim()) {
    return { ok: false, sideEffect: 'NONE', error: { code: 'UNKNOWN', message: 'nothing to speak', retryable: false } };
  }
  if (!opts.voiceId) {
    return { ok: false, sideEffect: 'NONE', error: { code: 'UNKNOWN', message: 'no voice selected', retryable: false } };
  }

  const model = opts.modelId || ELEVENLABS_DEFAULTS.ttsModel;
  const rate = opts.sampleRate ?? ELEVENLABS_DEFAULTS.pcmSampleRate;

  const body: Record<string, unknown> = { text, model_id: model };
  if (opts.languageCode && opts.sendLanguage !== false) body.language_code = opts.languageCode;
  if (opts.settings) {
    const v = opts.settings;
    body.voice_settings = {
      ...(v.stability !== undefined ? { stability: v.stability } : {}),
      ...(v.similarityBoost !== undefined ? { similarity_boost: v.similarityBoost } : {}),
      ...(v.style !== undefined ? { style: v.style } : {}),
      ...(v.useSpeakerBoost !== undefined ? { use_speaker_boost: v.useSpeakerBoost } : {}),
      ...(v.speed !== undefined ? { speed: v.speed } : {}),
    };
  }
  if (opts.dictionaries?.length) {
    body.pronunciation_dictionary_locators = opts.dictionaries.slice(0, 3).map((d) => ({
      pronunciation_dictionary_id: d.id,
      version_id: d.versionId,
    }));
  }

  const query = new URLSearchParams({ output_format: `pcm_${rate}` });
  if (opts.optimizeLatency !== undefined) {
    query.set('optimize_streaming_latency', String(Math.max(0, Math.min(4, opts.optimizeLatency))));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  const started = Date.now();

  try {
    const res = await fetch(
      `${API}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/stream?${query}`,
      {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json', accept: 'audio/*' }),
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!res.ok || !res.body) {
      const detail = res.ok ? 'provider returned no stream' : await res.text();
      return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, detail) };
    }

    const reader = res.body.getReader();
    let firstByteMs = 0;
    let bytes = 0;
    let index = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      if (!firstByteMs) firstByteMs = Date.now() - started;
      bytes += value.byteLength;
      onChunk(value, index);
      index += 1;
    }

    if (!bytes) {
      return {
        ok: false, sideEffect: 'NONE',
        error: { code: 'UNKNOWN', message: 'provider returned no audio', retryable: false },
      };
    }

    return {
      ok: true,
      data: {
        firstByteMs, totalMs: Date.now() - started, bytes,
        sampleRate: rate, model, characters: text.length,
      },
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, sideEffect: 'MAYBE',
      error: {
        code: aborted ? 'TIMEOUT' : 'TRANSIENT',
        message: aborted ? 'the provider did not start speaking in time' : 'the provider stream broke',
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Pronunciation ───────────────────────────────────────────────────────────

export interface PronunciationRuleInput {
  /** The written form, exactly. These dictionaries are case sensitive. */
  stringToReplace: string;
  /** An alias is a respelling; a phoneme is IPA/CMU and not every model takes one. */
  type: 'alias' | 'phoneme';
  alias?: string;
  phoneme?: string;
  alphabet?: 'ipa' | 'cmu-arpabet';
}

export interface PronunciationDictionary {
  id: string;
  versionId: string;
  name: string;
}

/**
 * Create a dictionary from rules.
 *
 * Homatch keeps the rules; the provider keeps a versioned copy that synthesis
 * can point at. A new version is created rather than a dictionary mutated, so
 * audio generated last week can still be explained.
 */
export async function createPronunciationDictionary(
  name: string, rules: PronunciationRuleInput[],
): Promise<ProviderResult<PronunciationDictionary>> {
  const res = await call('/v1/pronunciation-dictionaries/add-from-rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    timeoutMs: 15_000,
    body: JSON.stringify({
      name: name.slice(0, 80),
      rules: rules.slice(0, 200).map((r) => ({
        string_to_replace: r.stringToReplace,
        type: r.type,
        ...(r.type === 'alias' ? { alias: r.alias ?? '' } : {}),
        ...(r.type === 'phoneme' ? { phoneme: r.phoneme ?? '', alphabet: r.alphabet ?? 'ipa' } : {}),
      })),
    }),
  });

  if (!res.ok) return { ok: false, sideEffect: 'NONE', error: classifyElevenLabs(res.status, res.text) };
  const body = res.json as { id?: string; version_id?: string; name?: string } | null;
  if (!body?.id || !body?.version_id) {
    return {
      ok: false, sideEffect: 'MAYBE',
      error: { code: 'UNKNOWN', message: 'the provider accepted the rules but named no dictionary', retryable: true },
    };
  }
  return {
    ok: true, sideEffect: 'COMMITTED', latencyMs: res.latencyMs,
    data: { id: body.id, versionId: body.version_id, name: body.name ?? name },
  };
}

/**
 * Which of Homatch's pronunciation methods this model will actually honour.
 *
 * Phonemes are not universally supported, and a rule that is silently ignored
 * is worse than one that is refused: the owner approves audio that does not
 * match what customers will hear. The flash models are alias-only.
 */
export function pronunciationMethodsFor(modelId: string): Array<'alias' | 'phoneme'> {
  const m = modelId.toLowerCase();
  if (m.includes('flash') || m.includes('turbo') || m.includes('v3')) return ['alias'];
  return ['alias', 'phoneme'];
}
