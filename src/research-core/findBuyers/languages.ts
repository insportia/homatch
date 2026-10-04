// The six search languages of FIND BUYERS / FIND TENANTS, and a cheap,
// deterministic script-level language guess for public text.
//
// Every campaign searches all six, whatever the UI language: a Russian-
// speaking buyer of a Tbilisi flat does not write in Georgian because the
// owner reads Georgian.

export const SEARCH_LANGUAGES = ['ka', 'ru', 'en', 'ar', 'he', 'tr'] as const;
export type SearchLanguage = typeof SEARCH_LANGUAGES[number];

export const LANGUAGE_NAMES: Readonly<Record<SearchLanguage, string>> = {
  ka: 'Georgian', ru: 'Russian', en: 'English', ar: 'Arabic', he: 'Hebrew', tr: 'Turkish',
};

export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'he']);

export function isSearchLanguage(value: unknown): value is SearchLanguage {
  return SEARCH_LANGUAGES.includes(String(value ?? '').toLowerCase() as SearchLanguage);
}

const TURKISH_MARKERS = /[ğışçöüĞİŞÇÖÜ]|\b(daire|kiralık|satılık|arıyorum|ev|oda|metrekare|fiyat|merhaba|lütfen)\b/i;

/**
 * Script-first guess. Georgian, Arabic, Hebrew and Cyrillic are unambiguous by
 * script; Latin text is Turkish when it carries Turkish letters or words,
 * otherwise English. Returns null for text with no letters (emoji, numbers).
 */
export function detectLanguage(text: string | null | undefined): SearchLanguage | null {
  const s = String(text ?? '');
  const counts = {
    ka: (s.match(/[Ⴀ-ჿ]/g) ?? []).length,
    ar: (s.match(/[؀-ۿ]/g) ?? []).length,
    he: (s.match(/[֐-׿]/g) ?? []).length,
    ru: (s.match(/[Ѐ-ӿ]/g) ?? []).length,
    latin: (s.match(/[A-Za-zğışçöüĞİŞÇÖÜ]/g) ?? []).length,
  };
  const best = (Object.entries(counts) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return null;
  if (best[0] !== 'latin') return best[0] as SearchLanguage;
  return TURKISH_MARKERS.test(s) ? 'tr' : 'en';
}
