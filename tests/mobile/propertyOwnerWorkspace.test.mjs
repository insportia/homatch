// THE SELLER-SIDE PROPERTY OWNER WORKSPACE, in a real browser.
//
// Against the harness build with every backend call stubbed: the property, its
// photos, its matches, the server's lifecycle answer (my_property_lifecycle) and the
// free renewal (renew_property). The portal image host is stubbed too — it answers a
// real PNG ("working photo") or 403 ("the photo disappeared"), which is exactly what
// production sees when tnet.ge stops serving a hotlinked listing image.
//
//   * broken imported photo → explained, with the exact listing and "update in HOMATCH"
//   * working imported photo → shown, no fallback
//   * day 24 → "მალე განაახლე" + free renewal; double click renews once
//   * expired → discovery paused (no start), renewal restores it on the same property
//   * the Property Detail workspace at 1440/1280/1024/768/430/390/360: no horizontal
//     overflow, quick actions as a grid, discovery full-width, no dead column
//   * My Property cards: normal photo, broken photo fallback, freshness chip
//   * six locales; ar/he render right-to-left

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4362;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PROPERTY_OWNER_QA_SHOTS || null;
const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const WIDTHS = [1440, 1280, 1024, 768, 430, 390, 360];

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

/* A tiny real PNG, so a "working" external photo genuinely decodes. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAHUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const IMG = 'https://static-statements.tnet.ge/uploads/202608/20260819/statements/XXB2rD26a8603155deb3.webp';
const LISTING = 'https://www.myhome.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-krwanisshi-25805378/';
const PID = 'c5c1a6a4-6fed-4764-91c2-3cd7ad090407';

function propertyRow({ imported = true, photo = 'external', state = 'ACTIVE' } = {}) {
  return {
    id: PID, user_id: 'u1', homatch_id: 244486,
    source_type: imported ? 'URL_IMPORT' : 'PRIVATE_LISTING',
    title: 'იყიდება 3 ოთახიანი ბინა კრწანისში',
    transaction_type: 'SALE', property_type: 'APARTMENT',
    matching_status: state === 'EXPIRED' ? 'PAUSED' : 'ACTIVE',
    cover_photo_url: photo === 'external' ? IMG : photo === 'managed' ? 'users/u1/property-photos/cover.png' : null,
    contact_phone_e164: '+995555123456', contact_phone_raw: '555 12 34 56', contact_phone_country: 'GE',
    is_deleted: false, archived_at: null, created_at: '2026-08-28T15:32:57Z', updated_at: '2026-09-29T13:38:39Z',
    facts: {
      property_id: PID, city: 'Tbilisi', district: 'Krtsanisi', total_price: 213840, currency: 'USD', price_per_sqm: 2200,
      area: 97.2, rooms: 3, bedrooms: 2, bathrooms: 2, floor: 7, total_floors: 12, parking: true, balcony: true, elevator: true,
      description: 'მზიანი, გარემონტებული ბინა კრწანისში, ახალ აშენებულ კორპუსში.',
      source_url: imported ? LISTING : null, source_domain: imported ? 'www.myhome.ge' : null,
      source_listing_id: imported ? '25805378' : null, cover_image: imported ? IMG : null, gallery_images: imported ? [IMG] : null,
    },
    photos: photo === 'managed' ? [{ id: 'p1', storage_path: 'users/u1/property-photos/cover.png', is_cover: true, display_order: 0 }] : [],
    search_profile: null, import: [],
  };
}

function lifecycle(state, { imported = true, source = 'UNKNOWN' } = {}) {
  const day = 86_400_000;
  const age = state === 'ACTIVE' ? 3 : state === 'EXPIRING_SOON' ? 24 : 34;
  const anchor = Date.now() - age * day;
  return {
    property_id: PID, freshness_state: state, anchor_at: new Date(anchor).toISOString(),
    expires_at: new Date(anchor + 30 * day).toISOString(), days_left: Math.max(0, 30 - age),
    owner_confirmed_at: null, archived: false, matching_paused_by_freshness: state === 'EXPIRED',
    discovery_eligible: state !== 'EXPIRED', source_status: imported ? source : null, source_checked_at: null,
    imported_at: imported ? '2026-08-28T15:32:57Z' : null, server_now: new Date().toISOString(),
  };
}

async function boot(t, { width = 1440, height = 900, lang = 'en', imported = true, photo = 'external', imageWorks = false, state = 'ACTIVE', source = 'UNKNOWN', route = `/property/${PID}` } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const st = { state, renews: 0, lifecycleReads: 0, starts: 0 };
  const matches = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, status: i < 5 ? 'NEW' : 'VIEWED', signal_strength: i < 3 ? 'STRONG' : 'POTENTIAL', demand_published_at: new Date().toISOString() }));
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.startsWith('https://static-statements.tnet.ge/')) {
      return imageWorks ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' });
    }
    if (url.includes('/functions/v1/storage-sign')) return r.fulfill(json({ url: `${BASE}/managed-photo.png`, expiresIn: 600 }));
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    if (url.includes('/rest/v1/rpc/my_property_lifecycle')) { st.lifecycleReads += 1; return r.fulfill(json([lifecycle(st.state, { imported, source })])); }
    if (url.includes('/rest/v1/rpc/renew_property')) {
      st.renews += 1;
      const already = st.state === 'ACTIVE';
      st.state = 'ACTIVE';
      return r.fulfill(json(already ? { ok: true, renewed: false, reason: 'ALREADY_RENEWED' } : { ok: true, renewed: true, freshness_state: 'ACTIVE', matching_resumed: state === 'EXPIRED' }));
    }
    if (url.includes('/rest/v1/properties')) {
      const row = { ...propertyRow({ imported, photo, state: st.state }) };
      return r.fulfill(json(object ? row : [row]));
    }
    if (url.includes('/rest/v1/matches')) return r.fulfill(json(matches));
    if (url.includes('/rest/v1/credit_accounts')) return r.fulfill(json(object ? { id: 'c1', user_id: 'u1', balance: 120 } : [{ id: 'c1', user_id: 'u1', balance: 120 }]));
    if (url.includes('/functions/v1/match-campaign')) { st.starts += 1; return r.fulfill(json({ error: 'PROPERTY_EXPIRED', reasonCode: 'PROPERTY_EXPIRED' }, 409)); }
    return r.fulfill(json(object ? null : []));
  });
  await page.route(`${BASE}/managed-photo.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto(`${BASE}${route}`);
  return { page, st };
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/* ── MEDIA ─────────────────────────────────────────────────────────────── */

