// FIND BUYERS / FIND TENANTS → potential buyer cards, in a real browser.
//
// Harness build, the Matches page of a SALE property answered by fixtures
// shaped like production find_buyers_leads rows: an Arabic comment under a
// comparable Krtsanisi listing, a Russian request post, and a lead whose
// stored links are unsafe. Checked at 1440px and 390px in all six locales:
//   * the card says WHY, shows the original text with its language and a
//     translate action (UI language), similarity/intent, age and source;
//   * every link is a real http(s) URL opening in a new tab with
//     noopener + noreferrer; unsafe links are never rendered as links;
//   * Translate calls match-campaign with the UI language and shows the
//     translation while keeping the original;
//   * no horizontal overflow; ar/he render RTL; no provider internals shown.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { matchDetailRows } from './propertyFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4357;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FIND_BUYERS_QA_SHOTS || null;
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
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const property = {
  id: PROPERTY_ID, user_id: 'u1', title: '2-bedroom apartment in Krtsanisi', transaction_type: 'SALE', property_type: 'APARTMENT',
  contact_phone_e164: '+995555123456', is_deleted: false, created_at: new Date().toISOString(), photos: [],
  facts: [{ city: 'Tbilisi', district: 'Krtsanisi', total_price: 120000, currency: 'USD', bedrooms: 2, area: 75 }],
};
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

const COMMENT_URL = 'https://www.facebook.com/groups/tbilisiapartments/posts/9911/?comment_id=777';
const POST_URL = 'https://www.facebook.com/groups/tbilisiapartments/posts/9911/';
const PROFILE_URL = 'https://www.facebook.com/profile.php?id=100012345678';
const AR_TEXT = 'مهتم. هل ما زالت متاحة؟ أرسل لي السعر من فضلك، أبحث عن شقة مشابهة في تبليسي';
const RU_TEXT = 'Ищу 2-комнатную квартиру в Крцаниси или Мтацминде до 130 000$, без посредников. Пишите в личку.';
const lead = (id, over) => ({
  id, matching_job_id: 'job1', counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 92, strength: 'STRONG',
  similarity: 91, intent_score: 92, signal_count: 1, signal_at: ago(2), seen_before: false, language: 'ar', created_at: ago(1),
  author_name: 'Layla A.', author_profile_url: PROFILE_URL,
  score_components: { why: { kind: 'COMMENT_ON_SIMILAR', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['location', 'area', 'price'], parentAgeDays: 3 } },
  evidence: [{ signalId: 's1', parentSignalId: 'p1', kind: 'COMMENT', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 92, similarity: 91, ageDays: 2,
    text: AR_TEXT, url: COMMENT_URL, parentUrl: POST_URL, parentExcerpt: 'იყიდება 2 საძინებლიანი ბინა კრწანისში, 78 კვ.მ, $125 000', language: 'ar', publishedAt: ago(2) }],
  ...over,
});
const LEADS = [
  lead('l1', {}),
  lead('l2', {
    source: 'VK', overall_score: 81, strength: 'STRONG', match_category: 'STRONG', similarity: 84, intent_score: 92, language: 'ru', author_name: 'Дмитрий К.',
    author_profile_url: 'https://vk.com/id12345', signal_count: 2,
    score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['price'], parentAgeDays: null } },
    evidence: [
      { signalId: 's2', parentSignalId: null, kind: 'POST', source: 'VK', intentClass: 'BUYER_HIGH', intentScore: 92, similarity: 84, ageDays: 4, text: RU_TEXT,
        url: 'https://vk.com/wall-123_456', parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(4) },
      { signalId: 's3', parentSignalId: null, kind: 'POST', source: 'VK', intentClass: 'BUYER_MEDIUM', intentScore: 68, similarity: 70, ageDays: 9, text: 'Актуально, ищу', url: null, parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(9) },
    ],
  }),
  lead('l3', {
    overall_score: 66, strength: 'GOOD', author_name: 'unsafe', author_profile_url: "javascript:alert('x')", language: 'en',
    evidence: [{ signalId: 's4', parentSignalId: null, kind: 'COMMENT', source: 'FACEBOOK', intentClass: 'BUYER_MEDIUM', intentScore: 68, similarity: 75, ageDays: 1,
      text: 'Interested, how much?', url: 'data:text/html,x', parentUrl: 'signal:abc', parentExcerpt: null, language: 'en', publishedAt: ago(1) }],
  }),
];

