// REAL viewport overflow coverage across the customer product.
//
// mobileOverflow.test.mjs drives ONE screen — the verification report —
// deeply, with an adversarial fixture. This is the other axis: many routes,
// shallowly, to catch the layout that overflows on a phone because nobody
// ever opened it at 320px.
//
// WHY THIS CAN REACH SIGNED-IN SCREENS
//
// Most of the product is behind auth, and the previous pass stopped at the
// public routes for exactly that reason. It does not need a real account:
// the harness build points at a stub origin, every request is intercepted,
// and a session object shaped the way supabase-js persists one is written
// into localStorage before the app boots. So /dashboard, /ai, /credits and
// the rest render as a signed-in customer would see them, against fixtures,
// touching no backend and no real data.
//
// WHY GEORGIAN IS THE DEFAULT LOCALE HERE
//
// It is the language that breaks layouts. Georgian compounds are long and
// unhyphenated, so a container that fits English at 320px often does not fit
// Georgian — and Georgian is a primary locale for this product, not a
// fallback. Every route is checked in Georgian at the narrowest width; the
// rest of the matrix samples the other widths and an RTL locale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { SYNTHESIS, STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;

/* The widths the product supports. 320 is the floor. */
const WIDTHS = [320, 360, 390, 430];

/**
 * The routes a customer can actually reach, and what each one is for.
 *
 * `auth` marks the ones that need the stub session; they are the majority,
 * and they are the ones no previous pass had rendered at a phone width.
 */
const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/about', name: 'about' },
  { path: '/verify', name: 'verify centre', auth: true },
  { path: '/mortgage', name: 'mortgage' },
  { path: '/pricing', name: 'pricing' },
  { path: '/developers', name: 'developers' },
  { path: '/dashboard', name: 'dashboard', auth: true },
  { path: '/ai', name: 'AI chat', auth: true },
  { path: '/credits', name: 'credits', auth: true },
  { path: '/profile', name: 'profile', auth: true },
  { path: '/activity', name: 'activity', auth: true },
  { path: '/notifications', name: 'notifications', auth: true },
  { path: '/viewings', name: 'viewings', auth: true },
  { path: '/active-search', name: 'active search', auth: true },
  { path: '/outreach', name: 'outreach hub', auth: true },
  { path: '/outreach/email', name: 'email campaigns', auth: true },
  { path: '/outreach/calls', name: 'AI call center', auth: true },
  { path: '/property/add', name: 'add property', auth: true },
  /* Homatch for Developers. The workspace shell, the screens a sales floor
     lives in, the sales file, and the buyer-facing shared apartment page.
     These render against the dev_* fixtures below rather than a backend. */
  { path: '/developers/home', name: 'developer home', auth: true },
  { path: '/developers/projects', name: 'developer projects', auth: true },
  { path: '/developers/contacts', name: 'developer contacts', auth: true },
  { path: '/developers/sales/ledger', name: 'developer sales ledger', auth: true },
  { path: '/developers/settings', name: 'developer settings', auth: true },
  { path: '/developers/sales/offers', name: 'developer offers', auth: true },
  { path: '/developers/sales/contracts', name: 'developer contracts', auth: true },
  { path: '/developers/sales/commissions', name: 'developer commissions', auth: true },
  { path: '/developers/sales/handover', name: 'developer handover', auth: true },
  { path: '/developers/marketing', name: 'developer marketing', auth: true },
  { path: '/developers/insights', name: 'developer insights', auth: true },
  { path: '/developers/settings/audit', name: 'developer activity record', auth: true },
  { path: '/s/harness-token', name: 'shared apartment' },
  /* The buyer-facing surfaces. Neither needs an account, and both are
     opened on a phone far more often than on anything else. */
  { path: '/buyer/harness-token', name: 'buyer room' },
  { path: '/p/harness/harness-project', name: 'digital twin viewer' },
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
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
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
/* In CI a missing prerequisite is a FAILURE, never a silent pass: a workflow
   that skips its only layout gate reports green while proving nothing. */
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

/** One workspace, owned by the stub account. Georgian on purpose: it is the
 *  locale this gate treats as the hard case, and a company name is one of the
 *  longest unbroken strings the shell has to fit. */
const DEV_WORKSPACE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  owner_id: '00000000-0000-4000-8000-000000000001',
  name: 'ჰარნესის სამშენებლო კომპანია',
  slug: 'harness-developer',
  legal_name: null, country: 'GE', city: 'თბილისი', website: null,
  developer_profile_id: null, brand_logo_url: null, brand_color: null,
  default_currency: 'USD', status: 'ACTIVE', feature_flags: {},
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

/* Every counter zero. The point of this gate is the LAYOUT, and on most of
   these screens the empty state is the widest thing that ever renders. */
