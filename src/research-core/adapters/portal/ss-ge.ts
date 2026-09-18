// HOMATCH RESEARCH CORE — the ss.ge (home.ss.ge) listing adapter.
//
// WHY THIS PORTAL, AND WHY WITHOUT A BROWSER
//
// home.ss.ge is a Next.js application that ships its search results inside the
// `__NEXT_DATA__` island of the initial HTML. A plain GET therefore returns
// the same structured records the page itself renders from — application id,
// address down to sub-district, total area, bedroom count, floor, both a GEL
// and a USD price, both per-square-metre figures, and the real creation date.
//
// That matters more than convenience. Reading the JSON the server already sent
// is cheaper than a browser, it is stable against layout changes, and it is
// honest: every field below is a field the portal itself published. Nothing
// here scrapes rendered text, and nothing here needs a browser, a session, or
// any form of protection circumvention.
//
// robots.txt on home.ss.ge disallows only /ka/user, /en/user and /ru/user.
// Real-estate listing and search paths are explicitly permitted, and the
// source policy for this host respects robots and rate-limits the domain.
//
// WHAT THE PORTAL CAN AND CANNOT BE ASKED
//
// Verified live against the running site: `cityIdList`, `subdistrictIds`,
// `areaFrom` and `areaTo` are honoured server-side, and transaction and
// property type are path segments. Bedrooms and price are NOT expressible in
// the query string — several spellings were tried and the result count did not
// move — so they are applied here, after fetching, and reported as client-side
// filters. An envelope that claims a server filter it does not have would make
// a wider result set look like a narrower one.
//
// PRICE BASIS IS NOT NEGOTIABLE
//
// Everything this portal publishes is an ASKING price. A sale search yields
// ASKING_SALE_PRICE, a rent search yields ASKING_RENT, and the two are reached
// through different URLs and never appear in the same result. Nothing here can
// produce TRANSACTION_PRICE, because nothing on this portal is a transaction.

import type { AdapterContext, AdapterOutcome } from '../../discovery/adapter.ts';
import type { PriceBasis } from '../../core/types.ts';
import { emptyListing, type NormalizedListing } from '../../parse/listing.ts';
import { normalizeAddress } from '../../normalize/address.ts';
import type {
  AppliedFilters,
  ListingPortalAdapter,
  ListingQuery,
  ListingSearchResult,
  PortalListing,
} from './types.ts';
import { withinRange } from './types.ts';

const HOST = 'home.ss.ge';
const ORIGIN = 'https://home.ss.ge';

/**
 * The portal's own city ids, read from its own `locations` block.
 *
 * Only the nine cities the portal itself marks visible. Sub-districts are NOT
 * listed here: they are resolved at runtime from the same response, because a
 * hardcoded district table is exactly the kind of catalogue that rots quietly.
 */
const CITY_IDS: Record<string, number> = {
  tbilisi: 95,
  batumi: 96,
  kutaisi: 97,
  rustavi: 98,
  gori: 99,
  zugdidi: 100,
  poti: 101,
  telavi: 102,
  mtskheta: 19,
};

/** Portal property-type codes, confirmed live against each type's own path. */
const TYPE_CODE_APARTMENT = 5;
const TYPE_CODE_HOUSE = 4;
const TYPE_CODE_LAND = 3;
const TYPE_CODE_COMMERCIAL = 6;

const DEAL_CODE_RENT = 1;
const DEAL_CODE_SALE = 4;

const TYPE_PATH: Record<string, string | null> = {
  APARTMENT: 'Apartment',
  HOUSE: 'Private-House',
  LAND: 'Land',
  COMMERCIAL: 'Commercial-Real-Estate',
  ANY: null,
};

const EXPECTED_TYPE_CODE: Record<string, number | null> = {
  APARTMENT: TYPE_CODE_APARTMENT,
  HOUSE: TYPE_CODE_HOUSE,
  LAND: TYPE_CODE_LAND,
  COMMERCIAL: TYPE_CODE_COMMERCIAL,
  ANY: null,
};

/** 16 per page is what the portal serves; asking for more does not change it. */
const PAGE_SIZE = 16;
const MAX_PAGES = 6;

interface SsAddress {
  cityId?: number | null;
  cityTitle?: string | null;
  districtId?: number | null;
  districtTitle?: string | null;
  subdistrictId?: number | null;
  subdistrictTitle?: string | null;
  streetTitle?: string | null;
  streetNumber?: string | null;
}

interface SsPrice {
  priceGeo?: number | null;
  unitPriceGeo?: number | null;
  priceUsd?: number | null;
  unitPriceUsd?: number | null;
  currencyType?: number | null;
}

