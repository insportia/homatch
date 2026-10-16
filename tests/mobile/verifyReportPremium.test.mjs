// VERIFY → the customer report of production job 8ba97da9 (cadastral
// 01.18.06.019.055.03.01.601), in a real browser (harness build).
//
// The synthesis is the sanitized production row
// (src/verify/__tests__/fixtures/job601Synthesis.mjs) passed through the same
// toCustomerVisualAssets() that verify-synthesis forCustomer() runs, so the
// page receives what production serves. Signed image URLs are answered with a
// local placeholder. Checked at 1440px and 390px in Georgian:
//   * the official gallery renders near the top with all 24 images counted,
//     a scope label on the stage, and real <img> elements that loaded;
//   * the People behind the project render grouped by discipline — the two
//     chief architects under architecture, the developer's director never
//     among them — with an evidence drawer;
//   * no OCR fragment or the city authority appears as a person;
//   * no horizontal overflow.
// v6 layout (owner, 2026-10-11), also at 360px:
//   * five navigation groups in order, sticky directly under the app header;
//     a jump lands with its heading below the bar (scroll-margin) and marks
//     the group active (aria-current); the bar scrolls sideways on a phone,
//     the page never does;
//   * the people chapter opens with the approved introduction and every
//     documented person carries a stage label;
//   * at the bottom of the page nothing of the report sits under the fixed
//     bottom navigation or the floating assistant button.
// And a report stored before v3 (no projectTeamV2, no officialVisuals) still
// renders, with the gallery's honest empty state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { customerSynthesis } from '../../src/verify/__tests__/fixtures/job601Synthesis.mjs';
import { SYNTHESIS as LEGACY_SYNTHESIS, STATUS_RESPONSE } from './fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4367;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function openReport(browser, synthesis, { width, height, lang = 'ka' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => { try { localStorage.setItem('homatch_lang', l); } catch { /* */ } }, lang);
  await ctx.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), ['sb-stubproj-auth-token', fakeSession()]);
  const page = await ctx.newPage();
  const json = (b) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  await page.route('**', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/storage/v1/object/sign/verify-official-visuals/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLACEHOLDER });
    if (url.includes('/functions/v1/verify-synthesis')) return route.fulfill(json(synthesis));
    if (url.includes('/functions/v1/research-agent')) return route.fulfill(json(STATUS_RESPONSE));
    if (url.includes('/auth/v1/user')) return route.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return route.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/')) return route.fulfill(json([]));
    return route.fulfill(json({}));
  });
  await page.goto(`${BASE}/verify?job=fixture-job`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.verify-report article', { timeout: 30000 });
  // Bring the gallery into view so its lazy images load.
  await page.locator('#vbi-explore').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('#vbi-explore img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
  return { ctx, page };
}

/** The v6 five-group navigation, the people introduction and the bottom clearance. */
async function checkNavigation(page, at) {
  const nav = await page.evaluate(() => {
    const n = document.querySelector('[data-report-nav]');
    const links = [...(n?.querySelectorAll('a[data-nav-target]') ?? [])];
    return {
      position: n ? getComputedStyle(n).position : null,
      targets: links.map((a) => a.getAttribute('data-nav-target')),
      labels: links.map((a) => a.textContent.trim()),
      intro: document.querySelectorAll('#vbi-people [data-people-intro] p').length,
      cards: [...document.querySelectorAll('#vbi-people [data-team-group] > ul > li')].map((li) => ({ stage: li.getAttribute('data-stage'), chip: !!li.querySelector('[data-stage-chip]') })),
    };
  });
  assert.equal(nav.position, 'sticky', `${at}: the navigation is not sticky`);
  assert.deepEqual(nav.targets, ['vbi-g-main', 'vbi-g-project', 'vbi-g-safety', 'vbi-g-place', 'vbi-g-documents'], `${at}: nav groups`);
  assert.deepEqual(nav.labels, ['მთავარი', 'პროექტი', 'უსაფრთხოება', 'გარემო და ფასი', 'დოკუმენტები'], `${at}: nav labels`);
  assert.equal(nav.intro, 3, `${at}: the people introduction is missing`);
  // Every dated documented role says which stage it belongs to; an undated one says nothing rather than guess.
  assert.ok(nav.cards.length > 0 && nav.cards.every((c) => ['CURRENT', 'EARLIER', 'UNDATED'].includes(c.stage) && c.chip === (c.stage !== 'UNDATED')), `${at}: stage labels ${JSON.stringify(nav.cards)}`);
  assert.ok(nav.cards.some((c) => c.chip), `${at}: no stage label at all`);

  for (const id of ['vbi-g-safety', 'vbi-g-place', 'vbi-g-project']) {
    await page.locator(`[data-report-nav] a[data-nav-target="${id}"]`).click();
    await page.waitForTimeout(1300);
    const m = await page.evaluate((gid) => {
      const header = [...document.querySelectorAll('header')].find((h) => ['sticky', 'fixed'].includes(getComputedStyle(h).position) && h.getBoundingClientRect().top <= 1);
      const bar = document.querySelector('[data-report-nav]').getBoundingClientRect();
      return {
        headerBottom: header ? header.getBoundingClientRect().bottom : 0,
        barTop: bar.top, barBottom: bar.bottom,
        target: document.getElementById(gid).getBoundingClientRect().top,
        current: document.querySelector('[data-report-nav] a[aria-current="location"]')?.getAttribute('data-nav-target') ?? null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, id);
    assert.ok(Math.abs(m.barTop - m.headerBottom) <= 2, `${at}: the bar is not directly under the header ${JSON.stringify(m)}`);
    assert.ok(m.target >= m.barBottom - 1 && m.target <= m.barBottom + 64, `${at}: ${id} landed under the bar or far below it ${JSON.stringify(m)}`);
    assert.equal(m.current, id, `${at}: ${id} is not marked as the active group`);
    assert.ok(m.overflow <= 1, `${at}: horizontal overflow ${m.overflow}px`);
  }

  // The end of the report clears every fixed control at the bottom of the screen.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  const end = await page.evaluate(() => {
    const article = document.querySelector('.verify-report article');
    const last = article.lastElementChild?.lastElementChild ?? article.lastElementChild;
    const fixed = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.top > window.innerHeight / 2 && b.top < window.innerHeight;
    }).map((el) => el.getBoundingClientRect().top);
    return { lastBottom: last.getBoundingClientRect().bottom, fixedTop: fixed.length ? Math.min(...fixed) : window.innerHeight };
  });
  assert.ok(end.lastBottom <= end.fixedTop + 1, `${at}: the end of the report sits under a fixed control ${JSON.stringify(end)}`);
}

