/*
 * WHEN THE RECOGNISER HEARD THE WRONG LANGUAGE, AND THE SAME AUDIO CAN SAY SO.
 *
 * The live socket is pinned to one language, and unrestricted detection is
 * deliberately off (it turned a Georgian word into "Abba" and took a whole
 * session to English). The price of that safety is a blind spot: Georgian
 * spoken into an en-US socket comes back as Latin letters with the label
 * "en-US" -- and from the trace it is indistinguishable from real English.
 * The reply is English, and a visitor who switched back to Georgian finds the
 * assistant will not follow.
 *
 * Script cannot separate those two. The WORDS can. Real English, Turkish or
 * Russian is full of function words -- the, and, what, ve, bir, и, что -- and
 * a transliteration of Georgian into Latin or Cyrillic letters has none of
 * them. So a sustained transcript in the pinned language's own script that
 * carries none of that language's function words is a mismatch worth one
 * bounded recovery: the SAME utterance, already captured, transcribed once
 * more through the batch recogniser with an explicit hint from the six
 * languages this product speaks. Never `auto`. Never more than once per turn.
 *
 * Short and ambiguous things -- "ok", "yes", "кі", names, brands -- cannot
 * trigger this: it needs sustained speech and several words.
 */

import { scriptEvidence, type TalkLanguage } from './talkLanguage.ts';
import {
  SCRIPT_OF as SCRIPT_OF_LANGUAGE,
  SCRIPT_PATTERN as SCRIPT_OF,
  FUNCTION_WORDS, isCheckable, functionWordRatio, hasAnyFunctionWord,
  type CheckableLanguage,
} from './languageRegistry.ts';

/*
 * The function-word table and the three helpers that read it now live in
 * languageRegistry.ts, so the language RESOLVER can use them too without an
 * import cycle. They are re-exported here because this is where every caller
 * in the project already looks for them.
 */
export { FUNCTION_WORDS, isCheckable, functionWordRatio, hasAnyFunctionWord };
export type { CheckableLanguage };


export interface RecoveryInput {
  /** The language the live socket was configured with. */
  pinned: string | null;
  /** What the pinned socket wrote for this utterance. */
  transcript: string;
  /** Voiced milliseconds in the utterance, from the local endpointer. */
  speechMs: number;
  /** Recoveries already spent this session. */
  spent: number;
}

/*
 * EMPTY_FINAL is not NO_FINAL. NO_FINAL is a socket that never answered;
 * EMPTY_FINAL is one that answered with no words in it, which is what a
 * ka-GE recogniser does when it is handed Russian. Same re-read, different
 * evidence, and worth telling apart in a trace.
 */
export type RecoveryReason = 'NO_FUNCTION_WORDS' | 'SCRIPT_MISMATCH' | 'FRAGMENT' | 'NO_FINAL' | 'EMPTY_FINAL';

export interface RecoveryPlan {
  /**
   * Always null now. A hint was how the recovery went wrong: told "ka", the
   * batch recogniser TRANSLATED English and Hindi speech into Georgian
   * (measured 2026-09-18, six real utterances), and a session that had left
   * Georgian was pulled back into it. The recogniser is asked with no
   * language, and the script of what comes back says which one it was.
   */
  hint: TalkLanguage | null;
  reason: RecoveryReason;
  ratio: number;
  words: number;
}

/** Sustained speech, so a one-word answer cannot earn a recovery. */
export const RECOVERY_MIN_SPEECH_MS = 900;
/** Enough words that the absence of function words means something. */
export const RECOVERY_MIN_WORDS = 4;
/** Below this share of function words the text is not in the pinned language. */
export const RECOVERY_MAX_RATIO = 0.15;
/** A ceiling per session, so a bad microphone cannot pay for this on every turn. */
export const RECOVERY_MAX_PER_SESSION = 8;

/**
 * Does a transcript look like the language the socket was configured for?
 *
 * Empty is not consistent; a script the language is not written in is not
 * (a ka-GE socket writing Arabic letters heard Turkish, measured); and, for a
 * language whose function words are listed, several words with none of them
 * is not. Anything this cannot judge is presumed consistent, so a language
 * without a word list can never be overridden on this ground.
 */
export function consistentWith(text: string, lang: string | null | undefined): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!isCheckable(lang)) return true;
  if (!SCRIPT_OF[lang].test(t)) return false;
  const { ratio, words } = functionWordRatio(t, lang);
  if (words < RECOVERY_MIN_WORDS) return true;
  return ratio > RECOVERY_MAX_RATIO;
}

