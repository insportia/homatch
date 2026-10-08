// MyHome.ge + SS.ge comparables folded into Verify's market lane: profile,
// cross-platform dedupe, lane overlap, tiering, ledger, and the rule that a
// marketplace advert never becomes official project evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marketProfileFromSeed, dedupeMarketplace, sameApartment, foldMarketplaceIntoLane, listingKeyFromUrl, toReportComparable } from '../marketplaceComparables.ts';
import { buildMarketIntelligence } from '../intelligence/marketIntelligence.ts';

const base = {
  source: 'MYHOME', sourceListingId: '1', exactUrl: 'https://www.myhome.ge/pr/1/', price: 120000, currency: 'USD', pricePerSqm: 1500, areaSqm: 80, rooms: 3, bedrooms: 2,
  floor: 6, totalFloors: 12, city: 'Tbilisi', district: 'Vake', address: 'Chavchavadze Ave 10', latitude: 41.709, longitude: 44.754, propertyType: 'APARTMENT',
  transactionType: 'BUY', buildingStatus: 'NEW_BUILD', renovationStatus: 'WHITE_FRAME', title: 'ბინა ვაკეში', publishedAt: null, updatedAt: '2026-09-20T00:00:00Z',
  observedAt: '2026-10-08T00:00:00Z', imageHashes: [], phoneHash: null, scope: 'DISTRICT',
};
const mk = (o) => ({ ...base, ...o });

test('profile: built from identified attributes; no city, no search', () => {
  const seed = { location: { city: { value: 'Tbilisi' }, district: { value: 'Vake-Saburtalo' }, subDistrict: { value: 'Vake' } }, property: { propertyType: { value: 'APARTMENT' }, areaSqm: { value: 82.4 }, rooms: { value: 3 }, transaction: 'SALE' } };
  assert.deepEqual(marketProfileFromSeed(seed, 150000), { city: 'Tbilisi', district: 'Vake', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: 82.4, rooms: 3, priceUsd: 150000 });
  assert.equal(marketProfileFromSeed({ location: {}, property: {} }), null);
  assert.equal(marketProfileFromSeed({ ...seed, property: { ...seed.property, transaction: 'RENT' } }).transactionType, 'MONTHLY_RENT');
});

test('same apartment across MyHome.ge and SS.ge: phone, photo or coordinates — with matching size and floor', () => {
  assert.ok(sameApartment(mk({ phoneHash: 'p1' }), mk({ source: 'SSGE', sourceListingId: '9', phoneHash: 'p1', areaSqm: 81 })));
  assert.ok(sameApartment(mk({ imageHashes: ['h'] }), mk({ source: 'SSGE', sourceListingId: '9', imageHashes: ['h', 'x'] })));
  assert.ok(sameApartment(mk({}), mk({ source: 'SSGE', sourceListingId: '9', latitude: 41.70905 })));
  // Identical layout, different floor: two apartments.
  assert.ok(!sameApartment(mk({ phoneHash: 'p1' }), mk({ source: 'SSGE', sourceListingId: '9', phoneHash: 'p1', floor: 7 })));
  // Same building, no strong signal: never merged on looks alone.
  assert.ok(!sameApartment(mk({ latitude: null }), mk({ source: 'SSGE', sourceListingId: '9', latitude: null })));
  // Size differs beyond 3 %.
  assert.ok(!sameApartment(mk({ phoneHash: 'p1' }), mk({ source: 'SSGE', sourceListingId: '9', phoneHash: 'p1', areaSqm: 90 })));
});

test('dedupe: one apartment on two platforms counts once, fresher advert leads, the other is kept as provenance', () => {
  const r = dedupeMarketplace([
    mk({ phoneHash: 'p', updatedAt: '2026-08-01T00:00:00Z' }),
    mk({ source: 'SSGE', sourceListingId: '77', exactUrl: 'https://home.ss.ge/ka/udzravi-qoneba/77', phoneHash: 'p', updatedAt: '2026-10-01T00:00:00Z' }),
    mk({ sourceListingId: '1' }),
    mk({ sourceListingId: '2', areaSqm: 60, latitude: 41.72 }),
  ]);
  assert.equal(r.unique.length, 2);
  assert.equal(r.crossPlatformDuplicates, 1);
  assert.equal(r.sameSourceDuplicates, 1);
  const merged = r.unique.find((u) => u.alsoListedAt.length);
  assert.equal(merged.source, 'SSGE');
  assert.equal(merged.alsoListedAt[0].source, 'MYHOME');
});

