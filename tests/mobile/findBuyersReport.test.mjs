// FIND BUYERS / FIND TENANTS → the search report and Research Notes, in a
// real browser (harness build).
//
// The final report is the production report of campaign 70b0d32b (computed
// by the find_buyers_campaign_report body, run read-only against production:
// tests/fixtures/findBuyersReport-70b0d32b.json — a legacy campaign whose 37
// leads predate match review). A live variant shows the partial report and
// the leads grouped Strong → Potential → Weak with budget / location fit.
// Checked at 1440px and 390px, in en, ka and the RTL locales:
//   * the report claims no full market coverage and shows no provider money;
//   * every Research NOTE is a sentence with the record's numbers;
//   * legacy leads are "not yet reviewed", never qualified; no best source is
//     invented from them;
//   * UNKNOWN fit reads "unknown", never "fits"; rejected leads never show;
//   * no raw keys, no horizontal overflow; ar/he render RTL;
//   * the admin Intelligence tab renders the cross-campaign view.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4365;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FIND_BUYERS_REPORT_SHOTS || null;

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
const PROPERTY_ID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';
const JOB_ID = '70b0d32b-028b-4b8b-8adf-3f177e573bb3';
const property = {
  id: PROPERTY_ID, user_id: 'u1', title: '3-room apartment in Krtsanisi', transaction_type: 'SALE', property_type: 'APARTMENT',
  contact_phone_e164: '+995555123456', is_deleted: false, created_at: new Date().toISOString(), photos: [],
  facts: [{ city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD', bedrooms: 2, rooms: 3, area: 97.2 }],
};
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

/* The production report (read-only SQL, 2026-10-09). */
const { _source, ...PROD_REPORT } = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/findBuyersReport-70b0d32b.json'), 'utf8'));
void _source;

/* A live, re-qualified run of the same property: partial report, real categories. */
const LIVE_REPORT = {
  ...PROD_REPORT, live: true, legacy: false, budget: { usedPct: 41, exhausted: false, creditsCommitted: 100 },
  timing: { ...PROD_REPORT.timing, finalizedAt: null, durationSeconds: 742, firstQualifiedAt: '2026-10-09T05:38:02.000Z' },
  results: { ...PROD_REPORT.results, strong: 1, potential: 1, weak: 1, uncategorised: 0, rejected: 9, visible: 3, genuineSeekers: 2,
    rejectionReasons: { JOB_SEARCH: 5, WRONG_TRANSACTION: 3, SALE_ADVERTISEMENT: 1 },
    signalRoles: { SALE_OFFER: 96, RENT_SEEKER: 7, BUY_SEEKER: 2, JOB: 12, IRRELEVANT: 20, UNCLEAR: 9 },
    budgetFit: { UNKNOWN: 2, COMPATIBLE: 1 }, locationFit: { COMPATIBLE: 2, UNKNOWN: 1 } },
  notes: [
    { code: 'PARTIAL_REPORT', params: {} },
    { code: 'NO_LOCATION_AND_PRICE_MATCH', params: { genuineBuyers: 2 } },
    { code: 'RENTAL_DEMAND_DOMINANT', params: { share: 78, seekers: 2, otherSeekers: 7 } },
    { code: 'SUPPLY_DOMINANT', params: { share: 66, basis: 'ROLE' } },
    { code: 'JOB_GROUP_NOISE', params: { signals: 12 } },
    { code: 'TELEGRAM_COVERAGE', params: { free: 0, paid: 40, paidChannels: 3, discovered: 31, activated: 0, freeChannels: 4 } },
  ],
  bestSources: [{ platform: 'FACEBOOK', community: 'facebook.com/groups/real.tbilisi', qualified: 2, weak: 0, uncategorised: 0, postsRead: 64, budgetSharePct: 12.5 }],
  limitations: [{ code: 'BUDGET_UNKNOWN', leads: 2, of: 3 }],
};

const lead = (id, over) => ({
  id, matching_job_id: JOB_ID, counterpart: 'BUYER', source: 'FACEBOOK', intent_class: 'BUYER_HIGH', overall_score: 80, strength: 'GOOD',
  similarity: 80, intent_score: 85, signal_count: 1, signal_at: ago(2), seen_before: false, language: 'ru', created_at: ago(1),
  author_name: 'Anna K.', author_profile_url: 'https://www.facebook.com/profile.php?id=1000',
  score_components: { why: { kind: 'REQUEST_POST', bedrooms: 2, propertyType: 'APARTMENT', district: 'krtsanisi', city: null, agreed: ['price'], parentAgeDays: null } },
  evidence: [{ signalId: `s-${id}`, parentSignalId: null, kind: 'POST', source: 'FACEBOOK', intentClass: 'BUYER_HIGH', intentScore: 85, similarity: 80, ageDays: 2,
    text: 'Ищу 2-комнатную квартиру в Крцаниси, рассмотрю варианты.', url: `https://www.facebook.com/groups/real.tbilisi/permalink/${id}/`, parentUrl: null, parentExcerpt: null, language: 'ru', publishedAt: ago(2) }],
  ...over,
});
const LIVE_LEADS = [
  lead('l1', { overall_score: 91, strength: 'STRONG', match_category: 'STRONG', budget_fit: 'COMPATIBLE', location_fit: 'COMPATIBLE' }),
  lead('l2', { overall_score: 77, match_category: 'POTENTIAL', budget_fit: 'UNKNOWN', location_fit: 'COMPATIBLE' }),
  lead('l3', { overall_score: 60, strength: 'POSSIBLE', match_category: 'WEAK', budget_fit: 'UNKNOWN', location_fit: 'UNKNOWN' }),
  /* the view excludes REJECTED; the screen would hide one even if it arrived */
  lead('l4', { overall_score: 85, match_category: 'REJECTED', budget_fit: 'UNKNOWN', location_fit: 'UNKNOWN', author_name: 'Job Seeker' }),
];
const LEGACY_LEADS = [lead('g1', { strength: 'STRONG', overall_score: 92 }), lead('g2', { overall_score: 70 })];

const campaign = (over) => ({
  jobId: JOB_ID, campaignId: null, state: 'COMPLETED_WITH_RESULTS', stage: null, active: false, createdAt: PROD_REPORT.timing.createdAt,
  startedAt: PROD_REPORT.timing.createdAt, completedAt: PROD_REPORT.timing.finalizedAt, pausedAt: null, lastActivityAt: PROD_REPORT.timing.finalizedAt,
  transaction: 'SALE', languages: ['ka', 'ru', 'en', 'ar', 'he', 'tr'],
  queue: { total: 106, queued: 0, running: 0, done: 89, failed: 5, cancelled: 12, paused: 0 }, runs: { inFlight: 0, succeeded: 88, failed: 8 },
  sources: [
    { source: 'FACEBOOK', state: 'DONE', total: 70, running: 0, queued: 0, done: 63, failed: 0, results: 744, checked: 744, qualified: 37 },
    { source: 'TELEGRAM', state: 'DONE', total: 12, running: 0, queued: 0, done: 12, failed: 0, results: 130, checked: 130, communities: 31, qualified: 0 },
  ],
  signalsAnalyzed: 412, signalsChecked: 958, staleSkipped: 103, duplicatesRemoved: 7, newResults: 37, newLeads: 37, newMatches: 0, strong: 1,
  executed: true, failureReason: null, ...over,
});
const FINAL_STATUS = { readiness: { ready: true, reason: null, sources: ['FACEBOOK', 'TELEGRAM'] }, campaign: campaign({}) };
const LIVE_STATUS = {
  readiness: FINAL_STATUS.readiness,
  campaign: campaign({ state: 'PARTIAL_RESULTS', active: true, completedAt: null, lastActivityAt: new Date().toISOString(), newResults: 3, newLeads: 3, strong: 1,
    sources: [{ source: 'FACEBOOK', state: 'RUNNING', total: 20, running: 3, queued: 4, done: 13, failed: 0, results: 120, checked: 120, qualified: 3 }],
    queue: { total: 20, queued: 4, running: 3, done: 13, failed: 0, cancelled: 0, paused: 0 }, runs: { inFlight: 3, succeeded: 13, failed: 0 } }),
};

/* Admin intelligence, shaped like the production 7-day read (2026-10-09). */
const INTEL = {
  since: ago(7), campaigns: 4,
  queries: [
    { operation: 'FB_GROUP_POSTS', query: 'https://www.facebook.com/groups/1776131272409385/', language: 'en', runs: 19, failed: 0, costMicros: 437000, items: 20, qualified: 5, strong: 0 },
    { operation: 'FB_GROUP_SEARCH', query: 'Tbilisi apartments', language: 'en', runs: 3, failed: 0, costMicros: 89100, items: 47, qualified: 0, strong: 0 },
    { operation: 'TIKTOK_SEARCH', query: 'أبحث عن شقة للشراء في تبليسي', language: 'ar', runs: 1, failed: 0, costMicros: 35000, items: 15, qualified: 0, strong: 0 },
  ],
  actors: [
    { actorKey: 'FB_GROUP_POSTS', runs: 59, succeeded: 58, failed: 0, empty: 21, costMicros: 1844000, items: 677, qualified: 37, costPerQualifiedMicros: 49838 },
    { actorKey: 'TIKTOK', runs: 10, succeeded: 10, failed: 0, empty: 0, costMicros: 320000, items: 150, qualified: 0, costPerQualifiedMicros: null },
    { actorKey: 'BLUESKY', runs: 6, succeeded: 0, failed: 6, empty: 0, costMicros: 30000, items: 0, qualified: 0, costPerQualifiedMicros: null },
  ],
  falsePositives: { leads: 37, requalified: 37, rejectedAfterRequalification: 33, rate: 0.892 },
  categories: { STRONG: 1, POTENTIAL: 2, WEAK: 1, REJECTED: 33 },
  rejectionReasons: { JOB_SEARCH: 14, WRONG_TRANSACTION: 9, SALE_ADVERTISEMENT: 8 },
  signalRejectionReasons: {},
  sourceQuality: [
    { platform: 'FACEBOOK', community: 'facebook.com/groups/jobingeorgia', leads: 14, qualified: 0, rejected: 14, uncategorised: 0, costMicros: 243000, items: 100, qualifiedPerDollar: 0 },
    { platform: 'FACEBOOK', community: 'facebook.com/groups/175357289696998', leads: 3, qualified: 2, rejected: 1, uncategorised: 0, costMicros: 161000, items: 103, qualifiedPerDollar: 12.42 },
  ],
  timing: [{ jobId: JOB_ID, createdAt: PROD_REPORT.timing.createdAt, finalizedAt: PROD_REPORT.timing.finalizedAt, phase1EndedAt: PROD_REPORT.timing.phase1EndedAt,
    firstExtractionAt: '2026-10-09T05:32:16.602Z', firstLeadAt: '2026-10-09T05:33:30.348Z', firstQualifiedAt: null, phase1Seconds: 232, durationSeconds: 1830 }],
  comments: { commentsAssessed: 0, postsAssessed: 322, decisions: { NOT_DECIDED: 46, SKIP_NO_COMMENTS: 231, SKIP_WEAK_SIGNALS: 1, SKIP_LOW_SIMILARITY: 44 } },
  telegram: { freeJobs: 3, freeMessages: 2, freeTargets: 14, paidRuns: 10, paidItems: 130, paidChannels: 8, paidCostMicros: 34750, communitiesDiscovered: 107 },
  bottlenecks: { waits: { ACTOR_BUSY: 51, GLOBAL_BUSY: 16, PHASE1_DISCOVERY: 5 }, cancelled: { PHASE1_BUDGET: 5, CAMPAIGN_DEADLINE: 7 },
    queueStates: { DONE: 93, FAILED: 5, CANCELLED: 12 }, phase1AvgSeconds: 151 },
};

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = false, status = FINAL_STATUS, report = PROD_REPORT, leads = LEGACY_LEADS } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  if (process.env.FB_DEBUG) page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const calls = { report: 0, intel: 0, reportJobs: [] };
  const json = (b, code = 200) => ({ status: code, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    const who = admin ? { ...profile, is_admin: true, role: 'admin' } : profile;
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? who : [who]));
    if (url.includes('/rpc/find_buyers_campaign_report')) {
      calls.report += 1;
      calls.reportJobs.push(JSON.parse(req.postData() ?? '{}').p_job_id);
      return r.fulfill(json(report));
    }
    if (url.includes('/rpc/admin_find_buyers_intelligence')) { calls.intel += 1; return r.fulfill(json(INTEL)); }
    if (url.includes('/rpc/admin_find_buyers_center')) {
      return r.fulfill(json({ generated_at: new Date().toISOString(), window_days: 30, switches: {}, overview: {}, campaigns: [], actors: [], sources: [], languages: [], ledger: [] }));
    }
    if (url.includes('/rpc/admin_discovery_')) return r.fulfill(json({ message: 'not in this fixture' }, 400));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(wantsObject ? property : [property]));
    if (url.includes('/rest/v1/find_buyers_current_leads')) {
      return r.fulfill({ ...json(leads), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `0-${leads.length - 1}/${leads.length}` } });
    }
    if (url.includes('/rpc/find_buyers_campaign_status')) return r.fulfill(json(status));
    if (url.includes('/rest/v1/matches')) return r.fulfill({ ...json([]), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/0' } });
    if (url.includes('/rpc/billing_my_budget_choices')) return r.fulfill(json({ ok: true, balance: 1000, min_viable: 50, allow_custom: true, recommended: 100, presets: [] }));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 10, creditsPerUsd: 10, minCredits: 100 }));
    if (url.includes('/rpc/background_jobs_mine')) return r.fulfill(json([]));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls };
}

