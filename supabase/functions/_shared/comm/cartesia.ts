// HOMATCH Communications — Cartesia.
//
// Cartesia serves three roles here and they have different risk profiles:
//
//   ORCHESTRATOR  the browser realtime agent, used by the homepage AI Talk
//                 demo and by Voice Studio's live test. No telephony leg, so
//                 no per-minute carrier cost.
//   STT           Ink, for Georgian. §24 makes this a release gate.
//   TTS           Sonic.
//
// WHAT THIS FILE IS CAREFUL ABOUT
//
// CARTESIA_API_KEY never leaves the server (§139). The browser receives a
// short-lived access token minted here with the narrowest grant that will do
// the job. The existing deployed cartesia-access-token function already proved
// this path works end to end against the live API; this is that path, with the
// three things it was missing: a timeout, a caller-supplied TTL, and grants
// that are chosen rather than hardcoded.

import {
  providerFetch, requireSecret, hasSecret,
  type ProviderResult, type RealtimeProvider, type RealtimeGrant,
} from './contracts.ts';

const CARTESIA_API = 'https://api.cartesia.ai';

/**
 * Pinned for the same reason Meta's is. This is the version the deployed
 * function was verified against; changing it is a deliberate edit plus a
 * re-test, not a drift.
 */
export const CARTESIA_VERSION = '2026-03-01';

/**
 * The agents and realtime-STT APIs are on a later date-versioned contract than
 * the token endpoint. Both are pinned; the browser's websocket URLs carry this
 * one, so it must match what voiceClient.ts sends or the sockets are refused.
 */
export const CARTESIA_AGENTS_VERSION = '2026-08-14';

export type CartesiaGrantScope = 'agent' | 'stt' | 'tts';

