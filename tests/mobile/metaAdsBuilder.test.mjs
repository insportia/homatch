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
const STEPS = ['account', 'offer', 'goal', 'destination', 'audience', 'budget', 'creative', 'placements', 'review'];

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
  return { campaign, status, creative };
}

async function boot(t, { width, height, lang }) {
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
  const calls = { patches: [], inserts: 0, actions: [] };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(PROFILE));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/functions/v1/meta-ads-api')) {
      const body = JSON.parse(req.postData() || '{}');
      calls.actions.push(body.action);
      if (body.action === 'status') return r.fulfill(json(fx.status));
      if (body.action === 'plan_preview') return r.fulfill(json({ issues: [], totals: { mediaCents: 3500, feeCents: 315, totalCents: 3815, feePercent: 9 }, recommendedPlacements: ['facebook_feed', 'facebook_stories', 'instagram_feed', 'instagram_stories'], requirements: [], summary: null }));
      if (body.action === 'preflight') return r.fulfill(json({ status: 'READY', warnings: 1, checks: [{ key: 'connection', state: 'READY', ok: true }, { key: 'integration_mode', state: 'WARNING', ok: true, detail: 'MOCK_MODE_NOTHING_REACHES_META' }] }));
      if (body.action === 'ai_copy') return r.fulfill(json({ variants: [{ primaryText: 'Sunny two-bedroom in Vake.', headline: 'Vake 2BR', description: '' }] }));
      return r.fulfill(json({ ok: true }));
    }
    if (url.includes('/rest/v1/meta_campaigns')) {
      if (req.method() === 'PATCH') { calls.patches.push(JSON.parse(req.postData() || '{}')); return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
      if (req.method() === 'POST') { calls.inserts += 1; return r.fulfill(json(fx.campaign, 201)); }
      return r.fulfill(json(wantsObject ? fx.campaign : [fx.campaign]));
    }
    if (url.includes('/rest/v1/meta_creatives')) return r.fulfill(json(wantsObject ? fx.creative : [fx.creative]));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json([{ id: 'prop-1', title: 'Vake two-bedroom', homatch_id: 123456, transaction_type: 'SALE' }]));
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
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit || !b.contains(hit);
  }).length,
});

async function waitReady(page) {
  await page.waitForSelector('[data-madsb-stepper]', { timeout: 20000 });
  await page.waitForTimeout(300);
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`every step, every locale, fits at ${width}px`, opts, async (t) => {
    if (skipReason) assert.fail(`meta ads builder gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height, lang });
      for (const step of STEPS) {
        await page.goto(`${BASE}/outreach/meta/create?draft=c1&step=${step}`, { waitUntil: 'domcontentloaded' });
        await waitReady(page);
        const l = await page.evaluate(LAYOUT);
        if (l.overflow > 1) failures.push(`${lang} ${width}px ${step}: horizontal overflow ${l.overflow}px`);
        if (l.buttons < 2) failures.push(`${lang} ${width}px ${step}: Back/Continue missing`);
        if (l.covered) failures.push(`${lang} ${width}px ${step}: ${l.covered} of Back/Continue covered`);
        if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang} ${width}px ${step}: not RTL`);
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
  const other = page.locator('button[aria-pressed]', { hasText: 'Another offer' });
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
  assert.match(text, /\$38\.15/, 'the total shown is the server total');
  assert.match(text, /\$3\.15/, 'the 9% fee shown is the server fee');
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
