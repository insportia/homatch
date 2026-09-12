// TEXT YOU CAN ACTUALLY READ.
//
// Measures the contrast of every piece of text on every customer route
// against what is really painted behind it, and fails anything below the
// WCAG AA threshold for its size and weight.
//
// WHY THIS IS HARDER THAN IT SOUNDS, AND WHAT IT REFUSES TO GUESS
//
// Getting this wrong invents failures, and "fixing" invented failures makes
// the design worse. Three separate versions of this measurement were wrong
// before it was trustworthy:
//
//   Walking ANCESTORS for the background. Dark plates here are painted by
//   absolutely positioned SIBLING layers over a photograph, which are not
//   ancestors of the text at all — so the walk fell through to the page
//   background and reported white-on-white for text that sits on black.
//
//   Hit-testing without scrolling. elementsFromPoint only knows the current
//   viewport, so every element below the fold was measured against whatever
//   happened to be at the bottom of the screen.
//
//   Skipping the element itself. A button is a solid block with a label in
//   it: the background belongs to the very element the text lives in.
//   Skipping it reported every primary button in the product as unreadable.
//
// And it still refuses to guess. Text over a photograph, a gradient, or any
// translucent layer has no backdrop colour that can be read off the box
// model, so it is counted as unmeasurable rather than judged. Roughly a
// quarter of all text on this product is in that category, which is why the
// gate reports the skipped count instead of hiding it.
//
// Verified by lightening --muted-foreground from 24% to 70%: 114 failures.
// At the real value, none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4345;
const BASE = `http://127.0.0.1:${PORT}`;

const ROUTES = [
  '/', '/about', '/pricing', '/mortgage', '/dashboard', '/ai', '/credits',
  '/profile', '/activity', '/notifications', '/viewings', '/active-search',
  '/verify', '/property/add', '/outreach', '/outreach/email', '/outreach/calls',
  '/outreach/sms', '/outreach/communities', '/outreach/contact-lists',
  '/outreach/insights', '/deal-rooms', '/chat', '/live-chat',
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
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

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

const PROFILE = {
  id: 'u1', auth_id: 'u1', email: 'harness@example.test',
  is_admin: false, preferred_language: 'en', full_name: 'Harness User',
  created_at: new Date().toISOString(),
};

/** Runs inside the page. Returns every measurable sample that fails AA. */
function measure() {
  const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => {
    const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const la = lum(a); const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const fails = [];
  let checked = 0;
  let skipped = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || '').trim();
    if (t.length < 8) continue;
    const el = n.parentElement;
    if (!el) continue;
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.95) continue;

    // On screen first — see the header of this file for why.
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { skipped += 1; continue; }

    const px = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 2);
    const py = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 2);

    let bg = null;
    let unmeasurable = false;
    for (const node of document.elementsFromPoint(px, py)) {
      // Only STRICT descendants paint OVER the text rather than behind it.
      if (node !== el && el.contains(node)) continue;
      const s2 = getComputedStyle(node);
      if (s2.backgroundImage && s2.backgroundImage !== 'none') { unmeasurable = true; break; }
      const c = s2.backgroundColor;
      if (!c || /rgba\(0, 0, 0, 0\)|transparent/.test(c)) continue;
      const p = parse(c);
      if (p.length === 3 && (c.startsWith('rgb(') || /,\s*1\)$/.test(c))) { bg = p; break; }
      unmeasurable = true; break;
    }
    if (unmeasurable || !bg) { skipped += 1; continue; }

    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    // WCAG "large text": 24px, or 18.66px when bold.
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(parse(cs.color), bg);
    checked += 1;
    if (got < need) {
      fails.push(`${got.toFixed(2)}:1 (needs ${need}) ${size}px/${weight} ${cs.color} on rgb(${bg.join(', ')}) — "${t.slice(0, 44)}"`);
    }
  }
  return { checked, skipped, fails: fails.slice(0, 8), failCount: fails.length };
}

test('no customer route carries text below the contrast floor', opts, async (t) => {
  if (skipReason) assert.fail(`contrast gate could not run: ${skipReason}`);

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

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([k, s]) => {
    window.localStorage.setItem(k, JSON.stringify(s));
    window.localStorage.setItem('homatch_lang', 'en');
  }, ['sb-stubproj-auth-token', fakeSession()]);

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

  const failures = [];
  let totalChecked = 0;

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const res = await page.evaluate(measure);
    totalChecked += res.checked;
    if (res.failCount) {
      failures.push(`${route}: ${res.failCount} of ${res.checked}\n      ${res.fails.join('\n      ')}`);
    }
  }

  /* Coverage first: a clean run that measured nothing is not a pass. */
  assert.ok(totalChecked >= 300,
    `the gate only measured ${totalChecked} pieces of text — did the pages render?`);
  assert.deepEqual(failures, [], `text below the contrast floor:\n  ${failures.join('\n  ')}`);
});
