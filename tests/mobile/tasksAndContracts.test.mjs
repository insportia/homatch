// REAL viewport regression for the Running-tasks drawer and the contract
// upload entry.
//
// Both are places a customer meets long, unbreakable, non-Latin strings: a
// contract filename is whatever their phone called it, and a task row carries
// a cadastral code or that same filename. Neither had any viewport coverage,
// and both are rendered inside containers narrower than the page — a drawer
// and a card — where a flex row squeezes a label to one character wide
// without ever producing horizontal page overflow.
//
// So this measures what the page-overflow check cannot see, at the six widths
// Homatch supports, in all six languages, with deliberately hostile content.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const WIDTHS = [320, 360, 375, 390, 412, 430];
const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const RTL = new Set(['ar', 'he']);

const PREVIEW_PORT = 4321;
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;

/* The content that actually breaks these two surfaces. */
const KA_FILE = 'ნასყიდობის-ხელშეკრულება-კრწანისის-ქუჩა-N6-ბინა-42-2026-წლის-19-სექტემბერი.pdf';
const RU_FILE = 'договор-купли-продажи-квартиры-в-районе-Крцаниси-номер-42-от-19-сентября-2026.pdf';
const AR_FILE = 'عقد-بيع-شقة-في-حي-كرتسانيسي-رقم-42-بتاريخ-19-سبتمبر-2026.pdf';
const CADASTRAL = '01.18.06.019.055.03.01.601';

/** The signed-in profile. Without this row `homatchUser` is null and the
 *  Verification Center hides its contract card entirely. */
const PROFILE = {
  id: '00000000-0000-4000-8000-000000000001',
  auth_id: '00000000-0000-4000-8000-000000000001',
  email: 'harness@example.test', is_admin: false,
  preferred_language: 'en', full_name: 'Harness User',
  plan: 'FREE', created_at: new Date().toISOString(),
};

