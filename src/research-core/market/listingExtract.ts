/*
 * A PAGE BECOMES EVIDENCE.
 *
 * Extraction is tried structured-first, because a portal that publishes
 * schema.org data is telling us what it means rather than leaving us to infer
 * it. korter.ge's building page carries an Apartment+Product block with the
 * project name, the developer, a room range, a floor-size range and geo
 * coordinates — all of it unambiguous, none of it guessable from prose.
 *
 * Where there is no structured block the heuristics read what a listing page
 * always shows: an address line, an area, a price. myhome.ge is read this way.
 *
 * ── A MISSING OPTIONAL FIELD NEVER DISCARDS A LISTING ────────────────
 *
 * A 90 m² flat on Krtsanisi Street at $2,056/m² with no floor number and no
 * stated condition is still the single most relevant observation this report
 * can carry. Requiring a full record is how a local result gets thrown away in
 * favour of a complete city-wide one.
 */

import type { SellerType } from './geoTier.ts';

export interface ExtractedListing {
  sourceDomain: string;
  url: string;
  canonicalUrl?: string | null;
  project?: string | null;
  developer?: string | null;
  address?: string | null;
  title?: string | null;
  district?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
  price?: number | null;
  currency?: string | null;
  pricePerSqm?: number | null;
  area?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  rooms?: number | null;
  floor?: number | null;
  condition?: string | null;
  sellerType?: SellerType | null;
  listedAt?: string | null;
  /** True when the page describes a development rather than one unit. */
  isProjectPage?: boolean;
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[\s ,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

/** The schema.org types that describe a dwelling or an offer of one. */
const PLACE_TYPES = /Apartment|Residence|House|Product|Offer|RealEstateListing|SingleFamilyResidence/i;

/**
 * Pulls a listing out of one or more ld+json blocks.
 *
 * Returns null when no block describes a place, so the caller can fall back to
 * heuristics rather than treating an Organization or a BreadcrumbList as a
 * property.
 */
export function fromLdJson(
  blocks: unknown[],
  ctx: { url: string; sourceDomain: string }
): ExtractedListing | null {
  const flat: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      flat.push(v as Record<string, unknown>);
      // @graph is how several CMSes wrap everything they know.
      const g = (v as { '@graph'?: unknown })['@graph'];
      if (g) walk(g);
    }
  };
  blocks.forEach(walk);

  const node = flat.find((d) => {
    const t = d['@type'];
    const s = Array.isArray(t) ? t.join(' ') : String(t ?? '');
    return PLACE_TYPES.test(s);
  });
  if (!node) return null;

  const addr = (node.address ?? {}) as Record<string, unknown>;
  const geo = (node.geo ?? {}) as Record<string, unknown>;
  const brand = (node.brand ?? {}) as Record<string, unknown>;
  const floorSize = (node.floorSize ?? {}) as Record<string, unknown>;
  const rooms = (node.numberOfRooms ?? {}) as Record<string, unknown>;
  const offers = (node.offers ?? {}) as Record<string, unknown>;

  const areaMin = num(floorSize.minValue);
  const areaMax = num(floorSize.maxValue);
  const area = num(floorSize.value) ?? (areaMin !== null && areaMax !== null && areaMin === areaMax ? areaMin : null);
  const price = num(offers.price) ?? num(offers.lowPrice);

  const street = text(addr.streetAddress);
  const locality = text(addr.addressLocality);

  return {
    sourceDomain: ctx.sourceDomain,
    url: ctx.url,
    canonicalUrl: text(node.url) ?? ctx.url,
    project: text(node.name),
    developer: text(brand.name),
    address: street ?? (locality ? locality : null),
    title: text(node.name),
    city: locality,
    district: text(addr.addressRegion),
    lat: num(geo.latitude),
    lon: num(geo.longitude),
    price,
    currency: text(offers.priceCurrency),
    pricePerSqm: price !== null && area ? Math.round(price / area) : null,
    area,
    areaMin,
    areaMax,
    rooms: num(rooms.value) ?? num(rooms.minValue),
    // A range of sizes and rooms describes a development, not one flat.
    isProjectPage: areaMin !== null && areaMax !== null && areaMin !== areaMax,
  };
}

