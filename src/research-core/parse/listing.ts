// HOMATCH RESEARCH CORE — the normalized shape of one listing-like page.
//
// This is a PARSE OUTPUT, not evidence and not a fact. It is what a single
// fetched page turned out to say, with per-field provenance attached so a
// JSON-LD price is never overwritten by a regex hit on the page text.
// bridge/evidence.ts is what turns it into a real EvidenceItem.
//
// THE ONE THING THIS FILE EXISTS TO ENFORCE
//
// There is no field called `price`. There is `sale` and there is `rent`, each
// carrying a `basis`, and there is no constructor for a money value without
// one. An asking rent cannot be assigned to a field that means achieved rent,
// because they are different fields; a developer's price list cannot quietly
// become a transaction price, because `basis` is required and the parser must
// say which it saw.
//
// That is a type-level guarantee rather than a comment, and it is deliberate:
// a comment saying "never convert asking rent into achieved rent" has to be
// read to work. A missing field has to be dealt with.

import type { Area } from '../normalize/area.ts';
import type { GeoPoint } from '../normalize/geo.ts';
import type { NormalizedAddress } from '../normalize/address.ts';
import {
  ORIGIN_QUALITY,
  priceBasisSide,
  type FieldOrigin,
  type Money,
  type PriceBasis,
} from '../core/types.ts';

export type { FieldOrigin, Money, PriceBasis };
export { ORIGIN_QUALITY };

export interface NormalizedListing {
  title: string | null;
  description: string | null;
  listingId: string | null;
  propertyType: string | null;

  /** Listing availability in the portal's vocabulary (AVAILABLE / SOLD). */
  status: string | null;
  /**
   * Registration status in a registry's vocabulary (REGISTERED / PENDING).
   * Kept separate from `status` on purpose: "AVAILABLE" and "REGISTERED" are
   * answers to different questions, and comparing them produced a permanent
   * false conflict between a portal and a registry.
   */
  registrationStatus: string | null;

  /**
   * A sale-side money value, if the page carried one. `basis` says which kind.
   * A page that shows a price without saying what kind of price it is yields
   * basis UNKNOWN, which downstream arithmetic must handle explicitly.
   */
  sale: Money | null;
  /** A rent-side money value, if the page carried one. Never pooled with sale. */
  rent: Money | null;
  /** Rent period, where stated. Null means the page did not say. */
  rentPeriod: 'MONTH' | 'DAY' | 'YEAR' | null;

  area: Area | null;
  /**
   * Derived, and only ever from the sale value — never from rent, and never
   * across bases. Null when either input is missing.
   */
  salePricePerSqm: number | null;

  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  isStudio: boolean;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;

  address: NormalizedAddress | null;
  city: string | null;
  district: string | null;
  country: string | null;
  geo: GeoPoint | null;

  developerName: string | null;
  projectName: string | null;
  agencyName: string | null;

  cadastralCode: string | null;
  encumbrances: string[];

  /**
   * When the listing says it was published. NOT days-on-market: a first-seen
   * date is not a listing date, and subtracting today from a scrape timestamp
   * produces a number that looks like market evidence and is not. Days on
   * market is left absent unless a source states it.
   */
  publishedAt: string | null;
  /** Days on market, ONLY when a source states it. Never computed here. */
  daysOnMarket: number | null;

  /** Per-field provenance, keyed by field path. */
  fieldOrigins: Record<string, FieldOrigin>;
}

export function emptyListing(): NormalizedListing {
  return {
    title: null,
    description: null,
    listingId: null,
    propertyType: null,
    status: null,
    registrationStatus: null,
    sale: null,
    rent: null,
    rentPeriod: null,
    area: null,
    salePricePerSqm: null,
    rooms: null,
    bedrooms: null,
    bathrooms: null,
    isStudio: false,
    floor: null,
    totalFloors: null,
    yearBuilt: null,
    address: null,
    city: null,
    district: null,
    country: null,
    geo: null,
    developerName: null,
    projectName: null,
    agencyName: null,
    cadastralCode: null,
    encumbrances: [],
    publishedAt: null,
    daysOnMarket: null,
    fieldOrigins: {},
  };
}

