// HOMATCH AI TALK — transcription that keeps up with the speaker.
//
// WHY THIS EXISTS BESIDE THE BATCH PATH AND NOT INSTEAD OF IT
//
// Batch transcription cannot start reading the audio until the sentence has
// ended, because the audio is a file that does not exist until then. Measured
// on production: a 0.7 second silence gate to decide the sentence was over,
// then 1.5 seconds to upload and transcribe it — 2.2 seconds before the model
// had seen a word.
//
// The same audio through the realtime socket, measured the same day, same
// Georgian sentence: the provider's own voice detection committed the turn
// 125 ms after the speaker stopped, the first words came back 630 ms after
// that, and the finished transcript at 1.07 seconds. The audio had already
// been streamed while they were talking, so there was nothing left to upload.
//
// It is not a replacement because it is not always available. The credential
// is minted per session and can be refused — a model this account cannot use,
// a provider outage, a network that will not hold a socket. When any of that
// happens the batch path is still there and the conversation still works, a
// little slower. An optimisation with a fallback, not a dependency.
//
// WHAT IT NEVER HOLDS
//
// Not the API key. The credential is ephemeral, minted server-side, scoped to
// transcription alone: it cannot generate text, cannot generate speech, and
// expires in minutes.

import { GoogleTranscriber } from './googleTranscribe.ts';
import { ScribeTranscriber } from './scribeTranscribe.ts';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

/** The rate the socket is configured for, server-side. */
export const LIVE_SAMPLE_RATE = 24_000;

export interface LiveGrant {
  token: string;
  model?: string;
  sampleRate?: number;
  /**
   * Which protocol this token speaks.
   *
   * Decided server-side by which provider actually answered, not by the
   * browser. GOOGLE leads for Georgian when an operator has enabled it and
   * the worker holding the credential is actually up; ELEVENLABS is the
   * fallback that can still write Georgian; OPENAI carried this before both
   * and stays behind them.
   */
  provider?: 'GOOGLE' | 'ELEVENLABS' | 'OPENAI';
  /**
   * Where to connect, for a provider the browser cannot reach directly.
   *
   * Google's realtime recognition is gRPC, which no browser speaks, so that
   * stream terminates on Homatch's own worker and this is its address. The
   * other two providers take a socket at their own hostname and leave this
   * empty.
   */
  wsUrl?: string;
  /**
   * The terms the transcriber should be primed with, already chosen.
   *
   * A few dozen, selected server-side for this conversation out of a corpus
   * of over a thousand. The browser sends what it is given and never adds to
   * it -- see scribeTranscribe.ts for why that matters.
   */
  keyterms?: string[];
  /** Sent only once the conversation has settled into a language. */
  languageCode?: string | null;
  /** Every language this conversation could plausibly be in, primary first. */
  languages?: string[];
}

/**
 * What a transcription socket has to be, whoever is carrying it.
 *
 * Small on purpose: the session decides what a finished sentence means, and
 * a socket that also had opinions about turns would mean two things deciding
 * when somebody stopped talking.
 */
export interface LiveSocket {
  readonly isReady: boolean;
  readonly frames: number;
  readonly bytes: number;
  open(timeoutMs?: number): Promise<boolean>;
  setGated(gated: boolean): void;
  append(pcm: Int16Array): void;
  close(): void;
}

export interface LiveCallbacks {
  /** They have started speaking, per the provider's own voice detection. */
  onSpeechStart: () => void;
  /** They have stopped. The turn is committed at this moment, not later. */
  onSpeechEnd: () => void;
  /** Words while they are still arriving. Never committed to history. */
  onPartial: (text: string) => void;
  /**
   * The finished sentence, and the language the provider decided it was in.
   *
   * The language matters because nothing downstream can work it out: Georgian,
   * Hebrew, Arabic and Russian are separable by script, but English and
   * Turkish are the same alphabet and would be guessed wrong forever. The
   * recogniser is the only component that actually knows.
   */
  onFinal: (text: string, language?: string | null) => void;
  /** The socket will not carry this session. The caller falls back. */
  onUnavailable: (reason: string) => void;
}

/**
 * One live transcription socket.
 *
 * Deliberately owns nothing but the socket and the text. It does not know
 * about turns, playback, or state — the session does, and keeping that here
 * would mean two things deciding when somebody has finished speaking.
 */
export class LiveTranscriber implements LiveSocket {
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  /** Accumulated deltas for the utterance currently being transcribed. */
  private partial = '';
  /** True while the assistant is speaking: frames are dropped, not sent. */
  private gated = false;
  private framesSent = 0;
  private bytesSent = 0;

