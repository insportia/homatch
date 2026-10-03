// META ADS BUILDER — behaviour and layout, in a real browser.
//
// The complaints this gate exists to make impossible:
//   · "I selected 'another offer' and could not unselect it."
//   · "There is no Back; going back loses what I entered."
//   · "'Text with HOMATCH AI' takes me out of the campaign."
//   · a builder that works in one language and at one width only.
//
// Every request leaves the page to a fixture: the meta-ads-api edge function,
// PostgREST, storage signing. So this runs offline against the harness build
// and needs no Meta account and no Supabase project.
//
// Checked at 1440px and 390px, in all six locales, on every step:
//   no horizontal overflow, RTL for ar/he, Back and Continue present.
// Checked once in depth: offer select/unselect, Back/Continue moving through
// the URL, a reload returning to the same draft and step, and HOMATCH AI
// opening inline without leaving the builder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4351;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.META_ADS_QA_SHOTS || null;
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];
const STEPS = ['account', 'offer', 'goal', 'destination', 'audience', 'budget', 'creative', 'placements', 'brief', 'review'];

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
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'harness@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'harness@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const PROFILE = { id: 'u1', auth_id: 'u1', email: 'harness@example.test', is_admin: false, preferred_language: 'en', full_name: 'Harness User', plan: 'FREE', created_at: new Date().toISOString() };

// A 2x2 PNG, so image media renders without the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJgYGBAQAqCAMBCk4B9gAAAABJRU5ErkJggg==', 'base64');

function fixtures() {
  const campaign = {
    id: 'c1', user_id: 'u1', name: '', property_id: null, offer: null, goal: 'LEADS_ON_META', status: 'DRAFT',
    daily_budget_cents: 500, duration_days: 7, currency: 'USD', destination: { type: 'META_FORM', formId: 'form1' },
    audience_id: null, placements: { mode: 'RECOMMENDED' }, preflight: null, external_status: null, external_campaign_id: null,
    spend_cents: 0, results: null, special_ad_categories: [], last_error: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const status = {
    mode: 'MOCK',
    connection: { status: 'CONNECTED', health: 'CONNECTED', granted_scopes: ['ads_management'], missing_scopes: [] },
    assets: [
      { id: 'as1', kind: 'PAGE', external_id: 'p1', name: 'Vake Homes', selected: true, status: 'ACTIVE', capabilities: {} },
      { id: 'as2', kind: 'AD_ACCOUNT', external_id: 'act_1', name: 'Vake Homes Ads', selected: true, status: 'ACTIVE', capabilities: { account_status: 1, currency: 'USD' } },
      { id: 'as3', kind: 'INSTAGRAM', external_id: 'ig1', name: 'vakehomes', selected: true, status: 'ACTIVE', parent_external_id: 'p1', capabilities: {} },
      { id: 'as4', kind: 'LEAD_FORM', external_id: 'form1', name: 'Vake enquiry', selected: true, status: 'ACTIVE', parent_external_id: 'p1', capabilities: {} },
    ],
    wallet: { available_cents: 10000, reserved_cents: 0, spent_cents: 0, fees_cents: 0, deposited_cents: 10000, currency: 'USD' },
    settings: { feePercent: 9, minDurationDays: 2, minDailyCents: 200, maxDailyCents: 100000000,
      goalsEnabled: ['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'ENGAGEMENT', 'PROMOTE'],
      leadImportEnabled: true, audienceCreationEnabled: true, retargetingEnabled: true, aiAssistEnabled: true, publishingEnabled: true, countries: ['GE'] },
  };
  const creative = {
    id: 'cr1', user_id: 'u1', campaign_id: 'c1', kind: 'IMAGE', sort: 0,
    media: [{ path: 'u1/a.png', mime: 'image/png', size: 2000, width: 1080, height: 1350 }],
    headline: 'Two-bedroom in Vake', primary_text: 'Bright flat, parking included.', description: '', cta: 'SIGN_UP',
    destination_url: null, safety_status: 'PENDING',
  };
  // The dashboard as production held it on 2026-10-01: three drafts, one the
  // HOMATCH check sent back, and the real campaign the owner paused in Meta.
  const zero = { currency: 'USD', spendMinor: 0, impressions: 0, reach: null, clicks: 0, linkClicks: 0, landingPageViews: 0, leads: 0, messages: 0, registrations: 0, postEngagements: 0 };
  const noKpis = { spendMinor: 0, results: 0, costPerResultMinor: null, ctr: null, cpcMinor: null, cpmMinor: null, frequency: null, cplMinor: null, resultRate: null, cpqlMinor: null, qualificationRate: null, costPerViewingMinor: null, leadToViewingRate: null };
  const row = (id, status, extra = {}) => ({ ...campaign, id, status, name: '', external_status: null, guard_state: 'OK', last_error_key: null, launched_at: null,
    last_synced_at: null, totals: zero, kpis: noKpis, leads: 0, outcomes: { qualifiedLeads: 0, viewings: 0, won: 0 }, openRecommendations: 0, attention: false, ...extra });
  const dashboard = {
    campaigns: [
      row('911e571e-ff0a-463b-a0bf-0ae23eb71f27', 'PAUSED', { goal: 'MESSAGES', external_status: 'PAUSED', launched_at: '2026-09-30T18:30:56Z', last_synced_at: new Date(Date.now() - 120000).toISOString() }),
      row('d1d50dc1', 'NEEDS_CHANGES', { goal: 'ENGAGEMENT' }),
      row('829ab04d', 'DRAFT'), row('41e99f5c', 'DRAFT'), row('df990653', 'DRAFT'),
    ],
    summary: [{ currency: 'USD', totals: zero, kpis: noKpis, leads: 0, campaigns: 1 }],
    counts: { total: 5, active: 0, paused: 1, attention: 1 },
    serviceBalance: [],
  };
  return { campaign, status, creative, dashboard };
}

async function boot(t, { width, height, lang, admin = false, statusOver = null, campaignOver = null, creativeOver = null, preflightOver = null }) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const fx = fixtures();
  if (statusOver) fx.status = { ...fx.status, ...statusOver, connection: { ...fx.status.connection, ...(statusOver.connection ?? {}) } };
  if (campaignOver) Object.assign(fx.campaign, campaignOver);
  if (creativeOver) Object.assign(fx.creative, creativeOver);
  const calls = { patches: [], inserts: 0, actions: [], bodies: [], settingWrites: 0, creativePatches: [], creativeInserts: [] };
  const ADM = admin ? adminFixtures() : null;
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(admin ? { ...PROFILE, is_admin: true, role: 'admin' } : PROFILE));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (ADM) {
      if (url.includes('/rest/v1/admin_settings') && req.method() !== 'GET') { calls.settingWrites += 1; return r.fulfill(json({}, 403)); }
      if (url.includes('/rest/v1/meta_moderation_cases') && req.method() === 'PATCH') { calls.settingWrites += 1; return r.fulfill(json({}, 403)); }
      if (req.method() === 'HEAD') {
        const n = url.includes('meta_moderation_cases') ? 0 : url.includes('meta_leads') ? 2 : url.includes('meta_api_errors') ? 3 : 0;
        return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `0-0/${n}` }, body: '' });
      }
      if (url.includes('/rest/v1/meta_campaigns')) return r.fulfill(json(ADM.campaigns));
      if (url.includes('/rest/v1/admin_settings')) return r.fulfill(json(ADM.settings));
      if (url.includes('/functions/v1/meta-ads-api')) {
        const body = JSON.parse(req.postData() || '{}');
        calls.actions.push(body.action); calls.bodies.push(body);
        if (body.action === 'admin_test_connection') return r.fulfill(json(ADM.probe));
        if (body.action === 'admin_setting_set') return r.fulfill(json({ ok: true, key: body.key, value: body.value }));
        if (body.action === 'admin_sync') return r.fulfill(json({ ok: true, status: 'PAUSED', external_status: 'PAUSED' }));
        if (body.action === 'admin_meta_people') return r.fulfill(json({ people: Object.fromEntries((body.userIds ?? []).filter((id) => ADM.people[id]).map((id) => [id, ADM.people[id]])) }));
        return r.fulfill(json({ ok: true }));
      }
    }
    if (url.includes('/functions/v1/meta-ads-api')) {
      const body = JSON.parse(req.postData() || '{}');
      calls.actions.push(body.action);
      if (body.action === 'status') return r.fulfill(json(fx.status));
      if (body.action === 'dashboard') return r.fulfill(json(fx.dashboard));
      if (body.action === 'plan_preview') return r.fulfill(json({ issues: [], totals: { mediaCents: 3500, feeCents: 315, totalCents: 3815, feePercent: 9 }, recommendedPlacements: ['facebook_feed', 'facebook_stories', 'instagram_feed', 'instagram_stories'], requirements: [], summary: null }));
      if (body.action === 'preflight') return r.fulfill(json(preflightOver ?? { status: 'READY', warnings: 1, checks: [{ key: 'connection', state: 'READY', ok: true }, { key: 'integration_mode', state: 'WARNING', ok: true, detail: 'MOCK_MODE_NOTHING_REACHES_META' }] }));
      // The universal location search, as the edge answers it: countries from CLDR names, then Meta's places.
      if (body.action === 'geo_search') {
        calls.bodies.push(body);
        const q = String(body.q ?? '');
        const GE = { type: 'country', key: 'GE', name: String(body.locale).startsWith('ka') ? 'საქართველო' : 'Georgia', countryCode: 'GE' };
        const countryName = String(body.locale).startsWith('ka') ? 'საქართველო' : 'Georgia';
        const TB = { type: 'city', key: '1958367', name: 'Tbilisi', countryCode: 'GE', countryName, region: 'Tbilisi', lat: 41.7151, lng: 44.8271 };
        const VK = { type: 'neighborhood', key: '2340912', name: 'Vake', countryCode: 'GE', region: 'Tbilisi', metaType: 'neighborhood', lat: 41.709, lng: 44.75 };
        const results = /საქართველო|georgia|грузия|sakartvelo/i.test(q) ? [GE] : /თბილისი|tbilisi|тбилиси/i.test(q) ? [TB] : /vake|ვაკე|ваке/i.test(q) ? [VK] : [];
        return r.fulfill(json({ results, variant: 0, street: false }));
      }
      if (body.action === 'ai_copy' && body.op === 'TRANSLATE') {
        calls.bodies.push(body);
        return r.fulfill(json({ variants: [{ primaryText: 'Bright apartment with a balcony in Vake.', headline: 'Vake 2BR', description: '' }] }));
      }
      if (body.action === 'ai_copy') return r.fulfill(json({ variants: [{ primaryText: 'Sunny two-bedroom in Vake.', headline: 'Vake 2BR', description: '' }] }));
      // Meta's own catalogues and estimate, as the edge answers them (fixtures, never a real call).
      if (body.action === 'locale_search') {
        const names = { ru: 'Russian', en: 'English (All)', ka: 'Georgian' };
        const keys = { ru: '17', en: '1001', ka: '28' };
        return r.fulfill(json({ results: names[body.code] ? [{ key: keys[body.code], name: names[body.code], code: body.code }] : [] }));
      }
      if (body.action === 'brief_interpret') {
        calls.bodies.push(body);
        const u = {
          hash: fx.briefHash ?? '', source: 'AI', at: new Date().toISOString(),
          summary: 'You want Russian-speaking people living in Georgia or moving here; the balcony and location matter most.',
          audiences: ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE'], languages: ['ru'], markets: ['KZ'], places: [], sellingPoints: ['balcony', 'location'],
          expectation: 'MESSAGES', ignored: [],
        };
        fx.campaign.brief_understanding = u;
        return r.fulfill(json({ understanding: u }));
      }
      if (body.action === 'delivery_estimate') return r.fulfill(json({ available: true, source: 'META_DELIVERY_ESTIMATE', audience: { lower: 120000, upper: 150000 } }));
      return r.fulfill(json({ ok: true }));
    }
    if (url.includes('/rest/v1/meta_campaigns')) {
      if (req.method() === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.patches.push(b); Object.assign(fx.campaign, b); return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
      if (req.method() === 'POST') { calls.inserts += 1; return r.fulfill(json(fx.campaign, 201)); }
      return r.fulfill(json(wantsObject ? fx.campaign : [fx.campaign]));
    }
    if (url.includes('/rest/v1/meta_creatives')) {
      // A saved edit is what a reload reads back.
      if (req.method() === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); calls.creativePatches.push(b); Object.assign(fx.creative, b); return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); calls.creativeInserts.push(b); return r.fulfill(json({ ...fx.creative, ...b, id: `cr${calls.creativeInserts.length + 1}` }, 201)); }
      return r.fulfill(json(wantsObject ? fx.creative : [fx.creative]));
    }
    if (url.includes('/rest/v1/property_facts')) {
      const facts = { latitude: 41.7099, longitude: 44.7516, city: 'Tbilisi', district: 'Vake' };
      return r.fulfill(json(wantsObject ? facts : [facts]));
    }
    if (url.includes('/rest/v1/properties')) {
      const prop = { id: '0f0f0f0f-0000-4000-8000-000000000001', title: 'Vake two-bedroom', homatch_id: 123456, transaction_type: 'SALE' };
      return r.fulfill(json(wantsObject ? prop : [prop]));
    }
    if (url.includes('/storage/v1/object/sign/')) return r.fulfill(json({ signedURL: '/object/sign/meta-ads-media/u1/a.png?token=t' }));
    if (url.includes('/storage/v1/object/')) return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls };
}

