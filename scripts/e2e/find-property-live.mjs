#!/usr/bin/env node
/* TEMPORARY production E2E for Find Property (PR #233 release: redesigned workspace). Runs on a GitHub runner
 * against https://www.homatch.live with ONE dedicated test account the owner approved
 * (E2E_EMAIL). The password is generated on the runner, masked, and never leaves it.
 * The account is confirmed and later suspended by the operator through the database.
 * Prints one `E2E {json}` line per check; screenshots go to ./e2e-shots (artifact). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = 'https://www.homatch.live';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = 'E2e-' + randomBytes(18).toString('base64url');
console.log(`::add-mask::${PASSWORD}`);
const SHOTS = 'e2e-shots'; mkdirSync(SHOTS, { recursive: true });
const out = (check, data) => console.log('E2E ' + JSON.stringify({ check, at: new Date().toISOString(), ...data }));
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
await ctx.addInitScript(() => { try { if (!localStorage.getItem('homatch_lang')) localStorage.setItem('homatch_lang', 'en'); } catch {} });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
const calls = [];
const failed = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/functions/v1/marketplace-search')) calls.push({ status: r.status(), at: new Date().toISOString() }); if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${u.split('?')[0]}`); });

try {
  // 1. Sign up (the account must not exist yet), then wait for the operator to confirm it.
  await page.goto(`${BASE}/auth/signup`, { waitUntil: 'networkidle' });
  await page.fill('#fullname', 'Claude E2E (Find Property)').catch(() => {});
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  for (const box of await page.locator('button[role="checkbox"]').all()) await box.click().catch(() => {});
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  await shot(page, '01-signup');
  out('signup', { url: page.url(), toast: (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 300) });
  console.log('AWAITING_CONFIRMATION');

  let signedIn = false;
  for (let i = 0; i < 45 && !signedIn; i++) {
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', EMAIL); await page.fill('#password', PASSWORD);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
    signedIn = !/\/auth\//.test(new URL(page.url()).pathname);
    if (!signedIn) await page.waitForTimeout(15000);
  }
  out('login', { ok: signedIn, url: page.url() });
  if (!signedIn) throw Error('test account was not confirmed in time');

  // 2. Find Property: Scenario A, through the real UI.
  const t0 = Date.now();
  await page.goto(`${BASE}/find-property/new`, { waitUntil: 'networkidle' });
  await shot(page, '02-new');
  await page.locator('textarea').first().fill(process.env.E2E_QUERY);
  await page.locator('form button[type="submit"]').first().click();
  const start = page.locator('[data-action="mps-continue"]');
  const answered = [];
  for (let q = 0; q < 6; q++) {
    await start.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await start.isVisible().catch(() => false)) break;
    let clicked = null;
    for (const name of [/^(any|any number|doesn.t matter|no preference|skip|not important)$/i, /^2 rooms$/i, /^1 bedrooms$/i, /^2$/]) {
      const b = page.getByRole('button', { name }).first();
      if (await b.isVisible().catch(() => false)) { await b.click(); clicked = String(name); break; }
    }
    answered.push(clicked);
    if (!clicked) break;
    await page.waitForTimeout(3000);
  }
  out('answers', { answered });
  if (!(await start.isVisible().catch(() => false))) {
    await shot(page, '03-stuck');
    out('stuck', { url: page.url(), text: (await page.locator('main').innerText().catch(() => '')).slice(0, 2500),
      buttons: (await page.locator('main button').allInnerTexts().catch(() => [])).slice(0, 40) });
  }
  await shot(page, '03-confirmation');
  const confirmText = (await page.locator('main').innerText().catch(() => '')).slice(0, 1500);
  out('confirmation', { startVisible: await start.isVisible().catch(() => false), text: confirmText });
  // Redesign: confirmation → Continue → Free / Deep choice → Free Search.
  await start.click();
  await page.locator('#fpx-mode-title').waitFor({ timeout: 30000 });
  await shot(page, '03b-mode');
  out('mode-step', { text: (await page.locator('main').innerText().catch(() => '')).slice(0, 1500),
    deepDisabled: (await page.locator('[data-mode="DEEP"]').getAttribute('aria-disabled')) === 'true',
    liveSources: await page.locator('[data-live-sources] li').allInnerTexts().catch(() => []) });
  await page.locator('[data-action="mps-start"]').click();
  await page.waitForURL(/\/find-property\/search\//, { timeout: 60000 });
  const searchUrl = page.url();
  out('started', { searchUrl, searchId: searchUrl.split('/search/')[1]?.split(/[?#]/)[0] });

  // 3. Results: open the progressive results as soon as they are offered, then wait (up to 20 min)
  // until the search is finished and the results page shows cards.
  let cards = 0, done = false, progressive = null;
  for (let i = 0; i < 120 && !done; i++) {
    await page.waitForTimeout(10000);
    const cta = page.getByRole('button', { name: /^See results/ }).first();
    if (!progressive && await cta.isVisible().catch(() => false)) {
      await shot(page, '03c-progress');
      await cta.click();
      await page.waitForTimeout(5000);
      progressive = { afterSec: (i + 1) * 10, cards: await page.locator('[data-property-key]').count() };
      out('progressive', progressive);
      await shot(page, '03d-progressive-results');
    }
    cards = await page.locator('[data-property-key]').count();
    const searching = await page.locator('[data-testid="mps-sources"] [data-state="SEARCHING"], [data-testid="mps-sources"] [data-state="WAITING"]').count();
    done = cards > 0 && searching === 0;
    if (!done && i % 12 === 11) { await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(5000); }
  }
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { if (d.querySelector('[data-testid="mps-sources"]')) d.open = true; })).catch(() => {});
  await shot(page, '04-results');
  const sources = await page.locator('[data-testid="mps-sources"] li').evaluateAll((els) => els.map((el) => ({ source: el.getAttribute('data-source'), state: el.getAttribute('data-state'), text: el.innerText.replace(/\s+/g, ' ').slice(0, 120) })));
  out('sources', { sources, summary: (await page.locator('[data-testid="mps-unconfirmed"]').innerText().catch(() => null)), total: await page.getByTestId('mps-total').innerText().catch(() => null) });
  const cardInfo = await page.locator('[data-property-key]').evaluateAll((els) => els.slice(0, 60).map((el) => ({
    key: el.getAttribute('data-property-key'),
    text: el.innerText.replace(/\s+/g, ' ').slice(0, 220),
    links: [...el.querySelectorAll('a[href^="http"]')].map((a) => a.href).slice(0, 4),
  })));
  const hosts = {}; for (const c of cardInfo) for (const l of c.links) { const h = new URL(l).host; hosts[h] = (hosts[h] ?? 0) + 1; }
  out('results', { ms: Date.now() - t0, cards, hosts, sample: cardInfo.slice(0, 8), marketplaceCalls: calls.length, http5xx: calls.filter((c) => c.status >= 500).length });
  const body = await page.locator('main').innerText().catch(() => '');
  out('labels', { mentionsHomatchListing: /HOMATCH listing/i.test(body), sourceNamed: /(MyHome|SS\.ge|Place\.ge|Home\.ge|Allhome)/.test(body), excerpt: body.slice(0, 1200) });

  // 4. Detail + external link, persistence after reload, history.
  const firstLink = cardInfo.flatMap((c) => c.links)[0] ?? null;
  out('external-link', { firstLink });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(6000);
  out('reload', { cardsAfterReload: await page.locator('[data-property-key]').count() });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'networkidle' }); await page.waitForTimeout(4000);
  await shot(page, '05-history');
  out('history', { linksToSearch: await page.locator(`a[href*="${searchUrl.split('homatch.live')[1]?.split('?')[0]}"]`).count() });

  // 5. Mobile, six locales, RTL — on the results page.
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
    await m.addInitScript((l) => localStorage.setItem('homatch_lang', l), lang);
    const p = await m.newPage();
    await p.goto(searchUrl, { waitUntil: 'networkidle' }); await p.waitForTimeout(6000);
    out('locale', { lang, dir: await p.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction), cards: await p.locator('[data-property-key]').count(), overflowPx: await overflow(p) });
    await shot(p, `06-mobile-${lang}`);
    await m.close();
  }
  out('console', { errors: consoleErrors.slice(0, 15), count: consoleErrors.length, failedRequests: failed.slice(0, 20) });
} catch (error) {
  await shot(page, '99-failure');
  out('error', { message: String(error?.message ?? error).slice(0, 500), url: page.url() });
  process.exitCode = 1;
} finally {
  await browser.close();
}
