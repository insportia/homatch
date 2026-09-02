// Shared server-side locale contract for every Edge Function that returns
// user-visible or AI-generated content.
//
// The frontend's LanguageContext is the single source of truth for the
// user's selected UI language, and it is sent on every language-sensitive
// request as `locale` (the canonical field — see normalizeLocale below).
// `language` is accepted as a backward-compatible alias since some
// functions (e.g. homatch-research) shipped with that field name first.
//
// Nothing here ever trusts the raw client-supplied value: normalizeLocale
// maps ANY input to one of the six fixed, known-safe values below (falling
// back to English), so a locale string is never interpolated into a prompt
// unvalidated and can never be used to inject instructions.
export type Locale = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  ka: 'Georgian (ქართული)',
  ru: 'Russian (Русский)',
  tr: 'Turkish (Türkçe)',
  ar: 'Arabic (العربية)',
  he: 'Hebrew (עברית)',
};

export const RTL_LOCALES: Locale[] = ['ar', 'he'];

/**
 * Normalizes ANY user-controlled input to one of the six known-safe locale
 * codes, defaulting to 'en'. Never returns anything else — safe to
 * interpolate the resulting LANGUAGE_NAMES[...] value into a prompt.
 */
export function normalizeLocale(input: unknown): Locale {
  return typeof input === 'string' && (SUPPORTED_LOCALES as string[]).includes(input)
    ? (input as Locale)
    : 'en';
}

/**
 * Reads the caller's locale from a parsed request body, preferring the
 * canonical `locale` field and falling back to the legacy `language` field
 * for functions that have not been migrated to the new field name yet.
 * Always returns a normalized, safe Locale.
 */
export function resolveLocaleFromBody(body: Record<string, unknown> | null | undefined): Locale {
  if (!body) return 'en';
  return normalizeLocale(body.locale ?? body.language);
}

/**
 * Standard instruction fragment to append to any system/user prompt that
 * must return its ENTIRE answer in the caller's UI language, independent of
 * the language the input query or source data happen to be in. Source
 * titles/quotes may be cited in their original language — only the model's
 * own explanatory text must follow the target language.
 */
export function languageDirective(locale: Locale): string {
  const langName = LANGUAGE_NAMES[locale];
  return `LANGUAGE (mandatory): write your entire answer — every sentence and label — strictly in ${langName}. Do this regardless of what language the query, the internal data, or any source you find is written in. Do not mix languages and do not answer in English unless ${langName} is English. Source titles/quotes you cite may stay in their original language, but all of your own explanatory text must be in ${langName}.`;
}
