// verifyMarket.test.mjs — Verify Market Research over the existing MyHome.ge
// and SS.ge adapters: bounded sample, district→city widening, privacy
// stripping, source failure isolation. Adapters are faked at their own
// report() contract; nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerifyMarketRuntime, buildMarketplaceRequest, parseVerifyMarketProfile, toVerifyComparable } from '../.tstest-build/verify/VerifyMarketRuntime.js';

const listing = (source, i, extra = {}) => ({
  source, sourceListingId: `${source}-${i}`, exactUrl: `https://example.test/${source}/${i}`, canonicalUrl: null, sourceName: null, sourceType: 'MARKETPLACE',
  title: `ბინა ${i}`, description: 'long public description', price: 100000 + i * 1000, currency: 'USD', pricePerSqm: null, country: 'GE', city: 'Tbilisi',
  district: 'Vake', address: 'Chavchavadze Ave', latitude: 41.71, longitude: 44.75, propertyType: 'APARTMENT', transactionType: 'BUY', areaSqm: 80, rooms: 3,
  bedrooms: 2, bathrooms: 1, floor: 5, totalFloors: 12, buildingStatus: 'NEW_BUILD', renovationStatus: 'WHITE_FRAME', constructionYear: null, furnished: null,
  parking: null, amenities: [], images: ['https://img/1.jpg'], imageHashes: ['abc'], publishedAt: null, updatedAt: '2026-10-01T00:00:00Z', observedAt: '2026-10-08T00:00:00Z',
  seller: { name: 'Private Seller', publicPhone: '+995 555 12 34 56', publicEmail: 'x@y.z', publicProfile: null, declaredType: 'OWNER', sourceListingCount: null },
  provenance: { exactUrl: '', authorUrl: null, sourceUrl: null }, evidence: [], retrievalMetadata: {}, ...extra,
});

const waitDone = async (job) => { for (let i = 0; i < 200 && job.status !== 'COMPLETE'; i++) await new Promise((r) => setTimeout(r, 5)); };
const profile = { city: 'Tbilisi', district: 'Vake', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: 80, rooms: 3, priceUsd: 150000 };

test('request window: area ±25 %, rooms ±1, price ±60 % around a known ask', () => {
  const r = buildMarketplaceRequest(profile, 'Vake');
  assert.equal(r.areaMinSqm, 60);
  assert.equal(r.areaMaxSqm, 100);
  assert.deepEqual(r.rooms, { min: 2, max: 4 });
  assert.equal(r.priceMinUsd, 60000);
  assert.equal(r.priceMaxUsd, 240000);
  assert.equal(r.collectPriceMaxUsd, r.priceMaxUsd);
  assert.deepEqual(r.districts, ['Vake']);
  const open = buildMarketplaceRequest({ ...profile, priceUsd: null, areaSqm: null, rooms: null }, null);
  assert.equal(open.priceMinUsd, 0);
  assert.equal(open.rooms, null);
  assert.deepEqual(open.districts, []);
});

test('comparable normalisation strips seller identity, descriptions and photos; keeps a phone hash for dedupe', () => {
  const v = toVerifyComparable('MYHOME', listing('m', 1), 'DISTRICT');
  const s = JSON.stringify(v);
  assert.ok(!s.includes('555'));
  assert.ok(!s.includes('Private Seller'));
  assert.ok(!s.includes('x@y.z'));
  assert.ok(!s.includes('long public description'));
  assert.ok(!s.includes('img/1.jpg'));
  assert.equal(v.phoneHash.length, 24);
  assert.equal(v.pricePerSqm, 101000 / 80);
});

test('runtime: both sources searched, bounded by maxPerSource, stops politely by abort', async () => {
  let myhomeAborted = false;
  const rt = new VerifyMarketRuntime({
    maxPerSource: 10,
    acquireMyHome: async (req, { report, signal }) => {
      for (let p = 0; p < 5; p++) {
        if (signal.aborted) { myhomeAborted = true; return; }
        await report({ status: 'RESULTS_RECEIVED', discoveredCount: 120, listings: Array.from({ length: 6 }, (_, i) => listing('m', p * 6 + i)) });
      }
    },
    acquireSsge: async (req, { report }) => { await report({ status: 'COMPLETE', discoveredCount: 4, listings: [0, 1, 2, 3].map((i) => listing('s', i)) }); },
  });
  const job = rt.start(profile);
  await waitDone(job);
  assert.equal(job.status, 'COMPLETE');
  assert.equal(job.sources.MYHOME.listings, 10);
  assert.ok(myhomeAborted);
  assert.equal(job.sources.MYHOME.status, 'PARTIAL');
  assert.ok(job.comparables.some((c) => c.source === 'SSGE'));
});

test('runtime: thin district sample widens to the city; a failing source never fails the other', async () => {
  const calls = [];
  const rt = new VerifyMarketRuntime({
    minLocalSample: 8,
    acquireMyHome: async (req, { report }) => {
      calls.push(req.districts.length ? 'DISTRICT' : 'CITY');
      await report({ status: 'COMPLETE', discoveredCount: 2, listings: req.districts.length ? [listing('m', 1), listing('m', 2)] : [listing('m', 3), listing('m', 4), listing('m', 5)] });
    },
    acquireSsge: async () => { throw new Error('SS.ge public page unavailable'); },
  });
  const job = rt.start(profile);
  await waitDone(job);
  assert.deepEqual(calls, ['DISTRICT', 'CITY']);
  assert.equal(job.sources.MYHOME.listings, 5);
  assert.deepEqual(job.comparables.map((c) => c.scope).sort(), ['CITY', 'CITY', 'CITY', 'DISTRICT', 'DISTRICT']);
  assert.equal(job.sources.SSGE.status, 'FAILED');
  assert.equal(job.sources.SSGE.listings, 0);
});

test('profile validation: untrusted bodies are bounded and mapped to adapter-supported types', () => {
  assert.equal(parseVerifyMarketProfile({}), null);
  const p = parseVerifyMarketProfile({ city: 'Tbilisi', propertyType: 'PENTHOUSE', transactionType: 'DROP TABLE', areaSqm: '-5', rooms: '3' });
  assert.equal(p.propertyType, 'APARTMENT');
  assert.equal(p.transactionType, 'BUY');
  assert.equal(p.areaSqm, null);
  assert.equal(p.rooms, 3);
});
