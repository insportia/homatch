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
const PORT = 4352;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.ADMIN_DISCOVERY_QA_SHOTS || null;
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
function overview() {
  return {
    generated_at: ago(0),
    settings: {
      discovery_freshness_policy: { activeMaxDays: 30 }, telegram_discovery_enabled: false, campaign_source_discovery_enabled: true,
      discovery_background_refresh_enabled: false, forum_discovery_enabled: true, classifier_schedule_enabled: false,
      campaign_min_credits: 50, telegram_integration_mode: 'MTPROTO_USER',
    },
    telegram_health: { provider: 'TELEGRAM', status: 'ERROR', last_tested_at: ago(30), last_success_at: ago(1440), latency_ms: 812,
      last_error: 'NOT_CONFIGURED:worker has no Telegram session', success_count: 12, failure_count: 3 },
    targets: [
      { lifecycle: 'PRODUCTIVE', readability: 'READABLE', discovery_enabled: true, targets: 4, items_read: 1830, demand_found: 27, last_checked_at: ago(90) },
      { lifecycle: 'DISCOVERED', readability: 'UNVERIFIED', discovery_enabled: false, targets: 11, items_read: 0, demand_found: 0, last_checked_at: null },
    ],
    queue: [
      { provider: 'APIFY', status: 'CANCELLED', jobs: 3770, last_activity: ago(60) },
      { provider: 'DATAFORSEO', status: 'CANCELLED', jobs: 2787, last_activity: ago(60) },
      { provider: 'FORUM', status: 'DONE', jobs: 6, last_activity: ago(12) },
      { provider: 'TELEGRAM', status: 'RETRY_WAIT', jobs: 1, last_activity: ago(3) },
    ],
    labels_7d: [
      { label: 'BUYER_DEMAND', signals: 14 }, { label: 'TENANT_DEMAND', signals: 9 }, { label: 'LANDLORD_SUPPLY', signals: 41 },
      { label: 'BROKER_AGENCY', signals: 7 }, { label: 'AMBIGUOUS', signals: 5 }, { label: 'UNLABELLED', signals: 3 },
    ],
    pending_classification: 12,
    current_demand: { d7: 6, d14: 11, d30: 23 },
    jobs: [
      { id: 'j-run', property_id: 'p1', status: 'searching_sources', progress: 55, current_step: 'Searching sources for current demand (1 of 3 done)',
        fresh_matches_created: 0, failure_reason: null, started_at: ago(8), completed_at: null, discovery_deadline_at: ago(-22), budget_credits: 50,
        source_jobs: { DONE: 1, RETRY_WAIT: 1, PENDING: 1 } },
      { id: 'j-done', property_id: 'p2', status: 'completed', progress: 100, current_step: 'Found 3 new potentially interested people (posted in the last 30 days)',
        fresh_matches_created: 3, failure_reason: null, started_at: ago(200), completed_at: ago(170), discovery_deadline_at: null, budget_credits: 100, source_jobs: {} },
      { id: 'j-budget', property_id: 'p3', status: 'budget_reached', progress: 100, current_step: 'Stopped at the budget you set',
        fresh_matches_created: 0, failure_reason: 'RESERVATION_NOT_HELD', started_at: ago(900), completed_at: ago(860), discovery_deadline_at: ago(870), budget_credits: 50,
        source_jobs: { CANCELLED: 2 } },
    ],
  };
}
const EMPTY = { generated_at: ago(0), settings: {}, telegram_health: null, targets: [], queue: [], labels_7d: [], pending_classification: 0,
  current_demand: { d7: 0, d14: 0, d30: 0 }, jobs: [] };

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = true, data = overview(), rpc = null } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const calls = { settings: [], driver: [], rpc: 0 };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile(admin)));
    if (url.includes('/rest/v1/rpc/admin_discovery_overview')) {
      calls.rpc += 1;
      if (rpc) return rpc(r, json);
      return r.fulfill(json(data));
    }
    if (url.includes('/rest/v1/admin_settings') && req.method() === 'POST') {
      calls.settings.push(JSON.parse(req.postData() || '{}'));
      return r.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (url.includes('/functions/v1/discovery-queue-worker')) {
      calls.driver.push(JSON.parse(req.postData() || '{}'));
      return r.fulfill(json({ success: true }));
    }
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls };
}

