// HOMATCH RESEARCH CORE — one portal reader, configured per source.
//
// WHY A FAMILY AND NOT EIGHTEEN SCRAPERS
//
// The audit cleared eighteen Georgian property sites. Writing eighteen
// bespoke extractors would mean eighteen places for "asking price" to be
// confused with "transaction price", eighteen date parsers, and eighteen
// opportunities to quietly invent a field the page never carried. The second
// one would already be a copy of the first with three things changed and one
// thing forgotten.
//
// So the shape of the work is: ONE reader, THREE extraction strategies, and a
// configuration row per source. A strategy is chosen because the site
// genuinely differs in how it publishes data, not because it looks different.
//
// THE THREE STRATEGIES, AND THE EVIDENCE FOR EACH
//
// Measured on 2026-09-25 by scripts/probe-property-sources.mjs against the
// live sites, then captured as fixtures:
//
//   SCHEMA_ORG      home24.ge emits RealEstateListing, Offer, PostalAddress,
//                   PropertyValue and QuantitativeValue in ld+json. The whole
//                   listing is in the markup the server already sent.
//
//   EMBEDDED_STATE  home.ss.ge is a Next.js application that ships its search
//                   results inside __NEXT_DATA__. Reading the JSON the server
//                   sent is cheaper than a browser, stable against layout
//                   changes, and every field is one the portal published.
//                   ss-ge.ts already implements this and stays as it is.
//
//   OPEN_GRAPH      place.ge and zarayaproperties.com publish og:title,
//                   og:url, og:image and nothing structured. That is a
//                   genuinely weaker source, and the adapter's job is to say
//                   so rather than to guess the missing fields out of prose.
//
// WHAT A CONFIGURATION MAY NOT DO
//
// Invent. Every rule below maps something the page CARRIES to a field; there
// is no rule that computes a value from another value, no default price, no
// assumed currency and no inferred date. A field the source did not publish
// stays null, and structuredQuality() falls, which is the honest signal that
// a source is thin.
//
// AND WHAT HAPPENS WHEN A SITE CHANGES
//
// It fails visibly. extractListing returns a reason, the caller records
// DEGRADED against the source, and nothing is written. A parser that shrugs
// and returns a listing with six nulls produces garbage that looks like
// inventory, which is worse than an outage because nobody notices.

import type { ResearchLanguage } from '../../discovery/lexicon.ts';
import type { SourceFamily } from '../../discovery/source-lifecycle.ts';
import { extractJsonLd } from '../../parse/json-ld.ts';
import { parseHtml } from '../../parse/html.ts';
import {
  deriveSalePricePerSqm,
  emptyListing,
  type FieldOrigin,
  type NormalizedListing,
  type PriceBasis,
  structuredQuality,
} from '../../parse/listing.ts';
import { listingFromJsonLd } from '../../parse/schema-org.ts';
import type { ListingPropertyType, ListingTransaction } from './types.ts';

export const PORTAL_FAMILY_VERSION = 'portal-family-1.0.0';

export type ExtractionStrategy = 'SCHEMA_ORG' | 'EMBEDDED_STATE' | 'OPEN_GRAPH';

/**
 * A rule that reads ONE field out of what the page published.
 *
 * `from` names where to look; nothing here derives a value from another
 * value. The narrowness is the point: a rule that could compute would be a
 * rule that could invent.
 */
