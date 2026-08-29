import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { SupportedLanguage } from '@/types/types';
import { RTL_LANGUAGES } from '@/types/types';
import { translations } from '@/i18n/translations';

const LANG_STORAGE_KEY = 'homatch_lang';

interface LanguageContextValue {
  lang: SupportedLanguage;
  setLang: (lang: SupportedLanguage) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectBrowserLanguage(): SupportedLanguage {
  const supported: SupportedLanguage[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
  const nav = navigator.language?.toLowerCase() ?? 'en';
  for (const code of supported) {
    if (nav.startsWith(code)) return code;
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>(() => {
    const stored = localStorage.getItem(LANG_STORAGE_KEY) as SupportedLanguage | null;
    return stored ?? detectBrowserLanguage();
  });

  const isRTL = RTL_LANGUAGES.includes(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  }, [lang, isRTL]);

  const setLang = useCallback((newLang: SupportedLanguage) => {
    localStorage.setItem(LANG_STORAGE_KEY, newLang);
    setLangState(newLang);
  }, []);

  const t = useCallback((key: string): string => {
    const bundle = translations[lang] as Record<string, string>;
    return bundle[key] ?? (translations.en as Record<string, string>)[key] ?? key;
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
