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
  is_deleted: false, created_at: new Date().toISOString(), photos: [],
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
    source: 'VK', overall_score: 81, strength: 'STRONG', similarity: 84, intent_score: 92, language: 'ru', author_name: 'Дмитрий К.',
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

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = false } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
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
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
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
    if (url.includes('/rest/v1/find_buyers_leads')) return r.fulfill(json(LEADS));
    if (url.includes('/rpc/find_buyers_public_config')) return r.fulfill(json({ minUsd: 10, creditsPerUsd: 10, minCredits: 100 }));
    if (url.includes('/functions/v1/match-campaign')) {
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.action === 'translate') {
        translateCalls.push(body);
        return r.fulfill(json({ ok: true, translation: `[${body.targetLang}] translated`, sourceLang: 'ar', cached: false }));
      }
      return r.fulfill(json({}));
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, translateCalls };
}

async function open(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`a[href="${COMMENT_URL}"]`, { timeout: 30000 });
}

const anchors = (page) => page.$$eval('article a[href]', (as) => as.map((a) => ({
  href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '', text: a.textContent?.trim() ?? '',
})));

test('a potential buyer card explains why, keeps the original, links its provenance, translates on request', opts, async (t) => {
  const { page, translateCalls } = await boot(t);
  await open(page);
  const body = await page.textContent('main');
  assert.match(body, /Potential buyers from public conversations/);
  assert.match(body, /Strong Match/);
  assert.match(body, /Commented on a recently listed 2-bedroom apartment in Krtsanisi\. Similar size and price range\./);
  assert.match(body, /Publicly asked for a 2-bedroom apartment in Krtsanisi\./);
  assert.ok(body.includes(AR_TEXT), 'the original Arabic is shown as written');
  assert.match(body, /Original · Arabic/);
  assert.match(body, /\+1 more public signals from this person/);
  assert.doesNotMatch(body, /memo23|apify|actor/i, 'no provider internals');
  const links = await anchors(page);
  for (const href of [COMMENT_URL, POST_URL, PROFILE_URL, 'https://vk.com/wall-123_456', 'https://vk.com/id12345']) {
    const l = links.find((x) => x.href === href);
    assert.ok(l, `link to ${href}`);
    assert.equal(l.target, '_blank');
    assert.match(l.rel, /noopener/); assert.match(l.rel, /noreferrer/);
  }
  for (const l of links) assert.match(l.href, /^https?:\/\//, `never a non-web link: ${l.href}`);
  assert.ok(links.some((l) => l.href === COMMENT_URL && /View original comment/.test(l.text)));
  await page.getByRole('button', { name: 'Translate to English' }).first().click();
  await page.waitForSelector('text=[en] translated');
  assert.equal(translateCalls[0].targetLang, 'en');
  assert.equal(translateCalls[0].signalId, 's1');
  assert.ok((await page.textContent('main')).includes(AR_TEXT), 'the original stays visible after translation');
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
        cards: document.querySelectorAll('article[aria-label] a[href^="https://www.facebook.com"]').length,
        small: [...document.querySelectorAll('article footer a')].filter((a) => a.getBoundingClientRect().height < 43).length,
      }));
      if (layout.overflow > 1) failures.push(`${lang} ${width}: horizontal overflow ${layout.overflow}px`);
      if (['ar', 'he'].includes(lang) && layout.dir !== 'rtl') failures.push(`${lang}: not RTL`);
      if (layout.cards < 2) failures.push(`${lang} ${width}: cards missing`);
      if (layout.small > 0) failures.push(`${lang} ${width}: ${layout.small} provenance action(s) under 44px`);
      const text = await page.textContent('main');
      if (/fbx_/.test(text)) failures.push(`${lang} ${width}: untranslated key`);
      if (lang !== 'ar' && !/·/.test(text)) failures.push(`${lang} ${width}: original-language label missing`);
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
  campaigns: [{ matching_job_id: 'job1', transaction: 'SALE', credits_committed: 100, credits_per_usd: 10, credits_charged: 67, revenue_micros: 6700000, customer_value_micros: 10000000, provider_budget_micros: 5000000, reserved_micros: 0, provider_micros: 2100000, ai_micros: 11000, translation_micros: 600, other_micros: 0, total_cogs_micros: 2111600, leads: 5, strong: 2, job_status: 'completed', created_at: ago(1), last_activity_at: ago(1) }],
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
      if (n !== 6) failures.push(`${lang} ${width}: ${n} tabs`);
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
