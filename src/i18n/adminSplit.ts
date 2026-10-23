/*
 * WHICH STRINGS ONLY THE ADMIN CONSOLE READS.
 *
 * English ships whole in the entry chunk (src/i18n/bundles.ts), so every
 * visitor downloaded the admin console's ~89KB of English labels to read a
 * homepage. The build (vite.config.ts, i18nLanguageChunks) now cuts the keys
 * named here out of every language's bundle into virtual:homatch-i18n/admin-
 * <lang>, which loads with the admin layout (src/routes.tsx) and nowhere else.
 *
 * The rule is a prefix, `admin_`, with two families kept back because a
 * CUSTOMER screen renders them:
 *   admin_imp_      the impersonation banner (App root, on every page)
 *   admin_di_event_ Find Property's activity tabs (PersonalTabs)
 * tests/matrix/adminStringSplit.test.mjs holds that list honest: it fails if
 * any file outside the admin console names an admin-only key.
 *
 * Imported by the build and the tests only; the runtime never needs it.
 */
export const ADMIN_PREFIX = 'admin_';

/** `admin_` families a customer screen reads; they stay in the entry. */
export const CUSTOMER_ADMIN_PREFIXES: readonly string[] = ['admin_imp_', 'admin_di_event_'];

export function isAdminOnlyKey(key: string): boolean {
  return key.startsWith(ADMIN_PREFIX) && !CUSTOMER_ADMIN_PREFIXES.some((p) => key.startsWith(p));
}

/*
 * EMAIL STUDIO'S STRINGS, cut the same way into virtual:homatch-i18n/studio-<lang> and loaded with
 * the Email Studio screens (loadStudioStrings in routes.tsx). The rail labels (ems_nav_) stay in
 * the entry: every email screen, studio or not, shows the rail.
 * tests/matrix/studioStringSplit.test.mjs fails if a screen outside Email Studio names one.
 */
export const STUDIO_PREFIX = 'ems_';
export const STUDIO_ENTRY_PREFIXES: readonly string[] = ['ems_nav_'];

export function isStudioOnlyKey(key: string): boolean {
  return key.startsWith(STUDIO_PREFIX) && !STUDIO_ENTRY_PREFIXES.some((p) => key.startsWith(p));
}
