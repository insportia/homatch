/* A relative import, not the '@/' alias: this module is imported directly by
   a node test, which has no bundler to resolve the alias with. The rule that
   the domain modules stay importable without one is what lets 4,773 strings
   be reasoned about in a test at all. */
import { translations } from './translations.ts';

/**
 * APP CONTENT — the copy Site Studio cannot reach.
 *
 * Site Studio edits nine marketing pages and the shell. Everything else a
 * customer reads — the dashboard, Credits, the outreach screens, every empty
 * state, every confirmation, every error somebody is meant to act on — is a
 * key in translations.ts, and until now the only way to change one was a
 * deploy.
 *
 * This module is the part of the override layer that has no opinions about
 * React or the database: what the shipped copy is, how it is grouped so a
 * person can find one string among four and a half thousand, and what makes a
 * replacement safe to save. It is separated so all three can be tested
 * without a browser, because the third one is the dangerous one.
 *
 * WHY OVERRIDES APPLY EVERYWHERE AND NOT ONLY INSIDE THE APP
 *
 * `t()` is one function. A key used on the dashboard and again in the footer
 * is one key, and an admin who rewrites it means both. Pretending otherwise
 * would need a second key namespace, and a second namespace is where "why
 * did my change only work on one page" comes from.
 */

export const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;
export type ContentLocale = (typeof LOCALES)[number];

/** key -> locale -> the admin's replacement. */
export type OverrideMap = Partial<Record<ContentLocale, Record<string, string>>>;

/** The string the application ships for a key, or undefined. */
export function shipped(key: string, locale: ContentLocale): string | undefined {
  const bundle = translations[locale] as Record<string, string> | undefined;
  return bundle?.[key];
}

/** Every key the application ships, in the order the English bundle lists them. */
export function allKeys(): string[] {
  return Object.keys(translations.en as Record<string, string>);
}

/*
 * ── Finding one string among 4,773 ────────────────────────────────────────
 *
 * The keys already carry their area in the prefix before the first
 * underscore — `dash_`, `credits_`, `comm_`, `verify_`. That is a convention
 * rather than a rule, and it is enough: derived rather than listed, so a key
 * added next week appears in its group without anybody maintaining a map.
 *
 * The named groups below are only for the ones whose prefix is not a word an
 * admin would recognise. Everything else falls back to the prefix itself,
 * which is usually exactly right.
 */
const GROUP_NAMES: Readonly<Record<string, string>> = {
  mp: 'Marketing page',
  mjp: 'Mortgage journey',
  /* Not "Deal rooms". The database and the module tree still carry that
     name; no screen does, admin screens included — a term the product
     deliberately retired must not come back through a dropdown. These keys
     are the verification workspace a customer actually sees. */
  dr: 'Verifications',
  as: 'Active search',
  db: 'Database and imports',
  fin: 'Finance',
  comm: 'Communications',
  comms: 'Communications',
  dash: 'Dashboard',
  prop: 'Properties',
  notif: 'Notifications',
  doc: 'Documents',
  auth: 'Sign in and sign up',
  nav: 'Navigation',
  form: 'Forms',
  studio: 'Site Studio',
  admin: 'Admin',
  talk: 'AI Talk',
  live: 'Live chat',
  job: 'Background jobs',
  view: 'Viewings',
  bi: 'Building intelligence',
};

/** The group a key belongs to, derived from its prefix. */
export function groupOf(key: string): string {
  const prefix = key.split('_')[0] ?? key;
  return GROUP_NAMES[prefix] ?? prefix;
}

