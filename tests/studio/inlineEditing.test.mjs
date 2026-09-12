// SITE STUDIO — the editor, driven in a real browser.
//
// The unit guards next to the components assert how the files are WRITTEN.
// This asserts what actually happens when an admin clicks: whether the text
// under the cursor can be edited, whether a paste can smuggle markup into the
// draft, whether "add below" produces a block anybody can see.
//
// Every assertion below corresponds to a defect this gate found, each of
// which type-checked, linted and passed every other test:
//
//   - the click-to-select overlay covered the text, so click-to-edit could
//     never receive a click at all
//   - the edit layer searched for the text as it was BEFORE the last edit,
//     so a field became uneditable after being edited once
//   - a newly added block rendered zero pixels tall, so "add below" appeared
//     to do nothing
//   - the preview iframe had no doctype, so it rendered in quirks mode and
//     scrollIntoView silently did nothing
//
// WHY STUBBING THE ADMIN PROFILE IS NOT WEAKENING AUTHORIZATION
//
// The harness build points at a stub origin and every request is intercepted,
// so nothing here reaches a server. The client asks "is this user an admin"
// and the stub answers yes — exactly as it answers every other question. The
// real authorization lives in RLS and in the site_* functions' own checks,
// which are untouched, unreached, and covered by their own tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4331;
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
/* In CI a missing prerequisite is a FAILURE, never a silent pass: a workflow
   that skips its only editor gate reports green while proving nothing. */
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u-auth-1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u-auth-1', aud: 'authenticated', role: 'authenticated',
      email: 'admin@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

const ADMIN = {
  id: 'u1', auth_id: 'u-auth-1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
};

