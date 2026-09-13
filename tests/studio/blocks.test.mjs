// SITE STUDIO — THE BLOCKS AN ADMIN BUILDS WITH.
//
// Cards, questions and video, driven in a real browser against the real
// editor. These are the acceptance criteria for "an admin can build a page",
// and they are here rather than in a unit test because every one of them is
// about what happens when a person presses something and looks at the result.
//
// WHAT A UNIT TEST CANNOT SEE, AND THIS CAN
//
//   - A block added with no children is a heading over nothing: zero pixels
//     to click, and no sign that it repeats at all. The model cannot tell you
//     that; a measurement of the rendered card can.
//   - A card's toolbar is positioned by measuring the card inside an iframe.
//     Measuring on the render that MOVED the card puts every toolbar where
//     its card used to be — visible only in a browser, and only on the one
//     action that needs it.
//   - A video address is refused by a pure function that is already tested.
//     What is not otherwise tested is that the refusal reaches the admin's
//     eyes, and that nothing was stored on the way.
//
// The harness build points at a stub origin and every request is intercepted,
// so nothing here reaches a server. See inlineEditing.test.mjs for why
// stubbing the admin profile is not weakening authorization.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4332;
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

/** A stubbed PostgREST reply, with the CORS header the client insists on. */
const json = (b) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
});

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

