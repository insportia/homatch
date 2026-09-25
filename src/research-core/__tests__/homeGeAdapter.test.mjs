// A P0 PORTAL THAT HAD NEVER BEEN SURVEYED, READ FROM ITS SITEMAP.
//
// home.ge was absent from the source registry entirely -- not blocked, not
// audited, simply never looked at -- while five smaller sources were built.
// The survey note in market/runtime.ts said "myhome.ge not surveyed / livo.ge
// not surveyed" in as many words, and home.ge was not even on that list.
//
// It cannot be read the way the other portals are. Its category pages answer
// HTTP 200 with ZERO bytes to an identifying agent, so there is no collection
// page. Its sitemap is published, permitted by robots, and names 17,445 URLs
// whose paths encode the transaction and the property type -- so the sitemap
// IS the collection, and that is the capability this file exercises.
//
// WHAT IS REAL HERE. Both fixtures are what www.home.ge actually served on
// 2026-09-25: the detail page is listing 26565 unmodified, and the sitemap is
// a 24-URL slice of sitemap_listings1.xml keeping its real shape -- Georgian
// sale and rent paths, /en/ duplicates, and the plumbing-services URLs that
// share the same file and must not be mistaken for property.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConfiguredPortalAdapter, sitemapUrls } from '../adapters/portal/configured.ts';
import { HOME_GE } from '../adapters/portal/sources.ts';
import { latinNameFor } from '../normalize/place.ts';

const DIR = 'src/research-core/adapters/portal/__fixtures__/';
const SITEMAP_URL = 'https://www.home.ge/files/sitemap/sitemap_listings1.xml';
const DETAIL_URL =
  'https://www.home.ge/binebi/iyideba-binebi/iyideba-bina-4-otakhiani-dzveli-ashenebuli-tbilisi-saburtalo-26565.html';

const sitemapXml = readFileSync(`${DIR}home.ge.sitemap.xml`, 'utf8');
const detailHtml = readFileSync(`${DIR}home.ge.detail.html`, 'utf8');

const cityHint = (city) => {
  const latin = latinNameFor(city);
  return latin ? new RegExp(`-${latin}-`, 'i') : null;
};

const SALE_ROUTE = {
  transaction: 'SALE',
  url: SITEMAP_URL,
  propertyType: 'APARTMENT',
  sitemap: { pathPattern: /home\.ge\/binebi\/iyideba-binebi\//i, cityHint },
};

function context(pages) {
  const fetched = [];
  return {
    fetched,
    authenticatedSession: false,
    now: () => Date.parse('2026-09-25T12:00:00Z'),
    async fetchDocument(url) {
      fetched.push(url);
      const body = pages[url];
      return {
        url,
        status: body === undefined ? 404 : 200,
        body: body ?? '',
        contentType: url.endsWith('.xml') ? 'application/xml' : 'text/html',
        retrievedAt: '2026-09-25T12:00:00Z',
        via: 'http',
      };
    },
  };
}

function envelope(overrides = {}) {
  return {
    id: 'q-home-ge',
    transaction: 'SALE',
    propertyType: 'ANY',
    countryCode: 'GE',
    city: null,
    district: null,
    subDistrict: null,
    projectName: null,
    area: { min: null, max: null },
    rooms: { min: null, max: null },
    bedrooms: { min: null, max: null },
    floor: { min: null, max: null },
    price: { min: null, max: null },
    priceCurrency: null,
    languages: ['ka'],
    limit: 3,
    rationale: 'test',
    ...overrides,
  };
}

/* ── the sitemap reader ─────────────────────────────────────────────────── */

test('the sale route takes sale apartments and nothing else from a mixed sitemap', () => {
  const urls = sitemapUrls(sitemapXml, SALE_ROUTE, envelope(), HOME_GE);
  assert.ok(urls.length > 0, 'the sale route found no listings in its own sitemap');
  for (const url of urls) {
    assert.match(url, /\/binebi\/iyideba-binebi\//);
  }
  // The same file carries rentals and plumbing services. Neither is property
  // for sale, and both would be silently persisted by a looser pattern.
  assert.equal(urls.some((u) => u.includes('qiravdeba')), false, 'a rental entered the sale route');
  assert.equal(urls.some((u) => u.includes('plumbing-services')), false,
    'a plumbing advert was read as a property listing');
});

test('one listing is taken once, not once per language', () => {
  /*
   * home.ge publishes the unprefixed Georgian path, /en/ and /ru/ for the
   * same listing. Reading all three would fetch every property three times to
   * rediscover the same sku, and hand the entity resolver a mess this file
   * created.
   */
  const urls = sitemapUrls(sitemapXml, SALE_ROUTE, envelope(), HOME_GE);
  assert.equal(urls.some((u) => u.includes('/en/')), false, '/en/ duplicates were taken too');
  assert.equal(urls.some((u) => u.includes('/ru/')), false, '/ru/ duplicates were taken too');

  const ids = urls.map((u) => HOME_GE.detailUrl.pattern.exec(u)?.[HOME_GE.detailUrl.idGroup]);
  assert.ok(ids.every(Boolean), 'a URL was accepted whose id the config cannot find');
  assert.equal(new Set(ids).size, ids.length, 'the same listing id appeared twice');
});

test('the city hint narrows the sitemap before anything is fetched', () => {
  const all = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: null }), HOME_GE);
  const tbilisi = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: 'Tbilisi' }), HOME_GE);
  assert.ok(tbilisi.length > 0, 'the Tbilisi hint filtered every URL away');
  assert.ok(tbilisi.length <= all.length);
  for (const url of tbilisi) assert.match(url, /-tbilisi-/i);
});

