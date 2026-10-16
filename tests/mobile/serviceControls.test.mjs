// SERVICE CONTROL CENTER — what a customer sees while the owner has the six services
// paused, and that switching them on brings every entry point back.
//
// Real build (npm run build:harness), real Chromium, every network request stubbed.
// The switches arrive through the same RPC production uses (service_controls_public).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SERVICE_CONTROLS_RPC, SERVICES_ALL_OFF, SERVICES_ALL_ON } from './serviceControlsFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4391;
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

const PAUSED_PATHS = ['/publishing', '/outreach/calls', '/outreach/whatsapp', '/live-chat', '/design-studio'];
const SERVICE_OF = { '/publishing': 'publishing', '/outreach/calls': 'ai_call_center', '/outreach/whatsapp': 'whatsapp', '/live-chat': 'live_chat', '/design-studio': 'design_studio' };
// Every backend of the six that a mounted page would call. While paused, none may be called.
const SERVICE_BACKENDS = ['publishing-engine', 'ai-talk-session', 'comm-agent', 'comm-campaign-launch', 'whatsapp-send', 'design-studio-reconstruct', 'design-studio-model', 'live_chat_messages', 'live_chat_profiles', 'ds_projects'];

let shared = null;
async function browser(t) {
  if (shared) return shared;
  const { chromium } = resolvePlaywright();
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  shared = { b, preview };
  return shared;
}
test.after(async () => { if (shared) { await shared.b.close().catch(() => {}); shared.preview.kill(); } });

async function open(t, { route, services, width = 1440, height = 900, lang = 'en', signedIn = true }) {
  const { b } = await browser(t);
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  t.after(() => ctx.close().catch(() => {}));
  await ctx.addInitScript(([k, s, l, signed]) => {
    if (signed) window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', l);
  }, ['sb-stubproj-auth-token', fakeSession(), lang, signedIn]);
  const page = await ctx.newPage();
  const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const serviceCalls = [];
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (SERVICE_BACKENDS.some((s) => url.includes(s))) serviceCalls.push(url);
    if (url.includes(SERVICE_CONTROLS_RPC)) return r.fulfill(json(services));
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    return r.fulfill(json(object ? null : []));
  });
  await page.goto(`${BASE}${route}`);
  return { page, serviceCalls };
}

const hrefs = (page) => page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname));
const offered = (list) => list.filter((p) => PAUSED_PATHS.some((x) => p === x || p.startsWith(`${x}/`)));

test('paused: no entry point to any of the six in the desktop navigation', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: SERVICES_ALL_OFF });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(800);
  assert.deepEqual(offered(await hrefs(page)), [], 'a link to a paused service is still offered');
});

