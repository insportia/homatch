// BROKERS — onboarding, the broker desk and Admin broker management, in a
// real browser.
//
// Against the harness build with every request answered by a fixture, so it
// needs no Supabase project. Checked at 1440px and 390px in all six locales
// (RTL for ar/he): no horizontal overflow, no raw keys or enum values on
// screen. Then the flows in depth: a new broker creates a profile (the RPC
// gets exactly what was typed, then onboarding completes and the desk opens);
// a directory purchase sends an idempotency key and a retry after a refusal
// reuses it; a lead-less, profile-less and failing desk each say so; a
// suspended account is told and offered no paid action; an admin resolves a
// Broker Review item and opens a broker's record.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4353;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.BROKER_QA_SHOTS || null;
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
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'broker@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'broker@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profileRow = (isAdmin, accountType) => ({ id: 'u1', auth_id: 'u1', email: 'broker@example.test', is_admin: isAdmin, role: isAdmin ? 'admin' : 'user',
  preferred_language: 'en', full_name: 'Nino Broker', plan: 'FREE', account_type: accountType, created_at: new Date().toISOString() });

const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const LISTING = {
  id: 'l1', display_name: 'Nino Beridze Realty', role: 'BROKER', status: 'APPROVED', cities: ['Tbilisi'], districts: ['Vake'],
  languages: ['ka', 'en'], deal_kinds: ['SALE', 'RENT'], property_types: ['APARTMENT'], segments: ['RESIDENTIAL'],
  contact_phone: '+995555123456', contact_email: 'nino@example.test', whatsapp: null, telegram: '@ninorealty', website: null,
  about: 'Apartments in Vake and Saburtalo.', contact_person: 'Nino', experience_years: 7, logo_url: null, paid_until: null,
  review_note: null, onboarding_completed_at: ago(3), verification_state: 'UNVERIFIED', verification_note: null,
  verification_submitted_at: null, verified_at: null, created_at: ago(5),
};
function desk(over = {}) {
  return {
    active_window_days: 30,
    account: { account_type: 'BROKER', suspended: false, suspension_reason: null },
    profile: LISTING,
    documents: [],
    balance: 120.5,
    properties: [
      { id: 'p1', homatch_id: '104233', title: '3-room apartment, Vake', transaction_type: 'SALE', property_type: 'APARTMENT', matching_status: 'ACTIVE',
        listed_by_role: 'BROKER', created_at: ago(4), archived_at: null, current_leads: 7, opened_contacts: 2, campaign_status: null },
      { id: 'p2', homatch_id: '104890', title: 'Studio for rent, Saburtalo', transaction_type: 'RENT', property_type: 'APARTMENT', matching_status: 'ACTIVE',
        listed_by_role: 'BROKER', created_at: ago(2), archived_at: null, current_leads: 0, opened_contacts: 0, campaign_status: null },
    ],
    leads: { NEW: 5, REVIEWED: 2, CONTACTED: 1, IN_PROGRESS: 1 },
    client_searches: [{ id: 's1', side: 'SUPPLY', client_label: 'Giorgi — 2BR Vake', on_behalf: true, is_active: true, created_at: ago(1),
      criteria: { city: 'Tbilisi', propertyType: 'APARTMENT', transactionType: 'SALE' } }],
    purchases: [],
    listing_price_credits: 90,
    listing_duration_days: 30,
    ...over,
  };
}

async function boot(t, { width = 1440, height = 900, lang = 'en', admin = false, accountType = 'BROKER', summary = desk(), rpc = {} } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const calls = [];
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const defaults = {
    broker_desk_summary: () => summary,
    broker_profile_event_stats: () => ({ totals: {}, daily: [] }),
    admin_list_broker_directory: () => [{ ...LISTING, owner_user_id: 'u9', owner_email: 'nino@example.test', owner_name: 'Nino', is_public: false }],
    admin_list_broker_intelligence: () => [],
    admin_list_broker_verification: () => [{ id: 'l1', display_name: LISTING.display_name, role: 'BROKER', status: 'APPROVED', verification_state: 'PENDING',
      submitted_at: ago(1), owner_email: 'nino@example.test', owner_suspended: false, documents: 2 }],
    admin_list_broker_review: () => [{ id: 'r1', signal_id: 's1', platform: 'TELEGRAM', source_url: 'https://t.me/c/1/2', author_public_name: 'Vake Homes Agency',
      author_public_url: 'https://t.me/vakehomes', city: 'Tbilisi', language: 'ka', published_at: ago(2), confidence: 0.91, status: 'PENDING', note: null }],
    admin_resolve_broker_review: () => ({ id: 'r1', status: 'ACCEPTED', broker_id: 'b1' }),
    admin_broker_detail: () => ({ listing: { ...LISTING, owner_user_id: 'u9', verification_state: 'PENDING' },
      user: { id: 'u9', email: 'nino@example.test', full_name: 'Nino', account_type: 'BROKER', suspended_at: null, suspension_reason: null, created_at: ago(9) },
      documents: [{ id: 'd1', kind: 'LICENSE', path: 'u9/licence.pdf', created_at: ago(1) }], properties: 2, purchases: [], audit: [] }),
    broker_profile_save: () => 'l1',
    broker_complete_onboarding: () => true,
    broker_directory_purchase: () => ({ duplicate: false, charged_credits: 90, paid_until: ago(-30), listing_id: 'l1' }),
    billing_price_quote: () => null,
  };
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profileRow(admin, accountType)));
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (m) {
      const name = m[1];
      const body = JSON.parse(req.postData() || '{}');
      calls.push({ name, body });
      const handler = rpc[name] ?? defaults[name];
      if (handler) {
        const out = await handler(body, calls);
        if (out && out.__error) return r.fulfill(json({ message: out.__error, code: 'P0001' }, 400));
        if (out && out.__hang) return undefined;
        return r.fulfill(json(out));
      }
      return r.fulfill(json(null));
    }
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, calls };
}

