// FIND BUYERS 2.0 — SMART INTERNAL MATCH EXPANSION, in a real browser.
//
// Harness build; feed v2, the reach controls, the quote and the unlock answered by fixtures
// shaped exactly like the SQL (20261119090000_find_buyers_2_match_expansion.sql):
//   * three categories, one person in one: VIP, Exact, Nearby or similar — tabs with counts,
//     sections in that order, and the three prices (10 / 5 / 3 credits);
//   * every card says why it matched (measured distance, budget difference) and the detail
//     view says what is uncertain; a tolerance is never presented as purchasing capacity;
//   * the reach controls are free and change the feed on the server;
//   * the unlock quote prices each person once at their own key (never stacked);
//   * 390 px ka / ar / he: no horizontal overflow, RTL flips, no raw keys, no identity.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Unique within the mobile:discovery shard. */
const PORT = 4381;
const BASE = `http://127.0.0.1:${PORT}`;

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
const PRICES = { STANDARD: 3, EXACT: 5, PREMIUM: 10, active: true };
const PREFS = { nearbyEnabled: true, nearbyKm: 2.5, maxNearbyKm: 2.5, budgetTolerance: true, similarEnabled: true, similarAvailable: true, cityWideEnabled: true,
  saleBands: [{ upTo: 50000, tolerance: 5000 }, { upTo: 119999, tolerance: 10000 }, { upTo: null, tolerance: 15000 }], bandsCurrency: 'USD', rentTolerancePct: 0 };

const base = (over) => ({
  score: 80, band: 'STRONG', segment: 'STANDARD', unlocked: false, contacted: false, crmStatus: null, crmEntryId: null, saved: false, fresh: false, stale: false,
  searcher: 'DIRECT', transaction: 'SALE', intentType: 'BUY', propertyTypes: ['APARTMENT'], requirements: { bedroomsMin: 2 }, features: {},
  agreed: ['TRANSACTION', 'CITY', 'PROPERTY_TYPE', 'BEDROOMS'], conflicted: [], unknown: [], demandAt: ago(3), activeAt: ago(1), matchedAt: ago(1), updatedAt: ago(1),
  contactOptions: { message: true, phone: false, email: false }, displayName: null, language: null, ...over,
});
const ITEMS = [
  base({ matchId: 'bbbbbbbb-0000-4000-8000-000000000003', segment: 'PREMIUM', category: 'VIP', matchCategory: 'NEARBY_SIMILAR', kind: 'CITY_WIDE', confidence: 'MEDIUM', priceKey: 'PREMIUM', priceCredits: 10,
    locations: { city: 'Tbilisi', district: null, neighborhoods: [] }, budget: { min: 200000, max: 300000, currency: 'USD' },
    explanation: { geo: { level: 'CITY_WIDE' }, budget: { verdict: 'WITHIN', currency: 'USD' }, uncertainty: ['CITY_WIDE_SEARCH'] } }),
  base({ matchId: 'bbbbbbbb-0000-4000-8000-000000000001', category: 'EXACT', matchCategory: 'EXACT', kind: 'EXACT_LOCATION', confidence: 'HIGH', priceKey: 'EXACT', priceCredits: 5, score: 95,
    locations: { city: 'Tbilisi', district: 'Krtsanisi', neighborhoods: [] }, budget: { min: 200000, max: 220000, currency: 'USD' },
    explanation: { geo: { level: 'EXACT_AREA', demandPlace: 'Krtsanisi', supplyPlace: 'Krtsanisi', streetMentioned: false }, budget: { verdict: 'WITHIN', currency: 'USD' }, uncertainty: [] } }),
  base({ matchId: 'bbbbbbbb-0000-4000-8000-000000000002', category: 'NEARBY_SIMILAR', matchCategory: 'NEARBY_SIMILAR', kind: 'NEARBY_AREA', confidence: 'LOW', priceKey: 'STANDARD', priceCredits: 3, score: 70, band: 'POTENTIAL',
    locations: { city: 'Tbilisi', district: 'Isani', neighborhoods: [] }, budget: { min: 150000, max: 200000, currency: 'USD' },
    explanation: { geo: { level: 'NEARBY_AREA', demandPlace: 'Isani', supplyPlace: 'Krtsanisi', km: 2.28, samples: [22, 142], priceLevelRatio: 1.08 },
      budget: { verdict: 'ABOVE_MAX_TOLERANCE', outsideBy: 13840, tolerance: 15000, currency: 'USD', flexible: false }, uncertainty: ['ABOVE_MAX'] } }),
];

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
  const state = { prefs: { ...PREFS }, feedCalls: [], prefCalls: [], quoteCalls: [], unlockCalls: [] };
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
    if (url.includes('/rpc/internal_match_preferences_set')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.prefCalls.push(body.p);
      state.prefs = { ...state.prefs, ...body.p };
      return r.fulfill(json(state.prefs));
    }
    if (url.includes('/rpc/internal_leads_feed_v2')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.feedCalls.push(body.p);
      const filters = body.p?.filters ?? [];
      const visible = ITEMS.filter((x) => !(x.kind === 'NEARBY_AREA' && (!state.prefs.nearbyEnabled || x.explanation.geo.km > state.prefs.nearbyKm))
        && !(!state.prefs.budgetTolerance && x.explanation.budget.verdict === 'ABOVE_MAX_TOLERANCE')
        && !(!state.prefs.cityWideEnabled && x.kind === 'CITY_WIDE'));
      const cat = (f) => (f === 'EXACT' ? 'EXACT' : f === 'NEARBY' ? 'NEARBY_SIMILAR' : f === 'VIP' ? 'VIP' : null);
      const pick = visible.filter((x) => filters.every((f) => !cat(f) || x.category === cat(f)));
      const c = (fn) => visible.filter(fn).length;
      return r.fulfill(json({
        total: pick.length, prices: PRICES, lastSeenAt: null, items: pick, preferences: state.prefs, facets: { districts: ['Isani', 'Krtsanisi'], propertyTypes: ['APARTMENT'] },
        counts: { ALL: visible.length, EXACT: c((x) => x.category === 'EXACT'), NEARBY: c((x) => x.category === 'NEARBY_SIMILAR'), VIP: c((x) => x.category === 'VIP'),
          HIGH_CONFIDENCE: c((x) => x.confidence === 'HIGH'), STRONG: c((x) => x.band === 'STRONG'), POTENTIAL: c((x) => x.band === 'POTENTIAL'),
          STANDARD: c((x) => x.segment === 'STANDARD'), PREMIUM: c((x) => x.segment === 'PREMIUM'), FRESH: 0, UNLOCKED: 0, LOCKED: visible.length,
          CONTACTED: 0, SAVED: 0, DIRECT: visible.length, BROKER: 0, STALE: 0, ACTIVE: visible.length },
      }));
    }
    if (url.includes('/rpc/internal_leads_unlock_quote')) {
      const ids = JSON.parse(req.postData() ?? '{}').p_match_ids ?? [];
      state.quoteCalls.push(ids);
      const sel = ITEMS.filter((x) => ids.includes(x.matchId));
      const n = (k) => sel.filter((x) => x.priceKey === k).length;
      return r.fulfill(json({ requested: ids.length, eligible: sel.length, alreadyUnlocked: 0,
        standardCount: n('STANDARD'), exactCount: n('EXACT'), premiumCount: n('PREMIUM'),
        standardCredits: n('STANDARD') * 3, exactCredits: n('EXACT') * 5, premiumCredits: n('PREMIUM') * 10,
        totalCredits: n('STANDARD') * 3 + n('EXACT') * 5 + n('PREMIUM') * 10, balance: 100, prices: PRICES }));
    }
    if (url.includes('/functions/v1/atomic-unlock')) { state.unlockCalls.push(JSON.parse(req.postData() ?? '{}')); return r.fulfill(json({ error: 'NOT_IN_THIS_TEST' }, 409)); }
    if (url.includes('/rpc/internal_leads_mark_seen') || url.includes('/rpc/internal_leads_request_matching')) return r.fulfill(json(true));
    if (url.includes('/rpc/owner_demo_lead_available')) return r.fulfill(json(false));
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state };
}