const LAYOUT = () => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'ltr',
  buttons: document.querySelectorAll('[data-madsb-nav] button').length,
  // Back/Continue must be the topmost element at their own centre: the app rail,
  // the mobile bottom nav or a floating button covering them is a broken builder.
  covered: [...document.querySelectorAll('[data-madsb-nav] button:not([disabled])')].filter((b) => {
    const r = b.getBoundingClientRect();
    // A control not shown at this width (the footer's gap link below sm) cannot be covered.
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit || !b.contains(hit);
  }).length,
});

async function waitReady(page) {
  await page.waitForSelector('[data-madsb-stepper]', { timeout: 20000 });
  await page.waitForTimeout(300);
}

/** Open a folded section (FinishKit Fold / the review insights) if it is closed. */
async function openFold(page, selector) {
  const el = page.locator(selector).first();
  if ((await el.getAttribute('aria-expanded')) === 'false') await el.click();
  await page.waitForSelector(`${selector}[aria-expanded="true"]`);
}

/* The last control must scroll fully above the builder bar; money on one line. */
const BOTTOM = () => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  const nav = document.querySelector('[data-madsb-nav]')?.getBoundingClientRect();
  const controls = [...document.querySelectorAll('main button, main a[href], main input, main textarea, main select')]
    // The page's own controls: not the bar itself, nor anything fixed (the app shell's nested <main> holds both).
    .filter((el) => !el.closest('[data-madsb-nav]') && ![...function* up(n) { for (; n; n = n.parentElement) yield n; }(el)].some((n) => getComputedStyle(n).position === 'fixed'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const last = controls.at(-1)?.getBoundingClientRect();
  const money = [...document.querySelectorAll('[data-charged-now]')].map((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 32;
    return el.getBoundingClientRect().height <= lh * 1.5;
  });
  const appNav = [...document.querySelectorAll('nav')].filter((n) => n !== document.querySelector('[data-madsb-nav]') && getComputedStyle(n).position === 'fixed'
    && n.getBoundingClientRect().bottom >= window.innerHeight - 1 && n.getBoundingClientRect().height > 0)
    .filter((n) => { const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 4); return hit && n.contains(hit); });
  const lastEl = controls.at(-1);
  const what = lastEl ? `${lastEl.tagName.toLowerCase()} "${(lastEl.textContent || '').trim().slice(0, 30)}" bottom ${Math.round(last.bottom)} vs bar ${Math.round(nav?.top ?? 0)}, page ${document.documentElement.scrollHeight}/${window.scrollY + window.innerHeight}` : '';
  return { what, lastClear: !last || !nav || last.bottom <= nav.top + 1, moneyOneLine: money.every(Boolean), appNavVisible: appNav.length };
};

for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [360, 760], [430, 932], [768, 1024]]) {
  test(`every step fits at ${width}px — ${width === 1440 || width === 390 ? 'every locale' : 'en, ka, ar'}; nothing hides under the bar`, opts, async (t) => {
    if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of (width === 1440 || width === 390 ? LOCALES : ['en', 'ka', 'ar'])) {
      const { page } = await boot(t, { width, height, lang });
      for (const step of STEPS) {
        await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=${step}`, { waitUntil: 'domcontentloaded' });
        await waitReady(page);
        const l = await page.evaluate(LAYOUT);
        if (l.overflow > 1) failures.push(`${lang} ${width}px ${step}: horizontal overflow ${l.overflow}px`);
        if (l.buttons < 2) failures.push(`${lang} ${width}px ${step}: Back/Continue missing`);
        if (l.covered) failures.push(`${lang} ${width}px ${step}: ${l.covered} of Back/Continue covered`);
        if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang} ${width}px ${step}: not RTL`);
        if (step === 'creative' || step === 'budget' || step === 'review' || step === 'audience') {
          const b = await page.evaluate(BOTTOM);
          if (!b.lastClear) failures.push(`${lang} ${width}px ${step}: the last control is under the bar — ${b.what}`);
          if (!b.moneyOneLine) failures.push(`${lang} ${width}px ${step}: an amount wraps`);
          if (width < 768 && b.appNavVisible) failures.push(`${lang} ${width}px ${step}: two bottom bars`);
        }
        if (SHOTS && (lang === 'en' || lang === 'ka' || lang === 'ar')) {
          mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: join(SHOTS, `${width}-${lang}-${step}.png`), fullPage: true });
        }
      }
    }
    assert.deepEqual(failures, []);
  });
}

test('offer can be selected, changed and unselected; Back/Continue move through the URL; reload keeps the place', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=offer`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const property = page.locator('button[aria-pressed]', { hasText: 'Vake two-bedroom' });
  const other = page.locator('button[aria-pressed]', { hasText: 'Another product or service' });
  await property.click();
  assert.equal(await property.getAttribute('aria-pressed'), 'true');
  await property.click();
  assert.equal(await property.getAttribute('aria-pressed'), 'false', 'clicking the selected property clears it');
  await other.click();
  assert.equal(await other.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('input[placeholder]').count() > 0, 'the offer name field appears');
  await other.click();
  assert.equal(await other.getAttribute('aria-pressed'), 'false', 'the other-offer choice can be unselected');
  await property.click();
  assert.equal(await other.getAttribute('aria-pressed'), 'false', 'changing the choice moves the selection');

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/step=goal/);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForURL(/step=offer/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.match(page.url(), /draft=c1/);
  assert.match(page.url(), /step=offer/);
  assert.equal(calls.inserts, 0, 'navigating and reloading never creates another draft row');
  assert.ok(calls.patches.length > 0, 'edits were saved to the one draft');
});

test('the two-day minimum is refused in the browser, and the money card comes from the server', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=budget`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const days = page.locator('input[inputmode="numeric"]');
  await days.fill('1');
  await page.waitForTimeout(900);
  assert.ok(!calls.patches.some((p) => p.duration_days === 1), 'one day is never saved');
  assert.equal(await days.getAttribute('aria-invalid'), 'true');
  await days.fill('3');
  await page.waitForTimeout(900);
  assert.ok(calls.patches.some((p) => p.duration_days === 3), 'three days is saved');
  const text = await page.textContent('body');
  assert.match(text, /\$35\.00/, 'the ad budget shown is the server budget');
  assert.match(text, /\$3\.15/, 'the 9% fee shown is the server fee');
  /* Customer ad-account billing: Meta bills the budget; HOMATCH charges only
     its fee now — never budget + fee. */
  const chargedNow = await page.locator('[data-charged-now]').first().textContent();
  assert.match(chargedNow ?? '', /\$3\.15/, 'charged by HOMATCH now is the fee alone');
  assert.doesNotMatch(chargedNow ?? '', /\$38\.15/, 'budget + fee is never presented as charged by HOMATCH');
  assert.ok(calls.actions.includes('plan_preview'));
});

test('HOMATCH AI opens inside the builder, suggests, and never navigates away', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const before = page.url();
  await page.locator('[data-madsb-ai]').first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  assert.equal(page.url(), before, 'still on the builder');
  await page.getByRole('dialog').getByRole('button', { name: 'Write new' }).click();
  await page.waitForSelector('text=Sunny two-bedroom in Vake.', { timeout: 10000 });
  const textarea = page.locator('textarea').first();
  assert.equal(await textarea.inputValue(), 'Bright flat, parking included.', 'nothing overwritten before acceptance');
  await page.getByRole('dialog').getByRole('button', { name: 'Use this' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('textarea').first().inputValue(), 'Sunny two-bedroom in Vake.', 'accepted text lands in the editable field');
  assert.ok(calls.actions.includes('ai_copy'));
  assert.equal(page.url(), before);
});

/* ── THE DASHBOARD: status that matches Meta, counts that are filters ──── */

const DASH = () => {
  const kpi = (f) => document.querySelector(`[data-mm-kpi="${f}"]`);
  const cards = [...document.querySelectorAll('[data-mm-campaign-card]')];
  const label = kpi('attention')?.querySelector('span > span:last-child');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'ltr',
    values: Object.fromEntries(['all', 'active', 'paused', 'attention'].map((f) => [f, kpi(f)?.getAttribute('data-mm-kpi-value')])),
    pressed: ['all', 'active', 'paused', 'attention'].filter((f) => kpi(f)?.getAttribute('aria-pressed') === 'true'),
    cards: cards.map((c) => c.getAttribute('data-mm-campaign-card')),
    // The attention label on one line, and nothing clipped inside any KPI.
    attentionLines: label ? Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight || '15')) : 0,
    kpiClipped: [...document.querySelectorAll('[data-mm-kpi]')].filter((b) => b.scrollWidth > b.clientWidth + 1).length,
    smallTargets: [...document.querySelectorAll('[data-mm-kpi]')].filter((b) => b.getBoundingClientRect().height < 44).length,
    // Scrolled to the end, no tappable element of the page sits under a
    // fixed control (the floating AI shortcut, the mobile bottom nav).
    lastCovered: (() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const fixed = [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > 0)
        .map((e) => ({ e, r: e.getBoundingClientRect() }));
      const targets = [...document.querySelectorAll('main a, main button, [data-mm-campaign-card], [data-mm-kpi]')]
        .filter((t) => !fixed.some((f) => f.e.contains(t)));
      return targets.filter((t) => {
        const r = t.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= innerHeight) return false;
        return fixed.some(({ r: f }) => !(r.right <= f.left || r.left >= f.right || r.bottom <= f.top || r.top >= f.bottom));
      }).map((t) => (t.getAttribute('data-mm-campaign-card') ?? t.getAttribute('aria-label') ?? t.textContent ?? '').slice(0, 40));
    })(),
  };
};

async function dashReady(page) {
  await page.waitForSelector('[data-mm-kpis] [data-mm-kpi="all"]', { timeout: 20000 });
  await page.waitForTimeout(250);
}

