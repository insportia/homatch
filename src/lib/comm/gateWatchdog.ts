/*
 * WHEN A CLOSED MICROPHONE GATE IS A STUCK ONE.
 *
 * The gate closes when a turn is sent and opens when the reply has finished
 * playing. A watchdog exists because one release path once never ran (a
 * barge-in that relabelled the state without ungating) and the session sat
 * deaf for ever.
 *
 * The first watchdog measured one thing: how long the gate had been closed.
 * Fifteen seconds, then stopPlayback() and back to listening. Its comment said
 * that was "longer than any reply this product produces". It was not. A real
 * Windows/Chrome session on production: turn sent, first audio 4.9s later,
 * 15.9s of Georgian audio -- and at exactly fifteen seconds after the gate
 * closed the watchdog stopped every scheduled source and reopened the
 * microphone. 58 of 82 chunks had played. The visitor heard the assistant stop
 * in the middle of its answer; nothing anywhere said why.
 *
 * Time since the gate closed is the wrong question. The right one is whether
 * anything is still legitimately happening behind it. A reply in flight, or
 * audio scheduled on the clock, is not a stuck gate however long it takes. A
 * closed gate with no turn in flight and nothing playing is stuck within
 * seconds. Only that case may be forced open early; a hard ceiling remains for
 * a state the session cannot explain at all.
 *
 * Pure, so the decision is tested directly with the real numbers.
 */

export interface GateWatchInput {
  /** True while the microphone gate is closed. */
  gated: boolean;
  /** Milliseconds since the gate closed. */
  gatedForMs: number;
  /** A reply is still being produced (request open, stream not finished). */
  turnInFlight: boolean;
  /** Seconds of audio scheduled on the clock and not yet heard. */
  pendingSeconds: number;
  /** The player still has sources scheduled or draining. */
  playing: boolean;
}

export interface GateWatchLimits {
  /** After this, a gate with NOTHING behind it is forced open. */
  idleMs: number;
  /** After this, the gate is forced open no matter what: the last resort. */
  hardMs: number;
}

export type GateVerdict = 'HOLD' | 'RELEASE_IDLE' | 'RELEASE_HARD';

export function gateWatchdog(input: GateWatchInput, limits: GateWatchLimits): GateVerdict {
  if (!input.gated) return 'HOLD';
  if (input.gatedForMs > limits.hardMs) return 'RELEASE_HARD';
  const busy = input.turnInFlight || input.playing || input.pendingSeconds > 0.02;
  if (busy) return 'HOLD';
  if (input.gatedForMs > limits.idleMs) return 'RELEASE_IDLE';
  return 'HOLD';
}
