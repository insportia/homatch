// THE MATCHING WORKSPACE — /property/:id/matches, in a real browser (harness build).
//
// Fixtures shaped like the SQL (tests/mobile/matchingWorkspaceFixture.mjs):
//   * Available and Unlocked are separate views; HOMATCH Internal and the External Leads
//     Database are separate products, each with live counts;
//   * External: 100 rows by default, 200 on request, numbered pages kept in the URL; masked
//     names and no contact details before an unlock;
//   * select a page, then everything matching the filters — the quote and the unlock send
//     allMatching + filters (never a list of the database); the quote names the leads already
//     unlocked (not charged again); the unlock is sent once, with expectedCredits and one
//     idempotency key; purchased leads leave Available and appear in Unlocked; the CTA opens
//     /outreach/email?new=1&list=…; nothing is sent;
//   * Internal: the server's 3 / 5 / 10 prices, one per person; quote → one unlock;
//   * every switch combination; maintenance shows the owner's Georgian copy verbatim with the
//     CTA to /find-property; switches re-read on focus;
//   * the retired addresses land here with the right product;
//   * 360 / 390 / 768 / 1024 / 1440 without horizontal overflow; ar / he right-to-left.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, internalItems, mortgageItem, mortgageMatchItem, noOverflow, openWorkspace, PROPERTY_ID, shot, testOptions, waitRows } from './matchingWorkspaceFixture.mjs';

/* Unique within the mobile:discovery shard (node --test runs its files in parallel). */
const PORT = 4397;
const SHOTS = process.env.MATCHING_WORKSPACE_SHOTS || null;
const opts = testOptions();

const KA_MAINTENANCE = [
  'სერვისი მალე ჩაირთვება',
  'თქვენი უძრავი ქონებისთვის ზუსტი დამთხვევები მალე ხელმისაწვდომი იქნება',
  'ამჟამად HOMATCH ახორციელებს არსებული მონაცემებისა და ტრაფიკის გადახარისხებას, რათა სერვისის ამოქმედებისას უზრუნველყოს მაღალი ხარისხის, რეალურ ინტერესებზე დაფუძნებული მყიდველებისა და მოიჯარეების დამთხვევები.',
  'მანამდე აღმოაჩინეთ HOMATCH-ის ქონების ძიება',
  'იპოვეთ სასურველი უძრავი ქონება სხვადასხვა ვებსაიტზე ერთდროულად, ერთი მოთხოვნით, უნიკალური ფილტრებითა და ინდივიდუალური ძიების შესაძლებლობებით.',
  'უძრავი ქონების ძიებაზე გადასვლა',
];

/* textContent, not innerText: CSS upper-casing and off-screen rows (content-visibility) must not change what is asserted. */
const text = async (page, sel) => (await page.locator(sel).first().textContent()) ?? '';
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail(`timed out: ${label}`);
}
const count = async (page, sel) => Number(await page.locator(sel).first().getAttribute('data-count'));

