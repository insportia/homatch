// The matching workspace in a real browser — shared harness and server fixtures.
//
// Harness build (npm run build:harness) + vite preview; every Supabase call is answered here,
// shaped exactly like the SQL in 20261128090000_curated_leads_marketplace.sql:
//   rpc/matching_workspace_state, curated_leads_catalog, curated_leads_quote,
//   internal_leads_feed_v2, internal_leads_unlock_quote, internal_lead_contact,
//   curated_leads_save_to_list, internal_leads_save_to_list, functions/v1/atomic-unlock.
// Used by matchingWorkspace.test.mjs and by the retired screens' tests (which now assert that
// their addresses land here). Each caller passes its own port (node --test runs files in
// parallel inside one shard).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = process.cwd();
export const PROPERTY_ID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';

export function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) ?? null;
}
export function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core')]) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
export function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Chrome not found — set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}
export function testOptions() {
  const skipReason = haveDeps();
  return skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900000 };
}

export function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Owner', plan: 'FREE', created_at: new Date().toISOString() };
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/* ── the External Leads Database: 640 published leads, 5 of them already unlocked ── */
const COUNTRIES = ['DE', 'AE', 'GB', 'IL', 'TR', 'RU', 'US', 'GE'];
const FIRST = ['Anna', 'Omar', 'James', 'Noa', 'Elif', 'Ivan', 'Mia', 'Giorgi'];
export function curatedLeads(n = 640) {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid('cccccccc', i + 1),
    firstName: FIRST[i % FIRST.length], lastName: `Zeta${i + 1}`,
    email: `lead${i + 1}@leads.example`, phone: i % 3 === 0 ? `+4915100${String(i).padStart(5, '0')}` : null,
    whatsapp: i % 4 === 0 ? `+97150${String(i).padStart(6, '0')}` : null, telegram: i % 5 === 0 ? `@lead${i + 1}` : null,
    facebook: null, linkedin: i % 7 === 0 ? `https://www.linkedin.com/in/lead${i + 1}` : null, otherSocial: null,
    country: COUNTRIES[i % COUNTRIES.length],
    languages: i % 9 === 0 ? [] : [['en'], ['ar', 'en'], ['en'], ['he'], ['tr'], ['ru'], ['en'], ['ka', 'ru']][i % 8],
    interests: [['INVEST'], ['RENT'], ['BUY'], ['BUY', 'RENT'], ['BUY'], ['INVEST', 'BUY'], ['RENT'], ['BUY']][i % 8],
    category: 'PRIVATE', city: null, region: null, preferredLocation: i % 6 === 0 ? 'Batumi' : null,
    budget: i % 10 === 0 ? { min: 100000, max: 250000, currency: 'USD' } : null,
    propertyType: null, investmentPrefs: null, description: null,
    addedAt: ago(i % 60), lastVerifiedAt: ago((i % 60) + 1), status: 'PUBLISHED',
  }));
}
const channelsOf = (l) => ({ email: true, phone: !!l.phone, whatsapp: !!l.whatsapp, telegram: !!l.telegram, facebook: !!l.facebook, linkedin: !!l.linkedin, otherSocial: !!l.otherSocial });
function curatedMatches(l, f = {}) {
  const has = (k) => Array.isArray(f[k]) && f[k].length > 0;
  if (has('countries') && !f.countries.includes(l.country)) return false;
  if (has('languages') && !(l.languages.some((x) => f.languages.includes(x)) || (f.languages.includes('unknown') && l.languages.length === 0))) return false;
  if (has('interests') && !l.interests.some((x) => f.interests.includes(x))) return false;
  if (f.q && !`${l.firstName} ${l.preferredLocation ?? ''}`.toLowerCase().includes(String(f.q).toLowerCase())) return false;
  if (has('channels') && f.channels.includes('PHONE') && !l.phone) return false;
  return true;
}

