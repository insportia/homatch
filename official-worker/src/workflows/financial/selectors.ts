// selectors.ts — RS Taxpayers Registry + MyGov Debtor Registry.
// Live-inspected 2026-09-06 via the user's own connected browser (this
// sandbox's own Playwright still cannot reach these hosts — see
// BrowserSession.ts's own header comment). Both are new sources added by
// the "FINAL PRE-PUSH CONSOLIDATION / ADAPTIVE RESEARCH ENGINE" mandate's
// "FINANCIAL/COMPANY SOURCE EXPANSION" section.

// RS Taxpayers Registry (rs.ge). The mandate's own recorded selector
// `#tin` was confirmed live: a real, stable, non-generated input id
// (`<input id="tin" type="text">`), plus a real `<button id="btnSearch1">
// ძებნა</button>` — submitNear()'s existing /ძებნა/i pattern already
// matches it, no new submit-button constant needed.
export const RSTAX_URL = 'https://www.rs.ge/TaxpayersRegistry';
export const RSTAX_ID_INPUT_SELECTORS = ['#tin', 'input[name="tin" i]', 'input[placeholder*="სნ" i]'];
// Confirmed live: submitting without first checking the reCAPTCHA
// checkbox (a normal-size, always-visible `div.g-recaptcha`, not
// invisible) blocks client-side with this exact banner text — a distinct
// signal from both "no result" and "result found", so it must be checked
// BEFORE evaluating result text, never lumped in with hasNoResultPhrase().
export const RSTAX_CAPTCHA_BLOCK_PHRASE = /უსაფრთხოების\s*ღილაკი/i;

// MyGov Debtor Registry (my.gov.ge service 38). Confirmed live: a real,
// stable field `input[name="debtorIdNumber"]` sits directly on the page
// (no iframe, unlike Service 176's registry), and a real
// `<button type="submit">ძიება</button>` — submitNear()'s existing
// /ძიება/i pattern already matches it. Its reCAPTCHA is `size=invisible`
// and, in the live test that produced this comment, passed silently with
// no visible challenge at all for a plain company-ID lookup (real search
// executed immediately, returning "მონაცემები ვერ მოიძებნა" for
// 404670272) — challenge() is still checked defensively for the rarer
// case where Google's own risk scoring decides to challenge this
// particular request.
export const DEBTOR_URL = 'https://my.gov.ge/ka-ge/services/38/searchdebtorinfo';
export const DEBTOR_ID_INPUT_SELECTORS = ['input[name="debtorIdNumber" i]'];

export const RSTAX_SOURCE_META = { name: 'RS Taxpayers Registry', class: 'OFFICIAL_REGISTRY', url: RSTAX_URL };
export const DEBTOR_SOURCE_META = { name: 'MyGov Debtor Registry', class: 'OFFICIAL_REGISTRY', url: DEBTOR_URL };
