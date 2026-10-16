// FIND BUYERS / FIND TENANTS — the customer UX of 2026-10-16, in a real browser
// (harness build; fixtures shaped like production rows):
//   * a successful start, from the property page or the results page, lands on
//     /property/:id/buyers/external with the live module in view and no stale
//     one-shot params;
//   * tab / filter changes replace history: Back leaves the results page;
//   * the elapsed time is computed from the server's timestamps, survives a
//     reload, and freezes while paused;
//   * the compact card is at most ~150px tall at 390px; the lead detail page
//     renders and Back returns to the results;
//   * three tabs with real counts; sellers / rejected readings never listed;
//     research opportunities merge the optional RPC with the lead-derived posts;
//   * ar / he render RTL without overflow at 320–430px; reduced motion draws a
//     still frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4371;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FIND_BUYERS_UX_SHOTS || null;

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
const PROPERTY_ID = '22222222-2222-2222-2222-222222222222';
const property = {
  id: PROPERTY_ID, user_id: 'u1', title: '2-bedroom apartment in Krtsanisi', transaction_type: 'SALE', property_type: 'APARTMENT',
  contact_phone_e164: '+995555123456', is_deleted: false, created_at: new Date().toISOString(), photos: [],
  facts: [{ city: 'Tbilisi', district: 'Krtsanisi', total_price: 120000, currency: 'USD', bedrooms: 2, area: 75 }],
};
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const agoSec = (s) => new Date(Date.now() - s * 1000).toISOString();

const POST = 'https://www.facebook.com/groups/tbilisiapartments/posts/9911/';
const lead = (id, over = {}) => ({
  id, matching_job_id: 'job1', counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 88, strength: 'STRONG',
  similarity: 86, intent_score: 90, signal_count: 1, signal_at: ago(1), seen_before: false, language: 'ru', created_at: ago(1),
  author_name: `Person ${id}`, author_profile_url: `https://www.facebook.com/profile.php?id=${id}`, match_category: 'STRONG', budget_fit: 'COMPATIBLE', location_fit: 'UNKNOWN',
  qualification: { resultType: 'DIRECT', intent: 'ACTIVE_BUYER', signals: ['EXPLICIT_BUY'], limitations: ['MORTGAGE_MENTIONED'] },
  score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['location', 'rooms'], parentAgeDays: null } },
  evidence: [{ signalId: `s-${id}`, parentSignalId: null, kind: 'POST', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 90, similarity: 86, ageDays: 1,
    text: 'Ищу 2-комнатную квартиру в Крцаниси до 130 000$. Рассмотрю ипотеку, без посредников. Пишите в личку, пожалуйста — срочно, переезжаю в следующем месяце и хочу посмотреть несколько вариантов.',
    url: `https://www.facebook.com/groups/tbilisiapartments/posts/${id}/`, parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(1) }],
  ...over,
});
const comment = (id, over = {}) => lead(id, {
  match_category: 'POTENTIAL', language: 'ar', qualification: { resultType: 'INTEREST', intent: 'PRICE_INQUIRY', signals: ['PRICE'] },
  evidence: [{ signalId: `s-${id}`, parentSignalId: 'p', kind: 'COMMENT', source: 'FACEBOOK', intentClass: 'BUYER_MEDIUM', intentScore: 60, similarity: 84, ageDays: 2,
    text: 'كم السعر؟ هل ما زالت متاحة؟', url: `${POST}?comment_id=${id}`, parentUrl: POST, parentExcerpt: 'იყიდება 2 საძინებლიანი ბინა კრწანისში', language: 'ar', publishedAt: ago(2),
    parentCommentCount: 60, parentAnalyzed: 20, signals: ['PRICE'] }],
  ...over,
});
const LEADS = [
  lead('d1'), lead('d2', { match_category: 'POTENTIAL', overall_score: 72, language: 'ka' }),
  lead('w1', { match_category: 'WEAK', overall_score: 51 }),
  lead('tu', { match_category: 'STRONG', qualification: { resultType: 'DIRECT', intent: 'ACTIVE_BUYER', signals: [], limitations: ['TRANSACTION_UNCONFIRMED'] } }),
  lead('agent', { role: 'AGENT', author_name: 'Broker Agency' }),
  lead('rej', { match_category: 'REJECTED', author_name: 'Rejected Seller' }),
  comment('c1'), comment('c2'),
];
const RESEARCH = [
  { signal_id: 'r1', url: POST, excerpt: 'dup of the lead-derived post', comments_state: 'NOT_INSPECTED', interested_count: 0, competitor: true, source: 'FACEBOOK', source_kind: 'GROUP', similarity: 80 },
  { signal_id: 'r2', url: 'https://www.facebook.com/groups/other/posts/77/', excerpt: 'იყიდება 3 ოთახიანი ბინა ვაკეში', language: 'ka', comments_state: 'NOT_INSPECTED', interested_count: 0, competitor: false, source: 'FACEBOOK', source_kind: 'GROUP', similarity: 70, published_at: ago(3) },
  { signal_id: 'r3', url: 'https://www.facebook.com/ads/library/?id=123', excerpt: 'Competitor ad', comments_state: 'NOT_INSPECTED', interested_count: 0, competitor: true, source: 'FACEBOOK', source_kind: 'AD', similarity: 66, published_at: ago(4) },
];

