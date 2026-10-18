// SERVICE CONTROL CENTER, EXPANDED — the fourteen live products (docs/claude/SERVICE_CONTROLS_INVENTORY.md).
//
// What a customer sees when the owner pauses them, that the platform stays reachable while
// they are, that switching them back on restores every entry point, that an unreadable
// control table never takes a live product down, and that the Admin group pause cannot
// fire without the typed confirmation.
//
// Real build (npm run build:harness), real Chromium, every network request stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LIVE_KEYS, PAID_KEYS, SERVICE_CONTROLS_RPC, SERVICE_KEYS, liveState } from './serviceControlsFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4393;
const BASE = `http://127.0.0.1:${PORT}`;

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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900_000 };

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

// One customer address per live product (find_property_deep has none of its own). The brokers
// directory and its profiles are gated like every other product (owner, 2026-10-18).
const DIRECT = {
  '/find-property': 'find_property', '/property/123456/matches': 'find_buyers', '/verify': 'verify', '/contracts': 'contracts',
  '/mortgage': 'mortgage', '/investment': 'investment', '/for-expats/georgia': 'for_expats', '/outreach/meta': 'meta_ads',
  '/outreach/email': 'email_campaigns', '/email-studio': 'email_campaigns', '/ai': 'ai_assistant',
  '/broker': 'broker_desk', '/developers': 'developers',
  '/brokers': 'brokers_directory', '/brokers/11111111-1111-1111-1111-111111111111': 'brokers_directory',
};
const LIVE_PREFIXES = ['/find-property', '/verify', '/contracts', '/mortgage', '/investment', '/for-expats', '/outreach/meta',
  '/outreach/email', '/email-studio', '/broker', '/brokers', '/developers'];
const isLivePath = (p) => p === '/ai' || /^\/property\/[^/]+\/(matches|buyers|leads|buyer)(\/|$)/.test(p)
  || LIVE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
// Backends a mounted live page would call for NEW work; while paused, none may be called.
const LIVE_BACKENDS = ['marketplace-search', 'find-property-plan', 'find-property-run', 'match-campaign', 'research-agent',
  'deal-room-ai', 'investment-research', 'investment-consultant', 'meta-ads-api', 'outreach-send', 'homatch-ai'];

let shared = null;
async function browser() {
  if (shared) return shared;
  const { chromium } = resolvePlaywright();
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  shared = { b, preview };
  return shared;
}
test.after(async () => { if (shared) { await shared.b.close().catch(() => {}); shared.preview.kill(); } });

const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const preflight = { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } };

// services: rows to answer with, or 'unreadable' for a 500. remembered: this browser's last answer.
async function open(t, { route, services, width = 1440, height = 900, signedIn = true, remembered = null }) {
  const { b } = await browser();
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  t.after(() => ctx.close().catch(() => {}));
  await ctx.addInitScript(([k, s, signed, mem]) => {
    if (signed) window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
    if (mem) window.localStorage.setItem('homatch-service-visibility', JSON.stringify(mem));
  }, ['sb-stubproj-auth-token', fakeSession(), signedIn, remembered]);
  const page = await ctx.newPage();
  const serviceCalls = [];
  const directoryReads = [];
  let rpcCalls = 0;
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill(preflight);
    if (url.includes('/rest/v1/broker_directory_public')) {
      directoryReads.push(url);
      // What the public view returns: only ACTIVE listings still inside their paid period.
      return r.fulfill(json((req.headers().accept ?? '').includes('vnd.pgrst.object') ? PAID_LISTING : [PAID_LISTING]));
    }
    if (LIVE_BACKENDS.some((s) => url.includes(`/functions/v1/${s}`))) serviceCalls.push({ url, action: (() => { try { return req.postDataJSON()?.action ?? null; } catch { return null; } })() });
    if (url.includes(SERVICE_CONTROLS_RPC)) {
      rpcCalls += 1;
      const answer = typeof services === 'function' ? services(rpcCalls) : services;
      return r.fulfill(answer === 'unreadable' ? json({ message: 'down' }, 500) : json(answer));
    }
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    return r.fulfill(json(object ? null : []));
  });
  await page.goto(`${BASE}${route}`);
  return { page, serviceCalls, directoryReads };
}
const hrefs = (page) => page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => new URL(a.href, location.href).pathname));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const ALL_LIVE_OFF = liveState(false);
const PAID_LISTING = {
  id: '11111111-1111-1111-1111-111111111111', broker_id: '22222222-2222-2222-2222-222222222222', display_name: 'Vake Homes Agency',
  role: 'AGENCY', country_code: 'GE', cities: ['Tbilisi'], languages: ['ka', 'en'], contact_phone: null, contact_email: null, website: null,
  paid_until: new Date(Date.now() + 20 * 86_400_000).toISOString(), about: 'Apartments in Vake.', contact_person: null, logo_url: null,
  property_types: ['APARTMENT'], deal_kinds: ['SALE'], districts: ['Vake'], experience_years: 9, whatsapp: null, telegram: null,
  segments: ['RESIDENTIAL'], verified: true,
};
const ALL_LIVE_ON = liveState(true);

