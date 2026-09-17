/*
 * WHERE A BLOCK OF MICROPHONE AUDIO GOES, AND WHY.
 *
 * This existed inside VoiceSession as a boolean and four counters, and it
 * shipped a defect that no test in this repository could have caught, because
 * every test of that file reads its source rather than running it.
 *
 * THE DEFECT, for whoever changes this next:
 *
 * `liveExpected` meant "a socket exists or is being opened". Three paths set
 * it and returned without clearing it -- a failed grant, a socket that never
 * opened, and a provider that went away mid-session. The hold branch then
 * matched on every block and RETURNED, so the batch capture underneath it
 * was unreachable. A real Android session held 688,128 bytes of speech
 * through a three-second ring buffer, evicted all of it, and completed zero
 * turns while still showing itself as listening.
 *
 * Two rules come out of that, and they are what this class exists to enforce:
 *
 *   HOLDING IS ALWAYS TEMPORARY. It is bounded in milliseconds, not only in
 *   bytes, and running out of patience is a state change, not a silence.
 *
 *   "A SOCKET IS COMING" IS A STATE SOMEBODY HAS TO WRITE DOWN. There is no
 *   way to stop a socket arriving without saying so here.
 *
 * ONE UNIT THROUGHOUT: canonical outgoing PCM, 16 kHz mono signed Int16.
 * Nothing in this file counts 48 kHz Float32 input bytes, and audio is
 * resampled exactly once, before it reaches here.
 */

export type LivePhase = 'IDLE' | 'CONNECTING' | 'READY' | 'ROTATING' | 'FAILED';

/** What the caller should do with the block it just handed over. */
export type Route =
  | { kind: 'SEND' }        // a socket is ready; send it
  | { kind: 'HELD' }        // a socket is coming; this class kept it
  | { kind: 'BATCH' };      // no socket is coming; the batch path owns it

export interface RouterOptions {
  /** Canonical sample rate of the PCM this router carries. */
  sampleRate: number;
  /** Capacity of the hold buffer. */
  maxBufferMs: number;
  /** How long a socket may be "coming" before the batch path takes over. */
  maxWaitMs: number;
  now?: () => number;
}

export class LiveAudioRouter {
  private phase: LivePhase = 'IDLE';
  private expectingSince = 0;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private readonly now: () => number;

  // All canonical PCM bytes. A byte is in exactly one of these.
  postResampleBytes = 0;
  sentLiveBytes = 0;
  flushedBufferedBytes = 0;
  droppedPcmBytes = 0;
  /*
   * Bytes the BATCH path took, because no socket was coming.
   *
   * A fifth category, and not a rounding detail: without it the invariant
   * below quietly excused every byte that went to the fallback, which is
   * exactly the traffic worth accounting for when the live path is failing.
   */
  batchedPcmBytes = 0;
  maxBufferedBytes = 0;

  socketFailures = 0;
  socketReconnects = 0;
  lastFellBack: string | null = null;
  /** Counts every flush, so "exactly once" is checkable rather than asserted. */
  flushes = 0;

  private opts: RouterOptions;

  constructor(opts: RouterOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The rate the socket actually negotiated.
   *
   * The router is built before a grant exists, so it starts on a default --
   * and that default is LIVE_SAMPLE_RATE, which is 24,000 because OpenAI's
   * realtime socket runs at 24k. Google's grant asks for 16,000. Nothing
   * about the audio was wrong (the resampler has always used the grant's
   * rate), but every number in here that is expressed in TIME was computed
   * against the wrong one, and `bufferFormat` told a real device it was
   * sending 24 kHz when it was sending 16.
   */
  configure(sampleRate: number): void {
    if (sampleRate > 0) this.opts = { ...this.opts, sampleRate };
  }

  get sampleRate(): number { return this.opts.sampleRate; }
  get currentPhase(): LivePhase { return this.phase; }
  get bufferedBytes(): number { return this.samples * 2; }
  get bufferedMs(): number { return (this.samples / this.opts.sampleRate) * 1000; }
  get bufferFormat(): string { return `pcm_s16le ${this.opts.sampleRate}Hz mono`; }

  /** A socket is on its way. Starts the clock that stops it being forever. */
  expect(phase: 'CONNECTING' | 'ROTATING'): void {
    this.phase = phase;
    this.expectingSince = this.now();
  }

  /**
   * A socket is live. Returns the held audio to flush, in order, exactly once.
   *
   * The buffer is emptied as it is handed over, so a second call returns
   * nothing and no chunk can reach a recogniser twice.
   */
  ready(): Int16Array[] {
    this.phase = 'READY';
    this.expectingSince = 0;
    this.socketReconnects += 1;
    if (!this.chunks.length) return [];
    const out = this.chunks;
    let bytes = 0;
    for (const c of out) bytes += c.byteLength;
    this.chunks = [];
    this.samples = 0;
    this.flushedBufferedBytes += bytes;
    this.flushes += 1;
    return out;
  }

  /**
   * Nothing is coming. The held audio has no recogniser; the batch path takes
   * over. This is the ONLY way to stop expecting a socket.
   */
  abandon(reason: string): void {
    this.phase = 'FAILED';
    this.expectingSince = 0;
    this.socketFailures += 1;
    this.lastFellBack = reason;
    for (const c of this.chunks) this.droppedPcmBytes += c.byteLength;
    this.chunks = [];
    this.samples = 0;
  }

  /**
   * Route one block of canonical PCM.
   *
   * `HELD` is returned only while a socket is genuinely moments away. Past
   * maxWaitMs the router abandons and answers `BATCH`, so the caller's batch
   * capture runs and the conversation keeps taking turns.
   */
  route(pcm: Int16Array, socketReady: boolean): Route {
    this.postResampleBytes += pcm.byteLength;

    if (socketReady) {
      this.sentLiveBytes += pcm.byteLength;
      return { kind: 'SEND' };
    }

    const expecting = this.phase === 'CONNECTING' || this.phase === 'ROTATING';
    if (!expecting) {
      this.batchedPcmBytes += pcm.byteLength;
      return { kind: 'BATCH' };
    }

    if (this.now() - this.expectingSince > this.opts.maxWaitMs) {
      this.abandon(`socket not ready within ${this.opts.maxWaitMs}ms`);
      this.batchedPcmBytes += pcm.byteLength;
      return { kind: 'BATCH' };
    }

    this.chunks.push(pcm);
    this.samples += pcm.length;
    if (this.bufferedBytes > this.maxBufferedBytes) this.maxBufferedBytes = this.bufferedBytes;

    // Bounded. The OLDEST goes, because the newest is the sentence still
    // being spoken -- but with maxWaitMs in force this should never run.
    const cap = (this.opts.maxBufferMs / 1000) * this.opts.sampleRate;
    while (this.samples > cap && this.chunks.length > 1) {
      const gone = this.chunks.shift()!;
      this.samples -= gone.length;
      this.droppedPcmBytes += gone.byteLength;
    }
    return { kind: 'HELD' };
  }

  /**
   * Every byte in exactly one category.
   *
   * If this is ever false a byte was counted twice or vanished, and every
   * other number here is suspect.
   */
  accountsBalance(): boolean {
    return this.postResampleBytes === (
      this.sentLiveBytes + this.flushedBufferedBytes
      + this.bufferedBytes + this.droppedPcmBytes + this.batchedPcmBytes
    );
  }
}