for (const [width, height] of [[360, 760], [390, 844], [412, 915], [1440, 900]]) {
  test(`dashboard at ${width}px, every locale: Meta-paused is Paused, counts are honest, nothing clipped or covered`, opts, async (t) => {
    if (skipReason) assert.fail(`meta ads dashboard gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height, lang });
      await page.goto(`${BASE}/outreach/meta?tab=overview`, { waitUntil: 'domcontentloaded' });
      await dashReady(page);
      const d = await page.evaluate(DASH);
      const tag = `${lang} ${width}px`;
      if (d.overflow > 1) failures.push(`${tag}: horizontal overflow ${d.overflow}px`);
      if (JSON.stringify(d.values) !== JSON.stringify({ all: '5', active: '0', paused: '1', attention: '1' })) failures.push(`${tag}: counts ${JSON.stringify(d.values)}`);
      if (d.cards.filter((c) => c === 'PAUSED').length !== 1 || d.cards.includes('ACTIVE')) failures.push(`${tag}: cards ${d.cards.join(',')}`);
      if (d.kpiClipped) failures.push(`${tag}: ${d.kpiClipped} KPI control(s) clip their text`);
      if (d.smallTargets) failures.push(`${tag}: ${d.smallTargets} KPI control(s) under 44px tall`);
      if (lang === 'ka' && d.attentionLines > 1) failures.push(`${tag}: the Georgian attention label wraps (${d.attentionLines} lines)`);
      if (d.lastCovered.length) failures.push(`${tag}: under a fixed control at the end of the page: ${d.lastCovered.join(' | ')}`);
      if ((lang === 'ar' || lang === 'he') && d.dir !== 'rtl') failures.push(`${tag}: not RTL`);
      if (SHOTS && (lang === 'en' || lang === 'ka')) {
        mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(SHOTS, `dashboard-${width}-${lang}.png`), fullPage: true });
      }
    }
    assert.deepEqual(failures, []);
  });
}

test('dashboard: tapping a count filters the list to exactly those campaigns, and a card opens its campaign', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads dashboard gate could not run: ${skipReason}`);
  const { page } = await boot(t, { width: 390, height: 844, lang: 'ka' });
  await page.goto(`${BASE}/outreach/meta?tab=overview`, { waitUntil: 'domcontentloaded' });
  await dashReady(page);
  const tap = async (f) => { await page.locator(`[data-mm-kpi="${f}"]`).click(); await page.waitForTimeout(150); return page.evaluate(DASH); };

  let d = await tap('active');
  assert.deepEqual(d.pressed, ['active']);
  assert.deepEqual(d.cards, [], 'nothing is running at Meta');
  assert.equal(await page.locator('[data-mm-filtered-empty]').count(), 1, 'an honest empty filtered state');
  assert.match(page.url(), /view=active/);

  d = await tap('paused');
  assert.deepEqual(d.cards, ['PAUSED']);
  assert.ok(await page.locator('[data-mm-campaign-card="PAUSED"] [data-mm-synced]').count() === 1, 'Paused · synced with Meta');

  d = await tap('attention');
  assert.deepEqual(d.cards, ['NEEDS_ATTENTION']);
  assert.equal(await page.locator('[data-mm-campaign-card] [data-mm-warning]').count(), 1);

  d = await tap('all');
  assert.equal(d.cards.length, 5);
  assert.deepEqual(d.pressed, ['all']);

  // Tapping a selected filter again returns to all.
  await tap('paused');
  d = await tap('paused');
  assert.deepEqual(d.pressed, ['all']);

  // Anywhere on the card — here its delivery line, not the chevron — opens the campaign.
  assert.equal(await page.locator('[data-mm-campaign-card="PAUSED"] [data-mm-no-delivery]').count(), 1, 'no zeros pretending to be results');
  await page.locator('[data-mm-campaign-card="PAUSED"] [data-mm-no-delivery]').click();
  await page.waitForURL(/\/outreach\/meta\/campaigns\/911e571e/, { timeout: 10000 });
  // A draft opens the builder.
  await page.goto(`${BASE}/outreach/meta?tab=overview`, { waitUntil: 'domcontentloaded' });
  await dashReady(page);
  await page.locator('[data-mm-campaign-card="DRAFT"]').first().click({ position: { x: 30, y: 30 } });
  await page.waitForURL(/\/outreach\/meta\/create\?draft=/, { timeout: 10000 });
  // The view survives a reload.
  await page.goto(`${BASE}/outreach/meta?tab=overview&view=paused`, { waitUntil: 'domcontentloaded' });
  await dashReady(page);
  d = await page.evaluate(DASH);
  assert.deepEqual(d.pressed, ['paused']);
  assert.deepEqual(d.cards, ['PAUSED']);
});

/* ── ADMIN CONTROL CENTER ───────────────────────────────────────────────── */

/* Production's five campaigns on 2026-10-01, plus one at Meta review that
   Meta has disapproved and that has not been read for 45 minutes: one
   discrepancy, one stale sync — and still nothing delivering. */
function adminFixtures() {
  const t = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const c = (id, status, extra = {}) => ({ id, user_id: 'u2', name: `Campaign ${id.slice(0, 4)}`, goal: 'LEADS_ON_META', status, external_status: null,
    guard_state: 'OK', last_error: null, launched_at: null, external_campaign_id: null, last_synced_at: null, daily_budget_cents: 500, duration_days: 7,
    special_ad_categories: ['HOUSING'], property_id: null, created_at: t(600), ...extra });
  return {
    campaigns: [
      c('911e571e-ff0a-463b-a0bf-0ae23eb71f27', 'PAUSED', { user_id: 'b0b00000-0000-4000-8000-0000000000aa', external_status: 'PAUSED', launched_at: t(720), external_campaign_id: '120200000000001', ad_account_external_id: 'act_920919324393041', last_synced_at: t(2) }),
      c('d1d50dc1-0000-4000-8000-000000000001', 'NEEDS_CHANGES'),
      c('829ab04d-0000-4000-8000-000000000002', 'DRAFT'), c('41e99f5c-0000-4000-8000-000000000003', 'DRAFT'), c('df990653-0000-4000-8000-000000000004', 'DRAFT'),
      c('7c0ffee0-0000-4000-8000-000000000005', 'META_REVIEW', { external_status: 'DISAPPROVED', launched_at: t(200), external_campaign_id: '120200000000002', last_synced_at: t(45) }),
    ],
    settings: [
      { key: 'meta_ads_autopilot_enabled', value: false }, { key: 'meta_ads_enabled', value: true },
      { key: 'meta_ads_fee_percent', value: 9 }, { key: 'meta_ads_guard_policy', value: {} },
    ],
    people: {
      'b0b00000-0000-4000-8000-0000000000aa': { id: 'b0b00000-0000-4000-8000-0000000000aa', name: 'Nino Beridze', username: 'nino', email: 'nino@example.test', suspended: false,
        connection: { status: 'CONNECTED', instantFormsMissing: ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata'] }, adAccounts: [{ id: 'act_920919324393041', name: 'Nino Ads', selected: true }] },
    },
    probe: { mode: 'REAL', secretsConfigured: true, webhookVerifyTokenConfigured: true, tokenEncryptionConfigured: true, redirectUriConfigured: false,
      capabilities: [{ key: 'LEADS_ON_META', status: 'VERIFIED_SUPPORTED' }], lastStatusSyncAt: t(1), lastUsageReportAt: t(3), checkedAt: t(0) },
  };
}

const ADMIN = () => {
  const kpi = (f) => document.querySelector(`[data-mm-admin-kpi="${f}"]`);
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'ltr',
    values: Object.fromEntries(['all', 'delivering', 'paused', 'review', 'drafts', 'attention', 'discrepancy', 'stale'].map((f) => [f, kpi(f)?.getAttribute('data-mm-admin-kpi-value')])),
    clipped: [...document.querySelectorAll('[data-mm-admin-kpi]')].filter((b) => b.scrollWidth > b.clientWidth + 1).length,
    small: [...document.querySelectorAll('[data-mm-admin-kpi]')].filter((b) => b.getBoundingClientRect().height < 44).length,
    rows: [...document.querySelectorAll('[data-mm-admin-campaign]')].map((r) => ({
      id: r.getAttribute('data-mm-admin-campaign').slice(0, 8),
      status: r.querySelector('[data-mm-status]')?.getAttribute('data-mm-status'),
      lifecycle: r.querySelector('[data-mm-lifecycle]')?.getAttribute('data-mm-lifecycle'),
      meta: r.querySelector('[data-mm-meta-status]')?.getAttribute('data-mm-meta-status'),
      sync: r.querySelector('[data-mm-sync]')?.getAttribute('data-mm-sync'),
      discrepancy: r.querySelector('[data-mm-discrepancy]')?.getAttribute('data-mm-discrepancy') ?? null,
    })),
    text: document.body.innerText,
  };
};
const adminReady = (page, sel = '[data-mm-admin-kpi="all"]') => page.waitForSelector(sel, { timeout: 20000 }).then(() => page.waitForTimeout(250));

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`admin Meta Ads at ${width}px, every locale: paused is not delivering, KPIs and campaign states fit`, opts, async (t) => {
    if (skipReason) assert.fail(`meta ads admin gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height, lang, admin: true });
      await page.goto(`${BASE}/admin/meta-ads`, { waitUntil: 'domcontentloaded' });
      await adminReady(page);
      const o = await page.evaluate(ADMIN);
      const tag = `${lang} ${width}px`;
      const want = { all: '6', delivering: '0', paused: '1', review: '1', drafts: '3', attention: '1', discrepancy: '1', stale: '1' };
      if (JSON.stringify(o.values) !== JSON.stringify(want)) failures.push(`${tag}: KPIs ${JSON.stringify(o.values)}`);
      if (o.overflow > 1) failures.push(`${tag}: overview overflows ${o.overflow}px`);
      if (o.clipped) failures.push(`${tag}: ${o.clipped} KPI tile(s) clip`);
      if (o.small) failures.push(`${tag}: ${o.small} KPI tile(s) under 44px`);
      if ((lang === 'ar' || lang === 'he') && o.dir !== 'rtl') failures.push(`${tag}: not RTL`);
      await page.goto(`${BASE}/admin/meta-ads?tab=campaigns`, { waitUntil: 'domcontentloaded' });
      await adminReady(page, '[data-mm-admin-campaign]');
      const c = await page.evaluate(ADMIN);
      if (c.overflow > 1) failures.push(`${tag}: campaigns overflow ${c.overflow}px`);
      if (c.rows.length !== 6) failures.push(`${tag}: ${c.rows.length} campaign rows`);
      if (SHOTS && (lang === 'en' || lang === 'ka')) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `admin-campaigns-${width}-${lang}.png`), fullPage: true });
        await page.goto(`${BASE}/admin/meta-ads`, { waitUntil: 'domcontentloaded' });
        await adminReady(page);
        await page.screenshot({ path: join(SHOTS, `admin-overview-${width}-${lang}.png`), fullPage: true });
      }
    }
    assert.deepEqual(failures, []);
  });
}

test('admin: a KPI opens exactly its records; the row shows HOMATCH, canonical and Meta state, freshness and the mismatch', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads admin gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en', admin: true });
  await page.goto(`${BASE}/admin/meta-ads`, { waitUntil: 'domcontentloaded' });
  await adminReady(page);

  await page.locator('[data-mm-admin-kpi="paused"]').click();
  await page.waitForURL(/tab=campaigns&view=paused/);
  await adminReady(page, '[data-mm-admin-campaign]');
  let o = await page.evaluate(ADMIN);
  assert.deepEqual(o.rows, [{ id: '911e571e', status: 'PAUSED', lifecycle: 'PAUSED', meta: 'PAUSED', sync: 'FRESH', discrepancy: null }]);

  await page.goto(`${BASE}/admin/meta-ads`, { waitUntil: 'domcontentloaded' });
  await adminReady(page);
  await page.locator('[data-mm-admin-kpi="delivering"]').click();
  await page.waitForURL(/view=delivering/);
  await page.waitForSelector('[data-mm-admin-empty="delivering"]', { timeout: 10000 });
  assert.equal((await page.evaluate(ADMIN)).rows.length, 0, 'nothing is delivering: the paused campaign is not counted or listed');

  await page.goto(`${BASE}/admin/meta-ads?tab=campaigns&view=discrepancy`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-admin-campaign]');
  o = await page.evaluate(ADMIN);
  assert.deepEqual(o.rows.map((r) => [r.id, r.lifecycle, r.meta, r.sync, r.discrepancy]), [['7c0ffee0', 'META_REVIEW', 'DISAPPROVED', 'STALE', 'META_PROBLEM']]);
  assert.match(o.text, /Meta reports a problem: DISAPPROVED/);

  await page.goto(`${BASE}/admin/meta-ads?tab=campaigns&view=stale`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-admin-campaign]');
  assert.deepEqual((await page.evaluate(ADMIN)).rows.map((r) => r.id), ['7c0ffee0']);

  // Drafts are not "never synced": nothing at Meta is read for them.
  await page.goto(`${BASE}/admin/meta-ads?tab=campaigns&view=drafts`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-admin-campaign]');
  assert.deepEqual([...new Set((await page.evaluate(ADMIN)).rows.map((r) => r.sync))], ['NOT_SYNCED']);

  // Manual sync of the paused campaign: the audited server action, then a re-read.
  await page.goto(`${BASE}/admin/meta-ads?tab=campaigns&view=paused`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-admin-campaign]');
  await page.locator('[data-mm-admin-campaign]').click();
  await page.getByRole('button', { name: /sync/i }).last().click();
  await page.waitForTimeout(300);
  assert.ok(calls.bodies.some((b) => b.action === 'admin_sync' && b.campaignId === '911e571e-ff0a-463b-a0bf-0ae23eb71f27'));
});

test('admin: a setting changes only through the audited server action, with a reason; API health shows booleans only', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads admin gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'en', admin: true });
  await page.goto(`${BASE}/admin/meta-ads?tab=settings`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-setting="meta_ads_autopilot_enabled"]');
  const row = page.locator('[data-mm-setting="meta_ads_autopilot_enabled"]');
  await row.locator('[data-mm-switch]').click();
  const staged = page.locator('[data-mm-setting-staged="meta_ads_autopilot_enabled"]');
  const save = staged.getByRole('button', { name: 'Save' });
  assert.equal(await save.isDisabled(), true, 'no reason, no save');
  assert.equal(calls.actions.filter((a) => a === 'admin_setting_set').length, 0, 'staging writes nothing');
  await staged.locator('input').fill('Owner approved autopilot trial');
  await save.click();
  await page.waitForTimeout(300);
  const sent = calls.bodies.find((b) => b.action === 'admin_setting_set');
  assert.deepEqual(sent, { action: 'admin_setting_set', key: 'meta_ads_autopilot_enabled', value: true, reason: 'Owner approved autopilot trial' });

  // A fee the server would refuse is refused before it is sent.
  const fee = page.locator('[data-mm-setting="meta_ads_fee_percent"] input');
  await fee.fill('9.125');
  await page.locator('[data-mm-setting-staged="meta_ads_fee_percent"] input').fill('typo test');
  await page.locator('[data-mm-setting-staged="meta_ads_fee_percent"]').getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('[data-mm-setting-staged="meta_ads_fee_percent"] [role="alert"]');
  assert.equal(calls.bodies.filter((b) => b.action === 'admin_setting_set').length, 1);
  assert.equal(calls.settingWrites, 0, 'the browser never writes admin_settings or a moderation case itself');

  await page.goto(`${BASE}/admin/meta-ads?tab=api`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-probe="secrets"]');
  const probe = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-mm-probe]')].map((e) => [e.getAttribute('data-mm-probe'), e.getAttribute('data-mm-probe-value')])));
  assert.deepEqual(probe, { secrets: 'set', webhook: 'set', encryption: 'set', redirect: 'missing' });
  assert.equal(await page.locator('[data-mm-probe-fresh="fresh"]').count(), 1);
  assert.equal((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, true);
});

/* ── PRODUCTION POLISH: owners, Leads on Meta, smart audience, CTA ─────── */

test('admin: every campaign names its owner (name, email, ids) and search finds it by email or Meta id', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads admin gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en', admin: true });
  await page.goto(`${BASE}/admin/meta-ads?tab=campaigns`, { waitUntil: 'domcontentloaded' });
  await adminReady(page, '[data-mm-admin-campaign]');
  await page.waitForSelector('[data-mm-owner="b0b00000-0000-4000-8000-0000000000aa"] b', { timeout: 10000 });
  const line = await page.locator('[data-mm-admin-identity="911e571e-ff0a-463b-a0bf-0ae23eb71f27"]').innerText();
  for (const s of ['Nino Beridze', 'nino@example.test', '911e571e', '120200000000001', 'act_920919324393041', 'CONNECTED']) assert.ok(line.includes(s), `${s} in: ${line}`);
  assert.equal(calls.bodies.filter((b) => b.action === 'admin_meta_people').length, 1, 'one batched lookup for the whole list');
  const search = page.locator('[data-mm-admin-search]');
  for (const q of ['nino@example', 'Beridze', '120200000000001', '920919324393041']) {
    await search.fill(q);
    await page.waitForTimeout(100);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-mm-admin-campaign]')].map((r) => r.getAttribute('data-mm-admin-campaign').slice(0, 8)));
    assert.deepEqual(rows, ['911e571e'], q);
  }
  await search.fill('nobody@example');
  await page.waitForSelector('[data-mm-admin-empty]');
});

test('builder: Leads without the lead permissions reads as "Reconnect Meta" — never "terms not accepted", no permission names anywhere', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  // The production case: an old token (no lead permissions) — Meta's terms answer cannot be trusted yet.
  const { page } = await boot(t, { width: 390, height: 844, lang: 'en', statusOver: { mode: 'REAL', connection: { instant_forms_available: false, instant_forms: 'PERMISSIONS_MISSING', lead_terms: 'UNKNOWN', lead_checked_at: '2026-10-02T06:44:03Z', granted_scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'] } } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=goal`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Reconnect Meta to enable/);
  assert.doesNotMatch(text, /Coming soon/);
  assert.doesNotMatch(text, /leads_retrieval|pages_manage_ads|pages_manage_metadata|permission/i);
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=destination`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.equal(await page.locator('[data-mm-forms-state="PERMISSIONS_MISSING"]').count(), 1);
  assert.equal(await page.locator('[data-mm-lf-row="terms"]').getAttribute('data-mm-lf-row-state'), 'unknown', 'unknown terms are never shown as refused');
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /leads_retrieval|pages_manage_ads|pages_manage_metadata/);
});

test('builder: a Georgian property ad keeps the owner\'s ages and gender; Meta\'s rule appears only for a restricted country, named, with what will run', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const narrowed = { ageMin: 30, ageMax: 45, gender: 'FEMALE' };
  {
    const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'ka', campaignOver: {
      property_id: '123456',
      targeting: { locations: [{ type: 'city', key: '2001', name: 'ბათუმი', countryCode: 'GE', radiusKm: 10 }], ...narrowed },
    } });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-who-choice]');
    assert.equal(await page.locator('[data-mm-meta-rule]').count(), 0, 'no restriction in Georgia');
    assert.equal(await page.locator('[data-mm-gender="FEMALE"]').getAttribute('aria-pressed'), 'true', 'the owner\'s choice is shown as chosen');
    assert.equal(await page.locator('[data-mm-age-min]').inputValue(), '30');
    assert.equal(await page.locator('select[disabled], [data-mm-gender][disabled]').count(), 0, 'no dead controls');
    await page.waitForTimeout(500);
    assert.equal(calls.patches.filter((p) => p.targeting).length, 0, 'nothing silently reverted');
    await page.locator('[data-mm-gender="MALE"]').click();
    await page.waitForTimeout(300);
    assert.equal(calls.patches.map((p) => p.targeting).filter(Boolean).pop().gender, 'MALE', 'a new choice is saved as made');
    assert.match(await page.evaluate(() => document.body.innerText), /HOMATCH-ის რჩევა/);
  }
  {
    const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en', campaignOver: {
      property_id: '123456',
      targeting: { locations: [{ type: 'city', key: '2001', name: 'Batumi', countryCode: 'GE', radiusKm: 10 }, { type: 'country', key: 'DE', name: 'Germany', countryCode: 'DE' }], ...narrowed },
    } });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-meta-rule]');
    assert.equal(await page.locator('[data-mm-meta-rule]').getAttribute('data-mm-meta-rule'), 'DE');
    const text = await page.evaluate(() => document.querySelector('[data-mm-meta-rule]').innerText);
    assert.match(text, /Germany/);
    assert.match(text, /Meta's rule, not a HOMATCH choice/);
    await page.waitForTimeout(500);
    const saved = calls.patches.map((p) => p.targeting).filter(Boolean).pop();
    assert.deepEqual([saved.ageMin, saved.ageMax, saved.gender, saved.locations[0].radiusKm], [18, 65, 'ALL', 15], 'stores what Meta will run: the European floor');
  }
});

test('END TO END: a Russian-speaking expat messages campaign — map, international mode, language, priority, AI translation, brief, review — nothing launched', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `e2e-${name}.png`), fullPage: true }); } };
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { page, calls } = await boot(t, { width, height, lang: 'en',
      statusOver: { settings: { ...fixtures().status.settings, goalsEnabled: ['MESSAGES', 'LEADS_ON_META', 'PROMOTE'] } },
      campaignOver: { property_id: '123456', goal: 'MESSAGES', destination: { type: 'MESSAGING', messagingApp: 'MESSENGER' }, daily_budget_cents: 2000, duration_days: 10,
        targeting: { locations: [{ type: 'city', key: '1963014', name: 'Tbilisi', countryCode: 'GE', radiusKm: 17 }], ageMin: 18, ageMax: 65, gender: 'ALL' } },
      creativeOver: { primary_text: 'Продаётся светлая квартира с балконом в Ваке. 85 м², 7 этаж.', headline: 'Квартира в Ваке', cta: 'MESSAGE_PAGE' },
    });
    const at = `${width}px`;

    // 📍 Audience: the map, a live radius, around my property.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-map="georgia"]', { timeout: 15000 });
    assert.equal(await page.locator('[data-mm-map-circle="city:1963014"]').getAttribute('data-mm-map-km'), '17', at);
    await page.locator('[data-mm-radius="city:1963014"]').fill('25');
    await page.waitForFunction(() => document.querySelector('[data-mm-map-circle="city:1963014"]')?.getAttribute('data-mm-map-km') === '25', null, { timeout: 5000 });
    assert.equal(await page.locator('[data-mm-breadth]').getAttribute('data-mm-breadth'), 'BALANCED');
    await page.waitForSelector('[data-mm-around-property]');
    await page.locator('[data-mm-around-property]').click();
    await page.waitForSelector('[data-mm-loc^="pin:41.70990"]');
    if (SHOTS) { await page.waitForTimeout(600); await page.locator('[data-mm-map]').screenshot({ path: join(SHOTS, `e2e-${width}-map-georgia.png`) }); }

    // 🌍 International: foreigners here + people moving here, from Kazakhstan.
    await page.locator('[data-mm-intl-toggle]').click();
    await page.locator('[data-mm-intent="FOREIGNERS_IN_COUNTRY"]').click();
    await page.locator('[data-mm-intent="MOVING_HERE"]').click();
    await page.locator('[data-mm-markets] input').fill('Kazakh');
    await page.getByRole('option', { name: /Kazakhstan/ }).locator('button').dispatchEvent('mousedown');
    await page.waitForSelector('[data-mm-intl-suggest]');
    await page.locator('[data-mm-intl-suggest] button').click();
    await page.waitForSelector('[data-mm-map="world"]');
    if (SHOTS) { await page.waitForTimeout(600); await page.locator('[data-mm-map]').screenshot({ path: join(SHOTS, `e2e-${width}-map-world.png`) }); }
    // 🗣️ Language: Russian, from Meta's locale catalogue.
    await page.waitForSelector('[data-mm-copy-lang="ru"]');
    await page.locator('[data-mm-lang="ru"]').click();
    await page.waitForSelector('[data-mm-lang="ru"][aria-pressed="true"]');
    // 👥 Gender is a real choice here (Georgia and Kazakhstan are not restricted) — folded until opened.
    await openFold(page, '[data-mm-fold="who"]');
    await page.locator('[data-mm-gender="FEMALE"]').click();
    await page.waitForTimeout(800);
    await shot(page, `${width}-audience`);
    const tg = calls.patches.map((p) => p.targeting).filter(Boolean).pop();
    assert.ok(tg.locations.some((l) => l.type === 'pin' && l.countryCode === 'GE' && Math.abs(l.lat - 41.7099) < 1e-4), `${at} pin around the property`);
    assert.ok(tg.locations.some((l) => l.type === 'country' && l.key === 'KZ'), `${at} Kazakhstan reached`);
    assert.equal(tg.locations.find((l) => l.key === '1963014').radiusKm, 25);
    assert.deepEqual(tg.languages, [{ key: '17', name: 'Russian', code: 'ru' }]);
    assert.deepEqual(tg.international, { enabled: true, intents: ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE'], markets: ['KZ'] });
    assert.equal(tg.gender, 'FEMALE');

    // 🎨 Creative: priority, the language it is written in, AI translation as a new version.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-creative-lang="ru"]');
    await page.locator('[data-mm-priority-toggle]').click();
    await page.waitForSelector('[data-mm-priority="true"]');
    await page.locator('[data-mm-translate]').click();
    await page.waitForSelector('[data-mm-ai-translate]');
    await page.locator('[data-mm-ai-translate] button').click();
    await page.waitForSelector('[data-mm-ai-as-version]');
    await page.locator('[data-mm-ai-as-version]').click();
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await shot(page, `${width}-creative`);
    assert.ok(calls.creativePatches.some((b) => b.priority === true), `${at} priority saved`);
    const tr = calls.bodies.find((b) => b.action === 'ai_copy');
    assert.equal(tr.op, 'TRANSLATE');
    assert.equal(calls.creativeInserts.length, 1, `${at} one new language version`);
    assert.equal(calls.creativeInserts[0].primary_text, 'Bright apartment with a balcony in Vake.');
    assert.deepEqual(calls.creativeInserts[0].media, fixtures().creative.media, 'same photo, new text');

    // 💬 Brief: the owner's words, what HOMATCH understood, one-tap suggestions.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=brief`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const BRIEF = 'I mainly want Russian-speaking people living in Georgia or considering moving here. The location and balcony are the strongest parts.';
    await page.locator('[data-mm-brief]').fill(BRIEF);
    await page.waitForTimeout(800);
    assert.equal(calls.patches.map((p) => p.owner_brief).filter((x) => x != null).pop(), BRIEF, `${at} brief saved`);
    // The fixture echoes the hash the browser computes, as the server stores it.
    await page.evaluate(async (b) => {
      const s = b.trim(); let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      window.__briefHash = `b${h.toString(16)}_${s.length}`;
    }, BRIEF);
    const hash = await page.evaluate(() => window.__briefHash);
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.action !== 'brief_interpret') return r.fallback();
      calls.bodies.push(body);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ understanding: {
        hash, source: 'AI', at: new Date().toISOString(),
        summary: 'You want Russian-speaking people living in Georgia or moving here; the balcony and location matter most.',
        audiences: ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE'], languages: ['ru'], markets: [], places: [], sellingPoints: ['balcony', 'location'], expectation: 'MESSAGES', ignored: [],
      } }) });
    });
    await page.locator('[data-mm-brief-read]').click();
    await page.waitForSelector('[data-mm-understood="AI"]');
    const understood = await page.locator('[data-mm-understood]').innerText();
    assert.match(understood, /What HOMATCH understood/);
    assert.match(understood, /balcony/);
    assert.match(understood, /Foreigners living here/);
    assert.ok(calls.bodies.some((b) => b.action === 'brief_interpret' && b.campaignId === 'c1'));
    await shot(page, `${width}-brief`);

    // 🚀 Review: the campaign explained, what to expect, the holistic check.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=review`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    // The summary comes first; the explanation is one tap away.
    await page.waitForSelector('[data-mm-review-summary]');
    await page.waitForSelector('[data-mm-learning-stage="NEW"]');
    await openFold(page, '[data-mm-insights-toggle]');
    await page.waitForSelector('[data-mm-story]');
    const sections = await page.locator('[data-mm-story-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm-story-section')));
    for (const s of ['goal', 'who', 'where', 'language', 'creative', 'optimise', 'first_days']) assert.ok(sections.includes(s), `${at} story: ${s}`);
    const story = await page.locator('[data-mm-story]').innerText();
    assert.match(story, /Start conversations/);
    assert.match(story, /Russian/);
    assert.match(story, /priority creative/i);
    await page.waitForSelector('[data-mm-estimate="meta"]', { timeout: 8000 });
    assert.match(await page.locator('[data-mm-estimate]').innerText(), /120K–150K|120K-150K/);
    assert.match(await page.locator('[data-mm-expect]').innerText(), /never promises/i);
    await page.waitForSelector('[data-mm-learning]');
    await page.waitForSelector('[data-mm-consistency]');
    const layout = await page.evaluate(LAYOUT);
    assert.ok(layout.overflow <= 1, `${at} review: no horizontal overflow`);
    await shot(page, `${width}-review`);

    // Nothing was launched or charged, and the saved draft carries every choice.
    assert.ok(!calls.actions.includes('launch'), 'no launch');
    assert.ok(!calls.actions.includes('deposit_checkout'), 'no money moved');
    assert.equal(calls.inserts, 0, 'still the one draft');
  }
});

