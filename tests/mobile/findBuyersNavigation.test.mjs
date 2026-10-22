// FIND BUYERS NAVIGATION — Back means the previous SCREEN (harness build, real browser).
//
//   * the live results page pushes no same-screen history: "Review Budget" is a button
//     (it was <a href="#rb-title">), result pages replace ?rp=, so the top-left Back
//     leaves the screen instead of popping to the same one and only scrolling;
//   * "Edit search" / property Edit return to where they were opened from; a deep link
//     to /property/P/edit returns to /property/P;
//   * a Find Buyers notification opens THE search (/buyers/external?job=J), including
//     rows stored with the old generic /matches link;
//   * the browser's own Back (Android hardware Back) lands where the in-app Back does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4395;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const P = '22222222-2222-2222-2222-222222222222';
const property = {
  id: P, user_id: 'u1', title: '2-bedroom apartment in Krtsanisi', transaction_type: 'SALE', property_type: 'APARTMENT', homatch_id: 482913,
  contact_phone_e164: '+995555123456', is_deleted: false, created_at: new Date().toISOString(), photos: [],
  facts: [{ city: 'Tbilisi', district: 'Krtsanisi', total_price: 120000, currency: 'USD', bedrooms: 2, area: 75 }],
};
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const agoSec = (s) => new Date(Date.now() - s * 1000).toISOString();
const lead = (id, job = 'job1') => ({
  id, matching_job_id: job, counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 88, strength: 'STRONG',
  similarity: 86, intent_score: 90, signal_count: 1, signal_at: ago(1), seen_before: false, language: 'en', created_at: ago(1),
  author_name: `Person ${id}`, author_profile_url: `https://www.facebook.com/profile.php?id=${id}`, match_category: 'STRONG', budget_fit: 'COMPATIBLE', location_fit: 'UNKNOWN',
  qualification: { resultType: 'DIRECT', intent: 'ACTIVE_BUYER', signals: ['EXPLICIT_BUY'], limitations: [] },
  score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['location', 'rooms'], parentAgeDays: null } },
  evidence: [{ signalId: `s-${id}`, parentSignalId: null, kind: 'POST', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 90, similarity: 86, ageDays: 1,
    text: 'Looking for a 2-bedroom apartment in Krtsanisi up to $130,000.', url: `https://www.facebook.com/groups/tbilisiapartments/posts/${id}/`,
    parentUrl: null, parentExcerpt: null, language: 'en', publishedAt: ago(1) }],
});
/* Twelve current leads of the live search (two result pages of nine) and two of an older, finished one. */
const LEADS = [...Array.from({ length: 12 }, (_, i) => lead(`d${i + 1}`)), lead('o1', 'job-old'), lead('o2', 'job-old')];

const campaign = (state, over = {}) => ({
  jobId: 'job1', campaignId: 'c1', state, stage: null, active: ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'].includes(state),
  createdAt: agoSec(700), startedAt: agoSec(605), completedAt: null, pausedAt: null, lastActivityAt: agoSec(3), transaction: 'SALE', languages: ['ka', 'en'],
  queue: { total: 8, queued: 2, running: 3, done: 3, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 3, succeeded: 3, failed: 0 },
  sources: [{ source: 'FACEBOOK', state: 'RUNNING', total: 8, running: 3, queued: 2, done: 3, failed: 0, results: 12, checked: 40, communities: 0, qualified: 12 }],
  signalsAnalyzed: 40, staleSkipped: 0, duplicatesRemoved: 0, newResults: 12, newLeads: 12, newMatches: 0, strong: 12, executed: true, failureReason: null, ...over,
});
const READY = { ready: true, reason: null, sources: ['FACEBOOK'] };

/* A notification stored before 20261112090000: generic /matches link, but it names the job. */
const OLD_NOTICE = {
  id: '00000000-0000-0000-0000-00000000aa01', user_id: 'u1', type: 'CAMPAIGN_COMPLETED', title: 'Search finished: 2 new results',
  body: 'Open the search to review them.', read: false, priority: 'NORMAL', deep_link: `/property/${P}/matches`,
  entity_type: 'matching_jobs', entity_id: 'job-old', metadata: {}, created_at: agoSec(60),
};

