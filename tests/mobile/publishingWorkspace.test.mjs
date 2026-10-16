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
//   * journey: empty workspace → choose a property → prefilled draft → save → preview →
//     prepare MyHome.ge → paste URL → PUBLISHED (live page) while SS.ge stays pending
//     (portal blocked the check) → refresh keeps it → back/forward between tabs
//   * 320 / 375 / 390 / 430 in ka, en and ar/he: no horizontal overflow; ar/he are RTL

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  classifyCheck, normalizeListing, parseExternalUrl, portalById, publicRegistry, transition, validateListing,
} from '../../supabase/functions/publishing-engine/domain.ts';

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
const profile = { id: 'u1', auth_id: 'u1', email: 'owner@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Nino Owner', plan: 'FREE', account_type: 'OWNER', created_at: new Date().toISOString() };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAHUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const PID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';
const PHOTO = '6f2b8a1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const MYHOME_URL = 'https://www.myhome.ge/ka/pr/25805378/iyideba-3-otaxiani-bina';
const SSGE_URL = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-krwanisshi-31234567';

const photoRow = { id: PHOTO, property_id: PID, storage_path: 'users/u1/property-photos/cover.png', is_cover: true, display_order: 0, visibility: 'PRIVATE', created_at: '2026-09-01T00:00:00Z' };
const propertyRow = {
  id: PID, user_id: 'u1', homatch_id: 244486, source_type: 'PRIVATE_LISTING',
  title: 'იყიდება 3 ოთახიანი ბინა კრწანისში', transaction_type: 'SALE', property_type: 'APARTMENT', matching_status: 'ACTIVE',
  cover_photo_url: photoRow.storage_path, contact_phone_e164: '+995555123456', is_deleted: false, archived_at: null,
  created_at: '2026-08-28T15:32:57Z', updated_at: '2026-09-29T13:38:39Z',
  facts: { property_id: PID, city: 'Tbilisi', district: 'Krtsanisi', address: 'Kazbegi Ave 12', total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, bathrooms: 2, floor: 7, total_floors: 12, parking: true, balcony: true, elevator: true, description: 'მზიანი, გარემონტებული ბინა კრწანისში.' },
  photos: [photoRow], search_profile: null, import: [],
};

/* The server, in memory: the real domain, the same response shapes as index.ts. */
function publishingServer() {
  const db = { listing: null, pubs: new Map(), events: [] };
  const event = (kind, portal = null, detail = {}) => db.events.unshift({ id: db.events.length + 1, kind, portal_id: portal, from_status: null, to_status: null, detail, created_at: new Date().toISOString() });
  const listingOut = () => db.listing && ({ ...db.listing, validation: validateListing(normalizeListing(db.listing.payload)) });
  const detail = () => ({ listing: listingOut(), publications: [...db.pubs.values()], events: db.events });
  const write = (portal, cmd) => {
    const current = db.pubs.get(portal) ?? null;
    const next = transition(current, cmd, new Date());
    if (next.error) return next.error;
    const row = current ?? { id: `pub-${portal}`, listing_id: PID, portal_id: portal, revision: -1, external_id: null, external_url: null, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null, created_at: new Date().toISOString() };
    db.pubs.set(portal, { ...row, ...next.set, revision: row.revision + 1, updated_at: new Date().toISOString() });
    event(next.kind, portal, next.detail ?? {});
    return null;
  };
  const page = (url) => (url.startsWith('https://www.myhome.ge/') ? { status: 200, body: '<script>{"statement_id":25805378}</script>' } : { status: 403 });
  return {
    db,
    handle(body) {
      const { action } = body;
      if (action === 'workspace') return [200, { portals: publicRegistry(), listings: db.listing ? [listingOut()] : [], publications: [...db.pubs.values()] }];
      if (action === 'listing.get') return db.listing ? [200, detail()] : [404, { code: 'LISTING_NOT_FOUND' }];
      if (action === 'listing.save') {
        if ((db.listing?.version ?? 0) !== body.version) return [409, { code: 'VERSION_CONFLICT' }];
        const payload = normalizeListing(body.listing);
        const ready = validateListing(payload).ready;
        db.listing = { id: PID, version: (db.listing?.version ?? 0) + 1, status: ready ? 'READY' : 'DRAFT', payload, archived_at: null, created_at: db.listing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
        event('LISTING_SAVED');
        return [200, detail()];
      }
      const portal = portalById(body.portalId);
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
        const parsed = parseExternalUrl(portal.id, body.externalUrl);
        if (parsed.error) return [400, { code: parsed.error }];
        const err = write(portal.id, { type: 'LINK', url: parsed.url, externalId: parsed.externalId, listingVersion: db.listing.version });
        if (err) return [400, { code: err }];
        check();
        return [200, detail()];
      }
      if (action === 'publication.check') {
        const err = check();
        return err ? [err === 'CHECK_TOO_SOON' ? 429 : 400, { code: err, retryAt: db.pubs.get(portal.id)?.next_check_at }] : [200, detail()];
      }
      return [404, { code: 'UNKNOWN_ACTION' }];
    },
  };
}

