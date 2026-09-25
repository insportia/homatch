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
  servableUrl,
  transactionFromUrl,
} from '../adapters/portal/family.ts';
import {
  ESTATEMARKET_GE, HOME24_GE, HOME_SS_GE, MAKLER_GE, PLACE_GE, PORTAL_SOURCES, REALTING,
  sourceById, sourceForUrl, ZARAYA,
} from '../adapters/portal/sources.ts';
import { ORIGIN_QUALITY } from '../parse/listing.ts';
import { createPortalRuntime } from '../market/runtime.ts';
import { detailLinks, itemListTotal, itemListUrls } from '../adapters/portal/configured.ts';
import { samePlace } from '../normalize/place.ts';

const DIR = 'src/research-core/adapters/portal/__fixtures__/';
const fixture = (name) => readFileSync(`${DIR}${name}`, 'utf8');

/** The URLs the capture actually landed on. Not invented. */
const CAPTURED = {
  home24: 'https://www.home24.ge/ge/property/1079/For-Sale-Flat',
  place: 'https://place.ge/ge/ads/view/1317856',
  zaraya: 'https://www.zarayaproperties.com/properties-1/0001',
  realting: 'https://realting.com/georgia/property/3820614',
  makler: 'https://www.makler.ge/ka/ad/20063506--20063506',
  estatemarket: 'https://estatemarket.ge/zk/next-collection/1-spalnya-45-8-m2/',
};

/* ── the framework's shape ─────────────────────────────────────────────── */

test('the batch is chosen for difference, and is no longer one country', () => {
  // A framework validated against two portals sharing a CMS has not been
  // validated, so the batch was chosen for difference as well as inventory.
  //
  // Eight since 2026-09-26: home.ge, a P0 portal that had never been
  // surveyed while five smaller sources were built. It is also the first
  // source read from a SITEMAP rather than a collection page, because its
  // category pages answer HTTP 200 with zero bytes -- another shape the
  // framework had not met.
  assert.equal(PORTAL_SOURCES.length, 8);
  const strategies = new Set(PORTAL_SOURCES.map((s) => s.strategy));
  assert.deepEqual([...strategies].sort(), ['EMBEDDED_STATE', 'OPEN_GRAPH', 'SCHEMA_ORG']);
  const families = new Set(PORTAL_SOURCES.map((s) => s.family));
  assert.ok(families.size >= 3, `only ${families.size} families in the batch`);
});