test('builder: the CTA and headline are edited in the editor, the preview follows live, and a reload keeps them', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 1440, height: 900, lang: 'en' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForSelector('[data-mm-cta-options]');
  const offered = (await page.locator('[data-mm-cta-options]').getAttribute('data-mm-cta-options')).split(',');
  assert.deepEqual(offered, ['SIGN_UP', 'LEARN_MORE', 'GET_QUOTE', 'APPLY_NOW', 'SUBSCRIBE'], 'only the lead-form CTAs Meta documents');
  await page.locator('[data-mm-cta="APPLY_NOW"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-mm-preview-zone="cta"]')].some((z) => /Apply now/i.test(z.textContent ?? '')), null, { timeout: 5000 });
  await page.locator('#madsb-field-cr1-headline').fill('Sunny 2BR in Vake');
  await page.waitForFunction(() => /Sunny 2BR in Vake/.test(document.querySelector('[data-mm-preview-zone="headline"]')?.textContent ?? ''), null, { timeout: 5000 });
  await page.waitForTimeout(900);
  assert.ok(calls.creativePatches.some((b) => b.cta === 'APPLY_NOW'), 'the CTA was saved');
  assert.ok(calls.creativePatches.some((b) => b.headline === 'Sunny 2BR in Vake'), 'the headline was saved');
  // The media is shown, not offered as an editor.
  assert.equal(await page.locator('[data-mm-preview-fixed="media"]').count() > 0, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForSelector('[data-mm-cta="APPLY_NOW"][aria-pressed="true"]');
  assert.equal(await page.locator('#madsb-field-cr1-headline').inputValue(), 'Sunny 2BR in Vake');
});


