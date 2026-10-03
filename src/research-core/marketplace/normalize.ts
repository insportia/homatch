// HOMATCH MARKETPLACE SEARCH — normalisation and current-listing validation.
//
// Every worker's candidate passes through here. Two copies always exist: the
// RAW candidate as the worker reported it (stored untouched, the source's own
// truth) and the NORMALISED listing HOMATCH reasons over. Nothing here fills a
// gap: a listing that did not state its floor has no floor.
//
// CURRENT means observed live. A listing is "verified" only when a worker
// actually retrieved it in this search; an old indexed URL is not current
// because it exists in history.

import type { CurrencyConverter } from '../normalize/currency.ts';
import { comparePlaces, resolvePlace } from '../normalize/place.ts';
import { safeWebUrl } from '../discovery/source-link.ts';
import { listingContextFrom, resolveAgeCeiling } from '../discovery/listing-age-policy.ts';
import { publicContactsIn, phoneKey } from '../discovery/public-contacts.ts';
import type { ExternalListingCandidate, MarketplaceSearchRequest } from './worker-contract.ts';
import {
  type BuildingStatus, type MarketplacePropertyType, type MarketplaceTransaction, type RenovationStatus,
  propertyClassOf,
} from './taxonomy.ts';

export const NORMALIZER_VERSION = 'marketplace-normalize-1';

/** A worker observation older than this is not "verified now"; it is a recent sighting. */
export const VERIFIED_WINDOW_MS = 6 * 60 * 60 * 1000;

export type FreshnessState = 'VERIFIED' | 'RECENT' | 'STALE';

export interface NormalizedListing {
  /** `${source}:${sourceListingId}` — stable within a search. */
  id: string;
  source: string;
  sourceName: string | null;
  sourceListingId: string;
  exactUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  transactionType: MarketplaceTransaction | null;
  propertyType: MarketplacePropertyType | null;
  country: string | null;
  city: string | null;
  cityKey: string | null;
  district: string | null;
  districtKey: string | null;
  address: string | null;
  geo: { lat: number; lng: number } | null;
  priceOriginal: { amount: number; currency: string } | null;
  priceUsd: number | null;
  priceUsdBasis: 'STATED_USD' | 'CONVERTED' | null;
  fxRate: number | null;
  pricePerSqmUsd: number | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  buildingStatus: BuildingStatus | null;
  renovationStatus: RenovationStatus | null;
  constructionYear: number | null;
  furnished: boolean | null;
  parking: boolean | null;
  amenities: string[];
  images: string[];
  imageHashes: string[];
  publishedAt: string | null;
  updatedAt: string | null;
  observedAt: string;
  lastVerifiedAt: string | null;
  freshness: FreshnessState;
  /** Listing age beyond the market's ceiling for this deal kind (listing-age-policy.ts). */
  oldListing: boolean;
  seller: ExternalListingCandidate['seller'] & { phoneKey: string | null };
  provenance: ExternalListingCandidate['provenance'];
  completeness: number;
}

export type ValidationOutcome =
  | { valid: true; listing: NormalizedListing; warnings: string[] }
  | { valid: false; listing: NormalizedListing | null; reason: string };

const NORM_AMENITY: Record<string, string> = {
  parking: 'PARKING', garage: 'PARKING', balcony: 'BALCONY', terrace: 'TERRACE', elevator: 'ELEVATOR', lift: 'ELEVATOR',
  garden: 'GARDEN', yard: 'GARDEN', pool: 'POOL', furnished: 'FURNISHED', heating: 'CENTRAL_HEATING',
  central_heating: 'CENTRAL_HEATING', view: 'VIEW', pets: 'PET_FRIENDLY', storage: 'STORAGE', air_conditioning: 'AIR_CONDITIONING',
};

function amenityCodes(list: readonly string[]): string[] {
  const out = new Set<string>();
  for (const a of list) {
    const k = a.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const code = NORM_AMENITY[k] ?? (/^[A-Z_]+$/.test(a) ? a : null);
    if (code) out.add(code);
  }
  return [...out];
}

