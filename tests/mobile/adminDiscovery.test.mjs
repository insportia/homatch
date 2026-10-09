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
    /* Phase 2 intelligence panel: a realistic, populated shape so it is covered. */
    if (url.includes('/rest/v1/rpc/admin_discovery_intelligence')) {
      return r.fulfill(json({
        generated_at: new Date().toISOString(),
        switches: { find_property_discovery_enabled: false, discovery_worker_route_enabled: false, discovery_worker_portal_adapters: [] },
        runs: [{ id: 'run-1', user_id: 'u', status: 'SEARCHING', stage: 'SEARCHING_SOURCES', progress: 40, results_found: 0,
          credits_charged: null, provider_cost_usd: null, failure_reason: null, started_at: new Date().toISOString(),
          completed_at: null, elapsed_seconds: 120, source_jobs: { 'PORTAL:EDGE:DONE': 2, 'TELEGRAM:EDGE:PENDING': 1 } }],
        plans_7d: { SUPPLY: 1, DEMAND: 3 },
        queue: [{ provider: 'PORTAL', executor: 'EDGE', status: 'DONE', jobs: 2, oldest_waiting: null, last_activity: new Date().toISOString(), expired_leases: 0 }],
        live_checks: [{ source_key: 'www.myhome.ge', route: 'EDGE_HTTP', market: 'GE', checked_at: new Date().toISOString(), ok: false,
          http_status: 403, latency_ms: 812, collection_items: null, detail_ok: null, normalized_ok: null, limitation: 'THIN_HTML (client-rendered?)' }],
        supply_by_adapter: [{ adapter_id: 'telegram-community', observations: 210, entities: 64, new_7d: 30, last_seen: new Date().toISOString(), valid: 0, gone: 0, avg_quality: 0.83 }],
        entities: { total: 65, multi_observation: 20, multi_source: 3, observations: 242, resolved_observations: 230,
          largest: [{ id: 'e1', city: 'batumi', transaction: 'RENT', property_type: 'APARTMENT', observation_count: 9, source_count: 1,
            min_price: 700, max_price: 700, price_currency: 'USD', price_spread: 0, last_seen_at: new Date().toISOString() }] },
        resolution_7d: { LIKELY_SAME_ENTITY: 40, DISTINCT: 120 },
        matches: { external_listing: 5, external_intelligence: 72, internal_homatch: 0, demand_matches_30d: 3 },
        community_supply: { listing_posts: 356, stored_as_supply: 210 },
      }));
    }
    /* Find Buyers center + its source network tab (2026-10-08 production shape). */
    if (url.includes('/rest/v1/rpc/admin_find_buyers_center')) {
      return r.fulfill(json({ switches: { find_buyers_social_enabled: false }, overview: { revenue_micros: 0, credits_committed: 0, customer_value_micros: 0,
        provider_micros: 0, ai_micros: 0, translation_micros: 0, other_micros: 0, qualified_leads: 0, strong_leads: 0 },
        campaigns: [], actors: [], sources: [], languages: [], ledger: [] }));
    }
    if (url.includes('/rest/v1/rpc/admin_find_buyers_source_network')) {
      calls.network = (calls.network ?? 0) + 1;
      return r.fulfill(json({
        since: ago(7), memo23Discovered: 0, autoEnable: false,
        platforms: [
          { platform: 'TELEGRAM', discovered: 41, verified: 11, active: 5, read: 5, inactive: 36, blocked: 1, newInWindow: 31, itemsRead: 1681, commentsRead: 0, demandSignals: 14, lastRead: ago(0) },
          { platform: 'FACEBOOK', discovered: 3, verified: 0, active: 0, read: 1, inactive: 3, blocked: 1, newInWindow: 0, itemsRead: 0, commentsRead: 0, demandSignals: 0, lastRead: null },
        ],
        directory: [{ platform: 'FACEBOOK', listed: 13 }, { platform: 'TELEGRAM', listed: 15 }],
        phases: [{ jobId: 'j1', at: ago(1), finalizedAt: null, stopReason: null, budgetMicros: 5000000, phase1DeadlineAt: ago(-9),
          discoveryCapMicros: 61000, budgetRationale: 'FULL_DISCOVERY', planned: { phase1: 3, phase2SourceDependent: 1, phase2IndependentSearch: 4 },
          phase1Queue: { DONE: 2 }, phase2Queue: { RETRY_WAIT: 4 }, phase1SpendMicros: 48000, phase2SpendMicros: 0, runs: { 'FB_GROUP_SEARCH:SUCCEEDED': 2 } }],
        campaigns: [{ jobId: 'j1', at: ago(1), status: 'DONE', communitiesFound: 38, newlyRegistered: 31, audited: 10, verified: 4, activated: 0, readNow: 0,
          languages: ['ka', 'ru', 'en', 'ar', 'he', 'tr'], city: 'თბილისი', error: null }],
        telegram: [
          { handle: 'tbilisikvartiri', name: 'Тбилиси Квартиры (RU)', lifecycle: 'REACHABLE', readability: 'READABLE', enabled: true, relevance: null, lastMessageAt: ago(0),
            auditReason: null, discoveredQuery: null, itemsRead: 14, demandFound: 1, lastSuccessAt: ago(0), lastError: null, createdAt: ago(10) },
          { handle: 'batumi_re', name: 'Недвижимость Батуми', lifecycle: 'AUDITED', readability: 'READABLE', enabled: false, relevance: 0.75, lastMessageAt: ago(1),
            auditReason: '75% about property, 0 demand in sample', discoveredQuery: 'недвижимость батуми', itemsRead: 0, demandFound: 0, lastSuccessAt: null, lastError: null, createdAt: ago(4) },
        ],
      }));
    }
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

