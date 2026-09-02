import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { SupportedLanguage } from '@/types/types';
import { RTL_LANGUAGES } from '@/types/types';
import { translations } from '@/i18n/translations';

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

// Simple, safe {{placeholder}} interpolation — plain string substitution
// only (no HTML parsing/eval), so it carries no injection risk whether the
// result lands in JSX text or an attribute.
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

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
    const value = bundle?.[key];
    if (value === undefined) {
      if (english[key] === undefined) {
        warnOnce(`unknown key "${key}" — not present even in the English bundle`);
      } else if (lang !== 'en') {
        warnOnce(`"${key}" missing in "${lang}" — falling back to English`);
      }
    }
    const resolved = value ?? english[key] ?? key;
    return interpolate(resolved, vars);
  }, [lang]);

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
