import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { SupportedLanguage } from '@/types/types';
import { RTL_LANGUAGES } from '@/types/types';
import { translations } from '@/i18n/translations';
import type { ContentLocale, OverrideMap } from '@/i18n/appContent';
import { hasUnfilledHole, interpolate, resolveCopy } from '@/i18n/interpolate';
import { fetchOverrides } from '@/services/appContent';

const LANG_STORAGE_KEY = 'homatch_lang';
const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

// Dev-only, capped so a broken key can't spam the console. Never runs in
// production — this is a development-time missing-translation signal only,
// per the "detectable, not silently hidden" i18n requirement.
const isDev = typeof import.meta !== 'undefined' && Boolean((import.meta as any)?.env?.DEV);
const warnedKeys = new Set<string>();
function warnOnce(msg: string) {
  if (!isDev || warnedKeys.has(msg) || warnedKeys.size > 300) return;
  warnedKeys.add(msg);
  // eslint-disable-next-line no-console
  console.warn(`[i18n] ${msg}`);
}

/* Interpolation, and the guarantee that no `{{hole}}` ever reaches a
   customer, live in src/i18n/interpolate.ts — a module with no React in it,
   so the guarantee can be tested without a browser. The header there is the
   incident that produced it. */


interface LanguageContextValue {
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  /**
   * Applies a language coming from the user's saved account preference —
   * used once, on login/profile-load, and ONLY when the user has not
   * already made an explicit choice on this device (nothing in
   * localStorage yet). It never overrides a language the user just picked,
   * and never re-applies after the first attempt, so it can't fight with
   * setLang or loop.
   */
  applyProfileLanguage: (lang: string | null | undefined) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);
}

function detectBrowserLanguage(): SupportedLanguage {
  try {
    if (typeof navigator === 'undefined') return 'en';
    const nav = navigator.language?.toLowerCase() ?? 'en';
    for (const code of SUPPORTED_LANGUAGES) {
      if (nav.startsWith(code)) return code;
    }
  } catch {
    // Some privacy-focused/mobile browsers can restrict navigator access.
  }
  return 'en';
}

function getInitialLanguage(): SupportedLanguage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (isSupportedLanguage(stored)) return stored;
    }
  } catch {
    // Safari private mode / embedded browsers may throw on storage access.
  }
  return detectBrowserLanguage();
}

function hadExplicitStoredPreference(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage &&
      isSupportedLanguage(window.localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>(getInitialLanguage);

  /*
   * WHAT AN ADMIN WROTE INSTEAD.
   *
   * App Content lets an admin replace any bundled string, per locale, without
   * a deploy. The map starts EMPTY and stays empty on any failure, and empty
   * means "use what shipped" — so a slow query, an outage, a revoked grant
   * and a table that does not exist yet are all the same answer, and none of
   * them can change a word the customer reads.
   *
   * It is not awaited before the first paint. The application renders its own
   * copy immediately and swaps in an override when one arrives, because the
   * alternative is a blank screen while a CMS answers, and the copy that
   * shipped is correct copy.
   */
  const [overrides, setOverrides] = useState<OverrideMap>({});

  useEffect(() => {
    let live = true;
    void fetchOverrides().then((map) => { if (live) setOverrides(map); });
    return () => { live = false; };
  }, []);
  const isRTL = RTL_LANGUAGES.includes(lang);
  // Precedence guard: once true, a profile-stored preference must never
  // silently override what the user (or this device) already has set —
  // only a brand-new device/session with zero prior signal may adopt it.
  const hasExplicitPreferenceRef = useRef(hadExplicitStoredPreference());
  const profileAppliedRef = useRef(false);

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    } catch {
      // Rendering must never fail because document metadata could not update.
    }
  }, [lang, isRTL]);

  const setLang = useCallback((newLang: SupportedLanguage) => {
    if (!isSupportedLanguage(newLang)) return;
    hasExplicitPreferenceRef.current = true;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch {
      // Keep the in-memory language working even when persistence is blocked.
    }
    setLangState(newLang);
  }, []);

  const applyProfileLanguage = useCallback((profileLang: string | null | undefined) => {
    if (profileAppliedRef.current) return; // once per session — never re-fights a live choice
    profileAppliedRef.current = true;
    if (hasExplicitPreferenceRef.current) return; // device/user already has a preference
    if (!isSupportedLanguage(profileLang)) return;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, profileLang);
    } catch {
      // Non-fatal — the in-memory language still applies for this session.
    }
    setLangState(profileLang);
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const bundle = translations[lang] as Record<string, string> | undefined;
    const english = translations.en as Record<string, string>;
    /*
     * The override first, and only when it has words in it. A blank is not a
     * choice somebody made: the write path deletes a cleared row rather than
     * storing an empty one, so a blank here could only come from a direct
     * database write, and rendering it would be a heading with nothing in it.
     */
    const written = overrides[lang as ContentLocale]?.[key];
    const value = bundle?.[key];
    if (value === undefined) {
      if (english[key] === undefined) {
        warnOnce(`unknown key "${key}" — not present even in the English bundle`);
      } else if (lang !== 'en') {
        warnOnce(`"${key}" missing in "${lang}" — falling back to English`);
      }
    }
    /*
     * An override only wins if it comes out WHOLE. One that names a hole
     * this call site cannot fill is not a preference an admin expressed —
     * it is a typo that would print braces — so the shipped string, which
     * the placeholder gate guards, is used instead. See i18n/interpolate.ts.
     */
    if (typeof written === 'string' && written.trim() && hasUnfilledHole(interpolate(written, vars))) {
      warnOnce(`app_content override for "${key}" (${lang}) names a placeholder this call site cannot fill — using the shipped string`);
    }
    return resolveCopy([written?.trim() ? written : undefined, value, english[key]], vars) ?? key;
  }, [lang, overrides]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, applyProfileLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

/**
 * Render a subtree in a different language from the rest of the app.
 *
 * Exists for one caller: the Site Studio preview, which has to show the page
 * in the language being EDITED while the editor's own interface stays in the
 * admin's language. Someone checking the Arabic homepage should not have the
 * toolbar flip to Arabic under them, and should not have to change their own
 * account language to look at it.
 *
 * Deliberately narrower than the real provider. It does NOT write
 * localStorage, does NOT touch document.lang or document.dir, and its setLang
 * is a no-op: a preview is a view of content, not a change of preference.
 * Direction for the previewed page is applied by the preview's own wrapper,
 * scoped to that element, so RTL can be inspected inside an LTR editor.
 */
export function LanguageOverride({
  lang, children, overrides,
}: { lang: SupportedLanguage; children: React.ReactNode; overrides?: OverrideMap }) {
  const outer = useLanguage();

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const bundle = translations[lang] as Record<string, string> | undefined;
    const english = translations.en as Record<string, string>;
    /* The same order as the real provider. A preview that ignored overrides
       would show an admin the copy they have already replaced, which is the
       one thing a preview must not do. */
    const written = overrides?.[lang as ContentLocale]?.[key];
    /* Same contract as the real provider, including the part where an
       override that cannot be completed loses to the shipped string. A
       preview that rendered braces the live page will not would be lying
       about the change the admin is looking at. */
    return resolveCopy([written?.trim() ? written : undefined, bundle?.[key], english[key]], vars) ?? key;
  }, [lang, overrides]);

  const value: LanguageContextValue = {
    lang,
    setLang: () => { /* a preview does not change anyone's language */ },
    applyProfileLanguage: outer.applyProfileLanguage,
    t,
    isRTL: RTL_LANGUAGES.includes(lang),
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
