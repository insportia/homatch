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

/*
 * The matrix scope is a DECISION, held in one place and shared.
 *
 * src/surfaces/classification.ts says which surfaces are customer-critical and why, and
 * tests/matrix/surfaceAudit.test.mjs keeps it honest. Importing it here means the
 * acceptance matrix and the migration plan cannot disagree about which screens matter.
 */
import { customerCriticalPaths, statusOf } from '../../src/surfaces/classification.ts';
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
 * Every locale the product ships, not a sample of them.
 *
 * Arabic and Hebrew are not interchangeable and neither stands in for the other:
 * Arabic shapes and joins, so its rendered strings are routinely wider than the Hebrew
 * equivalent at the same character count. Georgian is unhyphenated and produces the
 * longest single words. Russian produces the longest phrases. Turkish sits between.
 */
const LOCALES = ['ka', 'en', 'ru', 'ar', 'he', 'tr'];

/**
 * THE FULL 4x6, off by default and run by `npm run test:matrix`.
 *
 * 11 customer-critical surfaces x 4 widths x 6 locales is 264 renders, roughly twelve
 * minutes. The three passes below stay the everyday gate because a gate nobody runs is
 * not a gate; this is the acceptance matrix, and it is explicit rather than sampled.
 */
const FULL_MATRIX = process.env.HOMATCH_FULL_MATRIX === '1';

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
  { path: '/investment', name: 'investment' },
  /* FOR EXPATS. Public like its two neighbours, and the one most likely
     to overflow: Georgian nav words are long and unhyphenated, and the
     market cards carry a currency range and a comparable count on one
     row. The plan is auth-gated. */
  { path: '/for-expats/georgia', name: 'for expats' },
  { path: '/for-expats/georgia/residence-permits', name: 'for expats topic' },
  { path: '/for-expats/plan', name: 'my expat plan', auth: true },
  { path: '/pricing', name: 'pricing' },
  { path: '/developers', name: 'developers' },
  /*
   * BROKERS. Public, and measured for a reason specific to it: the page's whole
   * job is to keep 'listed with Homatch' and 'seen in the market, not registered'
   * apart, and the second label is the longer one in every language. A width that
   * truncates it into the first turns a disclaimer into a claim.
   */
  { path: '/brokers', name: 'brokers' },
  /*
   * FIND PROPERTY. auth, because confirming a plan writes a row that belongs to
   * an account. Measured at every width because the plan editor is the densest
   * form in the product on the narrowest screens -- a label, an input and a
   * strength select per requirement -- and clipping a strength control is not a
   * cosmetic failure: it is the difference between a preference and a demand.
   */
  { path: '/find-property', name: 'find property', auth: true },
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
  /*
   * ADMIN SOCIAL DISCOVERY, the one admin screen in this matrix.
   *
   * Admin design is protected and is not being redesigned -- but the community
   * intelligence panel is NEW markup added to it, and new markup is exactly what
   * has not been measured at 320px. It puts a five-tile total row, two scrolling
   * button rails and a thirty-bar chart on one card, which is the densest shape on
   * any admin screen and the one most likely to widen the page.
   */
  { path: '/admin/social-discovery', name: 'admin social discovery', auth: true, admin: true },
  /*
   * THE SCREEN THE PRODUCT IS SOLD ON, and it was not in this matrix.
   *
   * /property/:id/matches is where a customer meets the locked preview, the
   * unlock price in Credits and the match strength — the only screen where
   * money changes hands. Every other customer route was being rendered at
   * 320px and this one never had been, which is the combination most likely
   * to overflow: a price, a strength badge and a redacted excerpt on one row,
   * in Georgian, at the narrowest supported width.
   *
   * The id is a stub; every non-local request is intercepted, so this
   * exercises the page's own layout and its empty state rather than a
   * backend.
   */
  { path: '/property/11111111-1111-4111-8111-111111111111/matches', name: 'property matches', auth: true },
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
       * THE HOMATCH USER ROW, and its absence was quietly gutting this whole file.
       *
       * AuthContext reads `users` by auth_id and every signed-in screen waits on
       * it. There was no stub, so it fell through to the empty array below,
       * homatchUser stayed null, and EVERY `auth: true` route rendered the "we
       * could not load your profile" card instead of itself.
       *
       * Which means the gate was measuring that card at four widths in three
       * locales and calling it coverage of the dashboard, the credits screen and
       * the matches page. This route list's own comment claims /matches covers
       * "the locked preview, the unlock price in Credits and the match strength";
       * it covered an error state with two buttons on it.
       *
       * Found 2026-09-26 by asserting that a panel we had just added to that
       * screen was actually present, and discovering the screen was not.
       */
      if (url.includes('/rest/v1/users')) {
        const row = {
          id: '77777777-7777-4777-8777-777777777777',
          auth_id: fakeSession().user.id,
          email: 'harness@example.test',
          full_name: 'Harness Customer',
          /*
           * PER ROUTE, not a constant. Admin screens are gated on this, so a
           * hardcoded false meant an adminOnly route could only ever render its
           * redirect -- the same class of false coverage that once had every
           * auth: true route measuring a "could not load your profile" card.
           */
          is_admin: route.admin === true,
          role: 'SELLER',
          created_at: new Date().toISOString(),
        };
        const single = (r.request().headers()['accept'] ?? '').includes('pgrst.object');
        return r.fulfill(json(single ? row : [row]));
      }
      /*
       * Homatch for Developers needs a membership to render its shell at all:
       * with none, every route redirects to onboarding and the layout under
       * test is never measured. These put a signed-in OWNER inside one
       * workspace. Every other dev_* table falls through to the empty array
       * below, so the screens render their real empty states.
       */
      /*
       * ADMIN SOCIAL DISCOVERY needs two answers or it renders skeletons forever,
       * and a skeleton has no layout to measure.
       *
       * The connection cards come from social-connections?action=status. The shape
       * below is the honest one this product insists on: CONNECTED but NOT readable,
       * because an authorized Facebook account can see its groups and Meta has
       * exposed no supported way to read them since 2024-04-22. That renders the
       * longest label on the screen -- "MEMBER · API ACCESS UNAVAILABLE" -- which is
       * exactly the string most likely to overflow at 320px and to mirror badly in
       * Arabic and Hebrew.
       */
      if (url.includes('/functions/v1/social-connections')) {
        /*
         * SHAPED FROM SocialConnectionCard IN src/services/social.ts, not from
         * memory. My first attempt invented the shape and the page died on
         * `Cannot read properties of undefined (reading 'toLowerCase')` -- it reads
         * card.status, and my fixture had no status. A fixture that guesses is a
         * fixture that tests the guess.
         *
         * META is CONNECTED and NOT readable on purpose: an authorized Facebook
         * account can see its groups and Meta has exposed no supported way to read
         * them since 2024-04-22. That renders the longest label on the screen and
         * the one most likely to overflow at 320px or mirror badly in RTL.
         */
        const card = (over) => ({
          provider: 'META',
          platform: 'FACEBOOK',
          connectMechanism: 'OAUTH',
          status: 'CONNECTED',
          statusDetail: 'authorized, and the groups API was removed on 2024-04-22',
          missingAppCredentials: [],
          account: { id: 'acct-1', name: 'Homatch Research' },
          connectionId: 'conn-1',
          connectedAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          lastSuccessAt: null,
          lastErrorAt: null,
          lastErrorCode: null,
          tokenExpiresAt: null,
          grantedScopes: ['pages_show_list'],
          surfaces: [
            {
              surface: 'COMMUNITY_POSTS', best: 'UNAVAILABLE',
              modes: [{ mode: 'OFFICIAL_API', availability: 'UNAVAILABLE' }], requires: [],
            },
            {
              surface: 'PAGE_POSTS', best: 'RESTRICTED',
              modes: [{ mode: 'BUSINESS_API', availability: 'RESTRICTED' }],
              requires: ['App Review'],
            },
          ],
          targets: { total: 3, readable: 0, memberButUnreadable: 2, joinRequired: 1, enabled: 3 },
          volume: { itemsRead: 0, commentsRead: 0, demandFound: 0, supplyFound: 0 },
          ...over,
        });
        return r.fulfill(json({
          cards: [
            card({}),
            card({
              provider: 'TELEGRAM', platform: 'TELEGRAM', connectMechanism: 'CREDENTIALS',
              status: 'NOT_CONNECTED',
              statusDetail: 'the public preview needs no account',
              missingAppCredentials: ['TELEGRAM_BOT_TOKEN'],
              account: null, connectionId: null, connectedAt: null, lastValidatedAt: null,
              lastSuccessAt: new Date().toISOString(),
              grantedScopes: [],
              surfaces: [{
                surface: 'COMMUNITY_POSTS', best: 'AVAILABLE',
                modes: [{ mode: 'PUBLIC_WEB', availability: 'AVAILABLE' }], requires: [],
              }],
              targets: { total: 3, readable: 1, memberButUnreadable: 0, joinRequired: 0, enabled: 3 },
              volume: { itemsRead: 7, commentsRead: 0, demandFound: 1, supplyFound: 3 },
            }),
          ],
          diagnostics: { note: 'harness fixture, shaped from SocialConnectionCard' },
        }));
      }
      /*
       * The intelligence panel. A DENSE series on purpose: 30 daily buckets is what
       * LAST_30D produces, and the bar row has to scroll inside itself rather than
       * widening the page. The totals carry the real production shape -- 7 items, 3
       * supply, 1 demand, 3 unclassified -- so the tiles hold plausible widths.
       */
      if (url.includes('/functions/v1/community-intelligence')) {
        const start = Date.parse('2026-08-28T00:00:00.000Z');
        const series = Array.from({ length: 30 }, (_, i) => ({
          bucketStart: new Date(start + i * 86400000).toISOString(),
          evidence: i === 29 ? 7 : 0,
          demand: i === 29 ? 1 : 0,
          supply: i === 29 ? 3 : 0,
          reference: 0,
          unknown: i === 29 ? 3 : 0,
          unavailable: 0,
          fromQuery: i === 29,
        }));
        return r.fulfill(json({
          success: true,
          window: 'LAST_30D',
          bounds: {
            from: new Date(start).toISOString(),
            to: new Date(start + 29 * 86400000).toISOString(),
            column: 'discovered_at',
          },
          bucket: 'DAY',
          buckets: series.length,
          bucketsWithEvidence: 1,
          filters: { platform: null, direction: null, language: null },
          totals: { evidence: 7, demand: 1, supply: 3, reference: 0, unknown: 3, unavailable: 0 },
          series,
          elapsedMs: 12,
        }));
      }
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
      /*
       * A SETTLED SWEEP THAT LEFT SOURCES UNREAD, so Expand Search renders.
       *
       * Without this, matching_jobs falls through to the empty array below,
       * getLastSettledSweep returns null and DeeperSearchPanel renders nothing —
       * which is correct behaviour and completely useless as layout coverage. The
       * panel puts two count tiles side by side and then stacks a budget ladder
       * under them, which is exactly the shape that overflows at 320 and mirrors
       * badly in RTL.
       *
       * Three sources read of eight, which is the real FREE-plan shape.
       */
      if (url.includes('/rest/v1/matching_jobs')) {
        const sweep = {
          id: '99999999-9999-4999-8999-999999999999',
          status: 'completed',
          campaign_id: '88888888-8888-4888-8888-888888888888',
          discovery_headroom: {
            searchDepth: 'STANDARD',
            sourcesSearched: 3,
            sourcesAvailableDeeper: 5,
            resultCeiling: 10,
            moreAvailable: true,
          },
        };
        /*
         * A BARE OBJECT, NOT AN ARRAY, when the caller asked for one row.
         *
         * `.maybeSingle()` sends `Accept: application/vnd.pgrst.object+json`, and
         * PostgREST answers that with the object itself. Returning `[obj]` to it
         * makes supabase-js hand back a row whose fields are all undefined, so
         * `campaign_id` is missing, the panel renders nothing, and every overflow
         * assertion passes while measuring its absence. That is precisely what
         * happened on the first run of this stub, and it is why the coverage
         * assertion at the bottom of this file exists.
         */
        const single = (r.request().headers()['accept'] ?? '').includes('pgrst.object');
        return r.fulfill(json(single ? sweep : [sweep]));
      }
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
        /*
         * AND NEITHER IS ANYTHING INSIDE ONE.
         *
         * This skipped an element that scrolls and stopped there, so the CONTENTS
         * of a deliberate horizontal scroller were all reported as offenders — a
         * tab strip built as `overflow-x-auto` around a `min-w-max` nav had every
         * one of its links flagged, on a page whose scrollWidth equalled its
         * clientWidth and which therefore did not overflow at all.
         *
         * That noise is not harmless: it arrived in the same list as real
         * failures, so the real ones were four lines down a wall of false ones.
         */
        let scrolled = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden') {
            scrolled = true;
            break;
          }
        }
        if (scrolled) continue;
        if (r.right > vw + 1) {
          offenders.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} right=${Math.round(r.right)}`);
        }
      }
      return {
        mounted: document.body.innerText.trim().length > 0,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        offenders: offenders.slice(0, 4),
        /*
         * COVERAGE THAT CHECKS ITSELF.
         *
         * A route can be measured at every width in every locale and still tell
         * us nothing about the panel we added it for: DeeperSearchPanel renders
         * only when a settled sweep recorded headroom, and if the stub for
         * matching_jobs ever stops matching, the page renders WITHOUT it and
         * every assertion below keeps passing. That is a clean run measuring an
         * absence, which this file's own coverage floor exists to refuse.
         *
         * So the panel's presence is part of what a sample reports. Found by the
         * icon-plus-counts structure rather than by a translated string, because
         * the copy is different in all six languages and the point is to check it
         * in all six.
         */
        expandPanel: [...document.querySelectorAll('dl')].some(
          (dl) => dl.querySelectorAll('dt').length === 2
            && dl.querySelectorAll('dd').length === 2
            && [...dl.querySelectorAll('dd')].every((dd) => /^\d+$/.test(dd.textContent.trim())),
        ),
        /*
         * The community intelligence panel: a five-tile total row of plain integers.
         * Found by that structure rather than by a translated heading, for the same
         * reason as above -- the copy differs in all six languages and the point is
         * to check it in all six.
         *
         * Without this, adding an adminOnly route to the matrix would prove only
         * that SOMETHING rendered at 320px. An admin route can render its redirect,
         * and a redirect has an excellent scrollWidth.
         */
        /*
         * EXACT, not structural. A connection card above also renders a five-tile
         * dl of integers, so "some dl with 5 dt" matched the wrong element and would
         * have reported coverage this panel never had. data-testid is already the
         * hook this repository uses in admin components, and it changes nothing
         * visual -- the protected admin design is untouched.
         */
        intelPanel: (() => {
          const dl = document.querySelector('[data-testid="intel-totals"]');
          if (!dl) return false;
          return dl.querySelectorAll('dt').length === 5
            && [...dl.querySelectorAll('dd')].every((dd) => /^\d+$/.test(dd.textContent.trim()));
        })(),
        /* The bar row must scroll inside ITSELF: 30 daily buckets, or 720 hourly
           ones, must never widen the page. */
        intelChartScrolls: (() => {
          const box = document.querySelector('[data-testid="intel-series"]');
          if (!box) return false;
          const style = getComputedStyle(box);
          /* Only that it CAN scroll. Whether the series is currently wider than its
             box is irrelevant -- that is what scrolling is for -- and what matters is
             that the PAGE did not grow, which the document-level check asserts. */
          return style.overflowX === 'auto' || style.overflowX === 'scroll';
        })(),
        intelBarCount: document
          .querySelector('[data-testid="intel-series"]')?.querySelectorAll('div').length ?? 0,

        /*
         * THE THREE THINGS THAT PASS AN OVERFLOW CHECK WHILE PROVING NOTHING.
         *
         * A not-found page, the profile-load error card and the crash fallback all have
         * excellent scrollWidth. Each has been mistaken for coverage in this very file
         * already -- the admin route measured a 404, and every auth:true route measured
         * the profile card for four widths across three locales. Detected by marker
         * rather than by copy, because the copy differs in all six languages and that is
         * the whole point of testing six.
         */
        notFound: Boolean(document.querySelector('[data-testid="not-found"]')),
        authFallback: Boolean(document.querySelector('[data-testid="auth-fallback"]')),

        /*
         * AND THE OTHER WAY TO FAKE A PASS: shrink the type until it fits.
         *
         * An overflow "fixed" by rendering Georgian at 9px is not fixed, it is hidden --
         * and Georgian and Arabic are the two scripts where it would be most tempting.
         * Only elements carrying real words are measured: an 8px badge with "3" in it is
         * a legitimate design, a paragraph at 8px is not.
         */
        tinyText: (() => {
          const offenders = [];
          for (const el of document.querySelectorAll('p, h1, h2, h3, li, dt, dd, label, button, a')) {
            const text = (el.textContent || '').trim();
            if (text.length < 12) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (Number.isFinite(size) && size < 11) {
              offenders.push(`${el.tagName.toLowerCase()}@${size}px "${text.slice(0, 28)}"`);
            }
            if (offenders.length >= 4) break;
          }
          return offenders;
        })(),
      };
    };

    let previous = null;
    let result = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = await page.evaluate(sample, width);
      const shape = JSON.stringify([now.mounted, now.scrollWidth, now.clientWidth, now.offenders, now.expandPanel]);
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
  /* Where Expand Search was found, and where the matches route rendered without
     it. The second list must stay empty or the coverage above is an illusion. */
  const panelSeen = [];
  const panelMissing = [];
  const MATCHES = '/property/11111111-1111-4111-8111-111111111111/matches';
  const notePanel = (route, label, present) => {
    if (route.path !== MATCHES) return;
    (present ? panelSeen : panelMissing).push(label);
  };

  /* The same discipline for the admin intelligence panel. An adminOnly route that
     renders its redirect would pass every overflow check ever written. */
  const ADMIN_SOCIAL = '/admin/social-discovery';
  const intelSeen = [];
  const intelMissing = [];
  const intelUnscrollable = [];
  let intelBars = 0;
  const noteIntel = (route, label, sample) => {
    if (route.path !== ADMIN_SOCIAL) return;
    (sample.intelPanel ? intelSeen : intelMissing).push(label);
    if (sample.intelPanel && !sample.intelChartScrolls) intelUnscrollable.push(label);
    intelBars = Math.max(intelBars, sample.intelBarCount ?? 0);
  };

  /* 1. EVERY route at the narrowest width, in Georgian — the combination
        most likely to break, and the one nobody opens by accident. */
  for (const route of ROUTES) {
    const r = await measure(route, 320, 'ka');
    checked.push(`${route.path}@320/ka`);
    notePanel(route, '320/ka', r.expandPanel);
    noteIntel(route, '320/ka', r);
    if (!r.mounted) { failures.push(`${route.name} (${route.path}) @320 ka: rendered nothing`); continue; }
    if (!r.settled) { failures.push(`${route.name} (${route.path}) @320 ka: layout never settled`); continue; }
    if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
      failures.push(`${route.name} (${route.path}) @320 ka: scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}\n    ${r.offenders.join('\n    ')}`);
    }
  }

  /* 2. A representative spread across the remaining widths, in English. */
  /* FOR EXPATS is in the spread, not just the 320/ka pass, because it is
     the one product written for people who will read it in Arabic and
     Hebrew — and because its market cards put a currency range and two
     counts on one row, which is where a mirrored layout overflows. */
  const SPREAD = ROUTES.filter((r) =>
    ['/', '/dashboard', '/ai', '/verify', '/outreach/email', '/for-expats/georgia',
      /*
       * The matches screen joins the spread because Expand Search lives on it,
       * and that panel is the one new layout with two count tiles on one row and
       * a budget ladder stacked underneath. It was covered at 320/ka alone --
       * the width most likely to break and the ONLY one measured -- so 360, 390
       * and 430 went unchecked on the screen a seller spends the most time on.
       */
      '/property/11111111-1111-4111-8111-111111111111/matches',
      /*
       * ADMIN SOCIAL DISCOVERY joins the spread for the same reason the matches
       * screen did: the community intelligence panel is the newest layout in the
       * product and the densest on any admin screen -- a five-tile total row, two
       * scrolling button rails and a thirty-bar chart on one card. 320/ka alone
       * proved it survives the narrowest width; 360, 390 and 430 were unchecked.
       */
      '/admin/social-discovery',
    ].includes(r.path));
  for (const route of SPREAD) {
    for (const width of WIDTHS.filter((w) => w !== 320)) {
      const r = await measure(route, width, 'en');
      checked.push(`${route.path}@${width}/en`);
      notePanel(route, `${width}/en`, r.expandPanel);
      noteIntel(route, `${width}/en`, r);
      if (!r.settled) { failures.push(`${route.name} (${route.path}) @${width} en: layout never settled`); continue; }
      if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
        failures.push(`${route.name} (${route.path}) @${width} en: scrollWidth=${r.scrollWidth}\n    ${r.offenders.join('\n    ')}`);
      }
    }
  }

  /* 3. BOTH RTL locales, because a mirrored layout overflows on the other side
        and a left-only check would never see it.

        Hebrew and Arabic are not interchangeable here. Arabic shapes and joins,
        so its rendered strings are routinely wider than the Hebrew equivalent at
        the same character count, and a row that fits one can overflow the other.
        Checking one RTL locale and calling the axis covered is the same mistake
        as checking one width. */
  for (const route of SPREAD) {
    for (const locale of ['he', 'ar']) {
      const r = await measure(route, 390, locale);
      checked.push(`${route.path}@390/${locale}`);
      notePanel(route, `390/${locale}`, r.expandPanel);
      noteIntel(route, `390/${locale}`, r);
      if (!r.settled) {
        failures.push(`${route.name} (${route.path}) @390 ${locale}: layout never settled`);
        continue;
      }
      if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
        failures.push(`${route.name} (${route.path}) @390 ${locale} (RTL): scrollWidth=${r.scrollWidth}\n    ${r.offenders.join('\n    ')}`);
      }
    }
  }

  /*
   * 4. THE ACCEPTANCE MATRIX: every customer-critical surface, all four widths, all six
   *    locales. Off unless HOMATCH_FULL_MATRIX=1, because 264 renders is twelve minutes
   *    and the three passes above are the gate that runs on every change.
   *
   *    A parameterised path in the classification (/property/:id/matches) is matched to
   *    the concrete route this harness already stubs data for, so the matrix measures a
   *    page with content on it rather than an empty state.
   */
  const fullMatrixChecked = [];
  if (FULL_MATRIX) {
    const concrete = new Map(ROUTES.map((r) => [r.path, r]));
    for (const classified of customerCriticalPaths()) {
      /* The classification names the route pattern; ROUTES holds the concrete path with
         a real id in it. Fall back to an exact match for unparameterised surfaces. */
      const route = concrete.get(classified)
        ?? ROUTES.find((r) => r.path.replace(/\/[0-9a-f-]{36}\//g, '/:id/') === classified)
        ?? ROUTES.find((r) => classified.split('/:')[0] !== '' && r.path.startsWith(classified.split('/:')[0]));
      if (!route) {
        failures.push(`the matrix cannot reach ${classified}: no concrete route in this harness`);
        continue;
      }
      for (const width of WIDTHS) {
        for (const locale of LOCALES) {
          const r = await measure(route, width, locale);
          const label = `${route.path}@${width}/${locale}`;
          checked.push(label);
          fullMatrixChecked.push(label);
          notePanel(route, `${width}/${locale}`, r.expandPanel);
          noteIntel(route, `${width}/${locale}`, r);

          /*
           * A REDIRECT, AN AUTH FALLBACK, A 404 OR AN ERROR PAGE MUST FAIL.
           *
           * All four have excellent scrollWidth. This is the lesson the admin route
           * taught: it passed the overflow check while rendering a not-found page, and
           * only an assertion that the intended content was PRESENT caught it.
           */
          if (!r.mounted) {
            failures.push(`${label}: rendered nothing`);
            continue;
          }
          if (!r.settled) { failures.push(`${label}: layout never settled`); continue; }
          if (r.notFound) { failures.push(`${label}: rendered a not-found page`); continue; }
          if (r.authFallback) { failures.push(`${label}: rendered the profile-load error card`); continue; }
          if (r.scrollWidth > r.clientWidth + 1 || r.offenders.length) {
            failures.push(`${label}: scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}`
              + `\n    ${r.offenders.join('\n    ')}`);
          }
          /*
           * AND NOT SOLVED BY SHRINKING THE TYPE. An overflow fixed by making Georgian
           * 9px is not fixed. The floor is 11px for anything carrying real words.
           */
          if (r.tinyText?.length) {
            failures.push(`${label}: text below the legible floor: ${r.tinyText.join(', ')}`);
          }
        }
      }
    }
  }

  /* Coverage first: a clean run that measured nothing is not a pass. The
     floor is a literal, not derived from ROUTES, so shrinking ROUTES cannot
     shrink the guard along with it. */
  assert.ok(checked.length >= 30, `the gate covered only ${checked.length} route/width/locale combinations`);

  /*
   * AND THE PANEL WAS ACTUALLY THERE.
   *
   * Expand Search is the reason the matches route joined the spread. It renders
   * only when a settled sweep recorded headroom, so if the matching_jobs stub
   * ever stops matching, the page renders without it and every overflow
   * assertion above still passes -- a green gate measuring an absence.
   *
   * Every width and both RTL locales, because the two count tiles sit on one row
   * and that row is what a mirrored 320px layout breaks.
   */
  assert.deepEqual(
    panelMissing, [],
    `the matches screen rendered WITHOUT the Expand Search panel, so these `
    + `combinations proved nothing about it: ${panelMissing.join(', ')}`,
  );
  assert.ok(panelSeen.length >= 6,
    `Expand Search was only measured in ${panelSeen.length} combination(s): ${panelSeen.join(', ')}`);

  /*
   * THE ADMIN PANEL, held to the same standard. An adminOnly route that rendered
   * its redirect would satisfy every overflow check in this file, so the panel's
   * presence is asserted rather than hoped for.
   */
  assert.deepEqual(
    intelMissing, [],
    'the admin social screen rendered WITHOUT the community intelligence panel, so '
    + `these combinations proved nothing about it: ${intelMissing.join(', ')}`,
  );
  assert.ok(intelSeen.length >= 1,
    'the community intelligence panel was never measured at all; the admin route is '
    + 'in the matrix but is not rendering');
  assert.deepEqual(
    intelUnscrollable, [],
    'the intelligence bar row rendered without its own horizontal scroll container, '
    + `so 30 daily or 720 hourly buckets would widen the page: ${intelUnscrollable.join(', ')}`,
  );
  /* And the series was really drawn. An empty scroll box scrolls perfectly. */
  assert.ok(
    intelBars >= 20,
    `the intelligence panel rendered only ${intelBars} bar(s); the fixture supplies 30 `
    + 'daily buckets, so an empty series means the chart is not being drawn at all',
  );
  /*
   * THE MATRIX MUST HAVE ACTUALLY RUN.
   *
   * A skipped fourth pass and a green fourth pass look identical from the outside, and
   * this file's whole history is of passes that measured the wrong thing. So when the
   * matrix is requested, its size is asserted: every customer-critical surface, four
   * widths, six locales, with nothing quietly dropped because a path could not be
   * resolved to a concrete route.
   */
  if (FULL_MATRIX) {
    const expected = customerCriticalPaths().length * WIDTHS.length * LOCALES.length;
    console.log(`[matrix] ${fullMatrixChecked.length} of an expected ${expected} combinations`);
    assert.equal(
      fullMatrixChecked.length,
      expected,
      `the acceptance matrix measured ${fullMatrixChecked.length} combinations and should `
      + `have measured ${expected} (${customerCriticalPaths().length} surfaces x `
      + `${WIDTHS.length} widths x ${LOCALES.length} locales)`,
    );
    /* And every locale really appeared, so a filter bug cannot silently drop Arabic. */
    for (const locale of LOCALES) {
      const seen = fullMatrixChecked.filter((label) => label.endsWith(`/${locale}`)).length;
      assert.equal(
        seen,
        customerCriticalPaths().length * WIDTHS.length,
        `locale ${locale} was measured ${seen} times, not once per surface per width`,
      );
    }
  }

  assert.deepEqual(failures, [], `horizontal overflow on real phone viewports:\n${failures.join('\n')}`);
});
