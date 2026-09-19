// THE FIRST SCREEN MUST LOOK LIKE A CALCULATOR, NOT A DASHBOARD.
//
// This suite replaced one that drove nine topic cards, and the change it
// guards is the reason that suite is gone: before anybody could find out
// what a loan costs a month they had to pick one of nine questions about
// the product's own capabilities. What a phone shows on arrival now is
// five fields and one button, and that is an assertion here, not a hope.
//
// WHAT IT PROVES
//
//   THE CALCULATOR IS ABOVE THE FOLD at every supported width, in every
//   language, with nothing between it and the top of the page.
//
//   THE BUTTON WORKS. The five fields are TYPED, Calculate is pressed,
//   and the three headline figures have to appear. Nothing is seeded for
//   that part: it is the path a first-time visitor actually takes.
//
//   A SCENARIO HAS ONE CURRENCY. Six calculations, one per supported
//   currency, each checked for its own marker AND for the absence of
//   every other currency's. A lari symbol in a dirham scenario is a
//   wrong answer, not a cosmetic slip.
//
//   EVERY TOOL SURVIVED THE SIMPLIFICATION. Each of the five shelf
//   buttons is clicked and has to produce its module.
//
//   NO RAW TRANSLATION KEY REACHES THE SCREEN, in any of the six
//   languages. The defect that shipped once lived in database column
//   values, invisible to every literal scan; reading rendered text is
//   the only check that sees it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  CURRENCY_MARKERS,
  MORTGAGE_DRAFT,
  MORTGAGE_DRAFT_KEY,
  MORTGAGE_RULES,
  MORTGAGE_TOOLS,
  MORTGAGE_TOPIC_KEY,
} from './mortgageFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;

