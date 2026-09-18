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

import { STT_TAGS } from './languageRegistry.ts';
import type { LiveCallbacks, LiveGrant, LiveSocket } from './liveTranscribe.ts';

/**
 * How long to let the worker finish after being told the speaker has stopped.
 *
 * Slightly longer than the worker's own grace so the decision belongs to the
 * side that knows whether a sentence is still coming, and short enough that a
 * worker which has stopped answering cannot leave a socket open on this page.
 */
const CLOSE_GRACE_MS = 5000;

/** What the worker's recogniser is configured for. */
export const GOOGLE_SAMPLE_RATE = 16_000;

/**
 * How often a gated stream reminds Google it is still there.
 *
 * MEASURED, not guessed. While the assistant speaks the microphone is gated
 * and this used to send NOTHING AT ALL for the whole reply. Google ends a
 * stream that goes quiet:
 *
 *   code 10, "Stream timed out after receiving no more client requests."
 *
 * which this worker classifies as non-retryable, so the socket closed 1011
 * and the conversation stopped being able to hear. A ten-second answer was
 * enough. That is the real reason a Georgian acknowledgement after a longer
 * reply went nowhere: not the recogniser, which transcribes `კი` correctly
 * every time, but a recognition stream that was no longer alive to hear it.
 *
 * Three seconds is comfortably inside the provider's tolerance, and a tenth
 * of a second of audio every three seconds is roughly three per cent of what
 * streaming continuously would cost -- and it is billed silence either way,
 * so the frame is kept as short as it can be rather than filling the gap.
 */
const GATED_KEEPALIVE_MS = 3000;

