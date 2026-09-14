// ACCESSIBILITY AND PERFORMANCE — the production pass.
//
// WHAT THE EXISTING GATES ALREADY HOLD, AND WHY THIS IS NOT THEM
//
// tests/mobile already measures contrast on every customer route, horizontal
// overflow from 320px up, form control sizes, the chat composer, and motion
// that stops when the operating system asks. Those are the regressions that
// come back, and they are checked on every change.
//
// None of them covers KEYBOARD USE, and none of them covers the admin
// surfaces this finish pass added. A screen can pass contrast, fit a phone,
// respect reduced motion, and still be unusable by somebody who does not use
// a mouse — a focus ring that was removed to look tidy, a control with no
// accessible name, a dialog that does not take focus.
//
// This is that audit, plus the two performance questions this pass could
// plausibly have got wrong: what a visitor downloads before the first paint,
// and whether a screen built to search four and a half thousand strings can
// actually be typed into.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4341;
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
    sub: 'u1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'admin@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

/*
 * The routes this pass touched or added, plus the two most-read customer
 * pages. Not every route in the product: an audit that takes twenty minutes
 * is an audit that gets switched off.
 */
const ROUTES = [
  { path: '/', name: 'the marketing page' },
  { path: '/about', name: 'About' },
  { path: '/admin/app-content', name: 'App Content' },
  { path: '/notifications', name: 'Notifications' },
];

/** What an assistive technology would read for this element, if anything. */
const NAME_OF = `(el) => {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '');
    if (parts.join(' ').trim()) return parts.join(' ').trim();
  }
  if (el.id) {
    const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const closestLabel = el.closest('label');
  if (closestLabel?.textContent?.trim()) return closestLabel.textContent.trim();
  if (el.getAttribute('title')?.trim()) return el.getAttribute('title').trim();
  if (el.getAttribute('placeholder')?.trim()) return el.getAttribute('placeholder').trim();
  if (el.textContent?.trim()) return el.textContent.trim();
  const img = el.querySelector('img[alt]');
  if (img?.getAttribute('alt')?.trim()) return img.getAttribute('alt').trim();
  return '';
}`;