const TITLE = 'h1';
async function ready(page) {
  await page.waitForSelector(TITLE, { timeout: 20000 });
  await page.waitForTimeout(400);
}
const LAYOUT = () => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'ltr',
  sections: document.querySelectorAll('main section, [role="main"] section, section').length,
  switches: document.querySelectorAll('[role="switch"]').length,
  text: document.body.innerText,
  /* Every visible action must be fully inside the viewport, not behind a
     sideways-scrolling table. */
  clippedActions: [...document.querySelectorAll('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && /Retry|Stop|↻|■/.test(b.innerText + b.innerHTML) && (r.left < 0 || r.right > window.innerWidth);
  }).length,
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`Admin → Discovery renders every section, every locale, at ${width}px`, opts, async (t) => {
    if (skipReason) assert.fail(`admin discovery gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height, lang });
      await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.waitForSelector('[role="switch"]', { timeout: 20000 });
      const l = await page.evaluate(LAYOUT);
      if (l.overflow > 1) failures.push(`${lang} ${width}: horizontal overflow ${l.overflow}px`);
      if (l.switches !== 5) failures.push(`${lang} ${width}: ${l.switches} switches, expected 5`);
      if (l.sections < 5) failures.push(`${lang} ${width}: ${l.sections} sections`);
      if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang} ${width}: not RTL`);
      for (const v of ['2787', '3770', '23', '1830']) if (!l.text.includes(v)) failures.push(`${lang} ${width}: value ${v} missing`);
      if (/admin_disc_|mjp_status_|undefined/.test(l.text)) failures.push(`${lang} ${width}: raw key or undefined on screen`);
      if (/searching_sources|budget_reached|partially_completed/.test(l.text)) failures.push(`${lang} ${width}: raw job status on screen`);
      if (l.clippedActions) failures.push(`${lang} ${width}: ${l.clippedActions} action(s) outside the viewport`);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `admin-discovery-${width}-${lang}.png`), fullPage: true }); }
    }
    assert.deepEqual(failures, []);
  });
}

test('switches write admin_settings; Stop and Retry reach the driver with the job id', opts, async (t) => {
  if (skipReason) assert.fail(`admin discovery gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t);
  await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role="switch"]', { timeout: 20000 });
  const first = page.locator('[role="switch"]').first();
  const before = await first.getAttribute('aria-checked');
  await first.click();
  await page.waitForTimeout(500);
  assert.equal(calls.settings.length, 1, 'a switch did not write');
  assert.equal(calls.settings[0].key, 'telegram_discovery_enabled');
  assert.equal(calls.settings[0].value, before !== 'true');

  await page.getByRole('button', { name: 'Retry sources' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.waitForTimeout(400);
  assert.deepEqual(calls.driver.map((d) => [d.mode, d.jobId]), [['admin_retry', 'j-run'], ['admin_stop', 'j-run']]);
  /* A finished or budget-reached campaign offers neither action. */
  assert.equal(await page.getByRole('button', { name: 'Stop' }).count(), 1);
});

test('empty, error and loading states are honest', opts, async (t) => {
  if (skipReason) assert.fail(`admin discovery gate could not run: ${skipReason}`);
  const empty = await boot(t, { data: EMPTY });
  await empty.page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
  await empty.page.waitForSelector('[role="switch"]', { timeout: 20000 });
  const text = await empty.page.evaluate(() => document.body.innerText);
  assert.match(text, /Not yet checked/);
  assert.match(text, /Nothing yet\./);
  for (const s of await empty.page.locator('[role="switch"]').all()) assert.equal(await s.getAttribute('aria-checked'), 'false', 'an unset switch shows as on');

  const failing = await boot(t, { rpc: (r, json) => r.fulfill(json({ message: 'FORBIDDEN' }, 400)) });
  await failing.page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
  await ready(failing.page);
  await failing.page.waitForTimeout(800);
  const failed = await failing.page.evaluate(() => document.body.innerText);
  assert.match(failed, /FORBIDDEN|Could not load/, 'the failure is not said');
  assert.equal(await failing.page.locator('[role="switch"]').count(), 0, 'switches rendered without data');

  let release;
  const gate = new Promise((res) => { release = res; });
  const slow = await boot(t, { rpc: async (r, json) => { await gate; return r.fulfill(json(overview())); } });
  await slow.page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
  await ready(slow.page);
  assert.ok(await slow.page.locator('.animate-pulse').count() > 0, 'no loading placeholder while the overview loads');
  release();
  await slow.page.waitForSelector('[role="switch"]', { timeout: 20000 });
});

test('a non-admin never sees the control center', opts, async (t) => {
  if (skipReason) assert.fail(`admin discovery gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { admin: false });
  await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(text, /Discovery control center/);
  assert.equal(calls.rpc, 0, 'a non-admin session still asked for the overview');
});
