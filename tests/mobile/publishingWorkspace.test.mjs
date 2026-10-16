// PUBLISH TO PORTALS — the standalone workspace (/publishing), in a real browser.
//
// Against the harness build with every backend call stubbed. The publishing-engine
// stub is STATEFUL and runs the real domain (supabase/functions/publishing-engine/
// domain.ts: validation, URL parsing, page-check classification, state machine), so
// what the page shows after a click is what the server would answer.
//
//   * sidebar: Broker → Publish to Portals → Find Property, desktop rail AND mobile drawer,
//     six locales; the TOP BAR carries no publishing control; My Properties' header has none
//   * the property detail page embeds no publishing UI, only a link to /publishing/<id>
//   * the legacy /property/publish redirects to /publishing
//   * journey: empty workspace (eight portals, no Connect) → choose a property → prefilled
//     draft (optional details collapsed, bathrooms not required) → the property's number
//     offered, never copied → WhatsApp by explicit choice → contact footer once →
//     multi-portal selection → MyHome.ge PUBLISHED (live page), SS.ge pending (blocked),
//     Korter.ge OWNER_CONFIRMED by explicit statement with no page fetched → refresh →
//     back/forward → overview counts
//   * admin: Integrations → Property portals, eight cards, a portal's settings saved and
//     audited, test connection answers with the capability it lacks
//   * 320 / 375 / 390 / 430 in ka, en and ar/he: no horizontal overflow; ar/he are RTL

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  classifyCheck, normalizeListing, parseExternalUrl, publicRegistry, transition, validateListing,
} from '../../supabase/functions/publishing-engine/domain.ts';
import { adapterFor, configs, sanitizePatch, profileById } from '../../supabase/functions/publishing-engine/providers.ts';
import { accountView, centralCopy, emptyAccount, registeredStatus, routeFor, sanitizeAccountPatch } from '../../supabase/functions/publishing-engine/central.ts';
import { BROWSER_CAPABILITIES } from '../../supabase/functions/publishing-engine/automation.ts';
import { SERVICE_CONTROLS_RPC, SERVICES_ALL_ON } from './serviceControlsFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4374;
const BASE = `http://127.0.0.1:${PORT}`;
const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const SHOTS = process.env.PUBLISHING_QA_SHOTS || null;

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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 1_800_000 };

/* The six labels, as the bundle spells them (scripts/publishing-workspace-i18n-data.mjs). */
const NAV_LABEL = { en: 'Publish to Portals', ka: 'პორტალებზე გამოქვეყნება', ru: 'Публикация на порталах', tr: 'Portallarda yayınla', ar: 'النشر على البوابات', he: 'פרסום בפורטלים' };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'owner@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const ownerProfile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Nino Owner', plan: 'FREE', account_type: 'OWNER', created_at: new Date().toISOString() };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAHUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const PID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';
const PHOTO = '6f2b8a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const MYHOME_URL = 'https://www.myhome.ge/ka/pr/25805378/iyideba-3-otaxiani-bina';
const SSGE_URL = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-krwanisshi-31234567';
const KORTER_URL = 'https://korter.ge/ka/krtsanisi-residence/4521';

const photoRow = { id: PHOTO, property_id: PID, storage_path: 'users/u1/property-photos/cover.png', is_cover: true, display_order: 0, visibility: 'PRIVATE', created_at: '2026-09-01T00:00:00Z' };
const propertyRow = {
  id: PID, user_id: 'u1', homatch_id: 244486, source_type: 'PRIVATE_LISTING',
  title: 'იყიდება 3 ოთახიანი ბინა კრწანისში', transaction_type: 'SALE', property_type: 'APARTMENT', matching_status: 'ACTIVE',
  cover_photo_url: photoRow.storage_path, contact_phone_e164: '+995555123456', is_deleted: false, archived_at: null,
  created_at: '2026-08-28T15:32:57Z', updated_at: '2026-09-29T13:38:39Z',
  facts: { property_id: PID, city: 'Tbilisi', district: 'Krtsanisi', address: 'Kazbegi Ave 12', total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, bathrooms: 2, floor: 7, total_floors: 12, parking: true, balcony: true, elevator: true, description: 'მზიანი, გარემონტებული ბინა კრწანისში.' },
  photos: [photoRow], search_profile: null, import: [],
};