const STATUS_SEARCHING = {
  readiness: { ready: true, reason: null, sources: ['FACEBOOK', 'VK'] },
  campaign: {
    jobId: 'job1', campaignId: 'c1', state: 'PARTIAL_RESULTS', stage: null, active: true, createdAt: ago(0.01), startedAt: ago(0.01),
    completedAt: null, pausedAt: null, lastActivityAt: ago(0.001), transaction: 'SALE', languages: ['ka', 'ru', 'en', 'ar', 'he', 'tr'],
    queue: { total: 9, queued: 3, running: 4, done: 2, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 4, succeeded: 2, failed: 0 },
    sources: [
      { source: 'FACEBOOK', state: 'RUNNING', total: 5, running: 3, queued: 1, done: 1, failed: 0, results: 2 },
      { source: 'VK', state: 'RUNNING', total: 3, running: 1, queued: 1, done: 1, failed: 0, results: 1 },
      { source: 'REDDIT', state: 'QUEUED', total: 1, running: 0, queued: 1, done: 0, failed: 0, results: 0 },
    ],
    signalsAnalyzed: 38, staleSkipped: 6, duplicatesRemoved: 2, newResults: 3, newLeads: 3, newMatches: 0, strong: 1, executed: true, failureReason: null,
  },
};
const withState = (state, over = {}) => ({ ...STATUS_SEARCHING, campaign: { ...STATUS_SEARCHING.campaign, state, ...over } });
const MATCHES = matchDetailRows(30, PROPERTY_ID).map((m) => ({ ...m, demand_published_at: ago(3) }));

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = false, status = STATUS_SEARCHING, matches = [], jobs = [], leads = LEADS } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  if (process.env.FB_DEBUG) page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
  if (process.env.FB_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
  const translateCalls = [];
  const matchRequests = [];
  const settingWrites = [];
  const healthTests = [];
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    /* Real fonts: Georgian/Arabic/Hebrew glyph widths are what lay the page out in production. */
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    const who = admin ? { ...profile, is_admin: true, role: 'admin' } : profile;
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? who : [who]));
    if (url.includes('/rpc/admin_find_buyers_center')) return r.fulfill(json(CENTER));
    /* The other admin panels answer with an honest error: this suite covers Find Buyers only. */
    if (url.includes('/rpc/admin_discovery_')) return r.fulfill(json({ message: 'not in this fixture' }, 400));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(wantsObject ? property : [property]));
    if (url.includes('/rest/v1/find_buyers_current_leads')) {
      /* One search at a time: honour matching_job_id=eq.<job> like PostgREST does. */
      const job = new URL(url).searchParams.get('matching_job_id');
      const one = new URL(url).searchParams.get('id');
      const rows = (job ? leads.filter((l) => `eq.${l.matching_job_id}` === job) : leads).filter((l) => !one || `eq.${l.id}` === one);
      return r.fulfill({ ...json(rows), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } });
    }
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json(status));
    if (url.includes('/rest/v1/matches')) {
      /* Server pages: honour offset/limit (or Range) and report the total. */
      matchRequests.push(url);
      const u = new URL(url);
      const history = (u.searchParams.get('or') ?? '').includes('is.null');
      const rows = history ? [] : matches;
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? rows.length);
      const page = rows.slice(offset, offset + limit);
      return r.fulfill({ ...json(page), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range',
        'content-range': rows.length ? `${offset}-${offset + page.length - 1}/${rows.length}` : `*/0` } });
    }
    if (url.includes('/rpc/billing_budget_offer')) return r.fulfill(json({ ok: true, offer: 'PAYG_FULL', estimate_min_credits: 17.5, estimate_max_credits: 32.5, available_balance: 99832.03, min_viable_budget_credits: 50 }));
    if (url.includes('/rpc/billing_my_budget_choices')) return r.fulfill(json({ ok: true, balance: 99832.03, min_viable: 50, allow_custom: true, recommended: 100,
      presets: [100, 250, 500, 1000].map((c) => ({ credits: c, affordable: true, viable: true, recommended: c === 100 })) }));
    if (url.includes('/rpc/background_jobs_mine')) return r.fulfill(json(jobs));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 10, creditsPerUsd: 10, minCredits: 100 }));
    if (url.includes('/functions/v1/match-campaign')) {
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.action === 'translate') {
        translateCalls.push(body);
        return r.fulfill(json({ ok: true, translation: `[${body.targetLang}] translated`, sourceLang: 'ar', cached: false }));
      }
      return r.fulfill(json({}));
    }
    /* Admin → Providers, shaped like production: kill switch on, APIFY in the disabled list. */
    if (url.includes('/rest/v1/provider_health')) return r.fulfill(json(PROVIDER_HEALTH));
    if (url.includes('/rest/v1/admin_settings')) return r.fulfill(json(PROVIDER_SETTINGS));
    if (url.includes('/rpc/admin_set_setting')) { settingWrites.push(JSON.parse(req.postData() ?? '{}')); return r.fulfill(json(null)); }
    if (url.includes('/functions/v1/provider-health-check')) {
      const body = JSON.parse(req.postData() ?? '{}');
      healthTests.push(body);
      return r.fulfill(json({ provider: body.provider, status: 'REAL_TEST_PASSED', latency_ms: 120, error: null }));
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, translateCalls, matchRequests, settingWrites, healthTests, setStatus: (next) => { status = next; } };
}

const hp = (provider, status) => ({ provider, status, last_error: null, latency_ms: null, success_count: 3, failure_count: 0, last_tested_at: null, updated_at: '2026-10-04T10:00:00Z' });
const PROVIDER_HEALTH = [hp('APIFY', 'REAL_TEST_PASSED'), hp('DATAFORSEO', 'REAL_TEST_PASSED'), hp('OPENAI', 'REAL_TEST_PASSED')];
const PROVIDER_SETTINGS = [
  { key: 'provider_kill_switch', value: true },
  { key: 'provider_disabled_list', value: ['APIFY', 'DATAFORSEO', 'ZENROWS', 'SCRAPINGBEE', 'BRIGHTDATA'] },
];

/* Find Buyers 3.0: these fixtures are mostly comments under a comparable listing —
   interest signals — so the shared helper opens the Interest tab (Buyers would hold
   only the Russian request post). */
async function open(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/external?tab=interest`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbx-lead-card"]', { timeout: 30000 });
}
/* 2026-10-16: the technical view (tiles, per-source outcomes, profile, report) is one collapsed disclosure. */
async function openDetails(page) {
  await page.waitForSelector('[data-testid="fbl-details-toggle"]', { timeout: 30000 });
  if (await page.locator('[data-testid="fbl-details"]').count() === 0) await page.click('[data-testid="fbl-details-toggle"]');
  await page.waitForSelector('[data-testid="fbl-details"]', { timeout: 5000 });
}

const anchors = (page) => page.$$eval('main a[href^="http"], main a[href^="data:"], main a[href^="javascript:"], main a[href^="signal:"]', (as) => as.map((a) => ({
  href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '', text: a.textContent?.trim() ?? '',
})));

test('a compact card links only to its detail page; the detail explains why, keeps the original, links provenance, translates on request', opts, async (t) => {
  const { page, translateCalls } = await boot(t);
  await open(page);
  /* Interest tab: the Arabic question under a comparable listing, as a compact card. */
  const card = page.locator('[data-testid="fbx-lead-card"][data-lead="l1"]');
  const cardText = await card.innerText();
  assert.match(cardText, /Potentially interested person/, 'a question under a listing is an interested person, never a buyer');
  assert.doesNotMatch(cardText, /Qualified buyer|confirmed buyer/i);
  assert.ok((await card.textContent()).includes(AR_TEXT), 'the original Arabic is shown as written');
  assert.equal(await card.locator('a[href^="http"]').count(), 0, 'no external link on the list card');
  assert.match(await page.textContent('main'), /Extended research results/);
  assert.doesNotMatch(await page.textContent('main'), /memo23|apify|actor/i, 'no provider internals');
  await card.locator('[data-testid="fbx-lead-details"]').click();
  await page.waitForURL(/\/buyers\/lead\/l1$/, { timeout: 15000 });
  await page.waitForSelector('[data-testid="fbld-detail"]', { timeout: 20000 });
  const body = await page.textContent('main');
  assert.match(body, /Commented on a recently listed 2-bedroom apartment in Krtsanisi\. Similar size and price range\./);
  assert.match(body, /Original · Arabic/);
  assert.match(body, /Intent confidence/); assert.match(body, /Property compatibility/);
  assert.doesNotMatch(body, /memo23|apify|actor/i, 'no provider internals');
  let links = await anchors(page);
  for (const href of [COMMENT_URL, POST_URL, PROFILE_URL]) {
    const l = links.find((x) => x.href === href);
    assert.ok(l, `link to ${href}`);
    assert.equal(l.target, '_blank');
    assert.match(l.rel, /noopener/); assert.match(l.rel, /noreferrer/); assert.match(l.rel, /nofollow/);
  }
  for (const l of links) assert.match(l.href, /^https?:\/\//, `never a non-web link: ${l.href}`);
  assert.ok(links.some((l) => l.href === COMMENT_URL && /View original comment/.test(l.text)));
  await page.getByRole('button', { name: 'Translate to English' }).first().click();
  await page.waitForSelector('text=[en] translated');
  assert.equal(translateCalls[0].targetLang, 'en');
  assert.equal(translateCalls[0].signalId, 's1');
  assert.ok((await page.textContent('main')).includes(AR_TEXT), 'the original stays visible after translation');
  /* Back returns to the results page. */
  await page.getByRole('button', { name: /^back$/i }).first().click();
  await page.waitForURL(/\/buyers\/external\?tab=interest$/, { timeout: 15000 });
  /* Buyers tab: the Russian request post (reviewed STRONG) states its own intent. */
  await page.click('[data-testid="fbx-tab-direct"]');
  await page.waitForSelector('[data-testid="fbx-lead-card"][data-lead="l2"]', { timeout: 15000 });
  const buyers = await page.textContent('main');
  assert.match(buyers, /Strong interest/);
  assert.match(buyers, /Strong match/);
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/lead/l2`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbld-detail"]', { timeout: 20000 });
  assert.match(await page.textContent('main'), /Publicly asked for a 2-bedroom apartment in Krtsanisi\./);
  assert.match(await page.textContent('main'), /\+1 more public signals from this person/);
  assert.equal(await page.locator('[data-testid="fbld-evidence-item"]').count(), 2, 'every piece of evidence');
  links = await anchors(page);
  for (const href of ['https://vk.com/wall-123_456', 'https://vk.com/id12345']) assert.ok(links.find((x) => x.href === href), `link to ${href}`);
  /* The unsafe lead: none of its stored links render. */
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/lead/l3`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbld-detail"]', { timeout: 20000 });
  links = await anchors(page);
  for (const l of links) assert.match(l.href, /^https?:\/\//, `never a non-web link: ${l.href}`);
  assert.equal(await page.locator('[data-testid="fbld-copy"]').count(), 0, 'no copy action for an unsafe link');
  /* A lead that is not this property's says so. */
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/lead/nope`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbld-missing"]', { timeout: 20000 });
});