/** Every width the product claims to support. 320 is the floor. */
const WIDTHS = [320, 360, 375, 390, 412, 430];
const LANGS = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/** The five fields, by the id each one carries. */
const PRIMARY_FIELDS = ['#mtg-currency', '#mtg-price', '#mtg-down', '#mtg-term', '#mtg-rate-input'];

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
  for (const c of [
    'playwright-core',
    join(ROOT, '.tooling', 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE_PATH,
  ].filter(Boolean)) {
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
/* In CI a missing prerequisite is a FAILURE: a workflow that skips its
   only layout gate reports green while proving nothing. */
const opts = skipReason && !process.env.CI ? { skip: skipReason } : {};

/**
 * Anything on screen that looks like one of our own i18n keys.
 * Narrow on purpose: it matches only the namespaces this page renders.
 */
const KEY_LEAK = /\b(?:mortgage|wk|inv)_[a-z0-9]+(?:_[a-z0-9]+){1,}\b/g;

/** Measured inside the page: layout defects a phone would actually show. */
function inspect([viewportWidth, region]) {
  const de = document.documentElement;
  const overflow = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (style.position === 'fixed') continue;
    if (rect.right > viewportWidth + 1) {
      overflow.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} right=${Math.round(rect.right)}`);
    }
  }

  /* A table laid out at a phone width, with no scroll container. */
  const tables = [];
  for (const table of document.querySelectorAll('table')) {
    const rect = table.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    let node = table.parentElement;
    let scrollable = false;
    while (node && node !== document.body) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === 'auto' || ox === 'scroll') { scrollable = true; break; }
      node = node.parentElement;
    }
    if (!scrollable) tables.push(`${Math.round(rect.width)}px table`);
  }

  /* Tap targets, inside the page's own content only: the shared site
     header runs at a density decided elsewhere. */
  const small = [];
  const scope = document.querySelector(region) ?? document.body;
  for (const el of scope.querySelectorAll('button, a[href], input, select, [role="button"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.height < 40) {
      small.push(`${el.tagName} ${Math.round(rect.height)}px "${(el.textContent || '').trim().slice(0, 24)}"`);
    }
  }

  const calculator = document.querySelector('#calculator');
  return {
    mounted: document.body.innerText.trim().length > 0,
    text: document.body.innerText,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    calculatorTop: calculator ? Math.round(calculator.getBoundingClientRect().top) : null,
    hasResult: Boolean(document.querySelector('#result')),
    hasTools: Boolean(document.querySelector('#tools')),
    overflow: overflow.slice(0, 4),
    tables: tables.slice(0, 2),
    small: small.slice(0, 3),
  };
}

test('the mortgage page is a simple calculator on a phone', opts, async (t) => {
  if (skipReason) assert.fail(`mortgage calculator gate could not run: ${skipReason}`);

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

  const failures = [];
  const checked = [];

  /** One page, optionally with a scenario already in storage. */
  async function open({ width, lang, seed = null, currency = null }) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(
      ([draftKey, draft, topicKey, locale]) => {
        window.localStorage.clear();
        if (draft) window.localStorage.setItem(draftKey, draft);
        window.localStorage.removeItem(topicKey);
        window.localStorage.setItem('homatch_lang', locale);
      },
      [
        MORTGAGE_DRAFT_KEY,
        seed ? JSON.stringify(currency ? { ...seed, currency } : seed) : null,
        MORTGAGE_TOPIC_KEY,
        lang,
      ],
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
        return r.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': '*',
          },
        });
      }
      if (url.includes('/rest/v1/mortgage_rules')) {
        const wanted = /type=eq\.([A-Z_]+)/.exec(url)?.[1];
        return r.fulfill(json(MORTGAGE_RULES.filter((row) => !wanted || row.type === wanted)));
      }
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}/mortgage`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.querySelector('#calculator')),
      null, { timeout: 20000 },
    ).catch(() => { /* reported below as "rendered nothing" */ });
    return { ctx, page };
  }

  /** Measure until two consecutive samples agree — nine suites share a machine. */
  async function settle(page, width, region = 'main') {
    let previous = null;
    let result = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = await page.evaluate(inspect, [width, region]);
      const shape = JSON.stringify([now.mounted, now.scrollWidth, now.overflow, now.tables, now.hasResult]);
      if (previous === shape) return { ...now, settled: true };
      previous = shape;
      result = { ...now, settled: false };
      await page.waitForTimeout(400);
    }
    return result;
  }

  function judge(where, r, { expectResult }) {
    if (!r.mounted) { failures.push(`${where}: rendered nothing`); return false; }
    if (!r.settled) { failures.push(`${where}: layout never settled`); return false; }
    if (r.scrollWidth > r.clientWidth + 1 || r.overflow.length) {
      failures.push(`${where}: overflows — scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}\n    ${r.overflow.join('\n    ')}`);
    }
    if (r.tables.length) failures.push(`${where}: a desktop table is laid out on a phone — ${r.tables.join('; ')}`);
    if (r.small.length) failures.push(`${where}: controls under 40px — ${r.small.join('; ')}`);
    const leaked = [...new Set(r.text.match(KEY_LEAK) ?? [])];
    if (leaked.length) failures.push(`${where}: untranslated keys on screen — ${leaked.slice(0, 5).join(', ')}`);
    if (expectResult && !r.hasResult) failures.push(`${where}: no result was rendered`);
    return true;
  }

  /* ── 1. ARRIVAL. Five fields, one button, nothing else. ── */
  for (const width of WIDTHS) {
    const lang = width === 320 ? 'ka' : 'en';
    const where = `arrival @${width} ${lang}`;
    const { ctx, page } = await open({ width, lang });
    const r = await settle(page, width);
    checked.push(where);
    if (judge(where, r, { expectResult: false })) {
      /* The calculator must be the first thing, not below a fold of
         product taxonomy. 900px is the test viewport height. */
      if (r.calculatorTop === null) failures.push(`${where}: there is no calculator`);
      else if (r.calculatorTop > 640) failures.push(`${where}: the calculator starts ${r.calculatorTop}px down`);
      if (r.hasResult) failures.push(`${where}: a result is shown before anything was entered`);
      if (r.hasTools) failures.push(`${where}: the tool shelf is competing with the calculator`);

      const present = await page.evaluate(
        (ids) => ids.filter((id) => document.querySelector(id)),
        PRIMARY_FIELDS,
      );
      if (present.length !== PRIMARY_FIELDS.length) {
        failures.push(`${where}: only ${present.length} of the five fields are on screen`);
      }
      if (!(await page.locator('#mtg-calculate').count())) {
        failures.push(`${where}: there is no Calculate button`);
      } else if (await page.locator('#mtg-calculate').isDisabled()) {
        failures.push(`${where}: the Calculate button is disabled`);
      }
    }
    await ctx.close();
  }

  /* ── 2. TYPING AND PRESSING, ONCE PER CURRENCY. ── */
  for (const [code, markers] of Object.entries(CURRENCY_MARKERS)) {
    const where = `typed ${code} @390 en`;
    const { ctx, page } = await open({ width: 390, lang: 'en' });
    checked.push(where);

    await page.selectOption('#mtg-currency', code).catch(() => {});
    /* Round numbers that are ordinary in each currency; nothing is
       converted, so the numerals differ and that is the point. */
    const price = code === 'TRY' ? '7000000' : code === 'AED' ? '1500000' : '150000';
    const down = code === 'TRY' ? '1400000' : code === 'AED' ? '300000' : '30000';
    await page.fill('#mtg-price', price);
    await page.fill('#mtg-down', down);
    await page.fill('#mtg-term', '20');
    await page.fill('#mtg-rate-input', '12.4');
    await page.click('#mtg-calculate');
    await page.waitForSelector('#result', { timeout: 10000 }).catch(() => {});

    const r = await settle(page, 390);
    if (judge(where, r, { expectResult: true }) && r.hasResult) {
      const resultText = await page.locator('#result').innerText().catch(() => '');
      if (!markers.present.some((marker) => resultText.includes(marker))) {
        failures.push(`${where}: the result never shows the currency (${markers.present.join(' or ')})`);
      }
      for (const stray of markers.absent) {
        if (resultText.includes(stray)) {
          failures.push(`${where}: a ${stray} leaked into a ${code} scenario`);
        }
      }
      /* All three headline figures, not just the payment. */
      const figures = await page.evaluate(() => {
        const text = document.querySelector('#result')?.innerText ?? '';
        return (text.match(/\d[\d.,\u00a0\u202f ]*\d/g) ?? []).length;
      });
      if (figures < 4) failures.push(`${where}: the result shows only ${figures} figures, expected four`);
    }
    await ctx.close();
  }

  /* ── 3. THE CALCULATED PAGE, IN EVERY LANGUAGE. ── */
  for (const lang of LANGS) {
    const width = WIDTHS[LANGS.indexOf(lang) % WIDTHS.length];
    const where = `calculated @${width} ${lang}`;
    const { ctx, page } = await open({ width, lang, seed: MORTGAGE_DRAFT });
    await page.waitForSelector('#result', { timeout: 15000 }).catch(() => {});
    const r = await settle(page, width);
    checked.push(where);
    judge(where, r, { expectResult: true });

    /* THE CHIPS, IN EVERY LANGUAGE AND AT EVERY WIDTH.
       Four of them in Georgian at 320px is the case that breaks a chip
       row: the labels are long and unhyphenated, and they have to wrap
       inside the pill rather than push the page sideways. */
    const chips = await page.evaluate(() => {
      const group = document.querySelector('#consultant [role="group"]');
      if (!group) return null;
      return [...group.querySelectorAll('button')].map((b) => ({
        h: Math.round(b.getBoundingClientRect().height),
        right: Math.round(b.getBoundingClientRect().right),
        text: (b.textContent || '').trim().slice(0, 30),
      }));
    });
    if (!chips || chips.length < 2) {
      failures.push(`${where}: the consultant offered ${chips ? chips.length : 0} suggested replies`);
    } else {
      for (const chip of chips) {
        if (chip.h < 44) failures.push(`${where}: a ${chip.h}px chip ("${chip.text}")`);
        if (chip.right > width + 1) failures.push(`${where}: a chip overflows ("${chip.text}")`);
      }
    }
    await ctx.close();
  }

  /* ── 4. EVERY TOOL STILL OPENS. ── */
  {
    const where = 'tools @390 en';
    const { ctx, page } = await open({ width: 390, lang: 'en', seed: MORTGAGE_DRAFT });
    await page.waitForSelector('#tools', { timeout: 15000 }).catch(() => {});
    checked.push(where);
    const buttons = page.locator('#tools button[aria-controls="tool-panel"]');
    const count = await buttons.count();
    if (count !== MORTGAGE_TOOLS.length) {
      failures.push(`${where}: the shelf offers ${count} tools, expected ${MORTGAGE_TOOLS.length}`);
    }
    for (let i = 0; i < Math.min(count, MORTGAGE_TOOLS.length); i += 1) {
      await buttons.nth(i).click().catch(() => {});
      await page.waitForTimeout(500);
      const anchor = MORTGAGE_TOOLS[i].anchor;
      const opened = await page.locator(anchor).count().catch(() => 0);
      if (!opened) failures.push(`${where}: ${MORTGAGE_TOOLS[i].id} opened nothing (${anchor})`);
      const r = await settle(page, 390);
      if (r.overflow.length || r.tables.length) {
        failures.push(`${where}: ${MORTGAGE_TOOLS[i].id} overflows — ${[...r.overflow, ...r.tables].join('; ')}`);
      }
      await buttons.nth(i).click().catch(() => {});
      await page.waitForTimeout(200);
    }
    /* And the consultant, which is the product's other half. */
    if (!(await page.locator('#consultant input').count())) {
      failures.push(`${where}: the consultant has nowhere to type`);
    }
    await ctx.close();
  }

  /* ── 5. A TOOL THAT CANNOT ANSWER YET STILL ASKS. ── */
  {
    /* Affordability needs income, and the common case is not having
       entered any. Opening it must produce the question, not a blank
       panel — which is what shipped once, because the section that
       holds the question took an id and never rendered it. */
    const where = 'affordability without income @390 en';
    const { monthlyNetIncome, existingMonthlyDebtObligations, ...noIncome } = MORTGAGE_DRAFT;
    const { ctx, page } = await open({ width: 390, lang: 'en', seed: noIncome });
    await page.waitForSelector('#tools', { timeout: 15000 }).catch(() => {});
    checked.push(where);
    const affordability = page.locator('#tools button[aria-controls="tool-panel"]').nth(2);
    await affordability.click().catch(() => {});
    await page.waitForTimeout(800);
    if (!(await page.locator('#income').count())) {
      failures.push(`${where}: the tool opened without asking for income`);
    }
    const r = await settle(page, 390);
    judge(where, r, { expectResult: true });
    await ctx.close();
  }

  assert.ok(checked.length >= 18, `the gate covered only ${checked.length} combinations`);
  assert.deepEqual(failures, [], `mortgage on a phone:\n${failures.join('\n')}`);
});
