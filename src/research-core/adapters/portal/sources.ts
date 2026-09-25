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
 * place.ge — OpenGraph only, and honest about it.
 *
 * The probe found og:url, og:type, og:title and og:image and no structured
 * data at all. So this configuration reads what OpenGraph carries and takes
 * the numbers it can from the page's own visible text, with every one of
 * those recorded as TEXT provenance — the weakest kind, so a consumer
 * weighing evidence can see the difference between a number the site
 * published and a number found in a sentence.
 *
 * There is deliberately no price rule. place.ge writes prices in several
 * formats and currencies in running text, and a pattern that guessed would
 * produce a number that looks like a market figure and is not. A listing from
 * here carries a title, an id and an area, and says nothing about money.
 */
export const PLACE_GE: PortalSourceConfig = {
  id: 'place-ge',
  host: 'place.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'OPEN_GRAPH',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  detailUrl: { pattern: /place\.ge\/[a-z]{2}\/[^/]+\/(\d+)/i, idGroup: 1 },
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
    // "120 მ²" / "120 m2". Group 1 is the number and nothing else.
    { field: 'areaSqm', from: 'TEXT_PATTERN', pattern: /(\d{2,4}(?:[.,]\d+)?)\s*(?:მ²|m²|m2|кв\.?м)/i },
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
