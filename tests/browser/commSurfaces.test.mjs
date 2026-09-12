// Authenticated browser sweep of every Communications surface.
//
// WHY THIS EXISTS
//
// Everything in this workstream had been verified by type-check, unit tests
// and reading. None of that can tell you whether a screen renders, whether a
// translation key leaked through as `comm_billing_title`, whether a card
// overflows at 320px, or whether the Arabic build actually flips. Those are
// browser facts and they need a browser.
//
// HOW IT IS AUTHENTICATED WITHOUT A PRODUCTION CREDENTIAL
//
// It is not an auth bypass. Nothing in src/ knows this file exists, and no
// production code path is weakened — `tests/browser/harnessIsolation.test.mjs`
// fails the build if that ever stops being true.
//
// The mechanism is the one tests/mobile/ already established: the harness
// build (`npm run build:harness`) is the ORDINARY bundle, pointed by
// .env.harness at https://stubproj.supabase.co, an origin that does not
// resolve. Playwright intercepts every request to it and answers from
// tests/browser/commFixtures.mjs, and seeds localStorage with a session shaped
// the way supabase-js persists one. So the real AuthContext, the real
// RouteGuard, the real AdminLayout admin check, the real
// services/communications.ts queries and the real page components all execute.
// Only the far side of the network is a fixture.
//
// That is also what makes the sweep possible at all while the Communications
// migration is deliberately unapplied: the tables do not exist in any
// database, but the code that reads them is exercised exactly as shipped.
//
// WHAT IT ASSERTS, AND WHY EACH ONE IS A REAL DEFECT
//
//   rendered        a surface that renders nothing is broken, and every other
//                   check on it would otherwise pass vacuously
//   leaked keys     `comm_billing_title` on screen means t() missed
//   overflow        a phone that scrolls sideways is a bug, not a preference
//   placeholders    "Coming soon" shipped to a customer is a lie
//   nameless ctrl    a button with no accessible name cannot be used or read out
//   provider names  "Cartesia" on a customer screen is our plumbing, not theirs
//   rtl             an Arabic build that does not flip is not localised

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { TABLES, FUNCTIONS, harnessSession, OWNER_ID } from './commFixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/*
 * Port 0 means "whatever is free".
 *
 * A fixed port is a shared resource, and a previous run that did not shut down
 * cleanly then fails the next one with EADDRINUSE — a red test that has
 * nothing to do with the product. The server reports the port it actually got
 * and BASE is built from that.
 */
let BASE = '';
const OUT = join(ROOT, '.tooling', 'comm-sweep');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

/* ── The surfaces, and what proves each one actually rendered ──────────────
 *
 * `anchor` is a selector that only exists once the page's own content is on
 * screen — not the shell. Without it a redirect to /auth/login would pass
 * every other check, because a login page has no overflow either.
 *
 * `customer` marks the screens a paying user sees. Those may not show raw
 * provider names; the admin screens exist precisely to show them.
 */
