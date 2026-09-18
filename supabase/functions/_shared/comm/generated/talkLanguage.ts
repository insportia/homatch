// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/talkLanguage.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

import {
  LANGUAGE_CODES, LANGUAGE_NAMES, LATIN_CODES, SCRIPT_FAMILIES, SCRIPT_TESTS, guessLatinLanguage,
  latinLanguageAgainst, guessCyrillicLanguage, isGreeting, SCRIPT_OF, type Script,
} from './languageRegistry.ts';
// HOMATCH AI TALK — one place that decides what language a turn is in.
//
// WHY THIS FILE EXISTS
//
// Language was being decided in five places: the worker chose a recogniser
// config, the gateway forwarded a label, the browser ran a stabiliser, the
// edge function picked a reply language from script-or-hint-or-locale, and the
// voice lookup picked a row from whatever came out. Each was defensible. The
// combination produced a live session containing Georgian, Korean and
// Devanagari at once.
//
// WHAT ACTUALLY HAPPENED, MEASURED ON THE DEPLOYED PATH
//
// Chirp's `auto` language detection is not scoped to a product's languages. It
// is scoped to every language Google supports. Fed short Georgian — the kind
// of thing a real caller says — it returned:
//
//   დიახ.              -> lb  "dir"
//   არა, გმადლობთ.     -> ko  "아, 고맙습니다."
//   კარგი.             -> ha  "Karki"
//   ვაკეში.            -> en  "Wackisch"
//   კი, მაინტერესებს.  -> lt  "Ki, ma interesas."
//
// Two of eight came back as Georgian. The transcript itself is in the wrong
// script, so this was never a labelling problem that better handling could
// paper over: the words were wrong. That text went to the screen, the bogus
// language went into session state, and the voice lookup then found no
// approved voice for Korean and produced a silent turn. One cause, both
// symptoms.
//
// THE RULE THIS FILE ENFORCES
//
// A turn's language is one of six, decided from evidence, in a fixed order,
// and nothing outside those six can enter the system at any point. Not from a
// provider, not from a locale, not from a cached session. The resolver is
// pure and total: same inputs, same answer, always one of the six.

/*
 * The languages this product can carry end to end. Six became forty-four on
 * 2026-09-18, each one checked against the live recogniser and the voice's
 * own language list; see languageRegistry.ts, which is the single table the
 * socket tag, the script map, the recovery hints and the reply names all
 * come from.
 */
export const TALK_LANGUAGES = LANGUAGE_CODES as readonly string[];
export type TalkLanguage = string;

const SUPPORTED = new Set<string>(TALK_LANGUAGES);

/**
 * Provider spellings that mean one of our six.
 *
 * `iw` is Hebrew: ISO renamed it to `he` in 1989 and several Google APIs still
 * emit the old code. The rest are the ordinary regional variants. Anything not
 * listed and not already one of the six resolves to null, which is the whole
 * point — an unsupported language has no representation in this system.
 */
const ALIASES: Record<string, TalkLanguage> = {
  iw: 'he', heb: 'he',
  nb: 'no', nn: 'no', nor: 'no',
  hin: 'hi', urd: 'ur', ben: 'bn', tam: 'ta', tel: 'te', guj: 'gu', kan: 'kn', mal: 'ml',
  mar: 'mr', pan: 'pa', ori: 'or', msa: 'ms', may: 'ms',
  spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt', ukr: 'uk',
  pol: 'pl', ell: 'el', gre: 'el', ron: 'ro', rum: 'ro', bul: 'bg', jpn: 'ja', kor: 'ko',
  nld: 'nl', dut: 'nl', swe: 'sv', ces: 'cs', cze: 'cs', ind: 'id', vie: 'vi', tha: 'th',
  hun: 'hu', dan: 'da', fin: 'fi', hrv: 'hr', slk: 'sk', slo: 'sk',
  kat: 'ka', geo: 'ka',
  rus: 'ru',
  tur: 'tr',
  ara: 'ar',
  eng: 'en',
};