test('1440 (en): Available | Unlocked and Internal | External, live counts, 100 masked rows, page size 200, numbered pages in the URL', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=external');
  await waitRows(page, 100);
  assert.match(await text(page, '[data-testid="mw-page"] h1'), /3-room apartment, Krtsanisi St 6/, 'the property is named');
  assert.equal(await count(page, '[data-testid="mw-view-available"] [data-count]'), 635 + 2 + 1, 'available = 635 external + 3 internal');
  assert.equal(await count(page, '[data-testid="mw-view-unlocked"] [data-count]'), 5);
  assert.equal(await count(page, '[data-testid="mw-product-external"] [data-count]'), 635);
  assert.equal(await count(page, '[data-testid="mw-product-internal"] [data-count]'), 3);
  assert.match(await text(page, '[data-testid="mw-range"]'), /Showing 1–100 of 635/);
  /* Masked: "Anna Z." — never a surname, email or phone before an unlock. */
  const html = await page.locator('[data-testid="mw-list"]').innerHTML();
  assert.match(html, /Anna Z\./);
  assert.doesNotMatch(html, /Zeta\d|@leads\.example|\+4915100/);
  assert.match(await text(page, '[data-testid="mw-row-price"]'), /1 credit\s*\$0\.10/);
  assert.match(await text(page, '[data-testid="mw-row-summary"]'), /from|Potential|Prospective/);
  assert.match(await text(page, '[data-testid="mw-consent-note"]'), /lawful basis/);
  await noOverflow(page, 'en 1440');
  await shot(page, SHOTS, 'mw-external-en-1440');

  await page.locator('[data-testid="mw-page-size"]').selectOption('200');
  await waitRows(page, 200);
  assert.match(page.url(), /size=200/);
  assert.equal(state.catalogCalls.at(-1).pageSize, '200');
  await page.locator('[data-testid="mw-pagination"] [data-page="2"]').click();
  await until(() => state.catalogCalls.some((c) => c.view === 'AVAILABLE' && c.page === 2 && c.pageSize === '200'), 'page 2 is a server request');
  await page.waitForFunction(() => /Showing 201–400/.test(document.querySelector('[data-testid="mw-range"]')?.textContent ?? ''));
  assert.match(page.url(), /page=2/);
  /* Refresh-safe: the same view, product, size and page come back from the URL. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitRows(page, 200);
  assert.match(await text(page, '[data-testid="mw-range"]'), /Showing 201–400 of 635/);
});

test('filters are server-side and in the URL: country (Georgian or English name), language incl. Unknown, interest; chips and clear all', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, lang: 'ka' });
  await openWorkspace(page, BASE, '?product=external');
  await waitRows(page);
  await page.locator('[data-testid="mw-country"]').click();
  await page.locator('[data-testid="mw-country-search"]').fill('Germany');
  await page.locator('[data-testid="mw-country-panel"] [data-option="DE"]').click();
  /* The UI-language name (Georgian where the runtime has the data; headless shells may fall back). */
  const kaName = await page.evaluate(() => new Intl.DisplayNames(['ka-GE'], { type: 'region' }).of('AE'));
  await page.locator('[data-testid="mw-country-search"]').fill(kaName.split(' ')[0]);
  await page.locator('[data-testid="mw-country-panel"] [data-option="AE"]').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => /country=DE%2CAE|country=DE,AE/.test(location.search));
  await until(() => JSON.stringify(state.catalogCalls.at(-1)?.filters?.countries) === '["DE","AE"]', 'countries sent to the server');
  await page.locator('[data-testid="mw-language"]').click();
  await page.locator('[data-testid="mw-language-panel"] [data-option="unknown"]').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-interest="RENT"]').click();
  await page.waitForFunction(() => /interest=RENT/.test(location.search));
  await until(() => JSON.stringify(state.catalogCalls.at(-1)?.filters?.interests) === '["RENT"]', 'interest sent to the server');
  const last = state.catalogCalls.at(-1).filters;
  assert.deepEqual(last.languages, ['unknown']);
  assert.deepEqual(last.countries, ['DE', 'AE']);
  assert.ok(await page.locator('[data-testid="mw-filter-chips"] [data-chip]').count() >= 4);
  await page.locator('[data-testid="mw-clear-all"]').click();
  await page.waitForFunction(() => !/country=|interest=|lang=/.test(location.search));
  await until(() => JSON.stringify(state.catalogCalls.at(-1)?.filters) === '{}', 'cleared filters reach the server');
});

