// HOMATCH SPEECH — which language configurations this project can actually use.
//
// The multi-language config was the obvious design: hand Chirp the candidate
// set, let it decide per utterance, and the visitor never picks a language.
// chirp_3 answers INVALID_ARGUMENT and takes every stream down with it.
//
// "Obviously right" has now been wrong four times on this integration — the
// region, the API version, the client wrapper, and this — and each time the
// answer came from asking the provider rather than from reasoning about it.
// So this asks: a handful of real StreamingRecognize configurations, one
// short frame of audio each, reporting which are accepted.
//
// No audio content is judged here. The question is only whether the request
// is legal, which is the question that was answered wrong.

// v2, named explicitly: the package root exports the v1 client.
import { v2 } from '@google-cloud/speech';
import { speechEndpoint } from './GoogleSpeechStream.js';

const SpeechClient = v2.SpeechClient;
type SpeechClient = InstanceType<typeof v2.SpeechClient>;

export interface LanguageAttempt {
  name: string;
  model: string;
  languageCodes: string[];
  accepted: boolean;
  code: number | null;
  detail: string;
  ms: number;
}

interface Opts {
  projectId: string;
  credentials: Record<string, unknown>;
  region: string;
  sampleRate: number;
  audio: Buffer;
}

async function attempt(
  name: string, model: string, languageCodes: string[], o: Opts,
): Promise<LanguageAttempt> {
  const started = Date.now();
  const recognizer = `projects/${o.projectId}/locations/${o.region}/recognizers/_`;
  const client = new SpeechClient({
    projectId: o.projectId,
    credentials: o.credentials,
    apiEndpoint: speechEndpoint(o.region),
  });

  const outcome = await new Promise<{ accepted: boolean; code: number | null; detail: string }>((resolve) => {
    let settled = false;
    const done = (accepted: boolean, code: number | null, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ accepted, code, detail: detail.slice(0, 200) });
    };
    const timer = setTimeout(() => done(false, null, 'TIMEOUT'), 15_000);

    const stream = client._streamingRecognize({
      otherArgs: { headers: { 'x-goog-request-params': `recognizer=${encodeURIComponent(recognizer)}` } },
    });

    stream.on('error', (err: { code?: number; details?: string; message?: string }) => {
      done(false, Number.isFinite(Number(err?.code)) ? Number(err.code) : null,
        String(err?.details ?? err?.message ?? 'unknown'));
    });
    // Any response at all means the configuration was legal.
    stream.on('data', () => done(true, null, 'accepted'));
    stream.on('end', () => done(true, null, 'accepted, stream ended'));

    try {
      stream.write({
        recognizer,
        streamingConfig: {
          config: {
            explicitDecodingConfig: {
              encoding: 'LINEAR16', sampleRateHertz: o.sampleRate, audioChannelCount: 1,
            },
            languageCodes,
            model,
          },
          streamingFeatures: { interimResults: true },
        },
      });
      for (let off = 0; off < o.audio.length; off += 3200) {
        stream.write({ audio: o.audio.subarray(off, Math.min(off + 3200, o.audio.length)) });
      }
    } catch (e: unknown) {
      done(false, null, `WRITE: ${String((e as Error)?.message ?? e)}`);
    }
  });

  try { await client.close(); } catch { /* the probe is over either way */ }
  return { name, model, languageCodes, ...outcome, ms: Date.now() - started };
}

/**
 * The configurations worth knowing about, in the order they matter.
 *
 * The single-language control is first on purpose: if THAT fails, the answer
 * is not about multi-language at all and everything below it is noise.
 */
export async function probeLanguageConfigs(o: Opts & { primary: string; candidates: string[] }): Promise<{
  region: string;
  attempts: LanguageAttempt[];
  multiLanguageModel: string | null;
}> {
  const multi = o.candidates.slice(0, 4);
  const attempts: LanguageAttempt[] = [];

  attempts.push(await attempt('chirp_3 single (control)', 'chirp_3', [o.primary], o));
  attempts.push(await attempt('chirp_3 multi', 'chirp_3', multi, o));
  attempts.push(await attempt('chirp_3 auto', 'chirp_3', ['auto'], o));
  attempts.push(await attempt('chirp_2 multi', 'chirp_2', multi, o));
  attempts.push(await attempt('chirp_2 auto', 'chirp_2', ['auto'], o));
  attempts.push(await attempt('chirp_2 single', 'chirp_2', [o.primary], o));

  // A model that took more than one code, if any did.
  const winner = attempts.find((a) => a.accepted && a.languageCodes.length > 1)
    ?? attempts.find((a) => a.accepted && a.languageCodes[0] === 'auto')
    ?? null;

  return { region: o.region, attempts, multiLanguageModel: winner ? winner.model : null };
}