async function openReport(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="fbr-report"]', { timeout: 30000 });
}
async function expand(page) {
  await page.click('[data-testid="fbr-toggle"]');
  await page.waitForSelector('[data-testid="fbr-details"]', { timeout: 5000 });
}
const layout = (page) => page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  dir: document.documentElement.getAttribute('dir'),
  report: document.querySelector('[data-testid="fbr-report"]')?.innerText ?? '',
  /* any element inside the report wider than the viewport */
  wide: [...document.querySelectorAll('[data-testid="fbr-report"] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1
    || e.getBoundingClientRect().left < -1).length,
}));
function shot(page, name) {
  if (!SHOTS) return Promise.resolve();
  mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: join(SHOTS, name), fullPage: true });
}

test('final report (production campaign 70b0d32b): truthful summary, Research Notes, sections, no money, no invented best source', opts, async (t) => {
  const { page, calls } = await boot(t);
  await openReport(page);
  assert.equal(calls.reportJobs[0], JOB_ID, 'the report is read for the campaign the status names');
  const summary = await page.locator('[data-testid="fbr-summary"]').innerText();
  assert.match(summary, /Not yet reviewed/, 'legacy leads are labelled unreviewed');
  assert.equal(await page.locator('[data-testid="fbr-strong"] p').first().innerText(), '0', 'no legacy lead counted as strong');
  assert.equal(await page.locator('[data-testid="fbr-uncategorised"] p').first().innerText(), '37');
  assert.match(summary, /88%/);
  assert.match(summary, /30 min 30 s/);
  assert.match(summary, /412/);
  assert.equal(await page.getAttribute('[data-testid="fbr-report"]', 'data-live'), 'false');
  assert.match(await page.innerText('[data-testid="fbr-scope"]'), /not a survey of the whole market/);
  const notes = await page.locator('[data-testid="fbr-research-notes"] li').allInnerTexts();
  assert.equal(notes.length, 7, notes.join('\n'));
  assert.match(notes[0], /Candidates found before match review was introduced: 37/);
  assert.match(notes[1], /60% of the analysed posts/);
  assert.match(notes[2], /Bluesky, VK/);
  assert.match(notes[3], /88% of the research budget/);
  assert.match(notes[4], /time limit before they ran: 7/);
  assert.match(notes[5], /No comments were examined.*posts: 322/);
  assert.match(notes[6], /all 130 messages came through paid access to 8 channels/);
  await expand(page);
  const l = await layout(page);
  assert.match(l.report, /Property searched/i);
  assert.match(l.report, /Price: \$213,840/);
  assert.match(l.report, /Budget band: \$171,072 – \$256,608/);
  assert.match(l.report, /Derived from the property’s own facts/);
  assert.match(l.report, /Search tasks completed: 89 of 106/);
  assert.match(l.report, /No source has produced a qualified match yet/, 'jobingeorgia (14 unreviewed leads) is not a "best source"');
  assert.doesNotMatch(l.report, /jobingeorgia/);
  assert.match(l.report, /Unavailable during this search: Bluesky, VK/);
  assert.match(l.report, /Search for source groups in Arabic, Hebrew, Georgian, Russian, Turkish/);
  assert.match(l.report, /Telegram communities discovered but not yet read: 31/);
  assert.match(l.report, /none of them guarantees more interested people/);
  assert.match(l.report, /What the analysed posts appeared to be \(before review\)/);
  assert.doesNotMatch(l.report, /fbr_|fbx_|undefined|NaN|micros|Micros|\$2\.8|2800000/, 'no raw key, no provider money');
  assert.doesNotMatch(l.report, /confirmed buyer/i);
  assert.ok(l.overflow <= 1, `no horizontal page scroll (${l.overflow}px)`);
  await shot(page, 'report-final-1440-en.png');
});

