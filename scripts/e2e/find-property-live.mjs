#!/usr/bin/env node
/* TEMPORARY production E2E for Find Property (PR #210 release). Runs on a GitHub runner
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
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
const calls = [];
page.on('response', (r) => { const u = r.url(); if (u.includes('/functions/v1/marketplace-search')) calls.push({ status: r.status(), at: new Date().toISOString() }); });

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
  await page.locator('textarea').first().fill('I want to buy an apartment in Tbilisi, 50 to 120 m², budget $80,000 to $200,000.');
  await page.locator('form button[type="submit"]').first().click();
  const start = page.locator('[data-action="mps-start"]');
  const answered = [];
  for (let q = 0; q < 6; q++) {
    await start.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await start.isVisible().catch(() => false)) break;
    // Answer the follow-up the way a Scenario A user would: rooms are not part of the scenario, so 2–3 is
    // chosen when the UI insists (recorded); an "any / doesn't matter / skip" choice is preferred when offered.
    let clicked = null;
    for (const name of [/^(any|any number|doesn.t matter|no preference|skip|not important)$/i, /^2 rooms$/i]) {
      const b = page.getByRole('button', { name }).first();
      if (await b.isVisible().catch(() => false)) { await b.click(); clicked = String(name); break; }
    }
    answered.push(clicked);
    if (!clicked) break;
    await page.waitForTimeout(3000);
  }
  out('answers', { answered });
  await shot(page, '03-confirmation');
  const confirmText = (await page.locator('main').innerText().catch(() => '')).slice(0, 1500);
  out('confirmation', { startVisible: await start.isVisible().catch(() => false), text: confirmText });
  await start.click();
  await page.waitForURL(/\/find-property\/search\//, { timeout: 60000 });
  const searchUrl = page.url();
  out('started', { searchUrl, searchId: searchUrl.split('/search/')[1]?.split(/[?#]/)[0] });

  // 3. Results: wait up to 8 minutes for the search to finish (portal workers are paced).
  let cards = 0, done = false;
  for (let i = 0; i < 48 && !done; i++) {
    await page.waitForTimeout(10000);
    cards = await page.locator('[data-property-key]').count();
    const live = (await page.locator('[aria-live="polite"]').allInnerTexts().catch(() => [])).join(' ');
    done = cards > 0 && !/search(ing)? (is )?(running|in progress)|still searching/i.test(live) && i > 5;
  }
  await shot(page, '04-results');
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
  out('console', { errors: consoleErrors.slice(0, 15), count: consoleErrors.length });
} catch (error) {
  await shot(page, '99-failure');
  out('error', { message: String(error?.message ?? error).slice(0, 500), url: page.url() });
  process.exitCode = 1;
} finally {
  await browser.close();
}