export function cartesiaCredentialsPresent(): { ok: boolean; missing: string[] } {
  const missing = hasSecret('CARTESIA_API_KEY') ? [] : ['CARTESIA_API_KEY'];
  return { ok: missing.length === 0, missing };
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireSecret('CARTESIA_API_KEY')}`,
    'Cartesia-Version': CARTESIA_VERSION,
    'Content-Type': 'application/json',
  };
}

export function createCartesiaProvider(): RealtimeProvider {
  return {
    name: 'CARTESIA',

    async mintGrant(params: { ttlSeconds: number; scopes: string[] }): Promise<ProviderResult<RealtimeGrant>> {
      // A token is only as dangerous as what it can do and how long it lives.
      // The caller says what it needs; anything it did not ask for is false,
      // and the TTL is clamped so a caller bug cannot mint an hour-long key.
      const scopes = new Set(params.scopes);
      const grants = {
        agent: scopes.has('agent'),
        stt: scopes.has('stt'),
        tts: scopes.has('tts'),
      };
      if (!grants.agent && !grants.stt && !grants.tts) {
        return {
          ok: false, sideEffect: 'NONE',
          error: { code: 'NOT_SUPPORTED', message: 'a grant with no scopes is useless', retryable: false },
        };
      }

      const expiresIn = Math.min(600, Math.max(30, Math.floor(params.ttlSeconds)));

      const res = await providerFetch(`${CARTESIA_API}/access-token`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ grants, expires_in: expiresIn }),
        timeoutMs: 10_000,
      });

      if (!res.ok) {
        return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
      }
      const token = (res.json as { token?: string })?.token;
      if (!token) {
        return {
          ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs,
          error: { code: 'UNKNOWN', message: 'Cartesia returned no token', retryable: false },
        };
      }

      return {
        ok: true,
        sideEffect: 'NONE',
        latencyMs: res.latencyMs,
        data: {
          token,
          // Computed from OUR clock at mint time. The browser must not be the
          // authority on when its own key stops working.
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          provider: 'CARTESIA',
        },
      };
    },

    /**
     * Health check (§57): authenticated, read-only, and free.
     *
     * Listing voices proves the key is valid and the API is reachable without
     * synthesising a single second of audio. A "test connection" button that
     * quietly bills for a TTS render is a button an admin learns not to press.
     */
    async ping(): Promise<ProviderResult<{ detail: string }>> {
      const res = await providerFetch(`${CARTESIA_API}/voices?limit=1`, {
        headers: headers(),
        timeoutMs: 8_000,
      });
      if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
      return { ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs, data: { detail: 'voices endpoint reachable' } };
    },
  };
}

/**
 * Make sure there is a Cartesia agent to stream against, and return its id.
 *
 * WHY ONE AGENT AND NOT ONE PER HOMATCH AGENT
 *
 * The websocket `start` event accepts `agent.system_prompt`,
 * `agent.introduction` and `config.voice_id` as per-session overrides. So a
 * single base agent at the provider can serve every Homatch agent, with the
 * real instructions supplied at connect time.
 *
 * That is not just economy. A stored provider agent is mutable state living
 * outside Homatch: it can be edited in Cartesia's dashboard, it drifts from
 * comm_agent_versions, and then a transcript can no longer be explained by the
 * snapshot it claims to have run under (§11). Keeping the instructions in the
 * connect frame keeps comm_agent_versions the only source of truth.
 *
 * The id is cached in admin_settings so this costs one API call ever, not one
 * per session.
 */
/**
 * The placeholder identity of the stored agent.
 *
 * Written defensively rather than left blank so that a session which somehow
 * fails to override it still behaves inside the product boundary.
 */
const BASE_INSTRUCTIONS =
  'You are a real-estate assistant for Homatch. Speak briefly. Never state a price, '
  + 'an address, availability or any legal or financial fact you have not been given.';

/**
 * Keep Cartesia's own reason for refusing an agent-create.
 *
 * The blanket rule (§74) is that a provider error body is never retained,
 * because provider errors echo the request and requests carry phone numbers.
 * THIS request carries no customer data at all — a fixed name and a fixed
 * instruction string — so the schema complaint is safe to keep, and without it
 * an admin sees "UNKNOWN" and has nothing to act on.
 */
function classifyCartesia(status: number, body: string): ProviderResult<never>['error'] {
  if (status === 401 || status === 403) {
    return { code: 'AUTH', message: 'the provider rejected our credentials', retryable: false, providerCode: status };
  }
  if (status === 429) {
    return { code: 'RATE_LIMIT', message: 'the provider is rate limiting us', retryable: true, providerCode: status };
  }
  if (status >= 500) {
    return { code: 'TRANSIENT', message: `provider returned ${status}`, retryable: true, providerCode: status };
  }
  let detail = '';
  try {
    const j = JSON.parse(body) as { title?: string; message?: string };
    detail = [j?.title, j?.message].filter(Boolean).join(': ').slice(0, 300);
  } catch { detail = body.slice(0, 200); }
  return {
    code: 'UNKNOWN',
    message: `provider returned ${status}${detail ? ` — ${detail}` : ''}`,
    retryable: false,
    providerCode: status,
  };
}

export async function ensureBaseAgent(
  sb: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { value?: unknown } | null }> } }; upsert: (v: unknown, o?: unknown) => Promise<unknown> } },
  defaults: { voiceId?: string | null; language?: string } = {},
): Promise<ProviderResult<{ agentId: string; created: boolean }>> {
  const SETTING_KEY = 'cartesia_base_agent_id';

  const { data: stored } = await sb.from('admin_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
  const cached = typeof stored?.value === 'string' ? stored.value : null;
  if (cached) {
    return { ok: true, sideEffect: 'NONE', data: { agentId: cached, created: false } };
  }

  // WHAT THE STORED AGENT IS FOR, AND WHY IT IS NEARLY EMPTY
  //
  // Every session overrides instructions, voice and language in the websocket
  // start frame. The stored agent is a handle, not a configuration — so the
  // create request should carry the minimum the API requires and nothing
  // speculative.
  //
  // It used to send a full nested config: initial_message: null, an empty
  // audio.output (voice_id was `undefined`, which JSON.stringify drops), a
  // model object and language: { primary: 'ka' }. Cartesia rejected it with a
  // 4xx, ensureBaseAgent returned UNKNOWN, and ai-talk-session turned that
  // into PROVIDER_ERROR/UNAVAILABLE — which is why AI Talk and the agent
  // browser test could not start at all. admin_settings has never held a
  // cartesia_base_agent_id, so this request has never once succeeded.
  //
  // Each candidate below is a strictly smaller request than the one before.
  // The first that the provider accepts wins, and whichever it is, the shape
  // is recorded so this stops being guesswork the next time the API moves.
  const candidates: Array<{ shape: string; body: Record<string, unknown> }> = [
    {
      shape: 'minimal',
      body: { name: 'Homatch', config: { instructions: BASE_INSTRUCTIONS } },
    },
    {
      shape: 'with_model',
      body: {
        name: 'Homatch',
        config: { instructions: BASE_INSTRUCTIONS, model: { id: 'sonic-agent' } },
      },
    },
    {
      shape: 'name_only',
      body: { name: 'Homatch' },
    },
  ];

  let res!: Awaited<ReturnType<typeof providerFetch>>;
  let shape = '';
  for (const candidate of candidates) {
    shape = candidate.shape;
    res = await providerFetch(`${CARTESIA_API}/v1/agents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireSecret('CARTESIA_API_KEY')}`,
        'Cartesia-Version': CARTESIA_AGENTS_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(candidate.body),
      timeoutMs: 15_000,
    }, classifyCartesia);

    if (res.ok) break;
    // A credential or rate-limit problem is not a schema problem: a smaller
    // body will not fix it, and retrying twice more only wastes the caller's
    // time and the provider's patience.
    const code = res.error?.code;
    if (code === 'AUTH' || code === 'RATE_LIMIT' || code === 'TIMEOUT') break;
  }

  if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };

  const agentId = (res.json as { id?: string })?.id;
  if (!agentId) {
    return {
      ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs,
      error: { code: 'UNKNOWN', message: 'Cartesia created an agent without returning an id', retryable: false },
    };
  }

  await sb.from('admin_settings').upsert(
    {
      key: SETTING_KEY,
      value: agentId,
      description: `Base Cartesia agent (accepted shape: ${shape}); per-session prompt and voice are sent in the websocket start frame.`,
    },
    { onConflict: 'key' },
  );

  return { ok: true, sideEffect: 'COMMITTED', latencyMs: res.latencyMs, data: { agentId, created: true } };
}

export interface CartesiaVoice {
  id: string;
  name: string;
  description: string | null;
  language: string | null;
  /** Whether this voice belongs to the account rather than the public library. */
  isCustom: boolean;
}

/**
 * The voice catalogue for Voice Studio.
 *
 * §12 is explicit: "Do not invent demographic characteristics not supplied by
 * the provider." So this maps only fields Cartesia actually returns. Where it
 * gives no description, the UI shows none — it does not fill the gap with a
 * guess about who the speaker sounds like.
 */
export async function listCartesiaVoices(limit = 100): Promise<ProviderResult<CartesiaVoice[]>> {
  const res = await providerFetch(`${CARTESIA_API}/voices?limit=${Math.min(200, Math.max(1, limit))}`, {
    headers: headers(),
    timeoutMs: 12_000,
  });
  if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };

  const payload = res.json as { data?: unknown[] } | unknown[];
  const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);

  const voices: CartesiaVoice[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const id = typeof v.id === 'string' ? v.id : null;
    if (!id) continue;
    voices.push({
      id,
      name: typeof v.name === 'string' ? v.name : id,
      description: typeof v.description === 'string' ? v.description : null,
      language: typeof v.language === 'string' ? v.language : null,
      isCustom: v.is_public === false,
    });
  }
  return { ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs, data: voices };
}

/**
 * Batch speech-to-text, used by the Georgian benchmark harness (§25) and by
 * WhatsApp voice-note transcription (§118).
 *
 * Deliberately NOT the path a live call uses — a call streams over a websocket
 * that the runtime owns. This is for audio that already exists as a file.
 */
export async function transcribeAudio(params: {
  bytes: Uint8Array;
  mime: string;
  model?: string;
  language?: string | null;
}): Promise<ProviderResult<{ text: string; language: string | null; durationSec: number | null }>> {
  const form = new FormData();
  form.append('file', new Blob([params.bytes], { type: params.mime }), 'audio');
  form.append('model', params.model ?? 'ink-whisper');
  form.append('encoding', 'auto');
  // Passing a language is a hint, never a lock: §24 requires that short
  // Georgian speech is allowed to prove itself rather than being forced into
  // whatever the first 200ms suggested.
  if (params.language) form.append('language', params.language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const started = Date.now();
  try {
    const res = await fetch(`${CARTESIA_API}/stt`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireSecret('CARTESIA_API_KEY')}`,
        'Cartesia-Version': CARTESIA_VERSION,
      },
      body: form,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false, sideEffect: 'NONE', latencyMs,
        error: {
          code: res.status === 401 ? 'AUTH' : res.status === 429 ? 'RATE_LIMIT' : res.status >= 500 ? 'TRANSIENT' : 'UNKNOWN',
          message: `Cartesia STT returned ${res.status}`,
          retryable: res.status === 429 || res.status >= 500,
        },
      };
    }
    const json = JSON.parse(text) as { text?: string; language?: string; duration?: number };
    return {
      ok: true, sideEffect: 'NONE', latencyMs,
      data: {
        text: json.text ?? '',
        language: json.language ?? null,
        durationSec: typeof json.duration === 'number' ? json.duration : null,
      },
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, sideEffect: 'NONE', latencyMs: Date.now() - started,
      error: { code: aborted ? 'TIMEOUT' : 'TRANSIENT', message: String((e as Error)?.message ?? e), retryable: true },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Voice preview ───────────────────────────────────────────────────────────

/**
 * The sentence a preview speaks.
 *
 * Localised, and deliberately about property: a customer choosing a voice for
 * a real-estate agent is judging how it sounds saying THIS, not how it sounds
 * reading a pangram. Kept to one short line because previews are synthesised
 * on demand and every character is billable.
 */
const PREVIEW_PHRASE: Record<string, string> = {
  ka: 'გამარჯობათ, გირეკავთ Homatch-იდან იმ ბინასთან დაკავშირებით, რომელიც დაგაინტერესათ.',
  en: 'Hello, I am calling from Homatch about the apartment you asked about.',
  ru: 'Здравствуйте, я звоню из Homatch по поводу квартиры, которой вы интересовались.',
  tr: 'Merhaba, sorduğunuz daire hakkında Homatch’tan arıyorum.',
  ar: 'مرحبًا، أتصل بك من Homatch بخصوص الشقة التي سألت عنها.',
  he: 'שלום, אני מתקשר מ-Homatch בנוגע לדירה ששאלת עליה.',
};

export function previewPhrase(language: string): string {
  return PREVIEW_PHRASE[String(language ?? '').toLowerCase()] ?? PREVIEW_PHRASE.en;
}

/**
 * Synthesise the preview line in one voice.
 *
 * WHY THE MODEL IS A LIST
 *
 * Cartesia names its TTS models by generation and retires them, and this
 * repository has never called /tts/bytes before, so there is no model id here
 * that production has ever proved. Rather than hardcode one guess and ship a
 * feature that silently does nothing, each candidate is tried in order and the
 * one the provider accepts is reported back to the caller, which records it.
 * A credential or rate-limit refusal stops the loop immediately — a different
 * model id cannot fix either of those.
 */
const TTS_MODELS = ['sonic-3', 'sonic-2', 'sonic-english', 'sonic'];

export async function synthesizePreview(params: {
  voiceId: string;
  language: string;
}): Promise<ProviderResult<{ audioBase64: string; mime: string; model: string }>> {
  const transcript = previewPhrase(params.language);
  let last: ProviderResult<never>['error'] | undefined;

  for (const model of TTS_MODELS) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(`${CARTESIA_API}/tts/bytes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireSecret('CARTESIA_API_KEY')}`,
          'Cartesia-Version': CARTESIA_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: model,
          transcript,
          voice: { mode: 'id', id: params.voiceId },
          language: String(params.language ?? 'en').toLowerCase(),
          output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100, bit_rate: 128000 },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        last = classifyCartesia(res.status, body);
        // Not a schema problem: another model id will fail identically.
        if (last?.code === 'AUTH' || last?.code === 'RATE_LIMIT') break;
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) { last = { code: 'UNKNOWN', message: 'provider returned no audio', retryable: false }; continue; }

      // Chunked so a long clip cannot blow the argument limit on spread.
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }

      return {
        ok: true, sideEffect: 'COMMITTED', latencyMs: Date.now() - started,
        data: { audioBase64: btoa(binary), mime: 'audio/mpeg', model },
      };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      last = { code: aborted ? 'TIMEOUT' : 'TRANSIENT', message: String((e as Error)?.message ?? e), retryable: true };
      if (aborted) break;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, sideEffect: 'NONE', error: last ?? { code: 'UNKNOWN', message: 'no model accepted', retryable: false } };
}