test('select a page, then all matching: the quote sends allMatching + filters (no ids), names 5 already unlocked; one unlock with expectedCredits and one key', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=external');
  await waitRows(page, 100);
  await page.locator('[data-testid="mw-select-page"]').check();
  const bar = page.locator('[data-testid="mw-selection-bar"]');
  await bar.waitFor();
  assert.match(await text(page, '[data-testid="mw-selected-count"]'), /100 selected/);
  await page.waitForFunction(() => /100 new · 100 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  assert.equal(state.quoteCalls.at(-1).ids.length, 100);

  await page.locator('[data-testid="mw-select-all-matching"]').click();
  await page.waitForFunction(() => /635 selected/.test(document.querySelector('[data-testid="mw-selected-count"]')?.textContent ?? ''));
  /* "All matching" covers every published lead for the filters, the 5 already owned too: named, not charged. */
  await page.waitForFunction(() => /5 already unlocked — not charged again/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  const q = state.quoteCalls.at(-1);
  assert.equal(q.allMatching, true);
  assert.deepEqual(q.filters, {});
  assert.equal(q.ids, undefined, 'never a list of the database');
  /* Deselect one row → it becomes an exclusion. */
  await page.locator('[data-testid="mw-row-check"]').nth(3).uncheck();
  await page.waitForFunction(() => /634 selected/.test(document.querySelector('[data-testid="mw-selected-count"]')?.textContent ?? ''));
  await page.waitForFunction(() => /634 new · 634 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  assert.equal(state.quoteCalls.at(-1).exclude.length, 1);
  await noOverflow(page, 'selection bar 1440');
  await shot(page, SHOTS, 'mw-selection-1440', false);

  await page.locator('[data-testid="mw-unlock"]').click();
  const dialog = page.locator('[data-testid="mw-confirm-dialog"]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /634 credits[\s\S]*\$63\.40/);
  assert.match(await dialog.textContent(), /Already unlocked — not charged again\s*5/);
  await shot(page, SHOTS, 'mw-confirm-1440', false);
  /* 634 credits against a 500-credit balance: said before the click, with the way to add credits… */
  assert.equal(await dialog.locator('[data-testid="mw-confirm-over-balance"] a[href="/credits"]').count(), 1);
  /* …and refused by the server if confirmed anyway, charging nothing. */
  await page.locator('[data-testid="mw-confirm"]').click();
  const err = page.locator('[data-testid="mw-confirm-error"]');
  await err.waitFor({ timeout: 15000 });
  assert.equal(await err.getAttribute('data-code'), 'INSUFFICIENT_CREDITS');
  assert.equal(await err.locator('a[href="/credits"]').count(), 1);
  /* Credits added elsewhere; retrying the SAME confirmation reuses its key, and a double click charges once. */
  state.balance = 2000;
  await page.locator('[data-testid="mw-confirm"]').dblclick();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  const calls = state.unlockCalls.filter((c) => c.kind === 'curated_leads');
  assert.equal(new Set(calls.map((c) => c.idempotencyKey)).size, 1, 'one idempotency key for the confirmation and its retry');
  assert.match(calls[0].idempotencyKey, /^clu:/);
  assert.equal(calls[0].expectedCredits, 634);
  assert.equal(calls[0].allMatching, true);
  assert.equal(calls[0].ids, undefined);
  assert.equal(state.balance, 2000 - 634, 'charged once');
});

test('a purchase leaves Available, appears in Unlocked, and the CTA opens the campaign screen on the list (nothing sent)', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?product=external&country=DE');
  await waitRows(page);
  const before = await page.locator('[data-testid="mw-row"]').count();
  const ids = await page.locator('[data-testid="mw-row"]').evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute('data-id')));
  for (let i = 0; i < 3; i += 1) await page.locator('[data-testid="mw-row-check"]').nth(i).check();
  await page.waitForFunction(() => /3 new · 3 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm"]').click();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  assert.equal(state.unlockCalls.length, 1);
  assert.deepEqual(state.unlockCalls[0].ids, ids);
  assert.equal(state.unlockCalls[0].expectedCredits, 3);
  await waitRows(page, before - 3);
  for (const id of ids) assert.equal(await page.locator(`[data-testid="mw-row"][data-id="${id}"]`).count(), 0, 'purchased rows leave Available');
  assert.match(await text(page, '[data-testid="mw-success"]'), /3 contacts unlocked[\s\S]*3 credits charged[\s\S]*Nothing has been sent/);
  assert.equal(await count(page, '[data-testid="mw-view-unlocked"] [data-count]'), 8);
  await shot(page, SHOTS, 'mw-success-1440', false);

  await page.locator('[data-testid="mw-view-unlocked"]').click();
  await page.waitForFunction(() => /view=unlocked/.test(location.search));
  await waitRows(page);
  for (const id of ids) await page.locator(`[data-testid="mw-row"][data-id="${id}"]`).waitFor();
  assert.match(await page.locator('[data-testid="mw-list"]').textContent(), /@leads\.example/, 'full details once unlocked');
  assert.equal(await page.locator('[data-testid="mw-unlock"]').count(), 0, 'no unlock inside the library');
  await shot(page, SHOTS, 'mw-unlocked-1440');

  await page.locator('[data-testid="mw-view-available"]').click();
  await page.locator('[data-testid="mw-success"]').waitFor();
  await page.locator('[data-testid="mw-create-campaign"]').click();
  await page.waitForURL(/\/outreach\/email\?/);
  const u = new URL(page.url());
  assert.equal(u.searchParams.get('new'), '1');
  assert.equal(u.searchParams.get('list'), 'list-curated-standing');
  assert.equal(u.searchParams.get('property'), PROPERTY_ID);
});

test('the Unlocked library: select, Create Email Campaign → save to list → campaign screen; never a charge', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT });
  await openWorkspace(page, BASE, '?view=unlocked&product=external');
  await waitRows(page, 5);
  await page.locator('[data-testid="mw-select-page"]').check();
  await page.locator('[data-testid="mw-library-campaign"]').click();
  await page.waitForURL(/\/outreach\/email\?/);
  assert.equal(state.saveCalls.length, 1);
  assert.equal(state.saveCalls[0].kind, 'curated');
  assert.equal(state.saveCalls[0].p_lead_ids.length, 5);
  assert.equal(new URL(page.url()).searchParams.get('list'), 'list-curated-saved');
  assert.equal(state.unlockCalls.length, 0);
  assert.equal(state.quoteCalls.length, 0, 'no quote in the library');
});