test('an admin can build a page out of cards, questions and a video', opts, async (t) => {
  if (skipReason) assert.fail(`blocks gate could not run: ${skipReason}`);

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

  /* Every request that leaves the page, recorded. The video block's whole
     justification is that it opens no third-party connection until somebody
     presses play, and this is how that is checked rather than asserted. */
  const external = [];
  const rpcCalls = [];

  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(BASE)) return r.continue();
    if (!url.includes('stubproj')) external.push(url);
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
  await page.waitForTimeout(6000);
  const frame = page.frameLocator('iframe').first();

  const ids = () => frame.locator('[data-studio-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-studio-section')));

  /** Add a block by name from the block library, and return its section id.
      The library replaced a row of buttons pinned under the layer list: the
      catalogue is long enough now that a searchable dialog beats a column of
      every name at once. */
  async function addBlock(label) {
    const before = await ids();
    await page.getByRole('button', { name: /add a block/i }).first().click();
    await page.waitForTimeout(400);
    const dialog = page.getByRole('dialog');
    await dialog.locator('button', { hasText: new RegExp(`^${label}`) }).first().click();
    await page.waitForTimeout(2200);
    const id = (await ids()).find((x) => !before.includes(x));
    assert.ok(id, `adding "${label}" created nothing`);
    return id;
  }

  const cardsOf = (sectionId) => frame.locator(
    `[data-hm-section="${sectionId}"][data-hm-item-root]`,
  );
  const cardIds = (sectionId) => cardsOf(sectionId)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-hm-item-root')));

  async function typeInto(locator, value, commitKey = 'Enter') {
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    if (commitKey) await page.keyboard.press(commitKey);
    await page.waitForTimeout(700);
  }

  /* ── 1. A block that repeats arrives with something in it ────────────── */
  const cards = await addBlock('Feature cards');
  let order = await cardIds(cards);
  assert.equal(order.length, 3,
    'a new cards block should arrive with three children, not an empty heading');

  const firstCard = cardsOf(cards).first();
  const h = await firstCard.evaluate((n) => Math.round(n.getBoundingClientRect().height));
  assert.ok(h > 30, `the first card rendered ${h}px tall — there is nothing to click into`);

  /* ── 2. Each card's words are editable where they are rendered ───────── */
  const cardField = (itemId, field) =>
    frame.locator(`[data-hm-section="${cards}"][data-hm-item="${itemId}"][data-hm-field="${field}"]`).first();

  assert.equal(await cardField(order[0], 'title').getAttribute('contenteditable'), 'plaintext-only',
    'a card heading is not editable where it is rendered');

  await typeInto(cardField(order[0], 'title'), 'Registry-backed');
  await typeInto(cardField(order[1], 'title'), 'Contract review');
  assert.equal((await cardField(order[0], 'title').textContent()).trim(), 'Registry-backed');
  assert.equal((await cardField(order[1], 'title').textContent()).trim(), 'Contract review',
    'editing one card changed a different one');

  /* ── 3. Editing one card leaves its siblings alone ───────────────────── */
  await typeInto(cardField(order[2], 'body'), 'Only the third card says this.', null);
  await cardField(order[2], 'body').evaluate((n) => n.blur());
  await page.waitForTimeout(700);
  assert.doesNotMatch((await cardField(order[0], 'body').textContent()).trim(),
    /Only the third card/, 'a card body leaked into a sibling');

  /* ── 4. A card carries its own controls, and they move THAT card ─────── */
  /*
   * The toolbar that belongs to one card, found the way an admin finds it:
   * by where it is.
   *
   * Fully CONTAINED, all four edges. Cards in a grid row share a top edge, so
   * "top is within the card and the right edge is not past it" matched the
   * left-hand neighbour's toolbar as well — and the test then pressed the
   * wrong card's duplicate button and reported a product bug that was not
   * there.
   */
  async function toolbarFor(itemId) {
    const bars = frame.locator('[role="toolbar"]');
    const n = await bars.count();
    for (let i = 0; i < n; i += 1) {
      const inside = await bars.nth(i).evaluate((bar, sel) => {
        const card = bar.ownerDocument.querySelector(sel);
        if (!card) return false;
        const c = card.getBoundingClientRect();
        const r = bar.getBoundingClientRect();
        return r.top >= c.top - 2 && r.bottom <= c.bottom + 2
          && r.left >= c.left - 2 && r.right <= c.right + 2;
      }, `[data-hm-item-root="${itemId}"]`);
      if (inside) return bars.nth(i);
    }
    return null;
  }

  await firstCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const bar0 = await toolbarFor(order[0]);
  assert.ok(bar0, 'the first card has no controls of its own on the canvas');

  await bar0.locator('button[aria-label="Move down"]').click();
  await page.waitForTimeout(1200);
  const afterMove = await cardIds(cards);
  assert.deepEqual(afterMove, [order[1], order[0], order[2]],
    'moving a card down did not reorder it, or reordered the wrong one');
  // The words travelled with the card, which is the point of a per-card id.
  assert.equal((await cardField(order[0], 'title').textContent()).trim(), 'Registry-backed');

  /* ── 5. Duplicating a card copies its words, and the two are separate ── */
  const beforeDup = await cardIds(cards);
  const barDup = await toolbarFor(order[0]);
  await barDup.locator('button[aria-label="Duplicate"]').click();
  await page.waitForTimeout(1400);
  const afterDup = await cardIds(cards);
  const copy = afterDup.find((x) => !beforeDup.includes(x));
  assert.ok(copy, 'duplicating a card created nothing');
  assert.equal((await cardField(copy, 'title').textContent()).trim(), 'Registry-backed',
    'the copy did not carry the words it was copied from');

  await typeInto(cardField(copy, 'title'), 'Only the copy changed');
  assert.equal((await cardField(order[0], 'title').textContent()).trim(), 'Registry-backed',
    'editing the copy also changed the original — they share one set of words');

  /* ── 6. Removing a card removes that card ───────────────────────────── */
  const barRemove = await toolbarFor(copy);
  await barRemove.locator('button[aria-label="Remove"]').click();
  await page.waitForTimeout(1200);
  const afterRemove = await cardIds(cards);
  assert.equal(afterRemove.includes(copy), false, 'the removed card is still on the page');
  assert.equal(afterRemove.length, afterDup.length - 1, 'removing one card removed more than one');

  /* ── 7. An icon is a choice from a list, and it lands on that card ───── */
  await cardsOf(cards).first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(800);
  // Open the first card's row in the inspector's item list. Scoped by name:
  // the layer tree on the other side of the screen also has expandable rows,
  // and "the first one on the page" is the wrong one.
  const itemRow = page.locator('[data-studio-items] li button[aria-expanded]').first();
  await itemRow.click();
  await page.waitForTimeout(500);

  const iconGrid = page.locator('[role="radiogroup"]').first();
  assert.ok(await iconGrid.count() > 0, 'there is no way to choose an icon');
  const shield = iconGrid.locator('button[title="ShieldCheck"]');
  assert.equal(await shield.count(), 1, 'the curated icon set is not being offered');
  await shield.click();
  await page.waitForTimeout(900);
  assert.equal(await shield.getAttribute('aria-checked'), 'true', 'the icon choice did not stick');

  /* An icon slot must hold a NAME. Nothing here can put markup on the page. */
  const svgCount = await cardsOf(cards).first().locator('svg').count();
  assert.ok(svgCount > 0, 'the chosen icon did not render');

  /* ── 8. Questions and answers, from the same machinery ──────────────── */
  const faq = await addBlock('Questions & answers');
  const faqIds = await cardIds(faq);
  assert.equal(faqIds.length, 3, 'a new question block should arrive with three questions');
  await typeInto(
    frame.locator(`[data-hm-section="${faq}"][data-hm-item="${faqIds[0]}"][data-hm-field="question"]`).first(),
    'Is the registry record current?',
  );
  assert.equal(
    (await frame.locator(`[data-hm-section="${faq}"][data-hm-item="${faqIds[0]}"][data-hm-field="question"]`)
      .first().textContent()).trim(),
    'Is the registry record current?',
    'a question is not editable on the canvas',
  );

  /* ── 9. A video address is checked, and a refusal is SHOWN ───────────── */
  const video = await addBlock('Video');
  await frame.locator(`[data-studio-section="${video}"]`).first().click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(800);

  const urlBox = page.locator('aside input[inputmode="url"]').first();
  assert.equal(await urlBox.count(), 1, 'the video block offers nowhere to put an address');

  /* The INSPECTOR, not the admin navigation, which is also an <aside>. */
  const inspector = page.locator('aside:has(input[inputmode="url"])').first();

  await urlBox.fill('javascript:alert(1)');
  await page.waitForTimeout(600);
  assert.match(await inspector.textContent(), /Only https addresses can be embedded/,
    'a javascript: address was accepted, or refused silently');
  assert.equal(await frame.locator(`[data-studio-section="${video}"] iframe`).count(), 0,
    'a refused address still produced an embed');

  await urlBox.fill('https://example.com/not-a-video');
  await page.waitForTimeout(600);
  assert.match(await inspector.textContent(),
    /Use a YouTube, Vimeo or direct MP4 address/,
    'an unsupported address was not explained');

  /* ── 10. An accepted address becomes a nocookie embed, not a request ─── */
  await urlBox.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.waitForTimeout(900);
  assert.match(await inspector.textContent(),
    /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0/,
    'the accepted address was not normalised to the no-cookie embed');

  const played = external.filter((u) => /youtube|ytimg|googlevideo|vimeo/.test(u));
  assert.deepEqual(played, [],
    `the page contacted ${played.join(', ')} before anybody pressed play`);
  assert.equal(await frame.locator(`[data-studio-section="${video}"] iframe`).count(), 0,
    'the editor loaded the third-party embed into the editing surface');

  /* ── 11. None of that wrote anything ────────────────────────────────── */
  assert.deepEqual(
    rpcCalls.filter((n) => n.startsWith('site_') && n !== 'site_get_page' && n !== 'site_upload_asset'),
    [],
    `building a page called ${rpcCalls.join(', ')} — a draft is written only when the admin asks`,
  );
  assert.deepEqual(pageErrors, [], 'the editor threw while a page was being built');
});