/**
 * A provider tag as one of our six, or null.
 *
 * Null is a real answer and must be handled as one. It means "this is not a
 * language AI TALK speaks", which is true of Korean, Luxembourgish and Hausa,
 * all of which production has now seen.
 */
export function normaliseLanguage(tag: unknown): TalkLanguage | null {
  const base = String(tag ?? '').toLowerCase().trim().split(/[-_]/)[0];
  if (!base) return null;
  if (SUPPORTED.has(base)) return base as TalkLanguage;
  return ALIASES[base] ?? null;
}

export type TalkScript = Script;

/** Which script a transcript is written in, and how dominant it is. */
export interface ScriptEvidence {
  script: TalkScript | null;
  ratio: number;
  letters: number;
}

const SCRIPTS: ReadonlyArray<readonly [TalkScript, RegExp]> = SCRIPT_TESTS;

/**
 * The dominant script, counted over letters only.
 *
 * Punctuation, digits and spaces are excluded because "150,000" is not
 * evidence of anything and a sentence that is half numerals would otherwise
 * look like it had no script at all.
 */
export function scriptEvidence(text: string): ScriptEvidence {
  const letters = [...String(text ?? '')].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return { script: null, ratio: 0, letters: 0 };

  let best: TalkScript = 'other';
  let bestCount = 0;
  for (const [name, re] of SCRIPTS) {
    const count = letters.filter((c) => re.test(c)).length;
    if (count > bestCount) { bestCount = count; best = name; }
  }
  const ratio = bestCount / letters.length;
  // Below half, nothing is dominant and the text is mixed or unrecognised.
  return { script: bestCount ? best : 'other', ratio, letters: letters.length };
}

/**
 * Scripts that belong to exactly one of our six languages.
 *
 * These are decisive. Georgian Mkhedruli is not English; Hebrew script is not
 * Georgian. Among the six we support, Cyrillic means Russian — which is a
 * statement about this product's languages, not about Cyrillic.
 */
/*
 * A script names a family, and the first member is the default. Where a
 * family has siblings (Cyrillic: ru/uk/bg; Arabic: ar/ur; Devanagari: hi/mr;
 * Han: zh/ja) the provider's label or the established session picks the
 * sibling, because the letters alone cannot.
 */
const SCRIPT_LANGUAGE: Partial<Record<TalkScript, TalkLanguage>> = Object.fromEntries(
  Object.entries(SCRIPT_FAMILIES).map(([script, family]) => [script, family[0]]),
) as Partial<Record<TalkScript, TalkLanguage>>;

function siblingIn(script: TalkScript, candidate: TalkLanguage | null | undefined): TalkLanguage | null {
  if (!candidate) return null;
  const family = SCRIPT_FAMILIES[script];
  return family && family.includes(candidate) ? candidate : null;
}

/** The two of our six that share the Latin alphabet and cannot be told apart by it. */
const LATIN_LANGUAGES: readonly TalkLanguage[] = LATIN_CODES;

export type ResolutionReason =
  | 'SCRIPT'              // the alphabet settles it
  | 'PROVIDER_LATIN'      // Latin text, and the provider named one of ours
  | 'LATIN_LEXICAL'       // Latin text whose WORDS are another Latin language
  | 'LEXICAL_GREETING'    // a genuine greeting, on a session's first turn
  | 'STICKY_LATIN'        // Latin text, no usable label, session already settled
  | 'LOCALE_LATIN'        // Latin text, nothing else, the UI locale is Latin
  | 'STICKY_HELD'         // evidence too weak to move an established session
  | 'LATIN_FROM_PINNED'   // substantial Latin text out of a non-Latin-pinned socket
  | 'STICKY'              // no evidence at all, session continues
  | 'LOCALE'              // no session yet, fall back to the interface language
  | 'DEFAULT';            // nothing at all to go on