test('HOMATCH Internal: prices 10 / 5 / 3 from the server, one per person; quote → one unlock (ilu:) → list → campaign', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, width: 390, height: 844 });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  const prices = await page.locator('[data-testid="mw-row-price"]').allTextContents();
  assert.deepEqual(prices.map((p) => p.trim()), ['10 credits', '5 credits', '3 credits']);
  assert.match(await text(page, '[data-testid="mw-internal-prices"]'), /Exact[\s\S]*5 credits[\s\S]*Nearby[\s\S]*3 credits[\s\S]*VIP[\s\S]*10 credits/);
  assert.doesNotMatch(await page.locator('[data-testid="mw-list"]').textContent(), /\+995|Member \d/, 'no identity before unlock');
  await page.locator('[data-testid="mw-row-check"]').nth(0).check();
  await page.locator('[data-testid="mw-row-check"]').nth(2).check();
  await page.waitForFunction(() => /2 new · 13 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  await noOverflow(page, 'internal 390 with bar');
  await shot(page, SHOTS, 'mw-internal-390');
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm"]').dblclick();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  assert.equal(state.unlockCalls.length >= 1, true);
  assert.equal(new Set(state.unlockCalls.map((c) => c.idempotencyKey)).size, 1);
  assert.equal(state.unlockCalls[0].kind, 'internal_leads');
  assert.match(state.unlockCalls[0].idempotencyKey, /^ilu:/);
  assert.equal(state.balance, 487, 'charged 13 once');
  await waitRows(page, 1);
  await page.locator('[data-testid="mw-create-campaign"]').click();
  await page.waitForURL(/\/outreach\/email\?/);
  assert.equal(state.saveCalls[0].kind, 'internal');
  assert.equal(state.saveCalls[0].p_match_ids.length, 2);
});

