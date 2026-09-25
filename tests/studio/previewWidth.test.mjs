// SITE STUDIO — THE DESKTOP PREVIEW MUST BE A DESKTOP.
//
// WHY THIS FILE EXISTS
//
// StudioPreview has carried the invariant in a comment since it was written:
//
//   "at a 1920px browser the frame gets 1040px, and the site's lg breakpoint
//    is 1024. Widening the left panel by two rem put the frame at 1008 and
//    silently turned the desktop preview into the tablet one. Anything added
//    to either side panel has to be checked against that number."
//
// Sixteen pixels of headroom, and the check was a sentence asking a human to
// remember. On 2026-09-24 the admin sidebar went from w-56 to lg:w-72 to stop
// "Properties & matching" truncating — +64px, in a different file, by someone
// who had never read that comment. 1040 - 64 = 976, and the desktop preview
// quietly became the tablet preview: the site's desktop navigation stopped
// rendering, so an owner on a large monitor could not click the navigation
// labels they had opened Site Studio to edit.
//
// Nothing failed loudly. blocks.test.mjs failed, which is how it was found —
// four days and thirty red deploy runs later, because Validate gates the edge
// deployment and nobody reads a pipeline that fails for someone else's reason.
//
// So the sentence is a test now. It asserts the MEASUREMENT, not the layout:
// any arrangement that leaves the desktop preview able to render a desktop is
// acceptable, and any that does not fails here rather than three files away.
//
// WHAT IT DOES NOT ASSERT
//
// A specific width, a specific panel arrangement, or that the sidebar is
// hidden. Those are design decisions and they are allowed to change. The
// breakpoint is not: it belongs to the site being previewed.

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

/** The site's own `lg` breakpoint. Below this it is not a desktop. */
const DESKTOP_BREAKPOINT = 1024;

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
/* In CI a missing prerequisite is a FAILURE, never a silent pass. */
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

test('the desktop preview can render a desktop, at every desktop window size', opts, async (t) => {
  if (skipReason) assert.fail(`preview width gate could not run: ${skipReason}`);

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

  /*
   * Three real desktop window sizes. 1920 is the one the original comment
   * measured; 1440 is the commonest laptop; 1280 is the narrowest thing a
   * person would call a desktop, and the honest place for this to be tight.
   */
  const failures = [];
  for (const width of [1280, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1080 } });
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
      if (url.includes('/rest/v1/rpc/')) {
        const name = url.split('/rpc/')[1].split('?')[0];
        if (name === 'site_get_page') return r.fulfill(json({ page: null, versions: [] }));
        return r.fulfill(json(null));
      }
      if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
      if (url.includes('/rest/v1/site_pages')) return r.fulfill(json(null));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    /*
     * The frame's OWN viewport, not its size on screen.
     *
     * Those are different numbers as soon as the preview is scaled to fit,
     * and only the first one decides anything: media queries, `sizes` and
     * every breakpoint in the site read the frame's innerWidth. Measuring the
     * on-screen box would fail a preview that is rendering a perfectly
     * correct desktop slightly smaller, and pass one that fills the pane
     * while rendering a tablet.
     */
    const viewport = await page.frameLocator('iframe').first()
      .locator('body')
      .evaluate((b) => b.ownerDocument.defaultView.innerWidth)
      .catch(() => 0);
    if (!viewport) { failures.push(`${width}: no preview frame`); await ctx.close(); continue; }
    if (viewport < DESKTOP_BREAKPOINT) {
      failures.push(`${width}px window -> ${viewport}px preview viewport (needs ${DESKTOP_BREAKPOINT})`);
    }

    /*
     * And it has to FIT: a desktop viewport the admin has to scroll sideways
     * to reach is the trade this editor already rejected once. Whatever the
     * frame does, its rendered width may not exceed the pane it sits in.
     */
    const box = await page.locator('iframe').first().boundingBox();
    const pane = await page.locator('iframe').first()
      .evaluate((el) => el.parentElement?.getBoundingClientRect().width ?? 0)
      .catch(() => 0);
    if (box && pane && box.width > pane + 2) {
      failures.push(`${width}px window -> preview ${Math.round(box.width)}px overflows its ${Math.round(pane)}px pane`);
    }

    /*
     * And the consequence, rather than only the number.
     *
     * The site's global chrome is edited on its own page, so open it and look
     * for the DESKTOP navigation label — the thing an owner opens this editor
     * to rename. A width that satisfies the arithmetic and still leaves that
     * label unrendered has not fixed anything, which is exactly the state
     * this file exists to catch.
     */
    await page.locator('[role="combobox"]').first().click();
    await page.waitForTimeout(500);
    await page.locator('[role="option"]', { hasText: /Header & footer/ }).first().click();
    await page.waitForTimeout(5000);

    const navVisible = await page
      .frameLocator('iframe').first()
      .locator('[data-hm-section^="site_header"][data-hm-field="nav_verify"]:visible')
      .count()
      .catch(() => 0);
    if (navVisible === 0) failures.push(`${width}px window -> no editable desktop navigation on screen`);

    await ctx.close();
  }

  assert.deepEqual(failures, [], `the desktop preview is not a desktop:\n  ${failures.join('\n  ')}`);
});
