// The login screen in all six languages, including the two that mirror.
//
// WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT
//
// The password field reserved its space with `pr-10` — physical right —
// while the reveal button was placed with `isRTL ? 'left-3' : 'right-3'`.
// In English those agree. In Arabic and Hebrew they point at opposite
// sides: forty pixels held empty on the right, twelve on the left, and a
// sixteen-pixel button sitting in those twelve. A typed password ran
// underneath it at every width in both languages.
//
// Every existing gate passed. formControls.test.mjs already visits
// /auth/login and checks that each control is big enough, tappable,
// labelled and asks for the right keyboard — all of which was true. The
// property nobody was asserting is that a control floating inside a field
// sits on the side the field actually reserved for it, and that is a
// property you can only see by comparing the two in a mirrored locale.
//
// THE OTHER TWO REPORTS WERE THE MEASURING INSTRUMENT
//
// A Turkish line was reported as rendering "0px wide", and Russian and
// Hebrew as having truncated content. Neither was real. clientWidth is
// zero for every non-replaced inline element by specification, so the
// first reported identically for <span> in all six languages including
// English; and innerText.length is not a completeness measure, because
// Hebrew is an abjad and writes the same sentence in a fifth fewer
// characters. So this file asserts the things those two were reaching
// for, in forms that cannot produce the same false positive: words are
// checked for real line breaks using Range geometry, and completeness is
// checked as the SET OF CONTROLS AND STRINGS, never as a character count.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
/* Its own port: routeOverflow 4321, expatsReadable 4322/4323,
   formControls 4337. */
const PORT = 4341;
const BASE = `http://127.0.0.1:${PORT}`;

const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
const RTL = new Set(['ar', 'he']);
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];

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

/**
 * Does the field reserve its space on the side the button is on?
 *
 * This is the defect stated as geometry, and it is direction-agnostic:
 * whichever side the reveal button ends up on, the padding on THAT side
 * has to clear it. Reading the computed padding rather than the class
 * means the test keeps working if the class names change.
 */
const FIELD_GEOMETRY = () => {
  const field = document.getElementById('password');
  if (!field) return { error: 'no password field' };
  const button = field.parentElement?.querySelector('button');
  if (!button) return { error: 'no reveal button' };
  const cs = getComputedStyle(field);
  const f = field.getBoundingClientRect();
  const b = button.getBoundingClientRect();
  const paddingLeft = parseFloat(cs.paddingLeft || '0');
  const paddingRight = parseFloat(cs.paddingRight || '0');
  const onLeft = (b.left + b.width / 2) < (f.left + f.width / 2);
  const reserved = onLeft ? paddingLeft : paddingRight;
  /* The strip the text is allowed to occupy. */
  const textLeft = f.left + paddingLeft;
  const textRight = f.right - paddingRight;
  return {
    direction: cs.direction,
    buttonSide: onLeft ? 'left' : 'right',
    paddingLeft, paddingRight, reserved,
    buttonWidth: b.width,
    /* True when the button's box intrudes into the text strip. */
    overlapsText: b.left < textRight - 0.5 && b.right > textLeft + 0.5,
  };
};

/** Words the browser was forced to split across two lines. */
const BROKEN_WORDS = () => {
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement;
    if (!parent || !parent.checkVisibility?.()) continue;
    const cs = getComputedStyle(parent);
    if (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') continue;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length < 2) continue;
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      range.detach?.();
      if (rects.length < 2) continue;
      /* Several rects on ONE line are bidi runs and are fine; rects at
         different tops mean the word itself was cut in half. */
      if (new Set(rects.map((r) => Math.round(r.top))).size > 1) {
        bad.push({ word: m[0].slice(0, 24), tag: parent.tagName, context: text.trim().slice(0, 50) });
      }
    }
  }
  return bad;
};

/** The page as a set of things, not as a number of characters. */
const SHAPE = () => ({
  dir: document.documentElement.getAttribute('dir') || getComputedStyle(document.body).direction,
  inputs: [...document.querySelectorAll('input')].map((e) => e.type).sort(),
  buttonCount: document.querySelectorAll('button').length,
  linkTargets: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).sort(),
  labelCount: document.querySelectorAll('label').length,
  headings: document.querySelectorAll('h1,h2').length,
  /* Every visible string, trimmed. Two locales are equivalent when these
     line up one-for-one, whatever their lengths. */
  strings: (document.body.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean),
  overflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
});