test('paused live products: the desktop sidebar offers none of them, and the platform stays', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: ALL_LIVE_OFF });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const links = await hrefs(page);
  assert.deepEqual(links.filter(isLivePath), [], 'a link to a paused product is still offered');
  for (const platform of ['/dashboard', '/property', '/chat']) assert.ok(links.includes(platform), `${platform} must stay reachable`);
  assert.ok(!links.includes('/brokers') && !links.includes('/broker'), 'a paused broker service is still in the sidebar');
  assert.equal(await page.getByTestId('service-unavailable').count(), 0, 'the dashboard itself is never gated');
  assert.equal(await noOverflow(page), true);
});

test('paused live products: the phone bottom bar keeps the dashboard and reflows without overflow', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: ALL_LIVE_OFF, width: 390, height: 844 });
  await page.waitForSelector('[data-mobile-nav]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  const bar = await page.evaluate(() => [...document.querySelector('[data-mobile-nav]').querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname));
  assert.deepEqual(bar, ['/dashboard'], 'Verify, AI, Contracts (and the paused Live Chat) leave the bar');
  assert.equal(await noOverflow(page), true);
});

// A live product renders before the first answer (fail-open: Verify must not wait on a
// spinner), so a browser that has never seen the pause may mount the page for a moment and
// let it read its own state. Reads only, which the backend answers while paused; never a
// call that starts work. A browser that has seen the pause mounts nothing at all.
const READ_ONLY = new Set(['capabilities', 'history', 'status']);
test('paused live products: every direct URL shows "currently unavailable" and starts no work', opts, async (t) => {
  const pausedMemory = Object.fromEntries(LIVE_KEYS.map((k) => [k, false]));
  for (const [path, key] of Object.entries(DIRECT)) {
    for (const remembered of [null, pausedMemory]) {
      const { page, serviceCalls } = await open(t, { route: path, services: ALL_LIVE_OFF, remembered });
      const box = page.getByTestId('service-unavailable');
      await box.waitFor({ timeout: 30_000 }).catch(async (e) => {
        throw new Error(`${path} (${remembered ? 'remembered paused' : 'fresh browser'}): no "currently unavailable" after 30s; on screen: ${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 200))}`, { cause: e });
      });
      assert.equal(await box.getAttribute('data-service'), key, path);
      await page.waitForTimeout(500);
      if (remembered) assert.deepEqual(serviceCalls, [], `${path} called a backend although this browser knew it was paused`);
      else assert.deepEqual(serviceCalls.filter((c) => !READ_ONLY.has(c.action)), [], `${path} started work while paused`);
    }
  }
});

test('a first read that fails is retried within seconds, so a paused product does not linger', opts, async (t) => {
  // Production CI, 2026-10-17: a transient error on the very first read left a paused live
  // product mounted until the 60-second refresh. One failure, then the real (paused) answer.
  const { page } = await open(t, { route: '/verify', services: (n) => (n === 1 ? 'unreadable' : ALL_LIVE_OFF) });
  await page.getByTestId('service-unavailable').waitFor({ timeout: 15_000 });
  assert.equal(await page.getByTestId('service-unavailable').getAttribute('data-service'), 'verify');
});

test('paused live products: the platform pages around them still open', opts, async (t) => {
  for (const path of ['/credits', '/property', '/chat', '/admin']) {
    const { page } = await open(t, { route: path, services: ALL_LIVE_OFF });
    await page.waitForSelector('main, nav', { timeout: 30_000 });
    await page.waitForTimeout(600);
    assert.equal(await page.getByTestId('service-unavailable').count(), 0, `${path} must never be gated`);
  }
});

