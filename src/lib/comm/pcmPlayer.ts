// HOMATCH AI TALK — playing a voice that arrives in pieces.
//
// WHAT WAS WRONG BEFORE
//
// Every chunk became its own AudioBuffer declared at the PROVIDER's sample
// rate — `ctx.createBuffer(1, n, 24000)` on a context running at 48000. That
// is legal, and the browser resamples it on playback, which sounds like the
// right thing until you notice it resamples EACH BUFFER INDEPENDENTLY.
//
// An independent resample has no idea what came before it or what follows. At
// every join the interpolator restarts from nothing, so the waveform takes a
// step, and a step in a waveform is a click. Dozens of them a second, at
// phrase boundaries, is the high-frequency whine and the harshness a listener
// hears. It was never the voice; it was the arithmetic between the pieces.
//
// WHAT THIS DOES INSTEAD
//
// One conversion, continuous across the whole reply. Samples are converted to
// the context's own rate ONCE, carrying the interpolation phase and the last
// sample from chunk to chunk, so a join is arithmetically identical to the
// middle of a chunk. Then they are batched and scheduled on an integer sample
// cursor, so consecutive buffers abut exactly rather than nearly.
//
// Usually there is no conversion at all: the server asks the provider to
// synthesise at the rate this context runs at, so the samples are simply
// played. The resampler is here for the devices where that is not possible.
//
// WHY BATCHING
//
// A provider chunk can be 20ms. Scheduling hundreds of tiny AudioBufferSources
// is exactly the pattern that stutters on a mid-range Android under load: each
// one is a separate object, a separate callback, and a separate chance for the
// audio thread to miss a deadline. They are accumulated into pieces of about
// an eighth of a second, which is long enough to be cheap and short enough
// that nobody hears the delay.

/** How much audio to gather before scheduling a piece of it. */
const BATCH_SECONDS = 0.12;

/**
 * How far ahead of the clock the first piece starts.
 *
 * Starting at exactly `currentTime` races the audio thread: the buffer is
 * handed over after the deadline it was meant for and the first milliseconds
 * are dropped, which is heard as the voice beginning mid-word. Small enough
 * that nobody perceives it as delay.
 */
const LEAD_SECONDS = 0.05;

/**
 * If the cursor falls behind the clock by more than this, the stream starved
 * and the schedule is rebuilt rather than trying to catch up. Catching up means
 * playing pieces late and overlapping, which sounds far worse than a gap.
 */
const RESYNC_SECONDS = 0.25;

export interface PcmPlayerStats {
  /** Pieces scheduled. */
  batches: number;
  /** Sources actually handed to the audio clock. */
  started: number;
  /** Samples that were not silence. A stream of zeroes is not speech. */
  nonSilentSamples: number;
  /** The context clock when the first piece was scheduled to begin. */
  firstStartAt: number | null;
  /** True once the clock has passed that moment: sound has actually been produced. */
  clockAdvanced: boolean;
  /** What the context says about itself. A suspended context makes no sound. */
  contextState: string;
  /** Times the incoming audio arrived too slowly to keep the cursor ahead. */
  underruns: number;
  /** Chunks dropped because they belonged to a turn that is over. */
  stale: number;
  /** Whether any resampling happened at all. */
  resampled: boolean;
  providerRate: number | null;
  contextRate: number;
}

export class PcmStreamPlayer {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;

  /** Converted samples not yet long enough to be worth scheduling. */
  private pendingSamples: Float32Array[] = [];
  private pendingLength = 0;

  /** Where the next piece starts on the audio clock. */
  private cursor = 0;
  private sources: AudioBufferSourceNode[] = [];

  /** Only chunks from this turn are accepted. */
  private generation = 0;

  // Resampler state, carried across chunks so joins are not special.
  private ratio = 1;
  private phase = 0;
  private tail = 0;
  private hasTail = false;
  private providerRate: number | null = null;

