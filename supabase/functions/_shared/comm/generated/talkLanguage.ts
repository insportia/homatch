// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/talkLanguage.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

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

export const TALK_LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
export type TalkLanguage = (typeof TALK_LANGUAGES)[number];

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

export type TalkScript = 'georgian' | 'cyrillic' | 'arabic' | 'hebrew' | 'latin' | 'other';

/** Which script a transcript is written in, and how dominant it is. */
export interface ScriptEvidence {
  script: TalkScript | null;
  ratio: number;
  letters: number;
}

const SCRIPTS: Array<[TalkScript, RegExp]> = [
  ['georgian', /\p{Script=Georgian}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['latin', /\p{Script=Latin}/u],
];

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
const SCRIPT_LANGUAGE: Partial<Record<TalkScript, TalkLanguage>> = {
  georgian: 'ka',
  cyrillic: 'ru',
  arabic: 'ar',
  hebrew: 'he',
};

/** The two of our six that share the Latin alphabet and cannot be told apart by it. */
const LATIN_LANGUAGES: TalkLanguage[] = ['en', 'tr'];

export type ResolutionReason =
  | 'SCRIPT'              // the alphabet settles it
  | 'PROVIDER_LATIN'      // Latin text, and the provider named one of ours
  | 'STICKY_LATIN'        // Latin text, no usable label, session already settled
  | 'LOCALE_LATIN'        // Latin text, nothing else, the UI locale is Latin
  | 'STICKY_HELD'         // evidence too weak to move an established session
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
}

/** Below this, a turn may not move an already-established session language. */
export const SWITCH_MIN_CONFIDENCE = 0.6;
/** Below this many letters, a turn is not evidence of anything. */
export const SWITCH_MIN_LETTERS = 6;

export interface ResolveInput {
  transcript: string;
  /** The recogniser's own label, in whatever spelling it used. */
  providerLanguage?: string | null;
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
      const tooShort = evidence.letters < SWITCH_MIN_LETTERS;
      if (tooShort || confidence < SWITCH_MIN_CONFIDENCE) {
        language = prior;
        reason = 'STICKY_HELD';
        score = 0.5;
      }
    }

    return { ...base, resolvedLanguage: language, resolutionReason: reason, confidence: score, switched: Boolean(previous) && language !== previous };
  };

  // 1. The alphabet, where it belongs to exactly one of ours.
  if (evidence.script && evidence.ratio >= 0.5) {
    const byScript = SCRIPT_LANGUAGE[evidence.script];
    if (byScript) {
      // Strong and unambiguous: this is allowed to switch a session.
      return decide(byScript, 'SCRIPT', 0.5 + evidence.ratio / 2);
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
        return decide(provider, 'PROVIDER_LATIN', leavingNonLatin && !substantial ? 0.35 : 0.7);
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
export function textMatchesLanguage(text: string, language: TalkLanguage): boolean {
  const evidence = scriptEvidence(text);
  // Too little to judge. A three-word answer is not a language violation.
  if (evidence.letters < SWITCH_MIN_LETTERS) return true;

  const expected: Partial<Record<TalkLanguage, TalkScript>> = {
    ka: 'georgian', ru: 'cyrillic', ar: 'arabic', he: 'hebrew',
  };
  const want = expected[language];

  if (want) return evidence.script === want && evidence.ratio >= 0.5;
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
const LANGUAGE_REQUEST_TERMS: Record<TalkLanguage, string[]> = {
  ka: ['ქართულ', 'georgian', 'грузинс', 'gürcüce', 'gurcuce', 'جورجي', 'גאורגי'],
  en: ['ინგლისურ', 'english', 'английск', 'ingilizce', 'إنجليزي', 'انجليزي', 'אנגלית'],
  ru: ['რუსულ', 'russian', 'русск', 'rusça', 'rusca', 'روسي', 'רוסית'],
  tr: ['თურქულ', 'turkish', 'турецк', 'türkçe', 'turkce', 'تركي', 'טורקית'],
  ar: ['არაბულ', 'arabic', 'арабск', 'arapça', 'arapca', 'عربي', 'ערבית'],
  he: ['ებრაულ', 'hebrew', 'иврит', 'еврейск', 'ibranice', 'عبري', 'עברית'],
};

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
  'speak', 'talk', 'switch', 'continue', 'answer', 'reply', 'in ', 'let us', "let's",
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
    if (!LANGUAGE_REQUEST_TERMS[language].some((term) => text.includes(term))) continue;
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
