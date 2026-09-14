// HOMATCH — Google Cloud Speech-to-Text v2, streaming, for Georgian.
//
// WHY THIS LIVES IN THE WORKER AND NOT IN AN EDGE FUNCTION
//
// Google's realtime recognition is `StreamingRecognize`, a bidirectional gRPC
// stream. Supabase edge functions are Deno over HTTP and the browser is a
// browser; neither speaks gRPC, and the REST `:recognize` endpoint is a
// request-per-chunk shape that should not be called realtime. This worker is
// Node on Railway, already deployed from this repository, and the Google
// service-account credentials are already on it. So the stream terminates
// here and the browser talks to it over a WebSocket.
//
// WHAT IT IS CONFIGURED FOR, AND WHY EACH PART
//
//   chirp_3   the only model family that lists Georgian AND supports
//             StreamingRecognize. chirp and chirp_2 list Georgian too but
//             this is the one documented for streaming.
//   ka-GE     the owner's decision. Sent as a single language code rather
//             than a list: asking for detection across several costs
//             accuracy on the one that matters.
//   LINEAR16  raw PCM. The browser already captures and resamples PCM for
//             the existing transcribers, so nothing new has to encode.
//
// WHAT IT NEVER DOES
//
// The credential never leaves this process. The browser is handed a
// short-lived grant that proves Homatch sent it, and nothing else.

/*
 * v2, NAMED EXPLICITLY.
 *
 * `import { SpeechClient } from '@google-cloud/speech'` is the v1 client --
 * the root export is an alias for v1.SpeechClient, which this package has
 * never changed and which nothing in the import site suggests.
 *
 * Every request here is v2 shaped: a `recognizer` path, `streamingConfig`,
 * `explicitDecodingConfig`, and `audio` for the frames. Handed to a v1 client
 * those field names are all unknown, google-gax drops unknown fields rather
 * than throwing, and what reaches Google is an empty message -- which it
 * answers with "Malordered Data Received. Expected audio_content none was
 * set.", naming v1's own field and describing a request nobody wrote.
 *
 * That error is why this took three deploys to find: it reads as a sequencing
 * bug in perfectly correctly sequenced code, and chirp_3 does not exist in v1
 * at all, so the model name was never the thing being rejected.
 */
import { v2 } from '@google-cloud/speech';

const SpeechClient = v2.SpeechClient;
type SpeechClient = InstanceType<typeof v2.SpeechClient>;

/** Google closes a stream at five minutes; restart before it does. */
const STREAM_RESTART_MS = 4 * 60 * 1000;

/** Nothing heard at all for this long means the socket is dead weight. */
const IDLE_TIMEOUT_MS = 90 * 1000;

export interface SpeechConfig {
  projectId: string;
  region: string;
  languageCode: string;
  /**
   * Every language this stream will accept, primary first.
   *
   * Chirp 3 decides per utterance which of these it heard and reports it back,
   * which is the only reliable way to tell English from Turkish: both are
   * Latin script, so nothing downstream can separate them by looking at the
   * transcript. The visitor never picks a language.
   */
  languageCodes: string[];
  model: string;
  sampleRate: number;
}

export interface SpeechEvents {
  onInterim: (text: string, language: string | null) => void;
  onFinal: (text: string, confidence: number | null, language: string | null) => void;
  /** The stream will not carry this session. The caller tells the browser. */
  onUnavailable: (reason: string) => void;
  /** A restart happened and nothing was lost; for diagnostics only. */
  onRestart: () => void;
}

/**
 * Read the service account once, from the environment, and fail loudly here
 * rather than on the first customer's first sentence.
 */
/**
 * The last thing the recogniser refused, kept for the self-test to report.
 *
 * Railway's log API would not return these when they were most needed, and a
 * diagnostic whose answer lives somewhere you cannot reach is not one. It is a
 * single slot on purpose: the interesting error is the current one, and
 * keeping a history of provider messages is keeping somebody else's text
 * around for no reason.
 *
 * Never a credential. Google's gRPC messages describe the request, and the
 * service account is read from the environment and never appears in one.
 */
let lastError: { code: number | null; detail: string; at: string } | null = null;

export function lastRecogniserError(): { code: number | null; detail: string; at: string } | null {
  return lastError;
}

export function speechConfigFromEnv(): SpeechConfig | null {
  return speechConfigProblem() === null ? buildConfig() : null;
}

