// FOR EXPATS must be READABLE at a phone width, not merely un-overflowing.
//
// routeOverflow.test.mjs asks whether anything sticks out past the right
// edge. Every FOR EXPATS route passed it while the product was broken,
// because the defect the owner found is the opposite failure: a column
// that gets too NARROW. Nothing overflowed. The prose cell in each cost
// row was squeezed to thirty pixels and the browser, having no other
// option, broke English mid-word — "MagtiCom's published home fibre
// packages" came out four characters to a line, down the screen.
//
// WHY THE RULE IS MEASURED AND NOT EYEBALLED
//
// "Looks cramped" is not a gate. "Narrower than its own longest word" is:
// below that width a browser MUST break inside a word, whatever the copy
// or the language. So each text cell is measured against its own widest
// token, rendered through a canvas with that element's computed font. A
// cell wider than its longest word can always wrap legally; a cell
// narrower than it cannot. That is the whole test, and it holds for
// Georgian compounds, German nouns, Arabic and a currency range alike.
//
// WHY NOT JUST SET word-break
//
// Because `word-break: break-all` makes the symptom invisible and keeps
// the bug: the column is still thirty pixels wide and the sentence is
// still unreadable, just without the ragged edge that gave it away. The
// fix is structural — a real `min-width` on the prose cell so the row
// wraps instead — and this gate is what keeps it structural.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Its own port: routeOverflow holds 4321, and node:test may run both. */
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;

const WIDTHS = [320, 360, 390, 430];

const TOPIC_SLUGS = [
  'entry-and-stay', 'residence-permits', 'opening-a-bank-account',
  'cost-of-living', 'healthcare-and-insurance', 'buying-property',
];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME) return process.env.PLAYWRIGHT_CHROME;
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
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : {};

/* ── Fixtures ────────────────────────────────────────────────────── */

/**
 * Content shaped like production's, including the sentence that broke.
 *
 * The Magticom note is here verbatim because it is the specific string the
 * owner saw wrap character-by-character: a long unhyphenated brand name
 * followed by numbers and a currency code. If the fixture used short copy
 * the gate would pass on a layout that still fails for real prose.
 */
const LONG_NOTE =
  "MagtiCom's published home fibre packages: 70 Mbps at GEL 33 promotional " +
  'and GEL 40 standard, 80 Mbps at GEL 50, 100 Mbps at GEL 60.';

const KA_NOTE =
  'მაგთიკომის გამოქვეყნებული საშინაო ბოჭკოვანი პაკეტები: 70 Mbps 33 ლარად ' +
  'სააქციო და 40 ლარად სტანდარტული, 80 Mbps 50 ლარად.';

const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

const localeBlock = (title, summary, body) =>
  Object.fromEntries(LOCALES.map((l) => [l, {
    title: l === 'ka' ? `${title} (ქართული)` : title,
    summary: l === 'ka' ? `${summary} ქართული შეჯამება წინადადებით.` : summary,
    sections: [
      { kind: 'SHORT_ANSWER', heading: l === 'ka' ? 'მოკლე პასუხი' : 'The short answer', body: l === 'ka' ? `${KA_NOTE} ${body}` : `${LONG_NOTE} ${body}` },
    ],
  }]));

/* Prose titles, as production has. A fixture title built from the slug
   would be one unbreakable 360px token and would fail the gate on the
   fixture rather than on the product. */
const TOPIC_TITLES = {
  'entry-and-stay': 'Entering Georgia and how long you may stay',
  'residence-permits': 'Residence permits: the routes, the cost and the deadline',
  'opening-a-bank-account': 'Opening a Georgian bank account',
  'cost-of-living': 'What a month in Georgia costs',
  'healthcare-and-insurance': 'Healthcare and insurance',
  'buying-property': 'Buying property in Georgia as a foreigner',
};

const TOPICS = TOPIC_SLUGS.map((slug, i) => ({
  id: `00000000-0000-4000-8000-00000000f0${i}0`,
  country: 'GE', slug,
  domain: 'RESIDENCY', pathway: 'MOVE', fact_class: 'RULE', register: 'OFFICIAL',
  sort_order: (i + 1) * 10, published: true,
  needs_review: false, review_reason: null,
  last_verified_at: '2026-09-01T00:00:00Z', review_due_at: null,
  content: localeBlock(
    TOPIC_TITLES[slug],
    'A summary long enough to wrap on a narrow viewport and be measured.',
    'Body copy that has to remain readable at three hundred and twenty pixels.',
  ),
}));