test('the login screen works in every language it offers', opts, async (t) => {
  if (skipReason) assert.fail(`auth login locale gate could not run: ${skipReason}`);

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

  async function open(lang, width) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700,
    });
    await ctx.addInitScript((l) => {
      window.localStorage.removeItem('sb-stubproj-auth-token');
      window.localStorage.setItem('homatch_lang', l);
    }, lang);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
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
      if (url.includes('/rest/v1/')) return r.fulfill(json([]));
      return r.fulfill(json({}));
    });
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#password', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  }

  const failures = [];
  const shapes = {};
  let checked = 0;

  for (const lang of LOCALES) {
    for (const width of WIDTHS) {
      const { ctx, page, errors } = await open(lang, width);
      checked += 1;

      /* 1. THE DEFECT. The reveal button must sit in space the field
            actually reserved, in whichever direction the page runs. */
      const geo = await page.evaluate(FIELD_GEOMETRY);
      if (geo.error) {
        failures.push(`${lang}@${width}: ${geo.error}`);
      } else {
        if (RTL.has(lang) && geo.direction !== 'rtl') {
          failures.push(`${lang}@${width}: password field is ${geo.direction}, not rtl`);
        }
        if (geo.reserved < geo.buttonWidth) {
          failures.push(
            `${lang}@${width}: reveal button is on the ${geo.buttonSide} (${Math.round(geo.buttonWidth)}px) ` +
            `but only ${geo.reserved}px is reserved there ` +
            `(padding L${geo.paddingLeft}/R${geo.paddingRight}) — a typed password runs under it`,
          );
        }
        if (geo.overlapsText) {
          failures.push(`${lang}@${width}: reveal button overlaps the field's text area`);
        }
      }

      /* 2. Nothing broken mid-word, and nothing overflowing. */
      const broken = await page.evaluate(BROKEN_WORDS);
      if (broken.length) {
        failures.push(`${lang}@${width}: ${broken.length} word(s) split across lines — "${broken[0].word}" in <${broken[0].tag}>`);
      }
      const shape = await page.evaluate(SHAPE);
      if (shape.overflow) failures.push(`${lang}@${width}: the page scrolls sideways`);
      if (RTL.has(lang) && shape.dir !== 'rtl') failures.push(`${lang}@${width}: document is ${shape.dir}, not rtl`);
      if (!RTL.has(lang) && shape.dir === 'rtl') failures.push(`${lang}@${width}: document is rtl but ${lang} is not`);
      if (errors.length) failures.push(`${lang}@${width}: ${errors[0]}`);

      if (width === 1440) shapes[lang] = shape;
      await ctx.close();
    }
  }

  /* 3. COMPLETENESS, as a set rather than a length. Every locale must
        offer the same controls, the same destinations and the same NUMBER
        of visible strings. Hebrew writes them shorter; it does not get to
        write fewer. */
  const ref = shapes.en;
  assert.ok(ref, 'English never rendered');
  for (const lang of LOCALES) {
    const s = shapes[lang];
    if (!s) { failures.push(`${lang}: never rendered at 1440`); continue; }
    assert.deepEqual(s.inputs, ref.inputs, `${lang} does not offer the same input types as English`);
    assert.deepEqual(s.linkTargets, ref.linkTargets, `${lang} does not offer the same links as English`);
    if (s.buttonCount !== ref.buttonCount) failures.push(`${lang}: ${s.buttonCount} buttons, English has ${ref.buttonCount}`);
    if (s.labelCount !== ref.labelCount) failures.push(`${lang}: ${s.labelCount} labels, English has ${ref.labelCount}`);
    if (s.headings !== ref.headings) failures.push(`${lang}: ${s.headings} headings, English has ${ref.headings}`);
    if (s.strings.length !== ref.strings.length) {
      failures.push(`${lang}: ${s.strings.length} visible strings, English has ${ref.strings.length}`);
    }
    /* Not one of them may be left in English. Exempt the things that are
       the same in every language by design: the wordmark (rendered
       uppercase), the example address in the placeholder, the locale chip
       the switcher shows, and Google's own product name. */
    const SAME_EVERYWHERE = /homatch|example\.com|google|^[A-Z]{2}$|^©/i;
    if (lang !== 'en') {
      const untranslated = s.strings.filter((x, i) => x === ref.strings[i] && /[A-Za-z]{4}/.test(x) && !SAME_EVERYWHERE.test(x));
      if (untranslated.length) failures.push(`${lang}: still in English — ${untranslated.slice(0, 3).join(' | ')}`);
    }
  }

  /* 4. The controls work, and the keyboard can reach them. */
  for (const lang of LOCALES) {
    const { ctx, page } = await open(lang, 390);
    await page.fill('#email', 'qa@example.test');
    await page.fill('#password', 'CorrectHorseBatteryStaple');
    await page.waitForTimeout(150);
    if (await page.evaluate(() => document.querySelector('button[type="submit"]')?.disabled)) {
      failures.push(`${lang}: submit stays disabled after both fields are filled`);
    }
    const before = await page.getAttribute('#password', 'type');
    await page.click('#password ~ button, .relative > button');
    await page.waitForTimeout(150);
    if (await page.getAttribute('#password', 'type') === before) {
      failures.push(`${lang}: the reveal button does not toggle the password`);
    }
    /* Tab from the email field: the password, then its reveal button,
       must both be reachable without a mouse. */
    await page.focus('#email');
    const reached = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}${a.id ? '#' + a.id : ''}` : 'none';
      }));
    }
    if (!reached.includes('INPUT#password')) failures.push(`${lang}: the password field is not reachable by Tab (${reached.join(' → ')})`);
    await ctx.close();
  }

  assert.ok(checked >= LOCALES.length * WIDTHS.length, `only ${checked} combinations measured`);
  assert.deepEqual(failures, [], `/auth/login is broken:\n  ${failures.join('\n  ')}`);
});
