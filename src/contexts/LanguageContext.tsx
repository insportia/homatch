import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SupportedLanguage } from '@/types/types';
import { RTL_LANGUAGES } from '@/types/types';
import { translations } from '@/i18n/translations';

const LANG_STORAGE_KEY = 'homatch_lang';
const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

interface LanguageContextValue {
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  t: (key: string) => string;
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

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>(getInitialLanguage);
  const isRTL = RTL_LANGUAGES.includes(lang);

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
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch {
      // Keep the in-memory language working even when persistence is blocked.
    }
    setLangState(newLang);
  }, []);

  const t = useCallback((key: string): string => {
    const bundle = translations[lang] as Record<string, string> | undefined;
    const english = translations.en as Record<string, string>;
    return bundle?.[key] ?? english[key] ?? key;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