async function boot(t, { width = 390, height = 844, status = { readiness: READY, campaign: campaign('PARTIAL_RESULTS') }, notifications = [], leads = LEADS } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', 'en'); },
    ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  if (process.env.FB_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const json = (b, code = 200) => ({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const ranged = (rows) => ({ ...json(rows), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? profile : [profile]));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(wantsObject ? property : [property]));
    if (url.includes('/rest/v1/notifications')) return r.fulfill(req.method() === 'GET' ? ranged(notifications) : json([]));
    if (url.includes('/rest/v1/find_buyers_current_leads')) {
      const u = new URL(url);
      const job = u.searchParams.get('matching_job_id'); const one = u.searchParams.get('id');
      return r.fulfill(ranged(leads.filter((l) => (!job || `eq.${l.matching_job_id}` === job) && (!one || `eq.${l.id}` === one))));
    }
    if (url.includes('/rpc/find_buyers_research_opportunities')) return r.fulfill(json([]));
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json(status));
    if (url.includes('/rest/v1/matches')) return r.fulfill(ranged([]));
    if (url.includes('/rpc/billing_budget_offer')) return r.fulfill(json({ ok: true, offer: 'PAYG_FULL', estimate_min_credits: 17.5, estimate_max_credits: 32.5, available_balance: 99832.03, min_viable_budget_credits: 50 }));
    if (url.includes('/rpc/billing_my_budget_choices')) return r.fulfill(json({ ok: true, balance: 99832.03, min_viable: 50, allow_custom: true, recommended: 100,
      presets: [50, 100, 500, 1000, 1500, 2000].map((c) => ({ credits: c, affordable: true, viable: true, recommended: c === 100 })) }));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 5, creditsPerUsd: 10, minCredits: 50 }));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page };
}

const path = (page) => new URL(page.url()).pathname;
/** The shell's top-left Back (SmartBack): a plain button labelled "Back". */
const shellBack = (page) => page.getByRole('button', { name: 'Back', exact: true }).first();
/* The live page re-renders on every status tick, so Playwright's "stable" wait can starve:
   wait for the control, then press it the way a tap does. */
async function clickPage2(page) {
  /* At 390px the numbered cells are hidden (sm:flex); the phone pages with "next". */
  const btn = page.locator('[data-testid="fbx-results"] nav > button').last();
  await btn.waitFor({ timeout: 30000 });
  await btn.dispatchEvent('click');
}
const toPath = (page, p) => page.waitForURL((u) => new URL(u).pathname === p, { timeout: 30000 });
/* The shell's Back on a screen that has just rendered: a press can land before the new route
   has bound its handler (CI, 2026-10-18). Press, and press again only while still on `from`. */
async function backTo(page, from, to) {
  for (let i = 0; i < 3 && path(page) === from; i++) {
    await shellBack(page).waitFor({ timeout: 30000 });
    await shellBack(page).click();
    await page.waitForURL((u) => new URL(u).pathname !== from, { timeout: 8000 }).catch(() => undefined);
  }
  await toPath(page, to);
}

test('live results: Review Budget and page 2 add no history; Back leaves for the dashboard (not a scroll)', opts, async (t) => {
  /* Finished, so "New search" is offered; only this search's leads, so it is the one shown. */
  const { page } = await boot(t, { status: { readiness: READY, campaign: campaign('COMPLETED_WITH_RESULTS', { completedAt: agoSec(5) }) },
    leads: LEADS.filter((l) => l.matching_job_id === 'job1') });
  await page.goto(`${BASE}/property/${P}/matches`, { waitUntil: 'domcontentloaded' });
  /* In-app to the results page: the dashboard's new-search control or its link to the results
     (which one is the dashboard's business), then the live module's launch opens the budget step. */
  const go = page.locator('[data-testid="fbd-primary-action"], main a[href*="/buyers/external"] >> visible=true').first();
  await go.waitFor({ timeout: 30000 });
  const entries = await page.evaluate(() => history.length);
  await go.click();
  await toPath(page, `/property/${P}/buyers/external`);
  const review = page.locator('[data-testid="rb-review"]');
  if (!(await review.isVisible().catch(() => false))) {
    await page.waitForSelector('[data-testid="fbl-launch"], [data-testid="rb-review"]', { timeout: 30000 });
    if (!(await review.isVisible().catch(() => false))) await page.click('[data-testid="fbl-launch"]');
  }
  /* "Review Budget" must not push #rb-title. */
  await review.waitFor({ timeout: 30000 });
  assert.equal(await page.locator('[data-testid="research-budget"] a[href^="#"]').count(), 0, 'no fragment link inside the budget step');
  /* $5 minimum (owner, 2026-10-19): the ladder starts at 50 credits, chosen by default; 49 is refused. */
  assert.equal(await page.locator('[data-testid="research-budget"] [role="radio"]').first().getAttribute('data-testid'), 'rb-preset-50', 'the first rung is 50 credits');
  assert.equal(await page.locator('[data-testid="rb-preset-50"]').getAttribute('aria-checked'), 'true', '50 credits is the default choice');
  await page.click('[data-testid="rb-preset-custom"]');
  await page.fill('[data-testid="rb-custom-input"]', '49');
  assert.match(await page.locator('[data-testid="research-budget"] [role="alert"]').textContent(), /50/, 'below 50 credits is refused, naming the minimum');
  await page.fill('[data-testid="rb-custom-input"]', '50');
  assert.equal(await page.locator('[data-testid="research-budget"] [role="alert"]').count(), 0, 'exactly 50 credits is accepted');
  await page.click('[data-testid="rb-preset-50"]');
  await page.click('[data-testid="rb-review"]');
  assert.equal(new URL(page.url()).hash, '', 'Review Budget does not touch the URL');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="rb-review"]', { state: 'detached', timeout: 10000 });
  /* Page 2 of the results replaces the entry. */
  await page.waitForSelector('[data-testid="fbx-lead-card"]', { timeout: 30000 });
  await clickPage2(page);
  await page.waitForFunction(() => new URLSearchParams(location.search).get('rp') === '2', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => history.length), entries + 1, 'one entry for the results screen, none for the dialog or the page number');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shellBack(page).click();
  await toPath(page, `/property/${P}/matches`);
  assert.equal(path(page), `/property/${P}/matches`, 'Back changed the screen');
});

