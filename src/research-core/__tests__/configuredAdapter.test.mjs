// THE FILTER THAT SAID IT RAN AND DID NOT.
//
// The first production discovery run asked for apartments in Tbilisi and
// persisted a flat in ჩაქვი — Chakvi, on the Black Sea, 300km away — while
// appliedFilters reported `client: ['propertyType', 'city']`. Both constraints
// were pushed onto that list unconditionally and neither was ever compared
// against anything. The sweep was broad, the report said it was targeted, and
// nothing in the suite disagreed because ConfiguredPortalAdapter had no test
// at all.
//
// That is the specific failure this file exists to prevent, and the general
// one behind it: a declaration about behaviour is not behaviour. Every
// constraint appliedFilters() names as client-applied is exercised here
// against a listing that violates it, and the last test in the file asserts
// the two lists cannot drift apart.
//
// WHAT IS REAL HERE AND WHAT IS A STUB
//
// The DETAIL pages are the captured fixtures — markup home24.ge and
// zarayaproperties.com actually served on 2026-09-25. The COLLECTION page is a stub: a few <a>
// hrefs, standing in for the network. That split is deliberate. The thing
// under test is which listings survive the envelope, so the listings must be
// real and the transport need not be.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConfiguredPortalAdapter } from '../adapters/portal/configured.ts';
import { comparePlaces, samePlace } from '../normalize/place.ts';
import { HOME24_GE, ZARAYA } from '../adapters/portal/sources.ts';

const DIR = 'src/research-core/adapters/portal/__fixtures__/';

/* The URL the capture actually landed on, and the markup it returned. */
const HOME24_DETAIL = 'https://www.home24.ge/ge/property/1079/For-Sale-Flat';
const ZARAYA_DETAIL = 'https://www.zarayaproperties.com/properties-1/0001';
const COLLECTION = 'https://www.home24.ge/ge/properties';

const home24Html = readFileSync(`${DIR}home24.ge.detail.html`, 'utf8');
const zarayaHtml = readFileSync(`${DIR}zarayaproperties.com.detail.html`, 'utf8');

/**
 * A context that serves the fixtures and counts hops.
 *
 * It does NOT emulate the runtime's robots check, rate limiter or breaker —
 * those have their own tests and pretending to them here would produce a
 * second, weaker copy of a guarantee that already exists.
 */
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
        contentType: 'text/html',
        retrievedAt: '2026-09-25T12:00:00Z',
        via: 'http',
      };
    },
  };
}

function collectionOf(...links) {
  return `<html><body>${links.map((h) => `<a href="${h}">listing</a>`).join('')}</body></html>`;
}

function home24Adapter() {
  return new ConfiguredPortalAdapter({
    config: HOME24_GE,
    routes: [{ transaction: 'SALE', url: COLLECTION }],
  });
}

/** The envelope, with every constraint off unless a test turns it on. */
function envelope(overrides = {}) {
  return {
    id: 'q-test',
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
    limit: 5,
    rationale: 'test envelope',
    ...overrides,
  };
}

async function sweep(query, pages = { [COLLECTION]: collectionOf(HOME24_DETAIL), [HOME24_DETAIL]: home24Html }) {
  const ctx = context(pages);
  const outcome = await home24Adapter().searchListings(query, ctx);
  return { outcome, ctx };
}

/**
 * The same envelope against a second source, with a different extraction
 * strategy and a different city.
 *
 * A filter proven on one adapter is a filter proven on one adapter. This one
 * reads OpenGraph and a spec table where home24 reads schema.org, and it
 * publishes a Batumi property where home24 publishes Tbilisi.
 */
async function zarayaSweep(query) {
  const adapter = new ConfiguredPortalAdapter({
    config: ZARAYA,
    routes: [{ transaction: 'SALE', url: COLLECTION }],
  });
  const ctx = context({
    [COLLECTION]: collectionOf(ZARAYA_DETAIL),
    [ZARAYA_DETAIL]: zarayaHtml,
  });
  return adapter.searchListings(query, ctx);
}

