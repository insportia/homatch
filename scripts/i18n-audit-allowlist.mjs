// Deliberate, reviewed exceptions for scripts/i18n-audit.mjs.
//
// Every entry here is a conscious decision that some text is allowed to
// stay hardcoded — never add one just to silence a real finding.

// Whole files/folders (relative to the repo root, glob with `**`/`*`) that
// are out of scope for the audit.
export const AUDIT_ALLOWED_FILE_GLOBS = [
  // Vendored shadcn/ui primitives — generated component library code, not
  // hand-authored app UI. Any genuinely user-facing string that flows
  // through these primitives (e.g. a dialog title) is supplied by the
  // *calling* app code, which the auditor does check.
  'src/components/ui/**',
  // Static translation data itself is expected to contain literal strings
  // in every language — that's its job, not a bug.
  'src/i18n/translations.ts',
  // TEMPORARY. The AI Talk live readout: an engineering diagnostic shown to
  // the product owner while Georgian speech-in is being confirmed on real
  // phones. Its labels are field names ("Input rate", "Bytes sent"), not
  // product copy, and translating them would make them harder to compare
  // against the code they name. It is meant to be DELETED rather than
  // translated — if it is still here after that confirmation, that is the
  // bug, not the missing translations.
  'src/components/home/AiTalkDiagnostics.tsx',
];

// Regexes for strings that are structurally never user-facing prose
// (formats, technical identifiers) but don't fit the generic case-based
// heuristics in i18n-audit.mjs.
export const AUDIT_ALLOWED_STRINGS = [
  /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg|webp|gif|ico|pdf)$/i, // filenames
  /^#[0-9a-fA-F]{3,8}$/, // hex colors
];

// Exact-string exceptions — reviewed case by case.
export const AUDIT_ALLOWED_EXACT = new Set([
  'Homatch',
  // An example hostname in the Studio's custom-domain field. A domain is a
  // technical token with no translation — showing "alan.gelistirici.com" in
  // Turkish would teach the wrong shape, not the right word.
  'twin.developer.com',
  'Homatch AI',
  // The voice provider's own name, on the admin Voice AI screen. A company
  // name, written the same way in every language — exactly like 'Homatch'.
  'ElevenLabs',
  // The calling vendor's own name. The Admin deliberately leads with
  // "Calling provider" and shows this beside it as the answer, so the
  // owner never has to know the word to find the page — but the word
  // itself is a brand and is the same in all six languages.
  'Vapi',
  // Placeholders in the pronunciation editor showing how to WRITE a rule for
  // the Homatch brand: an IPA transcription and a syllable hint. IPA is a
  // universal notation and both are examples of the brand name itself, so
  // translating them would make the field harder to fill in, not easier.
  'ˈhoʊmætʃ',
  'Ho-match',
  // Demo/sample data — a person's name in a static UI mockup, not real
  // content, and names are not translated across languages.
  'Giorgi M.',
  // An HTML numeric/named entity rendered as literal JSX text (the "©"
  // symbol) — a typographic symbol, not natural-language prose, so it is
  // never translated.
  '&copy;',
  // Legal-document literals (Terms/Privacy contact card): a bare domain and
  // bare email addresses, shown as their own anchor text. Never translated
  // in any language, mirroring privacy_domain_text/privacy_email_text in
  // scripts/i18n-allowlist.mjs.
  'homatch.live',
  'support@homatch.live',
  'legal@homatch.live',
]);
