// HOMATCH — a recorded voice message to HOMI, turned into text.
//
// WHY THIS IS NOT THE STREAMING PATH
//
// AI TALK streams raw PCM over a WebSocket because it needs words while the
// person is still talking. A voice message is the opposite shape: the person
// records, lets go, and sends one finished clip. That is Google's unary
// `Recognize`, which takes the whole clip in one request and decodes the
// browser's own container (WebM/Opus, Ogg/Opus, MP4/AAC) itself through
// `autoDecodingConfig`. Nothing has to be resampled in the browser.
//
// WHAT IT REUSES
//
// The same service account, project, region and model as AI TALK
// (GOOGLE_SPEECH_* on this worker, read through speechConfigFromEnv). No new
// secret, no new Google project. Only the language is per request: it follows
// the person's interface language, using the exact tags AI TALK's live probe
// proved chirp_3 accepts at this endpoint (src/lib/comm/languageRegistry.ts).
//
// LIMITS, AND WHY THEY ARE THESE
//
// Unary Recognize accepts at most one minute of inline audio. So a voice
// message is at most 60 seconds, and the browser stops recording there. The
// byte cap is generous for a minute of Opus (about 0.5 MB at 64 kbps) and
// stops anybody posting a file that is not a voice message.
//
// WHAT IS NEVER DONE
//
// The audio is never written to disk, never logged, never kept. The
// transcript is returned to the caller and not logged either: it is what a
// customer said.

import { v2 } from '@google-cloud/speech';
import { speechEndpoint, type SpeechConfig } from './GoogleSpeechStream.js';

const SpeechClient = v2.SpeechClient;
type SpeechClient = InstanceType<typeof v2.SpeechClient>;

/** Google's ceiling for inline audio on unary Recognize. */
export const MAX_CLIP_SECONDS = 60;
/** A minute of Opus is ~0.5 MB; MP4/AAC from Safari runs larger. */
export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
/** Anything shorter than this cannot hold a word. */
export const MIN_CLIP_BYTES = 256;

/**
 * HOMATCH's six interface languages, as chirp_3 spells them.
 *
 * ar-XA and iw-IL are not guesses: AI TALK opened a live chirp_3 socket with
 * each of them at this endpoint (languageRegistry.ts, 2026-09-18).
 */
export const LOCALE_TO_SPEECH: Readonly<Record<string, string>> = {
  ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL',
};

/** The recogniser tag for an interface locale. Georgian when unknown. */
export function speechLanguageFor(locale: unknown): string {
  const key = String(locale ?? '').trim().toLowerCase().slice(0, 2);
  return LOCALE_TO_SPEECH[key] ?? 'ka-GE';
}

/** The interface locale a recogniser tag belongs to, or null. */
export function localeForSpeechTag(tag: unknown): string | null {
  const t = String(tag ?? '').trim().toLowerCase();
  if (!t || t === 'auto') return null;
  if (t.startsWith('iw') || t.startsWith('he')) return 'he';
  const two = t.slice(0, 2);
  return Object.prototype.hasOwnProperty.call(LOCALE_TO_SPEECH, two) ? two : null;
}

export type ClipContainer = 'WEBM' | 'OGG' | 'MP4';

/**
 * What the bytes are, read from their own header rather than from a
 * content-type anybody can set.
 */
export function sniffContainer(audio: Uint8Array): ClipContainer | null {
  if (audio.length < 12) return null;
  // EBML header: WebM (Chrome, Firefox, Edge MediaRecorder).
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) return 'WEBM';
  // "OggS": Ogg (Firefox can produce it).
  if (audio[0] === 0x4f && audio[1] === 0x67 && audio[2] === 0x67 && audio[3] === 0x53) return 'OGG';
  // "ftyp" at offset 4: ISO BMFF (Safari MediaRecorder writes audio/mp4).
  if (audio[4] === 0x66 && audio[5] === 0x74 && audio[6] === 0x79 && audio[7] === 0x70) return 'MP4';
  return null;
}

export type ClipProblem = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_FORMAT';

/** Why a clip will not be sent to Google, or null when it will. */
export function clipProblem(audio: Uint8Array | null | undefined): ClipProblem | null {
  if (!audio || audio.length < MIN_CLIP_BYTES) return 'EMPTY';
  if (audio.length > MAX_CLIP_BYTES) return 'TOO_LARGE';
  if (!sniffContainer(audio)) return 'UNSUPPORTED_FORMAT';
  return null;
}

/** A protobuf Duration as seconds. Null when Google did not say. */
export function durationSeconds(d: unknown): number | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as { seconds?: unknown; nanos?: unknown };
  if (o.seconds == null && o.nanos == null) return null;
  const s = Number(o.seconds ?? 0);
  const n = Number(o.nanos ?? 0);
  if (!Number.isFinite(s) || !Number.isFinite(n)) return null;
  return Math.round((s + n / 1e9) * 1000) / 1000;
}

export interface TranscribeResult {
  ok: true;
  transcript: string;
  /** The recogniser's tag for what it heard (e.g. ka-GE), or the one asked for. */
  languageCode: string;
  /** That tag as one of HOMATCH's interface locales, when it is one. */
  locale: string | null;
  /** Seconds Google billed for. Null when the response did not carry it. */
  billedSeconds: number | null;
  /** The end of the last recognised word, when Google reports it. */
  audioSeconds: number | null;
  confidence: number | null;
  model: string;
  /** True when the requested language was refused and `auto` answered instead. */
  autoFallback: boolean;
  /** Recognize calls made (2 after a fallback): both are billed by Google. */
  attempts: number;
  container: ClipContainer;
}