test('Home Financing opt-ins in Matching: beside the others, origin and signals, 3 credits, quote line, one unlock, contact', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, width: 390, height: 844, internal: [...internalItems(), mortgageItem()] });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 4);
  const row = page.locator('[data-testid="mw-row"]').filter({ has: page.locator('[data-testid="lead-origin-mortgage"]') });
  assert.equal(await row.count(), 1, 'one member, marked by origin');
  assert.match(await row.textContent(), /Mortgage interest/);
  assert.match(await row.locator('[data-testid="lead-mortgage-signals"]').textContent(), /Calculated a mortgage for this listing[\s\S]*several times/);
  assert.equal((await row.locator('[data-testid="mw-row-price"]').textContent()).trim(), '3 credits');
  assert.doesNotMatch(await row.textContent(), /income|salary|debt|\+995/i, 'no finances, no identity before unlock');
  assert.match(await text(page, '[data-testid="mw-internal-prices"]'), /Mortgage interest[\s\S]*3 credits/);
  await row.locator('[data-testid="mw-row-check"]').check();
  await page.waitForFunction(() => /1 new · 3 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  await noOverflow(page, 'internal 390 with a mortgage-origin member');
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm"]').dblclick();
  await page.locator('[data-testid="mw-success"]').waitFor({ timeout: 15000 });
  assert.equal(new Set(state.unlockCalls.map((c) => c.idempotencyKey)).size, 1, 'one unlock, one key');
  assert.equal(state.unlockCalls[0].kind, 'internal_leads', 'the existing Matching unlock, not a mortgage one');
  assert.equal(state.balance, 497, 'charged 3 once');
});

test('value-based price: mortgage + matching search is 5 with both reasons; a price raised after the quote is re-quoted, never charged', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, width: 390, height: 844, internal: [...internalItems(), mortgageItem(), mortgageMatchItem()] });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 5);
  const row = page.locator('[data-testid="mw-row"][data-id="' + mortgageMatchItem().matchId + '"]');
  assert.equal((await row.locator('[data-testid="mw-row-price"]').textContent()).trim(), '5 credits');
  assert.match(await row.locator('[data-testid="lead-price-reasons"]').textContent(), /Why 5 credits:[\s\S]*calculated a mortgage for a listing on HOMATCH[\s\S]*matches this listing exactly/);
  assert.match(await text(page, '[data-testid="mw-internal-prices"]'), /Mortgage and search[\s\S]*5 credits/);
  await row.locator('[data-testid="mw-row-check"]').check();
  await page.waitForFunction(() => /1 new · 5 credits/.test(document.querySelector('[data-testid="mw-quote"]')?.textContent ?? ''));
  await page.locator('[data-testid="mw-unlock"]').click();
  await page.locator('[data-testid="mw-confirm-line-MORTGAGE_MATCH"]').waitFor();
  assert.match(await text(page, '[data-testid="mw-confirm-line-MORTGAGE_MATCH"]'), /Mortgage interest and a matching search × 1/);
  /* New evidence after the quote: the server's price rises to 8; the confirmed 5 is refused, nothing charged. */
  state.internal.find((x) => x.matchId === mortgageMatchItem().matchId).priceCredits = 8;
  await page.locator('[data-testid="mw-confirm"]').click();
  await page.locator('[data-testid="mw-confirm-error"][data-code="PRICE_CHANGED"]').waitFor({ timeout: 15000 });
  assert.equal(state.unlockCalls.at(-1).expectedCredits, 5, 'the confirmed total travels with the unlock');
  assert.equal(state.balance, 500, 'nothing charged');
  assert.equal(await page.locator('[data-testid="mw-requote"]').count(), 1, 'a fresh quote is one click away');
});

