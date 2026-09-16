/*
 * THE INSTALL INSTRUCTIONS, INSIDE THE VIEWPORT THEY ARE READ IN.
 *
 * WHAT WENT WRONG, AND WHY IT WAS INVISIBLE TO EVERY EXISTING GATE
 *
 * On an iPhone the sheet opened with its top above the top of the screen.
 * What a person saw was "3. Tap Add" and "Not now"; steps one and two were
 * off-screen and nothing could scroll to reach them, because the overflow was
 * outside the panel rather than inside it. The one flow whose entire purpose
 * is to be followed in order could only be read from its last step.
 *
 * The cause is that `position: fixed; inset: 0` measures the LAYOUT viewport.
 * On iOS Safari that box is taller than the visible one whenever the browser
 * chrome is showing, so `items-end` aligned the panel to the bottom of a
 * rectangle whose top was above the screen.
 *
 * No existing gate could see it. The mobile suites measure overflow, contrast
 * and control sizes on ROUTES; this is a modal that only exists after a click,
 * and its failure is vertical, which nothing was measuring.
 *
 * WHY THE ASSERTIONS ARE GEOMETRIC
 *
 * Checking that the element has a class, or that the CSS mentions `dvh`, would
 * pass on a panel that is still off-screen — the original bug had correct-
 * looking CSS too. So these read the real rectangle out of a real Chrome at
 * real iPhone sizes and compare it against the real viewport, which is the
 * thing that was actually wrong.
 *
 * A short viewport is included deliberately: it is both a landscape iPhone and
 * the honest simulation of an expanded address bar eating the bottom of the
 * screen. That is the case the panel must SCROLL for rather than clip.
 *
 * WHAT THIS GATE CANNOT SEE, STATED SO NOBODY READS MORE INTO A PASS
 *
 * Headless Chrome's layout viewport and visual viewport are the same box, so
 * the iOS-specific divergence between them cannot be reproduced here. What IS
 * reproduced, and what fails on the original code, is the consequence: a panel
 * taller than the space it is given, with no way to scroll to the rest. Run
 * against the pre-fix component this reports 380px of content in a 380px box
 * with overflow visible.
 *
 * The other half of the fix -- dvh height and the portal -- is verified here
 * only in that it does not regress these numbers. The behaviour it exists for
 * needs a real iPhone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4356;
const BASE = `http://127.0.0.1:${PORT}`;

/* Safari on iOS. isIOSSafari() returns false for CriOS/FxiOS/EdgiOS, so this
   has to be the real Safari string for the manual-instruction mode to exist. */
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/*
 * The sizes that matter, and why each one is here.
 *
 *   375x667   iPhone SE. The smallest screen still sold, and the one this
 *             bug is worst on because the panel is tallest relative to it.
 *   390x844   iPhone 14/15. The common case.
 *   430x932   iPhone 15 Pro Max. Proves the fix did not simply move the
 *             clipping to a different size.
 *   375x390   landscape, and the honest stand-in for Safari with both bars
 *             expanded. Here the content genuinely cannot fit, so the panel
 *             must scroll rather than clip.
 */
const SIZES = [
  { name: 'iPhone SE', width: 375, height: 667, mustScroll: false },
  { name: 'iPhone 14', width: 390, height: 844, mustScroll: false },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, mustScroll: false },
  { name: 'short viewport (bars expanded / landscape)', width: 375, height: 390, mustScroll: true },
];

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

