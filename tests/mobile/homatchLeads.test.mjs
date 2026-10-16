// HOMATCH LEADS — "Your Matching Buyers", in a real browser.
//
// Harness build; the feed, quote, unlock and contact calls answered by fixtures shaped
// exactly like the SQL functions (20261028090000_homatch_leads_marketplace.sql):
//
//   * the approved copy (eyebrow, headline, description, sales section, filters, CTAs);
//   * a Standard and a Premium card, segment and score side by side, no identity before
//     an unlock (no name, phone or email anywhere in the DOM);
//   * unlocking one contact: the exact price is quoted, confirmed once, sent once to
//     atomic-unlock as kind=internal_leads with an idempotency key; after it, the card
//     says Open Contact and the drawer shows only what the member allows;
//   * Bulk Unlock: the bar totals Standard + Premium, a double click confirms once;
//   * 320 → 1440 px, en / ka / ar / he: no horizontal overflow, RTL flips.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Unique within the mobile:discovery shard (node --test runs its files in parallel). */
const PORT = 4367;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.HOMATCH_LEADS_SHOTS || null;

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p) && !p.endsWith('/opt/pw-browsers/chromium')) ?? null;
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
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const PRICES = { STANDARD: 2.5, PREMIUM: 6, active: true };

const item = (over) => ({
  matchId: 'aaaaaaaa-0000-4000-8000-000000000001', score: 91, band: 'STRONG', segment: 'PREMIUM', priceCredits: 6,
  unlocked: false, contacted: false, crmStatus: null, crmEntryId: null, saved: false, fresh: true, transaction: 'SALE', intentType: 'BUYER',
  propertyTypes: ['APARTMENT'], locations: { city: 'Tbilisi', district: 'Krtsanisi', neighborhoods: ['Ortachala'] },
  budget: { min: 300000, max: 450000, currency: 'USD' }, requirements: { bedroomsMin: 2 }, agreed: ['TRANSACTION', 'PROPERTY_TYPE', 'CITY', 'DISTRICT', 'PRICE'],
  conflicted: [], unknown: ['AREA'], demandAt: ago(3), matchedAt: ago(1), updatedAt: ago(1),
  contactOptions: { message: true, phone: false, email: false }, displayName: null, language: null, ...over,
});