const CITATION = {
  id: '00000000-0000-4000-8000-00000000c001',
  publisher: 'Tbilisi Transport Company', official: true,
  url: 'https://example.test/source', title: 'A published tariff decision',
  observed_at: '2026-09-01T00:00:00Z', effective_from: '2026-04-01',
  published_at: '2026-04-01', language: 'ka', quote: null,
};

const FACTS = [{
  id: '00000000-0000-4000-8000-00000000fa01',
  topic_id: TOPICS[0].id, fact_key: 'visa-free-duration',
  fact_class: 'RULE', register: 'OFFICIAL', availability: 'ESTABLISHED',
  needs_review: false, observed_at: '2026-09-01T00:00:00Z',
  statement: Object.fromEntries(LOCALES.map((l) => [l,
    l === 'ka'
      ? 'მთავრობის დადგენილების დანართში ჩამოთვლილი ქვეყნების მოქალაქეებს შეუძლიათ უვიზოდ შემოსვლა.'
      : 'Citizens of the countries listed in the annex may enter and stay without a visa for one full year.',
  ])),
  expat_fact_citations: [{ citation_id: CITATION.id, expat_citations: CITATION }],
}];

const COSTS = [
  {
    id: '00000000-0000-4000-8000-00000000c101', city: 'Tbilisi', category: 'INTERNET',
    low: 33, high: 60, currency: 'GEL', status: 'CURRENT', basis: 'OBSERVED',
    observed_at: '2026-09-01T00:00:00Z', notes: LONG_NOTE,
    citation_id: CITATION.id, expat_citations: CITATION,
  },
  {
    id: '00000000-0000-4000-8000-00000000c102', city: 'Tbilisi', category: 'TRANSPORT',
    low: 40, high: 40, currency: 'GEL', status: 'CURRENT', basis: 'OBSERVED',
    observed_at: '2026-09-01T00:00:00Z',
    notes: "The operator's published price for a one-month unlimited travel card on Tbilisi public transport.",
    citation_id: CITATION.id, expat_citations: CITATION,
  },
];

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

/* ── The measurement, run inside the page ────────────────────────── */

/**
 * Returns every text cell narrower than its own longest word.
 *
 * Only leaf elements with real prose are considered: something with child
 * elements is a container whose width belongs to its children, and a
 * single long token with no spaces (a URL, a hash) has no legal break
 * point anywhere and is not evidence of a layout fault.
 */
const COLLAPSE_PROBE = () => {
  const ctx = document.createElement('canvas').getContext('2d');
  const bad = [];
  for (const el of document.querySelectorAll('p,li,dd,dt,span,div,td,th,h1,h2,h3,a,button,label')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 25 || !/\s/.test(text)) continue;
    const cs = getComputedStyle(el);
    if (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') continue;
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const width =
      el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let widest = 0;
    let word = '';
    for (const token of text.split(/\s+/)) {
      const w = ctx.measureText(token).width;
      if (w > widest) { widest = w; word = token; }
    }
    /* A pixel of slack for sub-pixel layout and font hinting. */
    if (width < widest - 1) {
      bad.push({
        tag: el.tagName,
        width: Math.round(width),
        widest: Math.round(widest),
        word: word.slice(0, 24),
        text: text.slice(0, 60),
      });
    }
  }
  return bad;
};

const PAGE_CENSUS = () => ({
  mounted: (document.body.innerText || '').trim().length > 0,
  textLength: (document.body.innerText || '').trim().length,
  h1: document.querySelector('h1')?.innerText?.trim() ?? null,
  path: location.pathname,
  dir: document.documentElement.getAttribute('dir') || getComputedStyle(document.body).direction,
  topicLinks: [...document.querySelectorAll('[data-expat-topic-link]')].map((a) => a.getAttribute('href')),
  pathways: [...document.querySelectorAll('[data-expat-pathway]')].map((a) => a.getAttribute('href')),
  cities: document.querySelectorAll('[data-expat-city]').length,
  drawers: document.querySelectorAll('[data-expat-evidence-open]').length,
  costRows: document.querySelectorAll('[data-expat-cost-row]').length,
  anchorTargets: ['topics', 'cost-of-living', 'budget', 'tools'].filter((id) => document.getElementById(id)),
  scrollWidth: document.body.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
});