/** Jobs shaped exactly as background_job_public() returns them. */
const JOBS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    product_type: 'VERIFY', subject_type: 'RESEARCH_JOB',
    subject_id: 'e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c',
    subject_label: CADASTRAL,
    state: 'PROCESSING', stored_state: 'PROCESSING', can_cancel: false,
    progress: 62, current_stage: 'MARKET', stages: [],
    created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    cancel_deadline_at: null, committed_at: new Date().toISOString(),
    completed_at: null, failed_at: null, cancelled_at: null,
    last_heartbeat_at: new Date().toISOString(), user_safe_error: null,
    attempt: 1, result_ref: '/verify?job=e1b5d95c-b127-4baa-82a0-f89c1b4a0f8c',
    reservation_id: null, authorized_budget_credits: 0, metadata: {},
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    product_type: 'CONTRACT_ANALYSIS', subject_type: 'DOCUMENT',
    subject_id: '33333333-3333-4333-8333-333333333333',
    subject_label: KA_FILE,
    state: 'COMPLETED', stored_state: 'COMPLETED', can_cancel: false,
    progress: 100, current_stage: 'DONE', stages: [],
    created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    cancel_deadline_at: null, committed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(), failed_at: null, cancelled_at: null,
    last_heartbeat_at: new Date().toISOString(), user_safe_error: null,
    attempt: 1,
    result_ref: '/verify/44444444-4444-4444-8444-444444444444?tab=documents&doc=33333333-3333-4333-8333-333333333333',
    reservation_id: null, authorized_budget_credits: 0, metadata: {},
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    product_type: 'DOCUMENT_ANALYSIS', subject_type: 'DOCUMENT',
    subject_id: '66666666-6666-4666-8666-666666666666',
    subject_label: RU_FILE,
    state: 'FAILED', stored_state: 'FAILED', can_cancel: false,
    progress: 40, current_stage: null, stages: [],
    created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    cancel_deadline_at: null, committed_at: new Date().toISOString(),
    completed_at: null, failed_at: new Date().toISOString(), cancelled_at: null,
    last_heartbeat_at: new Date().toISOString(),
    user_safe_error: 'doc_error_billing',
    attempt: 1, result_ref: '/verify/77777777-7777-4777-8777-777777777777?tab=documents&doc=66666666-6666-4666-8666-666666666666',
    reservation_id: null, authorized_budget_credits: 0, metadata: {},
  },
  {
    // A legacy row whose product this build does not know: the safe-fallback
    // path, and the longest possible label.
    id: '88888888-8888-4888-8888-888888888888',
    product_type: 'SOME_FUTURE_PRODUCT', subject_type: 'PROPERTY',
    subject_id: '99999999-9999-4999-8999-999999999999',
    subject_label: AR_FILE,
    state: 'COMPLETED', stored_state: 'COMPLETED', can_cancel: false,
    progress: 100, current_stage: null, stages: [],
    created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    cancel_deadline_at: null, committed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(), failed_at: null, cancelled_at: null,
    last_heartbeat_at: new Date().toISOString(), user_safe_error: null,
    attempt: 1, result_ref: null,
    reservation_id: null, authorized_budget_credits: 0, metadata: {},
  },
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) {
    return process.env.PLAYWRIGHT_CHROME;
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function resolvePlaywright() {
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}

function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME to its path';
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

/*
 * THE MEASUREMENT.
 *
 * `crushed` is the defect this file exists for: an element narrower than
 * ~96px, far taller than it is wide, and several lines deep. It produces no
 * horizontal overflow at all, so a scrollWidth check cannot see it. The width
 * floor is deliberately low — a legitimate 200px paragraph running many lines
 * is ordinary prose.
 */
const PROBE = (vw) => {
  const de = document.documentElement;
  const overflow = [];
  const crushed = [];
  const clipped = [];

  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'auto' && s.overflowX !== 'scroll' && (r.right > vw + 1 || r.left < -1)) {
      overflow.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} right=${Math.round(r.right)}`);
    }
    if (el.children.length) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 4) continue;
    const fs = parseFloat(s.fontSize) || 16;
    if (r.width < 96 && r.height > r.width * 1.8 && r.height / (fs * 1.2) >= 3) {
      crushed.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)} "${text.slice(0, 24)}"`);
    }
    // Text cut off by its own box rather than wrapped. Visually-hidden
    // elements are 1px by design and are not clipped content.
    const hidden = /sr-only/.test(String(el.className || '')) || r.width <= 2 || r.height <= 2;
    if (!hidden && el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis') {
      clipped.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  return {
    dir: document.documentElement.getAttribute('dir') || 'ltr',
    pageOverflow: de.scrollWidth > de.clientWidth + 1,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    drawerOpen: !!document.querySelector('[role="dialog"]'),
    ctaCount: document.querySelectorAll('[role="dialog"] button').length,
    overflow: overflow.slice(0, 6),
    crushed: crushed.slice(0, 6),
    clipped: clipped.slice(0, 6),
  };
};