export interface TranscribeFailure {
  ok: false;
  reason: ClipProblem | 'NOT_CONFIGURED' | 'PROVIDER_REJECTED' | 'PROVIDER_FAILED' | 'TIMEOUT';
  /** Google's own status code when it answered, for the operator. */
  code?: number | null;
}

/** The one call this module makes to Google, injectable so tests need no network. */
export type RecognizeFn = (request: Record<string, unknown>, timeoutMs: number) => Promise<any>;

let sharedClient: SpeechClient | null = null;
let sharedClientRegion = '';

/** Unary Recognize against the configured regional endpoint, one client per region. */
export function googleRecognizer(cfg: SpeechConfig): RecognizeFn {
  return async (request, timeoutMs) => {
    if (!sharedClient || sharedClientRegion !== cfg.region) {
      sharedClient = new SpeechClient({
        projectId: cfg.projectId,
        credentials: JSON.parse(process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '{}'),
        apiEndpoint: speechEndpoint(cfg.region),
      });
      sharedClientRegion = cfg.region;
    }
    const [res] = await sharedClient.recognize(request as any, { timeout: timeoutMs });
    return res;
  };
}

/** The v2 Recognize request. Exported for tests. */
export function buildRecognizeRequest(cfg: SpeechConfig, audio: Uint8Array, languageCode: string): Record<string, unknown> {
  return {
    recognizer: `projects/${cfg.projectId}/locations/${cfg.region}/recognizers/_`,
    config: {
      // The container says what it is; Google decodes WebM/Ogg Opus and MP4.
      autoDecodingConfig: {},
      // ONE code, or `auto`. chirp_3 refuses a list (GoogleSpeechStream.ts).
      languageCodes: [languageCode],
      model: cfg.model,
      features: { enableAutomaticPunctuation: true, enableWordTimeOffsets: false },
    },
    // Bytes as they arrived (express.raw hands over a Buffer, a Uint8Array).
    content: audio,
  };
}

/** Read Google's answer into what HOMI needs. Exported for tests. */
export function readRecognizeResponse(res: any, asked: string): {
  transcript: string; languageCode: string; billedSeconds: number | null; audioSeconds: number | null; confidence: number | null;
} {
  const results = Array.isArray(res?.results) ? res.results : [];
  const parts: string[] = [];
  let language = '';
  let confSum = 0;
  let confN = 0;
  let audioSeconds: number | null = null;
  for (const r of results) {
    const alt = r?.alternatives?.[0];
    const text = String(alt?.transcript ?? '').trim();
    if (text) parts.push(text);
    const c = Number(alt?.confidence);
    if (text && Number.isFinite(c) && c > 0) { confSum += c; confN += 1; }
    if (!language && text && r?.languageCode) language = String(r.languageCode);
    const end = durationSeconds(r?.resultEndOffset);
    if (end != null) audioSeconds = Math.max(audioSeconds ?? 0, end);
  }
  return {
    transcript: parts.join(' ').replace(/\s+/g, ' ').trim(),
    languageCode: language || asked,
    billedSeconds: durationSeconds(res?.metadata?.totalBilledDuration),
    audioSeconds,
    confidence: confN ? Math.round((confSum / confN) * 1000) / 1000 : null,
  };
}

const INVALID_ARGUMENT = 3;
const DEADLINE_EXCEEDED = 4;

function failureFor(e: any): TranscribeFailure {
  const code = typeof e?.code === 'number' ? e.code : null;
  return {
    ok: false,
    reason: code === DEADLINE_EXCEEDED ? 'TIMEOUT' : code === INVALID_ARGUMENT ? 'PROVIDER_REJECTED' : 'PROVIDER_FAILED',
    code,
  };
}

/**
 * Transcribe one voice message.
 *
 * Asks in the person's interface language. If Google refuses that request
 * with INVALID_ARGUMENT (a language tag a model version stopped accepting is
 * the realistic cause), it asks once more with `auto` so the message is not
 * lost. Any other failure is returned as it is.
 */
export async function transcribeVoiceMessage(
  audio: Uint8Array,
  opts: { locale?: unknown; detect?: boolean; timeoutMs?: number },
  cfg: SpeechConfig | null,
  recognize: RecognizeFn | null,
): Promise<TranscribeResult | TranscribeFailure> {
  if (!cfg || !recognize) return { ok: false, reason: 'NOT_CONFIGURED' };
  const problem = clipProblem(audio);
  if (problem) return { ok: false, reason: problem };
  const container = sniffContainer(audio)!;
  const timeoutMs = Math.max(5_000, Math.min(opts.timeoutMs ?? 45_000, 90_000));
  const asked = opts.detect ? 'auto' : speechLanguageFor(opts.locale);

  const attempt = async (languageCode: string) => readRecognizeResponse(
    await recognize(buildRecognizeRequest(cfg, audio, languageCode), timeoutMs), languageCode,
  );

  let autoFallback = false;
  let attempts = 1;
  let read: ReturnType<typeof readRecognizeResponse>;
  try {
    read = await attempt(asked);
  } catch (e: any) {
    if (e?.code !== INVALID_ARGUMENT || asked === 'auto') return failureFor(e);
    attempts = 2;
    try {
      read = await attempt('auto');
      autoFallback = true;
    } catch (e2: any) {
      return failureFor(e2);
    }
  }

  return {
    ok: true,
    transcript: read.transcript,
    languageCode: read.languageCode === 'auto' ? asked : read.languageCode,
    locale: localeForSpeechTag(read.languageCode),
    billedSeconds: read.billedSeconds,
    audioSeconds: read.audioSeconds,
    confidence: read.confidence,
    model: cfg.model,
    autoFallback,
    attempts,
    container,
  };
}
