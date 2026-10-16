// Find Property HTML portals (place.ge, home.ge, brokeri.ge, allhome.ge) against pages the sites
// actually served on 2026-10-15 (test/fixtures/portals/*.html.gz, unmodified), through
// the shared acquisition loop, with every report checked by the platform's own
// worker-contract validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { acquirePortal, contradiction, robotsRules, robotsAllows } from '../src/marketplace/portals/acquire.mjs';
import { startPortalRuntime } from '../src/marketplace/portals/runtime.mjs';
import { PORTAL_ADAPTERS } from '../src/marketplace/portals/adapters.mjs';
import { placege } from '../src/marketplace/portals/adapters/placege.mjs';
import { brokeri } from '../src/marketplace/portals/adapters/brokeri.mjs';
import { homege } from '../src/marketplace/portals/adapters/homege.mjs';
import { allhome } from '../src/marketplace/portals/adapters/allhome.mjs';
import { TBILISI_DISTRICT_ROWS, districtConflict } from '../src/marketplace/portals/places.mjs';
import { comparePlaces } from '../../src/research-core/normalize/place.ts';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';
import { loadMarketplaceSwitches, workerSwitchOn } from '../../supabase/functions/_shared/marketplaceSearch.ts';

const page = (name) => gunzipSync(readFileSync(new URL(`fixtures/portals/${name}.html.gz`, import.meta.url))).toString('utf8');
const ROBOTS = {
  'place.ge': 'User-agent: *\nDisallow: /admin*\n',
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

for (const [adapter, list, detail, expected] of [[placege, 'place-list', 'place-detail', 16], [brokeri, 'brokeri-list', 'brokeri-detail', 13]]) {
  test(`${adapter.sourceName}: real search page → contract-valid listings, pages capped at 2, robots honoured`, async () => {
    const { outcome, reports, urls } = await run(adapter, page(list), page(detail));
    const listings = reports.flatMap((r) => r.listings);
    assert.equal(new Set(listings.map((l) => l.sourceListingId)).size, expected, 'every card of the real (unfiltered) page that does not contradict the BUY request, once');
    assert.ok(listings.every((l) => l.transactionType === 'BUY'), 'a rent listing on an unfiltered page is never delivered for a purchase');
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

test('brokeri.ge: structured card cells and the agent number published on the listing', () => {
  const v = brokeri.parseList(page('brokeri-list'), 'https://brokeri.ge/property-search').find((i) => i.sourceListingId === '4931');
  assert.deepEqual({ area: v.areaSqm, floor: v.floor, of: v.totalFloors, rooms: v.rooms, bedrooms: v.bedrooms, city: v.city, district: v.district, price: v.price },
    { area: 170, floor: 11, of: 12, rooms: 4, bedrooms: 3, city: 'თბილისი', district: 'ვაკე', price: 830000 });
  const d = brokeri.parseDetail(page('brokeri-detail'));
  assert.equal(d.seller.publicPhone, '+995592006242');
});

test('unsupported requests are refused up front, not searched loosely', async () => {
  for (const adapter of [placege, homege]) {
    const { outcome, urls } = await run(adapter, '', '', { city: 'Telavi' });
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
  assert.equal(workerSwitchOn(s, 'homege-agent'), false, 'unset is off');
  assert.equal(workerSwitchOn(s, 'korter-agent'), false, 'korter.ge is not a Find Property worker (terms forbid scraping)');
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

test('shared loop: a listing is dropped only when its own stated deal, USD price, rooms or area contradicts the request', () => {
  const req = { transactionType: 'BUY', priceMinUsd: 50000, priceMaxUsd: 200000, collectPriceMaxUsd: 220000, rooms: { min: 2, max: 3 }, areaMinSqm: 40, areaMaxSqm: null };
  assert.equal(contradiction({ transactionType: 'BUY', price: 150000, currency: 'USD', rooms: 2, areaSqm: 60 }, req), null);
  assert.equal(contradiction({ price: 210000, currency: 'USD' }, req), null, 'inside the collection margin');
  assert.equal(contradiction({ price: 230000, currency: 'USD' }, req), 'price');
  assert.equal(contradiction({ price: 900000, currency: 'GEL' }, req), null, 'no USD figure → never excluded on price');
  assert.equal(contradiction({ price: 900000, currency: 'GEL', _usd: 330000 }, req), 'price', "the portal's own USD conversion is used");
  assert.equal(contradiction({ rooms: 4 }, req), 'rooms');
  assert.equal(contradiction({ areaSqm: 30 }, req), 'area');
  assert.equal(contradiction({ transactionType: 'MONTHLY_RENT' }, req), 'deal');
  assert.equal(contradiction({}, req), null, 'unknown values never exclude');
});

test('districts: the worker table is the core place table; a listing naming another place is dropped, one naming none is kept', () => {
  for (const row of TBILISI_DISTRICT_ROWS) for (const name of row) assert.equal(comparePlaces(name, row[0]), 'AGREE', `${name} is one place with ${row[0]} in the core table`);
  for (const a of TBILISI_DISTRICT_ROWS) for (const b of TBILISI_DISTRICT_ROWS) if (a !== b) assert.equal(comparePlaces(a[1], b[0]), 'CONFLICT');
  const req = { districts: ['Krtsanisi', 'ორთაჭალა'] };
  assert.equal(districtConflict('კრწანისი', req), false);
  assert.equal(districtConflict('Ortachala', req), false);
  assert.equal(districtConflict('საბურთალო', req), true);
  assert.equal(contradiction({ district: 'ვაკე' }, req), 'district');
  assert.equal(districtConflict('ვაშლიჯვარი', req), true, 'a named neighbourhood that is not a requested district is dropped (live run 2026-10-16)');
  assert.equal(districtConflict('საბურთალო', { districts: ['Krtsanisi', 'Abanotubani'] }), false, 'a partly unknown request is not narrowed');
  assert.equal(districtConflict(null, req), false);
});

test('place.ge: its server ignores district parameters, so none is sent; the city is read and each card checked', () => {
  const c = placege.criteria(request({ districts: ['Krtsanisi'] }));
  const u = new URL(placege.searchUrl(c, 1));
  assert.equal(['district_id', 'region_id', 'selected_places'].some((k) => u.searchParams.has(k)), false);
  assert.equal(contradiction({ district: 'საბურთალო' }, request({ districts: ['Krtsanisi'] })), 'district');
  assert.equal(contradiction({ district: 'კრწანისი' }, request({ districts: ['Krtsanisi'] })), null);
});

test('shared loop: a placeholder price ("1 ₾") is removed, never shown as an in-budget price', async () => {
  const { withoutPlaceholderPrice } = await import('../src/marketplace/portals/acquire.mjs');
  const f = withoutPlaceholderPrice({ title: 't', price: 1, currency: 'GEL', _usd: 0.37, pricePerSqm: 0 });
  assert.equal(f.price, undefined); assert.equal(f.currency, undefined); assert.equal(f._usd, undefined);
  assert.match(f.evidence.at(-1).text, /placeholder price 1 GEL/);
  assert.equal(withoutPlaceholderPrice({ price: 450, currency: 'USD' }).price, 450);
});

test('home.ge: a requested district narrows the sitemap by its slug', () => {
  const xml = page('homege-sitemap');
  const rent = { transactionType: 'MONTHLY_RENT' };
  const all = homege.parseList(xml, '', homege.criteria(request(rent)));
  const orta = homege.parseList(xml, '', homege.criteria(request({ ...rent, districts: ['ორთაჭალა'] })));
  assert.ok(orta.length > 0 && orta.length < all.length);
  assert.ok(orta.every((i) => /-tbilisi-ortachala-\d+\.html$/.test(i.url)));
  assert.equal(homege.parseList(xml, '', homege.criteria(request({ ...rent, districts: ['Ortachala', 'Unknownville'] }))).length, all.length, 'unknown name → city read');
});

test('registry: korter.ge (terms forbid scraping) and binebi.ge (challenge) are not portal workers', () => {
  const ids = PORTAL_ADAPTERS.map((a) => a.sourceId);
  assert.ok(!ids.includes('korter-ge') && !ids.includes('binebi-ge'));
  const sql = readFileSync(new URL('../../supabase/migrations/20261104100000_find_property_portal_workers.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /korter|binebi/i);
});

const ALLHOME_ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /index.php?*\nDisallow: /admin/*\nDisallow: /ajax/*\nDisallow: /uploads/*\nDisallow: /*send*\nDisallow: /*login*\n';
test('allhome.ge: its sitemap → newest flats for sale, each read from its own page; never an index.php URL', async () => {
  const urls = [], reports = [];
  const fetcher = async (url) => { urls.push(String(url)); const u = new URL(url); if (u.pathname === '/robots.txt') return new Response(ALLHOME_ROBOTS);
    return new Response(u.pathname.startsWith('/sitemaps/') ? page('allhome-sitemap') : page('allhome-detail')); };
  const outcome = await acquirePortal(allhome, request({ priceMaxUsd: 250000, collectPriceMaxUsd: 275000 }), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
  const listings = reports.flatMap((r) => r.listings);
  assert.equal(outcome.status, 'COMPLETE');
  assert.equal(listings.length, allhome.detailLimit);
  for (const r of reports) { const v = validateWorkerReport(r, 'allhome-ge'); assert.ok(v.ok, v.reason); assert.equal(v.report.listings.length, r.listings.length); }
  assert.equal(listings[0].sourceListingId, '166588', 'newest id first');
  assert.ok(listings.every((l) => /^https:\/\/www\.allhome\.ge\/binebis-(kidva-gakidva|yidva-gayidva)-\d+-10\.html$/.test(l.exactUrl)));
  const rules = robotsRules(ALLHOME_ROBOTS);
  assert.ok(urls.every((u) => u.endsWith('/robots.txt') || robotsAllows(rules, u)) && urls.every((u) => !u.includes('index.php')));
  const l = listings[0];
  assert.deepEqual({ price: l.price, currency: l.currency, area: l.areaSqm, rooms: l.rooms, floor: l.floor, of: l.totalFloors, city: l.city, district: l.district, building: l.buildingStatus, renovation: l.renovationStatus, published: l.publishedAt, phone: l.seller.publicPhone },
    { price: 94000, currency: 'USD', area: 58, rooms: 2, floor: 10, of: 15, city: 'თბილისი', district: 'ვაშლიჯვარი', building: 'NEW_BUILD', renovation: 'RENOVATED', published: '2026-10-15T00:00:00.000Z', phone: null });
  assert.equal(l.images.length, 5);
});

test('allhome.ge: a listing outside the requested city is dropped after reading (the slug does not state it)', async () => {
  const reports = [];
  const fetcher = async (url) => { const u = new URL(url); if (u.pathname === '/robots.txt') return new Response(ALLHOME_ROBOTS); return new Response(u.pathname.startsWith('/sitemaps/') ? page('allhome-sitemap') : page('allhome-detail')); };
  await acquirePortal(allhome, request({ city: 'Batumi' }), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
  assert.equal(reports.flatMap((r) => r.listings).length, 0);
  assert.equal(reports.at(-1).queryApplied.filteredAfterRead, String(allhome.detailLimit));
  assert.throws(() => allhome.criteria(request({ propertyType: 'LAND' })), /flats/);
});

test('results pipeline: real reports from the portals become result properties that name their source; the rest fall only to platform rules', async () => {
  const { processSearch, publicView } = await import('../../src/research-core/marketplace/pipeline.ts');
  const serve = { 'place.ge': ['place-list', 'place-detail'], 'brokeri.ge': ['brokeri-list', 'brokeri-detail'], 'www.home.ge': ['homege-sitemap', 'homege-detail'], 'www.allhome.ge': ['allhome-sitemap', 'allhome-detail'] };
  const candidates = [];
  for (const adapter of PORTAL_ADAPTERS) {
    const [list, detail] = serve[new URL(adapter.origin).host];
    const fetcher = async (url) => { const u = new URL(url); if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow:\n');
      return new Response(/\/(ads|property-search|files\/sitemap|sitemaps)/.test(u.pathname) ? page(list) : page(detail)); };
    const reports = [];
    await acquirePortal(adapter, request({ priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000 }), { deadlineAt: new Date(Date.now() + 600000).toISOString(), fetcher, sleep: async () => {}, report: async (r) => { reports.push(r); } });
    for (const r of reports) { const v = validateWorkerReport(r, adapter.sourceId); assert.ok(v.ok, v.reason); for (const candidate of v.report.listings) candidates.push({ workerId: adapter.workerId, candidate }); }
  }
  // Fixtures were captured on 2026-10-15; the 30-day listing-age policy is judged as of then.
  const out = processSearch({ now: new Date('2026-10-15T00:00:00Z'), request: request({ priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000 }), candidates, converter: { name: 'test', convert: (amount, from, to) => (from === 'GEL' && to === 'USD' ? { amount: amount * 0.37, rate: 0.37 } : null) } });
  const names = new Set(out.properties.map(publicView).flatMap((p) => p.listings.map((l) => l.sourceName)));
  for (const a of PORTAL_ADAPTERS.filter((x) => x.sourceId !== 'brokeri-ge')) assert.ok(names.has(a.sourceName), `${a.sourceName} listings reach the result set (${[...names].join(', ')})`);
  // The Brokeri fixture is its unfiltered front page: land, other cities, and one Tbilisi flat
  // from February. Every one is turned away by the platform's own rules, never by the adapter.
  const reasons = Object.keys(out.stats.rejected);
  assert.ok(reasons.every((r) => ['PROPERTY_TYPE_MISMATCH', 'CITY_MISMATCH', 'LISTING_OVER_30_DAYS', 'NO_PRICE'].includes(r)), reasons.join(','));
});
