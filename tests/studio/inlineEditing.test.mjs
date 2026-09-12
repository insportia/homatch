// SITE STUDIO — EDITING THE PAGE BY TYPING ON IT.
//
// Ten scenarios, driven in a real browser against the real Site Studio. They
// are the acceptance criteria for on-canvas editing, and they are here rather
// than in a unit test because every one of them is about what happens when a
// person clicks and types.
//
// WHAT THE FIRST IMPLEMENTATION GOT WRONG
//
// It found elements by comparing their rendered text against the value the
// model held. That works exactly once. The comparison ran against the value
// from BEFORE the edit, so a field stopped being editable the moment it was
// edited, and two fields that happened to say the same thing were
// indistinguishable. Identity is now declared by the component that renders
// the copy — section, field, item and locale, on the element itself — so it
// survives any rerender and cannot be confused between two fields.
//
// Three defects that only a browser could find, all fixed here:
//
//   - The click-to-select overlay was a button covering the whole section, so
//     nothing underneath could be clicked, including the text. Click-to-edit
//     could never receive a click at all, which is why every edit still went
//     through the sidebar.
//   - A CTA label lives inside its button. Typing the first SPACE of "Start
//     the check" activated the button and navigated the editor away from
//     Studio, destroying the preview mid-word. Activation is a default
//     action: stopPropagation does not touch it, and neither does making the
//     button ignore pointer events.
//   - A commit fires on blur, and switching language is a click elsewhere,
//     which blurs. Reading the editor's current locale at that moment wrote
//     the old language's text into the new one's field.
//
// WHY STUBBING THE ADMIN PROFILE IS NOT WEAKENING AUTHORIZATION
//
// The harness build points at a stub origin and every request is intercepted,
// so nothing here reaches a server. The client asks "is this user an admin"
// and the stub answers yes, exactly as it answers every other question. The
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

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

