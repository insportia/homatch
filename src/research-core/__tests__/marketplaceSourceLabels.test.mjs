import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate } from '../marketplace/normalize.ts';
import { buildingStatusFromLabel, renovationStatusFromLabel } from '../marketplace/source-labels.ts';
import { unconfirmedRequirements } from '../marketplace/browse-results.ts';

test('portal labels map to the closed vocabulary; unlisted labels stay unknown', () => {
  assert.equal(buildingStatusFromLabel(' ძველი  აშენებული '), 'OLD_BUILD');
  assert.equal(buildingStatusFromLabel('ახალი აშენებული'), 'NEW_BUILD');
  assert.equal(renovationStatusFromLabel('თეთრი კარკასი'), 'WHITE_FRAME');
  assert.equal(renovationStatusFromLabel('მიმდინარე რემონტი'), null);
  assert.equal(buildingStatusFromLabel(null), null);
});

test('pooled SS.ge rows stored before the adapter fix get their facts from the stored labels', () => {
  const now = new Date();
  const c = { source: 'ss-ge', sourceListingId: '1', exactUrl: 'https://home.ss.ge/x', canonicalUrl: null, sourceName: 'SS.ge', sourceType: 'MARKETPLACE',
    title: null, description: null, price: 1, currency: 'USD', pricePerSqm: null, country: 'Georgia', city: 'თბილისი', district: null, address: null,
    latitude: null, longitude: null, propertyType: 'APARTMENT', transactionType: 'BUY', areaSqm: null, rooms: null, bedrooms: null, bathrooms: null,
    floor: null, totalFloors: null, buildingStatus: null, renovationStatus: null, constructionYear: null, furnished: null, parking: null, amenities: [],
    images: [], imageHashes: [], publishedAt: null, updatedAt: null, observedAt: now.toISOString(),
    seller: { name: null, publicPhone: null, publicEmail: null, publicProfile: null, declaredType: null },
    provenance: { exactUrl: 'https://home.ss.ge/x', authorUrl: null, sourceUrl: null },
    retrievalMetadata: { buildingStatusSource: 'ახალი აშენებული', conditionSource: 'გარემონტებული' } };
  const n = normalizeCandidate(c, { now });
  assert.equal(n.buildingStatus, 'NEW_BUILD');
  assert.equal(n.renovationStatus, 'RENOVATED');
  assert.equal(normalizeCandidate({ ...c, buildingStatus: 'OLD_BUILD' }, { now }).buildingStatus, 'OLD_BUILD', 'a stated fact wins over the label');
});

test('the unconfirmed summary counts each requirement once per property, most frequent first', () => {
  const out = unconfirmedRequirements([{ unverified: ['BUILDING_AGE', 'REQUIRED_ELEVATOR'] }, { unverified: ['BUILDING_AGE', 'BUILDING_AGE'] }, { unverified: [] }]);
  assert.deepEqual(out, [{ code: 'BUILDING_AGE', count: 2 }, { code: 'REQUIRED_ELEVATOR', count: 1 }]);
});
