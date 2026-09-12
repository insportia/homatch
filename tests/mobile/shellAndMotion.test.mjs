// THE HEADER, THE INSTALL CONTROL, AND HOW MUCH THE PAGE MOVES.
//
// Three things that can only be checked at a real viewport, in a real
// browser, and that had all three gone wrong in ways nothing reported:
//
//   THE INSTALL BUTTON WAS INVISIBLE. On the black hero it was a dark
//   hairline over a transparent background — `border-foreground/20` on
//   near-black — so it appeared only on hover, which a phone does not have.
//   A contrast measurement of the control at rest is the check; a screenshot
//   review is not, because the button IS there, it just cannot be seen.
//
//   THE INSTALL BUTTON DELETED ITSELF. Dismissing Chrome's own install
//   dialog called rememberDismissal(), and the control vanished for sixty
//   days. The single likeliest interaction destroyed the entry point.
//
//   TWO ANIMATIONS WERE HIDDEN FOR EVERYONE. One stray brace put two
//   `animation: none; opacity: 0` rules outside the reduced-motion query, so
//   they applied always. An animation that never runs looks exactly like a
//   design decision, which is why this asserts that the band is RUNNING for
//   somebody who has not asked it to stop.
//
// The backend is stubbed, so this needs no session, no network and no
// production data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4333;
const BASE = `http://127.0.0.1:${PORT}`;

/** Real devices, narrowest first. 320 is the floor this product supports. */
const WIDTHS = [320, 375, 390, 430];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next one */ }
  }
  return null;
}

function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) {
    return 'no build in dist/ — run: npm run build:harness';
  }
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

/** sRGB relative luminance, for the contrast ratio below. */
function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

async function serve(t, chromium) {
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return browser;
}

const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

async function stub(page) {
  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(BASE)) return r.continue();
    if (r.request().method() === 'OPTIONS') {
      return r.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }
    if (url.includes('/rest/v1/rpc/')) return r.fulfill(json(null));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });
}

/**
 * Chromium only fires `beforeinstallprompt` for a site it judges installable,
 * which headless Chrome will not do. The event is a plain CustomEvent with a
 * `prompt()` and a `userChoice`, so the platform's half of the contract is
 * replayed here — what is under test is OUR half: what the control does with
 * an offer, an acceptance, and a refusal.
 */
const INSTALL_SHIM = `
  window.__installOutcome = 'accepted';
  window.__promptCalls = 0;
  window.__fireInstallPrompt = () => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__promptCalls += 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: window.__installOutcome, platform: 'web' });
    window.dispatchEvent(e);
  };
`;

test('the install control is visible, reachable and does not delete itself', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 780 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await ctx.addInitScript(INSTALL_SHIM);
    await ctx.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
    const page = await ctx.newPage();
    await stub(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__fireInstallPrompt());
    await page.waitForTimeout(600);

    /* ── 1. In the menu, not hidden behind a hover ───────────────────── */
    /* The MENU toggle, by what it is for. `header button[aria-expanded]`
       also matches the language dropdown's Radix trigger, which is hidden at
       these widths — so the first match was an invisible button. */
    const menuButton = page.locator('header button[aria-expanded]:visible').last();
    assert.ok(await menuButton.count() > 0, `no menu control in the header at ${width}px`);
    await menuButton.click();
    await page.waitForTimeout(700);

    const shown = page.locator('button:visible').filter({ hasText: /Install app/i });
    assert.ok(await shown.count() > 0,
      `the mobile menu offers no way to install the app at ${width}px`);

    const target = shown.first();
    await target.scrollIntoViewIfNeeded();

    /* ── 2. VISIBLE AT REST. The old treatment was a dark hairline on
           near-black: present in the DOM, invisible on a phone. ──────── */
    const look = await target.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Walk up for the first painted background behind the control.
      let behind = 'rgba(0, 0, 0, 0)';
      for (let n = el.parentElement; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { behind = bg; break; }
      }
      return {
        background: cs.backgroundColor, color: cs.color, behind,
        width: Math.round(r.width), height: Math.round(r.height),
        left: Math.round(r.left), right: Math.round(r.right),
      };
    });

    assert.ok(look.height >= 40,
      `the install control is ${look.height}px tall at ${width}px — below the touch floor`);
    assert.ok(look.left >= -1 && look.right <= width + 1,
      `the install control hangs outside the ${width}px viewport`);

    const surface = rgb(look.background);
    const behind = rgb(look.behind);
    assert.ok(
      surface.length === 3 && !/rgba\(0, 0, 0, 0\)/.test(look.background),
      `the install control has no background of its own at ${width}px — it is invisible until hover`,
    );
    assert.ok(
      contrast(rgb(look.color), surface) >= 4.5,
      `the install label is ${contrast(rgb(look.color), surface).toFixed(2)}:1 on its own surface at ${width}px`,
    );
    assert.ok(
      contrast(surface, behind) >= 1.2,
      `the install control is indistinguishable from what is behind it at ${width}px`,
    );

    /* ── 3. The language selector is reachable on a phone ────────────── */
    /* By what it says, trimmed: the trigger is a two-letter code beside a
       globe and a chevron, both of which are SVG and contribute no text. */
    const langs = await page.locator('button:visible').evaluateAll(
      (els) => els.filter((e) => /^(en|ka|ru|tr|ar|he)$/i.test((e.textContent ?? '').trim())).length,
    );
    assert.ok(langs > 0, `no language control is reachable at ${width}px`);

    await ctx.close();
  }
});

