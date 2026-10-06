// FIND PROPERTY — MARKETPLACE SEARCH, in a real browser.
//
// Against the harness build with marketplace-search answered by a stateful
// stub whose result pages are produced by the REAL pipeline
// (src/research-core/marketplace) over the synthetic fixture set — so what the
// browser renders is exactly what processSearch() produces. Nothing here is
// production data; every URL is on a reserved .example host.
//
//   * complete request → confirmation → start → real stages → results
//   * incomplete request asks only what is missing, one question at a time
//   * same flat on three sources: one card, price difference, exact links
//   * worth considering (+3.5%) with measured advantages; Deep Search unavailable
//   * Investment / Mortgage handoffs, comparison, Snake while searching
//   * refresh while searching resumes the search; partial and empty states
//   * 1440px and 390px in six locales (RTL for ar/he): no horizontal overflow
//   * switch off → the existing Find Property, unchanged

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { processSearch, pageResults, publicView } from '../../src/research-core/marketplace/pipeline.ts';
import { briefFromModel } from '../../src/research-core/marketplace/brief.ts';
import { evaluateReadiness } from '../../src/research-core/marketplace/readiness.ts';
import { compareProperties } from '../../src/research-core/marketplace/comparison.ts';
import { stagesOf } from '../../src/research-core/marketplace/lifecycle.ts';
import * as F from '../../src/research-core/__tests__/fixtures/marketplaceFixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.FIND_PROPERTY_QA_SHOTS || null;
const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME && existsSync(process.env.PLAYWRIGHT_CHROME)) return process.env.PLAYWRIGHT_CHROME;
  return ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
}
function resolvePlaywright() {
  for (const c of ['playwright-core', join(ROOT, '.tooling', 'node_modules', 'playwright-core')]) {
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
const opts = skipReason && !process.env.CI ? { skip: skipReason } : { timeout: 1_800_000 };

function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp, email: 'buyer@example.test', aud: 'authenticated' })}.stub`;
  return {
    access_token: jwt, refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'buyer@example.test', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
const profile = { id: 'u1', auth_id: 'u1', email: 'buyer@example.test', is_admin: false, role: 'user', preferred_language: 'en', full_name: 'Buyer', plan: 'FREE', created_at: new Date().toISOString() };

/* The processed result set, from the real pipeline. Listings are re-timed to "now" so freshness reads as current. */
function liveCandidates() {
  const now = Date.now();
  return F.fixtureCandidates().map(({ workerId, candidate }) => ({
    workerId, candidate: { ...candidate, observedAt: new Date(now - (Date.parse(F.FIXTURE_NOW) - Date.parse(candidate.observedAt))).toISOString() },
  }));
}
const OUTPUT = processSearch({ request: F.FIXTURE_REQUEST, candidates: liveCandidates() });
const BRIEF_COMPLETE = briefFromModel(F.COMPLETE_MODEL_OUTPUT, F.COMPLETE_TEXT);
const SEARCH_BRIEF = briefFromModel({ ...F.COMPLETE_MODEL_OUTPUT, priceMinUsd: 130000, priceMaxUsd: 170000 }, F.COMPLETE_TEXT.replace('$120,000', '$130,000').replace('$160,000', '$170,000'));

function summary(status, { empty = false, output = OUTPUT } = {}) {
  const terminal = ['COMPLETE', 'PARTIAL_COMPLETE', 'FAILED', 'CANCELLED'].includes(status);
  const processed = status !== 'SEARCHING';
  const groups = { BEST: 0, OWNER: 0, UPGRADE: 0, MORE: 0 };
  if (processed && !empty) for (const p of output.properties) groups[p.group] += 1;
  const s = output.stats;
  return {
    id: '11111111-1111-4111-8111-111111111111', status, terminal, brief: SEARCH_BRIEF, createdAt: new Date().toISOString(),
    resultsAvailableAt: processed ? new Date().toISOString() : null,
    progress: { sourcesTotal: 5, sourcesCompleted: terminal ? 5 : processed ? 3 : 1, sourcesFailed: status === 'PARTIAL_COMPLETE' ? 1 : 0, fraction: terminal ? 1 : processed ? 0.6 : 0.2 },
    stages: stagesOf({ discovered: processed ? s.raw : 4, validated: processed ? s.validated : 0, uniqueProperties: processed ? s.uniqueProperties : 0, processed, terminal }),
    counters: {
      listingsDiscovered: processed ? s.raw : 4, listingsValidated: processed ? s.validated : 0, uniqueProperties: processed && !empty ? s.uniqueProperties : 0,
      strongMatches: processed && !empty ? s.strongMatches : 0, sourcesCompleted: terminal ? 5 : processed ? 3 : 1, sourcesTotal: 5,
    },
    groups, totalProperties: Object.values(groups).reduce((a, b) => a + b, 0), partial: status === 'PARTIAL_COMPLETE', unavailable: status === 'FAILED' ? 'FAILED' : null,
  };
}

async function boot(t, { rateLimited = false, width = 1440, height = 900, lang = 'en', enabled = true, timeline = ['SEARCHING', 'RESULTS_AVAILABLE', 'COMPLETE'], empty = false, resumeStatus = null, output = OUTPUT } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close().catch(() => {}); server.kill(); });
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const state = { started: resumeStatus !== null, polls: 0, calls: [], starts: 0 };
  await page.route('**', async (r) => {
    const req = r.request();
    const url = req.url();
    if (url.startsWith(BASE)) return r.continue();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.includes('/auth/v1/user')) return r.fulfill(json(fakeSession().user));
    if (url.includes('/auth/v1/token')) return r.fulfill(json(fakeSession()));
    if (url.includes('/rest/v1/users')) return r.fulfill(json(profile));
    if (url.includes('/functions/v1/marketplace-search')) {
      const body = JSON.parse(req.postData() ?? '{}');
      state.calls.push(body.action);
      if (body.action === 'capabilities') return r.fulfill(json({ marketplaceEnabled: enabled, activeSources: enabled ? 5 : 0, deepSearchAvailable: false }));
      if (body.action === 'understand' && rateLimited) {
        return r.fulfill({ ...json({ error: 'RATE_LIMIT_EXCEEDED', code: 'RATE_LIMIT_EXCEEDED', retryAfterSeconds: 120 }, 429), headers: { 'access-control-allow-origin': '*', 'retry-after': '120' } });
      }
      if (body.action === 'understand') {
        const raw = /80/.test(body.text) ? F.COMPLETE_MODEL_OUTPUT : F.INCOMPLETE_MODEL_OUTPUT;
        const brief = briefFromModel(raw, body.text);
        return r.fulfill(json({ understood: true, brief, readiness: evaluateReadiness(brief) }));
      }
      if (body.action === 'start') {
        const readiness = evaluateReadiness(body.brief);
        if (readiness.state !== 'READY') return r.fulfill(json({ error: 'SEARCH_NOT_READY', readiness }, 422));
        state.started = true;
        state.starts += 1;
        return r.fulfill(json({ search: summary('SEARCHING', { output }) }, 202));
      }
      if (body.action === 'status') {
        if (!state.started) return r.fulfill(json({ search: null }));
        if (resumeStatus) return r.fulfill(json({ search: summary(resumeStatus, { empty, output }) }));
        const i = Math.min(state.polls, timeline.length - 1);
        state.polls += 1;
        return r.fulfill(json({ search: summary(timeline[i], { empty, output }) }));
      }
      if (body.action === 'results') {
        const page = empty ? { items: [], total: 0, nextOffset: null } : pageResults(output, body.group, body.offset ?? 0, body.limit ?? 12);
        return r.fulfill(json({ group: body.group, items: page.items.map(publicView), total: page.total, nextOffset: page.nextOffset }));
      }
      if (body.action === 'property') {
        const p = output.properties.find((x) => x.key === body.key);
        return r.fulfill(p ? json({ property: publicView(p), request: F.FIXTURE_REQUEST }) : json({ error: 'NOT_FOUND' }, 404));
      }
      if (body.action === 'compare') {
        const [a, b] = [body.a, body.b].map((k) => OUTPUT.properties.find((x) => x.key === k));
        const c = (p) => ({ key: p.key, facts: p.facts, freshness: p.freshness.state, lastVerifiedAt: p.freshness.lastVerifiedAt, seller: p.seller.classification, sourceCount: p.sourceCount });
        return r.fulfill(json({ a: publicView(a), b: publicView(b), rows: compareProperties(c(a), c(b)) }));
      }
      if (body.action === 'cancel') return r.fulfill(json({ search: summary('CANCELLED') }));
      return r.fulfill(json({ error: 'UNKNOWN_ACTION' }, 400));
    }
    if (url.includes('/functions/v1/find-property')) return r.fulfill(json({ success: true, searches: 0, state: 'NO_ACTIVE_SEARCH', results: [] }));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state };
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page, name, { fullPage = true } = {}) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });
}

/** Mode → intro → complete request → confirmation. */
async function toConfirm(page, modeShot = null) {
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('#mps-mode-title').waitFor({ timeout: 30000 });
  if (modeShot) {
    if (await overflow(page) > 1) throw new Error(`${modeShot}: mode screen overflows`);
    await shot(page, modeShot);
  }
  await page.locator('section[aria-labelledby="mps-mode-title"] article').first().locator('button').click();
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.locator('#mps-ready').waitFor({ timeout: 15000 });
}

test('ka, 1440: complete request → READY without questions → search → grouped results with exact links', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'ka' });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('#mps-mode-title').waitFor({ timeout: 30000 });
  const mode = await page.textContent('main');
  for (const s of ['შენი მოთხოვნა ასობით მარკეტფლეისი ყველა შესაბამისი განცხადება ერთ სივრცეში', 'უბრალოდ უთხარი HOMATCH-ს რას ეძებ.',
    'ერთი მოთხოვნა. ბევრი წყარო. ბევრად ნაკლები ძებნა.', 'Marketplace Search', 'უფასო', 'მომიძებნე ქონება', 'Deep Search']) assert.ok(mode.includes(s), s);
  assert.ok(!mode.includes('მარკეტპლეის'));
  const deep = page.locator('section[aria-labelledby="mps-mode-title"] article').nth(1).locator('button');
  assert.equal(await deep.isDisabled(), true, 'Deep Search never starts a fake search');
  await shot(page, 'ka-1440-mode');

  await page.locator('section[aria-labelledby="mps-mode-title"] article').first().locator('button').click();
  const intro = await page.textContent('main');
  for (const s of ['მომიყევი, რას ეძებ 🏡', 'მაგალითად', 'გაგრძელება']) assert.ok(intro.includes(s), s);
  assert.equal(await page.locator('textarea').getAttribute('placeholder'), 'მაგალითად: ვაკეში მინდა 2 საძინებლიანი ბინა...');
  await shot(page, 'ka-1440-intro');
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.locator('#mps-ready').waitFor({ timeout: 15000 });
  const ready = await page.textContent('main');
  for (const s of ['ყველაფერი მზადაა ✨', 'ყიდვა', 'ბინა', 'ვაკე', '3 ოთახი', '2 საძინებელი', '80 დან 110 მ² მდე', '$120,000 დან $160,000 მდე', 'ძიების დაწყება', 'შეცვლა']) {
    assert.ok(ready.includes(s), `confirmation shows ${s}`);
  }
  assert.ok(!(await page.locator('[aria-labelledby$="-q"]').count()), 'no question was asked');
  await shot(page, 'ka-1440-confirm');

  await page.getByRole('button', { name: 'ძიების დაწყება' }).click();
  await page.locator('#mps-searching').waitFor({ timeout: 15000 });
  assert.ok(state.calls.includes('start'));
  const searching = await page.textContent('main');
  for (const s of ['HOMATCH უკვე ეძებს შენთვის', 'შედეგები გამოჩნდება ეტაპობრივად, როგორც კი სხვადასხვა წყაროდან მივიღებთ.', 'ვეძებთ მიმდინარე განცხადებებს', 'ძიება გრძელდება...']) {
    assert.ok(searching.includes(s), s);
  }
  assert.ok(!searching.includes('ითამაშე სანამ HOMATCH ეძებს'), 'the old Snake text block is gone');
  assert.doesNotMatch(searching, /\d+%/, 'no percentage is shown');
  await shot(page, 'ka-1440-searching');

  await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
  await page.locator('section[aria-labelledby="mps-g-UPGRADE"] article').first().waitFor({ timeout: 30000 });
  const results = await page.textContent('main');
  for (const s of [`ნაპოვნია ${OUTPUT.properties.length} შესაბამისი ქონება`, 'საუკეთესო ვარიანტები', 'ღირს განხილვა', 'სხვა შესაბამისი ვარიანტები', 'რატომ გირჩევს HOMATCH', 'ნაპოვნია 3 წყაროში', 'ფასებში სხვაობა',
    '+3.5% შენს მაქსიმალურ ბიუჯეტზე მეტი', 'რატომ ღირს განხილვა', 'გინდა უფრო ფართოდ მოვძებნოთ?']) {
    assert.ok(results.includes(s), `results show ${s}`);
  }
  assert.ok(!results.includes('$188,000'), 'nothing above the 10% ceiling is shown');
  await shot(page, 'ka-1440-results');

  /* The three-source flat: one card, one property sheet, three exact links. */
  const card = page.locator('article', { hasText: 'ნაპოვნია 3 წყაროში' }).first();
  await card.getByRole('button', { name: 'ქონების ნახვა' }).click();
  await page.locator('#mps-listings').waitFor();
  const sheet = page.locator('[role="dialog"]');
  const text = await sheet.textContent();
  for (const s of ['ფასებში სხვაობა ვიპოვეთ', 'ყველაზე დაბალი ფასი', 'ყველაზე მაღალი ფასი', '$162,000', '$181,000', '$19,000', 'დაკავშირებამდე გადაამოწმე მიმდინარე ფასი და პირობები.',
    'სავარაუდოდ მესაკუთრისგან', 'სააგენტო', 'ბროკერი', 'უფრო მაღალი ფასი', 'ინვესტიციის ანალიზი', 'იპოთეკის ნახვა']) assert.ok(text.includes(s), `sheet shows ${s}`);
  for (const w of ['თაღლით', 'scam', 'fraud']) assert.ok(!text.toLowerCase().includes(w));
  const links = await sheet.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
  for (const href of ['https://source-a.example/listing/a-162', 'https://source-b.example/listing/b-165', 'https://source-c.example/listing/c-181']) {
    const l = links.find((x) => x.href === href);
    assert.ok(l, `exact link ${href}`);
    assert.equal(l.target, '_blank');
    assert.match(l.rel, /noopener/);
  }
  assert.ok(await sheet.locator('a[href^="tel:+995599112233"]').count(), 'the public phone is shown as published');
  await shot(page, 'ka-1440-property');

  /* Mortgage gets the price only; Investment gets the stated facts. */
  await sheet.getByRole('button', { name: 'იპოთეკის ნახვა' }).click();
  await page.waitForURL(/\/mortgage/);
  const mortgageState = await page.evaluate(() => window.history.state?.usr ?? null);
  assert.deepEqual(mortgageState, { context: { price: 162000, currency: 'USD' } });
});

test('en, 1440: incomplete request asks only what is missing, one question at a time; READY only when complete', opts, async (t) => {
  const { page } = await boot(t, { lang: 'en' });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('#mps-mode-title').waitFor({ timeout: 30000 });
  await page.locator('section[aria-labelledby="mps-mode-title"] article').first().locator('button').click();
  await page.locator('textarea').fill(F.INCOMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: 'What are you looking for?' }).waitFor({ timeout: 15000 });
  const body = await page.textContent('main');
  assert.ok(body.includes('Missing:'));
  assert.ok(body.includes('2 bedrooms') && body.includes('Apartment'), 'understood criteria are shown as chips');
  assert.ok(!body.includes('How many bedrooms'), 'bedrooms is not asked again');
  await shot(page, 'en-1440-incomplete');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('heading', { name: 'What price range should we search in?' }).waitFor();
  const inputs = page.locator('input[inputmode="numeric"]');
  await inputs.nth(0).fill('120000');
  await inputs.nth(1).fill('160000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'What area range should we search in?' }).waitFor();
  await page.locator('input[inputmode="numeric"]').nth(0).fill('80');
  await page.locator('input[inputmode="numeric"]').nth(1).fill('110');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'How many rooms do you need?' }).waitFor();
  await page.getByRole('button', { name: '3 rooms' }).click();
  await page.getByRole('heading', { name: 'What type of building do you prefer?' }).waitFor();
  await page.getByRole('button', { name: "Doesn't matter" }).click();
  await page.locator('#mps-ready').waitFor();
  assert.ok((await page.textContent('main')).includes('Everything is ready ✨'));
});

test('Snake: a thumbnail opens the game at once; keys, WASD and swipe work; the search goes on and is never duplicated', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'ka', width: 390, height: 844, timeline: ['SEARCHING', 'SEARCHING', 'RESULTS_AVAILABLE', 'COMPLETE'] });
  await toConfirm(page);
  /* A double click starts ONE search. */
  await page.locator('[data-action="mps-start"]').dblclick();
  await page.locator('#mps-searching').waitFor({ timeout: 15000 });
  assert.equal(state.starts, 1, 'one search for a double click');
  await shot(page, 'ka-390-searching');

  await page.locator('[data-action="mps-snake-open"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('application').waitFor();
  assert.equal(await page.locator('#mps-snake-intro').count(), 0, 'no intermediate screen');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await page.keyboard.press('d');
  await page.waitForTimeout(300);
  await page.keyboard.press('s');
  const scoreText = await dialog.textContent();
  assert.match(scoreText, /ქულა: \d+/);
  /* A swipe on the board turns the snake and never scrolls the page. */
  const box = await dialog.getByRole('application').boundingBox();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.scrollY), before);
  await shot(page, 'ka-390-snake', { fullPage: false });

  /* Results arrive while playing: a quiet notice, and the game stays open even after the search completes. */
  await dialog.getByText('შედეგები მზადაა').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(5000);
  assert.equal(await page.getByRole('dialog').count(), 1, 'the search finishing never closes the game');
  await shot(page, 'ka-390-snake-ready', { fullPage: false });
  assert.ok(state.calls.filter((c) => c === 'status').length >= 2, 'the search kept polling while the game was open');
  assert.equal(state.starts, 1, 'opening Snake never started another search');

  await page.getByRole('button', { name: 'თამაშის დახურვა' }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
  assert.match(page.url(), /search=11111111-1111-4111-8111-111111111111/, 'closing returns to the same search');

  /* Refresh: the same search is restored, nothing is restarted. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
  assert.equal(state.starts, 1, 'refresh never duplicates the search');
  assert.ok(await overflow(page) <= 1);
  await shot(page, 'ka-390-results');
});

test('ranking is not hiding: 800 valid matching properties are all reachable in the browser', opts, async (t) => {
  const many = Array.from({ length: 800 }, (_, i) => F.listing({
    source: 'source-a', sourceListingId: `v${i}`, price: 130000 + (i * 37) % 40000, areaSqm: 80 + (i % 30), floor: 1 + (i % 25), images: [],
    observedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  }));
  const big = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(many) });
  assert.equal(big.properties.length, 800);
  const { page } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE', output: big });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mps-total').waitFor({ timeout: 30000 });
  assert.equal(await page.getByTestId('mps-total').textContent(), '800 matching properties found');
  for (let i = 0; i < 200; i++) {
    const n = await page.locator('section[aria-labelledby^="mps-g-"] article').count();
    if (n >= 800) break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
  }
  const keys = await page.locator('section[aria-labelledby^="mps-g-"] article').count();
  assert.equal(keys, 800, 'every valid property is on the page once the customer scrolls');
  assert.ok(await overflow(page) <= 1);
});

test('rate limited understand: a clear message, then the questions; nothing breaks', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'en', rateLimited: true });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('#mps-mode-title').waitFor({ timeout: 30000 });
  await page.locator('section[aria-labelledby="mps-mode-title"] article').first().locator('button').click();
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.getByText('You have made many requests in a short time', { exact: false }).waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'What are you looking for?' }).waitFor();
  assert.equal(state.starts, 0, 'no search was started');
});

test('ka: owner can leave a resumed failed search without hiding or retrying it automatically', opts, async (t) => {
  const {page,state}=await boot(t,{lang:'ka',resumeStatus:'FAILED',empty:true});
  await page.goto(BASE+'/find-property');
  await page.getByRole('button',{name:'ახალი ძიება',exact:true}).waitFor();
  assert.match(await page.textContent('main'),/ძიება ამჟამად ვერ შესრულდა/);
  assert.equal(state.starts,0,'failed history does not silently restart acquisition');
  await page.getByRole('button',{name:'ახალი ძიება',exact:true}).click();
  await page.locator('section[aria-labelledby="mps-mode-title"]').waitFor();
  assert.equal(state.starts,0);assert.ok(!new URL(page.url()).searchParams.has('search'));
});

test('partial and empty results say so, without technical errors', opts, async (t) => {
  {
    const { page } = await boot(t, { lang: 'ka', resumeStatus: 'PARTIAL_COMPLETE' });
    await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
    await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
    const text = await page.textContent('main');
    assert.ok(text.includes('ძიება ნაწილობრივ დასრულდა'));
    assert.ok(text.includes('შედეგები უკვე მზადაა. რამდენიმე წყაროს შემოწმება ამჯერად ვერ მოხერხდა.'));
    assert.doesNotMatch(text, /TIMED_OUT|FAILED|Error/);
    await page.context().close();
  }
  {
    const { page } = await boot(t, { lang: 'ka', resumeStatus: 'COMPLETE', empty: true });
    await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mps-empty').waitFor({ timeout: 30000 });
    const text = await page.textContent('main');
    for (const s of ['ზუსტი შესაბამისობა ჯერ ვერ ვიპოვეთ', 'ფართობის შეცვლა', 'ბიუჯეტის შეცვლა']) assert.ok(text.includes(s), s);
    await shot(page, 'ka-1440-empty');
  }
});

test('comparison: two properties side by side, factual rows, no winner', opts, async (t) => {
  const { page } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE' });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-labelledby="mps-g-UPGRADE"] article').first().waitFor({ timeout: 30000 });
  await page.locator('section[aria-labelledby="mps-g-BEST"]').getByRole('button', { name: 'Compare' }).first().click();
  await page.locator('section[aria-labelledby="mps-g-UPGRADE"]').getByRole('button', { name: 'Compare' }).first().click();
  await page.getByRole('region', { name: 'Compare' }).getByRole('button', { name: 'Compare' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Known facts only. The decision is yours.').waitFor();
  const text = await dialog.textContent();
  for (const s of ['Price', 'Price per m²', 'Area', 'Seller']) assert.ok(text.includes(s));
  assert.doesNotMatch(text, /winner|best choice/i);
  await shot(page, 'en-1440-compare');
});

test('switch off: the existing Find Property renders, unchanged', opts, async (t) => {
  const { page } = await boot(t, { lang: 'en', enabled: false });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 30000 });
  assert.equal(await page.locator('#mps-mode-title').count(), 0);
});

test('1440px and 390px, six locales: mode, confirmation, results and property sheet without horizontal overflow; RTL for ar/he', opts, async (t) => {
  const failures = [];
  for (const width of [1440, 390]) {
    for (const lang of LOCALES) {
      const { page } = await boot(t, { width, height: width < 700 ? 844 : 900, lang });
      await toConfirm(page, `${lang}-${width}-mode`);
      if (await overflow(page) > 1) failures.push(`${lang} ${width}: confirm overflow`);
      const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
      if (['ar', 'he'].includes(lang) && dir !== 'rtl') failures.push(`${lang}: not RTL`);
      await page.locator('[data-action="mps-start"]').click();
      await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
      if (await overflow(page) > 1) failures.push(`${lang} ${width}: results overflow ${await overflow(page)}px`);
      await shot(page, `${lang}-${width}-results`);
      await page.locator('section[aria-labelledby="mps-g-BEST"]').locator('article').first().locator('button').first().click();
      await page.locator('#mps-listings').waitFor();
      const sheetOverflow = await page.locator('[role="dialog"]').evaluate((el) => el.scrollWidth - el.clientWidth);
      if (sheetOverflow > 1) failures.push(`${lang} ${width}: property sheet overflow ${sheetOverflow}px`);
      await shot(page, `${lang}-${width}-property`);
      await page.context().close();
    }
  }
  assert.deepEqual(failures, []);
});
