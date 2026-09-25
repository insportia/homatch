/*
 * Copy for the source priority tier column in Admin → Sources.
 *
 * One word, and it has to be the BUSINESS one rather than the technical one.
 * The column does not say how well a source parses — quality_score already
 * does — it says how much the product depends on it, which is the judgement
 * the entitlement planner gates customer discovery on.
 *
 * Order is en, ka, ru, tr, ar, he — LANGS in lib/i18nSplice.mjs.
 */
export const SOURCE_TIER_STRINGS = {
  admin_sources_tier: [
    'Priority',
    'პრიორიტეტი',
    'Приоритет',
    'Öncelik',
    'الأولوية',
    'עדיפות',
  ],
};