const SURFACES = [
  { id: 'overview',       path: '/outreach',                    customer: true,  anchor: 'main h1, [data-testid="comm-overview"]' },
  { id: 'agents',         path: '/outreach/agents',             customer: true,  anchor: 'main h1' },
  { id: 'agent-builder',  path: '/outreach/agents/ag-1',        customer: true,  anchor: 'main h1' },
  { id: 'campaigns',      path: '/outreach/campaigns',          customer: true,  anchor: 'main h1' },
  { id: 'campaign-new',   path: '/outreach/campaigns/new',      customer: true,  anchor: 'main h1' },
  { id: 'contact-import', path: '/outreach/contacts/import',    customer: true,  anchor: 'main h1' },
  { id: 'contact',        path: '/outreach/contacts/ct-1',      customer: true,  anchor: 'main h1' },
  { id: 'whatsapp',       path: '/outreach/whatsapp',           customer: true,  anchor: 'main h1' },
  { id: 'inbox',          path: '/outreach/whatsapp/inbox',     customer: true,  anchor: 'main h1' },
  { id: 'templates',      path: '/outreach/whatsapp/templates', customer: true,  anchor: 'main h1' },
  { id: 'numbers',        path: '/outreach/numbers',            customer: true,  anchor: 'main h1' },
  { id: 'analytics',      path: '/outreach/analytics',          customer: true,  anchor: 'main h1' },
  { id: 'call-center',    path: '/outreach/calls',              customer: true,  anchor: 'main h1' },
  { id: 'calls-log',      path: '/outreach/calls/log',          customer: true,  anchor: 'main h1' },
  { id: 'billing',        path: '/outreach/billing',            customer: true,  anchor: 'main h1' },
  { id: 'home-ai-talk',   path: '/',                            customer: true,  anchor: 'h1' },
  { id: 'admin-providers',path: '/admin/providers',             customer: false, anchor: 'h1' },
  { id: 'admin-settings', path: '/admin/settings',              customer: false, anchor: 'h1' },
  { id: 'admin-risk',     path: '/admin/risk',                  customer: false, anchor: 'h1' },
];

/** §9 of the continuation directive names these six for the phone and RTL pass. */
const NARROW_SURFACES = ['overview', 'agent-builder', 'campaign-new', 'inbox', 'billing', 'admin-providers'];
const WIDTHS = [430, 390, 375, 320];
const RTL_LANGS = ['ar', 'he'];
const LTR_LANGS = ['ka', 'ru', 'tr'];

/* ── Prerequisites ─────────────────────────────────────────────────────── */

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
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
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME to its path';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

/* ── The translation keys, so a leaked one can be recognised ───────────── */

function translationKeys() {
  const src = readFileSync(join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):\s*['"`]/gm)) keys.add(m[1]);
  return keys;
}

/*
 * Tokens that LOOK like a leaked key but are legitimately on screen.
 *
 * Each one is a real string a customer or admin is meant to read, not a
 * translation that failed. The list is short on purpose: anything added here
 * is a hole in the check, so it names why.
 */
const NOT_A_LEAK = new Set([
  'admin_settings',   // AdminSettingsPage names the table it writes to, deliberately
  'comm_voice_tuning', 'ai_talk_limits', 'ai_talk_enabled', // the same, on the voice panel
]);

/* ── The fixture backend ───────────────────────────────────────────────── */

function jsonBody(body) {
  return {
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' },
    body: JSON.stringify(body),
  };
}

/**
 * Answer one intercepted request from the fixtures.
 *
 * PostgREST semantics that actually matter here:
 *   - `Accept: application/vnd.pgrst.object+json` is how supabase-js asks for
 *     .single()/.maybeSingle(). Returning an array there makes the client
 *     throw, and the page renders its error state instead of its content —
 *     which is exactly how the first draft of this sweep "found" nine bugs
 *     that did not exist.
 *   - a filtered select still has to honour `id=eq.x`, or the agent builder
 *     opens the wrong agent and every assertion about it is meaningless.
 */
function answer(route, scenario) {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;

  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  }

  if (path.startsWith('/auth/v1/user')) return route.fulfill(jsonBody(harnessSession().user));
  if (path.startsWith('/auth/v1/token')) return route.fulfill(jsonBody(harnessSession()));
  if (path.startsWith('/auth/v1/')) return route.fulfill(jsonBody({}));

  if (path.startsWith('/functions/v1/')) {
    const fn = path.slice('/functions/v1/'.length).split('/')[0];
    return route.fulfill(jsonBody(FUNCTIONS[fn] ?? {}));
  }

  if (path.startsWith('/rest/v1/rpc/')) {
    // Every RPC this product calls returns a boolean-ish "did it" or a row
    // count; none of them feed a rendered list, so `true` is faithful.
    return route.fulfill(jsonBody(true));
  }

  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length).split('/')[0];
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      // Writes succeed and echo the body, which is what PostgREST does with
      // Prefer: return=representation, and what the optimistic UI expects.
      let echoed = {};
      try { echoed = JSON.parse(req.postData() || '{}'); } catch { echoed = {}; }
      const row = Array.isArray(echoed) ? echoed[0] : echoed;
      return route.fulfill(jsonBody([{ id: 'new-row', owner_id: OWNER_ID, ...row }]));
    }

    // `users` is the one table that must answer even in the empty scenario:
    // without it AdminLayout renders null and the admin surfaces "pass" by
    // being blank.
    const all = (scenario === 'empty' && table !== 'users' && table !== 'admin_settings')
      ? []
      : (TABLES[table] ?? []);

    let rows = all;
    for (const [key, raw] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const [op, ...rest] = String(raw).split('.');
      const value = rest.join('.');
      if (op === 'eq') rows = rows.filter((r) => String(r[key] ?? '') === value);
      else if (op === 'neq') rows = rows.filter((r) => String(r[key] ?? '') !== value);
      else if (op === 'in') {
        const set = new Set(value.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')));
        rows = rows.filter((r) => set.has(String(r[key] ?? '')));
      } else if (op === 'is') {
        rows = rows.filter((r) => (value === 'null' ? r[key] == null : r[key] != null));
      }
      // gte/lte on timestamps are left unfiltered on purpose: the fixture
      // window is minutes old, so every row is inside every window the UI
      // asks for, and filtering here would only risk emptying a screen for a
      // reason that has nothing to do with the code under test.
    }

    const limit = Number(url.searchParams.get('limit') ?? 0);
    if (limit > 0) rows = rows.slice(0, limit);

    const wantsObject = String(req.headers()['accept'] ?? '').includes('pgrst.object');
    if (wantsObject) return route.fulfill(jsonBody(rows[0] ?? null));
    return route.fulfill(jsonBody(rows));
  }

  // Anything unanticipated is answered emptily rather than reaching the
  // network, so the sweep can never depend on the outside world.
  return route.fulfill(jsonBody({}));
}

