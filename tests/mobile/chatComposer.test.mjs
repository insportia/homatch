// THE ASSISTANT'S COMPOSER, AT REAL WIDTHS.
//
// A chat screen has one job that must never fail: you can see the box you
// type into. Three separate things had broken that, and none of them was
// visible to a type-checker, a linter or any other test:
//
//   - the column was sized `100vh - 3.5rem` while the shell's header is 4rem,
//     and 5rem from md, so the composer hung below the bottom of the window
//   - 100vh on a phone is the height WITHOUT the keyboard and does not change
//     when one opens, so the box you type into sat behind the keyboard
//   - the field was a single-line input, at a font size Safari zooms into and
//     never zooms back out of
//
// So this measures the real thing in a real browser: where the composer is,
// how big its text is, and whether it is still reachable after somebody types
// three lines into it.

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

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp, email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/* Each case is a width, a height and a language — including the narrowest
   screen in the longest-word language, and one right-to-left locale. */
const CASES = [
  { name: 'iPhone-class portrait, English', w: 390, h: 844, lang: 'en' },
  { name: 'the 320px floor, Georgian', w: 320, h: 720, lang: 'ka' },
  { name: 'right to left, Hebrew', w: 390, h: 844, lang: 'he' },
  { name: 'laptop', w: 1600, h: 900, lang: 'en' },
];

test('you can always see the box you type into', opts, async (t) => {
  if (skipReason) assert.fail(`chat composer gate could not run: ${skipReason}`);

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

  const json = (b) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
  });

  const failures = [];

  for (const c of CASES) {
    const ctx = await browser.newContext({
      viewport: { width: c.w, height: c.h },
      deviceScaleFactor: 2, isMobile: c.w < 700, hasTouch: c.w < 700,
    });
    await ctx.addInitScript(([k, s, l]) => {
      window.localStorage.setItem(k, JSON.stringify(s));
      window.localStorage.setItem('homatch_lang', l);
    }, ['sb-stubproj-auth-token', fakeSession(), c.lang]);

    const page = await ctx.newPage();
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
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const before = await page.evaluate((vh) => {
      const ta = document.querySelector('textarea');
      const de = document.documentElement;
      if (!ta) return { mounted: false, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
      const r = ta.getBoundingClientRect();
      const send = ta.parentElement?.querySelector('button');
      const sr = send?.getBoundingClientRect();
      return {
        mounted: true,
        scrollWidth: de.scrollWidth,
        docScrollH: de.scrollHeight,
        docClientH: de.clientHeight,
        clientWidth: de.clientWidth,
        onScreen: r.top >= 0 && r.bottom <= vh + 1,
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        fontSize: parseFloat(getComputedStyle(ta).fontSize),
        sendOnScreen: sr ? sr.bottom <= vh + 1 : false,
        dir: de.getAttribute('dir'),
      };
    }, c.h);

    const where = `${c.name} (${c.w}x${c.h}, ${c.lang})`;

    if (!before.mounted) {
      failures.push(`${where}: the assistant rendered no composer at all`);
      await ctx.close();
      continue;
    }
    if (!before.onScreen) {
      failures.push(`${where}: the composer is off screen (bottom ${before.bottom}, viewport ${c.h})`);
    }
    if (!before.sendOnScreen) failures.push(`${where}: the send button is off screen`);
    /*
     * The chat shell must not scroll as a PAGE.
     *
     * The conversation scrolls; the screen around it does not. When the
     * document itself is taller than the window, the header scrolls away
     * while you type and the composer will not stay put. It was 933px
     * against an 844px viewport, because the shell added 96px of padding
     * to clear the mobile tab bar on a screen that had already sized
     * itself to the window.
     */
    if (before.docScrollH > before.docClientH + 1) {
      failures.push(
        `${where}: the whole page scrolls (${before.docScrollH}px of document`
        + ` in a ${before.docClientH}px window); the chat shell should be fixed`,
      );
    }
    if (before.scrollWidth > before.clientWidth + 1) {
      failures.push(`${where}: horizontal overflow, scrollWidth ${before.scrollWidth}`);
    }
    /* Under 16px and Safari zooms the page on focus — and does not zoom back
       out on blur, leaving the customer on a magnified, sideways-scrolling
       page after asking a single question. */
    if (before.fontSize < 16) {
      failures.push(`${where}: composer text is ${before.fontSize}px; iOS zooms anything under 16px`);
    }
    if (c.lang === 'he' && before.dir !== 'rtl') {
      failures.push(`${where}: the document is not in right-to-left mode`);
    }

    /* Three lines: the box must grow, and must still be reachable. A field
       that grows off the bottom of the window is worse than one that does
       not grow at all. */
    await page.locator('textarea').click();
    await page.keyboard.type('one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('three');
    await page.waitForTimeout(400);

    const after = await page.evaluate((vh) => {
      const ta = document.querySelector('textarea');
      const r = ta.getBoundingClientRect();
      return {
        height: Math.round(r.height),
        onScreen: r.bottom <= vh + 1,
        lines: ta.value.split('\n').length,
      };
    }, c.h);

    if (after.lines !== 3) {
      failures.push(`${where}: Shift+Enter produced ${after.lines} lines, not 3 — can the field hold a newline?`);
    }
    if (after.height <= before.height) {
      failures.push(
        `${where}: the composer did not grow for three lines`
        + ` (${before.height}px then ${after.height}px)`,
      );
    }
    if (!after.onScreen) {
      failures.push(`${where}: the composer grew off the bottom of the window`);
    }

    await ctx.close();
  }

  assert.deepEqual(failures, [], `the assistant's composer:\n  ${failures.join('\n  ')}`);
});