test('job 601: the official gallery and the people behind the project render, desktop and phone', opts, async (t) => {
  if (skipReason) assert.fail(`verify premium report could not run: ${skipReason}`);
  const { chromium } = resolvePlaywright();
  const preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); preview.kill(); });
  for (let i = 0; i < 80; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  const synthesis = await customerSynthesis();
  for (const [width, height] of [[1440, 1000], [390, 844], [360, 740]]) {
    const { ctx, page } = await openReport(browser, synthesis, { width, height });
    const r = await page.evaluate(() => {
      const top = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + window.scrollY : -1; };
      const groups = [...document.querySelectorAll('[data-team-group]')].map((g) => ({
        group: g.getAttribute('data-team-group'),
        names: [...g.querySelectorAll(':scope > ul > li')].map((li) => li.querySelector('p')?.textContent?.trim()),
      }));
      return {
        explore: top('#vbi-explore'), legal: top('#vbi-legal'), people: top('#vbi-people'), market: top('#vbi-market'),
        galleryCount: Number(document.querySelector('[data-gallery-count]')?.getAttribute('data-gallery-count') ?? 0),
        loaded: [...document.querySelectorAll('#vbi-explore img')].filter((i) => i.complete && i.naturalWidth > 0).length,
        groups,
        evidenceButtons: document.querySelectorAll('#vbi-people button[aria-expanded]').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: document.querySelector('.verify-report article')?.innerText ?? '',
      };
    });
    const at = `${width}px`;
    assert.ok(r.explore > 0 && r.explore < r.people && r.people < r.legal && r.legal < r.market, `${at}: chapter order ${JSON.stringify({ ...r, text: undefined })}`);
    assert.equal(r.galleryCount, 24, `${at}: gallery count`);
    assert.ok(r.loaded >= 1, `${at}: no official image loaded`);
    const by = Object.fromEntries(r.groups.map((g) => [g.group, g.names]));
    assert.deepEqual(by.ARCHITECTURE, ['დარეჯან შათაშვილი', 'დავით ლოსაბერიძე'], `${at}: architects ${JSON.stringify(r.groups)}`);
    assert.ok(by.APPLICANTS?.includes('ლევან ჩაჩუა'), `${at}: the director-applicant is missing`);
    assert.ok(r.evidenceButtons >= 3, `${at}: no evidence drawers`);
    for (const noise of ['ნაცვლად - შპს', 'ნაცვლად დაფიქსირდეს', 'გამოყენებული წესები', 'მუნიციპალიტეტის სსიპ', '(პ/ნ']) assert.ok(!r.text.includes(noise), `${at}: "${noise}" is on the page`);
    assert.ok(!/\bJOINT\b/.test(r.text), `${at}: a representation code printed as English`);
    assert.ok(r.overflow <= 1, `${at}: horizontal overflow ${r.overflow}px`);
    // The evidence drawer opens.
    await page.locator('#vbi-people button[aria-expanded="false"]').first().click();
    assert.equal(await page.locator('#vbi-people button[aria-expanded="true"]').count(), 1);
    await checkNavigation(page, at);
    await ctx.close();
  }

  // RTL at 360px: the bar scrolls sideways inside itself, the page does not.
  {
    const { ctx, page } = await openReport(browser, synthesis, { width: 360, height: 740, lang: 'ar' });
    await page.locator('[data-report-nav] a[data-nav-target="vbi-g-documents"]').click();
    await page.waitForTimeout(1300);
    const rtl = await page.evaluate(() => {
      const list = document.querySelector('[data-report-nav] ul').getBoundingClientRect();
      const on = document.querySelector('[data-report-nav] a[aria-current="location"]');
      const b = on?.getBoundingClientRect();
      return { dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, current: on?.getAttribute('data-nav-target'), visible: !!b && b.left >= list.left - 1 && b.right <= list.right + 1 };
    });
    assert.equal(rtl.dir, 'rtl');
    assert.ok(rtl.overflow <= 1, `rtl 360px: horizontal overflow ${rtl.overflow}px`);
    assert.equal(rtl.current, 'vbi-g-documents');
    assert.ok(rtl.visible, 'rtl 360px: the active group is scrolled out of the bar');
    await ctx.close();
  }

  // A report stored before v3 still renders — the gallery says it has nothing, honestly.
  const { projectTeamV2: _t, technicalSpecs: _s, officialDocuments: _d, officialVisuals: _v, ...legacyShape } = LEGACY_SYNTHESIS;
  const { ctx, page } = await openReport(browser, legacyShape, { width: 390, height: 844 });
  const legacy = await page.evaluate(() => ({
    explore: !!document.querySelector('#vbi-explore'),
    imgs: document.querySelectorAll('#vbi-explore img').length,
    teamGroups: document.querySelectorAll('[data-team-group]').length,
    final: !!document.querySelector('#vbi-final'),
  }));
  assert.deepEqual(legacy, { explore: true, imgs: 0, teamGroups: 0, final: true });
  await ctx.close();
});