export type EnrichmentRule =
  /** A schema.org PropertyValue, matched by its `name`. */
  | { field: 'areaSqm' | 'rooms' | 'bedrooms' | 'floor' | 'totalFloors' | 'yearBuilt';
      from: 'PROPERTY_VALUE'; name: RegExp }
  /** A QuantitativeValue with a known unit code. MTK is the square metre. */
  | { field: 'areaSqm'; from: 'QUANTITATIVE_VALUE'; unitCode: string }
  /** schema.org PostalAddress parts. */
  | { field: 'city' | 'district' | 'country' | 'street'; from: 'POSTAL_ADDRESS'; key: string }
  /** An og: meta tag. */
  | { field: 'title' | 'description' | 'image'; from: 'OPEN_GRAPH'; property: string }
  /**
   * A number in the page's own visible text, found by a pattern that must
   * capture it in group 1. Used only where a site publishes nothing better,
   * and every match records its origin as the weakest kind.
   */
  | { field: 'areaSqm' | 'rooms' | 'bedrooms' | 'floor' | 'totalFloors';
      from: 'TEXT_PATTERN'; pattern: RegExp }
  /*
   * A price written the way a person reads it: a currency mark and a number,
   * in the page's own visible text.
   *
   * Generic on purpose. Several of the audited sites publish no structured
   * data at all and yet print "GEL2,559,015" and "$5,250 / month" plainly --
   * reading OpenGraph and stopping would have written those sources off as
   * empty when they are not. `currency` is stated by the CONFIGURATION rather
   * than guessed from the symbol, because a bare number next to a symbol is
   * not a currency declaration and getting it wrong misprices a market.
   *
   * `perPeriod` marks a rent. A monthly figure landing in the sale field is
   * the single worst thing this file could do.
   */
  | { field: 'price'; from: 'PRICE_TEXT'; pattern: RegExp; currency: string;
      side: 'SALE' | 'RENT'; perPeriod?: 'MONTH' | 'DAY' | 'YEAR' }
  /*
   * A publication date the page states. NEVER the time we read it: a
   * first-seen date is not a listing date, and the difference is what makes
   * "days on market" a real number or a fabricated one.
   */
  | { field: 'publishedAt'; from: 'DATE_TEXT'; pattern: RegExp; order: 'DMY' | 'YMD' }
  /**
   * A free-text value the page prints: the listing agency, or a place name.
   *
   * Locations are here because several sites put a clean, comma-separated
   * breakdown in the page TITLE -- "for sale, apartment, 3 rooms, Tbilisi,
   * Vake-Saburtalo, Saburtalo" -- which is more reliable than anything in the
   * body and is published deliberately. It is still prose, so it is still
   * recorded as TEXT provenance.
   */
  | { field: 'agencyName' | 'developerName' | 'projectName' | 'city' | 'district';
      from: 'TEXT_CAPTURE'; pattern: RegExp };

export interface PortalSourceConfig {
  /** Stable key. Appears in provenance and in the registry. */
  id: string;
  host: string;
  family: SourceFamily;
  strategy: ExtractionStrategy;
  countryCode: string;
  languages: ResearchLanguage[];

  /**
   * How a detail URL is recognised, and where its canonical id is.
   *
   * The id matters more than it looks: it is what makes the same listing seen
   * twice one entity rather than two, and a source that puts it in the URL
   * gives it to us without a second request.
   */
  detailUrl: { pattern: RegExp; idGroup: number };

  /**
   * What the URL says about the transaction and the property type, where the
   * site encodes them in the path. Checked in order; no match means the
   * listing carries no such claim, which is different from a wrong guess.
   */
  transactionFromUrl?: Array<{ match: RegExp; transaction: ListingTransaction }>;
  propertyTypeFromUrl?: Array<{ match: RegExp; type: ListingPropertyType }>;

  /**
   * The price basis everything from this source carries.
   *
   * ASKING_SALE_PRICE for a portal, DEVELOPER_PRICE for a developer's own
   * site. Never TRANSACTION_PRICE: none of these sources publishes what was
   * actually paid, and a basis is not a detail — pooling an asking price with
   * a transaction price produces a market statistic that is simply wrong.
   */
  saleBasis: PriceBasis;
  rentBasis: PriceBasis;

  enrich?: EnrichmentRule[];
}