test('FOR EXPATS stays readable at every supported width', opts, async (t) => {
  if (skipReason) assert.fail(`FOR EXPATS readability gate could not run: ${skipReason}`);

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

  async function open(path, width, lang, { signedIn = false } = {}) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700,
    });
    await ctx.addInitScript(
      ([key, session, locale, withSession]) => {
        if (withSession) window.localStorage.setItem(key, JSON.stringify(session));
        else window.localStorage.removeItem(key);
        window.localStorage.setItem('homatch_lang', locale);
      },
      ['sb-stubproj-auth-token', fakeSession(), lang, signedIn],
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

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
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/expat_topic_facts')) return r.fulfill(json(FACTS));
      if (url.includes('/rest/v1/expat_topics')) {
        const m = /slug=eq\.([^&]+)/.exec(url);
        return r.fulfill(json(m ? TOPICS.filter((x) => x.slug === decodeURIComponent(m[1])) : TOPICS));
      }
      if (url.includes('/rest/v1/expat_cost_observations')) return r.fulfill(json(COSTS));
      if (url.includes('/rest/v1/rpc/expat_market_readings')) return r.fulfill(json([]));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.body.innerText.trim().length > 0, null, { timeout: 20000 },
    ).catch(() => { /* an empty page is a result the census reports */ });
    /* Let the five parallel reads land and the layout settle. */
    await page.waitForTimeout(900);
    return { ctx, page, errors };
  }

  const failures = [];
  let checked = 0;

  /* 1. THE COLLAPSE RULE, over every route, width and both primary
        locales. This is the owner's defect, stated as a measurement. */
  const ROUTES = [
    '/for-expats/georgia',
    ...TOPIC_SLUGS.map((s) => `/for-expats/georgia/${s}`),
  ];
  for (const lang of ['en', 'ka']) {
    for (const width of WIDTHS) {
      for (const path of ROUTES) {
        const { ctx, page, errors } = await open(path, width, lang);
        const census = await page.evaluate(PAGE_CENSUS);
        const collapsed = await page.evaluate(COLLAPSE_PROBE);
        checked += 1;
        if (!census.mounted) failures.push(`${path} @${width}/${lang}: rendered nothing`);
        if (errors.length) failures.push(`${path} @${width}/${lang}: ${errors[0]}`);
        if (collapsed.length) {
          const worst = collapsed.sort((a, b) => a.width - b.width)[0];
          failures.push(
            `${path} @${width}/${lang}: ${collapsed.length} cell(s) narrower than their longest word — ` +
            `<${worst.tag}> ${worst.width}px wide, "${worst.word}" needs ${worst.widest}px: "${worst.text}"`,
          );
        }
        await ctx.close();
      }
    }
  }

  /* 2. RTL. A mirrored layout collapses on the other side, and a
        left-to-right-only check never sees it. */
  for (const path of ['/for-expats/georgia', '/for-expats/georgia/cost-of-living']) {
    const { ctx, page } = await open(path, 390, 'he');
    const census = await page.evaluate(PAGE_CENSUS);
    const collapsed = await page.evaluate(COLLAPSE_PROBE);
    checked += 1;
    assert.equal(census.dir, 'rtl', `${path} did not render right-to-left in Hebrew`);
    if (collapsed.length) failures.push(`${path} @390/he (RTL): ${collapsed.length} collapsed cell(s)`);
    await ctx.close();
  }

  assert.ok(checked >= 56, `the gate covered only ${checked} combinations`);
  assert.deepEqual(failures, [], `FOR EXPATS is not readable:\n  ${failures.join('\n  ')}`);
});

