// VERIFY → the whole report in the customer's language (owner P0, 2026-10-12).
//
// The production report of job 8ba97da9 (job601Synthesis, the same payload the
// premium test renders) is opened in a real browser (harness build) in
// English and in Arabic, with verify-synthesis `translate` answered by a stub
// translator that returns "<LANG>:" + the Georgian text. Every section is
// mounted (scrolled into view, every <details> opened, the evidence drawer and
// the gallery lightbox included), and then EVERY text node and every
// title / aria-label / alt / placeholder on the page that contains Georgian
// letters must carry the prefix — i.e. went through the translation layer.
// A component that renders Georgian the layer never sees fails this test.
//
// Also: Arabic keeps the page right-to-left; requests stay inside the client
// batch limits; and in Georgian nothing is translated and nothing is asked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { customerSynthesis } from '../../src/verify/__tests__/fixtures/job601Synthesis.mjs';
import { STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4371;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB = '8ba97da9-5d0e-4c4b-9a59-000000000601';

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core'), process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}
function haveDeps() {
  if (!resolvePlaywright()) return 'browser driver missing — run: npm run test:mobile:setup';
  if (!findChrome()) return 'Chrome not found — set PLAYWRIGHT_CHROME';
  const distDir = join(ROOT, 'dist', 'assets');
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(distDir)) return 'no build in dist/ — run: npm run build:harness';
  const bundled = readdirSync(distDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .some((f) => readFileSync(join(distDir, f), 'utf8').includes('stubproj'));
  if (!bundled) return 'dist/ is not the harness build — run: npm run build:harness';
  return null;
}
const skipReason = haveDeps();
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 600000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', exp, email: 'harness@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'harness@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#3b4a5c"/></svg>';

async function openReport(browser, synthesis, { width, height, lang }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('homatch_lang', l); } catch { /* */ } }, lang);
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  const requests = [];
  const json = (b) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/storage/v1/object/sign/verify-official-visuals/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLACEHOLDER });
    if (url.includes('/functions/v1/verify-synthesis')) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* */ }
      if (body.action === 'translate') {
        requests.push(body);
        const prefix = `${String(body.lang).toUpperCase()}:`;
        return route.fulfill(json({ translations: Object.fromEntries(body.texts.map((t) => [t, prefix + t])), cached: 0, translated: body.texts.length, failed: 0, limited: false, skipped: 0 }));
      }
      return route.fulfill(json(synthesis));
    }
    if (url.includes('/functions/v1/research-agent')) return route.fulfill(json({ ...STATUS_RESPONSE, id: JOB }));
    if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill(json({}));
  });
  await page.goto(`${BASE}/verify?job=${JOB}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.verify-report article', { timeout: 30000 });
  return { ctx, page, requests };
}

/** Mounts everything the report can show: lazy sections, every <details>, the evidence drawer. */
async function mountEverything(page) {
  for (let pass = 0; pass < 3; pass++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += 500) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => { for (const d of document.querySelectorAll('[data-report-translation-root] details')) d.open = true; });
    await page.waitForTimeout(300);
  }
}

async function settle(page, requests) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const busy = await page.evaluate(() => !!document.querySelector('[data-report-translating]'));
    if (!busy && requests.length === last) return;
    last = requests.length;
  }
}

/** Every Georgian text / attribute on the WHOLE page (report, portals, chrome) that did NOT go through the translation layer. */
function untranslated(page, prefix) {
  return page.evaluate((pfx) => {
    const GEO = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;
    const SKIP = '[data-no-translate],[translate="no"],.notranslate,script,style,noscript,textarea,input,select';
    const roots = [document.body];
    const bad = [];
    let good = 0;
    for (const root of roots) {
      // The app's own translate="no" on <html>/<body> (App.tsx) does not count as a skip marker.
      const skip = (el) => { const m = el?.closest(SKIP); return !!m && m !== document.body && m !== document.documentElement; };
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = w.currentNode; n; n = w.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
          const v = n.nodeValue || '';
          if (!GEO.test(v) || skip(n.parentElement)) continue;
          if (v.trim().startsWith(pfx)) good++;
          else bad.push({ text: v.trim().slice(0, 120), where: n.parentElement?.closest('[id],[data-section]')?.id || n.parentElement?.tagName });
        } else {
          for (const a of ['title', 'aria-label', 'alt', 'placeholder']) {
            const v = n.getAttribute(a);
            if (!v || !GEO.test(v) || skip(n)) continue;
            if (v.trim().startsWith(pfx)) good++;
            else bad.push({ attr: a, text: v.slice(0, 120) });
          }
        }
      }
    }
    return { bad, good };
  }, prefix);
}

test('job 601 in English and Arabic: every Georgian text on the report goes through the translation layer', opts, async (t) => {
  if (skipReason) assert.fail(`verify report translation could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 80; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  const synthesis = { ...(await customerSynthesis()), jobId: JOB };

  for (const [lang, width, height] of [['en', 1440, 1000], ['ar', 390, 844]]) {
    const prefix = `${lang.toUpperCase()}:`;
    const { ctx, page, requests } = await openReport(browser, synthesis, { width, height, lang });
    await mountEverything(page);
    await settle(page, requests);

    const r = await untranslated(page, prefix);
    assert.ok(r.good > 100, `${lang}: only ${r.good} translated texts — the layer did not run`);
    assert.deepEqual(r.bad.slice(0, 25), [], `${lang}: ${r.bad.length} Georgian text(s) bypassed the translation layer`);

    // Requests stay within the client batch limits and are authorised against the job.
    assert.ok(requests.length > 0);
    for (const q of requests) {
      assert.equal(q.jobId, JOB);
      assert.equal(q.lang, lang);
      assert.ok(q.texts.length <= 120, `a request carried ${q.texts.length} texts`);
      assert.ok(q.texts.reduce((a, x) => a + x.length, 0) <= 16000);
    }
    // The page stays in its direction; the translating status is gone.
    const page2 = await page.evaluate(() => ({ dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction, busy: !!document.querySelector('[data-report-translating]') }));
    assert.equal(page2.dir, lang === 'ar' ? 'rtl' : 'ltr', `${lang}: page direction`);
    assert.equal(page2.busy, false);

    // The gallery lightbox renders through a portal — its captions are report content too.
    const opener = page.locator('#vbi-explore button:has(img)').first();
    assert.ok(await opener.count(), `${lang}: no gallery image to open`);
    {
      await opener.scrollIntoViewIfNeeded();
      await opener.click();
      await page.waitForSelector('[data-report-portal]', { timeout: 5000 });
      await settle(page, requests);
      const lb = await untranslated(page, prefix);
      assert.ok(lb.good > r.good, `${lang}: the lightbox added no translated text`);
      assert.deepEqual(lb.bad.slice(0, 25), [], `${lang}: lightbox Georgian bypassed the translation layer`);
    }
    await ctx.close();
  }

  // Georgian is the source: nothing is translated, nothing is asked.
  const { ctx, page, requests } = await openReport(browser, synthesis, { width: 390, height: 844, lang: 'ka' });
  await mountEverything(page);
  await page.waitForTimeout(500);
  assert.equal(requests.length, 0, 'Georgian asked for translations');
  const ka = await untranslated(page, 'KA:');
  assert.equal(ka.good, 0);
  assert.ok(ka.bad.length > 200, 'the Georgian report did not render');
  await ctx.close();
});
