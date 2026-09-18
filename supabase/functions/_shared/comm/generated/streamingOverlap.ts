// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/streamingOverlap.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

/*
 * DID THE PIPELINE ACTUALLY OVERLAP, OR DID IT WAIT?
 *
 * The desired shape is: the model is still writing sentence N+2 while the
 * voice is synthesising N+1 and the speaker is playing N. That is either true
 * of a turn or it is not, and the server's own stamps can say which. This
 * turns them into three yes/no facts and the two numbers that decide how a
 * reply FEELS: how long until the first speakable phrase existed, and how long
 * the technical silences between segments were.
 *
 * Pure, shared with the edge through the generated mirror, and driven by
 * streamingOverlap.test.mjs with the numbers from real turns.
 */

export interface SegmentStamp {
  index: number;
  /** ms after the turn started that this phrase was handed to the voice. */
  requestMs: number | null;
  /** ms after the turn started that its first audio byte came back. */
  firstByteMs: number | null;
  /** ms after the turn started that its last audio byte came back. */
  doneMs: number | null;
  textChars: number;
}

export interface OverlapInput {
  /** ms after the turn started that the model produced its first token. */
  llmFirstTokenMs: number | null;
  /** ms after the turn started that the model finished. */
  llmFinalMs: number | null;
  /** ms after the turn started that the first audio byte was SENT to the browser. */
  firstAudioSentMs: number | null;
  segments: SegmentStamp[];
}

export interface OverlapVerdict {
  lunaAndTts: boolean;        // a phrase was synthesising before the model finished
  lunaAndPlayback: boolean;   // audio was already flowing before the model finished
  ttsAndPlayback: boolean;    // audio was flowing while a later phrase was still synthesising
  firstSpeakablePhraseMs: number | null;
  firstTtsRequestMs: number | null;
  segments: number;
}

export function judgeOverlap(input: OverlapInput): OverlapVerdict {
  const segs = input.segments.filter((s) => s.requestMs !== null);
  const first = segs.length ? segs.reduce((a, b) => (a.requestMs! <= b.requestMs! ? a : b)) : null;
  const lastDone = segs.reduce<number | null>((m, s) => (s.doneMs !== null && (m === null || s.doneMs > m) ? s.doneMs : m), null);
  const fin = input.llmFinalMs;
  return {
    lunaAndTts: first !== null && fin !== null && first.requestMs! < fin,
    lunaAndPlayback: input.firstAudioSentMs !== null && fin !== null && input.firstAudioSentMs < fin,
    ttsAndPlayback: input.firstAudioSentMs !== null && lastDone !== null && input.firstAudioSentMs < lastDone,
    firstSpeakablePhraseMs: first?.requestMs ?? null,
    firstTtsRequestMs: first?.requestMs ?? null,
    segments: input.segments.length,
  };
}

/** p50 / p95 / max of a set of gap measurements, in ms. */
export function summariseGaps(gapsMs: number[]): { count: number; p50: number | null; p95: number | null; max: number | null } {
  if (!gapsMs.length) return { count: 0, p50: null, p95: null, max: null };
  const xs = [...gapsMs].sort((a, b) => a - b);
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.round((p / 100) * (xs.length - 1)))];
  return { count: xs.length, p50: at(50), p95: at(95), max: xs[xs.length - 1] };
}
