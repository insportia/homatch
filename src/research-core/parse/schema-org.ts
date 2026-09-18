// HOMATCH RESEARCH CORE — schema.org JSON-LD onto a normalized listing.
//
// Every field written here is tagged JSON_LD so the merge in ./listing.ts
// prefers it over anything scraped from page text.
//
// WHAT KIND OF PRICE IS THIS?
//
// schema.org cannot tell us. An `Offer.price` on a property page is what
// somebody is ASKING; whether that asking price is a portal listing or a
// developer's own price list depends on WHOSE page it is, which is a fact
// about the source and not about the markup. So the basis is supplied by the
// caller from the source policy, and there is no default that guesses: a
// caller that does not know passes UNKNOWN and the arithmetic downstream has
// to cope, which is the honest outcome.
//
// A transaction price is never produced here. No portal publishes one in
// JSON-LD, and inferring one from a listing that disappeared would be
// invention.

import { parseArea, normalizeAreaUnit } from '../normalize/area.ts';
import { normalizeAddress } from '../normalize/address.ts';
import { normalizeGeoPoint } from '../normalize/geo.ts';
import { normalizeTimestamp } from '../normalize/dates.ts';
import { parseNumber } from '../normalize/numbers.ts';
import { detectCurrency } from '../normalize/currency.ts';
import { assignMoney, money, type NormalizedListing } from './listing.ts';
import type { FieldOrigin, PriceBasis } from '../core/types.ts';
import {
  hasType,
  readNumberLike,
  readProperty,
  readString,
  typesOf,
  type JsonLdNode,
} from './json-ld.ts';

export const SCHEMA_ORG_PARSER_VERSION = 'schemaorg-2.0.0';

export interface SchemaOrgOptions {
  /**
   * What a sale-side price on THIS source means. Comes from the source policy
   * — a developer's own site yields DEVELOPER_PRICE, a portal yields
   * ASKING_SALE_PRICE. UNKNOWN when the caller genuinely does not know.
   */
  saleBasis: PriceBasis;
  /** What a rent-side price on this source means. Almost always ASKING_RENT. */
  rentBasis: PriceBasis;
}

const PROPERTY_TYPES = [
  'apartment', 'house', 'singlefamilyresidence', 'residence', 'accommodation',
  'realestatelisting', 'product', 'offer', 'place', 'suite', 'room',
];

const ORGANIZATION_TYPES = ['organization', 'realestateagent', 'localbusiness', 'corporation'];

/** Signals that an offer is a tenancy rather than a sale. */
const RENT_HINT = /lease|rent|rental|tenanc|\bper\s*(month|night|day)\b|monthly/i;

