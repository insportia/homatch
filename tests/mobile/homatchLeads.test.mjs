// HOMATCH LEADS — the internal marketplace, now inside the matching workspace.
//
// The standalone "Your Matching Buyers" screen (/property/:id/leads) was retired into
// /property/:id/matches?product=internal (owner, 2026-10-24). Its guarantees, on the workspace
// (fixtures: tests/mobile/matchingWorkspaceFixture.mjs, shaped like the SQL):
//   * the old address lands on HOMATCH Internal;
//   * no identity before an unlock (no name, phone or email anywhere in the DOM);
//   * unlocking one contact: the server quote, confirmed once, sent once to atomic-unlock as
//     kind=internal_leads with an ilu: idempotency key; after it the member's permitted
//     contact is shown in Unlocked Leads;
//   * Bulk unlock: two members quoted together, a double click charges once;
//   * 320 → 1280 px, en / ka / ar / he: no horizontal overflow, RTL flips, 44px targets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, noOverflow, openWorkspace, PROPERTY_ID, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

/* Unique within the mobile:discovery shard (node --test runs its files in parallel). */
const PORT = 4367;
const opts = testOptions();
const quoteText = (page) => page.locator('[data-testid="mw-quote"]').textContent();

test('the old address lands on HOMATCH Internal; nothing identifying before an unlock', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT });
  await page.goto(`${BASE}/property/${PROPERTY_ID}/leads`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => new URL(u).pathname.endsWith('/matches'), { timeout: 30000 });
  await waitRows(page, 3);
  assert.equal(new URL(page.url()).searchParams.get('product'), 'internal');
  assert.equal(await page.locator('[data-testid="mw-list"]').getAttribute('data-product'), 'internal');
  assert.doesNotMatch(await page.content(), /Member \d|\+995555000111/, 'no identity before unlock');
  await noOverflow(page, 'en 1440');
});

test('unlock one contact: quoted, confirmed once, one ilu: request; the permitted phone appears in Unlocked Leads', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  await page.locator('[data-testid="mw-row-check"]').nth(2).check();
  await page.waitForFunction(() => /1 new · 3 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm"]').click();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  assert.equal(state.unlockCalls.length, 1, 'one charge request');
  assert.equal(state.unlockCalls[0].kind, 'internal_leads');
  assert.match(state.unlockCalls[0].idempotencyKey, /^ilu:/);
  assert.equal(state.balance, 497);
  await openWorkspace(page, BASE, '?view=unlocked&product=internal');
  await waitRows(page, 1);
  await page.locator('[data-testid="mw-internal-contact-open"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mw-internal-contact"]')?.textContent?.includes('+995555000111'));
});

test('bulk unlock: two members quoted together (10 + 5 = 15, one price each); a double click charges once', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, width: 390, height: 844 });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  await page.locator('[data-testid="mw-row-check"]').nth(0).check();
  await page.locator('[data-testid="mw-row-check"]').nth(1).check();
  await page.waitForFunction(() => /2 new · 15 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  assert.match(await quoteText(page), /Balance: 500 credits/);
  await noOverflow(page, 'bulk bar 390');
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm"]').dblclick();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  assert.equal(new Set(state.unlockCalls.map((c) => c.idempotencyKey)).size, 1, 'one idempotency key for the confirmation');
  assert.equal(state.balance, 485, 'charged 15 once');
});

for (const lang of ['en', 'ka', 'ar', 'he']) {
  test(`${lang}: 320 · 360 · 390 · 430 · 768 · 1024 · 1280 — no horizontal overflow${['ar', 'he'].includes(lang) ? ', RTL' : ''}`, opts, async (t) => {
    const { page, BASE } = await boot(t, { port: PORT, width: 320, height: 900, lang });
    for (const width of [320, 360, 390, 430, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openWorkspace(page, BASE, '?product=internal');
      await waitRows(page, 3);
      await noOverflow(page, `${lang} ${width}`);
      if (['ar', 'he'].includes(lang)) assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      const box = await page.locator('[data-testid="mw-row-check"]').first().boundingBox();
      assert.ok(box && box.height >= 44, `${lang} ${width}: selection target ≥ 44px tall`);
    }
  });
}
