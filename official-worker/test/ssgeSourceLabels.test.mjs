import test from 'node:test';
import assert from 'node:assert/strict';
import { ssgeCandidate } from '../src/marketplace/ssge/mapping.mjs';

/* Production search f5121176 (2026-10-11): 94 SS.ge listings carried their building status and
   condition as Georgian labels, and every one reached the platform as "not stated". */
const listing = { exactUrl: 'https://home.ss.ge/ka/udzravi-qoneba/1', images: [] };
const detail = (buildingStatus, condition) => ({ sourceListingId: '1', title: 'x', description: null, price: 90000, currency: 'USD', city: 'თბილისი',
  district: 'ვარკეთილი', subdistrict: null, propertyType: 'apartment', transactionType: 'sale', area: 80, rooms: 3, bedrooms: 2, floor: 3, totalFloors: 9,
  amenities: { elevator: true }, images: [], publishedAt: null, updatedAt: null, observedAt: new Date().toISOString(), buildingStatus, condition,
  provenance: { locationIds: {} }, raw: {} });

test('SS.ge building status and condition labels become facts; an unknown label stays unknown', () => {
  const c = ssgeCandidate(listing, detail('ძველი აშენებული', 'ახალი რემონტით'), { searchId: 's' }, 1);
  assert.equal(c.buildingStatus, 'OLD_BUILD');
  assert.equal(c.renovationStatus, 'RENOVATED');
  assert.equal(ssgeCandidate(listing, detail('ახალი აშენებული', 'მწვანე კარკასი'), { searchId: 's' }, 1).renovationStatus, 'GREEN_FRAME');
  assert.equal(ssgeCandidate(listing, detail('მშენებარე', 'სარემონტო'), { searchId: 's' }, 1).buildingStatus, 'UNDER_CONSTRUCTION');
  const unknown = ssgeCandidate(listing, detail('უცნობი', 'მიმდინარე რემონტი'), { searchId: 's' }, 1);
  assert.equal(unknown.buildingStatus, null);
  assert.equal(unknown.renovationStatus, null, 'a renovation in progress is neither finished nor a frame');
});