/** A tenth of a second: long enough to be a request, short enough to be free. */
const KEEPALIVE_SECONDS = 0.1;

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
  /** Keeps the stream alive while the microphone is gated. */
  private keepalive: number | null = null;
  /**
   * True from asking for the final until the socket answers or gives up.
   *
   * The socket is deliberately still open and still listened to: the whole
   * point of asking is the sentence that comes back afterwards.
   */
  private finalizing = false;
  /** A non-empty final has been delivered on this socket. */
  private deliveredFinal = false;
  /** Silence frames sent purely to stop the stream timing out. */
  private keepalives = 0;

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

    /*
     * EVERY LANGUAGE THIS CONVERSATION COULD BE IN.
     *
     * The recogniser decides per utterance which one it heard, so the visitor
     * simply starts talking instead of choosing from a menu first. The
     * established language is sent separately above and stays the primary
     * candidate, which is what keeps a settled conversation from being
     * re-decided on every pause.
     */
    /*
     * IDENTIFY THE LANGUAGE, WHILE THERE IS STILL ONE TO IDENTIFY.
     *
     * Chirp 3 takes one language or `auto`. One language is far more accurate
     * and is what a settled conversation uses; `auto` is the only way to
     * answer "what is this person speaking", which is the question somebody
     * poses by simply starting to talk on a page whose locale says nothing
     * about them.
     *
     * MEASURED, all six languages, short opener and full sentence:
     *
     *   en ru tr ar   correct on both, every time
     *   ka            correct on a sentence; a bare "გამარჯობა" comes back
     *                 as Javanese, transcribed "gamarjoba" in Latin
     *   he            correct on a sentence (as `iw`, the legacy code this
     *                 product already aliases); a bare "שלום" comes back as
     *                 hi-Latn, "Shalom"
     *
     * So it is used to ESTABLISH the language and then dropped. An
     * unsupported label like jv or hi-Latn resolves to nothing and the
     * session keeps what it had, which is why a short Georgian greeting
     * degrades to one imperfect transcript rather than a Javanese session.
     */
    if (this.grant.detect) query.set('detect', '1');

    const candidates = (this.grant.languages ?? [])
      .map((code) => TAGS[String(code).toLowerCase().split('-')[0]] ?? null)
      .filter((tag): tag is string => Boolean(tag));
    if (candidates.length) query.set('languages', [...new Set(candidates)].join(','));

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
      //
      // Unless we ended the turn ourselves. The worker closes the socket once
      // it has handed back the sentence we asked for, so after finalize() a
      // close is the expected end of this stream and not a fault: reporting
      // it would drop the session to the batch path on every single turn.
      const wasReady = this.ready;
      this.ready = false;
      if (!this.closed && !this.finalizing && wasReady) this.cb.onUnavailable('SOCKET_CLOSED');
      /*
       * Closed while a final was owed and none was delivered. This used to
       * be silent on purpose -- a close after finalize is the normal end of
       * a turn -- and the silence was only correct when a final had already
       * arrived. Without one it left a real Android session dead.
       */
      if (!this.closed && this.finalizing && !this.deliveredFinal) this.cb.onNoFinal?.('CLOSED_WITHOUT_FINAL');
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

  /**
   * Drop frames without closing: the assistant is speaking.
   *
   * The visitor's audio still does not go anywhere -- that is the echo
   * protection and it is unchanged. What changes is that the STREAM is kept
   * alive with silence rather than left to time out. Silence is not "sending
   * noise to the recogniser": there is nothing in it to transcribe, and it
   * produces no interim, no final and no turn. It exists so that the socket
   * is still open when the visitor speaks again.
   */
  setGated(gated: boolean): void {
    if (gated === this.gated) return;
    this.gated = gated;
    if (!gated) this.speaking = false;
    if (gated) this.startKeepalive();
    else this.stopKeepalive();
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    const samples = Math.round(GOOGLE_SAMPLE_RATE * KEEPALIVE_SECONDS);
    this.keepalive = window.setInterval(() => {
      // isReady, not this.gated: if the socket died anyway there is nothing
      // to keep alive and the close handler has already reported it.
      if (!this.isReady) { this.stopKeepalive(); return; }
      try {
        this.socket!.send(new Uint8Array(samples * 2));
        this.keepalives += 1;
      } catch { /* the close handler reports it */ }
    }, GATED_KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepalive !== null) { window.clearInterval(this.keepalive); this.keepalive = null; }
  }

  /**
   * One block of microphone audio, already at GOOGLE_SAMPLE_RATE.
   *
   * Sent as binary rather than base64: this hop is Homatch's own worker, so
   * there is no provider protocol demanding JSON, and base64 would add a
   * third more bytes to every frame of a live conversation for nothing.
   */
  append(pcm: Int16Array): void {
    // Audio after the turn was ended belongs to the NEXT stream, not this one.
    if (this.finalizing) return;
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

  /**
   * END THIS TURN NOW, AND KEEP LISTENING FOR THE SENTENCE.
   *
   * Chirp 3's endpointer is the slowest thing in the conversation: measured
   * on this deployment a final lands 1.6-2.8 seconds after somebody stops,
   * and a short "კი." never arrives at all. The documented lever for that,
   * voice_activity_timeout, was deployed and measured to do nothing.
   *
   * What does work is the half-close. Google flushes the final as soon as the
   * audio side ends, and the worker's own self-test measures that at a steady
   * ~310ms -- including for the utterances the endpointer never ends. So the
   * turn boundary becomes a decision this session makes, from its own voice
   * activity, rather than a wait for a provider that may never finish.
   *
   * This is NOT close(): the socket stays open and its handlers stay attached
   * precisely so the final can arrive. The worker closes it once it has the
   * sentence, and the session opens a fresh one for the next turn.
   */
  finalize(): boolean {
    if (this.finalizing || this.closed || !this.isReady) return false;
    this.finalizing = true;
    // Nothing more to keep alive: we have just asked it to stop.
    this.stopKeepalive();
    try { this.socket!.send(JSON.stringify({ type: 'close' })); } catch { return false; }
    return true;
  }

  /** True once the final for this turn has been asked for. */
  get isFinalizing(): boolean { return this.finalizing; }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.stopKeepalive();

    /*
     * SAY SO, THEN GIVE THE LAST SENTENCE A MOMENT TO COME BACK.
     *
     * Telling the worker is what lets it end the Google stream cleanly rather
     * than waiting out a timeout on a paid connection. But hanging up in the
     * same breath threw away the final transcript of the last utterance:
     * Google flushes it only after the audio side half-closes, so the reply
     * arrives a beat after the request to stop.
     *
     * The worker closes the socket itself once it has the sentence, or gives
     * up on its own. This timer only exists for the case where it does
     * neither, so the page is never left holding an open socket. Nothing here
     * blocks the caller: close() returns immediately and the session moves on.
     */
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;

    try { socket.send(JSON.stringify({ type: 'close' })); } catch { /* already */ }

    if (socket.readyState !== WebSocket.OPEN) {
      try { socket.close(); } catch { /* already */ }
      return;
    }
    const giveUp = window.setTimeout(() => {
      try { socket.close(); } catch { /* already */ }
    }, CLOSE_GRACE_MS);
    socket.addEventListener('close', () => window.clearTimeout(giveUp), { once: true });
  }

  private onEvent(event: MessageEvent): void {
    let message: { type?: string; text?: string; reason?: string; language?: string };
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
        // What the recogniser decided it heard, forwarded verbatim.
        const heard = typeof message.language === 'string' ? message.language : null;
        // Google's own endpointer deciding the utterance ended. Both
        // callbacks fire from it, in order, because this is the moment the
        // wait a person feels begins.
        if (this.speaking) this.cb.onSpeechEnd();
        this.speaking = false;
        if (text) {
          this.deliveredFinal = true;
          this.cb.onFinal(text, heard);
        } else if (this.finalizing) {
          // The recogniser's answer to the whole utterance was nothing.
          // Reported, not swallowed: an empty final is a miss, not a turn.
          this.cb.onNoFinal?.('EMPTY_FINAL');
        }
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
// One table for every language the product carries. See languageRegistry.ts.
const TAGS: Record<string, string> = STT_TAGS;