const campaign = (state, over = {}) => ({
  jobId: 'job1', campaignId: 'c1', state, stage: null, active: ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED'].includes(state),
  createdAt: agoSec(700), startedAt: agoSec(605), completedAt: null, pausedAt: null, lastActivityAt: agoSec(3), transaction: 'SALE', languages: ['ka', 'ru'],
  queue: { total: 8, queued: 2, running: 3, done: 3, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 3, succeeded: 3, failed: 0 },
  sources: [{ source: 'FACEBOOK', state: 'RUNNING', total: 8, running: 3, queued: 2, done: 3, failed: 0, results: 6, checked: 40, communities: 0, qualified: 3 }],
  signalsAnalyzed: 40, staleSkipped: 2, duplicatesRemoved: 1, newResults: 6, newLeads: 6, newMatches: 0, strong: 2, executed: true, failureReason: null, ...over,
});
const READY = { ready: true, reason: null, sources: ['FACEBOOK'] };
const IDLE = { readiness: READY, campaign: null };

async function boot(t, { width = 390, height = 844, lang = 'en', status = { readiness: READY, campaign: campaign('PARTIAL_RESULTS') }, leads = LEADS, research = RESEARCH, reduced = true } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  if (process.env.FB_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const calls = { start: 0, research: [] };
  const json = (b, code = 200) => ({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
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
    if (url.includes('/rest/v1/find_buyers_current_leads')) {
      const u = new URL(url);
      const job = u.searchParams.get('matching_job_id'); const one = u.searchParams.get('id');
      const rows = leads.filter((l) => (!job || `eq.${l.matching_job_id}` === job) && (!one || `eq.${l.id}` === one));
      return r.fulfill({ ...json(rows), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } });
    }
    if (url.includes('/rpc/find_buyers_research_opportunities')) {
      calls.research.push(JSON.parse(req.postData() ?? '{}'));
      return research === 'missing' ? r.fulfill(json({ message: 'function does not exist', code: 'PGRST202' }, 404)) : r.fulfill(json(research));
    }
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json(status));
    if (url.includes('/rest/v1/matching_jobs')) return r.fulfill(json(wantsObject ? { id: 'job-new' } : [{ id: 'job-new' }]));
    if (url.includes('/rest/v1/matches')) return r.fulfill({ ...json([]), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/0' } });
    if (url.includes('/rpc/billing_budget_offer')) return r.fulfill(json({ ok: true, offer: 'PAYG_FULL', estimate_min_credits: 17.5, estimate_max_credits: 32.5, available_balance: 99832.03, min_viable_budget_credits: 50 }));
    if (url.includes('/rpc/billing_my_budget_choices')) return r.fulfill(json({ ok: true, balance: 99832.03, min_viable: 50, allow_custom: true, recommended: 100,
      presets: [100, 250, 500, 1000].map((c) => ({ credits: c, affordable: true, viable: true, recommended: c === 100 })) }));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 10, creditsPerUsd: 10, minCredits: 100 }));
    if (url.includes('/functions/v1/match-campaign')) {
      calls.start += 1;
      /* From now on the server reports the new search as running. */
      status = { readiness: READY, campaign: campaign('SEARCHING', { jobId: 'job-new', startedAt: agoSec(1), createdAt: agoSec(2), newResults: 0, queue: { total: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, paused: 0 } }) };
      return r.fulfill(json({ jobId: 'job-new', campaignId: 'c1' }));
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls, setStatus: (s) => { status = s; } };
}