test('MOBILE: countries, cities and pins coexist; one effective-geography line says what runs', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page } = await boot(t, { width: 360, height: 760, lang: 'en', campaignOver: {
    targeting: { locations: [
      { type: 'pin', key: '41.70990,44.75160', name: 'Pin 1', countryCode: 'GE', lat: 41.7099, lng: 44.7516, radiusKm: 5 },
      { type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' },
      { type: 'city', key: '1963014', name: 'Tbilisi', countryCode: 'GE', radiusKm: 15 },
      { type: 'country', key: 'KZ', name: 'Kazakhstan', countryCode: 'KZ' },
    ], ageMin: 18, ageMax: 65, gender: 'ALL' },
  } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const line = await page.locator('[data-mm-geo-summary]').innerText();
  assert.match(line, /Georgia → Pin 1 · 5 km, Tbilisi · 15 km \+ Kazakhstan/);
  assert.equal(await page.locator('[data-mm-loc]').count(), 4, 'nothing replaced');
  assert.match(await page.locator('[data-mm-loc="country:GE"]').innerText(), /Only the places you chose inside it/);
  // Folded sections say what is chosen and open on request.
  assert.match(await page.locator('[data-mm-fold-section="who"]').innerText(), /18.+65\+ · /);
  await openFold(page, '[data-mm-fold="who"]');
  assert.equal(await page.locator('[data-mm-gender="ALL"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-mm-authority="USER_CHOICE"]').count(), 1);
  assert.equal(await page.locator('[data-mm-authority="META_REQUIRED"]').count(), 0, 'Georgia/Kazakhstan: no Meta rule');
  assert.equal(await page.locator('#mm-f-aud-h').count(), 0, 'no empty retargeting section');
});

test('MOBILE: a US-registered ad account follows Meta\'s housing rule even in Georgia — named as Meta\'s, from Meta\'s data', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const base = fixtures().status;
  const assets = base.assets.map((a) => (a.kind === 'AD_ACCOUNT' ? { ...a, capabilities: { ...(a.capabilities ?? {}), business_country_code: 'US' } } : a));
  const { page } = await boot(t, { width: 390, height: 844, lang: 'en', statusOver: { assets }, campaignOver: {
    property_id: '123456', targeting: { locations: [{ type: 'city', key: '1963014', name: 'Tbilisi', countryCode: 'GE', radiusKm: 30 }], ageMin: 18, ageMax: 65, gender: 'ALL' },
  } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForSelector('[data-mm-authority="META_REQUIRED"]');
  assert.match(await page.locator('[data-mm-meta-rule]').innerText(), /registered in the United States[\s\S]*Meta's rule, not a HOMATCH choice/);
});

test('MOBILE: priority is a binary ☆/★ toggle with words, aria-pressed and an explanation; the AI button says what it does', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { width: 320, height: 640, lang: 'ka' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const toggle = page.locator('[data-mm-priority-toggle]').first();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.match(await toggle.innerText(), /☆/);
  await toggle.click();
  await page.waitForSelector('[data-mm-priority-toggle][aria-pressed="true"]');
  assert.match(await toggle.innerText(), /★\s*პრიორიტეტი/);
  assert.match(await page.locator('[data-mm-priority-explain]').first().innerText(), /პირველ რიგში გაითვალისწინებს/);
  await page.waitForTimeout(700);
  assert.ok(calls.creativePatches.some((b) => b.priority === true), 'saved');
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /დაწერეთ თქვენი სარეკლამო ტექსტი \/ აღწერა/);
  assert.match(text, /მოკლე მთავარი ფრაზა, რომელსაც მომხმარებელი პირველ რიგში დაინახავს/);
  assert.match(await page.locator('[data-madsb-ai]').first().innerText(), /HOMATCH AI დამეხმაროს/);
  const box = await toggle.boundingBox();
  assert.ok(box.height >= 44, `44px target (${box.height})`);
  assert.equal((await page.evaluate(LAYOUT)).overflow <= 1, true, 'no overflow at 320px');
});

test('DOMAIN GUARD: an out-of-scope offer is told kindly in the builder, and the server check is what blocks it', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page } = await boot(t, { width: 390, height: 844, lang: 'ka', campaignOver: { property_id: null, offer: { isProperty: false, dealKind: 'OTHER', title: '' } } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=offer`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('[data-mm-offer-title]').fill('Online casino bonus');
  await page.waitForSelector('[data-mm-scope="BLOCKED_OUT_OF_SCOPE"]');
  assert.match(await page.locator('[data-mm-scope]').innerText(), /აზარტული თამაშების/);
  await page.locator('[data-mm-offer-title]').fill('Apartment renovation in Tbilisi');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-mm-scope]').count(), 0, 'real-estate services are welcome');
  // Any ordinary lawful business is welcome too — no real-estate signal, no review card.
  await page.locator('[data-mm-offer-title]').fill('Pizza delivery in 30 minutes');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-mm-scope]').count(), 0, 'a lawful non-real-estate business is not flagged');
  // Even if the browser said nothing, the server's preflight decides — and the customer reads one kind sentence.
  await page.route('**/functions/v1/meta-ads-api', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action !== 'preflight') return r.fallback();
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({
      status: 'NEEDS_CHANGES', warnings: 0, checks: [{ key: 'domain_scope', state: 'ACTION_REQUIRED', ok: false, detail: 'BLOCKED_OUT_OF_SCOPE:GAMBLING' }],
    }) });
  });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=review`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('[data-mm-run-check]').click();
  await page.waitForFunction(() => /აზარტული თამაშების/.test(document.body.innerText), null, { timeout: 8000 });
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /GAMBLING|casino/i, 'never the matched words');
  assert.equal(await page.locator('[data-madsb-nav] button').last().isDisabled(), true, 'nothing to launch');
});

test('LEADS: unavailable forms offer ONE action — never a permission name, never a form builder that cannot work', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const settings = { ...fixtures().status.settings, goalsEnabled: ['MESSAGES', 'LEADS_ON_META', 'PROMOTE'] };
  for (const [state, action] of [['PAGE_UNAVAILABLE', 'USE_MESSAGES'], ['PERMISSIONS_MISSING', 'RECONNECT'], ['FORM_ACCESS_UNAVAILABLE', 'RECONNECT']]) {
    const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'en', statusOver: { settings, mode: 'REAL', connection: { instant_forms: state, instant_forms_available: false, lead_checked_at: '2026-10-02T06:44:03Z' } },
      campaignOver: { goal: 'LEADS_ON_META', destination: { type: 'META_FORM', formId: null } } });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=destination`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector(`[data-mm-forms-state="${state}"]`);
    assert.equal(await page.locator('[data-mm-forms-action]').count(), 1, `${state}: exactly one action`);
    assert.equal(await page.locator('[data-mm-forms-action]').getAttribute('data-mm-forms-action'), action);
    const text = await page.evaluate(() => document.body.innerText);
    assert.doesNotMatch(text, /leads_retrieval|pages_manage_ads|pages_manage_metadata/);
    assert.doesNotMatch(text, /Create a HOMATCH lead form/, `${state}: no form builder`);
    if (action === 'USE_MESSAGES') {
      await page.locator('[data-mm-forms-action="USE_MESSAGES"]').click();
      await page.waitForTimeout(500);
      assert.equal(calls.patches.map((p) => p.goal).filter(Boolean).pop(), 'MESSAGES', 'one tap switches to messages');
    }
  }
});

test('LEADS TERMS: Leads stays selectable; Meta\'s own terms page opens from HOMATCH; only Meta\'s answer makes Leads available; the draft is kept', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const settings = { ...fixtures().status.settings, goalsEnabled: ['MESSAGES', 'LEADS_ON_META', 'PROMOTE'] };
  const assets = fixtures().status.assets;
  const pageId = assets.find((a) => a.kind === 'PAGE' && a.selected)?.external_id;
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { page, calls } = await boot(t, { width, height, lang: 'ka',
      statusOver: { settings, mode: 'REAL', connection: { instant_forms: 'TERMS_REQUIRED', instant_forms_next: 'READY', lead_terms: 'REQUIRED', lead_checked_at: '2026-10-02T06:44:03Z', instant_forms_available: true } },
      campaignOver: { goal: 'LEADS_ON_META', destination: { type: 'META_FORM', formId: null }, daily_budget_cents: 2500, duration_days: 7 } });
    // A stand-in for the browser window so the test can play the owner closing it — Meta's page itself is not loaded offline.
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = (url, name, features) => { const w = { closed: false, opener: window, location: { href: url } }; window.__opened.push({ name, features, w }); return w; };
    });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=goal`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const leads = page.locator('button[aria-pressed]', { hasText: /ლიდ|Lead/i }).first();
    assert.equal(await leads.isDisabled(), false, `${width}: Leads is not shown as permanently disabled`);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /მალე/, 'not "coming soon"');

    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=destination`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-forms-state="TERMS_REQUIRED"]');
    assert.equal(await page.locator('[data-mm-terms-open]').count(), 1, 'one obvious action');
    assert.match(await page.locator('[data-mm-terms-open]').innerText(), /Meta-ს პირობებზე დათანხმება/);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /leads_retrieval|pages_manage/);
    await page.locator('[data-mm-terms-open]').click();
    const opened = await page.evaluate(() => window.__opened.map((o) => ({ href: o.w.location.href, opener: o.w.opener, features: o.features })));
    assert.equal(opened.length, 1);
    assert.equal(opened[0].href, `https://www.facebook.com/ads/leadgen/tos?page_id=${pageId}`, 'Meta\'s own terms page for the selected Page');
    assert.equal(opened[0].opener, null, 'the Meta window cannot reach back into HOMATCH');
    await page.waitForSelector('[data-mm-terms-flow="WAITING"]');

    // A forged message changes nothing: no message is listened to.
    await page.evaluate(() => window.postMessage({ type: 'META_TERMS_ACCEPTED', accepted: true }, '*'));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-mm-terms-flow="WAITING"]').count(), 1);
    assert.ok(!calls.actions.includes('forms_recheck'), 'nothing re-checked on a message');

    // The owner closes Meta's window without accepting: HOMATCH asks Meta, Meta says no.
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.action !== 'forms_recheck') return r.fallback();
      calls.actions.push('forms_recheck');
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, pageId, state: 'TERMS_REQUIRED', checked: { page: true, terms: 'REQUIRED' } }) });
    });
    await page.evaluate(() => { window.__opened[0].w.closed = true; });
    await page.waitForSelector('[data-mm-terms-flow="NOT_ACCEPTED"]', { timeout: 8000 });

    // Opened again, accepted in Meta's window: Meta now reports it, the server status follows.
    await page.locator('[data-mm-terms-open]').click();
    await page.waitForSelector('[data-mm-terms-flow="WAITING"]');
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      const ok = (o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (body.action === 'forms_recheck') { calls.actions.push('forms_recheck'); return ok({ ok: true, pageId, state: 'READY', checked: { page: true, terms: 'ACCEPTED', formsReadable: true } }); }
      if (body.action === 'status') {
        const s = fixtures().status;
        return ok({ ...s, mode: 'REAL', settings, connection: { ...s.connection, instant_forms: 'READY', instant_forms_next: 'READY', lead_terms: 'ACCEPTED', lead_checked_at: '2026-10-02T07:00:00Z', instant_forms_available: true } });
      }
      return r.fallback();
    });
    await page.evaluate(() => { window.__opened.at(-1).w.closed = true; });
    await page.waitForFunction(() => !document.querySelector('[data-mm-forms-state]'), null, { timeout: 8000 });
    await page.waitForSelector('[data-mm-lf-open]', { timeout: 5000 });
    // Still the same draft, nothing lost or re-created; nothing launched or charged.
    assert.equal(calls.inserts, 0);
    assert.ok(!calls.actions.includes('launch') && !calls.actions.includes('deposit_checkout'));
    assert.match(page.url(), /draft=c1&step=destination/);
  }
});