/* One switch per DISCOVERY_SWITCHES entry — read from the source, so adding
   a switch (forum_schedule_enabled) moves the expectation with it. */
const EXPECTED_SWITCHES = (() => {
  const src = readFileSync(new URL('../../src/services/adminDiscovery.ts', import.meta.url), 'utf8');
  const count = (name) => {
    const start = src.indexOf(`export const ${name} = [`);
    if (start < 0) return 0;
    return (src.slice(start, src.indexOf('] as const;', start)).match(/'[a-z_]+'/g) ?? []).length;
  };
  /* The overview's switches plus the Phase 2 intelligence panel's own, plus
     the Find Buyers control center's product switch (src/services/findBuyers.ts). */
  const fb = readFileSync(new URL('../../src/services/findBuyers.ts', import.meta.url), 'utf8');
  const fbStart = fb.indexOf('export const FIND_BUYERS_SWITCHES = [');
  const fbCount = fbStart < 0 ? 0 : (fb.slice(fbStart, fb.indexOf('] as const;', fbStart)).match(/'[a-z_]+'/g) ?? []).length;
  return count('DISCOVERY_SWITCHES') + count('PHASE2_SWITCHES') + fbCount;
})();

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
      if (l.switches !== EXPECTED_SWITCHES) failures.push(`${lang} ${width}: ${l.switches} switches, expected ${EXPECTED_SWITCHES}`);
      if (l.sections < 5) failures.push(`${lang} ${width}: ${l.sections} sections`);
      if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang} ${width}: not RTL`);
      for (const v of ['2787', '3770', '23', '1830']) if (!l.text.includes(v)) failures.push(`${lang} ${width}: value ${v} missing`);
      /* Source readiness: every named source, statuses as codes, LinkedIn honestly BLOCKED. */
      for (const v of ['myhome.ge', 'livo.ge', 'LinkedIn', 'Facebook groups', 'BLOCKED', 'WORKER_BROWSER']) if (!l.text.includes(v)) failures.push(`${lang} ${width}: readiness ${v} missing`);
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
  /* The OVERVIEW's switches; the Phase 2 intelligence panel loads on its own RPC. */
  const overviewSwitches = await failing.page.evaluate(() => [...document.querySelectorAll('[role="switch"]')]
    .filter((el) => !el.closest('[data-testid="discovery-intelligence"]') && !el.closest('[data-testid="find-buyers-center"]')).length);
  assert.equal(overviewSwitches, 0, 'switches rendered without data');

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

test('Find Buyers source network: discovered, verified, active and read stay apart, in every language and width', opts, async (t) => {
  if (skipReason) assert.fail(`admin discovery gate could not run: ${skipReason}`);
  for (const [lang, width] of [['en', 1440], ['ka', 390], ['ar', 390]]) {
    const { page, calls } = await boot(t, { lang, width, height: width < 700 ? 844 : 900 });
    await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const center = page.locator('[data-testid="find-buyers-center"]');
    await center.waitFor({ timeout: 20000 });
    const tabs = center.locator('[role="tab"]');
    assert.equal(await tabs.count(), 7, `${lang}: seven tabs`);
    await tabs.nth(3).click();
    await page.waitForSelector('[data-testid="fbx-source-network"]', { timeout: 20000 });
    assert.equal(calls.network, 1, `${lang}: the network loads on demand, once`);
    const totals = await page.evaluate(() => ['discovered', 'verified', 'active', 'read']
      .map((k) => document.querySelector(`[data-testid="fbx-net-total-${k}"] p:last-child`)?.textContent?.replace(/\D/g, '')));
    assert.deepEqual(totals, ['44', '11', '5', '6'], `${lang}: totals across platforms`);
    const text = await page.locator('[data-testid="fbx-source-network"]').innerText();
    assert.match(text, /TELEGRAM/);
    assert.match(text, /ka, ru, en, ar, he, tr/, `${lang}: the six searched languages are shown`);
    assert.match(text, /BATUMI/, `${lang}: a community's city is shown`);
    assert.match(text, /75% about property/, `${lang}: the audit finding is shown`);
    const phases = await page.locator('[data-testid="fbx-net-phases"]').innerText();
    assert.match(phases, /DONE 2/, `${lang}: Phase 1 queue`);
    assert.match(phases, /RETRY_WAIT 4/, `${lang}: Phase 2 held`);
    assert.match(phases, /FULL_DISCOVERY/, `${lang}: the budget rationale`);
    assert.match(phases, /A 1 \/ B 4/, `${lang}: source-dependent vs independent search`);
    assert.ok(await page.locator('[data-testid="fbx-net-directory"]').count() === 1, `${lang}: the posting directory is on its own line`);
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.getAttribute('dir') }));
    assert.ok(layout.overflow <= 1, `${lang}@${width}: no page-level horizontal scroll (${layout.overflow}px)`);
    if (lang === 'ar') assert.equal(layout.dir, 'rtl');
  }
});
