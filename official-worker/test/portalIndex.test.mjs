// Worker-local portal index (src/marketplace/portals/index/PortalIndex.mjs): politeness,
// warm/cold switch, the shared loop's acceptance rules applied to indexed facts,
// eviction and refresh. Fixtures only — no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { acquirePortal } from '../src/marketplace/portals/acquire.mjs';
import { createPortalIndex } from '../src/marketplace/portals/index/PortalIndex.mjs';
import { startPortalRuntime } from '../src/marketplace/portals/runtime.mjs';
import { PORTAL_ADAPTERS } from '../src/marketplace/portals/adapters.mjs';
import { allhome } from '../src/marketplace/portals/adapters/allhome.mjs';
import { homege } from '../src/marketplace/portals/adapters/homege.mjs';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';

const page = (name) => gunzipSync(readFileSync(new URL(`fixtures/portals/${name}.html.gz`, import.meta.url))).toString('utf8');
const request = (over = {}) => ({ contract: 'marketplace-worker-1', searchId: '11111111-1111-4111-8111-111111111111', searchPlanId: '33333333-3333-4333-8333-333333333333',
  market: 'GE', country: 'GE', city: 'Tbilisi', districts: [], transactionType: 'BUY', propertyType: 'APARTMENT', priceMinUsd: 0, priceMaxUsd: 1000000, collectPriceMaxUsd: 1100000,
  areaMinSqm: null, areaMaxSqm: null, rooms: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka'], requestedAt: new Date().toISOString(), ...over });

/* A tiny portal whose sitemap and listing pages are JSON, so each listing can state its own facts. */
const CITY = { tbilisi: 'თბილისი', batumi: 'ბათუმი' };
function fakeAdapter(over = {}) {
  return {
    workerId: 'fake-agent', sourceId: 'allhome-ge', sourceName: 'Fake.ge', envPrefix: 'FAKE', origin: 'https://www.fake.ge',
    deepMaxPages: 3, filtersAfterRead: true, maxPages: 1, pagesIndependent: true, detailLimit: 24, detailIntervalMs: 900, pageIntervalMs: 1000,
    indexed: true, indexCityAgnostic: true,
    indexSegments: [{ transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi' }, { transactionType: 'MONTHLY_RENT', propertyType: 'APARTMENT', city: 'Tbilisi' }],
    criteria(r) {
      const city = CITY[String(r.city ?? '').toLowerCase()];
      if (!city || r.propertyType !== 'APARTMENT' || !['BUY', 'MONTHLY_RENT'].includes(r.transactionType)) throw Object.assign(Error('unsupported'), { code: 'UNSUPPORTED_REQUEST' });
      return { city, transactionType: r.transactionType, propertyType: r.propertyType };
    },
    searchUrl() { return 'https://www.fake.ge/sitemap.xml'; },
    parseList(text, _url, c) {
      return JSON.parse(text).filter((l) => l.deal === c.transactionType).map((l) => ({ sourceListingId: String(l.id), url: `https://www.fake.ge/l/${l.id}.html`, transactionType: c.transactionType, propertyType: c.propertyType }))
        .sort((a, b) => Number(b.sourceListingId) - Number(a.sourceListingId));
    },
    parseDetail(html) { const f = JSON.parse(html); return { title: `flat ${f.id}`, price: f.price, currency: 'USD', areaSqm: f.area, rooms: f.rooms, city: f.city, district: f.district, buildingStatus: f.building, publishedAt: f.published ?? undefined }; },
    accept(fields, c) { return !fields.city || fields.city === c.city; },
    ...over,
  };
}
function fakeSite(listings, { robots = 'User-agent: *\nDisallow:\n', status = {} } = {}) {
  const calls = [];
  const state = { listings, robots };
  const fetcher = async (url) => {
    const u = new URL(url); calls.push({ url: String(url), at: state.clock?.() ?? null });
    if (u.pathname === '/robots.txt') return new Response(state.robots);
    if (u.pathname === '/sitemap.xml') return new Response(JSON.stringify(state.listings.map(({ id, deal }) => ({ id, deal }))));
    const id = Number(u.pathname.match(/(\d+)\.html$/)?.[1]);
    if (status[id]) return new Response('nope', { status: status[id] });
    const l = state.listings.find((x) => x.id === id);
    return l ? new Response(JSON.stringify(l)) : new Response('gone', { status: 404 });
  };
  return { fetcher, calls, state };
}
function clockwork() {
  let t = Date.parse('2026-10-16T08:00:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}
const listing = (id, over = {}) => ({ id, deal: 'BUY', price: 130000, area: 95, rooms: 3, city: 'თბილისი', district: 'ვაკე', building: 'NEW_BUILD', published: '2026-10-15T00:00:00.000Z', ...over });
async function warmUp(index, max = 1000) { for (let i = 0; i < max; i++) if ((await index.step()) !== 'read') return i; return max; }

test('index: one site request at a time, ≥ 1 s apart, robots honoured, warm only after the window is read', async () => {
  const c = clockwork();
  const site = fakeSite([listing(101), listing(102), listing(103), listing(104, { deal: 'MONTHLY_RENT', price: 1200 })], { robots: 'User-agent: *\nDisallow: /l/103.html\n' });
  site.state.clock = c.now;
  const index = createPortalIndex(fakeAdapter(), { fetcher: site.fetcher, now: c.now, sleep: c.sleep });
  assert.deepEqual(index.lookup(fakeAdapter().criteria(request())), { warm: false, coverage: 0, segment: 'BUY|APARTMENT|*' }, 'before the sitemap is read, nothing is known');
  await index.step();
  assert.equal(index.lookup(fakeAdapter().criteria(request())).warm, false, 'sitemap read, listings not yet → cold');
  await warmUp(index);
  const at = site.calls.map((x) => x.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 1000, `request ${i} paced (${at[i] - at[i - 1]} ms)`);
  assert.ok(!site.calls.some((x) => x.url.endsWith('/l/103.html')), 'robots-disallowed page never requested');
  const stats = index.stats();
  assert.equal(stats.entries, 3);
  assert.deepEqual(stats.segments.map((s) => [s.key, s.warm]), [['BUY|APARTMENT|*', true], ['MONTHLY_RENT|APARTMENT|*', true]]);
  assert.equal(await index.step(), 'idle', 'nothing new and nothing stale → idle');
});

test('index: a held site makes the crawler wait (a search is reading it); release resumes', async () => {
  const c = clockwork();
  const site = fakeSite([listing(1), listing(2)]);
  const index = createPortalIndex(fakeAdapter(), { fetcher: site.fetcher, now: c.now, sleep: c.sleep });
  const release = index.hold();
  assert.equal(await index.step(), 'held');
  assert.equal(site.calls.length, 0);
  release();
  assert.equal(await index.step(), 'read');
});

test('warm search: the shared acceptance rules on indexed facts, best first, no site request, observedAt = when the page was read', async () => {
  const c = clockwork();
  const site = fakeSite([
    listing(201), // fits
    listing(202, { price: 150000 }), // over the collect ceiling
    listing(203, { area: 70 }), // too small
    listing(204, { rooms: 2 }), // too few rooms
    listing(205, { district: 'საბურთალო' }), // another district
    listing(206, { city: 'ბათუმი' }), // another city (adapter.accept)
    listing(207, { building: 'OLD_BUILD' }), // fits; ranked below the requested new build
    listing(208, { price: 138000, published: '2026-08-01T00:00:00.000Z' }), // fits, older listing
    listing(209, { price: 1 }), // placeholder price → no price, still fits on the rest
    listing(210, { deal: 'MONTHLY_RENT', price: 1500 }),
  ]);
  const adapter = fakeAdapter();
  const index = createPortalIndex(adapter, { fetcher: site.fetcher, now: c.now, sleep: c.sleep });
  await warmUp(index);
  const readAt = index.entry(201).fetchedAt;
  c.advance(3 * 3600000);
  const acquireCalls = [], reports = [];
  const req = request({ districts: ['Vake'], priceMinUsd: 120000, priceMaxUsd: 140000, collectPriceMaxUsd: 140000, areaMinSqm: 80, areaMaxSqm: 110, rooms: { min: 3, max: null }, buildingStatuses: ['NEW_BUILD'] });
  const outcome = await acquirePortal(adapter, req, { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index,
    fetcher: async (u) => { acquireCalls.push(String(u)); return new Response(''); }, report: async (r) => { reports.push(r); } });
  assert.equal(outcome.status, 'COMPLETE');
  assert.equal(outcome.index, 'WARM');
  assert.equal(acquireCalls.length, 0, 'no sitemap, robots or page request at search time');
  const listings = reports.flatMap((r) => r.listings);
  assert.deepEqual(listings.map((l) => l.sourceListingId), ['201', '209', '208', '207'], 'requested new build, recent, priced first');
  assert.equal(listings[0].observedAt, new Date(readAt).toISOString(), 'freshness is when the page was read, not now');
  assert.equal(listings.find((l) => l.sourceListingId === '209').price, null, 'placeholder price removed as in the loop');
  for (const r of reports) { const v = validateWorkerReport(r, 'allhome-ge', new Date(c.now())); assert.ok(v.ok, v.reason); assert.equal(v.report.listings.length, r.listings.length); }
  const q = reports.at(-1).queryApplied;
  assert.equal(q.index, 'WARM'); assert.equal(q.filteredAfterRead, '5'); assert.equal(q.indexMatched, '4'); assert.equal(q.indexOldestMinutes, '180');
  assert.ok(listings.every((l) => l.retrievalMetadata.index === true));

  const capped = [];
  await acquirePortal(adapter, { ...req, maxResults: 2 }, { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index, fetcher: async () => new Response(''), report: async (r) => { capped.push(r); } });
  assert.deepEqual(capped.flatMap((r) => r.listings).map((l) => l.sourceListingId), ['201', '209'], 'request.maxResults respected');
});

test('cold index: the search runs exactly as before (sitemap + pages) and what it reads seeds the index', async () => {
  const c = clockwork();
  const site = fakeSite([listing(301), listing(302), listing(303, { price: 90000 })]);
  const adapter = fakeAdapter();
  const index = createPortalIndex(adapter, { fetcher: async () => { throw Error('index must not fetch here'); }, now: c.now, sleep: c.sleep });
  const reports = [];
  const outcome = await acquirePortal(adapter, request({ priceMinUsd: 100000 }), { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index, fetcher: site.fetcher, report: async (r) => { reports.push(r); } });
  assert.equal(outcome.index, undefined);
  assert.match(reports.at(-1).queryApplied.index, /^COLD/);
  assert.deepEqual(reports.flatMap((r) => r.listings).map((l) => l.sourceListingId).sort(), ['301', '302']);
  assert.ok(site.calls.some((x) => x.url.endsWith('/sitemap.xml')) && site.calls.some((x) => x.url.endsWith('/l/301.html')));
  // Without a loaded sitemap the index has no window, so nothing is absorbed yet …
  assert.equal(index.stats().entries, 0);
  // … once it has one, a cold search's reads land in it.
  const seeded = createPortalIndex(adapter, { fetcher: site.fetcher, now: c.now, sleep: c.sleep });
  await seeded.refreshLists();
  await acquirePortal(adapter, request(), { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index: seeded, fetcher: site.fetcher, report: async () => {} });
  assert.equal(seeded.stats().entries, 3);
  assert.equal(seeded.lookup(adapter.criteria(request())).warm, true, 'the cold search warmed the segment');
});

test('index: capacity keeps the newest per site; a listing leaving the sitemap is evicted; stale entries are re-read; 404 drops; refusal backs off', async () => {
  const c = clockwork();
  const site = fakeSite(Array.from({ length: 8 }, (_, i) => listing(400 + i)));
  const adapter = fakeAdapter({ indexSegments: [{ transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi' }] });
  const index = createPortalIndex(adapter, { fetcher: site.fetcher, now: c.now, sleep: c.sleep, capacity: 5 });
  await warmUp(index);
  assert.equal(index.stats().entries, 5);
  assert.equal(index.entry(402), null, 'oldest ids beyond capacity are not kept');
  assert.ok(index.entry(407) && index.entry(403));

  // New listings appear; the sitemap is re-read after listRefreshMs; the oldest leave the window.
  site.state.listings = [...site.state.listings, listing(408), listing(409)];
  c.advance(31 * 60000);
  await warmUp(index);
  assert.equal(index.stats().entries, 5);
  assert.equal(index.entry(403), null, 'pushed out of the newest window → evicted');
  assert.ok(index.entry(409));
  assert.ok(index.stats().counters.evicted >= 2);

  // 12 h later every entry is stale and re-read, newest facts replace the old.
  const before = index.entry(409).fetchedAt;
  site.state.listings = site.state.listings.map((l) => (l.id === 409 ? { ...l, price: 125000 } : l));
  c.advance(12 * 3600000);
  await warmUp(index);
  assert.ok(index.entry(409).fetchedAt > before);
  assert.equal(index.entry(409).detail.price, 125000);
  assert.ok(index.stats().counters.refreshed >= 5);

  // A refusal backs the whole site off (no request at all meanwhile); a page answering 404 is dropped.
  let refusals = 1, requests = 0;
  const other = createPortalIndex(adapter, { now: c.now, sleep: c.sleep, capacity: 5,
    fetcher: async (u, o) => { requests++;
      if (String(u).endsWith('/l/409.html') && refusals-- > 0) return new Response('Forbidden', { status: 403 });
      return String(u).endsWith('/l/408.html') ? new Response('gone', { status: 404 }) : site.fetcher(u, o); } });
  await assert.rejects(other.step(), { code: 'BLOCKED' });
  assert.equal(other.stats().counters.blocked, 1);
  assert.ok(other.stats().backoffUntil);
  const sent = requests;
  assert.equal(await other.step(), 'backoff');
  assert.equal(requests, sent, 'no request during the back-off');
  c.advance(31 * 60000);
  await warmUp(other);
  assert.equal(other.entry(408), null);
  assert.equal(other.stats().counters.gone, 1);
  assert.ok(other.entry(409), 'read after the back-off');
  assert.equal(other.lookup(adapter.criteria(request())).warm, true, 'a gone listing counts as settled');
});

test('warm search re-reads a stale top match and reads the newest unread listings within its budget', async () => {
  const c = clockwork();
  const site = fakeSite([listing(501), listing(502)]);
  const adapter = fakeAdapter({ indexSegments: [{ transactionType: 'BUY', propertyType: 'APARTMENT', city: 'Tbilisi' }] });
  const index = createPortalIndex(adapter, { fetcher: site.fetcher, now: c.now, sleep: c.sleep, staleMs: 3600000, warmCoverage: 0.5 });
  await warmUp(index);
  // 502 sold above budget since it was read; 503 is new and not yet read by the crawler.
  site.state.listings = [listing(501), listing(502, { price: 200000 }), listing(503)];
  c.advance(31 * 60000); await index.refreshLists();
  c.advance(2 * 3600000);
  const reports = [];
  await acquirePortal(adapter, request({ priceMaxUsd: 140000, collectPriceMaxUsd: 140000 }), { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index, fetcher: async () => new Response(''), report: async (r) => { reports.push(r); } });
  const ids = reports.flatMap((r) => r.listings).map((l) => l.sourceListingId);
  assert.deepEqual(ids.sort(), ['501', '503'], 'stale 502 re-read and dropped; new 503 read on demand');
  assert.equal(Number(reports.at(-1).queryApplied.indexReads), 3);
});

test('allhome.ge / home.ge real pages: the index warms Tbilisi first and answers with contract-valid listings', async () => {
  for (const [adapter, sitemap, detail, robots] of [[homege, 'homege-sitemap', 'homege-detail', 'User-agent: *\nDisallow: /plugins/\n'], [allhome, 'allhome-sitemap', 'allhome-detail', 'User-agent: *\nDisallow: /index.php?*\n']]) {
    const c = clockwork(), urls = [];
    const fetcher = async (url) => { urls.push(String(url)); const u = new URL(url); if (u.pathname === '/robots.txt') return new Response(robots);
      return new Response(/^\/(files\/sitemap|sitemaps)\//.test(u.pathname) ? page(sitemap) : page(detail)); };
    const index = createPortalIndex(adapter, { fetcher, now: c.now, sleep: c.sleep, capacity: 60 });
    await warmUp(index, 200);
    const segs = index.stats().segments;
    assert.equal(segs[0].key.startsWith('BUY|APARTMENT|'), true);
    assert.equal(segs[0].warm, true, `${adapter.sourceName}: Tbilisi sale flats warm`);
    assert.ok(index.stats().entries <= 60, 'capacity honoured');
    assert.ok(urls.every((u) => !u.includes('index.php')));
    const reports = [], fetched = [];
    const outcome = await acquirePortal(adapter, request({ priceMaxUsd: 250000, collectPriceMaxUsd: 275000 }), { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index,
      fetcher: async (u) => { fetched.push(u); return new Response(''); }, report: async (r) => { reports.push(r); } });
    assert.equal(outcome.index, 'WARM', adapter.sourceName);
    assert.equal(fetched.length, 0);
    const listings = reports.flatMap((r) => r.listings);
    assert.ok(listings.length > 0 && listings.length <= (adapter.indexResultCap ?? 60));
    for (const r of reports) { const v = validateWorkerReport(r, adapter.sourceId, new Date(c.now())); assert.ok(v.ok, v.reason); assert.equal(v.report.listings.length, r.listings.length); }
    assert.ok(listings.every((l) => l.city === 'თბილისი' && l.price != null && l.transactionType === 'BUY'));
    // A request the stated facts contradict: nothing delivered, everything counted as filtered.
    const none = [];
    await acquirePortal(adapter, request({ priceMaxUsd: 50000, collectPriceMaxUsd: 50000 }), { deadlineAt: new Date(c.now() + 600000).toISOString(), now: c.now, sleep: c.sleep, index, fetcher: async () => new Response(''), report: async (r) => { none.push(r); } });
    assert.equal(none.flatMap((r) => r.listings).length, 0);
    assert.ok(Number(none.at(-1).queryApplied.filteredAfterRead) > 0);
  }
});

test('runtime: the index starts only for indexed, enabled, configured portals and can be switched off', () => {
  const started = [];
  const createIndex = (adapter) => ({ start() { started.push(adapter.workerId); }, stop() {}, hold: () => () => {}, stats: () => ({ enabled: true }) });
  const acquire = async () => ({ status: 'COMPLETE' });
  const env = (a, extra = {}) => ({ SUPABASE_URL: 'https://x.supabase.co', [`${a.envPrefix}_WORKER_TOKEN`]: 'x'.repeat(40), [`${a.envPrefix}_MARKETPLACE_ENABLED`]: 'true', ...extra });
  const idle = async () => new Promise(() => {});
  for (const a of PORTAL_ADAPTERS) {
    const rt = startPortalRuntime(a, env(a), idle, acquire, createIndex);
    assert.equal(rt.status().index.enabled, a.indexed === true, a.workerId);
    rt.shutdown();
    const off = startPortalRuntime(a, env(a, { PORTAL_INDEX_ENABLED: 'false' }), idle, acquire, createIndex);
    assert.equal(off.status().index.enabled, false);
    off.shutdown();
    const disabled = startPortalRuntime(a, { ...env(a), [`${a.envPrefix}_MARKETPLACE_ENABLED`]: 'false' }, idle, acquire, createIndex);
    assert.equal(disabled.status().index.enabled, false, 'a disabled portal is never crawled');
    disabled.shutdown();
  }
  assert.deepEqual(started.sort(), ['allhome-agent', 'homege-agent']);
});
