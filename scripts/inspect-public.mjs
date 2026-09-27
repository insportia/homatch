// RENDER THE PUBLIC SITE, SIGNED OUT, AND LOOK AT IT.
//
// inspect-desktop.mjs injects a session because it looks at the customer app.
// The public site is the opposite case: what a visitor with no account sees.
// So this boots the same harness build (stubbed Supabase, see .env.harness),
// answers every backend request with an empty result, sets NO session, and
// writes one PNG per route x width x locale into .inspect/public/.
//
//   node scripts/inspect-public.mjs                              home, every width, every locale
//   node scripts/inspect-public.mjs --routes /,/pricing --widths 390 --langs ka
//   node scripts/inspect-public.mjs --menu                       also open the mobile menu
//   node scripts/inspect-public.mjs --full                       full-page screenshots
//
// It prints horizontal overflow per shot, so "nothing sticks out" is a
// measurement rather than an impression — but the point is the PNGs.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4190;
const BASE = `http://127.0.0.1:${PORT}`;

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const ROUTES = arg('routes', '/').split(',');
const WIDTHS = arg('widths', '1440,1024,430,390,360,320').split(',').map(Number);
const LANGS = arg('langs', 'ka,en,ru,tr,ar,he').split(',');
const MENU = flag('menu');
const FULL = flag('full');
const OUT = join(ROOT, '.inspect', 'public');

function resolvePlaywright() {
  for (const candidate of [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean)) {
    try { return require(candidate); } catch { /* next */ }
  }
  return null;
}

function findChrome() {
  return [
    process.env.PLAYWRIGHT_CHROME,
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find((c) => existsSync(c)) ?? null;
}

const driver = resolvePlaywright();
if (!driver) { console.error('browser driver missing — run: npm run test:mobile:setup'); process.exit(1); }
const chromePath = findChrome();
if (!chromePath) { console.error('Chrome not found — set PLAYWRIGHT_CHROME'); process.exit(1); }
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('no dist/ — run: npm run build:harness'); process.exit(1); }
const harness = readdirSync(join(ROOT, 'dist', 'assets'))
  .filter((f) => f.endsWith('.js'))
  .some((f) => readFileSync(join(ROOT, 'dist', 'assets', f), 'utf8').includes('stubproj'));
if (!harness) { console.error('dist/ is not the harness build — run: npm run build:harness'); process.exit(1); }

mkdirSync(OUT, { recursive: true });

/*
 * The site's faces come from Google Fonts. Chrome here cannot reach it, so
 * the stylesheet and its files are fetched once into .inspect/fonts (curl,
 * which goes through the proxy) and served from there:
 *
 *   curl -A '<chrome UA>' '<the @import url in src/index.css>' -o .inspect/fonts/fonts.css
 *   then each fonts.gstatic.com URL in it, saved with '/' replaced by '_'.
 *
 * Absent the cache the shots still render, in fallback faces.
 */
const FONT_DIR = join(ROOT, '.inspect', 'fonts');
const FONTS = existsSync(join(FONT_DIR, 'fonts.css'))
  ? { dir: FONT_DIR, css: readFileSync(join(FONT_DIR, 'fonts.css'), 'utf8') }
  : null;

const preview = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);
process.on('exit', () => preview.kill());
for (let i = 0; i < 80; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const browser = await driver.chromium.launch({ executablePath: chromePath, headless: true });
const report = [];

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    const mobile = width < 768;
    const ctx = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
      // Reveal shows everything at once under reduced motion, so a
      // full-page capture is the page rather than a column of blanks.
      reducedMotion: FULL ? 'reduce' : 'no-preference',
    });
    await ctx.addInitScript((locale) => {
      try { window.localStorage.setItem('homatch_lang', locale); } catch { /* none */ }
    }, lang);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));

    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(BASE)) return r.continue();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      // Real type, from a local cache (see FONTS below): a screenshot in a
      // fallback face says nothing about how the page actually reads.
      if (url.startsWith('https://fonts.googleapis.com/') && FONTS) {
        return r.fulfill({ status: 200, contentType: 'text/css', headers: cors, body: FONTS.css });
      }
      if (url.startsWith('https://fonts.gstatic.com/') && FONTS) {
        const file = join(FONTS.dir, url.replace('https://fonts.gstatic.com/', '').replace(/\//g, '_'));
        if (existsSync(file)) return r.fulfill({ status: 200, contentType: 'font/woff2', headers: cors, body: readFileSync(file) });
      }
      if (url.includes('stubproj.supabase.co')) {
        if (url.includes('/auth/v1/')) return r.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: '{}' });
        const body = url.includes('/rest/v1/') ? '[]' : '{}';
        return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
    });

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      const name = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\W+/g, '-');
      const measure = () => page.evaluate(() => ({
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      if (FULL) {
        // Reveal waits for a scroll; walk the page so every section is shown.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 500) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(700);
      }
      const file = join(OUT, `${name}-${width}-${lang}${FULL ? '-full' : ''}.png`);
      await page.screenshot({ path: file, fullPage: FULL });
      report.push({ route, width, lang, ...(await measure()), file });
      if (FULL) {
        // A 12,000px image shrinks to illegibility when viewed; slices do not.
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        const slice = mobile ? 1400 : 1800;
        for (let y = 0, n = 0; y < height; y += slice, n += 1) {
          await page.screenshot({
            path: join(OUT, `${name}-${width}-${lang}-part${n}.png`),
            fullPage: true,
            clip: { x: 0, y, width, height: Math.min(slice, height - y) },
          });
        }
      }

      if (MENU && width < 1024) {
        const toggle = page.locator('[data-hm-menu-toggle]');
        if (await toggle.count()) {
          await toggle.first().click();
          await page.waitForTimeout(450);
          const menuFile = join(OUT, `${name}-${width}-${lang}-menu.png`);
          await page.screenshot({ path: menuFile });
          const a11y = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"][aria-modal="true"]');
            return {
              dialog: Boolean(d),
              focusInside: Boolean(d && d.contains(document.activeElement)),
              bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
            };
          });
          report.push({ route: `${route} [menu]`, width, lang, ...a11y, ...(await measure()), file: menuFile });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
    }
    if (errors.length) report.push({ route: 'ERRORS', width, lang, errors });
    await ctx.close();
  }
}

await browser.close();
preview.kill();

for (const row of report) {
  console.log(JSON.stringify(row));
}
