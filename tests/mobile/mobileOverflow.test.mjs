// REAL viewport mobile regression for the Verification report.
//
// WHY THIS EXISTS RATHER THAN A DOM MEASUREMENT
//
// Overflow was previously checked by shrinking an <article> inside a
// 1920px-wide page and measuring scrollWidth. That is not a mobile test: the
// viewport is still 1920, so every `sm:` and `md:` rule stays active and the
// layout under test is the DESKTOP one squeezed into a narrow box. It can
// report failures that never happen on a phone and, worse, pass things that
// do.
//
// This drives a real Chrome at a real viewport, so media queries resolve the
// way they resolve on the device. The backend is stubbed, so the test needs
// no session, no network and no production data, and it is deterministic.
//
// The fixture is deliberately adversarial (see fixture.mjs): 26-character
// cadastral codes, 45-character unbroken Georgian and Russian compounds, long
// portal URLs inside the evidence drawer, wide matrices and comparables
// tables. Those are the inputs that actually break narrow layouts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { SYNTHESIS, STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

/** Real devices, narrowest first. 320 is the floor we support. */
/*
 * Phones AND the widths where several metric chips share one row.
 *
 * The one-character-column defect on the live report was a CONTAINER-width
 * failure: four chips competing inside `max-w-[68ch]` were all shrunk toward
 * zero. At 320px only one chip fits per line, so nothing competes and the
 * defect is invisible — a phone-only sweep reported green while production
 * was broken. 768 and 1280 are where it actually reproduces.
 */
const WIDTHS = [320, 360, 375, 390, 412, 430, 768, 1280];
/**
 * Chrome is DISCOVERED, not hardcoded to one machine's install path.
 * playwright-core downloads no browsers; it drives the Chrome already here.
 */
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
const PREVIEW_PORT = 4319;
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;
/** Matches the VITE_SUPABASE_URL the harness build is given. */
const STUB_SUPABASE = 'https://stubproj.supabase.co';

/**
 * playwright-core is resolved from the project OR from a path in
 * PLAYWRIGHT_CORE_PATH, so a machine can supply the driver without the repo
 * taking a heavy devDependency that CI may not want to install.
 */
function resolvePlaywright() {
  // In order of preference: a real dependency if one is ever added, the
  // provisioned .tooling/ directory (npm run test:mobile:setup), then an
  // explicit override. No hidden machine state is required for any of them.
  const candidates = [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next */ }
  }
  return null;
}

function haveDeps() {
  // Every skip reason names the exact command that fixes it. A suite that
  // skips for an unexplained reason is a suite nobody ever turns back on.
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Google Chrome not found — install it, or set PLAYWRIGHT_CHROME to its path';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) {
    return 'no build in dist/ — run: npm run build:harness';
  }
  /*
   * dist/ must be the HARNESS build specifically.
   *
   * A normal `npm run build` overwrites dist/ with a bundle pointing at the
   * real backend, and the stubs then intercept nothing — the page renders
   * signed out with no report and the suite fails for a reason that has
   * nothing to do with layout. Detect that and say which command fixes it,
   * rather than reporting a false overflow failure.
   */
  const bundled = readdirSync(distDir)
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

/*
 * A REAL CONTRACT, IN GEORGIAN, FOR THE CONTRACTS SWEEP.
 *
 * Taken from the persisted analysis of production document d4a86b9c — a
 * parking-space purchase agreement. Real text matters here: the defect this
 * suite exists to catch was a Georgian label squeezed into a one-character
 * column, and Georgian has no spaces to break on in a long legal phrase.
 * Invented Latin placeholder text would pass while the shipped screen failed.
 */
