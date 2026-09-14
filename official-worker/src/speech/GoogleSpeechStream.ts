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

import { SpeechClient } from '@google-cloud/speech';

/** Google closes a stream at five minutes; restart before it does. */
const STREAM_RESTART_MS = 4 * 60 * 1000;

/** Nothing heard at all for this long means the socket is dead weight. */
const IDLE_TIMEOUT_MS = 90 * 1000;

export interface SpeechConfig {
  projectId: string;
  region: string;
  languageCode: string;
  model: string;
  sampleRate: number;
}

export interface SpeechEvents {
  onInterim: (text: string) => void;
  onFinal: (text: string, confidence: number | null) => void;
  /** The stream will not carry this session. The caller tells the browser. */
  onUnavailable: (reason: string) => void;
  /** A restart happened and nothing was lost; for diagnostics only. */
  onRestart: () => void;
}

/**
 * Read the service account once, from the environment, and fail loudly here
 * rather than on the first customer's first sentence.
 */
export function speechConfigFromEnv(): SpeechConfig | null {
  const projectId = process.env.GOOGLE_SPEECH_PROJECT_ID || '';
  const region = process.env.GOOGLE_SPEECH_REGION || '';
  const creds = process.env.GOOGLE_SPEECH_CREDENTIALS_JSON || '';
  if (!projectId || !region || !creds) return null;
  return {
    projectId,
    region,
    languageCode: process.env.GOOGLE_SPEECH_LANGUAGE || 'ka-GE',
    model: process.env.GOOGLE_SPEECH_MODEL || 'chirp_3',
    sampleRate: Number(process.env.GOOGLE_SPEECH_SAMPLE_RATE || 16000),
  };
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
    // Regional endpoint. The global endpoint does not serve chirp_3.
    apiEndpoint: `${cfg.region}-speech.googleapis.com`,
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
  private stream: ReturnType<SpeechClient['streamingRecognize']> | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private restarting = false;
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
    if (this.closed || !chunk.length) return;
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

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.end();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private open(): void {
    const cfg = this.cfg;
    let s: ReturnType<SpeechClient['streamingRecognize']>;
    try {
      s = client(cfg).streamingRecognize();
    } catch (e) {
      this.events.onUnavailable('CLIENT_FAILED');
      return;
    }

    s.on('data', (response: any) => {
      for (const result of response?.results ?? []) {
        const alt = result?.alternatives?.[0];
        const text = String(alt?.transcript ?? '').trim();
        if (!text) continue;
        if (result.isFinal) {
          const c = typeof alt?.confidence === 'number' ? alt.confidence : null;
          this.events.onFinal(text, c);
        } else {
          this.events.onInterim(text);
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
      if (this.closed || this.restarting) return;
      this.restart('stream_ended');
    });

    // The v2 config goes in the first message and nothing else may be sent
    // with it.
    s.write({
      recognizer: `projects/${cfg.projectId}/locations/${cfg.region}/recognizers/_`,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: 'LINEAR16',
            sampleRateHertz: cfg.sampleRate,
            audioChannelCount: 1,
          },
          languageCodes: [cfg.languageCode],
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
