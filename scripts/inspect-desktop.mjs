// RENDER A CUSTOMER SURFACE AT A DESKTOP VIEWPORT AND LOOK AT IT.
//
// The mobile matrix answers one question — does anything overflow at 320/360/390/430 —
// and it is the wrong tool for the question "is this a well-composed desktop page".
// A page can pass every overflow assertion and still be a mobile layout stretched onto
// a large screen, which is exactly what happened here twice: first a 250px tile in a
// 1920px canvas, then a single row consuming almost the entire content width.
//
// So this is the other gate. It boots the same harness build, stubs the same world, and
// renders at a real desktop size with a CHOSEN NUMBER OF PROPERTIES — because the whole
// reason the second attempt was oversized is that the database contains one row and the
// layout was tuned to make that one row look balanced.
//
//   node scripts/inspect-desktop.mjs                 1, 3 and 10 at 1440x900
//   node scripts/inspect-desktop.mjs --counts 3      just the density case
//   node scripts/inspect-desktop.mjs --width 1920 --lang ka
//
// It reports measurements as well as writing PNGs, so "the row is too tall" is a number
// rather than an impression: row height, rows visible above the fold, the share of the
// content region the canvas uses, and whether anything overflows.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', 900));
const LANG = arg('lang', 'en');
const ROUTE = arg('route', '/property');
const COUNTS = arg('counts', '1,3,10').split(',').map((n) => Number(n.trim())).filter(Boolean);
const OUT = join(ROOT, '.inspect');

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
  const candidates = [
    process.env.PLAYWRIGHT_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

const driver = resolvePlaywright();
if (!driver) {
  console.error('browser driver missing — run: npm run test:mobile:setup');
  process.exit(1);
}
const chromePath = findChrome();
if (!chromePath) {
  console.error('Google Chrome not found — set PLAYWRIGHT_CHROME');
  process.exit(1);
}
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('no build in dist/ — run: npm run build:harness');
  process.exit(1);
}
const bundled = readdirSync(join(ROOT, 'dist', 'assets'))
  .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
  .some((f) => readFileSync(join(ROOT, 'dist', 'assets', f), 'utf8').includes('stubproj'));
if (!bundled) {
  console.error('dist/ is not the harness build — run: npm run build:harness');
  process.exit(1);
}

/*
 * pathToFileURL, NOT a raw path. On Windows a dynamic import of a drive path is
 * ERR_UNSUPPORTED_ESM_URL_SCHEME -- node reads "C:" as a protocol. The same trap as
 * turning a file: URL back into a path, in the other direction.
 */
const { propertyRows, matchRows } = await import(
  pathToFileURL(join(ROOT, 'tests', 'mobile', 'propertyFixture.mjs')).href
);

/** The same fake session the mobile harness uses. */
function fakeSession() {
  const claims = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'harness@example.test',
    role: 'authenticated', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: claims.exp,
    user: {
      id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated',
      app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
    },
  };
}

/**
 * A FLAT SVG, NOT A HAND-ROLLED PNG. The first attempt embedded base64 I wrote by
 * hand; it was not a valid PNG, every <img> fired onerror, and all three rows rendered
 * the no-photo placeholder -- which looks exactly like no stub at all. An SVG is text,
 * so it is correct by inspection. Browsers sniff the content type for <img>, so serving
 * it for a .webp URL is fine.
 */
const FLAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 36">'
  + '<rect width="64" height="36" fill="#5b6472"/>'
  + '<rect x="8" y="20" width="14" height="16" fill="#79828f"/>'
  + '<rect x="26" y="12" width="16" height="24" fill="#8d95a1"/>'
  + '<rect x="46" y="24" width="12" height="12" fill="#6d7583"/>'
  + '</svg>';

mkdirSync(OUT, { recursive: true });

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

for (const count of COUNTS) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  await ctx.addInitScript(
    ([key, session, locale]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
      window.localStorage.setItem('homatch_lang', locale);
    },
    ['sb-stubproj-auth-token', fakeSession(), LANG],
  );
  const page = await ctx.newPage();
  const json = (body, extra = {}) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', ...extra }, body: JSON.stringify(body),
  });

  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(BASE)) return r.continue();
    if (r.request().method() === 'OPTIONS') {
      return r.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/properties')) {
      /*
       * THE COUNT COMES BACK IN A HEADER, ALWAYS. The first version of this stub only
       * set content-range when it thought a count was being asked for, and the tab read
       * "Current 0" above three listed rows -- a fixture disagreeing with itself, which
       * is worse than no fixture. content-range is cheap and PostgREST sends it anyway.
       */
      const archived = url.includes('archived_at=not.is.null');
      const rows = archived ? [] : propertyRows(count);
      return r.fulfill({
        status: 206,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
          'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
        },
        body: JSON.stringify(rows),
      });
    }
    if (url.includes('/rest/v1/matches')) return r.fulfill(json(matchRows(count)));
    if (url.includes('/rest/v1/users')) {
      const row = {
        id: '77777777-7777-4777-8777-777777777777',
        auth_id: fakeSession().user.id,
        email: 'harness@example.test',
        full_name: 'Harness Customer',
        is_admin: false, role: 'SELLER', created_at: new Date().toISOString(),
      };
      const single = (r.request().headers()['accept'] ?? '').includes('pgrst.object');
      return r.fulfill(json(single ? row : [row]));
    }
    /*
     * A REAL IMAGE IN THE MEDIA AREA. Every unmatched request used to be answered with
     * JSON, so every <img> failed and all three rows rendered the no-photo placeholder
     * -- which makes the media column impossible to judge. A flat PNG is enough: this
     * inspection is about proportion, not photography.
     */
    if (/\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i.test(url)) {
      return r.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'access-control-allow-origin': '*' },
        body: FLAT_SVG,
      });
    }
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    if (url.includes('/functions/v1/')) return r.fulfill(json({}));
    return r.fulfill(json({}));
  });

  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('[class*="max-w-["]');
    const region = canvas?.parentElement ?? null;
    const rows = [...document.querySelectorAll('[class*="rounded-xl"], [data-slot="card"]')]
      .filter((el) => el.querySelector('h3'));
    const first = rows[0]?.getBoundingClientRect();
    const cr = canvas?.getBoundingClientRect();
    const rr = region?.getBoundingClientRect();
    return {
      rows: rows.length,
      rowHeight: first ? Math.round(first.height) : null,
      rowWidth: first ? Math.round(first.width) : null,
      canvasWidth: cr ? Math.round(cr.width) : null,
      regionWidth: rr ? Math.round(rr.width) : null,
      /* How many complete rows fit above the fold — the density question, answered. */
      rowsAboveFold: rows.filter((el) => el.getBoundingClientRect().bottom <= window.innerHeight)
        .length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  const file = join(OUT, `${ROUTE.replace(/\W+/g, '-')}-${count}-${WIDTH}x${HEIGHT}-${LANG}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.push({ count, ...measured, file });
  await ctx.close();
}

await browser.close();
preview.kill();

console.log(`\n${ROUTE} at ${WIDTH}x${HEIGHT}, locale ${LANG}\n`);
for (const row of report) {
  console.log(
    `  ${String(row.count).padStart(2)} properties  `
    + `rows=${row.rows} rowH=${row.rowHeight}px rowW=${row.rowWidth}px  `
    + `aboveFold=${row.rowsAboveFold}  `
    + `canvas=${row.canvasWidth}/${row.regionWidth}  `
    + `overflow=${row.overflow ? 'YES' : 'no'}`,
  );
  console.log(`      ${row.file}`);
}
