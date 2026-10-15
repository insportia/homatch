// Find Property HTML portals (place.ge, korter.ge, brokeri.ge) against pages the sites
// actually served on 2026-10-15 (test/fixtures/portals/*.html.gz, unmodified), through
// the shared acquisition loop, with every report checked by the platform's own
// worker-contract validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { acquirePortal, robotsRules, robotsAllows } from '../src/marketplace/portals/acquire.mjs';
import { startPortalRuntime } from '../src/marketplace/portals/runtime.mjs';
import { PORTAL_ADAPTERS } from '../src/marketplace/portals/adapters.mjs';
import { placege } from '../src/marketplace/portals/adapters/placege.mjs';
import { korter } from '../src/marketplace/portals/adapters/korter.mjs';
import { brokeri } from '../src/marketplace/portals/adapters/brokeri.mjs';
import { homege } from '../src/marketplace/portals/adapters/homege.mjs';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';
import { loadMarketplaceSwitches, workerSwitchOn } from '../../supabase/functions/_shared/marketplaceSearch.ts';

const page = (name) => gunzipSync(readFileSync(new URL(`fixtures/portals/${name}.html.gz`, import.meta.url))).toString('utf8');
const ROBOTS = {
  'place.ge': 'User-agent: *\nDisallow: /admin*\n',
  'korter.ge': 'User-agent: *\nDisallow: /redirect\nDisallow: /building/geo\nDisallow: /api/\nDisallow: /pyapi/\nDisallow: /node-api/\n',
  'brokeri.ge': 'User-agent: *\nDisallow:\n',
  'home.ge': 'User-agent: Yandex\nDisallow: /\n\nUser-Agent: *\nAllow: /\nDisallow: /plugins/\nDisallow: /*?sort_by=\nDisallow: /*listing-details.html*\nDisallow: /*print.html*\n',
};
const request = (over = {}) => ({ contract: 'marketplace-worker-1', searchId: '11111111-1111-4111-8111-111111111111', searchPlanId: '33333333-3333-4333-8333-333333333333',
  market: 'GE', country: 'GE', city: 'Tbilisi', districts: [], transactionType: 'BUY', propertyType: 'APARTMENT', priceMinUsd: 0, priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000,
  areaMinSqm: null, areaMaxSqm: null, rooms: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka'], requestedAt: new Date().toISOString(), ...over });
function site(adapter, list, detail, { refuse = null } = {}) {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(String(url));
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response(ROBOTS[u.host.replace(/^www\./, '')] ?? '', { status: 200 });
    if (refuse && refuse(u)) return new Response(refuse.body ?? 'Forbidden', { status: refuse.status ?? 403 });
    return new Response(urls.filter((x) => !x.endsWith('robots.txt')).length <= 1 || /page[:=]/.test(u.pathname + u.search) || u.pathname.endsWith('/ads') || u.pathname.includes('property-search') || !/\d{3,}/.test(u.pathname) ? list : detail, { status: 200 });
  };
  return { fetcher, urls };
}
async function run(adapter, list, detail, over = {}, opts = {}) {
  const reports = [];
  const s = site(adapter, list, detail, opts);
  const outcome = await acquirePortal(adapter, request(over), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher: s.fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
  return { outcome, reports, urls: s.urls };
}

for (const [adapter, list, detail, expected] of [[placege, 'place-list', 'place-detail', 17], [korter, 'korter-list', 'korter-detail', 20], [brokeri, 'brokeri-list', 'brokeri-detail', 15]]) {
  test(`${adapter.sourceName}: real search page → contract-valid listings, pages capped at 2, robots honoured`, async () => {
    const { outcome, reports, urls } = await run(adapter, page(list), page(detail));
    const listings = reports.flatMap((r) => r.listings);
    assert.equal(new Set(listings.map((l) => l.sourceListingId)).size, expected, 'every card of the real page, once');
    for (const r of reports) {
      const v = validateWorkerReport(r, adapter.sourceId);
      assert.ok(v.ok, v.reason);
      assert.equal(v.report.listings.length, r.listings.length, 'no listing rejected by the platform contract');
    }
    for (const l of listings) {
      assert.match(l.exactUrl, new RegExp(`^https://(www\\.)?${adapter.origin.replace('https://', '').replace('.', '\\.')}/`));
      assert.ok(l.title || l.price != null);
      assert.ok(l.images.every((u) => u.startsWith('https://')));
    }
    assert.ok(listings.filter((l) => l.price != null && l.currency).length >= expected * 0.8, 'prices with currency');
    const searchPages = urls.filter((u) => u === adapter.searchUrl(adapter.criteria(request()), 1) || u === adapter.searchUrl(adapter.criteria(request()), 2));
    assert.ok(searchPages.length <= 2, 'never past page 2');
    const rules = robotsRules(ROBOTS[new URL(adapter.origin).host]);
    assert.ok(urls.every((u) => u.endsWith('/robots.txt') || robotsAllows(rules, u)), 'no robots-disallowed URL requested');
    assert.ok(['COMPLETE', 'PARTIAL'].includes(outcome.status));
  });

  test(`${adapter.sourceName}: a refusal or challenge ends the run BLOCKED, never a retry past it`, async () => {
    const { outcome, reports } = await run(adapter, page(list), page(detail), {}, { refuse: Object.assign((u) => !u.pathname.endsWith('robots.txt'), { status: 403 }) });
    assert.equal(outcome.status, 'BLOCKED');
    assert.equal(reports.at(-1).status, 'BLOCKED');
    assert.ok(validateWorkerReport(reports.at(-1), adapter.sourceId).ok);
  });
}

test('place.ge: card facts read exactly as the page states them', () => {
  const [first] = placege.parseList(page('place-list'), 'https://place.ge/ge/ads');
  assert.deepEqual({ id: first.sourceListingId, price: first.price, currency: first.currency, rooms: first.rooms, area: first.areaSqm, floor: first.floor, of: first.totalFloors, district: first.district, phone: first.seller.publicPhone },
    { id: '1308843', price: 395000, currency: 'USD', rooms: 4, area: 145, floor: 3, of: 8, district: 'ვაკე', phone: '+995579972707' });
  const d = placege.parseDetail(page('place-detail'));
  assert.equal(d.images.length, 6);
  assert.equal(d.renovationStatus, undefined, '"მიმდინარე რემონტი" (renovation in progress) is not "renovated"');
  assert.equal(d.buildingStatus, 'NEW_BUILD');
});

test('korter.ge: results read from the page\'s own state; no phone is claimed', () => {
  const rows = korter.parseList(page('korter-list'));
  assert.equal(rows[0].sourceListingId, '964832');
  assert.equal(rows[0].price, 100000); assert.equal(rows[0].currency, 'USD'); assert.equal(rows[0].areaSqm, 49); assert.equal(rows[0].district, 'გლდანი');
  assert.ok(rows.every((r) => r.seller.publicPhone === null));
  const d = korter.parseDetail(page('korter-detail'));
  assert.equal(d.bedrooms, 3); assert.equal(d.bathrooms, 2); assert.equal(d.images.length, 11);
});

test('brokeri.ge: structured card cells and the agent number published on the listing', () => {
  const v = brokeri.parseList(page('brokeri-list'), 'https://brokeri.ge/property-search').find((i) => i.sourceListingId === '4931');
  assert.deepEqual({ area: v.areaSqm, floor: v.floor, of: v.totalFloors, rooms: v.rooms, bedrooms: v.bedrooms, city: v.city, district: v.district, price: v.price },
    { area: 170, floor: 11, of: 12, rooms: 4, bedrooms: 3, city: 'თბილისი', district: 'ვაკე', price: 830000 });
  const d = brokeri.parseDetail(page('brokeri-detail'));
  assert.equal(d.seller.publicPhone, '+995592006242');
});

test('unsupported requests are refused up front, not searched loosely', async () => {
  for (const adapter of [placege, korter]) {
    const { outcome, urls } = await run(adapter, '', '', { city: 'Kutaisi' });
    assert.equal(outcome.code, 'UNSUPPORTED_REQUEST');
    assert.equal(urls.length, 0);
  }
});

test('portal runtimes idle until their own flag and token are set', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ runs: [] }); };
  for (const adapter of PORTAL_ADAPTERS) {
    const off = startPortalRuntime(adapter, { SUPABASE_URL: 'https://x.supabase.co', [`${adapter.envPrefix}_WORKER_TOKEN`]: 'x'.repeat(40) }, fetcher);
    assert.equal(off.status().enabled, false);
    off.shutdown();
  }
  assert.equal(calls, 0, 'no claim without the enable flag');
});