export function listingFromJsonLd(
  nodes: readonly JsonLdNode[],
  options: SchemaOrgOptions,
): Partial<NormalizedListing> {
  const out: Partial<NormalizedListing> = {};
  const origins: Record<string, FieldOrigin> = {};
  const set = <K extends keyof NormalizedListing>(
    key: K,
    value: NormalizedListing[K] | null,
    origin: FieldOrigin = 'JSON_LD',
  ) => {
    if (value === null || value === undefined) return;
    if (out[key] !== undefined && out[key] !== null) return;
    out[key] = value;
    origins[key as string] = origin;
  };

  const primary = nodes.find((node) => hasType(node, ...PROPERTY_TYPES));
  const organization = nodes.find((node) => hasType(node, ...ORGANIZATION_TYPES));
  const offer = nodes.find((node) => hasType(node, 'offer', 'aggregateoffer'));
  const place = nodes.find((node) => hasType(node, 'place', 'residence', 'apartment', 'house'));

  if (primary) {
    set('title', readString(primary, 'name'));
    set('description', readString(primary, 'description'));
    set(
      'listingId',
      readString(primary, 'identifier') ?? readString(primary, 'sku') ?? readString(primary, '@id'),
    );
    set('propertyType', typesOf(primary)[0] ?? null);
    set('yearBuilt', toInt(readNumberLike(primary, 'yearBuilt')));
    set(
      'publishedAt',
      normalizeTimestamp(readString(primary, 'datePosted') ?? readString(primary, 'datePublished')),
    );
  }

  // ---- money -------------------------------------------------------------
  const priceNode = offer ?? primary;
  if (priceNode) {
    const rawPrice =
      readNumberLike(priceNode, 'price') ??
      readNumberLike(priceNode, 'offers.price') ??
      readNumberLike(priceNode, 'lowPrice') ??
      readNumberLike(priceNode, 'offers.lowPrice');
    const currency =
      readString(priceNode, 'priceCurrency') ??
      readString(priceNode, 'offers.priceCurrency') ??
      (typeof rawPrice === 'string' ? detectCurrency(rawPrice)?.code ?? null : null);
    const amount = parseNumber(rawPrice ?? null);

    const rentSignal = [
      readString(priceNode, 'businessFunction'),
      readString(priceNode, 'priceSpecification.unitText'),
      readString(priceNode, 'priceSpecification.billingDuration'),
      readString(priceNode, 'unitText'),
      typesOf(priceNode).join(' '),
      readString(primary ?? priceNode, 'name'),
    ]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => RENT_HINT.test(value));

    const basis: PriceBasis = rentSignal ? options.rentBasis : options.saleBasis;
    const value = money(amount, currency, basis);
    if (value) {
      // assignMoney routes by basis, so a rent basis can never land in the
      // sale field however the markup was shaped.
      const target: NormalizedListing = {
        sale: null, rent: null, fieldOrigins: {},
      } as NormalizedListing;
      assignMoney(target, value, 'JSON_LD');
      if (target.sale) set('sale', target.sale);
      if (target.rent) set('rent', target.rent);
      if (rentSignal) set('rentPeriod', readRentPeriod(priceNode));
    }

    set('status', normalizeAvailability(readString(priceNode, 'availability')));
  }

  // ---- area --------------------------------------------------------------
  const areaNode = (primary ?? place) as JsonLdNode | undefined;
  if (areaNode) {
    const areaValue =
      readNumberLike(areaNode, 'floorSize.value') ??
      readNumberLike(areaNode, 'floorSize') ??
      readNumberLike(areaNode, 'area.value') ??
      readNumberLike(areaNode, 'size.value');
    const unitRaw =
      readString(areaNode, 'floorSize.unitCode') ??
      readString(areaNode, 'floorSize.unitText') ??
      readString(areaNode, 'area.unitText') ??
      'MTK';
    const value = parseNumber(areaValue ?? null, { ambiguousTripleGroup: 'decimal' });
    const unit = normalizeUnitCode(unitRaw);
    if (value !== null && value > 0 && unit) {
      set('area', { value, unit });
    } else if (typeof areaValue === 'string') {
      const parsed = parseArea(areaValue);
      if (parsed) set('area', parsed);
    }

    set('rooms', toInt(readNumberLike(areaNode, 'numberOfRooms')));
    set('bedrooms', toInt(readNumberLike(areaNode, 'numberOfBedrooms')));
    set(
      'bathrooms',
      toInt(
        readNumberLike(areaNode, 'numberOfBathroomsTotal') ??
          readNumberLike(areaNode, 'numberOfBathrooms'),
      ),
    );
    set('floor', toInt(readNumberLike(areaNode, 'floorLevel')));
  }

  // ---- address & geo -----------------------------------------------------
  const addressHost = primary ?? place;
  if (addressHost) {
    const street = readString(addressHost, 'address.streetAddress');
    const city = readString(addressHost, 'address.addressLocality');
    const district = readString(addressHost, 'address.addressRegion');
    const country = readString(addressHost, 'address.addressCountry');
    const addressText =
      typeof readProperty(addressHost, 'address') === 'string'
        ? readString(addressHost, 'address')
        : street;

    if (addressText) set('address', normalizeAddress(addressText, city));
    set('city', city);
    set('district', district);
    set('country', country);

    set(
      'geo',
      normalizeGeoPoint(
        readProperty(addressHost, 'geo.latitude') ?? readProperty(addressHost, 'latitude'),
        readProperty(addressHost, 'geo.longitude') ?? readProperty(addressHost, 'longitude'),
      ),
    );
  }

  // ---- organisations -----------------------------------------------------
  if (organization) {
    const name = readString(organization, 'name');
    const types = typesOf(organization);
    if (name) {
      if (types.includes('realestateagent')) set('agencyName', name);
      else set('developerName', name);
    }
  }
  if (primary) {
    set('developerName', readString(primary, 'provider.name') ?? readString(primary, 'brand.name'));
    set(
      'projectName',
      readString(primary, 'isPartOf.name') ?? readString(primary, 'containedInPlace.name'),
    );
    set('agencyName', readString(primary, 'seller.name') ?? readString(primary, 'offeredBy.name'));
  }

  out.fieldOrigins = origins;
  return out;
}

function readRentPeriod(node: JsonLdNode): 'MONTH' | 'DAY' | 'YEAR' | null {
  const raw = (
    readString(node, 'priceSpecification.unitText') ??
    readString(node, 'priceSpecification.billingDuration') ??
    readString(node, 'unitText') ??
    ''
  ).toLowerCase();
  if (/month|mo\b|monthly/.test(raw)) return 'MONTH';
  if (/night|day|daily/.test(raw)) return 'DAY';
  if (/year|annual|p\.?a\.?/.test(raw)) return 'YEAR';
  return null;
}

/** UN/CEFACT unit codes used by schema.org for areas. */
function normalizeUnitCode(raw: string | null): 'sqm' | 'sqft' | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code === 'MTK' || code === 'M2' || code === 'SQM') return 'sqm';
  if (code === 'FTK' || code === 'SQFT' || code === 'FT2') return 'sqft';
  const normalized = normalizeAreaUnit(raw);
  return normalized === 'sqm' || normalized === 'sqft' ? normalized : null;
}

function normalizeAvailability(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value.includes('instock')) return 'AVAILABLE';
  if (value.includes('soldout') || value.includes('sold')) return 'SOLD';
  if (value.includes('outofstock')) return 'UNAVAILABLE';
  if (value.includes('preorder')) return 'PRE_SALE';
  return raw;
}

function toInt(value: string | number | null): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  const int = Math.round(parsed);
  return Number.isFinite(int) ? int : null;
}

/** Light microdata pass: `itemprop` attributes with inline values. */
export function listingFromItemProps(
  itemProps: ReadonlyArray<{ name: string; value: string }>,
  options: SchemaOrgOptions,
): Partial<NormalizedListing> {
  const out: Partial<NormalizedListing> = {};
  const origins: Record<string, FieldOrigin> = {};
  const byName = new Map(itemProps.map((p) => [p.name, p.value]));

  const amount = parseNumber(byName.get('price') ?? null);
  const currency = byName.get('pricecurrency');
  const value = money(amount, currency ?? null, options.saleBasis);
  if (value) {
    out.sale = value;
    origins['sale'] = 'MICRODATA';
  }

  const floorSize = byName.get('floorsize');
  if (floorSize) {
    const area = parseArea(floorSize);
    if (area) {
      out.area = area;
      origins['area'] = 'MICRODATA';
    }
  }

  const published = normalizeTimestamp(byName.get('datepublished') ?? null);
  if (published) {
    out.publishedAt = published;
    origins['publishedAt'] = 'MICRODATA';
  }

  out.fieldOrigins = origins;
  return out;
}
