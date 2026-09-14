// HOMATCH SPEECH — which region will actually serve this model.
//
// WHY THIS IS NOT A LOOKUP TABLE
//
// Google publishes where the Chirp models run, and that list moves, and it is
// scoped per project and per language. Hardcoding "chirp_3 lives in
// europe-west4" is how this failed the first time, in the other direction:
// GOOGLE_SPEECH_REGION was set to `global` on the strength of it sounding
// right, /health said available because a credential had parsed, and every
// stream then died on a hostname that does not exist.
//
// So this asks. It opens a real StreamingRecognize to each candidate endpoint
// with the real credential and the real config, and reports what came back. No
// audio is sent -- the question is whether the config is implemented there, and
// that is answered by the response to the first frame.
//
// WHAT IT IS NOT
//
// Not a proof that recognition works. A region accepting the configuration
// says the request is implemented, nothing more. The full chain is
// /health/speech-selftest, which sends real Georgian and reads real text back.
// Keeping the two apart matters: this workstream has already mistaken one kind
// of green light for another once.

// v2, named explicitly: the package root exports the v1 client, and v1 has
// no chirp_3 and no `recognizer` field. See GoogleSpeechStream.ts.
import { v2 } from '@google-cloud/speech';

const SpeechClient = v2.SpeechClient;
type SpeechClient = InstanceType<typeof v2.SpeechClient>;
import { speechEndpoint } from './GoogleSpeechStream.js';

/**
 * Where Chirp has plausibly been served, widest first.
 *
 * An allow-list rather than a free-text parameter because this endpoint is
 * public and each entry opens a billable connection. Adding a region is a
 * commit, which is the correct amount of friction.
 */
export const CANDIDATE_REGIONS = [
  'us-central1',
  'europe-west4',
  'us',
  'eu',
  'asia-southeast1',
  'europe-west1',
  'us-east1',
];

export interface RegionResult {
  region: string;
  endpoint: string;
  accepted: boolean;
  code: number | null;
  detail: string;
  ms: number;
}

/**
 * One candidate: construct a client, write the config, see what happens.
 *
 * Bounded hard. An endpoint that does not exist fails fast, but an endpoint
 * that exists and simply never answers must not hold this request open.
 */
async function probeOne(
  region: string,
  opts: { projectId: string; credentials: unknown; model: string; language: string; sampleRate: number },
): Promise<RegionResult> {
  const started = Date.now();
  const endpoint = speechEndpoint(region);
  const holder: { client: SpeechClient | null } = { client: null };

  const result = await new Promise<RegionResult>((resolve) => {
    let settled = false;
    const done = (accepted: boolean, code: number | null, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ region, endpoint, accepted, code, detail: detail.slice(0, 200), ms: Date.now() - started });
    };

    const timer = setTimeout(() => done(false, null, 'TIMEOUT'), 12_000);

    let client: SpeechClient;
    try {
      client = new SpeechClient({
        projectId: opts.projectId,
        credentials: opts.credentials as Record<string, unknown>,
        apiEndpoint: endpoint,
      });
      holder.client = client;
    } catch (e: unknown) {
      done(false, null, `CLIENT_CONSTRUCT: ${String((e as Error)?.message ?? e)}`);
      return;
    }

    const stream = client.streamingRecognize();

    stream.on('error', (err: { code?: number; details?: string; message?: string }) => {
      const code = Number.isFinite(Number(err?.code)) ? Number(err.code) : null;
      const detail = String(err?.details ?? err?.message ?? 'unknown');

      /*
       * A COMPLAINT ABOUT THE MISSING AUDIO IS A PASS.
       *
       * Sending a config and immediately half-closing gets INVALID_ARGUMENT
       * and "Malordered Data Received. Expected audio_content none was set."
       * from a region that is perfectly happy: Google parsed the recognizer,
       * the model and the language, found them all implemented, and then
       * objected to the one thing this probe deliberately does not send.
       *
       * Reading that as a failure would have thrown away the right answer.
       * The first sweep rejected `us` and `eu` on exactly this and reported
       * firstWorking: null while both were working.
       *
       * A region that does NOT implement the configuration never gets that
       * far: it answers 12, UNIMPLEMENTED, before looking at the audio at all.
       */
      const wantedAudio = code === 3 && /audio_content|Malordered/i.test(detail);
      done(wantedAudio, code, wantedAudio ? `config accepted (${detail})` : detail);
    });

    /*
     * Google answers a valid streaming config with an empty first response
     * rather than silence, so anything arriving at all means the request was
     * implemented and understood here. `end` without an error means the same.
     */
    stream.on('data', () => done(true, null, 'config accepted'));
    stream.on('end', () => done(true, null, 'config accepted, stream ended'));

    try {
      stream.write({
        recognizer: `projects/${opts.projectId}/locations/${region}/recognizers/_`,
        streamingConfig: {
          config: {
            explicitDecodingConfig: {
              encoding: 'LINEAR16',
              sampleRateHertz: opts.sampleRate,
              audioChannelCount: 1,
            },
            languageCodes: [opts.language],
            model: opts.model,
          },
          streamingFeatures: { interimResults: true },
        },
      });
      // Nothing else is coming. Half-closing asks Google to respond to the
      // config rather than wait for audio that will never arrive.
      stream.end();
    } catch (e: unknown) {
      done(false, null, `WRITE: ${String((e as Error)?.message ?? e)}`);
    }
  });

  try { await holder.client?.close(); } catch { /* the probe is over either way */ }
  return result;
}

/**
 * Every candidate, in sequence.
 *
 * Sequential on purpose: seven simultaneous gRPC channels on a container that
 * is also running Chromium is a good way to turn a diagnostic into an
 * incident, and the whole sweep still finishes in seconds.
 */
export async function probeRegions(opts: {
  projectId: string;
  credentialsJson: string;
  model: string;
  language: string;
  sampleRate: number;
  regions?: string[];
}): Promise<{ model: string; language: string; results: RegionResult[]; firstWorking: string | null }> {
  let credentials: unknown;
  try {
    credentials = JSON.parse(opts.credentialsJson || '{}');
  } catch {
    return { model: opts.model, language: opts.language, results: [], firstWorking: null };
  }

  const regions = (opts.regions ?? CANDIDATE_REGIONS).filter((r) => CANDIDATE_REGIONS.includes(r));
  const results: RegionResult[] = [];
  for (const region of regions) {
    results.push(await probeOne(region, {
      projectId: opts.projectId, credentials,
      model: opts.model, language: opts.language, sampleRate: opts.sampleRate,
    }));
  }

  return {
    model: opts.model,
    language: opts.language,
    results,
    firstWorking: results.find((r) => r.accepted)?.region ?? null,
  };
}
