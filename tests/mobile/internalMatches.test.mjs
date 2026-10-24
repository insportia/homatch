// HOMATCH INTERNAL MATCHES — now a product of the matching workspace.
//
// The old Matches page (/property/:id/buyers/internal) — internal members and external leads
// as two sections, the admin-only demo card — was retired into /property/:id/matches
// (owner, 2026-10-24); the demo journey keeps its own test (ownerDemoLead.test.mjs). What
// still holds, on the workspace:
//   * the old address (and ?filter=UNLOCKED) lands on HOMATCH Internal (Available / Unlocked);
//   * internal members and external leads are two products with two counts, never one list:
//     the Internal list holds members only, the External list leads only;
//   * phone 390 (he, RTL) and 360: no horizontal scroll.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, noOverflow, openWorkspace, PROPERTY_ID, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

/* Unique within the mobile:discovery shard — 4361 belongs to findPropertyMarketplace. */
const PORT = 4366;
const opts = testOptions();

test('the old address lands on HOMATCH Internal, Available and (with ?filter=UNLOCKED) Unlocked', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT });
  for (const [search, view] of [['', null], ['?filter=UNLOCKED', 'unlocked']]) {
    await page.goto(`${BASE}/property/${PROPERTY_ID}/buyers/internal${search}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="mw-page"]').waitFor({ timeout: 30000 });
    const u = new URL(page.url());
    assert.equal(u.pathname, `/property/${PROPERTY_ID}/matches`);
    assert.equal(u.searchParams.get('product'), 'internal');
    assert.equal(u.searchParams.get('view'), view);
  }
});

test('two products, two counts, never one list', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  assert.equal(await page.locator('[data-testid="mw-product-internal"] [data-count]').getAttribute('data-count'), '3');
  assert.equal(await page.locator('[data-testid="mw-product-external"] [data-count]').getAttribute('data-count'), '635');
  const internalIds = await page.locator('[data-testid="mw-row"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id')));
  assert.ok(internalIds.every((id) => id.startsWith('aaaaaaaa')), 'members only');
  await page.locator('[data-testid="mw-product-external"]').click();
  await waitRows(page, 100);
  const externalIds = await page.locator('[data-testid="mw-row"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id')));
  assert.ok(externalIds.every((id) => id.startsWith('cccccccc')), 'leads only');
});

for (const [width, lang] of [[390, 'he'], [360, 'en']]) {
  test(`phone ${width} (${lang}): Internal Available and Unlocked never scroll sideways${lang === 'he' ? ', RTL' : ''}`, opts, async (t) => {
    const { page, BASE } = await boot(t, { port: PORT, width, height: 844, lang });
    for (const view of ['available', 'unlocked']) {
      await openWorkspace(page, BASE, `?product=internal&view=${view}`);
      if (view === 'available') await waitRows(page, 3);
      else await page.locator('[data-testid="mw-library-actions"]').waitFor();
      await noOverflow(page, `${lang} ${width} ${view}`);
      if (lang === 'he') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    }
  });
}