/* ------------------------------------------------------------------ *
 * Heuristics, for pages with nothing structured                       *
 * ------------------------------------------------------------------ */

const AREA_RE = /([0-9]+(?:[.,][0-9]+)?)\s*(?:m²|მ²|м²|кв\.?\s?м|sq\.?m)/giu;
const PRICE_RE = /(?:\$|USD)\s*([0-9][0-9\s ,]{2,})|([0-9][0-9\s ,]{2,})\s*(?:\$|USD|₾|GEL|ლარი)/giu;

/**
 * Reads a rendered page's text.
 *
 * `innerText` rather than HTML: a portal's markup changes constantly and its
 * visible text does not, and the numbers a buyer can see are the numbers we
 * are entitled to record.
 */
export function fromPageText(
  body: string,
  ctx: { url: string; sourceDomain: string; streetHints?: readonly string[] }
): ExtractedListing | null {
  /*
   * No length guard.
   *
   * There was one, at 40 characters, and it discarded
   * "90 m²  $2,056  Krtsanisi St" — a complete local observation in 27. Length
   * is not a signal of whether a page said anything; whether anything was
   * extracted is, and that is checked below.
   */
  if (!body) return null;

  const areas = [...body.matchAll(AREA_RE)].map((m) => num(m[1])).filter((n): n is number => n !== null && n > 5);
  const prices = [...body.matchAll(PRICE_RE)]
    .map((m) => num(m[1] ?? m[2]))
    .filter((n): n is number => n !== null && n > 50);

  /*
   * FORWARD FROM THE STREET NAME, NEVER BACKWARDS INTO THE PROSE.
   *
   * These windows reached 25-30 characters either side of the hint, and on
   * "Продается 3 комнатная квартира, Крцаниси улица 6" that returned a span
   * whose most prominent word was "комнатная" — which then became the street,
   * and the acceptance fixture failed to match its own address. The address
   * runs FORWARD from the name: that is where the word "street" and the
   * building number sit, in all three scripts.
   */
  const address = addressWindow(body, ctx.streetHints ?? [], 34);

  if (!areas.length && !prices.length && !address) return null;

  /*
   * A portal shows both a total and a per-m² figure, and which is which is not
   * marked. The smaller of two plausible values is the rate: no Tbilisi flat
   * costs less per square metre than in total.
   */
  /*
   * SANITY BANDS, BECAUSE A CATEGORY PAGE IS NOT A LISTING.
   *
   * Reading a page that lists twenty flats mixes their numbers together. The
   * live crawl produced „3,457 m² at $40/m²" from one such page and put it in
   * a same-street median — a number no source published, assembled out of two
   * that were never about each other.
   *
   * These are deliberately wide: a genuine Tbilisi apartment is under 1,000 m²
   * and its rate is not two digits. Anything outside that is an artefact of
   * reading a list as though it were a record, so the FIELD is dropped while
   * the observation is kept — an address on this street is still evidence that
   * the street has inventory, and it is then counted as a locator rather than
   * as a priced comparable.
   */
  const MAX_RESIDENTIAL_SQM = 1_000;
  const MIN_RATE = 150;
  const areasSane = areas.filter((a) => a <= MAX_RESIDENTIAL_SQM);
  const area = areasSane.length ? areasSane[0] : null;
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  const rateCandidate = sorted.find((p) => p >= MIN_RATE) ?? null;
  const perSqm = rateCandidate;
  const total = sorted.length > 1 ? sorted[sorted.length - 1] : null;

  return {
    sourceDomain: ctx.sourceDomain,
    url: ctx.url,
    canonicalUrl: ctx.url,
    address,
    title: null,
    area,
    price: total,
    pricePerSqm: perSqm !== null && perSqm < 20_000 ? perSqm : (total && area ? Math.round(total / area) : null),
    currency: /₾|GEL|ლარი/.test(body) && !/\$|USD/.test(body) ? 'GEL' : 'USD',
    rooms: num((body.match(/([0-9])\s*(?:-|\s)?\s*(?:room|ოთახ|комнат)/i) ?? [])[1]),
    sellerType: sellerTypeFrom(body),
  };
}

