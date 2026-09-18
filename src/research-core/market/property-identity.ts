// HOMATCH RESEARCH CORE — is this the same apartment, or another one?
//
// THE PROBLEM, CONCRETELY
//
// One flat is advertised by its owner on ss.ge, by two agencies on myhome.ge,
// on the agency's own site, and in a Facebook group. Counted naively that is
// five comparables and five "independent sources", and both numbers are wrong
// in the direction that flatters the report. The median moves toward whichever
// property happens to be advertised the most, and a buyer is told five sources
// agree when one property was seen five times.
//
// WHAT THIS DOES AND DELIBERATELY DOES NOT DO
//
// It compares structured attributes that a portal actually published, and it
// returns one of three verdicts: SAME, DIFFERENT, or UNCERTAIN. The third is
// the important one. Two 97m² two-bedroom flats on the fifth floor of the same
// district are PROBABLY one property advertised twice — and might be two
// genuinely similar flats in the same building. Forcing that to a yes or a no
// destroys information either way, so it stays UNCERTAIN and is reported as
// such.
//
// THE PRICE IS NOT PART OF IDENTITY
//
// Two adverts for the same flat at different prices are the single most
// valuable thing this whole lane can find — a stale listing, a negotiation, or
// an agency margin. If price disagreement made them "different properties",
// the conflict would erase itself. So price is compared AFTER identity, never
// as part of it.

import type { NormalizedListing } from '../parse/listing.ts';

export type IdentityVerdict = 'SAME' | 'UNCERTAIN' | 'DIFFERENT';

export interface IdentityDecision {
  verdict: IdentityVerdict;
  /** Which attributes actually agreed. Shown to the operator, not inferred. */
  matched: string[];
  /** Which attributes disagreed outright. */
  conflicting: string[];
  reason: string;
}

/** Areas within half a square metre are the same area written differently. */
const AREA_EXACT_TOLERANCE_SQM = 0.5;
/** Rounding across portals: 97.2 becomes 97 on one and 98 on another. */
const AREA_NEAR_TOLERANCE_SQM = 2;

const norm = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function bothPresent<T>(a: T | null, b: T | null): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined;
}

/**
 * Compare two listings as candidate descriptions of one property.
 *
 * Nothing here treats an absent field as agreement. Two listings that say
 * nothing about their floor do not "match on floor"; they simply carry no
 * evidence either way, which is why the verdict ladder counts POSITIVE
 * matches rather than absence of contradiction.
 */