test('Site Studio edits the page itself, and cannot be made to store markup', opts, async (t) => {
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

  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  const json = (b) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
  });

  /* Every RPC, recorded — so the test can prove that a session of editing
     wrote nothing to the backend and cost nothing. */
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

  await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  assert.equal(await page.locator('iframe').count(), 1, 'the studio did not mount a preview');
  const frame = page.frameLocator('iframe').first();

  /* The preview must be a faithful copy of the real page, which means a real
     document. Quirks mode changes layout AND breaks programmatic scrolling. */
  assert.equal(
    await frame.locator('body').evaluate((el) => el.ownerDocument.compatMode),
    'CSS1Compat', 'the preview document is in quirks mode',
  );

  /** A field's element, addressed by identity rather than by its text. */
  const F = (sectionId, field) => `[data-hm-section="${sectionId}"][data-hm-field="${field}"]`;
  const textOf = async (sel) => (await frame.locator(sel).first().textContent() ?? '').trim();

  async function typeInto(sel, value, commitKey = 'Enter') {
    const el = frame.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    if (commitKey) await page.keyboard.press(commitKey);
    await page.waitForTimeout(700);
  }

  const heroTitle = F('hero-1', 'title');

  /* ── 1. Click the heading, type inside the heading ───────────────────── */
  assert.equal(
    await frame.locator(heroTitle).first().getAttribute('contenteditable'), 'plaintext-only',
    'the hero heading is not editable where it is rendered',
  );
  await typeInto(heroTitle, 'Evidence before signature');
  assert.equal(await textOf(heroTitle), 'Evidence before signature',
    'typing in the heading did not change the heading');

  /* ── 2. And again, immediately. The old implementation died here ─────── */
  await typeInto(heroTitle, 'Evidence before you sign');
  assert.equal(await textOf(heroTitle), 'Evidence before you sign',
    'the field could not be edited a second time');
  assert.equal(
    await frame.locator(heroTitle).first().getAttribute('contenteditable'), 'plaintext-only',
    'the field stopped being editable after one edit',
  );

  /* ── 3. Escape abandons ─────────────────────────────────────────────── */
  const before3 = await textOf(heroTitle);
  await frame.locator(heroTitle).first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('THIS MUST BE ABANDONED');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  assert.equal(await textOf(heroTitle), before3, 'Escape committed instead of abandoning');

  /* ── 4. A paste carrying markup lands as text ────────────────────────── */
  await frame.locator(heroTitle).first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await frame.locator(heroTitle).first().evaluate((node) => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<img src=x onerror="window.pwned = 1"><b>BOLD</b>');
    dt.setData('text/plain', 'BOLD');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  assert.equal(await frame.locator(`${heroTitle} img`).count(), 0, 'a pasted <img> reached the page');
  assert.equal(await frame.locator(`${heroTitle} b`).count(), 0, 'pasted markup reached the page');
  assert.match(await frame.locator(heroTitle).first().innerHTML(), /^[^<>]*$/,
    'the field contains markup');
  assert.equal(await page.evaluate(() => Boolean(window.pwned)), false,
    'a pasted onerror handler ran');

  /* ── 5. A CTA label edits, and the button does not fire ──────────────── */
  const ctaSel = '[data-hm-field="cta"]';
  assert.ok(await frame.locator(ctaSel).count() > 0, 'no CTA label is editable on the canvas');
  const urlBefore = page.url();
  // The value contains spaces on purpose: SPACE is how a button is pressed.
  await typeInto(ctaSel, 'Start the check');
  assert.equal((await frame.locator(ctaSel).first().textContent()).trim(), 'Start the check',
    'the CTA label did not take the edit');
  assert.equal(page.url(), urlBefore, 'editing the CTA navigated the editor away');
  assert.equal(await page.locator('iframe').count(), 1, 'the preview was destroyed by the edit');

  /* ── 6. A paragraph keeps its typography while being edited ──────────── */
  const bodySel = F('hero-1', 'body');
  const metrics = (sel) => frame.locator(sel).first().evaluate((n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return {
      fontSize: cs.fontSize, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
      fontFamily: cs.fontFamily, width: Math.round(r.width),
    };
  });
  const before6 = await metrics(bodySel);
  await typeInto(bodySel, 'A short line about what the report contains.', null);
  await frame.locator(bodySel).first().evaluate((n) => n.blur());
  await page.waitForTimeout(700);
  assert.deepEqual(await metrics(bodySel), before6,
    'the paragraph changed size, alignment, family or width while being edited');

  /* ── 10. Add a block: visible, and editable at once ──────────────────── */
  const ids = () => frame.locator('[data-studio-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-studio-section')));
  const idsBefore = await ids();
  await frame.locator('[data-studio-section="hero-1"]').first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(600);
  const bar = frame.locator('[role="toolbar"]');
  await bar.locator('button[aria-label="Add below"]').click();
  await page.waitForTimeout(2200);

  const idsAfterAdd = await ids();
  const newId = idsAfterAdd.find((x) => !idsBefore.includes(x));
  assert.ok(newId, 'add below created nothing');

  const newTitle = F(newId, 'title');
  const geom = await frame.locator(newTitle).first().evaluate((n) => {
    const r = n.getBoundingClientRect();
    return { h: Math.round(r.height), top: Math.round(r.top), vh: n.ownerDocument.defaultView.innerHeight };
  });
  assert.ok(geom.h > 10, `the new block's heading rendered ${geom.h}px tall`);
  assert.ok(geom.top >= 0 && geom.top < geom.vh, 'the new block was left off screen');
  await typeInto(newTitle, 'A new block');
  assert.equal(await textOf(newTitle), 'A new block', 'the new block was not editable straight away');

  /* ── 9. Duplicate, edit the copy, original untouched ─────────────────── */
  await frame.locator(`[data-studio-section="${newId}"]`).first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(600);
  await bar.locator('button[aria-label="Duplicate"]').click();
  await page.waitForTimeout(1200);
  const copyId = (await ids()).find((x) => !idsAfterAdd.includes(x));
  assert.ok(copyId, 'duplicate created nothing');

  await typeInto(F(copyId, 'title'), 'Only the copy changed');
  assert.equal(await textOf(F(copyId, 'title')), 'Only the copy changed');
  assert.equal(await textOf(F(newId, 'title')), 'A new block',
    'editing the duplicate also changed the original');

  /* ── 7. Two blocks of the same type: one edit touches one of them ────── */
  await typeInto(F(newId, 'body'), 'First block body.', null);
  await frame.locator(F(newId, 'body')).first().evaluate((n) => n.blur());
  await page.waitForTimeout(700);
  assert.match(await textOf(F(newId, 'body')), /^First block body/);
  assert.doesNotMatch(await textOf(F(copyId, 'body')), /^First block body/,
    'editing one repeated block changed the other');

  /* ── 8. Locales do not leak into each other ──────────────────────────── */
  const enBefore = await textOf(heroTitle);
  await page.locator('button', { hasText: /^ქარ$/ }).first().click();
  await page.waitForTimeout(1800);
  await typeInto(F('hero-1', 'title'), 'ქართული სათაური');
  assert.equal(await textOf(F('hero-1', 'title')), 'ქართული სათაური',
    'the Georgian edit did not take');
  await page.locator('button', { hasText: /^EN$/ }).first().click();
  await page.waitForTimeout(1800);
  assert.equal(await textOf(heroTitle), enBefore,
    'editing Georgian changed the English copy');

  /* ── Clicking a picture offers THAT picture ──────────────────────────── */
  const shot = frame.locator('[data-hm-media]:visible').first();
  await shot.scrollIntoViewIfNeeded();
  const slot = await shot.getAttribute('data-hm-media');
  const shotSection = await shot.getAttribute('data-hm-section');
  await shot.click({ position: { x: 30, y: 30 } });
  await page.waitForTimeout(900);

  const imageBar = frame.locator('[data-studio-ui][role="toolbar"]');
  assert.equal(await imageBar.count(), 1,
    'clicking a picture did not offer anything to do with it');
  // Anchored to the picture that was clicked, not to the section.
  const anchored = await imageBar.first().evaluate((bar, sel) => {
    const img = bar.ownerDocument.querySelector(sel).getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    return r.top >= img.top - 2 && r.left >= img.left - 2 && r.top < img.bottom;
  }, `[data-hm-section="${shotSection}"][data-hm-media="${slot}"]`);
  assert.ok(anchored, 'the image toolbar is not anchored to the image it acts on');
  assert.equal(page.url(), urlBefore, 'clicking a picture navigated the editor away');

  /* ── Nothing above wrote anything, or cost anything ──────────────────── */
  assert.deepEqual(
    rpcCalls.filter((n) => n.startsWith('site_') && n !== 'site_get_page'), [],
    `editing called ${rpcCalls.join(', ')} — a draft is written only when the admin asks`,
  );
  assert.deepEqual(pageErrors, [], 'the editor threw while being used');
});