function buildConfig(): SpeechConfig {
  return {
    projectId: process.env.GOOGLE_SPEECH_PROJECT_ID || '',
    region: (process.env.GOOGLE_SPEECH_REGION || '').trim().toLowerCase(),
    languageCode: primaryLanguage(),
    languageCodes: configuredLanguages(),
    model: process.env.GOOGLE_SPEECH_MODEL || 'chirp_3',
    sampleRate: Number(process.env.GOOGLE_SPEECH_SAMPLE_RATE || 16000),
  };
}

/**
 * Why this worker cannot recognise speech, or null when it can.
 *
 * WHY REGION IS CHECKED HERE AND NOT LEFT TO GOOGLE
 *
 * It was left to Google, and the result was the most expensive kind of green
 * light: /health answered `available: true` for a configuration that could
 * never work, because "available" only ever meant that a credential had
 * parsed. GOOGLE_SPEECH_REGION was set to `global`, the client built
 * `global-speech.googleapis.com`, and that hostname does not exist -- so every
 * stream died on an HTTP 404 wearing a gRPC UNIMPLEMENTED, 167ms after the
 * socket said it was ready and before a byte of audio was sent.
 *
 * Two separate things were wrong and each one alone is fatal:
 *
 *   * `global` is not spelled that way in an endpoint. The global endpoint is
 *     `speech.googleapis.com`, with no prefix at all.
 *   * And it would not help, because the Chirp models are served only from
 *     regional endpoints. `global` cannot run chirp_3 however it is spelled.
 *
 * So a region that cannot serve the configured model is a configuration
 * error, reported by name, at startup, in the health check an operator reads
 * -- not a runtime surprise discovered by the first person to speak Georgian.
 */
/**
 * The languages this worker will recognise, primary first.
 *
 * GOOGLE_SPEECH_LANGUAGES is a comma-separated list; GOOGLE_SPEECH_LANGUAGE
 * remains the primary and is honoured on its own for an older deployment that
 * only sets that one. Homatch's six are the default because they are the six
 * the product already speaks.
 *
 * Capped at four: Google's per-stream limit for multi-language recognition,
 * and a list that silently exceeds it is a stream that fails at the config
 * frame rather than a stream that ignores the extras.
 */
export const MAX_STREAM_LANGUAGES = 4;

/**
 * Whether this deployment may send more than one language code.
 *
 * Off by default. chirp_3 rejects a multi-language config outright, and the
 * failure mode is total: every stream fails, not just the unusual ones.
 */
export function multiLanguageEnabled(): boolean {
  const v = (process.env.GOOGLE_SPEECH_MULTILANG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

const DEFAULT_LANGUAGES = ['ka-GE', 'en-US', 'ru-RU', 'tr-TR'];

export function primaryLanguage(): string {
  const declared = (process.env.GOOGLE_SPEECH_LANGUAGE || '').trim();
  return declared || configuredLanguages()[0] || 'ka-GE';
}

export function configuredLanguages(): string[] {
  const raw = (process.env.GOOGLE_SPEECH_LANGUAGES || '').trim();
  const listed = raw
    ? raw.split(',').map((x) => x.trim()).filter((x) => /^[a-z]{2,3}-[A-Z]{2}$/.test(x))
    : [];
  const primary = (process.env.GOOGLE_SPEECH_LANGUAGE || '').trim();

  const ordered = [primary, ...(listed.length ? listed : DEFAULT_LANGUAGES)].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of ordered) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === MAX_STREAM_LANGUAGES) break;
  }
  return out.length ? out : DEFAULT_LANGUAGES.slice(0, MAX_STREAM_LANGUAGES);
}

export function speechConfigProblem(): string | null {
  if (!process.env.GOOGLE_SPEECH_CREDENTIALS_JSON) return 'GOOGLE_SPEECH_NOT_CONFIGURED';
  if (!process.env.GOOGLE_SPEECH_PROJECT_ID) return 'NO_PROJECT_ID';

  const region = (process.env.GOOGLE_SPEECH_REGION || '').trim().toLowerCase();
  if (!region) return 'NO_REGION';

  const model = process.env.GOOGLE_SPEECH_MODEL || 'chirp_3';
  if (region === 'global' && model.startsWith('chirp')) {
    return 'REGION_GLOBAL_CANNOT_SERVE_CHIRP';
  }
  return null;
}

