// verifyMarketLocality.test.mjs — job 8ba97da9: the Verify market search for
// a Krtsanisi flat sent the administrative raion "კრწანისი"; the
// district-scoped SS.ge search returned nothing and the run widened to the
// whole city, while SS.ge itself files Krtsanisi St. under "ორთაჭალა". The
// Verify adapter now tries the raion and then the portal neighbourhood, each
// as its own DISTRICT attempt, before widening. Engines are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerifyMarketRuntime, districtCandidates } from '../.tstest-build/verify/VerifyMarketRuntime.js';

const listing = (i, district) => ({
  source: 'SSGE', sourceListingId: `s-${i}`, exactUrl: `https://example.test/s/${i}`, title: `ბინა ${i}`, price: 300000, currency: 'USD', pricePerSqm: null,
  city: 'თბილისი', district, address: 'კრწანისის ქ.', latitude: null, longitude: null, propertyType: 'APARTMENT', transactionType: 'BUY', areaSqm: 95, rooms: 3,
  floor: 5, totalFloors: 12, imageHashes: [], publishedAt: null, updatedAt: null, observedAt: '2026-10-11T00:00:00Z', seller: null, retrievalMetadata: {},
});
const waitDone = async (job) => { for (let i = 0; i < 200 && job.status !== 'COMPLETE'; i++) await new Promise((r) => setTimeout(r, 5)); };

test('districtCandidates: Krtsanisi raion → itself, then Ortachala; others unchanged', () => {
  assert.deepEqual(districtCandidates('კრწანისი'), ['კრწანისი', 'ორთაჭალა']);
  assert.deepEqual(districtCandidates('კრწანისის რაიონი'), ['კრწანისის რაიონი', 'ორთაჭალა']);
  assert.deepEqual(districtCandidates('Krtsanisi'), ['Krtsanisi', 'ორთაჭალა']);
  assert.deepEqual(districtCandidates('ორთაჭალა'), ['ორთაჭალა']);
  assert.deepEqual(districtCandidates('ვაკე'), ['ვაკე']);
  assert.deepEqual(districtCandidates(null), []);
  assert.deepEqual(districtCandidates('  '), []);
});

test('the .601 shape: raion search fails, the neighbourhood search is local, no citywide widening', async () => {
  const calls = [];
  const rt = new VerifyMarketRuntime({
    minLocalSample: 3,
    acquireMyHome: async () => { throw new Error('MyHome down'); },
    acquireSsge: async (req, { report }) => {
      const d = req.districts[0] ?? null;
      calls.push(d ?? 'CITY');
      if (d === 'კრწანისი') throw new Error('Unknown or ambiguous SS.ge district/neighborhood');
      if (d === 'ორთაჭალა') return report({ status: 'COMPLETE', discoveredCount: 4, listings: [1, 2, 3, 4].map((i) => listing(i, 'ორთაჭალა')) });
      return report({ status: 'COMPLETE', discoveredCount: 999, listings: [listing(99, 'საბურთალო')] });
    },
  });
  const job = rt.start({ city: 'თბილისი', district: 'კრწანისი', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: null, rooms: null, priceUsd: null }, ['MYHOME', 'SSGE']);
  await waitDone(job);
  assert.deepEqual(calls, ['კრწანისი', 'ორთაჭალა']);
  assert.ok(job.comparables.every((c) => c.scope === 'DISTRICT' && c.district === 'ორთაჭალა'));
  const att = job.sources.SSGE.attempts;
  assert.deepEqual(att.map((a) => [a.scope, a.district, a.status]), [['DISTRICT', 'კრწანისი', 'FAILED'], ['DISTRICT', 'ორთაჭალა', 'COMPLETE']]);
  assert.match(att[0].error, /Unknown or ambiguous/);
});

test('still thin after every local name: widens to the city exactly once', async () => {
  const calls = [];
  const rt = new VerifyMarketRuntime({
    minLocalSample: 8,
    acquireMyHome: async (req, { report }) => { calls.push(req.districts[0] ?? 'CITY'); await report({ status: 'COMPLETE', discoveredCount: 1, listings: [listing(calls.length, 'x')] }); },
    acquireSsge: async () => undefined,
  });
  const job = rt.start({ city: 'თბილისი', district: 'კრწანისი', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: 94, rooms: 3, priceUsd: null }, ['MYHOME']);
  await waitDone(job);
  assert.deepEqual(calls, ['კრწანისი', 'ორთაჭალა', 'CITY']);
});
