// Exact mandated entry point — service 176 under service GROUP 10, never the
// homepage, a generic /search?keyword= query, or a different service id/group.
export const MYGOV_URL = 'https://www.my.gov.ge/ka-ge/services/10/service/176';
// Live-inspected 2026-09-06 directly against the real naprweb registry app
// (https://naprweb.reestri.gov.ge/_dea/#/search, reached via MYGOV_URL —
// confirmed this deep-links correctly, service GROUP 10/176 is right). This
// is a legacy AngularJS 1.x + Angular Material app: the real cadastral-code
// <input> has NO matching placeholder/name/id at all — its id is a
// meaningless sequential `input_5`-style value assigned at render time, and
// its <label> ("საკადასტრო კოდი") is a separate sibling DOM node, not a
// wrapping <label for>. The one stable, semantic, live-confirmed attribute
// on the real element is its AngularJS binding: `ng-model="searchForm.cadcode"`
// (verified alongside its siblings on the same form: regno/person/address —
// cadcode is the only one containing "cad"). This hint is listed FIRST so
// interact() resolves it via the confident HINT_MATCH path and never falls
// through to candidateRankedRetry()'s low-confidence generic scan — that
// fallback landing on the wrong field (GENERIC_FIELD_MATCH /
// contextConfidence-rejected) was the exact, confirmed root cause of the
// production WRONG_SEARCH_CONTEXT result for 01.18.06.019.055.03.01.603: the
// real registry app was reached correctly, but none of the old
// placeholder/name/id hints matched anything on it, so the code never even
// tried this field. A real live search against this exact fixture using
// this selector returned exactly 1 real application (892024345197,
// registration procedure completed 2024-09-09, ⁠interested party შპს
// მილენიო გრუპი, address ...N6 'ც' ბლოკი, სართული 6, ბინა 603) — proving the
// field, the submit flow, and result rendering are all now correctly
// reachable. Opening that application's own detail view (owner/rights/
// mortgage/restrictions) triggers a real Google reCAPTCHA ("დაადასტურეთ
// მონიშვნით 'მე არ ვარ რობოტი'") — a genuine human-verification gate, not a
// selector problem; this is exactly what the existing WAITING_HUMAN/resume
// lifecycle is for, and must never be papered over.
// submitNear() (browser/BrowserSession.ts) already matches this button via
// its existing generic /ძებნა/i role-name pattern — "განცხადების ძებნა"
// contains "ძებნა" as a substring, so no new constant/selector is needed
// for the submit click itself; confirmed live, no separate fix required.
export const CADASTRAL_INPUT_SELECTORS = ['input[ng-model*="cadcode" i]', 'input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]'];
// naprweb's Angular app doesn't always show up as a Playwright frame — but
// its iframe src IS present in the raw DOM. Its invisible reCAPTCHA anchor
// can take up to 20-30s to finish executing before the real app iframe
// appears at all (Google's own declared readiness window), hence the long
// poll in MyGovPage.pollForRegistryIframe.
export const REGISTRY_IFRAME_PATTERN = /reestri\.gov\.ge|naprweb/i;