/**
 * The endpoint for a region.
 *
 * `global` is the one that is not `<region>-speech.googleapis.com`. Kept
 * correct even though the check above refuses global for Chirp, because the
 * day somebody configures a non-Chirp model on global this should work rather
 * than 404 in a new and confusing way.
 */
export function speechEndpoint(region: string): string {
  return region === 'global' ? 'speech.googleapis.com' : `${region}-speech.googleapis.com`;
}

let sharedClient: SpeechClient | null = null;
let sharedClientRegion = '';

/**
 * One client per region, reused.
 *
 * Constructing a SpeechClient parses the credential and opens a gRPC channel.
 * Doing that per conversation adds hundreds of milliseconds to the first word
 * of every call, which is precisely the latency this whole exercise is about.
 */
function client(cfg: SpeechConfig): SpeechClient {
  if (sharedClient && sharedClientRegion === cfg.region) return sharedClient;

  const credentials = JSON.parse(process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '{}');
  sharedClient = new SpeechClient({
    projectId: cfg.projectId,
    credentials,
    // Regional endpoint. The global endpoint does not serve chirp_3, and is
    // not spelled with a prefix either -- see speechConfigProblem().
    apiEndpoint: speechEndpoint(cfg.region),
  });
  sharedClientRegion = cfg.region;
  return sharedClient;
}

/**
 * One conversation's recognition stream.
 *
 * Owns exactly one Google stream at a time and replaces it before Google's
 * own five-minute limit ends it. Audio that arrives during the swap is held
 * and replayed, so a restart is invisible to the person speaking rather than
 * a swallowed word.
 */
export class GoogleSpeechStream {
  private stream: ReturnType<SpeechClient['_streamingRecognize']> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private restarting = false;
  /** Set once the speaker has stopped: no more audio, but the final still matters. */
  private finishing = false;
  private pending: Uint8Array[] = [];
  private framesIn = 0;
  private bytesIn = 0;

  constructor(
    private readonly cfg: SpeechConfig,
    private readonly events: SpeechEvents,
  ) {}

  get frames(): number { return this.framesIn; }
  get bytes(): number { return this.bytesIn; }

  start(): void {
    if (this.closed) return;
    this.open();
    this.touchIdle();
  }

  /**
   * One block of PCM16 at the configured rate.
   *
   * Uint8Array rather than Buffer: `ws` delivers three different shapes and
   * gRPC wants bytes. This is what all of them actually mean, and it keeps
   * the hot path free of Buffer's generic parameter.
   */
  write(chunk: Uint8Array): void {
    if (this.closed || this.finishing || !chunk.length) return;
    this.framesIn += 1;
    this.bytesIn += chunk.byteLength;
    this.touchIdle();

    if (this.restarting || !this.stream) {
      // Held rather than dropped: a restart in the middle of a word must not
      // eat the word.
      this.pending.push(chunk);
      // Bounded, so a stream that never comes back cannot grow without limit.
      if (this.pending.length > 200) this.pending.shift();
      return;
    }
    try {
      this.stream.write({ audio: chunk });
    } catch {
      // A broken pipe is a restart, not a failure of the conversation.
      this.restart('write_failed');
    }
  }

