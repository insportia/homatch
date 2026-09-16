// A SCREENSHOT SWEEP OF EVERY DEVELOPER SURFACE.
//
// Not a gate — it asserts nothing. It drives the seeded harness workspace
// through every Developer screen, saves a full-page PNG at each width, and
// prints the measurements that tell you whether a page is sparse: how much of
// the viewport carries content, how many words are on it, how tall the tallest
// empty gap is, and what the largest text on the page actually is.
//
// Run: node tests/browser/devScreens.mjs [outDir]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeBackend } from './devBackend.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = 4191;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.argv[2] ?? path.join(ROOT, 'dev-screens');
const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440').split(',').map(Number);

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find(existsSync);

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'u1', role: 'authenticated', exp, email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: 'u1', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/* What "sparse" means, measured rather than felt: the share of the first
   screenful that any element actually paints on, the number of words, and the
   tallest vertical run with nothing in it. */
const PROBE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const main = document.querySelector('main') ?? document.body;
  const words = (main.innerText || '').trim().split(/\s+/).filter(Boolean).length;

  const boxes = [];
  for (const el of document.querySelectorAll('main *, [data-shell] *')) {
    if (el.children.length) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 2 && r.height > 2 && r.top < vh && r.bottom > 0) {
      boxes.push([Math.max(0, r.top), Math.min(vh, r.bottom)]);
    }
  }
  boxes.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let biggestGap = 0;
  let cursor = 0;
  for (const [top, bottom] of boxes) {
    if (top > cursor) { biggestGap = Math.max(biggestGap, top - cursor); covered += 0; }
    if (bottom > cursor) { covered += bottom - Math.max(top, cursor); cursor = Math.max(cursor, bottom); }
  }
  biggestGap = Math.max(biggestGap, vh - cursor);

  const sizes = [...document.querySelectorAll('main h1, main h2, main h3')]
    .map((h) => ({ t: h.innerText.trim().slice(0, 40), px: Math.round(parseFloat(getComputedStyle(h).fontSize)) }))
    .filter((h) => h.t);

  return {
    vw,
    vh,
    scrollH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > vw + 1,
    words,
    verticalCoverage: Math.round((covered / vh) * 100),
    biggestGap: Math.round(biggestGap),
    images: document.querySelectorAll('main img, main canvas, main svg[data-chart]').length,
    canvases: document.querySelectorAll('canvas').length,
    tables: document.querySelectorAll('main table').length,
    rows: document.querySelectorAll('main tbody tr').length,
    cards: document.querySelectorAll('main [class*="rounded-lg"], main [class*="rounded-xl"]').length,
    buttons: document.querySelectorAll('main button, main a[href]').length,
    headings: sizes.slice(0, 4),
  };
};

const SCREENS = [
  ['home', '/developers/home'],
  ['projects', '/developers/projects'],
  ['project', '/developers/projects/:project'],
  ['project-twin', '/developers/projects/:project?view=twin'],
  ['project-table', '/developers/projects/:project?view=table'],
  ['contacts', '/developers/contacts'],
  ['sales', '/developers/sales'],
  ['viewings', '/developers/sales/viewings'],
  ['reservations', '/developers/sales/reservations'],
  ['offers', '/developers/sales/offers'],
  ['contracts', '/developers/sales/contracts'],
  ['commissions', '/developers/sales/commissions'],
  ['handover', '/developers/sales/handover'],
  ['payments', '/developers/sales/payments'],
  ['ledger', '/developers/sales/ledger'],
  ['documents', '/developers/documents'],
  ['marketing', '/developers/marketing'],
  ['insights', '/developers/insights'],
  ['settings', '/developers/settings'],
  ['exports', '/developers/settings/exports'],
  ['audit', '/developers/settings/audit'],
  ['studio', '/studio'],
];

const backend = makeBackend({ demo: true });
mkdirSync(OUT, { recursive: true });

const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);
for (let i = 0; i < 80; i += 1) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const json = (b, status = 200, extra = {}) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...extra },
  body: JSON.stringify(b),
});

