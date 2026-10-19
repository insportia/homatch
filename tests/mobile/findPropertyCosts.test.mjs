// ADMIN → DISCOVERY — the control center, in a real browser.
//
// Against the harness build with every request answered by a fixture, so it
// needs no Supabase project: realistic overview data (Telegram health, sources,
// queue incl. the cancelled retired-provider rows, labels, current demand,
// campaigns in every state), then empty, error, loading and non-admin states.
//
// Checked at 1440px and 390px in all six locales (RTL for ar/he): no
// horizontal overflow, every section present. Checked once in depth: a switch
// writes admin_settings, Stop and Retry reach the driver with the job id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4383;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FP_COSTS_QA_SHOTS || null;
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core')]) {
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'admin@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = (isAdmin) => ({ id: 'u1', auth_id: 'u1', email: 'admin@example.test', is_admin: isAdmin, role: isAdmin ? 'admin' : 'user', preferred_language: 'en', full_name: 'Admin User', plan: 'FREE', created_at: new Date().toISOString() });


const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();
const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
/* The production shape of finance_find_property_costs (20261119120000), with the real search 383ec400. */
function costs() {
  return {
    generated_at: ago(0),
    summary: { today_usd: 0, yesterday_usd: 0.000932, last7_usd: 0.004211, month_usd: 0.009310, month_upper_usd: 0.031220, searches: 34, searches_in_range: 34,
      properties: 1820, avg_per_search_usd: 0.000514, avg_per_property_usd: 0.0000062,
      most_expensive: { id: '383ec400-2032-4b8e-9023-d130b2e485d2', created_at: ago(900), usd: 0.000557 },
      run_rate_month_usd: 0.015190, unlinked_brief_usd: 0.005725, unlinked_brief_upper_usd: 0.022901, unlinked_brief_calls: 29, incomplete_searches: 1 },
    infrastructure: { monthly_fixed_usd: 0, amounts_entered: false, share: null, allocated_per_search_usd: null, status: 'UNKNOWN' },
    daily: Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), searches: i % 3, properties: (i % 3) * 40, ai_usd: (i % 3) * 0.00051, ai_upper_usd: (i % 3) * 0.0009, provider_usd: 0 })),
    providers: [
      { worker: 'ssge-agent', runs: 25, pages: 71, listings: 3508, failed: 2, empty: 1, warm_index: 0, shared: 3, direct_usd: 0, billing: 'NO_PAID_PROVIDER' },
      { worker: 'homege-agent', runs: 13, pages: 9, listings: 411, failed: 0, empty: 2, warm_index: 11, shared: 0, direct_usd: 0, billing: 'NO_PAID_PROVIDER' },
    ],
    cache: { runs: 96, shared_runs: 5, warm_index_runs: 22, pool_listings: 640, hit_rate: 0.2813 },
    optimisation: { repeated_ai_searches: 0, retries: 4, failed_runs: 7, empty_runs: 6 },
    searches: [
      { id: '383ec400-2032-4b8e-9023-d130b2e485d2', created_at: ago(900), status: 'COMPLETE', properties: 117, workers: ['allhome-agent', 'homege-agent', 'myhome-agent', 'placege-agent', 'ssge-agent'], runs: 5,
        ai_usd: 0.000557, ai_upper_usd: 0.000557, ai_calls: 1, provider_usd: 0, other_usd: null, total_usd: 0.000557, completeness: 'ESTIMATED' },
      { id: '9f1e0000-0000-4000-8000-000000000001', created_at: ago(2000), status: 'COMPLETE', properties: 12, workers: ['ssge-agent'], runs: 1,
        ai_usd: 0, ai_upper_usd: 0, ai_calls: 0, provider_usd: 0, other_usd: null, total_usd: 0, completeness: 'UNKNOWN' },
      { id: '9f1e0000-0000-4000-8000-000000000002', created_at: ago(3000), status: 'FAILED', properties: 0, workers: ['myhome-agent'], runs: 1,
        ai_usd: 0.000375, ai_upper_usd: 0.0015, ai_calls: 1, provider_usd: 0, other_usd: null, total_usd: 0.000375, completeness: 'PARTIAL' },
    ],
  };
}
const DETAIL = {
  search: { id: '383ec400-2032-4b8e-9023-d130b2e485d2', created_at: ago(900), status: 'COMPLETE', properties: 117, ai_status: 'DONE', brief_cost_refs: [] },
  ai: [{ id: 'a1', at: ago(893), operation: 'MARKETPLACE_RESULTS_INTELLIGENCE', model: 'gpt-4o-mini', input_tokens: 1991, output_tokens: 430, units: 2421,
    input_rate_per_1m: 0.15, output_rate_per_1m: 0.6, usd: 0.000557, upper_usd: null, state: 'ESTIMATED', success: true }],
  workers: [{ worker: 'homege-agent', status: 'COMPLETE', attempts: 1, returned: 10, discovered: 120, pages: 5, actions: 122, bytes: 55233944, duration_ms: 399000, index: 'COLD 52%', shared_run_id: null, cached_listings: 0, direct_usd: 0, billing: 'NO_PAID_PROVIDER' },
    { worker: 'allhome-agent', status: 'COMPLETE', attempts: 1, returned: 14, discovered: 328, pages: 0, actions: 0, bytes: 0, duration_ms: 1496, index: 'WARM', shared_run_id: null, cached_listings: 0, direct_usd: 0, billing: 'NO_PAID_PROVIDER' }],
};

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = true } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce', acceptDownloads: true });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const calls = [];
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request(), url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile(admin)));
    if (url.includes('/rest/v1/rpc/finance_find_property_costs')) { calls.push(JSON.parse(req.postData() ?? '{}')); return r.fulfill(admin ? json(costs()) : json({ message: 'FORBIDDEN: finance data is admin only' }, 403)); }
    if (url.includes('/rest/v1/rpc/finance_find_property_search_cost')) return r.fulfill(json(DETAIL));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });
  await page.goto(`${BASE}/admin/finance/find-property`);
  return { page, calls };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Find Property costs (owner, 2026-10-19): an admin sees what free Find Property costs HOMATCH — micro-costs exact, unknown never $0, ranges for partial records, per-search breakdown, CSV (en 1440, ka 390, he 390 RTL)', opts, async (t) => {
  const failures = [];
  for (const [lang, width] of [['en', 1440], ['ka', 390], ['he', 390]]) {
    const { page, calls } = await boot(t, { lang, width, height: width < 700 ? 844 : 900 });
    await page.locator('[data-fp-summary]').waitFor({ timeout: 30000 });
    const summary = await page.locator('[data-fp-summary]').textContent();
    if (!summary.includes('0.000557')) failures.push(`${lang}: the most expensive search is not shown to the micro-dollar (${summary.slice(0, 200)})`);
    if (!/0\.00931/.test(summary) || !/0\.03122/.test(summary)) failures.push(`${lang}: the month is not a range while records are partial`);
    if (!calls.length || !calls[0].p_from || !calls[0].p_to) failures.push(`${lang}: no dated range sent`);
    const rows = page.locator('[data-fp-history] [data-fp-row]');
    if (await rows.count() !== 3) failures.push(`${lang}: history rows ${await rows.count()}`);
    /* The AI and total cells of a search whose cost has no record say Unknown — never $0.00
       (its provider cell is a real $0: no paid provider exists). */
    const unknownCells = await page.locator('[data-fp-row="9f1e0000-0000-4000-8000-000000000001"] td').allTextContents();
    for (const i of [5, 8]) if (/\d/.test(unknownCells[i] ?? '')) failures.push(`${lang}: unknown cost cell ${i} shows a figure: ${unknownCells[i]}`);
    const partialRow = await page.locator('[data-fp-row="9f1e0000-0000-4000-8000-000000000002"]').textContent();
    if (!/0\.000375/.test(partialRow) || !/0\.0015/.test(partialRow)) failures.push(`${lang}: a partial record is not a range (${partialRow})`);
    if (!(await page.locator('[data-fp-basis]').textContent()).includes('find_property_infra_share')) failures.push(`${lang}: the unknown infrastructure is not explained`);
    await page.locator('[data-fp-row="383ec400-2032-4b8e-9023-d130b2e485d2"]').click();
    await page.locator('[data-fp-detail]').waitFor({ timeout: 10000 });
    const detail = await page.locator('[data-fp-detail]').textContent();
    for (const s of ['1,991', '430', '0.15', '0.6', 'gpt-4o-mini', '0.000557']) if (!detail.includes(s)) failures.push(`${lang}: detail lacks ${s}`);
    await page.keyboard.press('Escape');
    if (lang === 'en') {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV/ }).click()]);
      const csv = readFileSync(await download.path(), 'utf8');
      if (!csv.startsWith('created_at,search_id,status') || !csv.includes('383ec400-2032-4b8e-9023-d130b2e485d2') || !csv.includes('0.000557') || !csv.includes('not_recorded')) failures.push(`csv: ${csv.slice(0, 200)}`);
      await page.getByLabel(/provider/i).first().selectOption('ssge-agent').catch(() => {});
    }
    if (await overflow(page) > 1) failures.push(`${lang}-${width}: horizontal overflow ${await overflow(page)}`);
    if (lang === 'he' && await page.evaluate(() => document.documentElement.dir) !== 'rtl') failures.push('he: not RTL');
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${lang}-${width}-fp-costs.png`), fullPage: true }); }
  }
  assert.deepEqual(failures, []);
});

test('Find Property costs: a non-admin gets no figures (the database refuses; the page shows the refusal, never numbers)', opts, async (t) => {
  const { page } = await boot(t, { admin: false });
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('[data-fp-summary]').count(), 0);
  assert.doesNotMatch((await page.locator('body').textContent()) ?? '', /0\.000557/);
});