  private stats: PcmPlayerStats;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.stats = {
      batches: 0, started: 0, nonSilentSamples: 0, firstStartAt: null,
      clockAdvanced: false, contextState: ctx.state,
      underruns: 0, stale: 0,
      resampled: false, providerRate: null, contextRate: ctx.sampleRate,
    };
  }

  /** Begin a new turn. Anything still arriving from the previous one is dropped. */
  startTurn(generation: number): void {
    this.generation = generation;
    this.stats.started = 0;
    this.stats.nonSilentSamples = 0;
    this.stats.firstStartAt = null;
    this.stats.clockAdvanced = false;
    this.pendingSamples = [];
    this.pendingLength = 0;
    this.phase = 0;
    this.hasTail = false;
    this.tail = 0;
    this.turnQueued = 0;
    this.turnCompleted = 0;
    this.turnStopped = 0;
    this.turnStopReason = null;
    this.turnLastEndedAt = null;
    this.turnGapsMs = [];
    this.turnReceivedChunks = 0;
    this.turnReceivedBytes = 0;
    this.turnScheduled = 0;
    this.turnAheadMs = [];
    this.turnStartDelayMs = null;
    this.turnMaxUnderrunMs = 0;
    this.turnUnderruns = 0;
    this.turnQueueResets = 0;
    this.turnScheduleCorrections = 0;
    this.turnContextStateAtStart = this.ctx.state;
    this.lastContextState = this.ctx.state;
    this.turnContextStateChanges = 0;
    this.turnFirstPushAt = null;
  }

  get currentGeneration(): number { return this.generation; }

  /** Seconds of audio scheduled but not yet heard. */
  get pendingSeconds(): number {
    return Math.max(0, this.cursor - this.ctx.currentTime);
  }

  get playing(): boolean {
    return this.sources.length > 0 || this.pendingSeconds > 0.01;
  }

  snapshot(): PcmPlayerStats {
    return {
      ...this.stats,
      contextState: this.ctx.state,
      // Recomputed rather than remembered: the question is whether the clock
      // has passed the moment the first piece was due, and only the clock
      // knows that.
      clockAdvanced: this.stats.firstStartAt !== null
        && this.ctx.currentTime > this.stats.firstStartAt,
    };
  }

  /**
   * Did this reply actually make a sound?
   *
   * NOT "was a buffer queued". A buffer queued into a suspended context, or
   * into a player that was never connected to anything, produces exactly the
   * same success from every counter in the system and exactly no audio in the
   * room — which is what production shipped.
   *
   * Every clause here is a separate way that has already failed or could:
   * a context that never resumed, a graph never built, a reply of pure
   * silence, and a clock that never reached the first scheduled piece.
   */
  audiblyPlayed(): { ok: boolean; reason: string | null } {
    const s = this.snapshot();
    if (s.contextState !== 'running') return { ok: false, reason: `CONTEXT_${s.contextState.toUpperCase()}` };
    if (!s.started) return { ok: false, reason: 'NOTHING_SCHEDULED' };
    if (!s.nonSilentSamples) return { ok: false, reason: 'ONLY_SILENCE' };
    if (!s.clockAdvanced) return { ok: false, reason: 'CLOCK_NOT_ADVANCED' };
    return { ok: true, reason: null };
  }

  /**
   * One chunk of signed 16-bit little-endian mono PCM, base64 as it arrived.
   *
   * `generation` is the turn it belongs to. A chunk from a turn the visitor
   * has already interrupted is counted and thrown away — the alternative is
   * the assistant answering a question that was cancelled, over the top of the
   * one that replaced it.
   */
  private completed = 0;

  /*
   * PER-RESPONSE ACCOUNTING. Reset by startTurn(), never across turns.
   *
   * `completed` counts natural endings only: stop() nulls onended before it
   * stops a source, so a stopped source is counted under `stopped` and can
   * never masquerade as one that finished. That is how 82 queued / 58
   * completed on a real Windows session was read as what it was -- a stop --
   * rather than as audio that never arrived.
   */
  private turnQueued = 0;
  private turnCompleted = 0;
  private turnStopped = 0;
  private turnStopReason: string | null = null;
  private turnLastEndedAt: number | null = null;
  /** Technical silences between scheduled pieces, in ms, for THIS response. */
  private turnGapsMs: number[] = [];

  /*
   * WHAT THE SCHEDULER DID, PER TURN.
   *
   * Session 6a16165f reported healthy SERVER cadence on all four turns --
   * every chunk carried 167-179ms of audio and the worst gap between chunks
   * was 129-143ms, so the stream always arrived faster than it plays. The
   * owner still heard choppy audio. That leaves this scheduler, and nothing
   * here was measured, so the forensic answer had to be UNKNOWN.
   *
   * `aheadMs` is the headroom at each flush: how far the write cursor sits
   * in front of the audio clock. Healthy playback keeps it comfortably
   * positive. A value at or near zero is the queue catching up with the
   * listener, which is what starvation sounds like.
   */
  private turnReceivedChunks = 0;
  private turnReceivedBytes = 0;
  private turnScheduled = 0;
  private turnAheadMs: number[] = [];
  private turnStartDelayMs: number | null = null;
  private turnMaxUnderrunMs = 0;
  private turnUnderruns = 0;
  private turnQueueResets = 0;
  private turnScheduleCorrections = 0;
  private turnContextStateAtStart: string | null = null;
  private turnContextStateChanges = 0;
  private lastContextState: string | null = null;
  private turnFirstPushAt: number | null = null;

  /** Everything a trace needs to say whether THIS response was heard to the end. */
  turnStats(): {
    queued: number; started: number; completed: number; stopped: number;
    drained: boolean; stopReason: string | null; lastChunkEndedAt: number | null; gapsMs: number[];
  } {
    return {
      queued: this.turnQueued,
      started: this.stats.started,
      completed: this.turnCompleted,
      stopped: this.turnStopped,
      drained: this.turnQueued > 0
        && this.turnCompleted === this.turnQueued
        && this.turnStopped === 0
        && this.pendingSeconds <= 0.02,
      stopReason: this.turnStopReason,
      lastChunkEndedAt: this.turnLastEndedAt,
      gapsMs: [...this.turnGapsMs],
    };
  }

  /** Pieces handed to the audio clock for this player's lifetime. */
  get queuedChunks(): number { return this.stats.batches; }

  /**
   * One turn's scheduler behaviour, for the trace.
   *
   * Aggregates only: percentiles and counts, never a per-chunk event stream.
   * A playback log that fires per chunk would be forty lines a sentence and
   * would be switched off within a day.
   */
  playbackStats(): {
    receivedChunks: number; receivedBytes: number; scheduled: number;
    startDelayMs: number | null; minAheadMs: number | null;
    p50AheadMs: number | null; p95AheadMs: number | null;
    underruns: number; maxUnderrunMs: number;
    contextStateAtStart: string | null; contextStateChanges: number;
    queueResets: number; scheduleCorrections: number;
  } {
    const ahead = [...this.turnAheadMs].sort((a, b) => a - b);
    const at = (q: number) => (ahead.length ? ahead[Math.min(ahead.length - 1, Math.floor(ahead.length * q))] : null);
    return {
      receivedChunks: this.turnReceivedChunks,
      receivedBytes: this.turnReceivedBytes,
      scheduled: this.turnScheduled,
      startDelayMs: this.turnStartDelayMs,
      minAheadMs: ahead.length ? ahead[0] : null,
      p50AheadMs: at(0.5),
      p95AheadMs: at(0.95),
      underruns: this.turnUnderruns,
      maxUnderrunMs: this.turnMaxUnderrunMs,
      contextStateAtStart: this.turnContextStateAtStart,
      contextStateChanges: this.turnContextStateChanges,
      queueResets: this.turnQueueResets,
      scheduleCorrections: this.turnScheduleCorrections,
    };
  }

  /** Pieces the clock has finished playing. Equal to queued once drained. */
  get completedChunks(): number { return this.completed; }

  push(pcmBase64: string, sampleRate: number, generation: number): void {
    if (generation !== this.generation) { this.stats.stale += 1; return; }
    this.turnReceivedChunks += 1;
    // base64 is 4 characters per 3 bytes; exact enough to compare against the
    // server's own tts_bytes without decoding twice to find out.
    this.turnReceivedBytes += Math.floor((pcmBase64.length * 3) / 4);
    if (this.turnFirstPushAt === null) this.turnFirstPushAt = this.ctx.currentTime;
    if (this.ctx.state !== this.lastContextState) {
      this.turnContextStateChanges += 1;
      this.lastContextState = this.ctx.state;
    }

    const bytes = decodeBase64(pcmBase64);
    // Two bytes to a sample. An odd length means the stream was cut through
    // the middle of one; the server holds those back, and if one still arrives
    // the odd byte is dropped rather than shifting every sample after it.
    const count = bytes.byteLength >> 1;
    if (!count) return;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const input = new Float32Array(count);
    for (let i = 0; i < count; i++) input[i] = view.getInt16(i * 2, true) / 0x8000;

    if (this.providerRate !== sampleRate) {
      // A rate change mid-reply would be a provider or route change mid
      // sentence. Reset the phase rather than interpolating across it.
      this.providerRate = sampleRate;
      this.stats.providerRate = sampleRate;
      this.ratio = sampleRate / this.ctx.sampleRate;
      this.phase = 0;
      this.hasTail = false;
      if (sampleRate !== this.ctx.sampleRate) this.stats.resampled = true;
    }

    const converted = this.ratio === 1 ? input : this.resample(input);
    if (converted.length) {
      this.pendingSamples.push(converted);
      this.pendingLength += converted.length;
    }

    if (this.pendingLength >= BATCH_SECONDS * this.ctx.sampleRate) this.flushPending();
  }

  /**
   * Continuous linear resampling.
   *
   * `phase` is where in the input the next output sample falls, and it is kept
   * between calls; `tail` is the final input sample of the previous chunk, so
   * an output sample landing across the boundary interpolates between the two
   * real samples either side of it rather than between silence and the first
   * one. Those two pieces of carried state are the entire difference between
   * this and what was there before.
   */
  private resample(input: Float32Array): Float32Array {
    const ratio = this.ratio;
    const available = input.length + (this.hasTail ? 1 : 0);
    const out = new Float32Array(Math.max(0, Math.ceil((available - this.phase) / ratio)));

    const at = (i: number): number => {
      if (!this.hasTail) return input[i];
      return i === 0 ? this.tail : input[i - 1];
    };

    let n = 0;
    let pos = this.phase;
    while (pos < available - 1) {
      const i = Math.floor(pos);
      const f = pos - i;
      out[n++] = at(i) * (1 - f) + at(i + 1) * f;
      pos += ratio;
    }

    // What is left over becomes the next call's starting phase, measured from
    // the last input sample, which becomes the next call's tail.
    this.phase = Math.max(0, pos - (available - 1));
    this.tail = input[input.length - 1];
    this.hasTail = true;
    return n === out.length ? out : out.subarray(0, n);
  }

  /** Schedule whatever has accumulated, however short. */
  private flushPending(): void {
    if (!this.pendingLength) return;

    const merged = new Float32Array(this.pendingLength);
    let at = 0;
    for (const part of this.pendingSamples) { merged.set(part, at); at += part.length; }
    this.pendingSamples = [];
    this.pendingLength = 0;

    const buffer = this.ctx.createBuffer(1, merged.length, this.ctx.sampleRate);
    buffer.copyToChannel(merged, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    const now = this.ctx.currentTime;
    this.turnScheduled += 1;
    // Headroom before this piece is placed: negative means the clock has
    // already passed where the audio was going to go.
    this.turnAheadMs.push(Math.round((this.cursor - now) * 1000));
    if (this.turnStartDelayMs === null && this.turnFirstPushAt !== null) {
      this.turnStartDelayMs = Math.round((now - this.turnFirstPushAt) * 1000);
    }
    if (this.cursor < now + 0.001) {
      this.turnScheduleCorrections += 1;
      if (this.cursor !== 0) {
        const lateMs = Math.round((now - this.cursor) * 1000);
        if (lateMs > this.turnMaxUnderrunMs) this.turnMaxUnderrunMs = lateMs;
        this.turnUnderruns += 1;
      } else {
        this.turnQueueResets += 1;
      }
      // Either the first piece of a reply, or the stream starved. Both want a
      // fresh cursor slightly ahead of the clock.
      if (this.cursor !== 0 && now - this.cursor > RESYNC_SECONDS) this.stats.underruns += 1;
      // Not the first piece of the reply: the stream starved and the listener
      // heard a technical silence of exactly this length. Recorded per turn
      // so "multiple TTS requests sound like one answer" is measured, not hoped.
      const resumeAt = now + LEAD_SECONDS;
      if (this.cursor !== 0 && this.turnQueued > 0) this.turnGapsMs.push(Math.round((resumeAt - this.cursor) * 1000));
      this.cursor = resumeAt;
    }

    source.start(this.cursor);
    if (this.stats.firstStartAt === null) this.stats.firstStartAt = this.cursor;
    this.cursor += buffer.duration;
    this.stats.batches += 1;
    this.stats.started += 1;
    this.turnQueued += 1;

    // Silence is a real provider failure mode and answers 200 like any other.
    for (let i = 0; i < merged.length; i += 32) {
      if (Math.abs(merged[i]) > 0.002) { this.stats.nonSilentSamples += 1; break; }
    }

    this.sources.push(source);
    source.onended = () => {
      const i = this.sources.indexOf(source);
      if (i !== -1) this.sources.splice(i, 1);
      // Counted so "did the whole answer play" is answerable from a trace
      // rather than from whether anybody was listening at the time.
      this.completed += 1;
      this.turnCompleted += 1;
      this.turnLastEndedAt = this.ctx.currentTime;
    };
  }

  /** The reply is complete: play the remainder, however short it is. */
  endOfTurn(): void {
    this.flushPending();
  }

  /**
   * Stop immediately and forget everything.
   *
   * Used for barge-in and for navigating away. Every scheduled source is
   * stopped rather than left to finish, the accumulator is dropped, and the
   * cursor is reset — a cursor left in the future would make the NEXT reply
   * wait for audio that will never play.
   */
  /**
   * @param reason who is stopping, so the trace can tell a visitor's
   *   interruption from a defect. Only a USER_BARGE_IN may discard a reply's
   *   remaining audio on purpose; anything else is a cut the visitor heard.
   */
  stop(reason = 'UNSPECIFIED'): void {
    if (this.sources.length) this.turnStopReason = reason;
    for (const source of this.sources) {
      this.turnStopped += 1;
      try { source.onended = null; source.stop(); } catch { /* already finished */ }
      try { source.disconnect(); } catch { /* already detached */ }
    }
    this.sources = [];
    this.pendingSamples = [];
    this.pendingLength = 0;
    this.cursor = 0;
    this.phase = 0;
    this.hasTail = false;
    // A new turn must not be able to accept chunks still in flight from this
    // one. Advancing the generation is what makes cancellation immediate
    // rather than eventual.
    this.generation += 1;
  }
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
