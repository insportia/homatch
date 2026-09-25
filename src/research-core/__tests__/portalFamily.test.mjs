// FOUR REAL SITES, READ FROM WHAT THEY ACTUALLY SERVED.
//
// Every fixture under adapters/portal/__fixtures__ is markup the live site
// returned on 2026-09-25 to an identifying crawler, captured by
// scripts/capture-listing-fixtures.mjs. Nothing here is hand-written HTML,
// which matters: an adapter tested against markup its author invented is an
// adapter tested against its author's assumptions.
//
// A test in this file failing is therefore one of two things, and both are
// worth knowing: the extractor broke, or the site changed. The second is what
// DEGRADED exists for.
//
// WHAT THESE PROVE AND WHAT THEY DO NOT
//
// They prove the extraction is correct against real markup: FIXTURE_TESTED.
// They prove nothing about the site being reachable today, which is
// LIVE_TESTED and needs a controlled run with measurement. Keeping those
// apart is the whole point of the lifecycle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalIdFrom,
  extractListing,
  isDetailUrl,
  transactionFromUrl,
} from '../adapters/portal/family.ts';
import {
  HOME24_GE, HOME_SS_GE, PLACE_GE, PORTAL_SOURCES, sourceById, sourceForUrl, ZARAYA,
} from '../adapters/portal/sources.ts';
import { ORIGIN_QUALITY } from '../parse/listing.ts';

const DIR = 'src/research-core/adapters/portal/__fixtures__/';
const fixture = (name) => readFileSync(`${DIR}${name}`, 'utf8');

/** The URLs the capture actually landed on. Not invented. */
const CAPTURED = {
  home24: 'https://www.home24.ge/ge/property/1079/For-Sale-Flat',
  place: 'https://place.ge/ge/ads/view/1317856',
  zaraya: 'https://www.zarayaproperties.com/properties-1/0001',
};

/* ── the framework's shape ─────────────────────────────────────────────── */

test('four sources, three strategies, three families', () => {
  // A framework validated against two portals sharing a CMS has not been
  // validated, so the batch was chosen for difference as well as inventory.
  assert.equal(PORTAL_SOURCES.length, 4);
  const strategies = new Set(PORTAL_SOURCES.map((s) => s.strategy));
  assert.deepEqual([...strategies].sort(), ['EMBEDDED_STATE', 'OPEN_GRAPH', 'SCHEMA_ORG']);
  const families = new Set(PORTAL_SOURCES.map((s) => s.family));
  assert.ok(families.size >= 3, `only ${families.size} families in the batch`);
});

test('every source declares a price basis, and none claims a transaction', () => {
  /*
   * None of these sites publishes what was actually paid. Pooling an asking
   * price with a transaction price produces a market statistic that is simply
   * wrong, and the basis is the only thing preventing it.
   */
  for (const source of PORTAL_SOURCES) {
    assert.ok(source.saleBasis, `${source.id} has no sale basis`);
    assert.notEqual(source.saleBasis, 'TRANSACTION_PRICE', `${source.id} claims transactions`);
    assert.notEqual(source.rentBasis, 'ACHIEVED_RENT', `${source.id} claims achieved rent`);
  }
  // And a developer's own price is not an asking price.
  assert.equal(ZARAYA.saleBasis, 'DEVELOPER_PRICE');
  assert.equal(HOME24_GE.saleBasis, 'ASKING_SALE_PRICE');
});

/* ── home24.ge: the structured one ─────────────────────────────────────── */

test('home24.ge yields a complete listing from its own structured data', () => {
  const result = extractListing(fixture('home24.ge.detail.html'), CAPTURED.home24, HOME24_GE);
  assert.equal(result.ok, true, result.reason);

  const l = result.listing;
  assert.equal(l.listingId, '1079');
  assert.equal(l.propertyType, 'APARTMENT');
  assert.equal(l.area.value, 141);
  // Lowercase, because that is what the Area declaration says and what
  // deriveSalePricePerSqm compares against.
  assert.equal(l.area.unit, 'sqm');
  assert.equal(l.city, 'თბილისი');
  assert.equal(l.district, 'ვაკე');
  assert.equal(l.country, 'GE');
  assert.equal(l.sale.amount, 330000);
  assert.equal(l.sale.currency, 'USD');
});

