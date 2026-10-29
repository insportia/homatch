/*
 * WHICH LANGUAGE A VISITOR SEES FIRST, AND WHAT WE MAY SUGGEST.
 *
 * HOMATCH is Georgian first (owner, 2026-10-29). The order of authority:
 *
 *   1. a language the person picked themselves  (homatch_lang_source = 'explicit')
 *   2. the language saved on their account       (homatch_lang_source = 'profile')
 *   3. a language their browser asks for that we support
 *   4. Georgian
 *
 * A coarse IP country (api/geo.ts) sits between 3 and 4, but it never
 * switches anything: when the visitor is reading Georgian only because
 * nothing better was known, it may OFFER a language (a dismissible toast,
 * LanguageSuggestion.tsx). A VPN, a roaming phone or a wrong guess costs one
 * dismissible line, and a dismissal is remembered.
 *
 * Pure: no React, no window. LanguageContext reads storage and navigator and
 * hands the values in, so every rule here is testable in node.
 */
import type { SupportedLanguage } from '@/types/types';

/** Selector and fallback order. Georgian first; then English and Russian. */
export const LANGUAGE_ORDER: readonly SupportedLanguage[] = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ka';

export const LANG_STORAGE_KEY = 'homatch_lang';
export const LANG_SOURCE_KEY = 'homatch_lang_source';
export const LANG_SUGGESTION_KEY = 'homatch_lang_suggestion';

export type LanguageSource = 'explicit' | 'profile' | 'browser' | 'default';

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (LANGUAGE_ORDER as readonly string[]).includes(value);
}

/** 'he-IL' -> he, 'iw' (the pre-1989 Hebrew code some Android builds still send) -> he. */
function primaryOf(tag: string): string {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return primary === 'iw' ? 'he' : primary;
}

/** The first browser language we support, in the browser's own order; null when none fits. */
export function browserLanguageFrom(tags: readonly (string | null | undefined)[]): SupportedLanguage | null {
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag) continue;
    const primary = primaryOf(tag);
    if (isSupportedLanguage(primary)) return primary;
  }
  return null;
}

/**
 * The language to render first, and why.
 *
 * A stored language with no recorded source predates the source flag: it was
 * written either by the person's own pick or by their saved profile, and both
 * outrank anything we could infer, so it is honoured as explicit.
 */
export function resolveInitialLanguage(input: {
  stored: string | null | undefined;
  storedSource: string | null | undefined;
  browser: readonly (string | null | undefined)[];
}): { lang: SupportedLanguage; source: LanguageSource } {
  if (isSupportedLanguage(input.stored)) {
    return { lang: input.stored, source: input.storedSource === 'profile' ? 'profile' : 'explicit' };
  }
  const fromBrowser = browserLanguageFrom(input.browser);
  if (fromBrowser) return { lang: fromBrowser, source: 'browser' };
  return { lang: DEFAULT_LANGUAGE, source: 'default' };
}

/** A saved account language may apply unless the person picked one on this device. */
export function profileMayApply(source: LanguageSource, profileLang: unknown): profileLang is SupportedLanguage {
  return source !== 'explicit' && isSupportedLanguage(profileLang);
}

/*
 * Country -> the language to OFFER. Deliberately narrow: Russian only where it
 * is the common language of the country's own residents (not "everywhere east
 * of Georgia"), Turkish for Turkey and Azerbaijan (closely related languages),
 * Hebrew for Israel, Arabic for Arab League states, English for everyone else.
 * Georgia offers nothing: Georgian is already the default.
 */
const RUSSIAN = new Set(['RU', 'BY', 'KZ', 'KG', 'AM', 'TJ', 'UZ', 'TM']);
const TURKISH = new Set(['TR', 'AZ']);
const ARABIC = new Set(['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'JO', 'LB', 'SY', 'PS', 'EG', 'LY', 'TN', 'DZ', 'MA', 'SD', 'MR']);

/** Accepts only a two-letter ISO country; 'XX', 'T1' (Tor) and anything else unknown give null. */
export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'ZZ') return null;
  return code;
}

export function suggestedLanguageForCountry(value: unknown): SupportedLanguage | null {
  const country = normalizeCountry(value);
  if (!country || country === 'GE') return null;
  if (RUSSIAN.has(country)) return 'ru';
  if (TURKISH.has(country)) return 'tr';
  if (country === 'IL') return 'he';
  if (ARABIC.has(country)) return 'ar';
  return 'en';
}

/**
 * Whether to look up the country at all: only for a visitor who reads the
 * Georgian default because nothing better was known, and who has not already
 * dismissed a suggestion.
 */
export function mayLookUpCountry(source: LanguageSource, dismissed: boolean): boolean {
  return source === 'default' && !dismissed;
}

/** Whether to offer `suggested` to someone currently reading `current`. */
export function shouldSuggest(input: {
  source: LanguageSource;
  current: SupportedLanguage;
  suggested: SupportedLanguage | null;
  dismissed: boolean;
}): input is { source: LanguageSource; current: SupportedLanguage; suggested: SupportedLanguage; dismissed: boolean } {
  return mayLookUpCountry(input.source, input.dismissed) && input.suggested !== null && input.suggested !== input.current;
}
