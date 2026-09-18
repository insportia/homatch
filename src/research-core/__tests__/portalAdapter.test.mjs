// The ss.ge listing adapter, against a fixture captured from the live portal.
//
// The fixture is REAL: six records and the Tbilisi taxonomy, taken verbatim
// from a search the running site answered. A hand-written fixture would test
// the shape this file already believes in, which is the one thing a parser
// test must not do.
//
// What is asserted here is mostly about honesty rather than parsing. Anyone
// can read a JSON blob; the properties that matter are that an asking price
// stays an asking price, that a rent never lands in a sale field, that a
// filter the portal cannot enforce is declared as client-side, and that a
// field the portal did not publish comes out null instead of guessed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SsGeAdapter,
  parseNextData,
  resolveSubDistrictId,
  toNormalizedListing,
  cityIdFor,
} from '../adapters/portal/ss-ge.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'ss-ge-vake-sale.html'), 'utf8');

function envelope(overrides = {}) {
  return {
    id: 'test:primary',
    transaction: 'SALE',
    propertyType: 'APARTMENT',
    countryCode: 'GE',
    city: 'Tbilisi',
    district: 'Vake',
    subDistrict: 'Vake',
    projectName: null,
    area: { min: 83, max: 112 },
    rooms: { min: null, max: null },
    bedrooms: { min: 1, max: 3 },
    floor: { min: null, max: null },
    price: { min: null, max: null },
    priceCurrency: null,
    languages: ['en'],
    limit: 40,
    rationale: 'test envelope',
    ...overrides,
  };
}

/** A context that serves the fixture and records what was asked for. */
function fixtureContext(body = FIXTURE, status = 200) {
  const urls = [];
  return {
    urls,
    context: {
      async fetchDocument(url) {
        urls.push(url);
        return {
          url,
          status,
          body,
          contentType: 'text/html',
          retrievedAt: '2026-09-18T20:00:00.000Z',
          via: 'http',
        };
      },
      authenticatedSession: false,
      now: () => Date.parse('2026-09-18T20:00:00.000Z'),
    },
  };
}

test('the fixture is the portal\'s own structured payload, not scraped text', () => {
  const props = parseNextData(FIXTURE);
  assert.ok(props, 'expected a __NEXT_DATA__ island');
  const items = props.applicationList.realStateItemModel;
  assert.ok(items.length >= 5);
  // Every field the adapter reads must actually be present in a real record.
  for (const key of ['applicationId', 'address', 'price', 'totalArea', 'dealType', 'detailUrl']) {
    assert.ok(key in items[0], `real records carry ${key}`);
  }
});

test('the district id is resolved from the portal\'s own taxonomy', () => {
  const props = parseNextData(FIXTURE);
  const vake = resolveSubDistrictId(props.locations, 95, 'Vake');
  assert.equal(typeof vake, 'number');
  // Same answer whatever case or decoration the subject address carried.
  assert.equal(resolveSubDistrictId(props.locations, 95, 'vake'), vake);
  assert.equal(resolveSubDistrictId(props.locations, 95, 'Vake district'), vake);
  // A district the portal does not know resolves to nothing rather than to
  // something close enough, which would silently search the wrong place.
  assert.equal(resolveSubDistrictId(props.locations, 95, 'Krtsanisi'), null);
});

test('cities resolve from Latin and Georgian spellings, and nothing else does', () => {
  assert.equal(cityIdFor('Tbilisi'), 95);
  assert.equal(cityIdFor('თბილისი'), 95);
  assert.equal(cityIdFor('Batumi'), 96);
  assert.equal(cityIdFor('Paris'), null);
  assert.equal(cityIdFor(null), null);
});

test('a sale listing is an ASKING price, never a transaction price', () => {
  const props = parseNextData(FIXTURE);
  const listing = toNormalizedListing(props.applicationList.realStateItemModel[0], 'ASKING_SALE_PRICE');
  assert.equal(listing.sale.basis, 'ASKING_SALE_PRICE');
  assert.equal(listing.rent, null, 'a sale search must never populate the rent side');
  assert.ok(listing.sale.amount > 0);
  assert.equal(listing.sale.currency, 'USD');
});

test('a rent listing never lands in the sale field or gets a price per sqm', () => {
  const props = parseNextData(FIXTURE);
  const listing = toNormalizedListing(props.applicationList.realStateItemModel[0], 'ASKING_RENT');
  assert.equal(listing.sale, null, 'rent must never be written into sale');
  assert.equal(listing.rent.basis, 'ASKING_RENT');
  // salePricePerSqm is derived from the sale side only. A rent per square
  // metre pooled with sale figures is the arithmetic this forbids.
  assert.equal(listing.salePricePerSqm, null);
});