/* ── The in-page audit ─────────────────────────────────────────────────── */

const AUDIT = ({ vw, keys, notALeak, customer, providerWords, placeholderWords }) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  // Text as a reader sees it: only nodes that are actually painted.
  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent) continue;
    if (parent.closest('script, style, noscript')) continue;
    if (!visible(parent)) continue;
    const text = (n.nodeValue || '').trim();
    if (text) seen.push(text);
  }
  const allText = seen.join('\n');

  // A leaked key is a whole word that IS a translation key.
  const leaked = [];
  for (const m of allText.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    const token = m[0];
    if (notALeak.includes(token)) continue;
    if (keys.includes(token) && !leaked.includes(token)) leaked.push(token);
  }

  const lower = allText.toLowerCase();
  const placeholders = placeholderWords.filter((w) => lower.includes(w));
  const providers = customer ? providerWords.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)) : [];

  /*
   * Overflow.
   *
   * A wide table INSIDE a container that scrolls horizontally is the fix, not
   * the bug — ScrollTable exists precisely so a six-column table can be read
   * on a 320px phone without the page itself moving. So this skips any element
   * with a scrolling ANCESTOR, not merely elements that scroll themselves.
   * Without that it flags every table, thead, tr and th inside a working
   * scroll region, which is exactly what the first run did: eighteen reported
   * defects, every one of them the deliberate solution.
   *
   * What stays reportable is what actually hurts — content pushed past the
   * viewport with nothing to scroll it back.
   */
  const insideAScroller = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
    }
    return false;
  };

  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const s = getComputedStyle(el);
    if (insideAScroller(el)) continue;
    if (s.position === 'fixed') continue; // a drawer parked off-screen is not overflow
    if (r.right > vw + 1 || r.left < -1) {
      offenders.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 70), right: Math.round(r.right), left: Math.round(r.left), text: (el.textContent || '').trim().slice(0, 40) });
    }
  }

  // A control nobody can name is a control nobody can use — including a
  // screen reader, and including the person maintaining it.
  const nameless = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    if (!visible(el)) continue;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      || (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
    if (!name) nameless.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 70) });
  }

  return {
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    clientWidth: document.documentElement.clientWidth,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    textLength: allText.length,
    signedOut: /\/auth\/login/.test(location.pathname),
    leaked, placeholders, providers,
    offenders: offenders.slice(0, 6),
    nameless: nameless.slice(0, 6),
  };
};

