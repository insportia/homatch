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
//   * worth considering (+5.3%) with measured advantages; Deep Search unavailable
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
import { browseResults } from '../../src/research-core/marketplace/browse-results.ts';
import { briefFromModel } from '../../src/research-core/marketplace/brief.ts';
import { evaluateReadiness } from '../../src/research-core/marketplace/readiness.ts';
import { compareProperties } from '../../src/research-core/marketplace/comparison.ts';
import { stagesOf } from '../../src/research-core/marketplace/lifecycle.ts';
import * as F from '../../src/research-core/__tests__/fixtures/marketplaceFixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const PORT = Number(process.env.HOMATCH_FIND_PROPERTY_QA_PORT) || 4361;
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

test('V2: card gallery, durable dossier, scoped paid chat, insufficient credits and exact result Back state', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE' });
  await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111?fp_sort=FRESHEST&page=1`);
  const cards = page.locator('[data-property-key]');
  await cards.first().waitFor();
  const card = cards.filter({ has: page.getByRole('button', { name: 'Next photo', exact: true }) }).first();
  await card.waitFor();
  const before = page.url();
  await card.getByRole('button', { name: 'Next photo', exact: true }).click();
  const counter = await card.locator('[aria-live="polite"]').textContent();
  await card.getByRole('button', { name: 'Next photo', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await card.locator('[aria-live="polite"]').textContent(), counter, 'focused gallery supports arrow keys');
  assert.equal(page.url(), before, 'gallery controls do not navigate');
  const key = await card.getAttribute('data-property-key');
  await card.getByRole('button', { name: 'View property', exact: true }).last().click();
  await page.locator('[data-property-dossier]').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'ordinary property details are a page');
  assert.ok(new URL(page.url()).pathname.endsWith(`/property/${encodeURIComponent(key)}`));
  assert.equal(new URL(page.url()).searchParams.get('fp_sort'), 'FRESHEST');
  await page.reload(); await page.locator('[data-property-dossier]').waitFor();
  const composer = page.getByLabel('Your question about this property');
  await composer.waitFor(); await page.waitForFunction(() => !document.getElementById('property-ai-message').disabled);
  await shot(page, 'v2-desktop-dossier');
  await composer.fill('What should I verify?');
  await page.getByRole('button', { name: 'Send · uses Credits', exact: true }).click();
  await page.getByText('Evidence-based property answer.', { exact: true }).waitFor();
  assert.equal(state.aiCalls[0].context.type, 'property');
  assert.equal(state.aiCalls[0].context.searchId, '11111111-1111-4111-8111-111111111111');
  assert.equal(state.aiCalls[0].context.propertyKey, key);
  assert.equal(state.conversations[0].context.propertyKey, key);
  assert.ok(state.aiCalls[0].interactionId);
  state.aiNetworkFailure = true;
  await composer.fill('Explain the price discrepancy.');
  const networkFailure = page.waitForEvent('requestfailed', { predicate: (request) => request.url().includes('/functions/v1/homatch-ai') });
  await page.getByRole('button', { name: 'Send · uses Credits', exact: true }).click();
  await networkFailure;
  await page.waitForFunction(() => !document.getElementById('property-ai-message').disabled);
  const failedTurn = state.aiCalls[state.aiCalls.length - 1];
  const retriedResponse = page.waitForResponse((response) => response.url().includes('/functions/v1/homatch-ai') && response.status() === 200);
  await page.getByRole('button', { name: 'Send · uses Credits', exact: true }).click();
  await retriedResponse;
  await page.waitForFunction(() => !document.getElementById('property-ai-message').disabled);
  const retriedTurn = state.aiCalls[state.aiCalls.length - 1];
  assert.equal(retriedTurn.interactionId, failedTurn.interactionId, 'ambiguous network retry cannot reserve a new charge');
  state.aiInsufficient = true;
  await composer.fill('What about negotiation?');
  await page.getByRole('button', { name: 'Send · uses Credits', exact: true }).click();
  await page.getByText('Not enough Credits.', { exact: false }).waitFor();
  assert.equal(await composer.inputValue(), 'What about negotiation?', 'failed billing preserves the question after a previous answer');
  assert.ok(await page.getByText('Evidence-based property answer.', { exact: true }).count(), 'conversation survives insufficient credits');
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  await cards.first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('fp_sort'), 'FRESHEST');
  assert.ok(new URL(page.url()).pathname.endsWith('/search/11111111-1111-4111-8111-111111111111'));
  await shot(page, 'v2-desktop-results');
});

test('Advisor: confirmed original listings are explorable; optional floor requirements survive refresh and submission', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'en', width: 390 });
  await page.goto(`${BASE}/find-property/search/22222222-2222-4222-8222-222222222222`);
  const duplicates = page.locator('[data-confirmed-duplicates]').first();
  await duplicates.locator('summary').click();
  assert.doesNotMatch(await duplicates.locator('summary').textContent(), /\{n\}/);
  assert.ok(await duplicates.locator('a[target="_blank"]').count() >= 2);
  await duplicates.getByText('Lowest price', { exact: false }).waitFor({ state: 'visible' });
  await page.waitForURL((url) => url.searchParams.get('revision') === state.revision);
  assert.equal(await duplicates.getAttribute('open'), '', 'recording the result revision preserves an opened disclosure');
  assert.equal(state.requests.filter((r) => r.action === 'browse').length, 1, 'initial revision bookkeeping does not refetch and remount the cards');
  await shot(page, 'advisor-mobile-confirmed-duplicates');
  await page.goto(`${BASE}/find-property/new`);
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.getByText('Floor & building preferences · optional', { exact: true }).click();
  await page.getByLabel('Elevator required', { exact: true }).check();
  await page.getByLabel('Minimum floor', { exact: true }).fill('2');
  await page.getByLabel('Maximum floor', { exact: true }).fill('8');
  await page.getByLabel('Maximum building age · years', { exact: true }).fill('25');
  await page.reload();
  await page.getByText('Floor & building preferences · optional', { exact: true }).click();
  assert.ok(await page.getByLabel('Elevator required', { exact: true }).isChecked());
  assert.equal(await page.getByLabel('Minimum floor', { exact: true }).inputValue(), '2');
  assert.equal(await page.getByLabel('Maximum floor', { exact: true }).inputValue(), '8');
  await shot(page, 'advisor-mobile-advanced-preferences');
  await page.getByRole('button', { name: 'Start search', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[data-property-key]'));
  const started = state.requests.find((r) => r.action === 'start');
  assert.deepEqual(started.brief.floorRange, { min: 2, max: 8 });
  assert.equal(started.brief.maxBuildingAge, 25);
  assert.ok(started.brief.mustHave.includes('ELEVATOR'));
  assert.ok(await overflow(page) <= 1);
});

test('V2 mobile: workspace, touch gallery and property AI composer at 375px and Arabic RTL at 393px', opts, async (t) => {
  for (const [width, lang] of [[375, 'en'], [393, 'ar']]) {
    const { page, close } = await boot(t, { lang, width, height: 844 });
    await page.goto(`${BASE}/find-property`);
    const start = page.locator('a[href="/find-property/new"]');
    await start.waitFor();
    assert.ok((await start.boundingBox()).height >= 44);
    assert.equal(await page.locator('[data-property-key]').count(), 0);
    await page.locator('a[href="/find-property/search/22222222-2222-4222-8222-222222222222"]').waitFor();
    await shot(page, `v2-${lang}-${width}-workspace`);
    await page.locator('a[href="/find-property/search/22222222-2222-4222-8222-222222222222"]').click();
    const card = page.locator('[data-property-key]').filter({ has: page.locator('[aria-live="polite"]') }).first();
    await card.waitFor();
    const before = await card.locator('[aria-live="polite"]').textContent();
    const searchUrl = page.url();
    const propertyKey = await card.getAttribute('data-property-key');
    const currentGallery = () => page.locator(`[data-property-key=${JSON.stringify(propertyKey)}]`).locator('[role="group"][aria-label]');
    await currentGallery().waitFor({ state: 'visible' });
    await currentGallery().locator('button').first().click({ trial: true });
    const gallery = currentGallery();
    const box = await gallery.boundingBox();
    assert.ok(box && box.width > 120, 'gallery has room for a horizontal gesture');
    const touch = await page.context().newCDPSession(page);
    const x = box.x + box.width * 0.7, y = box.y + box.height * 0.6;
    // Browser-generated touch events exercise hit testing, touch-action and React
    // updates, unlike synchronous dispatchEvent calls on the group itself.
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    for (const distance of [30, 60, 90, 120]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance, y, id: 1 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    const expected = `${Number(before.split('/')[0]) % Number(before.split('/')[1]) + 1}/${before.split('/')[1]}`;
    await page.waitForFunction(({ key, expected }) => [...document.querySelectorAll('[data-property-key]')]
      .find((el) => el.getAttribute('data-property-key') === key)?.querySelector('[aria-live="polite"]')?.textContent === expected,
    { key: await card.getAttribute('data-property-key'), expected });
    assert.equal(await card.locator('[aria-live="polite"]').textContent(), expected, 'left swipe advances exactly one photo');
    await gallery.evaluate((el) => el.querySelector('button').click()); // Suppress any compatibility click after the swipe.
    assert.equal(page.url(), searchUrl, 'swiping stays on the search');
    await card.getByRole('button').first().click();
    await page.locator('[data-property-dossier]').waitFor();
    await page.locator('#property-ai-message').waitFor();
    assert.ok(await overflow(page) <= 1, `${lang} ${width}: no clipping`);
    if (lang === 'ar') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await shot(page, `v2-${lang}-${width}-dossier`);
    await close();
  }
});

test('V2: an unavailable dossier cannot be hidden by a later successful search-status response', opts, async (t) => {
  const { page, state } = await boot(t, { resumeStatus: 'COMPLETE' });
  state.statusDelayMs = 100;
  await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111/property/missing-property`);
  const warning = page.getByText('This property could not be loaded. Reopen the search or try again.', { exact: true });
  await warning.waitFor();
  await page.getByRole('link', { name: 'Back to results', exact: true }).waitFor();
  assert.ok(await warning.isVisible());
  assert.equal(await page.locator('[data-property-dossier]').count(), 0);
  await page.getByRole('link', { name: 'Back to results', exact: true }).click();
  await page.locator('[data-property-key]').first().waitFor();
});