test('paused: the phone bottom bar drops Live Chat and reflows without a gap or overflow', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: SERVICES_ALL_OFF, width: 390, height: 844 });
  await page.waitForSelector('[data-mobile-nav]', { timeout: 30_000 });
  await page.waitForTimeout(500);
  const bar = await page.evaluate(() => {
    const nav = document.querySelector('[data-mobile-nav]');
    return { links: [...nav.querySelectorAll('a[href]')].map((a) => new URL(a.href).pathname), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  assert.ok(!bar.links.includes('/live-chat'));
  assert.equal(bar.links.length, 4);
  assert.equal(bar.overflow, false);
});

test('paused: a direct URL shows "currently unavailable" and never mounts or calls the service', opts, async (t) => {
  for (const path of PAUSED_PATHS) {
    const { page, serviceCalls } = await open(t, { route: path, services: SERVICES_ALL_OFF });
    const box = page.getByTestId('service-unavailable');
    await box.waitFor({ timeout: 30_000 });
    assert.equal(await box.getAttribute('data-service'), SERVICE_OF[path], path);
    await page.waitForTimeout(600);
    assert.deepEqual(serviceCalls, [], `${path} called its backend while paused`);
  }
});

test('paused: the home page shows neither the AI TALK panel nor the call-center section, and keeps its layout', opts, async (t) => {
  const { page, serviceCalls } = await open(t, { route: '/', services: SERVICES_ALL_OFF, signedIn: false });
  await page.waitForSelector('section', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.getByTestId('ai-talk-panel').count(), 0);
  assert.equal(await page.locator('#call-center').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.ok(!serviceCalls.some((u) => u.includes('ai-talk-session')), 'AI TALK opened a session while paused');
});

test('switched on: every entry point comes back, with no redeploy', opts, async (t) => {
  const { page } = await open(t, { route: '/dashboard', services: SERVICES_ALL_ON });
  await page.waitForSelector('nav', { timeout: 30_000 });
  await page.waitForTimeout(800);
  const links = await hrefs(page);
  for (const path of PAUSED_PATHS) assert.ok(links.includes(path), `${path} is not offered while ON`);
  const home = await open(t, { route: '/', services: SERVICES_ALL_ON, signedIn: false });
  await home.page.getByTestId('ai-talk-panel').waitFor({ timeout: 30_000 });
  const pub = await open(t, { route: '/publishing', services: SERVICES_ALL_ON });
  await pub.page.waitForTimeout(1500);
  assert.equal(await pub.page.getByTestId('service-unavailable').count(), 0, '/publishing still shows the paused page while ON');
});

test('the unavailable page speaks all six languages, right-to-left where it should', opts, async (t) => {
  const seen = new Set();
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    const { page } = await open(t, { route: '/live-chat', services: SERVICES_ALL_OFF, lang, width: 390, height: 844 });
    const box = page.getByTestId('service-unavailable');
    await box.waitFor({ timeout: 30_000 });
    const heading = (await box.locator('h1').innerText()).trim();
    assert.ok(heading.length > 5, lang);
    seen.add(heading);
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    assert.equal(dir, ['ar', 'he'].includes(lang) ? 'rtl' : 'ltr', `${lang} direction`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${lang} overflows`);
  }
  assert.equal(seen.size, 6, 'every language has its own words');
});

/* ── Admin → Service Control Center ─────────────────────────────────── */

const adminProfile = { ...profile, is_admin: true, role: 'admin', email: 'owner@homatch.test' };
function overviewCard(key, over = {}) {
  return {
    key, frontend: false, backend: false, version: 1, reason: 'Initial state: paused by the owner', updatedAt: '2026-10-16T15:00:00Z', updatedBy: null,
    effective: 'PAUSED', readiness: { ready: true, missing: [], notes: [] }, running: {}, history: [], ...over,
  };
}
const OVERVIEW = {
  services: [
    overviewCard('ai_call_center', { readiness: { ready: false, missing: ['SECRET_VAPI_PRIVATE_API_KEY', 'ROUTE_TELEPHONY_VAPI_OFF'], notes: ['PRODUCT_AI_CALL_NOT_PRICED'] }, running: { campaigns_running: 0, sends_pending: 0 } }),
    overviewCard('ai_talk', { running: { sessions_active: 0 } }),
    overviewCard('design_studio'), overviewCard('live_chat'), overviewCard('publishing'), overviewCard('whatsapp'),
  ],
  checkedAt: '2026-10-16T15:05:00Z', propagationSeconds: 10,
};

async function openAdmin(t, lang = 'en') {
  const { b } = await browser(t);
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => ctx.close().catch(() => {}));
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); }, ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const writes = [];
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/functions/v1/service-control')) {
      const body = req.postDataJSON();
      if (body.action === 'overview') return r.fulfill(json(OVERVIEW));
      writes.push(body);
      if (body.action === 'set' && body.service === 'ai_call_center') return r.fulfill(json({ code: 'NOT_READY', missing: ['SECRET_VAPI_PRIVATE_API_KEY', 'ROUTE_TELEPHONY_VAPI_OFF'], notes: [] }, 409));
      if (body.action === 'set') return r.fulfill(json({ result: 'CHANGED', control: { service_key: body.service, version: 2 } }));
      return r.fulfill(json({ result: 'UNCHANGED', changed: [] }));
    }
    if (url.includes(SERVICE_CONTROLS_RPC)) return r.fulfill(json(SERVICES_ALL_OFF));
    if (url.includes('/rest/v1/rpc/is_admin')) return r.fulfill(json(true));
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(adminProfile));
    const object = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    return r.fulfill(json(object ? null : []));
  });
  await page.goto(`${BASE}/admin/service-control`);
  await page.getByTestId('service-control-center').waitFor({ timeout: 30_000 });
  await page.getByTestId('service-card-ai_talk').waitFor({ timeout: 30_000 });
  return { page, writes };
}

test('admin: six cards; visibility cannot be switched on before execution; NOT READY names what is missing', opts, async (t) => {
  const { page, writes } = await openAdmin(t);
  for (const key of ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio']) {
    assert.equal(await page.getByTestId(`service-card-${key}`).count(), 1, key);
    assert.equal(await page.getByTestId(`svc-frontend-${key}`).isDisabled(), true, `${key}: frontend switch must wait for the backend`);
  }
  const callsCard = page.getByTestId('service-card-ai_call_center');
  assert.match(await callsCard.innerText(), /VAPI_PRIVATE_API_KEY/);
  await page.getByTestId('svc-backend-ai_call_center').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  const refusal = page.getByRole('alertdialog');
  await refusal.getByText('Complete these first').waitFor({ timeout: 15_000 });
  assert.match(await refusal.innerText(), /Vapi telephony route is switched off/);
  assert.equal(writes.at(-1).backend, true);
  assert.equal(writes.at(-1).frontend, false);
  assert.equal(writes.at(-1).expectedVersion, 1);
  assert.match(String(writes.at(-1).requestId), /^[A-Za-z0-9-]{8,}$/);
  assert.equal(await page.locator('[data-sonner-toast][data-type="success"]').count(), 0, 'no success before the server confirms');
});

test('admin: a confirmed change is sent once with its version and reason; the page is right-to-left in Hebrew', opts, async (t) => {
  const { page, writes } = await openAdmin(t);
  await page.getByTestId('svc-backend-ai_talk').click();
  const dialog = page.getByRole('alertdialog');
  await dialog.locator('textarea').fill('supervised test');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 15_000 });
  const sets = writes.filter((w) => w.action === 'set' && w.service === 'ai_talk');
  assert.equal(sets.length, 1, 'one click, one write');
  assert.deepEqual({ backend: sets[0].backend, frontend: sets[0].frontend, expectedVersion: sets[0].expectedVersion, reason: sets[0].reason }, { backend: true, frontend: false, expectedVersion: 1, reason: 'supervised test' });
  const he = await openAdmin(t, 'he');
  assert.equal(await he.page.evaluate(() => document.documentElement.getAttribute('dir')), 'rtl');
  assert.equal(await he.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
});
