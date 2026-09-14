// APP CONTENT — the copy Site Studio cannot reach, driven in a real browser.
//
// The unit tests beside src/i18n/appContent.ts hold the rules: an override
// can only add, a lost placeholder is refused, a group is derived from the
// key. All of that is true of functions. None of it says whether a person can
// find one string among 4,773 and change it.
//
// This does. It opens the editor the way an admin does, searches for a
// sentence by what it SAYS rather than by what it is called, types a
// replacement, and checks three things a unit test cannot see:
//
//   - the replacement was SENT, as an app_content_set call carrying the key,
//     the locale and the words, and nothing else;
//   - the refusal of a lost placeholder reaches the admin's eyes and disables
//     the control, rather than being a return value nobody renders;
//   - clearing the field sends the empty value that puts the original back,
//     instead of storing a blank string that would render an empty heading.
//
// The harness build points at a stub origin and every request is intercepted,
// so nothing here reaches a server.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4336;
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

test('an admin can find one string among thousands and replace it', opts, async (t) => {
  if (skipReason) assert.fail(`app content gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  /* Every write, with its arguments. The point of recording the body rather
     than the call name is that "it saved" and "it saved the right string in
     the right language" are different claims. */
  const writes = [];
  let stored = [];

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
      if (name === 'app_content_all') return r.fulfill(json(stored));
      if (name === 'app_content_set') {
        let body = {};
        try { body = JSON.parse(r.request().postData() ?? '{}'); } catch { /* recorded as {} */ }
        writes.push(body);
        const cleared = !String(body.p_value ?? '').trim();
        /* Behave like the function: a cleared value deletes the row. */
        stored = stored.filter(row => !(row.key === body.p_key && row.locale === body.p_locale));
        if (!cleared) {
          stored = [...stored, {
            key: body.p_key, locale: body.p_locale, value: body.p_value,
            updated_at: new Date().toISOString(), updated_by: 'Admin',
          }];
        }
        return r.fulfill(json({ key: body.p_key, locale: body.p_locale, cleared }));
      }
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/app_content')) return r.fulfill(json([]));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  await page.goto(`${BASE}/admin/app-content`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  /* ── Found by what it says ───────────────────────────────────────────
     The sentence, not the key. This is the whole reason the surface is a
     search box: `notif_cat_viewings` is not a thing anybody remembers. */
  const search = page.locator('input[type="text"], input:not([type])').first();
  await search.fill('Viewing requests');
  await page.waitForTimeout(700);

  const card = page.locator('[data-content-key="notif_cat_viewings"]');
  assert.equal(await card.count(), 1, 'searching the English text did not find the string');

  /* ── A replacement is sent, once, with the right three things ──────── */
  await card.locator('textarea').fill('Requests to view your property');
  await card.locator('button', { hasText: 'Save' }).click();
  await page.waitForTimeout(1200);

  assert.equal(writes.length, 1, `expected one write, got ${writes.length}`);
  assert.deepEqual(writes[0], {
    p_key: 'notif_cat_viewings',
    p_locale: 'en',
    p_value: 'Requests to view your property',
  }, 'the write did not carry exactly the key, the locale and the words');

  /* And the row now says so, rather than the screen claiming success and
     showing the old state. */
  await page.waitForTimeout(500);
  const badges = await page.locator('text=Replaced').count();
  assert.ok(badges >= 1, 'the row does not show that it has been replaced');

  /* ── A lost placeholder is refused where the admin can see it ──────── */
  await search.fill('{{n}} strings');
  await page.waitForTimeout(700);
  const holed = page.locator('[data-content-key="app_content_matches"]');
  assert.equal(await holed.count(), 1, 'the placeholder string was not found');

  await holed.locator('textarea').fill('lots of strings');
  await page.waitForTimeout(400);

  const holeSave = holed.locator('button', { hasText: 'Save' });
  assert.equal(await holeSave.isDisabled(), true,
    'a replacement that drops {{n}} can be saved');
  const complaint = await page.locator('text=/drops/').count();
  assert.ok(complaint >= 1, 'nothing on screen says why it cannot be saved');

  const before = writes.length;
  await page.waitForTimeout(300);
  assert.equal(writes.length, before, 'a refused replacement still reached the server');

  /* ── Clearing sends empty, which is how the original comes back ────── */
  await search.fill('Viewing requests');
  await page.waitForTimeout(700);
  const reset = page.locator('[data-content-key="notif_cat_viewings"]').locator('button', { hasText: 'Reset' });
  assert.equal(await reset.count(), 1, 'a replaced string offers no way back');
  await reset.click();
  await page.waitForTimeout(1200);

  const last = writes[writes.length - 1];
  assert.equal(last.p_key, 'notif_cat_viewings');
  assert.equal(String(last.p_value ?? '').trim(), '',
    'Reset stored a blank string instead of asking for the override to be removed');

  assert.deepEqual(pageErrors, [], `the editor threw:\n${pageErrors.join('\n')}`);
});
