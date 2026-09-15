/**
 * How a word is SAID, which is not always how it is written.
 *
 * WHY THIS LAYER EXISTS
 *
 * "Homatch" is the brand, and it is spelled that way everywhere a person can
 * see it. Handed to a Georgian voice it is still pronounced, just not the way
 * the name is pronounced. MEASURED, by synthesising the greeting with Cartesia
 * and reading the audio back with the Georgian recogniser:
 *
 *   written to Cartesia    ... მე მარიამი ვარ, Homatch-ის AI ასისტენტი ...
 *   heard back from STT    ... მე მარიამი ვარ, ჰომაჩის AI ასისტენტი ...
 *
 * So sonic-3 reads the Latin stem as a word -- ჰომაჩ, "ho-mach" -- rather than
 * spelling it out. That is a better failure than naming the letters and still
 * the wrong name: the owner's pronunciation is ჰოუმეჩ, "hoh-mech". The vowels
 * are wrong in both syllables, and it is the company's own name, said wrong,
 * in its own first sentence.
 *
 * The fix that must NOT be used is changing what Luna writes. The transcript
 * on screen, the row in the database and the reply the model produced are all
 * the brand's actual spelling, and corrupting them to bend a voice model is
 * how "Homatch" becomes "ჰოუმეჩ" in a search index six months later.
 *
 * So the respelling happens HERE, on the last hop before the audio provider,
 * to a copy of the text nothing else ever sees. Text in, text out, no state:
 * the displayed reply and the spoken reply are produced from one string and
 * diverge only in how the sounds are notated.
 *
 * WHAT "CORRECT" MEANS PER LANGUAGE
 *
 * Latin script reads Latin letters, so English and Turkish keep a Latin
 * respelling. Georgian, Russian, Arabic and Hebrew readers get the name in
 * their OWN script, because that is the only way their voice model produces
 * the sounds rather than the letter names.
 */

import { type TalkLanguage } from './talkLanguage.ts';

/**
 * The brand, as each language's voice has to see it to say it.
 *
 *   ka  ჰოუმეჩ    ho-u-me-ch — the owner's own notation, and the one
 *                 validated against real Cartesia synthesis
 *   en  Homatch   the spelling is already the pronunciation
 *   tr  Houmeç    ç is Turkish for the final affricate
 *   ru  Хоумэч    х is the nearest initial, э keeps the vowel open
 *   ar  هوميتش    hoo-meetsh
 *   he  הומץ׳     the geresh makes צ the ch of "church"
 *
 * Only `ka` is validated by synthesis today. The other five are respellings
 * of the same syllables and are marked HUMAN REVIEW REQUIRED in the report:
 * a native speaker has to hear them before anyone calls them correct.
 */
const BRAND_SPOKEN: Record<TalkLanguage, string> = {
  ka: 'ჰოუმეჩ',
  en: 'Homatch',
  tr: 'Houmeç',
  ru: 'Хоумэч',
  ar: 'هوميتش',
  he: 'הומץ׳',
};

/**
 * The brand as it might appear in a reply, including the ways a model writes
 * it when it is already trying to be helpful.
 *
 * The Georgian spellings are here because Luna occasionally transliterates on
 * its own, and a transliteration that is not the one we chose is a DIFFERENT
 * mispronunciation rather than a fixed one. All of them collapse to the same
 * spoken form.
 */
/*
 * STEMS ONLY. A Georgian ending is never part of a stem here.
 *
 * These listed the nominative forms too -- ჰომაჩი, ჰოუმეჩი -- and because the
 * alternation is tried longest-first, `ჰოუმეჩის` matched the stem `ჰოუმეჩი`
 * and left `ს` as the ending. `ს` is a real case ending, so it was welded back
 * on and the result was `ჰოუმეჩს`: a letter of the visitor's own language
 * silently deleted. Every ending, `ი` included, belongs to the tail group.
 */
const BRAND_WRITTEN = [
  'homatch',
  'ჰომაჩ', 'ჰოუმეჩ', 'ჰომატჩ',
];

/** Georgian letters, for recognising a case ending welded to the name. */
const KA_LETTER = '\u10A0-\u10FF';

/**
 * One matcher for every written form, longest first so that `ჰოუმეჩი` is not
 * matched as `ჰოუმეჩ` with a stray `ი` left behind.
 *
 * The tail group is the part that makes this work in Georgian at all: the
 * language declines the name, so a reply says `Homatch-ში` (at Homatch),
 * `Homatch-ის` (Homatch's) or `Homatchში` without the hyphen. The hyphen is
 * a WRITING convention for a Latin stem — it is not pronounced — so it is
 * dropped and the ending is welded straight onto the Georgian respelling.
 */
const BRAND_RE = new RegExp(
  `(${[...BRAND_WRITTEN].sort((a, b) => b.length - a.length).join('|')})`
  // Not part of a longer Latin word: "homatchers" is somebody's surname.
  + '(?![A-Za-z])'
  // An optional hyphen, then an optional Georgian ending, each captured so
  // the separator can be dropped without counting characters back off the end.
  + `([-\u2010-\u2015]?)([${KA_LETTER}]{1,6})?`,
  'giu',
);

/** Georgian case endings, so a real word after a hyphen is not eaten. */
const KA_SUFFIXES = new Set([
  'ი', 'ის', 'ში', 'ზე', 'მა', 'ს', 'თან', 'დან', 'ით', 'ად', 'ო',
  'იდან', 'ისთვის', 'ივით', 'ისა', 'მდე', 'ზეც', 'შიც', 'იც', 'საც',
]);

/**
 * The text a voice provider should be given, for the language it will speak.
 *
 * Pure, and deliberately narrow: it respells the brand and nothing else. It
 * is NOT a place to trim, re-punctuate or shorten a reply — the wording is
 * Luna's and the segmentation is the caller's, and both have their own tests.
 */
export function speechText(text: string, language: string | null | undefined): string {
  if (!text) return text;
  const lang = String(language ?? '').toLowerCase().split('-')[0] as TalkLanguage;
  const spoken = BRAND_SPOKEN[lang];
  if (!spoken) return text;

  return text.replace(
    BRAND_RE,
    (_whole, _stem: string, dash: string, tail: string | undefined) => {
      /*
       * A Georgian case ending belongs to the name, and the hyphen that a
       * writer puts before it does not: `Homatch-ში` is one spoken word,
       * `ჰოუმეჩში`. Anything else after the name is left exactly as it was,
       * hyphen included, because it is the next word rather than an ending.
       */
      if (tail && lang === 'ka' && KA_SUFFIXES.has(tail)) return spoken + tail;
      return spoken + dash + (tail ?? '');
    },
  );
}

/** Whether a reply contains the brand at all — for the before/after report. */
export function mentionsBrand(text: string): boolean {
  BRAND_RE.lastIndex = 0;
  return BRAND_RE.test(text);
}