test('the navigation and footer are edited once, for the whole site', opts, async (t) => {
  if (skipReason) assert.fail(`shell gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT + 1), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const SITE = `http://127.0.0.1:${PORT + 1}`;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(SITE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  /* Wide enough that the PREVIEW pane clears 1024px once the two side
     panels are subtracted — below that the desktop navigation is correctly
     not rendered, and there is nothing to click. */
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  /* What the admin saves, held here, and served back to the public pages —
     which is how "edited once, for the whole site" is actually checked
     rather than asserted about a single component. */
  let stored = null;

  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(SITE)) return r.continue();
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
      if (name === 'site_save_draft') {
        const body = JSON.parse(r.request().postData() ?? '{}');
        if (body.p_slug === 'shell' || body.slug === 'shell') {
          stored = body.p_content ?? body.content ?? null;
        }
        return r.fulfill(json(null));
      }
      return r.fulfill(json(null));
    }
    if (url.includes('/rest/v1/users')) return r.fulfill(json(ADMIN));
    /* The published read the public header and footer make. */
    if (url.includes('/rest/v1/site_pages')) {
      const wantsShell = /slug=eq\.shell/.test(url);
      return r.fulfill(json(wantsShell && stored ? { published: stored } : null));
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });

  await page.goto(`${SITE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  /* ── 1. The chrome is a page you can open ───────────────────────────── */
  /* The page selector is a listbox, not a native <select>: open it, then
     choose. Its options do not exist in the DOM until it is open. */
  await page.locator('[role="combobox"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[role="option"]', { hasText: /Header & footer/ }).first().click();
  await page.waitForTimeout(6000);

  const frame = page.frameLocator('iframe').first();
  /* The label is marked in the desktop bar AND in the phone menu — the same
     field, in both places an admin might click it — so ask for the one that
     is actually on screen. */
  const navVerify = frame
    .locator('[data-hm-section="site_header-1"][data-hm-field="nav_verify"]:visible').first();
  assert.ok(await navVerify.count() > 0,
    'the navigation labels are not editable where they are rendered');
  assert.equal(await navVerify.getAttribute('contenteditable'), 'plaintext-only',
    'a navigation label is marked but not editable');

  /* ── 2. Type on it, exactly as on any other text ────────────────────── */
  await navVerify.scrollIntoViewIfNeeded();
  await navVerify.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Check a record');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  assert.equal((await navVerify.textContent()).trim(), 'Check a record',
    'the navigation label did not take the edit');

  /* SPACE inside a nav item must type a space, not press the button and
     navigate the editor away from Studio. */
  assert.equal(await page.locator('iframe').count(), 1,
    'editing a navigation label destroyed the preview');

  /* ── 3. The footer's headings are editable too ──────────────────────── */
  const legal = frame
    .locator('[data-hm-section="site_footer-1"][data-hm-field="heading_legal"]:visible').first();
  assert.ok(await legal.count() > 0, 'the footer headings are not editable');
  await legal.scrollIntoViewIfNeeded();
  await legal.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('The small print');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  assert.equal((await legal.textContent()).trim(), 'The small print');

  /* ── 4. Saved once, the public pages all say it ─────────────────────── */
  await page.locator('button', { hasText: /^Save draft$/ }).first().click();
  await page.waitForTimeout(1500);
  assert.ok(stored, 'saving the chrome page stored nothing');

  for (const route of ['/', '/about', '/partners']) {
    const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await visitor.addInitScript(() => window.localStorage.setItem('homatch_lang', 'en'));
    const pub = await visitor.newPage();
    await pub.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(SITE)) return r.continue();
      if (url.includes('/rest/v1/site_pages')) {
        const wantsShell = /slug=eq\.shell/.test(url);
        return r.fulfill(json(wantsShell ? { published: stored } : null));
      }
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });
    await pub.goto(`${SITE}${route}`, { waitUntil: 'domcontentloaded' });
    await pub.waitForTimeout(2500);

    const text = await pub.locator('footer').first().textContent();
    assert.match(text, /The small print/,
      `the footer heading edited once did not reach ${route}`);
    await visitor.close();
  }

  assert.deepEqual(errors, [], 'the editor threw while the chrome was being edited');
});