const LAYOUT = () => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  dir: document.documentElement.getAttribute('dir') || document.body.getAttribute('dir') || 'ltr',
  text: document.body.innerText,
  clipped: [...document.querySelectorAll('button, a, input, select')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > window.innerWidth + 1);
  }).length,
});
const RAW = /\b(broker_desk_|broker_onb_|broker_verif_|broker_err_|broker_doc_|lead_state_|admin_broker_|broker_segment_|broker_deal_|nav_broker_)\w*|undefined|NaN/;

async function check(page, lang, width, what, failures, expect = []) {
  const l = await page.evaluate(LAYOUT);
  if (l.overflow > 1) failures.push(`${what} ${lang} ${width}: horizontal overflow ${l.overflow}px`);
  if (l.clipped) failures.push(`${what} ${lang} ${width}: ${l.clipped} control(s) outside the viewport`);
  if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${what} ${lang} ${width}: not RTL`);
  const raw = l.text.match(RAW);
  if (raw) failures.push(`${what} ${lang} ${width}: raw text on screen: ${raw[0]}`);
  for (const v of expect) if (!l.text.includes(v)) failures.push(`${what} ${lang} ${width}: "${v}" missing`);
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${what}-${width}-${lang}.png`), fullPage: true }); }
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`broker desk, onboarding and admin brokers at ${width}px in every locale`, opts, async (t) => {
    if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
    const failures = [];
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height, lang });
      /* The workspace: overview (identity, KPIs from the one summary call),
         then every section through its tab. */
      await page.goto(`${BASE}/broker`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-ws-overview]', { timeout: 20000 });
      await check(page, lang, width, 'desk overview', failures, ['Nino Beridze Realty', '120.50']);
      for (const tab of ['profile', 'properties', 'clients', 'leads', 'listing', 'billing', 'notifications']) {
        await page.goto(`${BASE}/broker?tab=${tab}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ws-tabs] [aria-current="page"]', { timeout: 20000 });
        await check(page, lang, width, `desk ${tab}`, failures, tab === 'properties' ? ['104233'] : []);
        if (tab === 'clients' && await page.inputValue('#cl-s1') !== 'Giorgi — 2BR Vake') failures.push(`desk ${lang} ${width}: private client label not shown`);
      }

      await page.goto(`${BASE}/broker/onboarding`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#onb-name', { timeout: 20000 });
      await check(page, lang, width, 'onboarding', failures);
      if (await page.inputValue('#onb-name') !== LISTING.display_name) failures.push(`onboarding ${lang} ${width}: existing profile not loaded`);

      const admin = await boot(t, { width, height, lang, admin: true });
      await admin.page.goto(`${BASE}/admin/brokers`, { waitUntil: 'domcontentloaded' });
      await admin.page.waitForSelector('h1', { timeout: 20000 });
      for (const tab of [1, 2]) {
        await admin.page.locator('[aria-pressed]').nth(tab).click();
        await admin.page.waitForTimeout(500);
        await check(admin.page, lang, width, `admin-tab${tab}`, failures, [tab === 1 ? LISTING.display_name : 'Vake Homes Agency']);
      }
    }
    assert.deepEqual(failures, []);
  });
}

test('a new broker creates a profile: the RPC gets what was typed, onboarding completes, the desk opens', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { accountType: 'PERSONAL', summary: desk({ profile: null, account: { account_type: 'PERSONAL', suspended: false } }) });
  await page.goto(`${BASE}/broker`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href="/broker/onboarding"]', { timeout: 20000 });
  await page.click('main a[href="/broker/onboarding"]');
  await page.waitForSelector('#onb-name', { timeout: 20000 });

  /* No contact → the page says so and nothing is sent. */
  await page.fill('#onb-email', '');
  await page.fill('#onb-name', 'Vake Homes');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);
  assert.equal(calls.filter((c) => c.name === 'broker_profile_save').length, 0, 'saved without any contact');
  assert.ok(await page.locator('[role="alert"]').count() > 0, 'the missing contact is not said');

  await page.getByRole('radio').nth(1).click();
  await page.fill('#onb-phone', '+995 555 00 11 22');
  await page.fill('#onb-tg', '@vakehomes');
  await page.fill('#onb-cities', 'Tbilisi, Batumi');
  await page.fill('#onb-exp', '12');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/broker`, { timeout: 10000 });
  const save = calls.find((c) => c.name === 'broker_profile_save');
  assert.ok(save, 'broker_profile_save was not called');
  assert.equal(save.body.p_role, 'AGENCY');
  assert.equal(save.body.p_display_name, 'Vake Homes');
  assert.deepEqual(save.body.p_cities, ['Tbilisi', 'Batumi']);
  assert.equal(save.body.p_telegram, '@vakehomes');
  assert.equal(save.body.p_experience_years, 12);
  assert.equal(save.body.p_logo_url, null);
  for (const forbidden of ['p_status', 'p_paid_until', 'p_verification_state']) assert.ok(!(forbidden in save.body), `${forbidden} was sent`);
  assert.ok(calls.findIndex((c) => c.name === 'broker_complete_onboarding') > calls.indexOf(save), 'onboarding was not completed after the save');
});

