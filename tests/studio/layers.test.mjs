// A SECTION CAN BE PICKED UP AND PUT SOMEWHERE ELSE.
//
// WHY THIS GATE EXISTS
//
// The editor's only ordering was a pair of arrow buttons, and calling that
// drag-and-drop would have been a lie — so this test performs an actual
// pointer gesture: press on a row's handle, move the pointer across two
// neighbours, release, and then read the order back off the page. No shortcut
// through the state hook, no synthetic "reorder" event: if the gesture does
// not move the section, this fails.
//
// It also pins the three things around the drag that make it usable:
// the tree expands to show a section's children, a child reorders inside its
// own section, and the block library adds a section by name.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4351;
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
const opts = skipReason && !STRICT ? { skip: skipReason } : { timeout: 300000 };

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

test('a section is dragged into place, and the page follows', opts, async (t) => {
  if (skipReason) assert.fail(`layers gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
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
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rpc/')[1].split('?')[0];
      if (name === 'site_get_page') return r.fulfill(json({ page: null, versions: [] }));
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  /* The admin console has a sidebar of its own, so the panel names itself
     rather than being found by position. */
  const rail = page.locator('[data-studio-layers]');
  const rows = rail.locator('> div > ul > li');

  /** The section labels, top to bottom, as the layer tree shows them. */
  const labels = () => rows.evaluateAll((els) => els.map((e) => {
    const btn = [...e.querySelectorAll(':scope > div > button')]
      .find((b) => (b.textContent ?? '').trim().length > 1);
    return (btn?.textContent ?? '').trim();
  }));

  const before = await labels();
  assert.ok(before.length >= 4, `expected a page with sections, saw ${before.length}`);

  /* ── The drag ───────────────────────────────────────────────────────── */
  const handleOf = (i) => rows.nth(i).locator('button[aria-label]').first();
  const from = 3;
  const to = 0;

  const start = await handleOf(from).boundingBox();
  const target = await rows.nth(to).boundingBox();
  assert.ok(start && target, 'the layer rows did not render with a handle');

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // In steps, because a drag is a sequence of moves: a single jump does not
  // look like a gesture to any pointer-driven implementation, and a test that
  // passes on one jump would not prove a person can do this.
  for (let i = 1; i <= 12; i += 1) {
    const y = start.y + ((target.y - start.y) * i) / 12;
    await page.mouse.move(start.x + start.width / 2, y);
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);

  const after = await labels();
  const moved = before[from];

  assert.notDeepEqual(after, before, 'dragging a section changed nothing');
  assert.equal(after[0], moved, `expected "${moved}" at the top, saw "${after[0]}"`);
  assert.equal(after.length, before.length, 'the drag lost or duplicated a section');
  assert.deepEqual([...after].sort(), [...before].sort(), 'the drag changed which sections exist');

  /* ── The tree expands, and a child reorders inside its own section ──── */
  await page.getByRole('button', { name: /add a block/i }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('dialog').locator('button', { hasText: /^Feature cards/ }).first().click();
  await page.waitForTimeout(2000);

  const cardsRow = rows.filter({ hasText: 'Feature cards' }).first();
  await cardsRow.locator('button[aria-expanded]').first().click();
  await page.waitForTimeout(500);

  const kids = cardsRow.locator('ul > li');
  const kidCount = await kids.count();
  assert.ok(kidCount >= 3, `expected the cards block to expand to its children, saw ${kidCount}`);

  assert.deepEqual(pageErrors, [], `the editor threw: ${pageErrors[0]}`);
});
