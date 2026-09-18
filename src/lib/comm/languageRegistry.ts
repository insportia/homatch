/*
 * EVERY LANGUAGE AI TALK CAN CARRY END TO END, AND WHAT EACH ONE NEEDS.
 *
 * "Supported" here means the whole path, not a checkbox: the live recogniser
 * accepts the locale, the model answers in it, and the approved voice can
 * speak it. Each row was checked against the providers this product actually
 * runs on, not against a brochure:
 *
 *   STT   chirp_3 at the eu endpoint, one live socket per code with real
 *         PCM, 2026-09-18 -- every tag below opened without a config error
 *   TTS   Cartesia Sonic 3 language list (44 languages), read 2026-09-18
 *   LLM   the model answers in any of these
 *
 * Persian is NOT here: the recogniser takes fa-IR but the voice cannot speak
 * it, and a language that can be heard and not answered is worse than one
 * that is honestly absent. Azerbaijani, Armenian and Kazakh are absent for the
 * same reason. Punjabi is absent because the recogniser refused pa-IN outright.
 * Chinese and Filipino are absent because the live gateway only forwards a
 * two-letter-dash-two-letter tag to the recogniser; cmn-Hans-CN and fil-PH
 * silently fell back to the session default, so the first probe's "accepted"
 * for them was vacuous. They return when the gateway learns longer tags.
 *
 * One table, so the client's socket tag, the resolver's script map, the
 * recovery hints and the server's reply-language names cannot drift apart.
 */

export type Script =
  | 'georgian' | 'cyrillic' | 'arabic' | 'hebrew' | 'latin' | 'greek'
  | 'devanagari' | 'bengali' | 'tamil' | 'telugu' | 'gujarati' | 'kannada'
  | 'malayalam' | 'gurmukhi' | 'oriya' | 'thai' | 'hangul' | 'kana' | 'han'
  | 'other';

export interface LanguageEntry {
  /** ISO 639-1 (or the code Cartesia uses) -- the session's language key. */
  code: string;
  /** What the live recogniser is configured with. */
  sttTag: string;
  /** What Luna is told to reply in. */
  name: string;
  /** The script it is written in; shared scripts are disambiguated by the provider label. */
  script: Script;
}

export const LANGUAGE_REGISTRY: readonly LanguageEntry[] = [
  { code: 'ka', sttTag: 'ka-GE', name: 'Georgian', script: 'georgian' },
  { code: 'en', sttTag: 'en-US', name: 'English', script: 'latin' },
  { code: 'ru', sttTag: 'ru-RU', name: 'Russian', script: 'cyrillic' },
  { code: 'tr', sttTag: 'tr-TR', name: 'Turkish', script: 'latin' },
  { code: 'ar', sttTag: 'ar-XA', name: 'Arabic', script: 'arabic' },
  { code: 'he', sttTag: 'iw-IL', name: 'Hebrew', script: 'hebrew' },
  { code: 'hi', sttTag: 'hi-IN', name: 'Hindi', script: 'devanagari' },
  { code: 'ur', sttTag: 'ur-PK', name: 'Urdu', script: 'arabic' },
  { code: 'es', sttTag: 'es-ES', name: 'Spanish', script: 'latin' },
  { code: 'fr', sttTag: 'fr-FR', name: 'French', script: 'latin' },
  { code: 'de', sttTag: 'de-DE', name: 'German', script: 'latin' },
  { code: 'it', sttTag: 'it-IT', name: 'Italian', script: 'latin' },
  { code: 'pt', sttTag: 'pt-BR', name: 'Portuguese', script: 'latin' },
  { code: 'uk', sttTag: 'uk-UA', name: 'Ukrainian', script: 'cyrillic' },
  { code: 'pl', sttTag: 'pl-PL', name: 'Polish', script: 'latin' },
  { code: 'el', sttTag: 'el-GR', name: 'Greek', script: 'greek' },
  { code: 'ro', sttTag: 'ro-RO', name: 'Romanian', script: 'latin' },
  { code: 'bg', sttTag: 'bg-BG', name: 'Bulgarian', script: 'cyrillic' },
  { code: 'ja', sttTag: 'ja-JP', name: 'Japanese', script: 'kana' },
  { code: 'ko', sttTag: 'ko-KR', name: 'Korean', script: 'hangul' },
  { code: 'nl', sttTag: 'nl-NL', name: 'Dutch', script: 'latin' },
  { code: 'sv', sttTag: 'sv-SE', name: 'Swedish', script: 'latin' },
  { code: 'cs', sttTag: 'cs-CZ', name: 'Czech', script: 'latin' },
  { code: 'id', sttTag: 'id-ID', name: 'Indonesian', script: 'latin' },
  { code: 'vi', sttTag: 'vi-VN', name: 'Vietnamese', script: 'latin' },
  { code: 'th', sttTag: 'th-TH', name: 'Thai', script: 'thai' },
  { code: 'bn', sttTag: 'bn-IN', name: 'Bengali', script: 'bengali' },
  { code: 'ta', sttTag: 'ta-IN', name: 'Tamil', script: 'tamil' },
  { code: 'te', sttTag: 'te-IN', name: 'Telugu', script: 'telugu' },
  { code: 'gu', sttTag: 'gu-IN', name: 'Gujarati', script: 'gujarati' },
  { code: 'kn', sttTag: 'kn-IN', name: 'Kannada', script: 'kannada' },
  { code: 'ml', sttTag: 'ml-IN', name: 'Malayalam', script: 'malayalam' },
  { code: 'mr', sttTag: 'mr-IN', name: 'Marathi', script: 'devanagari' },
  { code: 'or', sttTag: 'or-IN', name: 'Odia', script: 'oriya' },
  { code: 'ms', sttTag: 'ms-MY', name: 'Malay', script: 'latin' },
  { code: 'hu', sttTag: 'hu-HU', name: 'Hungarian', script: 'latin' },
  { code: 'no', sttTag: 'nb-NO', name: 'Norwegian', script: 'latin' },
  { code: 'da', sttTag: 'da-DK', name: 'Danish', script: 'latin' },
  { code: 'fi', sttTag: 'fi-FI', name: 'Finnish', script: 'latin' },
  { code: 'hr', sttTag: 'hr-HR', name: 'Croatian', script: 'latin' },
  { code: 'sk', sttTag: 'sk-SK', name: 'Slovak', script: 'latin' },
] as const;

