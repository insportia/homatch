/*
 * WHAT HAPPENS WHEN THE RECOGNISER NEVER ANSWERS.
 *
 * A real Android session, on production: the microphone captured, 43 kB of
 * ka-GE PCM reached the worker, the socket was half-closed for a final, and
 * the socket then ended with NO final transcript. The client's rule was
 * "rotate when a final arrives", so nothing rotated; `liveEnded` stayed true,
 * so no further end-of-turn could fire; the state stayed UNDERSTANDING; and
 * the session was dead with the panel still looking alive. Zero turns.
 *
 * That path was identical in the last known-good build -- it had simply
 * never been hit, because every earlier turn happened to produce a final.
 *
 * This class owns the one decision that was missing: a requested final is
 * WATCHED, and either it arrives, or its absence resolves into an explicit
 * outcome -- recover with a fresh socket, or, after enough consecutive
 * misses, stop reconnecting and say so. Driven directly by
 * noFinalRecovery.test.mjs, which is the point: the dead end shipped past
 * thousands of tests that only read source.
 *
 * ONE EMPTY STT TURN MUST NEVER KILL THE SESSION.
 */

export type NoFinalReason = 'EMPTY_FINAL' | 'CLOSED_WITHOUT_FINAL' | 'FINAL_TIMEOUT';

export type FinalDecision =
  | { kind: 'RECOVER'; reason: NoFinalReason }   // rotate to a fresh socket, keep listening
  | { kind: 'GIVE_UP'; reason: NoFinalReason };  // too many in a row: explicit failure state

export interface FinalWatchOptions {
  /** How long a requested final may take before its absence is a fact. */
  timeoutMs: number;
  /** Consecutive misses before recovery stops and a failure state is shown. */
  maxConsecutive: number;
}

export class FinalWatch {
  private pending = false;
  private requestedAt = 0;
  private readonly opts: FinalWatchOptions;

  noFinalCount = 0;
  consecutiveNoFinals = 0;
  noFinalRecoveries = 0;
  lastNoFinalReason: NoFinalReason | null = null;
  lastNoFinalAt: number | null = null;
  /** The last socket close: did a usable final precede it, and why did it close. */
  socketCloseHadFinal: boolean | null = null;
  socketCloseReason: string | null = null;

  constructor(opts: FinalWatchOptions) {
    this.opts = opts;
  }

  get isPending(): boolean { return this.pending; }

  /** finalize() was sent. From here the final is owed. */
  requested(now: number): void {
    this.pending = true;
    this.requestedAt = now;
  }

  /** A usable, non-empty final arrived: the normal path. */
  arrived(): void {
    this.pending = false;
    this.consecutiveNoFinals = 0;
    this.socketCloseHadFinal = true;
  }

  /**
   * The socket ended, or answered empty, with a final still owed.
   *
   * Idempotent per request: whichever signal lands first decides, and a
   * later close/timeout for the same request is ignored, so one miss can
   * never trigger two recoveries.
   */
  missed(reason: NoFinalReason, now: number): FinalDecision | null {
    if (!this.pending) return null;
    this.pending = false;
    this.noFinalCount += 1;
    this.consecutiveNoFinals += 1;
    this.lastNoFinalReason = reason;
    this.lastNoFinalAt = now;
    this.socketCloseHadFinal = false;
    this.socketCloseReason = reason;
    if (this.consecutiveNoFinals >= this.opts.maxConsecutive) return { kind: 'GIVE_UP', reason };
    this.noFinalRecoveries += 1;
    return { kind: 'RECOVER', reason };
  }

  /** Called on the session's clock: a final owed for too long is a miss. */
  tick(now: number): FinalDecision | null {
    if (!this.pending) return null;
    if (now - this.requestedAt < this.opts.timeoutMs) return null;
    return this.missed('FINAL_TIMEOUT', now);
  }

  /** A socket closed after a normal, delivered final. Recorded, not acted on. */
  closedAfterFinal(reason: string): void {
    this.socketCloseHadFinal = true;
    this.socketCloseReason = reason;
  }
}