test('FOR EXPATS navigation goes where it says', opts, async (t) => {
  if (skipReason) assert.fail(`FOR EXPATS navigation gate could not run: ${skipReason}`);

  const { chromium } = resolvePlaywright();
  const preview = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT + 1), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  const base = `http://127.0.0.1:${PORT + 1}`;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }

  const json = (body) => ({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
  });

  async function open(path, lang, { signedIn = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(
      ([key, session, locale, withSession]) => {
        if (withSession) window.localStorage.setItem(key, JSON.stringify(session));
        else window.localStorage.removeItem(key);
        window.localStorage.setItem('homatch_lang', locale);
      },
      ['sb-stubproj-auth-token', fakeSession(), lang, signedIn],
    );
    const page = await ctx.newPage();
    await page.route('**', async (r) => {
      const url = r.request().url();
      if (url.startsWith(base)) return r.continue();
      if (r.request().method() === 'OPTIONS') {
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      }
      if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
      if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
      if (url.includes('/rest/v1/expat_topic_facts')) return r.fulfill(json(FACTS));
      if (url.includes('/rest/v1/expat_topics')) {
        const m = /slug=eq\.([^&]+)/.exec(url);
        return r.fulfill(json(m ? TOPICS.filter((x) => x.slug === decodeURIComponent(m[1])) : TOPICS));
      }
      if (url.includes('/rest/v1/expat_cost_observations')) return r.fulfill(json(COSTS));
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(900);
    return { ctx, page };
  }

  const failures = [];

  /* Every landing-page destination, followed. The seven that shipped dead
     all returned HTTP 200 and rendered the missing-page copy, so the only
     proof that a link works is opening it and reading what came back. */
  {
    const { ctx, page } = await open('/for-expats/georgia', 'en');
    const census = await page.evaluate(PAGE_CENSUS);

    assert.equal(census.cities, 3, 'the three city cards are gone');
    assert.deepEqual(
      census.anchorTargets, ['topics', 'cost-of-living', 'budget', 'tools'],
      'a section lost the id its hero row points at',
    );
    for (const href of census.pathways) {
      if (!href?.startsWith('#')) failures.push(`hero pathway points at ${href}, not an in-page anchor`);
      else if (!census.anchorTargets.includes(href.slice(1))) failures.push(`hero pathway ${href} has no target`);
    }
    assert.equal(census.topicLinks.length, TOPIC_SLUGS.length, 'the topic index lost a topic');

    const internal = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')));
    await ctx.close();

    /*
     * Follow the ones that stay inside this product.
     *
     * The handoffs to Verify, Investment, Mortgage, Contracts and AI Talk
     * are other products with their own gates and their own auth, and
     * opening them here would measure those instead of this one — their
     * existence as routes is proved statically in
     * src/expats/__tests__/localisedCopy.test.mjs. What has to be opened
     * is every FOR EXPATS destination, because the seven that shipped dead
     * all returned HTTP 200 and rendered the missing-page copy.
     */
    const inProduct = [...new Set(internal)].filter((h) => h.startsWith('/for-expats'));
    /* Six: one per topic. The four pathway rows are in-page anchors and the
       plan sits behind /auth/signup, so those are checked separately above
       and below rather than followed here. */
    assert.equal(
      inProduct.length, TOPIC_SLUGS.length,
      `expected one in-product link per topic, found ${inProduct.length}: ${inProduct.join(' ')}`,
    );
    for (const href of inProduct) {
      const o = await open(href.split('?')[0], 'en');
      const c = await o.page.evaluate(PAGE_CENSUS);
      /* The missing-page screen is short and says so. A real page is not. */
      if (c.textLength < 400) failures.push(`${href} rendered ${c.textLength} characters — it is the missing-page screen`);
      await o.ctx.close();
    }
  }

  /* All six topic routes carry their own content, not the fallback. */
  for (const slug of TOPIC_SLUGS) {
    const { ctx, page } = await open(`/for-expats/georgia/${slug}`, 'ka');
    const c = await page.evaluate(PAGE_CENSUS);
    if (!c.h1 || /do not have this page|არ გვაქვს/.test(c.h1)) failures.push(`topic ${slug}: ${c.h1}`);
    /* Georgian is present, and the page is not quietly serving English. */
    const body = await page.evaluate(() => document.body.innerText);
    if (!/[\u10A0-\u10FF]/.test(body)) failures.push(`topic ${slug}: no Georgian on the Georgian page`);
    await ctx.close();
  }

  /* The evidence drawer opens. A citation nobody can reach is a citation
     the product does not really have. */
  {
    const { ctx, page } = await open('/for-expats/georgia/entry-and-stay', 'en');
    const opener = page.locator('[data-expat-evidence-open]').first();
    if (await opener.count()) {
      await opener.click();
      await page.waitForTimeout(400);
      const text = await page.evaluate(() => document.body.innerText);
      if (!text.includes(CITATION.publisher)) failures.push('the evidence drawer opened without its source');
    } else {
      failures.push('no evidence drawer on a topic that has a sourced fact');
    }
    await ctx.close();
  }

  /* Anonymous and signed-in both resolve: the plan is the only gated
     route here, and the landing page must never require an account. */
  {
    const anon = await open('/for-expats/georgia', 'en');
    const c = await anon.page.evaluate(PAGE_CENSUS);
    if (c.path !== '/for-expats/georgia') failures.push(`the landing page redirected an anonymous visitor to ${c.path}`);
    if (c.costRows < 2) failures.push('the cost tool did not render for an anonymous visitor');
    await anon.ctx.close();

    const gated = await open('/for-expats/plan', 'en');
    const g = await gated.page.evaluate(PAGE_CENSUS);
    if (g.path === '/for-expats/plan') failures.push('the plan rendered for a signed-out visitor');
    await gated.ctx.close();

    const member = await open('/for-expats/plan', 'en', { signedIn: true });
    const m = await member.page.evaluate(PAGE_CENSUS);
    if (m.path !== '/for-expats/plan') failures.push(`a signed-in visitor was sent to ${m.path} instead of the plan`);
    await member.ctx.close();
  }

  assert.deepEqual(failures, [], `FOR EXPATS navigation is broken:\n  ${failures.join('\n  ')}`);
});