const CONTRACT_ANALYSIS = {
  documentType: 'ნასყიდობის ხელშეკრულება (უძრავი ქონების შესახებ)',
  summary: [
    'მყიდველი ყიდულობს მშენებარე ავტოსადგომს თბილისში, კრწანისის ქუჩა №6-ში, ბლოკ „ა“-ში, მე-2 სართულზე, 24.30 კვ.მ. ფართობით.',
    'ხელშეკრულებაში წერია, რომ 15 000 აშშ დოლარის ღირებულება სრულად გადახდილია ხელმოწერის დროისთვის.',
    'ქონება ხელშეკრულების გაფორმების დროს იპოთეკითაა დატვირთული სს „საქართველოს ბანკის“ სასარგებლოდ.',
  ],
  clauses: [
    {
      label: 'იპოთეკით დატვირთვა',
      plain: 'ქონება ხელმოწერის მომენტისთვის იპოთეკითაა დატვირთული ბანკის სასარგებლოდ.',
      quote: 'ნასყიდობის საგანი დატვირთულია იპოთეკით სს „საქართველოს ბანკის“ სასარგებლოდ',
      page: null,
      attention: 'MISSING_PROTECTION',
    },
  ],
  obligations: [
    {
      party: 'SELLER',
      label: 'იპოთეკის მოხსნა',
      plain: 'გამყიდველმა რეგისტრაციიდან ათი საბანკო დღის ვადაში იპოთეკა უნდა მოხსნას.',
      quote: 'ათი საბანკო დღის ვადაში გამყიდველი ვალდებულია მოხსნას რეგისტრირებული იპოთეკა',
      page: null,
    },
  ],
  deadlines: [
    { label: 'იპოთეკის მოხსნის ვადა', value: 'რეგისტრაციიდან 10 საბანკო დღე', quote: 'ათი საბანკო დღის ვადაში', page: null },
  ],
  financial: [
    { label: 'ქონების ჯამური ღირებულება', value: '15 000 აშშ დოლარი', quote: 'ნასყიდობის საგნის ჯამური ღირებულება შეადგენს 15 000 (თხუთმეტი ათასი) აშშ დოლარს', page: null },
    { label: 'გადახდის ანგარიში', value: 'GE50BG0000000545803196GEL', quote: 'ა/ა: GE50BG0000000545803196GEL', page: null },
  ],
  missingProtections: [
    { label: 'ჯარიმა ვადის დარღვევისთვის', plain: 'ხელშეკრულება არ ითვალისწინებს სანქციას, თუ გამყიდველი ვადას დაარღვევს.' },
  ],
  questions: [
    'აქვს თუ არა გამყიდველის წარმომადგენელს ხელშეკრულების ხელმოწერისთვის მოქმედი წარმომადგენლობითი უფლებამოსილება?',
  ],
  pages: 4,
  containsInstructionLikeText: false,
  analysedAt: '2026-09-18T14:51:49.828Z',
};

/** The row the Contracts pages read, with its container's property context. */
const CONTRACT_ROW = {
  id: 'fixture-doc',
  deal_room_id: 'fixture-room',
  label: 'გარაჟი ციალა მელაძე.docx',
  original_filename: 'გარაჟი ციალა მელაძე.docx',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size_bytes: 25576,
  uploaded_at: '2026-09-18T14:51:21.869Z',
  created_at: '2026-09-18T14:51:21.869Z',
  analysis_state: 'DONE',
  analysis: CONTRACT_ANALYSIS,
  analysis_error: null,
  deal_rooms: {
    cadastral_code: '01.18.06.019.055.03.01.601',
    address: 'საქართველო, თბილისი, კრწანისის რაიონი, კრწანისის ქუჩა, N6',
    verify_job_id: 'fixture-job',
  },
};

const skipReason = haveDeps();

/*
 * IN CI, A MISSING PREREQUISITE IS A FAILURE — NEVER A SILENT PASS.
 *
 * Skipping is the right behaviour on a laptop without Chrome: the suite says
 * which command fixes it and gets out of the way. In CI it is the worst
 * possible behaviour, because a workflow that skips its only layout gate
 * reports green while proving nothing. So CI turns every skip reason into a
 * hard failure that names the missing prerequisite.
 */
