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
  assert.match(modalSource, /h-\[100dvh\] max-h-\[100dvh\] sm:h-\[92vh\] sm:max-h-\[92vh\]/);
  // Panel clips its children, so the iframe can never escape the rounded edge.
  assert.match(modalSource, /bg-background shadow-2xl overflow-hidden flex flex-col/);
  assert.match(modalSource, /relative bg-neutral-950 flex-1 min-h-0 overflow-hidden/);
  assert.match(modalSource, /<iframe [^>]*className="block w-full h-full max-w-full border-0/);
});

test('the modal controls stay reachable on a phone — full-width taps, safe-area padding, wrapping text', () => {
  assert.match(modalSource, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(modalSource, /className="flex flex-col gap-2 sm:flex-row sm:justify-end"/);
  assert.equal((modalSource.match(/className="w-full sm:w-auto"/g) || []).length, 2, 'both footer actions are full-width on mobile');
  assert.match(modalSource, /px-3 py-3 sm:px-5 sm:py-4 border-b/);
  assert.match(modalSource, /text-xs text-muted-foreground mb-2 sm:mb-3 break-words/);
});

test('the modal is a labelled dialog and its icon controls are named', () => {
  assert.match(modalSource, /role="dialog" aria-modal="true" aria-label=\{copy\.title\}/);
  assert.match(modalSource, /aria-label=\{copy\.refresh\}/);
  assert.match(modalSource, /aria-label=\{copy\.close\}/);
  // Every language variant defines the new close label.
  assert.equal((modalSource.match(/close:'/g) || []).length, 3);
});

/* ------------------------------------------------------------------ *
 * The UI changes did not touch the live-browser contract.             *
 * ------------------------------------------------------------------ */

test('the live-browser and resume contracts the worker serves are untouched by the layout work', () => {
  assert.match(modalSource, /fetch\(`\$\{WORKER\}\/research\/\$\{jobId\}\/live`,\s*\{\s*method:\s*'POST'/);
  assert.match(modalSource, /\/research\/\$\{jobId\}\/resume`,\s*\{\s*method:\s*'POST'/);
  assert.match(modalSource, /if\(!r\.ok\|\|!d\?\.liveURL\)throw new Error\(d\?\.error/);
  // The real interactive liveURL remains the only source — nothing faked, no
  // solver, no bypass.
  assert.match(modalSource, /src=\{live\.liveURL\}/);
  assert.equal(modalSource.includes('liveURLId'), false);
  assert.equal(/solveCaptcha|captchaSolver|2captcha|anticaptcha|bypassCaptcha/i.test(modalSource), false);
  // VerifyPage still drives the same modal with the same worker job id.
  assert.match(verifySource, /<ResearchCaptchaModal open=\{!!captcha\} jobId=\{workerCaptchaId\}/);
});