async function boot(t, { width = 1440, height = 900, lang = 'en', route = '/publishing', server = publishingServer() } = {}) {
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

test('journey: choose → prefilled draft → save → preview → MyHome PUBLISHED, SS.ge pending → refresh → back/forward', opts, async (t) => {
  for (const width of [1440, 390]) {
    await t.test(`@${width}`, async (tt) => {
      const { page, server, calls } = await boot(tt, { width });
      await page.getByText('No listings yet').waitFor({ timeout: 20000 });
      await page.getByRole('link', { name: 'Publish a property' }).first().click();
      await page.waitForURL('**/publishing/new');
      await page.getByRole('link', { name: /იყიდება 3 ოთახიანი/ }).click();
      await page.waitForURL(`**/publishing/${PID}`);
      /* Prefilled from the property: nothing retyped. */
      const title = page.getByLabel('Listing title');
      await title.waitFor({ timeout: 20000 });
      assert.equal(await title.inputValue(), propertyRow.title);
      assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '213840');
      assert.equal(await page.getByLabel('Street').inputValue(), 'Kazbegi Ave 12');
      assert.ok(await noOverflow(page), `editor @${width}`);
      await shot(page, `editor-${width}`);
      /* A missing required field blocks readiness but not a draft save. */
      await page.getByLabel('Contact name').fill('');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByText('Draft saved').first().waitFor();
      assert.equal(server.db.listing.status, 'DRAFT');
      await page.getByLabel('Contact name').fill('Nino');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByText('Saved — ready to publish').first().waitFor();
      assert.equal(server.db.listing.status, 'READY');
      assert.equal(server.db.listing.version, 2);
      /* Preview. */
      await page.getByRole('tab', { name: 'Preview' }).click();
      await page.getByText('Preview of the portal-ready listing', { exact: false }).waitFor();
      assert.ok(await noOverflow(page), `preview @${width}`);
      await shot(page, `preview-${width}`);
      /* Portals: prepare MyHome, link, verified. */
      await page.getByRole('tab', { name: 'Portals' }).click();
      await page.getByRole('button', { name: 'Prepare for MyHome.ge' }).click();
      await page.getByRole('link', { name: 'Open MyHome.ge' }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Open MyHome.ge' }).getAttribute('target'), '_blank');
      await page.getByLabel('Publication URL').first().fill('https://evil.example/pr/25805378');
      await page.getByRole('button', { name: 'Verify' }).first().click();
      await page.getByText('This link is not on this portal’s website.').first().waitFor();
      await page.getByLabel('Publication URL').first().fill(MYHOME_URL);
      await page.getByRole('button', { name: 'Verify' }).first().click();
      await page.getByText('Published · verified').first().waitFor({ timeout: 20000 });
      assert.equal(server.db.pubs.get('myhome').status, 'PUBLISHED');
      /* SS.ge: the portal blocks the automated check → pending, never PUBLISHED. */
      await page.getByRole('button', { name: 'Prepare for SS.ge' }).click();
      await page.getByLabel('Publication URL').last().fill(SSGE_URL);
      await page.getByRole('button', { name: 'Verify' }).last().click();
      await page.getByText('Checking publication').first().waitFor({ timeout: 20000 });
      assert.equal(server.db.pubs.get('ssge').status, 'VERIFYING');
      assert.equal(server.db.pubs.get('myhome').status, 'PUBLISHED', 'partial success keeps the successful portal');
      await page.getByText('The portal blocked the automatic check', { exact: false }).first().waitFor();
      assert.ok(await noOverflow(page), `portals @${width}`);
      await shot(page, `portals-${width}`);
      /* Refresh: the state comes back from the server, on the same tab. */
      await page.reload();
      await page.getByText('Published · verified').first().waitFor({ timeout: 20000 });
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
      assert.equal(await kpi('Active publications'), 1);
      assert.equal(await kpi('Pending'), 1);
      await shot(page, `workspace-${width}`);
      assert.ok(calls.includes('publication.link'));
    });
  }
});

test('phone widths 320/375/390/430: every publishing screen fits, ar/he right-to-left', opts, async (t) => {
  for (const lang of ['ka', 'en', 'ar', 'he']) {
    for (const width of [320, 375, 390, 430]) {
      await t.test(`${lang}@${width}`, async (tt) => {
        const server = publishingServer();
        server.handle({ action: 'listing.save', version: 0, listing: { ...normalizeListing({ title: propertyRow.title, description: { ka: 'ბინა' }, propertyType: 'APARTMENT', dealType: 'SALE', price: 1, area: 1, city: 'Tbilisi', street: 'Kazbegi', contactName: 'N', contactPhone: '+995555123456', photos: [PHOTO], portalTargets: ['myhome', 'ssge'] }) } });
        const { page } = await boot(tt, { lang, width, height: 800, server });
        for (const route of ['/publishing', '/publishing/new', `/publishing/${PID}?tab=listing`, `/publishing/${PID}?tab=preview`, `/publishing/${PID}?tab=portals`]) {
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