test('the install instructions are fully on screen, at every iPhone size', opts, async (t) => {
  if (skipReason) assert.fail(`PWA install sheet gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
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

  const failures = [];
  let measured = 0;

  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      userAgent: IOS_SAFARI_UA,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await ctx.addInitScript(() => {
      window.localStorage.setItem('homatch_lang', 'en');
      // A previous mute would collapse the control to a chip and never show
      // the sheet, which would make this gate pass by not running.
      window.localStorage.removeItem('homatch_pwa_dismissed_at');
    });

    const page = await ctx.newPage();
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(BASE)) return r.continue();
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '[]',
      });
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    /* The control names itself with an aria-label, which is also the thing a
       screen-reader user would find. If there is more than one on the page
       (header and mobile menu), the first visible one is the one a thumb
       reaches. */
    const button = page.locator('button[aria-label]').filter({ has: page.locator('svg') });
    const opened = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const target = btns.find((b) => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return label.includes('install') || label.includes('add to home');
      });
      if (!target) return false;
      target.click();
      return true;
    });
    void button;

    if (!opened) {
      failures.push(`${size.name}: no install control rendered, so the sheet could not be opened`);
      await ctx.close();
      continue;
    }

    await page.waitForTimeout(500);

    const geom = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dialog) return null;
      const panel = dialog.firstElementChild;
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const steps = [...panel.querySelectorAll('ol li')].map((li) => {
        const lr = li.getBoundingClientRect();
        return { top: lr.top, bottom: lr.bottom, text: (li.textContent || '').trim().slice(0, 40) };
      });
      return {
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        viewport: window.innerHeight,
        overflowY: cs.overflowY,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        steps,
      };
    });

    if (!geom) {
      failures.push(`${size.name}: the install sheet did not open`);
      await ctx.close();
      continue;
    }

    measured += 1;

    /* THE BUG, STATED AS A NUMBER. A negative top is the clipped sheet. */
    if (geom.top < -0.5) {
      failures.push(
        `${size.name}: the sheet starts ${Math.abs(Math.round(geom.top))}px ABOVE the top of the `
        + `screen — its first instructions cannot be read (panel ${Math.round(geom.height)}px, `
        + `viewport ${geom.viewport}px)`,
      );
    }

    if (geom.bottom > geom.viewport + 0.5) {
      failures.push(
        `${size.name}: the sheet ends ${Math.round(geom.bottom - geom.viewport)}px below the bottom `
        + 'of the screen',
      );
    }

    /* Taller than the screen is allowed. Taller than the screen WITHOUT being
       scrollable is the clip this gate exists to prevent. */
    if (geom.scrollHeight > geom.clientHeight + 1 && !/auto|scroll/.test(geom.overflowY)) {
      failures.push(
        `${size.name}: content overflows the panel (${geom.scrollHeight}px in ${geom.clientHeight}px) `
        + `and overflow-y is "${geom.overflowY}", so the rest is unreachable`,
      );
    }

    if (size.mustScroll && !(geom.scrollHeight > geom.clientHeight + 1)) {
      /* Not a failure of the product — just a sign this size no longer
         exercises the scrolling path, so the assertion above proves nothing
         here and somebody should pick a shorter one. */
      failures.push(
        `${size.name}: expected the content to exceed the panel so the scroll path is covered, `
        + `but it fits (${geom.scrollHeight}px in ${geom.clientHeight}px)`,
      );
    }

    /* EVERY step must be reachable, which is the actual requirement: the
       person has to get from 1 to Add. A step is reachable if it is inside
       the panel's scrollable content, not if it happens to be visible now. */
    if (geom.steps.length < 2) {
      failures.push(`${size.name}: expected the numbered instructions, found ${geom.steps.length}`);
    }
    const firstStep = geom.steps[0];
    if (firstStep && firstStep.top < -0.5) {
      failures.push(
        `${size.name}: step 1 ("${firstStep.text}") is above the top of the screen — this is the `
        + 'reported bug, where only the last step and "Not now" were visible',
      );
    }

    /* The page behind must not scroll while the modal is open: on iOS that is
       what moves the address bar and resizes the viewport mid-read. */
    if (geom.bodyOverflow !== 'hidden') {
      failures.push(`${size.name}: the page behind the modal still scrolls (body overflow "${geom.bodyOverflow}")`);
    }

    await ctx.close();
  }

  assert.ok(measured > 0, 'the install sheet was never opened, so nothing was measured');
  assert.deepEqual(failures, [], `\n  - ${failures.join('\n  - ')}\n`);
});

/*
 * ── THE FOUR PATHS, EACH TAKING THE FEWEST TAPS ITS PLATFORM ALLOWS ───────
 *
 * The number of taps is set by the operating system, not by us. What IS ours
 * is whether we add one on top:
 *
 *   Chromium with a held prompt   must raise the browser's own dialog on the
 *                                 first click. A Homatch modal before the
 *                                 browser's modal is a tap we invented.
 *   iOS Safari                    must open the instructions immediately.
 *   iOS Chrome/Firefox            must say where it CAN be done. This used to
 *                                 render nothing at all.
 *   already installed             must offer no install control and no modal.
 */
test('each platform takes the shortest path it actually permits', opts, async (t) => {
  if (skipReason) assert.fail(`PWA path gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT + 1), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const base = `http://127.0.0.1:${PORT + 1}`;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const IOS_CHROME_UA = IOS_SAFARI_UA.replace('Version/17.5', 'CriOS/126.0');
  const failures = [];

  /** Open the page as a given platform, click the install control, report. */
  async function run({ name, ua, standalone, fireBip, lateBip, muted }) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: ua, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    });
    await ctx.addInitScript(([isStandalone, wantBip, lateMs, wantMuted]) => {
      window.localStorage.setItem('homatch_lang', 'en');
      if (wantMuted) {
        // What rememberMuted() writes: a recent timestamp.
        window.localStorage.setItem('homatch_pwa_dismissed_at', String(Date.now()));
      } else {
        window.localStorage.removeItem('homatch_pwa_dismissed_at');
      }
      window.__promptCalls = 0;
      if (lateMs) {
        /* Dispatched AFTER the click, which is the ordering the fix exists
           for. The click handler must wait rather than conclude. */
        window.__fireLate = () => {
          const e = new Event('beforeinstallprompt');
          e.prompt = () => { window.__promptCalls += 1; return Promise.resolve(); };
          e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
          window.dispatchEvent(e);
        };
      }
      if (isStandalone) {
        // What isStandalone() reads on iOS, and on Chromium.
        Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
        const mm = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
          ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
          : mm(q));
      }
      if (wantBip) {
        /* A real BeforeInstallPromptEvent cannot be constructed in a page, so
           this is a stand-in carrying the two members the code uses. It proves
           our WIRING calls prompt() on the first click -- not that Chromium
           would have offered one, which is Chromium's business. */
        window.addEventListener('load', () => {
          const e = new Event('beforeinstallprompt');
          e.prompt = () => { window.__promptCalls += 1; return Promise.resolve(); };
          e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
          window.dispatchEvent(e);
        });
      }
    }, [Boolean(standalone), Boolean(fireBip), lateBip ?? 0, Boolean(muted)]);

    const page = await ctx.newPage();
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(base)) return r.continue();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const clicked = await page.evaluate(() => {
      const target = [...document.querySelectorAll('button')].find((b) => {
        const l = (b.getAttribute('aria-label') || '').toLowerCase();
        return l.includes('install') || l.includes('add to home');
      });
      if (!target) return false;
      target.click();
      return true;
    });
    if (lateBip) {
      await page.waitForTimeout(lateBip);
      await page.evaluate(() => window.__fireLate?.());
    }
    await page.waitForTimeout(900);

    const out = await page.evaluate(() => ({
      dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      promptCalls: window.__promptCalls ?? 0,
      title: document.querySelector('[role="dialog"] h2')?.textContent?.trim() ?? null,
      steps: [...document.querySelectorAll('[role="dialog"] ol li')].length,
    }));
    await ctx.close();
    return { clicked, ...out };
  }

  // 1. Chromium holding a prompt: straight to the browser's own dialog.
  const chromiumUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const native = await run({ name: 'android', ua: chromiumUA, fireBip: true });
  if (!native.clicked) failures.push('android: no install control was rendered');
  else {
    if (native.promptCalls !== 1) {
      failures.push(`android: the native prompt was raised ${native.promptCalls} times, expected exactly 1 on the first click`);
    }
    if (native.dialog) failures.push('android: a Homatch modal opened before the browser dialog — that is a tap we invented');
  }

  // 2. iOS Safari: instructions, immediately, three steps.
  const ios = await run({ name: 'ios', ua: IOS_SAFARI_UA });
  if (!ios.clicked) failures.push('ios: no install control was rendered');
  else {
    if (!ios.dialog) failures.push('ios: the instructions did not open');
    if (ios.steps !== 3) failures.push(`ios: expected the three Safari steps, found ${ios.steps}`);
  }

  // 3. iOS Chrome: told where it can be done, rather than nothing at all.
  const iosChrome = await run({ name: 'ios-chrome', ua: IOS_CHROME_UA });
  if (!iosChrome.clicked) {
    failures.push('ios-chrome: still renders no control, so the user cannot learn that Safari installs it');
  } else if (!iosChrome.dialog) {
    failures.push('ios-chrome: the control does nothing');
  }

  // 4. Installed: nothing to offer, and nothing that opens.
  const installed = await run({ name: 'standalone', ua: IOS_SAFARI_UA, standalone: true });
  if (installed.dialog) failures.push('standalone: an install modal opened inside the installed app');

  /*
   * 5. THE FOUR-SECOND WINDOW.
   *
   * Measured against the deployed site in a real Chrome: beforeinstallprompt
   * arrives about four seconds after load. A press before then used to open
   * Add to Home Screen instructions on a browser that was about to offer a
   * one-tap install. Here the click happens FIRST and the event arrives
   * afterwards, which is the order that was broken.
   */
  const rescued = await run({ name: 'late-event', ua: chromiumUA, lateBip: 250 });
  if (!rescued.clicked) failures.push('late-event: no install control was rendered');
  else {
    if (rescued.promptCalls !== 1) {
      failures.push(`late-event: a prompt arriving after the click was ignored (prompt called ${rescued.promptCalls} times)`);
    }
    if (rescued.dialog) failures.push('late-event: instructions opened instead of waiting for the prompt that was coming');
  }

  /*
   * 6. MUTED, ON A BROWSER THAT IS OFFERING.
   *
   * "Not now" means stop nagging, not disable the capability. The control is
   * a quiet chip, and pressing it must still spend the real prompt rather
   * than explain a browser menu.
   */
  const muted = await run({ name: 'muted', ua: chromiumUA, fireBip: true, muted: true });
  if (!muted.clicked) failures.push('muted: the control vanished entirely');
  else {
    if (muted.promptCalls !== 1) {
      failures.push(`muted: a held prompt was not used (prompt called ${muted.promptCalls} times)`);
    }
    if (muted.dialog) failures.push('muted: instructions opened while a real prompt was held');
  }

  assert.deepEqual(failures, [], `\n  - ${failures.join('\n  - ')}\n`);
});
