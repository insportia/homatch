// HOMATCH AI TALK — the ElevenLabs realtime transcription socket.
//
// WHY A SECOND FILE AND NOT A BRANCH INSIDE THE FIRST
//
// These are two different protocols that happen to do the same job. OpenAI's
// realtime socket takes `input_audio_buffer.append` and answers with
// `conversation.item.input_audio_transcription.*`; ElevenLabs takes
// `input_audio_chunk` and answers with `partial_transcript` and
// `committed_transcript`. Interleaving them behind one switch statement means
// every future change to either has to be read against the other, and the
// first thing to go wrong is a message name that belongs to the wrong
// provider being silently ignored.
//
// So each provider owns a file, both satisfy the same small interface, and
// the session picks one by the name the server gave it. The old path is not
// deleted — see liveTranscribe.ts for why an optimisation that can be refused
// must keep the thing it was optimising.
//
// WHAT THIS NEVER HOLDS
//
// Not the API key. The token is minted server-side, single-use, scoped to
// realtime transcription, and expires in minutes. It travels in the URL
// because that is the only place a browser WebSocket can carry it, which is
// exactly why it must be the ephemeral one and never the account key.
//
// THE KEYTERMS ARE NOT A SECRET AND ARE NOT THE WHOLE CORPUS
//
// They arrive already selected: a few dozen terms chosen server-side for this
// conversation out of a corpus of over a thousand. This file sends what it is
// given and never adds to it. It matters that it stays that way — sending the
// abuse lexicon to a transcriber teaches it to hear abuse.

import type { LiveCallbacks, LiveGrant, LiveSocket } from './liveTranscribe.ts';

const SCRIBE_REALTIME_WS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

/** The rate the server mints the token for. */
export const SCRIBE_SAMPLE_RATE = 16_000;

/**
 * One live ElevenLabs transcription socket.
 *
 * Owns the socket and the text, nothing else — the session decides what a
 * finished sentence means.
 */
export class ScribeTranscriber implements LiveSocket {
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  /** True between the first words of an utterance and its commit. */
  private speaking = false;
  /** True while the assistant is speaking: frames are dropped, not sent. */
  private gated = false;
  private framesSent = 0;
  private bytesSent = 0;

  constructor(private readonly grant: LiveGrant, private readonly cb: LiveCallbacks) {}

  get isReady(): boolean { return this.ready && this.socket?.readyState === WebSocket.OPEN; }
  get frames(): number { return this.framesSent; }
  get bytes(): number { return this.bytesSent; }

  private url(): string {
    const rate = this.grant.sampleRate ?? SCRIBE_SAMPLE_RATE;
    const query = new URLSearchParams({
      token: this.grant.token,
      model_id: this.grant.model || 'scribe_v2_realtime',
      audio_format: `pcm_${rate}`,
      // The provider's own endpointer decides when a sentence ended. Ours
      // hears a pause inside a sentence the same as the end of one, which is
      // how a question gets cut in half.
      commit_strategy: 'vad',
      include_language_detection: 'true',
    });
    // Only when the conversation has actually settled into a language.
    // Naming it from the page locale is how a Russian speaker reading a
    // Georgian page gets Georgian letters back.
    if (this.grant.languageCode) query.set('language_code', this.grant.languageCode);
    for (const term of this.grant.keyterms ?? []) query.append('keyterms', term);
    return `${SCRIBE_REALTIME_WS}?${query}`;
  }

  /**
   * Open the socket, or report that it will not open.
   *
   * Resolves either way. A caller that has to choose between two paths should
   * not also have to catch.
   */
  async open(timeoutMs = 8000): Promise<boolean> {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url());
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
      // A socket that dies mid-conversation must be reported, not ignored:
      // the failure this product has already paid for is a transport that
      // stopped while the panel went on saying "Listening".
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
    if (!gated) this.speaking = false;
  }

  /** One block of microphone audio, already at the grant's sample rate. */
  append(pcm: Int16Array): void {
    if (!this.isReady || this.gated || !pcm.length) return;
    this.framesSent += 1;
    this.bytesSent += pcm.byteLength;
    this.send({
      message_type: 'input_audio_chunk',
      audio_base_64: toBase64(pcm),
      sample_rate: this.grant.sampleRate ?? SCRIBE_SAMPLE_RATE,
    });
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
    let message: {
      message_type?: string;
      type?: string;
      text?: string;
      transcript?: string;
      language_code?: string;
      reason?: string;
    };
    try { message = JSON.parse(String(event.data)); } catch { return; }

    // The field has been spelled both ways across the provider's own
    // documentation; reading either is cheaper than being wrong about which.
    const kind = message.message_type ?? message.type ?? '';
    const text = (message.text ?? message.transcript ?? '').trim();

    switch (kind) {
      case 'session_started':
        break;

      case 'partial_transcript':
        if (!text) break;
        // The first partial IS the start of speech here: this protocol has no
        // separate speech_started event, and inventing one from our own
        // energy detector would put two things in charge of the same
        // decision.
        if (!this.speaking) {
          this.speaking = true;
          this.cb.onSpeechStart();
        }
        this.cb.onPartial(text);
        break;

      case 'committed_transcript': {
        // The commit is the provider's endpointer saying the sentence ended.
        // Both callbacks fire from it, in order, because the moment a person
        // actually feels the wait begin is this one.
        if (this.speaking) this.cb.onSpeechEnd();
        this.speaking = false;
        if (text) this.cb.onFinal(text);
        break;
      }

      case 'auth_error':
        // The token was refused. Nothing about it is echoed to a visitor.
        this.cb.onUnavailable('AUTH_REFUSED');
        break;

      case 'quota_exceeded':
        // Out of provider credit. A different thing from a defect, and worth
        // being able to tell apart in the diagnostics.
        this.cb.onUnavailable('QUOTA_EXCEEDED');
        break;

      case 'error':
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