/* ── META ADS CLOSURE: empty audience, targets-only map, HOMATCH AI creatives, video ── */

test('AUDIENCE: a new campaign starts with NO places; the map shows only the chosen targets and follows removals', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1440, 900]]) {
    const { page, calls } = await boot(t, { width, height, lang: 'en' });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-map]');
    assert.equal(await page.locator('[data-mm-geo-empty]').count(), 1, `${width}: empty state, nothing chosen for the owner`);
    assert.equal(await page.locator('[data-mm-loc]').count(), 0);
    assert.equal(await page.locator('[data-mm-map]').getAttribute('data-mm-map'), 'empty');
    assert.equal(await page.locator('[data-mm-map]').getAttribute('data-mm-map-targets'), '0');
    assert.equal(await page.locator('[data-mm-map-target]').count(), 0, 'no device / IP / Georgia marker');
    assert.equal(await page.locator('[data-mm-map-ge="whole"]').count(), 0);
    assert.ok(await page.locator('[data-mm-map]').isVisible(), `${width}: the map is visible, not folded away`);
    await page.waitForTimeout(400);
    assert.equal(calls.patches.filter((p) => p.targeting?.locations?.length).length, 0, 'no location is ever saved on the owner\'s behalf');
    assert.ok((await page.evaluate(LAYOUT)).overflow <= 1, `${width}: no horizontal overflow`);
  }
  const two = { targeting: { locations: [
    { type: 'city', key: '2001', name: 'Tbilisi', countryCode: 'GE', radiusKm: 10, lat: 41.7151, lng: 44.8271 },
    { type: 'city', key: '2002', name: 'Batumi', countryCode: 'GE', radiusKm: 15, lat: 41.6168, lng: 41.6367 },
  ] } };
  const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'en', campaignOver: two });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.waitForSelector('[data-mm-map-circle]');
  assert.equal(await page.locator('[data-mm-map]').getAttribute('data-mm-map-targets'), '2', 'a restored draft keeps its places');
  assert.equal(await page.locator('[data-mm-map-circle]').count(), 2);
  assert.deepEqual(await page.locator('[data-mm-map-circle]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm-map-km'))), ['10', '15'], 'the real radius');
  await page.locator('[data-mm-loc-remove]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-mm-map]')?.getAttribute('data-mm-map-targets') === '1');
  assert.equal(await page.locator('[data-mm-map-circle]').count(), 1, 'removed from the map at once');
  await page.waitForTimeout(800);
  assert.equal(calls.patches.map((p) => p.targeting).filter(Boolean).pop()?.locations?.length, 1);
});

const aiJob = (o) => ({ id: 'j1', kind: 'ANALYSIS', status: 'DONE', stage: 'DONE', error: null, creativeId: 'cr1', conceptId: null, requested: null,
  quotedCredits: null, chargedCredits: null, analysis: null, images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...o });
const ANALYSIS = { subject: 'A bright living room with a balcony', strengths: ['Natural light'], issues: [], concepts: [
  { id: 'c1', title: 'Calm premium', angle: 'Quiet space in Vake', visual: 'Warm light', composition: 'Window on the right', cta: 'Book a viewing', safeArea: 'TOP' },
  { id: 'c2', title: 'City value', angle: 'Close to everything', visual: 'Crisp daylight', composition: 'Wide frame', cta: 'Learn more', safeArea: 'BOTTOM' },
] };
const IMG = (i) => ({ index: i, width: 1024, height: 1536, discarded: false, url: `https://stubproj.supabase.co/storage/v1/object/sign/meta-ads-media/u1/ai/j2/${i}.png?token=t` });

/** Buttons or labels in the AI panel whose text is cut off (wider or taller than their box). */
const CLIPPED = () => {
  const out = [];
  for (const el of document.querySelectorAll('[data-mm-ai-panel] button, [data-mm-ai-panel] label > span, [data-mm-ai-panel] summary')) {
    if (!el.offsetParent || !el.clientWidth) continue;
    // Text cut inside its own box…
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) { out.push(el.textContent.trim().slice(0, 40)); continue; }
    // …or the box itself pushed out of its card / the dialog.
    const box = el.getBoundingClientRect();
    const host = (el.closest('figure') ?? el.closest('[data-mm-ai-panel]')).getBoundingClientRect();
    if (box.left < host.left - 1 || box.right > host.right + 1) out.push(`outside: ${el.textContent.trim().slice(0, 40)}`);
  }
  return out;
};

test('CREATIVE AI: nothing on upload; analysis only on the click and cached; the price before Generate; one paid job on a double click; Original + 3; selected variations become new creatives', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  for (const [width, height] of [[360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900]]) {
    const settings = { ...fixtures().status.settings, aiCreativeEnabled: true };
    const { page, calls } = await boot(t, { width, height, lang: 'en', statusOver: { settings } });
    const ai = { analyze: 0, generate: [], jobPolls: 0, use: [], compose: [] };
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      const ok = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (!String(body.action).startsWith('creative_ai_')) return r.fallback();
      calls.actions.push(body.action);
      if (body.action === 'creative_ai_jobs') return ok({ jobs: ai.analyze ? [aiJob({ analysis: { ...ANALYSIS, version: 3 } })] : [] });
      if (body.action === 'creative_ai_analyze') { ai.analyze += 1; return ok({ cached: false, job: aiJob({ analysis: { ...ANALYSIS, version: 3 } }) }); }
      if (body.action === 'creative_ai_quote') return ok({ quote: { variations: body.variations, unitCredits: 1.3, expectedCredits: 1.3 * body.variations, maxCredits: 1.63 * body.variations, balanceCredits: 50, enough: true, available: true } });
      if (body.action === 'creative_ai_generate') { ai.generate.push(body); return ok({ job: aiJob({ id: 'j2', kind: 'GENERATION', status: 'RUNNING', stage: 'GENERATING', requested: 3, quotedCredits: 4.89 }), replay: false }, 202); }
      if (body.action === 'creative_ai_job') { ai.jobPolls += 1; return ok({ job: aiJob({ id: 'j2', kind: 'GENERATION', status: 'DONE', stage: 'DONE', requested: 3, chargedCredits: 3.9, images: [IMG(1), IMG(2), IMG(3)] }) }); }
      if (body.action === 'creative_ai_use') { ai.use.push(body); return ok({ created: body.picks.map((_, i) => `n${i}`), refused: [] }); }
      if (body.action === 'creative_ai_compose') {
        // The server's composition (the real one is tested in creativeText.test.mjs): an SVG with real text.
        ai.compose.push(body);
        const spec = body.spec ?? { layout: body.index === 3 ? 'OVERLAY_BOTTOM' : 'EDITORIAL_BOTTOM', aspect: '4:5', theme: 'INK', copy: { headline: 'Calm living in Vake', cta: 'Book a viewing' } };
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#0E1626"/><text x="72" y="1000" font-family="HMC Sans" font-size="64" font-weight="700" fill="#fff">${spec.copy.headline}</text></svg>`;
        return ok({ spec, svg, composition: { layout: spec.layout, requestedLayout: spec.layout, aspect: spec.aspect, ok: !!spec.copy.headline, dir: 'ltr', copy: spec.copy, checks: spec.copy.headline ? [] : [{ code: 'HEADLINE_REQUIRED', field: 'headline', blocking: true }], sizes: {}, lines: {} } });
      }
      return ok({ ok: true });
    });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-ai-improve]');
    await page.waitForTimeout(500);
    assert.equal(calls.actions.filter((a) => String(a).startsWith('creative_ai_')).length, 0, `${width}: no AI call before the click`);

    await page.locator('[data-mm-ai-improve]').click();
    await page.waitForSelector('[data-mm-ai-concept="c2"]');
    assert.equal(ai.analyze, 1, 'one analysis, on the click');
    assert.equal(await page.locator('[data-mm-ai-concept]').count(), 2);
    assert.match(await page.locator('[data-mm-ai-generate]').innerText(), /Generate 3 variation\(s\) · 3\.90 Credits/, 'the price is shown before anything runs');
    assert.equal(ai.generate.length, 0);

    // Closing and re-opening reads the cached analysis — no new model call.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mm-ai-panel]', { state: 'detached' });
    await page.locator('[data-mm-ai-improve]').click();
    await page.waitForSelector('[data-mm-ai-concept="c1"]');
    assert.equal(ai.analyze, 1, 'cached: opening again does not analyse again');

    // Purpose first, in one glance; then the words for the creative go to the TEXT layer, not the image model.
    assert.equal(await page.locator('[data-mm-ai-info] li').count(), 4, 'what HOMATCH AI does — four plain lines');
    assert.equal(await page.locator('[data-mm-ai-step][aria-current="step"]').getAttribute('data-mm-ai-step'), 'instruction');
    assert.deepEqual(await page.locator('[data-mm-ai-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm-ai-step'))), ['instruction', 'generate', 'choose', 'final'], 'four steps — text & layout is not one of them');
    assert.equal(await page.locator('[data-mm-ai-overlay]').count(), 0, 'one instruction field — text requests go in the same words');
    await page.locator('[data-mm-ai-concept="c2"]').click();
    await page.locator('[data-mm-ai-chip="view"]').click();
    await page.locator('[data-mm-ai-instruction]').fill('უფრო ნათელი. ზემოთ ეწეროს ახალი ბინა ვაკეში');
    await page.waitForSelector('[data-mm-ai-overlay-parsed="top"]');
    assert.match(await page.locator('[data-mm-ai-overlay-parsed]').innerText(), /ახალი ბინა ვაკეში/, 'the request is understood as text for the creative');
    assert.ok((await page.evaluate(CLIPPED)).length === 0, `${width}: no clipped labels: ${JSON.stringify(await page.evaluate(CLIPPED))}`);
    await page.locator('[data-mm-ai-generate]').click();
    await page.waitForSelector('[data-mm-ai-confirm]');
    assert.equal(ai.generate.length, 0, 'Generate only asks for confirmation');
    await page.locator('[data-mm-ai-confirm-go]').dblclick();
    await page.waitForSelector('[data-mm-ai-running], [data-mm-ai-gallery]');
    await page.waitForTimeout(300);
    assert.equal(ai.generate.length, 1, 'a double click starts one paid job');
    assert.match(ai.generate[0].idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(ai.generate[0].conceptId, 'c2');
    assert.equal(ai.generate[0].variations, 3);
    assert.match(ai.generate[0].instruction, /ზემოთ ეწეროს ახალი ბინა ვაკეში/, 'the text request travels in the instruction; the server sets it on the creative');
    assert.ok(!('credits' in ai.generate[0]) && !('price' in ai.generate[0]), 'the browser never sends a price');
    if (await page.locator('[data-mm-ai-running]').count()) assert.equal(await page.locator('[data-mm-ai-stage][data-state="active"]').count(), 1, 'a real stage, no percentage');

    await page.waitForSelector('[data-mm-ai-gallery="3"]', { timeout: 10000 });
    assert.equal(await page.locator('[data-mm-ai-original]').count(), 1, 'the original stays');
    assert.match(await page.locator('[data-mm-ai-original]').innerText(), /Original[\s\S]*Your uploaded photo/, 'the original is named as the upload');
    assert.equal(await page.locator('[data-mm-ai-step][aria-current="step"]').getAttribute('data-mm-ai-step'), 'choose');
    assert.ok((await page.evaluate(CLIPPED)).length === 0, `${width}: gallery labels: ${JSON.stringify(await page.evaluate(CLIPPED))}`);
    assert.equal(await page.locator('[data-mm-ai-variant]').count(), 3);
    await page.locator('[data-mm-ai-variant="1"] button[aria-pressed]').click();
    await page.locator('[data-mm-ai-variant="3"] button[aria-pressed]').click();
    assert.equal(await page.locator('[data-mm-ai-role="1"]').inputValue(), 'PRIMARY');
    await page.locator('[data-mm-ai-role="3"]').selectOption('TEST');
    assert.deepEqual(await page.evaluate(CLIPPED), [], `${width}: chosen cards keep their actions inside`);
    assert.ok((await page.evaluate(LAYOUT)).overflow <= 1, `${width}: the gallery fits`);
    // The cards ARE the finished creatives: the visual with its text already set.
    await page.waitForSelector('[data-mm-ai-variant="1"] [data-mm-ai-finished] svg text');
    assert.equal(await page.locator('[data-mm-ai-variant="1"] [data-mm-ai-finished] svg text').first().textContent(), 'Calm living in Vake', 'real text on the finished card');
    // Text & layout is OPTIONAL: open it for one card, then go back without changing anything.
    await page.locator('[data-mm-ai-edit="3"]').click();
    await page.waitForSelector('[data-mm-composer="1"] [data-mm-composer-ready]', { timeout: 10000 });
    assert.ok((await page.evaluate(CLIPPED)).length === 0, `${width}: composer labels: ${JSON.stringify(await page.evaluate(CLIPPED))}`);
    await page.locator('[data-mm-composer-field="headline"]').fill('');
    await page.waitForSelector('[data-mm-composer-check="HEADLINE_REQUIRED"]');
    assert.ok(await page.locator('[data-mm-composer-submit]').isDisabled(), 'an invalid text layer cannot be confirmed');
    await page.locator('[data-mm-composer-back]').click();
    await page.waitForSelector('[data-mm-ai-gallery="3"]');
    assert.equal(ai.use.length, 0);
    // Use → created at once, as shown. No required extra step.
    await page.locator('[data-mm-ai-use]').click();
    await page.waitForSelector('[data-mm-ai-panel]', { state: 'detached' });
    assert.deepEqual(ai.use.map((u) => u.picks.map((p) => [p.index, p.role, p.spec ?? null])), [[[1, 'PRIMARY', null]], [[3, 'TEST', null]]], 'one export per request; the server composes the finished creative the card showed');
    assert.equal(ai.generate.length, 1, 'choosing and using never start a new generation');
    assert.equal(calls.creativePatches.filter((p) => p.media).length, 0, 'the original creative is never rewritten');
  }
});