const results = (q = '') => `${BASE}/property/${PROPERTY_ID}/buyers/external${q}`;
const shot = async (page, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name), fullPage: true }); };

test('start from the results page: lands on the live module, one-shot and stale params dropped', opts, async (t) => {
  const { page, calls } = await boot(t, { status: IDLE });
  await page.goto(results('?start=1&job=job-old&rp=2&tab=interest'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="rb-start"]', { timeout: 30000 });
  assert.doesNotMatch(page.url(), /start=1/, '?start=1 is consumed on arrival');
  await page.click('[data-testid="rb-start"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="fbl-module"]')?.getAttribute('data-state') === 'SEARCHING', null, { timeout: 30000 });
  assert.equal(calls.start, 1);
  await page.waitForFunction(() => !/[?&](start|job|rp)=/.test(location.search), null, { timeout: 10000 });
  assert.match(page.url(), /\/property\/[^/]+\/buyers\/external(\?tab=interest)?$/);
  await page.waitForTimeout(600);
  const inView = await page.evaluate(() => { const r = document.querySelector('[data-testid="fbl-module"]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
  assert.ok(inView, 'the live module is in view');
  assert.equal(await page.locator('[data-testid="search-starting"]').count(), 0, 'no extra dialog step');
  assert.equal(await page.getAttribute('[data-testid="fbx-results"]', 'data-job'), 'job-new', 'the results follow the new search before its first lead');
});

test('start from the property page: navigates straight to /buyers/external (no timer, no dashboard detour)', opts, async (t) => {
  const { page, calls } = await boot(t, { status: IDLE, width: 1280, height: 900 });
  await page.goto(`${BASE}/property/${PROPERTY_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="pow-discovery"]', { timeout: 30000 });
  await page.locator('[data-testid="pow-discovery"] button').filter({ hasText: /Find|Search/i }).first().click();
  await page.waitForSelector('[data-testid="rb-start"]', { timeout: 20000 });
  await page.click('[data-testid="rb-start"]');
  await page.waitForURL(/\/property\/[^/]+\/buyers\/external$/, { timeout: 30000 });
  assert.equal(calls.start, 1);
  await page.waitForFunction(() => document.querySelector('[data-testid="fbl-module"]')?.getAttribute('data-state') === 'SEARCHING', null, { timeout: 30000 });
  /* Back returns to the property, not through a replayed start. */
  await page.goBack();
  await page.waitForURL(/\/property\/[^/]+$/, { timeout: 15000 });
});

test('tab and filter changes replace history: Back leaves the results page', opts, async (t) => {
  const { page } = await boot(t);
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbd-external-view"]', { timeout: 30000 });
  await page.click('[data-testid="fbd-external-view"]');
  await page.waitForSelector('[data-testid="fbx-tab-interest"]', { timeout: 30000 });
  await page.click('[data-testid="fbx-tab-interest"]');
  await page.click('[data-testid="fbx-tab-opportunities"]');
  await page.click('[data-testid="fbx-filters-open"]');
  await page.click('[data-testid="fbx-fresh-week"]');
  await page.click('[data-testid="fbx-filter-lang"][data-lang="ka"]');
  await page.click('[data-testid="fbx-filters-done"]');
  await page.waitForFunction(() => /fresh=week/.test(location.search) && /sl=ka/.test(location.search) && /tab=opportunities/.test(location.search));
  assert.equal(await page.innerText('[data-testid="fbx-filters-count"]'), '2');
  await page.goBack();
  await page.waitForURL(/\/matches$/, { timeout: 15000 });
});

test('elapsed time: from server timestamps, survives a reload, frozen while paused, ends at completion', opts, async (t) => {
  const { page, setStatus } = await boot(t);
  await page.goto(results(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbl-elapsed-value"]', { timeout: 30000 });
  const secs = (s) => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  const first = secs(await page.innerText('[data-testid="fbl-elapsed-value"]'));
  assert.ok(first >= 600 && first < 680, `started ~605 s ago on the server: ${first}`);
  assert.equal(await page.getAttribute('[data-testid="fbl-elapsed-value"]', 'dir'), 'ltr');
  await page.waitForTimeout(2200);
  const later = secs(await page.innerText('[data-testid="fbl-elapsed-value"]'));
  assert.ok(later >= first + 1, 'the clock moves while searching');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbl-elapsed-value"]', { timeout: 30000 });
  const reloaded = secs(await page.innerText('[data-testid="fbl-elapsed-value"]'));
  assert.ok(reloaded >= later, `a reload does not restart the clock (${reloaded} ≥ ${later})`);
  setStatus({ readiness: READY, campaign: campaign('PAUSED', { pausedAt: agoSec(300), runs: { inFlight: 0, succeeded: 3, failed: 0 } }) });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbl-elapsed-value"]', { timeout: 30000 });
  const paused = await page.innerText('[data-testid="fbl-elapsed-value"]');
  assert.equal(secs(paused), 305, 'frozen at pausedAt − startedAt');
  await page.waitForTimeout(1500);
  assert.equal(await page.innerText('[data-testid="fbl-elapsed-value"]'), paused, 'no tick while paused');
  assert.equal(await page.getAttribute('[data-testid="fbl-field"]', 'data-mode'), 'paused');
  setStatus({ readiness: READY, campaign: campaign('COMPLETED_WITH_RESULTS', { completedAt: agoSec(5), active: false }) });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbl-elapsed-value"]', { timeout: 30000 });
  assert.equal(secs(await page.innerText('[data-testid="fbl-elapsed-value"]')), 600);
  assert.match(await page.innerText('[data-testid="fbl-elapsed"]'), /Total time/);
});

test('primary view is simple; technical detail is one collapsed disclosure; the duration note never promises', opts, async (t) => {
  const { page } = await boot(t, { lang: 'ka' });
  await page.goto(results(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbl-duration-notice"]', { timeout: 30000 });
  assert.equal(await page.innerText('[data-testid="fbl-duration-notice"] p:last-child'),
    'მყიდველებისა და მოიჯარეების მოძიებას შესაძლოა 10–30 წუთი დასჭირდეს. დრო დამოკიდებულია ძებნის მასშტაბსა და ხელმისაწვდომ წყაროებზე.');
  assert.equal(await page.locator('[data-testid="fbl-details"]').count(), 0, 'details collapsed');
  assert.equal(await page.locator('[data-testid="fbr-report"]').count(), 0, 'report collapsed');
  assert.equal(await page.getAttribute('[data-testid="fbl-details-toggle"]', 'aria-expanded'), 'false');
  await page.click('[data-testid="fbl-details-toggle"]');
  await page.waitForSelector('[data-testid="fbl-source-outcomes"]', { timeout: 5000 });
});

test('three tabs, real counts; sellers, brokers and rejected readings never listed; weak and unconfirmed need verification', opts, async (t) => {
  const { page, calls } = await boot(t);
  await page.goto(results(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbx-lead-card"]', { timeout: 30000 });
  const count = (k) => page.$eval(`[data-testid="fbx-tab-${k}"]`, (e) => e.textContent.match(/\d+/)[0]);
  /* Buyers: d1 (STRONG), d2 (POTENTIAL). Interested: w1 (WEAK), tu (buy/rent unstated), c1, c2. Agent and rejected: never. */
  assert.deepEqual([await count('direct'), await count('interest')], ['2', '4']);
  /* Opportunities: the lead-derived post (+ the duplicate research row merged into it), the research-only post, the competitor ad. */
  await page.waitForFunction(() => document.querySelector('[data-testid="fbx-tab-opportunities"]')?.textContent?.includes('3'), null, { timeout: 10000 });
  assert.deepEqual(calls.research.at(-1), { p_job_id: 'job1' });
  const main = await page.textContent('main');
  assert.doesNotMatch(main, /Broker Agency|Rejected Seller/);
  assert.match(main, /Qualified buyer/);
  await page.click('[data-testid="fbx-tab-interest"]');
  await page.waitForSelector('[data-testid="fbx-lead-card"][data-lead="w1"]');
  assert.equal(await page.getAttribute('[data-testid="fbx-lead-card"][data-lead="w1"]', 'data-verify'), 'true');
  assert.match(await page.innerText('[data-testid="fbx-lead-card"][data-lead="tu"] [data-testid="fbx-card-kind"]'), /buy or rent not stated/);
  assert.equal(await page.locator('[data-testid="fbx-verify-note"]').count(), 1);
  await page.click('[data-testid="fbx-tab-opportunities"]');
  await page.waitForSelector('[data-testid="fbo-card"]');
  const cards = await page.$$eval('[data-testid="fbo-card"]', (els) => els.map((e) => ({ src: e.getAttribute('data-source'), note: e.querySelector('[data-testid="fbo-card-note"]')?.textContent, state: e.querySelector('[data-testid="fbo-card-note"]')?.getAttribute('data-state') })));
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.find((c) => c.src === 'leads'), { src: 'leads', note: 'Potentially interested people found in the comments: 2', state: 'INSPECTED' });
  assert.ok(cards.some((c) => c.src === 'research' && /People interested in a similar type of apartment may be in the comments/.test(c.note)), 'not-inspected copy, no count');
  assert.ok(cards.some((c) => /competitor’s apartment.*not accessible from the ad/.test(c.note ?? '')), 'the ad: competitor copy + comments not accessible');
  for (const a of await page.$$eval('[data-testid="fbo-card-open"]', (as) => as.map((x) => ({ href: x.getAttribute('href'), rel: x.getAttribute('rel') })))) {
    assert.match(a.href, /^https:\/\//); assert.match(a.rel, /nofollow/);
  }
});

test('a missing research RPC degrades to the lead-derived opportunities', opts, async (t) => {
  const { page } = await boot(t, { research: 'missing' });
  await page.goto(results('?tab=opportunities'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbo-card"]', { timeout: 30000 });
  assert.equal(await page.locator('[data-testid="fbo-card"]').count(), 1);
  assert.equal(await page.locator('[data-testid="fbx-results-error"]').count(), 0, 'never an error for the optional source');
});

test('compact card ≤ 150px at 390px; detail page renders, separate intent / compatibility, Back returns', opts, async (t) => {
  const { page } = await boot(t, { width: 390, height: 844 });
  await page.goto(results(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbx-lead-card"]', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const heights = await page.$$eval('[data-testid="fbx-lead-card"]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  for (const h of heights) assert.ok(h <= 150, `card ${h}px tall`);
  await shot(page, 'ux-results-390-en.png');
  await page.click('[data-testid="fbx-lead-card"][data-lead="d1"] [data-testid="fbx-lead-details"]');
  await page.waitForSelector('[data-testid="fbld-detail"]', { timeout: 20000 });
  assert.equal(await page.getAttribute('[data-testid="fbld-classification"]', 'data-tab'), 'direct');
  assert.equal(await page.locator('[data-testid="fbld-intent"]').count(), 1);
  assert.equal(await page.locator('[data-testid="fbld-compat"]').count(), 1);
  assert.equal(await page.locator('[data-testid="fbld-compat"] [data-financing]').count() + await page.locator('[data-testid="fbld-limitations"]').count() >= 1, true);
  assert.equal(await page.getAttribute('[data-testid="fbld-evidence-item"] blockquote', 'lang'), 'ru');
  assert.equal(await page.getAttribute('[data-testid="fbld-evidence-item"] blockquote', 'dir'), 'auto');
  await shot(page, 'ux-detail-390-en.png');
  await page.getByRole('button', { name: /^back$/i }).first().click();
  await page.waitForURL(/\/buyers\/external$/, { timeout: 15000 });
  /* A deep link (no history) still goes Back to the results page. */
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/lead/d2`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbld-detail"]', { timeout: 20000 });
});

test('ar / he at 320–430px: results, filters and the lead detail fit, RTL', opts, async (t) => {
  const failures = [];
  for (const lang of ['ar', 'he', 'ka']) {
    for (const width of [320, 390, 430]) {
      const { page } = await boot(t, { lang, width, height: 800 });
      for (const [path, ready] of [[results(), '[data-testid="fbx-lead-card"]'], [results('?tab=opportunities'), '[data-testid="fbo-card"]'], [`${BASE}/property/${PROPERTY_ID}/buyers/lead/c1`, '[data-testid="fbld-detail"]']]) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(ready, { timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const l = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.getAttribute('dir'), text: document.body.innerText }));
        if (l.over > 1) failures.push(`${lang} ${width} ${path}: overflow ${l.over}px`);
        if (lang !== 'ka' && l.dir !== 'rtl') failures.push(`${lang} ${path}: not RTL`);
        if (/fbx_|fbl_|undefined|NaN/.test(l.text)) failures.push(`${lang} ${width} ${path}: raw key / undefined / NaN`);
      }
      await page.goto(results(), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="fbx-filters-open"]', { timeout: 60000 });
      await page.click('[data-testid="fbx-filters-open"]');
      await page.waitForSelector('[data-testid="fbx-filters"]');
      const f = await page.evaluate(() => { const r = document.querySelector('[data-testid="fbx-filters"]').getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
      if (f.left < 0 || f.right > f.vw + 1) failures.push(`${lang} ${width}: filters outside the screen`);
      if (width === 390) await shot(page, `ux-filters-390-${lang}.png`);
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});

test('reduced motion: one still frame; full motion: the field animates while searching', opts, async (t) => {
  const frame = (page) => page.$eval('[data-testid="fbl-field"] canvas', (c) => c.toDataURL());
  {
    const { page } = await boot(t, { reduced: true, width: 1280, height: 900 });
    await page.goto(results(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="fbl-field"] canvas', { timeout: 30000 });
    await page.waitForTimeout(400);
    assert.equal(await page.getAttribute('[data-testid="fbl-field"]', 'data-motion'), 'reduced');
    const a = await frame(page); await page.waitForTimeout(700); const b = await frame(page);
    assert.equal(a, b, 'reduced motion draws a still frame');
    await page.context().close();
  }
  {
    const { page } = await boot(t, { reduced: false, width: 1280, height: 900 });
    await page.goto(results(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="fbl-field"] canvas', { timeout: 30000 });
    await page.waitForTimeout(400);
    const a = await frame(page); await page.waitForTimeout(700); const b = await frame(page);
    assert.notEqual(a, b, 'the field moves while searching');
    await shot(page, 'ux-live-1280-en.png');
  }
});
