// PHASE 2 supply revalidation: field-by-field, through the same reader, never a page hash.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareSnapshots, judgeRevalidation, revalidationDue, revalidationMethod, snapshotOfListing, snapshotOfRow,
  SUPPLY_REVALIDATION_POLICY,
} from '../discovery/supply-revalidation.ts';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const row = { transaction: 'SALE', sale_amount: '145000', sale_currency: 'USD', area_sqm: '70', rooms: 3 };

test('only portal listings are re-fetched; community posts and REMOVED rows are not', () => {
  assert.equal(revalidationMethod({ adapter_id: 'place-ge', canonical_url: 'https://place.ge/x' }).method, 'PORTAL_REFETCH');
  assert.equal(revalidationMethod({ adapter_id: 'telegram-community', canonical_url: 'https://t.me/a/1' }).method, 'NOT_REVALIDATABLE');
  assert.equal(revalidationMethod({ adapter_id: 'place-ge', canonical_url: 'https://place.ge/x', validation_state: 'REMOVED' }).method, 'NOT_REVALIDATABLE');
  assert.equal(revalidationMethod({ adapter_id: 'place-ge', canonical_url: null }).method, 'NOT_REVALIDATABLE');
});

test('cadence: rentals every 3 days, sales every 7; nothing is due early', () => {
  const base = { adapter_id: 'place-ge', canonical_url: 'https://place.ge/x' };
  assert.equal(revalidationDue({ ...base, transaction: 'RENT', last_verified_at: ago(2) }, NOW), false);
  assert.equal(revalidationDue({ ...base, transaction: 'RENT', last_verified_at: ago(3) }, NOW), true);
  assert.equal(revalidationDue({ ...base, transaction: 'SALE', last_verified_at: ago(6) }, NOW), false);
  assert.equal(revalidationDue({ ...base, transaction: 'SALE', first_seen_at: ago(8) }, NOW), true);
  assert.ok(SUPPLY_REVALIDATION_POLICY.MAX_PER_RUN <= 25);
});

test('404/410 is REMOVED (conclusive); other errors are not a verification', () => {
  assert.deepEqual(judgeRevalidation({ status: 410, before: snapshotOfRow(row), after: null }).outcome, 'REMOVED');
  const blocked = judgeRevalidation({ status: 403, before: snapshotOfRow(row), after: null });
  assert.equal(blocked.outcome, 'INACCESSIBLE');
  assert.equal(blocked.conclusive, false);
});

test('a page that answers but cannot be read by its adapter is UNKNOWN, never a guessed change', () => {
  const r = judgeRevalidation({ status: 200, before: snapshotOfRow(row), after: null });
  assert.equal(r.outcome, 'UNKNOWN');
  assert.equal(r.conclusive, false);
});

test('same fields → UNCHANGED_VALID even though the page itself differs; a price drop → CHANGED_VALID with history', () => {
  const listing = { sale: { amount: 145000, currency: 'USD' }, area: { value: 70.5, unit: 'sqm' }, rooms: 3 };
  const same = judgeRevalidation({ status: 200, before: snapshotOfRow(row), after: snapshotOfListing(listing, 'SALE') });
  assert.equal(same.outcome, 'UNCHANGED_VALID');
  assert.ok(same.confidence > 0.9);
  const cheaper = judgeRevalidation({ status: 200, before: snapshotOfRow(row), after: snapshotOfListing({ ...listing, sale: { amount: 135000, currency: 'USD' } }, 'SALE') });
  assert.equal(cheaper.outcome, 'CHANGED_VALID');
  assert.deepEqual(cheaper.comparison.priceChange, { from: 145000, to: 135000, share: 0.069, currency: 'USD' });
  const tiny = compareSnapshots(snapshotOfRow(row), { price: 144500, currency: 'USD', areaSqm: 70, rooms: 3 });
  assert.equal(tiny.material, false, 'a sub-3% move is recorded but not material');
  assert.ok(tiny.priceChange);
  const otherCurrency = compareSnapshots(snapshotOfRow(row), { price: 390000, currency: 'GEL', areaSqm: null, rooms: null });
  assert.equal(otherCurrency.confidence, 0, 'a currency switch is not compared (never converted)');
});
