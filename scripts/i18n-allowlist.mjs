// Shared allowlists for scripts/i18n-check.mjs and scripts/i18n-audit.mjs.
//
// Keeping this in one small, hand-reviewed file (instead of scattering
// `// i18n-ignore` comments or silently softening the checkers) means every
// exception is visible in one diff and has to be deliberately added — per
// the "no fake success" requirement, these checkers must fail loudly by
// default and only skip something a human explicitly decided is fine.

// Translation keys whose value is EXPECTED to be identical across every
// language (brand name, a code/format example, an abbreviation with no
// real translation). Add a key here only when that's a deliberate decision,
// never to silence a real missing translation.
export const ALLOW_DUPLICATE_KEYS = new Set([
  // Product/brand names — never translated in any language.
  'ai_title', // "Homatch AI"
  'profile_login_google', // "Google" — third-party trademark
  // Turkish legitimately borrows these exact Latin spellings; the other
  // languages already carry distinct real translations for the same keys,
  // so allowlisting here can't hide a missing translation elsewhere.
  'prop_area', // Turkish "m²" is the standard Turkish abbreviation too
  'prop_price_sqm', // Turkish "/m²"
  'matches_platform', // Turkish "Platform" is a standard loanword
  'profile_field_plan', // Turkish "Plan" is a standard loanword
  'comm_filter_platform',
  'admin_sources_platform',
  'admin_signals_platform',
  'as_type_villa', // Turkish "Villa" is the standard loanword too
  // WhatsApp/Telegram are kept in their Latin brand spelling in Georgian,
  // Russian and Turkish (as they commonly are in everyday use in those
  // languages); Arabic and Hebrew get their own transliterated forms and
  // are NOT in this list, so a missing translation there would still fail.
  'contact_whatsapp',
  'contact_telegram',
  // A phone-number format example ("+995 5XX XXX XXX") — not natural
  // language, deliberately identical in every locale.
  'chat_phone_ph',
  // An email-address format example ("you@example.com") — not natural
  // language, deliberately identical in every locale.
  'auth_email_ph',
  'ai_beta_badge', // Turkish "Beta" is the standard loanword too
]);

// Heuristic: values that don't need translating in the first place, so an
// identical value across languages is expected rather than a sign of a
// lazy/untranslated fill. Deliberately conservative — anything ambiguous
// falls through to the report instead of being silently waved through.
export function isAutoInvariantValue(value) {
  const v = value.trim();
  if (v === '') return false; // handled separately as "empty", not invariant
  // No letters at all (numbers, punctuation, symbols, emoji, dashes, "24/7", "$", "%", …).
  if (!/[A-Za-zÀ-ɏЀ-ӿႠ-ჿ֐-׿؀-ۿ]/.test(v)) return true;
  // A bare URL or email — never translated.
  if (/^(https?:\/\/|mailto:)/i.test(v)) return true;
  // Short, all-caps (optionally with digits/&/./-) acronyms: "AI", "PDF", "URL", "24/7", "Q&A".
  if (v.length <= 5 && /^[A-Z0-9&./-]+$/.test(v)) return true;
  return false;
}
