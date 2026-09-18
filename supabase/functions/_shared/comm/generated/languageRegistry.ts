// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/languageRegistry.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

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
/*
 * THE LANGUAGES THIS PRODUCT CAN ACTUALLY LISTEN IN.
 *
 * The live recogniser is PINNED, and these six tags are the only things it
 * can be pinned to. Everything else in the registry is a language the
 * assistant can REPLY in, recognised only by the `auto` second opinion --
 * which, running unrestricted, can name any language on earth and on a real
 * device sometimes does. A Georgian session was carried into TELUGU by one
 * such transcript on 2026-09-18.
 *
 * So this set is not a preference, it is a fact about the microphone, and the
 * resolver uses it as one: a switch INTO one of these is the product working
 * as designed and is believed at once. A detected language from outside it is
 * believed on the second turn that asks for it.
 */
export const SPEECH_TAGS: Record<string, string> = {
  ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL',
};

export const LISTENING_LANGUAGES: readonly string[] = Object.keys(SPEECH_TAGS);

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

/**
 * HOW EACH LANGUAGE SAYS HELLO.
 *
 * The one piece of evidence a single word can carry. A session's first
 * utterance is often exactly one word, and the floor that protects a settled
 * conversation from a mis-hearing was holding real greetings too: somebody
 * opened the Georgian page, said "Hello.", and was answered in Georgian.
 *
 * This is a closed list of words people actually greet with, so it separates
 * a greeting from the thing the floor exists for -- "Abba", "Karki", "dir",
 * "Wackisch", the phonetic fragments a recogniser invents. Those are in no
 * list and never will be.
 */