interface SsItem {
  applicationId?: number | null;
  address?: SsAddress | null;
  price?: SsPrice | null;
  title?: string | null;
  description?: string | null;
  totalArea?: number | null;
  totalAmountOfFloor?: number | null;
  floorNumber?: string | number | null;
  numberOfBedrooms?: number | null;
  type?: number | null;
  dealType?: number | null;
  createDate?: string | null;
  detailUrl?: string | null;
}

interface SsSubDistrict {
  subDistrictId?: number | null;
  subDistrictTitle?: string | null;
  subDistrictTitleSeo?: string | null;
}

interface SsDistrict {
  districtId?: number | null;
  districtTitle?: string | null;
  subDistricts?: SsSubDistrict[] | null;
}

interface SsCity {
  cityId?: number | null;
  cityTitle?: string | null;
  districts?: SsDistrict[] | null;
}

interface SsPageProps {
  initialTotalApplicationCount?: number | null;
  applicationList?: { realStateItemModel?: SsItem[] | null } | null;
  locations?: { visibleCities?: SsCity[] | null } | null;
}

const slug = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9Ⴀ-ჿ]+/g, '')
    .trim();

/**
 * Pull the `__NEXT_DATA__` island out of a page.
 *
 * Returns null rather than throwing: a portal that changes its delivery is a
 * PARSE_FAILED outcome the caller reports honestly, not an exception that
 * takes a verification down with it.
 */
export function parseNextData(html: string): SsPageProps | null {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      props?: { pageProps?: SsPageProps };
    };
    return parsed?.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the portal's own id for a district or sub-district name.
 *
 * Resolved from the `locations` block the portal ships with every search
 * response, so it follows the portal rather than a table we maintain. Matching
 * is slug-based in both directions so "Vake", "vake" and "ვაკე" all land.
 */
export function resolveSubDistrictId(
  locations: SsPageProps['locations'],
  cityId: number,
  name: string | null,
): number | null {
  if (!name) return null;
  const want = slug(name);
  if (!want) return null;
  const city = (locations?.visibleCities ?? []).find((c) => c?.cityId === cityId);
  if (!city) return null;
  for (const district of city.districts ?? []) {
    for (const sub of district.subDistricts ?? []) {
      const title = slug(sub?.subDistrictTitle);
      const seo = slug(sub?.subDistrictTitleSeo);
      if (!sub?.subDistrictId) continue;
      if (title === want || seo === want) return sub.subDistrictId;
      // A subject address often says "Vake district" where the portal says
      // "Vake". Containment in either direction, but only for names long
      // enough that it cannot collide by accident.
      if (want.length >= 4 && (title.includes(want) || want.includes(title)) && title.length >= 4) {
        return sub.subDistrictId;
      }
    }
  }
  return null;
}

