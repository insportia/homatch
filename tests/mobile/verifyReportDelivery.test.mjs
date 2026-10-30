// VERIFY → research finished, report NOT delivered, in a real browser (harness build).
//
// Production 2026-10-29: verify-synthesis failed to boot; job 674df06e read
// COMPLETE and the page rendered the evidence as if it were the report.
// Research completion is not report delivery (src/verify/reportDelivery.ts):
//   * synthesis FAILED after every attempt → an honest "could not prepare"
//     card that says nothing is charged, and no report shell;
//   * synthesis still being written → a calm "being prepared" card with a
//     re-check button, and no report shell;
// at 390px (ka) and 360px (ar, RTL), with no horizontal overflow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4371;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Chrome not found — set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}
const skipReason = haveDeps();
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 600000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp, email: 'harness@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'harness@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

/** The page with research COMPLETE; verify-synthesis answers `synth`; the row says `row`. */
async function openUndelivered(browser, { synth, row, width, height, lang }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('homatch_lang', l); } catch { /* */ } }, lang);
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  const cors = { 'access-control-allow-origin': '*' };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
  let synthCalls = 0;
  await page.route('**', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/functions/v1/verify-synthesis')) { synthCalls++; return route.fulfill(json(synth.body, synth.status)); }
    if (url.includes('/functions/v1/research-agent')) return route.fulfill(json({ ...STATUS_RESPONSE, synthesis_state: row.synthesis_state, synthesis_attempts: row.synthesis_attempts }));
    if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
    // The page's delivery read (status,cancelled_at,synthesis_state,…): an array, as PostgREST answers maybeSingle().
    if (url.includes('/rest/v1/research_jobs') && url.includes('cancelled_at')) return route.fulfill(json([{ status: 'COMPLETE', cancelled_at: null, completed_at: new Date(Date.now() - 5 * 60_000).toISOString(), ...row }]));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill(json({}));
  });
  await page.goto(`${BASE}/verify?job=fixture-job`, { waitUntil: 'domcontentloaded' });
  return { ctx, page, synthCalls: () => synthCalls };
}

const measure = (page) => page.evaluate(() => ({
  dir: document.documentElement.dir,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  reportArticles: document.querySelectorAll('.verify-report article').length,
  evidenceTitle: [...document.querySelectorAll('.verify-report h2, .verify-report h3')].map((h) => h.textContent.trim()),
}));

test('research COMPLETE, report not delivered: failed and preparing states, never a report shell', opts, async (t) => {
  if (skipReason) assert.fail(`verify delivery could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 80; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  // 1. The incident: every attempt spent, the function answers report_unavailable.
  for (const [width, height, lang] of [[390, 844, 'ka'], [360, 740, 'ar']]) {
    const { ctx, page } = await openUndelivered(browser, {
      synth: { status: 503, body: { error: 'report_unavailable' } },
      row: { synthesis_state: 'FAILED', synthesis_attempts: 4 },
      width, height, lang,
    });
    const card = page.locator('[data-testid="verify-report-failed"]');
    await card.waitFor({ timeout: 30000 });
    assert.equal(await card.getAttribute('role'), 'alert');
    const text = await card.innerText();
    if (lang === 'ka') {
      assert.match(text, /ანგარიშის მომზადება ვერ მოხერხდა/);
      assert.match(text, /თანხა არ ჩამოგეჭრებათ/);
    }
    const m = await measure(page);
    assert.equal(m.reportArticles, 0, `${lang} ${width}px: a report shell rendered`);
    assert.ok(m.overflow <= 1, `${lang} ${width}px: horizontal overflow ${m.overflow}px`);
    if (lang === 'ar') assert.equal(m.dir, 'rtl');
    assert.equal(await page.locator('[data-testid="verify-report-preparing"]').count(), 0);
    await ctx.close();
  }

  // 2. Still being written: the function failed this call (500), the driver is retrying (attempts left).
  {
    const { ctx, page, synthCalls } = await openUndelivered(browser, {
      synth: { status: 500, body: { error: 'internal_error' } },
      row: { synthesis_state: 'PENDING', synthesis_attempts: 1 },
      width: 390, height: 844, lang: 'ka',
    });
    const card = page.locator('[data-testid="verify-report-preparing"]');
    await card.waitFor({ timeout: 30000 });
    assert.match(await card.innerText(), /ანგარიში მზადდება/);
    const m = await measure(page);
    assert.equal(m.reportArticles, 0, 'a report shell rendered while the report is being prepared');
    assert.ok(m.overflow <= 1, `preparing 390px: horizontal overflow ${m.overflow}px`);
    assert.equal(await page.locator('[data-testid="verify-report-failed"]').count(), 0);
    // "Check again" asks the server again (it never starts a second build: the server claims one).
    const before = synthCalls();
    await card.getByRole('button').click();
    await page.waitForTimeout(1500);
    assert.ok(synthCalls() > before, 'the re-check did not ask for the report');
    await ctx.close();
  }
});