test('broken imported photo: explained in approved Georgian, exact listing link, update in HOMATCH', opts, async (t) => {
  const { page } = await boot(t, { lang: 'ka', imageWorks: false });
  const notice = page.getByTestId('pow-media-unavailable').first();
  await notice.waitFor({ timeout: 20000 });
  assert.match(await notice.innerText(), /ფოტო აღარ არის ხელმისაწვდომი/);
  assert.match(await notice.innerText(), /ეს ქონება სხვა საიტიდან არის იმპორტირებული და წყაროზე არსებული ფოტო ამჟამად აღარ იტვირთება\./);
  const link = notice.getByRole('link', { name: 'განცხადებაზე გადასვლა' });
  assert.equal(await link.getAttribute('href'), LISTING, 'the exact listing, not the portal homepage');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.ok(await notice.getByRole('link', { name: 'განახლება HOMATCH-ში' }).isVisible());
  await shot(page, 'detail-1440-ka-broken-photo');
});

test('working imported photo is shown, requested without a referrer, and no fallback appears', opts, async (t) => {
  const { page } = await boot(t, { imageWorks: true });
  const img = page.locator(`img[src="${IMG}"]`).first();
  await img.waitFor({ timeout: 20000 });
  await page.waitForFunction((src) => { const el = document.querySelector(`img[src="${src}"]`); return el && el.complete && el.naturalWidth > 0; }, IMG);
  assert.equal(await img.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(await page.getByTestId('pow-media-unavailable').count(), 0);
});

test('a HOMATCH-managed photo leads and is shown even though the external one is broken', opts, async (t) => {
  const { page } = await boot(t, { photo: 'managed', imageWorks: false });
  await page.waitForFunction(() => [...document.images].some((el) => el.src.endsWith('/managed-photo.png') && el.naturalWidth > 0), null, { timeout: 20000 });
  assert.equal(await page.getByTestId('pow-media-unavailable').count(), 0);
});

/* ── FRESHNESS + RENEWAL ───────────────────────────────────────────────── */

test('day 24: "მალე განაახლე" with a free renewal; a double click renews once', opts, async (t) => {
  const { page, st } = await boot(t, { lang: 'ka', state: 'EXPIRING_SOON', imageWorks: true });
  const panel = page.getByTestId('pow-freshness-panel');
  await panel.waitFor({ timeout: 20000 });
  assert.match(await panel.innerText(), /მალე განაახლე/);
  assert.match(await panel.innerText(), /განახლება უფასოა და განცხადება კიდევ 30 დღე აქტიური იქნება\./);
  assert.equal(await page.getByTestId('pow-freshness-chip').first().getAttribute('data-state'), 'EXPIRING_SOON');
  await shot(page, 'detail-1440-ka-expiring');
  const renew = page.locator('[data-action="pow-renew"]');
  await renew.dblclick();
  await page.getByTestId('pow-freshness-chip').first().and(page.locator('[data-state="ACTIVE"]')).waitFor({ timeout: 15000 });
  assert.equal(st.renews, 1, 'a double click is one renewal request');
  assert.match(await page.getByTestId('pow-freshness-panel').innerText(), /აქტიური/);
});

test('expired: discovery is paused (no start), matches kept, renewal restores it on the same property', opts, async (t) => {
  const { page, st } = await boot(t, { lang: 'ka', state: 'EXPIRED', imageWorks: true });
  const blocked = page.getByTestId('pow-discovery-blocked');
  await blocked.waitFor({ timeout: 20000 });
  assert.match(await page.getByTestId('pow-freshness-panel').innerText(), /ვადაგასულია/);
  assert.match(await page.getByTestId('pow-freshness-panel').innerText(), /ამ ქონების ინფორმაცია 30 დღეზე მეტია არ განახლებულა\. დაადასტურე, რომ განცხადება ისევ აქტიურია\./);
  assert.match(await page.getByTestId('pow-freshness-panel').innerText(), /ინფორმაციის შეცვლა/);
  assert.match(await page.getByTestId('pow-discovery-state').innerText(), /შეჩერებულია/);
  assert.equal(await page.getByRole('button', { name: /მყიდველების|Find/ }).count(), 0, 'no start while expired');
  assert.match(await page.getByTestId('pow-discovery-counts').innerText(), /12/, 'existing matches are kept and counted');
  await shot(page, 'detail-1440-ka-expired');
  await blocked.getByRole('button').click();
  await page.getByTestId('pow-discovery-blocked').waitFor({ state: 'detached', timeout: 15000 });
  assert.equal(st.renews, 1);
  assert.equal(st.starts, 0, 'renewal never starts a paid search by itself');
  assert.equal(await page.getByTestId('pow-freshness-chip').first().getAttribute('data-state'), 'ACTIVE');
});

test('source problem on an imported property: "წყაროზე პრობლემაა" with the source action, independent of freshness', opts, async (t) => {
  const { page } = await boot(t, { lang: 'ka', state: 'ACTIVE', source: 'LISTING_NOT_FOUND', imageWorks: false });
  const source = page.getByTestId('pow-source-panel');
  await source.waitFor({ timeout: 20000 });
  const text = await source.innerText();
  assert.match(text, /წყაროზე პრობლემაა/);
  assert.match(text, /წყაროზე განცხადება აღარ იძებნება\./);
  assert.match(text, /განაახლე განცხადება წყაროზე/);
  assert.match(text, /თუ განცხადება ისევ აქტიურია, გადაამოწმე და განაახლე ის საიტზე, საიდანაც HOMATCH-ში შემოიტანე\./);
  assert.equal(await page.getByTestId('pow-freshness-chip').first().getAttribute('data-state'), 'ACTIVE', 'freshness is not the source');
});

/* ── LAYOUT ────────────────────────────────────────────────────────────── */

test('Property Detail workspace at seven widths: no overflow, grid actions, full-width discovery, no dead column', opts, async (t) => {
  for (const width of WIDTHS) {
    await t.test(`${width}px`, async (tt) => {
      const { page } = await boot(tt, { width, lang: 'ka', imageWorks: true, state: 'EXPIRING_SOON' });
      await page.getByTestId('pow-discovery').waitFor({ timeout: 20000 });
      assert.ok(await noOverflow(page), `no horizontal overflow at ${width}`);
      const m = await page.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const ws = box('[data-testid="pow-workspace"]');
        const disc = box('[data-testid="pow-discovery"]');
        const tiles = [...document.querySelectorAll('[data-testid="pow-quick-actions"] > button')].map((b) => b.getBoundingClientRect());
        const hero = document.querySelector('[data-testid="pow-hero"]');
        const cols = [...hero.children].map((c) => c.getBoundingClientRect());
        const info = document.querySelector('[data-testid="pow-info"]');
        const infoCols = [...info.children].map((c) => c.getBoundingClientRect());
        return {
          ws: ws.width, area: document.querySelector('[data-testid="pow-workspace"]').parentElement.getBoundingClientRect().width, disc: disc.width, firstRow: tiles.filter((r) => Math.abs(r.top - tiles[0].top) < 2).length, tiles: tiles.length,
          heroCols: cols.map((c) => ({ w: c.width, h: c.height, top: c.top })), infoCols: infoCols.map((c) => ({ w: c.width, h: c.height })),
          heroBox: hero.getBoundingClientRect().height,
        };
      });
      const usable = m.ws - (width >= 1024 ? 64 : width >= 640 ? 48 : 32);
      assert.ok(m.disc >= usable - 2, `discovery spans the workspace at ${width} (${m.disc} of ${usable})`);
      if (width >= 1280) assert.equal(m.firstRow, m.tiles, `all quick actions on one row at ${width}`);
      if (width >= 1024) {
        /* Side by side, and neither column leaves a hole the size of the other. */
        assert.equal(m.heroCols.length, 2);
        assert.ok(Math.abs(m.heroCols[0].top - m.heroCols[1].top) < 2, 'hero columns share a row');
        const [g, id] = m.heroCols;
        const dead = Math.abs(g.h - id.h) * Math.min(g.w, id.w);
        const area = m.heroBox * (g.w + id.w);
        assert.ok(dead / area < 0.3, `hero dead space ${(100 * dead / area).toFixed(0)}% at ${width}`);
        /* The canvas fills the content area beside the app's navigation, up to 90rem. */
        assert.ok(m.ws >= Math.min(m.area, 1440) - 2, `the canvas uses the content area (${m.ws} of ${m.area})`);
      } else {
        assert.ok(m.heroCols.every((c) => c.w >= usable - 2), `stacked single column at ${width}`);
      }
      await shot(page, `detail-${width}-ka`);
    });
  }
});