test('a Georgian city name reaches the Latin slug', () => {
  /*
   * The campaign may ask in Georgian and the slug is always Latin. This is
   * the cross-script case that made entity resolution impossible before
   * place.ts existed, arriving now in a URL filter.
   */
  const inGeorgian = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: 'თბილისი' }), HOME_GE);
  const inLatin = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: 'Tbilisi' }), HOME_GE);
  assert.deepEqual(inGeorgian, inLatin);
  assert.ok(inGeorgian.length > 0);
});

test('a city the place vocabulary does not know reads the sitemap unfiltered', () => {
  /*
   * NOT filtered to nothing. An unknown city has no reliable transliteration,
   * and guessing one would report a working source as an empty market --
   * strictly worse than reading wider and letting withinEnvelope judge.
   */
  const unfiltered = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: null }), HOME_GE);
  const unknown = sitemapUrls(sitemapXml, SALE_ROUTE, envelope({ city: 'Zugdidi' }), HOME_GE);
  assert.equal(latinNameFor('Zugdidi'), null, 'precondition: this city is not in the table');
  assert.deepEqual(unknown, unfiltered);
});

/* ── end to end, through the adapter ────────────────────────────────────── */

test('the adapter reads the sitemap and then the listing it names', async () => {
  const adapter = new ConfiguredPortalAdapter({ config: HOME_GE, routes: [SALE_ROUTE] });
  const ctx = context({ [SITEMAP_URL]: sitemapXml, [DETAIL_URL]: detailHtml });

  const result = await adapter.searchListings(envelope({ city: 'Tbilisi', limit: 1 }), ctx);
  assert.equal(result.ok, true, `adapter failed: ${result.reason} ${result.detail ?? ''}`);

  // One sitemap fetch, then detail pages — never a walk of all 17,445.
  assert.equal(ctx.fetched[0], SITEMAP_URL);
  assert.ok(ctx.fetched.length <= 2, `fetched ${ctx.fetched.length} pages for a limit of 1`);
});

test('the listing carries what the Offer actually published', async () => {
  const adapter = new ConfiguredPortalAdapter({ config: HOME_GE, routes: [SALE_ROUTE] });
  const ctx = context({ [SITEMAP_URL]: sitemapXml, [DETAIL_URL]: detailHtml });
  const result = await adapter.searchListings(envelope({ city: 'Tbilisi', limit: 1 }), ctx);

  const found = result.value.listings.find((l) => l.listing.listingId === '26565');
  assert.ok(found, 'listing 26565 was not among the results');
  const listing = found.listing;

  // sku in the JSON-LD equals the id in the slug. Verified on 26565 and 11673.
  assert.equal(listing.listingId, '26565');
  /*
   * 240300 GEL, and that is the site's own conversion: the seller's
   * description on the same page asks "90 000$", about 2.67 to the dollar.
   * GEL is recorded because GEL is what the Offer states. Nothing here
   * converts it back, because an exchange rate invented at read time would
   * sit inside a price a customer is charged against.
   */
  assert.equal(listing.sale.currency, 'GEL');
  assert.equal(listing.sale.amount, 240300);
  assert.equal(listing.sale.basis, 'ASKING_SALE_PRICE');
  assert.equal(listing.rent, null, 'a sale listing carried a rent figure');
});

test('the Georgian title is preserved rather than translated away', async () => {
  const adapter = new ConfiguredPortalAdapter({ config: HOME_GE, routes: [SALE_ROUTE] });
  const ctx = context({ [SITEMAP_URL]: sitemapXml, [DETAIL_URL]: detailHtml });
  const result = await adapter.searchListings(envelope({ city: 'Tbilisi', limit: 1 }), ctx);
  const listing = result.value.listings.find((l) => l.listing.listingId === '26565').listing;

  // The raw evidence stays in the language the source published it in.
  assert.match(listing.title ?? '', /[Ⴀ-ჿ]/, 'the Georgian title was lost');
});

test('a sitemap with no matching path is a parse failure, not an empty market', async () => {
  /*
   * The distinction that decides whether a source is marked DEGRADED or
   * simply quiet. A sitemap that answered and named nothing we recognise is
   * something we could not read, not a portal with no inventory.
   */
  const adapter = new ConfiguredPortalAdapter({
    config: HOME_GE,
    routes: [{
      ...SALE_ROUTE,
      sitemap: { pathPattern: /home\.ge\/nothing-like-this\//i, cityHint },
    }],
  });
  const ctx = context({ [SITEMAP_URL]: sitemapXml });
  const result = await adapter.searchListings(envelope(), ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PARSE_FAILED');
});
