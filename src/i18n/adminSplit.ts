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

/*
 * ROUTE-ONLY FEATURE STRINGS: Home Financing (mortgage_), Investment Intelligence (inv_) and For
 * Expats (expat_). About 150KB of English that a visitor reading the homepage never needs, cut into
 * virtual:homatch-i18n/feature-<lang> and loaded with those routes (withFeatureStrings in
 * routes.tsx). The few keys shared screens read stay in the entry (FEATURE_ENTRY_KEYS).
 * src/i18n/__tests__/featureSplit.test.mjs fails if any other screen names a split key.
 */
export const FEATURE_PREFIXES: readonly string[] = ['mortgage_', 'inv_', 'expat_'];
/* Read by the shared workspace controls (src/components/workspace), which chat, CRM and Email Studio use too. */
export const FEATURE_ENTRY_KEYS: ReadonlySet<string> = new Set<string>([
  'inv_clear', 'inv_custom', 'inv_custom_value', 'inv_gap_missing_input', 'inv_gap_never_recovers', 'inv_gap_no_positive_income', 'inv_gap_not_financed', 'inv_gap_not_meaningful', 'inv_needs_input_prefix', 'inv_no', 'inv_src_calculated', 'inv_src_convention', 'inv_src_example', 'inv_src_market', 'inv_src_user', 'inv_unit_months', 'inv_unit_months_short', 'inv_unit_years', 'inv_yes', 'mortgage_effective_rate_unavailable_no_financing',
]);

export function isFeatureOnlyKey(key: string): boolean {
  return FEATURE_PREFIXES.some((p) => key.startsWith(p)) && !FEATURE_ENTRY_KEYS.has(key);
}