test('switches: internal only, curated only, both off (library only), library hidden, nothing at all', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, switches: { curated: false } });
  /* Internal only: no External catalog, prices or promo in Available; its Unlocked list stays. */
  await openWorkspace(page, BASE, '?product=external');
  await waitRows(page);
  assert.equal(await page.locator('[data-testid="mw-product-external"]').count(), 0);
  assert.equal(await page.locator('[data-testid="mw-page"]').getAttribute('data-product'), 'internal');
  assert.equal(await page.locator('[data-testid="mw-promo"][data-product="external"]').count(), 0);
  await page.locator('[data-testid="mw-view-unlocked"]').click();
  await page.locator('[data-testid="mw-product-external"]').waitFor();

  /* Curated only. */
  state.switches = { maintenance: false, internal: false, curated: true, unlockedLibrary: true };
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page);
  assert.equal(await page.locator('[data-testid="mw-product-internal"]').count(), 0);
  assert.equal(await page.locator('[data-testid="mw-page"]').getAttribute('data-product'), 'external');

  /* Both products off, library visible: Unlocked only. */
  state.switches = { maintenance: false, internal: false, curated: false, unlockedLibrary: true };
  await openWorkspace(page, BASE);
  await page.locator('[data-testid="mw-view-single"][data-view="unlocked"]').waitFor();
  assert.equal(await page.locator('[data-testid="mw-view"]').count(), 0);
  assert.equal(await page.locator('[data-testid="mw-promo"]').count(), 0);

  /* Library hidden (products on): no Unlocked entry; the secure alternative link instead. */
  state.switches = { maintenance: false, internal: true, curated: true, unlockedLibrary: false };
  await openWorkspace(page, BASE, '?view=unlocked&product=external');
  await waitRows(page);
  assert.equal(await page.locator('[data-testid="mw-view-unlocked"]').count(), 0);
  assert.equal(await page.locator('[data-testid="mw-page"]').getAttribute('data-view'), 'available');
  assert.equal(await page.locator('[data-testid="mw-library-alt-curated"]').getAttribute('href'), '/outreach/contacts?source=CURATED_LEAD');
  assert.equal(await page.locator('[data-testid="mw-library-alt-internal"]').getAttribute('href'), '/outreach/contacts?source=INTERNAL_MATCH');

  /* Nothing at all: a calm state with the same link. */
  state.switches = { maintenance: false, internal: false, curated: false, unlockedLibrary: false };
  await openWorkspace(page, BASE);
  await page.locator('[data-testid="mw-empty-marketplace"]').waitFor();
  assert.equal(await page.locator('[data-testid="mw-library-alt-curated"]').count(), 1);
  assert.equal(await page.locator('[data-testid="mw-row"]').count(), 0);
  await shot(page, SHOTS, 'mw-nothing-1440');

  /* A stale tab corrects itself when it regains focus. */
  state.switches = { maintenance: false, internal: true, curated: true, unlockedLibrary: true };
  await openWorkspace(page, BASE, '?product=external');
  await waitRows(page);
  state.switches = { ...state.switches, curated: false };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-testid="mw-product-external"]').waitFor({ state: 'detached', timeout: 15000 });
});

/* Words that the browser split across two lines (one Range per word → more than one line box). */
async function brokenWords(page, sel) {
  return page.locator(sel).evaluateAll((els) => {
    const out = [];
    for (const el of els) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const m of node.data.matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top)));
          if (tops.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  });
}

test('Georgian at 320 / 360: tabs and internal prices never cut a word; the internal intro says it is this property, kept up to date', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT, width: 360, height: 800, lang: 'ka' });
  await openWorkspace(page, BASE, '?product=internal');
  await waitRows(page, 3);
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const sel of ['[data-testid="mw-view"] [role="tab"]', '[data-testid="mw-product"] [role="tab"]', '[data-testid="mw-internal-prices"] [data-price]']) {
      assert.deepEqual(await brokenWords(page, sel), [], `${width}px ${sel}: no word split across lines`);
    }
  }
  assert.match(await text(page, '[data-testid="mw-promo"] h2'), /ამ ქონების დამთხვევები/);
  assert.match(await text(page, '[data-testid="mw-internal-live"]'), /მუდმივად ახლდება[\s\S]*აქტიურია[\s\S]*დაემატება/);
  await noOverflow(page, 'internal ka 360');
  await shot(page, SHOTS, 'mw-internal-ka-360');
});