export interface ExtractionResult {
  ok: boolean;
  listing: NormalizedListing | null;
  /** 0..1 from structuredQuality: how much of the model the page filled. */
  quality: number;
  /** Fields the configuration expected and the page did not carry. */
  missing: string[];
  reason: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading what a page published
 * ──────────────────────────────────────────────────────────────────────── */

/*
 * FieldOrigin is a STRING, not a record.
 *
 * It is 'API' | 'JSON_LD' | 'MICRODATA' | 'OPEN_GRAPH' | 'URL' | 'TEXT', and
 * ORIGIN_QUALITY indexes it directly. An earlier version of this file wrote
 * `{ kind, sourceId, retrievedAt }`, which type-checked through a cast and
 * made every structuredQuality() call return NaN -- a score that silently
 * poisons any comparison it touches rather than failing.
 *
 * Read off the declaration in core/types.ts, not off what a fixture seemed to
 * suggest.
 */
type OriginKind = 'STRUCTURED' | 'METADATA' | 'DERIVED' | 'TEXT';

const ORIGIN_FOR: Record<OriginKind, FieldOrigin> = {
  // The source published it as machine-readable data.
  STRUCTURED: 'JSON_LD',
  // An og: tag. Published deliberately, and thinner than structured data.
  METADATA: 'OPEN_GRAPH',
  // Read out of the URL, which the source also controls.
  DERIVED: 'URL',
  // Found in prose. The weakest evidence there is.
  TEXT: 'TEXT',
};

function origin(_config: PortalSourceConfig, kind: OriginKind): FieldOrigin {
  return ORIGIN_FOR[kind];
}

/** Every node of every ld+json block, flattened. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
  const flat: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    flat.push(node as Record<string, unknown>);
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  try {
    extractJsonLd(parseHtml(html)).nodes.forEach(walk);
  } catch {
    /* A page whose ld+json is malformed has published nothing usable, which
       the caller sees as a low quality rather than as an exception. */
  }
  return flat;
}

function ogValue(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']*)["']`, 'i',
  );
  const direct = re.exec(html);
  if (direct) return direct[1].trim() || null;
  // Attribute order is not guaranteed; try the reverse spelling before giving up.
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${property}["']`, 'i',
  ).exec(html);
  return reversed ? (reversed[1].trim() || null) : null;
}