test('the price from home24 is an ASKING price, whatever the page called it', () => {
  const l = extractListing(fixture('home24.ge.detail.html'), CAPTURED.home24, HOME24_GE).listing;
  assert.equal(l.sale.basis, 'ASKING_SALE_PRICE');
  assert.equal(l.rent, null, 'a sale listing produced a rent value');
});

test('a price per sqm is derived only from the sale side', () => {
  const l = extractListing(fixture('home24.ge.detail.html'), CAPTURED.home24, HOME24_GE).listing;
  // 330000 / 141. Derived because both inputs were present and both are sale-side.
  assert.ok(l.salePricePerSqm > 2000 && l.salePricePerSqm < 2500, `got ${l.salePricePerSqm}`);
});

test('"product" is not a property type', () => {
  /*
   * listingFromJsonLd fills propertyType from the schema.org @type, and
   * home24 models a listing as a Product — so the word "product" landed in a
   * field meant to hold APARTMENT or LAND, and would have been matched
   * against a customer's property type forever after.
   */
  const l = extractListing(fixture('home24.ge.detail.html'), CAPTURED.home24, HOME24_GE).listing;
  assert.notEqual(String(l.propertyType).toLowerCase(), 'product');
  assert.equal(l.fieldOrigins.propertyType, 'URL', 'the type is claimed as structured data');
});

/* ── place.ge and zaraya: thin, and honest about it ────────────────────── */

test('place.ge yields a real price, place and date from its own text', () => {
  /*
   * THE FIXTURE THIS REPLACES WAS NOT A LISTING.
   *
   * The first detail-URL pattern matched /ge/a/<id>/ads — an AGENCY page —
   * so the capture, the tests and a live run all operated on the wrong kind
   * of page, reporting three "listings" whose unique ids were agency ids.
   * The real shape is /ge/ads/view/<id>, and it appears thirty times on the
   * very page that was being misread.
   *
   * On a real listing the site publishes plenty: a price anchored to a
   * per-square-metre figure, a stated date, and a title broken into
   * transaction, type, rooms, city, macro-district and district.
   */
  const result = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.listing.listingId, '1317856');
  assert.ok(result.listing.title);

  assert.ok(result.listing.sale, 'no price was read');
  assert.equal(result.listing.sale.amount, 145000);
  assert.equal(result.listing.sale.currency, 'USD');
  assert.equal(result.listing.sale.basis, 'ASKING_SALE_PRICE');
  assert.equal(result.listing.rent, null, 'a sale listing produced a rent');

  assert.equal(result.listing.publishedAt, '2026-09-24');
  assert.ok(result.listing.city);
  assert.ok(result.listing.district);
});

test('the place.ge price is the listing\'s own, not the sidebar\'s', () => {
  /*
   * The failure this pins. An unanchored price pattern matched the
   * related-listings sidebar and returned GEL3,117 for three DIFFERENT
   * listings — three green rows, three unique ids, one wrong number
   * repeated. Nothing in the counts would have shown it.
   *
   * The anchor is the per-square-metre suffix, which only the listing's own
   * price line carries.
   */
  const l = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE).listing;
  assert.notEqual(l.sale.amount, 3117, 'the sidebar price is back');
  // And it is recorded as prose, because that is what it is.
  assert.equal(l.fieldOrigins.sale, 'TEXT');
});

test('place.ge publishes no area, and none is invented', () => {
  /*
   * The obvious area pattern matched the PRICE PER SQUARE METRE: "$1,629 per
   * sqm" yielded an area of 629 on a flat that has nothing of the sort, and
   * three listings came back with 629, 573 and 609 — all wrong, all
   * plausible. Absent is the honest answer until it can be read without
   * ambiguity.
   */
  const l = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE).listing;
  assert.equal(l.area, null, 'an area appeared that the site does not publish unambiguously');
});