export const LANGUAGE_CODES = LANGUAGE_REGISTRY.map((l) => l.code);

export const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  LANGUAGE_REGISTRY.map((l) => [l.code, l.name]),
);

/** The socket tag for a session language; undefined when it is not one of ours. */
export const STT_TAGS: Record<string, string> = Object.fromEntries(
  LANGUAGE_REGISTRY.map((l) => [l.code, l.sttTag]),
);

export const SCRIPT_OF: Record<string, Script> = Object.fromEntries(
  LANGUAGE_REGISTRY.map((l) => [l.code, l.script]),
);

/** Languages written in Latin letters: script alone cannot tell them apart. */
export const LATIN_CODES: readonly string[] = LANGUAGE_REGISTRY
  .filter((l) => l.script === 'latin').map((l) => l.code);

/**
 * The languages that share a script, in the order a bare script resolves to
 * when nothing else says otherwise: the first is the default.
 */
export const SCRIPT_FAMILIES: Partial<Record<Script, readonly string[]>> = {
  georgian: ['ka'],
  cyrillic: ['ru', 'uk', 'bg'],
  arabic: ['ar', 'ur'],
  hebrew: ['he'],
  greek: ['el'],
  devanagari: ['hi', 'mr'],
  bengali: ['bn'],
  tamil: ['ta'],
  telugu: ['te'],
  gujarati: ['gu'],
  kannada: ['kn'],
  malayalam: ['ml'],
  oriya: ['or'],
  thai: ['th'],
  hangul: ['ko'],
  kana: ['ja'],
  han: ['ja'],
};