/* The executive rollup, all zeroes. These screens are measured for LAYOUT,
   and inventing figures here would mean measuring a table that production
   would not show. */
const DEV_DASHBOARD = {
  inventory: {
    total: 0, available: 0, reserved: 0, on_hold: 0, negotiation: 0,
    contract_pending: 0, sold: 0, value_available: 0, area_available: 0,
  },
  sales: { count: 0, value: 0, avg_value: null, discount_given: 0 },
  money: { collected: 0, awaiting_confirmation: 0 },
  receivables: { overdue_count: 0, overdue_amount: 0, due_30d: 0, outstanding_total: 0 },
  funnel: { leads: 0, qualified: 0, viewing: 0, reserved: 0, sold: 0, lost: 0 },
  by_project: [], by_salesperson: [], by_source: [],
  commissions: { pending: 0, approved: 0, paid: 0 },
  handover: { pending: 0, overdue: 0, completed: 0 },
};

const TWIN_ANALYTICS = {
  since: new Date(0).toISOString(),
  totals: {
    opens: 0, unit_views: 0, floorplan_views: 0,
    walkthroughs: 0, contact_requests: 0, visitors: 0,
  },
  by_origin: [], top_units: [], daily: [],
};

const DEV_OVERVIEW = {
  units: { total: 0, available: 0, reserved: 0, negotiation: 0, contract_pending: 0, sold: 0, value_available: 0 },
  leads: { total: 0, new: 0, active: 0, negotiation: 0, overdue_follow_ups: 0 },
  viewings: { today: 0, upcoming: 0 },
  reservations: { active: 0, expiring_soon: 0, expired_unresolved: 0 },
  sales: { this_month: 0, value_this_month: 0, contracted_value: 0 },
  money: { collected: 0, collected_this_month: 0, awaiting_confirmation: 0 },
  schedule: { overdue_count: 0, overdue_amount: 0, due_30d: 0 },
  tasks: { open: 0, overdue: 0 },
  documents: { needs_review: 0 },
};

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp,
    email: 'harness@example.test', aud: 'authenticated',
  })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: {
      id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'harness@example.test', app_metadata: {}, user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

test('no customer route overflows a phone viewport', opts, async (t) => {
  if (skipReason) assert.fail(`route overflow gate could not run: ${skipReason}`);

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
   * One page load: set the locale and session, stub the world, measure.
   * Returns the offenders rather than asserting, so one run can report every
   * broken route instead of stopping at the first.
   */
  async function measure(route, width, lang) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(
      ([key, session, locale]) => {
        window.localStorage.setItem(key, JSON.stringify(session));
        window.localStorage.setItem('homatch_lang', locale);
      },
      ['sb-stubproj-auth-token', fakeSession(), lang],
    );
    const page = await ctx.newPage();
    const json = (body) => ({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
    });
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(BASE)) return r.continue();
      if (r.request().method() === 'OPTIONS') {
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/functions/v1/verify-synthesis')) return r.fulfill(json(SYNTHESIS));
      if (url.includes('/functions/v1/research-agent')) return r.fulfill(json(STATUS_RESPONSE));
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      /*
       * Homatch for Developers needs a membership to render its shell at all:
       * with none, every route redirects to onboarding and the layout under
       * test is never measured. These put a signed-in OWNER inside one
       * workspace. Every other dev_* table falls through to the empty array
       * below, so the screens render their real empty states.
       */
      if (url.includes('/rest/v1/dev_members')) {
        return r.fulfill(json([{ workspace_id: DEV_WORKSPACE.id, role: 'OWNER' }]));
      }
      if (url.includes('/rest/v1/dev_workspaces')) return r.fulfill(json([DEV_WORKSPACE]));
      if (url.includes('/rest/v1/rpc/dev_workspace_overview')) return r.fulfill(json(DEV_OVERVIEW));
      if (url.includes('/rest/v1/rpc/dev_claim_invites')) return r.fulfill(json(0));
      if (url.includes('/rest/v1/rpc/dev_expire_reservations')) return r.fulfill(json(0));
      if (url.includes('/rest/v1/rpc/dev_share_resolve')) return r.fulfill(json({ error: 'NOT_FOUND' }));
      /* The buyer room and the twin viewer both resolve a token that does
         not exist here, so each renders its "we could not find that"
         state -- which is a real layout with real copy, and exactly the
         one a mistyped link produces in production. */
      if (url.includes('/rest/v1/rpc/dev_buyer_room')) return r.fulfill(json({ error: 'NOT_FOUND' }));
      if (url.includes('/rest/v1/rpc/dt_experience_manifest')) return r.fulfill(json({ error: 'NOT_FOUND' }));
      if (url.includes('/rest/v1/rpc/dev_dashboard')) return r.fulfill(json(DEV_DASHBOARD));
      if (url.includes('/rest/v1/rpc/dt_analytics')) return r.fulfill(json(TWIN_ANALYTICS));
      if (url.includes('/rest/v1/rpc/dev_generate_notifications')) return r.fulfill(json(0));
      if (url.includes('/rest/v1/rpc/dev_expire_offers')) return r.fulfill(json(0));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });

    /*
     * WAIT FOR THE APP, THEN FOR THE ANSWER TO STOP CHANGING.
     *
     * `domcontentloaded` fires before React has mounted anything, so what
     * follows used to be a flat 1200ms and a single measurement. Wall clock
     * is not a fixed amount of WORK: nine browser test files run in parallel
     * on one machine, and under that load the sample could land mid-mount --
     * where a tree that is half laid out is legitimately wider than the
     * settled one. That produced a failure that could not be reproduced on
     * its own and passed four runs in a row, which is the worst kind: it
     * teaches everyone to re-run the gate instead of reading it.
     *
     * Measuring until two consecutive samples agree removes the guess. A
     * layout that is stably broken fails exactly as it did before; one that
     * never settles is REPORTED as never settling, rather than passing on
     * whichever frame happened to be sampled.
     */
    await page.waitForFunction(
      () => document.body.innerText.trim().length > 0,
      null, { timeout: 20000 },
    ).catch(() => { /* an empty page is a real result: `mounted` reports it */ });

    const sample = (vw) => {
      const de = document.documentElement;
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const s = getComputedStyle(el);
        // An element that scrolls on purpose is a solution, not a defect.
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
        if (s.position === 'fixed') continue;
        if (r.right > vw + 1) {
          offenders.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} right=${Math.round(r.right)}`);
        }
      }
      return {
        mounted: document.body.innerText.trim().length > 0,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        offenders: offenders.slice(0, 4),
      };
    };

    let previous = null;
    let result = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = await page.evaluate(sample, width);
      const shape = JSON.stringify([now.mounted, now.scrollWidth, now.clientWidth, now.offenders]);
      if (previous === shape) { result = { ...now, settled: true }; break; }
      previous = shape;
      result = { ...now, settled: false };
      await page.waitForTimeout(500);
    }

    await ctx.close();
    return result;
  }

  const failures = [];
  const checked = [];

  /* 1. EVERY route at the narrowest width, in Georgian — the combination
        most likely to break, and the one nobody opens by accident. */
  for (const route of ROUTES) {
    const r = await measure(route, 320, 'ka');
    checked.push(`${route.path}@320/ka`);
    if (!r.mounted) { failures.push(`${route.name} (${route.path}) @320 ka: rendered nothing`); continue; }
    if (!r.settled) { failures.push(`${route.name} (${route.path}) @320 ka: layout never settled`); continue; }
    if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
      failures.push(`${route.name} (${route.path}) @320 ka: scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}\n    ${r.offenders.join('\n    ')}`);
    }
  }

  /* 2. A representative spread across the remaining widths, in English. */
  const SPREAD = ROUTES.filter((r) => ['/', '/dashboard', '/ai', '/verify', '/outreach/email'].includes(r.path));
  for (const route of SPREAD) {
    for (const width of WIDTHS.filter((w) => w !== 320)) {
      const r = await measure(route, width, 'en');
      checked.push(`${route.path}@${width}/en`);
      if (!r.settled) { failures.push(`${route.name} (${route.path}) @${width} en: layout never settled`); continue; }
      if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
        failures.push(`${route.name} (${route.path}) @${width} en: scrollWidth=${r.scrollWidth}\n    ${r.offenders.join('\n    ')}`);
      }
    }
  }

  /* 3. One RTL locale, because a mirrored layout overflows on the other
        side and a left-only check would never see it. */
  for (const route of SPREAD) {
    const r = await measure(route, 390, 'he');
    checked.push(`${route.path}@390/he`);
    if (!r.settled) { failures.push(`${route.name} (${route.path}) @390 he: layout never settled`); continue; }
    if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
      failures.push(`${route.name} (${route.path}) @390 he (RTL): scrollWidth=${r.scrollWidth}\n    ${r.offenders.join('\n    ')}`);
    }
  }

  /* Coverage first: a clean run that measured nothing is not a pass. The
     floor is a literal, not derived from ROUTES, so shrinking ROUTES cannot
     shrink the guard along with it. */
  assert.ok(checked.length >= 30, `the gate covered only ${checked.length} route/width/locale combinations`);
  assert.deepEqual(failures, [], `horizontal overflow on real phone viewports:\n${failures.join('\n')}`);
});
