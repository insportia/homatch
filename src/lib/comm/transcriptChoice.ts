/*
 * WHICH OF TWO TRANSCRIPTS OF THE SAME BREATH IS THE ONE THEY SAID.
 *
 * Production session 6a16165f, turn t5. The batch recogniser was handed 8.2
 * seconds of Georgian — 262,188 bytes — and returned 76 characters. The turn
 * committed 16, and the other 60 characters of a sentence somebody actually
 * said were dropped on the floor.
 *
 * The rule that did it took the batch result only when the live socket had
 * said nothing at all, or had named a different language, or had contradicted
 * the pinned one:
 *
 *   used = usable && (reason === 'NO_FINAL' || !liveTranscript.trim()
 *     || (language !== null && language !== pinned)
 *     || !consistentWith(liveTranscript, pinned))
 *
 * A live final that is short, same-language and perfectly consistent is none
 * of those things. It is also, when the batch heard five times as much, the
 * wrong answer — and the one case the rule could not see.
 *
 * "TAKE THE LONGER ONE" IS NOT THE FIX, AND IS ITS OWN BUG.
 *
 * A recogniser correcting itself often gets SHORTER: "ho- ho- how much is the
 * deposit" becomes "how much is the deposit", and a length rule would reject
 * the correction and keep the stutter. Worse, two recognisers that disagree
 * about the WORDS are not two lengths of the same sentence, and picking the
 * longer of two different sentences is how you commit something nobody said.
 *
 * So the question is not "which is longer" but "is one of these the same
 * sentence as the other, carried further". The batch wins only when it
 * CONTAINS what the live socket heard and adds materially to it. When they
 * diverge, the live final stays, because it is the one the endpointer and the
 * language resolver already agreed about.
 *
 * Language is not decided here and never can be. This returns text only; the
 * single-authority resolver keeps deciding what language it is in.
 */

/** The reason a transcript was chosen, for the trace. */
export type TranscriptChoiceReason =
  | 'LIVE_ONLY'
  | 'BATCH_ONLY'
  | 'NEITHER'
  | 'BATCH_EXTENDS_LIVE'
  | 'LIVE_KEPT_EQUIVALENT'
  | 'LIVE_KEPT_DIVERGENT'
  | 'LIVE_KEPT_LONGER';

export interface TranscriptChoice {
  text: string;
  source: 'LIVE' | 'BATCH' | 'NONE';
  reason: TranscriptChoiceReason;
  liveChars: number;
  batchChars: number;
}

/**
 * Comparison form: what was said, not how it was written down.
 *
 * Two recognisers punctuate the same sentence differently and disagree about
 * spacing, and neither difference means a word was lost. Case folding is
 * harmless here and matters for the Latin-script languages; Georgian, Arabic
 * and Hebrew are caseless and unaffected.
 *
 * Deliberately NOT normalising away anything else. Stripping diacritics or
 * collapsing letters would start making genuinely different words look equal,
 * which is the failure mode this whole function exists to prevent.
 */
export function comparable(text: string): string {
  return text
    .toLowerCase()
    // Punctuation and symbols, including the Georgian and Arabic marks. \p{L}
    // and \p{N} keep every script's letters and digits.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (text: string): string[] => (text ? text.split(' ').filter(Boolean) : []);

/**
 * How much of `inner` appears inside `outer`, in order.
 *
 * A subsequence rather than a substring: a recogniser that heard the same
 * sentence plus two extra words in the middle has still heard the sentence.
 * Order is required, so the same words shuffled into a different sentence
 * does not count as containment.
 */
export function containment(inner: string[], outer: string[]): number {
  if (inner.length === 0) return 1;
  let i = 0;
  for (const w of outer) {
    if (w === inner[i]) i += 1;
    if (i === inner.length) break;
  }
  return i / inner.length;
}

/**
 * The batch has to carry nearly all of the live final to be believed as the
 * same sentence. 0.8 rather than 0.5: half a sentence in common is two
 * recognisers disagreeing, not one of them finishing the other's thought.
 */
export const CONTAINMENT_MIN = 0.8;

/**
 * And it has to add something worth having. One or two extra words is the
 * ordinary disagreement between two recognisers at an utterance boundary;
 * t5's real loss was 76 characters against 16, and 9 words against 2.
 */
export const EXTRA_WORDS_MIN = 2;
export const EXTRA_CHARS_MIN = 8;

/**
 * Choose between what the live socket heard and what the batch recogniser
 * heard for the SAME utterance.
 *
 * Text only. The caller keeps deciding the language, and nothing here may
 * change it: a turn whose words come from the batch is still a turn whose
 * language the resolver owns.
 */
export function chooseTranscript(liveRaw: string | null, batchRaw: string | null): TranscriptChoice {
  const live = (liveRaw ?? '').trim();
  const batch = (batchRaw ?? '').trim();
  const liveChars = live.length;
  const batchChars = batch.length;
  const base = { liveChars, batchChars };

  if (!live && !batch) return { text: '', source: 'NONE', reason: 'NEITHER', ...base };
  if (!live) return { text: batch, source: 'BATCH', reason: 'BATCH_ONLY', ...base };
  if (!batch) return { text: live, source: 'LIVE', reason: 'LIVE_ONLY', ...base };

  const liveWords = words(comparable(live));
  const batchWords = words(comparable(batch));

  // The same sentence written twice. Keep the live one: it is what the
  // endpointer committed and what the resolver already read.
  if (liveWords.join(' ') === batchWords.join(' ')) {
    return { text: live, source: 'LIVE', reason: 'LIVE_KEPT_EQUIVALENT', ...base };
  }

  /*
   * A SHORTER BATCH IS NEVER A REASON TO REPLACE THE LIVE FINAL.
   *
   * This is the guard against the naive length rule read backwards: a live
   * final that is richer than the batch stays, whatever the batch says.
   */
  if (batchWords.length <= liveWords.length) {
    return { text: live, source: 'LIVE', reason: 'LIVE_KEPT_LONGER', ...base };
  }

  const carries = containment(liveWords, batchWords);
  const extraWords = batchWords.length - liveWords.length;
  const extraChars = batchChars - liveChars;

  if (carries >= CONTAINMENT_MIN && extraWords >= EXTRA_WORDS_MIN && extraChars >= EXTRA_CHARS_MIN) {
    return { text: batch, source: 'BATCH', reason: 'BATCH_EXTENDS_LIVE', ...base };
  }

  // Longer, but not the same sentence. Two recognisers that disagree about
  // the words are not a correction, and committing the longer of two
  // different sentences is how a turn says something nobody said.
  return { text: live, source: 'LIVE', reason: 'LIVE_KEPT_DIVERGENT', ...base };
}