/**
 * Build a money value. The only way to make one, and it refuses the
 * combination that causes the damage.
 */
export function money(
  amount: number | null | undefined,
  currency: string | null | undefined,
  basis: PriceBasis,
): Money | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  if (!currency) return null;
  return { amount, currency: currency.toUpperCase(), basis };
}

/** Assign a money value to whichever side its basis belongs to. */
export function assignMoney(listing: NormalizedListing, value: Money, origin: FieldOrigin): void {
  const side = priceBasisSide(value.basis);
  if (side === 'RENT') {
    if (!listing.rent) {
      listing.rent = value;
      listing.fieldOrigins['rent'] = origin;
    }
    return;
  }
  // UNKNOWN basis lands on the sale side because that is where an unlabelled
  // headline figure on a property page almost always sits — but it keeps
  // basis UNKNOWN, so nothing downstream may pool it with a real sale price.
  if (!listing.sale) {
    listing.sale = value;
    listing.fieldOrigins['sale'] = origin;
  }
}

/**
 * Merge `next` into `base`, keeping whichever value has the higher-quality
 * origin. A JSON-LD price is never overwritten by a regex hit on page text.
 */
export function mergeListing(
  base: NormalizedListing,
  next: Partial<NormalizedListing>,
): NormalizedListing {
  const merged: NormalizedListing = { ...base, fieldOrigins: { ...base.fieldOrigins } };
  const nextOrigins = next.fieldOrigins ?? {};

  for (const [key, value] of Object.entries(next) as Array<[keyof NormalizedListing, unknown]>) {
    if (key === 'fieldOrigins') continue;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (key === 'isStudio' && value === false) continue;

    const incomingOrigin = nextOrigins[key as string];
    const existingOrigin = merged.fieldOrigins[key as string];
    const existingValue = merged[key];

    if (Array.isArray(value) && Array.isArray(existingValue)) {
      const union = [...new Set([...(existingValue as string[]), ...(value as string[])])];
      (merged as unknown as Record<string, unknown>)[key] = union;
      if (incomingOrigin && !existingOrigin) merged.fieldOrigins[key as string] = incomingOrigin;
      continue;
    }

    // A money value may only be replaced by one of the SAME basis. A better
    // origin does not license swapping an asking price for a transaction
    // price: those are different claims, and the second belongs in its own
    // observation rather than overwriting the first.
    if ((key === 'sale' || key === 'rent') && existingValue) {
      const incoming = value as Money;
      const existing = existingValue as Money;
      if (incoming.basis !== existing.basis) continue;
    }

    const existingPresent =
      existingValue !== null && existingValue !== undefined && existingValue !== false;
    if (existingPresent && existingOrigin && incomingOrigin) {
      if (ORIGIN_QUALITY[incomingOrigin] <= ORIGIN_QUALITY[existingOrigin]) continue;
    } else if (existingPresent && !incomingOrigin) {
      continue;
    }

    (merged as unknown as Record<string, unknown>)[key] = value;
    if (incomingOrigin) merged.fieldOrigins[key as string] = incomingOrigin;
  }

  return merged;
}

/**
 * Fill `salePricePerSqm` when, and only when, both inputs exist and the area
 * is in square metres. Never derived from rent, and never across bases.
 */
export function deriveSalePricePerSqm(listing: NormalizedListing): NormalizedListing {
  if (listing.salePricePerSqm !== null) return listing;
  const { sale, area } = listing;
  if (!sale || !area || area.unit !== 'sqm' || area.value <= 0) return listing;
  return { ...listing, salePricePerSqm: sale.amount / area.value };
}

/** Average origin quality across the fields actually resolved. */
export function structuredQuality(listing: NormalizedListing): number {
  const origins = Object.values(listing.fieldOrigins);
  if (origins.length === 0) return 0;
  const total = origins.reduce((acc, origin) => acc + ORIGIN_QUALITY[origin], 0);
  return total / origins.length;
}
