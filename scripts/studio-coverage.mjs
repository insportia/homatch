/*
 * HOW MUCH OF THE PUBLIC SITE IS ACTUALLY EDITABLE.
 *
 * WHY THIS EXISTS
 *
 * "Everything you can see is editable" has been claimed several times and has
 * never been true, because nobody was counting. A claim about coverage that
 * cannot produce a number is a claim about intentions.
 *
 * WHERE IT MEASURES, AND WHY THERE
 *
 * Inside Site Studio, not on the public site. `data-hm-field` — the attribute
 * the editor uses to find what a caret is sitting in — is only emitted in
 * editing mode, because shipping editor plumbing to every visitor would be
 * dead weight in the DOM. So the first version of this script measured the
 * public pages, found the attribute nowhere, and reported 0%: a number that
 * was precisely wrong rather than roughly right.
 *
 * It now opens each managed page in the editor and walks the preview frame,
 * which is the real website with the editing layer on. For every visible run
 * of words it asks one question: is this inside an element carrying
 * `data-hm-field`? Agreeing with the editor's own attribute is the definition
 * of editable — not a count of registry entries, which would happily report
 * 100% for fields nothing renders.
 *
 * WHAT IS DELIBERATELY NOT COUNTED
 *
 *   Anything aria-hidden, and anything not rendered.
 *   Pure symbols, digits and separators: "01 / 07" is a counter, not a
 *     sentence somebody wants to rewrite.
 *   Live application DATA — a price, a Credit grant, a provider status — is
 *     read from the database on every load, and making it CMS copy would let
 *     a bad save misstate what a customer is charged. Reported separately,
 *     not as a miss, because a miss should mean "go and register this".
 *
 * The useful output is not the percentage. It is the list of exact sentences
 * nobody can change yet, which is printed verbatim.
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  return [
    process.env.PLAYWRIGHT_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  for (const c of ['playwright-core', process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test',
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    },
  };
}

const ADMIN = {
  id: 'u1', auth_id: 'u1', email: 'admin@example.test',
  is_admin: true, preferred_language: 'en', full_name: 'Admin',
  created_at: new Date().toISOString(),
};

/* Runs inside the preview frame. One function, so what is counted is plain. */
const MEASURE = () => {
  const root = document.body;
  /* Digits, punctuation and separators are not sentences. */
  const SYMBOLIC = /^[\s\p{P}\p{S}\d]*$/u;

  const seen = { editable: [], data: [], missing: [] };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.closest('script, style, svg')) continue;
    if (!el.getClientRects().length) continue;

    if (SYMBOLIC.test(text)) { seen.data.push(text.slice(0, 40)); continue; }
    if (el.closest('[data-hm-field]')) seen.editable.push(text.slice(0, 60));
    else seen.missing.push(text.slice(0, 90));
  }
  return seen;
};

const chrome = findChrome();
const pw = resolvePlaywright();
if (!chrome || !pw) {
  console.error('[studio:coverage] needs Chrome and playwright-core — run: npm run test:mobile:setup');
  process.exit(2);
}
if (!existsSync('dist/index.html')) {
  console.error('[studio:coverage] no build in dist/ — run: npm run build:harness');
  process.exit(2);
}

const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: 'ignore', shell: process.platform === 'win32' },
);
for (let i = 0; i < 80; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const browser = await pw.chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
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

await page.goto(`${BASE}/admin/site-studio`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

/* Every page the editor offers, read off its own selector rather than from a
   list here — a page added to the editor is a page this measures. */
await page.locator('[role="combobox"]').first().click();
await page.waitForTimeout(500);
const names = await page.locator('[role="option"]').allTextContents();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

let totalEditable = 0;
let totalMissing = 0;
const report = [];

for (const name of names) {
  await page.locator('[role="combobox"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[role="option"]', { hasText: name }).first().click();
  await page.waitForTimeout(5000);

  /* The preview is written with srcDoc, so its URL is `about:srcdoc` rather
     than anything on this origin — filtering by URL found nothing and made
     every page report zero. It is simply the one frame that is not the page. */
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) { report.push({ name, editable: 0, missing: 0, data: 0, pct: 0, unregistered: ['(preview did not render)'] }); continue; }

  /* Everything below the fold has to render before it can be counted. */
  await frame.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);

  const seen = await frame.evaluate(MEASURE);
  const editable = seen.editable.length;
  const missing = seen.missing.length;
  /*
   * A page with nothing to measure is not a page at 100%.
   *
   * Five of these — Partners, Mortgage, Privacy, Terms, Verify — are written
   * in JSX with a BAND of admin blocks beside them, and the editor's preview
   * shows only that band. Empty band, no text, and the first version of this
   * reported them as perfect. That is the exact flattering-number problem
   * this script was written to stop, reproduced inside the script.
   */
  const pct = editable + missing === 0 ? null : Math.round((editable / (editable + missing)) * 100);
  totalEditable += editable;
  totalMissing += missing;
  report.push({ name, editable, missing, data: seen.data.length, pct, unregistered: seen.missing });
}

await browser.close();
server.kill();

console.log('\n=== SITE STUDIO COVERAGE ===\n');
for (const r of report) {
  const score = r.pct === null ? '  —' : String(r.pct).padStart(3);
  const note = r.pct === null ? '   (coded page; only admin-added blocks are measurable here)' : '';
  console.log(`${r.name.padEnd(18)} ${score}%   editable ${String(r.editable).padStart(3)}   unregistered ${String(r.missing).padStart(3)}   symbolic ${r.data}${note}`);
}
const overall = totalEditable + totalMissing === 0
  ? 100 : Math.round((totalEditable / (totalEditable + totalMissing)) * 100);
console.log(`\n${'OVERALL'.padEnd(18)} ${String(overall).padStart(3)}%   editable ${totalEditable}   unregistered ${totalMissing}\n`);

for (const r of report) {
  if (!r.unregistered.length) continue;
  console.log(`--- ${r.name}: ${r.unregistered.length} unregistered ---`);
  for (const line of [...new Set(r.unregistered)].slice(0, 30)) console.log(`    ${line}`);
  console.log('');
}