// The home page reaches its products through buttons (navigate), not anchors, so it is
// compared as a page: the same build with the products ON, then OFF.
const homeShape = (page) => page.evaluate(() => ({
  sections: [...document.querySelectorAll('main section[id]')].map((s) => s.id),
  tiles: document.querySelectorAll('#start .grid > *').length,
  text: document.body.innerText,
  empty: [...document.querySelectorAll('main section')].filter((s) => s.getBoundingClientRect().height > 0 && !s.textContent.trim()).length,
}));
/* ── Brokers: two switches, brokers_directory (/brokers, /brokers/:id) and broker_desk (/broker…) ── */
const brokerState = (directory, desk) => liveState(true).map((row) =>
  row.service_key === 'brokers_directory' ? { ...row, frontend_enabled: directory, backend_enabled: directory }
    : row.service_key === 'broker_desk' ? { ...row, frontend_enabled: desk, backend_enabled: desk } : row);
const DRAWER_OPEN = 'Open navigation';
const sidebarLinks = async (page) => {
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  return hrefs(page);
};

test('brokers: both switches OFF — no sidebar item (desktop and phone drawer), no home section, every address gated, nothing read', opts, async (t) => {
  const off = brokerState(false, false);
  const desk = await open(t, { route: '/dashboard', services: off });
  const links = await sidebarLinks(desk.page);
  assert.ok(!links.some((p) => p === '/brokers' || p.startsWith('/brokers/') || p === '/broker' || p.startsWith('/broker/')), `desktop sidebar: ${links}`);
  for (const path of ['/find-property', '/verify']) assert.ok(links.includes(path), `${path} must stay while only brokers are paused`);

  const phone = await open(t, { route: '/dashboard', services: off, width: 390, height: 844 });
  await phone.page.waitForSelector('[data-mobile-nav]', { timeout: 30_000 });
  await phone.page.waitForTimeout(600);
  await phone.page.getByRole('button', { name: DRAWER_OPEN }).first().click(); // the phone sidebar is a drawer
  await phone.page.waitForTimeout(500);
  const phoneLinks = await hrefs(phone.page);
  assert.ok(!phoneLinks.some((p) => p === '/brokers' || p === '/broker'), `phone: ${phoneLinks}`);
  assert.equal(await noOverflow(phone.page), true);

  for (const width of [1440, 390]) {
    const home = await open(t, { route: '/', services: off, signedIn: false, width });
    await home.page.waitForSelector('section', { timeout: 30_000 });
    await home.page.waitForTimeout(1200);
    assert.equal(await home.page.locator('#brokers').count(), 0, `home @${width}: the Brokers section is still shown`);
    assert.ok(!(await hrefs(home.page)).some((p) => p === '/brokers'), `home @${width}: a link to /brokers is still offered`);
    assert.equal(await noOverflow(home.page), true);
  }

  for (const path of ['/brokers', '/brokers/11111111-1111-1111-1111-111111111111', '/broker', '/broker/onboarding']) {
    for (const signedIn of [false, true]) {
      if (!signedIn && !path.startsWith('/brokers')) continue; // the desk asks a visitor to sign in first
      const { page, directoryReads } = await open(t, { route: path, services: off, signedIn });
      await page.getByTestId('service-unavailable').waitFor({ timeout: 30_000 });
      assert.equal(await page.getByTestId('service-unavailable').getAttribute('data-service'), path.startsWith('/brokers') ? 'brokers_directory' : 'broker_desk', path);
      await page.waitForTimeout(500);
      assert.deepEqual(directoryReads, [], `${path} read the directory while paused`);
      assert.equal(await page.getByText('Vake Homes Agency').count(), 0, `${path} showed a listing while paused`);
    }
  }
});