/* ── PRODUCTION REGRESSION (campaign d8b69c51, 2026-10-13): the latest search found 2
   WEAK leads, stored and readable, but they sorted behind 37 older leads in one
   property-wide list. The list now opens on the latest search, with its own counts. ── */
test('the latest search opens first: its 2 weak leads show without paging; earlier searches stay one tap away', opts, async (t) => {
  const older = Array.from({ length: 12 }, (_, i) => lead(`old${i}`, { matching_job_id: 'job-old', overall_score: 90 - i, created_at: ago(9), match_category: null }));
  const latest = [
    lead('new1', { matching_job_id: 'job-new', overall_score: 55, strength: 'POSSIBLE', created_at: ago(1), match_category: 'WEAK' }),
    lead('new2', { matching_job_id: 'job-new', overall_score: 47, strength: 'POSSIBLE', created_at: ago(1), match_category: 'WEAK' }),
  ];
  /* The running search is the latest one (job-new): a running search is the default even before its leads. */
  const { page } = await boot(t, { leads: [...older, ...latest], status: withState('PARTIAL_RESULTS', { jobId: 'job-new' }) });
  await open(page);
  await page.waitForSelector('[data-testid="fbx-results"]', { timeout: 20000 });
  const first = await page.evaluate(() => ({
    selected: document.querySelector('[data-testid="fbx-results"]')?.getAttribute('data-job'),
    weakGroup: document.querySelector('[data-testid="fbx-lead-group"][data-category="WEAK"]') !== null,
    groups: [...document.querySelectorAll('[data-testid="fbx-lead-group"]')].map((g) => g.getAttribute('data-category')),
  }));
  assert.equal(first.selected, 'job-new', 'the latest search is selected');
  /* Both leads are questions under a comparable listing: INTEREST, never buyers. */
  assert.deepEqual(first.groups, ['WEAK'], 'only the latest search\'s leads (Weak), never the older 12');
  const tabs = await page.evaluate(() => ['direct', 'interest', 'opportunities'].map((k) => document.querySelector(`[data-testid="fbx-tab-${k}"]`)?.textContent?.match(/\d+/)?.[0]));
  assert.deepEqual(tabs, ['0', '2', '1'], 'two interest signals under one post: one opportunity, zero buyers');
  /* Earlier searches live in the one Filters control. */
  await page.click('[data-testid="fbx-filters-open"]');
  await page.click('[data-testid="fbx-campaign-all"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="fbx-results"]')?.getAttribute('data-job') === 'all', null, { timeout: 10000 });
  assert.equal(await page.getAttribute('[data-testid="fbx-campaign-all"]', 'aria-checked'), 'true');
});