/**
 * Who is selling, when the page says so.
 *
 * UNKNOWN is the honest default and by far the most common: most portals do
 * not distinguish, and guessing from a phone number would be an invention.
 */
export function sellerTypeFrom(body: string): SellerType {
  const s = body.toLowerCase();
  if (/დეველოპერ|developer|застройщик|from the builder/.test(s)) return 'DEVELOPER';
  if (/სააგენტო|agency|broker|რიელტორ|агентств|риелтор/.test(s)) return 'BROKER';
  if (/მესაკუთრ|owner|собственник|частное лицо/.test(s)) return 'OWNER';
  return 'UNKNOWN';
}

/* ------------------------------------------------------------------ *
 * The search index is itself a source                                 *
 * ------------------------------------------------------------------ */

/**
 * Evidence taken from a search result, not from the page it points at.
 *
 * ── WHY THIS IS FIRST-CLASS AND NOT A FALLBACK ───────────────────────
 *
 * myhome.ge answers 403 to every non-browser client. Its inventory is not
 * therefore unavailable: the public index carries it, with the numbers
 * included. One Russian query returns, in the snippets alone:
 *
 *   „201,447 · 3,919₾ /м² · 51.4 · Крцаниси улица"
 *   „1,045 · 17₾ /м² · 60 · Крцаниси улица 16"
 *   „6. 146,000 $ m² - 1,446 $"            (home.ss.ge)
 *   „150 м² … ул. Крцаниси. Цена — $375,000" (korter.ge)
 *
 * Those are areas, rates and street numbers on the subject's own street —
 * exactly the evidence the run reported as absent. Treating a blocked fetch as
 * "no inventory" is how SAME_STREET became 0 while the index showed hundreds.
 *
 * ── AND WHY IT CARRIES A WEAKER CONFIDENCE ───────────────────────────
 *
 * A snippet is a fragment chosen by a search engine, not a record. Numbers can
 * belong to a neighbouring listing in the same list page, and a rate may be
 * rent rather than sale. So this returns `confidence: 'INDEX'`, the canonical
 * URL is kept for enrichment, and a caller that later reads the page replaces
 * this rather than adding to it.
 */
export interface SearchIndexResult {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  /** The query that surfaced it, for the discovery post-mortem. */
  query?: string;
}

/*
 * A PER-SQUARE-METRE RATE, WITH THE CURRENCY ON EITHER SIDE OF THE NUMBER.
 *
 * This required the symbol to FOLLOW the number, as „3,919₾ /м²" writes it —
 * and myhome.ge's English pages write „$ 2,056 per m²", so the one priced
 * observation we had on the subject's own street was read as having no price
 * at all. Both orders, and the word between them, are the same fact.
 */
const RATE_RE = /(?:([0-9][0-9\s ,]{2,})\s*(?:₾|\$|USD|GEL)|(?:₾|\$|USD|GEL)\s*([0-9][0-9\s ,]{2,}))\s*(?:\/|per|за)?\s*(?:м²|m²|მ²|кв\.?\s?м)/giu;
/*
 * THE BUILDING NUMBER, IN BOTH WORD ORDERS AND WITHOUT SWALLOWING A DATE.
 *
 * This required the number to sit immediately after the word for "street",
 * which reads „Крцаниси улица 6" correctly and returns nothing at all for
 * „ул. Крцаниси 25" — so korter.ge's neighbour at number 25 was discovered,
 * extracted, and then lost for want of a house number.
 *
 * The abbreviated forms may carry a full stop and an intervening name; the
 * SPELLED-OUT forms may not, because „Крцаниси улица. 7 сент., 18:45" is a
 * street followed by a timestamp, and allowing the sentence break there turns
 * the seventh of September into building 7.
 *
 * An abbreviation must also END where it claims to: „пр" sits inside
 * „Продается", and without the closing boundary „Продается 3 комнатная" read
 * as avenue-name-number and made the room count the house number on every
 * Russian result we had.
 */