test('brokers: each switch on its own — the directory without the desk, the desk without the directory', opts, async (t) => {
  // Directory ON, desk OFF: /brokers opens and lists; the desk is gone everywhere.
  const dirOnly = brokerState(true, false);
  const a = await open(t, { route: '/dashboard', services: dirOnly });
  const aLinks = await sidebarLinks(a.page);
  assert.ok(aLinks.includes('/brokers') && !aLinks.includes('/broker'), `directory only: ${aLinks}`);
  const list = await open(t, { route: '/brokers', services: dirOnly });
  await list.page.getByText('Vake Homes Agency').first().waitFor({ timeout: 30_000 });
  assert.equal(await list.page.getByTestId('service-unavailable').count(), 0);
  assert.ok(!(await hrefs(list.page)).some((p) => p === '/broker' || p === '/broker/onboarding'), 'the directory offers the paused desk');
  const deskOff = await open(t, { route: '/broker', services: dirOnly });
  await deskOff.page.getByTestId('service-unavailable').waitFor({ timeout: 30_000 });
  const signup = await open(t, { route: '/auth/signup?intent=broker', services: dirOnly, signedIn: false });
  await signup.page.waitForSelector('form', { timeout: 30_000 });
  await signup.page.waitForTimeout(800);
  assert.equal(await signup.page.locator('[data-signup-professional]').count(), 0, 'professional sign-up offered while the desk is paused');

  // Desk ON, directory OFF: a professional keeps the desk; the directory is gone everywhere.
  const deskOnly = brokerState(false, true);
  const b = await open(t, { route: '/dashboard', services: deskOnly });
  const bLinks = await sidebarLinks(b.page);
  assert.ok(!bLinks.includes('/brokers'), `desk only: the directory is still in the sidebar (${bLinks})`);
  const dirOff = await open(t, { route: '/brokers', services: deskOnly });
  await dirOff.page.getByTestId('service-unavailable').waitFor({ timeout: 30_000 });
  assert.equal(await dirOff.page.getByTestId('service-unavailable').getAttribute('data-service'), 'brokers_directory');
  const deskPage = await open(t, { route: '/broker', services: deskOnly });
  await deskPage.page.waitForTimeout(2000);
  assert.equal(await deskPage.page.getByTestId('service-unavailable').count(), 0, 'the desk is gated although only the directory is paused');
  assert.ok(!(await hrefs(deskPage.page)).some((p) => p.startsWith('/brokers')), 'the desk links into the paused directory');
  const signupOn = await open(t, { route: '/auth/signup?intent=broker', services: deskOnly, signedIn: false });
  await signupOn.page.locator('[data-signup-professional]').waitFor({ timeout: 30_000 });
});

test('brokers: a reload or a new sign-in never brings back a paused broker service, even from memory or after a failed read', opts, async (t) => {
  const off = brokerState(false, false);
  // This browser last saw both ON (memory), the first read fails, then the real answer is OFF.
  const remembered = { brokers_directory: true, broker_desk: true };
  const shown = [];
  const { page } = await open(t, { route: '/dashboard', services: (n) => (n === 1 ? 'unreadable' : off), remembered });
  await page.exposeFunction('__seen', (p) => shown.push(p));
  await page.evaluate(() => {
    const check = () => document.querySelectorAll('a[href="/brokers"], a[href="/broker"]').forEach((a) => window.__seen(a.getAttribute('href')));
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true }); check();
  });
  await page.waitForTimeout(6000);
  assert.deepEqual(shown, [], 'a broker link appeared during the failed read');
  // Reload and sign in again: still hidden from the very first frame.
  for (let i = 0; i < 2; i += 1) {
    await page.reload();
    await page.waitForSelector('nav', { timeout: 30_000 });
    const early = await hrefs(page);
    await page.waitForTimeout(1200);
    const later = await hrefs(page);
    assert.ok(![...early, ...later].some((p) => p === '/brokers' || p === '/broker'), `after reload ${i + 1}`);
  }
  const relogin = await open(t, { route: '/brokers', services: (n) => (n === 1 ? 'unreadable' : off), remembered });
  await relogin.page.getByTestId('service-unavailable').waitFor({ timeout: 30_000 });
  assert.deepEqual(relogin.directoryReads, [], 'the directory page mounted from a remembered ON');
});

test('paused live products: the public home page drops their tiles and sections, with no gap or overflow', opts, async (t) => {
  for (const width of [1440, 390]) {
    const on = await open(t, { route: '/', services: ALL_LIVE_ON, signedIn: false, width, height: 900 });
    await on.page.waitForSelector('#start', { timeout: 30_000 });
    await on.page.waitForTimeout(1200);
    const before = await homeShape(on.page);
    assert.ok(before.tiles >= 8, `home @${width}: the launcher shows its tiles while ON (${before.tiles})`);

    const off = await open(t, { route: '/', services: ALL_LIVE_OFF, signedIn: false, width, height: 900 });
    await off.page.waitForSelector('section', { timeout: 30_000 });
    await off.page.waitForTimeout(1200);
    const after = await homeShape(off.page);
    assert.equal(after.tiles, 0, `home @${width}: a launcher tile for a paused product is still shown`);
    assert.ok(!after.sections.includes('start'), `home @${width}: the launcher heading stays over an empty grid`);
    assert.ok(after.sections.every((id) => before.sections.includes(id)), `home @${width}: pausing added a section`);
    assert.ok(after.sections.length < before.sections.length, `home @${width}: no product section left the page`);
    assert.ok(after.text.length > 200, `home @${width}: the page kept its identity (hero, story, footer)`);
    assert.equal(after.empty, 0, `home @${width} keeps an empty section`);
    assert.deepEqual((await hrefs(off.page)).filter(isLivePath), [], `home @${width}: a link to a paused product is still offered`);
    assert.equal(await noOverflow(off.page), true, `home @${width} overflows`);
    assert.deepEqual(off.serviceCalls, [], 'the home page called a product backend while paused');
  }
});