test('the tasks drawer and the contract entry survive every phone width in every language', opts, async (t) => {
  if (skipReason) assert.fail(`mobile regression could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' }
  );
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  t.after(async () => {
    await browser.close().catch(() => {});
    preview.kill();
  });

  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const failures = [];
  const measured = [];

  /* Full width sweep in Georgian (longest words), plus every other language
     at 320 where a long label first has nowhere to go. */
  const CASES = [
    ...WIDTHS.map((width) => ({ width, lang: 'ka' })),
    ...LANGS.filter((l) => l !== 'ka').map((lang) => ({ width: 320, lang })),
  ];

  for (const { width, lang } of CASES) {
    const ctx = await browser.newContext({
      viewport: { width, height: 880 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });

    await ctx.addInitScript(
      ([key, session, l]) => {
        window.localStorage.setItem(key, JSON.stringify(session));
        window.localStorage.setItem('homatch_lang', l);
      },
      ['sb-stubproj-auth-token', fakeSession(), lang]
    );

    const page = await ctx.newPage();
    const json = (body) => ({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

    // ONE handler: Playwright matches in reverse registration order, so a
    // catch-all registered later would shadow every specific pattern.
    await page.route('**', async (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE)) return route.continue();
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
          },
        });
      }
      if (url.includes('/rpc/background_jobs_mine')) return route.fulfill(json(JOBS));
      if (url.includes('/rest/v1/users')) return route.fulfill(json(PROFILE));
      if (url.includes('/rest/v1/')) return route.fulfill(json([]));
      return route.fulfill(json({}));
    });

    await page.goto(`${BASE}/verify`, { waitUntil: 'domcontentloaded' });

    /* 1. The contract entry, in the Verification Center's landing state. */
    await page.waitForSelector('input[type="file"]', { timeout: 20000 }).catch(() => {});
    const entry = await page.evaluate(PROBE, width);

    const accept = await page.evaluate(() => {
      const el = document.querySelector('input[type="file"]');
      return el ? { accept: el.getAttribute('accept') || '', label: el.getAttribute('aria-label') || '' } : null;
    });
    if (!accept) {
      failures.push(`${width}px ${lang}: the contract file input never rendered`);
    } else {
      if (!/\.pdf/.test(accept.accept) || !/\.docx/.test(accept.accept)) {
        failures.push(`${width}px ${lang}: contract picker does not offer PDF/DOCX (accept="${accept.accept}")`);
      }
      if (/image\//.test(accept.accept)) {
        failures.push(`${width}px ${lang}: contract picker offers an unreadable image format`);
      }
      if (!accept.label.trim()) {
        failures.push(`${width}px ${lang}: the file input has no accessible name`);
      }
    }

    /* 2. The Running-tasks drawer, opened from its own pill. */
    const pill = await page.$('button[aria-label]:not([aria-label=""])');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[aria-label]')];
      const b = btns.find((x) => /fixed/.test(x.className) && /rounded-full/.test(x.className));
      if (b) b.click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => {});
    /*
     * The drawer SLIDES IN. Measuring mid-transition reports the panel while
     * it is still partly off-screen, which looks exactly like an overflow
     * defect and is not one. Wait for the animation to settle rather than
     * guessing a duration.
     */
    await page.evaluate(async () => {
      const el = document.querySelector('[role="dialog"]');
      if (!el) return;
      await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    });
    await page.waitForTimeout(250);
    const drawer = await page.evaluate(PROBE, width);

    if (!drawer.drawerOpen) {
      failures.push(`${width}px ${lang}: the tasks drawer did not open (pill found: ${!!pill})`);
    } else if (drawer.ctaCount < 1) {
      failures.push(`${width}px ${lang}: the drawer rendered no actions at all`);
    }

    if (RTL.has(lang) && drawer.dir !== 'rtl') {
      failures.push(`${width}px ${lang}: expected dir=rtl, got ${drawer.dir}`);
    }

    for (const [label, r] of [['contract entry', entry], ['tasks drawer', drawer]]) {
      if (r.pageOverflow || r.overflow.length) {
        failures.push(`${width}px ${lang} [${label}]: horizontal overflow ${r.scrollWidth}>${r.clientWidth}\n    ${r.overflow.join('\n    ')}`);
      }
      if (r.crushed.length) {
        failures.push(`${width}px ${lang} [${label}]: one-character column(s)\n    ${r.crushed.join('\n    ')}`);
      }
      if (r.clipped.length) {
        failures.push(`${width}px ${lang} [${label}]: clipped text\n    ${r.clipped.join('\n    ')}`);
      }
    }

    measured.push(`${width}:${lang}`);
    await ctx.close();
  }

  /* What was really exercised — compared against a literal list, because
     comparing against the loop's own inputs is a tautology. */
  assert.deepEqual(
    measured,
    [
      '320:ka', '360:ka', '375:ka', '390:ka', '412:ka', '430:ka',
      '320:en', '320:ru', '320:tr', '320:ar', '320:he',
    ],
    `the suite did not cover every width and language, it covered ${JSON.stringify(measured)}`
  );

  assert.deepEqual(failures, [], `tasks/contract mobile defects:\n${failures.join('\n')}`);
});