/** Unicode script tests, in the order the evidence is scored. */
export const SCRIPT_TESTS: ReadonlyArray<readonly [Script, RegExp]> = [
  ['georgian', /\p{Script=Georgian}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['greek', /\p{Script=Greek}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['bengali', /\p{Script=Bengali}/u],
  ['tamil', /\p{Script=Tamil}/u],
  ['telugu', /\p{Script=Telugu}/u],
  ['gujarati', /\p{Script=Gujarati}/u],
  ['kannada', /\p{Script=Kannada}/u],
  ['malayalam', /\p{Script=Malayalam}/u],
  ['gurmukhi', /\p{Script=Gurmukhi}/u],
  ['oriya', /\p{Script=Oriya}/u],
  ['thai', /\p{Script=Thai}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['han', /\p{Script=Han}/u],
  ['latin', /\p{Script=Latin}/u],
];

/**
 * Which Latin-script language a substantial Latin transcript is in, by the
 * letters and function words that only some of them use. English is the
 * default because it is the Latin language this product most often hears.
 */
const LATIN_HINTS: ReadonlyArray<readonly [string, RegExp, readonly string[]]> = [
  // English has no letters of its own, so it is identified by its function
  // words alone; the empty class never matches.
  ['en', /$^/, ['the', 'and', 'is', 'are', 'what', 'how', 'much', 'this', 'that', 'you', 'for', 'with', 'my', 'of', 'it', 'have', 'want', 'looking', 'hello', 'name', 'please', 'thanks', 'okay']],
  ['tr', /[çğıöşüÇĞİÖŞÜ]/, ['ve', 'bir', 'için', 'değil', 'nasıl', 'kaç', 'benim', 'bu', 'evet', 'hayır']],
  ['es', /[ñ¿¡]/, ['que', 'de', 'el', 'la', 'los', 'para', 'con', 'cuánto', 'cuanto', 'está', 'hola', 'piso', 'cuesta', 'comprar', 'alquilar']],
  ['fr', /[àâçéèêëîïôûùüÿœ]/i, ['le', 'la', 'les', 'des', 'est', 'pour', 'avec', 'combien', 'vous', 'je', 'bonjour', 'cherche', 'deux', 'chambres', 'appartement', 'et', 'pas', 'dans']],
  ['de', /[äöüß]/i, ['und', 'ist', 'nicht', 'das', 'ich', 'wie', 'viel', 'eine', 'für', 'hallo', 'suche', 'wohnung', 'mit', 'zwei', 'heiße', 'heisse']],
  ['it', /[àèéìòù]/i, ['che', 'della', 'per', 'con', 'quanto', 'sono', 'una', 'gli', 'mi', 'chiamo', 'cerco', 'ciao', 'due', 'vorrei', 'camere', 'appartamento', 'non', 'anche', 'come', 'questo']],
  ['pt', /[ãõâê]/i, ['não', 'nao', 'para', 'com', 'quanto', 'uma', 'você', 'voce', 'olá', 'apartamento', 'alugar']],
  ['pl', /[ąćęłńóśźż]/i, ['jest', 'nie', 'jak', 'ile', 'dla', 'mieszkanie']],
  ['ro', /[ăâîșşțţ]/i, ['este', 'pentru', 'cât', 'cat', 'apartament']],
  ['nl', /\b(het|een|niet|hoeveel|voor|van)\b/i, ['het', 'een', 'niet', 'hoeveel']],
  ['cs', /[ěřůňťď]/i, ['jak', 'kolik', 'byt', 'pro']],
  ['hu', /[őű]/i, ['hogy', 'mennyi', 'lakás', 'nem']],
];

export function scoreLatinLanguages(text: string): Array<{ code: string; score: number }> {
  const lower = text.toLowerCase();
  const words = new Set(lower.split(/[^\p{L}\p{M}']+/u).filter(Boolean));
  const out: Array<{ code: string; score: number }> = [];
  for (const [code, letters, fws] of LATIN_HINTS) {
    let score = letters.test(text) ? 2 : 0;
    for (const w of fws) if (words.has(w)) score += 1;
    if (score >= 2) out.push({ code, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function guessLatinLanguage(text: string, fallback = 'en'): string {
  return scoreLatinLanguages(text)[0]?.code ?? fallback;
}

/**
 * Which Latin language a transcript is in when it is NOT the one the socket
 * was configured for: the best-scoring language, only when it clearly beats
 * the configured one. An English socket hearing "Hola, me llamo Tariel y
 * busco un piso" writes Spanish words and labels them en-US; the words win.
 */
export function latinLanguageAgainst(text: string, configured: string): string | null {
  const scores = scoreLatinLanguages(text);
  const best = scores[0];
  if (!best || best.code === configured) return null;
  const own = scores.find((s) => s.code === configured)?.score ?? 0;
  return best.score >= 3 && best.score >= own + 2 ? best.code : null;
}

/** Cyrillic siblings, by the letters only one of them uses. */
export function guessCyrillicLanguage(text: string, fallback = 'ru'): string {
  if (/[іїєґІЇЄҐ]/.test(text)) return 'uk';
  return fallback;
}