export interface LanguageResolution {
  /** Exactly what the provider said, kept for the trace and never used raw. */
  providerLanguage: string | null;
  /** That tag as one of our six, or null when it is not one of ours. */
  normalizedProviderLanguage: TalkLanguage | null;
  transcript: string;
  transcriptScript: TalkScript | null;
  transcriptScriptRatio: number;
  previousSessionLanguage: TalkLanguage | null;
  pageLocale: TalkLanguage | null;
  resolvedLanguage: TalkLanguage;
  resolutionReason: ResolutionReason;
  /** How much this turn's own evidence supports the answer, 0..1. */
  confidence: number;
  /** True when the answer differs from the language the session was in. */
  switched: boolean;
  /**
   * True when this turn was too short to be evidence of anything: a word or
   * two. The language above is then the prior, not a finding, and the model
   * is told so -- "Shalom" after a Georgian conversation is answered like a
   * greeting, not echoed as one.
   */
  weakEvidence: boolean;
}

/** Below this, a turn may not move an already-established session language. */
export const SWITCH_MIN_CONFIDENCE = 0.6;
/** Below this many letters, a turn is not evidence of anything. */
export const SWITCH_MIN_LETTERS = 6;
/*
 * WHAT SIX LETTERS MEAN IN A SYLLABARY.
 *
 * Six was calibrated on alphabets, where six letters is one short word.
 * A Hangul block or a kana is a whole syllable, so six of them is "no,
 * thanks" -- and "no, thanks" is exactly the kind of utterance that must not
 * move a session. The capture that proved it: a Georgian speaker's
 * "არა, გმადლობთ" came back from an auto-language socket as "아, 고맙습니다",
 * six blocks, labelled Korean. Two words of a language that is now supported
 * must not weigh more than two words of one that never was.
 */
export const SWITCH_MIN_LETTERS_BY_SCRIPT: Partial<Record<TalkScript, number>> = {
  hangul: 8,
  kana: 10,
};

export interface ResolveInput {
  transcript: string;
  /** The recogniser's own label, in whatever spelling it used. */
  providerLanguage?: string | null;
  /**
   * TRUE WHEN THAT LABEL IS A DETECTION, FALSE WHEN IT IS A CONFIGURATION.
   *
   * A live socket pinned to ka-GE reports "ka-GE" for every utterance,
   * including the Turkish one it just wrote in Arabic letters: that label is
   * what it was told, not what it heard, and it carries no evidence at all.
   * A label from the `auto` second opinion or from the batch recogniser is
   * the opposite -- nothing configured it, so it is the provider's finding.
   * The two used to be the same string, so the resolver had to discount both
   * equally, and a short clear switch out of a non-Latin session was held.
   */
  providerDetected?: boolean;
  /**
   * True while no turn of this session has resolved a language yet. The page
   * is the only prior then, and it is a much weaker one than a conversation
   * somebody has actually been having.
   */
  firstTurn?: boolean;
  previousSessionLanguage?: string | null;
  pageLocale?: string | null;
  /** Used only when there is nothing else at all. */
  fallback?: TalkLanguage;
}

/**
 * What language this turn is in.
 *
 * ORDER OF EVIDENCE, STRONGEST FIRST
 *
 *   1. The script. Georgian, Cyrillic, Arabic and Hebrew each belong to
 *      exactly one of our six, and an alphabet is not an opinion. A provider
 *      label that contradicts the script loses — measured in production, an
 *      English sentence came back labelled ka-GE.
 *
 *   2. For Latin text, the provider's label, because English and Turkish share
 *      an alphabet and nothing in the text can separate them. This is the one
 *      place the label is trusted, and only when it names one of our six.
 *
 *   3. The language the session already settled on. People do not usually
 *      change language mid-call, and treating every ambiguous turn as a
 *      possible switch is how a Georgian session became Korean.
 *
 *   4. The interface locale, which says where somebody arrived rather than
 *      what they are speaking.
 *
 * An unsupported provider label contributes NOTHING at any stage. It is not
 * ranked below the others; it does not exist.
 */