test('the pages this pass touched can be used without a mouse', opts, async (t) => {
  if (skipReason) assert.fail(`accessibility gate could not run: ${skipReason}`);

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

  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(([k, s]) => {
      window.localStorage.setItem(k, JSON.stringify(s));
      window.localStorage.setItem('homatch_lang', 'en');
    }, ['sb-stubproj-auth-token', fakeSession()]);

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
      if (url.includes('/rest/v1/rpc/')) return r.fulfill(json(null));
      if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);

    /* ── Every control says what it is ─────────────────────────────────
       A button with no accessible name is read out as "button", which in a
       list of six is six identical buttons. */
    const named = await page.evaluate((nameOfSrc) => {
      const nameOf = eval(nameOfSrc);
      const out = [];
      let examined = 0;
      const controls = document.querySelectorAll(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]',
      );
      for (const el of controls) {
        if (!el.getClientRects().length) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        examined += 1;
        if (!nameOf(el)) {
          out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''}`);
        }
      }
      return { unnamed: [...new Set(out)], examined };
    }, NAME_OF);
    /* A page where nothing was examined passes every check below it. This is
       the difference between "no findings" and "no page". */
    if (named.examined < 3) failures.push(`${route.name}: only ${named.examined} controls found — the page did not render`);
    if (named.unnamed.length) failures.push(`${route.name}: ${named.unnamed.length} of ${named.examined} controls have no accessible name — ${named.unnamed.slice(0, 5).join(', ')}`);

    /* ── Focus is visible ──────────────────────────────────────────────
       Tabbing to something that looks exactly the same as not being on it is
       the single most common way a keyboard user is locked out. */
    const invisibleFocus = await page.evaluate(() => {
      const focusable = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')]
        .filter((el) => el.getClientRects().length && !el.closest('[aria-hidden="true"]'))
        .slice(0, 25);
      const bad = [];
      for (const el of focusable) {
        el.focus();
        if (document.activeElement !== el) continue;
        const style = getComputedStyle(el);
        /* Any of the three is enough: an outline, a ring drawn as a shadow,
           or a border that changes. The shadcn primitives use the middle
           one, so a test that only looked for an outline would fail every
           correctly-built control in the product. */
        const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const hasRing = style.boxShadow && style.boxShadow !== 'none';
        const cls = typeof el.className === 'string' ? el.className : '';
        const declaresRing = /focus-visible:(ring|outline|border|shadow)/.test(cls);
        if (!hasOutline && !hasRing && !declaresRing) {
          bad.push(el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\s+/)[0] : ''));
        }
      }
      return [...new Set(bad)];
    });
    if (invisibleFocus.length) {
      failures.push(`${route.name}: ${invisibleFocus.length} controls give no sign they are focused — ${invisibleFocus.slice(0, 5).join(', ')}`);
    }

    /* ── Tab actually moves ────────────────────────────────────────────
       A page where Tab does nothing is a page with a focus trap or a layer
       swallowing keys, and it is unusable rather than merely awkward. */
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.tagName ?? null);
    await page.keyboard.press('Tab');
    const second = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      isBody: document.activeElement === document.body,
    }));
    if (second.isBody && first === 'BODY') failures.push(`${route.name}: Tab does not reach anything`);

    /* ── 320px, the narrowest phone still in use ───────────────────────── */
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => Math.max(
      0, document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ));
    if (overflow > 2) failures.push(`${route.name}: ${overflow}px of horizontal overflow at 320px`);

    await ctx.close();
  }

  assert.deepEqual(failures, [], `accessibility findings:\n${failures.join('\n')}`);
});

test('the content editor can be typed into with the whole registry loaded', opts, async (t) => {
  if (skipReason) assert.fail(`performance gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(base)) return r.continue();
    if (r.request().method() === 'OPTIONS') {
      return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/rpc/')) return r.fulfill(json([]));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  await page.goto(`${base}/admin/app-content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const search = page.locator('input[type="text"], input:not([type])').first();
  await search.waitFor({ state: 'visible', timeout: 15000 });

  /*
   * A search over 4,773 keys AND their English text, on every keystroke, with
   * the result list re-rendered. This is the one screen in the product that
   * does real work per character, and "it feels fine on my laptop" is how a
   * search box that takes 400ms a letter ships.
   */
  const typed = await page.evaluate(async () => {
    const input = document.querySelector('input[type="text"], input:not([type])');
    if (!input) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const times = [];
    for (const term of ['v', 've', 'ver', 'veri', 'verif', 'verify']) {
      const started = performance.now();
      setter.call(input, term);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - started);
    }
    return times;
  });

  assert.ok(typed, 'the search box never rendered');
  const worst = Math.max(...typed);
  /*
   * 250ms is not a target, it is the point at which a person notices the
   * letters arriving late. The measurement is on an unthrottled headless
   * Chrome, so this is a floor rather than a promise about an old laptop —
   * what it catches is the accidental O(n²), not the last 20ms.
   */
  assert.ok(worst < 250, `a keystroke in the content search took ${Math.round(worst)}ms`);

  const rows = await page.locator('[data-content-key]').count();
  assert.ok(rows > 0 && rows <= 60,
    `the editor rendered ${rows} rows; the cap exists so four thousand textareas never reach the DOM`);
});

/* ── What a visitor downloads ──────────────────────────────────────────── */

test('the entry bundle is measured, and its size is a stated fact', () => {
  const dir = join(ROOT, 'dist', 'assets');
  if (!existsSync(dir)) {
    assert.fail('no build to measure — run: npm run build');
  }
  const entry = readdirSync(dir).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
  assert.equal(entry.length, 1, `expected one entry chunk, found ${entry.length}`);
  const bytes = statSync(join(dir, entry[0])).size;

  /*
   * A CEILING, NOT A TARGET.
   *
   * The entry chunk is large — around 5MB unzipped — and the dominant reason
   * is src/i18n/translations.ts: 2.26MB of source holding all six languages,
   * imported synchronously by LanguageContext so that t() can be a plain
   * function call. Every visitor downloads six languages to read one.
   *
   * That is worth fixing and it is not a small change: it turns a synchronous
   * lookup used by 4,773 keys into something that has to be loaded, which
   * reaches the App Content editor (which genuinely wants all six), the Site
   * Studio preview, the i18n gates and every test. Doing it at the end of a
   * release is how a release breaks.
   *
   * So this is a ratchet rather than a fix: the number is written down, and
   * the next change that makes it materially worse fails here instead of
   * being noticed in six months. Lower it when the work above is done.
   */
  const CEILING = 6 * 1024 * 1024;
  assert.ok(bytes < CEILING,
    `the entry chunk is ${(bytes / 1024 / 1024).toFixed(2)}MB, past the ${CEILING / 1024 / 1024}MB ceiling`);
});