test('VIDEO: a real player (play, seek, mute, volume, full screen) and a cover chosen by hand or by HOMATCH — fits at 320', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  for (const [width, height, lang] of [[320, 640, 'en'], [1440, 900, 'ka']]) {
    const { page } = await boot(t, { width, height, lang, creativeOver: { kind: 'VIDEO', media: [{ path: 'u1/v.mp4', mime: 'video/mp4', size: 900000, width: 1080, height: 1920, duration: 12 }] } });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-video-controls]');
    for (const sel of ['[data-mm-video-play]', '[data-mm-video-seek]', '[data-mm-video-mute]', '[data-mm-video-full]', '[data-mm-video-use-frame]', '[data-mm-video-auto]']) {
      assert.equal(await page.locator(sel).count(), 1, `${width}: ${sel}`);
      assert.ok(await page.locator(sel).isVisible(), `${width}: ${sel} visible`);
    }
    assert.ok(await page.locator('[data-mm-video-play]').getAttribute('aria-label'), 'the play button is named');
    assert.match(await page.locator('[data-mm-video-time]').innerText(), /0:00 \/ 0:12/, 'the duration is shown');
    assert.equal(await page.locator('[data-mm-video-cover="meta"]').count(), 1, 'no cover chosen yet — said plainly');
    await page.locator('[data-mm-video-mute]').click();
    assert.equal(await page.locator('[data-mm-video-mute]').getAttribute('aria-pressed'), 'true', 'sound on');
    const box = await page.locator('[data-mm-video-play]').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, 'touch target');
    assert.ok((await page.evaluate(LAYOUT)).overflow <= 1, `${width}: no horizontal overflow`);
  }
});

/* ── MOBILE UX HARDENING: the production screenshots as layout invariants ── */

/* Every word of the summary values stays whole, buttons contain their text,
   edit targets are 44px, nothing overlaps or leaves the screen. */
const GEOMETRY = () => {
  const vw = document.documentElement.clientWidth;
  const out = { overflow: document.documentElement.scrollWidth - vw, split: [], narrow: [], offscreen: [], overlap: [], clipped: [], smallTargets: [] };
  const box = (el) => el.getBoundingClientRect();
  for (const row of document.querySelectorAll('[data-mm-row]')) {
    const v = row.querySelector('[data-mm-row-value]');
    const e = row.querySelector('[data-mm-row-edit]');
    const rv = box(v);
    if (rv.width < 120) out.narrow.push(`${v.textContent.slice(0, 30)} → ${Math.round(rv.width)}px`);
    if (box(row).right > vw + 1 || box(row).left < -1) out.offscreen.push(v.textContent.slice(0, 30));
    if (e) {
      const re = box(e);
      if (re.height < 43.5 || re.width < 43.5) out.smallTargets.push(`edit ${Math.round(re.width)}×${Math.round(re.height)}`);
      const ix = Math.min(rv.right, re.right) - Math.max(rv.left, re.left);
      const iy = Math.min(rv.bottom, re.bottom) - Math.max(rv.top, re.top);
      if (ix > 1 && iy > 1) out.overlap.push(v.textContent.slice(0, 30));
    }
    // A normal word must never be broken across lines.
    const walker = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent;
      for (const m of text.matchAll(/\S{2,}/g)) {
        const r = document.createRange();
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (lines.size > 1) out.split.push(m[0]);
      }
    }
  }
  for (const b of document.querySelectorAll('main button, [data-madsb-nav] button')) {
    const rb = box(b);
    if (!rb.width || !rb.height) continue;
    if (b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2) out.clipped.push(`"${b.textContent.trim().slice(0, 40)}" ${b.scrollWidth}×${b.scrollHeight} in ${b.clientWidth}×${b.clientHeight}`);
    if (rb.right > vw + 1 || rb.left < -1) out.offscreen.push(`button "${b.textContent.trim().slice(0, 30)}"`);
  }
  return out;
};

test('MOBILE UX: the review summary reflows in Georgian — "Facebook/Instagram-ზე" whole, "$5.00 × 7" together, Edit 44px, the check button contains its text, nothing under the bar', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const campaignOver = { goal: 'LEADS_ON_META', daily_budget_cents: 500, duration_days: 7, name: 'ვაკის ორსაძინებლიანი ბინა',
    targeting: { locations: [{ type: 'city', key: '2001', name: 'თბილისი', countryCode: 'GE', radiusKm: 10, lat: 41.7151, lng: 44.8271 }] } };
  const failures = [];
  const runs = [[390, 844, 'ka'], [320, 640, 'ka'], [360, 760, 'ka'], [430, 932, 'ka'], [768, 1024, 'ka'], [1440, 900, 'ka'], [390, 600, 'ka'],
    [390, 844, 'en'], [390, 844, 'ru'], [390, 844, 'ar'], [390, 844, 'he'], [390, 844, 'tr']];
  for (const [width, height, lang] of runs) {
    const { page } = await boot(t, { width, height, lang, campaignOver });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=review`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-review-summary] [data-mm-row]');
    const tag = `${lang} ${width}×${height}`;
    const g = await page.evaluate(GEOMETRY);
    if (g.overflow > 1) failures.push(`${tag}: horizontal overflow ${g.overflow}px`);
    for (const k of ['split', 'narrow', 'offscreen', 'overlap', 'clipped', 'smallTargets']) if (g[k].length) failures.push(`${tag}: ${k} ${JSON.stringify(g[k].slice(0, 4))}`);
    const budget = await page.locator('[data-mm-review-summary] [data-mm-row-value] span[dir="ltr"]').first();
    const bb = await budget.evaluate((el) => ({ lines: new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size, text: el.textContent }));
    if (bb.lines !== 1) failures.push(`${tag}: "${bb.text}" wraps`);
    if (lang === 'ka') {
      const text = await page.locator('[data-mm-review-summary]').innerText();
      if (!/Facebook\/Instagram-ზე/.test(text)) failures.push(`${tag}: the destination text is not shown whole`);
    }
    const check = page.locator('[data-mm-run-check]');
    const cb = await check.evaluate((el) => ({ h: el.getBoundingClientRect().height, clipped: el.scrollHeight > el.clientHeight + 2 }));
    if (cb.h < 43.5 || cb.clipped) failures.push(`${tag}: the check button ${JSON.stringify(cb)}`);
    const b = await page.evaluate(BOTTOM);
    if (!b.lastClear) failures.push(`${tag}: the last control is under the bar — ${b.what}`);
    const nav = await page.evaluate(() => {
      const n = document.querySelector('[data-madsb-nav]').getBoundingClientRect();
      const btns = [...document.querySelectorAll('[data-madsb-nav] button')].map((x) => x.getBoundingClientRect());
      return { h: n.height, small: btns.filter((r) => r.height < 43.5).length, vh: window.innerHeight };
    });
    if (nav.small) failures.push(`${tag}: a bar button under 44px`);
    if (nav.h > (width < 768 ? 120 : 90)) failures.push(`${tag}: the bar is ${Math.round(nav.h)}px tall`);
    if (lang === 'ar' || lang === 'he') {
      const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
      if (dir !== 'rtl') failures.push(`${tag}: not RTL`);
      const sides = await page.locator('[data-mm-review-summary] [data-mm-row]').first().evaluate((row) => {
        const v = row.querySelector('[data-mm-row-value]').getBoundingClientRect(); const e = row.querySelector('[data-mm-row-edit]').getBoundingClientRect();
        return e.right <= v.left + 1;
      });
      if (!sides) failures.push(`${tag}: Edit is not on the trailing (left) side in RTL`);
    }
  }
  assert.deepEqual(failures, []);
});

test('META CONNECT: one tap = one attempt to Meta\'s own dialog with the way back sealed; return → same draft and step, one refresh; cancel keeps the work', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { page, calls } = await boot(t, { width, height, lang: 'ka', statusOver: { mode: 'REAL', connection: { status: 'NOT_CONNECTED', health: 'NOT_CONNECTED', granted_scopes: [] } } });
    const starts = [];
    let dialogLoads = 0;
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.action !== 'oauth_start') return r.fallback();
      starts.push(body);
      await new Promise((res) => setTimeout(res, 150)); // a real round trip: the double tap lands while preparing
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ mode: 'REAL', url: 'https://www.facebook.com/v26.0/dialog/oauth?client_id=1&state=s' }) });
    });
    await page.route('https://www.facebook.com/**', (r) => { dialogLoads += 1; return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Meta</title>' }); });
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=account&from=destination`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const btn = page.locator('[data-mm-connect="connect"]');
    assert.match(await btn.innerText(), /Meta-ს დაკავშირება/);
    const bb = await btn.boundingBox();
    assert.ok(bb.height >= 43.5, 'a 44px target');
    await btn.dblclick();
    await page.waitForURL(/facebook\.com/, { timeout: 8000 });
    assert.equal(starts.length, 1, `${width}: a double tap starts ONE attempt`);
    assert.equal(starts[0].returnTo, '/outreach/meta/create?draft=c1&step=account&from=destination', 'the way back is this draft and step');
    assert.equal(dialogLoads, 1, 'Meta\'s dialog opened once, in this tab');

    // Back from Meta: connected.
    const before = calls.actions.length;
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=account&from=destination&connect=ok`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-connect-return="ok"]');
    assert.match(await page.locator('[data-mm-connect-return]').innerText(), /Meta დაკავშირებულია/);
    await page.waitForURL(/step=destination/, { timeout: 8000 });
    assert.doesNotMatch(page.url(), /connect=/, 'the result is consumed — a reload repeats nothing');
    await page.waitForTimeout(400);
    assert.equal(calls.actions.slice(before).filter((a) => a === 'assets_refresh').length, 1, `one canonical refresh (${calls.actions.slice(before).join(',')})`);
    assert.equal(calls.inserts, 0, 'the same draft');

    // Cancelled at Meta: a calm line, the work kept, nothing refreshed.
    const before2 = calls.actions.length;
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=account&connect=denied`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.waitForSelector('[data-mm-connect-return="denied"]');
    const msg = await page.locator('[data-mm-connect-return]').innerText();
    assert.match(msg, /Meta-ში კავშირი არ დასრულებულა/);
    assert.match(msg, /კამპანია შენახულია/);
    assert.doesNotMatch(msg, /access_denied|error_reason|user_denied/);
    assert.equal(calls.actions.slice(before2).filter((a) => a === 'assets_refresh').length, 0);
    assert.match(page.url(), /draft=c1&step=account/);
    assert.ok((await page.evaluate(LAYOUT)).overflow <= 1);
  }
});