export function resolveTurnLanguage(input: ResolveInput): LanguageResolution {
  const transcript = String(input.transcript ?? '');
  const providerRaw = input.providerLanguage ? String(input.providerLanguage) : null;
  const provider = normaliseLanguage(providerRaw);
  const previous = normaliseLanguage(input.previousSessionLanguage);
  const locale = normaliseLanguage(input.pageLocale);
  const fallback: TalkLanguage = input.fallback && SUPPORTED.has(input.fallback)
    ? input.fallback
    : (previous ?? locale ?? 'ka');

  const evidence = scriptEvidence(transcript);

  const base = {
    providerLanguage: providerRaw,
    normalizedProviderLanguage: provider,
    transcript,
    transcriptScript: evidence.script,
    transcriptScriptRatio: Math.round(evidence.ratio * 100) / 100,
    previousSessionLanguage: previous,
    pageLocale: locale,
  };

  const decide = (
    resolvedLanguage: TalkLanguage,
    resolutionReason: ResolutionReason,
    confidence: number,
  ): LanguageResolution => {
    /*
     * STICKINESS IS APPLIED HERE, ONCE, RATHER THAN BY EACH CALLER.
     *
     * A session that has settled on a language only moves on evidence strong
     * enough to mean it. Weak evidence keeps what is already there, which is
     * both what people actually do and what stops one odd label from
     * redefining a conversation.
     */
    let language = resolvedLanguage;
    let reason = resolutionReason;
    let score = confidence;

    const words = transcript.trim().split(/\s+/).filter(Boolean).length;

    /*
     * THE PAGE IS A PRIOR ON THE FIRST TURN, NOT JUST THE PREVIOUS TURN.
     *
     * This only held a language once the session already had one, so the
     * FIRST utterance could be redefined by a single weak token. Measured on
     * a real Android phone, on the Georgian site: a clipped Georgian word
     * came back as "Abba", labelled English, and the whole session switched
     * to English on four letters.
     *
     * Somebody who opened the Georgian site is probably going to speak
     * Georgian, which is weak evidence but not no evidence -- and it is
     * certainly stronger than one four-letter hypothesis. It is a prior and
     * not a lock: a real English sentence clears SWITCH_MIN_LETTERS easily
     * and still switches on its first turn, which is how the six-language
     * first-turn behaviour keeps working.
     */
    const prior = previous ?? locale;
    if (prior && language !== prior) {
      const minLetters = (evidence.script && SWITCH_MIN_LETTERS_BY_SCRIPT[evidence.script]) ?? SWITCH_MIN_LETTERS;
      /*
       * THE LETTER FLOOR COUNTS LETTERS, AND A QUESTION ABOUT NUMBERS HAS FEW.
       *
       * Measured: "כמה זה 2 + 2?" is five Hebrew letters -- the digits and the
       * plus are not letters -- so a plainly Hebrew question was held in
       * Russian, and answered in Russian. Several words is the other way to
       * be more than a one-word mis-hearing, and the confidence test below
       * still guards every Latin case, which is where the corruptions live.
       */
      const tooShort = evidence.letters < minLetters && words < 3;
      /*
       * ONE WORD CAN BE EVIDENCE IF IT IS A WORD.
       *
       * The floor above exists for what a recogniser INVENTS out of a syllable
       * it could not place -- "Abba", "Karki", "dir", "Wackisch". A greeting is
       * the opposite: a closed list of things people actually say, matched
       * whole. On a session's first turn the only prior is the page somebody
       * happened to open, and holding "Hello." to it answered an English
       * speaker in Georgian. The threshold is not lowered; this is a separate,
       * positive piece of lexical evidence, and it needs a DETECTED label --
       * the pinned socket's own configuration can never supply it.
       */
      const genuineGreeting = Boolean(input.firstTurn)
        && Boolean(input.providerDetected)
        && isGreeting(transcript, language);
      if (tooShort || confidence < SWITCH_MIN_CONFIDENCE) {
        if (genuineGreeting) {
          reason = 'LEXICAL_GREETING';
          score = 0.65;
        } else {
          language = prior;
          reason = 'STICKY_HELD';
          score = 0.5;
        }
      }
    }

    const weakEvidence = evidence.letters < SWITCH_MIN_LETTERS || words <= 1;
    return { ...base, resolvedLanguage: language, resolutionReason: reason, confidence: score, switched: Boolean(previous) && language !== previous, weakEvidence };
  };

  // 1. The alphabet, where it belongs to exactly one of ours.
  if (evidence.script && evidence.ratio >= 0.5) {
    const byScript = SCRIPT_LANGUAGE[evidence.script];
    if (byScript) {
      const lettered = evidence.script === 'cyrillic' ? guessCyrillicLanguage(transcript, '') : '';
      const sibling = siblingIn(evidence.script!, provider)
        ?? (lettered ? siblingIn(evidence.script!, lettered) : null)
        ?? siblingIn(evidence.script!, previous) ?? byScript;
      return decide(sibling, 'SCRIPT', 0.5 + evidence.ratio / 2);
    }

    // 2. Latin: English and Turkish, which the alphabet cannot separate.
    if (evidence.script === 'latin') {
      if (provider && LATIN_LANGUAGES.includes(provider)) {
        /*
         * HOW MUCH LATIN IT TAKES TO LEAVE A NON-LATIN SESSION.
         *
         * The hardest real case: Georgian audio mis-transcribed into Latin
         * letters AND labelled with a language we support. "ვაკეში." came
         * back as "Wackisch" tagged en. Script cannot separate that from
         * somebody genuinely saying one English word, and the label agrees
         * with the wrong answer.
         *
         * Length can. A person switching language says a sentence; a
         * mis-transcription is a fragment. So leaving a non-Latin session on
         * the strength of a provider label needs a real utterance behind it,
         * and a single stray token keeps the session where it was.
         *
         * Between two Latin languages — English and Turkish — there is no
         * such asymmetry and the label is taken at face value.
         */
        const words = transcript.trim().split(/\s+/).filter(Boolean).length;
        // Leaving a non-Latin language, whether the session had settled on one
      // or the page simply is one. Both are reasons to want more evidence.
      const anchor = previous ?? locale;
      const leavingNonLatin = Boolean(anchor) && !LATIN_LANGUAGES.includes(anchor!);
        const substantial = words >= 4 || evidence.letters >= 15;
        // A DETECTED label needs less text than a configured one: "Benim adım
        // ne?" is three words and twelve letters -- below the bar written for
        // corrupted transcripts -- but a recogniser that was not told the
        // language and answered "Turkish" has actually identified it.
        const detectedEnough = Boolean(input.providerDetected) && words >= 2;
        // The socket was configured for one Latin language and wrote another:
        // "Hola, me llamo Tariel y busco un piso" labelled en-US. The words
        // outrank the configuration, at the same bar a switch needs.
        const lexical = substantial ? latinLanguageAgainst(transcript, provider) : null;
        if (lexical && LATIN_LANGUAGES.includes(lexical)) return decide(lexical, 'LATIN_LEXICAL', 0.65);
        return decide(provider, 'PROVIDER_LATIN', leavingNonLatin && !substantial && !detectedEnough ? 0.35 : 0.7);
      }
      if (previous && LATIN_LANGUAGES.includes(previous)) {
        return decide(previous, 'STICKY_LATIN', 0.55);
      }
      if (locale && LATIN_LANGUAGES.includes(locale)) {
        return decide(locale, 'LOCALE_LATIN', 0.45);
      }
      /*
       * Latin text in a session that is not Latin. This is the shape of the
       * corruption: Georgian audio transcribed as "Wackisch" or "Karki".
       * Deliberately weak, so stickiness keeps the established language.
       */
      /*
       * ...UNLESS THE LATIN IS SUBSTANTIAL AND CAME OUT OF A SOCKET PINNED TO
       * A NON-LATIN LANGUAGE. Then it is evidence, not corruption.
       *
       * The socket is pinned to the session's language, so the provider's
       * label is its configuration, not a detection: a ru-RU socket says
       * "ru" whatever it hears. On a real Windows session the visitor moved
       * from Russian to a clear English sentence; the ru-RU socket wrote it
       * in Latin letters, the label still said ru, and the line below held
       * the session in Russian at 0.2. The reply came back in Russian, twice.
       *
       * The bar is the one PROVIDER_LATIN already uses to leave a non-Latin
       * session -- four words or fifteen letters -- so "Wackisch", "Karki",
       * or a Georgian speaker's "Homatch ROI" still cannot do this. Which
       * Latin language is settled by the text (Turkish has letters English
       * does not) and otherwise by English.
       */
      const anchorLang = previous ?? locale;
      const latinWords = transcript.trim().split(/\s+/).filter(Boolean).length;
      const substantialLatin = evidence.ratio >= 0.5 && (latinWords >= 4 || evidence.letters >= 15);
      if (substantialLatin && anchorLang && !LATIN_LANGUAGES.includes(anchorLang)) {
        return decide(guessLatinLanguage(transcript, 'en'), 'LATIN_FROM_PINNED', 0.7);
      }
      return decide(previous ?? locale ?? fallback, 'STICKY_HELD', 0.2);
    }
  }

  // 3 and 4. No usable script evidence.
  if (previous) return decide(previous, 'STICKY', 0.4);
  if (locale) return decide(locale, 'LOCALE', 0.35);
  return decide(fallback, 'DEFAULT', 0.2);
}

