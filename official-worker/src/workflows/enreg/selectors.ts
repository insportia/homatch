// selectors.ts (ENREG) — input-field CSS hints. The mandate's own exact
// field LABEL strings (used for label-based lookups) live in EnregState.ts
// alongside the URL/button-label constants; these are the CSS-hint
// fallbacks EnregPage.ts tries when a label-based getByLabel/getByText
// lookup doesn't resolve to an <input> directly (a common mismatch when the
// visible label text is a separate DOM node from the actual field).
//
// Live-inspected 2026-09-06 directly against enreg.reestri.gov.ge's real
// entity search form (main.php?m=new_index, no iframe — 29 plain <input>
// elements on the page). The legal-entity ID-code field's real, confirmed
// attribute is `id="s_legal_person_idnumber" name="s_legal_person_idnumber"`
// — it contains neither "ident" nor "code" as a substring ("idnumber" is
// "id"+"number", not "ident"), so NONE of the old hints ever matched it.
// This is the confirmed, exact root cause of the production SUBMIT_FAILED
// result for ID-code 404670272: the field the old hints found (if any) was
// never the real one. The page also has s_people_idnumber (natural person)
// and s_participants_idnumber (participant of another entity) — both also
// contain "idnumber", so the EXACT selector is listed first to remove any
// DOM-order ambiguity between the three. A live search using
// #s_legal_person_idnumber with value 404670272, submitted via its own
// form's real <button type="submit"> (form#s_search_persons_form),
// returned exactly the expected single row: შპს მილენიო გრუპი, legal form
// შეზღუდული პასუხისმგებლობის საზოგადოება, status აქტიური. Opening that
// row's own detail (director/representative names, application history,
// registry extract) via its real `<a onclick="show_legal_person(id)">` link
// triggers a genuine image CAPTCHA dialog (#capture_gate, backed by
// simple-php-captcha-master/icaptcha.php) — a real human-verification gate
// requiring the distorted image to be read, never a page of plain digits to
// scan; this is exactly the existing WAITING_HUMAN/resume lifecycle's job,
// not something to read past or fake through.
export const ID_CODE_INPUT_HINTS = ['#s_legal_person_idnumber', 'input[name="s_legal_person_idnumber"]', 'input[placeholder*="საიდენტიფიკაციო" i]', 'input[name*="idnumber" i]', 'input[name*="ident" i]', 'input[name*="code" i]', 'input[id*="ident" i]', 'input[id*="code" i]'];
// Same live inspection: the legal-entity name field is
// `id="s_legal_person_name" name="s_legal_person_name"` — the old
// name*="name" hint already happened to match it (first in DOM order among
// several *_name/_orgname fields on the same page), so this only makes that
// match exact/unambiguous rather than order-dependent.
export const NAME_INPUT_HINTS = ['#s_legal_person_name', 'input[name="s_legal_person_name"]', 'input[placeholder*="დასახელება" i]', 'input[placeholder*="სახელ" i]', 'input[name*="name" i]', 'input[id*="name" i]'];