test('a thin source scores lower than a structured one, and the gap is visible', () => {
  /*
   * This is the number that decides which of two conflicting observations
   * about the same property wins, so it has to reflect what each source
   * actually published rather than how many fields happen to be filled.
   */
  const rich = extractListing(fixture('home24.ge.detail.html'), CAPTURED.home24, HOME24_GE);
  const thin = extractListing(fixture('zarayaproperties.com.detail.html'), CAPTURED.zaraya, ZARAYA);
  assert.ok(rich.quality > 0.8, `structured source scored ${rich.quality}`);
  assert.ok(thin.quality < 0.7, `prose-only source scored ${thin.quality}`);
  assert.ok(rich.quality > thin.quality);

  /*
   * place.ge sits between them and scores LOW despite carrying price, place
   * and date — because every one of those was read out of prose. The score
   * measures how the source PUBLISHED its data, not how many fields we
   * managed to fill, which is what makes it useful for deciding whose
   * observation wins when two disagree.
   */
  const prose = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE);
  assert.ok(prose.listing.sale, 'place.ge carries a price');
  assert.ok(prose.quality < rich.quality, 'prose scored as high as structured data');
});

test('quality is a number, not NaN', () => {
  /*
   * FieldOrigin is a STRING union and ORIGIN_QUALITY indexes it directly. An
   * earlier version of the framework wrote an object into fieldOrigins, which
   * type-checked through a cast and made every score NaN — a value that
   * silently poisons every comparison it touches instead of failing.
   */
  for (const [name, config, url] of [
    ['home24.ge.detail.html', HOME24_GE, CAPTURED.home24],
    ['place.ge.detail.html', PLACE_GE, CAPTURED.place],
    ['zarayaproperties.com.detail.html', ZARAYA, CAPTURED.zaraya],
  ]) {
    const result = extractListing(fixture(name), url, config);
    assert.ok(Number.isFinite(result.quality), `${name} scored ${result.quality}`);
    for (const [field, origin] of Object.entries(result.listing.fieldOrigins)) {
      assert.ok(origin in ORIGIN_QUALITY, `${name}: ${field} has origin ${JSON.stringify(origin)}`);
    }
  }
});

test('a number found in prose is recorded as prose', () => {
  // zaraya publishes no structured area, so the figure comes from the page's
  // visible text — the weakest evidence there is, and labelled as such.
  const l = extractListing(fixture('zarayaproperties.com.detail.html'), CAPTURED.zaraya, ZARAYA).listing;
  assert.ok(l.area, 'no area was found at all');
  assert.equal(l.fieldOrigins.area, 'TEXT');
  assert.ok(ORIGIN_QUALITY.TEXT < ORIGIN_QUALITY.JSON_LD);
});

test('a developer site is priced as a developer, not as a reseller', () => {
  const config = sourceById('zaraya-properties');
  assert.equal(config.family, 'DEVELOPER_SITE');
  assert.equal(config.saleBasis, 'DEVELOPER_PRICE');
});

/* ── identity ──────────────────────────────────────────────────────────── */

test('every source recognises its own detail URLs and no others', () => {
  const urls = [
    [CAPTURED.home24, 'home24-ge'],
    [CAPTURED.place, 'place-ge'],
    [CAPTURED.zaraya, 'zaraya-properties'],
    ['https://home.ss.ge/ka/udzravi-qoneba/iyideba-4-otaxiani-bina-nadzaladevshi-36733497', 'home-ss-ge'],
  ];
  for (const [url, expected] of urls) {
    const found = sourceForUrl(url);
    assert.ok(found, `nothing recognised ${url}`);
    assert.equal(found.id, expected, `${url} matched ${found.id}`);
  }
});

test('a collection page is not mistaken for a listing', () => {
  /*
   * A false positive costs a request to a page that is not a listing, and
   * those requests land on somebody else's server.
   */
  for (const url of [
    'https://www.home24.ge/ge/results/for_sale/flat',
    'https://place.ge/ge/sakartvelo/bina/iyideba',
    'https://home.ss.ge/ka/udzravi-qoneba/l/bina/iyideba',
    'https://www.zarayaproperties.com/en/properties-1',
  ]) {
    assert.equal(sourceForUrl(url), null, `${url} was read as a listing`);
  }
});

test('the canonical id is stable across a site\'s languages', () => {
  /*
   * zaraya serves the same unit at /properties-1/000614 and
   * /ar/properties-1/000614. Two URLs, one property — and if the identity
   * were the path rather than the id, that would be two entities and a
   * customer would see the same flat twice.
   */
  const a = canonicalIdFrom('https://www.zarayaproperties.com/properties-1/000614', ZARAYA);
  const b = canonicalIdFrom('https://www.zarayaproperties.com/ar/properties-1/000614', ZARAYA);
  assert.equal(a, b);
  assert.equal(a, '000614');
});