export const GREETINGS: Record<string, readonly string[]> = {
  ka: ['გამარჯობა', 'გამარჯობათ', 'სალამი', 'ჰაი', 'გაუმარჯოს', 'დილა მშვიდობისა'],
  en: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'],
  ru: ['привет', 'здравствуйте', 'здравствуй', 'добрый день', 'доброе утро', 'добрый вечер'],
  tr: ['merhaba', 'selam', 'günaydın', 'gunaydin', 'iyi günler', 'iyi gunler', 'iyi akşamlar'],
  ar: ['مرحبا', 'مرحباً', 'السلام عليكم', 'أهلا', 'اهلا', 'أهلاً', 'صباح الخير', 'مساء الخير'],
  he: ['שלום', 'היי', 'בוקר טוב', 'ערב טוב', 'אהלן'],
  hi: ['नमस्ते', 'नमस्कार', 'हैलो', 'सुप्रभात'],
  ur: ['السلام علیکم', 'ہیلو'],
  es: ['hola', 'buenos días', 'buenos dias', 'buenas tardes', 'buenas noches'],
  fr: ['bonjour', 'salut', 'bonsoir', 'coucou'],
  de: ['hallo', 'guten tag', 'guten morgen', 'guten abend', 'servus'],
  it: ['ciao', 'buongiorno', 'buonasera', 'salve'],
  pt: ['olá', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite'],
  uk: ['привіт', 'вітаю', 'доброго дня', 'добрий день'],
  pl: ['cześć', 'czesc', 'dzień dobry', 'dzien dobry', 'witam'],
  nl: ['hallo', 'hoi', 'goedemorgen', 'goedendag'],
  el: ['γεια', 'γεια σου', 'καλημέρα', 'καλησπέρα'],
  ro: ['bună', 'buna', 'salut', 'bună ziua'],
  bg: ['здравей', 'здравейте', 'добър ден'],
  cs: ['ahoj', 'dobrý den', 'dobry den'],
  sk: ['ahoj', 'dobrý deň', 'dobry den'],
  hr: ['bok', 'dobar dan'],
  hu: ['szia', 'jó napot', 'jo napot'],
  sv: ['hej', 'god morgon'],
  da: ['hej', 'goddag'],
  no: ['hei', 'god dag'],
  fi: ['hei', 'moi', 'hyvää päivää'],
  id: ['halo', 'selamat pagi', 'selamat siang'],
  ms: ['helo', 'selamat pagi'],
  vi: ['xin chào', 'chào'],
  th: ['สวัสดี', 'สวัสดีครับ', 'สวัสดีค่ะ'],
  ja: ['こんにちは', 'おはよう', 'おはようございます', 'こんばんは'],
  ko: ['안녕하세요', '안녕'],
  bn: ['নমস্কার', 'হ্যালো'],
  ta: ['வணக்கம்'],
  te: ['నమస్కారం'],
  gu: ['નમસ્તે'],
  kn: ['ನಮಸ್ಕಾರ'],
  ml: ['നമസ്കാരം'],
  mr: ['नमस्कार'],
  or: ['ନମସ୍କାର'],
};

/**
 * Is this whole utterance a greeting in that language, and nothing else?
 *
 * Whole, because the evidence is the utterance being a greeting -- not a
 * sentence that happens to open with one, which is judged on its own words.
 * Three tokens at most, so "good morning" and "السلام عليكم" fit and a
 * question does not.
 */
export function isGreeting(text: string, language: string): boolean {
  const list = GREETINGS[language];
  if (!list) return false;
  const norm = String(text ?? '').toLowerCase()
    .replace(/[^\p{L}\p{M}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return false;
  const words = norm.split(' ');
  if (words.length > 3) return false;
  return list.some((g) => (g.includes(' ') ? norm.includes(g) : words.includes(g)));
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


/* ── THE WORDS A LANGUAGE IS HELD TOGETHER WITH ───────────────────────────
 *
 * Moved here from sameTurnRecovery.ts, unchanged, because the RESOLVER needs
 * it too and cannot import that file without a cycle. It is a language fact,
 * so it belongs beside GREETINGS and LATIN_HINTS rather than beside the
 * recovery that happened to need it first.
 *
 * What it is for: real English, Turkish or Russian is full of function words
 * -- the, and, what, ve, bir, и, что -- and a transliteration of Georgian
 * into Latin or Cyrillic letters has none of them. "Madoba, najuandis."
 * carries no Spanish. That is the difference between somebody switching
 * language and a recogniser writing down a language it was not given.
 */
/** Languages whose transcripts can be checked for function words. */
export type CheckableLanguage = 'en' | 'tr' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'pl' | 'nl' | 'uk' | 'ka' | 'ar' | 'he' | 'hi';

export const FUNCTION_WORDS: Record<CheckableLanguage, string[]> = {
  // No one- or two-letter tokens: "me" is Georgian მე, "da" is და, and a
  // transliteration would otherwise pass as English on the strength of them.
  en: ['the', 'and', 'but', 'are', 'was', 'were', 'this', 'that', 'what', 'how', 'much', 'many', 'does',
    'can', 'could', 'would', 'should', 'you', 'they', 'your', 'not', 'yes', 'okay', 'about', 'there',
    'here', 'have', 'has', 'want', 'need', 'price', 'cost', 'with', 'from', 'for', 'right', 'now',
    'thank', 'thanks', 'bye', 'goodbye', 'sure', 'good', 'morning',
    'i', 'my', 'is', 'am', 'a', 'in', 'to', 'of', 'it', 'looking', 'hello', 'hi', 'name', 'please',
    'thanks', 'on', 'at', 'do', 'be', 'so', 'if', 'call', 'room', 'flat', 'apartment'],
  tr: ['ve', 'bir', 'bu', 'şu', 'o', 'ne', 'nasıl', 'kaç', 'için', 'ile', 'gibi', 'çok', 'daha', 'en',
    'mi', 'mı', 'mu', 'mü', 'var', 'yok', 'evet', 'hayır', 'ben', 'sen', 'biz', 'siz', 'da', 'de', 'ama',
    'fiyat', 'kadar', 'istiyorum', 'lütfen', 'tamam', 'peki', 'şimdi', 'burada', 'orada',
    'merhaba', 'selam', 'teşekkür', 'teşekkürler', 'tesekkurler', 'sağol', 'sagol', 'görüşürüz'],
  ru: ['и', 'а', 'но', 'в', 'на', 'с', 'по', 'за', 'из', 'к', 'о', 'у', 'не', 'да', 'нет', 'что', 'как',
    'это', 'этот', 'эта', 'я', 'ты', 'мы', 'вы', 'он', 'она', 'они', 'мне', 'меня', 'хочу', 'нужно', 'можно',
    'сколько', 'стоит', 'цена', 'квартира', 'есть', 'был', 'была', 'будет', 'если', 'или', 'же', 'ли',
    'спасибо', 'привет', 'здравствуйте', 'пожалуйста', 'хорошо', 'свидания', 'добрый'],
  es: ['que', 'los', 'las', 'para', 'con', 'una', 'por', 'como', 'cuánto', 'cuanto', 'está', 'esta', 'pero', 'también',
    'gracias', 'hola', 'adiós', 'adios', 'favor', 'buenos', 'días', 'dias'],
  fr: ['les', 'des', 'est', 'pour', 'avec', 'une', 'dans', 'que', 'combien', 'vous', 'pas', 'sur', 'mais',
    'merci', 'bonjour', 'salut', 'revoir', 'bonsoir'],
  de: ['und', 'ist', 'nicht', 'das', 'ich', 'wie', 'viel', 'eine', 'für', 'mit', 'auch', 'aber', 'sie',
    'danke', 'hallo', 'tschüss', 'bitte', 'guten'],
  it: ['che', 'della', 'per', 'con', 'quanto', 'sono', 'una', 'gli', 'non', 'anche', 'come', 'questo',
    'grazie', 'ciao', 'arrivederci', 'prego', 'buongiorno'],
  pt: ['não', 'nao', 'para', 'com', 'quanto', 'uma', 'você', 'voce', 'está', 'esta', 'mas', 'também', 'isso',
    'obrigado', 'obrigada', 'olá', 'ola', 'tchau', 'bom'],
  pl: ['jest', 'nie', 'jak', 'ile', 'dla', 'ale', 'też', 'tez', 'czy', 'tak', 'to', 'się', 'sie',
    'dziękuję', 'dziekuje', 'cześć', 'czesc', 'proszę', 'prosze', 'dzień'],
  nl: ['het', 'een', 'niet', 'hoeveel', 'voor', 'van', 'maar', 'ook', 'dat', 'wat', 'is',
    'bedankt', 'hallo', 'dag', 'alstublieft', 'goedemorgen'],
  uk: ['і', 'та', 'але', 'не', 'що', 'як', 'це', 'скільки', 'коштує', 'для', 'або', 'так', 'ні',
    'дякую', 'привіт', 'будь', 'ласка', 'добрий'],
  /*
   * The non-Latin languages a socket can be pinned to. Not for recovery
   * toward them -- script already decides those -- but for judging whether
   * a transcript in their script is a sentence or a transliteration: a
   * ka-GE socket writes Turkish speech in ARABIC letters, with none of the
   * words Arabic sentences are made of.
   */
  ka: ['და', 'არის', 'რომ', 'მე', 'შენ', 'ეს', 'რა', 'არ', 'კი', 'ვარ', 'მინდა', 'უნდა', 'თუ', 'როგორ', 'სად',
    'რამდენი', 'ბინა', 'ბინას', 'ღირს', 'ვეძებ', 'მქვია', 'გამარჯობა', 'დიახ', 'არა', 'კარგი', 'ხარ', 'ჩემი',
    'შენი', 'ან', 'მაგრამ', 'იქ', 'აქ', 'ახლა', 'ძალიან', 'ერთი', 'ორი', 'სამი',
    'მადლობა', 'გმადლობთ', 'მადლობთ', 'ნახვამდის', 'კარგად', 'გისმენთ', 'სალამი',
    /*
     * SPOKEN GEORGIAN, NOT WRITTEN GEORGIAN. These are what a person actually
     * says out loud, and their absence was making ordinary short Georgian
     * turns look like fragments -- which cost them a second opinion they did
     * not need and a wait they should never have paid.
     */
    'ხო', 'ჰო', 'აბა', 'მერე', 'ხომ', 'ცოტა', 'ბევრი', 'უფრო', 'ალბათ', 'იქნებ', 'შეიძლება',
    'მგონი', 'ვიცი', 'კაი', 'რავი', 'აი', 'ის', 'ვინ', 'როდის', 'რატომ', 'რამდენად', 'რომელი',
    'ფასი', 'ფული', 'ლარი', 'დოლარი', 'თვე', 'წელი', 'დღეს', 'ხვალ', 'გუშინ', 'ახლავე',
    'შემიძლია', 'მომწონს', 'არაუშავს', 'კითხვა', 'პასუხი', 'გავიგე', 'მითხარი', 'მაჩვენე',
    'უბანი', 'ქუჩა', 'სახლი', 'ეზო', 'სართულზე', 'ოთახი', 'ოთახიანი', 'კვადრატი', 'ფართი',
    // The whole-sentence answers somebody returns to Georgian with, named
    // from the owner's own physical session. One of these IS the turn.
    'მოკლედ', 'გასაგებია', 'რას', 'ამბობ', 'გაჩერდი', 'მოიცა', 'ნამდვილად', 'აუცილებლად',
    'სხვა', 'იგივე', 'უკეთესი', 'იაფი', 'ძვირი', 'გინდა', 'გირჩევ', 'მართლა'],
  ar: ['في', 'من', 'على', 'عن', 'إلى', 'الى', 'أنا', 'انا', 'هل', 'ما', 'لا', 'نعم', 'هذا', 'هذه', 'كم', 'شقة',
    'شقه', 'أريد', 'اريد', 'أبحث', 'ابحث', 'اسمي', 'مرحبا', 'مع', 'أو', 'او', 'كيف', 'أين', 'اين',
    'شكرا', 'السلام', 'عليكم', 'السلامة', 'فضلك', 'أهلا', 'اهلا'],
  he: ['אני', 'את', 'של', 'זה', 'לא', 'כן', 'מה', 'איך', 'כמה', 'יש', 'עם', 'על', 'דירה', 'מחפש', 'מחפשת',
    'רוצה', 'שלום', 'קוראים', 'לי', 'בבקשה', 'תודה', 'או', 'אבל', 'גם', 'להתראות', 'בוקר', 'טוב'],
  hi: ['है', 'हैं', 'मैं', 'मुझे', 'मेरा', 'मेरी', 'और', 'का', 'की', 'के', 'में', 'को', 'से', 'यह', 'क्या', 'कैसे',
    'कितना', 'नहीं', 'हाँ', 'हां', 'चाहिए', 'नमस्ते', 'नाम', 'फ्लैट', 'घर', 'एक', 'दो', 'पर', 'या',
    'धन्यवाद', 'शुक्रिया', 'कृपया', 'नमस्कार', 'अलविदा'],
};

/** Which script a checkable language writes in. */
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
export const SCRIPT_PATTERN: Record<CheckableLanguage, RegExp> = {
  en: LATIN, tr: LATIN, es: LATIN, fr: LATIN, de: LATIN, it: LATIN, pt: LATIN, pl: LATIN, nl: LATIN,
  ru: CYRILLIC, uk: CYRILLIC,
  ka: /\p{Script=Georgian}/u, ar: /\p{Script=Arabic}/u, he: /\p{Script=Hebrew}/u, hi: /\p{Script=Devanagari}/u,
};

export function isCheckable(lang: string | null | undefined): lang is CheckableLanguage {
  return typeof lang === 'string' && Object.prototype.hasOwnProperty.call(FUNCTION_WORDS, lang);
}

/**
 * How much of the text is made of the language's own function words.
 *
 * 0 means none of the words are ones this language uses to hold a sentence
 * together -- what a transliteration of another language looks like.
 */
export function functionWordRatio(text: string, lang: CheckableLanguage): { ratio: number; words: number } {
  /*
   * COMBINING MARKS ARE PART OF THE WORD.
   *
   * A Devanagari virama and a matra are marks, not letters, so a class of
   * letters and digits alone SPLIT धन्यवाद into two pieces and no Hindi
   * word could ever match its own list. The same shreds Arabic and Hebrew
   * wherever diacritics are written.
   */
  const words = text.toLowerCase().split(/[^\p{L}\p{N}\p{M}']+/u).filter(Boolean);
  if (!words.length) return { ratio: 0, words: 0 };
  const set = new Set(FUNCTION_WORDS[lang]);
  const hits = words.filter((w) => set.has(w)).length;
  return { ratio: hits / words.length, words: words.length };
}


/** Whether a checkable language's function words appear at all; true when the language cannot be judged. */
export function hasAnyFunctionWord(text: string, lang: string | null | undefined): boolean {
  if (!isCheckable(lang)) return true;
  return functionWordRatio(text, lang).ratio > 0;
}