test('maintenance (ka): the owner’s Georgian copy, verbatim and in order; the CTA opens /find-property; no list, no prices', opts, async (t) => {
  const { page, state, BASE } = await boot(t, { port: PORT, width: 360, lang: 'ka', switches: { maintenance: true } });
  await openWorkspace(page, BASE);
  const box = page.locator('[data-testid="mw-maintenance"]');
  await box.waitFor();
  const lines = [
    await text(page, '[data-testid="mw-mt-heading"]'), await text(page, '[data-testid="mw-mt-subheading"]'),
    await text(page, '[data-testid="mw-mt-paragraph"]'), await text(page, '[data-testid="mw-mt-section-title"]'),
    await text(page, '[data-testid="mw-mt-section-text"]'), await text(page, '[data-testid="mw-maintenance-cta"]'),
  ].map((s) => s.trim());
  assert.deepEqual(lines, KA_MAINTENANCE);
  assert.equal(await page.locator('[data-testid="mw-maintenance-cta"]').getAttribute('href'), '/find-property');
  assert.equal(await page.locator('[data-testid="mw-row"]').count(), 0);
  assert.equal(await page.locator('[data-testid="mw-filters"]').count(), 0);
  assert.equal(state.catalogCalls.filter((c) => c.view === 'AVAILABLE').length, 0, 'the catalog is not read');
  assert.match(await text(page, '[data-testid="mw-page"] h1'), /Krtsanisi/, 'the property header stays');
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page, `maintenance ka ${width}`);
    await shot(page, SHOTS, `mw-maintenance-ka-${width}`);
  }
  await page.locator('[data-testid="mw-maintenance-cta"]').click();
  await page.waitForURL(/\/find-property/);
});

test('the retired addresses land in the workspace with the right product and view', opts, async (t) => {
  const { page, BASE } = await boot(t, { port: PORT });
  for (const [path, product, view] of [
    ['/leads', 'internal', null], ['/buyers/internal', 'internal', null], ['/buyer/k1', 'internal', null],
    ['/buyers/external?job=j1&start=1', 'external', null], ['/buyers/opportunity/k2', 'external', null], ['/buyers/lead/l1', 'external', null],
    ['/buyers/internal?filter=UNLOCKED', 'internal', 'unlocked'],
  ]) {
    await page.goto(`${BASE}/property/${PROPERTY_ID}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="mw-page"]').waitFor({ timeout: 30000 });
    const u = new URL(page.url());
    assert.equal(u.pathname, `/property/${PROPERTY_ID}/matches`, path);
    assert.equal(u.searchParams.get('product'), product, path);
    assert.equal(u.searchParams.get('view'), view, path);
    assert.equal(u.searchParams.get('job'), null, `${path}: old campaign parameters do not survive`);
  }
});

for (const lang of ['en', 'ar', 'he']) {
  test(`${lang}: 360 · 390 · 768 · 1024 · 1440 — no horizontal overflow${lang === 'en' ? '' : ', right-to-left'}`, opts, async (t) => {
    const { page, BASE } = await boot(t, { port: PORT, width: 360, lang });
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const product of ['external', 'internal']) {
        await openWorkspace(page, BASE, `?product=${product}`);
        await waitRows(page);
        await page.locator('[data-testid="mw-row-check"]').first().check();
        await page.locator('[data-testid="mw-selection-bar"]').waitFor();
        await noOverflow(page, `${lang} ${width} ${product}`);
        if (lang !== 'en') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
        const box = await page.locator('[data-testid="mw-row-check"]').first().boundingBox();
        assert.ok(box && box.height >= 44, `${lang} ${width}: the row checkbox is a 44px target`);
        if (width === 390 || width === 1024) await shot(page, SHOTS, `mw-${product}-${lang}-${width}`);
      }
    }
  });
}
