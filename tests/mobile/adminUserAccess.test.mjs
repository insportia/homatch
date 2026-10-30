// ADMIN → USER ACCESS ("მომხმარებლების წვდომები") and the owner's own screens, at 390 px, in Georgian.
//
// A stubbed Supabase answers the admin_access_* RPCs and entitlement_status_for_me. The admin finds
// a customer, grants Unlimited for 30 days with a reason, confirms, and the test reads back exactly
// what was sent. The owner's My subscription shows "Unlimited access" and no purchase, no credits.
// Nothing horizontal-scrolls.
//
//   npm run build:harness && node --test tests/mobile/adminUserAccess.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4403;
const BASE = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p)) ?? null;
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 600000 };

function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return { access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {} } };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: true, preferred_language: 'ka',
  full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const feature = (f, kind, o = {}) => ({ feature: f, kind, source: 'NONE', included: false, unlimited: false, limit: null, used: 0, remaining: 0,
  trialEnabled: kind === 'QUOTA', trialState: 'UNUSED', trialAvailable: kind === 'QUOTA', ...o });
const FEATURES = [['VERIFY', 'QUOTA'], ['CONTRACT_ANALYSIS', 'QUOTA'], ['PREMIUM_DISCOVERY', 'QUOTA'], ['HOMI_UNLIMITED', 'BOOLEAN'],
  ['INTERNAL_SEARCH', 'BOOLEAN'], ['INTERNAL_MATCHING', 'BOOLEAN'], ['INTERNAL_UNLOCK_FREE', 'BOOLEAN']];
const OWNER_STATUS = {
  plan: 'FREE', subscription: null, accountEligibleForTrials: true, legacyBalance: 99178.51, hasLegacyBalance: true,
  features: FEATURES.map(([f, k]) => (f === 'PREMIUM_DISCOVERY' ? feature(f, k) : feature(f, k, { source: 'OWNER', included: true, unlimited: true, used: 3, remaining: null, trialAvailable: false }))),
  access: { owner: true, unlimited: true, source: 'OWNER', grants: [] },
};
const CUSTOMER = { id: 'c1', email: 'nino@example.test', fullName: 'ნინო ბერიძე', username: 'nino', isAdmin: false, owner: false, suspended: false,
  createdAt: '2026-09-01T10:00:00Z', plan: null, activeGrants: 0, unlimited: false };