const ST_FULL = 'улица|street|ქუჩა|проспект|avenue|გამზირი';
const ST_ABBR = 'ул|st|str|ave|пр|ქ';
const STREET_NO_RE = new RegExp(
  `(?<!\\p{L})(?:(?:${ST_FULL})|(?:${ST_ABBR})\\.?(?!\\p{L}))\\s*,?\\s*(?:\\p{L}{3,}\\s+)?(\\d{1,4})(?![\\d.,]\\d)`,
  'iu'
);
/** Any word meaning "street", for judging whether a window reads as an address. */
const STREET_WORD_RE = new RegExp(`(?<!\\p{L})(?:${ST_FULL}|${ST_ABBR})\\.?(?!\\p{L})`, 'iu');

/*
 * WHICH OCCURRENCE OF THE STREET NAME IS THE ADDRESS.
 *
 * A search result names the street more than once — „Продается 3 комнатная
 * квартира в крцаниси" is the title, and the address itself is further down in
 * the snippet. Taking the FIRST occurrence and reading forward produced
 * „крцаниси Продается 3 комнатная кварт", whose most prominent word is
 * „комнатная", and the acceptance fixture then failed to match its own street.
 *
 * So every occurrence is considered and the most address-like one wins: an
 * address says the word "street", and it carries a number.
 */
function addressWindow(
  text: string,
  hints: readonly string[],
  span: number
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const hint of hints) {
    for (const m of text.matchAll(new RegExp(hint, 'giu'))) {
      const window = text
        .slice(m.index, m.index + hint.length + span)
        .split(/[.;|,\n]/)[0]
        .trim();
      if (!window) continue;
      const score = (STREET_WORD_RE.test(window) ? 2 : 0)
        + (/\d/.test(window) ? 2 : 0)
        + (STREET_NO_RE.test(window) ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = window; }
    }
  }
  return best;
}

/**
 * Reads what a search result already states.
 *
 * Deliberately conservative: only a rate that is explicitly per-square-metre
 * is taken as one, because a bare number beside an address is as likely to be
 * a listing id as a price.
 */
export function fromSearchSnippet(
  r: SearchIndexResult,
  streetHints: readonly string[] = []
): (ExtractedListing & { confidence: 'INDEX' }) | null {
  const text = `${r.title} ${r.snippet}`;
  if (!text.trim()) return null;

  const rates = [...text.matchAll(RATE_RE)]
    .map((m) => num(m[1] ?? m[2]))
    .filter((n): n is number => n !== null && n > 50 && n < 30_000);

  const areas = [...text.matchAll(AREA_RE)]
    .map((m) => num(m[1]))
    .filter((n): n is number => n !== null && n > 10 && n < 2_000);

  let address = addressWindow(text, streetHints, 28);
  if (!address && STREET_NO_RE.test(text)) address = (text.match(STREET_NO_RE) ?? [])[0] ?? null;

  if (!address && !rates.length && !areas.length) return null;

  return {
    sourceDomain: r.domain,
    url: r.url,
    canonicalUrl: r.url,
    address,
    title: r.title,
    area: areas.length ? areas[0] : null,
    pricePerSqm: rates.length ? rates[0] : null,
    price: null,
    currency: /₾|GEL/.test(text) ? 'GEL' : 'USD',
    rooms: num((text.match(/([0-9])\s*-?\s*(?:комнат|room|ოთახ)/i) ?? [])[1]),
    sellerType: sellerTypeFrom(text),
    confidence: 'INDEX',
  };
}

/** The street number a result states, when it states one. */
export function streetNumberFrom(text: string): string | null {
  return (text.match(STREET_NO_RE) ?? [])[1] ?? null;
}
