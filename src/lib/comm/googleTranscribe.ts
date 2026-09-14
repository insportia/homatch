// HOMATCH AI TALK — Georgian recognition, through Homatch's own worker.
//
// WHY THIS SOCKET GOES TO HOMATCH AND NOT TO THE PROVIDER
//
// The other two transcribers open a socket straight at the provider, holding
// an ephemeral token the provider minted. Google's realtime recognition is
// `StreamingRecognize`, a bidirectional gRPC stream, and a browser cannot
// speak gRPC at all. So the stream terminates on Homatch's worker — which is
// Node, already deployed, and already holds the service account — and this
// socket carries the same PCM frames to it.
//
// WHAT THE BROWSER HOLDS
//
// A grant: `sessionId.expiry.signature`, signed by the edge function with a
// secret this browser never sees and cannot derive. It is good for one
// session and expires in minutes. There is no Google credential here, and
// there is no way to get one from what is here.
//
// WHY IT IMPLEMENTS THE SAME INTERFACE AS THE OTHER TWO
//
// Because the session should not learn a third protocol. LiveSocket exists
// so that choosing a provider is a factory call and nothing else changes —
// this file is the reason that interface was worth having.

import type { LiveCallbacks, LiveGrant, LiveSocket } from './liveTranscribe.ts';

/** What the worker's recogniser is configured for. */
export const GOOGLE_SAMPLE_RATE = 16_000;

export class GoogleTranscriber implements LiveSocket {
  private socket: WebSocket | null = null;
  private closed = false;
  private ready = false;
  /** True between the first interim of an utterance and its final. */
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
    const base = this.grant.wsUrl ?? '';
    const query = new URLSearchParams({ grant: this.grant.token });
    /*
     * The language is sent as a full BCP-47 tag because that is what Google
     * takes, and only when the conversation has actually settled on one.
     * Naming it from the page locale is how a Russian speaker reading a
     * Georgian page gets Georgian letters back.
     */
    if (this.grant.languageCode) {
      const tag = TAGS[this.grant.languageCode.toLowerCase().split('-')[0]];
      if (tag) query.set('language', tag);
    }
    return `${base}?${query}`;
  }

  async open(timeoutMs = 8000): Promise<boolean> {
    if (!this.grant.wsUrl) {
      this.cb.onUnavailable('NO_SOCKET_URL');
      return false;
    }

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

  /**
   * One block of microphone audio, already at GOOGLE_SAMPLE_RATE.
   *
   * Sent as binary rather than base64: this hop is Homatch's own worker, so
   * there is no provider protocol demanding JSON, and base64 would add a
   * third more bytes to every frame of a live conversation for nothing.
   */
  append(pcm: Int16Array): void {
    if (!this.isReady || this.gated || !pcm.length) return;
    this.framesSent += 1;
    this.bytesSent += pcm.byteLength;
    try {
      /*
       * Copied into a plain byte view before sending.
       *
       * The capture pipeline hands out Int16Array windows onto a reused
       * buffer, which the DOM types describe as possibly SharedArrayBuffer
       * backed — and send() does not take one of those. The copy is about a
       * kilobyte per frame, it makes the bytes unambiguously this frame's,
       * and it removes any chance of the window being reused underneath a
       * send that has not gone out yet.
       */
      const bytes = new Uint8Array(pcm.byteLength);
      bytes.set(new Uint8Array(pcm.buffer as ArrayBuffer, pcm.byteOffset, pcm.byteLength));
      this.socket!.send(bytes);
    } catch { /* the close handler reports it */ }
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    // Tell the worker rather than vanishing, so it can end the Google stream
    // cleanly instead of waiting out a timeout holding a paid connection.
    try { this.socket?.send(JSON.stringify({ type: 'close' })); } catch { /* already */ }
    try { this.socket?.close(); } catch { /* already */ }
    this.socket = null;
  }

  private onEvent(event: MessageEvent): void {
    let message: { type?: string; text?: string; reason?: string };
    try { message = JSON.parse(String(event.data)); } catch { return; }

    switch (message.type) {
      case 'ready':
        break;

      case 'interim': {
        const text = String(message.text ?? '').trim();
        if (!text) break;
        /*
         * The first interim IS the start of speech here. Google reports
         * voice activity separately, but inventing a second opinion from our
         * own energy detector would put two things in charge of one
         * decision — and the session already has a turn detector.
         */
        if (!this.speaking) {
          this.speaking = true;
          this.cb.onSpeechStart();
        }
        this.cb.onPartial(text);
        break;
      }

      case 'final': {
        const text = String(message.text ?? '').trim();
        // Google's own endpointer deciding the utterance ended. Both
        // callbacks fire from it, in order, because this is the moment the
        // wait a person feels begins.
        if (this.speaking) this.cb.onSpeechEnd();
        this.speaking = false;
        if (text) this.cb.onFinal(text);
        break;
      }

      case 'restarted':
        // The worker swapped the underlying stream before Google's own limit
        // ended it, replaying what it held. Nothing was lost and the session
        // has nothing to do.
        break;

      case 'unavailable':
        // Bounded and never echoed to a visitor. The caller falls back.
        this.cb.onUnavailable(String(message.reason ?? 'PROVIDER_ERROR').slice(0, 40));
        break;

      default:
        break;
    }
  }
}

/**
 * The full tags Google takes, for the languages Homatch actually speaks.
 *
 * A map rather than `${code}-${code.toUpperCase()}`: that trick produces
 * en-EN and he-HE, neither of which exists.
 */
const TAGS: Record<string, string> = {
  ka: 'ka-GE',
  en: 'en-US',
  ru: 'ru-RU',
  tr: 'tr-TR',
  ar: 'ar-XA',
  he: 'iw-IL',
};