/**
 * Is a piece of text plausibly in this language?
 *
 * Used to check what the model wrote before anybody hears it. Script-based, so
 * it is decisive for four of the six and silent about English versus Turkish,
 * which is honest: nothing cheap can tell those apart, and pretending
 * otherwise would reject correct answers.
 */
/** Letters that exist in Turkish and not in English, in either case. */
const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
function looksTurkish(text: string): boolean {
  return TURKISH_LETTERS.test(text);
}

export function textMatchesLanguage(text: string, language: TalkLanguage): boolean {
  const evidence = scriptEvidence(text);
  // Too little to judge. A three-word answer is not a language violation.
  if (evidence.letters < SWITCH_MIN_LETTERS) return true;

  /*
   * The script each language is written in comes from the registry. The
   * first version listed four and demanded LATIN for everything else, so a
   * Hindi reply in Devanagari was judged "wrong language", retried, and cut
   * -- measured on the first chain run, 2026-09-18. Cyrillic, Arabic and
   * Devanagari siblings share a script and are accepted as each other here;
   * telling Ukrainian from Russian is the resolver's job, not the guard's.
   */
  const want = SCRIPT_OF[language];
  if (want && want !== 'latin') return evidence.script === want && evidence.ratio >= 0.5;
  // en and tr: any Latin-dominant answer is acceptable; a Georgian or Korean
  // one is not.
  return evidence.script === 'latin' && evidence.ratio >= 0.5;
}