/** Visible text, for the TEXT_PATTERN rules and nothing else. */
function visibleText(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A stated date, as an ISO day.
 *
 * `order` is declared by the configuration because 04.09.2026 is the fourth
 * of September in Tbilisi and the ninth of April in a different convention,
 * and there is nothing in the string that settles it. A site that writes
 * ambiguous dates gets whichever order its own locale uses, stated once, in
 * one place, by somebody who looked.
 *
 * No time and no zone: the page said a day. Inventing midnight in a guessed
 * timezone would be inventing precision.
 */
function isoFromParts(raw: string, order: 'DMY' | 'YMD'): string | null {
  const parts = String(raw).match(/(\d{1,4})[.\-/](\d{1,2})[.\-/](\d{1,4})/);
  if (!parts) return null;
  const [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const [year, month, day] = order === 'YMD' ? [a, b, c] : [c, b, a];
  if (!year || !month || !day) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // A portal writes 141.00, 141, "141 m²" and "1 200". Take the first number
  // and nothing clever: a rule that reassembled digits would invent values.
  const match = /(-?\d[\d\s.,]*)/.exec(value.replace(/ /g, ' '));
  if (!match) return null;
  const cleaned = match[1].replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '');
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The reader
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Read one listing page into the shared Supply model.
 *
 * Fails rather than guesses. A page that produced no id, no title and no
 * price is not a thin listing, it is a page we did not understand — and
 * saying PARSE_FAILED is what lets the caller mark the source DEGRADED
 * instead of writing six nulls into the corpus.
 */
export function extractListing(
  html: string,
  url: string,
  config: PortalSourceConfig,
): ExtractionResult {
  if (!html || html.length < 200) {
    return { ok: false, listing: null, quality: 0, missing: [], reason: 'the response carried no document' };
  }

  let listing = emptyListing();
  const missing: string[] = [];

  if (config.strategy === 'SCHEMA_ORG') {
    /*
     * The shared schema.org reader does the heavy lifting -- one parser for
     * title, description, id, price and status, used by every source that
     * publishes them, so "asking price" is decided in one place.
     */
    try {
      /*
       * The basis is handed to the PARSER, not stamped on afterwards.
       * listingFromJsonLd needs it to decide whether an Offer is a sale or a
       * tenancy, so telling it late would mean it had already guessed.
       */
      const parsed = listingFromJsonLd(extractJsonLd(parseHtml(html)).nodes, {
        saleBasis: config.saleBasis,
        rentBasis: config.rentBasis,
      });
      /*
       * MERGED ONTO A COMPLETE LISTING, not assigned over it.
       *
       * listingFromJsonLd returns only the fields it resolved, so assigning
       * it left `rent` and `salePricePerSqm` UNDEFINED rather than null. That
       * is not cosmetic: deriveSalePricePerSqm guards on
       * `salePricePerSqm !== null`, and undefined passes that guard, so the
       * price per square metre was silently never derived on the one source
       * that publishes everything needed to derive it.
       */
      if (parsed) listing = { ...listing, ...parsed };
    } catch {
      return { ok: false, listing: null, quality: 0, missing: [], reason: 'ld+json could not be parsed' };
    }
  }

  // OpenGraph is a FALLBACK everywhere and the primary source only where a
  // site publishes nothing else. Never overwrites a structured value.
  listing.title ??= ogValue(html, 'title');
  listing.description ??= ogValue(html, 'description');
  if (listing.title) listing.fieldOrigins.title ??= origin(config, 'METADATA');

  // The canonical id, from the URL where the site puts it there.
  if (!listing.listingId) {
    const match = config.detailUrl.pattern.exec(url);
    const fromUrl = match?.[config.detailUrl.idGroup];
    if (fromUrl) {
      listing.listingId = fromUrl;
      /*
       * DERIVED, not STRUCTURED. The id came out of the URL, which the source
       * controls but did not publish as data -- recording it as JSON_LD would
       * inflate structuredQuality for a page that published nothing, and
       * quality is what decides which of two conflicting observations wins.
       */
      listing.fieldOrigins.listingId = origin(config, 'DERIVED');
    }
  }

  const nodes = config.strategy === 'OPEN_GRAPH' ? [] : jsonLdNodes(html);
  const TEXT_RULES = new Set(['TEXT_PATTERN', 'PRICE_TEXT', 'DATE_TEXT', 'TEXT_CAPTURE']);
  const text = config.enrich?.some((r) => TEXT_RULES.has(r.from)) ? visibleText(html) : '';

  for (const rule of config.enrich ?? []) {
    const value = readRule(rule, { nodes, html, text });
    if (value === null) { missing.push(rule.field); continue; }
    applyRule(listing, rule, value, config);
  }

  /*
   * Price basis comes from the CONFIGURATION, and for SCHEMA_ORG sources the
   * parser above already applied it. This covers the strategies that build a
   * price without the parser, and it is a fill rather than an overwrite: a
   * parser that identified an Offer as a tenancy must not have that decision
   * replaced by the sale default.
   */
  if (listing.sale && !listing.sale.basis) {
    listing.sale = { ...listing.sale, basis: config.saleBasis };
  }
  if (listing.rent && !listing.rent.basis) {
    listing.rent = { ...listing.rent, basis: config.rentBasis };
  }

  // What the URL says, where it says anything. Applied after the page's own
  // claims so a page that stated its type wins over a path segment.
  /*
   * "product" is not a property type. listingFromJsonLd fills propertyType
   * from the schema.org @type, and on a site that models a listing as a
   * Product that word lands in a field meant to hold APARTMENT or LAND.
   * Treated as absent so the URL's own claim can answer instead.
   */
  const GENERIC_TYPES = /^(product|thing|offer|webpage|article|realestatelisting)$/i;
  if (listing.propertyType && GENERIC_TYPES.test(listing.propertyType)) {
    listing.propertyType = null;
    delete listing.fieldOrigins.propertyType;
  }

  const fromUrlType = config.propertyTypeFromUrl?.find((r) => r.match.test(url))?.type;
  if (!listing.propertyType && fromUrlType && fromUrlType !== 'ANY') {
    listing.propertyType = fromUrlType;
    listing.fieldOrigins.propertyType = origin(config, 'DERIVED');
  }

  listing = deriveSalePricePerSqm(listing);
  const quality = structuredQuality(listing);

  /*
   * THE FLOOR. An id, or a title with a price. Below that the page is not a
   * thin listing -- it is a page the configuration did not understand, and
   * writing it would put something shaped like inventory into the corpus.
   */
  const usable = Boolean(listing.listingId) || Boolean(listing.title && (listing.sale || listing.rent));
  if (!usable) {
    return {
      ok: false, listing: null, quality, missing,
      reason: 'no listing id, and no title with a price: the page was not understood',
    };
  }

  return { ok: true, listing, quality, missing, reason: 'extracted' };
}

function readRule(
  rule: EnrichmentRule,
  ctx: { nodes: Record<string, unknown>[]; html: string; text: string },
): string | number | null {
  switch (rule.from) {
    case 'PROPERTY_VALUE': {
      const node = ctx.nodes.find((n) =>
        String(n['@type']) === 'PropertyValue' && rule.name.test(String(n.name ?? '')));
      return node ? numberFrom(node.value) : null;
    }
    case 'QUANTITATIVE_VALUE': {
      const node = ctx.nodes.find((n) =>
        String(n['@type']) === 'QuantitativeValue' && String(n.unitCode ?? '') === rule.unitCode);
      return node ? numberFrom(node.value) : null;
    }
    case 'POSTAL_ADDRESS': {
      const node = ctx.nodes.find((n) => String(n['@type']) === 'PostalAddress');
      const value = node?.[rule.key];
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
    case 'OPEN_GRAPH':
      return ogValue(ctx.html, rule.property);
    case 'TEXT_PATTERN': {
      const match = rule.pattern.exec(ctx.text);
      return match ? numberFrom(match[1]) : null;
    }
    case 'PRICE_TEXT': {
      const match = rule.pattern.exec(ctx.text);
      if (!match) return null;
      const amount = numberFrom(match[1]);
      // Zero is not a price. A page that printed one has not told us what it
      // costs, and a free property is not a thing.
      return amount !== null && amount > 0 ? amount : null;
    }
    case 'DATE_TEXT': {
      const match = rule.pattern.exec(ctx.text);
      return match ? (match[1] ?? null) : null;
    }
    case 'TEXT_CAPTURE': {
      const match = rule.pattern.exec(ctx.text);
      const value = match?.[1]?.trim();
      return value && value.length > 1 ? value : null;
    }
  }
}

/** Rules that read prose. Their findings are the weakest evidence there is. */
const TEXT_ORIGIN_RULES = new Set(['TEXT_PATTERN', 'PRICE_TEXT', 'DATE_TEXT', 'TEXT_CAPTURE']);

function applyRule(
  listing: NormalizedListing,
  rule: EnrichmentRule,
  value: string | number,
  config: PortalSourceConfig,
): void {
  /*
   * A TEXT_PATTERN match is the weakest evidence there is -- a number found
   * in prose -- so it is recorded as such and never overwrites a structured
   * value that is already present.
   */
  const kind: OriginKind = TEXT_ORIGIN_RULES.has(rule.from)
    ? 'TEXT'
    : rule.from === 'OPEN_GRAPH' ? 'METADATA' : 'STRUCTURED';

  const setNumber = (field: keyof NormalizedListing, n: number) => {
    // Through `unknown`: NormalizedListing has no index signature, and a
    // direct cast to Record<string, unknown> is the kind TypeScript refuses
    // for good reason.
    const bag = listing as unknown as Record<string, unknown>;
    if (bag[field] != null) return;
    bag[field] = n;
    listing.fieldOrigins[field as string] = origin(config, kind);
  };

  if (rule.from === 'PRICE_TEXT') {
    const amount = typeof value === 'number' ? value : numberFrom(value);
    if (amount === null || amount <= 0) return;
    /*
     * Sale and rent NEVER pool. A monthly figure in the sale field turns a
     * $5,250 tenancy into a $5,250 flat, and every market statistic built on
     * it is then wrong in a way nobody can see.
     */
    if (rule.side === 'RENT') {
      if (listing.rent) return;
      listing.rent = { amount, currency: rule.currency, basis: config.rentBasis };
      listing.rentPeriod = rule.perPeriod ?? null;
      listing.fieldOrigins.rent = origin(config, kind);
    } else {
      if (listing.sale) return;
      listing.sale = { amount, currency: rule.currency, basis: config.saleBasis };
      listing.fieldOrigins.sale = origin(config, kind);
    }
    return;
  }

  if (rule.from === 'DATE_TEXT') {
    if (listing.publishedAt) return;
    const iso = isoFromParts(String(value), rule.order);
    // An unparseable date stays absent. A wrong one would become market
    // evidence, which is worse than none.
    if (!iso) return;
    listing.publishedAt = iso;
    listing.fieldOrigins.publishedAt = origin(config, kind);
    return;
  }

  if (rule.from === 'TEXT_CAPTURE') {
    const field = rule.field as 'agencyName' | 'developerName' | 'projectName' | 'city' | 'district';
    if (listing[field] != null) return;
    listing[field] = String(value);
    listing.fieldOrigins[field] = origin(config, kind);
    return;
  }

  if (rule.field === 'areaSqm') {
    if (listing.area) return;
    const n = typeof value === 'number' ? value : numberFrom(value);
    if (n === null || n <= 0) return;
    /*
     * 'sqm', lowercase. deriveSalePricePerSqm compares `area.unit !== 'sqm'`
     * and returns the listing untouched on anything else, so 'SQM' meant
     * every derived price per square metre quietly did not happen. Read off
     * the Area declaration rather than guessed from the field name.
     */
    listing.area = { value: n, unit: 'sqm' };
    listing.fieldOrigins.area = origin(config, kind);
    return;
  }

  if (rule.field === 'city' || rule.field === 'district' || rule.field === 'country') {
    if (listing[rule.field] != null) return;
    listing[rule.field] = String(value);
    listing.fieldOrigins[rule.field] = origin(config, kind);
    return;
  }

  if (rule.field === 'street' || rule.field === 'image') return; // carried elsewhere

  if (rule.field === 'title' || rule.field === 'description') {
    if (listing[rule.field] != null) return;
    listing[rule.field] = String(value);
    listing.fieldOrigins[rule.field] = origin(config, kind);
    return;
  }

  const n = typeof value === 'number' ? value : numberFrom(value);
  if (n === null) return;
  setNumber(rule.field as keyof NormalizedListing, n);
}

/**
 * Is this URL a listing on this source?
 *
 * Used to decide whether a link found on a collection page is worth
 * following, so it is deliberately strict: a false positive costs a request
 * to a page that is not a listing, which is somebody else's server.
 */
export function isDetailUrl(url: string, config: PortalSourceConfig): boolean {
  return config.detailUrl.pattern.test(url);
}

export function canonicalIdFrom(url: string, config: PortalSourceConfig): string | null {
  const match = config.detailUrl.pattern.exec(url);
  return match?.[config.detailUrl.idGroup] ?? null;
}

/** What the URL says the transaction is, or null when it says nothing. */
export function transactionFromUrl(url: string, config: PortalSourceConfig): ListingTransaction | null {
  return config.transactionFromUrl?.find((r) => r.match.test(url))?.transaction ?? null;
}