test('browser Back (Android hardware Back) lands where the in-app Back does', opts, async (t) => {
  const { page } = await boot(t);
  await page.goto(`${BASE}/property/${P}/matches`, { waitUntil: 'domcontentloaded' });
  /* Any in-app link from the dashboard to the external results (its exact control is the dashboard's own business). */
  const toResults = page.locator('main a[href*="/buyers/external"] >> visible=true').first();
  await toResults.waitFor({ timeout: 30000 });
  await toResults.click();
  await toPath(page, `/property/${P}/buyers/external`);
  await page.waitForSelector('[data-testid="fbx-lead-card"]', { timeout: 30000 });
  await clickPage2(page);
  await page.waitForFunction(() => new URLSearchParams(location.search).get('rp') === '2', null, { timeout: 10000 });
  await page.goBack();
  await toPath(page, `/property/${P}/matches`);
  /* Forward again, then the in-app Back: the same destination. */
  await page.goForward();
  await toPath(page, `/property/${P}/buyers/external`);
  await shellBack(page).click();
  await toPath(page, `/property/${P}/matches`);
});

test('Edit search from the Find Buyers dashboard: Back returns to the dashboard', opts, async (t) => {
  const { page } = await boot(t);
  await page.goto(`${BASE}/property/${P}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbh-edit-search"]', { timeout: 30000 });
  await page.click('[data-testid="fbh-edit-search"]');
  await toPath(page, `/property/${P}/edit`);
  assert.equal(await page.getByText('Back to portfolio').count(), 0, 'one Back control, the shell\'s');
  await backTo(page, `/property/${P}/edit`, `/property/${P}/matches`);
  /* A reload loses the in-memory history table; the opener's `from` still decides. */
  await page.goForward();
  await toPath(page, `/property/${P}/edit`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await backTo(page, `/property/${P}/edit`, `/property/${P}/matches`);
});

test('a deep link to /property/P/edit: Back goes to the property, never the portfolio', opts, async (t) => {
  const { page } = await boot(t);
  await page.goto(`${BASE}/property/${P}/edit`, { waitUntil: 'domcontentloaded' });
  await shellBack(page).waitFor({ timeout: 30000 });
  await shellBack(page).click();
  await toPath(page, `/property/${P}`);
});

test('Edit from the property page: Back returns to the property', opts, async (t) => {
  const { page } = await boot(t, { width: 1280, height: 900 });
  await page.goto(`${BASE}/property/${P}`, { waitUntil: 'domcontentloaded' });
  const edit = page.locator(`main a[href="/property/${P}/edit"]`).first();
  await edit.waitFor({ timeout: 30000 });
  await edit.click();
  await toPath(page, `/property/${P}/edit`);
  await shellBack(page).click();
  await toPath(page, `/property/${P}`);
});

test('a Find Buyers notification opens that search, even one stored with the old /matches link', opts, async (t) => {
  const { page } = await boot(t, { notifications: [OLD_NOTICE] });
  await page.goto(`${BASE}/notifications`, { waitUntil: 'domcontentloaded' });
  const row = page.getByText('Search finished: 2 new results').first();
  await row.waitFor({ timeout: 30000 });
  await row.click();
  await page.waitForURL((u) => new URL(u).pathname === `/property/${P}/buyers/external` && new URL(u).searchParams.get('job') === 'job-old', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="fbx-results"]')?.getAttribute('data-job') === 'job-old', null, { timeout: 30000 });
  /* The older search's own results, not the running one's. */
  const people = await page.locator('[data-testid="fbx-lead-card"]').allInnerTexts();
  assert.ok(people.length > 0 && people.every((txt) => /Person o\d/.test(txt)), `only job-old leads: ${people.length}`);
});
