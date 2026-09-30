/*
 * THE LANGUAGE BUNDLES THE RUNTIME READS, ONE LANGUAGE AT A TIME.
 *
 * translations.ts stays the single source every tool and test reads. What a
 * visitor downloads is cut from it at build time (vite.config.ts,
 * i18nLanguageChunks): English ships in the entry — it is the fallback for
 * every key, so it has to be there before anything renders — and each other
 * language is its own chunk holding only that language's strings, fetched
 * when a visitor needs it. Before this, every visitor downloaded all six
 * languages to read one.
 *
 * A language that is not loaded yet reads as English (the same fallback a
 * missing key has always had). The provider avoids ever showing that: the
 * first render waits for the visitor's language (preloadLanguage in
 * main.tsx), and a language switch loads before it switches.
 */
import type { SupportedLanguage } from '@/types/types';
import en from 'virtual:homatch-i18n/en';

export type Bundle = Record<string, string>;

/** Canonical keys and the fallback for every one of them. */
export const english: Bundle = en;

const loaded: Partial<Record<SupportedLanguage, Bundle>> = { en };
const inFlight = new Map<SupportedLanguage, Promise<Bundle>>();

/* Literal specifiers, so the bundler can see each chunk. */
const loaders: Record<Exclude<SupportedLanguage, 'en'>, () => Promise<{ default: Bundle }>> = {
  ka: () => import('virtual:homatch-i18n/ka'),
  ru: () => import('virtual:homatch-i18n/ru'),
  tr: () => import('virtual:homatch-i18n/tr'),
  ar: () => import('virtual:homatch-i18n/ar'),
  he: () => import('virtual:homatch-i18n/he'),
};

/** The bundle for a language if it has arrived; undefined means "read English". */
export function bundleFor(lang: SupportedLanguage): Bundle | undefined {
  return loaded[lang];
}

/**
 * Fetch a language's bundle. Resolves at once when it is already here; one
 * request per language however many callers ask. A failure is not cached, so
 * the next call (the next switch, a remount) tries again — and until then the
 * page reads English, which is legible, rather than keys.
 */
export function loadLanguage(lang: SupportedLanguage): Promise<Bundle> {
  const have = loaded[lang];
  if (have) return Promise.resolve(have);
  const pending = inFlight.get(lang);
  if (pending) return pending;
  const load = loaders[lang as Exclude<SupportedLanguage, 'en'>];
  if (!load) return Promise.resolve(english);
  const p = load()
    .then((m) => { loaded[lang] = m.default; return m.default; })
    .finally(() => { inFlight.delete(lang); });
  inFlight.set(lang, p);
  return p;
}