const PROVIDER_WORDS = ['cartesia', 'vapi', 'twilio', 'deepgram', 'elevenlabs', 'bland', 'retell', 'openai'];
const PLACEHOLDER_WORDS = ['lorem ipsum', 'coming soon', 'todo:', 'tbd', 'placeholder text', 'under construction'];

/* ── The run ───────────────────────────────────────────────────────────── */

test('every Communications surface renders, translates, fits and flips', opts, async (t) => {
  if (skipReason) assert.fail(`the Communications browser sweep could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const keys = [...translationKeys()];
  const notALeak = [...NOT_A_LEAK];

  /*
   * dist/ is served in-process rather than by `npx vite preview`.
   *
   * The first version of this sweep spawned vite preview, and on the 115th
   * navigation it answered ERR_HTTP_RESPONSE_CODE_FAILURE and took the whole
   * run down — fourteen minutes of real measurements lost to a dev server
   * that was never meant to take that much traffic. Twenty lines of
   * http.createServer have no such opinion, start instantly, and remove an
   * npx invocation from the critical path.
   */
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = join(ROOT, 'dist', path);
    // Single-page app: any route that is not a real file is index.html.
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'dist', 'index.html');
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  });

  mkdirSync(OUT, { recursive: true });
  const failures = [];
  const covered = [];
  const report = [];

  /** One browser context per (width, lang), navigated across many surfaces. */
  async function sweep({ width, lang, ids, scenario = 'ready', shots = false }) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      isMobile: width <= 430,
      hasTouch: width <= 430,
    });
    await ctx.addInitScript(
      ([authKey, session, langKey, language]) => {
        window.localStorage.setItem(authKey, JSON.stringify(session));
        window.localStorage.setItem(langKey, language);
      },
      ['sb-stubproj-auth-token', harnessSession(), 'homatch_lang', lang]
    );
    await ctx.route('**', (route) => {
      if (route.request().url().startsWith(BASE)) return route.continue();
      return answer(route, scenario);
    });

    const page = await ctx.newPage();
    for (const id of ids) {
      const surface = SURFACES.find((s) => s.id === id);
      const label = `${surface.id} @ ${width}px ${lang}${scenario === 'empty' ? ' (empty)' : ''}`;
      /*
       * A navigation that fails is recorded and the sweep moves on.
       *
       * Throwing here loses every measurement taken so far, which is how the
       * first full run ended with 115 pages visited and nothing to show. One
       * retry covers a transient; a second failure is reported as the defect
       * it would be.
       */
      let navError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto(`${BASE}${surface.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          navError = null;
          break;
        } catch (e) {
          navError = e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : String(e);
        }
      }
      if (navError) {
        covered.push(label);
        failures.push(`${label}: the page could not be loaded — ${navError}`);
        continue;
      }
      await page.waitForSelector(surface.anchor, { timeout: 15000 }).catch(() => {});
      // Let the data land and the layout settle; these screens fetch on mount.
      await page.waitForTimeout(650);

      const r = await page.evaluate(AUDIT, {
        vw: width, keys, notALeak,
        customer: surface.customer,
        providerWords: PROVIDER_WORDS,
        placeholderWords: PLACEHOLDER_WORDS,
      });

      if (shots) {
        await page.screenshot({ path: join(OUT, `${surface.id}-${width}-${lang}.png`), fullPage: false }).catch(() => {});
      }

      covered.push(label);
      report.push({ label, ...r, offenders: r.offenders.length, nameless: r.nameless.length });
      writeFileSync(join(OUT, 'sweep.json'), JSON.stringify({ generated_at: new Date().toISOString(), report }, null, 2));

      // ── The assertions, each one a real defect ──
      if (r.signedOut) { failures.push(`${label}: redirected to the login page — the session fixture did not take`); continue; }
      if (r.clientWidth !== width) { failures.push(`${label}: viewport was not applied (clientWidth=${r.clientWidth})`); continue; }
      if (r.textLength < 120) { failures.push(`${label}: rendered almost nothing (${r.textLength} characters of visible text)`); continue; }
      if (r.leaked.length) failures.push(`${label}: untranslated keys on screen — ${r.leaked.join(', ')}`);
      if (r.placeholders.length) failures.push(`${label}: placeholder copy on screen — ${r.placeholders.join(', ')}`);
      if (r.providers.length) failures.push(`${label}: raw provider names on a customer screen — ${r.providers.join(', ')}`);
      if (r.nameless.length) failures.push(`${label}: ${r.nameless.length} control(s) with no accessible name — ${r.nameless.map((n) => `${n.tag}.${n.cls}`).join(' | ')}`);
      if (r.pageOverflow || r.offenders.length) {
        failures.push(`${label}: horizontal overflow, scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}\n` +
          r.offenders.map((o) => `      ${o.tag}.${o.cls} left=${o.left} right=${o.right} "${o.text}"`).join('\n'));
      }
      const wantDir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
      if (r.dir !== wantDir) failures.push(`${label}: document direction is "${r.dir}", expected "${wantDir}"`);
      if (r.lang !== lang) failures.push(`${label}: document language is "${r.lang}", expected "${lang}"`);
    }
    await ctx.close();
  }

  const allIds = SURFACES.map((s) => s.id);

  // Pass A — every surface, desktop, English. The full gap sweep.
  await sweep({ width: 1280, lang: 'en', ids: allIds, shots: true });

  // Pass B — the empty state of every list screen. An "everything is fine"
  // screen that renders a blank rectangle when there is no data is a bug that
  // only shows up on a new account, which is every account once.
  await sweep({ width: 1280, lang: 'en', ids: allIds, scenario: 'empty' });

  // Pass C — real phone widths on the six surfaces §9 names.
  for (const width of WIDTHS) {
    await sweep({ width, lang: 'en', ids: NARROW_SURFACES, shots: width === 390 });
  }

  // Pass D — right to left, at a phone width and a desktop width.
  for (const lang of RTL_LANGS) {
    await sweep({ width: 390, lang, ids: NARROW_SURFACES, shots: true });
    await sweep({ width: 1280, lang, ids: NARROW_SURFACES });
  }

  // Pass E — the remaining locales. Georgian is the one that breaks layouts:
  // its words are long and it has no case distinction to shorten a label with.
  for (const lang of LTR_LANGS) {
    await sweep({ width: 1280, lang, ids: NARROW_SURFACES, shots: lang === 'ka' });
  }

  writeFileSync(join(OUT, 'sweep.json'), JSON.stringify({ generated_at: new Date().toISOString(), report }, null, 2));

  // Coverage first: a clean run that measured nothing is not a pass.
  const wanted = [
    ...allIds.map((id) => `${id} @ 1280px en`),
    ...allIds.map((id) => `${id} @ 1280px en (empty)`),
    ...WIDTHS.flatMap((w) => NARROW_SURFACES.map((id) => `${id} @ ${w}px en`)),
    ...RTL_LANGS.flatMap((l) => [390, 1280].flatMap((w) => NARROW_SURFACES.map((id) => `${id} @ ${w}px ${l}`))),
    ...LTR_LANGS.flatMap((l) => NARROW_SURFACES.map((id) => `${id} @ 1280px ${l}`)),
  ];
  assert.deepEqual(covered, wanted, 'the sweep did not visit every surface it claims to cover');

  assert.deepEqual(failures, [], `Communications surface defects (${failures.length}):\n  - ${failures.join('\n  - ')}`);
});