test('a field the portal did not publish stays null', () => {
  const props = parseNextData(FIXTURE);
  const listing = toNormalizedListing(props.applicationList.realStateItemModel[0], 'ASKING_SALE_PRICE');
  // ss.ge carries no room count distinct from bedrooms. Reusing bedrooms as
  // rooms would invent a number the source never stated.
  assert.equal(listing.rooms, null);
  assert.equal(listing.cadastralCode, null);
  assert.equal(listing.daysOnMarket, null, 'days on market is never computed from a fetch time');
  assert.ok(listing.bedrooms > 0, 'but a field it DID publish is kept');
});

test('publishedAt is the portal\'s own date, not when we read the page', () => {
  const props = parseNextData(FIXTURE);
  const item = props.applicationList.realStateItemModel[0];
  const listing = toNormalizedListing(item, 'ASKING_SALE_PRICE');
  assert.equal(listing.publishedAt, item.createDate);
  assert.notEqual(listing.publishedAt, '2026-09-18T20:00:00.000Z');
});

test('a search declares which filters the portal enforced and which it did not', async () => {
  const { context, urls } = fixtureContext();
  const result = await new SsGeAdapter().searchListings(envelope(), context);
  assert.equal(result.ok, true);

  const filters = result.value.appliedFilters;
  assert.ok(filters.server.includes('city'));
  assert.ok(filters.server.includes('area'));
  assert.ok(filters.server.includes('transaction'));
  assert.ok(filters.server.includes('district'), 'district was resolved and applied server-side');
  // Bedrooms cannot be expressed in this portal's query string. Claiming it
  // server-side would make a wider result set look like a narrower one.
  assert.ok(filters.client.includes('bedrooms'));
  assert.ok(!filters.server.includes('bedrooms'));

  // The request really did carry the constraints it claims.
  const first = urls[0];
  assert.match(first, /cityIdList=95/);
  assert.match(first, /areaFrom=83/);
  assert.match(first, /areaTo=112/);
  assert.match(first, /For-Sale/);
});

test('rent and sale are reached through different URLs', async () => {
  const sale = fixtureContext();
  await new SsGeAdapter().searchListings(envelope({ transaction: 'SALE' }), sale.context);
  const rent = fixtureContext();
  await new SsGeAdapter().searchListings(envelope({ transaction: 'RENT' }), rent.context);
  assert.match(sale.urls[0], /For-Sale/);
  assert.match(rent.urls[0], /For-Rent/);
  assert.ok(!rent.urls[0].includes('For-Sale'));
});

test('every candidate carries the query that found it and why it matched', async () => {
  const { context } = fixtureContext();
  const result = await new SsGeAdapter().searchListings(envelope(), context);
  for (const candidate of result.value.listings) {
    assert.equal(candidate.queryId, 'test:primary');
    assert.ok(candidate.matchRationale.length > 0);
    assert.match(candidate.url, /^https:\/\/home\.ss\.ge\//);
    assert.equal(candidate.sourceFamily, 'ss.ge');
    assert.equal(candidate.priceBasis, 'ASKING_SALE_PRICE');
  }
});

test('the bedroom envelope is actually applied, not merely declared', async () => {
  const { context } = fixtureContext();
  const narrow = await new SsGeAdapter().searchListings(
    envelope({ bedrooms: { min: 2, max: 2 } }),
    context,
  );
  for (const candidate of narrow.value.listings) {
    assert.equal(candidate.listing.bedrooms, 2);
  }
  assert.ok(narrow.value.listings.length > 0, 'the fixture does contain 2-bedroom flats');
});

test('an HTTP refusal is reported as BLOCKED, not as an empty market', async () => {
  const { context } = fixtureContext('<html>forbidden</html>', 403);
  const result = await new SsGeAdapter().searchListings(envelope(), context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'BLOCKED');
});

test('a portal that stops serving structured data says PARSE_FAILED', async () => {
  const { context } = fixtureContext('<html><body>redesigned</body></html>', 200);
  const result = await new SsGeAdapter().searchListings(envelope(), context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PARSE_FAILED');
});

test('a city the portal does not cover is refused rather than searched broadly', async () => {
  const { context, urls } = fixtureContext();
  const adapter = new SsGeAdapter();
  const query = envelope({ city: 'Paris', countryCode: 'GE' });
  assert.equal(adapter.supports(query), false);
  const result = await adapter.searchListings(query, context);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(urls.length, 0, 'and no request was made');
});

test('listing URLs on this portal are recognised and canonicalised', () => {
  const adapter = new SsGeAdapter();
  assert.equal(adapter.handles('https://home.ss.ge/en/real-estate/Flat-For-Sale-Vake-123'), true);
  assert.equal(adapter.handles('https://www.myhome.ge/en/pr/123'), false);
  assert.equal(
    adapter.canonicalize('https://home.ss.ge/en/real-estate/Flat-For-Sale-Vake-123'),
    'https://home.ss.ge/en/real-estate/Flat-For-Sale-Vake-123',
  );
});
