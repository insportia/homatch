// FIND PROPERTY → WHERE A RESULT CAME FROM, in a real browser.
//
// Against the harness build with find-property answered by a fixture shaped
// like production: a Telegram community post, a forum.ge post and a portal
// listing, plus a result whose stored links are unsafe. Checked at 1440px and
// 390px in all six locales (RTL for ar/he):
//   * one click opens the EXACT post / listing, in a new tab with
//     noopener + noreferrer;
//   * channel / board, thread and author profile are links, author names and
//     the post as written (public contacts included) are visible;
//   * nothing that is not a real http(s) URL is ever a link;
//   * no horizontal overflow; the long post expands and collapses.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4356;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FIND_PROPERTY_QA_SHOTS || null;
const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 900000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'buyer@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'buyer@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'buyer@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Buyer', plan: 'FREE', created_at: new Date().toISOString() };

const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const TG_TEXT = 'Сдается 2-комн. квартира в Батуми, ул. Руставели 12, 65 м², 5 этаж, 700$ в месяц. '
  + 'Новый ремонт, вся техника, рядом с морем и парком. Долгосрочно, от 6 месяцев, депозит один месяц. '
  + 'Можно с животными по договорённости. Показы каждый день после 18:00.\n'
  + 'Звоните +995 599 12 34 56, WhatsApp wa.me/995599123456, @konttin';
const TG = 'https://t.me/moonlightbatumi2023/4521';
const FORUM_POST = 'https://forum.ge/?showtopic=33976335&view=findpost&p=14172410';
const LISTING = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-2-otaxiani-bina-vakeshi-36733497';

const result = (id, listing, attribution, extra = {}) => ({
  id, intentId: 'i1', score: 0.82, deal: 'RENT', roles: { demand: 'TENANT', supply: null },
  whyThisMatches: 'Batumi, rent under your budget, 2 rooms', agreed: ['CITY', 'BUDGET'], preferenceMisses: [], notStated: [],
  flexible: [], dimensions: {}, freshness: { publishedAt: ago(3), firstSeenAt: ago(3), lastVerifiedAt: null, listingAgeCeilingDays: 30, listingAgeCeilingBasis: 'ACTIVE' },
  listing: { id: `o-${id}`, title: listing.title, url: listing.url, city: 'batumi', district: null, transaction: 'RENT', propertyType: 'APARTMENT',
    areaSqm: 65, rooms: 2, bedrooms: 1, price: { amount: 700, currency: 'USD' }, language: 'ru', source: listing.source },
  attribution, supply: { role: null, broker: null }, ...extra,
});
const RESULTS = [
  result('tg', { title: 'Сдается 2-комн. квартира в Батуми', url: TG, source: 'telegram-community' }, {
    platform: 'TELEGRAM', sourceName: 'moonlightbatumi2023', sourceUrl: 'https://t.me/moonlightbatumi2023', threadUrl: null,
    permalink: TG, authorName: '@konttin', authorUrl: 'https://t.me/konttin', originalText: TG_TEXT }),
  result('forum', { title: 'ვყიდი ბინას ვაკეში', url: FORUM_POST, source: 'forum-community' }, {
    platform: 'FORUM', sourceName: 'forum.ge', sourceUrl: 'https://forum.ge/', threadUrl: 'https://forum.ge/?showtopic=33976335',
    permalink: FORUM_POST, authorName: 'kukurino', authorUrl: 'https://forum.ge/?showuser=90411',
    originalText: 'ვყიდი ბინას ვაკეში, 85 მ², 120 000 $. ტელ: 599 12 34 56' }),
  result('portal', { title: 'იყიდება 2 ოთახიანი ბინა ვაკეში', url: LISTING, source: 'ss-ge' }, {
    platform: 'PORTAL', sourceName: 'home.ss.ge', sourceUrl: 'https://home.ss.ge/', threadUrl: null,
    permalink: LISTING, authorName: null, authorUrl: null, originalText: null }),
  result('unsafe', { title: 'Unsafe stored links', url: "javascript:alert('x')", source: 'telegram-community' }, {
    platform: 'TELEGRAM', sourceName: 'evil', sourceUrl: 'javascript:void(0)', threadUrl: 'data:text/html,x',
    permalink: 'signal:abc', authorName: '@someone', authorUrl: "javascript:paste('x')", originalText: 'short text' }),
];

async function boot(t, { width = 1440, height = 900, lang = 'en' } = {}) {
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
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    if (url.includes('/functions/v1/find-property')) {
      return r.fulfill(json({ success: true, searches: 1, state: 'HAS_RESULTS', results: RESULTS, elapsedMs: 12 }));
    }
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page };
}

async function open(page) {
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`a[href="${TG}"]`, { timeout: 30000 });
}

const anchors = (page) => page.$$eval('main a[href], article a[href]', (as) => as.map((a) => ({
  href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '', text: a.textContent?.trim() ?? '',
})));

test('one click to the exact source, with channel, thread, author and the post as written', opts, async (t) => {
  const { page } = await boot(t);
  await open(page);
  const links = await anchors(page);
  const find = (href) => links.find((l) => l.href === href);
  for (const href of [TG, 'https://t.me/moonlightbatumi2023', 'https://t.me/konttin', FORUM_POST,
    'https://forum.ge/?showtopic=33976335', 'https://forum.ge/?showuser=90411', LISTING, 'https://home.ss.ge/']) {
    const link = find(href);
    assert.ok(link, `link to ${href}`);
    assert.equal(link.target, '_blank', `${href} opens in a new tab`);
    assert.match(link.rel, /noopener/);
    assert.match(link.rel, /noreferrer/);
  }
  assert.equal(find('https://t.me/konttin').text, '@konttin');
  assert.equal(find('https://forum.ge/?showuser=90411').text, 'kukurino');
  assert.ok(links.some((l) => l.href === TG && /Open original post/.test(l.text)), 'the action names the post');
  assert.ok(links.some((l) => l.href === LISTING && /Open original listing/.test(l.text)));
  for (const l of links) assert.match(l.href, /^https?:\/\//, `never a non-web link: ${l.href}`);
  const body = await page.textContent('main');
  assert.match(body, /\+995 599 12 34 56/, 'public contacts in the post are shown as written');
  assert.match(body, /@someone/, 'an unsafe profile link is shown as text, not dropped');

  const toggle = page.getByRole('button', { name: 'Show full text' });
  await toggle.click();
  assert.equal(await page.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded'), 'true');
});

test('1440px and 390px, six locales: attribution present, no non-web link, no horizontal overflow', opts, async (t) => {
  const failures = [];
  for (const width of [1440, 390]) {
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang });
      await open(page);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dir: document.documentElement.getAttribute('dir'),
      }));
      if (layout.overflow > 1) failures.push(`${lang} ${width}: horizontal overflow ${layout.overflow}px`);
      if (['ar', 'he'].includes(lang) && layout.dir !== 'rtl') failures.push(`${lang}: not RTL`);
      const links = await anchors(page);
      for (const href of [TG, FORUM_POST, LISTING, 'https://t.me/konttin', 'https://forum.ge/?showuser=90411']) {
        if (!links.some((l) => l.href === href)) failures.push(`${lang} ${width}: missing ${href}`);
      }
      for (const l of links) if (!/^https?:\/\//.test(l.href)) failures.push(`${lang} ${width}: non-web link ${l.href}`);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `find-property-attribution-${width}-${lang}.png`), fullPage: true });
      }
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});
