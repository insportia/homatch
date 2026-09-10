// REAL viewport mobile regression for the Verification report.
//
// WHY THIS EXISTS RATHER THAN A DOM MEASUREMENT
//
// Overflow was previously checked by shrinking an <article> inside a
// 1920px-wide page and measuring scrollWidth. That is not a mobile test: the
// viewport is still 1920, so every `sm:` and `md:` rule stays active and the
// layout under test is the DESKTOP one squeezed into a narrow box. It can
// report failures that never happen on a phone and, worse, pass things that
// do.
//
// This drives a real Chrome at a real viewport, so media queries resolve the
// way they resolve on the device. The backend is stubbed, so the test needs
// no session, no network and no production data, and it is deterministic.
//
// The fixture is deliberately adversarial (see fixture.mjs): 26-character
// cadastral codes, 45-character unbroken Georgian and Russian compounds, long
// portal URLs inside the evidence drawer, wide matrices and comparables
// tables. Those are the inputs that actually break narrow layouts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { SYNTHESIS, STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

/** Real devices, narrowest first. 320 is the floor we support. */
const WIDTHS = [320, 360, 375, 390, 430];
/**
 * Chrome is DISCOVERED, not hardcoded to one machine's install path.
 * playwright-core downloads no browsers; it drives the Chrome already here.
 */
function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}
const PREVIEW_PORT = 4319;
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;
/** Matches the VITE_SUPABASE_URL the harness build is given. */
const STUB_SUPABASE = 'https://stubproj.supabase.co';

/**
 * playwright-core is resolved from the project OR from a path in
 * PLAYWRIGHT_CORE_PATH, so a machine can supply the driver without the repo
 * taking a heavy devDependency that CI may not want to install.
 */
function resolvePlaywright() {
  // In order of preference: a real dependency if one is ever added, the
  // provisioned .tooling/ directory (npm run test:mobile:setup), then an
  // explicit override. No hidden machine state is required for any of them.
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next */ }
  }
  return null;
}

function haveDeps() {
  // Every skip reason names the exact command that fixes it. A suite that
  // skips for an unexplained reason is a suite nobody ever turns back on.
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME to its path';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) {
    return 'no build in dist/ — run: npm run build:harness';
  }
  /*
   * dist/ must be the HARNESS build specifically.
   *
   * A normal `npm run build` overwrites dist/ with a bundle pointing at the
   * real backend, and the stubs then intercept nothing — the page renders
   * signed out with no report and the suite fails for a reason that has
   * nothing to do with layout. Detect that and say which command fixes it,
   * rather than reporting a false overflow failure.
   */
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
/*
 * Pass the option ONLY when actually skipping.
 *
 * `{ skip: null }` still marks the test as skipped in the reporter, so the
 * run counted pass 0 / fail 0 / skipped 1 while the body was really
 * executing and asserting. A gate that reports neither pass nor fail is
 * worse than no gate: it looks green and proves nothing.
 */
const opts = skipReason ? { skip: skipReason } : {};

/** A session shaped the way supabase-js persists it, so the app boots signed in. */
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp,
    email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

test('the verification report has no horizontal overflow at real phone widths', opts, async (t) => {
  const { chromium } = resolvePlaywright();

  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore', shell: process.platform === 'win32' }
  );

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  t.after(async () => {
    await browser.close().catch(() => {});
    preview.kill();
  });

  // Wait for the preview server rather than sleeping a fixed amount.
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const failures = [];

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
      isMobile: width <= 430,
      hasTouch: width <= 430,
    });

    await ctx.addInitScript(
      ([key, session]) => {
        // supabase-js v2 stores the session object itself under this key.
        // The v1 { currentSession } envelope is ignored, which is why the
        // harness first rendered signed out.
        window.localStorage.setItem(key, JSON.stringify(session));
      },
      ['sb-stubproj-auth-token', fakeSession()]
    );

    const page = await ctx.newPage();
    const json = (body) => ({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

    /*
     * ONE handler, not two.
     *
     * Playwright matches routes in REVERSE registration order, so a '**'
     * catch-all registered after a specific pattern silently shadows it —
     * which is exactly how the first version of this harness recorded zero
     * backend calls and rendered a signed-out page.
     */
    await page.route('**', async (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE)) return route.continue();
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/functions/v1/verify-synthesis')) return route.fulfill(json(SYNTHESIS));
      if (url.includes('/functions/v1/research-agent')) return route.fulfill(json(STATUS_RESPONSE));
      if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/')) return route.fulfill(json([]));
      // Anything unanticipated is answered emptily rather than reaching the
      // network, so the test can never depend on the outside world.
      return route.fulfill(json({}));
    });

    await page.goto(`${BASE}/verify?job=fixture-job`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article', { timeout: 20000 }).catch(() => {});

    // Open the evidence drawer — the reported offender lives inside it.
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
    });
    await page.waitForTimeout(600);

    const result = await page.evaluate((vw) => {
      const de = document.documentElement;
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const s = getComputedStyle(el);
        // An element that scrolls on purpose is a solution, not a defect.
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
        if (r.right > vw + 1 || r.left < -1) {
          offenders.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 60),
            right: Math.round(r.right),
            left: Math.round(r.left),
            text: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
      return {
        hasArticle: !!document.querySelector('article'),
        pageOverflow: de.scrollWidth > de.clientWidth,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        // Only the innermost offenders: a wide parent is usually a symptom.
        offenders: offenders.slice(0, 8),
      };
    }, width);

    await ctx.close();

    assert.ok(result.hasArticle, `${width}px: the report never rendered — the harness stubs are wrong`);
    if (result.pageOverflow || result.offenders.length) {
      failures.push(`${width}px: scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth}\n` +
        result.offenders.map((o) => `    ${o.tag}.${o.cls} right=${o.right} "${o.text}"`).join('\n'));
    }
  }

  assert.deepEqual(failures, [], `horizontal overflow at real phone widths:\n${failures.join('\n')}`);
});
