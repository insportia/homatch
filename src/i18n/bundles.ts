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
  /* In the admin console a language is only "here" with its admin half, so a
     switch waits for both (LanguageContext loads before it applies). */
  if (adminWanted && lang !== 'en' && !adminLoaded[lang]) return undefined;
  /* Likewise in Email Studio: a language is here with its studio half. */
  if (studioWanted && lang !== 'en' && !studioLoaded[lang]) return undefined;
  /* And on the Mortgage, Investment and For Expats routes, with its feature half. */
  if (featureWanted && lang !== 'en' && !featureLoaded[lang]) return undefined;
  return loaded[lang];
}

/*
 * THE ADMIN CONSOLE'S OWN STRINGS (src/i18n/adminSplit.ts).
 *
 * Cut out of every language at build time so a visitor never downloads them.
 * The admin layout asks for them (loadAdminStrings, in routes.tsx) and does
 * not render until they are here; from then on every language this tab loads
 * brings its admin half with it, so a language switch inside the console
 * waits for both halves rather than flashing English or raw keys.
 */
const adminLoaders: Record<SupportedLanguage, () => Promise<{ default: Bundle }>> = {
  en: () => import('virtual:homatch-i18n/admin-en'),
  ka: () => import('virtual:homatch-i18n/admin-ka'),
  ru: () => import('virtual:homatch-i18n/admin-ru'),
  tr: () => import('virtual:homatch-i18n/admin-tr'),
  ar: () => import('virtual:homatch-i18n/admin-ar'),
  he: () => import('virtual:homatch-i18n/admin-he'),
};
const adminLoaded: Partial<Record<SupportedLanguage, Bundle>> = {};
const adminInFlight = new Map<SupportedLanguage, Promise<void>>();
let adminWanted = false;

/** Put a language's admin and studio halves into its bundle once the base is here. */
function mergeAdmin(lang: SupportedLanguage): void {
  const base = loaded[lang];
  const admin = adminLoaded[lang];
  if (base && admin) Object.assign(base, admin);
  const studio = studioLoaded[lang];
  if (base && studio) Object.assign(base, studio);
  const feature = featureLoaded[lang];
  if (base && feature) Object.assign(base, feature);
}

function loadAdminHalf(lang: SupportedLanguage): Promise<void> {
  if (adminLoaded[lang]) { mergeAdmin(lang); return Promise.resolve(); }
  const pending = adminInFlight.get(lang);
  if (pending) return pending;
  const p = adminLoaders[lang]()
    .then((m) => { adminLoaded[lang] = m.default; mergeAdmin(lang); })
    .finally(() => { adminInFlight.delete(lang); });
  adminInFlight.set(lang, p);
  return p;
}

/**
 * The admin console's strings for every language this tab has (English, the
 * fallback, and whatever the visitor reads in, which is always loaded or
 * loading before it is shown). Resolves when they are merged; a failure
 * rejects, so the layout's chunk recovery (lazyRoute) treats it like any
 * other missing chunk.
 */
export function loadAdminStrings(): Promise<void> {
  adminWanted = true;
  const langs = new Set<SupportedLanguage>(['en', ...(Object.keys(loaded) as SupportedLanguage[]), ...inFlight.keys()]);
  return Promise.all([...langs].map(loadAdminHalf)).then(() => undefined);
}

/**
 * Fetch a language's bundle. Resolves at once when it is already here; one
 * request per language however many callers ask. A failure is not cached, so
 * the next call (the next switch, a remount) tries again — and until then the
 * page reads English, which is legible, rather than keys. Once the admin
 * console has asked for its strings, a language arrives with its admin half.
 */
export function loadLanguage(lang: SupportedLanguage): Promise<Bundle> {
  const base = loadBase(lang);
  if (!adminWanted && !studioWanted && !featureWanted) return base;
  return Promise.all([base, adminWanted ? loadAdminHalf(lang) : null, studioWanted ? loadStudioHalf(lang) : null, featureWanted ? loadFeatureHalf(lang) : null]).then(([bundle]) => bundle);
}

/*
 * EMAIL STUDIO'S OWN STRINGS (src/i18n/adminSplit.ts, isStudioOnlyKey).
 *
 * The same cut as the admin console's, for the Email Studio screens (dashboard, campaigns,
 * workspace, designer, HOMI, templates, analytics, deliverability) and the admin email review
 * page: ~55KB of English a visitor who never opens Email Studio no longer downloads. The rail
 * labels (ems_nav_*) stay in the entry because every email screen shows them.
 */