test('refusing the browser dialog is "not now", never "never again"', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript(INSTALL_SHIM);
  await ctx.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const page = await ctx.newPage();
  await stub(page);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__installOutcome = 'dismissed'; window.__fireInstallPrompt(); });
  await page.waitForTimeout(500);

  await page.locator('header button[aria-expanded]:visible').last().click();
  await page.waitForTimeout(700);

  const button = page.locator('button:visible').filter({ hasText: /Install app/i }).first();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForTimeout(900);

  assert.equal(await page.evaluate(() => window.__promptCalls), 1,
    'pressing the control did not replay the browser prompt');

  /* THE REGRESSION. A dismissal used to mute the control for sixty days, so
     the likeliest interaction was the one that removed the entry point. */
  assert.equal(
    await page.evaluate(() => Object.keys(window.localStorage)
      .some((k) => /install|pwa/i.test(k) && /dismiss|mute/i.test(window.localStorage.getItem(k) ?? k))),
    false,
    'refusing the browser dialog wrote a "do not show again" flag',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.locator('header button[aria-expanded]:visible').last().click();
  await page.waitForTimeout(700);
  assert.ok(
    await page.locator('button:visible').filter({ hasText: /Install app/i }).count() > 0,
    'the install control disappeared after the dialog was dismissed once',
  );
});

test('the page moves on a phone, and stops dead when asked to', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const browser = await serve(t, chromium);

  /** Every section's opacity, to catch a reveal that never arrives. */
  const opacities = (page) => page.evaluate(() => Array.from(document.querySelectorAll('main section'))
    .map((s) => Number(getComputedStyle(s).opacity)));

  /* ── Motion ON ────────────────────────────────────────────────────── */
  const moving = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await moving.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const page = await moving.newPage();
  await stub(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  /*
   * The band that says a document is being read must actually be running.
   *
   * This is the assertion that would have caught the stray brace: the rule
   * existed, the keyframes existed, and the element was in the page — with
   * `animation: none` applied to everyone.
   */
  const band = await page.evaluate(() => {
    const el = document.querySelector('.hm-read');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      duration: cs.animationDuration,
      opacity: Number(cs.opacity),
      running: el.getAnimations().length,
    };
  });
  if (band) {
    assert.notEqual(band.name, 'none',
      'the reading band has no animation for somebody who never asked it to stop');
    assert.ok(band.running > 0, 'the reading band is not actually animating');
  }

  // Scroll the page the way a reader would, then check nothing was left
  // behind at opacity 0 by a reveal that never fired.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(1200);
  const after = await opacities(page);
  assert.equal(after.filter((o) => o < 0.99).length, 0,
    'a section was left invisible after the page had been scrolled past it');
  await moving.close();

  /* ── Motion OFF ───────────────────────────────────────────────────── */
  const still = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  await still.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
  const quiet = await still.newPage();
  await stub(quiet);
  await quiet.goto(BASE, { waitUntil: 'domcontentloaded' });
  await quiet.waitForTimeout(3000);

  /*
   * Nothing is animating, and everything is visible.
   *
   * Both halves matter. The naive implementation of "respect reduced motion"
   * is `animation: none`, which CANCELS an animation — so anything whose
   * final state comes from its keyframes is stuck at its first frame,
   * invisible. A near-zero duration ends instead, in the right place.
   */
  const runningNow = await quiet.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running'
      && Number(a.effect?.getTiming?.().duration ?? 0) > 1).length);
  assert.equal(runningNow, 0, 'something is still animating for a reader who asked it to stop');

  const quietOpacities = await opacities(quiet);
  assert.ok(quietOpacities.length > 0, 'the home page rendered no sections at all');
  assert.equal(quietOpacities.filter((o) => o < 0.99).length, 0,
    'reduced motion left part of the page invisible');
});
