/*
 * The one place a requirement or amenity code becomes an i18n key. Pure (no React),
 * so a matrix test can prove every code the server can name has words in all six
 * bundles and none ever reaches a customer as a raw key.
 */
export const AMENITY_CODES = ['PARKING', 'BALCONY', 'TERRACE', 'ELEVATOR', 'GARDEN', 'POOL', 'FURNISHED',
  'CENTRAL_HEATING', 'VIEW', 'PET_FRIENDLY', 'STORAGE', 'AIR_CONDITIONING'] as const;
export const OTHER_REQUIREMENT_KEY = 'fpv_amenity_OTHER';

const REQUIREMENT_KEYS: Record<string, string> = {
  AREA: 'mps_fact_area', ROOMS: 'mps_fact_rooms', BEDROOMS: 'mps_fact_bedrooms', BATHROOMS: 'mps_fact_bathrooms',
  FLOOR_NOT_FIRST: 'fpa_NOT_FIRST', FLOOR_NOT_LAST: 'fpa_NOT_LAST', FLOOR_RANGE: 'mps_fact_floor',
  BUILDING_AGE: 'fpa_building_age', BUILDING_STATUS: 'mps_fact_building', RENOVATION: 'mps_fact_renovation',
  DISTRICT: 'fpr_location', PARKING: 'mps_fact_parking', FURNISHED: 'fpv_amenity_FURNISHED',
};

export const amenityKey = (code: string): string =>
  (AMENITY_CODES as readonly string[]).includes(code) ? `fpv_amenity_${code}` : OTHER_REQUIREMENT_KEY;

/** REQUIRED_<amenity> and EXCLUDED_<amenity> name the amenity; anything unknown gets a neutral word, never the code. */
export function requirementKey(code: string): string {
  if (REQUIREMENT_KEYS[code]) return REQUIREMENT_KEYS[code];
  const amenity = /^(?:REQUIRED|EXCLUDED)_(.+)$/.exec(code)?.[1] ?? code;
  return amenityKey(amenity);
}