async function boot(t, { width = 1440, height = 900, lang = 'en' } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const state = {
    items: [
      item({}),
      item({ matchId: 'aaaaaaaa-0000-4000-8000-000000000002', score: 74, band: 'POTENTIAL', segment: 'STANDARD', priceCredits: 2.5, fresh: false,
        budget: { min: 180000, max: 220000, currency: 'USD' }, contactOptions: { message: true, phone: true, email: false }, agreed: ['TRANSACTION', 'CITY', 'PROPERTY_TYPE'] }),
    ],
    unlockCalls: [],
    balance: 40,
  };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE) || url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? profile : [profile]));
    if (url.includes('/rest/v1/properties')) {
      const p = { id: PROPERTY_ID, title: '3-room apartment, Krtsanisi St 6', homatch_id: 244486 };
      return r.fulfill(json(wantsObject ? p : [p]));
    }
    if (url.includes('/rpc/internal_leads_feed')) {
      const body = JSON.parse(req.postData() ?? '{}');
      const f = body.p_filter ?? 'ALL';
      const pick = state.items.filter((x) => f === 'ALL' || (f === 'PREMIUM' && x.segment === 'PREMIUM') || (f === 'STANDARD' && x.segment === 'STANDARD')
        || (f === 'UNLOCKED' && x.unlocked) || (f === 'FRESH' && x.fresh) || (f === 'STRONG' && x.band === 'STRONG') || (f === 'POTENTIAL' && x.band === 'POTENTIAL'));
      const c = (fn) => state.items.filter(fn).length;
      return r.fulfill(json({
        total: pick.length, prices: PRICES, lastSeenAt: null, items: pick,
        counts: { ALL: state.items.length, STRONG: c((x) => x.band === 'STRONG'), POTENTIAL: c((x) => x.band === 'POTENTIAL'), STANDARD: c((x) => x.segment === 'STANDARD'),
          PREMIUM: c((x) => x.segment === 'PREMIUM'), FRESH: c((x) => x.fresh), UNLOCKED: c((x) => x.unlocked), CONTACTED: 0, SAVED: c((x) => x.saved) },
      }));
    }
    if (url.includes('/rpc/internal_leads_unlock_quote')) {
      const ids = JSON.parse(req.postData() ?? '{}').p_match_ids ?? [];
      const sel = state.items.filter((x) => ids.includes(x.matchId));
      const fresh = sel.filter((x) => !x.unlocked);
      const std = fresh.filter((x) => x.segment === 'STANDARD').length;
      const prem = fresh.filter((x) => x.segment === 'PREMIUM').length;
      return r.fulfill(json({ requested: ids.length, eligible: sel.length, alreadyUnlocked: sel.length - fresh.length, standardCount: std, premiumCount: prem,
        standardCredits: std * 2.5, premiumCredits: prem * 6, totalCredits: std * 2.5 + prem * 6, balance: state.balance, prices: PRICES }));
    }
    if (url.includes('/functions/v1/atomic-unlock')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.unlockCalls.push(body);
      const seen = state.unlockCalls.filter((c) => c.idempotencyKey === body.idempotencyKey).length > 1;
      let charged = 0;
      for (const x of state.items) {
        if (body.matchIds.includes(x.matchId) && !x.unlocked) {
          if (!seen) charged += x.priceCredits;
          x.unlocked = true; x.displayName = x.segment === 'STANDARD' ? 'Layla' : 'Ivan';
        }
      }
      state.balance -= charged;
      return r.fulfill(json({ success: true, unlocked: body.matchIds, alreadyUnlocked: [], skipped: [], chargedCredits: charged, balanceAfter: state.balance, duplicate: seen }));
    }
    if (url.includes('/rpc/internal_lead_contact')) {
      const id = JSON.parse(req.postData() ?? '{}').p_match_id;
      const x = state.items.find((i) => i.matchId === id);
      return r.fulfill(json({ restricted: false, displayName: x?.displayName, canMessage: true, phone: x?.contactOptions.phone ? '+971500000001' : null, email: null }));
    }
    if (url.includes('/rpc/internal_leads_mark_seen') || url.includes('/rpc/internal_leads_request_matching')) return r.fulfill(json(true));
    if (url.includes('/rpc/billing_my_budget_choices')) return r.fulfill(json({ ok: true, balance: state.balance, presets: [] }));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state };
}