test('V2: malformed history is recoverable and never masquerades as an empty workspace', opts, async (t) => {
  const { page, state } = await boot(t);
  state.historyMalformed = true;
  await page.goto(`${BASE}/find-property`);
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(await page.locator('[data-property-key]').count(), 0);
  assert.ok(await page.locator('a[href="/find-property/new"]').isVisible());
  state.historyMalformed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('a[href="/find-property/search/22222222-2222-4222-8222-222222222222"]').waitFor();
  assert.equal(state.starts, 0);
});

test('V2: a backend missing the history action stays an error; authenticated retry recovers and legacy optional counts are omitted', opts, async (t) => {
  const { page, state } = await boot(t);
  state.historyBackendFailure = true;
  await page.goto(`${BASE}/find-property`);
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(await page.locator('a[href="/find-property/search/22222222-2222-4222-8222-222222222222"]').count(), 0);
  state.historyBackendFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('a[href="/find-property/search/22222222-2222-4222-8222-222222222222"]').waitFor();
  assert.ok(state.historyAuthenticated);
  assert.ok(state.requests.filter(r => r.action === 'history').every(r => !('user_id' in r)));
});

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
    workerId, candidate: { ...candidate, observedAt: new Date(now - (Date.parse(F.FIXTURE_NOW) - Date.parse(candidate.observedAt))).toISOString(),
      publishedAt: candidate.publishedAt ? new Date(now - (Date.parse(F.FIXTURE_NOW) - Date.parse(candidate.publishedAt))).toISOString() : null },
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