/* Money is wrapped in bidi isolates (U+2066–U+2069) so it reads right in RTL; compare without them. */
const plain = (s) => String(s ?? '').replace(/[\u2066-\u2069]/g, '');

async function openLeads(page) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/leads`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="lead-card"]').first().waitFor({ timeout: 30000 });
}
async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${label}: horizontal overflow ${sw} > ${iw}`);
}

test('1440 (en): three categories, three prices, sections in order, every card says why', opts, async (t) => {
  const { page, state } = await boot(t);
  await openLeads(page);
  await noOverflow(page, 'en 1440');
  assert.equal(state.feedCalls[0].sort, 'CATEGORY', 'grouped by category by default');
  const prices = await page.locator('[data-testid="hl-prices"]').textContent();
  for (const p of ['Exact match', '5 credits', 'Nearby or similar', '3 credits', 'VIP', '10 credits']) assert.ok(prices.includes(p), `price tile: ${p}`);
  const tabs = await page.locator('[data-testid="hl-categories"]').textContent();
  assert.match(tabs, /All\s*3/); assert.match(tabs, /Exact match\s*1/); assert.match(tabs, /Nearby or similar\s*1/); assert.match(tabs, /VIP\s*1/);
  const sections = await page.locator('[data-testid="hl-section"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  assert.deepEqual(sections, ['VIP', 'EXACT', 'NEARBY_SIMILAR']);
  const cards = page.locator('[data-testid="lead-card"]');
  assert.deepEqual(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-category'))), ['VIP', 'EXACT', 'NEARBY_SIMILAR'], 'one person, one category');
  const exact = await cards.nth(1).textContent();
  assert.match(exact, /They searched in Krtsanisi, where this property is\./);
  assert.match(exact, /high confidence/);
  assert.match(exact, /Unlock exact match · 5 credits/);
  const nearby = await cards.nth(2).textContent();
  assert.match(nearby, /They searched in Isani; this property is in Krtsanisi, about 2\.28 km away\./);
  assert.match(nearby, /low confidence/);
  assert.match(await cards.nth(0).textContent(), /Unlock VIP contact · 10 credits/, 'VIP replaces the other prices');
  /* The detail view: the budget difference, what it is not, and what is uncertain. */
  await cards.nth(2).locator('[data-testid="lead-details"]').click();
  const drawer = page.locator('[data-testid="lead-drawer"]');
  await drawer.waitFor();
  const why = plain(await drawer.locator('[data-testid="lead-why-detail"]').textContent());
  assert.match(why, /Distance measured from where 22 and 142 listings actually are/);
  assert.match(why, /\$13,840 above the maximum they stated — within HOMATCH's discovery tolerance of \$15,000\. This is not proof they can pay more\./);
  assert.match(await drawer.locator('[data-testid="lead-uncertain"]').textContent(), /Above their stated maximum budget\./);
  /* Nothing identifying before an unlock: no member name, no contact link anywhere on the page. */
  assert.equal(await page.locator('a[href^="tel:"], a[href^="mailto:"]').count(), 0, 'no contact link before an unlock');
});

test('reach controls are free and change the feed on the server; the quote prices each person once', opts, async (t) => {
  const { page, state } = await boot(t);
  await openLeads(page);
  const reach = page.locator('[data-testid="hl-reach"]');
  assert.match(await reach.textContent(), /it is not proof anyone can pay more/);
  assert.match(plain(await reach.locator('[data-testid="hl-reach-bands"]').textContent()), /Up to \$50,000: ±\$5,000.*\$50,001–\$119,999: ±\$10,000.*\$120,000 and above: ±\$15,000/s);
  const before = state.feedCalls.length;
  await reach.locator('[data-testid="hl-reach-budgetTolerance"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-card"]').length === 2);
  assert.deepEqual(state.prefCalls.at(-1), { budgetTolerance: false });
  assert.ok(state.feedCalls.length > before, 'the feed is read again');
  assert.equal(await reach.locator('[data-testid="hl-reach-budgetTolerance"]').getAttribute('aria-checked'), 'false');
  await reach.locator('[data-testid="hl-reach-budgetTolerance"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lead-card"]').length === 3);
  const kmOptions = await reach.locator('[data-testid="hl-reach-km"] option').evaluateAll((els) => els.map((e) => Number(e.value)));
  assert.ok(kmOptions.every((k) => k <= 2.5), 'the owner can only narrow the configured distance');
  /* Select all three and open the bulk unlock: one price per person, never stacked. */
  for (const box of await page.locator('[data-testid="lead-card"] input[type="checkbox"]').all()) await box.check();
  assert.match(plain(await page.locator('[data-testid="bulk-bar"]').textContent()), /Exact 1 · Nearby or similar 1 · VIP 1 · 18 credits/);
  await page.locator('[data-testid="bulk-unlock"]').click();
  const dialog = page.locator('[data-testid="unlock-dialog"]');
  await dialog.waitFor();
  await dialog.locator('[data-testid="unlock-exact-row"]').waitFor();
  const quote = plain(await dialog.textContent());
  assert.match(quote, /Exact match × 1 \(5 each\)/);
  assert.match(quote, /Nearby or similar × 1 \(3 each\)/);
  assert.match(quote, /18 credits/);
  assert.equal(state.unlockCalls.length, 0, 'nothing is charged without the explicit confirmation');
});

test('390 px (ka, ar, he): categories, reasons and controls fit; RTL flips; no raw keys', opts, async (t) => {
  for (const lang of ['ka', 'ar', 'he']) {
    const { page } = await boot(t, { width: 390, height: 844, lang });
    await openLeads(page);
    await noOverflow(page, `${lang} 390`);
    const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
    assert.equal(dir, lang === 'ka' ? 'ltr' : 'rtl', `${lang} direction`);
    const text = await page.textContent('main');
    assert.ok(!/\bhl_[a-z_]+/i.test(text), `${lang}: no raw translation keys`);
    if (lang === 'ka') { assert.ok(text.includes('ზუსტი დამთხვევა')); assert.ok(!text.includes('შესატყვისი')); }
    await page.locator('[data-testid="hl-reach"]').scrollIntoViewIfNeeded();
    const box = await page.locator('[data-testid="hl-reach-budgetTolerance"]').boundingBox();
    assert.ok(box && box.height >= 24 && box.x >= 0 && box.x + box.width <= 390, `${lang}: the switch is on screen`);
  }
});
