import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { SupportedLanguage } from '@/types/types';
import { RTL_LANGUAGES } from '@/types/types';
import { bundleFor, english as englishBundle, loadLanguage } from '@/i18n/bundles';
import type { ContentLocale, OverrideMap } from '@/i18n/appContent';
import { hasUnfilledHole, interpolate, resolveCopy } from '@/i18n/interpolate';
import { fetchOverrides } from '@/services/appContent';
import { tellServiceWorkerLanguage } from '@/lib/swLanguage';
import {
  LANG_SOURCE_KEY, LANG_STORAGE_KEY, isSupportedLanguage, profileMayApply, resolveInitialLanguage,
  type LanguageSource,
} from '@/i18n/languagePreference';

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
  /** Why this language is showing (languagePreference.ts); only 'default' may be offered another. */
  langSource: LanguageSource;
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
  } catch {
    // Safari private mode / embedded browsers may throw on storage access.
  }
  return null;
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory language working even when persistence is blocked.
  }
}

function browserLanguages(): readonly string[] {
  try {
    if (typeof navigator === 'undefined') return [];
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    // Some privacy-focused/mobile browsers can restrict navigator access.
    return [];
  }
}

/** Explicit pick > saved profile > browser > Georgian (languagePreference.ts). */
function getInitial(): { lang: SupportedLanguage; source: LanguageSource } {
  return resolveInitialLanguage({
    stored: readStorage(LANG_STORAGE_KEY),
    storedSource: readStorage(LANG_SOURCE_KEY),
    browser: browserLanguages(),
  });
}

/**
 * Fetch the language this visitor will see first, before the app renders.
 *
 * English and Georgian ship in the entry; every other language is its own
 * chunk (src/i18n/bundles.ts). main.tsx awaits this — bounded, so a failed or
 * slow chunk still lets the app render, in English — which is what keeps a
 * Russian, Turkish, Arabic or Hebrew visitor from seeing an English flash
 * before their own language arrives.
 */
export function preloadLanguage(timeoutMs = 4000): Promise<void> {
  const { lang } = getInitial();
  if (bundleFor(lang)) return Promise.resolve();
  return Promise.race([
    loadLanguage(lang).then(() => undefined, () => undefined),
    new Promise<void>((resolve) => { setTimeout(resolve, timeoutMs); }),
  ]);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(getInitial);
  const [lang, setLangStateNow] = useState<SupportedLanguage>(initial.lang);
  const [langSource, setLangSource] = useState<LanguageSource>(initial.source);
  /* Bumped when a language bundle arrives, so t() re-reads it. */
  const [bundleTick, setBundleTick] = useState(0);
  /* The last language asked for: a slower, earlier request never wins. */
  const wantedRef = useRef<SupportedLanguage>(lang);

  /*
   * A language switch loads first and switches second, so the page goes
   * straight from one whole language to the other. If the bundle cannot be
   * fetched the switch still happens (direction, lang attribute, the saved
   * choice) and the copy reads English until a later load succeeds.
   */
  const setLangState = useCallback((next: SupportedLanguage) => {
    wantedRef.current = next;
    if (bundleFor(next)) { setLangStateNow(next); return; }
    const apply = () => { if (wantedRef.current === next) setLangStateNow(next); };
    loadLanguage(next).then(apply, (err) => {
      warnOnce(`could not load the "${next}" bundle (${err instanceof Error ? err.message : String(err)}) — reading English`);
      apply();
    });
  }, []);

  /* The first language, when main.tsx's preload did not finish in time. */
  useEffect(() => {
    if (bundleFor(lang)) return;
    let live = true;
    loadLanguage(lang).then(() => { if (live) setBundleTick((n) => n + 1); }, () => { /* reads English */ });
    return () => { live = false; };
  }, [lang]);

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
  // Precedence guard: a saved profile language never overrides a language
  // the person picked on this device; it does outrank the browser's and the
  // Georgian default (languagePreference.ts).
  const sourceRef = useRef<LanguageSource>(initial.source);
  const profileAppliedRef = useRef(false);

  /* Pushes drawn later by the service worker read in this language (swLanguage.ts). */
  useEffect(() => { tellServiceWorkerLanguage(lang); }, [lang]);

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
    sourceRef.current = 'explicit';
    setLangSource('explicit');
    writeStorage(LANG_STORAGE_KEY, newLang);
    writeStorage(LANG_SOURCE_KEY, 'explicit');
    setLangState(newLang);
  }, [setLangState]);

  const applyProfileLanguage = useCallback((profileLang: string | null | undefined) => {
    if (profileAppliedRef.current) return; // once per session — never re-fights a live choice
    profileAppliedRef.current = true;
    if (!profileMayApply(sourceRef.current, profileLang)) return; // an explicit pick on this device wins
    sourceRef.current = 'profile';
    setLangSource('profile');
    writeStorage(LANG_STORAGE_KEY, profileLang);
    writeStorage(LANG_SOURCE_KEY, 'profile');
    setLangState(profileLang);
  }, [setLangState]);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const bundle = bundleFor(lang);
    const english = englishBundle;
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
    // bundleTick: a bundle that arrived after this language was chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, overrides, bundleTick]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, applyProfileLanguage, langSource, t, isRTL }}>
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
  /* The previewed language may not be the one this visitor has loaded. */
  const [bundleTick, setBundleTick] = useState(0);
  useEffect(() => {
    if (bundleFor(lang)) return;
    let live = true;
    loadLanguage(lang).then(() => { if (live) setBundleTick((n) => n + 1); }, () => { /* reads English */ });
    return () => { live = false; };
  }, [lang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const bundle = bundleFor(lang);
    const english = englishBundle;
    /* The same order as the real provider. A preview that ignored overrides
       would show an admin the copy they have already replaced, which is the
       one thing a preview must not do. */
    const written = overrides?.[lang as ContentLocale]?.[key];
    /* Same contract as the real provider, including the part where an
       override that cannot be completed loses to the shipped string. A
       preview that rendered braces the live page will not would be lying
       about the change the admin is looking at. */
    return resolveCopy([written?.trim() ? written : undefined, bundle?.[key], english[key]], vars) ?? key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, overrides, bundleTick]);

  const value: LanguageContextValue = {
    lang,
    setLang: () => { /* a preview does not change anyone's language */ },
    applyProfileLanguage: outer.applyProfileLanguage,
    langSource: outer.langSource,
    t,
    isRTL: RTL_LANGUAGES.includes(lang),
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
