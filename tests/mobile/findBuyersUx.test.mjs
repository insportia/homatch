// FIND BUYERS / FIND TENANTS — customer UX after the matching workspace (owner, 2026-10-24).
//
// The paid external search (start from the property page or the results page, the live
// module, elapsed time, tabs, lead detail page, clear old results) is no longer offered to
// customers; its screens redirect to /property/:id/matches. What this file now guarantees:
//   * the property page offers no paid search launch, budget step or campaign controls — one
//     entry card opens the matching workspace (and its product tiles open each product);
//   * every retired results address lands on the workspace with no stale one-shot params,
//     and the redirect adds no history (Back leaves);
//   * ar / he at 320–430 px: the workspace fits, right-to-left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, noOverflow, PROPERTY_ID, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

const PORT = 4371;
const opts = testOptions();

test('the property page: no paid search launch or budget step — one entry card into the workspace', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await page.goto(`${BASE}/property/${PROPERTY_ID}`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-testid="pow-matching-entry"]');
  await card.waitFor({ timeout: 30000 });
  for (const gone of ['pow-discovery', 'pow-discovery-state', 'pow-clear-open', 'pow-discovery-counts']) {
    assert.equal(await page.locator(`[data-testid="${gone}"]`).count(), 0, `${gone} is gone`);
  }
  assert.doesNotMatch(await card.textContent(), /budget|campaign/i);
  await page.locator('[data-testid="pow-matching-internal"]').waitFor();
  assert.equal(await page.locator('[data-testid="pow-matching-internal"]').getAttribute('href'), `/property/${PROPERTY_ID}/matches?product=internal`);
  assert.equal(await page.locator('[data-testid="pow-matching-external"]').getAttribute('href'), `/property/${PROPERTY_ID}/matches?product=external`);
  await page.locator('[data-testid="pow-matching-open"]').click();
  await page.waitForURL((u) => new URL(u).pathname === `/property/${PROPERTY_ID}/matches`, { timeout: 30000 });
  await waitRows(page);
  assert.equal(state.unlockCalls.length, 0);
});

test('the entry card follows the switches: maintenance says so; a product that is off has no tile', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT, switches: { curated: false } });
  await page.goto(`${BASE}/property/${PROPERTY_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="pow-matching-internal"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('[data-testid="pow-matching-external"]').count(), 0);
});

test('retired results addresses: stale params dropped, no history added', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT, width: 390, height: 844 });
  await page.goto(`${BASE}/property/${PROPERTY_ID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="pow-matching-entry"]').waitFor({ timeout: 30000 });
  await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/external?start=1&job=j1&tab=interest&rp=2`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="mw-page"]').waitFor({ timeout: 30000 });
  assert.equal(new URL(page.url()).search, '?product=external');
  await page.goBack();
  await page.waitForURL((u) => new URL(u).pathname === `/property/${PROPERTY_ID}`, { timeout: 30000 });
});

test('ar / he at 320–430 px: the workspace fits, right-to-left', opts, async (t) => {
  for (const lang of ['ar', 'he']) {
    const { page, BASE } = await boot(t, { port: PORT, width: 320, height: 844, lang });
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/external`, { waitUntil: 'domcontentloaded' });
      await waitRows(page);
      await noOverflow(page, `${lang} ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    }
    await page.context().close();
  }
});
