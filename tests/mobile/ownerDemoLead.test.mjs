// HOMATCH LEADS — DEMO MODE is not customer-reachable (owner, 2026-10-24).
//
// The owner's brief for the matching workspace: "no visible demo-account upsells". The address
// Demo Mode used to open on, /property/:id/leads?demo=1, is now a legacy matching address:
// LegacyMatchingRedirect sends it to the workspace's Internal product
// (/property/:id/matches?product=internal), and OwnerDemoJourney is no longer routed anywhere a
// customer can reach. The simulated end-to-end journey this file used to drive (entry → guided
// walkthrough → unlock dialog labelled DEMO → fictional contact → CRM → simulated replies → offer
// → Email Studio draft → notifications → Reset / Exit) is RETIRED with it: it exercised a screen
// that no longer renders. The owner_demo_lead_* SQL stays proven by tests/sql/run-owner-demo-lead.sh.
//
// What still holds, in a real browser (harness build, workspace fixture):
//   * /property/:id/leads?demo=1 (and plain /leads) land on the workspace, Internal product,
//     with the demo parameter dropped;
//   * nothing simulated renders: no demo entry, no OwnerDemoJourney / demo-* testid, no DEMO
//     unlock badge, and no owner_demo_lead_* / demo_send_message call is made;
//   * the workspace shows its real rows at 390 and 1440 px in en / ka / he, with no horizontal
//     overflow, and he renders right-to-left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, noOverflow, PROPERTY_ID, shot, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

/* Unique within the mobile:discovery shard (node --test runs its files in parallel). */
const PORT = 4368;
const SHOTS = process.env.OWNER_DEMO_SHOTS || null;
const opts = testOptions();

/* Every marker OwnerDemoJourney, its entry card and the demo unlock dialog ever rendered. */
const DEMO_MARKERS = '[data-testid^="demo-"], [data-testid="owner-demo"], [data-testid="unlock-demo-badge"]';
const DEMO_CALLS = /\/rpc\/(owner_demo_lead_|demo_send_message)/;

async function landsOnWorkspace(page, BASE, path, label) {
  await page.goto(`${BASE}/property/${PROPERTY_ID}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="mw-page"]').waitFor({ timeout: 30000 });
  await waitRows(page);
  const u = new URL(page.url());
  assert.equal(u.pathname, `/property/${PROPERTY_ID}/matches`, `${label}: lands on the workspace`);
  assert.equal(u.searchParams.get('product'), 'internal', `${label}: the Internal product`);
  assert.equal(u.searchParams.get('demo'), null, `${label}: the demo parameter does not survive`);
  assert.equal(await page.locator('[data-testid="mw-page"]').getAttribute('data-product'), 'internal', `${label}: Internal is shown`);
  /* Give a late-mounting demo entry the chance to appear before asserting it did not. */
  await page.waitForTimeout(500);
  assert.equal(await page.locator(DEMO_MARKERS).count(), 0, `${label}: nothing simulated renders`);
}

test('/leads?demo=1 and /leads open the workspace (Internal); no demo entry, no simulated journey, no demo RPC', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT });
  const calls = [];
  page.on('request', (req) => calls.push(req.url()));
  for (const path of ['/leads?demo=1', '/leads']) await landsOnWorkspace(page, BASE, path, `en 1440 ${path}`);
  const text = (await page.locator('body').textContent()) ?? '';
  assert.doesNotMatch(text, /Demo Mode|test lead|simulated/i, 'no demo copy on the workspace');
  assert.deepEqual(calls.filter((u) => DEMO_CALLS.test(u)), [], 'no owner_demo_lead_* / demo_send_message call');
});

for (const lang of ['en', 'ka', 'he']) {
  test(`${lang}: /leads?demo=1 at 390 and 1440 — the workspace, nothing simulated, no horizontal overflow${lang === 'he' ? ', RTL' : ''}`, opts, async (t) => {
    const { page, BASE } = await boot(t, { port: PORT, width: 390, height: 844, lang });
    const calls = [];
    page.on('request', (req) => calls.push(req.url()));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
      await landsOnWorkspace(page, BASE, '/leads?demo=1', `${lang} ${width}`);
      await noOverflow(page, `${lang} ${width}`);
      if (lang === 'he') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      await shot(page, SHOTS, `demo-redirect-${lang}-${width}`);
    }
    assert.deepEqual(calls.filter((u) => DEMO_CALLS.test(u)), [], 'no owner_demo_lead_* / demo_send_message call');
  });
}
