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

import type { TalkLanguage } from './talkLanguage.ts';

/** Languages whose transcripts can be checked for function words. */
export type CheckableLanguage = 'en' | 'tr' | 'ru';

const FUNCTION_WORDS: Record<CheckableLanguage, string[]> = {
  // No one- or two-letter tokens: "me" is Georgian მე, "da" is და, and a
  // transliteration would otherwise pass as English on the strength of them.
  en: ['the', 'and', 'but', 'are', 'was', 'were', 'this', 'that', 'what', 'how', 'much', 'many', 'does',
    'can', 'could', 'would', 'should', 'you', 'they', 'your', 'not', 'yes', 'okay', 'about', 'there',
    'here', 'have', 'has', 'want', 'need', 'price', 'cost', 'with', 'from', 'for', 'right', 'now'],
  tr: ['ve', 'bir', 'bu', 'şu', 'o', 'ne', 'nasıl', 'kaç', 'için', 'ile', 'gibi', 'çok', 'daha', 'en',
    'mi', 'mı', 'mu', 'mü', 'var', 'yok', 'evet', 'hayır', 'ben', 'sen', 'biz', 'siz', 'da', 'de', 'ama',
    'fiyat', 'kadar', 'istiyorum', 'lütfen', 'tamam', 'peki', 'şimdi', 'burada', 'orada'],
  ru: ['и', 'а', 'но', 'в', 'на', 'с', 'по', 'за', 'из', 'к', 'о', 'у', 'не', 'да', 'нет', 'что', 'как',
    'это', 'этот', 'эта', 'я', 'ты', 'мы', 'вы', 'он', 'она', 'они', 'мне', 'меня', 'хочу', 'нужно', 'можно',
    'сколько', 'стоит', 'цена', 'квартира', 'есть', 'был', 'была', 'будет', 'если', 'или', 'же', 'ли'],
};

/** Which script a checkable language writes in. */
const SCRIPT_OF: Record<CheckableLanguage, RegExp> = {
  en: /\p{Script=Latin}/u,
  tr: /\p{Script=Latin}/u,
  ru: /\p{Script=Cyrillic}/u,
};

export function isCheckable(lang: string | null | undefined): lang is CheckableLanguage {
  return lang === 'en' || lang === 'tr' || lang === 'ru';
}

/**
 * How much of the text is made of the language's own function words.
 *
 * 0 means none of the words are ones this language uses to hold a sentence
 * together -- what a transliteration of another language looks like.
 */
export function functionWordRatio(text: string, lang: CheckableLanguage): { ratio: number; words: number } {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  if (!words.length) return { ratio: 0, words: 0 };
  const set = new Set(FUNCTION_WORDS[lang]);
  const hits = words.filter((w) => set.has(w)).length;
  return { ratio: hits / words.length, words: words.length };
}

export interface RecoveryInput {
  /** The language the live socket was configured with. */
  pinned: string | null;
  /** What the pinned socket wrote for this utterance. */
  transcript: string;
  /** Voiced milliseconds in the utterance, from the local endpointer. */
  speechMs: number;
  /** The page the visitor chose. */
  pageLocale: string | null;
  /** The last non-Latin language this session actually resolved to, if any. */
  lastOther: string | null;
  /** Recoveries already spent this session. */
  spent: number;
}

export interface RecoveryPlan {
  /** The explicit language the batch recogniser is asked for. Never `auto`. */
  hint: TalkLanguage;
  reason: 'NO_FUNCTION_WORDS';
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
export const RECOVERY_MAX_PER_SESSION = 6;

/**
 * Decide whether this turn earns one same-audio recovery, and in which
 * language to ask for it.
 *
 * Only a pinned language whose transcripts can be checked (en, tr, ru), only
 * when the transcript is in that language's script (otherwise the script
 * itself already told the resolver the truth), only with sustained speech and
 * several words, and only while the session has recoveries left.
 */
export function planRecovery(input: RecoveryInput): RecoveryPlan | null {
  if (!isCheckable(input.pinned)) return null;
  if (input.spent >= RECOVERY_MAX_PER_SESSION) return null;
  if (input.speechMs < RECOVERY_MIN_SPEECH_MS) return null;
  if (!SCRIPT_OF[input.pinned].test(input.transcript)) return null;

  const { ratio, words } = functionWordRatio(input.transcript, input.pinned);
  if (words < RECOVERY_MIN_WORDS) return null;
  if (ratio > RECOVERY_MAX_RATIO) return null;

  // Which language to ask for: the one this visitor has actually used that
  // is not the pinned one, else the page they chose, else Georgian -- the
  // language this product exists for.
  const candidates = [input.lastOther, input.pageLocale, 'ka']
    .filter((c): c is string => Boolean(c) && c !== input.pinned);
  const hint = (candidates[0] ?? 'ka') as TalkLanguage;
  return { hint, reason: 'NO_FUNCTION_WORDS', ratio, words };
}
