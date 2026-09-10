import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Verify UI layout regressions — the NOTE's document flow and the mobile
 * safety of the human-verification surface.
 *
 * The streamed CAPTCHA modal this file used to cover no longer exists. It was
 * removed after a real customer test showed a person being asked to solve a
 * Google reCAPTCHA inside the Railway browser, through a screenshot with
 * relayed clicks. The human-verification surface is now the local-browser
 * handoff, and the mobile assertions below follow it there.
 *
 * The repository has no React/DOM test runner (no vitest/jest/testing-library
 * in package.json — its frontend suites are all plain `node --test` .mjs
 * files), so these are structural source assertions, in the same style as the
 * worker's own endpoint-contract suite.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const NOTICE = `${here}../ResearchDepthNotice.tsx`;
const HANDOFF = `${here}../HumanVerificationHandoff.tsx`;
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
const handoffSource = read(HANDOFF);
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
  // The percentage progress card is gone; the research stream replaced it.
  const loadingAt = verifySource.indexOf('<ResearchStream');
  const reportAt = verifySource.indexOf('<OverallAssessmentCard');
  const aiButtonAt = verifySource.indexOf("{t('verify_ask_ai_button')}");

  assert.equal(inputAt < noticeAt, true, 'the NOTE follows the cadastral input it explains');
  assert.equal(loadingAt > -1, true, 'the research stream must be rendered');
  assert.equal(noticeAt < loadingAt, true, 'the NOTE is above the loading UI');
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
  // The retrieved-documents card lists dates as chips rather than one long
  // identifier per row, so its overflow guard is wrapping, not truncation.
  assert.match(verifySource, /className="flex flex-wrap gap-1">\{g\.dates\.map/);
});

/* ------------------------------------------------------------------ *
 * The human-verification surface: local browser, mobile-safe.         *
 * ------------------------------------------------------------------ */

test('the customer is sent to the official page in their OWN browser', () => {
  assert.match(handoffSource, /target="_blank"/);
  assert.match(handoffSource, /rel="noopener noreferrer"/);
  assert.equal(/<iframe/i.test(handoffSource), false, 'no embedded source surface');
});

test('nothing streams the worker browser to the customer any more', () => {
  // The three things the deleted modal did: pull a screenshot, relay a click,
  // and drive the worker session directly from the browser.
  for (const p of [VERIFY_PAGE, HANDOFF]) {
    const s = code(p);
    assert.equal(/\/screenshot`/.test(s), false, `${p} must not fetch a worker screenshot`);
    assert.equal(/\/action`/.test(s), false, `${p} must not relay clicks into the worker page`);
  }
});

test('the handoff fits the narrowest audited viewport', () => {
  // 320px is the floor. Nothing fixed-width may exceed it.
  for (const [, value] of handoffSource.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) {
    assert.ok(Number(value) <= 320, `fixed width ${value}px exceeds the 320px floor`);
  }
  assert.equal(/min-w-\[\d+px\]/.test(handoffSource), false, 'no fixed min-width');
});

test('the handoff actions are reachable on a phone', () => {
  // Full-width tap targets below sm, and text that wraps rather than clips.
  assert.match(handoffSource, /w-full sm:w-auto/);
  assert.match(handoffSource, /break-words|break-all/);
});

test('the Verify page renders the handoff and nothing else for this state', () => {
  assert.match(verifySource, /\{handoff&&<HumanVerificationHandoff /);
  assert.equal(
    /ResearchCaptchaModal/.test(verifySource), false,
    'the competing remote-browser path must not exist'
  );
});
