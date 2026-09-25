// HOMATCH RESEARCH CORE — the configured property sources.
//
// One row per source, and every value in it came from looking at the live
// site rather than from an assumption. The evidence is
// scripts/probe-property-sources.mjs (2026-09-25) and the fixtures captured
// by scripts/capture-listing-fixtures.mjs on the same day.
//
// WHAT A ROW HERE MEANS, AND WHAT IT DOES NOT
//
// It means: this source is AUDITED as permitted, its extraction strategy has
// been observed, and its detail URLs have a shape we can recognise.
//
// It does NOT mean the source is live in production. That is decided by
// source_registry.lifecycle, which only reaches LIVE_TESTED after a real
// controlled run, and by source_may_scan_for_campaign(), which admits
// LIVE_TESTED and PRODUCTIVE and nothing else. A configuration row is an
// adapter existing, not an adapter running.
//
// THE FOUR, AND WHY THESE FOUR
//
// Chosen from the eighteen the audit cleared, for inventory and for
// structural difference — a framework validated against two portals sharing
// a CMS has not been validated:
//
//   home.ss.ge     12,021 sitemap URLs. Georgia's dominant classifieds, and
//                  a Next.js app that ships its results in __NEXT_DATA__.
//                  Already implemented in ss-ge.ts and left alone.
//   home24.ge       1,881 URLs, and the only source in the eighteen that
//                  publishes full schema.org: RealEstateListing, Offer,
//                  PostalAddress, PropertyValue, QuantitativeValue.
//   place.ge        7,003 URLs and OpenGraph only. A genuinely weaker source,
//                  and the adapter's job is to say so.
//   zarayaproperties.com
//                  A developer's own site. Small, OpenGraph only, and the
//                  price it publishes is a DEVELOPER_PRICE rather than a
//                  resale asking price — which is the reason it is here.
//
// korter.ge and myhomesale.ge were probed and are deliberately absent: the
// first is a new-development aggregator whose detail pages are PROJECTS
// rather than listings, and the second's collection page yielded no detail
// links matching any pattern its own markup suggested. Both need their own
// look, and guessing a configuration for them would produce an adapter that
// silently returns nothing.

import type { PortalSourceConfig } from './family.ts';

/**
 * home24.ge — the structured one.
 *
 * Detail URLs are /ge/property/<id>/<slug>, so the canonical id is in the URL
 * and needs no second request. The page publishes a RealEstateListing with a
 * PostalAddress broken down to district, an Offer with a price, a
 * PropertyValue named "Area" and a QuantitativeValue in MTK — the UN/CEFACT
 * code for the square metre.
 *
 * Both area rules are present on purpose. The site currently emits both, and
 * a source that drops one has not broken: the other still answers, `missing`
 * records which went away, and nothing silently becomes null.
 */