const STRICT = !!process.env.CI;

/*
 * Pass the option ONLY when actually skipping.
 *
 * `{ skip: null }` still marks the test as skipped in the reporter, so the
 * run counted pass 0 / fail 0 / skipped 1 while the body was really
 * executing and asserting. A gate that reports neither pass nor fail is
 * worse than no gate: it looks green and proves nothing.
 */
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

/** A session shaped the way supabase-js persists it, so the app boots signed in. */
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

test('the verification report has no horizontal overflow at real phone widths', opts, async (t) => {
  // In CI this is reached even when a prerequisite is missing, precisely so
  // the run fails loudly instead of reporting a green skip.
  if (skipReason) {
    assert.fail(`mobile regression could not run: ${skipReason}`);
  }

  const { chromium } = resolvePlaywright();

  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: process.cwd(), stdio: 'ignore', shell: process.platform === 'win32' }
  );

  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  t.after(async () => {
    await browser.close().catch(() => {});
    preview.kill();
  });

  // Wait for the preview server rather than sleeping a fixed amount.
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const failures = [];
  /*
   * What was actually exercised.
   *
   * `node --test` exits 0 for a suite that asserts nothing, so a future edit
   * that empties WIDTHS, or a loop that silently stops early, would report
   * green while covering no viewport at all. The run records what it really
   * measured and checks that at the end.
   */
  const measured = [];

  /*
   * THE TWO TYPEFACES THIS LAYOUT HAS TO SURVIVE.
   *
   * The harness intercepts every request, so the webfont never loads and
   * the browser falls back to whatever the machine has. On the CI runner
   * that is DejaVu Sans; on a Windows laptop it is Segoe UI, which is
   * narrower. The gate was therefore measuring a DIFFERENT typeface in
   * the two places — which is exactly how it passed locally and failed on
   * the runner for months, with the same code.
   *
   * So it now measures both, and both must be clean:
   *
   *   product   the stack as shipped, whatever the machine resolves it to
   *   fallback  a deliberately WIDE face, standing in for every machine
   *             where the webfont has not arrived
   *
   * Verdana is the stand-in because it is wider than DejaVu for Latin
   * text and is present on the developer machines here; where it is
   * absent the stack falls through to sans-serif, which on the runner is
   * DejaVu — the real CI condition either way.
   *
   * This is not a hypothetical. A customer on a slow connection sees the
   * fallback for the first seconds of every visit.
   */
  const FONT_MODES = ['product', 'fallback'];

  /*
   * EVERY LANGUAGE, AT THE WIDTH THAT BREAKS THINGS.
   *
   * The layout rule this report relies on is language-independent by
   * construction — a label owns its own line below `sm`, so nothing can
   * squeeze it to one character. That is a claim, and claims about six
   * alphabets are worth measuring rather than asserting.
   *
   * The full width sweep runs in the default language; every OTHER language
   * is measured at 320, which is where a long label first has nowhere to go.
   * Arabic and Hebrew also exercise RTL, where an unguarded flex row fails
   * differently.
   */
  const LANGS = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
  /*
   * THE TWO SCREENS A CUSTOMER READS LONG GEORGIAN TEXT ON.
   *
   * `verify` is the report. `contract` is the Contracts result page, which
   * did not exist when this harness was written and carries exactly the same
   * risk: legal prose, quoted passages, and labelled two-sided rows, on a
   * phone, in an alphabet with no convenient break points. Both are swept at
   * every width, in both font modes, and in all six languages at 320px.
   */
  const VIEWS = [
    { name: 'verify', path: '/verify?job=fixture-job', selector: '.verify-report' },
    { name: 'contract', path: '/contracts/fixture-doc', selector: '[data-contract-result]' },
  ];

  const CASES = VIEWS.flatMap((view) => [
    ...FONT_MODES.flatMap((fontMode) => WIDTHS.map((width) => ({ view, fontMode, width, lang: null }))),
    ...LANGS.map((lang) => ({ view, fontMode: 'product', width: 320, lang })),
  ]);

  for (const { view, fontMode, width, lang } of CASES) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
      isMobile: width <= 430,
      hasTouch: width <= 430,
    });

    /*
     * Forced at DOMContentLoaded, into the head.
     *
     * A <style> appended to documentElement before <head> exists is not
     * applied at all, and one inserted earlier in the cascade loses to
     * index.css's own :root rule. Last in the head, with !important on
     * the custom property, is what actually takes effect — verified by
     * reading back the computed font-family.
     */
    if (fontMode === 'fallback') {
      await ctx.addInitScript(() => {
        const put = () => {
          const st = document.createElement('style');
          st.textContent = ':root{'
            + '--font-body:Verdana,sans-serif !important;'
            + '--font-display:Verdana,sans-serif !important}';
          document.head.appendChild(st);
        };
        if (document.readyState === 'loading') addEventListener('DOMContentLoaded', put);
        else put();
      });
    }

    if (lang) {
      await ctx.addInitScript((l) => { window.localStorage.setItem('homatch_lang', l); }, lang);
    }

    await ctx.addInitScript(
      ([key, session]) => {
        // supabase-js v2 stores the session object itself under this key.
        // The v1 { currentSession } envelope is ignored, which is why the
        // harness first rendered signed out.
        window.localStorage.setItem(key, JSON.stringify(session));
      },
      ['sb-stubproj-auth-token', fakeSession()]
    );

    const page = await ctx.newPage();
    const json = (body) => ({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

    /*
     * ONE handler, not two.
     *
     * Playwright matches routes in REVERSE registration order, so a '**'
     * catch-all registered after a specific pattern silently shadows it —
     * which is exactly how the first version of this harness recorded zero
     * backend calls and rendered a signed-out page.
     */
    await page.route('**', async (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE)) return route.continue();
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/functions/v1/verify-synthesis')) return route.fulfill(json(SYNTHESIS));
      if (url.includes('/functions/v1/research-agent')) return route.fulfill(json(STATUS_RESPONSE));
      if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
      // The Contracts screens read this table three ways: a list, a single
      // row, and the analysis columns alone. All three are the same fixture.
      if (url.includes('/rest/v1/deal_room_documents')) {
        // maybeSingle() does not reliably set the PostgREST object Accept
        // header across supabase-js versions, so the QUERY is what decides:
        // a filter on a single id is a single-row read.
        const single = /[?&]id=eq\./.test(url)
          || (route.request().headers().accept || '').includes('vnd.pgrst.object');
        return route.fulfill(json(single ? CONTRACT_ROW : [CONTRACT_ROW]));
      }
      if (url.includes('/rest/v1/research_jobs')) return route.fulfill(json([]));
      if (url.includes('/rest/v1/')) return route.fulfill(json([]));
      // Anything unanticipated is answered emptily rather than reaching the
      // network, so the test can never depend on the outside world.
      return route.fulfill(json({}));
    });

    await page.goto(`${BASE}${view.path}`, { waitUntil: 'domcontentloaded' });
    /*
     * A VERIFY-SPECIFIC SELECTOR, NOT `article`.
     *
     * The Verify LANDING view renders an <article> too, so waiting on the
     * generic tag is satisfied by the search screen and the suite then
     * measures a page that contains none of the report it exists to check.
     * `.verify-report` only exists once a report is on screen.
     */
    await page.waitForSelector(view.selector, { timeout: 20000 }).catch(() => {});

    // Open the evidence drawer — the reported offender lives inside it.
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
    });
    await page.waitForTimeout(600);

    const result = await page.evaluate(([vw, sel]) => {
      const de = document.documentElement;
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const s = getComputedStyle(el);
        // An element that scrolls on purpose is a solution, not a defect.
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
        if (r.right > vw + 1 || r.left < -1) {
          offenders.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 60),
            right: Math.round(r.right),
            left: Math.round(r.left),
            text: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
      /*
       * THE ONE-CHARACTER COLUMN.
       *
       * The defect this report actually shipped: a label sharing a flex row
       * with something that refuses to shrink gets squeezed to roughly one
       * glyph wide and stacks vertically down the card. It causes NO
       * horizontal overflow, so the check above cannot see it at all.
       *
       * A crushed element is narrow, far taller than it is wide, and made of
       * several lines. The width floor is deliberately low: a legitimate
       * 206px paragraph running 16 lines is normal prose, and an earlier
       * version of this heuristic flagged it. Below ~96px no real sentence
       * wraps that way — that is a column of characters.
       */
      const crushed = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const text = (el.textContent || '').trim();
        if (text.length < 4) continue;
        const r = el.getBoundingClientRect();
        /*
         * THE BLIND SPOT THAT LET THE LIVE DEFECT THROUGH.
         *
         * This used to skip any element of zero width as invisible. A label
         * squeezed to ZERO by a non-shrinking sibling is not invisible — it
         * is the worst case of exactly the defect this detector exists to
         * catch, and it rendered 512px tall at one glyph per line on the
         * production report. Only genuinely collapsed elements (no height
         * either) are skipped now.
         */
        if (r.height === 0) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
        const lines = r.height / (fs * 1.2);
        if (r.width < 96 && r.height > r.width * 1.8 && lines >= 3) {
          crushed.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 60),
            w: Math.round(r.width),
            h: Math.round(r.height),
            text: text.slice(0, 30),
          });
        }
      }

      return {
        crushed: crushed.slice(0, 8),
        reportPresent: !!document.querySelector(sel),
        font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/['"]/g, ''),
        hasArticle: !!document.querySelector('article'),
        pageOverflow: de.scrollWidth > de.clientWidth,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        // Only the innermost offenders: a wide parent is usually a symptom.
        offenders: offenders.slice(0, 8),
        /*
         * THE MOBILE PRODUCT BAR.
         *
         * Measured in this pass rather than a suite of its own: it is fixed
         * chrome on every page swept here, so it costs one more evaluate and
         * gets the whole width × font × language matrix for free.
         *
         * `shown` is the fraction of each label that survives its container.
         * That single number is what a sixth item, a longer product name or a
         * padding change all show up as — it falls.
         */
        nav: (() => {
          const bar = document.querySelector('[data-mobile-nav]');
          if (!bar) return null;
          return [...bar.querySelectorAll('a')].map((a) => {
            const r = a.getBoundingClientRect();
            const span = a.querySelector('span:last-of-type');
            return {
              w: r.width,
              h: r.height,
              lineH: span ? span.getBoundingClientRect().height : 0,
              fontSize: span ? parseFloat(getComputedStyle(span).fontSize) || 16 : 16,
              shown: span ? span.clientWidth / Math.max(1, span.scrollWidth) : 1,
            };
          });
        })(),
      };
    }, [width, view.selector]);

    await ctx.close();

    // The REPORT, specifically — not merely some <article> on some screen.
    assert.ok(result.reportPresent, `${view.name} @ ${width}px: the view never rendered — the harness stubs are wrong`);
    assert.equal(result.clientWidth, width, `${view.name} @ ${width}px: the viewport was not actually applied`);
    if (fontMode === 'product' && !lang) measured.push({ view: view.name, width });

    /* ------------------------------------------------------------------ *
     * THE MOBILE PRODUCT BAR — FIVE SLOTS, AND WHAT THAT COSTS.           *
     *                                                                     *
     * Contracts became a product and needed a place on a phone. There was  *
     * no free slot, so the bar's own rule applied: five and no more, and   *
     * the lowest-ranked Communications item moved to the drawer. These     *
     * numbers are what makes that a decision rather than a hope.           *
     *                                                                     *
     * Measured before they were written, at 320-430px in all six           *
     * languages: 5 items, 64px wide and 64px tall at the narrowest, every  *
     * label on one line, no overflow anywhere, and the worst label         *
     * (Georgian „ხელშეკრულებები") showing 51% of itself.                   *
     *                                                                     *
     * A sixth item takes each slot from 64px to 53px and drags the worst   *
     * label under 45%, so the thresholds below are what a crushed bar      *
     * actually looks like — not a guess at one.                           *
     * ------------------------------------------------------------------ */
    if (width <= 430 && result.nav) {
      const where = `${view.name} @ ${width}px${lang ? ` (${lang})` : ''}`;

      assert.equal(result.nav.length, 5, `${where}: the bar must hold exactly five slots`);

      for (const item of result.nav) {
        // A thumb is about 44px. Anything less is a target you miss.
        assert.ok(
          item.h >= 44,
          `${where}: a slot is only ${Math.round(item.h)}px tall — under a thumb`
        );
        assert.ok(
          item.w >= 60,
          `${where}: a slot is only ${Math.round(item.w)}px wide — a sixth item would do this`
        );
        // One line. A label that wraps inside a 64px slot is the
        // one-character column defect wearing a different hat.
        assert.ok(
          item.lineH > 0 && item.lineH <= item.fontSize * 1.8,
          `${where}: a label wrapped to ${Math.round(item.lineH)}px on a ${Math.round(item.fontSize)}px font`
        );
      }

      const worst = Math.min(...result.nav.map((i) => i.shown));
      assert.ok(
        worst >= 0.45,
        `${where}: only ${Math.round(worst * 100)}% of the narrowest label is visible ` +
        '— below this a truncation stops being a word'
      );
    }

    /* The font actually in use, read back rather than assumed — an
       override that silently failed to apply would make this half of the
       run a duplicate of the other half. */
    if (fontMode === 'fallback' && !result.font.startsWith('Verdana')) {
      failures.push(`${width}px: the fallback font was not applied (got ${result.font})`);
    }

    /*
     * A crushed column produces no overflow, so it needs its own failure.
     * This is the defect a customer photographed; it may never regress
     * silently again.
     */
    if (result.crushed.length) {
      const detail = result.crushed
        .map((c) => `    ${c.tag}.${c.cls} ${c.w}x${c.h} "${c.text}"`)
        .join('\n');
      failures.push(
        `${width}px [${fontMode} font${lang ? `, ${lang}` : ''}]: one-character column(s)\n${detail}`
      );
    }

    if (result.pageOverflow || result.offenders.length) {
      failures.push(`${width}px [${fontMode} font${lang ? `, ${lang}` : ''}]: scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth}\n` +
        result.offenders.map((o) => `    ${o.tag}.${o.cls} right=${o.right} "${o.text}"`).join('\n'));
    }
  }

  // Coverage first: an overflow-free run that measured nothing is not a pass.
  //
  // Compared against a LITERAL list, deliberately, not against WIDTHS.
  // Comparing to WIDTHS is a tautology — shrinking WIDTHS shrinks both sides
  // and the guard stays green, which is exactly what a mutation test caught.
  // These eight widths are the supported contract; changing them has to be a
  // deliberate edit here. 412 is the common Android width (Pixel class) and
  // was added with the COMPANY & OWNERSHIP section, whose ownership rows and
  // encumbrance card are the narrowest new content in the report.
  // Each VIEW must cover every width, not merely the union of them: a sweep
  // that measured Verify eight times and the contract once would otherwise
  // satisfy a flat comparison while leaving a whole screen unmeasured.
  const SUPPORTED = [320, 360, 375, 390, 412, 430, 768, 1280];
  for (const view of VIEWS) {
    assert.deepEqual(
      measured.filter((m) => m.view === view.name).map((m) => m.width),
      SUPPORTED,
      `${view.name} did not measure every supported width, it covered ${
        JSON.stringify(measured.filter((m) => m.view === view.name).map((m) => m.width))}`
    );
  }

  assert.deepEqual(failures, [], `horizontal overflow at real phone widths:\n${failures.join('\n')}`);
});
