// LEGAL COMPLIANCE — registration acceptance and cookie consent, in a browser.
//
// What a customer must never be able to do, checked against the harness build:
//
//   * create an email/password account without ticking Terms + Privacy;
//   * start Google sign-up from the signup page without ticking it;
//   * use the platform after a Google sign-up that never ticked it (the
//     account is held at /auth/accept-policies until it accepts);
//   * be stopped at that screen when the server says nothing is owed
//     (existing logins must keep working).
//
// And for cookies: nothing optional runs before a choice, Reject is as easy as
// Accept, optional categories start off, a choice is remembered, the footer
// reopens it, and Arabic/Hebrew mirror it.
//
// The server side (the trigger and the two RPCs) is exercised separately on a
// real Postgres; here its answers are stubbed so the UI's use of them can be
// watched request by request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Its own port (4351 belongs to another suite): authScreens 4341. */
const PORT = 4359;
const BASE = `http://127.0.0.1:${PORT}`;
const VERSIONS = { terms: '2026-10-25', privacy: '2026-10-25' };

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME) return process.env.PLAYWRIGHT_CHROME;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: '00000000-0000-4000-8000-000000000002', role: 'authenticated', exp,
    email: 'legal@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated',
      email: 'legal@example.test', app_metadata: { provider: 'google' }, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

