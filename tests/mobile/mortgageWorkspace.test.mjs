// HOME FINANCING, ON A PHONE, WITH THE NUMBERS ACTUALLY ON SCREEN.
//
// WHY THIS FILE EXISTS SEPARATELY FROM routeOverflow.test.mjs
//
// That gate opens /mortgage and measures it. It has always passed, and
// it was always going to: an empty workspace is a column of input cards
// and it fits anything. The renderings that can break a phone — a
// 240-month amortization schedule, a three-offer comparison, a term
// ladder, an eight-segment rate decomposition — only exist once a loan
// has been entered, and nothing had ever entered one.
//
// So this suite seeds a complete scenario into the key the workspace
// persists to, opens each of the nine topics in turn, and measures the
// page in the state a customer who filled the form actually sees.
//
// WHAT IT CHECKS BEYOND OVERFLOW
//
//   THE TOPIC REALLY RENDERED. Every assertion below would also pass on
//   a page that quietly fell back to "enter a loan first", so each topic
//   names the module it must have produced. A gate that cannot tell the
//   empty state from the answer is measuring the empty state.
//
//   NO RAW TRANSLATION KEY REACHES THE SCREEN. This is the defect that
//   shipped: nine keys lived only in DATABASE COLUMN VALUES, no literal
//   scan could see them, and production printed
//   `mortgage_kb_subsidy_human_explanation` at customers in all six
//   languages. Reading the rendered text in every locale is the only
//   check that would have caught it.
//
//   NO DESKTOP TABLE ON A PHONE. Wide tables must be replaced by cards
//   below their breakpoint, not shrunk into one-character columns.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  MORTGAGE_DRAFT,
  MORTGAGE_DRAFT_KEY,
  MORTGAGE_RULES,
  MORTGAGE_TOPIC_KEY,
  MORTGAGE_TOPICS,
} from './mortgageFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;

/** Every width the product claims to support. 320 is the floor. */
const WIDTHS = [320, 360, 375, 390, 412, 430];

/** The module each topic must have rendered for the measurement to mean
 *  anything. `[id^="program-"]` because a programme card is keyed by the
 *  knowledge-base row's uuid. */
const TOPIC_ANCHORS = {
  MONTHLY_PAYMENT: ['#payment', '#schedule'],
  AFFORDABILITY: ['#affordability'],
  UNDERSTAND_RATE: ['#rate'],
  COMPARE_TERMS: ['#terms'],
  COMPARE_OFFERS: ['#offers-input', '#offers-compare'],
  EARLY_REPAYMENT: ['#early-input', '#early-result'],
  REFINANCING: ['#refi-input', '#refi-result'],
  GOVERNMENT_PROGRAMS: ['[id^="program-"]'],
  BEFORE_YOU_SIGN: ['#before-you-sign', '#checklist'],
};

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
 *
 * Deliberately narrow: it matches the namespaces this product renders
 * (`mortgage_`, `wk_`, `inv_`) rather than every snake_case word, so a
 * cadastral code or a URL in body text cannot trip it.
 */
const KEY_LEAK = /\b(?:mortgage|wk|inv)_[a-z0-9]+(?:_[a-z0-9]+){1,}\b/g;