/** Every group present in the bundle, with how many keys each holds. */
export function groups(): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const key of allKeys()) {
    const name = groupOf(key);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Keys matching a search, optionally narrowed to one group.
 *
 * Searches the key AND the English text, because nobody remembers that the
 * sentence they want to change is called `empty_no_notifications_desc`. They
 * remember the sentence.
 */
export function search(query: string, group: string | null, locale: ContentLocale): string[] {
  const q = query.trim().toLowerCase();
  const english = translations.en as Record<string, string>;
  const bundle = translations[locale] as Record<string, string> | undefined;
  return allKeys().filter((key) => {
    if (group && groupOf(key) !== group) return false;
    if (!q) return true;
    if (key.toLowerCase().includes(q)) return true;
    if ((english[key] ?? '').toLowerCase().includes(q)) return true;
    return (bundle?.[key] ?? '').toLowerCase().includes(q);
  });
}

/*
 * ── What makes a replacement safe ─────────────────────────────────────────
 *
 * Two kinds of hole appear in these strings and they are filled by different
 * code, which is exactly why both have to be checked here.
 *
 *   {{name}}  filled by interpolate() in LanguageContext. A `t()` call passes
 *             vars; an override that drops the hole silently throws the value
 *             away, so "Welcome back, {{name}}" becomes "Welcome back" and
 *             nobody finds out.
 *
 *   {n}       replaced by hand at a few call sites — the notification group
 *             titles, the transcript chips. Same failure, different mechanism.
 *
 * An override may REORDER holes and may change everything around them. It may
 * not lose one or invent one: an invented hole renders as literal braces in
 * front of a customer.
 */
const HOLE = /\{\{\s*\w+\s*\}\}|\{n\}/g;

/** The holes a string contains, normalised and sorted so order does not matter. */
export function holesIn(text: string): string[] {
  return (text.match(HOLE) ?? [])
    .map(h => h.replace(/\s+/g, ''))
    .sort();
}

export type OverrideProblem =
  | { kind: 'EMPTY' }
  | { kind: 'MISSING_HOLES'; holes: string[] }
  | { kind: 'UNKNOWN_HOLES'; holes: string[] }
  | { kind: 'TOO_LONG'; limit: number };

/** A single override, held against the string it replaces. */
export function validateOverride(replacement: string, original: string): OverrideProblem | null {
  const value = replacement.trim();
  /*
   * Empty is not a problem; it is how somebody says "put it back". The editor
   * sends it, the function deletes the row, and the shipped string returns.
   * It is listed as a problem kind only because a caller that wants to gate a
   * SAVE button needs to be able to ask.
   */
  if (!value) return { kind: 'EMPTY' };

  /* The column is text, so this is a judgement rather than a limit: past a
     few hundred characters it is not interface copy any more, and the most
     likely explanation is a paste into the wrong field. */
  if (value.length > 2000) return { kind: 'TOO_LONG', limit: 2000 };

  const expected = holesIn(original);
  const actual = holesIn(value);

  const missing = expected.filter(h => !actual.includes(h));
  if (missing.length) return { kind: 'MISSING_HOLES', holes: [...new Set(missing)] };

  const unknown = actual.filter(h => !expected.includes(h));
  if (unknown.length) return { kind: 'UNKNOWN_HOLES', holes: [...new Set(unknown)] };

  return null;
}

/**
 * Resolve a key the way the running application will.
 *
 * The order is the whole safety argument, and it is the same one Site Studio
 * makes: an override for this locale, else the bundled string for this
 * locale, else English, else the key itself. An override can only ever be an
 * addition — there is no path through this that produces less than what the
 * application shipped.
 */
export function resolve(
  key: string, locale: ContentLocale, overrides: OverrideMap,
): string | undefined {
  const override = overrides[locale]?.[key];
  if (typeof override === 'string' && override.trim()) return override;
  return shipped(key, locale) ?? shipped(key, 'en');
}

/**
 * How much of a locale has been translated at all.
 *
 * Counted against the English bundle, because English is the only one that is
 * complete by construction: a key exists because an English string was
 * written for it. A locale missing a key renders English, which is legible
 * and wrong, and the number of times that happens is the one fact worth
 * putting on the screen.
 */
export function localeCoverage(locale: ContentLocale, overrides: OverrideMap): {
  total: number; translated: number; overridden: number; missing: string[];
} {
  const keys = allKeys();
  const bundle = translations[locale] as Record<string, string> | undefined;
  const written = overrides[locale] ?? {};
  const missing: string[] = [];
  let translated = 0;
  for (const key of keys) {
    if (typeof written[key] === 'string' && written[key].trim()) { translated += 1; continue; }
    if (typeof bundle?.[key] === 'string' && bundle[key].trim()) { translated += 1; continue; }
    missing.push(key);
  }
  return {
    total: keys.length,
    translated,
    overridden: Object.keys(written).length,
    missing,
  };
}
