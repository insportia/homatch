// ONE LANGUAGE PER VISITOR, AND NEVER A FLASH OF THE WRONG ONE.
//
// Every visitor used to download all six languages in the entry chunk to read
// one. Each language but English is now its own chunk (vite.config.ts,
// i18nLanguageChunks; src/i18n/bundles.ts). That trade has two ways to go
// wrong, and this gate is written against both, in a real browser:
//
//   1. a visitor downloads languages they did not ask for (the whole point
//      lost), or
//   2. a Georgian visitor sees English first and Georgian a moment later —
//      the first render must already be in their language, and a switch must
//      go from one whole language to the other.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4351;
const BASE = `http://127.0.0.1:${PORT}`;
const OTHER = ['ka', 'ru', 'tr', 'ar', 'he'];
const SCRIPT = { ka: /[\u10D0-\u10FF]/, ru: /[\u0400-\u04FF]/, ar: /[\u0600-\u06FF]/, he: /[\u05D0-\u05EA]/ };

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  ].find((p) => existsSync(p)) ?? null;
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
  const dir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(dir)) return 'no build in dist/ — run: npm run build:harness';
  const harness = readdirSync(dir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(dir, f), 'utf8').includes('stubproj'));
  if (!harness) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}

const skipReason = haveDeps();
const STRICT = !!process.env.CI;
const opts = skipReason && !STRICT ? { skip: skipReason } : { timeout: 300000 };

/** Which language chunks a page fetched, by the chunk's file-name prefix. */
const chunkLang = (url) => {
  const m = url.match(/\/assets\/(ka|ru|tr|ar|he)-[A-Za-z0-9_-]+\.js(\?|$)/);
  return m ? m[1] : null;
};

async function boot(t) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return browser;
}

async function openAs(browser, lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([l]) => {
    if (l) window.localStorage.setItem('homatch_lang', l);
    /* The first text the visitor could see: recorded the moment #root has any. */
    window.__firstText = null;
    new MutationObserver((_, obs) => {
      const root = document.getElementById('root');
      const text = root?.innerText?.trim() ?? '';
      if (text.length > 20) { window.__firstText = text.slice(0, 2000); obs.disconnect(); }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, [lang]);
  const page = await ctx.newPage();
  const fetched = new Set();
  page.on('request', (r) => { const l = chunkLang(r.url()); if (l) fetched.add(l); });
  await page.route('**', async (r) => {
    const url = r.request().url();
    if (url.startsWith(BASE)) return r.continue();
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 20000 });
  return { page, fetched, ctx };
}

test('a visitor downloads their own language only, and the first render is already in it', opts, async (t) => {
  if (skipReason) assert.fail(`language chunk gate could not run: ${skipReason}`);
  const browser = await boot(t);

  // English: nothing but the entry.
  {
    const { fetched, ctx } = await openAs(browser, 'en');
    assert.deepEqual([...fetched], [], `an English visitor fetched language chunks: ${[...fetched]}`);
    await ctx.close();
  }

  // Each script-distinct language: exactly its own chunk, and its words first.
  for (const lang of ['ka', 'ru', 'ar', 'he']) {
    const { page, fetched, ctx } = await openAs(browser, lang);
    assert.deepEqual([...fetched], [lang], `a "${lang}" visitor fetched ${[...fetched].join(',') || 'nothing'}`);
    const first = await page.evaluate(() => window.__firstText);
    assert.match(first, SCRIPT[lang], `the first render for "${lang}" was not in that language: ${first.slice(0, 120)}`);
    assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
    if (lang === 'ar' || lang === 'he') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await ctx.close();
  }
});

test('a language switch loads the language, then shows it whole', opts, async (t) => {
  if (skipReason) assert.fail(`language chunk gate could not run: ${skipReason}`);
  const browser = await boot(t);
  const { page, fetched, ctx } = await openAs(browser, 'en');
  assert.equal(fetched.size, 0);

  /* Watch for the one wrong state: the document already says Georgian while
     the page still reads English. */
  await page.evaluate(() => {
    window.__mixed = false;
    new MutationObserver(() => {
      if (document.documentElement.lang !== 'ka') return;
      const text = document.getElementById('root')?.innerText ?? '';
      if (!/[\u10D0-\u10FF]/.test(text)) window.__mixed = true;
    }).observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
  });

  await page.getByRole('button', { name: /^en$/i }).first().click();
  await page.getByRole('menuitem', { name: /ქართული/ }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'ka', null, { timeout: 15000 });
  await page.waitForFunction(() => /[\u10D0-\u10FF]/.test(document.getElementById('root')?.innerText ?? ''), null, { timeout: 15000 });

  assert.deepEqual([...fetched], ['ka'], 'the switch fetched Georgian and nothing else');
  assert.equal(await page.evaluate(() => window.__mixed), false, 'the page said Georgian while still reading English');
  assert.equal(await page.evaluate(() => window.localStorage.getItem('homatch_lang')), 'ka');
  await ctx.close();
});