test('Site Studio edits the page in place, and cannot be made to store markup', opts, async (t) => {
  if (skipReason) assert.fail(`studio gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const json = (b) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
  });

  /* Every RPC the editor calls, recorded — so the test can assert that
     nothing published, saved or otherwise reached the backend. */
  const rpcCalls = [];
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
      rpcCalls.push(name);
      if (name === 'site_get_page') return r.fulfill(json({ page: null, versions: [] }));
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  assert.equal(await page.locator('iframe').count(), 1, 'the studio did not mount a preview');
  const frame = page.frameLocator('iframe').first();

  /* The preview must be a faithful copy of the real page, which means a real
     document. Quirks mode changes layout AND breaks programmatic scrolling. */
  const compat = await frame.locator('body').evaluate((el) => el.ownerDocument.compatMode);
  assert.equal(compat, 'CSS1Compat', 'the preview document is in quirks mode');

  const sections = await frame.locator('[data-studio-section]').count();
  assert.ok(sections >= 8, `expected the home page sections, saw ${sections}`);

  /* ── Click a section in the page; it selects, and its controls appear ── */
  const target = frame.locator('[data-studio-section]').nth(1);
  const targetId = await target.getAttribute('data-studio-section');
  await target.click({ position: { x: 40, y: 30 } });
  await page.waitForTimeout(1200);

  assert.equal(await frame.locator('[role="toolbar"]').count(), 1,
    'selecting a section did not produce its controls');

  /* ── The text under the cursor is editable, in place ── */
  const fields = frame.locator(`[data-studio-section="${targetId}"] [data-studio-field]`);
  const fieldCount = await fields.count();
  assert.ok(fieldCount >= 2, `expected editable fields, found ${fieldCount}`);

  const first = fields.first();
  const fieldName = await first.getAttribute('data-studio-field');
  assert.equal(await first.getAttribute('contenteditable'), 'plaintext-only');

  await first.click();
  await page.waitForTimeout(250);
  assert.ok(await first.evaluate((el) => el.ownerDocument.activeElement === el),
    'clicking the text did not put the caret in it — is something covering the section?');

  await page.keyboard.press('Control+A');
  await page.keyboard.type('Edited in place');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);

  const sel = `[data-studio-section="${targetId}"] [data-studio-field="${fieldName}"]`;
  assert.equal((await frame.locator(sel).textContent()).trim(), 'Edited in place',
    'the edit did not reach the draft and come back through the model');

  /* And the field is STILL editable afterwards — the regression that made an
     edited field impossible to edit a second time. */
  assert.equal(await frame.locator(sel).getAttribute('contenteditable'), 'plaintext-only',
    'the field stopped being editable after one edit');

  /* ── A paste carrying markup must land as text ── */
  const second = fields.nth(1);
  const secondName = await second.getAttribute('data-studio-field');
  await second.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await second.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<img src=x onerror="window.pwned=1"><b>bold</b>');
    dt.setData('text/plain', 'bold');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.keyboard.type('Plain only');
  await second.evaluate((el) => el.blur());
  await page.waitForTimeout(800);

  const sel2 = `[data-studio-section="${targetId}"] [data-studio-field="${secondName}"]`;
  assert.equal(await frame.locator(`${sel2} img`).count(), 0, 'a pasted <img> reached the page');
  assert.equal(await frame.locator(`${sel2} b`).count(), 0, 'pasted markup reached the page');
  assert.match(await frame.locator(sel2).innerHTML(), /^[^<>]*$/, 'the field contains markup');

  /* ── Escape abandons ── */
  const third = fields.nth(fieldCount - 1);
  const thirdName = await third.getAttribute('data-studio-field');
  const thirdBefore = (await third.textContent()).trim();
  await third.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('THIS SHOULD BE ABANDONED');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const thirdSel = `[data-studio-section="${targetId}"] [data-studio-field="${thirdName}"]`;
  assert.equal((await frame.locator(thirdSel).textContent()).trim(), thirdBefore,
    'Escape committed the edit instead of abandoning it');

  /* ── The section controls do what they say ── */
  const ids = () => frame.locator('[data-studio-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-studio-section')));
  const bar = frame.locator('[role="toolbar"]');
  const byLabel = (n) => bar.locator(`button[aria-label="${n}"]`);

  const before = await ids();
  await byLabel('Add below').click();
  await page.waitForTimeout(2200);

  const afterAdd = await ids();
  const newId = afterAdd.find((x) => !before.includes(x));
  assert.ok(newId, 'add below created nothing');
  assert.equal(afterAdd.indexOf(newId), afterAdd.indexOf(targetId) + 1,
    'the new block did not land directly below the selected one');

  /* It must be VISIBLE. A block that renders nothing, or that lands below the
     fold with its controls, reads to the admin as a button that did nothing. */
  const geom = await frame.locator(`[data-studio-section="${newId}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      h: Math.round(r.height), top: Math.round(r.top),
      winH: el.ownerDocument.defaultView.innerHeight,
    };
  });
  assert.ok(geom.h > 40, `the new block rendered ${geom.h}px tall`);
  assert.ok(geom.top >= 0 && geom.top < geom.winH,
    `the new block was left off screen (top ${geom.top}, viewport ${geom.winH})`);

  /* A repeatable block gets the two controls the designed regions do not. */
  assert.equal(await bar.locator('button').count(), 7,
    'a repeatable section should offer edit, up, down, hide, add, duplicate and delete');

  await byLabel('Duplicate').click();
  await page.waitForTimeout(900);
  const afterDup = await ids();
  assert.equal(afterDup.length, afterAdd.length + 1, 'duplicate did not add a section');
  assert.ok(!afterAdd.includes(afterDup[afterDup.indexOf(newId) + 1]),
    'the copy is not directly below its original');

  await frame.locator(`[data-studio-section="${newId}"]`).click({ position: { x: 20, y: 12 } });
  await page.waitForTimeout(700);
  await byLabel('Move up').click();
  await page.waitForTimeout(800);
  assert.equal((await ids()).indexOf(newId), afterDup.indexOf(newId) - 1,
    'move up did not move it');

  await byLabel('Hide from the site').click();
  await page.waitForTimeout(800);
  assert.ok(await page.locator('aside.border-e .line-through').count() >= 1,
    'hiding a section is not reflected in the structure list');

  await byLabel('Delete').click();
  await page.waitForTimeout(900);
  assert.ok(!(await ids()).includes(newId), 'delete did not remove the section');

  /* ── Nothing above published, saved or otherwise reached the backend ── */
  assert.deepEqual(
    rpcCalls.filter((n) => n.startsWith('site_') && n !== 'site_get_page'), [],
    `editing called ${rpcCalls.join(', ')} — drafts must only be written when the admin asks`,
  );
  assert.deepEqual(pageErrors, [], 'the editor threw while being used');
});
