// Property inventory rules (marketplace/inventory.ts): one row per listing, honest freshness,
// predictable R2 keys, nothing private in a snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEX_KEY_PATTERN, INVENTORY_POLICY, WORKER_ONLY_SOURCES, inventoryFreshness, inventoryRow, keySegment,
  listingSnapshotKey, portalIndexKey, snapshotOf,
} from '../marketplace/inventory.ts';
import * as F from './fixtures/marketplaceFixtures.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;

test('inventory row: sale, monthly and daily rent map to the supply vocabulary; an absent fact stays null', async () => {
  const sale = await inventoryRow(F.listing({ transactionType: 'BUY', price: 145000, currency: 'USD' }));
  assert.equal(sale.transaction, 'SALE');
  assert.deepEqual([sale.sale_amount, sale.sale_currency, sale.rent_amount, sale.rent_period], [145000, 'USD', null, null]);
  assert.equal(Date.parse(sale.expires_at) - Date.parse(sale.observed_at), INVENTORY_POLICY.SALE_WINDOW_DAYS * DAY);

  const rent = await inventoryRow(F.listing({ transactionType: 'MONTHLY_RENT', price: 900, currency: 'USD' }));
  assert.deepEqual([rent.transaction, rent.sale_amount, rent.rent_amount, rent.rent_currency, rent.rent_period], ['RENT', null, 900, 'USD', 'MONTH']);
  const daily = await inventoryRow(F.listing({ transactionType: 'DAILY_RENT', price: 60, currency: 'GEL' }));
  assert.deepEqual([daily.transaction, daily.rent_period], ['SHORT_STAY', 'DAY']);

  const bare = await inventoryRow(F.listing({ price: null, currency: 'USD', areaSqm: null, rooms: null, bedrooms: null, latitude: 0, longitude: 0, publishedAt: 'not a date' }));
  assert.deepEqual([bare.sale_amount, bare.sale_currency, bare.area_sqm, bare.rooms, bare.bedrooms, bare.latitude, bare.longitude, bare.published_at],
    [null, null, null, null, null, null, null, null], 'nothing is invented: no price means no currency, (0,0) is not a place');
});

test('inventory row: photos are URLs (https only, capped), never copies; the identity is the provider listing id', async () => {
  const row = await inventoryRow(F.listing({ sourceListingId: '9876543', images: ['http://x/a.jpg', 'https://x/b.jpg', ...Array.from({ length: 30 }, (_, i) => `https://x/${i}.jpg`)] }));
  assert.equal(row.external_id, '9876543');
  assert.ok(row.image_urls.every((u) => u.startsWith('https://')));
  assert.equal(row.image_urls.length, INVENTORY_POLICY.MAX_IMAGES);
});

test('content fingerprint: the same facts give the same fingerprint; a price change gives another; observation time does not count', async () => {
  const a = await inventoryRow(F.listing({ price: 120000, observedAt: '2026-10-01T00:00:00Z' }));
  const b = await inventoryRow(F.listing({ price: 120000, observedAt: '2026-10-02T00:00:00Z' }));
  const c = await inventoryRow(F.listing({ price: 118000 }));
  assert.equal(a.content_fingerprint, b.content_fingerprint);
  assert.notEqual(a.content_fingerprint, c.content_fingerprint);
  assert.match(a.content_fingerprint, /^[0-9a-f]{64}$/);
});

test('snapshot: a seller\'s phone and e-mail never reach R2; everything else is kept', () => {
  const c = F.listing({ seller: { name: 'Nino', publicPhone: '+995 555 12 34 56', publicEmail: 'n@example.ge', publicProfile: null, declaredType: 'OWNER', sourceListingCount: 1 } });
  const s = snapshotOf(c);
  assert.equal(s.seller.publicPhone, null);
  assert.equal(s.seller.publicEmail, null);
  assert.equal(s.seller.name, 'Nino');
  assert.equal(s.price, c.price);
  assert.equal(c.seller.publicPhone, '+995 555 12 34 56', 'the candidate itself is not mutated');
});

test('R2 keys: one convention for every provider, safe segments, predictable folders', () => {
  const first = new Date('2026-10-03T09:00:00Z'), at = new Date('2026-10-19T12:00:00.123Z');
  assert.equal(listingSnapshotKey('myhome-ge', 'GE', '123456', first, at, 'ab'.repeat(32)),
    'property-inventory/myhome-ge/ge/2026/10/123456/snapshot-20261019T120000Z-abababab.json.gz');
  assert.equal(listingSnapshotKey('home-ge', 'ge', '../../etc/passwd', first, at, 'cd'.repeat(32)).split('/').length, 7, 'a hostile id stays one segment');
  assert.ok(!listingSnapshotKey('home-ge', 'ge', '../../x', first, at, 'cd'.repeat(32)).includes('..'));
  assert.equal(keySegment('Allhome.GE'), 'allhome-ge');
  const index = portalIndexKey('allhome-ge', 'ge', at, 'ef'.repeat(32));
  assert.equal(index, 'property-inventory/allhome-ge/ge/portal-index/index-20261019T120000Z-efefefef.json.gz');
  assert.match(index, INDEX_KEY_PATTERN);
  assert.doesNotMatch('property-inventory/allhome-ge/ge/portal-index/../users/x.json.gz', INDEX_KEY_PATTERN);
});

test('freshness: a sighting is never a verification; an outage is never a removal; old is stale', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(inventoryFreshness({ validation_state: 'UNVERIFIED', last_seen_at: ago(2 * HOUR), transaction: 'SALE' }, now), 'RECENTLY_OBSERVED');
  assert.equal(inventoryFreshness({ validation_state: 'VALID', last_verified_at: ago(2 * DAY), last_seen_at: ago(2 * DAY), transaction: 'SALE' }, now), 'VERIFIED_ACTIVE');
  assert.equal(inventoryFreshness({ validation_state: 'VALID', last_verified_at: ago(4 * DAY), last_seen_at: ago(4 * DAY), transaction: 'RENT' }, now), 'STALE', 'a rental verification lasts 3 days');
  assert.equal(inventoryFreshness({ validation_state: 'UNVERIFIED', last_seen_at: ago(5 * DAY), transaction: 'SALE' }, now), 'STALE');
  assert.equal(inventoryFreshness({ validation_state: 'UNVERIFIABLE', last_seen_at: ago(5 * DAY) }, now), 'UNAVAILABLE', 'the portal could not be read: unavailable, not removed');
  assert.equal(inventoryFreshness({ validation_state: 'UNVERIFIABLE', last_seen_at: ago(HOUR) }, now), 'RECENTLY_OBSERVED', 'a worker sighting after a failed re-check wins (as in property_inventory_status)');
  assert.equal(inventoryFreshness({ validation_state: 'REMOVED', last_seen_at: ago(HOUR) }, now), 'REMOVED');
  assert.equal(inventoryFreshness({ validation_state: 'UNVERIFIED' }, now), 'UNVERIFIED');
});

test('worker-only sources are the portals no research-core reader can re-read', () => {
  assert.deepEqual([...WORKER_ONLY_SOURCES].sort(), ['allhome-ge', 'brokeri-ge', 'myhome-ge']);
});
