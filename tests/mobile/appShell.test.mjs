// ONE SHELL FOR THE SIGNED-IN PRODUCT.
//
// The complaint this gate exists to make impossible: "some authenticated
// pages unexpectedly switch to a top navigation instead of keeping the
// application sidebar."
//
// They all did. HomatchShell — the rail, the grouped navigation, the account
// card — was written to be reusable and then used by exactly one page, the
// dashboard. Every other authenticated screen came through AppLayout, which
// renders AppHeader: a second, complete navigation carrying ten product links
// of its own. Verify, Mortgage, Profile, Credits, Activity, the property
// flows and the whole of Communications therefore lost the rail and grew a
// horizontal menu instead, and the product changed shape depending on where
// you were standing in it.
//
// WHAT THIS ASSERTS, AND WHY IN THIS FORM
//
// For a signed-in visitor, on each authenticated route:
//
//   the rail's navigation landmark is in the document, and
//   the public header's navigation landmark is NOT,
//
// and, separately, that the rail's product links do not reappear in the top
// bar — which is the difference between "a utility bar" (search, language,
// notifications, credits, add-property: allowed) and "a second navigation"
// (the thing being removed).
//
// Checking landmarks rather than pixels is deliberate. A test that measured
// the rail's width would pass on a page that rendered both navigations, and
// both is the actual defect.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4347;
const BASE = `http://127.0.0.1:${PORT}`;

/* Authenticated tools, one per area, including the ones named in the
   complaint. /verify and /mortgage are in here on purpose: they are PUBLIC
   routes, so they are the ones most likely to keep the public chrome by
   accident once somebody has signed in. */
const APP_ROUTES = [
  '/dashboard', '/verify', '/mortgage', '/credits', '/profile',
  '/activity', '/chat', '/live-chat', '/outreach', '/outreach/calls',
  '/viewings', '/active-search', '/property/add',
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next one */ }
  }
  return null;
}

function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) {
    return 'no build in dist/ — run: npm run build:harness';
  }
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : { timeout: 300000 };

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
      email: 'harness@example.test', app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, created_at: new Date().toISOString(),
    },
  };
}

const PROFILE = {
  id: 'u1', auth_id: 'u1', email: 'harness@example.test',
  is_admin: false, preferred_language: 'en', full_name: 'Harness User',
  plan: 'FREE', created_at: new Date().toISOString(),
};

async function boot(t, { width, height, lang = 'en', signedIn = true }) {
  const { chromium } = resolvePlaywright();
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });

  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const ctx = await browser.newContext({
    viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700,
  });
  await ctx.addInitScript(([k, s, l, on]) => {
    if (on) window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', l);
  }, ['sb-stubproj-auth-token', fakeSession(), lang, signedIn]);

  const page = await ctx.newPage();
  const json = (b) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b),
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
    if (url.includes('/rest/v1/users')) return r.fulfill(json(PROFILE));
    if (url.includes('/rest/v1/')) return r.fulfill(json([]));
    return r.fulfill(json({}));
  });
  return page;
}

