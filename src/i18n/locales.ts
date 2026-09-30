/*
 * The locale list and the override map's shape, with no strings attached.
 *
 * Its own module so the runtime can name the six locales without importing
 * translations.ts: services/appContent loads overrides on every page, and an
 * import of appContent.ts from there put all six languages back into the
 * entry chunk. appContent.ts re-exports these for the editor and its tests.
 */
export const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;
export type ContentLocale = (typeof LOCALES)[number];

/** key -> locale -> the admin's replacement. */
export type OverrideMap = Partial<Record<ContentLocale, Record<string, string>>>;