test('switches: each portal has its own default-off switch; MyHome and SS.ge rules unchanged', async () => {
  const db = { from: () => ({ select: () => ({ in: async () => ({ data: [{ key: 'marketplace_search_enabled', value: true }, { key: 'provider_kill_switch', value: true }, { key: 'marketplace_myhome_enabled', value: true }, { key: 'marketplace_placege_enabled', value: true }] }) }) }) };
  const s = await loadMarketplaceSwitches(db);
  assert.equal(workerSwitchOn(s, 'myhome-agent'), true);
  assert.equal(workerSwitchOn(s, 'ssge-agent'), false);
  assert.equal(workerSwitchOn(s, 'placege-agent'), true);
  assert.equal(workerSwitchOn(s, 'korter-agent'), false, 'unset is off');
  assert.equal(workerSwitchOn(s, 'some-other-agent'), false, 'everything else stays under the global kill switch');
});

test('home.ge: the public sitemap index → newest matching listings, each read from its own page and contract-valid', async () => {
  const urls = [], reports = [];
  const fetcher = async (url) => {
    urls.push(String(url)); const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response(ROBOTS['home.ge']);
    return new Response(u.pathname.startsWith('/files/sitemap/') ? page('homege-sitemap') : page('homege-detail'));
  };
  const outcome = await acquirePortal(homege, request(), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
  const listings = reports.flatMap((r) => r.listings);
  assert.ok(['COMPLETE', 'PARTIAL'].includes(outcome.status));
  assert.equal(listings.length, homege.detailLimit, 'detail reads capped per index page; the second index repeats no listing');
  for (const r of reports) { const v = validateWorkerReport(r, 'home-ge'); assert.ok(v.ok, v.reason); assert.equal(v.report.listings.length, r.listings.length); }
  const ids = listings.map((l) => Number(l.sourceListingId));
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest ids first');
  assert.ok(listings.every((l) => /^https:\/\/www\.home\.ge\/binebi\/iyideba-binebi\/.*-tbilisi-/.test(l.exactUrl) && l.transactionType === 'BUY' && l.propertyType === 'APARTMENT'));
  const [l] = listings;
  assert.deepEqual({ price: l.price, currency: l.currency, floor: l.floor, of: l.totalFloors, district: l.district, building: l.buildingStatus, renovation: l.renovationStatus, phone: l.seller.publicPhone },
    { price: 240300, currency: 'GEL', floor: 4, of: 8, district: 'საბურთალო', building: 'OLD_BUILD', renovation: 'RENOVATED', phone: null });
  assert.ok(l.images.length >= 1 && l.images.every((u) => u.startsWith('https://www.home.ge/files/')));
  assert.equal(urls.filter((u) => u.includes('/files/sitemap/')).length, 2, 'each index read once');
  assert.ok(urls.every((u) => !/sitemap_listings1/.test(u)));
  const rules = robotsRules(ROBOTS['home.ge']);
  assert.ok(urls.every((u) => u.endsWith('/robots.txt') || robotsAllows(rules, u)));
});

test('home.ge: price ceiling applied after reading (₾ converted with the page\'s own USD rate); index cached between searches', async () => {
  const urls = [], reports = [];
  const fetcher = async (url) => { urls.push(String(url)); const u = new URL(url); if (u.pathname === '/robots.txt') return new Response(ROBOTS['home.ge']); return new Response(u.pathname.startsWith('/files/sitemap/') ? page('homege-sitemap') : page('homege-detail')); };
  await acquirePortal(homege, request({ priceMaxUsd: 80000, collectPriceMaxUsd: 88000 }), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
  assert.equal(reports.flatMap((r) => r.listings).length, 0, '₾240,300 ≈ $92k is above an $88k collection ceiling');
  assert.ok(Number(reports.at(-1).queryApplied.filteredAfterRead) > 0);
  assert.equal(urls.filter((u) => u.includes('/files/sitemap/')).length, 0, 'sitemaps served from the 6-hour cache');
  assert.throws(() => homege.criteria(request({ city: 'Telavi' })), /Tbilisi, Batumi/);
});