  /**
   * The speaker has stopped. Stop sending audio; do NOT tear the stream down.
   *
   * WHY THIS IS NOT close()
   *
   * close() ends the gRPC stream and immediately removes its listeners, so
   * anything Google sends afterwards lands on a stream nobody is listening to.
   * That is correct for abandoning a session and quietly wrong for ending a
   * sentence, because the final transcript is the last thing to arrive: Google
   * flushes it AFTER the input half-closes.
   *
   * The result was a recogniser that produced interim Georgian all the way
   * through an utterance and then lost the only version of it that was going
   * to be acted on. The last thing somebody says in a conversation is not a
   * good thing to drop.
   *
   * So the input half-closes, the listeners stay, the restart timer is
   * cancelled -- a stream ending because we ended it must not be resurrected
   * -- and the caller waits, briefly, for the sentence to come back.
   */
  halfClose(): void {
    if (this.closed || this.finishing) return;
    this.finishing = true;
    this.clearRestart();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    try { this.stream?.end(); } catch { /* already gone */ }
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.end();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private open(): void {
    const cfg = this.cfg;
    const recognizer = `projects/${cfg.projectId}/locations/${cfg.region}/recognizers/_`;
    let s: ReturnType<SpeechClient['_streamingRecognize']>;
    try {
      /*
       * `_streamingRecognize`, NOT `streamingRecognize`. THE UNDERSCORE IS THE
       * WHOLE FEATURE.
       *
       * @google-cloud/speech ships a convenience wrapper written for v1 and
       * installs it onto the v2 client's prototype as well:
       *
       *     Object.defineProperty(v2.SpeechClient.prototype,
       *       'streamingRecognize', ...ImprovedStreamingClient...)
       *
       * That wrapper has a v1 shape and v1 semantics. Its first argument is a
       * streaming config, not call options. It sends the first message itself,
       * as `{ streamingConfig }` and NOTHING ELSE -- there is no `recognizer`
       * field anywhere in it, because v1 has no such concept. Then it treats
       * everything the caller writes as raw audio and wraps it as
       * `{ audioContent }`, which is again v1's field name.
       *
       * So every v2 request this file carefully built was being fed to it as
       * if it were a buffer of PCM, and what actually reached Google was a
       * config message with no recognizer. Google said "Invalid resource field
       * value in the request", which was precisely true and read like the
       * recognizer path was malformed.
       *
       * That is why a recognizer name which certainly does not exist gave the
       * same error instead of NOT_FOUND -- no name was ever sent -- why the
       * error was identical in all eight locations, why moving regions did
       * nothing, and why the identical path through the unary API returned
       * Georgian on the first attempt. It is also why adding the routing
       * header changed nothing: the object carrying it was swallowed as the
       * wrapper's `streamingConfig` argument.
       *
       * `_streamingRecognize` is the generated v2 method. It is declared in
       * the published .d.ts and takes CallOptions, and every message on it is
       * ours. The underscore reads like a private detail; here it is the only
       * correct entry point.
       */
      s = client(cfg)._streamingRecognize({
        otherArgs: {
          headers: { 'x-goog-request-params': `recognizer=${encodeURIComponent(recognizer)}` },
        },
      });
    } catch (e) {
      this.events.onUnavailable('CLIENT_FAILED');
      return;
    }

    s.on('data', (response: any) => {
      for (const result of response?.results ?? []) {
        const alt = result?.alternatives?.[0];
        const text = String(alt?.transcript ?? '').trim();
        if (!text) continue;
        // Which of the configured languages Google decided it heard. Absent
        // on some interim results, which is why it is optional downstream.
        const heard = typeof result?.languageCode === 'string' && result.languageCode
          ? String(result.languageCode)
          : null;

        if (result.isFinal) {
          const c = typeof alt?.confidence === 'number' ? alt.confidence : null;
          this.events.onFinal(text, c, heard);
        } else {
          this.events.onInterim(text, heard);
        }
      }
    });

    s.on('error', (err: any) => {
      if (this.closed) return;
      /*
       * Google ends a stream that has run its course with an OUT_OF_RANGE or a
       * deadline, which is housekeeping rather than a fault. Anything else is
       * reported once and the socket is given up: a recogniser that silently
       * retries a permission error forever looks exactly like one that works.
       */
      const code = Number(err?.code);
      const retryable = code === 11 /* OUT_OF_RANGE */ || code === 4 /* DEADLINE_EXCEEDED */ || code === 14 /* UNAVAILABLE */;

      /*
       * THE CODE AND THE PROVIDER'S OWN SENTENCE, IN THE LOG.
       *
       * This used to report a bucketed word to the browser and keep nothing.
       * The first time it actually fired in production the answer was
       * "PROVIDER_ERROR", which is the default arm of a switch and says only
       * that the code was none of the five that were anticipated -- so the one
       * moment the diagnostic existed for was the one moment it was useless.
       *
       * Google's gRPC message describes a misconfigured request, never a
       * credential: the service account is loaded from the environment and
       * never appears in an error string. Bounded anyway, because a provider
       * message is somebody else's text and does not get to be unbounded in
       * Homatch's logs.
       */
      lastError = {
        code: Number.isFinite(code) ? code : null,
        detail: String(err?.details ?? err?.message ?? '').slice(0, 300),
        at: new Date().toISOString(),
      };

      console.log(JSON.stringify({
        at: new Date().toISOString(),
        service: 'speech',
        event: 'recogniser_error',
        code: Number.isFinite(code) ? code : null,
        retryable,
        detail: String(err?.details ?? err?.message ?? '').slice(0, 300),
      }));

      if (retryable) { this.restart(`grpc_${code}`); return; }
      this.events.onUnavailable(recogniserReason(code));
    });

    s.on('end', () => {
      if (this.closed || this.restarting || this.finishing) return;
      this.restart('stream_ended');
    });

    // The v2 config goes in the first message and nothing else may be sent
    // with it.
    s.write({
      recognizer,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: 'LINEAR16',
            sampleRateHertz: cfg.sampleRate,
            audioChannelCount: 1,
          },
          /*
           * ONE LANGUAGE, UNLESS THE PROVIDER IS KNOWN TO TAKE MORE.
           *
           * Sending the whole candidate set looked obviously right -- Chirp
           * picks one per utterance and names it back, which is exactly what
           * a "just start talking" product needs. chirp_3 refuses it:
           * INVALID_ARGUMENT, "Invalid arguments were provided.", before a
           * byte of audio.
           *
           * That is a provider constraint, not a configuration mistake, and
           * the important part is what it costs if this is got wrong. A
           * rejected config is not a degraded experience; it is EVERY stream
           * failing, in every language, including the one that worked. So
           * multi-language is opt-in and the default is the single language
           * this session settled on.
           *
           * What chirp_3 DOES accept is the single code `auto`, which is the
           * provider's own automatic detection and which reports the language
           * it chose on every result -- the thing that makes a "just start
           * talking" product possible, and the thing an explicit list was
           * only ever a guess at. Measured, not assumed:
           *
           *   chirp_3  ['ka-GE']                   accepted
           *   chirp_3  ['auto']                    accepted
           *   chirp_3  ['ka-GE','en-US',...]       INVALID_ARGUMENT
           *   chirp_2  anything                    not served in this region
           *
           * GOOGLE_SPEECH_MULTILANG=1 selects `auto`. The candidate list is
           * still carried and still bounds what the SESSION will act on;
           * it is simply not what the recogniser is configured with.
           * /health/speech-languages re-runs the measurement above.
           */
          languageCodes: multiLanguageEnabled() ? ['auto'] : [cfg.languageCode],
          model: cfg.model,
          features: {
            enableAutomaticPunctuation: true,
            // Word timings cost nothing here and are not used; left off so
            // the response stays small on a realtime path.
            enableWordTimeOffsets: false,
          },
        },
        streamingFeatures: {
          // The whole point: text while they are still speaking.
          interimResults: true,
          // Google's own end-of-utterance detection. Homatch already has a
          // turn detector; this supplies the provider's opinion as evidence
          // rather than replacing it — see SpeechGateway for how the two meet.
          enableVoiceActivityEvents: true,
        },
      },
    });

    this.stream = s;

    // Replay anything held during the swap, oldest first.
    const held = this.pending;
    this.pending = [];
    for (const c of held) {
      try { s.write({ audio: c }); } catch { /* the error handler restarts */ }
    }

    this.clearRestart();
    this.restartTimer = setTimeout(() => this.restart('scheduled'), STREAM_RESTART_MS);
  }

  private restart(_why: string): void {
    if (this.closed || this.restarting) return;
    this.restarting = true;
    this.end();
    // Immediate: a gap here is a gap in somebody's sentence.
    setImmediate(() => {
      if (this.closed) return;
      this.restarting = false;
      this.open();
      this.events.onRestart();
    });
  }

  private end(): void {
    const s = this.stream;
    this.stream = null;
    if (!s) return;
    try { s.end(); } catch { /* already gone */ }
    try { s.removeAllListeners(); } catch { /* already gone */ }
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.events.onUnavailable('IDLE');
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  private clearRestart(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
  }

  private clearTimers(): void {
    this.clearRestart();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
}

/**
 * A gRPC status turned into something an operator can act on.
 *
 * Never the provider's own message: it can contain the project and the
 * recogniser path, and this string is on its way to a browser.
 */
function recogniserReason(code: number): string {
  switch (code) {
    case 7: return 'PERMISSION_DENIED';
    case 16: return 'UNAUTHENTICATED';
    case 8: return 'QUOTA_EXCEEDED';
    case 3: return 'BAD_CONFIG';
    case 5: return 'RECOGNISER_NOT_FOUND';
    // The number matters. A bare 'PROVIDER_ERROR' cost a deploy cycle once.
    default: return Number.isFinite(code) ? `PROVIDER_ERROR_${code}` : 'PROVIDER_ERROR';
  }
}
