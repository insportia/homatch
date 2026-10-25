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

    await banner.getByRole('button', { name: 'Manage settings' }).click();
    assert.equal(await banner.locator('h2').innerText(), 'Cookie settings');
    assert.equal(await banner.locator('[data-always-active]').innerText(), 'Always active');
    const switches = banner.locator('[role="switch"]');
    assert.deepEqual(await switches.evaluateAll((s) => s.map((x) => [x.getAttribute('data-consent-category'), x.getAttribute('aria-checked')])),
      [['functional', 'false'], ['analytics', 'false'], ['marketing', 'false']], 'no optional category is pre-ticked');
    // Escape returns to the summary instead of dismissing without a choice.
    await page.keyboard.press('Escape');
    assert.equal(await banner.getByRole('button', { name: 'Manage settings' }).count(), 1);
    await banner.getByRole('button', { name: 'Manage settings' }).click();

    await banner.getByRole('button', { name: 'Reject optional' }).click();
    await banner.waitFor({ state: 'detached' });
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(stored.functional, false);
    assert.equal(stored.analytics, false);
    assert.equal(stored.marketing, false);
    assert.equal(stored.version, '2026-10-25');
    assert.ok(!Number.isNaN(Date.parse(stored.decidedAt)), 'the choice carries a timestamp');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-cookie-consent]').count(), 0, 'a returning visitor is not asked again');

    // Footer → Cookie settings reopens it on the settings view; change and save.
    await page.getByRole('button', { name: 'Cookie settings' }).first().click();
    await banner.waitFor({ timeout: 5000 });
    await banner.locator('[data-consent-category="analytics"]').click();
    await banner.getByRole('button', { name: 'Save choices' }).click();
    const changed = JSON.parse(await page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(changed.analytics, true);
    assert.equal(changed.functional, false);
    assert.equal(changed.marketing, false);
    await ctx.close();
  });

  await t.test('cookie banner: Accept all, Georgian copy, Hebrew mirrored, footer links', async () => {
    const ka = await open({ lang: 'ka' });
    await ka.page.goto(`${BASE}/cookies?consent=show`, { waitUntil: 'domcontentloaded' });
    const banner = ka.page.locator('[data-cookie-consent]');
    await banner.waitFor({ timeout: 20000 });
    assert.equal(await banner.locator('h2').innerText(), 'თქვენი კონფიდენციალურობა მნიშვნელოვანია');
    assert.equal(await banner.locator('p').first().innerText().then((x) => x.startsWith('ვიყენებთ აუცილებელ ქუქიებს HOMATCH-ის უსაფრთხო და გამართული მუშაობისთვის.')), true);
    for (const label of ['ყველას მიღება', 'არასავალდებულოების უარყოფა', 'პარამეტრების მართვა']) {
      assert.equal(await banner.getByRole('button', { name: label }).count(), 1, label);
    }
    for (const label of ['მომსახურების პირობები', 'კონფიდენციალურობის პოლიტიკა', 'ქუქიების პოლიტიკა', 'ქუქიების პარამეტრები']) {
      assert.ok(await ka.page.locator('footer').getByRole('button', { name: label, exact: true }).count() >= 1, `footer: ${label}`);
    }
    await banner.getByRole('button', { name: 'ყველას მიღება' }).click();
    const stored = JSON.parse(await ka.page.evaluate(() => localStorage.getItem('homatch_cookie_consent')));
    assert.equal(stored.functional && stored.analytics && stored.marketing, true);
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

  await t.test('legal center: operator from config, contents, numbering, no overflow, RTL', async () => {
    for (const [lang, path] of [['ka', '/terms'], ['en', '/privacy'], ['ar', '/cookies']]) {
      const { ctx, page } = await open({ lang });
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-legal-doc] h1', { timeout: 20000 });
      const body = await page.locator('[data-legal-doc]').innerText();
      assert.ok(body.includes('01027085016'), `${path}: identification number shown on the legal page`);
      if (lang === 'ka') {
        assert.ok(body.includes('ინდივიდუალური მეწარმე ტარიელი ჩაჩუა'), 'Georgian operator name');
        assert.ok(body.includes('რომელსაც მართავს ინდივიდუალური მეწარმე ტარიელი ჩაჩუა.'), 'approved 4.1 wording with the configured operator');
        for (const exact of [
          'HOMATCH მომხმარებლებს სთავაზობს უძრავ ქონებასთან დაკავშირებული ინტერესების ავტომატური შესაბამისობისა და ციფრული კომუნიკაციის მომსახურებას.',
          'შესაბამისობის გამოვლენის შემდეგ მომხმარებლებს შეუძლიათ ერთმანეთთან კომუნიკაცია HOMATCH-ის შიდა მიმოწერის სისტემის მეშვეობით.',
          'მომსახურების ფარგლებში, შესაბამისი სამართლებრივი საფუძვლის არსებობისას, მომხმარებლის რეგისტრირებული ელექტრონული ფოსტის მისამართი შეიძლება ხელმისაწვდომი გახდეს შესაბამისი მეორე მხარისთვის.',
          'მომხმარებლის ტელეფონის ნომერი არ წარმოადგენს სტანდარტული შესაბამისობის შედეგის ნაწილს და არ გადაეცემა სხვა მომხმარებლებს აღნიშნული მომსახურების ფარგლებში.',
          'HOMATCH იღებს წინასწარ განსაზღვრულ საფასურს ციფრული შესაბამისობისა და შუამავლობის მომსახურებისთვის და არა მომხმარებლის ტელეფონის ნომრის გაყიდვისთვის.',
        ]) assert.ok(body.includes(exact), `owner wording present: ${exact.slice(0, 40)}…`);
      } else {
        assert.ok(body.includes('Tariel Chachua'), `${lang}: operator name`);
      }
      assert.ok(!/\bLLC\b|შპს/.test(body), 'never described as an LLC');
      assert.ok(!/GDPR Certified|ISO 27001|Government Approved|100% legally/i.test(body), 'no certification claims');
      const overflow = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(overflow, false, `${lang} ${path}: no horizontal overflow`);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('dir') || getComputedStyle(document.body).direction), lang === 'ar' ? 'rtl' : 'ltr');
      // Mobile contents: a disclosure that jumps to a section.
      const toc = page.locator('details');
      await toc.locator('summary').click();
      const firstLink = toc.locator('a').nth(1);
      const target = (await firstLink.getAttribute('href')).slice(1);
      await firstLink.click();
      await page.waitForFunction((id) => location.hash === `#${id}`, target, { timeout: 5000 });
      assert.equal(await page.locator(`#${target} h2`).innerText().then((x) => /^2\./.test(x)), true, 'sections are numbered in order');
      await ctx.close();
    }
    // Profile → Security carries the legal links and the cookie settings control.
    const { ctx, page } = await open({ session: true });
    await page.goto(`${BASE}/terms`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-legal-doc]', { timeout: 20000 });
    const footer = await page.locator('footer').innerText();
    assert.ok(footer.includes('Tariel Chachua') && !footer.includes('01027085016'), 'footer names the operator but not the ID number');
    await ctx.close();
  });

  /**
   * A signed-in page whose REST reads come from fixtures, so a listing screen and the
   * seeker's match card can be driven without a database. Every rpc call is recorded.
   */
  async function openWithData({ lang = 'en', width = 390, tables = {}, rpc = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: width < 700 });
    await ctx.addInitScript(([s, locale]) => {
      localStorage.setItem('homatch_lang', locale);
      localStorage.setItem('sb-stubproj-auth-token', JSON.stringify(s));
    }, [fakeSession(), lang]);
    const page = await ctx.newPage();
    const calls = [];
    const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    await page.route('**', async (r) => {
      const req = r.request();
      const url = req.url();
      if (url.startsWith(BASE)) return r.continue();
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      const m = url.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/);
      if (m) {
        calls.push({ fn: m[1], body: JSON.parse(req.postData() || '{}') });
        if (m[1] === 'policy_acceptance_status') return r.fulfill(json({ required: false, missing: [] }));
        const fx = rpc[m[1]];
        return r.fulfill(json(typeof fx === 'function' ? fx(calls[calls.length - 1].body) : (fx ?? null)));
      }
      const tm = url.match(/\/rest\/v1\/([a-z_0-9]+)/);
      if (tm && req.method() === 'GET') {
        const rows = tables[tm[1]] ?? [];
        const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
        return r.fulfill(json(single ? (rows[0] ?? null) : rows));
      }
      /* A write answers with the row it touched, the way PostgREST does with select(). */
      if (tm) return r.fulfill(json((tables[tm[1]] ?? [{ id: 'ok' }]).slice(0, 1)));
      return r.fulfill(json({}));
    });
    return { ctx, page, calls };
  }

  const USER_ROW = { id: '00000000-0000-4000-8000-0000000000a1', auth_id: fakeSession().user.id, email: 'legal@example.test', full_name: 'Owner', phone: '+995599000001', preferred_language: 'en' };
  const PROPERTY_ROW = {
    id: '00000000-0000-4000-8000-0000000000c1', user_id: USER_ROW.id, title: 'Flat in Vake', homatch_id: 123456,
    transaction_type: 'SALE', property_type: 'APARTMENT', source_type: 'PRIVATE_LISTING', matching_status: 'ACTIVE',
    is_deleted: false, contact_phone_e164: '+995555123456', contact_phone_raw: '+995 555 123 456', contact_phone_country: 'GE',
    contact_phone_public: false, facts: [{ city: 'Tbilisi', total_price: 120000, currency: 'USD', area: 80 }], photos: [],
  };

  await t.test('listing contact: publication is an explicit, unticked choice saved through the server', async () => {
    for (const lang of ['ka', 'en', 'ar']) {
      /* English runs at desktop width: at 390px the app's bottom nav sits over the edit
         form's Save bar (pre-existing, reported separately), which blocks a real click. */
      const { ctx, page, calls } = await openWithData({
        lang, width: lang === 'en' ? 1280 : 390, tables: { users: [USER_ROW], properties: [PROPERTY_ROW] },
        rpc: { set_property_contact_publication: true, renew_property: { ok: true, renewed: false } },
      });
      await page.goto(`${BASE}/property/${PROPERTY_ROW.id}/edit`, { waitUntil: 'domcontentloaded' });
      const toggle = page.locator('#section-contact > button[aria-expanded]');
      await toggle.waitFor({ timeout: 20000 });
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      const box = page.locator('[data-contact-publish] input[type="checkbox"]');
      await box.waitFor({ timeout: 20000 });
      assert.equal(await box.isChecked(), false, `${lang}: an existing listing is not published by default`);
      const overflow = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);
      assert.equal(overflow, false, `${lang}: no horizontal overflow on the edit form`);
      if (lang === 'en') {
        // The listing number is what the field holds; the account phone is never put there.
        assert.equal(await page.locator('input[type="tel"]').inputValue(), '+995 555 123 456');
        await box.check();
        const save = page.getByRole('button', { name: 'Save changes' }).first();
        await save.scrollIntoViewIfNeeded();
        await save.click();
        for (let i = 0; i < 50 && !calls.some((c) => c.fn === 'set_property_contact_publication'); i += 1) await page.waitForTimeout(100);
        const call = calls.find((c) => c.fn === 'set_property_contact_publication');
        assert.deepEqual(call?.body, { p_property_id: PROPERTY_ROW.id, p_public: true }, 'the choice goes through the owner-only RPC');
      }
      await ctx.close();
    }
  });

  await t.test('seeker card: the published listing number with a working Call action; unpublished stays private', async () => {
    const ROW = {
      kind: 'MATCH', id: '00000000-0000-4000-8000-0000000000d1', role: 'SEEKER', property_id: PROPERTY_ROW.id, homatch_id: 123456,
      property_title: null, counterparty_name: 'Nino', match_score: 0.9, agreed: [], preference_misses: [], deal_kind: 'SALE',
      state: 'MATCHED', viewing_requested: false, has_conversation: false, updated_at: new Date().toISOString(),
      city: 'Tbilisi', district: 'Vake', property_type: 'APARTMENT', transaction_type: 'SALE', price: 120000, currency: 'USD', area: 80, rooms: 3, bedrooms: 2,
    };
    const cases = [[{ phone: '+995555123456', reason: null }, true], [{ phone: null, reason: 'NOT_PUBLISHED' }, false]];
    for (const [answer, expectPhone] of cases) {
      const { ctx, page, calls } = await openWithData({
        tables: { users: [USER_ROW] },
        rpc: { my_native_matches: [ROW], reveal_native_contact: answer },
      });
      await page.goto(`${BASE}/find-property?tab=searches`, { waitUntil: 'domcontentloaded' });
      const actions = page.locator('[data-native-actions]').first();
      await actions.waitFor({ timeout: 20000 });
      // No number is shipped to the page before Call is pressed.
      assert.equal(await page.locator('a[href^="tel:"]').count(), 0);
      await actions.locator('button').nth(1).click();
      for (let i = 0; i < 50 && !calls.some((c) => c.fn === 'reveal_native_contact'); i += 1) await page.waitForTimeout(100);
      await page.waitForTimeout(300);
      if (expectPhone) {
        const tel = page.locator('[data-native-phone] a[href^="tel:"]');
        assert.equal(await tel.getAttribute('href'), 'tel:+995555123456', 'Call dials the listing number');
        assert.ok(!(await page.content()).includes('+995599000001'), 'the account phone never appears');
      } else {
        assert.equal(await page.locator('a[href^="tel:"]').count(), 0);
        assert.match(await page.locator('[role="status"]').last().innerText(), /chosen to show a phone number/);
      }
      await ctx.close();
    }
  });
});
