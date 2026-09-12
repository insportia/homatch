// EVERY CUSTOMER ROUTE ACTUALLY WORKS.
//
// Not "does it overflow" — routeOverflow.test.mjs owns that. This asks the
// blunter question nothing was asking: does the screen come up at all, does
// it have a name, and does it ever stop loading.
//
// It was written because rendering all twenty-four routes found three that
// were completely dead — Email Campaigns, SMS Campaigns and the AI Call
// Center all showed "An application error has occurred" and nothing else.
// The cause was one optional chain that stopped one level too early
// (`providerStatus?.email.real`), so a provider-status payload without that
// key took the whole page down. It type-checked, it linted, and 1,739 unit
// tests passed.
//
// It also found the opposite failure: screens that never finish loading. Most
// pages behind the auth guard start their fetch with `if (!homatchUser)
// return;` and clear their loading flag in that fetch's `finally`. For an
// account whose profile row is missing or unreadable, the fetch never starts,
// the finally never runs, and the page sits on a skeleton for ever — no
// content, no empty state, no error, no way out.
//
// A SIGNED-IN CUSTOMER WITH AN EMPTY ACCOUNT
//
// The stub answers the profile query with a real row and every other query
// with nothing, which is exactly a new customer on their first day. That is
// the state where empty states are supposed to speak, and the state in which
// a screen that renders nothing is a defect rather than a shrug.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4343;
const BASE = `http://127.0.0.1:${PORT}`;

const ROUTES = [
  '/', '/about', '/pricing', '/mortgage',
  '/dashboard', '/ai', '/credits', '/profile', '/activity', '/notifications',
  '/viewings', '/active-search', '/verify', '/property/add',
  '/outreach', '/outreach/email', '/outreach/calls', '/outreach/sms',
  '/outreach/communities', '/outreach/contact-lists', '/outreach/insights',
  '/deal-rooms', '/chat', '/live-chat',
];

/* What the error boundary says when a screen has died. */
const BOUNDARY = /An application error has occurred|Something went wrong on our side/i;

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

/* A real customer with a real profile and nothing in their account yet. */
const PROFILE = {
  id: 'u1', auth_id: 'u1', email: 'harness@example.test',
  is_admin: false, preferred_language: 'en', full_name: 'Harness User',
  created_at: new Date().toISOString(),
};

test('every customer route renders, is named, and finishes loading', opts, async (t) => {
  if (skipReason) assert.fail(`route health gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    if (url.includes('/rest/v1/users')) return r.fulfill(json(PROFILE));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  let thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e).slice(0, 200)));

  const failures = [];

  for (const route of ROUTES) {
    thrown = [];
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    // Long enough for the first data pass to settle, so a skeleton that is
    // still on screen afterwards is a skeleton that is never coming off.
    await page.waitForTimeout(3000);

    const state = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = (main ?? document.body).innerText.trim();
      return {
        h1s: document.querySelectorAll('h1').length,
        mainText: text,
        mainChars: text.length,
        // A skeleton with no words next to it is a page still waiting.
        pulses: document.querySelectorAll('[class*="animate-pulse"]').length,
        title: document.querySelector('h1')?.textContent?.trim().slice(0, 40) ?? null,
      };
    });

    if (thrown.length) {
      failures.push(`${route}: threw — ${thrown[0]}`);
    }
    if (BOUNDARY.test(state.mainText)) {
      failures.push(`${route}: died into the error boundary`);
    }
    /* One h1 per screen. Zero means nothing names the page — for a screen
       reader there is nothing to land on, and it is usually a symptom of the
       page not having rendered at all. */
    if (state.h1s !== 1) {
      failures.push(`${route}: has ${state.h1s} <h1> elements, expected exactly 1`);
    }
    /* A page that has finished loading says SOMETHING, even when the account
       is empty — that is what an empty state is for. */
    if (state.mainChars < 40) {
      failures.push(`${route}: rendered ${state.mainChars} characters of content — "${state.mainText}"`);
    }
    if (state.pulses > 0 && state.mainChars < 120) {
      failures.push(`${route}: still showing ${state.pulses} loading placeholders after 3s`);
    }
  }

  /* A stale link must say so rather than silently becoming the home page. */
  await page.goto(`${BASE}/this-route-does-not-exist`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const notFound = await page.evaluate(() => ({
    path: window.location.pathname,
    text: document.querySelector('main')?.innerText ?? '',
  }));
  if (notFound.path !== '/this-route-does-not-exist') {
    failures.push(`an unknown route redirected to ${notFound.path} instead of saying it does not exist`);
  }
  if (!/does not exist/i.test(notFound.text)) {
    failures.push('an unknown route did not explain that the page is not there');
  }

  assert.deepEqual(failures, [], `customer routes:\n  ${failures.join('\n  ')}`);
});