test('admin user access at 390 px: find, grant Unlimited for 30 days, confirm; owner sees unlimited, no credits', opts, async (t) => {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', 'ka'); },
    ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();

  const grants = [];
  const rpc = [];
  const detail = () => ({
    user: { id: 'c1', email: CUSTOMER.email, fullName: CUSTOMER.fullName, username: 'nino', isAdmin: false, owner: false, accountType: 'PERSONAL',
      suspended: false, createdAt: CUSTOMER.createdAt, verified: true },
    manageable: true,
    status: { plan: 'FREE', subscription: null, accountEligibleForTrials: true, legacyBalance: 0, hasLegacyBalance: false,
      features: FEATURES.map(([f, k]) => feature(f, k, grants.length && f !== 'PREMIUM_DISCOVERY' ? { source: 'GRANT', included: true, unlimited: true, remaining: null } : {})),
      access: { owner: false, unlimited: grants.length > 0, source: grants.length ? 'GRANT' : 'NONE', grants: [] } },
    grants, usage: [], events: grants.map((g) => ({ id: `e-${g.id}`, grantId: g.id, action: 'GRANTED', actorId: 'u1', actorEmail: 'owner@example.test',
      previous: null, new: g, reason: g.reason, expiresAt: g.expiresAt, createdAt: g.createdAt })),
    legacyBalance: 0,
  });
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    if (url.includes('/rest/v1/rpc/entitlement_status_for_me')) return r.fulfill(json(OWNER_STATUS));
    if (url.includes('/rest/v1/rpc/admin_access_users')) return r.fulfill(json([{ ...CUSTOMER, unlimited: grants.length > 0, activeGrants: grants.length }]));
    if (url.includes('/rest/v1/rpc/admin_access_user')) return r.fulfill(json(detail()));
    if (url.includes('/rest/v1/rpc/admin_access_grant')) {
      const body = JSON.parse(req.postData() || '{}');
      rpc.push(body);
      const g = { id: `g${grants.length + 1}`, userId: body.p_user_id, kind: body.p_kind, planCode: body.p_plan_code, status: 'ACTIVE', live: true, expired: false,
        startsAt: new Date().toISOString(), expiresAt: body.p_expires_at, permanent: body.p_expires_at == null, reason: body.p_reason,
        createdBy: 'u1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revokedAt: null, revokeReason: null,
        allowances: FEATURES.filter(([f]) => f !== 'PREMIUM_DISCOVERY').map(([f]) => ({ feature: f, unlimited: true, limit: null, period: 'TOTAL',
          countedSince: new Date().toISOString(), windowStart: new Date().toISOString(), used: 0, remaining: null })) };
      grants.push(g);
      return r.fulfill(json(g));
    }
    if (url.includes('/rest/v1/rpc/')) return r.fulfill(json(null));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    if (url.includes('/functions/v1/')) return r.fulfill(json({}));
    return r.fulfill(json({}));
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const noOverflow = async (where) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${where}: page scrolls sideways by ${over}px`);
  };

  /* 1 · the page, its search and the customer */
  await page.goto(`${BASE}/admin/access`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('admin-access-page').waitFor({ timeout: 30000 });
  await page.getByRole('heading', { name: 'მომხმარებლების წვდომები' }).waitFor({ timeout: 15000 });
  await noOverflow('list');
  await page.getByRole('button', { name: /nino@example\.test/ }).click();
  const det = page.getByTestId('admin-access-detail');
  await det.waitFor({ timeout: 15000 });
  await det.getByText('წვდომის ტიპი').first().waitFor();
  await det.getByText('გამოყენების ისტორია').first().waitFor();
  await noOverflow('detail');

  /* 2 · grant Unlimited for 30 days: refused without a reason, then confirmed */
  const grantButton = det.getByRole('button', { name: 'შეუზღუდავი წვდომის მინიჭება' });
  await det.getByText('30 დღე').click();
  await grantButton.click();
  await page.getByText('ჯერ მიუთითეთ მიზეზი.').first().waitFor({ timeout: 5000 });
  assert.equal(rpc.length, 0, 'nothing is written without a reason');
  await page.getByLabel(/მიზეზი/).fill('პრესის დემო');
  await grantButton.click();
  const confirmBox = page.getByRole('alertdialog');
  await confirmBox.waitFor({ timeout: 5000 });
  assert.equal(rpc.length, 0, 'nothing is written before the confirmation');
  await noOverflow('confirm');
  await confirmBox.getByRole('button', { name: 'დადასტურება' }).click();
  await page.getByText('მომხმარებლის წვდომა წარმატებით განახლდა.').first().waitFor({ timeout: 10000 });
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].p_user_id, 'c1'); assert.equal(rpc[0].p_kind, 'UNLIMITED'); assert.equal(rpc[0].p_reason, 'პრესის დემო');
  const days = (Date.parse(rpc[0].p_expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days < 30.1, `30 days, got ${days}`);
  await det.getByText('წვდომის გაუქმება').first().waitFor({ timeout: 10000 });
  await det.getByText('მოქმედების ვადა').first().waitFor();
  await noOverflow('after grant');

  /* 3 · the owner's own subscription page: unlimited, no purchase, no credits */
  await page.goto(`${BASE}/account/subscription`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('manual-access').waitFor({ timeout: 30000 });
  await page.getByText('თქვენი წვდომა აქტიურია. გამოწერის შეძენა არ გჭირდებათ.').first().waitFor();
  await page.getByText('თქვენ გაქვთ შეუზღუდავი წვდომა HOMATCH-ის შიდა სერვისებზე.').first().waitFor();
  const body = await page.locator('main').innerText();
  assert.ok(!body.includes('99178'), 'no legacy balance for an unlimited account');
  assert.equal(await page.getByRole('link', { name: 'გეგმების ნახვა' }).count(), 0, 'no plans purchase link');
  assert.equal(await page.getByRole('button', { name: /db_credits_aria|კრედიტ/ }).count(), 0, 'no credit chip');
  await noOverflow('my subscription');

  assert.deepEqual(errors, [], 'no page errors');
});