/* The server, in memory: the real domain and providers, the same response shapes as index.ts. */
function publishingServer() {
  const db = { listing: null, pubs: new Map(), events: [], rows: [], audit: [], fetched: [], accounts: new Map(), accountAudit: [] };
  // HOMATCH has registered its MyHome.ge account; every other portal is still unconfigured.
  db.accounts.set('myhome', { ...emptyAccount('myhome'), status: 'PUBLISHING_RESTRICTED', connection_method: 'MANUAL', account_label: 'listings@homatch.live', contact_phone: '+995322000111' });
  const providers = () => configs(db.rows);
  const provider = (id) => providers().find((c) => c.id === id) ?? null;
  const event = (kind, portal = null, detail = {}) => db.events.unshift({ id: db.events.length + 1, kind, portal_id: portal, from_status: null, to_status: null, detail, created_at: new Date().toISOString() });
  const listingOut = () => db.listing && ({ ...db.listing, validation: validateListing(normalizeListing(db.listing.payload), providers()) });
  const account = (id) => db.accounts.get(id) ?? emptyAccount(id);
  const registry = () => publicRegistry(providers()).map((p) => {
    const r = routeFor(provider(p.id), account(p.id), new Date());
    return { ...p, homatch: { route: r.error ? null : r.route, unavailable: r.error ?? null, contactPhone: account(p.id).status === 'NOT_CONFIGURED' ? null : account(p.id).contact_phone } };
  });
  const detail = () => ({ portals: registry(), listing: listingOut(), publications: [...db.pubs.values()], events: db.events });
  const write = (portal, cmd) => {
    const current = db.pubs.get(portal) ?? null;
    const next = transition(current, cmd, new Date());
    if (next.error) return next.error;
    const row = current ?? { id: `00000000-0000-4000-8000-0000000000${String(db.pubs.size + 10)}`, listing_id: PID, portal_id: portal, revision: -1, channel: 'OWNER_HANDOFF', external_id: null, external_url: null, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null, created_at: new Date().toISOString() };
    db.pubs.set(portal, { ...row, ...next.set, revision: row.revision + 1, updated_at: new Date().toISOString() });
    event(next.kind, portal, next.detail ?? {});
    return null;
  };
  const page = (url) => {
    db.fetched.push(url);
    return url.startsWith('https://www.myhome.ge/') ? { status: 200, body: '<script>{"statement_id":25805378}</script>' } : { status: 403 };
  };
  return {
    db,
    handle(body) {
      const { action } = body;
      if (action === 'workspace') return [200, { portals: registry(), listings: db.listing ? [listingOut()] : [], publications: [...db.pubs.values()] }];
      if (action === 'listing.get') return db.listing ? [200, detail()] : [404, { code: 'LISTING_NOT_FOUND' }];
      if (action === 'listing.save') {
        if ((db.listing?.version ?? 0) !== body.version) return [409, { code: 'VERSION_CONFLICT' }];
        const payload = normalizeListing(body.listing);
        const ready = validateListing(payload, providers()).ready;
        db.listing = { id: PID, version: (db.listing?.version ?? 0) + 1, status: ready ? 'READY' : 'DRAFT', payload, archived_at: null, created_at: db.listing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
        event('LISTING_SAVED');
        return [200, detail()];
      }
      if (action === 'provider.operation') return [409, adapterFor(provider(body.portalId)).run(body.operation)];
      if (action === 'admin.providers') {
        const stats = {};
        for (const p of db.pubs.values()) (stats[p.portal_id] ??= {})[p.status] = ((stats[p.portal_id] ?? {})[p.status] ?? 0) + 1;
        return [200, { providers: providers().map((c) => ({ ...publicRegistry([c])[0], sort: c.sort, evidence: c.evidence, health: c.health, stats: stats[c.id] ?? {}, configured: true })), audit: db.audit, fieldKeys: ['area', 'rooms', 'bedrooms', 'bathrooms', 'photos', 'description.ka'] }];
      }
      if (action === 'admin.publications') return [200, { publications: [...db.pubs.values()].filter((p) => p.portal_id === body.portalId) }];
      if (action === 'admin.provider.update') {
        const clean = sanitizePatch(profileById(body.providerId), body.patch ?? {});
        if (clean.error) return [400, { code: clean.error }];
        const before = db.rows.find((r) => r.id === body.providerId) ?? { id: body.providerId, enabled: true, sort: 0, create_url: null, logo_url: null, verification: null, max_photos: null, description_max: null, required_fields: [] };
        const after = { ...before, ...clean.patch };
        db.rows = [...db.rows.filter((r) => r.id !== body.providerId), after];
        db.audit.unshift({ id: db.audit.length + 1, provider_id: body.providerId, action: 'UPDATE', before, after, created_at: new Date().toISOString() });
        return [200, { ok: true }];
      }
      /* The central engine (index.ts publication.publish and admin.account.* / admin.job.*). */
      if (action === 'publication.publish') {
        if (body.consent !== true) return [400, { code: 'CONTACT_CONSENT_REQUIRED' }];
        const results = [];
        for (const id of body.portalIds ?? []) {
          const r = routeFor(provider(id), account(id), new Date());
          if (r.error) { results.push({ portalId: id, code: r.error }); continue; }
          const err = write(id, { type: 'PUBLISH', listingVersion: db.listing.version, route: r.route, consentAt: new Date().toISOString() });
          results.push(err && err !== 'NO_CHANGE' ? { portalId: id, code: err } : { portalId: id, status: db.pubs.get(id).status });
        }
        return [200, { ...detail(), results }];
      }
      if (action === 'admin.accounts') return [200, { accounts: providers().map((c) => ({ portal: publicRegistry([c])[0], account: accountView(account(c.id), c.id), acceptsCredential: false, browser: BROWSER_CAPABILITIES[c.id], session: null })), audit: db.accountAudit }];
      if (action === 'admin.operations') return [200, { operations: [], artifacts: [] }];
      if (action === 'admin.account.save') {
        const clean = sanitizeAccountPatch(body.account ?? {});
        if (clean.error) return [400, { code: clean.error }];
        const status = registeredStatus(provider(body.portalId), clean.patch);
        db.accounts.set(body.portalId, { ...account(body.portalId), ...clean.patch, status });
        db.accountAudit.unshift({ id: db.accountAudit.length + 1, portal_id: body.portalId, action: 'REGISTER', actor: 'u1', created_at: new Date().toISOString() });
        let rerouted = 0;
        for (const [id, pub] of db.pubs) if (id === body.portalId && pub.channel === 'HOMATCH_ACCOUNT' && !write(id, { type: 'REROUTE', route: routeFor(provider(id), account(id), new Date()).route })) rerouted++;
        return [200, { ok: true, status, rerouted }];
      }
      if (action === 'admin.account.test') {
        const a = account(body.portalId);
        db.accounts.set(body.portalId, { ...a, verification_result: 'CAPABILITY_NOT_SUPPORTED' });
        return [200, { ok: false, result: 'CAPABILITY_NOT_SUPPORTED', status: a.status }];
      }
      const jobOf = (id) => [...db.pubs.values()].find((p) => p.id === id);
      if (action === 'admin.queue') {
        const jobs = [...db.pubs.values()].filter((p) => p.channel === 'HOMATCH_ACCOUNT' && (body.statuses ?? []).includes(p.status));
        const x = normalizeListing(db.listing?.payload ?? {});
        return [200, { jobs: jobs.map((j) => ({ ...j, user_id: 'u1', listing: { title: x.title, city: x.city, dealType: x.dealType, propertyType: x.propertyType, price: x.price, currency: x.currency, version: db.listing.version }, outdated: false })) }];
      }
      if (action === 'admin.job.get') {
        const job = jobOf(body.jobId);
        const x = normalizeListing(db.listing.payload);
        const cfg = provider(job.portal_id);
        return [200, { job, portal: publicRegistry([cfg])[0], account: accountView(account(job.portal_id), job.portal_id), listing: { ...x, version: db.listing.version }, copies: { ka: centralCopy(x, cfg, account(job.portal_id), 'ka') }, photos: [], events: db.events.filter((e) => e.portal_id === job.portal_id) }];
      }
      if (action.startsWith('admin.job.')) {
        const job = jobOf(body.jobId);
        const op = action.slice('admin.job.'.length);
        const cfg = provider(job.portal_id);
        let cmd;
        if (op === 'claim') cmd = { type: 'ADMIN_CLAIM', admin: 'u1' };
        else if (op === 'reject') cmd = { type: 'ADMIN_REJECT', reason: body.reason ?? '', admin: 'u1' };
        else if (op === 'complete') {
          const parsed = parseExternalUrl(cfg, body.externalUrl);
          if (parsed.error) return [400, { code: parsed.error }];
          cmd = { type: 'ADMIN_COMPLETE', url: parsed.url, externalId: parsed.externalId, listingVersion: job.listing_version, verification: cfg.verification, admin: 'u1' };
        } else return [404, { code: 'UNKNOWN_ACTION' }];
        const err = write(job.portal_id, cmd);
        if (err) return [400, { code: err }];
        const now = db.pubs.get(job.portal_id);
        if (op === 'complete' && now.status === 'VERIFYING') write(job.portal_id, { type: 'CHECK', outcome: classifyCheck({ ...page(now.external_url), externalId: now.external_id }) });
        return [200, { ok: true, job: db.pubs.get(job.portal_id) }];
      }
      const portal = provider(body.portalId);
      if (!db.listing || !portal) return [400, { code: 'LISTING_NOT_FOUND' }];
      if (action === 'publication.prepare') {
        const err = write(portal.id, { type: 'PREPARE', listingVersion: db.listing.version });
        return err && err !== 'NO_CHANGE' ? [400, { code: err }] : [200, detail()];
      }
      const check = () => {
        const pub = db.pubs.get(portal.id);
        const outcome = classifyCheck({ ...page(pub.external_url), externalId: pub.external_id });
        return write(portal.id, { type: 'CHECK', outcome });
      };
      if (action === 'publication.link') {
        const parsed = parseExternalUrl(portal, body.externalUrl);
        if (parsed.error) return [400, { code: parsed.error }];
        if (portal.verification === 'OWNER_CONFIRMED') {
          if (body.attest !== true) return [400, { code: 'ATTESTATION_REQUIRED' }];
          const err = write(portal.id, { type: 'LINK', url: parsed.url, externalId: parsed.externalId, listingVersion: db.listing.version, verification: 'OWNER_CONFIRMED' });
          return err ? [400, { code: err }] : [200, detail()];
        }
        const err = write(portal.id, { type: 'LINK', url: parsed.url, externalId: parsed.externalId, listingVersion: db.listing.version });
        if (err) return [400, { code: err }];
        check();
        return [200, detail()];
      }
      if (action === 'publication.unpublish') {
        const pub = db.pubs.get(portal.id);
        const pending = pub?.channel === 'HOMATCH_ACCOUNT' && ['QUEUED', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED'].includes(pub.status);
        const err = write(portal.id, pending ? { type: 'CANCEL' } : { type: 'REQUEST_UNPUBLISH' });
        return err ? [400, { code: err }] : [200, detail()];
      }
      if (action === 'publication.check') {
        if (portal.verification !== 'PAGE_CHECK') return [400, { code: 'CHECK_NOT_AVAILABLE' }];
        const err = check();
        return err ? [err === 'CHECK_TOO_SOON' ? 429 : 400, { code: err, retryAt: db.pubs.get(portal.id)?.next_check_at }] : [200, detail()];
      }
      return [404, { code: 'UNKNOWN_ACTION' }];
    },
  };
}

async function boot(t, { width = 1440, height = 900, lang = 'en', route = '/publishing', server = publishingServer(), profile = ownerProfile } = {}) {
  const { chromium } = resolvePlaywright();
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const calls = [];
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/functions/v1/publishing-engine')) {
      const body = req.postDataJSON();
      calls.push(body.action);
      const [status, out] = server.handle(body);
      return r.fulfill(json(out, status));
    }
    if (url.includes('/functions/v1/storage-sign')) return r.fulfill(json({ url: `${BASE}/managed-photo.png`, expiresIn: 600 }));
    if (url.includes(SERVICE_CONTROLS_RPC)) return r.fulfill(json(SERVICES_ALL_ON));
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    if (url.includes('/rest/v1/property_photos')) return r.fulfill(json(object ? photoRow : [photoRow]));
    if (url.includes('/rest/v1/properties')) return r.fulfill(json(object ? propertyRow : [propertyRow]));
    if (url.includes('/rest/v1/credit_accounts')) return r.fulfill(json(object ? { id: 'c1', user_id: 'u1', balance: 120 } : [{ id: 'c1', user_id: 'u1', balance: 120 }]));
    return r.fulfill(json(object ? null : []));
  });
  await page.route(`${BASE}/managed-photo.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto(`${BASE}${route}`);
  return { page, server, calls };
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const railOrder = (page, scope) => page.evaluate((sel) => {
  const nav = document.querySelector(sel);
  return nav ? [...nav.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : [];
}, scope);

test('navigation: Broker → Publish to Portals → Find Property in rail and drawer; nothing in the top bar', opts, async (t) => {
  for (const lang of LOCALES) {
    for (const width of [1440, 390]) {
      await t.test(`${lang}@${width}`, async (tt) => {
        const { page } = await boot(tt, { route: '/property', lang, width });
        const header = page.locator('header').first();
        await header.waitFor({ timeout: 20000 });
        if (width < 1024) {
          await page.getByRole('button', { name: /./ }).first().waitFor();
          await page.locator('header button[aria-label]').first().click();
        }
        const scope = width < 1024 ? 'aside.max-w-\\[88vw\\] nav' : 'aside nav';
        await page.locator(`${scope} a[href="/publishing"]`).first().waitFor({ timeout: 20000 });
        const hrefs = await railOrder(page, scope);
        const broker = hrefs.indexOf('/brokers');
        const pub = hrefs.indexOf('/publishing');
        const find = hrefs.indexOf('/find-property');
        assert.ok(broker > -1 && pub > -1 && find > -1, `${lang}@${width}: all three present (${hrefs.join(',')})`);
        assert.ok(broker < pub && pub < find, `${lang}@${width}: Broker → Publish → Find Property (${hrefs.join(',')})`);
        assert.equal(hrefs.filter((h) => h === '/publishing').length, 1, 'one publishing destination');
        const label = await page.locator(`${scope} a[href="/publishing"]`).first().innerText();
        assert.equal(label.trim(), NAV_LABEL[lang]);
        /* The top bar and the My Properties header carry no publishing control. */
        assert.equal(await page.locator('header').getByText(NAV_LABEL[lang], { exact: true }).count(), 0, 'no publishing in the top bar');
        assert.equal(await page.locator('main').getByRole('button', { name: NAV_LABEL[lang] }).count(), 0, 'no publishing button on My Properties');
        assert.equal(await page.locator('header a[href="/publishing"], header [href="/property/publish"]').count(), 0);
        await page.locator(`${scope} a[href="/publishing"]`).first().click();
        await page.waitForURL('**/publishing');
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr');
        assert.ok(await noOverflow(page), `${lang}@${width}: no horizontal overflow`);
      });
    }
  }
});

test('property detail embeds no publishing workspace — one contextual link to /publishing/<id>', opts, async (t) => {
  const { page } = await boot(t, { route: `/property/${PID}` });
  const link = page.locator(`main a[href="/publishing/${PID}"]`);
  await link.first().waitFor({ timeout: 20000 });
  assert.equal(await link.count(), 1);
  assert.equal(await page.locator('iframe').count(), 0, 'the old iframe workspace is gone');
  await link.click();
  await page.waitForURL(`**/publishing/${PID}`);
});

test('the legacy /property/publish path lands in the new workspace', opts, async (t) => {
  const { page } = await boot(t, { route: '/property/publish' });
  await page.waitForURL('**/publishing');
  assert.equal(await page.locator('iframe').count(), 0);
});

test('journey: eight portals → prefilled draft → numbers and footer → MyHome PUBLISHED, SS.ge pending, Korter owner-confirmed → refresh → back/forward', opts, async (t) => {
  for (const width of [1440, 390]) {
    await t.test(`@${width}`, async (tt) => {
      const { page, server, calls } = await boot(tt, { width });
      await page.getByText('No listings yet').waitFor({ timeout: 20000 });
      /* The honest capability statement comes first: eight portals, no account
         connection, no automatic publishing; capabilities open on request. */
      await page.getByRole('heading', { name: 'How publishing works' }).waitFor();
      const strip = page.getByTestId('pubw-portal-strip');
      assert.match(await strip.innerText(), /8 portals/);
      await strip.locator('summary').click();
      for (const id of ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']) {
        const text = await page.getByTestId(`pubw-capabilities-${id}`).innerText();
        assert.match(text, /Not offered by/, id);
        assert.match(text, /Not available — you post the listing yourself/, id);
        assert.match(text, id === 'korter' || id === 'binebi' ? /You confirm it — .* does not allow automated checks/ : /HOMATCH checks the public listing page/, id);
      }
      assert.equal(await page.getByRole('button', { name: /^connect/i }).count(), 0, 'no fake Connect button');
      await page.getByRole('link', { name: 'Publish a property' }).first().click();
      await page.waitForURL('**/publishing/new');
      await page.getByRole('link', { name: /იყიდება 3 ოთახიანი/ }).click();
      await page.waitForURL(`**/publishing/${PID}`);
      /* Prefilled from the property: nothing retyped. Optional details are collapsed. */
      const title = page.getByLabel(/^Listing title/);
      await title.waitFor({ timeout: 20000 });
      assert.equal(await title.inputValue(), propertyRow.title);
      assert.equal(await page.getByLabel(/^Price/).first().inputValue(), '213840');
      const optional = page.getByTestId('pubw-optional');
      assert.equal(await optional.getAttribute('open'), null, 'optional details start collapsed');
      await optional.locator('summary').click();
      assert.equal(await page.getByLabel('Street', { exact: true }).inputValue(), 'Kazbegi Ave 12');
      assert.equal(await page.getByLabel('Bathrooms', { exact: true }).inputValue(), '2');
      assert.equal(await page.getByLabel('Bathrooms', { exact: true }).getAttribute('aria-required'), 'false', 'bathrooms are optional');
      /* Four steps: create → choose portals → preview → publish; nothing is done before a save. */
      const steps = page.getByRole('navigation', { name: 'Publishing steps' });
      assert.equal(await steps.locator('li').count(), 4);
      assert.equal(await steps.locator('[data-state="done"]').count(), 0);
      assert.ok((await steps.locator('[aria-current="step"]').innerText()).includes('Create'));
      assert.ok(await noOverflow(page), `editor @${width}`);
      await shot(page, `editor-${width}`);
      /* The property's number is OFFERED, never copied in: saving now is a draft. */
      assert.equal(await page.getByTestId('pubw-contact-0').count(), 0);
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByText('Draft saved').first().waitFor();
      assert.equal(server.db.listing.status, 'DRAFT');
      assert.deepEqual(server.db.listing.payload.contacts, []);
      await page.getByTestId('pubw-contact-use-property').click();
      const contact = page.getByTestId('pubw-contact-0');
      assert.equal(await contact.getByRole('button', { name: 'Call' }).getAttribute('aria-pressed'), 'true', 'call is on for a valid number');
      assert.equal(await contact.getByRole('button', { name: 'WhatsApp' }).getAttribute('aria-pressed'), 'false', 'WhatsApp is never assumed');
      assert.equal(await contact.getByRole('button', { name: 'Viber' }).getAttribute('aria-pressed'), 'false');
      await contact.getByRole('button', { name: 'WhatsApp' }).click();
      assert.equal(await page.getByTestId('pubw-contact-links-0').locator('a[href="https://wa.me/995555123456"]').count(), 1);
      assert.equal(await page.getByTestId('pubw-contact-links-0').locator('a[href="tel:+995555123456"]').count(), 1);
      /* A second number, typed the Georgian way, normalised on blur. */
      await page.getByTestId('pubw-contact-add').click();
      const second = page.getByTestId('pubw-contact-1').getByRole('textbox');
      await second.fill('599 12 34 56');
      await second.blur();
      await page.getByTestId('pubw-contact-1').getByRole('button', { name: 'Viber' }).click();
      const footer = await page.getByTestId('pubw-footer-preview').innerText();
      assert.match(footer, /დაგვიკავშირდით მხოლოდ მითითებულ ნომრებზე:/);
      assert.match(footer, /📞 \+995 555 12 34 56\n📱 WhatsApp\n📞 \+995 599 12 34 56\n📱 Viber/);
      /* Several portals at once. */
      for (const id of ['myhome', 'ssge', 'korter']) await page.getByTestId(`pubw-pick-${id}`).click();
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByText('Saved — ready to publish').first().waitFor();
      assert.equal(server.db.listing.status, 'READY');
      assert.deepEqual(server.db.listing.payload.contacts, [{ phone: '+995555123456', whatsapp: true, viber: false }, { phone: '+995599123456', whatsapp: false, viber: true }]);
      assert.deepEqual(server.db.listing.payload.portalTargets, ['myhome', 'ssge', 'korter']);
      assert.equal(server.db.listing.payload.description.ka.includes('დაგვიკავშირდით'), false, 'the footer is never stored in the description');
      /* Preview: the description carries the footer exactly once; contact links are real. */
      await page.getByRole('tab', { name: 'Preview' }).click();
      const desc = await page.getByTestId('pubw-preview-description').innerText();
      assert.equal((desc.match(/დაგვიკავშირდით/g) ?? []).length, 1);
      assert.equal(await page.getByTestId('pubw-preview-contacts').locator('a[href^="viber://chat?number=%2B995599123456"]').count(), 1);
      assert.ok(await noOverflow(page), `preview @${width}`);
      await shot(page, `preview-${width}`);
      /* Portals: ONE action — Publish to Selected Portals, through HOMATCH's accounts. */
      await page.getByRole('tab', { name: 'Portals' }).click();
      const panel = page.getByTestId('pubw-publish');
      await panel.waitFor();
      /* The two identities, shown before anything is sent: HOMATCH's number in the
         portal's contact field, the owner's name and number once at the end. */
      assert.equal(await page.getByTestId('pubw-publish-homatch-phone').innerText(), '+995 322 00 01 11');
      const central = await page.getByTestId('pubw-publish-description').innerText();
      assert.equal((central.match(/ქონების მფლობელი: Nino Owner/g) ?? []).length, 1, 'the owner is named exactly once');
      assert.equal((central.match(/ტელეფონი: \+995 555 12 34 56/g) ?? []).length, 1, 'the owner phone appears exactly once');
      assert.ok(central.trim().endsWith('განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.'), 'the footer is at the end');
      assert.equal(central.includes('+995 322 00 01 11'), false, 'the HOMATCH number is not in the owner footer');
      assert.equal(central.includes('დაგვიკავშირდით'), false, 'no second footer');
      /* Korter.ge is left for the owner's own handoff below; consent gates the button. */
      await page.getByTestId('pubw-pick-korter').click();
      const publishBtn = page.getByTestId('pubw-publish-button');
      assert.equal(await publishBtn.innerText(), 'Publish to Selected Portals');
      assert.equal(await publishBtn.isDisabled(), true, 'no consent, no publish');
      await page.getByTestId('pubw-publish-consent').check();
      await publishBtn.click();
      await page.getByTestId('pubw-status-myhome').waitFor({ timeout: 20000 });
      assert.match(await page.getByTestId('pubw-status-myhome').innerText(), /Pending HOMATCH action/);
      assert.match(await page.getByTestId('pubw-status-ssge').innerText(), /Authentication required/);
      for (const id of ['myhome', 'ssge']) {
        const pub = server.db.pubs.get(id);
        assert.equal(pub.channel, 'HOMATCH_ACCOUNT');
        assert.ok(pub.contact_consent_at);
        assert.equal(pub.published_at, null, `${id}: nothing claims publication before the portal confirms it`);
      }
      assert.equal(server.db.pubs.has('korter'), false);
      assert.equal(await steps.locator('[data-state="done"]').count(), 4, 'all four steps done once the request is in');
      /* HOMATCH's specialist posts MyHome.ge and links it; the public page check confirms it. */
      const myhomeJob = server.db.pubs.get('myhome').id;
      server.handle({ action: 'admin.job.claim', jobId: myhomeJob });
      server.handle({ action: 'admin.job.complete', jobId: myhomeJob, externalUrl: MYHOME_URL });
      assert.equal(server.db.pubs.get('myhome').status, 'PUBLISHED');
      await page.reload();
      await page.getByTestId('pubw-status-myhome').getByText('Published').waitFor({ timeout: 20000 });
      assert.equal(await page.getByTestId('pubw-status-myhome').getByRole('link', { name: 'Open on portal' }).getAttribute('href'), 'https://www.myhome.ge/ka/pr/25805378/iyideba-3-otaxiani-bina');
      /* The owner's own handoff still works for a portal HOMATCH is not handling. */
      const own = page.getByTestId('pubw-own-handoff');
      if ((await own.getAttribute('open')) === null) await own.locator(':scope > summary').click();
      const korter = page.locator('#pubw-portal-korter');
      await korter.getByRole('button', { name: 'Prepare for Korter.ge' }).click();
      await korter.getByLabel('Publication URL').fill('https://evil.example/ka/x/4521');
      await page.getByTestId('pubw-attest-korter').check();
      await korter.getByRole('button', { name: 'Confirm' }).click();
      await page.getByText('This link is not on this portal’s website.').first().waitFor();
      await korter.getByLabel('Publication URL').fill(KORTER_URL);
      assert.equal(await korter.getByRole('button', { name: 'Confirm' }).isDisabled(), false);
      await korter.getByRole('button', { name: 'Confirm' }).click();
      await korter.getByText('Published · confirmed by you').first().waitFor({ timeout: 20000 });
      assert.equal(server.db.pubs.get('korter').status, 'OWNER_CONFIRMED');
      assert.equal(server.db.fetched.some((u) => u.includes('korter.ge')), false, 'HOMATCH never fetched a Korter page');
      assert.equal(await korter.getByRole('button', { name: /Check now|Sync/ }).count(), 0, 'no check button where checks are not allowed');
      assert.ok(await noOverflow(page), `portals @${width}`);
      await shot(page, `portals-${width}`);
      /* Refresh: the state comes back from the server, on the same tab. */
      await page.reload();
      await page.getByTestId('pubw-status-myhome').getByText('Published').waitFor({ timeout: 20000 });
      assert.match(page.url(), /tab=portals/);
      /* Back / forward move between tabs. */
      await page.goBack();
      await page.waitForURL(/tab=preview/);
      await page.goForward();
      await page.waitForURL(/tab=portals/);
      /* The workspace overview counts what the server holds. */
      await page.goto(`${BASE}/publishing`);
      await page.locator(`main a[href="/publishing/${PID}"]`).first().waitFor({ timeout: 20000 });
      const kpi = async (label) => Number((await page.getByRole('button', { name: new RegExp(label) }).first().innerText()).match(/\d+/)[0]);
      assert.equal(await kpi('Active publications'), 2, 'MyHome verified + Korter confirmed');
      assert.equal(await kpi('Awaiting publication'), 1, 'SS.ge waits for the HOMATCH account');
      await shot(page, `workspace-${width}`);
      assert.ok(calls.includes('publication.publish') && calls.includes('publication.link'));
    });
  }
});

test('admin: Integrations → Property portals — eight portals, HOMATCH accounts, settings saved and audited, honest test connection', opts, async (t) => {
  for (const width of [1440, 390]) {
    await t.test(`@${width}`, async (tt) => {
      const { page, server } = await boot(tt, { width, route: '/admin/integrations/portals', profile: { ...ownerProfile, is_admin: true } });
      await page.getByTestId('admin-portals').waitFor({ timeout: 20000 });
      for (const id of ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']) await page.getByTestId(`admin-portal-${id}`).waitFor();
      assert.match(await page.getByTestId('admin-portals').innerText(), /No portal offers one/);
      assert.equal(await page.getByRole('button', { name: /^connect/i }).count(), 0);
      assert.ok(await noOverflow(page), `admin overview @${width}`);
      await shot(page, `admin-portals-${width}`);
      /* Korter: automated checks are locked off by its terms. */
      await page.getByTestId('admin-portal-korter').click();
      await page.getByTestId('admin-portal-page-korter').waitFor({ timeout: 20000 });
      assert.equal(await page.getByLabel('How publication is confirmed').isDisabled(), true);
      assert.match(await page.getByTestId('admin-portal-automation').innerText(), /Manual administrator action required/);
      /* The HOMATCH account: registered with identity and phone — never a password —
         and never "Connected" without a real verification. */
      const acct = page.getByTestId('admin-account');
      assert.equal(await acct.getByTestId('admin-account-status').getAttribute('data-status'), 'NOT_CONFIGURED');
      assert.equal(await acct.locator('input[type="password"]').count(), 0, 'no password field');
      await acct.getByTestId('admin-account-label').fill('listings@homatch.live');
      await acct.getByTestId('admin-account-phone').fill('+995 322 00 01 11');
      await acct.getByTestId('admin-account-save').click();
      await page.getByText('Korter.ge account saved.').first().waitFor();
      await acct.locator('[data-testid="admin-account-status"][data-status="PUBLISHING_RESTRICTED"]').waitFor();
      await acct.getByTestId('admin-account-test').click();
      await acct.getByTestId('admin-account-test-result').getByText('Not available: this portal offers no authorised connection or API.').waitFor();
      assert.equal(await acct.getByTestId('admin-account-status').getAttribute('data-status'), 'PUBLISHING_RESTRICTED', 'a test without a verified mechanism never connects');
      assert.equal(server.db.accounts.get('korter').verified_at, null);
      /* Korter has no recorded browser workflow: no automation controls at all. */
      await page.getByTestId('admin-automation-none').waitFor();
      /* MyHome: what the worker can do, how it was verified, and the owner's switches (off). */
      await page.goto(`${BASE}/admin/integrations/portals/myhome`);
      const auto = page.getByTestId('admin-automation');
      await auto.waitFor({ timeout: 20000 });
      assert.match(await auto.getByTestId('admin-auto-level-CREATE').innerText(), /Tested on recorded pages only/);
      assert.match(await auto.getByTestId('admin-auto-level-PRICE').innerText(), /Not explored/);
      assert.match(await auto.getByTestId('admin-auto-session').innerText(), /none captured/);
      assert.match(await auto.getByTestId('admin-auto-session').innerText(), /capture-session\.mjs myhome/);
      assert.equal(await auto.getByTestId('admin-auto-enabled').getAttribute('aria-checked'), 'false');
      assert.equal(await auto.getByTestId('admin-auto-live').isDisabled(), true, 'live publishing cannot be approved while automation is off');
      /* Place.ge: require bathrooms, save — validated, applied, audited. */
      await page.goto(`${BASE}/admin/integrations/portals/placege`);
      await page.getByTestId('admin-portal-page-placege').waitFor({ timeout: 20000 });
      await page.getByTestId('admin-field-bathrooms').click();
      await page.getByTestId('admin-portal-create-url').fill('https://evil.example/add');
      await page.getByTestId('admin-portal-save').click();
      await page.getByText('The link must be https and on the portal’s own domain.').first().waitFor();
      assert.equal(server.db.audit.length, 0, 'a refused change writes nothing');
      await page.getByTestId('admin-portal-create-url').fill('https://place.ge/ge/ads/add');
      await page.getByTestId('admin-portal-save').click();
      await page.getByText('Settings saved').first().waitFor();
      assert.deepEqual(server.db.rows.find((r) => r.id === 'placege').required_fields, ['bathrooms']);
      assert.equal(server.db.audit.length, 1);
      assert.ok(await noOverflow(page), `admin portal @${width}`);
      await shot(page, `admin-portal-${width}`);
      /* What an owner now sees: Place.ge names bathrooms as required. */
      const owner = server.db;
      assert.equal(validateListing(normalizeListing({ title: 't' }), configs(owner.rows)).portals.placege.some((p) => p.field === 'bathrooms'), true);
    });
  }
});

test('admin: Publishing queue — the portal-ready copy, claim, link; published only after the page check', opts, async (t) => {
  for (const width of [1440, 390]) {
    await t.test(`@${width}`, async (tt) => {
      const server = publishingServer();
      server.handle({ action: 'listing.save', version: 0, listing: { title: 'ბინა კრწანისში', description: { ka: 'მზიანი ბინა.' }, propertyType: 'APARTMENT', dealType: 'SALE', price: 213840, city: 'Tbilisi', contactName: 'Nino Owner', contacts: [{ phone: '+995555123456' }], portalTargets: ['myhome'] } });
      server.handle({ action: 'publication.publish', portalIds: ['myhome'], consent: true });
      assert.equal(server.db.pubs.get('myhome').status, 'ADMIN_ACTION_REQUIRED');
      const { page } = await boot(tt, { width, server, route: '/admin/integrations/publishing', profile: { ...ownerProfile, is_admin: true } });
      await page.getByTestId('admin-publishing-queue').waitFor({ timeout: 20000 });
      const job = server.db.pubs.get('myhome').id;
      await page.getByTestId(`queue-job-${job}`).click();
      const d = page.getByTestId('queue-job-detail');
      await d.waitFor();
      assert.equal(await d.getByTestId('queue-contact-phone').innerText(), '+995 322 00 01 11', 'the HOMATCH number goes in the portal contact field');
      const copy = await d.getByTestId('queue-copy-ka').innerText();
      assert.equal((copy.match(/ქონების მფლობელი: Nino Owner/g) ?? []).length, 1);
      assert.ok(copy.trim().endsWith('განცხადება გამოქვეყნებულია HOMATCH-ის მეშვეობით.'));
      await d.getByTestId('queue-claim').click();
      await page.getByText('Started.').first().waitFor();
      assert.equal(server.db.pubs.get('myhome').status, 'PUBLISHING');
      await d.getByTestId('queue-url').fill(MYHOME_URL);
      await d.getByTestId('queue-complete').click();
      await page.getByText(/Linked\. It shows as published once the portal page confirms it\./).first().waitFor();
      assert.equal(server.db.pubs.get('myhome').status, 'PUBLISHED', 'the stub portal page carries the listing id');
      assert.ok(server.db.fetched.includes(MYHOME_URL), 'confirmed by fetching the public page');
      assert.ok(await noOverflow(page), `queue @${width}`);
      await shot(page, `admin-queue-${width}`);
    });
  }
});

test('phone widths 320/375/390/430: every publishing screen fits, ar/he right-to-left', opts, async (t) => {
  for (const lang of ['ka', 'en', 'ar', 'he']) {
    for (const width of [320, 375, 390, 430]) {
      await t.test(`${lang}@${width}`, async (tt) => {
        const server = publishingServer();
        server.handle({ action: 'listing.save', version: 0, listing: { ...normalizeListing({ title: propertyRow.title, description: { ka: 'ბინა' }, propertyType: 'APARTMENT', dealType: 'SALE', price: 1, area: 1, city: 'Tbilisi', street: 'Kazbegi', contactName: 'N', contacts: [{ phone: '+995555123456', whatsapp: true, viber: true }], photos: [PHOTO], portalTargets: ['myhome', 'ssge', 'korter'] }) } });
        const { page } = await boot(tt, { lang, width, height: 800, server, profile: { ...ownerProfile, is_admin: true } });
        for (const route of ['/publishing', '/publishing/new', `/publishing/${PID}?tab=listing`, `/publishing/${PID}?tab=preview`, `/publishing/${PID}?tab=portals`, ...(lang === 'en' || lang === 'he' ? ['/admin/integrations/portals', '/admin/integrations/portals/myhome', '/admin/integrations/publishing'] : [])]) {
          await page.goto(`${BASE}${route}`);
          await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
          await page.waitForTimeout(150);
          assert.ok(await noOverflow(page), `${lang}@${width} ${route}: no horizontal overflow`);
        }
        assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr');
      });
    }
  }
});
