// WHAT THE OWNER SAW ON A REAL GEORGIAN PHONE, AND MUST NOT SEE AGAIN.
//
// Everything asserted here was physically observed on the live page on
// 19 September 2026, in Georgian, with the owner's own scenario:
//
//   ამ პირობებით თვეში დაახლოებით {{monthly}} გადაიხდი 8 წლის განმავლობაში.
//   ...მაღალია.(მანძილი გამოცხადებულ და ეფექტურ განაკვეთს შორის)
//   PTI   LTV
//   Subsidized Mortgage Loan — families with children (Decree No. 388…)
//
// and, after six questions about a family's children, one sentence with
// no reason under it.
//
// The unit suite in src/mortgage/__tests__ proves the rule engine and
// the copy data. Only a browser can prove what is actually on a screen
// at 320 pixels in Georgian, which is where all four of those defects
// lived and where none of the other gates could see them.
//
// Same harness as mortgageConsultant.test.mjs: the harness build, a
// vite preview, and every Supabase call answered from the fixture that
// was copied out of production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { MORTGAGE_RULES, MORTGAGE_DRAFT_KEY, MORTGAGE_TOPIC_KEY } from './mortgageFixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4331;
const BASE = `http://127.0.0.1:${PORT}`;

/** The owner's scenario: 120,000 USD, 15,000 down, 8 years, 13%. */
const OWNER_DRAFT = {
  propertyPrice: 120000,
  currency: 'USD',
  downPayment: 15000,
  termMonths: 96,
  nominalAnnualRatePercent: 13,
  rateType: null,
  originationFeePercent: null,
  monthlyFeeFlat: null,
  mandatoryInsuranceAnnualFlat: null,
  valuationFeeFlat: null,
  gracePeriodMonths: null,
  effectiveAnnualRatePercentFromBank: null,
  monthlyNetIncome: null,
  existingMonthlyDebtObligations: null,
  extraPaymentAmount: null,
  extraPaymentMonth: null,
  recurringMonthlyExtra: null,
  knownEarlyRepaymentFeeFlat: null,
  ownRemainingPrincipal: null,
  ownRemainingTermMonths: null,
  ownNominalRatePercent: null,
  refiNewRatePercent: null,
  refiNewTermMonths: null,
  refinancingFeesFlat: null,
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : {};

/**
 * Everything a customer would see that they should not.
 *
 * Measured after the disclosures are open, because a closed <details>
 * returns '' from innerText for perfectly good content — that is how
 * the page came to look as though it had three empty headings in it.
 */
function artefacts() {
  const seen = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 || b.height > 0;
  };
  const inClosedDetails = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.open) return true;
    }
    return false;
  };
  const where = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) if (n.id) return n.id;
    return '(body)';
  };
  const text = document.body.innerText;
  const de = document.documentElement;
  return {
    text,
    dir: de.getAttribute('dir') || getComputedStyle(document.body).direction,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    placeholders: [...new Set(text.match(/\{\{[^}]*\}\}/g) ?? [])],
    parentheticals: [...new Set(text.match(/\([^)]{16,}\)/g) ?? [])],
    emptyHeadings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter((h) => seen(h) && !inClosedDetails(h) && !(h.innerText || '').trim())
      .map((h) => `${h.tagName}@${where(h)}`),
    emptyItems: [...document.querySelectorAll('li')]
      .filter((li) => seen(li) && !inClosedDetails(li) && !(li.innerText || '').trim()
        && !li.querySelector('img,svg,input,button'))
      .map((li) => `li@${where(li)}`),
    askButtons: document.querySelectorAll('[data-ask-homatch]').length,
  };
}