// ── Custom voices ───────────────────────────────────────────────────────────

/**
 * What a clip has to be before it is worth sending to the provider.
 *
 * Checked here as well as in the browser, because a browser check is a
 * courtesy and a server check is the rule. The ceiling exists so one request
 * cannot push twenty megabytes through an edge function; the floor exists
 * because the provider needs a few seconds of speech and a 2KB file is a
 * mistake, not a voice.
 */
export const CLIP_MIN_BYTES = 8_000;
export const CLIP_MAX_BYTES = 10 * 1024 * 1024;
export const CLIP_MIME_ALLOWED = [
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/ogg', 'audio/webm',
];

export function clipRejectionReason(bytes: number, mime: string): string | null {
  if (!CLIP_MIME_ALLOWED.includes(mime.toLowerCase().split(';')[0].trim())) {
    return 'unsupported_format';
  }
  if (bytes < CLIP_MIN_BYTES) return 'too_short';
  if (bytes > CLIP_MAX_BYTES) return 'too_large';
  return null;
}

/**
 * Clone a voice from a clip the customer supplied.
 *
 * The clip is streamed straight to the provider and never written to Homatch
 * storage. Keeping a library of voice samples would create precisely the
 * liability the consent record exists to bound, and nothing in this product
 * needs the audio again once the provider has a voice id.
 *
 * `access: 'private'` is not configurable. A cloned voice belongs to the
 * account that cloned it; publishing someone's voice to a shared library on
 * their behalf is not a decision a checkbox can carry.
 */
