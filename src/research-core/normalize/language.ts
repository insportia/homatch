/**
 * Language detection, restricted to what is actually deterministic.
 *
 * Script detection IS deterministic: Georgian, Armenian, Hebrew and Greek each
 * own a Unicode block, so seeing those characters settles the language. Latin
 * and Cyrillic are shared across many languages, so we fall back to a small
 * stopword test and - crucially - report `reliable: false` when we are
 * guessing. The engine never scores or branches on an unreliable detection.
 */

export type Script =
  | 'LATIN'
  | 'CYRILLIC'
  | 'GEORGIAN'
  | 'ARMENIAN'
  | 'GREEK'
  | 'HEBREW'
  | 'ARABIC'
  | 'CJK'
  | 'UNKNOWN';

export interface LanguageDetection {
  script: Script;
  /** ISO 639-1 where we can be confident, otherwise null. */
  language: string | null;
  confidence: number;
  reliable: boolean;
}

const SCRIPT_RANGES: Array<[Script, RegExp]> = [
  ['GEORGIAN', /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/g],
  ['ARMENIAN', /[԰-֏]/g],
  ['HEBREW', /[֐-׿]/g],
  ['ARABIC', /[؀-ۿ]/g],
  ['GREEK', /[Ͱ-Ͽ]/g],
  ['CYRILLIC', /[Ѐ-ӿ]/g],
  ['CJK', /[一-鿿぀-ヿ가-힯]/g],
  ['LATIN', /[A-Za-zÀ-ɏ]/g],
];

/** Scripts owned by exactly one language we care about. */
const UNAMBIGUOUS_SCRIPTS: Partial<Record<Script, string>> = {
  GEORGIAN: 'ka',
  ARMENIAN: 'hy',
  GREEK: 'el',
  HEBREW: 'he',
};

const STOPWORDS: Array<[string, RegExp]> = [
  ['en', /\b(?:the|and|with|for|from|this|that|apartment|price|floor)\b/gi],
  ['ru', /\b(?:и|в|на|с|для|квартира|цена|этаж|продажа)\b/gi],
  ['de', /\b(?:und|der|die|das|mit|wohnung|preis)\b/gi],
  ['fr', /\b(?:le|la|les|des|avec|appartement|prix)\b/gi],
  ['es', /\b(?:el|la|los|con|para|apartamento|precio)\b/gi],
];

export function detectScript(text: string): { script: Script; ratio: number } {
  const sample = text.slice(0, 4000);
  const letters = sample.replace(/[^\p{L}]/gu, '').length;
  if (letters === 0) return { script: 'UNKNOWN', ratio: 0 };

  let best: Script = 'UNKNOWN';
  let bestCount = 0;
  for (const [script, pattern] of SCRIPT_RANGES) {
    pattern.lastIndex = 0;
    const count = (sample.match(pattern) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = script;
    }
  }
  return { script: best, ratio: bestCount / letters };
}

export function detectLanguage(text: string): LanguageDetection {
  const { script, ratio } = detectScript(text);

  if (script === 'UNKNOWN') {
    return { script, language: null, confidence: 0, reliable: false };
  }

  const owned = UNAMBIGUOUS_SCRIPTS[script];
  if (owned && ratio >= 0.2) {
    // A script with a single owner language is a determination, not a guess.
    return { script, language: owned, confidence: Math.min(1, 0.6 + ratio), reliable: true };
  }

  // Shared scripts: count stopwords and only claim a language on a clear win.
  const sample = text.slice(0, 4000);
  let bestLang: string | null = null;
  let bestHits = 0;
  let totalHits = 0;
  for (const [lang, pattern] of STOPWORDS) {
    pattern.lastIndex = 0;
    const hits = (sample.match(pattern) ?? []).length;
    totalHits += hits;
    if (hits > bestHits) {
      bestHits = hits;
      bestLang = lang;
    }
  }

  if (bestLang && bestHits >= 3 && bestHits / Math.max(totalHits, 1) >= 0.6) {
    return {
      script,
      language: bestLang,
      confidence: Math.min(0.85, 0.4 + bestHits / 20),
      // Stopword counting is a heuristic. Say so.
      reliable: false,
    };
  }

  return { script, language: null, confidence: 0.2, reliable: false };
}

/** True when the text contains any Georgian character at all. */
export function containsGeorgian(text: string): boolean {
  return /[Ⴀ-ჿᲐ-Ჿ]/.test(text);
}
