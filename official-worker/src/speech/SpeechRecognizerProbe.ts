// HOMATCH SPEECH — which recognizer path StreamingRecognize will accept.
//
// WHERE THIS GOT TO
//
// ListRecognizers succeeds against every candidate location, so the credential
// is good, the API is enabled, the project is right and the locations exist.
// StreamingRecognize against the same locations answers 3, "Invalid resource
// field value in the request", for
//
//     projects/<project>/locations/<location>/recognizers/_
//
// Everything in that path has now been verified except the last segment. So
// this asks about the last segment, three ways, and stops the guessing:
//
//   inline   `recognizers/_`, the documented way to stream without creating a
//            recognizer resource first. What the worker uses today.
//   missing  a recognizer name that certainly does not exist. If the service
//            answers NOT_FOUND here but INVALID_ARGUMENT for `_`, then `_` is
//            being rejected as a malformed value rather than looked up -- and
//            the fix is a real Recognizer, not a different region.
//   unary    the same `_` through Recognize instead of StreamingRecognize. If
//            unary accepts what streaming refuses, the constraint is specific
//            to streaming and is worth knowing before creating anything.
//
// No resource is created here. Creating one in somebody's cloud project is a
// decision, and it should be made on evidence rather than to see what happens.

// v2, named explicitly: the package root exports the v1 client, and v1 has
// no chirp_3 and no `recognizer` field. See GoogleSpeechStream.ts.
import { v2 } from '@google-cloud/speech';
import { speechEndpoint } from './GoogleSpeechStream.js';

const SpeechClient = v2.SpeechClient;
type SpeechClient = InstanceType<typeof v2.SpeechClient>;

export interface Attempt {
  name: string;
  recognizer: string;
  ok: boolean;
  code: number | null;
  detail: string;
  ms: number;
}

interface Opts {
  projectId: string;
  credentials: Record<string, unknown>;
  region: string;
  model: string;
  language: string;
  sampleRate: number;
  /** A short slice of real audio, so unary recognition has something to chew. */
  audio: Buffer;
}

function recognitionConfig(o: Opts): Record<string, unknown> {
  return {
    explicitDecodingConfig: {
      encoding: 'LINEAR16',
      sampleRateHertz: o.sampleRate,
      audioChannelCount: 1,
    },
    languageCodes: [o.language],
    model: o.model,
  };
}

function clientFor(o: Opts): SpeechClient {
  return new SpeechClient({
    projectId: o.projectId,
    credentials: o.credentials,
    apiEndpoint: speechEndpoint(o.region),
  });
}

/** One streaming attempt against a given recognizer path. */
async function streamAttempt(name: string, recognizer: string, o: Opts): Promise<Attempt> {
  const started = Date.now();
  const client = clientFor(o);

  const outcome = await new Promise<{ ok: boolean; code: number | null; detail: string }>((resolve) => {
    let settled = false;
    const done = (ok: boolean, code: number | null, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, code, detail: detail.slice(0, 200) });
    };
    const timer = setTimeout(() => done(false, null, 'TIMEOUT'), 12_000);

    // The routing header gax cannot infer for a bidirectional stream. See
    // GoogleSpeechStream.open(). Probing without it only re-measures its
    // absence, which is now a known quantity.
    const stream = client.streamingRecognize({
      otherArgs: { headers: { 'x-goog-request-params': `recognizer=${encodeURIComponent(recognizer)}` } },
    } as never);
    stream.on('error', (err: { code?: number; details?: string; message?: string }) => {
      const code = Number.isFinite(Number(err?.code)) ? Number(err.code) : null;
      const detail = String(err?.details ?? err?.message ?? 'unknown');
      // A complaint about the audio means the resource field was accepted --
      // the service got as far as looking for the audio this never sends.
      const wantedAudio = code === 3 && /audio_content|Malordered/i.test(detail);
      done(wantedAudio, code, wantedAudio ? `recognizer accepted (${detail})` : detail);
    });
    stream.on('data', () => done(true, null, 'recognizer accepted'));
    stream.on('end', () => done(true, null, 'recognizer accepted, stream ended'));

    try {
      stream.write({ recognizer, streamingConfig: { config: recognitionConfig(o), streamingFeatures: { interimResults: true } } });
      stream.end();
    } catch (e: unknown) {
      done(false, null, `WRITE: ${String((e as Error)?.message ?? e)}`);
    }
  });

  try { await client.close(); } catch { /* the attempt is over either way */ }
  return { name, recognizer, ...outcome, ms: Date.now() - started };
}

/** The same path through the unary API, which has different rules. */
async function unaryAttempt(name: string, recognizer: string, o: Opts): Promise<Attempt> {
  const started = Date.now();
  const client = clientFor(o);
  try {
    const [res] = await client.recognize({
      recognizer,
      config: recognitionConfig(o),
      content: o.audio,
    });
    const results = (res?.results ?? []) as Array<{ alternatives?: Array<{ transcript?: string }> }>;
    const text = results.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ').trim();
    return {
      name, recognizer, ok: true, code: null,
      detail: text ? `recognised: ${text.slice(0, 120)}` : 'accepted, no transcript',
      ms: Date.now() - started,
    };
  } catch (e: unknown) {
    const err = e as { code?: number; details?: string; message?: string };
    return {
      name, recognizer, ok: false,
      code: Number.isFinite(Number(err?.code)) ? Number(err.code) : null,
      detail: String(err?.details ?? err?.message ?? e).slice(0, 200),
      ms: Date.now() - started,
    };
  } finally {
    try { await client.close(); } catch { /* done */ }
  }
}

export async function probeRecognizers(o: Opts): Promise<{ region: string; model: string; attempts: Attempt[] }> {
  const parent = `projects/${o.projectId}/locations/${o.region}/recognizers`;
  const attempts: Attempt[] = [];

  attempts.push(await streamAttempt('streaming inline `_`', `${parent}/_`, o));
  attempts.push(await streamAttempt('streaming missing name', `${parent}/homatch-ka-not-created`, o));
  attempts.push(await unaryAttempt('unary inline `_`', `${parent}/_`, o));

  return { region: o.region, model: o.model, attempts };
}
