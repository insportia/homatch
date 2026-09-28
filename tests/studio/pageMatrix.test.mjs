// SITE STUDIO — EVERY SELECTABLE PAGE OPENS A REAL EDITOR.
//
// The bug this pins down: pages whose shipped composition is CODE plus an
// additive content band (Partners, Mortgage, Privacy, Terms, Verify, Expat,
// Contact) have an EMPTY default section order, so an unedited page used to
// render the canvas as a silent white rectangle. That reads as "the editor
// is broken", and nothing said otherwise.
//
// The contract now: for EVERY page in the Admin page selector, the canvas
// shows either the page's sections or the explicit "no content blocks yet"
// state. A blank canvas fails this gate, for every slug, in every future.

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

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
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

/** The selector's own list, read from the one source it renders from. */
function editableSlugs() {
  const src = readFileSync(join(ROOT, 'src', 'services', 'siteContent.ts'), 'utf8');
  const list = src.slice(src.indexOf('EDITABLE_PAGES'), src.indexOf('SitePageRecord'));
  return [...list.matchAll(/slug: '([a-z]+)'/g)].map((m) => m[1]);
}

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

test('every page in the Studio selector opens sections or the explicit empty state', opts, async (t) => {
  if (skipReason) assert.fail(`page matrix gate could not run: ${skipReason}`);

  const slugs = editableSlugs();
  assert.ok(slugs.includes('home') && slugs.includes('about') && slugs.includes('contact'),
    `the selector list looks wrong: ${slugs.join(', ')}`);

  const { chromium } = resolvePlaywright();
  const server = spawn(
    'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });

  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

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
      /* No stored content for ANY page: the exact state that used to blank
         the canvas for the band pages. */
      if (name === 'site_get_page') return r.fulfill(json({ page: null, versions: [] }));
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const frame = page.frameLocator('iframe').first();

  const failures = [];
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    if (i > 0) {
      /* Drive the real page picker, exactly as an admin does. */
      await page.getByRole('combobox').first().click();
      await page.waitForTimeout(300);
      await page.getByRole('option').nth(i).click();
      await page.waitForTimeout(2500);
    }

    const sections = await frame.locator('[data-studio-section]').count()
      .catch(() => 0);
    const emptyState = await frame.getByText(/no content blocks yet/i).count()
      .catch(() => 0);

    if (sections === 0 && emptyState === 0) {
      failures.push(`${slug}: the canvas rendered neither sections nor the empty state — the blank white editor is back`);
    }
    /* Shell is not a route; every other page renders section chrome or the
       stated empty band. Either way, never silence. */
  }

  assert.deepEqual(failures, []);
  assert.deepEqual(pageErrors, [], 'the editor threw while switching pages');
});
