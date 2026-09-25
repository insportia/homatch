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
    { field: 'city', from: 'TEXT_CAPTURE', scope: 'TITLE',
      pattern: /\u10dd\u10d7\u10d0\u10ee\u10d8,\s*([^,]{3,25}),/ },
    /*
     * THE DISTRICT, READ ONLY FROM THIS LISTING'S OWN TITLE.
     *
     * This rule produced a district of "\u10d1\u10d8\u10dc\u10d0" -- which means "apartment"
     * -- in production, on listing 1317870. Its title is
     * "\u10d8\u10e7\u10d8\u10d3\u10d4\u10d1\u10d0, \u10d1\u10d8\u10dc\u10d0, 3 \u10dd\u10d7\u10d0\u10ee\u10d8, \u10d7\u10d1\u10d8\u10da\u10d8\u10e1\u10d8, \u10e1\u10d0\u10e1\u10ec\u10e0\u10d0\u10e4\u10dd\u10d3": no
     * macro-district and no district, because that seller did not give one.
     * Unscoped, the pattern went on scanning the visible page and matched a
     * RELATED LISTING in the sidebar.
     *
     * The pattern was right, the page was readable, and the answer was a real
     * word from a real listing -- just not this one, and nothing in the counts
     * could show it. The same sidebar had already produced one price for
     * three listings and an area that was a price per square metre.
     *
     * Scoped to the title, a listing that omits the slot yields absence,
     * which is what 1317870 should have said in the first place.
     */
    { field: 'district', from: 'TEXT_CAPTURE', scope: 'TITLE',
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
     * ROOMS FROM THE TITLE'S OWN SLOT, and scoped so it cannot be anything
     * else. The page prints seven other room counts -- the related-listings
     * sidebar -- and matching on the page would read whichever the layout
     * happened to put first. The title's comma-delimited shape is published
     * deliberately and in a fixed order, so it is both the anchor and, now,
     * the only text this rule can see.
     */
    { field: 'rooms', from: 'TEXT_PATTERN', scope: 'TITLE',
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
    /*
     * THIS SITE PUTS SPACES INSIDE ITS NUMBERS.
     *
     * It prints "$ 383, 521" and "113. 30 m²" -- a thousands separator with
     * a space after it, and a decimal point with a space after it. The first
     * area rule here was an unanchored `(\d{2,4}(?:[.,]\d+)?)\s*m²`, which
     * could not span the gap in "113. 30", so it matched further along and
     * returned an area of 30 for a 113 m² apartment. Plausible, wrong, and
     * invisible: 30 m² is a real size for a real flat.
     *
     * numberFrom already reassembles these correctly -- it strips whitespace
     * before parsing -- so the fix is entirely in what the patterns are
     * allowed to span and where they are anchored.
     *
     * EVERY RULE BELOW IS ANCHORED ON THE SPEC TABLE'S OWN LABEL ROW, which
     * the page prints as a block:
     *
     *   BEDROOMS BATHROOMS BUILT FLOORS LOCATION  2  1  113. 30 m²  44  Batumi
     *
     * The labels come first and the values follow in the same order, so each
     * rule re-states the whole label sequence and counts across. That reads
     * positionally, which is fragile -- and it fails CLOSED: a page with a
     * different label set matches nothing and yields absent fields rather
     * than another listing's numbers.
     */
    { field: 'areaSqm', from: 'TEXT_PATTERN',
      pattern: /BEDROOMS\s+BATHROOMS\s+BUILT\s+FLOORS\s+LOCATION\s+\d+\s+\d+\s+([\d.,\s]+?)\s*m²/i },
    { field: 'bedrooms', from: 'TEXT_PATTERN',
      pattern: /BEDROOMS\s+BATHROOMS\s+BUILT\s+FLOORS\s+LOCATION\s+(\d+)\s/i },
    /*
     * The BUILDING's height, not this unit's floor. A 44-storey tower is a
     * fact about the tower, and putting it in `floor` would say this
     * apartment is on the 44th.
     */
    { field: 'totalFloors', from: 'TEXT_PATTERN',
      pattern: /LOCATION\s+\d+\s+\d+\s+[\d.,\s]+?\s*m²\s+(\d+)\s/i },
    /*
     * PRICE, ANCHORED ON THE TABLE THAT FOLLOWS IT.
     *
     * The page carries a second dollar figure in its prose -- "buyers
     * investing over $100,000 can obtain permanent residency" -- which is a
     * fact about Georgian immigration law and not the price of this
     * apartment. The listing's own price is the one printed immediately
     * above the spec table, so BEDROOMS is what makes it identifiable.
     *
     * USD because that is the symbol this developer prices in, stated here
     * rather than inferred: a number beside a $ is not a currency
     * declaration, and this site sells to buyers in three languages.
     *
     * VERIFIED LIVE, AND THE TWO LISTINGS CHECK EACH OTHER:
     *
     *   0001   113.30 m2   $383,521   ->  $3,385 / m2
     *   1009    39.25 m2   $129,407   ->  $3,297 / m2
     *
     * Two unrelated units, three times apart in size, landing within 3% of
     * each other per square metre. Either rule reading the wrong number
     * would have to be wrong by the same factor on both pages to produce
     * that, which is what makes it evidence rather than a coincidence.
     */
    { field: 'price', from: 'PRICE_TEXT', side: 'SALE', currency: 'USD',
      pattern: /\$\s*([\d,\s]{4,14}?)\s+BEDROOMS/i },
    /*
     * THE CITY, from the last slot in the same row.
     *
     * Worth reading rather than leaving absent: a listing that states no
     * city survives every city envelope, because absence is not a mismatch.
     * Left unread, this source would widen the envelope of every campaign it
     * appears in and the applied-filter report would have to say so.
     *
     * ", Georgia" is required rather than optional -- it is what makes the
     * captured word a place name instead of whatever else ends that row.
     */
    { field: 'city', from: 'TEXT_CAPTURE',
      pattern: /LOCATION\s+\d+\s+\d+\s+[\d.,\s]+?\s*m²\s+\d+\s+([A-Za-z][A-Za-z\s\-]{2,30}?)\s*,\s*Georgia/i },
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

/**
 * realting.com — the first source here that is not Georgian.
 *
 * WHY IT IS IN THIS BATCH
 *
 * Its estate sitemaps carry listings in Montenegro, Cambodia, Poland, the
 * United States, Thailand, Cyprus, Latvia, Turkey, Lithuania, Israel and
 * Georgia. It is here BECAUSE of that. Four Georgian portals make a Georgian
 * scraper; the architecture only earns the word "network" when a source can
 * answer a question about a market nobody here has looked at.
 *
 * It is also the best-published source in the batch. Its detail pages emit
 * schema.org Apartment, Offer, PostalAddress and QuantitativeValue nodes, so
 * the generic reader gets the title, price, currency, area, rooms, bedrooms,
 * year built, country, locality and coordinates with no site-specific rule at
 * all. The enrich list below is empty and that is the point: a source that
 * publishes structured data properly should need no patterns.
 *
 * THREE URL SHAPES, AND ONLY TWO OF THEM ARE LISTINGS WE CAN MODEL
 *
 *   /<country>/property/<id>            a sale
 *   /<country>/property-to-rent/<id>    a long-term tenancy
 *   /<country>/short-term-rental/<id>   a NIGHTLY rate
 *
 * The third is deliberately unmatched by the pattern below, so those pages
 * are never treated as listings. The model has SALE and RENT and nothing
 * else, and folding a per-night price into ASKING_RENT would pool it with
 * monthly rents and produce a rental market that does not exist — the same
 * error as a monthly figure landing in the sale field, one level along.
 *
 * WHAT IT COST TO ADD, WHICH WAS NOT NOTHING
 *
 * Its JSON-LD says `"@id": "property1"` on every listing — a document-local
 * anchor the Offer and Product nodes point at, not an identity. The reader
 * preferred that over the URL's id, so this entire portal would have
 * collapsed into ONE observation, overwritten on every pass. And its
 * `"@type": "Apartment"` arrived lowercased while every source config
 * declares the vocabulary in capitals, which would have made a campaign
 * asking for APARTMENT reject every flat here and made the entity resolver
 * call one cross-posted flat two properties. Both were framework defects
 * that four Georgian portals had never provoked.
 */
export const REALTING: PortalSourceConfig = {
  id: 'realting-com',
  host: 'realting.com',
  /*
   * PROPERTY_PORTAL, not a family of its own. The family axis says what KIND
   * of source this is -- it weights source independence, so two portals
   * count as less corroboration than a portal and a registry. Geography is
   * not a kind, and inventing INTERNATIONAL_PORTAL would have split that
   * weighting on an axis that has nothing to do with whether two sources are
   * really independent.
   */
  family: 'PROPERTY_PORTAL',
  strategy: 'SCHEMA_ORG',
  /* The market this source is registered against by default. The adapter
     carries the full list, and each collection route names its own. */
  countryCode: 'GE',
  /*
   * The languages Homatch can actually run a campaign in. This site also
   * publishes German, Spanish, Polish and French, and those are not listed
   * because ResearchLanguage does not have them: the campaign language
   * system covers ka/en/ru/he/ar/tr/hi, and claiming a language the planner
   * cannot select would put a coverage number in a report for work no
   * campaign can commission.
   */
  languages: ['en', 'ru'],
  detailUrl: {
    pattern: /realting\.com\/[a-z-]+\/property(?:-to-rent)?\/(\d+)/i,
    idGroup: 1,
  },
  transactionFromUrl: [
    { match: /\/property-to-rent\//i, transaction: 'RENT' },
    { match: /\/property\/\d+/i, transaction: 'SALE' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  /*
   * EMPTY, AND VERIFIED EMPTY. Everything this source publishes comes out of
   * its schema.org nodes. A rule added here would be a rule reading prose on
   * a page that already stated the same fact as data, and it would score
   * lower for it.
   */
  enrich: [],
};

/*
 * A LIMITATION OF REALTING'S PRICES, FOUND BY LOOKING AT ONE THAT LOOKED WRONG.
 *
 * A Warsaw studio came back at $426,627 for 36 m2 — about $11,850 per square
 * metre, extreme even for a prestige tower. The extraction is faithful: the
 * site's own Offer node says `"price": 426627, "priceCurrency": "USD"`.
 *
 * But the same page carries these:
 *
 *   data-price-EUR="€375 053"   data-price-USD="$426 627"
 *   data-price-GBP="£322 855"   data-price-AED="1,57M AED"
 *   data-price-RUB="36,26M ₽"   data-price-BYN="1,29M Br"
 *
 * Six currencies and NO PLN. realting converts, the JSON-LD emits whichever
 * currency the session is displaying, and for a Polish flat the seller's own
 * asking currency is not published at all.
 *
 * So a realting price outside a USD-denominated market is realting's
 * conversion, at a rate and on a date this repository does not know. It is
 * recorded as the source stated it — currency USD, origin JSON_LD — because
 * that is literally what the source published, and inventing an "original
 * currency" from one listing would be the guess this file exists to avoid.
 *
 * WHERE IT MATTERS AND WHERE IT DOES NOT. Georgia prices property in USD, so
 * a Georgian realting price and an ss.ge price are the same kind of number.
 * Comparing a Polish realting price against another Polish source would be
 * comparing a conversion with an asking price, and there is no second Polish
 * source yet. The model has no currency-provenance field to say this in data;
 * until it does, this comment is where it is said.
 */



/**
 * makler.ge — a classifieds board that publishes in seven languages.
 *
 * WHY IT IS HERE
 *
 * Its sitemap index carries sitemap_ka, _en, _ru, _tr, _ar, _zh and _he.
 * Six of those seven are Homatch campaign languages, which makes this the
 * first source in the batch that can answer a question asked in Hebrew,
 * Arabic or Turkish with the site's own text rather than a translation.
 *
 * ITS COLLECTION PAGE HAS NO LINKS
 *
 * 375KB of markup, 46 mentions of /ad/, and not one <a href> to a listing.
 * Scraping anchors found nothing and would have written the source off as a
 * client-rendered shell. It is not: the grid publishes a schema.org ItemList
 * with every listing's url and numberOfItems — 1,056 for apartments for sale
 * in Tbilisi — so the site states its listing URLs deliberately, as data.
 * That is what itemListUrls() in configured.ts now reads, and makler is also
 * the first source to give a real totalAvailable instead of null.
 *
 * AND THOSE URLS DO NOT WORK
 *
 * The ItemList publishes https://www.makler.ge/ge/ad/<id>--<id>, and /ge/
 * answers HTTP 500 on every listing: the site uses /ka/ for Georgian
 * everywhere else. Same id, same page, working prefix — verified on
 * 20063506, where /ge/ 500s and /ka/ returns 5,041 characters of listing.
 *
 * So the rewrite below is a stated correction, not a guess, and it is
 * declarative so a test can check it. Fixing it in configuration is right:
 * the alternative is an adapter that politely fetches 500s forever because
 * the site's own canonical URLs are broken.
 */
export const MAKLER_GE: PortalSourceConfig = {
  id: 'makler-ge',
  host: 'makler.ge',
  family: 'CLASSIFIEDS',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  /* The seven its sitemaps cover, minus zh which the model has no campaign
     language for. Claiming zh would put a coverage number in a report for
     work no campaign can commission. */
  languages: ['ka', 'en', 'ru', 'tr', 'ar', 'he'],
  detailUrl: { pattern: /makler\.ge\/[a-z]{2}\/ad\/[^/]*?(\d{6,})$/i, idGroup: 1 },
  urlRewrite: { match: /\/ge\/ad\//i, replace: '/ka/ad/' },
  transactionFromUrl: [
    { match: /iyideba|for-sale|prodazha/i, transaction: 'SALE' },
    { match: /qiravdeba|for-rent|arenda/i, transaction: 'RENT' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: [
    /*
     * LABEL-ANCHORED, every one. The page carries a related-listings strip
     * with its own areas (114, 147, 120 m²), and this source's own spec
     * block is the only place these Georgian labels appear with a colon.
     * Verified against the captured page: each pattern matches twice, both
     * times this listing's own value.
     */
    { field: 'areaSqm', from: 'TEXT_PATTERN',
      pattern: /\u10e4\u10d0\u10e0\u10d7\u10dd\u10d1\u10d8\s*:\s*([\d.,]+)\s*m/ },
    { field: 'rooms', from: 'TEXT_PATTERN',
      pattern: /\u10dd\u10d7\u10d0\u10ee\u10d4\u10d1\u10d8\s*:\s*(\d+)/ },
    { field: 'bedrooms', from: 'TEXT_PATTERN',
      pattern: /\u10e1\u10d0\u10eb\u10d8\u10dc\u10d4\u10d1\u10d4\u10da\u10d8\s*:\s*(\d+)/ },
    /*
     * "\u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d8 \u10e1\u10e3\u10da" is the building's height and "\u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d8" alone is this
     * unit's floor. The totalFloors pattern is written first and is more
     * specific; the floor pattern requires the colon to follow immediately,
     * so it cannot swallow the other label.
     */
    { field: 'totalFloors', from: 'TEXT_PATTERN',
      pattern: /\u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d8\s*\u10e1\u10e3\u10da\s*:\s*(\d+)/ },
    { field: 'floor', from: 'TEXT_PATTERN',
      pattern: /\u10e1\u10d0\u10e0\u10d7\u10e3\u10da\u10d8\s*:\s*(\d+)/ },
  ],
};

/*
 * MAKLER PUBLISHES A PRICE AND THIS CONFIGURATION DOES NOT READ IT.
 *
 * The page prints three figures side by side with a lari/dollar/euro
 * selector and no label on any of them:
 *
 *   \u10e4\u10d0\u10e1\u10d8: 260 000 / 2 524.27    678 106 / 6 583.55    225 404 / 2 188.39
 *
 * The second number in each pair is that figure divided by the area (103
 * m²), which confirms all three describe this flat. The ratios between them
 * — 678,106/260,000 = 2.608 and 225,404/260,000 = 0.867 — match GEL/USD and
 * EUR/USD, so the order is almost certainly USD, GEL, EUR.
 *
 * "Almost certainly" is not a currency declaration. The selector lists lari
 * FIRST, and if the reading is wrong the error is a factor of 2.6 in a field
 * that decides what a customer is shown. A source that says "260 000" and a
 * source that says "$260,000" are not the same statement, and this file
 * exists to keep that distinction.
 *
 * So: no price rule, the evidence written down, and the next person finishes
 * it from a page where the currency is identifiable — a listing whose
 * selector state is in the markup, or the /en/ variant. place.ge carried a
 * note like this one for a day and was completed from it.
 */

/**
 * estatemarket.ge — developer inventory, and the first source whose own
 * address is in Russian.
 *
 * Its unit pages publish a schema.org Apartment with PostalAddress,
 * QuantitativeValue floorSize and GeoCoordinates, so the generic reader
 * handles it with no rules at all. addressLocality comes back as "\u0411\u0430\u0442\u0443\u043c\u0438"
 * — Batumi, in Cyrillic — which the place table in normalize/place.ts
 * already resolves against "Batumi" and "\u10d1\u10d0\u10d7\u10e3\u10db\u10d8". That was written for the
 * entity resolver before any source needed it; this is the source that does.
 *
 * TWO LEVELS, NOT ONE. /catalog/ lists COMPLEXES and each complex page lists
 * its unit types: /zk/<complex>/<type>-<size>-m2/. The collection route is
 * therefore a complex, not the catalogue — 16 unit links on
 * /zk/next-collection/ against zero on /catalog/.
 *
 * A unit type is not a listing of one flat. It is a developer's offer of a
 * floor plan, which is why the basis is DEVELOPER_PRICE and why two units of
 * the same type in one complex are RELATED rather than duplicates.
 *
 * ITS floorSize AND ITS TITLE DISAGREE, AND THE LIVE RUN SETTLES IT.
 *
 * The JSON-LD says 35 m2 where the title and slug say 45,8 -- a 31% gap in
 * the field the resolver treats as physics within 3%. Three units, read live
 * on 2026-09-25:
 *
 *   studiya-31-51-m2    24 m2   $45,500   ->  $1,896 / m2
 *   1-spalnya-45-8-m2   35 m2   $66,500   ->  $1,900 / m2
 *   2-spalni-79-31-m2   55 m2   $104,500  ->  $1,900 / m2
 *
 * The structured area gives this developer a flat $1,900 per square metre
 * across all three units; the title figures do not. So floorSize is the area
 * the price is quoted against, which is the one a comparison needs. That is
 * evidence, rather than the general rule about data beating prose -- though
 * it happens to agree with it.
 *
 * What the title figure IS remains unknown. Total-including-balcony is the
 * usual explanation and this file is not going to assert it.
 */
export const ESTATEMARKET_GE: PortalSourceConfig = {
  id: 'estatemarket-ge',
  host: 'estatemarket.ge',
  family: 'DEVELOPER_SITE',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  languages: ['ru', 'en'],
  detailUrl: { pattern: /estatemarket\.ge\/(?:en\/)?zk\/[^/]+\/([a-z0-9-]+)\/?$/i, idGroup: 1 },
  /* A developer sells; nothing here is let. */
  transactionFromUrl: [{ match: /\/zk\//i, transaction: 'SALE' }],
  saleBasis: 'DEVELOPER_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: [],
};

/**
 * home.ge — a P0 portal that had never been surveyed.
 *
 * WHY IT IS READ FROM A SITEMAP RATHER THAN A BROWSE PAGE.
 *
 * Its category pages answer HTTP 200 with ZERO bytes to an identifying agent:
 * /en/binebi/iyideba-binebi redirects to a trailing slash and then returns
 * nothing at all. There is no collection page to read. Its sitemap, however,
 * is published, permitted by robots, and carries 17,445 URLs across three
 * child files -- so the site states its own inventory, and that is what this
 * reads. One GET of a document published for the purpose.
 *
 * WHAT THE PATHS MEAN, read off the sitemap on 2026-09-25:
 *
 *   /binebi/iyideba-binebi/<slug>-<id>.html          apartments for sale, 2,164
 *   /binebi/qiravdeba-binebi/<slug>-<id>.html        apartments to rent,   864
 *   /binebi/qiravdeba-binebi-dgiurad/<slug>          daily rentals,        747
 *
 * Each appears three times over -- unprefixed, /en/ and /ru/ -- for the same
 * listing. The routes below take the UNPREFIXED Georgian path only. Taking
 * all three would fetch every listing three times to discover the same sku,
 * and the entity resolver would then be asked to clean up a mess this file
 * created. The same sitemap also carries plumbing services, which is why the
 * path pattern is doing real work.
 *
 * THE PRICE IS THE SITE'S CONVERSION, AND THAT IS WORTH KNOWING.
 *
 * Listing 26565 publishes offers.price 240300 with priceCurrency GEL, while
 * the seller's own description on the same page asks "90 000$" -- a rate of
 * about 2.67. So the structured price is home.ge's conversion of a figure
 * quoted in dollars, not the figure the seller wrote. It is recorded as GEL
 * because GEL is what the Offer states, and because withinEnvelope compares
 * price only within one currency, a USD envelope will leave these
 * unevaluated and say so in appliedFilters rather than convert anything here.
 */
export const HOME_GE: PortalSourceConfig = {
  id: 'home-ge',
  host: 'www.home.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  /* The id is the trailing number of the slug, and it is also the JSON-LD
     sku -- verified equal on 26565 and 11673. */
  detailUrl: { pattern: /home\.ge\/(?:[a-z]{2}\/)?[^?#]*-(\d+)\.html/i, idGroup: 1 },
  transactionFromUrl: [
    { match: /\/iyideba-/i, transaction: 'SALE' },
    { match: /\/qiravdeba-/i, transaction: 'RENT' },
  ],
  propertyTypeFromUrl: [
    { match: /\/binebi\//i, type: 'APARTMENT' },
    { match: /\/saxlebi-agarakebi\//i, type: 'HOUSE' },
    { match: /\/mitsis-nakvetebi\//i, type: 'LAND' },
  ],
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  /*
   * Nothing here. The page publishes a schema.org Product with an Offer
   * carrying price and priceCurrency, and a name that states transaction,
   * rooms, condition, city and district in Georgian. The SCHEMA_ORG strategy
   * reads all of it, and a text rule invented on top would be a second
   * reader of a page that already answers properly.
   */
  enrich: [],
};

export const PORTAL_SOURCES: readonly PortalSourceConfig[] = [
  HOME_SS_GE, HOME24_GE, PLACE_GE, ZARAYA, REALTING, MAKLER_GE, ESTATEMARKET_GE,
  HOME_GE,
];

export function sourceForUrl(url: string): PortalSourceConfig | null {
  return PORTAL_SOURCES.find((config) => config.detailUrl.pattern.test(url)) ?? null;
}

export function sourceById(id: string): PortalSourceConfig | null {
  return PORTAL_SOURCES.find((config) => config.id === id) ?? null;
}