async function openLeads(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/leads`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="lead-card"]').first().waitFor({ timeout: 30000 });
}

async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${label}: horizontal overflow ${sw} > ${iw}`);
}
async function shot(page, name, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

test('1440 (en): approved copy, two segments ranked by score, nothing identifying before an unlock', opts, async (t) => {
  const { page } = await boot(t);
  await openLeads(page);
  await noOverflow(page, "en 1440");
  const main = await page.textContent('main');
  for (const copy of ['HOMATCH INTELLIGENCE', 'Your Matching Buyers',
    'Discover people whose property requirements align with your listing. Explore every relevant opportunity and unlock only the contacts you want to approach.',
    'Every match is a new opportunity.', 'Explore every relevant opportunity. Unlock only the contacts you want to approach.',
    'All Matches', 'Strong Matches', 'Potential Matches', 'Fresh Matches', 'Unlock Contact · 6 Credits', 'Unlock Contact · 2.5 Credits',
    'Looking For', 'Preferred Location', 'Budget Range', 'Property Requirements', 'Why This Matches', 'Last Updated', 'Available Contact Options',
    'A higher-budget property search that may be relevant to your listing. Review the actual requirements and match strength before making an offer.']) {
    assert.ok(main.includes(copy), `missing approved copy: ${copy}`);
  }
  const cards = page.locator('[data-testid="lead-card"]');
  assert.equal(await cards.count(), 2);
  assert.equal(await cards.nth(0).getAttribute('data-segment'), 'PREMIUM');
  assert.match(await cards.nth(1).textContent(), /74%/);
  const html = await page.content();
  assert.doesNotMatch(html, /Layla|Ivan|\+971|@x\.test/, 'no identity before unlock');
  assert.match(main, /Looking for an apartment in Ortachala, Krtsanisi, Tbilisi, with a budget of/);
  await shot(page, 'leads-en-1440');
});

test('unlock one Standard contact: quoted 2.5, confirmed once, then Open Contact and the permitted phone', opts, async (t) => {
  const { page, state } = await boot(t);
  await openLeads(page);
  await page.locator('[data-testid="lead-card"]').nth(1).locator('[data-testid="lead-unlock"]').click();
  const dialog = page.locator('[data-testid="unlock-dialog"]');
  await dialog.waitFor();
  await page.waitForFunction(() => /2\.5/.test(document.querySelector('[data-testid="unlock-dialog"]')?.textContent ?? ''));
  await shot(page, 'leads-unlock-dialog', false);
  const confirm = dialog.locator('[data-testid="unlock-confirm"]');
  await confirm.click();
  await page.locator('[data-testid="unlock-dialog"]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  assert.equal(state.unlockCalls.length, 1, 'one charge request');
  assert.equal(state.unlockCalls[0].kind, 'internal_leads');
  assert.match(state.unlockCalls[0].idempotencyKey, /^ilu:/);
  assert.equal(state.balance, 37.5);
  await page.getByRole('button', { name: 'Open Contact' }).first().click();
  await page.locator('[data-testid="lead-drawer"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="lead-drawer"]')?.textContent?.includes('+971500000001'));
  await shot(page, 'leads-drawer-unlocked', false);
});

test('Bulk Unlock: the bar totals 1 Standard + 1 Premium = 8.5 credits; a double click charges once', opts, async (t) => {
  const { page, state } = await boot(t, { width: 390, height: 844 });
  await openLeads(page);
  const boxes = page.locator('[data-testid="lead-card"] input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.locator('[data-testid="bulk-bar"]');
  await bar.waitFor();
  assert.match(await bar.textContent(), /Standard 1 · Premium 1 · 8\.5 credits/);
  await noOverflow(page, 'bulk bar 390');
  await shot(page, 'leads-bulk-390');
  await page.locator('[data-testid="bulk-unlock"]').click();
  await page.waitForFunction(() => /8\.5/.test(document.querySelector('[data-testid="unlock-dialog"]')?.textContent ?? ''));
  const confirm = page.locator('[data-testid="unlock-confirm"]');
  await confirm.dblclick();
  await page.waitForFunction(() => !document.querySelector('[data-testid="unlock-dialog"]'), null, { timeout: 15000 }).catch(() => {});
  const keys = new Set(state.unlockCalls.map((c) => c.idempotencyKey));
  assert.equal(keys.size, 1, 'one idempotency key for the confirmation');
  assert.equal(state.balance, 31.5, 'charged 8.5 once');
});

for (const lang of ['en', 'ka', 'ar', 'he']) {
  test(`${lang}: 320 · 360 · 390 · 430 · 768 · 1024 · 1280 — no horizontal overflow${['ar', 'he'].includes(lang) ? ', RTL' : ''}`, opts, async (t) => {
    const { page } = await boot(t, { width: 320, height: 900, lang });
    for (const width of [320, 360, 390, 430, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openLeads(page);
      await noOverflow(page, `${lang} ${width}`);
      if (['ar', 'he'].includes(lang)) assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      const unlock = page.locator('[data-testid="lead-unlock"]').first();
      const box = await unlock.boundingBox();
      assert.ok(box && box.height >= 44, `${lang} ${width}: unlock button ≥ 44px tall`);
      if (width === 390 || width === 1024) await shot(page, `leads-${lang}-${width}`);
    }
  });
}
