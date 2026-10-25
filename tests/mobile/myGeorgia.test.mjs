// MY GEORGIA BY HOMI — the five-step onboarding and the dashboard, in a real browser.
//
// What this proves, on the harness build with a stateful stub of the owner's
// expat_profiles row:
//   · the owner-approved Georgian copy renders exactly;
//   · name and email are prefilled from the account, the email is read-only;
//   · a question shows only when it applies (rent vs purchase budget, arrival);
//   · every change autosaves, and reopening resumes at the saved step;
//   · the last step marks the profile complete with the private note kept on
//     the owner's row only;
//   · signed out, answers wait on the device and the last step leads to sign up;
//   · For Expats opens My Georgia: the welcome without a finished profile, the
//     dashboard with one; Later leads into My Georgia; the guide and the places
//     tabs are full, never empty;
//   · 320/375/390/430px, Georgian, Arabic and Hebrew (RTL): no sideways scroll,
//     44px touch targets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4401;
const BASE = `http://127.0.0.1:${PORT}`;

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
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}
const skipReason = haveDeps();
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900000 };

const UID = '00000000-0000-4000-8000-000000000001';
function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp, email: 'nino@example.test', aud: 'authenticated' })}.stub`;
  return { access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'nino@example.test', app_metadata: {}, user_metadata: {} } };
}
const PROFILE = { id: UID, auth_id: UID, email: 'nino@example.test', full_name: 'Nino Beridze', is_admin: false, role: 'user',
  preferred_language: 'ka', plan: 'FREE', created_at: new Date().toISOString() };

/* Owner-approved Georgian, verbatim. */
const KA = {
  welcome: 'საქართველოში თქვენი ახალი ეტაპი იწყება',
  start: 'დაწყება',
  s1: 'თქვენი ინფორმაცია',
  emailHelper: 'ელფოსტა ავტომატურად შევსებულია თქვენი ანგარიშიდან.',
  s2: 'რა გაინტერესებთ საქართველოში?',
  buy: 'შეძენა',
  rent: 'ქირაობა',
  budget100: '$100,000-მდე',
  s3: 'რა გეგმები გაქვთ საქართველოში?',
  arrival: 'როდის გეგმავთ ჩამოსვლას?',
  living: 'უკვე საქართველოში ვცხოვრობ',
  s4: 'რაში დაგეხმაროთ?',
  s5: 'კიდევ რისი ცოდნა დაეხმარება HOMI-ს?',
  create: 'ჩემი პროფილის შექმნა',
  success: 'თქვენი პროფილი მზადაა!',
  dash: 'ჩემი საქართველო',
  cont: 'გაგრძელება',
  skip: 'გამოტოვება',
};

test('My Georgia by HOMI: onboarding, autosave, resume, conditional questions, dashboard', opts, async (t) => {
  if (skipReason) assert.fail(`My Georgia gate could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  /* One stateful row, as the owner's RLS would return it. */
  const store = { row: null, writes: [] };
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });

  async function open(path, { width = 375, lang = 'ka', signedIn = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
    await ctx.addInitScript(([k, s, l, on]) => {
      if (on) window.localStorage.setItem(k, JSON.stringify(s)); else window.localStorage.removeItem(k);
      window.localStorage.setItem('homatch_lang', l);
    }, ['sb-stubproj-auth-token', fakeSession(), lang, signedIn]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.route('**', async (r) => {
      const req = r.request();
      const url = req.url();
      if (url.startsWith(BASE)) return r.continue();
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      const wantsObject = String(req.headers().accept || '').includes('vnd.pgrst.object');
      if (url.includes('/rest/v1/users')) return r.fulfill(json(wantsObject ? PROFILE : [PROFILE]));
      if (url.includes('/rest/v1/expat_profiles')) {
        if (req.method() === 'GET') return r.fulfill(json(wantsObject ? store.row : (store.row ? [store.row] : [])));
        const body = JSON.parse(req.postData() || '{}');
        const patch = Array.isArray(body) ? body[0] : body;
        store.writes.push({ method: req.method(), body: patch });
        store.row = { user_id: UID, ...(store.row ?? {}), ...patch };
        return r.fulfill(json(wantsObject ? store.row : [store.row], req.method() === 'POST' ? 201 : 200));
      }
      if (url.includes('/rest/v1/expat_tasks')) return r.fulfill(json([]));
      if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? null : []));
      return r.fulfill(json({}));
    });
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 50, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const text = (page) => page.evaluate(() => document.body.innerText);
  const layout = (page) => page.evaluate(() => {
    const small = [...document.querySelectorAll('[data-mg-step] button, [data-mg-welcome] a, [data-mg-welcome] button')]
      .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.height < 43.5);
    return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, small: small.length, dir: document.documentElement.dir };
  });
  const clickText = (page, s) => page.getByText(s, { exact: true }).first().click();
  const failures = [];

  /* 1 · Georgian, signed in, 375px: the whole flow. */
  {
    const { ctx, page, errors } = await open('/my-georgia/start');
    const body = await text(page);
    if (!body.includes(KA.welcome)) failures.push('the approved welcome title is not shown verbatim');
    await clickText(page, KA.start);
    await page.waitForTimeout(300);
    if (!(await text(page)).includes(KA.s1)) failures.push('step 1 did not open');
    const names = await page.$$eval('[data-mg-step] input:not([type=date]):not([role=combobox])', (els) => els.map((e) => e.value));
    if (names[0] !== 'Nino' || names[1] !== 'Beridze') failures.push(`name not prefilled from the account: ${JSON.stringify(names)}`);
    if (!names.includes('nino@example.test')) failures.push('email not prefilled');
    const ro = await page.$eval('input[aria-readonly="true"]', (e) => e.readOnly).catch(() => false);
    if (!ro) failures.push('the account email is editable');
    if (!(await text(page)).includes(KA.emailHelper)) failures.push('email helper missing');
    await page.click('input[role=combobox]');
    await page.keyboard.type('Germ');
    await page.waitForTimeout(200);
    await page.locator('[role=listbox] button').first().click();
    await clickText(page, KA.cont);
    await page.waitForTimeout(300);

    // Step 2: Continue needs a direction; budget depends on it.
    if (!(await text(page)).includes(KA.s2)) failures.push('step 2 did not open');
    const disabled = await page.getByText(KA.cont, { exact: true }).first().getAttribute('aria-disabled');
    if (disabled !== 'true') failures.push('step 2 continues without a direction');
    await page.getByRole('radio', { name: new RegExp(KA.rent) }).first().click();
    await page.waitForTimeout(200);
    let s2 = await text(page);
    if (s2.includes(KA.budget100)) failures.push('rent shows purchase budgets');
    if (!s2.includes('₾ GEL')) failures.push('rent offers no currency choice');
    await page.getByRole('radio', { name: new RegExp(KA.buy) }).first().click();
    await page.waitForTimeout(200);
    s2 = await text(page);
    if (!s2.includes(KA.budget100)) failures.push('purchase budgets missing for buying');
    await clickText(page, 'თბილისი');
    await clickText(page, KA.budget100);
    await page.waitForTimeout(1300); // autosave
    const saved2 = store.row;
    if (!saved2 || saved2.property_intent !== 'BUY' || !(saved2.cities || []).includes('TBILISI') || saved2.budget_band !== 'UP_TO_100K') {
      failures.push(`autosave did not keep step 2: ${JSON.stringify(saved2)?.slice(0, 200)}`);
    }
    if (saved2 && saved2.onboarding_step !== 2) failures.push(`resume step not saved (${saved2?.onboarding_step})`);
    const l = await layout(page);
    if (l.overflow) failures.push('375px: sideways scroll on step 2');
    if (l.small) failures.push(`375px: ${l.small} controls under 44px on step 2`);
    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
    await ctx.close();
  }

  /* 2 · Reopen: resumes at step 2 with the answers; finish the flow. */
  {
    const { ctx, page } = await open('/my-georgia/start');
    let body = await text(page);
    if (!body.includes(KA.s2)) failures.push('reopening did not resume at the saved step');
    const checked = await page.getByRole('radio', { name: new RegExp(KA.buy) }).first().getAttribute('aria-checked');
    if (checked !== 'true') failures.push('the saved direction was not restored');
    await clickText(page, KA.cont);
    await page.waitForTimeout(300);
    body = await text(page);
    if (!body.includes(KA.arrival)) failures.push('arrival is not asked of a newcomer');
    await clickText(page, KA.living);
    await page.waitForTimeout(200);
    if ((await text(page)).includes(KA.arrival)) failures.push('arrival is still asked of someone living here');
    await clickText(page, KA.cont);
    await page.waitForTimeout(300);
    if (!(await text(page)).includes(KA.s4)) failures.push('step 4 did not open');
    await clickText(page, KA.skip);
    await page.waitForTimeout(300);
    if (!(await text(page)).includes(KA.s5)) failures.push('skip did not reach step 5');
    await page.fill('textarea', 'ოჯახთან ერთად, სკოლები მაინტერესებს');
    await clickText(page, KA.create);
    await page.waitForTimeout(1500);
    if (!(await text(page)).includes(KA.success)) failures.push('the success screen did not appear');
    if (!store.row?.onboarding_completed_at) failures.push('the profile was not marked complete');
    if (store.row?.personal_notes !== 'ოჯახთან ერთად, სკოლები მაინტერესებს') failures.push('the private note was not kept on the owner row');
    if (store.row?.visit_status !== 'LIVING_HERE' || store.row?.arrival_date) failures.push('arrival saved for someone already living here');
    if (store.writes.some((w) => 'matching_intent_profile_id' in (w.body || {}))) failures.push('the client wrote the Matching link');
    await ctx.close();
  }

  /* 3 · The dashboard reads the saved profile. */
  {
    const { ctx, page } = await open('/my-georgia', { width: 390 });
    const body = await text(page);
    for (const s of [KA.dash, 'ჩემი ინფორმაცია', 'ჩემი გეგმები', 'უძრავი ქონება', 'დოკუმენტები', 'იურიდიული საკითხები', 'ყოველდღიური ცხოვრება', 'ქალაქების გზამკვლევი', 'ჩემი რეკომენდაციები', 'HOMI ასისტენტი']) {
      if (!body.includes(s)) failures.push(`dashboard section missing: ${s}`);
    }
    if (!body.includes('Nino')) failures.push('dashboard does not show the saved name');
    if (!body.includes('ამ სეზონზე წასასვლელად')) failures.push('the plan has no places for this season');
    const l = await layout(page);
    if (l.overflow) failures.push('390px: sideways scroll on the dashboard');
    await ctx.close();
  }

  /* 3b · For Expats opens My Georgia: with a finished profile, the dashboard. */
  {
    const { ctx, page } = await open('/for-expats/georgia', { width: 390 });
    await page.waitForTimeout(800);
    if (!page.url().endsWith('/my-georgia')) failures.push(`For Expats sent a profiled owner to ${page.url()} instead of My Georgia`);
    await ctx.close();
  }

  /* 3c · The places and the guide live inside My Georgia, full, in Georgian, at 320 and 390. */
  for (const width of [320, 390]) {
    const { ctx, page } = await open('/my-georgia?tab=places', { width });
    await page.waitForSelector('[data-place]', { timeout: 15000 }).catch(() => {});
    const n = await page.evaluate(() => document.querySelectorAll('[data-place]').length);
    if (n < 40) failures.push(`${width}px: Places in Georgia shows ${n} places`);
    const body = await text(page);
    for (const s of ['ადგილები საქართველოში', 'მთები', 'ზღვა და პლაჟები', 'მღვიმეები და კანიონები', 'ყაზბეგი, სტეფანწმინდა']) {
      if (!body.includes(s)) failures.push(`${width}px places: missing ${s}`);
    }
    await page.getByRole('button', { name: /^ზამთარი/ }).first().click();
    await page.waitForTimeout(300);
    const winter = await page.evaluate(() => document.querySelectorAll('[data-place]').length);
    if (!(winter > 0 && winter < n)) failures.push(`${width}px: the winter filter shows ${winter} of ${n}`);
    await page.locator('[data-place] button[aria-expanded]').first().click();
    await page.waitForTimeout(200);
    if (!(await text(page)).includes('როგორ მივიდეთ')) failures.push(`${width}px: a place card does not open its details`);
    const l = await layout(page);
    if (l.overflow) failures.push(`${width}px: sideways scroll on the places`);
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-places] button, [data-mg-tabs] a')]
      .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.height < 43.5).length);
    if (small) failures.push(`${width}px: ${small} places controls under 44px`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('/my-georgia?tab=guide', { width: 390 });
    if (!(await text(page)).includes('ცხოვრება საქართველოში, ნაბიჯ ნაბიჯ')) failures.push('the guide tab is empty');
    const l = await layout(page);
    if (l.overflow) failures.push('390px: sideways scroll on the guide');
    await ctx.close();
  }
  for (const lang of ['ar', 'he']) {
    const { ctx, page } = await open('/my-georgia?tab=places', { width: 375, lang });
    await page.waitForSelector('[data-place]', { timeout: 15000 }).catch(() => {});
    const l = await layout(page);
    if (l.overflow) failures.push(`375px ${lang}: sideways scroll on the places`);
    if (l.dir !== 'rtl') failures.push(`${lang}: the places are not right to left`);
    await ctx.close();
  }

  /* 4 · Widths and RTL on the first step. */
  for (const [width, lang] of [[320, 'ka'], [430, 'ka'], [375, 'ar'], [375, 'he'], [390, 'en']]) {
    store.row = { ...(store.row ?? {}), onboarding_step: 1, onboarding_completed_at: null };
    const { ctx, page } = await open('/my-georgia/start', { width, lang });
    const l = await layout(page);
    if (l.overflow) failures.push(`${width}px ${lang}: sideways scroll`);
    if (l.small) failures.push(`${width}px ${lang}: ${l.small} controls under 44px`);
    if ((lang === 'ar' || lang === 'he') && l.dir !== 'rtl') failures.push(`${lang}: the page is not right to left`);
    await ctx.close();
  }

  /* 5a · Signed out: For Expats starts with the welcome, and Later leads into My Georgia. */
  {
    const { ctx, page } = await open('/for-expats/georgia', { signedIn: false });
    if (!page.url().includes('/my-georgia/start')) failures.push(`signed out: For Expats went to ${page.url()}`);
    if (!(await text(page)).includes(KA.welcome)) failures.push('signed out: For Expats did not start with the welcome');
    await clickText(page, 'მოგვიანებით');
    await page.waitForTimeout(700);
    if (!page.url().endsWith('/my-georgia')) failures.push(`signed out: Later went to ${page.url()}`);
    const body = await text(page);
    if (body.includes('ჩემი ინფორმაცია')) failures.push('signed out: personal sections render for a guest');
    if (!body.includes('ადგილები') || !body.includes('იურიდიული საკითხები')) failures.push('signed out: My Georgia is empty for a guest');
    await ctx.close();
  }

  /* 5 · Signed out: answers wait on the device, the last step leads to sign up. */
  {
    const { ctx, page } = await open('/my-georgia/start', { signedIn: false });
    await clickText(page, KA.start);
    await page.waitForTimeout(300);
    await page.locator('[data-mg-step] input').first().fill('Ana');
    await clickText(page, KA.cont);
    await page.waitForTimeout(200);
    await page.getByRole('radio', { name: new RegExp(KA.buy) }).first().click();
    await page.waitForTimeout(1200);
    const draft = await page.evaluate(() => window.localStorage.getItem('homatch.myGeorgia.draft.v1'));
    if (!draft || !draft.includes('"propertyIntent":"BUY"')) failures.push('signed out: the answers were not kept on the device');
    for (let i = 0; i < 3; i += 1) { await clickText(page, KA.cont).catch(() => {}); await page.waitForTimeout(200); }
    await clickText(page, KA.create);
    await page.waitForTimeout(800);
    if (!page.url().includes('/auth/signup')) failures.push(`signed out: the last step went to ${page.url()} instead of sign up`);
    await ctx.close();
  }

  assert.deepEqual(failures, [], `My Georgia is broken:\n  ${failures.join('\n  ')}`);
});
