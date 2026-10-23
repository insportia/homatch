// verifyMarketPageCap.test.mjs — audit C2 (2026-10-22): Verify reads at most
// TWO result pages per portal, passed explicitly from the Verify path, while
// Find Property keeps its own defaults (SS.ge SSGE_PAGE_CAP = 2 since 2026-10-23, MyHome
// MYHOME_MAX_PAGES) and its byte-identical request. Also F6: no city-wide
// widening, type-specific area windows. Engines are faked; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VerifyMarketRuntime, VERIFY_MARKET_PAGE_CAP, buildMarketplaceRequest } from '../.tstest-build/verify/VerifyMarketRuntime.js';
import { acquireSsge, SSGE_PAGE_CAP } from '../src/marketplace/ssge/acquire.mjs';
import { startSsgeRuntime } from '../src/marketplace/ssge/runtime.mjs';
import { SsgePublicClient } from '../src/marketplace/ssge/vendor/public-client.mjs';

const fixture = JSON.parse(readFileSync(new URL('fixtures/ssge/accepted-scenarios.json', import.meta.url), 'utf8'));
const waitDone = async (job) => { for (let i = 0; i < 400 && job.status !== 'COMPLETE'; i++) await new Promise((r) => setTimeout(r, 5)); };
const profile = { city: 'Tbilisi', district: 'Vake', transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: 80, rooms: 3, priceUsd: null };

test('Verify passes pageCap 2 to BOTH portals on every attempt', async () => {
  assert.equal(VERIFY_MARKET_PAGE_CAP, 2);
  const seen = [];
  const rt = new VerifyMarketRuntime({
    acquireMyHome: async (req, opts) => { seen.push(['MYHOME', opts.pageCap]); },
    acquireSsge: async (req, opts) => { seen.push(['SSGE', opts.pageCap]); },
  });
  const job = rt.start({ ...profile, district: 'კრწანისი' });
  await waitDone(job);
  // Two local names (raion + portal neighbourhood) per source, each capped at 2.
  assert.deepEqual(seen.filter(([s]) => s === 'MYHOME').map(([, c]) => c), [2, 2]);
  assert.deepEqual(seen.filter(([s]) => s === 'SSGE').map(([, c]) => c), [2, 2]);
});

test('the real SS.ge adapter, driven through Verify, requests pages 1 and 2 only', async () => {
  const s = fixture.scenarios[0];
  const pages = [];
  const client = new SsgePublicClient({ locations: fixture.locations, session: { authorize: async (r) => r }, http: { fetchImpl: async (url, init) => {
    if (String(url).includes('legend-search-count')) return Response.json({ cardCount: 4829, applicationCount: 4829 });
    if (String(url).includes('LegendSearch')) {
      const { page } = JSON.parse(init.body);
      pages.push(page);
      const id = String(Number(s.list.applicationId) + page);
      return Response.json({ realStateItemModel: [{ ...s.list, applicationId: id, detailUrl: s.list.detailUrl.replace(/\d+$/, id) }], totalCount: 4829 });
    }
    if (String(url).includes('/details')) return Response.json({ ...s.detail, applicationId: new URL(url).searchParams.get('applicationId') });
    throw Error('Unexpected fixture request');
  } } });
  const rt = new VerifyMarketRuntime({
    acquireMyHome: async () => undefined,
    acquireSsge: (req, opts) => acquireSsge(req, { ...opts, client, sleep: async () => {}, verifyPage: async () => s.proof }),
  });
  const job = rt.start({ city: 'Tbilisi', district: s.detail.address.subdistrictTitle, transactionType: 'BUY', propertyType: 'APARTMENT', areaSqm: null, rooms: null, priceUsd: null }, ['SSGE']);
  await waitDone(job);
  assert.deepEqual(pages, [1, 2], 'page 3 is never requested by Verify');
});

test('Find Property\'s SS.ge runtime passes the claimed request unchanged and no page cap (default 2 applies)', async () => {
  assert.equal(SSGE_PAGE_CAP, 2);
  const claimedRequest = {
    contract: 'marketplace-worker-1', searchId: '11111111-1111-4111-8111-111111111111', searchPlanId: '33333333-3333-4333-8333-333333333333',
    country: 'GE', market: 'GE', city: 'Tbilisi', districts: ['ვაკე'], transactionType: 'BUY', propertyType: 'APARTMENT', priceMinUsd: 0,
    priceMaxUsd: 200000, collectPriceMaxUsd: 220000, areaMinSqm: 60, areaMaxSqm: null, rooms: null, bedrooms: null, bathrooms: null,
    buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null, mustHave: [], niceToHave: [], exclusions: [],
    searchLanguages: ['ka'], requestedAt: '2026-10-22T00:00:00.000Z',
  };
  const snapshot = JSON.stringify(claimedRequest);
  let captured = null;
  let claimed = false;
  const runtime = startSsgeRuntime(
    { SUPABASE_URL: 'https://fixture.supabase.co', SSGE_WORKER_TOKEN: 'x'.repeat(40), SSGE_MARKETPLACE_ENABLED: 'true' },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === 'claim') { const runs = claimed ? [] : [{ runId: 'r1', request: claimedRequest, deadlineAt: new Date(Date.now() + 900000).toISOString() }]; claimed = true; return Response.json({ runs }); }
      return Response.json({ accepted: 0, rejected: [] });
    },
    async (request, opts) => { captured = { request: JSON.stringify(request), pageCap: opts.pageCap, keys: Object.keys(opts).sort() }; },
  );
  try {
    for (let i = 0; i < 100 && !captured; i++) await new Promise((r) => setTimeout(r, 10));
  } finally { runtime.shutdown(); }
  assert.ok(captured, 'the Find Property runtime called acquire');
  assert.equal(captured.request, snapshot, 'byte-identical request');
  assert.equal(captured.pageCap, undefined, 'no page cap passed: acquireSsge keeps SSGE_PAGE_CAP');
  assert.deepEqual(captured.keys, ['deadlineAt', 'report', 'signal']);
});