test('the Georgian mortgage page says what it means, on a phone', opts, async (t) => {
  if (skipReason) assert.fail(`mortgage copy gate could not run: ${skipReason}`);

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

  async function open({ width = 390, lang = 'ka', draft = OWNER_DRAFT, topic = null } = {}) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700,
    });
    await ctx.addInitScript(
      ([draftKey, draftJson, topicKey, openTopic, locale]) => {
        window.localStorage.clear();
        if (draftJson) window.localStorage.setItem(draftKey, draftJson);
        if (openTopic) window.localStorage.setItem(topicKey, openTopic);
        else window.localStorage.removeItem(topicKey);
        window.localStorage.setItem('homatch_lang', locale);
      },
      [MORTGAGE_DRAFT_KEY, draft ? JSON.stringify(draft) : null, MORTGAGE_TOPIC_KEY, topic, lang],
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
    await page.waitForFunction(() => Boolean(document.querySelector('#result')), null, { timeout: 25000 });
    await page.waitForTimeout(700);
    return { ctx, page };
  }

  /**
   * Open every disclosure inside the workspace, three passes, because
   * opening one reveals collapsibles that were not in the DOM before.
   *
   * SCOPED TO .hm-workspace ON PURPOSE. The shared site header also has
   * an aria-expanded control — the language switcher — and a sweep that
   * clicks everything on the page changes the language out from under
   * the assertion that the language is right.
   */
  async function expand(page) {
    /*
     * A DOM click, not page.click(). Playwright's click waits for the
     * element to be actionable — stable, visible, unobscured — and a
     * disclosure that is briefly none of those costs the full timeout
     * before the catch. Thirty of them, three passes, ten viewports:
     * the sweep took longer than the rest of the suite put together.
     * These are toggles, and a toggle only needs its handler run.
     */
    for (let pass = 0; pass < 3; pass += 1) {
      const opened = await page.evaluate(() => {
        const nodes = [
          ...document.querySelectorAll('.hm-workspace button[aria-expanded="false"]'),
          ...document.querySelectorAll('.hm-workspace details:not([open]) > summary'),
        ];
        for (const node of nodes) node.click();
        return nodes.length;
      });
      if (!opened) break;
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(400);
  }

  const failures = [];
  const note = (where, message) => failures.push(`${where}: ${message}`);

  /* ── 1. The result sentence, which is where {{monthly}} appeared ── */
  await t.test('the result sentence carries the payment, not a placeholder', async () => {
    const { ctx, page } = await open();
    const r = await page.evaluate(artefacts);
    const sentence = await page.$eval('#result', (el) => el.innerText);

    if (r.placeholders.length) note('ka/390', `raw placeholders on screen: ${r.placeholders.join(' ')}`);
    if (!/\$\s?1[,. ]?765/.test(sentence)) note('ka/390', `the monthly figure is missing from the result:\n${sentence}`);
    if (!/105[,. ]000/.test(sentence)) note('ka/390', 'the loan amount is missing from the result');
    if (!/169[,. ]417/.test(sentence)) note('ka/390', 'the total repayment is missing from the result');
    await ctx.close();
  });

  /* ── 2. Internal labels, empty headings, overflow, RTL ── */
  /* Every width the product claims to support, in the language whose
     labels are longest, then every language at the commonest phone. */
  for (const [width, lang] of [
    [320, 'ka'], [360, 'ka'], [375, 'ka'], [390, 'ka'], [412, 'ka'], [430, 'ka'],
    [768, 'ka'], [1280, 'ka'],
    [390, 'en'], [390, 'ru'], [390, 'tr'], [390, 'ar'], [390, 'he'],
  ]) {
    await t.test(`nothing internal, empty or overflowing at ${width} in ${lang}`, async () => {
      const { ctx, page } = await open({ width, lang });
      await expand(page);
      const r = await page.evaluate(artefacts);
      const where = `${lang}/${width}`;

      if (r.placeholders.length) note(where, `raw placeholders: ${r.placeholders.join(' ')}`);
      if (r.parentheticals.length) {
        note(where, `an internal label reached a customer sentence: ${r.parentheticals.join(' | ')}`);
      }
      if (r.emptyHeadings.length) note(where, `empty heading(s): ${r.emptyHeadings.join(', ')}`);
      if (r.emptyItems.length) note(where, `empty list item(s): ${r.emptyItems.join(', ')}`);
      if (r.scrollWidth > r.clientWidth + 1) {
        note(where, `horizontal overflow ${r.scrollWidth} > ${r.clientWidth}`);
      }
      if (!r.askButtons) note(where, 'no way into the conversation from any card');
      const rtl = lang === 'ar' || lang === 'he';
      if (rtl && r.dir !== 'rtl') note(where, `dir=${r.dir}, expected rtl`);
      if (!rtl && r.dir === 'rtl') note(where, `dir=rtl on a left-to-right language`);
      /* The acronyms are allowed, but never alone above a number. */
      if (/^\s*(PTI|LTV)\s*$/m.test(r.text)) note(where, 'a bare PTI/LTV label is back');
      await ctx.close();
    });
  }

  /* ── 3. Ask Homatch reaches the one consultant on the page ── */
  await t.test('a checklist question lands in the consultant composer', async () => {
    const { ctx, page } = await open();
    await expand(page);

    const button = await page.$('#checklist [data-ask-homatch]');
    if (!button) {
      note('ka/390', 'the checklist offers no question to ask');
    } else {
      const question = (await button.innerText()).trim();
      await button.click();
      await page.waitForTimeout(900);
      const composer = await page.$eval('#consultant input', (el) => el.value);
      if (!composer.trim()) note('ka/390', 'pressing Ask Homatch left the composer empty');
      if (composer.trim() === question) {
        note('ka/390', 'the composer holds the button label rather than the question');
      }
      const panels = await page.$$eval('#consultant', (els) => els.length);
      if (panels !== 1) note('ka/390', `${panels} consultant panels on the page`);
      /* Nothing may be sent by a press: that would spend a credit on a
         click the person did not make. */
      const bubbles = await page.$$eval('#consultant [class*="rounded-2xl"]', (els) => els.length);
      if (bubbles > 0) note('ka/390', 'pressing Ask Homatch started a conversation on its own');
    }
    await ctx.close();
  });

  /* ── 4. The government programme gives a reasoned, reactive result ── */
  await t.test('the subsidy names the exact reason, and updates when the currency changes', async () => {
    /* Opened from storage rather than by clicking the shelf: the first
       click re-renders the section and every handle taken before it is
       stale, which is a fight with React, not a test of the product. */
    const { ctx, page } = await open({ topic: 'GOVERNMENT_PROGRAMS' });
    await page.waitForFunction(
      () => Boolean(document.querySelector('[id^="program-"]')),
      null, { timeout: 20000 },
    ).catch(() => {});
    await page.waitForTimeout(600);

    const panel = await page.$('#tool-panel');
    if (!panel) { note('ka/390', 'the programmes tool did not open'); await ctx.close(); return; }

    const text = await panel.innerText();
    /* The English administrative title must not be on a Georgian page. */
    if (/Subsidized Mortgage Loan/i.test(text)) {
      note('ka/390', 'the English programme title is on the Georgian page');
    }
    if (/Decree No\./i.test(text)) note('ka/390', 'the decree number is in the customer title');
    /* The benefit is explained before the questions. */
    if (!/1 წლამდე/.test(text)) note('ka/390', 'the under-one-year condition is not stated');
    if (!/200[,. ]000/.test(text)) note('ka/390', 'the loan ceiling is not shown');
    if (!/GEL|ლარ/.test(text)) note('ka/390', 'the currency rule is not shown');

    /*
     * THE RESULT MUST BE REACTIVE, WITHOUT RESUBMITTING ANYTHING.
     *
     * The loan is in USD and the programme is lari-only, so the card
     * says so before a single question is answered — the currency is
     * checked against the loan, not the household. Changing the
     * currency at the top of the page must clear that reason on its
     * own, which is what "no stale result" means in practice.
     */
    const usd = await panel.innerText();
    if (!/USD/.test(usd)) note('ka/390', 'the chosen currency is not named in the result');
    if (!/GEL/.test(usd)) note('ka/390', 'the required currency is not named in the result');

    await page.selectOption('#mtg-currency', 'GEL');
    await page.waitForTimeout(1200);
    const gel = await page.$eval('#tool-panel', (el) => el.innerText);
    if (gel === usd) note('ka/390', 'the programme result did not change with the currency');
    if (/USD/.test(gel)) note('ka/390', 'the currency mismatch survived the currency change');

    await ctx.close();
  });

  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});