/* ── HOMATCH Internal: three members, one per price key (VIP 10 / Exact 5 / Nearby 3) ── */
export function internalItems() {
  const base = {
    band: 'STRONG', segment: 'STANDARD', unlocked: false, contacted: false, crmStatus: null, crmEntryId: null, saved: false, fresh: true,
    transaction: 'SALE', intentType: 'BUYER', interest: 'BUY', country: 'GE', propertyTypes: ['APARTMENT'],
    locations: { city: 'Tbilisi', district: 'Krtsanisi', neighborhoods: ['Ortachala'] }, budget: { min: 300000, max: 450000, currency: 'USD' },
    requirements: { bedroomsMin: 2 }, agreed: ['TRANSACTION', 'PROPERTY_TYPE', 'CITY'], conflicted: [], unknown: [], demandAt: ago(3), matchedAt: ago(1), updatedAt: ago(1),
    contactOptions: { message: true, phone: true, email: false }, displayName: null, language: null, confidence: 'HIGH', kind: 'EXACT_LOCATION',
  };
  return [
    { ...base, matchId: uuid('aaaaaaaa', 1), score: 93, category: 'VIP', priceKey: 'PREMIUM', segment: 'PREMIUM', priceCredits: 10, budget: { min: 900000, max: 1200000, currency: 'USD' } },
    { ...base, matchId: uuid('aaaaaaaa', 2), score: 88, category: 'EXACT', priceKey: 'EXACT', priceCredits: 5 },
    { ...base, matchId: uuid('aaaaaaaa', 3), score: 71, band: 'POTENTIAL', category: 'NEARBY_SIMILAR', priceKey: 'STANDARD', priceCredits: 3, kind: 'NEARBY_AREA', interest: 'RENT', transaction: 'RENT' },
  ];
}
const PRICES = { STANDARD: 3, EXACT: 5, PREMIUM: 10, active: true };

export const SWITCHES_ON = { maintenance: false, internal: true, curated: true, unlockedLibrary: true };