/* ── the Chakvi regression ─────────────────────────────────────────────── */

test('a listing in another city is dropped, not persisted with the city filter marked applied', async () => {
  /*
   * The fixture is a real flat in თბილისი. Asking for Batumi is the same
   * shape as the production failure — an envelope naming one city, a listing
   * stating another — with the roles of fixture and query swapped so the
   * evidence stays real markup.
   */
  const { outcome } = await sweep(envelope({ city: 'Batumi' }));

  assert.equal(outcome.ok, true, 'reading every listing successfully is not a failure');
  assert.equal(outcome.value.listings.length, 0);
  assert.equal(outcome.value.rejectedByEnvelope, 1);
  assert.ok(outcome.value.appliedFilters.client.includes('city'));
});

test('an empty result after filtering is not PARSE_FAILED', async () => {
  /*
   * The distinction the lifecycle depends on. Every listing was read; none
   * matched. Marking that PARSE_FAILED would take a working source toward
   * DEGRADED for answering a narrow question honestly.
   */
  const { outcome } = await sweep(envelope({ city: 'Batumi' }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.listings.length, 0);
});

test('an unreadable page is still PARSE_FAILED', async () => {
  // The other side of the same distinction: nothing was read, so nothing is
  // known, and that must not be reported as an empty market.
  const { outcome } = await sweep(envelope(), {
    [COLLECTION]: collectionOf(HOME24_DETAIL),
    [HOME24_DETAIL]: '<html><body>gone</body></html>',
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'PARSE_FAILED');
});

test('the listing in the requested city survives', async () => {
  const { outcome } = await sweep(envelope({ city: 'თბილისი' }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.listings.length, 1);
  assert.equal(outcome.value.rejectedByEnvelope, 0);
});

/* ── absence, and two spellings of one place ───────────────────────────── */

test('a Batumi listing does not answer a Tbilisi envelope, across sources', async () => {
  /*
   * zarayaproperties.com is a Batumi developer and its page states the city
   * in its own spec row. This is the Chakvi failure at full size: a seafront
   * tower 300km from the subject, on a different source, with a different
   * strategy, filtered by the same rule.
   */
  const outcome = await zarayaSweep(envelope({ city: 'Tbilisi' }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.listings.length, 0);
  assert.equal(outcome.value.rejectedByEnvelope, 1);
  assert.ok(outcome.value.appliedFilters.client.includes('city'));

  const inBatumi = await zarayaSweep(envelope({ city: 'Batumi' }));
  assert.equal(inBatumi.value.listings.length, 1);
});

test('a listing that states no district is KEPT, and the filter stops claiming to have run', async () => {
  /*
   * zaraya publishes a city and no district. Dropping the listing would
   * manufacture a disqualifying fact out of a field the source never
   * published, which is the same invention as claiming a filter ran, pointed
   * the other way.
   *
   * But KEEPING it costs something, and the second assertion is that cost
   * being paid where it can be seen: a caller who asked for Vake and
   * received a listing that never said which district it is in has a wider
   * envelope than it requested, so `district` moves to `unsupported`.
   */
  const outcome = await zarayaSweep(envelope({ district: 'Vake' }));

  assert.equal(outcome.ok, true);
  const kept = outcome.value.listings[0];
  assert.ok(kept, 'a listing with no stated district must survive a district envelope');
  assert.equal(kept.listing.district, null);
  assert.ok(
    outcome.value.appliedFilters.unsupported.includes('district'),
    'the returned set is not all in Vake, so the district filter must not be reported as applied',
  );
  assert.equal(outcome.value.appliedFilters.client.includes('district'), false);
});

test('a constraint the returned listings cannot be judged on is unsupported, not client-applied', async () => {
  /*
   * home24.ge's fixture never states a bedroom count. The old report pushed
   * `bedrooms` onto the client list because the QUERY had one — describing
   * the code path rather than the answer. A caller reading that list is
   * entitled to believe every listing it received satisfies the constraint,
   * and for this set that belief is false.
   */
  const { outcome } = await sweep(envelope({ bedrooms: { min: 2, max: 4 } }));
  assert.equal(outcome.value.listings.length, 1);
  assert.equal(outcome.value.listings[0].listing.bedrooms, null);
  assert.ok(outcome.value.appliedFilters.unsupported.includes('bedrooms'));
  assert.equal(outcome.value.appliedFilters.client.includes('bedrooms'), false);
});

test('Tbilisi and თბილისი are one city; Tbilisi and Batumi are not', () => {
  assert.equal(samePlace('Tbilisi', 'თბილისი'), true);
  assert.equal(samePlace('თბილისი', 'тбилиси'), true);
  assert.equal(samePlace(' TBILISI ', 'tbilisi'), true);
  assert.equal(samePlace('Tbilisi', 'Batumi'), false);
  // Not a transliterator. Two places that merely look alike stay apart.
  assert.equal(samePlace('Vake', 'Vaketili'), false);
});

test('a comparison across scripts that the table cannot make is UNKNOWN, not a conflict', () => {
  /*
   * THE DISTINCTION THE FILTER AND THE RESOLVER BOTH DEPEND ON.
   *
   * Within one script, two different names are a real distinction: a portal
   * writing "Saburtalo" and "Vake" is separating them in its own words.
   *
   * Across scripts, an unlisted name tells us about an alphabet and nothing
   * about a place. Calling that a CONFLICT would let the entity resolver
   * return DISTINCT because one source writes Georgian and another writes
   * Latin — destroying precisely the cross-source merge the resolver exists
   * to find, with an answer that looks safe.
   */
  assert.equal(comparePlaces('Saburtalo', '\u10e1\u10d0\u10d1\u10e3\u10e0\u10d7\u10d0\u10da\u10dd'), 'AGREE');
  assert.equal(comparePlaces('Saburtalo', 'Vake'), 'CONFLICT');
  assert.equal(comparePlaces('\u10e1\u10d0\u10d1\u10e3\u10e0\u10d7\u10d0\u10da\u10dd', '\u10d5\u10d0\u10d9\u10d4'), 'CONFLICT');

  // Neither is in the table, and they are in different alphabets.
  assert.equal(comparePlaces('Lisi Lake', '\u10dd\u10e5\u10e0\u10dd\u10e7\u10d0\u10dc\u10d0'), 'UNKNOWN');

  // Absence is not disagreement, and it is not agreement either.
  assert.equal(comparePlaces(null, 'Vake'), 'UNKNOWN');
  assert.equal(comparePlaces('', ''), 'UNKNOWN');
  assert.equal(samePlace(null, null), false);
});

/* ── the remaining constraints, each against a violating listing ───────── */

test('propertyType is compared, and ANY compares nothing', async () => {
  // The fixture is an APARTMENT.
  const asHouse = await sweep(envelope({ propertyType: 'HOUSE' }));
  assert.equal(asHouse.outcome.value.listings.length, 0);
  assert.equal(asHouse.outcome.value.rejectedByEnvelope, 1);

  const asApartment = await sweep(envelope({ propertyType: 'APARTMENT' }));
  assert.equal(asApartment.outcome.value.listings.length, 1);
  assert.ok(asApartment.outcome.value.appliedFilters.client.includes('propertyType'));

  const anyType = await sweep(envelope());
  assert.equal(anyType.outcome.value.listings.length, 1);
  assert.equal(
    anyType.outcome.value.appliedFilters.client.includes('propertyType'),
    false,
    'ANY is not a constraint and must not be reported as one applied',
  );
});

test('area is compared in sqm', async () => {
  // The fixture states 141 sqm.
  const tooSmall = await sweep(envelope({ area: { min: null, max: 100 } }));
  assert.equal(tooSmall.outcome.value.listings.length, 0);

  const fits = await sweep(envelope({ area: { min: 120, max: 200 } }));
  assert.equal(fits.outcome.value.listings.length, 1);
  assert.ok(fits.outcome.value.appliedFilters.client.includes('area'));
});

test('price is compared only in the currency the envelope asked in', async () => {
  // The fixture quotes 330000 USD.
  const belowInUsd = await sweep(envelope({
    price: { min: null, max: 100_000 },
    priceCurrency: 'USD',
  }));
  assert.equal(belowInUsd.outcome.value.listings.length, 0, 'a USD envelope filters a USD listing');

  /*
   * The same numeric window in GEL keeps it. No rate is carried here, and a
   * comparison across currencies would be one invented at read time — a
   * fabricated exchange rate buried inside a filter decision where nothing
   * downstream could see it.
   */
  const belowInGel = await sweep(envelope({
    price: { min: null, max: 100_000 },
    priceCurrency: 'GEL',
  }));
  assert.equal(belowInGel.outcome.value.listings.length, 1);

  // And with no currency named there is nothing to compare against at all.
  const noCurrency = await sweep(envelope({ price: { min: null, max: 100_000 } }));
  assert.equal(noCurrency.outcome.value.listings.length, 1);
  assert.ok(noCurrency.outcome.value.appliedFilters.unsupported.includes('price'));
});

test('constraints this family cannot express are declared unsupported, not omitted', async () => {
  const { outcome } = await sweep(envelope({
    subDistrict: 'Vera',
    projectName: 'King David',
    rooms: { min: 3, max: null },
    floor: { min: 2, max: null },
  }));
  const { unsupported } = outcome.value.appliedFilters;
  for (const constraint of ['subDistrict', 'projectName', 'rooms', 'floor']) {
    assert.ok(unsupported.includes(constraint), `${constraint} silently widened the envelope`);
  }
});

test('only the transaction is claimed as server-enforced', async () => {
  /*
   * These collection pages separate sale from rent by URL and nothing else
   * anyone has verified. A server claim is a claim about the PORTAL, and
   * every one of them makes a broad sweep read as a targeted query.
   */
  const { outcome } = await sweep(envelope({ city: 'თბილისი', propertyType: 'APARTMENT' }));
  assert.deepEqual(outcome.value.appliedFilters.server, ['transaction']);
});

/* ── the equivalence, so the two can never drift again ─────────────────── */

test('every constraint reported as client-applied actually removes a violating listing', async () => {
  /*
   * THE TEST THAT WOULD HAVE CAUGHT CHAKVI.
   *
   * For each constraint, an envelope that the fixture violates. If the
   * constraint appears in appliedFilters.client, the listing must be gone. A
   * future edit that pushes a name onto that list without implementing the
   * comparison fails here, and so does one that quietly stops applying a
   * comparison it still advertises.
   */
  const violations = {
    city: { city: 'Batumi' },
    propertyType: { propertyType: 'LAND' },
    area: { area: { min: 5000, max: null } },
    district: { district: 'Sololaki' },
    price: { price: { min: 9_000_000, max: null }, priceCurrency: 'USD' },
    bedrooms: { bedrooms: { min: 40, max: null } },
  };

  for (const [constraint, overrides] of Object.entries(violations)) {
    const { outcome } = await sweep(envelope(overrides));
    assert.equal(outcome.ok, true, `${constraint}: the sweep itself failed`);
    /*
     * A constraint that landed in `unsupported` is not skipped quietly: the
     * assertion below is about what `client` claims, and a constraint the
     * returned listings could not be judged on has already declared itself.
     */
    if (!outcome.value.appliedFilters.client.includes(constraint)) {
      assert.ok(
        outcome.value.appliedFilters.unsupported.includes(constraint),
        `${constraint} appears in neither list — the envelope was widened in silence`,
      );
      continue;
    }
    assert.equal(
      outcome.value.listings.length,
      0,
      `${constraint} is reported as client-applied and did not remove a listing that violates it`,
    );
  }
});

test('the adapter reads one collection page and one page per candidate, and no more', async () => {
  /*
   * Filtering happens AFTER fetching, which is exactly why the hop count
   * matters: a client-side filter that also widened the crawl would trade an
   * honest report for somebody else's bandwidth.
   */
  const { ctx } = await sweep(envelope({ city: 'Batumi' }));
  assert.deepEqual(ctx.fetched, [COLLECTION, HOME24_DETAIL]);
});