export function compareListings(
  a: NormalizedListing,
  b: NormalizedListing,
): IdentityDecision {
  const matched: string[] = [];
  const conflicting: string[] = [];

  // A cadastral code is an identity, not an attribute. When both carry one,
  // it decides the question on its own in both directions.
  if (bothPresent(a.cadastralCode, b.cadastralCode)) {
    if (norm(a.cadastralCode) === norm(b.cadastralCode)) {
      return {
        verdict: 'SAME',
        matched: ['cadastralCode'],
        conflicting: [],
        reason: 'both listings state the same cadastral code',
      };
    }
    return {
      verdict: 'DIFFERENT',
      matched: [],
      conflicting: ['cadastralCode'],
      reason: 'the listings state different cadastral codes',
    };
  }

  // Area: the strongest ordinary attribute, because portals publish it as a
  // number and it barely varies between adverts for one flat.
  let areaAgrees = false;
  if (bothPresent(a.area, b.area)) {
    const delta = Math.abs((a.area as { value: number }).value - (b.area as { value: number }).value);
    if (delta <= AREA_EXACT_TOLERANCE_SQM) {
      matched.push('area');
      areaAgrees = true;
    } else if (delta <= AREA_NEAR_TOLERANCE_SQM) {
      matched.push('area(rounded)');
      areaAgrees = true;
    } else {
      conflicting.push('area');
    }
  }

  if (bothPresent(a.bedrooms, b.bedrooms)) {
    if (a.bedrooms === b.bedrooms) matched.push('bedrooms');
    else conflicting.push('bedrooms');
  }
  if (bothPresent(a.rooms, b.rooms)) {
    if (a.rooms === b.rooms) matched.push('rooms');
    else conflicting.push('rooms');
  }
  if (bothPresent(a.floor, b.floor)) {
    if (a.floor === b.floor) matched.push('floor');
    else conflicting.push('floor');
  }
  if (bothPresent(a.totalFloors, b.totalFloors)) {
    if (a.totalFloors === b.totalFloors) matched.push('totalFloors');
    else conflicting.push('totalFloors');
  }

  // Address: only counts when both sides carry a real street-level address.
  // A shared district is a neighbourhood, not an identity.
  const addrA = a.address?.key ?? null;
  const addrB = b.address?.key ?? null;
  const streetA = a.address?.street ?? null;
  const streetB = b.address?.street ?? null;
  if (bothPresent(addrA, addrB) && streetA && streetB) {
    if (addrA === addrB) matched.push('address');
    else if (norm(streetA) === norm(streetB)) matched.push('street');
    else conflicting.push('address');
  }

  if (bothPresent(a.projectName, b.projectName)) {
    if (norm(a.projectName) === norm(b.projectName)) matched.push('project');
    else conflicting.push('project');
  }

  // A hard physical contradiction settles it. Two adverts cannot describe one
  // flat while disagreeing about how big it is or which floor it is on.
  if (conflicting.includes('area') || conflicting.includes('floor') || conflicting.includes('rooms')) {
    return {
      verdict: 'DIFFERENT',
      matched,
      conflicting,
      reason: `physical attributes disagree: ${conflicting.join(', ')}`,
    };
  }

  const hasAddress = matched.includes('address');
  const strong = hasAddress && areaAgrees;
  if (strong) {
    return {
      verdict: 'SAME',
      matched,
      conflicting,
      reason: 'same street address and the same area',
    };
  }

  // Three or more agreeing physical attributes including area, in the same
  // place, is strong enough to flag but not to merge.
  const physical = matched.filter((m) => m.startsWith('area') || m === 'bedrooms' || m === 'rooms' || m === 'floor' || m === 'totalFloors');
  if (areaAgrees && physical.length >= 3) {
    return {
      verdict: 'UNCERTAIN',
      matched,
      conflicting,
      reason: `${physical.join(', ')} all agree, but no address confirms they are one property`,
    };
  }
  if (areaAgrees && (matched.includes('project') || matched.includes('street')) && physical.length >= 2) {
    return {
      verdict: 'UNCERTAIN',
      matched,
      conflicting,
      reason: 'same building or street with matching size, but not confirmed as one property',
    };
  }

  return {
    verdict: 'DIFFERENT',
    matched,
    conflicting,
    reason: matched.length
      ? `only ${matched.join(', ')} agree — not enough to call them one property`
      : 'no shared attributes strong enough to compare',
  };
}

/**
 * A blocking key, so identity comparison does not compare everything to
 * everything.
 *
 * DELIBERATELY NOT KEYED ON AREA. The obvious version rounds the area into
 * buckets — and that silently breaks the very case it exists for: with 5m²
 * buckets, 97m² rounds to 95 and 98m² rounds to 100, so two adverts for ONE
 * flat whose area was written down slightly differently land in different
 * buckets and are never compared. The duplicate then survives as two
 * comparables, which is exactly the error this module was built to prevent.
 *
 * Transaction and place are safe to block on because they are categorical: a
 * rent is never the same record as a sale, and one flat does not sit in two
 * districts. Within a block the comparison is quadratic, which is fine — the
 * envelope caps a run at a few dozen adverts, and correctness is worth more
 * here than a constant factor.
 */
export function identityBlockKey(listing: NormalizedListing): string {
  const district = norm(listing.district || listing.city || 'unknown');
  const transaction = listing.sale ? 'sale' : listing.rent ? 'rent' : 'unknown';
  return `${transaction}|${district}`;
}