const studioLoaders: Record<SupportedLanguage, () => Promise<{ default: Bundle }>> = {
  en: () => import('virtual:homatch-i18n/studio-en'),
  ka: () => import('virtual:homatch-i18n/studio-ka'),
  ru: () => import('virtual:homatch-i18n/studio-ru'),
  tr: () => import('virtual:homatch-i18n/studio-tr'),
  ar: () => import('virtual:homatch-i18n/studio-ar'),
  he: () => import('virtual:homatch-i18n/studio-he'),
};
const studioLoaded: Partial<Record<SupportedLanguage, Bundle>> = {};
const studioInFlight = new Map<SupportedLanguage, Promise<void>>();
let studioWanted = false;

function loadStudioHalf(lang: SupportedLanguage): Promise<void> {
  if (studioLoaded[lang]) { mergeAdmin(lang); return Promise.resolve(); }
  const pending = studioInFlight.get(lang);
  if (pending) return pending;
  const p = studioLoaders[lang]()
    .then((m) => { studioLoaded[lang] = m.default; mergeAdmin(lang); })
    .finally(() => { studioInFlight.delete(lang); });
  studioInFlight.set(lang, p);
  return p;
}

/** Email Studio's strings for every language this tab has; resolves when merged. */
export function loadStudioStrings(): Promise<void> {
  studioWanted = true;
  const langs = new Set<SupportedLanguage>(['en', ...(Object.keys(loaded) as SupportedLanguage[]), ...inFlight.keys()]);
  return Promise.all([...langs].map(loadStudioHalf)).then(() => undefined);
}

function loadBase(lang: SupportedLanguage): Promise<Bundle> {
  const have = loaded[lang];
  if (have) return Promise.resolve(have);
  const pending = inFlight.get(lang);
  if (pending) return pending;
  const load = loaders[lang as Exclude<SupportedLanguage, 'en'>];
  if (!load) return Promise.resolve(english);
  const p = load()
    .then((m) => { loaded[lang] = m.default; mergeAdmin(lang); return m.default; })
    .finally(() => { inFlight.delete(lang); });
  inFlight.set(lang, p);
  return p;
}

/*
 * THE ROUTE-ONLY STRINGS OF HOME FINANCING, INVESTMENT AND FOR EXPATS (adminSplit.ts,
 * isFeatureOnlyKey). Cut from every language like the admin and studio halves, so the entry and
 * every language a visitor waits for carry none of them; the routes that show them wait for them
 * (withFeatureStrings in routes.tsx), and from then on each language this tab loads brings them.
 */
const featureLoaders: Record<SupportedLanguage, () => Promise<{ default: Bundle }>> = {
  en: () => import('virtual:homatch-i18n/feature-en'),
  ka: () => import('virtual:homatch-i18n/feature-ka'),
  ru: () => import('virtual:homatch-i18n/feature-ru'),
  tr: () => import('virtual:homatch-i18n/feature-tr'),
  ar: () => import('virtual:homatch-i18n/feature-ar'),
  he: () => import('virtual:homatch-i18n/feature-he'),
};
const featureLoaded: Partial<Record<SupportedLanguage, Bundle>> = {};
const featureInFlight = new Map<SupportedLanguage, Promise<void>>();
let featureWanted = false;

function loadFeatureHalf(lang: SupportedLanguage): Promise<void> {
  if (featureLoaded[lang]) { mergeAdmin(lang); return Promise.resolve(); }
  const pending = featureInFlight.get(lang);
  if (pending) return pending;
  const p = featureLoaders[lang]()
    .then((m) => { featureLoaded[lang] = m.default; mergeAdmin(lang); })
    .finally(() => { featureInFlight.delete(lang); });
  featureInFlight.set(lang, p);
  return p;
}

/** The feature strings for every language this tab has; resolves when merged. */
export function loadFeatureStrings(): Promise<void> {
  featureWanted = true;
  const langs = new Set<SupportedLanguage>(['en', ...(Object.keys(loaded) as SupportedLanguage[]), ...inFlight.keys()]);
  return Promise.all([...langs].map(loadFeatureHalf)).then(() => undefined);
}