test('at least one source serves a market nobody here has looked at', () => {
  /*
   * THE ASSERTION THAT STOPS THIS BECOMING A GEORGIAN SCRAPER.
   *
   * Four portals in one country exercise one set of assumptions — one
   * currency, one script, one address vocabulary, one legal shape — and a
   * framework that only ever met those has not been shown to generalise. It
   * took an international source to surface two framework defects that four
   * Georgian portals never provoked: a JSON-LD @id adopted as an identity,
   * and a property type that compared wrongly because of its case.
   *
   * This is not a test about realting.com. It is a test that the batch keeps
   * containing something that is not Georgian, whichever source that is.
   */
  const runtime = createPortalRuntime();
  const foreign = runtime.registry.all()
    .filter((adapter) => adapter.countries.some((c) => c !== 'GE'));

  assert.ok(
    foreign.length > 0,
    'every registered adapter serves Georgia only — the network is a scraper',
  );

  // And it must really be registered for those markets, not merely claim them.
  const markets = new Set(foreign.flatMap((adapter) => [...adapter.countries]));
  assert.ok(markets.size >= 2, `only ${markets.size} market(s) across the foreign adapters`);
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

test('the place.ge area is the listing\'s own, and the site\'s arithmetic proves it', () => {
  /*
   * WHAT THIS TEST USED TO ASSERT, AND WHY IT CHANGED.
   *
   * It asserted the area was null. The first pattern had matched the PRICE
   * PER SQUARE METRE — "$1,629 per sqm" yielding an area of 629 on a flat
   * that has nothing of the sort, and three listings came back with 629, 573
   * and 609: all wrong, all plausible. The field was removed, and absent was
   * the honest answer while the figure could not be read unambiguously.
   *
   * It can be read. The unit was never the anchor; the LABEL is. The site's
   * own spec panel prints "ფართი: 89 კვ.მ." and the per-sqm suffix carries
   * no such label, so the pattern that reads it cannot reach the price.
   *
   * AND THE SITE CHECKS ITSELF. This listing prints $145,000 total and
   * $1,629 per square metre. 145000 / 89 = 1629.2. The number that caused
   * the original bug is the number that now confirms the fix, from two
   * independent places on the page.
   */
  const l = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE).listing;
  assert.deepEqual(l.area, { value: 89, unit: 'sqm' });

  const perSqm = l.sale.amount / l.area.value;
  assert.ok(
    Math.abs(perSqm - 1629) < 1,
    `the area disagrees with the site's own per-sqm figure: ${perSqm.toFixed(1)}`,
  );

  /*
   * ROOMS AND BEDROOMS ARE DIFFERENT FIELDS, and this listing is why. The
   * title says three rooms; the description says two bedrooms; both are true
   * of one flat. Folding them together would report a bedroom count that is
   * really a room count, which reads as a bigger property than it is.
   */
  assert.equal(l.rooms, 3);
  assert.equal(l.bedrooms, 2);
  assert.equal(l.floor, 3);

  // Read out of prose, and recorded as prose.
  assert.equal(l.fieldOrigins.area, 'TEXT');
});

test('the place.ge area is not the sidebar\'s, and not the price per sqm', () => {
  /*
   * The failure this source keeps teaching: the page carries seven other
   * room counts and several other prices, all belonging to the
   * related-listings sidebar, and an unanchored pattern reads whichever one
   * the layout happens to put first.
   */
  const l = extractListing(fixture('place.ge.detail.html'), CAPTURED.place, PLACE_GE).listing;
  for (const wrong of [629, 1629, 573, 609]) {
    assert.notEqual(l.area.value, wrong, `the area is a price-per-sqm figure: ${wrong}`);
  }
  assert.ok(l.area.value > 20 && l.area.value < 400, `implausible flat area ${l.area.value}`);
});

/* ── realting.com: the international one ───────────────────────────────── */

test('realting yields a complete listing with NO extraction rules at all', () => {
  /*
   * The enrich list on this source is empty, and that is the claim being
   * tested: a site that publishes schema.org properly should need no
   * site-specific patterns. Everything below comes from its Apartment, Offer
   * and PostalAddress nodes.
   *
   * It is also the standard the other four fall short of. place.ge needs six
   * hand-written patterns and scores 0.38 for it, because the score measures
   * how the SOURCE published rather than how hard we worked.
   */
  assert.deepEqual(REALTING.enrich, []);

  const r = extractListing(fixture('realting.com.detail.html'), CAPTURED.realting, REALTING);
  assert.equal(r.ok, true, r.reason);
  const l = r.listing;

  assert.equal(l.sale.amount, 39900);
  assert.equal(l.sale.currency, 'USD');
  assert.equal(l.sale.basis, 'ASKING_SALE_PRICE');
  assert.deepEqual(l.area, { value: 28, unit: 'sqm' });
  assert.equal(l.rooms, 1);
  assert.equal(l.bedrooms, 1);
  assert.equal(l.yearBuilt, 2026);
  assert.equal(l.country, 'GE');
  assert.equal(l.city, 'batumi');
  assert.equal(l.rent, null, 'a sale listing gained a rent');

  // Every one of those was published as data, not read out of prose.
  for (const field of ['sale', 'area', 'rooms', 'bedrooms', 'city', 'country']) {
    assert.equal(l.fieldOrigins[field], 'JSON_LD', `${field} was not structured`);
  }
  assert.ok(r.quality > 0.8, `a fully structured source scored ${r.quality}`);
});

test('the listing id is the URL\'s, not the JSON-LD @id every page shares', () => {
  /*
   * THE DEFECT THIS SOURCE EXPOSED.
   *
   * realting.com emits `"@id": "property1"` on every listing — a
   * document-local anchor that its Offer and Product nodes point at. The
   * reader preferred a published @id over the URL, so the entire portal
   * would have collapsed into ONE supply_observation: identity is
   * (source_id, external_id), so every listing would have overwritten the
   * last, with a canonical URL that changed each pass and a price belonging
   * to whichever flat was read most recently.
   *
   * That is the place.ge agency-id failure in different clothes, and the
   * argument that made it convincing — "the site published it, so it is
   * data" — is the same one.
   */
  const l = extractListing(fixture('realting.com.detail.html'), CAPTURED.realting, REALTING).listing;
  assert.equal(l.listingId, '3820614');
  assert.notEqual(l.listingId, 'property1');

  /*
   * And it is recorded as URL rather than JSON_LD. The id came out of a URL
   * the source controls but did not publish as data; calling it structured
   * would inflate the score that decides which of two conflicting
   * observations wins.
   */
  assert.equal(l.fieldOrigins.listingId, 'URL');
});

test('a schema.org type reaches the model in the model\'s own vocabulary', () => {
  /*
   * THE SECOND DEFECT, and the quieter one. typesOf() returned the type
   * lowercased — "apartment" — while every source config declares the
   * vocabulary in capitals. Nothing failed loudly. What happened instead:
   * a campaign envelope asking for APARTMENT rejected every flat from this
   * source, and the entity resolver's propertyType CONFLICT rule fired
   * between "apartment" and "APARTMENT", declaring one cross-posted flat two
   * different properties at 0.75 confidence with a reason that read like
   * authority.
   */
  const l = extractListing(fixture('realting.com.detail.html'), CAPTURED.realting, REALTING).listing;
  assert.equal(l.propertyType, 'APARTMENT');

  // The comparison that was silently failing, made explicit.
  assert.equal(l.propertyType === 'APARTMENT', true);
  assert.equal(String(l.propertyType), l.propertyType.toUpperCase());
});

test('a nightly rate is not a tenancy: short-term-rental URLs are not listings', () => {
  /*
   * The site publishes three shapes and the model has two transactions.
   * /<country>/short-term-rental/<id> is a per-night price, and folding it
   * into RENT would pool it with monthly tenancies and produce a rental
   * market that does not exist — the same error as a monthly figure landing
   * in the sale field, one level along.
   *
   * So the pattern does not match those pages at all. They are not listings
   * this adapter has, rather than listings it mislabels.
   */
  assert.equal(isDetailUrl('https://realting.com/georgia/property/3820614', REALTING), true);
  assert.equal(isDetailUrl('https://realting.com/georgia/property-to-rent/3745916', REALTING), true);
  assert.equal(isDetailUrl('https://realting.com/georgia/short-term-rental/2105258', REALTING), false);

  assert.equal(transactionFromUrl('https://realting.com/georgia/property/3820614', REALTING), 'SALE');
  assert.equal(
    transactionFromUrl('https://realting.com/georgia/property-to-rent/3745916', REALTING),
    'RENT',
  );
});

test('a listing whose title omits the district gets NO district, not the sidebar\'s', () => {
  /*
   * PRODUCTION, 2026-09-25. place.ge listing 1317870 was persisted with a
   * district of "\u10d1\u10d8\u10dc\u10d0", which means "apartment".
   *
   * Its real title, as the site served it, is:
   *   "\u10d8\u10e7\u10d8\u10d3\u10d4\u10d1\u10d0, \u10d1\u10d8\u10dc\u10d0, 3 \u10dd\u10d7\u10d0\u10ee\u10d8, \u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8, \u10e1\u10d0\u10e1\u10ec\u10e0\u10d0\u10e4\u10dd\u10d3"
   * — sale, apartment, 3 rooms, Tbilisi, urgent. No macro-district and no
   * district, because that seller did not give one. The other three listings
   * captured the same day all carry both.
   *
   * The pattern went on scanning the visible page, reached the
   * related-listings sidebar, and matched a NEIGHBOURING listing's title. The
   * pattern was correct, the page was readable, and the answer was a real
   * word from a real listing — just not this one, and nothing in the counts
   * could show it.
   *
   * The markup here is the captured fixture with its og:title replaced by
   * 1317870's real title. Both halves are real; the splice is what lets a
   * test reach a listing whose own capture was never taken.
   *
   * AND AGAINST THIS FIXTURE THE UNSCOPED RULE IS WORSE THAN PRODUCTION WAS.
   * It returns "საბურთალო" — Saburtalo, a real Tbilisi district,
   * belonging to a sidebar listing. Production's "ბინა" at least looked
   * wrong to anyone who reads Georgian. A plausible district attached to the
   * wrong flat would have been believed, and would have decided which
   * comparables a customer was shown.
   */
  const withShortTitle = fixture('place.ge.detail.html').replace(
    /(<meta[^>]+property=["\']og:title["\'][^>]+content=["\'])[^"\']*/i,
    '$1\u10d8\u10e7\u10d8\u10d3\u10d4\u10d1\u10d0, \u10d1\u10d8\u10dc\u10d0, 3 \u10dd\u10d7\u10d0\u10ee\u10d8, \u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8, \u10e1\u10d0\u10e1\u10ec\u10e0\u10d0\u10e4\u10dd\u10d3 - place.ge',
  );
  assert.notEqual(withShortTitle, fixture('place.ge.detail.html'), 'the og:title was not replaced');

  const l = extractListing(withShortTitle, CAPTURED.place, PLACE_GE).listing;

  assert.equal(l.city, '\u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8', 'the city is in the title and should still be read');
  assert.equal(
    l.district,
    null,
    `a district was invented from elsewhere on the page: ${l.district}`,
  );
  assert.notEqual(l.district, '\u10d1\u10d8\u10dc\u10d0', 'the district is the word for "apartment"');

  // The rest of the listing still reads: scoping one rule narrows one rule.
  assert.equal(l.sale.amount, 145000);
  assert.deepEqual(l.area, { value: 89, unit: 'sqm' });
});

/* ── wave 2: a board with no links, and a developer in Russian ─────────── */

test('makler publishes its listing URLs as data, not as anchors', () => {
  /*
   * 375KB of collection markup, 46 mentions of /ad/, and not one <a href>
   * to a listing. Scraping anchors found nothing, which would have written
   * this source off as a client-rendered shell.
   *
   * It is not. The grid carries a schema.org ItemList naming every listing,
   * which is the site stating its own URLs deliberately rather than us
   * inferring them from layout.
   */
  const html = fixture('makler.ge.collection.html');
  assert.equal(
    detailLinks(html, 'https://www.makler.ge/ka/iyideba/bina/', MAKLER_GE).length,
    0,
    'the anchors this source does not have have appeared',
  );

  const urls = itemListUrls(html, 'https://www.makler.ge/ka/iyideba/bina/', MAKLER_GE);
  assert.ok(urls.length >= 5, `only ${urls.length} listing url(s) from the ItemList`);
  assert.equal(new Set(urls).size, urls.length, 'the ItemList repeated a listing');
});

test('a total comes from the source or not at all', () => {
  /*
   * makler states numberOfItems on its collection page — 1,056 apartments
   * for sale in Tbilisi — so totalAvailable is a real figure with a
   * provenance for this source. It is NOT a count of what came back, and it
   * is not a denominator for a coverage percentage.
   *
   * Every other source in the batch publishes no total, and for those it
   * stays null: a number invented here would become a market size.
   */
  assert.equal(itemListTotal(fixture('makler.ge.collection.html')), 1056);
  assert.equal(itemListTotal(fixture('realting.com.collection.html')), null);
  assert.equal(itemListTotal('<html><body>no structured data</body></html>'), null);
});

test('a URL the source publishes but does not serve is corrected, once, declaratively', () => {
  /*
   * makler's ItemList names every listing as /ge/ad/<id>--<id>, and /ge/
   * answers HTTP 500 on all of them — the site uses /ka/ for Georgian
   * everywhere else. Verified on 20063506: /ge/ 500s, /ka/ returns the
   * listing.
   *
   * The rewrite is narrow on purpose. It must not reach another source's
   * URLs, and it must not fire on a URL that is already correct.
   */
  assert.equal(
    servableUrl('https://www.makler.ge/ge/ad/20063506--20063506', MAKLER_GE),
    'https://www.makler.ge/ka/ad/20063506--20063506',
  );
  assert.equal(
    servableUrl('https://www.makler.ge/ka/ad/20063506--20063506', MAKLER_GE),
    'https://www.makler.ge/ka/ad/20063506--20063506',
    'the rewrite fired on a URL that was already correct',
  );
  /* A source with no rule is untouched, including one whose URLs contain ge. */
  assert.equal(
    servableUrl('https://realting.com/georgia/property/3820614', REALTING),
    'https://realting.com/georgia/property/3820614',
  );

  // And the URLs the reader hands out are the ones that work.
  const urls = itemListUrls(
    fixture('makler.ge.collection.html'), 'https://www.makler.ge/ka/iyideba/bina/', MAKLER_GE,
  );
  assert.ok(urls.every((u) => u.includes('/ka/ad/')), 'a /ge/ URL reached the fetch path');
});

test('makler reads its spec block and states no price', () => {
  const l = extractListing(fixture('makler.ge.detail.html'), CAPTURED.makler, MAKLER_GE).listing;
  assert.equal(l.listingId, '20063506');
  assert.deepEqual(l.area, { value: 103, unit: 'sqm' });
  assert.equal(l.rooms, 4);
  assert.equal(l.bedrooms, 3);
  assert.equal(l.floor, 2);
  assert.equal(l.totalFloors, 2);

  /*
   * THE PRICE IS ON THE PAGE AND IS DELIBERATELY NOT READ.
   *
   * It prints three unlabelled figures — 260 000, 678 106, 225 404 — with a
   * lari/dollar/euro selector. The ratios match GEL/USD and EUR/USD, so the
   * order is almost certainly USD, GEL, EUR; the selector lists lari first.
   * "Almost certainly" is not a currency declaration, and reading it wrong
   * is a factor of 2.6 in the field that decides what a customer sees.
   */
  assert.equal(l.sale, null, 'a price was read whose currency nobody has identified');
  assert.equal(l.rent, null);
  assert.equal(
    MAKLER_GE.enrich.some((r) => r.field === 'price'),
    false,
    'a price rule appeared without a page that identifies the currency',
  );
});

test('a developer site in Russian lands in the place table that was waiting for it', () => {
  /*
   * estatemarket publishes addressLocality "\u0411\u0430\u0442\u0443\u043c\u0438" — Batumi, in Cyrillic.
   * normalize/place.ts had that row before any source needed it, written
   * for the entity resolver; this is the source that exercises it.
   */
  const r = extractListing(
    fixture('estatemarket.ge.detail.html'), CAPTURED.estatemarket, ESTATEMARKET_GE,
  );
  assert.equal(r.ok, true, r.reason);
  const l = r.listing;

  assert.equal(l.city, '\u0411\u0430\u0442\u0443\u043c\u0438');
  assert.equal(samePlace(l.city, 'Batumi'), true, 'the Cyrillic locality does not resolve');
  assert.equal(samePlace(l.city, '\u10d1\u10d0\u10d7\u10e3\u10db\u10d8'), true);
  assert.equal(samePlace(l.city, 'Tbilisi'), false);

  assert.equal(l.country, 'GE');
  assert.equal(l.propertyType, 'APARTMENT');
  assert.equal(l.sale.currency, 'USD');
  /* A developer's own figure, never an asking price from a reseller. */
  assert.equal(l.sale.basis, 'DEVELOPER_PRICE');
  assert.ok(r.quality > 0.85, `a fully structured source scored ${r.quality}`);
});

test('estatemarket states two different areas and the structured one wins', () => {
  /*
   * Its JSON-LD floorSize says 35 m². Its own title and URL slug say 45,8 —
   * "1-spalnya-45-8-m2". A 31% disagreement, in the field the entity
   * resolver treats as physics within 3%.
   *
   * The structured value is taken because it is the source's DATA and the
   * title is its prose, which is the same rule applied everywhere else here.
   * Recorded rather than reconciled: a developer quoting interior area in
   * one place and total-with-balcony in another is the likely explanation,
   * and guessing which is which would invent a fact about the flat.
   */
  const l = extractListing(
    fixture('estatemarket.ge.detail.html'), CAPTURED.estatemarket, ESTATEMARKET_GE,
  ).listing;
  assert.deepEqual(l.area, { value: 35, unit: 'sqm' });
  assert.equal(l.fieldOrigins.area, 'JSON_LD');
  assert.match(l.title, /45[.,]8/, 'the title no longer disagrees; re-check the source');
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
