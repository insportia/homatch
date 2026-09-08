import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Verify UI layout regressions — the NOTE's document flow, the mobile-safe
 * CAPTCHA modal, and the guarantee that neither change broke the live-browser
 * contract the worker depends on.
 *
 * The repository has no React/DOM test runner (no vitest/jest/testing-library
 * in package.json — its frontend suites are all plain `node --test` .mjs
 * files), so these are structural source assertions, in the same style as the
 * worker's own endpoint-contract suite.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const NOTICE = `${here}../ResearchDepthNotice.tsx`;
const MODAL = `${here}../ResearchCaptchaModal.tsx`;
const VERIFY_PAGE = `${here}../../../pages/VerifyPage.tsx`;
const APP = `${here}../../../App.tsx`;

const read = (p) => readFileSync(p, 'utf8');
/** Source with comments removed — a comment explaining the OLD fixed
 * positioning must not be mistaken for the positioning itself. */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const noticeSource = read(NOTICE);
const noticeCode = code(NOTICE);
const modalSource = read(MODAL);
const verifySource = read(VERIFY_PAGE);
const appSource = read(APP);

/* ------------------------------------------------------------------ *
 * The NOTE participates in normal document flow.                      *
 * ------------------------------------------------------------------ */

test('the deep-research NOTE uses NORMAL DOCUMENT FLOW — no fixed/absolute/sticky, no z-index, no transform, no negative margin', () => {
  // Everything inside className="..." in the rendered markup.
  const classNames = [...noticeCode.matchAll(/className="([^"]*)"/g)].map(([, v]) => v);
  assert.equal(classNames.length > 0, true, 'the notice must render classes');

  const forbidden = [
    /\bfixed\b/,
    /\babsolute\b/,
    /\bsticky\b/,
    /\bz-\[/,
    /\bz-\d/,
    /translate/,
    /(^|\s)-m[trblxy]?-/, // negative margins
    /(^|\s)(top|bottom|left|right)-/, // inset positioning utilities
    /\binset-/,
  ];
  for (const cls of classNames) {
    for (const pattern of forbidden) {
      assert.equal(pattern.test(cls), false, `NOTE must stay in flow — found ${pattern} in "${cls}"`);
    }
  }
  // No inline style escape hatch either.
  assert.equal(/style=\{\{/.test(noticeCode), false, 'no inline positioning styles');
  // It is a plain block element, so it can never overlay sibling content.
  assert.match(noticeCode, /return <section[^>]*className="w-full rounded-2xl/);
});

test('the NOTE is no longer mounted globally over every page', () => {
  assert.equal(appSource.includes('ResearchDepthNotice'), false, 'App.tsx must not render the notice globally');
  assert.equal(noticeCode.includes('useLocation'), false, 'the pathname guard went away with the global mount');
});

test('the NOTE sits directly under the Verify action area — above progress, results and the AI button', () => {
  const noticeAt = verifySource.indexOf('<ResearchDepthNotice/>');
  assert.equal(noticeAt > -1, true, 'VerifyPage must render the notice');

  const inputAt = verifySource.indexOf("placeholder={t('verify_cadastral_query_ph')}");
  const loadingAt = verifySource.indexOf("{t('verify_loading_label')}");
  const reportAt = verifySource.indexOf('<OverallAssessmentCard');
  const aiButtonAt = verifySource.indexOf("{t('verify_ask_ai_button')}");

  assert.equal(inputAt < noticeAt, true, 'the NOTE follows the cadastral input it explains');
  assert.equal(noticeAt < loadingAt, true, 'the NOTE is above the progress card');
  assert.equal(noticeAt < reportAt, true, 'the NOTE is above the report');
  assert.equal(noticeAt < aiButtonAt, true, 'the NOTE is not stranded at the very bottom');

  // It is a direct child of the page's space-y-5 column, so it always has
  // vertical separation above and below, in every state.
  assert.match(verifySource, /space-y-5 pb-16/);
});

/* ------------------------------------------------------------------ *
 * Mobile-safe Verify layout.                                          *
 * ------------------------------------------------------------------ */

test('the Verify header and primary action fit narrow screens without horizontal overflow', () => {
  // Header row wraps instead of squeezing the title against two buttons.
  assert.match(verifySource, /className="flex flex-wrap items-start justify-between gap-2"/);
  assert.match(verifySource, /className="min-w-0 flex-1"/);
  assert.match(verifySource, /text-xl sm:text-2xl font-bold break-words/);
  // Search input + button stack under sm, side by side above it.
  assert.match(verifySource, /className="flex flex-col gap-2 sm:flex-row"/);
  assert.match(verifySource, /<Input className="min-w-0 flex-1"/);
  assert.match(verifySource, /<Button className="w-full sm:w-auto shrink-0" onClick=\{\(\)=>run\(\)\}/);
});

test('long cadastral codes, evidence text and errors wrap instead of overflowing', () => {
  assert.match(verifySource, /text-sm font-medium break-all">\{exactUnit\.code\}/);
  assert.match(verifySource, /text-xs text-muted-foreground leading-relaxed break-words">• \{clean\(x\)\}/);
  assert.match(verifySource, /text-sm text-destructive break-words">\{err\}/);
  // Truncating rows need min-w-0 to truncate rather than push the row wide.
  assert.match(verifySource, /border text-xs min-w-0"><span className="truncate min-w-0">/);
});

/* ------------------------------------------------------------------ *
 * Mobile-safe CAPTCHA / live-browser modal.                           *
 * ------------------------------------------------------------------ */

test('the CAPTCHA modal fits the real mobile viewport and cannot exceed it', () => {
  assert.match(modalSource, /h-\[100dvh\] max-h-\[100dvh\] sm:h-auto/);
  assert.match(modalSource, /sm:max-h-\[90vh\]/);
  // The panel clips its children; the challenge area scrolls rather than
  // clipping, so a large multi-tile challenge is always reachable.
  assert.match(modalSource, /bg-background shadow-2xl overflow-hidden flex flex-col/);
  assert.match(modalSource, /flex-1 min-h-\[320px\] sm:min-h-\[420px\] overflow-auto/);
  // Browserless is gone: the challenge is a screenshot of the REAL local
  // Chromium page, clicked through /research/:id/action — no iframe, no
  // remote browser URL.
  assert.equal(modalSource.includes('<iframe'), false, 'no remote browser iframe after the local Chromium migration');
  assert.match(modalSource, /<img ref=\{img\} src=\{shot\.image\} onClick=\{click\}/);
});

test('the modal controls stay reachable on a phone — full-width taps, safe-area padding, wrapping text', () => {
  assert.match(modalSource, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(modalSource, /flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between/);
  assert.equal((modalSource.match(/className="w-full sm:w-auto"/g) || []).length, 2, 'both footer actions are full-width on mobile');
  assert.match(modalSource, /px-3 py-3 sm:px-5 sm:py-4 border-b/);
  assert.match(modalSource, /text-xs text-muted-foreground break-words/);
});

test('the required CAPTCHA NOTE is shown to the customer, in normal document flow', () => {
  // The yellow-person-icon instruction, in every supported language.
  assert.match(modalSource, /t\('verify_captcha_extension_note'\)/);
  // The whole NOTE block: its wrapper div through to the challenge area.
  const note = modalSource.slice(
    modalSource.lastIndexOf('<div', modalSource.indexOf("verify_captcha_recommended_note")),
    modalSource.indexOf('flex-1 min-h-')
  );
  // A plain block between the header and the challenge — never fixed,
  // absolute, translated or z-indexed over other content.
  assert.equal(/fixed|absolute|sticky|z-\[|translate|(^|\s)-m[trblxy]?-/.test(note), false);
  assert.match(note, /border-b shrink-0/);
});

test('the modal is a labelled dialog and its icon controls are named', () => {
  assert.match(modalSource, /role="dialog" aria-modal="true" aria-label=\{t\('verify_captcha_title'\)\}/);
  assert.equal((modalSource.match(/aria-label=\{t\(/g) || []).length >= 3, true, 'icon controls must be named');
});

/* ------------------------------------------------------------------ *
 * The UI changes did not touch the live-browser contract.             *
 * ------------------------------------------------------------------ */

test('the modal drives the SAME local Chromium page: screenshot in, clicks out, resume/skip on the same session', () => {
  // The proven pre-Browserless transport, restored.
  assert.match(modalSource, /path=`\/research\/\$\{jobId\}\/screenshot`/);
  assert.match(modalSource, /path=`\/research\/\$\{jobId\}\/action`/);
  assert.match(modalSource, /path=`\/research\/\$\{jobId\}\/resume`/);
  assert.match(modalSource, /path=`\/research\/\$\{jobId\}\/skip`/);
  // Authenticated with the user's Supabase JWT, as before.
  assert.match(modalSource, /Authorization:`Bearer \$\{session\.access_token\}`/);
  // Clicks are mapped from the displayed image back to real page coordinates.
  assert.match(modalSource, /x=\(e\.clientX-r\.left\)\*shot\.width\/r\.width/);
  // No Browserless remnants, and no solver or bypass anywhere.
  assert.equal(/liveURL|liveURLId|browserless/i.test(modalSource), false);
  assert.equal(/solveCaptcha|captchaSolver|2captcha|anticaptcha|bypassCaptcha/i.test(modalSource), false);
  // VerifyPage still drives the same modal with the same worker job id.
  assert.match(verifySource, /<ResearchCaptchaModal open=\{!!captcha\} jobId=\{workerCaptchaId\}/);
});

/* ------------------------------------------------------------------ *
 * The audited mobile widths.                                          *
 *                                                                     *
 * Mandate: "Audit at 320px / 360px / 375px / 390px / 430px. CAPTCHA   *
 * screenshot/action UI must be usable."                               *
 *                                                                     *
 * There is no DOM renderer in this repository, so the guarantee is    *
 * made structurally and it is a real one: Tailwind's `sm` breakpoint  *
 * is 640px (the config overrides `screens` only for `container`), so  *
 * every one of the audited widths renders the MOBILE branch of every  *
 * responsive class asserted above — the full-screen sheet, the        *
 * stacked full-width actions, the safe-area padding. What must then   *
 * be proven for the narrowest of them is that nothing in the modal    *
 * has a fixed width that cannot fit.                                  *
 * ------------------------------------------------------------------ */

const AUDITED_WIDTHS = [320, 360, 375, 390, 430];
const TAILWIND_SM = 640;

test('every audited width renders the mobile branch of the CAPTCHA modal', () => {
  for (const width of AUDITED_WIDTHS) {
    assert.equal(width < TAILWIND_SM, true, `${width}px must fall below the sm: breakpoint to get the mobile layout`);
  }
  // The mobile branch of each responsive pair the customer actually touches.
  assert.match(modalSource, /w-full h-\[100dvh\]/, 'full-screen sheet below sm');
  assert.match(modalSource, /className="w-full sm:w-auto"/, 'full-width tap targets below sm');
  assert.match(modalSource, /flex flex-col-reverse gap-2 sm:flex-row/, 'stacked actions below sm');
  assert.match(modalSource, /p-0 sm:p-4/, 'no wasted outer padding below sm');
});

test('nothing in the CAPTCHA modal is wider than the narrowest audited viewport', () => {
  const narrowest = Math.min(...AUDITED_WIDTHS);
  // Any fixed pixel width/min-width would overflow horizontally at 320px.
  for (const [, value] of modalSource.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) {
    assert.equal(Number(value) <= narrowest, true, `fixed width ${value}px overflows a ${narrowest}px viewport`);
  }
  // The desktop width is explicitly viewport-clamped, not absolute.
  assert.match(modalSource, /sm:w-\[min\(1100px,94vw\)\]/);
  // The screenshot scales down instead of forcing the page wide, and the
  // challenge area scrolls rather than clipping when it cannot.
  assert.match(modalSource, /className="max-w-full w-auto h-auto cursor-pointer select-none"/);
  assert.match(modalSource, /overflow-auto grid place-items-center/);
  // Only min-HEIGHT is fixed; a min-width there would break narrow screens.
  assert.equal(/min-w-\[\d+px\]/.test(modalSource), false, 'the challenge area must never have a fixed min-width');
});

test('the assistance NOTE stays readable and in flow at every audited width', () => {
  // The NOTE is rendered only when the worker reports a real, configured
  // human-assist backend — the UI must never promise help that is not there.
  assert.match(modalSource, /\{shot\?\.humanAssist&&<p [^>]*>\{t\('verify_captcha_extension_note'\)\}<\/p>\}/);
  // Long Georgian/Russian sentences must wrap, not overflow, at 320px.
  const noteTag = modalSource.match(/<p [^>]*>\{t\('verify_captcha_extension_note'\)\}<\/p>/)[0];
  assert.match(noteTag, /break-words/, 'the NOTE must wrap at narrow widths');
  assert.equal(/fixed|absolute|sticky|z-\[|translate/.test(noteTag), false, 'the NOTE must stay in normal flow');
});
