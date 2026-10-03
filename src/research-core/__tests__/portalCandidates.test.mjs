// PHASE 2 candidate portals (myhome.ge, livo.ge) and the discovery-browser
// transport. Fixtures here are SYNTHETIC (schema.org-shaped pages written for
// the test, not captures): they prove the mechanism, never that the real site
// answers. LIVE_TESTED is only ever set by a production live check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createPortalRuntime } from '../market/runtime.ts';
import { createAuditPortalRuntime } from '../discovery/audit-runtime.ts';
import { runtimePortalAdapterIds } from '../discovery/portal-selection.ts';
import { MYHOME_GE, LIVO_GE, declaredSitemaps, childSitemaps, unwrapRenderedText } from '../adapters/portal/candidates.ts';
import { BrowserTransport, RoutingTransport, estimatedCostUsd } from '../fetch/browser-transport.ts';

const listingPage = (id, { price = 185000, city = 'თბილისი', rooms = 3, area = 90 } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="იყიდება ${rooms} ოთახიანი ბინა კრწანისში">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'RealEstateListing',
  name: `იყიდება ${rooms} ოთახიანი ბინა`, url: `https://www.myhome.ge/pr/${id}/iyideba-bina`,
  description: `${area} მ² · ${rooms} ოთახი · 7/8 სართული. დარეკეთ 599 12 34 56`,
  datePosted: '2026-09-30',
  offers: { '@type': 'Offer', priceCurrency: 'USD', price },
  address: { '@type': 'PostalAddress', addressLocality: city, streetAddress: 'კრწანისის ქ. 6' },
})}</script></head><body><h1>იყიდება ბინა</h1><p>${area} მ² ${rooms} ოთახი 7/8 სართული</p>${'x'.repeat(300)}</body></html>`;

function fakeTransport(pages) {
  const seen = [];
  return {
    seen,
    name: 'fake', pinsAddresses: false,
    async send(request) {
      seen.push(request.url);
      const body = pages[request.url];
      return { url: request.url, status: body === undefined ? 404 : (typeof body === 'object' ? body.status : 200), headers: { 'content-type': 'text/html' },
        body: typeof body === 'object' ? body.body : (body ?? ''), bytes: 1, truncated: false, durationMs: 1 };
    },
  };
}

const QUERY = {
  id: 'live-check-x', transaction: 'SALE', countryCode: 'GE', city: 'Tbilisi', propertyType: 'APARTMENT',
  district: null, subDistrict: null, projectName: null, area: { min: null, max: null }, rooms: { min: null, max: null },
  bedrooms: { min: null, max: null }, floor: { min: null, max: null }, price: { min: null, max: null }, priceCurrency: null,
  languages: [], limit: 2, rationale: 'test',
};

test('candidates are invisible to every customer path and visible only to the live check', () => {
  const normal = createPortalRuntime().registry.all().map((a) => a.id);
  assert.ok(!normal.includes('myhome-ge') && !normal.includes('livo-ge'));
  assert.ok(!runtimePortalAdapterIds().includes('myhome-ge'));
  const audit = createAuditPortalRuntime().registry.all().map((a) => a.id);
  assert.ok(audit.includes('myhome-ge') && audit.includes('livo-ge'));
});

test('robots-declared sitemaps only; a sitemap index is expanded listing-first', () => {
  const robots = 'User-agent: *\nDisallow: /user\nSitemap: https://www.myhome.ge/sitemap.xml\nSitemap: https://evil.example/s.xml\nSitemap: javascript:alert(1)\n';
  assert.deepEqual(declaredSitemaps(robots, 'www.myhome.ge'), ['https://www.myhome.ge/sitemap.xml']);
  const index = '<sitemapindex><sitemap><loc>https://www.myhome.ge/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://www.myhome.ge/sitemap-statements-1.xml</loc></sitemap></sitemapindex>';
  assert.deepEqual(childSitemaps(index), ['https://www.myhome.ge/sitemap-statements-1.xml', 'https://www.myhome.ge/sitemap-pages.xml']);
  assert.equal(unwrapRenderedText('<html><body><pre>User-agent: *\nSitemap: https://a.ge/s.xml</pre></body></html>'), 'User-agent: *\nSitemap: https://a.ge/s.xml');
});

test('detail patterns accept a numeric listing id and reject everything else', () => {
  assert.equal(MYHOME_GE.detailUrl.pattern.exec('https://www.myhome.ge/pr/20592132/iyideba-3-otaxiani-bina')?.[1], '20592132');
  assert.equal(MYHOME_GE.detailUrl.pattern.exec('https://www.myhome.ge/ka/krtsanisi-20592132')?.[1], '20592132');
  assert.equal(MYHOME_GE.detailUrl.pattern.test('https://www.myhome.ge/about'), false);
  assert.equal(LIVO_GE.detailUrl.pattern.exec('https://livo.ge/ka/listing/1234567')?.[1], '1234567');
  assert.equal(LIVO_GE.detailUrl.pattern.test('https://livo.ge/blog/2026'), false);
});

test('a candidate reads robots → sitemap → listing pages and normalizes them (SYNTHETIC pages)', async () => {
  const pages = {
    'https://livo.ge/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://livo.ge/sitemap.xml\n',
    'https://livo.ge/sitemap.xml': '<urlset><url><loc>https://livo.ge/ka/about</loc></url><url><loc>https://livo.ge/ka/iyideba/bina/1234567</loc></url><url><loc>https://livo.ge/ka/iyideba/bina/7654321</loc></url></urlset>',
    'https://livo.ge/ka/iyideba/bina/1234567': listingPage('1234567'),
    'https://livo.ge/ka/iyideba/bina/7654321': listingPage('7654321', { price: 99000, rooms: 2, area: 55 }),
  };
  const transport = fakeTransport(pages);
  const runtime = createAuditPortalRuntime({ transport, documentCache: new Map() });
  const livo = runtime.registry.all().find((a) => a.id === 'livo-ge');
  const outcome = await livo.searchListings(QUERY, runtime.context);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(outcome.value.listings.length, 2);
  const first = outcome.value.listings[0];
  assert.equal(first.externalId, '1234567');
  assert.equal(first.url, 'https://livo.ge/ka/iyideba/bina/1234567', 'exact listing provenance');
  assert.equal(first.listing.sale.amount, 185000);
  assert.equal(first.listing.area?.value, 90);
  assert.equal(first.listing.rooms, 3);
  assert.ok(!transport.seen.includes('https://livo.ge/ka/about'), 'non-listing URLs are never fetched');
});

test('a candidate with no declared sitemap refuses rather than guessing paths', async () => {
  const transport = fakeTransport({ 'https://livo.ge/robots.txt': 'User-agent: *\nAllow: /\n' });
  const runtime = createAuditPortalRuntime({ transport, documentCache: new Map() });
  const outcome = await runtime.registry.all().find((a) => a.id === 'livo-ge').searchListings(QUERY, runtime.context);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'PARSE_FAILED');
  assert.deepEqual([...new Set(transport.seen)], ['https://livo.ge/robots.txt'], 'nothing but robots.txt was requested');
});

test('myhome.ge goes through the discovery browser; every other host stays on plain HTTP', async () => {
  const http = fakeTransport({
    'https://www.myhome.ge/robots.txt': { status: 403, body: 'Forbidden' },
    'https://place.ge/robots.txt': 'User-agent: *\n',
  });
  const rendered = [];
  const browser = {
    name: 'fake-browser', pinsAddresses: true,
    async send(request) {
      rendered.push(request.url);
      const body = request.url.endsWith('/robots.txt')
        ? '<html><body><pre>User-agent: *\nSitemap: https://www.myhome.ge/sitemap.xml</pre></body></html>'
        : request.url.endsWith('sitemap.xml')
          ? '<urlset><url><loc>https://www.myhome.ge/pr/20592132/iyideba-bina</loc></url></urlset>'
          : listingPage('20592132');
      return { url: request.url, status: 200, headers: { 'content-type': 'text/html' }, body, bytes: body.length, truncated: false, durationMs: 1 };
    },
  };
  const runtime = createAuditPortalRuntime({ transport: http, browserTransport: browser, documentCache: new Map() });
  const myhome = runtime.registry.all().find((a) => a.id === 'myhome-ge');
  const outcome = await myhome.searchListings(QUERY, runtime.context);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(outcome.value.listings[0].via, 'browser');
  assert.equal(outcome.value.listings[0].externalId, '20592132');
  assert.ok(rendered.some((u) => u.includes('/pr/20592132')), 'the listing page was rendered');
  const routing = new RoutingTransport(http, browser, ['www.myhome.ge', 'myhome.ge']);
  assert.equal(routing.usesBrowser('https://place.ge/x'), false);
  assert.equal(routing.usesBrowser('https://www.myhome.ge/robots.txt'), false, 'robots.txt is tried as text first');
  assert.equal(routing.usesBrowser('https://www.myhome.ge/pr/1'), true);
});

test('without a browser transport the browser-only host is never rendered, and no normal runtime routes anything to a browser', async () => {
  /* market/runtime.ts (Verify imports it) has no candidate and no browser option at all. */
  const runtime = createPortalRuntime({ browserTransport: { name: 'x', pinsAddresses: true, async send() { throw new Error('must not be called'); } } });
  assert.ok(!runtime.registry.all().map((a) => a.id).includes('myhome-ge'));
  const src = readFileSync(new URL('../market/runtime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /candidates|browser-transport|includeCandidates|browserTransport/);
});

test('BrowserTransport: token, typed refusals, metering and a documented cost estimate', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    if (body.url.includes('blocked')) return new Response(JSON.stringify({ ok: false, error: { kind: 'CHALLENGE' } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, render: { finalUrl: body.url, status: 200, html: '<html>ok</html>', bytes: 15, truncated: false, renderMs: 9000, transferBytes: 2_000_000 } }), { status: 200 });
  };
  const t = new BrowserTransport({ baseUrl: 'https://worker.example/', token: 'tok', fetchImpl });
  const r = await t.send({ url: 'https://www.myhome.ge/pr/1', method: 'GET', headers: {}, timeoutMs: 30000 });
  assert.equal(r.body, '<html>ok</html>');
  assert.equal(calls[0].url, 'https://worker.example/discovery/render');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  await assert.rejects(t.send({ url: 'https://www.myhome.ge/blocked', method: 'GET', headers: {}, timeoutMs: 30000 }), (e) => e.kind === 'CHALLENGE');
  await assert.rejects(t.send({ url: 'https://www.myhome.ge/x', method: 'POST', headers: {}, timeoutMs: 1000 }), (e) => e.kind === 'METHOD_NOT_ALLOWED');
  assert.deepEqual(t.usage, { renders: 1, renderMs: 9000, transferBytes: 2_000_000, refusals: 1 });
  const cost = estimatedCostUsd(t.usage);
  assert.ok(cost > 0 && cost < 0.001, `one render costs well under a tenth of a cent (${cost})`);
  await assert.rejects(new BrowserTransport({ baseUrl: '', token: '' }).send({ url: 'https://a.ge', method: 'GET', headers: {}, timeoutMs: 1 }), (e) => e.kind === 'NOT_CONFIGURED');
});