test('MyHome: Find Property\'s claim loop keeps MYHOME_MAX_PAGES; only the Verify entry lowers it', () => {
  const src = readFileSync(new URL('../src/marketplace/MyHomeRuntime.ts', import.meta.url), 'utf8');
  assert.match(src, /const maxPages = Math\.max\(1, Math\.trunc\(Number\(env\.MYHOME_MAX_PAGES\)\) \|\| 2\);/);
  assert.match(src, /acquireMyHome\(job\.request, \{ fetcher, engine: myHomeEngine, enrichDetails, maxPages, pageIntervalMs, checkpoint:/, 'Find Property call unchanged');
  assert.match(src, /Math\.min\(options\.pageCap as number, maxPages\)/, 'Verify can only lower the cap');
});

test('apartment request window is byte-identical to before; land/house/commercial get their own windows', () => {
  const r = buildMarketplaceRequest({ ...profile, priceUsd: 150000 }, 'Vake', '2026-10-22T00:00:00.000Z');
  const { searchId, ...rest } = r;
  assert.match(searchId, /^verify-/);
  assert.deepEqual(rest, {
    contract: 'marketplace-worker-1', searchPlanId: 'verify-market', market: 'GE', country: 'GE', city: 'Tbilisi', districts: ['Vake'],
    transactionType: 'BUY', propertyType: 'APARTMENT', priceMinUsd: 60000, priceMaxUsd: 240000, collectPriceMaxUsd: 240000,
    areaMinSqm: 60, areaMaxSqm: 100, rooms: { min: 2, max: 4 }, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [],
    furnished: null, parking: null, mustHave: [], niceToHave: [], exclusions: [], floorPreferences: [], searchLanguages: ['ka'], requestedAt: '2026-10-22T00:00:00.000Z',
  });
  const land = buildMarketplaceRequest({ city: 'თბილისი', district: 'ბაგები', transactionType: 'BUY', propertyType: 'LAND', areaSqm: 2509, rooms: 4, priceUsd: null }, 'ბაგები');
  assert.equal(land.propertyType, 'LAND');
  assert.equal(land.areaMinSqm, 1254);
  assert.equal(land.areaMaxSqm, 3764);
  assert.equal(land.rooms, null, 'rooms never filter a plot');
});

test('no city-wide widening: a thin district stays thin; no district means no search', async () => {
  const calls = [];
  const rt = new VerifyMarketRuntime({
    acquireMyHome: async (req, { report }) => { calls.push(req.districts[0] ?? 'CITY'); await report({ status: 'COMPLETE', discoveredCount: 1, listings: [] }); },
    acquireSsge: async (req) => { calls.push(req.districts[0] ?? 'CITY'); },
  });
  const job = rt.start({ ...profile, district: 'ვაკე' });
  await waitDone(job);
  assert.deepEqual(calls, ['ვაკე', 'ვაკე']);
  const none = rt.start({ ...profile, district: null });
  await waitDone(none);
  assert.deepEqual(calls, ['ვაკე', 'ვაკე'], 'nothing searched without a district');
  assert.deepEqual(none.sources.MYHOME.attempts.map((a) => [a.status, a.error]), [['SKIPPED', 'NO_DISTRICT']]);
  assert.equal(none.comparables.length, 0);
});

test('SS.ge district fallback (city read) is labelled CITY, never DISTRICT', async () => {
  const listing = { sourceListingId: 's1', exactUrl: 'https://home.ss.ge/1', price: 100000, currency: 'USD', areaSqm: 80, propertyType: 'APARTMENT', transactionType: 'BUY', district: 'გლდანი', observedAt: '2026-10-22T00:00:00Z' };
  const rt = new VerifyMarketRuntime({
    acquireMyHome: async () => undefined,
    acquireSsge: async (req, { report }) => { await report({ status: 'COMPLETE', discoveredCount: 900, queryApplied: { districtFallback: 'city read; SS.ge does not resolve: ბაგები' }, listings: [listing] }); },
  });
  const job = rt.start({ ...profile, district: 'ბაგები' }, ['SSGE']);
  await waitDone(job);
  assert.equal(job.comparables[0].scope, 'CITY');
  assert.equal(job.sources.SSGE.attempts[0].error, 'DISTRICT_UNRESOLVED');
});
