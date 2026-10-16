/*
 * Find Property — the ONE place a requirement or amenity code becomes words.
 *
 * Codes come from the server: ranking.ts hardFilter() (`unverified`, e.g. AREA,
 * DISTRICT, REQUIRED_BALCONY), the browse summary's `unconfirmed` list, and the
 * result evidence's preferences (amenity codes from taxonomy.ts). Every known
 * code maps to a real translation key; an unknown code becomes a generic phrase.
 * A translation key or a raw code is never what the customer reads.
 *
 * tests/matrix/marketplaceSearch.test.mjs enumerates every code ranking.ts and
 * taxonomy.ts can emit and asserts each key exists in all six bundles.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Facts hardFilter() can leave unconfirmed (or violate), by its own code. */
export const REQUIREMENT_KEY: Record<string, string> = {
  AREA: 'fpp_req_AREA', ROOMS: 'fpp_req_ROOMS', BEDROOMS: 'fpp_req_BEDROOMS', BATHROOMS: 'fpp_req_BATHROOMS',
  FLOOR_RANGE: 'fpp_req_FLOOR_RANGE', BUILDING_AGE: 'fpp_req_BUILDING_AGE',
  FLOOR_NOT_FIRST: 'fpp_req_FLOOR_NOT_FIRST', FLOOR_NOT_LAST: 'fpp_req_FLOOR_NOT_LAST',
  DISTRICT: 'fpp_req_DISTRICT', BUILDING_STATUS: 'fpp_req_BUILDING_STATUS', RENOVATION: 'fpp_req_RENOVATION',
  PARKING: 'fpp_amenity_PARKING', FURNISHED: 'fpp_amenity_FURNISHED',
};

/** The closed amenity vocabulary (taxonomy.ts AMENITIES). */
export const AMENITY_CODES = [
  'PARKING', 'BALCONY', 'TERRACE', 'ELEVATOR', 'GARDEN', 'POOL', 'FURNISHED',
  'CENTRAL_HEATING', 'VIEW', 'PET_FRIENDLY', 'STORAGE', 'AIR_CONDITIONING',
] as const;
const AMENITY = new Set<string>(AMENITY_CODES);

export const OTHER_REQUIREMENT_KEY = 'fpp_req_OTHER';

/** The translation key for a code, or null when the code is not known. */
export function requirementKey(code: string): string | null {
  if (REQUIREMENT_KEY[code]) return REQUIREMENT_KEY[code];
  const bare = code.replace(/^(REQUIRED|EXCLUDED)_/, '');
  if (AMENITY.has(bare)) return `fpp_amenity_${bare}`;
  return null;
}

/** Natural words for a code; never a key, never the code itself. */
export function requirementLabel(code: string, t: T): string {
  return t(requirementKey(code) ?? OTHER_REQUIREMENT_KEY);
}

/** Distinct labels for a list of codes, in first-seen order. */
export function requirementLabels(codes: readonly string[], t: T): string[] {
  return [...new Set(codes.map((code) => requirementLabel(code, t)))];
}