test('an agent at an agency is told teams are not available, and is saved as an individual broker', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { summary: desk({ profile: null }) });
  await page.goto(`${BASE}/broker/onboarding`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onb-name', { timeout: 20000 });
  await page.getByRole('radio').nth(2).click();
  assert.match(await page.evaluate(() => document.body.innerText), /teams aren't available yet/i);
  await page.fill('#onb-name', 'Tamar K.');
  await page.fill('#onb-phone', '+995555001122');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/broker`, { timeout: 10000 });
  assert.equal(calls.find((c) => c.name === 'broker_profile_save').body.p_role, 'BROKER');
});

test('the directory purchase is confirmed, keyed, and a retry after a refusal reuses the key', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  let attempts = 0;
  const { page, calls } = await boot(t, {
    rpc: { broker_directory_purchase: () => { attempts += 1; return attempts === 1 ? { __error: 'INSUFFICIENT_CREDITS' } : { duplicate: false, charged_credits: 90, paid_until: ago(-30) }; } },
  });
  await page.goto(`${BASE}/broker?tab=listing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#desk-listing', { timeout: 20000 });
  await page.getByRole('button', { name: 'Buy directory listing' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.waitFor({ timeout: 5000 });
  const body = await dialog.innerText();
  assert.match(body, /90\.00 Credits for 30 days/);
  assert.match(body, /120\.50/);
  assert.equal(calls.filter((c) => c.name === 'broker_directory_purchase').length, 0, 'charged before confirmation');
  await dialog.getByRole('button', { name: 'Pay and publish' }).click();
  await page.waitForTimeout(600);
  assert.match(await page.evaluate(() => document.body.innerText), /Not enough Credits/);

  await page.getByRole('button', { name: 'Buy directory listing' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pay and publish' }).click();
  await page.waitForTimeout(600);
  const keys = calls.filter((c) => c.name === 'broker_directory_purchase').map((c) => c.body.p_idempotency_key);
  assert.equal(keys.length, 2);
  assert.ok(keys[0] && keys[0].length >= 8, 'no idempotency key');
  assert.equal(keys[0], keys[1], 'a retry of the same purchase used a new key');
  assert.match(await page.evaluate(() => document.body.innerText), /in the public directory/);
});

test('empty, error, loading and suspended desks each say so', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  const empty = await boot(t, { summary: desk({ properties: [], leads: {}, client_searches: [] }) });
  const emptyTab = async (tab, sel) => {
    await empty.page.goto(`${BASE}/broker?tab=${tab}`, { waitUntil: 'domcontentloaded' });
    await empty.page.waitForSelector(sel, { timeout: 20000 });
    await empty.page.waitForTimeout(300);
    return empty.page.evaluate(() => document.body.innerText);
  };
  assert.match(await emptyTab('properties', '#desk-portfolio'), /No properties yet/);
  assert.match(await emptyTab('leads', '#desk-leads'), /No current leads yet/);
  assert.match(await emptyTab('clients', '#desk-clients'), /No client searches yet/);

  const failing = await boot(t, { rpc: { broker_desk_summary: () => ({ __error: 'NOT_AUTHENTICATED' }) } });
  await failing.page.goto(`${BASE}/broker`, { waitUntil: 'domcontentloaded' });
  await failing.page.waitForSelector('[role="alert"]', { timeout: 20000 });
  assert.match(await failing.page.evaluate(() => document.body.innerText), /couldn't load/);
  assert.equal(await failing.page.getByRole('button', { name: 'Try again' }).count(), 1);

  const slow = await boot(t, { rpc: { broker_desk_summary: () => ({ __hang: true }) } });
  await slow.page.goto(`${BASE}/broker`, { waitUntil: 'domcontentloaded' });
  await slow.page.waitForSelector('h1', { timeout: 20000 });
  await slow.page.waitForTimeout(500);
  assert.ok(await slow.page.locator('.animate-pulse').count() > 0, 'no loading placeholder');

  const suspended = await boot(t, { summary: desk({ account: { account_type: 'BROKER', suspended: true, suspension_reason: 'Duplicate listings reported' } }) });
  for (const tab of ['overview', 'profile', 'listing', 'clients']) {
    await suspended.page.goto(`${BASE}/broker?tab=${tab}`, { waitUntil: 'domcontentloaded' });
    await suspended.page.waitForSelector('[data-ws-tabs]', { timeout: 20000 });
    const sText = await suspended.page.evaluate(() => document.body.innerText);
    assert.match(sText, /account is suspended/);
    assert.match(sText, /Duplicate listings reported/);
    for (const name of ['Buy directory listing', 'Extend directory listing', 'Send for review', 'Send for verification', 'Start search', 'Stop search']) {
      assert.equal(await suspended.page.getByRole('button', { name }).count(), 0, `a suspended account is offered "${name}" on ${tab}`);
    }
  }
});

test('an admin accepts a Broker Review item and opens a broker\'s record with its private document', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  const { page, calls } = await boot(t, { admin: true });
  await page.goto(`${BASE}/admin/brokers`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 20000 });
  await page.getByRole('button', { name: /Broker Review/ }).click();
  await page.waitForSelector('text=Vake Homes Agency', { timeout: 10000 });
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.waitForTimeout(500);
  const accept = calls.find((c) => c.name === 'admin_resolve_broker_review');
  assert.deepEqual([accept.body.p_item_id, accept.body.p_action], ['r1', 'ACCEPT']);

  await page.getByRole('button', { name: /^Verification/ }).click();
  await page.getByRole('button', { name: 'Details' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  /* The record loads after the dialog opens; wait for it, not for a timer. */
  await dialog.getByText('Professional licence').waitFor({ timeout: 10000 });
  assert.equal(await dialog.getByRole('button', { name: 'Decline' }).isDisabled(), true, 'decline without a note is allowed');
  assert.equal(await dialog.getByRole('button', { name: 'Suspend account' }).isDisabled(), true, 'suspension without a reason is allowed');
});

test('a non-professional account never sees the broker desk in the navigation', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  const personal = await boot(t, { accountType: 'PERSONAL' });
  await personal.page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await personal.page.waitForSelector('nav', { timeout: 20000 });
  assert.equal(await personal.page.locator('nav a[href="/broker"]').count(), 0);
  const pro = await boot(t, { accountType: 'AGENCY' });
  await pro.page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await pro.page.waitForSelector('nav a[href="/broker"]', { timeout: 20000 });
});

test('/brokers is account-aware: a person is offered onboarding, a professional their workspace — never the old form', opts, async (t) => {
  if (skipReason) assert.fail(`broker gate could not run: ${skipReason}`);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const personal = await boot(t, { width, height, accountType: 'PERSONAL', summary: desk({ profile: null }) });
    await personal.page.goto(`${BASE}/brokers`, { waitUntil: 'domcontentloaded' });
    await personal.page.waitForSelector('[data-broker-bar="become"]', { timeout: 20000 });
    assert.equal(await personal.page.locator('#apply, #broker-name').count(), 0, 'the old application form is back');
    assert.equal(await personal.page.locator('details[data-broker-distinction]').count(), 1, 'the distinction is one collapsible note');
    await personal.page.getByRole('button', { name: 'Create professional profile' }).click();
    await personal.page.waitForURL(`${BASE}/broker/onboarding`, { timeout: 10000 });

    const pro = await boot(t, { width, height, accountType: 'BROKER' });
    await pro.page.goto(`${BASE}/brokers`, { waitUntil: 'domcontentloaded' });
    await pro.page.waitForSelector('[data-broker-bar="workspace"]', { timeout: 20000 });
    assert.match(await pro.page.locator('[data-broker-bar="workspace"]').innerText(), /Nino Beridze Realty/);
    assert.equal(await pro.page.locator('[data-broker-bar="workspace"] a[href="/broker"]').count(), 1, 'no way into the workspace');
    assert.equal(await pro.page.locator('#apply, #broker-name').count(), 0, 'a broker is shown the application form again');
  }
});
