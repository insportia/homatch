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