test('six locales at 390 and 1440; ar/he right-to-left; no overflow', opts, async (t) => {
  for (const lang of LOCALES) {
    for (const width of [390, 1440]) {
      await t.test(`${lang} ${width}`, async (tt) => {
        const { page } = await boot(tt, { width, lang, state: 'EXPIRED', imageWorks: false });
        await page.getByTestId('pow-discovery-blocked').waitFor({ timeout: 20000 });
        assert.ok(await noOverflow(page), `${lang} ${width} no overflow`);
        const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
        assert.equal(dir, lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr');
        if (width === 390 || lang === 'ar') await shot(page, `detail-${width}-${lang}-expired-broken`);
      });
    }
  }
});

/* ── MY PROPERTY CARDS ─────────────────────────────────────────────────── */

test('My Property card: normal photo, broken photo explained, freshness chip', opts, async (t) => {
  await t.test('normal photo', async (tt) => {
    const { page } = await boot(tt, { route: '/property', lang: 'ka', imageWorks: true, state: 'ACTIVE' });
    await page.waitForFunction((src) => [...document.images].some((el) => el.src === src && el.naturalWidth > 0), IMG, { timeout: 20000 });
    assert.equal(await page.getByTestId('pow-media-unavailable').count(), 0);
    assert.equal(await page.getByTestId('pow-freshness-chip').first().getAttribute('data-state'), 'ACTIVE');
    await shot(page, 'my-property-1440-ka-photo');
  });
  await t.test('broken photo', async (tt) => {
    const { page } = await boot(tt, { route: '/property', lang: 'ka', imageWorks: false, state: 'EXPIRING_SOON' });
    const notice = page.getByTestId('pow-media-unavailable').first();
    await notice.waitFor({ timeout: 20000 });
    assert.match(await notice.innerText(), /ფოტო აღარ არის ხელმისაწვდომი/);
    assert.match(await page.getByTestId('pow-freshness-chip').first().innerText(), /მალე განაახლე/);
    assert.ok(await page.getByTestId('pow-attention').first().isVisible(), 'attention is flagged');
    await shot(page, 'my-property-1440-ka-broken');
  });
  await t.test('broken photo at 390', async (tt) => {
    const { page } = await boot(tt, { route: '/property', lang: 'ka', width: 390, height: 844, imageWorks: false, state: 'EXPIRED' });
    await page.getByTestId('pow-media-unavailable').first().waitFor({ timeout: 20000 });
    assert.ok(await noOverflow(page));
    await shot(page, 'my-property-390-ka-broken');
  });
});

/* ── FIND BUYERS: the owner chooses the audience languages at launch ─────── */

test('launch: all six languages by default; tap to narrow (e.g. Georgian only); the last one cannot be removed', opts, async (t) => {
  for (const [lang, width] of [['ka', 390], ['ar', 1440]]) {
    const { page } = await boot(t, { lang, width, height: width < 700 ? 844 : 900, imageWorks: true });
    await page.getByTestId('pow-discovery').waitFor({ timeout: 20000 });
    /* The start action is the panel's last button (after "view matches"). */
    await page.getByTestId('pow-discovery').locator('button').last().click();
    const chips = page.getByTestId('fbx-language-chips');
    await chips.waitFor({ timeout: 20000 });
    const pressed = () => chips.locator('button[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.textContent.trim().toLowerCase()));
    assert.deepEqual(await pressed(), ['ka', 'ru', 'en', 'ar', 'he', 'tr'], `${lang}: all six by default`);
    const hint = page.locator('#fbx-lang-hint');
    const allHint = await hint.innerText();
    for (const l of ['ru', 'en', 'ar', 'he', 'tr']) await page.getByTestId(`fbx-lang-${l}`).click();
    assert.deepEqual(await pressed(), ['ka'], `${lang}: Georgian only`);
    assert.notEqual(await hint.innerText(), allHint, 'the hint says the search is narrowed');
    assert.match(await hint.innerText(), /KA/);
    await page.getByTestId('fbx-lang-ka').click();
    assert.deepEqual(await pressed(), ['ka'], 'the last language stays');
    await page.getByTestId('fbx-lang-ar').click();
    assert.deepEqual(await pressed(), ['ka', 'ar'], 'order stays the chips\' order');
    assert.ok(await noOverflow(page), `${lang}@${width}: no horizontal overflow`);
  }
});