/*
 * ASKING FOR A DIFFERENT LANGUAGE, WHICH IS NOT THE SAME AS SPEAKING ONE.
 *
 * "ინგლისურად მელაპარაკე" is a Georgian sentence. Everything that decides a
 * turn's language agrees it is Georgian, and every one of them is right: the
 * script is Georgian, the recogniser was configured for Georgian, and the
 * words are Georgian words. The visitor is nonetheless asking to stop
 * speaking Georgian.
 *
 * Without this the request was not merely ignored, it was actively undone.
 * The model would answer in English because it had been asked to, and the
 * reply-language guard -- which exists so a Georgian session cannot silently
 * become Korean -- would see English where it expected Georgian, throw the
 * answer away and retry it with a blunter instruction to use Georgian. The
 * one thing the visitor explicitly asked for was the one thing the system
 * was built to prevent.
 *
 * So the request is read BEFORE the reply is generated, from the words
 * themselves. Deterministic and testable: no model call decides this, because
 * a model call is exactly what cannot be trusted to obey it.
 */

/** What each language is called, in each language somebody might ask in. */
const HAND_WRITTEN_REQUEST_TERMS: Record<string, string[]> = {
  ka: ['ქართულ', 'georgian', 'грузинс', 'gürcüce', 'gurcuce', 'جورجي', 'גאורגי'],
  en: ['ინგლისურ', 'english', 'английск', 'ingilizce', 'إنجليزي', 'انجليزي', 'אנגלית'],
  ru: ['რუსულ', 'russian', 'русск', 'rusça', 'rusca', 'روسي', 'רוסית'],
  tr: ['თურქულ', 'turkish', 'турецк', 'türkçe', 'turkce', 'تركي', 'טורקית'],
  ar: ['არაბულ', 'arabic', 'арабск', 'arapça', 'arapca', 'عربي', 'ערבית'],
  he: ['ებრაულ', 'hebrew', 'иврит', 'еврейск', 'ibranice', 'عبري', 'עברית'],
  /*
   * The languages that arrived on 2026-09-18: named in English, in the
   * language itself, and -- for the ones a Georgian or Russian speaker is
   * likely to ask for -- in Georgian and Russian. Stems, not whole words,
   * for the same reason as above: "ესპანურად" and "испанском" both inflect.
   */
  hi: ['hindi', 'हिंदी', 'हिन्दी', 'ჰინდი', 'хинди'],
  ur: ['urdu', 'اردو', 'ურდუ', 'урду'],
  es: ['spanish', 'español', 'espanol', 'castellano', 'ესპანურ', 'испанск'],
  fr: ['french', 'français', 'francais', 'ფრანგულ', 'французск'],
  de: ['german', 'deutsch', 'გერმანულ', 'немецк'],
  it: ['italian', 'italiano', 'იტალიურ', 'итальянск'],
  pt: ['portuguese', 'português', 'portugues', 'პორტუგალიურ', 'португальск'],
  uk: ['ukrainian', 'українськ', 'უკრაინულ', 'украинск'],
  pl: ['polish', 'polsk', 'პოლონურ', 'польск'],
  el: ['greek', 'ελληνικ', 'ბერძნულ', 'греческ'],
  ro: ['romanian', 'român', 'romana', 'რუმინულ', 'румынск'],
  bg: ['bulgarian', 'българск', 'ბულგარულ', 'болгарск'],
  zh: ['chinese', 'mandarin', '中文', '汉语', '漢語', '普通话', 'ჩინურ', 'китайск'],
  ja: ['japanese', '日本語', 'იაპონურ', 'японск'],
  ko: ['korean', '한국어', '한국말', 'კორეულ', 'корейск'],
  nl: ['dutch', 'nederlands', 'ჰოლანდიურ', 'голландск', 'нидерландск'],
  sv: ['swedish', 'svenska', 'შვედურ', 'шведск'],
  cs: ['czech', 'čeština', 'cestina', 'česky', 'ჩეხურ', 'чешск'],
  id: ['indonesian', 'bahasa indonesia', 'ინდონეზიურ', 'индонезийск'],
  vi: ['vietnamese', 'tiếng việt', 'tieng viet', 'ვიეტნამურ', 'вьетнамск'],
  th: ['thai', 'ไทย', 'ტაილანდურ', 'тайск'],
  bn: ['bengali', 'bangla', 'বাংলা', 'ბენგალურ', 'бенгальск'],
  ta: ['tamil', 'தமிழ்', 'ტამილურ', 'тамильск'],
  te: ['telugu', 'తెలుగు', 'ტელუგუ', 'телугу'],
  gu: ['gujarati', 'ગુજરાતી', 'გუჯარათ', 'гуджарати'],
  kn: ['kannada', 'ಕನ್ನಡ', 'კანადა ენ', 'каннада'],
  ml: ['malayalam', 'മലയാളം', 'მალაიალამ', 'малаялам'],
  mr: ['marathi', 'मराठी', 'მარათჰი', 'маратхи'],
  or: ['odia', 'oriya', 'ଓଡ଼ିଆ', 'ორია', 'ория'],
  ms: ['malay', 'bahasa melayu', 'melayu', 'მალაიურ', 'малайск'],
  tl: ['filipino', 'tagalog', 'ფილიპინურ', 'филиппинск', 'тагальск'],
  hu: ['hungarian', 'magyar', 'უნგრულ', 'венгерск'],
  no: ['norwegian', 'norsk', 'ნორვეგიულ', 'норвежск'],
  da: ['danish', 'dansk', 'დანიურ', 'датск'],
  fi: ['finnish', 'suomi', 'suomea', 'ფინურ', 'финск'],
  hr: ['croatian', 'hrvatski', 'ხორვატიულ', 'хорватск'],
  sk: ['slovak', 'slovenčina', 'slovencina', 'slovensky', 'სლოვაკურ', 'словацк'],
};