/*
 * THE RETURN FROM META WINS, WHATEVER FINISHES FIRST. The draft loads in
 * parallel with the post-connect refresh; when it finished after the owner had
 * been sent back to their step, it wrote the URL from the search it closed over
 * at mount — resurrecting the consumed ?connect=ok and putting the owner back on
 * Account. Here the draft is held until the step change has happened, so the
 * losing order is the one tested, every run.
 */
test('META CONNECT: a draft that loads after the return never undoes it — same step, no ?connect= resurrected', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const { page } = await boot(t, { width: 390, height: 844, lang: 'ka', statusOver: { mode: 'REAL', connection: { status: 'NOT_CONNECTED', health: 'NOT_CONNECTED', granted_scopes: [] } } });
  let releaseDraft;
  const stepChanged = new Promise((res) => { releaseDraft = res; });
  await page.route('**/rest/v1/meta_campaigns**', async (r) => {
    if (r.request().method() === 'GET') await stepChanged;
    return r.fallback();
  });
  const draftServed = page.waitForResponse((res) => res.url().includes('/rest/v1/meta_campaigns') && res.request().method() === 'GET');
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=account&from=destination&connect=ok`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/step=destination/, { timeout: 15000 });
  releaseDraft();
  await draftServed;
  /* The draft's own URL write follows its load; the creatives read comes right after it. */
  await page.waitForResponse((res) => res.url().includes('/rest/v1/meta_creatives'), { timeout: 15000 });
  await waitReady(page);
  assert.match(page.url(), /step=destination/, 'the owner stays on the step they came from');
  assert.match(page.url(), /draft=c1/);
  assert.doesNotMatch(page.url(), /connect=/, 'a consumed return is never written back');
});

test('MOBILE UX: on every step in Georgian at 320 and 390, no button clips its label, nothing leaves the screen, no word is split', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  const failures = [];
  for (const [width, height] of [[320, 640], [390, 844]]) {
    const { page } = await boot(t, { width, height, lang: 'ka', campaignOver: { daily_budget_cents: 500, duration_days: 7 } });
    for (const step of STEPS) {
      await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=${step}`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      const g = await page.evaluate(GEOMETRY);
      if (g.overflow > 1) failures.push(`${width} ${step}: overflow ${g.overflow}px`);
      for (const k of ['split', 'offscreen', 'overlap', 'clipped', 'smallTargets']) if (g[k].length) failures.push(`${width} ${step}: ${k} ${JSON.stringify(g[k].slice(0, 3))}`);
    }
  }
  assert.deepEqual(failures, []);
});

/* ── FINAL ACCEPTANCE: what the phone test found ─────────────────────────── */

/* Screenshots for visual inspection, with the suite's own META_ADS_QA_SHOTS switch. */
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `final-${name}.png`), fullPage: true });
}

test('FINAL: one universal location search — "საქართველო" finds Georgia, typed, added as a removable chip', opts, async (t) => {
  const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'ka', campaignOver: { targeting: { locations: [], ageMin: 18, ageMax: 65, gender: 'ALL' } } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assert.equal(await page.locator('[data-mm-field="locations"] [role="group"] button[aria-pressed]').count(), 0, 'no Country/Region/City tabs');
  const input = page.locator('[data-mm-loc-search]');
  await input.fill('საქართველო');
  await page.waitForSelector('[data-mm-loc-result="country"]');
  const sub = await page.locator('[data-mm-loc-result="country"]').first().innerText();
  assert.match(sub, /ქვეყანა/, 'typed as Country');
  const asked = calls.bodies.filter((b) => b.action === 'geo_search').at(-1);
  assert.equal(asked.type, 'any');
  await page.locator('[data-mm-loc-result="country"]').first().dispatchEvent('mousedown');
  await page.waitForSelector('[data-mm-loc-chips] [data-mm-loc="country:GE"]');
  await input.fill('თბილისი');
  await page.waitForSelector('[data-mm-loc-result="city"]');
  assert.match(await page.locator('[data-mm-loc-result="city"]').first().innerText(), /ქალაქი · .*საქართველო/, 'City · …, Georgia');
  await shot(page, 'ka-390-audience-search');
  assert.match(await page.locator('[data-mm-loc-chips] [data-mm-loc="country:GE"]').innerText(), /საქართველო/, 'the chip speaks Georgian');
  await input.press('Escape'); // the open result list sits over the chips, as a combobox does
  await page.locator('[data-mm-loc-chips] [data-mm-loc-remove="country:GE"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.locator('[data-mm-loc-chips] [data-mm-loc-remove="country:GE"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-mm-loc="country:GE"]'));
});

test('FINAL: a readiness item is a link — the field is in view, focused; no raw key anywhere', opts, async (t) => {
  const { page } = await boot(t, { width: 390, height: 844, lang: 'ka', preflightOver: { status: 'NEEDS_CHANGES', warnings: 0, checks: [
    { key: 'connection', state: 'READY', ok: true },
    { key: 'targeting', state: 'ACTION_REQUIRED', ok: false, detail: 'LOCATION_REQUIRED' },
    { key: 'permissions', state: 'ACTION_REQUIRED', ok: false, detail: 'ads_management,ads_read' },
    { key: 'some_future_check', state: 'WARNING', ok: true, detail: 'SOME_FUTURE_CODE' },
  ] } });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=review`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.locator('[data-mm-run-check]').click();
  await page.waitForSelector('[data-mm-check="targeting"]');
  const body = await page.locator('body').innerText();
  assert.doesNotMatch(body, /mads_check_|madsb_pfd_|mm_r_|LOCATION_REQUIRED|ads_management|SOME_FUTURE_CODE/, 'no key, code or scope name on screen');
  assert.equal(await page.locator('[data-mm-check="targeting"]').getAttribute('data-mm-check-sev'), 'BLOCKER');
  assert.equal(await page.locator('[data-mm-check="some_future_check"]').getAttribute('data-mm-check-sev'), 'WARNING');
  await shot(page, 'ka-390-review-check');
  await page.locator('[data-mm-check="targeting"] button').click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('step') === 'audience');
  await page.waitForFunction(() => !!document.activeElement?.closest('[data-mm-field="locations"]'));
  const inView = await page.evaluate(() => { const r = document.querySelector('[data-mm-field="locations"]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
  assert.ok(inView, 'the field is on screen');
});

test('FINAL: HOMATCH Intelligence is off until turned on, and states its limits', opts, async (t) => {
  const { page, calls } = await boot(t, { width: 390, height: 844, lang: 'ka' });
  await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=audience`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const card = page.locator('[data-mm-intelligence]');
  assert.equal(await card.getAttribute('data-mm-intelligence'), 'off');
  await page.locator('[data-mm-intelligence-toggle]').click();
  await page.waitForSelector('[data-mm-intelligence="on"] [data-mm-intelligence-never]');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(400);
  assert.ok(calls.patches.some((p) => p.intelligence?.enabled === true), 'saved to the draft');
  assert.equal(await page.locator('[data-mm-intelligence-never] li').count(), 6);
  await shot(page, 'ka-390-audience-intelligence');
});

test('FINAL: screenshots for visual inspection — every step in Georgian at 390, audience in ru/ar/he', opts, async (t) => {
  if (!SHOTS) return;
  for (const lang of ['ka', 'ru', 'ar', 'he']) {
    const { page } = await boot(t, { width: 390, height: 844, lang });
    for (const step of lang === 'ka' ? STEPS : ['audience', 'review']) {
      await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=${step}`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await shot(page, `${lang}-390-${step}`);
    }
  }
});



/* ── FINAL UX: the owner's reported scenario ─────────────────────────────── */

test('FINAL UX: "another product or service" is a complete answer — no review card, no unresolved mark, an internal-only note; the AI cost is a cost, a failed start is said truthfully, one job on a double click', opts, async (t) => {
  if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const settings = { ...fixtures().status.settings, aiCreativeEnabled: true };
    const { page } = await boot(t, { width, height, lang: 'ka', statusOver: { settings }, campaignOver: { property_id: null, offer: null } });
    const ai = { generate: [], quotes: 0 };
    await page.route('**/functions/v1/meta-ads-api', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      const ok = (o, st = 200) => r.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (!String(body.action).startsWith('creative_ai_')) return r.fallback();
      if (body.action === 'creative_ai_jobs') return ok({ jobs: [aiJob({ analysis: ANALYSIS })] });
      if (body.action === 'creative_ai_analyze') return ok({ cached: true, job: aiJob({ analysis: ANALYSIS }) });
      // The first quote fails (the AI cost cannot be read); the retry succeeds.
      if (body.action === 'creative_ai_quote') {
        ai.quotes += 1;
        if (ai.quotes === 1) return ok({ error: 'PRICING_UNAVAILABLE', code: 'PRICING_UNAVAILABLE' }, 503);
        return ok({ quote: { variations: body.variations, unitCredits: 1.3, expectedCredits: 1.3 * body.variations, maxCredits: 1.63 * body.variations, balanceCredits: 50, enough: true, available: true } });
      }
      // The server could not start the job (e.g. a billing refusal): said as that, nothing charged.
      if (body.action === 'creative_ai_generate') { ai.generate.push(body); return ok({ error: 'START_FAILED', code: 'START_FAILED' }, 503); }
      return ok({ ok: true });
    });

    // Step 2: the non-HOMATCH path, an ordinary lawful business, no property, no price.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=offer`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.getByRole('button', { name: /სხვა პროდუქტი ან სერვისი/ }).click();
    await page.locator('[data-mm-offer-title]').fill('კერამიკული ფილების მაღაზია');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('[data-mm-scope]').count(), 0, `${width}: a lawful product needs no review and shows no warning`);
    assert.match(await page.locator('[data-mm-internal-note="offer"]').innerText(), /რეკლამაში ის არ ჩანს/, 'the name is said to be internal');
    for (const kind of [/^პროდუქტი ან სერვისი/, /^უძრავი ქონება/]) {
      await page.getByRole('button', { name: kind }).click();
      await page.waitForTimeout(400);
      await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=goal`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      if (width >= 1024) {
        assert.equal(await page.locator('[data-madsb-stepper] [aria-label="საჭიროებს ყურადღებას"]').count(), 0, `${width} ${kind}: Step 2 is complete — no unresolved mark`);
      }
      await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=offer`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
    }
    const g = await page.evaluate(GEOMETRY);
    for (const k of ['split', 'offscreen', 'overlap', 'clipped']) assert.deepEqual(g[k], [], `${width} offer: ${k}`);

    // Desktop: every step name readable — no accidental ellipsis in the rail.
    if (width >= 1024) {
      const cut = await page.evaluate(() => [...document.querySelectorAll('[data-madsb-stepper] ol li button span')]
        .filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      assert.deepEqual(cut, [], 'no step name is cut');
    }

    // Creative Intelligence: works with no property and no price; the AI cost is named as such.
    await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=creative`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.locator('[data-mm-ai-improve]').first().click();
    await page.waitForSelector('[data-mm-ai-concept]');
    await page.waitForSelector('[data-mm-ai-quote-failed]');
    // The title never runs under the dialog's close button (every line of its text, not the box).
    const underClose = await page.evaluate(() => {
      const panel = document.querySelector('[data-mm-ai-panel]');
      const title = panel?.querySelector('h2');
      const close = [...(panel?.querySelectorAll('button') ?? [])].find((b) => getComputedStyle(b).position === 'absolute');
      if (!title || !close) return 'missing';
      const c = close.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(title);
      return [...range.getClientRects()].some((r) => r.width > 0 && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top);
    });
    assert.equal(underClose, false, `${width}: the title is clear of the close button`);
    assert.match(await page.locator('[data-mm-ai-quote-failed]').innerText(), /AI გენერაციის ღირებულება/, 'a failed quote is the AI cost, never a price of the offer');
    assert.equal(await page.locator('[data-mm-ai-error]').count(), 0, 'one message, in the cost box');
    await page.locator('[data-mm-ai-quote-retry]').click();
    await page.waitForSelector('[data-mm-ai-generate]');
    assert.match(await page.locator('[data-mm-ai-cost-title]').innerText(), /AI გენერაციის ღირებულება/);
    assert.doesNotMatch(await page.locator('[data-mm-ai-panel]').innerText(), /ფასი ახლა მიუწვდომელია/, 'the old "price unavailable" wording is gone');
    await page.locator('[data-mm-ai-generate]').click();
    await page.locator('[data-mm-ai-confirm-go]').dblclick();
    await page.waitForSelector('[data-mm-ai-error="START_FAILED"]');
    await page.waitForTimeout(300);
    assert.equal(ai.generate.length, 1, `${width}: a double click sends one request`);
    assert.match(await page.locator('[data-mm-ai-error]').innerText(), /გენერაცია ვერ დაიწყო\. არაფერი ჩამოგეჭრათ/, 'a failed start is said truthfully');
    assert.ok(!('price' in ai.generate[0]) && !('credits' in ai.generate[0]), 'the browser never sends a price');
    assert.ok((await page.evaluate(LAYOUT)).overflow <= 1, `${width}: the dialog fits`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `final-ux-ka-${width}-creative-ai.png`) });
  }
});