/**
 * Decide whether this turn earns one same-audio recovery.
 *
 * Only a pinned language whose transcripts can be checked, only with
 * sustained speech and several words, and only while the session has
 * recoveries left. Two grounds: the transcript is not even in the pinned
 * language's script, or it is but carries none of that language's function
 * words. The recovery itself asks for no language.
 */
export function planRecovery(input: RecoveryInput): RecoveryPlan | null {
  if (!isCheckable(input.pinned)) return null;
  if (input.spent >= RECOVERY_MAX_PER_SESSION) return null;
  if (input.speechMs < RECOVERY_MIN_SPEECH_MS) return null;
  const words = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  /*
   * A ka-GE socket writing Arabic letters, or a ru-RU socket writing Latin:
   * it heard a language it was not configured for. That is a mismatch at any
   * length worth transcribing, so it is judged BEFORE the word floor -- the
   * floor exists for the function-word ratio, and "RAM x 6Y" out of a Russian
   * socket is three words and as clear a mismatch as a sentence would be.
   */
  if (words >= 2 && !SCRIPT_OF[input.pinned].test(input.transcript)) {
    return { hint: null, reason: 'SCRIPT_MISMATCH', ratio: 0, words };
  }
  if (words < RECOVERY_MIN_WORDS) return null;
  const { ratio } = functionWordRatio(input.transcript, input.pinned);
  if (ratio > RECOVERY_MAX_RATIO) return null;
  return { hint: null, reason: 'NO_FUNCTION_WORDS', ratio, words };
}

/**
 * The same finding, for an utterance too short for the ratio to mean
 * anything: two or three words, in the pinned language's own script, with not
 * one of that language's function words in them. Measured: an ar-XA socket
 * wrote Hebrew speech as "خرم كرميتال" -- Arabic letters, no Arabic. A real
 * short answer ("კი, კარგი", "Okay, sure", "مرحبا، اسمي طارق") always carries
 * one, so this cannot fire on them.
 */
/**
 * IS THIS TEXT PROVABLY NOT THE LANGUAGE THE TURN RESOLVED TO?
 *
 * Not "unlikely" -- provably: written in a different script from the one that
 * language uses, short enough to be a fragment rather than a sentence, and
 * carrying none of that language's own words. Every recogniser has already had
 * its turn by the time this is asked, so there is nothing left to try.
 *
 * A Georgian speaker dropping one English term into a Georgian sentence writes
 * mostly Georgian letters and never reaches here. "RAM x 6Y" out of a Russian
 * socket, or "रामाखूया", reaches here every time.
 */
/**
 * DOES THIS OPINION AGREE WITH ITSELF?
 *
 * Measured on the owner's physical Android session f90b91aa, turn 7: the
 * `auto` socket heard Georgian speech, wrote it in LATIN letters, and labelled
 * it ARABIC. Arabic is not written in Latin. A recogniser that contradicts
 * itself that badly has not identified anything, and on a real phone it does
 * this to Georgian often -- which is the entire reason this product pins the
 * language instead of running `auto` as its primary.
 *
 * So: a label is only evidence when the text it came with is written in a
 * script that language actually uses. This can only ever REJECT an opinion,
 * never promote one, so nothing that was already right changes.
 */
export function labelMatchesScript(text: string, language: string | null | undefined): boolean {
  if (!language) return false;
  const want = SCRIPT_OF_LANGUAGE[language];
  if (!want) return false;
  const evidence = scriptEvidence(text);
  // Nothing to judge: digits, punctuation, or too little to be sure.
  if (!evidence.script || evidence.letters < 2) return true;
  return evidence.script === want;
}

export function isDiscreditedTurn(text: string, language: string): boolean {
  const want = SCRIPT_OF_LANGUAGE[language];
  if (!want) return false;
  const evidence = scriptEvidence(text);
  if (!evidence.script || evidence.letters < 3) return false;
  if (evidence.script === want) return false;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 4) return false;
  return !hasAnyFunctionWord(text, language);
}

export function planFragmentRecovery(input: RecoveryInput): RecoveryPlan | null {
  if (!isCheckable(input.pinned)) return null;
  if (input.spent >= RECOVERY_MAX_PER_SESSION) return null;
  if (input.speechMs < RECOVERY_MIN_SPEECH_MS) return null;
  const words = input.transcript.trim().split(/\s+/).filter(Boolean).length;
  if (words < 2 || words >= RECOVERY_MIN_WORDS) return null;
  if (!SCRIPT_OF[input.pinned].test(input.transcript)) return null;
  if (hasAnyFunctionWord(input.transcript, input.pinned)) return null;
  return { hint: null, reason: 'FRAGMENT', ratio: 0, words };
}