/**
 * Every language in the registry can be asked for. One without a hand-written
 * entry is still reachable by its English name, so adding a row to the
 * registry cannot silently create a language nobody can request.
 */
const LANGUAGE_REQUEST_TERMS: Record<string, string[]> = Object.fromEntries(
  TALK_LANGUAGES.map((code) => [
    code,
    HAND_WRITTEN_REQUEST_TERMS[code] ?? [LANGUAGE_NAMES[code]?.toLowerCase() ?? code],
  ]),
);

/**
 * Words that make a mention of a language into a REQUEST to use it.
 *
 * "Do you speak English?" and "I read the Russian listing" mention a language
 * without asking for one, and switching on those would be worse than never
 * switching at all. Georgian marks the request with the verb rather than a
 * preposition, and `-ად` is already carried by the term itself, so the
 * Georgian cues are the speaking verbs.
 */
const SWITCH_CUES = [
  // Georgian: speak to me / let us speak / switch / continue
  // 'აგრძელ' rather than a whole verb: Georgian conjugates around the root,
  // so გააგრძელე and გავაგრძელოთ share this and nothing longer.
  'ლაპარაკ', 'საუბრ', 'ესაუბრ', 'გადავიდეთ', 'აგრძელ', 'მელაპარაკ', 'მიპასუხ', 'მიპასუხე',
  // English
  'speak', 'talk', 'switch', 'continue', 'answer', 'reply', 'in ', 'let us', "let's", 'please',
  // Russian
  'говор', 'перейд', 'продолж', 'ответ', 'давай', 'по-',
  // Turkish
  'konuş', 'konus', 'geç', 'gec', 'devam', 'cevap',
  // Arabic
  'تكلم', 'تحدث', 'بال', 'أجب', 'واصل',
  // Hebrew
  'דבר', 'תדבר', 'תמשיך', 'תענה', 'בוא',
];

/**
 * The language the visitor is ASKING to be answered in, or null.
 *
 * Null is the overwhelmingly common answer and the safe one: a turn that is
 * not a language request is left entirely to the ordinary resolver.
 */
export function detectLanguageRequest(
  transcript: string, current?: TalkLanguage | null,
): TalkLanguage | null {
  const text = String(transcript ?? '').toLowerCase();
  if (!text.trim()) return null;
  // A request is a short instruction. A paragraph that happens to contain the
  // word "English" is talking about something else.
  if (text.length > 120) return null;
  if (!SWITCH_CUES.some((cue) => text.includes(cue))) return null;

  let found: TalkLanguage | null = null;
  for (const language of TALK_LANGUAGES) {
    if (!(LANGUAGE_REQUEST_TERMS[language] ?? []).some((term) => text.includes(term))) continue;
    // Two different languages named in one breath is a comparison, not an
    // instruction: "is it in English or Russian?" gets no switch.
    if (found && found !== language) return null;
    found = language;
  }
  // Already speaking it. Not a switch, and acting on it would restart the
  // recogniser for nothing.
  if (found && current && found === current) return null;
  return found;
}