function floorOf(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  // "5", "5/12" and "5-6" all state a floor; the first integer is it.
  const match = text.match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one portal record into the canonical Homatch listing shape.
 *
 * Every assignment below is a field the portal published. Where it published
 * nothing, the field stays null — there is no inference step here, and no
 * derived figure that the portal did not itself state.
 */
export function toNormalizedListing(item: SsItem, basis: PriceBasis): NormalizedListing {
  const listing = emptyListing();
  const address = item.address ?? {};
  const price = item.price ?? {};

  listing.title = item.title ?? null;
  listing.description = item.description ?? null;
  listing.listingId = item.applicationId != null ? String(item.applicationId) : null;

  listing.propertyType =
    item.type === TYPE_CODE_APARTMENT
      ? 'APARTMENT'
      : item.type === TYPE_CODE_HOUSE
        ? 'HOUSE'
        : item.type === TYPE_CODE_LAND
          ? 'LAND'
          : item.type === TYPE_CODE_COMMERCIAL
            ? 'COMMERCIAL'
            : null;

  const area = typeof item.totalArea === 'number' && item.totalArea > 0 ? item.totalArea : null;
  listing.area = area === null ? null : { value: area, unit: 'sqm' };

  /*
   * USD is used as the comparison currency because the PORTAL publishes both
   * figures itself — priceUsd and unitPriceUsd sit in the same record as the
   * GEL pair. That is the portal's conversion, not ours, and doing it here
   * would be exactly the silent cross-currency arithmetic the core forbids.
   */
  const usd = typeof price.priceUsd === 'number' && price.priceUsd > 0 ? price.priceUsd : null;
  const perSqm =
    typeof price.unitPriceUsd === 'number' && price.unitPriceUsd > 0 ? price.unitPriceUsd : null;

  if (usd !== null) {
    const money = { amount: usd, currency: 'USD', basis };
    if (basis === 'ASKING_RENT' || basis === 'ACHIEVED_RENT') {
      listing.rent = money;
      // The portal lists residential rent monthly. It does not label the
      // period in this record, so the period is left unstated rather than
      // asserted — a wrong period is worse than an absent one.
      listing.rentPeriod = null;
    } else {
      listing.sale = money;
      // Only ever from the sale side, and only the portal's own figure.
      listing.salePricePerSqm = perSqm;
    }
  }

  listing.bedrooms =
    typeof item.numberOfBedrooms === 'number' && item.numberOfBedrooms > 0
      ? item.numberOfBedrooms
      : null;
  // The portal carries no room count distinct from bedrooms. Missing stays
  // missing: reusing bedrooms as rooms would invent a number.
  listing.rooms = null;
  listing.floor = floorOf(item.floorNumber);
  listing.totalFloors =
    typeof item.totalAmountOfFloor === 'number' && item.totalAmountOfFloor > 0
      ? item.totalAmountOfFloor
      : null;

  listing.city = address.cityTitle ?? null;
  listing.district = address.subdistrictTitle ?? address.districtTitle ?? null;
  listing.country = 'GE';

  const rawAddress = [
    [address.streetTitle, address.streetNumber].filter(Boolean).join(' '),
    address.subdistrictTitle,
    address.cityTitle,
  ]
    .filter(Boolean)
    .join(', ');
  // normalizeAddress() owns the comparison key, so the dedupe stage compares
  // ss.ge addresses the same way it compares every other source's.
  listing.address = rawAddress ? normalizeAddress(rawAddress, address.cityTitle ?? null) : null;

  // The portal's own creation timestamp. Not the moment we happened to read
  // the page, which is recorded separately as retrievedAt.
  listing.publishedAt = item.createDate ?? null;
  listing.daysOnMarket = null;

  const origins: Record<string, 'API'> = {};
  for (const key of [
    'title',
    'description',
    'listingId',
    'propertyType',
    'area',
    'sale',
    'rent',
    'salePricePerSqm',
    'bedrooms',
    'floor',
    'totalFloors',
    'city',
    'district',
    'address',
    'publishedAt',
  ]) {
    origins[key] = 'API';
  }
  listing.fieldOrigins = origins;

  return listing;
}

function listingUrl(item: SsItem, language: string): string | null {
  const path = item.detailUrl;
  if (!path) return null;
  return `${ORIGIN}/${language}/real-estate/${path}`;
}

function searchUrl(
  query: ListingQuery,
  language: string,
  page: number,
  cityId: number | null,
  subDistrictId: number | null,
): string {
  const typePath = TYPE_PATH[query.propertyType] ?? null;
  const dealPath = query.transaction === 'RENT' ? 'For-Rent' : 'For-Sale';
  const segments = ['real-estate', 'l'];
  if (typePath) segments.push(typePath);
  segments.push(dealPath);

  const params = new URLSearchParams();
  if (cityId !== null) params.set('cityIdList', String(cityId));
  if (subDistrictId !== null) params.set('subdistrictIds', String(subDistrictId));
  if (query.area.min !== null) params.set('areaFrom', String(Math.floor(query.area.min)));
  if (query.area.max !== null) params.set('areaTo', String(Math.ceil(query.area.max)));
  params.set('page', String(page));

  return `${ORIGIN}/${language}/${segments.join('/')}?${params.toString()}`;
}

const GEORGIAN = /[Ⴀ-ჿ]/;

/**
 * Which locale to ask the portal in.
 *
 * THE LOCALE IS A MATCHING DECISION, NOT A PRESENTATION ONE. The portal ships
 * its district taxonomy in the locale it was asked for: `/en/` calls the
 * district "Vake", `/ka/` calls it "ვაკე". Homatch's own district vocabulary
 * is Georgian, so asking in English and then trying to match "ვაკე" against
 * "Vake" resolves nothing — the search silently widens to the whole city.
 *
 * So the SCRIPT of the place name decides the locale. A Georgian district name
 * asks in Georgian and matches; a Latin one asks in English and matches. The
 * records returned are identical either way; only the titles differ.
 */
function languageFor(query: ListingQuery): string {
  const place = `${query.subDistrict ?? ''} ${query.district ?? ''} ${query.city ?? ''}`;
  if (GEORGIAN.test(place)) return 'ka';
  if (query.languages.includes('ka') && !place.trim()) return 'ka';
  if (query.languages.includes('ru') && !GEORGIAN.test(place)) return 'en';
  return 'en';
}

export class SsGeAdapter implements ListingPortalAdapter {
  readonly id = 'ss-ge';
  readonly sourceFamily = 'ss.ge';
  readonly countries = ['GE'] as const;

  supports(query: ListingQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'GE') return false;
    // A city the portal does not itself list cannot be turned into a
    // server-side filter, and a country-wide sweep is not a comparable set.
    return cityIdFor(query.city) !== null;
  }

  handles(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === HOST || host === 'ss.ge' || host.endsWith('.ss.ge');
    } catch {
      return false;
    }
  }

  canonicalize(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!this.handles(url)) return null;
      // The trailing numeric id is the listing's identity; locale is not.
      const id = parsed.pathname.match(/-(\d+)\/?$/);
      if (!id) return `${ORIGIN}${parsed.pathname}`;
      return `${ORIGIN}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
      return null;
    }
  }

  async searchListings(
    query: ListingQuery,
    context: AdapterContext,
  ): Promise<AdapterOutcome<ListingSearchResult>> {
    const cityId = cityIdFor(query.city);
    if (cityId === null) {
      return {
        ok: false,
        reason: 'CAPABILITY_NOT_SUPPORTED',
        detail: `ss.ge has no city filter for ${query.city ?? '(no city)'}`,
      };
    }

    const language = languageFor(query);
    const basis: PriceBasis =
      query.transaction === 'RENT' ? 'ASKING_RENT' : 'ASKING_SALE_PRICE';
    const expectedType = EXPECTED_TYPE_CODE[query.propertyType] ?? null;
    const expectedDeal = query.transaction === 'RENT' ? DEAL_CODE_RENT : DEAL_CODE_SALE;

    const server: string[] = ['transaction', 'city'];
    if (TYPE_PATH[query.propertyType]) server.push('propertyType');
    if (query.area.min !== null || query.area.max !== null) server.push('area');

    const client: string[] = [];
    const unsupported: string[] = [];
    if (query.bedrooms.min !== null || query.bedrooms.max !== null) client.push('bedrooms');
    if (query.floor.min !== null || query.floor.max !== null) client.push('floor');
    if (query.price.min !== null || query.price.max !== null) client.push('price');
    if (query.rooms.min !== null || query.rooms.max !== null) unsupported.push('rooms');
    if (query.projectName) unsupported.push('projectName');

    const out: PortalListing[] = [];
    let total: number | null = null;
    let pages = 0;
    let requests = 0;
    let subDistrictId: number | null = null;
    let resolvedSubDistrict = false;
    let truncated = false;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = searchUrl(query, language, page, cityId, subDistrictId);
      let document;
      try {
        document = await context.fetchDocument(url);
      } catch (error) {
        // A failure on the first page is a failed search. A failure on a later
        // page is a truncated one: what was already read stays valid.
        if (page === 1) {
          return { ok: false, reason: 'NETWORK_ERROR', detail: String(error).slice(0, 200) };
        }
        truncated = true;
        break;
      }
      requests += 1;

      if (document.status === 403 || document.status === 401) {
        return { ok: false, reason: 'BLOCKED', detail: `HTTP ${document.status}` };
      }
      if (document.status === 429) {
        return { ok: false, reason: 'RATE_LIMITED', detail: 'HTTP 429' };
      }
      if (document.status >= 400) {
        if (page === 1) {
          return { ok: false, reason: 'NOT_FOUND', detail: `HTTP ${document.status}` };
        }
        truncated = true;
        break;
      }

      const props = parseNextData(document.body);
      if (!props) {
        if (page === 1) {
          return {
            ok: false,
            reason: 'PARSE_FAILED',
            detail: 'no __NEXT_DATA__ island in the response',
          };
        }
        truncated = true;
        break;
      }

      pages += 1;
      if (total === null && typeof props.initialTotalApplicationCount === 'number') {
        total = props.initialTotalApplicationCount;
      }

      /*
       * The sub-district id is resolved from the portal's OWN taxonomy, which
       * travels in every search response. Resolving it on page 1 and refining
       * from page 2 costs nothing extra and keeps this adapter free of a
       * district table that would drift away from the portal.
       */
      if (!resolvedSubDistrict) {
        resolvedSubDistrict = true;
        const wanted = query.subDistrict ?? query.district;
        const resolved = resolveSubDistrictId(props.locations, cityId, wanted);
        if (resolved !== null) {
          subDistrictId = resolved;
          server.push('district');
          // Restart from page 1 under the narrower envelope: the pages read
          // under the wider one are not this envelope's answer.
          out.length = 0;
          pages = 0;
          total = null;
          page = 0;
          continue;
        }
        /*
         * The district could not be resolved against the portal's taxonomy.
         *
         * It is reported UNSUPPORTED rather than filtered here. Client-side
         * filtering on an unresolvable name is worse than not filtering: the
         * comparison would reject every row and the lane would report an
         * empty market for a district full of listings. Saying "we could not
         * constrain by district" is the true statement, and the evidence
         * level of each candidate reflects it.
         */
        if (wanted) unsupported.push('district');
      }

      const items = props.applicationList?.realStateItemModel ?? [];
      if (!items.length) break;

      for (const item of items) {
        if (out.length >= query.limit) {
          truncated = true;
          break;
        }
        // Belt and braces: the path already constrains these, and a record
        // that disagrees with the path is not something to normalize anyway.
        if (expectedDeal !== null && item.dealType != null && item.dealType !== expectedDeal) continue;
        if (expectedType !== null && item.type != null && item.type !== expectedType) continue;

        const url2 = listingUrl(item, language);
        if (!url2) continue;

        const listing = toNormalizedListing(item, basis);

        // Client-side constraints the portal cannot express. Applied here and
        // declared in appliedFilters.client, never passed off as server-side.
        if (
          (query.bedrooms.min !== null || query.bedrooms.max !== null) &&
          !withinRange(query.bedrooms, listing.bedrooms)
        ) {
          continue;
        }
        if (
          (query.floor.min !== null || query.floor.max !== null) &&
          !withinRange(query.floor, listing.floor)
        ) {
          continue;
        }
        if (query.price.min !== null || query.price.max !== null) {
          const amount = listing.sale?.amount ?? listing.rent?.amount ?? null;
          if (!withinRange(query.price, amount)) continue;
        }
        out.push({
          portalId: this.id,
          sourceFamily: this.sourceFamily,
          externalId: listing.listingId,
          url: url2,
          listing,
          priceBasis: basis,
          retrievedAt: document.retrievedAt,
          via: document.via,
          queryId: query.id,
          matchRationale: matchRationale(query, listing, subDistrictId !== null),
        });
      }

      if (out.length >= query.limit) {
        truncated = true;
        break;
      }
      if (items.length < PAGE_SIZE) break;
      if (total !== null && pages * PAGE_SIZE >= total) break;
    }

    return {
      ok: true,
      value: {
        listings: out,
        totalAvailable: total,
        truncated,
        appliedFilters: { server, client, unsupported } as AppliedFilters,
        pagesFetched: pages,
        networkRequests: requests,
      },
    };
  }
}

function matchesDistrict(actual: string | null, wanted: string | null): boolean {
  if (!wanted) return true;
  if (!actual) return false;
  const a = slug(actual);
  const w = slug(wanted);
  if (!a || !w) return false;
  return a === w || (w.length >= 4 && a.includes(w)) || (a.length >= 4 && w.includes(a));
}

/** One line a reader can check: why this listing was treated as comparable. */
function matchRationale(
  query: ListingQuery,
  listing: NormalizedListing,
  districtServerSide: boolean,
): string {
  const parts: string[] = [];
  if (listing.district) {
    parts.push(districtServerSide ? `same district (${listing.district})` : `district ${listing.district}`);
  } else if (listing.city) {
    parts.push(`same city (${listing.city})`);
  }
  if (listing.area && (query.area.min !== null || query.area.max !== null)) {
    const lo = query.area.min === null ? '' : Math.floor(query.area.min);
    const hi = query.area.max === null ? '' : Math.ceil(query.area.max);
    parts.push(`area ${listing.area.value}m² within ${lo}-${hi}m²`);
  }
  if (listing.bedrooms !== null && (query.bedrooms.min !== null || query.bedrooms.max !== null)) {
    parts.push(`${listing.bedrooms} bedroom(s)`);
  }
  parts.push(query.transaction === 'RENT' ? 'asking rent' : 'asking sale price');
  return parts.join('; ');
}

export function cityIdFor(city: string | null | undefined): number | null {
  const key = slug(city);
  if (!key) return null;
  if (CITY_IDS[key] !== undefined) return CITY_IDS[key];
  // Georgian spellings of the two cities that carry most of the market.
  if (key.includes('თბილის')) return CITY_IDS.tbilisi;
  if (key.includes('ბათუმ')) return CITY_IDS.batumi;
  for (const [name, id] of Object.entries(CITY_IDS)) {
    if (key.includes(name)) return id;
  }
  return null;
}

export const SS_GE_HOST = HOST;