const roundTo = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Candidate → normalised listing. Pure; `now` is injectable for deterministic tests. */
export function normalizeCandidate(
  c: ExternalListingCandidate,
  options: { converter?: CurrencyConverter | null; now?: Date } = {},
): NormalizedListing {
  const now = options.now ?? new Date();
  let priceUsd: number | null = null;
  let basis: NormalizedListing['priceUsdBasis'] = null;
  let fxRate: number | null = null;
  if (c.price !== null && c.price > 0 && c.currency) {
    if (c.currency === 'USD') { priceUsd = c.price; basis = 'STATED_USD'; }
    else if (options.converter) {
      const conv = options.converter.convert(c.price, c.currency, 'USD');
      if (conv) { priceUsd = roundTo(conv.amount, 0); basis = 'CONVERTED'; fxRate = conv.rate; }
    }
  }
  const cityPlace = resolvePlace(c.city);
  const districtPlace = resolvePlace(c.district);
  const observedMs = Date.parse(c.observedAt);
  const age = Number.isFinite(observedMs) ? now.getTime() - observedMs : Infinity;
  const freshness: FreshnessState = age <= VERIFIED_WINDOW_MS ? 'VERIFIED' : age <= 72 * 3600_000 ? 'RECENT' : 'STALE';
  const ctx = listingContextFrom({ transaction: c.transactionType, propertyType: c.propertyType });
  const ceiling = resolveAgeCeiling(ctx, { market: c.country });
  const listedAt = Date.parse(c.updatedAt ?? c.publishedAt ?? '');
  const oldListing = Number.isFinite(listedAt) && now.getTime() - listedAt > ceiling.days * 86_400_000;
  const phoneFromField = c.seller.publicPhone ? phoneKey(c.seller.publicPhone) : null;
  const phoneFromText = publicContactsIn(c.description).find((x) => x.kind === 'PHONE')?.key ?? null;
  const fields = [c.price, c.areaSqm, c.rooms, c.bedrooms, c.floor, c.district, c.city, c.buildingStatus, c.renovationStatus, c.images[0]];
  return {
    id: `${c.source}:${c.sourceListingId}`,
    source: c.source,
    sourceName: c.sourceName,
    sourceListingId: c.sourceListingId,
    exactUrl: c.exactUrl,
    canonicalUrl: c.canonicalUrl,
    title: c.title,
    description: c.description,
    transactionType: c.transactionType,
    propertyType: c.propertyType,
    country: c.country,
    city: c.city,
    cityKey: cityPlace?.kind === 'CITY' ? cityPlace.key : districtPlace?.cityKey ?? null,
    district: c.district,
    districtKey: districtPlace?.kind === 'DISTRICT' ? districtPlace.key : null,
    address: c.address,
    geo: c.latitude !== null && c.longitude !== null ? { lat: c.latitude, lng: c.longitude } : null,
    priceOriginal: c.price !== null && c.currency ? { amount: c.price, currency: c.currency } : null,
    priceUsd,
    priceUsdBasis: basis,
    fxRate,
    pricePerSqmUsd: priceUsd !== null && c.areaSqm ? roundTo(priceUsd / c.areaSqm, 0) : null,
    areaSqm: c.areaSqm,
    rooms: c.rooms,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    floor: c.floor,
    totalFloors: c.totalFloors,
    buildingStatus: c.buildingStatus,
    renovationStatus: c.renovationStatus,
    constructionYear: c.constructionYear,
    furnished: c.furnished,
    parking: c.parking ?? (amenityCodes(c.amenities).includes('PARKING') ? true : null),
    amenities: amenityCodes(c.amenities),
    images: c.images.map(safeWebUrl).filter((u): u is string => !!u),
    imageHashes: c.imageHashes,
    publishedAt: c.publishedAt,
    updatedAt: c.updatedAt,
    observedAt: c.observedAt,
    lastVerifiedAt: freshness === 'VERIFIED' ? c.observedAt : null,
    freshness,
    oldListing,
    seller: { ...c.seller, phoneKey: phoneFromField ?? phoneFromText },
    provenance: c.provenance,
    completeness: fields.filter((v) => v !== null && v !== undefined).length / fields.length,
  };
}

/**
 * Is this listing a current answer to the request at all? Rejections are
 * structural (wrong deal, wrong type, wrong city, no usable price); everything
 * else (budget, area, rooms) is the hard-filter's job in the pipeline, so it
 * can be counted and explained.
 */
export function validateListing(
  c: ExternalListingCandidate,
  request: Pick<MarketplaceSearchRequest, 'transactionType' | 'propertyType' | 'city'>,
  options: { converter?: CurrencyConverter | null; now?: Date } = {},
): ValidationOutcome {
  const listing = normalizeCandidate(c, options);
  const warnings: string[] = [];
  if (listing.transactionType && listing.transactionType !== request.transactionType) {
    return { valid: false, listing, reason: 'TRANSACTION_MISMATCH' };
  }
  if (listing.propertyType && propertyClassOf(listing.propertyType) !== propertyClassOf(request.propertyType)) {
    return { valid: false, listing, reason: 'PROPERTY_TYPE_MISMATCH' };
  }
  if (listing.city && comparePlaces(listing.city, request.city) === 'CONFLICT') {
    return { valid: false, listing, reason: 'CITY_MISMATCH' };
  }
  if (listing.priceOriginal === null) return { valid: false, listing, reason: 'NO_PRICE' };
  if (listing.priceUsd === null) return { valid: false, listing, reason: 'PRICE_NOT_CONVERTIBLE' };
  if (listing.freshness === 'STALE') warnings.push('STALE_OBSERVATION');
  if (listing.oldListing) warnings.push('OLD_LISTING');
  if (!listing.transactionType) warnings.push('TRANSACTION_NOT_STATED');
  if (!listing.propertyType) warnings.push('PROPERTY_TYPE_NOT_STATED');
  return { valid: true, listing, warnings };
}