/** The two navigations, named by their own aria-labels. */
const PROBE = () => ({
  navs: [...document.querySelectorAll('nav[aria-label]')].map((n) => ({
    label: n.getAttribute('aria-label'),
    links: [...n.querySelectorAll('a[href]')].length,
    visible: n.getBoundingClientRect().width > 0,
  })),
  /* The topbar is whatever sits in <header>. A utility bar has controls; a
     second navigation has product LINKS. */
  headerLinks: [...document.querySelectorAll('header a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && h !== '/' && !h.startsWith('http')),
  hasAccountCard: !!document.querySelector('[data-hm-account]'),
});

test('a signed-in visitor keeps one shell on every authenticated tool', opts, async (t) => {
  if (skipReason) assert.fail(`app shell gate could not run: ${skipReason}`);
  const page = await boot(t, { width: 1440, height: 900 });

  const failures = [];
  for (const route of APP_ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const seen = await page.evaluate(PROBE);

    const labels = seen.navs.map((n) => n.label);
    /* The rail names itself with dnav_aria; the public header's menu names
       itself "Main navigation". Both keys are translated, so the test reads
       the DOM rather than hardcoding either string: the rail is the nav
       inside <aside>, the public one is the nav inside <header>. */
    const railNav = await page.evaluate(() => !!document.querySelector('aside nav[aria-label]'));
    const publicNav = await page.evaluate(
      () => !!document.querySelector('header nav[aria-label] a[href]'),
    );

    if (!railNav) failures.push(`${route}: no sidebar navigation (labels seen: ${labels.join(', ') || 'none'})`);
    if (publicNav) failures.push(`${route}: a second navigation is rendered in the header`);
    /* Four is generous: the logo, add-property and at most a couple of
       utility destinations. Ten is the old AppHeader menu. */
    if (seen.headerLinks.length > 4) {
      failures.push(`${route}: header carries ${seen.headerLinks.length} product links — ${seen.headerLinks.slice(0, 6).join(' ')}`);
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the account block is separated from the product navigation', opts, async (t) => {
  if (skipReason) assert.fail(`app shell gate could not run: ${skipReason}`);
  const page = await boot(t, { width: 1440, height: 900, lang: 'ka' });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const shape = await page.evaluate(() => {
    const rail = document.querySelector('aside');
    const nav = rail?.querySelector('nav[aria-label]');
    if (!rail || !nav) return null;
    const navLinks = [...nav.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    return {
      navLinks,
      /* Group headings turn a list into a structure. */
      groups: [...nav.children].length,
      /* Anything the rail truncates in Georgian is a label a customer cannot
         read — the reason the rail got wider. */
      clipped: [...nav.querySelectorAll('a span')]
        .filter((s) => s.scrollWidth > s.clientWidth + 1).length,
    };
  });

  assert.ok(shape, 'the rail did not render');
  assert.ok(shape.groups >= 3, `expected grouped navigation, saw ${shape.groups} blocks`);
  assert.equal(shape.clipped, 0, 'a Georgian navigation label is being cut off');

  /* Account destinations must NOT be product-navigation siblings. */
  for (const personal of ['/credits', '/profile', '/activity']) {
    assert.ok(
      !shape.navLinks.includes(personal),
      `${personal} is still a product-navigation item; it belongs in the account block`,
    );
  }
  /*
   * ONE DESTINATION PER PRODUCT.
   *
   * The Communications group used to lead with /outreach — a hub containing
   * calls, WhatsApp, email, contacts, campaigns and analytics, every one of
   * which is also a destination. A customer looking for WhatsApp had to guess
   * whether it lived under "AI Communications" or under "AI Call Center", and
   * the honest answer was "both, differently".
   *
   * The three channels are now themselves the destinations. The hub route
   * still resolves — it has been bookmarked — it is simply not somewhere the
   * navigation sends anybody.
   */
  for (const product of ['/verify', '/mortgage', '/outreach/calls', '/outreach/whatsapp', '/outreach/email']) {
    assert.ok(shape.navLinks.includes(product), `${product} is missing from the rail`);
  }

  assert.ok(
    !shape.navLinks.includes('/outreach'),
    'the AI Communications hub is still a product destination beside the channels it contains',
  );

  /* Viewings, removed from customer-facing navigation at the owner's request
     — in every language, rather than by deleting the Georgian string and
     leaving "Viewings" in English. The route and its data are untouched. */
  assert.ok(
    !shape.navLinks.includes('/viewings'),
    'Viewings is still in the product navigation',
  );
});

test('a signed-out visitor still gets the public header', opts, async (t) => {
  if (skipReason) assert.fail(`app shell gate could not run: ${skipReason}`);
  const page = await boot(t, { width: 1440, height: 900, signedIn: false });
  /* /verify and /mortgage are usable without an account. A rail full of
     tools they cannot open would not be navigation. */
  await page.goto(`${BASE}/verify`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const rail = await page.evaluate(() => !!document.querySelector('aside nav[aria-label]'));
  assert.equal(rail, false, 'the app sidebar rendered for a signed-out visitor');
});

/*
 * ── THREE PRODUCTS, NOT ONE PRODUCT THREE TIMES ─────────────────────────
 *
 * The owner's test, in their words: "if screenshots of the three pages look
 * structurally almost identical, the information architecture is wrong."
 *
 * This measures that without a screenshot. Shared PRIMITIVES are fine and
 * expected — a Kpi tile and a Section wrapper are the design system. Shared
 * LABELS are the problem: they are the words a customer reads, and if two
 * products say the same words they are, to that customer, the same product.
 *
 * What it caught when it was written: the WhatsApp page carried a WhatsApp
 * CALLING module — a call concept on a messaging product, in NOT_ACTIVATED
 * state, advertising a launch path the owner had ruled out of scope — and a
 * second Templates card pointing at the page a Templates card above it
 * already pointed at. Both are gone, and "New campaign" became "New WhatsApp
 * campaign" and "New call campaign", because the model behind them is shared
 * and the label must not be.
 *
 * The threshold is deliberately generous: chrome ("Back") and the group
 * heading ("Communications") are shared on purpose, and the owner explicitly
 * allows the heading. Anything past a quarter means product sections have
 * started to converge.
 */
test('the three communication products do not look like one another', opts, async (t) => {
  if (skipReason) assert.fail(`app shell gate could not run: ${skipReason}`);
  const page = await boot(t, { width: 1440, height: 1000 });

  const PRODUCTS = [
    ['AI Call Center', '/outreach/calls'],
    ['WhatsApp', '/outreach/whatsapp'],
    ['Email', '/outreach/email'],
  ];

  const seen = new Map();
  for (const [name, path] of PRODUCTS) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3200);
    const labels = await page.evaluate(() => {
      const out = new Set();
      /* Headings and short card/tile labels: what somebody reads when
         deciding what this page is for. */
      for (const el of document.querySelectorAll('main h1, main h2, main h3, main button, main dt')) {
        const text = (el.textContent ?? '').trim();
        if (text && text.length < 46) out.add(text);
      }
      return [...out];
    });
    seen.set(name, new Set(labels));
  }

  const failures = [];
  const names = [...seen.keys()];
  for (const name of names) {
    if (seen.get(name).size < 3) failures.push(`${name}: rendered ${seen.get(name).size} labels — the page did not load`);
  }

  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = seen.get(names[i]);
      const b = seen.get(names[j]);
      const shared = [...a].filter((x) => b.has(x));
      const union = new Set([...a, ...b]).size;
      const pct = union ? Math.round((shared.length / union) * 100) : 0;
      if (pct > 25) {
        failures.push(`${names[i]} and ${names[j]} share ${pct}% of their labels: ${shared.slice(0, 10).join(' | ')}`);
      }
    }
  }

  /* The scope decision, pinned where it will be noticed if it comes back:
     WhatsApp calling is not part of the product. */
  await page.goto(`${BASE}/outreach/whatsapp`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const callOnWhatsApp = await page.evaluate(() => {
    const text = (document.querySelector('main')?.innerText ?? '').toLowerCase();
    return /whatsapp call|call from whatsapp/.test(text);
  });
  if (callOnWhatsApp) failures.push('WhatsApp calling is being advertised on the WhatsApp product page');

  assert.deepEqual(failures, [], failures.join('\n'));
});
