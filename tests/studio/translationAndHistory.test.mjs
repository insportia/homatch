// SITE STUDIO — SIX LANGUAGES, AND A WAY BACK.
//
// The two promises that are easiest to make and hardest to keep:
//
//   Editing one language never changes another's WORDS. It may only change
//   how they are described — "current" becomes "needs review" — and it may
//   put a machine's opinion BESIDE them. Those are different columns in the
//   model, and this drives the editor to prove they are different columns on
//   screen too.
//
//   Automatic translation will not overwrite what a person approved. It
//   proposes instead. That is the rule an admin has to be able to trust
//   before they will press a button labelled "translate everything", and a
//   unit test of the model is not where they will look for reassurance.
//
// And the way back: undo, redo, discard, in the browser, where the caret
// lives inside an iframe whose key events do not reach the editor's document.
//
// THE MODEL IS STUBBED, THE DECISIONS ARE NOT
//
// The edge function's reply is a fixture, so this test is about what the
// editor DOES with a translation — where it puts it, what it refuses to
// overwrite, what it shows. The wording a real model returns is not
// something a regression test can assert anyway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4334;
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

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

/** What the stubbed model "translates" everything to, so it is unmistakable. */
const MACHINE = 'ᲛᲐᲜᲥᲐᲜᲘᲡ ᲗᲐᲠᲒᲛᲐᲜᲘ';
const BY_HAND = 'ადამიანის ნაწერი';

async function boot(t) {
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

  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  const translateCalls = [];
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
    if (url.includes('/functions/v1/homatch-ai')) {
      translateCalls.push(r.request().postData() ?? '');
      // The client accepts a plain JSON {text} as well as an SSE stream; the
      // fixture uses the simpler one because the streaming is not under test.
      return r.fulfill(json({ text: MACHINE }));
    }
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rpc/')[1].split('?')[0];
      if (name === 'site_get_page') return r.fulfill(json({ page: null, versions: [] }));
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  return { page, errors, translateCalls };
}

const TITLE = '[data-hm-section="hero-1"][data-hm-field="title"]';

test('a translation is proposed beside the words, never on top of them', opts, async (t) => {
  if (skipReason) assert.fail(`translation gate could not run: ${skipReason}`);
  const { page, errors, translateCalls } = await boot(t);
  const frame = page.frameLocator('iframe').first();

  const pickLocale = async (label) => {
    await page.locator('button', { hasText: new RegExp(`^${label}$`) }).first().click();
    await page.waitForTimeout(1600);
  };
  const typeTitle = async (value) => {
    const el = page.frameLocator('iframe').first().locator(TITLE).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  };

  /* ── 1. Write it in English, then in Georgian ───────────────────────── */
  await typeTitle('Evidence before signature');
  await pickLocale('ქარ');
  await typeTitle(BY_HAND);
  assert.equal((await page.frameLocator('iframe').first().locator(TITLE).first().textContent()).trim(),
    BY_HAND, 'the Georgian edit did not take');

  /* ── 2. Revise the English. The Georgian WORDS must not change ──────── */
  await pickLocale('EN');
  assert.equal((await frame.locator(TITLE).first().textContent()).trim(),
    'Evidence before signature', 'the Georgian edit leaked into English');
  await typeTitle('Evidence before you sign');

  /*
   * Georgian is flagged, not rewritten. The dot carries the state in its
   * title, which is also what an admin hovers to find out.
   *
   * Scoped to the TITLE field's own block. The inspector draws one of these
   * dots per field, and `aside button[title^="ka:"]` first matched the
   * eyebrow's -- a field with no Georgian override, correctly reporting
   * itself as current, which read as the flag never being raised.
   */
  const titleField = page.locator('#f-title').locator('xpath=..');
  const kaDot = titleField.locator('button[title^="ka:"]').first();
  assert.match(await kaDot.getAttribute('title'), /Needs review/,
    'revising the source did not flag the translation that went stale');

  await pickLocale('ქარ');
  assert.equal((await page.frameLocator('iframe').first().locator(TITLE).first().textContent()).trim(),
    BY_HAND, 'revising English CHANGED the Georgian words');
  await pickLocale('EN');

  /* ── 3. Translate: a suggestion appears, and it is not the value ────── */
  await page.locator('#f-title').locator('xpath=..')
    .locator('button', { hasText: /Translate this field/ }).first().click();
  await page.waitForTimeout(4000);
  assert.ok(translateCalls.length > 0, 'nothing was asked of the translator');

  await pickLocale('ქარ');
  const inspector = page.locator('#f-title').locator('xpath=..');
  const shown = await inspector.textContent();
  assert.match(shown, /Suggestion/, 'the machine output is not presented as a suggestion');
  assert.match(shown, new RegExp(MACHINE), 'the suggestion was not shown');

  /* THE POINT: the page still says what the person wrote. */
  assert.equal((await page.frameLocator('iframe').first().locator(TITLE).first().textContent()).trim(),
    BY_HAND, 'the suggestion was written straight into the page');

  /* ── 4. Apply is a deliberate act, and then it IS the value ─────────── */
  await inspector.locator('button', { hasText: /^Apply$/ }).first().click();
  await page.waitForTimeout(1200);
  assert.equal((await page.frameLocator('iframe').first().locator(TITLE).first().textContent()).trim(),
    MACHINE, 'applying the suggestion did not change the page');

  assert.deepEqual(errors, [], 'the editor threw while translating');
});

test('undo, redo and discard reach an edit made on the page', opts, async (t) => {
  if (skipReason) assert.fail(`history gate could not run: ${skipReason}`);
  const { page, errors } = await boot(t);
  const frame = page.frameLocator('iframe').first();
  const title = () => frame.locator(TITLE).first().textContent().then((s) => s.trim());

  const typeTitle = async (value) => {
    const el = frame.locator(TITLE).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  };

  const original = await title();
  await typeTitle('First version');
  await typeTitle('Second version');
  assert.equal(await title(), 'Second version');

  /* ── Undo, from the toolbar ─────────────────────────────────────────── */
  const undo = page.locator('button[aria-label="Undo"], button[title="Undo"]').first();
  await undo.click();
  await page.waitForTimeout(900);
  assert.equal(await title(), 'First version', 'undo did not step back one edit');

  await undo.click();
  await page.waitForTimeout(900);
  assert.equal(await title(), original, 'undo did not reach the state before any edit');

  /* ── Redo ───────────────────────────────────────────────────────────── */
  const redo = page.locator('button[aria-label="Redo"], button[title="Redo"]').first();
  await redo.click();
  await page.waitForTimeout(900);
  assert.equal(await title(), 'First version', 'redo did not step forward');

  /*
   * ── Ctrl+Z with the caret INSIDE the preview ──────────────────────────
   *
   * The caret lives in the iframe's document, whose key events reach that
   * document and stop. Pressing Ctrl+Z while looking at the page did nothing
   * at all until the preview started forwarding them.
   */
  await typeTitle('Third version');
  await frame.locator('[data-studio-section="hero-1"]').first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  assert.equal(await title(), 'First version',
    'Ctrl+Z pressed over the preview never reached the editor');

  /* ── Discard: back to what the server last gave us ───────────────────── */
  await typeTitle('About to be thrown away');
  page.once('dialog', (d) => d.accept());
  await page.locator('button', { hasText: /^Discard$/ }).first().click();
  await page.waitForTimeout(1500);
  assert.equal(await title(), original,
    'discard did not return the page to its last saved state');

  assert.deepEqual(errors, [], 'the editor threw while stepping through history');
});