test('legal compliance: registration acceptance and cookie consent', opts, async (t) => {
  if (skipReason) assert.fail(`legal compliance gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  /**
   * A page against the stub backend. `policy` is what the server says the
   * account owes; every request worth asserting on is recorded in `log`.
   */
  async function open({ lang = 'en', session = false, policy = { required: false }, init = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(([s, locale, withSession, extra]) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('homatch_lang', locale);
      if (withSession) localStorage.setItem('sb-stubproj-auth-token', JSON.stringify(s));
      for (const [k, v] of Object.entries(extra.local ?? {})) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(extra.session ?? {})) sessionStorage.setItem(k, v);
    }, [fakeSession(), lang, session, init]);
    const page = await ctx.newPage();
    const log = { signup: [], authorize: 0, accept: [], pwa: 0 };
    const state = { ...policy };
    const json = (body, status = 200) => ({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
    });
    await page.route('**', async (r) => {
      const req = r.request();
      const url = req.url();
      if (url.startsWith(BASE)) return r.continue();
      if (req.method() === 'OPTIONS') {
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/auth/v1/authorize')) { log.authorize += 1; return r.fulfill({ status: 302, headers: { location: `${BASE}/terms` } }); }
      if (url.includes('/auth/v1/signup')) {
        log.signup.push(JSON.parse(req.postData() || '{}'));
        return r.fulfill(json({ id: fakeSession().user.id, email: 'new@example.test', user_metadata: {}, identities: [] }));
      }
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/rpc/policy_acceptance_status')) return r.fulfill(json(state));
      if (url.includes('/rest/v1/rpc/accept_current_policies')) {
        log.accept.push(JSON.parse(req.postData() || '{}'));
        state.required = false;
        return r.fulfill(json({ required: false, missing: [] }));
      }
      if (url.includes('/rest/v1/pwa_events')) { log.pwa += 1; return r.fulfill(json([])); }
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });
    return { ctx, page, log };
  }

  const checkboxOf = (page) => page.locator('[data-policy-acceptance] [role="checkbox"]');

  await t.test('signup checkbox: unticked, both documents linked, exact Georgian wording', async () => {
    const { ctx, page } = await open({ lang: 'ka' });
    await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-policy-acceptance]', { timeout: 20000 });
    assert.equal(await checkboxOf(page).getAttribute('aria-checked'), 'false');
    const text = (await page.locator('[data-policy-acceptance]').innerText()).replace(/\s+/g, ' ').trim();
    assert.equal(text, 'გავეცანი და ვეთანხმები მომსახურების პირობებს და გავეცანი კონფიდენციალურობის პოლიტიკას.');
    const links = await page.locator('[data-policy-acceptance] a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.textContent]));
    assert.deepEqual(links, [['/terms', 'მომსახურების პირობებს'], ['/privacy', 'კონფიდენციალურობის პოლიტიკას']]);
    await ctx.close();
  });

  await t.test('email signup: refused without the tick, carries the versions with it', async () => {
    const { ctx, page, log } = await open();
    await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#password', { timeout: 20000 });
    await page.fill('#email', 'new@example.test');
    await page.fill('#password', 'Sup3rLongPassphrase');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#policy-acceptance-error', { timeout: 5000 });
    assert.match(await page.locator('#policy-acceptance-error').innerText(), /To continue registration, please read and agree to the Terms of Service\./);
    await page.waitForTimeout(500);
    assert.equal(log.signup.length, 0, 'no signup request may leave without acceptance');

    await checkboxOf(page).click();
    assert.equal(await page.locator('#policy-acceptance-error').count(), 0);
    await page.click('button[type="submit"]');
    for (let i = 0; i < 40 && !log.signup.length; i += 1) await page.waitForTimeout(100);
    assert.equal(log.signup.length, 1);
    assert.deepEqual(log.signup[0].data?.policy_acceptance, { ...VERSIONS, accepted: true });
    await ctx.close();
  });

  await t.test('Google sign-up from the signup page: refused without the tick, remembered with it', async () => {
    const { ctx, page, log } = await open();
    await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-policy-acceptance]', { timeout: 20000 });
    const google = page.getByRole('button', { name: /google/i });
    await google.click();
    await page.waitForSelector('#policy-acceptance-error', { timeout: 5000 });
    await page.waitForTimeout(500);
    assert.equal(log.authorize, 0, 'the provider flow must not start without acceptance');

    await checkboxOf(page).click();
    await google.click();
    for (let i = 0; i < 40 && !log.authorize; i += 1) await page.waitForTimeout(100);
    assert.equal(log.authorize, 1);
    const pre = await page.evaluate(() => sessionStorage.getItem('homatch_policy_preaccept'));
    assert.deepEqual(JSON.parse(pre), VERSIONS);
    await ctx.close();
  });

  await t.test('Google callback with the remembered tick: recorded as oauth_signup, never held', async () => {
    const { ctx, page, log } = await open({
      session: true,
      policy: { required: true, missing: ['privacy', 'terms'] },
      init: { session: { homatch_policy_preaccept: JSON.stringify(VERSIONS) } },
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 60 && !log.accept.length; i += 1) await page.waitForTimeout(100);
    assert.equal(log.accept.length, 1);
    assert.deepEqual(log.accept[0], { p_versions: VERSIONS, p_source: 'oauth_signup' });
    await page.waitForTimeout(800);
    assert.notEqual(new URL(page.url()).pathname, '/auth/accept-policies');
    await ctx.close();
  });

  await t.test('Google sign-up without a tick (e.g. from the login page): held until it accepts', async () => {
    const { ctx, page, log } = await open({ session: true, policy: { required: true, missing: ['privacy', 'terms'] } });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/auth/accept-policies', { timeout: 20000 });
    await page.waitForSelector('[data-policy-acceptance]');
    // Every other product address bounces back while acceptance is owed.
    await page.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/auth/accept-policies', { timeout: 20000 });
    // The documents themselves stay readable.
    await page.goto(`${BASE}/terms`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    assert.equal(new URL(page.url()).pathname, '/terms');
    await page.goto(`${BASE}/auth/accept-policies`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-policy-acceptance]', { timeout: 20000 });

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForSelector('#policy-acceptance-error', { timeout: 5000 });
    assert.equal(log.accept.length, 0);
    await checkboxOf(page).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    for (let i = 0; i < 40 && !log.accept.length; i += 1) await page.waitForTimeout(100);
    assert.equal(log.accept.length, 1);
    assert.deepEqual(log.accept[0].p_versions, VERSIONS);
    assert.equal(log.accept[0].p_source, 'onboarding');
    await page.waitForFunction(() => location.pathname !== '/auth/accept-policies', null, { timeout: 10000 });
    await ctx.close();
  });

  await t.test('an existing login that owes nothing is never redirected', async () => {
    const { ctx, page } = await open({ session: true, policy: { required: false, missing: [] } });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    assert.notEqual(new URL(page.url()).pathname, '/auth/accept-policies');
    await ctx.close();
  });

  await t.test('cookie banner: nothing optional before a choice; reject as easy as accept; remembered', async () => {
    const { ctx, page, log } = await open();
    await page.goto(`${BASE}/cookies?consent=show`, { waitUntil: 'domcontentloaded' });
    const banner = page.locator('[data-cookie-consent]');
    await banner.waitFor({ timeout: 20000 });
    assert.equal(await banner.locator('h2').innerText(), 'Your privacy matters');
    await page.waitForTimeout(1500);
    assert.equal(log.pwa, 0, 'no analytics event before consent');
    assert.equal(await page.evaluate(() => localStorage.getItem('homatch_telemetry_id')), null);

    const accept = banner.getByRole('button', { name: 'Accept all' });
    const reject = banner.getByRole('button', { name: 'Reject optional' });
    const [a, r] = [await accept.boundingBox(), await reject.boundingBox()];
    assert.equal(Math.round(a.height), Math.round(r.height), 'Reject and Accept are the same height');
    assert.equal(await accept.getAttribute('class'), await reject.getAttribute('class'), 'Reject and Accept are styled identically');

    await banner.getByRole('button', { name: 'Settings' }).click();
    const switches = banner.locator('[role="switch"]');
    assert.equal(await switches.count(), 3);
    assert.deepEqual(await switches.evaluateAll((s) => s.map((x) => [x.getAttribute('aria-checked'), x.hasAttribute('disabled')])),
      [['true', true], ['false', false], ['false', false]], 'necessary locked on; optional start off');

    await banner.getByRole('button', { name: 'Reject optional' }).click();
    await banner.waitFor({ state: 'detached' });
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(stored.analytics, false);
    assert.equal(stored.marketing, false);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-cookie-consent]').count(), 0, 'a returning visitor is not asked again');

    // Footer → Cookie settings reopens it on the settings view; change and save.
    await page.getByRole('button', { name: 'Cookie settings' }).first().click();
    await banner.waitFor({ timeout: 5000 });
    await banner.locator('[role="switch"]').nth(1).click();
    await banner.getByRole('button', { name: 'Save choices' }).click();
    const changed = JSON.parse(await page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(changed.analytics, true);
    assert.equal(changed.marketing, false);
    await ctx.close();
  });

  await t.test('cookie banner: Accept all, Georgian copy, Hebrew mirrored, footer links', async () => {
    const ka = await open({ lang: 'ka' });
    await ka.page.goto(`${BASE}/cookies?consent=show`, { waitUntil: 'domcontentloaded' });
    const banner = ka.page.locator('[data-cookie-consent]');
    await banner.waitFor({ timeout: 20000 });
    assert.equal(await banner.locator('h2').innerText(), 'თქვენი კონფიდენციალურობა მნიშვნელოვანია');
    for (const label of ['ყველას მიღება', 'არასავალდებულოების უარყოფა', 'პარამეტრები']) {
      assert.equal(await banner.getByRole('button', { name: label }).count(), 1, label);
    }
    for (const label of ['მომსახურების პირობები', 'კონფიდენციალურობის პოლიტიკა', 'ქუქიების პოლიტიკა', 'ქუქიების პარამეტრები']) {
      assert.ok(await ka.page.locator('footer').getByRole('button', { name: label, exact: true }).count() >= 1, `footer: ${label}`);
    }
    await banner.getByRole('button', { name: 'ყველას მიღება' }).click();
    const stored = JSON.parse(await ka.page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(stored.analytics && stored.marketing, true);
    await ka.ctx.close();

    const he = await open({ lang: 'he' });
    await he.page.goto(`${BASE}/cookies?consent=show`, { waitUntil: 'domcontentloaded' });
    const heBanner = he.page.locator('[data-cookie-consent]');
    await heBanner.waitFor({ timeout: 20000 });
    assert.equal(await heBanner.getAttribute('dir'), 'rtl');
    const overflow = await he.page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(overflow, false, 'banner causes no horizontal overflow');
    await he.ctx.close();
  });
});
