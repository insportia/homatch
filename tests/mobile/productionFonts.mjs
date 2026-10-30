/*
 * The production web fonts, served to the browser tests from pinned copies
 * (tests/mobile/fonts, refreshed by scripts/fonts/pin-test-fonts.mjs).
 *
 * The suites stub every request outside the preview server, and the stub used
 * to answer the Google Fonts stylesheet with `{}`: no web font ever loaded, so
 * Georgian, Hebrew and Arabic rendered in the machine's system font. A width
 * measured that way is a different layout on every machine and never the one
 * customers see (Meta Ads, 2026-10-30: green on the Linux runner, a word broken
 * at 360px and a two-row action bar at 320px in the real Noto Sans Georgian).
 *
 * useProductionFonts(page) — call AFTER the suite's catch-all route (Playwright
 * tries the most recently registered route first). renderedFonts(page, sel) —
 * the faces Chrome actually drew a node's glyphs with (CDP), which is the proof;
 * document.fonts.check() answers true for a family no @font-face declares.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPinned } from '../../scripts/fonts/pin-test-fonts.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts', 'google');
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'max-age=31536000' };

let verified = false;
/** Fails loudly when src/index.css moved to another stylesheet or a pinned file changed. */
function assertPinned() {
  if (verified) return;
  const problems = checkPinned();
  if (problems.length) throw new Error(`pinned test fonts are stale:\n${problems.join('\n')}`);
  verified = true;
}

export async function useProductionFonts(page) {
  assertPinned();
  const css = readFileSync(join(DIR, 'css2.css'));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', headers: CORS, body: css }));
  await page.route('https://fonts.gstatic.com/**', (r) => {
    const file = join(DIR, new URL(r.request().url()).pathname);
    // A face the pinned stylesheet does not name is a 404, never a silent system fallback.
    if (!existsSync(file)) return r.fulfill({ status: 404, headers: CORS, body: '' });
    return r.fulfill({ status: 200, contentType: 'font/woff2', headers: CORS, body: readFileSync(file) });
  });
}

/** Waits for every face the page asked for, so no measurement happens mid-swap. */
export async function fontsSettled(page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}

/**
 * The platform fonts Chrome used for the glyphs of the first node matching
 * `selector`: [{ family, webFont, glyphs }]. null when nothing matches.
 */
export async function renderedFonts(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((f) => ({ family: f.familyName, webFont: f.isCustomFont, glyphs: f.glyphCount }));
  } finally {
    await cdp.detach().catch(() => {});
  }
}