test('switched back on: every entry point returns, with no redeploy', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: ALL_LIVE_ON });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const links = await hrefs(page);
  for (const path of ['/find-property', '/verify', '/contracts', '/mortgage', '/investment', '/outreach/meta', '/outreach/email', '/brokers'])
    assert.ok(links.includes(path), `${path} is not offered while ON`);
  const phone = await open(t, { route: '/dashboard', services: ALL_LIVE_ON, width: 390, height: 844 });
  await phone.page.waitForSelector('[data-mobile-nav]', { timeout: 30_000 });
  await phone.page.waitForTimeout(600);
  const bar = await phone.page.evaluate(() => [...document.querySelector('[data-mobile-nav]').querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname));
  assert.deepEqual(bar, ['/dashboard', '/verify', '/ai', '/contracts'], 'the bar is exactly as before the expansion (Live Chat stays paused)');
  for (const path of ['/verify', '/find-property', '/mortgage']) {
    const p = await open(t, { route: path, services: ALL_LIVE_ON });
    await p.page.waitForTimeout(1500);
    assert.equal(await p.page.getByTestId('service-unavailable').count(), 0, `${path} still shows the paused page while ON`);
  }
});

test('before the migration (no rows for them), the live products stay exactly as today', opts, async (t) => {
  const sixOnly = SERVICE_KEYS.map((service_key) => ({ service_key, frontend_enabled: false, backend_enabled: false }));
  const { page } = await open(t, { route: '/dashboard', services: sixOnly });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const links = await hrefs(page);
  for (const path of ['/find-property', '/verify', '/contracts', '/mortgage']) assert.ok(links.includes(path), `${path} vanished without an OFF row`);
  assert.ok(!links.includes('/live-chat') && !links.includes('/publishing'), 'the six stay hidden');
});

test('an unreadable control table never takes a live product down, and never shows one of the six', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: 'unreadable' });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const links = await hrefs(page);
  for (const path of ['/find-property', '/verify', '/contracts']) assert.ok(links.includes(path), `${path} hidden by an outage`);
  assert.ok(!links.includes('/live-chat') && !links.includes('/publishing') && !links.includes('/design-studio'), 'a paused service surfaced on an outage');
  const verify = await open(t, { route: '/verify', services: 'unreadable' });
  await verify.page.waitForTimeout(1500);
  assert.equal(await verify.page.getByTestId('service-unavailable').count(), 0, 'Verify was gated by an outage');
  // A product this browser last saw paused stays paused through the outage.
  const remembered = Object.fromEntries(LIVE_KEYS.map((k) => [k, k !== 'contracts']));
  const r = await open(t, { route: '/contracts', services: 'unreadable', remembered });
  await r.page.getByTestId('service-unavailable').waitFor({ timeout: 30_000 });
});

/* ── Admin → Service Control Center, grouped ──────────────────────────── */

const GROUP_OF = {
  publishing: 'publishing', design_studio: 'design', ai_call_center: 'communications', ai_talk: 'communications', whatsapp: 'communications',
  live_chat: 'communications', find_property: 'discovery', find_property_deep: 'discovery', find_buyers: 'discovery', verify: 'intelligence',
  contracts: 'intelligence', mortgage: 'intelligence', investment: 'intelligence', for_expats: 'intelligence', meta_ads: 'marketing',
  email_campaigns: 'marketing', ai_assistant: 'assistant', brokers_directory: 'professionals', broker_desk: 'professionals', developers: 'professionals',
};
const card = (key) => {
  const live = LIVE_KEYS.includes(key);
  return {
    key, group: GROUP_OF[key], failMode: live ? 'OPEN' : 'CLOSED', frontend: live, backend: live, version: 1,
    reason: live ? 'Initial state: live (matches production)' : 'Initial state: paused by the owner', updatedAt: '2026-10-16T15:00:00Z', updatedBy: null,
    effective: live ? 'LIVE' : 'PAUSED', readiness: { ready: true, missing: [], notes: [] }, running: live ? { campaigns_running: 2 } : {}, history: [],
  };
};
const adminProfile = { ...profile, is_admin: true, role: 'admin', email: 'owner@homatch.test' };