export async function boot(t, { port, width = 1440, height = 900, lang = 'en', switches = {}, curatedCount = 640, preUnlocked = 5 } = {}) {
  const BASE = `http://127.0.0.1:${port}`;
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const leads = curatedLeads(curatedCount);
  const state = {
    switches: { ...SWITCHES_ON, ...switches },
    leads,
    unlocked: new Map(leads.slice(0, preUnlocked).map((l) => [l.id, { at: ago(2), credits: 1 }])),
    internal: internalItems(),
    balance: 500,
    catalogCalls: [], quoteCalls: [], unlockCalls: [], internalFeedCalls: [], internalQuoteCalls: [], saveCalls: [],
    unlockResults: new Map(),
  };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const pgError = (message) => json({ code: 'P0001', message, details: null, hint: null }, 400);
  const price = () => ({ credits: 1, cents: 10, active: true });
  const off = (k) => state.switches.maintenance || !state.switches[k];

  function curatedSelection(p) {
    const pub = state.leads.filter((l) => l.status === 'PUBLISHED');
    const sel = p.allMatching
      ? pub.filter((l) => curatedMatches(l, p.filters ?? {}) && !(p.exclude ?? []).includes(l.id))
      : pub.filter((l) => (p.ids ?? []).includes(l.id));
    return sel.map((l) => ({ id: l.id, already: state.unlocked.has(l.id) }));
  }

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
      const p = { id: PROPERTY_ID, title: '3-room apartment, Krtsanisi St 6', homatch_id: 244486, facts: [{ address: 'Krtsanisi St 6', city: 'Tbilisi', district: 'Krtsanisi' }] };
      return r.fulfill(json(wantsObject ? p : [p]));
    }
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };

    if (url.includes('/rpc/matching_workspace_state')) {
      return r.fulfill(json({ ...state.switches, externalDiscovery: false, curatedPrice: price() }));
    }
    if (url.includes('/rpc/curated_leads_catalog')) {
      const p = body().p ?? {};
      state.catalogCalls.push(p);
      const view = String(p.view ?? 'AVAILABLE').toUpperCase();
      if (view === 'AVAILABLE' && off('curated')) return r.fulfill(pgError('SERVICE_DISABLED'));
      const size = [100, 200, 500].includes(Number(p.pageSize)) ? Number(p.pageSize) : 100;
      const pg = Math.max(1, Number(p.page ?? 1));
      const scope = view === 'AVAILABLE' ? state.leads.filter((l) => l.status === 'PUBLISHED' && !state.unlocked.has(l.id)) : state.leads.filter((l) => state.unlocked.has(l.id));
      const hits = scope.filter((l) => curatedMatches(l, p.filters ?? {}));
      const facet = (fn) => scope.reduce((acc, l) => { for (const k of fn(l)) acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
      const items = hits.slice((pg - 1) * size, pg * size).map((l) => (view === 'UNLOCKED'
        ? { ...l, channels: channelsOf(l), unlockedAt: state.unlocked.get(l.id).at, creditsCharged: state.unlocked.get(l.id).credits }
        : { id: l.id, displayName: `${l.firstName} ${l.lastName[0]}.`, country: l.country, languages: l.languages, interests: l.interests, category: l.category,
          city: l.city, region: l.region, preferredLocation: l.preferredLocation, budget: l.budget, propertyType: l.propertyType, investmentPrefs: null,
          description: l.description, addedAt: l.addedAt, lastVerifiedAt: l.lastVerifiedAt, channels: channelsOf(l) }));
      return r.fulfill(json({
        view, page: pg, pageSize: size, total: hits.length,
        counts: { available: state.leads.filter((l) => !state.unlocked.has(l.id)).length, unlocked: state.unlocked.size },
        facets: { countries: facet((l) => [l.country]), languages: facet((l) => (l.languages.length ? l.languages : ['unknown'])), interests: facet((l) => l.interests) },
        price: price(), items,
      }));
    }
    if (url.includes('/rpc/curated_leads_quote')) {
      const p = body().p ?? {};
      state.quoteCalls.push(p);
      if (off('curated')) return r.fulfill(pgError('SERVICE_DISABLED'));
      const sel = curatedSelection(p);
      const fresh = sel.filter((x) => !x.already).length;
      return r.fulfill(json({ selected: sel.length, alreadyUnlocked: sel.length - fresh, newCount: fresh, unitCredits: 1, totalCredits: fresh, active: true, maxPerPurchase: 5000, balance: state.balance }));
    }
    if (url.includes('/rpc/curated_leads_save_to_list') || url.includes('/rpc/internal_leads_save_to_list')) {
      const b = body();
      state.saveCalls.push({ kind: url.includes('curated') ? 'curated' : 'internal', ...b });
      const ids = b.p_lead_ids ?? b.p_match_ids ?? [];
      return r.fulfill(json({ listId: url.includes('curated') ? 'list-curated-saved' : 'list-internal-saved', contacts: ids.length, added: ids.length }));
    }
    if (url.includes('/rpc/internal_leads_feed_v2')) {
      const b = body();
      const p = b.p ?? {};
      state.internalFeedCalls.push(p);
      const filters = (p.filters ?? []).map(String);
      const unlockedView = filters.includes('UNLOCKED');
      if (!unlockedView && off('internal')) return r.fulfill(pgError('SERVICE_DISABLED'));
      const marked = state.internal;
      let rows = marked.filter((x) => (unlockedView ? x.unlocked : !x.unlocked));
      if (filters.includes('VIP')) rows = rows.filter((x) => x.category === 'VIP');
      if (filters.includes('EXACT')) rows = rows.filter((x) => x.category === 'EXACT');
      if ((p.interests ?? []).length) rows = rows.filter((x) => p.interests.includes(x.interest));
      const limit = Number(p.limit ?? 100);
      const offset = Number(p.offset ?? 0);
      const c = (fn) => marked.filter(fn).length;
      return r.fulfill(json({
        total: rows.length,
        counts: { ALL: marked.length, LOCKED: c((x) => !x.unlocked), UNLOCKED: c((x) => x.unlocked), EXACT: c((x) => x.category === 'EXACT'), NEARBY: c((x) => x.category === 'NEARBY_SIMILAR'), VIP: c((x) => x.category === 'VIP'), STRONG: c((x) => x.band === 'STRONG'), POTENTIAL: c((x) => x.band === 'POTENTIAL') },
        facets: { districts: ['Krtsanisi', 'Ortachala'], propertyTypes: ['APARTMENT'], countries: { GE: marked.length }, languages: { unknown: marked.length }, interests: { BUY: 2, RENT: 1 } },
        ids: p.withIds ? rows.map((x) => x.matchId) : null,
        prices: PRICES, preferences: null, lastSeenAt: null,
        items: rows.slice(offset, offset + limit),
      }));
    }
    if (url.includes('/rpc/internal_leads_unlock_quote')) {
      const ids = body().p_match_ids ?? [];
      state.internalQuoteCalls.push(ids);
      const sel = state.internal.filter((x) => ids.includes(x.matchId));
      const fresh = sel.filter((x) => !x.unlocked);
      const n = (k) => fresh.filter((x) => x.priceKey === k).length;
      return r.fulfill(json({ requested: ids.length, eligible: sel.length, alreadyUnlocked: sel.length - fresh.length,
        standardCount: n('STANDARD'), exactCount: n('EXACT'), premiumCount: n('PREMIUM'),
        standardCredits: n('STANDARD') * 3, exactCredits: n('EXACT') * 5, premiumCredits: n('PREMIUM') * 10,
        totalCredits: fresh.reduce((s, x) => s + x.priceCredits, 0), balance: state.balance, prices: PRICES }));
    }
    if (url.includes('/rpc/internal_lead_contact')) {
      const id = body().p_match_id;
      const x = state.internal.find((i) => i.matchId === id);
      return r.fulfill(json(x?.unlocked ? { restricted: false, displayName: x.displayName, canMessage: true, phone: '+995555000111', email: null } : { restricted: true }));
    }
    if (url.includes('/functions/v1/atomic-unlock')) {
      const b = body();
      state.unlockCalls.push(b);
      if (state.unlockResults.has(b.idempotencyKey)) return r.fulfill(json({ ...state.unlockResults.get(b.idempotencyKey), duplicate: true }));
      if (b.kind === 'curated_leads') {
        if (off('curated')) return r.fulfill(json({ error: 'SERVICE_DISABLED' }, 400));
        const sel = curatedSelection(b);
        const fresh = sel.filter((x) => !x.already).map((x) => x.id);
        if (b.expectedCredits != null && fresh.length > Number(b.expectedCredits)) return r.fulfill(json({ error: 'PRICE_CHANGED' }, 400));
        if (fresh.length > state.balance) return r.fulfill(json({ error: 'INSUFFICIENT_CREDITS' }, 402));
        for (const id of fresh) state.unlocked.set(id, { at: new Date().toISOString(), credits: 1 });
        state.balance -= fresh.length;
        const res = { batchId: 'batch-1', unlocked: fresh, unlockedCount: fresh.length, alreadyUnlocked: sel.length - fresh.length, chargedCredits: fresh.length, unitCredits: 1, balanceAfter: state.balance, listId: fresh.length ? 'list-curated-standing' : null, duplicate: false };
        state.unlockResults.set(b.idempotencyKey, res);
        return r.fulfill(json(res));
      }
      let charged = 0;
      const unlocked = [];
      for (const x of state.internal) {
        if ((b.matchIds ?? []).includes(x.matchId) && !x.unlocked) { charged += x.priceCredits; x.unlocked = true; x.displayName = `Member ${x.score}`; unlocked.push(x.matchId); }
      }
      state.balance -= charged;
      const res = { success: true, unlocked, alreadyUnlocked: [], skipped: [], chargedCredits: charged, balanceAfter: state.balance, duplicate: false };
      state.unlockResults.set(b.idempotencyKey, res);
      return r.fulfill(json(res));
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state, BASE };
}

export async function openWorkspace(page, BASE, search = '') {
  await page.goto(`${BASE}/property/${PROPERTY_ID}/matches${search}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="mw-page"]').waitFor({ timeout: 30000 });
}

/** Wait until the list shows rows (or the given count). */
export async function waitRows(page, count = null) {
  await page.waitForFunction((n) => {
    const rows = document.querySelectorAll('[data-testid="mw-row"]').length;
    return n == null ? rows > 0 : rows === n;
  }, count, { timeout: 30000 });
}

export async function noOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `${label}: horizontal overflow ${sw} > ${iw}`);
}

export async function shot(page, dir, name, fullPage = true) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}