test('home.ss.ge ids come out of the URL, so no second request is needed', () => {
  const url = 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-saburtaloze-36474494';
  assert.equal(isDetailUrl(url, HOME_SS_GE), true);
  assert.equal(canonicalIdFrom(url, HOME_SS_GE), '36474494');
  assert.equal(transactionFromUrl(url, HOME_SS_GE), 'SALE');
});

test('a URL that says nothing about the transaction is not guessed at', () => {
  assert.equal(transactionFromUrl(CAPTURED.zaraya, ZARAYA), null);
});

/* ── failing visibly ───────────────────────────────────────────────────── */

test('a page that was not understood fails rather than yielding nulls', () => {
  /*
   * The failure mode this exists to prevent: an extractor that shrugs and
   * returns a listing full of nulls puts something shaped like inventory into
   * the corpus, which is worse than an outage because nobody notices.
   */
  const result = extractListing(
    '<html><head><title>Maintenance</title></head><body><p>We will be back shortly.</p></body></html>'.padEnd(400, ' '),
    'https://www.home24.ge/ge/some-page',
    HOME24_GE,
  );
  assert.equal(result.ok, false);
  assert.equal(result.listing, null);
  assert.match(result.reason, /not understood|no listing id/);
});

test('an empty response is refused', () => {
  const result = extractListing('', CAPTURED.home24, HOME24_GE);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no document/);
});

test('a site that drops one of two equivalent fields still parses', () => {
  /*
   * home24 currently publishes the area twice — a PropertyValue and a
   * QuantitativeValue. Both rules are configured on purpose: if the site
   * drops one, the other answers and `missing` records which went away,
   * rather than the area silently becoming null.
   */
  const areaRules = HOME24_GE.enrich.filter((r) => r.field === 'areaSqm');
  assert.equal(areaRules.length, 2);
  assert.deepEqual(areaRules.map((r) => r.from).sort(), ['PROPERTY_VALUE', 'QUANTITATIVE_VALUE']);
});

test('missing fields are reported, not hidden', () => {
  /*
   * zaraya rather than place.ge: place.ge now matches every rule configured
   * for it and correctly reports nothing missing, which is the right answer
   * and made this assertion meaningless there. The point stands and needs a
   * source that genuinely has a gap.
   */
  const result = extractListing(fixture('zarayaproperties.com.detail.html'), CAPTURED.zaraya, ZARAYA);
  assert.ok(Array.isArray(result.missing));
  assert.ok(result.missing.length > 0, 'a page with an unmatched rule reported nothing missing');

  // And a source whose every rule matched says so, rather than padding the list.
  const complete = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE);
  assert.deepEqual(complete.missing, []);
});

/* ── the fixtures are real ─────────────────────────────────────────────── */

test('the fixtures are what the sites served, not hand-written markup', () => {
  /*
   * A hand-written fixture tests the author's idea of the markup. Real
   * captures are large, carry the site's own scripts and metadata, and break
   * when the site changes — which is the signal DEGRADED is for.
   */
  /*
   * home.ss.ge is absent on purpose: ss-ge.ts has carried its own captured
   * __NEXT_DATA__ payload since before this framework existed, and keeping a
   * second 1.1MB copy of the same site in the repository to assert its size
   * would be a megabyte spent on nothing.
   */
  for (const name of [
    'home24.ge.detail.html', 'place.ge.detail.html',
    'zarayaproperties.com.detail.html',
  ]) {
    const html = fixture(name);
    assert.ok(html.length > 50_000, `${name} is only ${html.length} bytes — is it real?`);
    assert.match(html, /<html/i);
  }
});

test('no configuration invents a value from another value', () => {
  /*
   * Every rule maps something the page CARRIES to a field. A rule that could
   * compute would be a rule that could invent, and the difference between a
   * source that published an area and one where we worked it out is the
   * difference between evidence and a guess.
   */
  const src = readFileSync('src/research-core/adapters/portal/family.ts', 'utf8');
  const rules = src.slice(src.indexOf('export type EnrichmentRule'), src.indexOf('export interface PortalSourceConfig'));
  for (const forbidden of [/compute/i, /default/i, /fallbackValue/i, /assume/i]) {
    assert.equal(forbidden.test(rules), false, `the rule vocabulary allows ${forbidden}`);
  }
});
