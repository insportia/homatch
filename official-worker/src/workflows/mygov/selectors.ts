// 2026-09-06 "final alignment pass" mandate: the live-recorded real
// production flow (napr-recording.spec.ts, repo root) starts at the SERVICE
// GROUP page itself — https://my.gov.ge/ka-ge/services/10 — not the deep
// link into service/176. From there a real, visible link
// ("უძრავი ქონების რეესტრში განაცხადების ძებნა...") is clicked, which loads
// the naprweb Angular app directly into `#main-routing-container iframe` ON
// THE SAME PAGE — the recording never opens a new tab/page for this step,
// it drives the whole flow via `.contentFrame()` locators chained off that
// one iframe. The previous implementation's `pollForIframe` + `ctx.newPage()`
// mechanism (opening the iframe's raw `src` in a brand-new page) does not
// match this — it is replaced below.
export const MYGOV_URL = 'https://my.gov.ge/ka-ge/services/10';
// The exact real link text (recording): a duplicated/wrapped accessible
// name is normal for this markup (the link's own title attribute repeats
// its visible text) — matched by substring, not the full duplicated string,
// so a whitespace/duplication difference between runs doesn't break it.
export const PROPERTY_SEARCH_LINK_TEXT = 'უძრავი ქონების რეესტრში განაცხადების ძებნა';
// The one iframe every step of the real flow operates inside, resolved via
// `.contentFrame()` on the SAME page/tab — never a separate page opened to
// its raw `src`.
export const MAIN_ROUTING_IFRAME_SELECTOR = '#main-routing-container iframe';
// Live-recorded (napr-recording.spec.ts): `#input_5` is the real cadastral
// field's id for this exact rendering. It is a sequentially-assigned
// Angular-Material id and can legitimately differ on another render pass —
// `ng-model="searchForm.cadcode"` (already live-confirmed 2026-09-06 against
// this same app) is kept as the primary, semantically-stable hint; #input_5
// is tried first here specifically because it is the literal selector the
// recording itself proves resolves the field, per the mandate's exact text.
export const CADASTRAL_INPUT_SELECTORS = ['#input_5', 'input[ng-model*="cadcode" i]', 'input[placeholder*="საკადასტრო" i]', 'input[name*="cad" i]', 'input[id*="cad" i]'];
// Live-recorded exact submit button.
export const APPLICATION_SEARCH_BUTTON_LABEL = 'განცხადების ძებნა';
// Every real search result is one of these dynamically-labeled buttons
// (recording: "განცხადება 892024345197") — enumerated by this TEXT PATTERN,
// never a fixed application-number list.
export const APPLICATION_ROW_BUTTON_PATTERN = /^განცხადება\s+\S/;
// After human verification clears, the application's detail view exposes
// its documents as dynamically-labeled buttons (recording: "მომზადებული
// დოკუმენტი: ამონაწერი საჯარო რეესტრიდან", "დოკუმენტი: სარეგისტრაციო
// წარმოება დასრულებულია 9 სექ 2024 15:...") — each click opens the document
// in a real new popup page.
export const PREPARED_DOCUMENT_BUTTON_PATTERN = /მომზადებული\s*დოკუმენტი\s*:|დოკუმენტი\s*:/;
export const MAX_APPLICATIONS = 15;
export const MAX_DOCUMENTS_PER_APPLICATION = 8;