export async function cloneCartesiaVoice(params: {
  clip: Uint8Array;
  mime: string;
  name: string;
  language: string;
  description?: string;
}): Promise<ProviderResult<{ voiceId: string }>> {
  const form = new FormData();
  form.append('clip', new Blob([params.clip], { type: params.mime }), 'clip');
  form.append('name', params.name.slice(0, 80));
  form.append('language', String(params.language ?? 'en').toLowerCase().slice(0, 5));
  form.append('mode', 'similarity');
  form.append('enhance', 'true');
  form.append('access', 'private');
  if (params.description) form.append('description', params.description.slice(0, 300));

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${CARTESIA_API}/voices/clone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireSecret('CARTESIA_API_KEY')}`,
        'Cartesia-Version': CARTESIA_VERSION,
        // No Content-Type: fetch sets the multipart boundary itself, and
        // setting it by hand produces a body the provider cannot parse.
      },
      body: form,
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false, sideEffect: 'MAYBE', latencyMs: Date.now() - started,
        error: classifyCartesia(res.status, text),
      };
    }

    let voiceId: string | null = null;
    try { voiceId = (JSON.parse(text) as { id?: string })?.id ?? null; } catch { voiceId = null; }
    if (!voiceId) {
      return {
        ok: false, sideEffect: 'MAYBE', latencyMs: Date.now() - started,
        error: { code: 'UNKNOWN', message: 'the provider created a voice without returning an id', retryable: false },
      };
    }

    return { ok: true, sideEffect: 'COMMITTED', latencyMs: Date.now() - started, data: { voiceId } };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false, sideEffect: 'MAYBE', latencyMs: Date.now() - started,
      error: {
        code: aborted ? 'TIMEOUT' : 'TRANSIENT',
        message: String((e as Error)?.message ?? e), retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Remove a voice this account created. Used to undo a failed or unwanted clone. */
export async function deleteCartesiaVoice(voiceId: string): Promise<ProviderResult<null>> {
  const res = await providerFetch(`${CARTESIA_API}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE', headers: headers(), timeoutMs: 15_000,
  }, classifyCartesia);
  if (!res.ok) return { ok: false, sideEffect: 'NONE', error: res.error };
  return { ok: true, sideEffect: 'COMMITTED', data: null };
}