export const HOME24_GE: PortalSourceConfig = {
  id: 'home24-ge',
  host: 'home24.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  languages: ['ka', 'en'],
  detailUrl: { pattern: /home24\.ge\/[a-z]{2}\/property\/(\d+)\//i, idGroup: 1 },
  transactionFromUrl: [
    { match: /for[_-]?sale|iyideba/i, transaction: 'SALE' },
    { match: /for[_-]?rent|qiravdeba/i, transaction: 'RENT' },
  ],
  propertyTypeFromUrl: [
    { match: /\bflat\b|\bbina\b/i, type: 'APARTMENT' },
    { match: /\bhouse\b|\bsakhli\b/i, type: 'HOUSE' },
    { match: /\bland\b|\bmitsa\b/i, type: 'LAND' },
    { match: /commercial|komerciuli/i, type: 'COMMERCIAL' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: [
    { field: 'areaSqm', from: 'PROPERTY_VALUE', name: /^area$/i },
    { field: 'areaSqm', from: 'QUANTITATIVE_VALUE', unitCode: 'MTK' },
    { field: 'city', from: 'POSTAL_ADDRESS', key: 'addressLocality' },
    { field: 'district', from: 'POSTAL_ADDRESS', key: 'addressRegion' },
    { field: 'country', from: 'POSTAL_ADDRESS', key: 'addressCountry' },
  ],
};

/**
 * place.ge — not OpenGraph-only after all.
 *
 * THE MISTAKE THIS ROW CORRECTS
 *
 * The first configuration read og:title and gave up, reporting listings with
 * an id and nothing else, and place.ge was very nearly written off as a thin
 * source on the strength of it. Two things were wrong.
 *
 * The detail URL pattern matched /ge/a/<id>/ads — which is an AGENCY page,
 * not a listing. The live test dutifully "parsed" three of them and reported
 * three unique ids that were agency ids. A source that produces confident
 * nonsense is worse than one that produces nothing, and nothing in the
 * numbers would have shown it: three listings, three unique ids, green.
 *
 * The real shape is /ge/ads/view/<id>, which appears thirty times on the very
 * page that was being misread.
 *
 * And the site publishes plenty in its own markup — GEL2,559,015 with a
 * price per square metre beside it, a stated publication date, the listing
 * agency, monthly rents in GEL and USD. None of it is structured data, and
 * all of it is printed where a person can read it.
 *
 * So the rules below read the text. Every one records TEXT provenance, which
 * is the weakest kind and exactly what it is: a number found in prose rather
 * than published as data.
 *
 * Prices are GEL because that is what the symbol on this site is, stated in
 * the configuration rather than inferred at the call site — a bare number
 * beside a symbol is not a currency declaration.
 */
export const PLACE_GE: PortalSourceConfig = {
  id: 'place-ge',
  host: 'place.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'OPEN_GRAPH',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  // /ge/ads/view/<id>. Read off the site's own markup, after the first
  // pattern turned out to match its agency pages.
  detailUrl: { pattern: /place\.ge\/[a-z]{2}\/ads\/view\/(\d+)/i, idGroup: 1 },
  transactionFromUrl: [
    { match: /iyideba|for-sale/i, transaction: 'SALE' },
    { match: /qiravdeba|for-rent/i, transaction: 'RENT' },
  ],
  propertyTypeFromUrl: [
    { match: /\/bina\b/i, type: 'APARTMENT' },
    { match: /\/sakhli\b|\/saxli\b/i, type: 'HOUSE' },
    { match: /\/mitsa\b|\/miwa\b/i, type: 'LAND' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: [
    { field: 'title', from: 'OPEN_GRAPH', property: 'title' },
    { field: 'description', from: 'OPEN_GRAPH', property: 'description' },
    /*
     * PRICE, ANCHORED ON THE PER-SQUARE-METRE SUFFIX.
     *
     * The listing's own price is the only figure printed as
     * "$145,000 / $1,629 per sqm"; the related-listings sidebar prints bare
     * amounts. An unanchored pattern matched the sidebar and returned the
     * SAME number for three different listings -- three green rows of
     * confident nonsense, which is worse than an empty result because
     * nothing in the counts shows it.
     *
     * USD, because that is the symbol this site prices in. Stated here
     * rather than inferred, since a number beside a symbol is not a currency
     * declaration.
     *
     * Verified against three live listings: 145,000 / 140,000 / 140,000.
     */
    { field: 'price', from: 'PRICE_TEXT', side: 'SALE', currency: 'USD',
      pattern: /\$\s*([\d,]{3,12})\s*\/\s*\$[\d,]+\s*\u10d9\u10d5\.\u10db/ },
    // "24.09.2026", day first. Verified: 24.09, 24.09, 25.09 across three.
    { field: 'publishedAt', from: 'DATE_TEXT', order: 'DMY', pattern: /(\d{2}\.\d{2}\.\d{4})/ },
    /*
     * THE TITLE IS THE STRUCTURED PART OF THIS SITE.
     *
     * "\u10d8\u10e7\u10d8\u10d3\u10d4\u10d1\u10d0, \u10d1\u10d8\u10dc\u10d0, 3 \u10dd\u10d7\u10d0\u10ee\u10d8, \u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8, \u10d5\u10d0\u10d9\u10d4-\u10e1\u10d0\u10d1\u10e3\u10e0\u10d7\u10d0\u10da\u10dd, \u10e1\u10d0\u10d1\u10e3\u10e0\u10d7\u10d0\u10da\u10dd" is
     * transaction, type, rooms, city, macro-district, district -- published
     * deliberately and in a fixed order.
     */
    { field: 'city', from: 'TEXT_CAPTURE',
      pattern: /\u10dd\u10d7\u10d0\u10ee\u10d8,\s*([^,]{3,25}),/ },
    { field: 'district', from: 'TEXT_CAPTURE',
      pattern: /\u10dd\u10d7\u10d0\u10ee\u10d8,\s*[^,]{3,25},\s*[^,]{3,30},\s*([^,\-]{3,30})/ },
    /*
     * AREA, ON THE LABEL RATHER THAN THE UNIT.
     *
     * THE MISTAKE THIS REPLACES. The first attempt matched the PRICE PER
     * SQUARE METRE -- "$1,629 / sqm" yielding an area of 629 on a flat that
     * has nothing of the sort. Three listings came back with 629, 573 and
     * 609: all wrong, all plausible, none detectable from the counts. The
     * field was removed and the comment said the figure could not be read
     * without ambiguity.
     *
     * It can. The unit was never the anchor -- the LABEL is. place.ge prints
     * its own spec panel as "\u10e4\u10d0\u10e0\u10d7\u10d8: 89 \u10d9\u10d5.\u10db." and the per-sqm suffix
     * carries no such label, so matching on it cannot reach the price again.
     *
     * The site rounds: its panel says 89 where the seller's own sentence
     * further down says "\u10e1\u10d0\u10d4\u10e0\u10d7\u10dd \u10e4\u10d0\u10e0\u10d7\u10d8: 88.30\u10d9\u10d5.\u10db". The panel is taken
     * because it is the site's field rather than a seller's prose, and the
     * 0.8% difference is inside the 3% the resolver treats as one property.
     *
     * VERIFIED LIVE, AND THE OLD BUG VERIFIES IT.
     *
     * The same three listings that produced the wrong answer:
     *
     *   1317856   89 m2   $145,000   ->  $1,629 / m2
     *   1317855   89 m2   $140,000   ->  $1,573 / m2
     *   1317880   87 m2   $140,000   ->  $1,609 / m2
     *
     * The three areas the broken pattern reported were 629, 573 and 609 --
     * the per-square-metre figures with the leading "1," eaten. Dividing the
     * real price by the real area reproduces all three of those numbers
     * exactly, from two independent places on each page. The evidence that
     * once made the bug convincing is the evidence that now settles it.
     */
    { field: 'areaSqm', from: 'TEXT_PATTERN',
      pattern: /\u10e4\u10d0\u10e0\u10d7\u10d8:\s*([\d.,]+)\s*\u10d9\u10d5\.\u10db/ },
    /*
     * ROOMS FROM THE TITLE'S OWN SLOT, not from the first number beside the
     * word. The page prints seven other room counts -- the related-listings
     * sidebar -- and an unanchored pattern would read whichever the layout
     * happened to put first. That is precisely how three listings once
     * reported the same price. The title's comma-delimited shape is
     * published deliberately and in a fixed order, so it is the anchor.
     */
    { field: 'rooms', from: 'TEXT_PATTERN',
      pattern: /,\s*(\d+)\s*\u10dd\u10d7\u10d0\u10ee\u10d8\s*,/ },
    /*
     * BEDROOMS AND ROOMS ARE NOT THE SAME FIELD and this listing is the
     * reason to keep them apart: the title says 3 rooms, the description
     * says 2 bedrooms, and both are true of one flat. A source that folded
     * them together would produce a bedroom count that is really a room
     * count, which reads as a bigger property than it is.
     */
    { field: 'bedrooms', from: 'TEXT_PATTERN',
      pattern: /(\d+)\s*\u10e1\u10d0\u10eb\u10d8\u10dc\u10d4\u10d1\u10d4\u10da/ },
    /*
     * FLOOR, from the Georgian ordinal. "\u10db\u10d4-3 \u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d6\u10d4" is the third
     * floor; the "\u10db\u10d4-" prefix is what separates it from "in a 5-storey
     * building", which is a different fact about a different thing. A first
     * floor is written "\u10de\u10d8\u10e0\u10d5\u10d4\u10da \u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d6\u10d4" and does not match -- it is
     * absent rather than wrong, which is the side to err on.
     */
    { field: 'floor', from: 'TEXT_PATTERN',
      pattern: /\u10db\u10d4-(\d+)\s*\u10e1\u10d0\u10e0\u10d7\u10e3\u10da/ },
  ],
};

/**
 * zarayaproperties.com — a developer, and priced like one.
 *
 * The only reason this is in the first batch is the price basis. Everything
 * the three portals publish is an ASKING price from whoever holds the
 * property; a developer publishes its own primary-market price, which is a
 * different fact and pools differently. A framework that could only express
 * one of those would produce a market statistic that silently mixes them.
 *
 * Detail URLs are /<lang>/properties-1/<id> with a zero-padded id, which is
 * the canonical identity and stable across the site's three languages — so
 * the same unit in Arabic and English is one entity rather than two.
 */
export const ZARAYA: PortalSourceConfig = {
  id: 'zaraya-properties',
  host: 'zarayaproperties.com',
  family: 'DEVELOPER_SITE',
  strategy: 'OPEN_GRAPH',
  countryCode: 'GE',
  languages: ['en', 'ru', 'ar'],
  // The language prefix is OPTIONAL: the site serves /properties-1/0001 and
  // /ar/properties-1/000614 as the same unit, which is why the numeric id
  // rather than the path is the identity.
  detailUrl: { pattern: /zarayaproperties\.com\/(?:[a-z]{2}\/)?properties-1\/(\d+)/i, idGroup: 1 },
  propertyTypeFromUrl: [{ match: /properties-1/i, type: 'APARTMENT' }],
  // NOT an asking price. A developer's own primary-market figure.
  saleBasis: 'DEVELOPER_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: [
    { field: 'title', from: 'OPEN_GRAPH', property: 'title' },
    { field: 'description', from: 'OPEN_GRAPH', property: 'description' },
    { field: 'areaSqm', from: 'TEXT_PATTERN', pattern: /(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|кв\.?м)/i },
  ],
};

/**
 * home.ss.ge — implemented separately, and listed here for completeness.
 *
 * ss-ge.ts reads __NEXT_DATA__ and was verified against the live site before
 * this framework existed. It stays as it is: rewriting a working, tested
 * adapter to fit a framework built after it would be churn with a regression
 * risk and no benefit. The configuration below is what the framework WOULD
 * use, and exists so the registry and the admin area can describe every
 * source the same way.
 */
export const HOME_SS_GE: PortalSourceConfig = {
  id: 'home-ss-ge',
  host: 'home.ss.ge',
  family: 'CLASSIFIEDS',
  strategy: 'EMBEDDED_STATE',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  // /ka/udzravi-qoneba/<georgian-slug>-<id>, read off the site's own markup.
  detailUrl: { pattern: /home\.ss\.ge\/[a-z]{2}\/udzravi-qoneba\/[a-z0-9-]+-(\d{6,})/i, idGroup: 1 },
  transactionFromUrl: [
    { match: /iyideba/i, transaction: 'SALE' },
    { match: /qiravdeba/i, transaction: 'RENT' },
  ],
  propertyTypeFromUrl: [
    { match: /-bina-|\/bina\b/i, type: 'APARTMENT' },
    { match: /-sakhli-|\/sakhli\b/i, type: 'HOUSE' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
};

export const PORTAL_SOURCES: readonly PortalSourceConfig[] = [
  HOME_SS_GE, HOME24_GE, PLACE_GE, ZARAYA,
];

export function sourceForUrl(url: string): PortalSourceConfig | null {
  return PORTAL_SOURCES.find((config) => config.detailUrl.pattern.test(url)) ?? null;
}

export function sourceById(id: string): PortalSourceConfig | null {
  return PORTAL_SOURCES.find((config) => config.id === id) ?? null;
}