  constructor(private readonly grant: LiveGrant, private readonly cb: LiveCallbacks) {}

  get isReady(): boolean { return this.ready && this.socket?.readyState === WebSocket.OPEN; }
  get frames(): number { return this.framesSent; }
  get bytes(): number { return this.bytesSent; }

  /**
   * Open the socket, or report that it will not open.
   *
   * Resolves either way. A caller that has to decide between two paths should
   * not also have to catch.
   */
  async open(timeoutMs = 8000): Promise<boolean> {
    /*
     * The credential travels as a WebSocket subprotocol.
     *
     * A browser cannot set an Authorization header on a WebSocket, so this is
     * the documented route — and it is why the credential must be ephemeral
     * and narrowly scoped: a subprotocol is visible to anything that can see
     * the connection.
     */
    let socket: WebSocket;
    try {
      socket = new WebSocket(REALTIME_URL, [
        'realtime',
        `openai-insecure-api-key.${this.grant.token}`,
      ]);
    } catch {
      this.cb.onUnavailable('SOCKET_REFUSED');
      return false;
    }

    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onmessage = (event) => this.onEvent(event);
    socket.onerror = () => {
      if (!this.closed) this.cb.onUnavailable('SOCKET_ERROR');
      this.ready = false;
    };
    socket.onclose = () => {
      // A socket that dies mid-conversation must be reported, not ignored.
      // The whole class of bug this product has already paid for is a
      // transport that stopped while the panel went on saying "Listening".
      const wasReady = this.ready;
      this.ready = false;
      if (!this.closed && wasReady) this.cb.onUnavailable('SOCKET_CLOSED');
    };

    const opened = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(socket.readyState === WebSocket.OPEN), timeoutMs);
      socket.onopen = () => { window.clearTimeout(timer); resolve(true); };
    });

    if (!opened) {
      this.cb.onUnavailable('SOCKET_TIMEOUT');
      try { socket.close(); } catch { /* already */ }
      return false;
    }

    this.ready = true;
    return true;
  }

  /** Drop frames without closing: the assistant is speaking. */
  setGated(gated: boolean): void {
    if (gated === this.gated) return;
    this.gated = gated;
    if (!gated) {
      // Anything the microphone heard of our own voice is discarded rather
      // than transcribed as though they had said it.
      this.send({ type: 'input_audio_buffer.clear' });
      this.partial = '';
    }
  }

  /** One block of microphone audio, already at LIVE_SAMPLE_RATE. */
  append(pcm: Int16Array): void {
    if (!this.isReady || this.gated || !pcm.length) return;
    this.framesSent += 1;
    this.bytesSent += pcm.byteLength;
    this.send({ type: 'input_audio_buffer.append', audio: toBase64(pcm) });
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    try { this.socket?.close(); } catch { /* already */ }
    this.socket = null;
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try { this.socket.send(JSON.stringify(message)); } catch { /* the close handler reports it */ }
  }

  private onEvent(event: MessageEvent): void {
    let message: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try { message = JSON.parse(String(event.data)); } catch { return; }

    switch (message.type) {
      case 'input_audio_buffer.speech_started':
        this.partial = '';
        this.cb.onSpeechStart();
        break;

      case 'input_audio_buffer.speech_stopped':
        // The provider's own endpointer, which hears a pause inside a
        // sentence differently from the end of one. This is the moment the
        // clock on "how long did that take" should start.
        this.cb.onSpeechEnd();
        break;

      case 'conversation.item.input_audio_transcription.delta':
        if (typeof message.delta === 'string') {
          this.partial += message.delta;
          this.cb.onPartial(this.partial);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed': {
        const text = (message.transcript ?? this.partial).trim();
        this.partial = '';
        if (text) this.cb.onFinal(text);
        break;
      }

      case 'error':
        // Bounded, and never echoed to a visitor. The caller falls back.
        this.cb.onUnavailable('PROVIDER_ERROR');
        break;

      default:
        break;
    }
  }
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The socket for whichever provider the server granted.
 *
 * The branch is here and nowhere else. A caller asks for a transcriber and
 * gets one; it does not learn a protocol, and neither implementation learns
 * about the other.
 */
export function createTranscriber(grant: LiveGrant, cb: LiveCallbacks): LiveSocket {
  if (grant.provider === 'GOOGLE') return new GoogleTranscriber(grant, cb);
  if (grant.provider === 'ELEVENLABS') return new ScribeTranscriber(grant, cb);
  return new LiveTranscriber(grant, cb);
}
