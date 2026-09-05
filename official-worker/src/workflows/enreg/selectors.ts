// selectors.ts (ENREG) — input-field CSS hints. The mandate's own exact
// field LABEL strings (used for label-based lookups) live in EnregState.ts
// alongside the URL/button-label constants; these are the CSS-hint
// fallbacks EnregPage.ts tries when a label-based getByLabel/getByText
// lookup doesn't resolve to an <input> directly (a common mismatch when the
// visible label text is a separate DOM node from the actual field).
export const ID_CODE_INPUT_HINTS = ['input[placeholder*="საიდენტიფიკაციო" i]', 'input[name*="ident" i]', 'input[name*="code" i]', 'input[id*="ident" i]', 'input[id*="code" i]'];
export const NAME_INPUT_HINTS = ['input[placeholder*="დასახელება" i]', 'input[placeholder*="სახელ" i]', 'input[name*="name" i]', 'input[id*="name" i]'];