test('a failed results read says so and offers a retry — never "no results"', opts, async (t) => {
  const { page } = await boot(t);
  await page.route('**/rest/v1/find_buyers_current_leads**', (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' }));
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/external`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbx-results-error"]', { timeout: 20000 });
});

test('internal matches never start research; the one start action only opens the budget step', opts, async (t) => {
  const { page } = await boot(t, { status: IDLE });
  const calls = [];
  page.on('request', (req) => { const u = req.url(); if (u.includes('/rpc/') || u.includes('/functions/v1/')) calls.push(u.replace(/^.*\/(rpc|functions\/v1)\//, '')); });
  await page.route('**/rpc/internal_leads_request_matching', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: 'true' }));
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbd-internal-view"]', { timeout: 20000 });
  assert.equal(await page.locator('[data-testid="fbd-internal-start"]').count(), 0, 'one button for internal matches');
  const before = calls.length;
  /* The RPC first awaits the auth session, so wait for the request itself, not a fixed delay. */
  const asked = page.waitForRequest((req) => req.url().includes('/rpc/internal_leads_request_matching'), { timeout: 15000 });
  await page.click('[data-testid="fbd-internal-view"]');
  await page.waitForURL(/\/buyers\/internal$/, { timeout: 15000 });
  await asked;
  await page.waitForTimeout(300);
  const opened = calls.slice(before);
  assert.ok(opened.some((c) => c.startsWith('internal_leads_request_matching')), 'the internal matcher was asked');
  assert.ok(!opened.some((c) => /match-campaign|billing_|wallet|reserve/.test(c)), `internal matches made no charging call: ${opened.join(', ')}`);
  /* The one primary action opens the budget step on the results page; nothing launches. */
  await page.goBack();
  await page.waitForSelector('[data-testid="fbd-primary-action"]', { timeout: 20000 });
  /* Once the searches are read, the property has one: "start a new search". */
  await page.waitForFunction(() => document.querySelector('[data-testid="fbd-primary"]')?.getAttribute('data-mode') === 'start_new', null, { timeout: 15000 });
  await page.click('[data-testid="fbd-primary-action"]');
  await page.waitForURL(/\/buyers\/external/, { timeout: 15000 });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  assert.ok(!calls.some((c) => c.startsWith('match-campaign')), 'opening the budget step launches nothing');
});

/* ── FIND BUYERS 3.0: dashboard → External Discovery → Post Opportunity ── */
const OPP_POST = 'https://www.facebook.com/groups/77/permalink/185000';
const oppLead = (n, signals, text) => lead(`opp${n}`, {
  matching_job_id: 'job-opp', overall_score: 40 + n, strength: 'POSSIBLE', created_at: ago(1), match_category: 'POTENTIAL', author_name: `Person ${n}`, author_profile_url: `https://www.facebook.com/person.${n}`,
  score_components: { why: { kind: 'COMMENT_ON_SIMILAR', agreed: ['location', 'area'] } },
  qualification: { resultType: 'INTEREST', intent: signals.includes('VIEWING') ? 'VIEWING_INQUIRY' : 'PRICE_INQUIRY', signals },
  evidence: [{ signalId: `s${n}`, parentSignalId: 'pp', kind: 'COMMENT', source: 'FACEBOOK', intentClass: 'BUYER_MEDIUM', intentScore: 60, similarity: 84, ageDays: 2,
    text, url: `${OPP_POST}?comment_id=${n}`, parentUrl: OPP_POST, parentExcerpt: 'იყიდება 2 საძინებლიანი ბინა კრწანისში, 100 კვ.მ, $185 000', language: 'ka', publishedAt: ago(2),
    parentCommentCount: 240, parentAnalyzed: 40, parentPublishedAt: ago(5), parentFacts: { price: 185000, currency: 'USD', areaSqm: 100, bedrooms: 2, district: 'krtsanisi' }, signals }],
});
const OPP_LEADS = [
  oppLead(1, ['PRICE'], 'ფასი რა არის?'), oppLead(2, ['PRICE', 'VIEWING'], 'რა ღირს და ხვალ ნახვა შეიძლება?'), oppLead(3, ['VIEWING'], 'Can I visit tomorrow?'),
  oppLead(4, ['FINANCING'], 'Is a mortgage possible?'),
  lead('direct1', { matching_job_id: 'job-opp', overall_score: 88, strength: 'STRONG', created_at: ago(1), match_category: 'STRONG',
    qualification: { resultType: 'DIRECT', intent: 'ACTIVE_BUYER', signals: ['EXPLICIT_BUY'] } }),
];

test('the dashboard is one journey: criteria, one action, the latest search with its own counts, no lead list', opts, async (t) => {
  const { page } = await boot(t, { status: IDLE, leads: OPP_LEADS });
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fb-dashboard"]', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="fbd-latest-people"]')?.textContent?.includes('5'), null, { timeout: 20000 });
  const d = await page.evaluate(() => ({
    people: document.querySelector('[data-testid="fbd-latest-people"]')?.textContent,
    opps: document.querySelector('[data-testid="fbd-latest-opportunities"]')?.textContent,
    fresh: document.querySelector('[data-testid="fbd-latest-new"]')?.textContent,
    again: document.querySelector('[data-testid="fbd-latest-again"]')?.textContent,
    cards: document.querySelectorAll('article[aria-label] a[href^="https://"]').length,
    previous: document.querySelectorAll('[data-testid="fbd-previous-item"]').length,
    edit: document.querySelector('[data-testid="fbh-edit-search"]')?.getAttribute('href'),
    criteria: document.querySelector('[data-testid="fbh-criteria"]')?.textContent ?? '',
  }));
  assert.deepEqual({ people: d.people, opps: d.opps, fresh: d.fresh, again: d.again }, { people: '5', opps: '1', fresh: '5', again: '0' },
    '1 strong + 4 needing qualification = 5 people, 1 post opportunity — never added together');
  assert.equal(d.cards, 0, 'no lead cards on the dashboard');
  assert.equal(d.previous, 0, 'one search: nothing previous');
  assert.match(d.edit ?? '', /\/property\/[^/]+\/edit$/, 'Edit search opens the listing, it never starts a search');
  assert.match(d.criteria, /Expected budget/, 'the search criteria are the property\'s own');
  await page.click('[data-testid="fbd-latest-open"]');
  await page.waitForURL(/\/buyers\/external$/, { timeout: 15000 });
  await page.waitForSelector('[data-testid="fbx-tab-direct"][aria-selected="true"]', { timeout: 20000 });
  await page.click('[data-testid="fbx-tab-opportunities"]');
  await page.waitForSelector('[data-testid="fbo-card"]', { timeout: 15000 });
  assert.equal(await page.locator('[data-testid="fbo-card"]').count(), 1, 'one post, one opportunity');
  await page.click('[data-testid="fbo-card"]');
  await page.waitForSelector('[data-testid="fbo-detail"]', { timeout: 20000 });
  const o = await page.evaluate(() => Object.fromEntries(['total', 'analyzed', 'people', 'signals'].map((k) => [k, document.querySelector(`[data-testid="fbo-stat-${k}"]`)?.textContent])));
  assert.deepEqual(o, { total: '240', analyzed: '40', people: '4', signals: '5' }, '240 comments, 40 analyzed, 4 people, 5 signals (one comment asked two things)');
  assert.ok(await page.locator('[data-testid="fbo-unread"]').count(), 'the 200 unread comments are named, never estimated');
  const summary = await page.locator('[data-testid="fbo-summary"]').innerText();
  assert.match(summary, /40 comments analyzed/, 'what was actually read');
  assert.match(summary, /Price: 2 · Viewing: 2 · Financing: 1/, 'what people asked, from real comments');
  assert.match(summary, /2 days ago/, 'how recently');
  assert.doesNotMatch(summary, /240/, 'the platform total is never presented as analyzed or as people');
  assert.deepEqual(await page.locator('[data-testid="fbo-agreed"] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-dim'))), ['location', 'area'], 'only stored agreements');
  assert.match(await page.locator('[data-testid="fbo-comparison"]').innerText(), /65,000|65 000|65.000/, 'owner $120,000 vs comparable $185,000');
  assert.equal(await page.locator('[data-testid="fbo-open-post"]').getAttribute('href'), OPP_POST);
  assert.equal(await page.locator('[data-testid="fbo-evidence"] li').count(), 4);
  await page.getByRole('button', { name: /^back$/i }).first().click();
  await page.waitForURL(/\/buyers\/external/, { timeout: 15000 });
});