async function openAdmin(t) {
  const { b } = await browser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => ctx.close().catch(() => {}));
  await ctx.addInitScript(([k, s]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', 'en'); }, ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  const writes = [];
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill(preflight);
    if (url.includes('/functions/v1/service-control')) {
      const body = req.postDataJSON();
      if (body.action === 'overview') return r.fulfill(json({ services: Object.keys(GROUP_OF).map(card), checkedAt: '2026-10-16T15:05:00Z', propagationSeconds: 10 }));
      writes.push(body);
      if (body.action === 'pause_group') return r.fulfill(json({ result: 'CHANGED', group: body.group, changed: ['email_campaigns', 'meta_ads'] }));
      return r.fulfill(json({ result: 'UNCHANGED', changed: [] }));
    }
    if (url.includes(SERVICE_CONTROLS_RPC)) return r.fulfill(json(liveState(true)));
    if (url.includes('/rest/v1/rpc/is_admin')) return r.fulfill(json(true));
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(adminProfile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    return r.fulfill(json(object ? null : []));
  });
  await page.goto(`${BASE}/admin/service-control`);
  await page.getByTestId('service-control-center').waitFor({ timeout: 30_000 });
  await page.getByTestId('service-card-verify').waitFor({ timeout: 30_000 });
  return { page, writes };
}

test('admin: twenty cards in their groups, counts computed from the cards, fail mode shown', opts, async (t) => {
  const { page } = await openAdmin(t);
  for (const [key, group] of Object.entries(GROUP_OF)) {
    assert.equal(await page.getByTestId(`service-group-${group}`).getByTestId(`service-card-${key}`).count(), 1, `${key} in ${group}`);
    assert.equal(await page.getByTestId(`svc-failmode-${key}`).count(), 1, `${key} fail mode`);
  }
  const text = await page.getByTestId('service-control-center').innerText();
  /* The six and paid Deep Search (paused 2026-10-18) are off; every other product is live. */
  assert.match(text, new RegExp(`${SERVICE_KEYS.length + PAID_KEYS.length} / 20`), 'paused count is dynamic');
  assert.match(text, new RegExp(`${LIVE_KEYS.length} / 20`), 'live count is dynamic');
  assert.doesNotMatch(text, /Pause all six/i, 'there is no global switch on the page');
  assert.equal(await page.getByTestId('svc-pause-group-other').count(), 0);
  // A group whose services are all paused has nothing to pause.
  assert.equal(await page.getByTestId('svc-pause-group-communications').isDisabled(), true);
  assert.equal(await noOverflow(page), true);
});

test('admin: a group pause needs the group name typed, and is sent once', opts, async (t) => {
  const { page, writes } = await openAdmin(t);
  await page.getByTestId('svc-pause-group-marketing').click();
  const dialog = page.getByRole('alertdialog');
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  assert.equal(await confirm.isDisabled(), true, 'no typed confirmation, no button');
  await page.getByTestId('svc-group-confirm-input').fill('Marketing');
  assert.equal(await confirm.isDisabled(), true, 'a near-miss is not the confirmation');
  await page.getByTestId('svc-group-confirm-input').fill('marketing');
  await dialog.locator('textarea').fill('drill');
  assert.equal(await confirm.isDisabled(), false);
  assert.equal(writes.length, 0, 'nothing is sent before Confirm');
  await confirm.click();
  await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 15_000 });
  const sent = writes.filter((w) => w.action === 'pause_group');
  assert.equal(sent.length, 1, 'one click, one write');
  assert.deepEqual({ group: sent[0].group, confirm: sent[0].confirm, reason: sent[0].reason }, { group: 'marketing', confirm: 'marketing', reason: 'drill' });
  assert.match(String(sent[0].requestId), /^[A-Za-z0-9-]{8,}$/);
  assert.equal(writes.filter((w) => w.action === 'pause_all').length, 0, 'no global pause is ever sent');
});

test('admin: turning one live product off warns that customers are using it', opts, async (t) => {
  const { page, writes } = await openAdmin(t);
  await page.getByTestId('svc-backend-verify').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByText('Customers are using this service right now.').waitFor({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(writes.length, 0, 'Cancel sends nothing');
});
