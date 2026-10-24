// FIND BUYERS 2.0 — SMART INTERNAL MATCH EXPANSION, inside the matching workspace.
//
// The standalone leads screen was retired into /property/:id/matches?product=internal
// (owner, 2026-10-24); the reach controls stay in the matching engine, untouched. What still
// holds, with fixtures shaped like the SQL:
//   * three categories, one person in one — VIP, Exact, Nearby or similar — with the server's
//     three prices (10 / 5 / 3 credits), and the category is a server-side filter;
//   * the quote prices each person once at their own key (never stacked: VIP + Exact = 15);
//   * every row says why it matched, with no identity before an unlock;
//   * 390 px ka / ar / he: no horizontal overflow, RTL flips, no raw keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, noOverflow, openWorkspace, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

/* Unique within the mobile:discovery shard. */
const PORT = 4381;
const opts = testOptions();

test('1440 (en): three categories, three prices, one per person; the category filter is the server\'s', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  const prices = await page.locator('[data-testid="mw-internal-prices"] [data-price]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-price')}:${e.textContent}`));
  assert.match(prices.join(' | '), /EXACT:.*5 credits \| NEARBY_SIMILAR:.*3 credits \| VIP:.*10 credits/);
  const rows = await page.locator('[data-testid="mw-row-price"]').allTextContents();
  assert.deepEqual(rows.map((x) => x.trim()), ['10 credits', '5 credits', '3 credits'], 'one price per person');
  const summaries = await page.locator('[data-testid="mw-row-summary"]').allTextContents();
  assert.ok(summaries.every((s) => /Looking for/.test(s)), 'every row says what the member is looking for');

  await page.locator('[data-testid="mw-more-filters"]').click();
  await page.locator('[data-criterion="VIP"]').click();
  await page.waitForFunction(() => /f=VIP/.test(location.search));
  await waitRows(page, 1);
  assert.ok(state.internalFeedCalls.at(-1).filters.includes('VIP'));
  assert.ok(state.internalFeedCalls.at(-1).filters.includes('LOCKED'));
  /* One choice per group: Exact replaces VIP. */
  await page.locator('[data-criterion="EXACT"]').click();
  await page.waitForFunction(() => /f=EXACT/.test(location.search) && !/VIP/.test(location.search));
});

test('the quote prices each person once at their own key: VIP + Exact = 15, never stacked', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  await page.locator('[data-testid="mw-row-check"]').nth(0).check();
  await page.locator('[data-testid="mw-row-check"]').nth(1).check();
  await page.waitForFunction(() => /2 new · 15 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  assert.equal(state.internalQuoteCalls.at(-1).length, 2);
});

for (const lang of ['ka', 'ar', 'he']) {
  test(`390 px (${lang}): categories, reasons and filters fit; ${lang === 'ka' ? 'LTR' : 'RTL'}; no raw keys`, opts, async (t) => {
    const { page, BASE } = await boot(t, { port: PORT, width: 390, height: 844, lang });
    await openWorkspace(page, BASE, '?product=internal');
    await waitRows(page, 3);
    await page.locator('[data-testid="mw-more-filters"]').click();
    await noOverflow(page, `${lang} 390`);
    assert.equal(await page.evaluate(() => document.documentElement.dir), lang === 'ka' ? 'ltr' : 'rtl');
    assert.doesNotMatch(await page.locator('[data-testid="mw-page"]').textContent(), /\bmw_|\bhl_|undefined|NaN/);
    assert.doesNotMatch(await page.content(), /Member \d|\+995555000111/, 'no identity before unlock');
  });
}