test('phones 320–430px (ka, ar, he): dashboard, external tabs and an opportunity fit, with RTL for ar/he', opts, async (t) => {
  const failures = [];
  for (const width of [320, 390, 430]) {
    for (const lang of ['ka', 'ar', 'he']) {
      const { page } = await boot(t, { width, height: 800, lang, status: IDLE, leads: OPP_LEADS });
      for (const [path, ready] of [['matches', '[data-testid="fb-dashboard"]'], ['buyers/external?tab=opportunities', '[data-testid="fbo-card"]']]) {
        await page.goto(`${BASE}/property/${PROPERTY_ID}/${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(ready, { timeout: 60000 }); // nine cold boots in one test: allow a loaded CI runner
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const l = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.getAttribute('dir'),
          who: [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > document.documentElement.clientWidth + 1 || r.left < -1); })
            .slice(-3).map((e) => `${e.tagName.toLowerCase()}[${(e.getAttribute('data-testid') ?? e.className ?? '').toString().slice(0, 40)}] ${(e.textContent ?? '').trim().slice(0, 24)}`),
          small: [...document.querySelectorAll('main button, main a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 36 && !e.closest('nav'); }).length }));
        if (l.over > 1) failures.push(`${lang} ${width} ${path}: overflow ${l.over}px — ${l.who.join(' | ')}`);
        if (['ar', 'he'].includes(lang) && l.dir !== 'rtl') failures.push(`${lang} ${path}: not RTL`);
      }
      await page.click('[data-testid="fbo-card"]');
      await page.waitForSelector('[data-testid="fbo-detail"]', { timeout: 20000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) failures.push(`${lang} ${width} opportunity: overflow ${over}px`);
      if (SHOTS && width === 390) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `fb3-opportunity-${lang}.png`), fullPage: true }); }
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});

test('1440px and 390px, six locales: cards render, RTL for ar/he, no horizontal overflow, 44px actions', opts, async (t) => {
  const failures = [];
  for (const width of [1440, 390]) {
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang });
      await open(page);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dir: document.documentElement.getAttribute('dir'),
        cards: document.querySelectorAll('[data-testid="fbx-lead-card"]').length,
        small: [...document.querySelectorAll('[data-testid="fbx-lead-details"]')].filter((a) => a.getBoundingClientRect().height < 43).length,
        langs: [...document.querySelectorAll('[data-testid="fbx-card-excerpt"]')].map((p) => p.getAttribute('lang')),
      }));
      if (layout.overflow > 1) failures.push(`${lang} ${width}: horizontal overflow ${layout.overflow}px`);
      if (['ar', 'he'].includes(lang) && layout.dir !== 'rtl') failures.push(`${lang}: not RTL`);
      if (layout.cards < 1) failures.push(`${lang} ${width}: cards missing`);
      if (layout.small > 0) failures.push(`${lang} ${width}: ${layout.small} Details action(s) under 44px`);
      if (!layout.langs.includes('ar')) failures.push(`${lang} ${width}: the excerpt lost its source language`);
      const text = await page.textContent('main');
      if (/fbx_/.test(text)) failures.push(`${lang} ${width}: untranslated key`);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `find-buyers-${width}-${lang}.png`), fullPage: true });
      }
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});

const CENTER = {
  generated_at: new Date().toISOString(), window_days: 30, switches: { find_buyers_social_enabled: false },
  overview: { campaigns: 2, credits_committed: 200, customer_value_micros: 20000000, revenue_micros: 13400000, provider_micros: 4100000, ai_micros: 23000, translation_micros: 1200, other_micros: 0, qualified_leads: 9, strong_leads: 3 },
  campaigns: [{ matching_job_id: 'job1', transaction: 'SALE', credits_committed: 100, credits_per_usd: 10, credits_charged: 67, revenue_micros: 6700000, customer_value_micros: 10000000, provider_budget_micros: 5000000, reserved_micros: 0, provider_micros: 2100000, ai_micros: 11000, translation_micros: 600, other_micros: 0, total_cogs_micros: 2111600, leads: 5, strong: 2, job_status: 'completed', created_at: ago(1), last_activity_at: ago(1),
    lifecycle: { state: 'COMPLETED_WITH_RESULTS', queue: { queued: 0, running: 0, done: 9, failed: 1, paused: 0 }, runs: { inFlight: 0 }, signalsAnalyzed: 412, newResults: 5 } }],
  actors: [{ actor_key: 'FB_COMMENTS', actor_id: 'memo23~facebook-comments-scraper', source: 'FACEBOOK', purpose: 'COMMENTS', role: 'PRIMARY', enabled: true, emergency_disabled: false, health: 'HEALTHY', pricing_model: 'PAY_PER_RESULT', price_per_1k_micros: 500000, start_fee_micros: 0, pricing_verified_at: ago(2), priority: 85, max_results: 100, probe_size: 20, timeout_seconds: 300, retry_cap: 1, concurrency: 2, daily_spend_cap_micros: 5000000, campaign_spend_cap_micros: 2000000, runs: 12, succeeded: 11, failed: 1, results_billed: 640, useful_results: 210, qualified_leads: 7, strong_leads: 3, spend_micros: 320000, latency_p50_ms: 41000, last_run_at: ago(0.1), last_error: 'RUN_TIMED-OUT' }],
  sources: [{ id: 's', platform: 'FACEBOOK', name: 'Квартиры в Тбилиси — аренда и продажа без посредников', url: 'https://www.facebook.com/groups/1', city: 'Tbilisi', languages: ['ru'], member_count: 48210, first_discovered: ago(5), last_checked_at: ago(1), posts_observed: 120, fb_spend_micros: 900000, fb_qualified_leads: 4, cost_per_qualified_micros: 225000, access_state: 'PUBLIC', lifecycle: 'DISCOVERED' }],
  languages: ['ka', 'ru', 'en', 'ar', 'he', 'tr'].map((lang, i) => ({ lang, spend_micros: 100000 * i, signals: 10 * i, qualified: i, strong: i > 3 ? 1 : 0 })),
  ledger: [{ id: 'x', occurred_at: ago(0.2), matching_job_id: 'job1', kind: 'PROVIDER', provider: 'APIFY_MEMO23', actor_key: 'FB_COMMENTS', provider_run_id: 'Hd8s7f6g5h4j3k2l1', operation: 'FB_COMMENTS', requested_limit: 20, billed_units: 18, estimated_micros: 10000, actual_micros: 9000, cost_state: 'ACTUAL', cost_basis: 'RUN_PRICE_X_BILLED_UNITS', status: 'SUCCEEDED', error: null, retry_of: null, after_settlement: false, source: 'FACEBOOK' }],
};

test('admin Find Buyers control center: every tab renders at 1440px and 390px (en, ar) without overflow', opts, async (t) => {
  const failures = [];
  for (const width of [1440, 390]) {
    for (const lang of ['en', 'ar']) {
      const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang, admin: true });
      await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="find-buyers-center"] [role="tab"]', { timeout: 30000 });
      const tabs = page.locator('[data-testid="find-buyers-center"] [role="tab"]');
      const n = await tabs.count();
      /* overview, actors, campaigns, source network (2026-10-08), sources, languages, ledger, intelligence (2026-10-24) */
      if (n !== 8) failures.push(`${lang} ${width}: ${n} tabs`);
      for (let i = 0; i < n; i += 1) {
        await tabs.nth(i).click();
        await page.waitForTimeout(150);
        const l = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: document.querySelector('[data-testid="find-buyers-center"]')?.innerText ?? '',
        }));
        if (l.overflow > 1) failures.push(`${lang} ${width} tab ${i}: overflow ${l.overflow}px`);
        if (/fbx_|undefined|NaN/.test(l.text)) failures.push(`${lang} ${width} tab ${i}: raw key / undefined / NaN`);
      }
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `find-buyers-admin-${width}-${lang}.png`), fullPage: true });
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});

test('live search module: server state, real source nodes only, real counts, the one control that fits', opts, async (t) => {
  const { page } = await boot(t);
  await open(page);
  /* Primary view: status, elapsed time, real progress, found so far, the duration note — no tiles. */
  const primary = await page.locator('[data-testid="fbl-module"]').innerText();
  assert.match(primary, /Searching — first results are in/);
  assert.match(primary, /10–30 minutes/, 'the duration note');
  assert.doesNotMatch(primary, /within 30 minutes/i, 'never a completion promise');
  assert.match(await page.innerText('[data-testid="fbl-progress-value"]'), /^2 \/ 9$/, 'tasks finished of tasks planned, from the queue');
  assert.match(await page.innerText('[data-testid="fbl-found"]'), /3/);
  assert.match(await page.innerText('[data-testid="fbl-elapsed-value"]'), /^\d{2}:\d{2}$/);
  assert.doesNotMatch(primary, /sources working|signals checked/, 'technical tiles are collapsed');
  assert.equal(await page.getAttribute('[data-testid="fbl-field"]', 'data-mode'), 'searching');
  assert.equal(await page.getAttribute('[data-testid="fbl-field"]', 'aria-hidden'), 'true');
  await openDetails(page);
  await page.waitForSelector('text=Expected budget', { timeout: 15000 });
  const main = await page.textContent('main');
  assert.match(main, /Searching — first results are in/);
  assert.match(main, /sources working/);
  assert.match(main, /signals checked/);
  /* Find Buyers 3.0: HOMATCH members are on their own page, never on the external one. */
  assert.doesNotMatch(main, /HOMATCH Matches/, 'internal matches never appear on the external results page');
  assert.match(main, /Extended research results/, 'external results are their own section');
  /* Only sources really working are listed; REDDIT is still queued and appears once it starts (2026-10-12). */
  /* The per-source list is an operator diagnostic since 2026-10-17 (owner): an owner never sees it. */
  assert.equal(await page.locator('[data-testid="fbl-source-outcomes"]').count(), 0, 'no source list for the owner');
  assert.equal(await page.getByRole('button', { name: 'Pause search' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Continue search' }).count(), 0);
  assert.doesNotMatch(main, /75%/, 'no invented percentage');
  assert.doesNotMatch(main, /New matches are in/, 'the first server read is a baseline, not an arrival');
  assert.match(main, /Expected budget/, 'the search profile is derived from the property facts');
  assert.match(main, /2 bedrooms/, 'the real bedroom count, never a stale "1+"');
  /* Scrolled away: a compact status entry stays reachable. */
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForSelector('text=3 new matches', { timeout: 5000 });
});

test('pause states: PAUSING says runs are finishing (no pause button), PAUSED offers continue', opts, async (t) => {
  const held = await boot(t, { status: withState('PAUSING') });
  for (const [state, expectText, button] of [['PAUSING', /Pausing the search/, 'Pausing…'], ['PAUSED', /Search is paused/, 'Continue search']]) {
    const { page } = held;
    if (state === 'PAUSED') held.setStatus(withState('PAUSED', { runs: { inFlight: 0, succeeded: 2, failed: 0 } }));
    await open(page);
    await page.getByText(expectText).first().waitFor({ state: 'visible' });
    const main = await page.textContent('main');
    assert.match(main, expectText);
    assert.equal(await page.getByRole('button', { name: 'Pause search' }).count(), 0, `${state}: no pause button`);
    assert.ok(await page.getByRole('button', { name: button }).count() >= 1, `${state}: ${button}`);
    if (state === 'PAUSING') assert.match(main, /no new source will start/);
  }
});

test('a search that could not start never reads as "finished, 0 results"; launch is disabled while not ready', opts, async (t) => {
  const status = { readiness: { ready: false, reason: 'DISCOVERY_SWITCHED_OFF', sources: [] },
    campaign: { ...STATUS_SEARCHING.campaign, state: 'UNAVAILABLE', active: false, sources: [], executed: false, newResults: 0, newLeads: 0,
      queue: { total: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 0, succeeded: 0, failed: 0 } } };
  const { page } = await boot(t, { status });
  await open(page);
  // The status answer renders after the page shell: wait for it, not for any text.
  await page.getByText('The search could not start').first().waitFor({ timeout: 30000 });
  const main = await page.textContent('main');
  assert.match(main, /The search could not start/);
  assert.doesNotMatch(main, /Search finished — no new active demand/);
  assert.match(main, /discovery sources are not switched on yet/);
  assert.equal(await page.getByRole('button', { name: 'Find interested people' }).first().isDisabled(), true);
});

/* 2026-10-17: a page number is a view of the screen, not a screen. Paging REPLACES the
   entry, so Back — the phone's or the top-left one — leaves the results instead of
   stepping back to page 1 of the same screen (which read as "Back only scrolled"). */
test('numbered server pages: page 2 is a server request, kept in the URL; paging adds no history, Back leaves the screen', opts, async (t) => {
  const { page } = await boot(t, { matches: MATCHES, status: withState('COMPLETED_WITH_RESULTS', { active: false }) });
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await open(page);
  const entries = await page.evaluate(() => history.length);
  /* Earlier internal matches start closed (owner, 2026-10-17): open them first. */
  await page.click('[data-testid="fbx-legacy-toggle"]');
  await page.waitForSelector('nav[aria-label="Match pages"]');
  assert.equal(await page.locator('nav[aria-label="Match pages"] [aria-current="page"]').textContent(), '1');
  /* The current-page marker follows the URL at once; the page-2 fetch fires a
     tick later, so wait for that request itself rather than reading the log. */
  const page2Request = page.waitForRequest((r) => r.url().includes('/rest/v1/matches') && /offset=12/.test(r.url()), { timeout: 30000 });
  await page.getByRole('button', { name: 'Page 2' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('page') === '2');
  await page.waitForFunction(() => document.querySelector('nav[aria-label="Match pages"] [aria-current="page"]')?.textContent === '2');
  assert.match((await page2Request).url(), /offset=12/, 'page 2 asked the server for offset 12');
  assert.doesNotMatch(await page.textContent('main'), /Show more|მეტის ჩვენება/);
  assert.equal(await page.evaluate(() => history.length), entries, 'paging replaced the entry, it did not push one');
  await page.goBack();
  await page.waitForURL((u) => new URL(u).pathname === `/property/${PROPERTY_ID}/matches`, { timeout: 30000 });
});

test('an Arabic excerpt reads right-to-left inside a left-to-right card (Georgian UI stays LTR)', opts, async (t) => {
  const { page } = await boot(t, { lang: 'ka' });
  await open(page);
  const dirs = await page.evaluate((txt) => {
    const q = [...document.querySelectorAll('[data-testid="fbx-card-excerpt"]')].find((b) => b.textContent?.includes(txt.slice(0, 12)));
    const card = q?.closest('article');
    return { quote: q ? getComputedStyle(q.querySelector('bdi') ?? q).direction : null, card: card ? getComputedStyle(card).direction : null, html: document.documentElement.dir };
  }, AR_TEXT);
  assert.equal(dirs.card, 'ltr');
  assert.equal(dirs.html, 'ltr');
  assert.equal(dirs.quote, 'rtl');
});

/* ── MOBILE FIT: the property page and the search dialog on real phone widths ── */
const IDLE = { readiness: { ready: true, reason: null, sources: ['TELEGRAM'] },
  campaign: { ...STATUS_SEARCHING.campaign, state: 'UNAVAILABLE', active: false, sources: [], executed: false, newResults: 0, newLeads: 0,
    queue: { total: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 0, succeeded: 0, failed: 0 } } };
const RUNNING_ELSEWHERE = [{ id: 'bg1', productType: 'VERIFY', subjectType: 'RESEARCH_JOB', subjectId: 'r1', state: 'PROCESSING',
  progress: 40, currentStage: 'x', resultRef: '/verify?job=r1', stages: [], metadata: {}, createdAt: ago(0.01), updatedAt: ago(0.001) }];

test('phones 320–430px (ka, en, ar): the page and the search dialog fit, scroll, and the task badge covers nothing', opts, async (t) => {
  const failures = [];
  for (const width of [320, 360, 375, 390, 412, 430]) {
    for (const lang of ['ka', 'en', 'ar']) {
      const { page } = await boot(t, { width, height: 760, lang, status: IDLE, jobs: RUNNING_ELSEWHERE });
      await page.goto(`${BASE}/property/${PROPERTY_ID}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href$="/matches"]', { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const where = `${lang} ${width}`;
      const l = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const primary = document.querySelector('main a[href$="/matches"]').getBoundingClientRect();
        const badge = document.querySelector('button.fixed.end-4');
        const b = badge?.getBoundingClientRect();
        window.scrollTo(0, document.documentElement.scrollHeight);
        return { overflow: document.documentElement.scrollWidth - vw, vw, primaryW: primary.width, primaryH: primary.height,
          badge: b ? { w: b.width, h: b.height, label: badge.getAttribute('aria-label') } : null,
          scrolledToEnd: Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 2 && window.scrollY > 0 };
      });
      if (l.overflow > 0) failures.push(`${where}: page wider than the screen by ${l.overflow}px`);
      if (l.primaryW < l.vw * 0.6 || l.primaryH > 80) failures.push(`${where}: primary action squeezed (${Math.round(l.primaryW)}×${Math.round(l.primaryH)})`);
      if (!l.badge) failures.push(`${where}: running-task badge missing`);
      else {
        if (l.badge.w > 48 || l.badge.h > 48) failures.push(`${where}: task badge ${l.badge.w}×${l.badge.h} spans the content`);
        if ((l.badge.label ?? '').trim().length < 4) failures.push(`${where}: task badge has no accessible name`);
      }
      if (!l.scrolledToEnd) failures.push(`${where}: page does not scroll to its end`);
      /* The search dialog. */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/external`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('text=Expected budget, text=მოსალოდნელი ბიუჯეტი, text=ميزانية', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const launch = page.locator('[data-testid="fbl-launch"]');
      if (await launch.count()) {
        await launch.click();
        await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);
        const d = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          const r = dlg.getBoundingClientRect();
          const outside = [...dlg.querySelectorAll('*')].filter((e) => {
            if (e.classList.contains('sr-only')) return false;
            const b = e.getBoundingClientRect();
            return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1);
          }).map((e) => (e.textContent || e.tagName).trim().slice(0, 30));
          const budget = [...dlg.querySelectorAll('p')].find((p) => /\$10/.test(p.textContent ?? ''));
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight,
            scrolls: dlg.scrollHeight > dlg.clientHeight ? getComputedStyle(dlg).overflowY : 'fits', outside: outside.slice(0, 5),
            budgetFits: budget ? budget.getBoundingClientRect().right <= r.right + 1 : true,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        if (d.top < 0 || d.bottom > d.vh + 1) failures.push(`${where}: dialog leaves the screen (${Math.round(d.top)}..${Math.round(d.bottom)} of ${d.vh})`);
        if (d.left < 0 || d.right > d.vw + 1) failures.push(`${where}: dialog wider than the screen`);
        if (!['auto', 'scroll', 'fits'].includes(d.scrolls)) failures.push(`${where}: dialog taller than the screen and cannot scroll`);
        if (d.outside.length) failures.push(`${where}: dialog content outside the dialog: ${d.outside.join(' | ')}`);
        if (!d.budgetFits) failures.push(`${where}: budget badge wider than the dialog`);
        if (d.pageOverflow > 0) failures.push(`${where}: page overflow with dialog open`);
        if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `fit-dialog-${width}-${lang}.png`) }); }
      } else failures.push(`${where}: launch control missing`);
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});

/* ── THE OWNER'S FIRST REAL RUN (job 7517daa6): Telegram read 2 messages and
   registered 31 communities; 0 qualified. Social actors were switched off. ── */
const REAL_RUN = {
  readiness: { ready: true, reason: null, sources: ['TELEGRAM'], network: [
    { family: 'TELEGRAM', state: 'AVAILABLE' }, { family: 'FACEBOOK', state: 'DISABLED' }, { family: 'INSTAGRAM', state: 'DISABLED' },
    { family: 'TIKTOK', state: 'DISABLED' }, { family: 'FORUM', state: 'DISABLED' },
  ] },
  campaign: { ...STATUS_SEARCHING.campaign, state: 'COMPLETED_NO_RESULTS', active: false, executed: true, completedAt: ago(0.05),
    sources: [{ source: 'TELEGRAM', state: 'DONE', total: 2, running: 0, queued: 0, done: 2, failed: 0, results: 2, checked: 2, communities: 31, qualified: 0 }],
    queue: { total: 2, queued: 0, running: 0, done: 2, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 0, succeeded: 0, failed: 0 },
    signalsAnalyzed: 0, signalsChecked: 2, communitiesFound: 31, newResults: 0, newLeads: 0, newMatches: 0, strong: 0 },
};

test('the real run reads truthfully: 2 checked + 31 communities, 0 qualified; READY now; Telegram searched, social off', opts, async (t) => {
  const { page } = await boot(t, { status: REAL_RUN, admin: true });
  await open(page);
  await openDetails(page);
  await page.waitForSelector('[data-testid="fbl-details"]', { timeout: 15000 });
  const main = await page.textContent('main');
  /* No per-source list on the results page for anyone, admins included (owner, 2026-10-18). */
  assert.equal(await page.locator('[data-testid="fbl-source-outcomes"]').count(), 0);
  /* Clock times (the dated history line, e.g. "6:33 PM") are not counts. */
  assert.doesNotMatch(main.replace(/\d{1,2}:\d{2}/g, ''), /33/, 'raw items and communities are never summed into one number');
  assert.match(main, /Ready to search/, 'the current state is READY, not the last outcome');
  assert.match(main, /Last search \(.+\): Search finished — no new active demand/, 'the last outcome is a dated history line');
  /* A finished search does not move; only the source that ran is listed, completed. */
  assert.equal(await page.getAttribute('[data-testid="fbl-field"]', 'data-mode'), 'finished');
  assert.equal(await page.locator('[data-testid="fbl-network-legend"]').count(), 0, 'no available / switched-off legend');
});

/* 2026-10-04 23:50 (job 123bd287): social sources were AVAILABLE, the memo23
   planner crashed, only Telegram ran. The screen must say exactly that. */
const PLANNER_FAILED = {
  readiness: { ...REAL_RUN.readiness, network: [
    { family: 'TELEGRAM', state: 'AVAILABLE' }, { family: 'FACEBOOK', state: 'AVAILABLE' }, { family: 'INSTAGRAM', state: 'AVAILABLE' },
    { family: 'TIKTOK', state: 'AVAILABLE' }, { family: 'FORUM', state: 'DISABLED' },
  ] },
  campaign: { ...REAL_RUN.campaign, sources: [{ ...REAL_RUN.campaign.sources[0], checked: 0, communities: 0, results: 0 }], signalsChecked: 0, communitiesFound: 0,
    socialPlan: { outcome: 'FAILED', reason: 'PLANNER_ERROR', queued: 0 } },
};

test('only Telegram ran because the social planner failed: the owner sees what worked, not our failure, in en/ka/ar at 1440 and 390', opts, async (t) => {
  const failures = [];
  for (const [width, lang] of [[1440, 'en'], [390, 'ka'], [390, 'ar']]) {
    const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang, status: PLANNER_FAILED, admin: true });
    await open(page);
    await openDetails(page);
    await page.waitForSelector('[data-testid="fbl-details"]', { timeout: 15000 });
    /* 2026-10-12: the planner failure and the sources it stopped stay internal (admin views). */
    if (await page.locator('[data-testid="fbl-scope-social-blocked"]').count() !== 0) failures.push(`${lang} ${width}: planner failure shown to the owner`);
    if (await page.locator('[data-testid="fbl-scope-only"]').count() !== 0) failures.push(`${lang} ${width}: "only X was searched" shown`);
    if (await page.locator('[data-testid="fbl-exec-state"]').count() !== 0) failures.push(`${lang} ${width}: per-source chips shown (removed 2026-10-18)`);
    const text = await page.evaluate(() => document.body.innerText);
    if (/fbl_|undefined|NaN/.test(text)) failures.push(`${lang} ${width}: raw key / undefined / NaN`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) failures.push(`${lang} ${width}: overflow ${overflow}px`);
    await page.context().close();
  }
  assert.deepEqual(failures, []);
});

test('Admin → Providers: APIFY is live (Test + Enable, memo23 scope note, usable under the legacy kill switch); DATAFORSEO stays retired', opts, async (t) => {
  const failures = [];
  for (const [width, lang] of [[1440, 'en'], [390, 'ka'], [390, 'ar']]) {
    const { page, settingWrites, healthTests } = await boot(t, { width, height: width < 700 ? 844 : 900, lang, admin: true });
    await page.goto(`${BASE}/admin/providers`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="apify-scope"]', { timeout: 30000 });
    const card = page.locator('div.rounded-xl, div[class*="card"]').filter({ has: page.locator('[data-testid="apify-scope"]') }).last();
    const buttons = card.getByRole('button');
    const cardText = await card.innerText();
    if (!/APIFY/.test(cardText) || /OPENAI|DATAFORSEO/.test(cardText)) failures.push(`${lang} ${width}: locator is not the APIFY card alone`);
    if ((await buttons.count()) !== 2) failures.push(`${lang} ${width}: APIFY card has ${await buttons.count()} buttons (Test + Enable expected)`);
    const retiredText = await page.evaluate(() => document.body.innerText);
    const dfsCard = page.locator('div.rounded-xl, div[class*="card"]').filter({ hasText: 'DATAFORSEO' }).filter({ hasNotText: 'OPENAI' }).filter({ hasNotText: 'memo23' }).last();
    if (!/DATAFORSEO/.test(await dfsCard.innerText())) failures.push(`${lang} ${width}: DATAFORSEO card not found`);
    if ((await dfsCard.getByRole('button').count()) !== 0) failures.push(`${lang} ${width}: DATAFORSEO card offers a control`);
    if (/admin_providers_|undefined|NaN/.test(retiredText)) failures.push(`${lang} ${width}: raw key / undefined / NaN`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) failures.push(`${lang} ${width}: overflow ${overflow}px`);
    if (lang === 'ar' && (await page.evaluate(() => document.documentElement.dir)) !== 'rtl') failures.push('ar: not rtl');

    /* Test = the free account check, for APIFY. */
    await buttons.nth(0).click();
    await page.waitForTimeout(300);
    if (!healthTests.some((b) => b.provider === 'APIFY')) failures.push(`${lang} ${width}: Test did not call provider-health-check for APIFY`);

    /* Enable works although the legacy kill switch is on, and writes the server switch (DataForSEO stays in). */
    const enable = buttons.nth(1);
    if (await enable.isDisabled()) failures.push(`${lang} ${width}: APIFY Enable is disabled under the legacy kill switch`);
    else {
      await enable.click();
      await page.waitForTimeout(300);
      const w = settingWrites.find((x) => x.p_key === 'provider_disabled_list');
      if (!w) failures.push(`${lang} ${width}: Enable wrote nothing`);
      else if (w.p_value.includes('APIFY') || !w.p_value.includes('DATAFORSEO')) failures.push(`${lang} ${width}: wrong list ${JSON.stringify(w.p_value)}`);
    }
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `admin-providers-${width}-${lang}.png`), fullPage: true });
    await page.context().close();
  }
  assert.deepEqual(failures, []);
});