async function wire(page) {
  await page.route('**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE)) return route.continue();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
          'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range',
        },
      });
    }
    if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
    if (url.includes('/storage/v1/')) return route.fulfill(json({ Key: 'stub/path', path: 'stub/path' }));
    if (url.includes('/functions/v1/')) return route.fulfill(json({ state: 'EXTRACTED' }));

    const rpc = url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
    if (rpc) {
      let args = {};
      try { args = JSON.parse(req.postData() || '{}'); } catch { /* none */ }
      const h = backend.RPC[rpc[1]];
      if (!h) return route.fulfill(json(null));
      const out = h(args);
      if (out && out.__error) return route.fulfill(json({ message: out.__error, code: 'P0001' }, 400));
      return route.fulfill(json(out ?? null));
    }

    const rest = url.match(/\/rest\/v1\/([a-z0-9_]+)/i);
    if (!rest) return route.fulfill(json({}));
    const table = rest[1];
    const params = new URL(url).searchParams;
    const one = (req.headers().accept || '').includes('vnd.pgrst.object');
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (table === 'dev_sales_ledger') backend.refreshLedger();
      let rows = backend.select(table, params);
      const total = rows.length;
      const limit = Number(params.get('limit') ?? 0);
      const offset = Number(params.get('offset') ?? 0);
      if (limit) rows = rows.slice(offset, offset + limit);
      rows = backend.withEmbeds(rows, params.get('select'));
      if (one) {
        return rows.length
          ? route.fulfill(json(rows[0]))
          : route.fulfill(json({ message: 'no rows', code: 'PGRST116' }, 406));
      }
      return route.fulfill(json(rows, 200, {
        'content-range': `${offset}-${Math.max(offset + rows.length - 1, offset)}/${total}`,
      }));
    }
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const items = Array.isArray(body) ? body : [body];
      const made = items.map((item) => {
        const row = { id: backend.uuid(), created_at: backend.now(), updated_at: backend.now(), ...item };
        backend.db[table] = backend.db[table] ?? [];
        backend.db[table].push(row);
        return row;
      });
      return route.fulfill(one ? json(made[0], 201) : json(made, 201));
    }
    if (req.method() === 'PATCH') {
      const patch = JSON.parse(req.postData() || '{}');
      const rows = backend.select(table, params);
      for (const row of rows) Object.assign(row, patch, { updated_at: backend.now() });
      backend.refreshLedger();
      return route.fulfill(one ? json(rows[0] ?? null) : json(rows));
    }
    return route.fulfill(json([]));
  });
}

for (const width of WIDTHS) {
  const height = width >= 1900 ? 1080 : width >= 1400 ? 900 : 844;
  const mobile = width < 500;
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}),
  });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  await wire(page);

  console.log(`\n=== ${width}x${height} ===`);
  console.log('screen        cover%  gap  words  img  tbl rows cards btn  scrollH  h1');
  for (const [name, template] of SCREENS) {
    const url = template.replace(':project', backend.PROJECT);
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2800);
    const m = await page.evaluate(PROBE).catch(() => null);
    await page.screenshot({
      path: path.join(OUT, `${width}-${name}.png`), fullPage: true, timeout: 20000,
    }).catch(() => {});
    if (!m) { console.log(`${name.padEnd(13)} (probe failed)`); continue; }
    const h1 = m.headings[0] ? `${m.headings[0].px}px "${m.headings[0].t}"` : '(none)';
    console.log(
      `${name.padEnd(13)} ${String(m.verticalCoverage).padStart(5)}  ${String(m.biggestGap).padStart(4)}`
      + ` ${String(m.words).padStart(6)} ${String(m.images).padStart(4)} ${String(m.tables).padStart(4)}`
      + ` ${String(m.rows).padStart(4)} ${String(m.cards).padStart(5)} ${String(m.buttons).padStart(4)}`
      + ` ${String(m.scrollH).padStart(8)}  ${h1}${m.overflowX ? '  [OVERFLOW-X]' : ''}`,
    );
  }
  await ctx.close();
}

await browser.close();
server.kill();
console.log(`\nScreenshots in ${OUT}`);