test('390px phones (en, ka) and RTL (ar, he): the full report fits, RTL flips, notes stay readable', opts, async (t) => {
  const failures = [];
  for (const [lang, width] of [['en', 390], ['ka', 390], ['ar', 390], ['he', 390], ['ar', 1440]]) {
    const { page } = await boot(t, { lang, width, height: width < 700 ? 844 : 900 });
    await openReport(page);
    await expand(page);
    const l = await layout(page);
    if (l.overflow > 1) failures.push(`${lang}@${width}: page overflow ${l.overflow}px`);
    if (l.wide > 0) failures.push(`${lang}@${width}: ${l.wide} report element(s) outside the viewport`);
    if (/fbr_|fbx_|undefined|NaN/.test(l.report)) failures.push(`${lang}@${width}: raw key / undefined / NaN`);
    if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang}: dir=${l.dir}`);
    if (lang === 'ka' && !/კვლევის შენიშვნები/.test(l.report)) failures.push('ka: Research Notes title');
    if (lang === 'ka' && !/37/.test(l.report)) failures.push('ka: legacy count');
    if (lang === 'ar' && !/ملاحظات البحث/.test(l.report)) failures.push('ar: Research Notes title');
    if (lang === 'he' && !/הערות מחקר/.test(l.report)) failures.push('he: Research Notes title');
    const toggle = await page.locator('[data-testid="fbr-toggle"]').boundingBox();
    if (!toggle || toggle.height < 44) failures.push(`${lang}@${width}: toggle under 44px`);
    await shot(page, `report-final-${width}-${lang}.png`);
    await page.context().close();
  }
  assert.deepEqual(failures, []);
});

test('live search: a partial report, leads grouped Strong → Potential → Weak, fit badges honest, rejected hidden', opts, async (t) => {
  const { page, calls } = await boot(t, { status: LIVE_STATUS, report: LIVE_REPORT, leads: LIVE_LEADS });
  await openReport(page);
  assert.equal(await page.getAttribute('[data-testid="fbr-report"]', 'data-live'), 'true');
  assert.match(await page.innerText('[data-testid="fbr-state"]'), /Live/);
  const notes = await page.locator('[data-testid="fbr-research-notes"] li').allInnerTexts();
  assert.match(notes[0], /still running — these figures are partial/);
  assert.match(notes[1], /Genuine purchase requests were found \(2\), but none matched both/);
  assert.match(notes[2], /renting, not buying \(78% of requests\)/);
  assert.match(notes[4], /Job-related posts surfaced in property groups \(12\)/);
  await page.waitForSelector('[data-testid="fbx-lead-group"]', { timeout: 20000 });
  const groups = await page.$$eval('[data-testid="fbx-lead-group"]', (els) => els.map((e) => e.getAttribute('data-category')));
  assert.deepEqual(groups, ['STRONG', 'POTENTIAL', 'WEAK'], 'category order; REJECTED never shown');
  const main = await page.textContent('main');
  assert.doesNotMatch(main, /Job Seeker/, 'a rejected lead never renders');
  const fits = await page.$$eval('[data-testid="fbx-fit-badges"] [data-fit]', (els) => els.map((e) => `${e.getAttribute('data-fit')}:${e.textContent}`));
  assert.deepEqual(fits, [
    'COMPATIBLE:Budget fits', 'COMPATIBLE:Location fits',
    'UNKNOWN:Budget unknown', 'COMPATIBLE:Location fits',
    'UNKNOWN:Budget unknown', 'UNKNOWN:Location unknown',
  ], 'UNKNOWN reads unknown, never fits');
  await expand(page);
  const l = await layout(page);
  assert.match(l.report, /Running for 12 min 22 s/);
  assert.match(l.report, /real\.tbilisi/);
  assert.match(l.report, /Qualified: 2 · Posts read: 64 · Share of budget: 12.5%/);
  assert.match(l.report, /Set aside after review: 9/);
  assert.match(l.report, /Job search, not housing\s*5/);
  assert.match(l.report, /Matches with no stated budget: 2 of 3/);
  assert.ok(l.overflow <= 1, `no overflow (${l.overflow}px)`);
  assert.ok(calls.report >= 1);
  await shot(page, 'report-live-1440-en.png');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'report-live-page-1440-en.png'), fullPage: true });
});

test('admin: the Intelligence tab renders the cross-campaign view (en 1440, ar 390) without overflow', opts, async (t) => {
  const failures = [];
  for (const [lang, width] of [['en', 1440], ['ar', 390]]) {
    const { page, calls } = await boot(t, { lang, width, height: width < 700 ? 844 : 900, admin: true });
    await page.goto(`${BASE}/admin/discovery`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="find-buyers-center"] [role="tab"]', { timeout: 30000 });
    const tabs = page.locator('[data-testid="find-buyers-center"] [role="tab"]');
    if (await tabs.count() !== 8) failures.push(`${lang}: ${await tabs.count()} tabs`);
    await tabs.nth(7).click();
    await page.waitForSelector('[data-testid="fbx-intelligence"]', { timeout: 20000 });
    if (calls.intel !== 1) failures.push(`${lang}: intelligence read ${calls.intel}×`);
    const text = await page.locator('[data-testid="fbx-intelligence"]').innerText();
    if (!/89\.2% \(33\/37\)/.test(text)) failures.push(`${lang}: false-positive rate`);
    if (!/2 \/ 130/.test(text)) failures.push(`${lang}: Telegram free / paid`);
    if (!/FB_GROUP_POSTS/.test(text) || !/\$0\.050/.test(text)) failures.push(`${lang}: actor cost per qualified`);
    if (!/jobingeorgia/.test(text)) failures.push(`${lang}: source quality`);
    if (!/ACTOR_BUSY 51/.test(text)) failures.push(`${lang}: wait reasons`);
    if (/fbi_|fbx_|undefined|NaN/.test(text)) failures.push(`${lang}: raw key / undefined / NaN`);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 1) failures.push(`${lang}@${width}: overflow ${o}px`);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `admin-intelligence-${width}-${lang}.png`), fullPage: true }); }
    await page.context().close();
  }
  assert.deepEqual(failures, []);
});