test('lane overlap: an SS.ge advert the portal lane already read is not counted twice', () => {
  assert.equal(listingKeyFromUrl('https://home.ss.ge/ka/udzravi-qoneba/qiravdeba-bina-12345678'), 'ss.ge:12345678');
  const lane = [{ source: 'ss.ge', url: 'https://home.ss.ge/ka/udzravi-qoneba/x-12345678', comparableType: 'MICRO_LOCATION', listingStatus: 'ACTIVE' }];
  const job = { status: 'COMPLETE', sources: { MYHOME: { status: 'COMPLETE', listings: 1, attempts: [{ discovered: 40 }] }, SSGE: { status: 'COMPLETE', listings: 1, attempts: [{ discovered: 12 }] } },
    comparables: [mk({ source: 'SSGE', sourceListingId: '12345678', exactUrl: 'https://home.ss.ge/x' }), mk({ sourceListingId: '555', latitude: 41.73, areaSqm: 70 })] };
  const r = foldMarketplaceIntoLane(lane, job, { project: null, latitude: null, longitude: null, district: 'Vake' }, '2026-10-08T00:00:00Z');
  assert.equal(r.ledger.alreadyInLane, 1);
  assert.equal(r.ledger.added, 1);
  assert.equal(r.comparables.length, 2);
  assert.equal(r.ledger.myhome.discovered, 40);
  assert.equal(r.ledger.searchesPerformed, 2);
  assert.equal(r.ledger.medianListingAgeDays, 18);
});

test('report comparable: asking price only, ACTIVE, tiered by real location, derived ppsm, no fabricated project', () => {
  const [u] = dedupeMarketplace([mk({ pricePerSqm: null, scope: 'CITY', latitude: 41.80 })]).unique;
  const c = toReportComparable(u, { project: null, latitude: 41.709, longitude: 44.754, district: 'Vake' });
  assert.equal(c.listingStatus, 'ACTIVE');
  assert.equal(c.pricePerSqm, '1500');
  assert.equal(c.comparableType, 'PEER_PROJECT');
  assert.equal(c.project, null);
  assert.equal(c.discoveryMethod, 'MARKETPLACE_WORKER_SEARCH');
  const near = toReportComparable(dedupeMarketplace([mk({ scope: 'CITY' })]).unique[0], { project: null, latitude: 41.7095, longitude: 44.7545, district: null });
  assert.equal(near.comparableType, 'MICRO_LOCATION');
  const same = toReportComparable(dedupeMarketplace([mk({ title: 'Villion Residence, block B' })]).unique[0], { project: 'Villion', latitude: null, longitude: null, district: null });
  assert.equal(same.comparableType, 'SAME_PROJECT');
});

test('folded comparables drive the existing market intelligence (median, range, sample) unchanged', () => {
  const comps = [1400, 1450, 1500, 1550, 1600, 1650].map((p, i) => mk({ sourceListingId: String(i), exactUrl: `https://www.myhome.ge/pr/${i}/`, pricePerSqm: p, latitude: 41.709 + i * 0.01, phoneHash: null }));
  const r = foldMarketplaceIntoLane([], { comparables: comps, sources: {} }, { project: null, latitude: null, longitude: null, district: 'Vake' }, '2026-10-08T00:00:00Z');
  assert.equal(r.comparables.length, 6);
  const mi = buildMarketIntelligence({ address: 'Chavchavadze Ave, Vake', area: 80, rooms: 3 }, r.comparables);
  assert.ok(mi);
  assert.equal(mi.count, 6);
  assert.equal(mi.median, 1525);
  assert.equal(mi.min, 1400);
  assert.equal(mi.max, 1650);
});