test('the home financing workspace fits a phone once a loan is entered', opts, async (t) => {
  if (skipReason) assert.fail(`mortgage workspace gate could not run: ${skipReason}`);

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
   * Open one topic at one width in one language, and report what is
   * wrong with it. Returns findings rather than asserting, so a single
   * run names every broken combination instead of the first.
   */
  async function open(topic, width, lang) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(
      ([draftKey, draft, topicKey, topicId, locale]) => {
        window.localStorage.setItem(draftKey, draft);
        window.localStorage.setItem(topicKey, topicId);
        window.localStorage.setItem('homatch_lang', locale);
      },
      [MORTGAGE_DRAFT_KEY, JSON.stringify(MORTGAGE_DRAFT), MORTGAGE_TOPIC_KEY, topic, lang],
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
      /* The knowledge base, filtered the way PostgREST would: the client
         asks for one type at a time. */
      if (url.includes('/rest/v1/mortgage_rules')) {
        const wanted = /type=eq\.([A-Z_]+)/.exec(url)?.[1];
        return r.fulfill(json(MORTGAGE_RULES.filter((row) => !wanted || row.type === wanted)));
      }
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });

    await page.goto(`${BASE}/mortgage`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.body.innerText.trim().length > 0,
      null, { timeout: 20000 },
    ).catch(() => { /* an empty page is a real result, reported below */ });

    /* Two topics only exist after an interaction, and both interactions
       are ones a customer performs on arrival. */
    if (topic === 'COMPARE_OFFERS') {
      /* Two offers is the minimum the comparison engine accepts. The
         rates are typed rather than left at the blank offer's zero,
         because a comparison of two 0% loans renders a table of
         zeroes — which fits any screen and proves nothing. */
      const add = page.locator('#offers-input > header button');
      for (let i = 0; i < 2; i += 1) {
        await add.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(120);
      }
      const rates = page.locator('[aria-labelledby="mtg-offerRate"] input');
      for (const [i, value] of [[0, '12.9'], [1, '13.4']]) {
        await rates.nth(i).fill(value, { timeout: 5000 }).catch(() => {});
      }
      await page.waitForTimeout(250);
    }
    if (topic === 'GOVERNMENT_PROGRAMS') {
      /* Answer the three questions that decide the verdict: a citizen,
         no earlier scheme, a child born after 1 September 2021. The
         fourth is a number chip and the last two are alternative
         routes, so this is the shortest path to a rendered verdict. */
      const groups = page.locator('[id^="program-"] div[role="group"]');
      for (const [group, button] of [[0, 0], [1, 1], [2, 0]]) {
        await groups.nth(group).locator('button').nth(button)
          .click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(250);
    }

    const anchors = TOPIC_ANCHORS[topic];
    const sample = ([vw, selectors]) => {
      const de = document.documentElement;
      const overflow = [];
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const style = getComputedStyle(el);
        // An element that scrolls on purpose is a solution, not a defect.
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        if (style.position === 'fixed') continue;
        if (rect.right > vw + 1) {
          overflow.push(`${el.tagName}.${String(el.className || '').slice(0, 40)} right=${Math.round(rect.right)}`);
        }
      }

      /* A table that is laid out at a phone width is the failure this
         product was told to avoid. One inside an overflow-x container
         is fine — it scrolls, and the reader can see whole columns. */
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
        if (!scrollable) tables.push(`${Math.round(rect.width)}px table with ${table.querySelectorAll('th,td').length} cells`);
      }

      /* Controls a thumb has to hit.
         Scoped to <main>: the workspace holds itself to 44px, while the
         shared site header runs its controls at 36px as a site-wide
         density decision taken elsewhere and shared by every page. This
         gate should not quietly redecide that for the whole product. */
      const small = [];
      const region = document.querySelector('main') ?? document.body;
      for (const el of region.querySelectorAll('button, a[href], input, select, [role="button"]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.height < 40) {
          small.push(`${el.tagName} ${Math.round(rect.height)}px "${(el.textContent || '').trim().slice(0, 24)}"`);
        }
      }

      return {
        mounted: document.body.innerText.trim().length > 0,
        text: document.body.innerText,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        missing: selectors.filter((s) => !document.querySelector(s)),
        overflow: overflow.slice(0, 4),
        tables: tables.slice(0, 2),
        small: small.slice(0, 3),
      };
    };

    /* Measure until two consecutive samples agree: nine browser suites
       share one machine, and a tree sampled mid-mount is legitimately
       wider than the settled one. A stably broken layout still fails;
       one that never settles is reported as never settling. */
    let previous = null;
    let result = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = await page.evaluate(sample, [width, anchors]);
      const shape = JSON.stringify([now.mounted, now.scrollWidth, now.missing, now.overflow, now.tables]);
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

  async function check(topic, width, lang) {
    const where = `${topic} @${width} ${lang}`;
    const r = await open(topic, width, lang);
    checked.push(where);
    if (!r.mounted) { failures.push(`${where}: rendered nothing`); return; }
    if (!r.settled) { failures.push(`${where}: layout never settled`); return; }
    if (r.missing.length) {
      failures.push(`${where}: the topic did not render — missing ${r.missing.join(', ')}`);
      return;
    }
    if (r.scrollWidth > r.clientWidth + 1 || r.overflow.length) {
      failures.push(`${where}: overflows — scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}\n    ${r.overflow.join('\n    ')}`);
    }
    if (r.tables.length) {
      failures.push(`${where}: a desktop table is laid out on a phone — ${r.tables.join('; ')}`);
    }
    if (r.small.length) {
      failures.push(`${where}: controls under 40px — ${r.small.join('; ')}`);
    }
    const leaked = [...new Set(r.text.match(KEY_LEAK) ?? [])];
    if (leaked.length) {
      failures.push(`${where}: untranslated keys on screen — ${leaked.slice(0, 5).join(', ')}`);
    }
  }

  /* 1. EVERY topic at the narrowest width, in Georgian. Long unhyphenated
        compounds in a 320px column: the hardest combination the product
        has, and a primary locale rather than an edge case. */
  for (const topic of MORTGAGE_TOPICS) await check(topic, 320, 'ka');

  /* 2. The two densest topics across every supported width. A schedule
        and an offer comparison are the only screens whose content grows
        with the loan rather than with the copy. */
  for (const width of WIDTHS) {
    await check('MONTHLY_PAYMENT', width, 'en');
    await check('COMPARE_OFFERS', width, 'en');
  }

  /* 3. Every remaining locale once — the check that reads rendered text
        for untranslated keys is only as good as its language coverage,
        and the defect this suite was written after was present in all
        six bundles at once. */
  for (const lang of ['ru', 'tr', 'ar', 'he']) {
    await check('GOVERNMENT_PROGRAMS', 390, lang);
  }

  /* 4. RTL, where a mirrored layout overflows on the side a left-only
        check never looks at. */
  for (const topic of ['UNDERSTAND_RATE', 'COMPARE_TERMS', 'AFFORDABILITY', 'BEFORE_YOU_SIGN']) {
    await check(topic, 360, 'he');
  }

  /* Coverage first: a clean run that measured nothing is not a pass, and
     the floor is a literal so shrinking the matrix cannot shrink it too. */
  assert.ok(checked.length >= 28, `the gate covered only ${checked.length} combinations`);
  assert.deepEqual(failures, [], `home financing on a phone:\n${failures.join('\n')}`);
});
