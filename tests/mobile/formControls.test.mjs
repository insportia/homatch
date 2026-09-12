// EVERY FORM CONTROL A CUSTOMER CAN REACH, MEASURED ON A PHONE.
//
// Four properties, each of which was broken somewhere when this was written:
//
//   SIZE      Under 16px, Safari zooms the page when the field is focused —
//             and does not zoom back out when it is blurred. One tap on one
//             small field leaves the customer on a magnified, sideways
//             scrolling page for the rest of the session.
//
//   TARGET    A fingertip needs about 44px. A mis-tap in a form is worse than
//             a mis-tap on a link, because it lands in a DIFFERENT FIELD and
//             several words get typed before anyone notices.
//
//   KEYBOARD  `type="number"` does not summon a numeric keypad on iOS; it
//             shows the full keyboard with a number row. inputmode does.
//
//   LABEL     A field with no accessible name is unusable with a screen
//             reader and unreadable in a form autofill prompt.
//
// The bug this found that no amount of reading would have: a search field
// carrying `flex-1` inside a container that is `flex-col` until sm. flex-1
// sets flex-basis on the MAIN axis, which on a phone is the VERTICAL one, so
// it overrode the field's height and collapsed it to 32px. The class looked
// completely ordinary, and it was correct from sm upwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4337;
const BASE = `http://127.0.0.1:${PORT}`;

/* Every customer route that carries, or can carry, a form. */
const ROUTES = [
  '/', '/about', '/pricing', '/mortgage',
  '/auth/login', '/auth/signup', '/auth/reset-password',
  '/dashboard', '/ai', '/credits', '/profile', '/activity', '/notifications',
  '/viewings', '/active-search', '/verify', '/property/add',
  '/outreach', '/outreach/email', '/outreach/calls', '/deal-rooms',
];

/** Names that mean "this field takes digits". */
const NUMERIC_NAME = /price|amount|budget|phone|tel|zip|postal|year|size|area|rooms/i;

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

test('every form control is typeable, tappable, labelled and asks for the right keyboard', opts, async (t) => {
  if (skipReason) assert.fail(`form control gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const json = (b) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
  });
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

  const failures = [];
  let measured = 0;

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const controls = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('input, textarea, select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;

        const type = el.getAttribute('type') || el.tagName.toLowerCase();
        // Controls whose size and keyboard are not the browser's text input:
        // a checkbox is meant to be small, a file input opens a picker.
        if (['hidden', 'checkbox', 'radio', 'range', 'file', 'color'].includes(type)) continue;

        const id = el.id;
        out.push({
          type,
          fontSize: parseFloat(cs.fontSize),
          height: Math.round(r.height),
          inputMode: el.getAttribute('inputmode'),
          name: el.getAttribute('name') || el.getAttribute('placeholder') || el.id || '(unnamed)',
          labelled: Boolean(
            el.getAttribute('aria-label')
            || el.getAttribute('aria-labelledby')
            || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
            || el.closest('label')
            || el.getAttribute('placeholder'),
          ),
        });
      }
      return out;
    });

    for (const c of controls) {
      measured += 1;
      const at = `${route} <${c.type}> "${c.name}"`;
      if (c.fontSize < 16) {
        failures.push(`${at}: text is ${c.fontSize}px; iOS zooms below 16px and never zooms back`);
      }
      if (c.height < 40) {
        failures.push(`${at}: only ${c.height}px tall; a fingertip needs about 44`);
      }
      if (!c.labelled) failures.push(`${at}: has no accessible name`);
      if ((c.type === 'number' || NUMERIC_NAME.test(c.name)) && !c.inputMode) {
        failures.push(`${at}: takes digits but declares no inputmode, so iOS shows letters`);
      }
    }
  }

  /* Coverage first: a clean run that measured nothing proves nothing. The
     floor is a literal so that shrinking ROUTES cannot shrink the guard. */
  assert.ok(measured >= 12, `the gate only found ${measured} form controls across ${ROUTES.length} routes`);
  assert.deepEqual(failures, [], `form controls on a phone:\n  ${failures.join('\n  ')}`);
});