async function boot(t, { rateLimited = false, width = 1440, height = 900, lang = 'en', enabled = true, timeline = ['SEARCHING', 'RESULTS_AVAILABLE', 'COMPLETE'], empty = false, resumeStatus = null, output = OUTPUT, nativeInventory = false } = {}) {
  const { chromium } = resolvePlaywright();
  const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const close = async () => { await browser.close().catch(() => {}); server.kill(); };
  t.after(close);
  for (let i = 0; i < 80; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce' });
  await ctx.addInitScript(([k, s, l]) => { window.localStorage.setItem(k, JSON.stringify(s)); window.localStorage.setItem('homatch_lang', l); },
    ['sb-stubproj-auth-token', fakeSession(), lang]);
  const page = await ctx.newPage();
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  const state = { started: resumeStatus !== null, polls: 0, calls: [], starts: 0, requests: [], revision: 'fixture-revision', browseFailure: false, aiCalls: [], aiInsufficient: false, aiNetworkFailure: false, conversations: [], statusDelayMs: 0, historyMalformed: false };
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
      state.requests.push(body);
      if (body.action === 'capabilities') return r.fulfill(json({ marketplaceEnabled: enabled, activeSources: enabled ? 5 : 0, deepSearchAvailable: false }));
      if (body.action === 'history') {
        state.historyAuthenticated = /^Bearer /.test(req.headers().authorization ?? '');
        if (state.historyBackendFailure) return r.fulfill(json({ error: 'UNKNOWN_ACTION' }, 400));
        if (state.historyMalformed) return r.fulfill(json({}));
        const ids = [{ id: '33333333-3333-4333-8333-333333333333', status: 'FAILED' }, { id: '22222222-2222-4222-8222-222222222222', status: 'COMPLETE' }];
        if (state.started) ids.unshift({ id: '11111111-1111-4111-8111-111111111111', status: resumeStatus ?? 'COMPLETE' });
        return r.fulfill(json({ page: body.page ?? 1, hasMore: false, items: ids.map(({ id, status }) => ({ id, status, brief: SEARCH_BRIEF, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), uniqueProperties: status === 'FAILED' ? null : output.properties.length, strongMatches: status === 'FAILED' ? null : output.stats.strongMatches, sourcesTotal: 5, sourcesTerminal: 5, rawListings: output.stats.raw })) }));
      }
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
        if (state.statusDelayMs) await new Promise((resolve) => setTimeout(resolve, state.statusDelayMs));
        if (body.searchId === '22222222-2222-4222-8222-222222222222') return r.fulfill(json({ search: { ...summary('COMPLETE', { output }), id: body.searchId } }));
        if (body.searchId === '33333333-3333-4333-8333-333333333333') return r.fulfill(json({ search: { ...summary('FAILED', { empty: true, output }), id: body.searchId } }));
        if (!state.started) return r.fulfill(json({ search: null }));
        if (resumeStatus) return r.fulfill(json({ search: summary(resumeStatus, { empty, output }) }));
        const i = Math.min(state.polls, timeline.length - 1);
        state.polls += 1;
        return r.fulfill(json({ search: summary(timeline[i], { empty, output }) }));
      }
      if (body.action === 'browse') {
        if (state.browseFailure) return r.fulfill(json({ error: 'REQUEST_FAILED' }, 503));
        if (body.revision && body.revision !== state.revision) return r.fulfill(json({ error: 'RESULTS_CHANGED' }, 409));
        const page = browseResults(empty ? [] : output.properties.map(publicView), body.filters, body.page ?? 1);
        return r.fulfill(json({ ...page, revision: state.revision }));
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
    if (url.includes('/functions/v1/homatch-ai')) {
      const body = JSON.parse(req.postData() ?? '{}'); state.aiCalls.push(body);
      if (state.aiNetworkFailure) { state.aiNetworkFailure = false; return r.abort('connectionreset'); }
      if (state.aiInsufficient) return r.fulfill(json({ error: 'insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402));
      return r.fulfill(json({ text: 'Evidence-based property answer.', billing: { chargedCredits: 1, remainingCredits: 99 } }));
    }
    if (url.includes('/rest/v1/ai_conversations')) {
      if (req.method() === 'POST') { const payload = JSON.parse(req.postData() ?? '{}'); const conversation = { id: '44444444-4444-4444-8444-444444444444', ...payload }; state.conversations.push(conversation); return r.fulfill(json(conversation)); }
      const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
      return r.fulfill(json(wantsObject ? state.conversations[0] ?? null : state.conversations));
    }
    if (url.includes('/rest/v1/rpc/my_native_matches')) return r.fulfill(json(nativeInventory ? [{ kind: 'MATCH', id: 'native-1', role: 'SEEKER', property_id: 'property-1', property_title: 'Native HOMATCH apartment', homatch_id: 101, agreed: ['CITY', 'PRICE'], preference_misses: [], viewing_requested: false, city: 'Tbilisi', price: 150000, currency: 'USD', area: 85, rooms: 3, bedrooms: 2 }] : []));
    const wantsObject = (req.headers().accept ?? '').includes('pgrst.object');
    if (url.includes('/rest/v1/')) return r.fulfill(json(wantsObject ? {} : []));
    return r.fulfill(json({}));
  });
  return { page, state, close };
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
  await page.locator('a[href="/find-property/new"]').waitFor({ timeout: 30000 });
  if (modeShot) {
    if (await overflow(page) > 1) throw new Error(`${modeShot}: mode screen overflows`);
    await shot(page, modeShot);
  }
  await page.locator('a[href="/find-property/new"]').click();
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.locator('#mps-ready').waitFor({ timeout: 15000 });
}

test('ka, 1440: complete request → READY without questions → search → grouped results with exact links', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'ka' });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href="/find-property/new"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('[data-property-key]').count(), 0, 'root is history, not a result dump');
  assert.equal(await page.locator('#mps-mode-title').count(), 0, 'marketing does not dominate the workspace');
  await shot(page, 'ka-1440-mode');

  await page.locator('a[href="/find-property/new"]').click();
  await page.locator('textarea').waitFor();
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
  for (const s of [`ნაპოვნია ${OUTPUT.properties.length} შესაბამისი ქონება`, 'საუკეთესო დამთხვევები', 'გონივრული გაუმჯობესება · +5–10%', 'რატომ გირჩევს HOMATCH', 'ნაპოვნია 3 წყაროში', 'ფასებში სხვაობა',
    '$9,000', 'რატომ ღირს განხილვა', 'გინდა უფრო ფართოდ მოვძებნოთ?']) {
    assert.ok(results.includes(s), `results show ${s}`);
  }
  assert.ok(!results.includes('$188,000'), 'nothing above the 10% ceiling is shown');
  assert.ok((await page.locator('section[aria-labelledby="mps-g-UPGRADE"]').textContent()).includes('+5.3%'), 'upgrade shows both measured over-budget amount and percentage');
  await shot(page, 'ka-1440-results');

  /* The three-source flat: one card, one property sheet, three exact links. */
  const card = page.locator('article', { hasText: 'ნაპოვნია 3 წყაროში' }).first();
  await card.getByRole('button', { name: 'ქონების ნახვა' }).click();
  await page.locator('#mps-listings').waitFor();
  const sheet = page.locator('[data-property-dossier]');
  const text = await sheet.textContent();
  for (const s of ['ფასებში სხვაობა ვიპოვეთ', 'ყველაზე დაბალი ფასი', 'ყველაზე მაღალი ფასი', '$162,000', '$181,000', '$19,000', 'დაკავშირებამდე გადაამოწმე მიმდინარე ფასი და პირობები.',
    'სავარაუდოდ მესაკუთრე', 'სააგენტო', 'სავარაუდოდ ბროკერი / სააგენტო', 'უფრო მაღალი ფასი', 'ინვესტიციის ანალიზი', 'იპოთეკის ნახვა']) assert.ok(text.includes(s), `sheet shows ${s}`);
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
  await page.locator('a[href="/find-property/new"]').waitFor({ timeout: 30000 });
  await page.locator('a[href="/find-property/new"]').click();
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
  assert.match(page.url(), /\/search\/11111111-1111-4111-8111-111111111111/, 'closing returns to the same search');

  /* Refresh: the same search is restored, nothing is restarted. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
  assert.equal(state.starts, 1, 'refresh never duplicates the search');
  assert.ok(await overflow(page) <= 1);
  await shot(page, 'ka-390-results');
});

test('800 properties use bounded numbered pages; filters reset and Back/Forward preserve state', opts, async (t) => {
  const many = Array.from({ length: 800 }, (_, i) => F.listing({
    source: 'source-a', sourceListingId: `v${i}`, price: 130000 + (i * 37) % 40000, areaSqm: 80 + (i % 30), floor: 1 + (i % 25), images: [],
    observedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    publishedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  }));
  const big = processSearch({ request: F.FIXTURE_REQUEST, candidates: F.fixtureCandidates(many) });
  assert.equal(big.properties.length, 800);
  const { page, state } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE', output: big });
  await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mps-total').waitFor({ timeout: 30000 });
  assert.equal(await page.getByTestId('mps-total').textContent(), '800 matching properties found');
  const cards = page.locator('[data-property-key]');
  await cards.first().waitFor();
  const first = await cards.evaluateAll((els) => els.map((el) => el.dataset.propertyKey));
  assert.equal(first.length, 12);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('nav button[aria-current="page"]')?.textContent === '2');
  const second = await cards.evaluateAll((els) => els.map((el) => el.dataset.propertyKey));
  assert.equal(second.length, 12); assert.ok(second.every((key) => !first.includes(key)));
  await page.goBack(); await page.waitForFunction(() => document.querySelector('nav button[aria-current="page"]')?.textContent === '1');
  assert.deepEqual(await cards.evaluateAll((els) => els.map((el) => el.dataset.propertyKey)), first);
  await page.goForward(); await page.waitForFunction(() => document.querySelector('nav button[aria-current="page"]')?.textContent === '2');
  await page.getByRole('button', { name: 'Page 67', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('nav button[aria-current="page"]')?.textContent === '67');
  assert.equal(await cards.count(), 8, 'final numbered page reaches the tail without appending DOM');
  await page.getByText('Price, space and listing evidence', { exact: true }).click();
  await page.getByLabel('Maximum price ($)', { exact: true }).fill('135000');
  await page.waitForURL(/fp_priceMax=135000/);
  assert.equal(new URL(page.url()).searchParams.get('page'), '1');
  assert.match(new URL(page.url()).pathname, /\/search\/11111111/); assert.ok(new URL(page.url()).searchParams.has('revision'));
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('fp_priceMax'));
  assert.ok(state.requests.filter((r) => r.action === 'browse').every((r) => !r.offset), 'only bounded page requests');
  assert.ok(await overflow(page) <= 1);
});

test('rate limited understand: a clear message, then the questions; nothing breaks', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'en', rateLimited: true });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href="/find-property/new"]').waitFor({ timeout: 30000 });
  await page.locator('a[href="/find-property/new"]').click();
  await page.locator('textarea').fill(F.COMPLETE_TEXT);
  await page.locator('form button[type="submit"]').click();
  await page.getByText('You have made many requests in a short time', { exact: false }).waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'What are you looking for?' }).waitFor();
  assert.equal(state.starts, 0, 'no search was started');
});

test('ka: owner can leave a resumed failed search without hiding or retrying it automatically', opts, async (t) => {
  const {page,state}=await boot(t,{lang:'ka',resumeStatus:'FAILED',empty:true});
  await page.goto(BASE+'/find-property?search=11111111-1111-4111-8111-111111111111');
  await page.getByRole('button',{name:'ახალი ძიება',exact:true}).waitFor();
  assert.match(await page.textContent('main'),/ძიება ამჯერად ვერ შესრულდა/);
  assert.equal(state.starts,0,'failed history does not silently restart acquisition');
  await page.getByRole('button',{name:'ახალი ძიება',exact:true}).click();
  await page.locator('textarea').waitFor();
  assert.equal(state.starts,0);assert.ok(!new URL(page.url()).searchParams.has('search'));
});

test('partial and empty results say so, without technical errors', opts, async (t) => {
  {
    const { page } = await boot(t, { lang: 'ka', resumeStatus: 'PARTIAL_COMPLETE' });
    await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
    await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
    const text = await page.textContent('main');
    assert.ok(text.includes('ძიება ნაწილობრივ დასრულდა'));
    assert.ok(text.includes('შედეგები უკვე მზადაა. რამდენიმე წყაროს შემოწმება ამჯერად ვერ მოხერხდა.'));
    assert.doesNotMatch(text, /TIMED_OUT|FAILED|Error/);
    await page.context().close();
  }
  {
    const { page } = await boot(t, { lang: 'ka', resumeStatus: 'COMPLETE', empty: true });
    await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mps-empty').waitFor({ timeout: 30000 });
    await page.getByRole('heading', { name: 'ზუსტი შესაბამისობა ჯერ ვერ ვიპოვეთ' }).waitFor({ timeout: 30000 });
    const text = await page.textContent('main');
    for (const s of ['ზუსტი შესაბამისობა ჯერ ვერ ვიპოვეთ', 'ფართობის შეცვლა', 'ბიუჯეტის შეცვლა']) assert.ok(text.includes(s), s);
    await shot(page, 'ka-1440-empty');
    await page.getByRole('button', { name: 'ბიუჯეტის შეცვლა', exact: true }).click();
    await page.getByRole('heading', { name: 'რა ფასის ფარგლებში ვეძებოთ?', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(new URL(page.url()).searchParams.has('search'), false, 'editing criteria stays in the builder');
  }
});

test('failed newest search leaves previous searches reachable in the dashboard', opts, async (t) => {
 const {page,state}=await boot(t,{lang:'en',resumeStatus:'FAILED',width:390});
 await page.goto(BASE+'/find-property');
 await page.getByRole('heading',{name:'Search history',exact:true}).waitFor();
 assert.equal(await page.locator('[data-property-key]').count(),0);
 const older='/find-property/search/22222222-2222-4222-8222-222222222222';
 await page.locator('a[href="'+older+'"]').click();
 await page.getByTestId('mps-total').waitFor();
 assert.equal(new URL(page.url()).pathname,older);
 assert.ok(state.requests.filter(r=>r.action==='status').every(r=>r.searchId==='22222222-2222-4222-8222-222222222222'));
 await page.goBack(); await page.getByRole('heading',{name:'Search history',exact:true}).waitFor();
 await page.locator('a[href="/find-property/new"]').click(); await page.locator('textarea').waitFor();
 assert.equal(state.starts,0); assert.ok(await overflow(page)<=1);
});

test('catalogue changes require explicit refresh; request failures retry without a false empty state', opts, async (t) => {
  const { page, state } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE' });
  await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111`);
  await page.locator('[data-property-key]').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.has('revision'));
  state.revision = 'changed-revision';
  await page.getByLabel('Sort', { exact: true }).selectOption('FRESHEST');
  await page.getByRole('button', { name: 'Refresh results', exact: true }).waitFor();
  assert.equal(await page.locator('#mps-empty').count(), 0);
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('revision') === 'changed-revision');
  assert.equal(new URL(page.url()).searchParams.get('fp_sort'), 'FRESHEST');
  state.browseFailure = true;
  await page.getByLabel('Sort', { exact: true }).selectOption('PRICE');
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(await page.locator('#mps-empty').count(), 0);
  state.browseFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('[data-property-key]').first().waitFor();
  const prices = await page.locator('[data-property-key]').evaluateAll((cards) => cards.map((card) => Number(card.querySelector('p.font-display')?.textContent?.replace(/[^\d.]/g, ''))));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'price sort remains ordered across section boundaries');
});

test('comparison: two properties side by side, factual rows, no winner', opts, async (t) => {
  const { page } = await boot(t, { lang: 'en', resumeStatus: 'COMPLETE' });
  await page.goto(`${BASE}/find-property/search/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
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

test('switch off: history remains reachable and new search uses the existing fallback', opts, async (t) => {
  const { page } = await boot(t, { lang: 'en', enabled: false });
  await page.goto(`${BASE}/find-property`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', {name:'Search history',exact:true}).waitFor();
  await page.locator('a[href="/find-property/new"]').click();
  await page.waitForSelector('textarea', { timeout: 30000 });
  assert.equal(await page.locator('#mps-mode-title').count(), 0);
});

test('375px, 390px, 768px, 1280px and 1440px, six locales: workspace, confirmation, results, filters and dedicated property page; RTL for ar/he', opts, async (t) => {
  const failures = [];
  for (const width of [1440, 1280, 768, 390, 375]) {
    for (const lang of LOCALES) {
      const { page, close } = await boot(t, { width, height: width < 700 ? 844 : 900, lang, timeline: ['COMPLETE'] });
      await toConfirm(page, `${lang}-${width}-mode`);
      if (await overflow(page) > 1) failures.push(`${lang} ${width}: confirm overflow`);
      const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
      if (['ar', 'he'].includes(lang) && dir !== 'rtl') failures.push(`${lang}: not RTL`);
      await page.locator('[data-action="mps-start"]').click();
      await page.locator('section[aria-labelledby="mps-g-BEST"] article').first().waitFor({ timeout: 30000 });
      if (await overflow(page) > 1) failures.push(`${lang} ${width}: results overflow ${await overflow(page)}px`);
      await shot(page, `${lang}-${width}-results`);
      await page.locator('details').filter({ has: page.locator('input[type="number"]') }).locator('summary').click();
      if (await overflow(page) > 1) failures.push(`${lang} ${width}: expanded filters overflow`);
      await shot(page, `${lang}-${width}-filters`);
      await page.locator('section[aria-labelledby="mps-g-BEST"]').locator('article').first().locator('button').first().click();
      await page.locator('#mps-listings').waitFor();
      const sheetOverflow = await page.locator('[data-property-dossier]').evaluate((el) => el.scrollWidth - el.clientWidth);
      if (sheetOverflow > 1) failures.push(`${lang} ${width}: property sheet overflow ${sheetOverflow}px`);
      await shot(page, `${lang}-${width}-property`);
      await close();
    }
  }
  assert.deepEqual(failures, []);
});
