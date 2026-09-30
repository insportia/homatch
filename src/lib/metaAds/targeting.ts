// META ADS — WHO SEES THE AD. The customer's simple choice (where, which ages,
// which gender) and the Meta targeting spec it becomes.
//
// The customer picks locations from Meta's own location search, so every
// region/city carries the key Meta issued; nothing here invents an id. Pure:
// no React, no Deno, no network. Used by the builder (to show what applies),
// by preflight (to refuse what Meta would refuse) and by the ad-set payload.
//
// SPECIAL AD CATEGORY: HOUSING. A residential sale or rental is a Housing ad.
// Meta then fixes the audience to all adults (18–65+) of every gender, allows
// no postcode targeting and no location radius under 15 miles, and restricts
// detailed targeting. HOMATCH never sends a narrowing Meta would reject; it
// applies the rule and says so, in plain words, before the customer launches.

export type Gender = 'ALL' | 'MALE' | 'FEMALE';
export type LocationType = 'country' | 'region' | 'city';

export interface LocationChoice {
  type: LocationType;
  /** ISO-3166 alpha-2 for a country; Meta's location key for a region or city. */
  key: string;
  name: string;
  countryCode: string;
  /** Cities only: radius around the city, kilometres. */
  radiusKm?: number | null;
}

export interface TargetingIntent {
  locations: LocationChoice[];
  ageMin: number;
  ageMax: number;
  gender: Gender;
}

/** Meta's own bounds: 18..65, where 65 means "65 and older". */
export const META_AGE_MIN = 18;
export const META_AGE_MAX = 65;
/** Housing ads: the smallest radius Meta accepts around a city (15 miles). */
export const HOUSING_MIN_RADIUS_KM = 25;
export const CITY_RADIUS_KM_DEFAULT = 17;
export const CITY_RADIUS_KM_MAX = 80;
export const MAX_LOCATIONS = 25;

export interface TargetingConstraints {
  ageLocked: boolean;
  genderLocked: boolean;
  minRadiusKm: number | null;
  detailedTargetingAllowed: boolean;
  reason: 'HOUSING_SPECIAL_AD_CATEGORY' | null;
}

export function targetingConstraints(specialAdCategories: string[]): TargetingConstraints {
  const housing = specialAdCategories.includes('HOUSING');
  return housing
    ? { ageLocked: true, genderLocked: true, minRadiusKm: HOUSING_MIN_RADIUS_KM, detailedTargetingAllowed: false, reason: 'HOUSING_SPECIAL_AD_CATEGORY' }
    : { ageLocked: false, genderLocked: false, minRadiusKm: null, detailedTargetingAllowed: true, reason: null };
}

const COUNTRY = /^[A-Z]{2}$/;
const META_KEY = /^[0-9]{1,20}$/;

export interface TargetingIssue { code: string; field: 'locations' | 'age' | 'gender' }

/** Structural validation. Meta itself is the final judge of a key; this
 *  refuses what can never be valid, so a bad draft never reaches Graph. */
export function validateTargeting(intent: TargetingIntent): TargetingIssue[] {
  const issues: TargetingIssue[] = [];
  const locs = Array.isArray(intent.locations) ? intent.locations : [];
  if (locs.length === 0) issues.push({ code: 'LOCATION_REQUIRED', field: 'locations' });
  if (locs.length > MAX_LOCATIONS) issues.push({ code: 'TOO_MANY_LOCATIONS', field: 'locations' });
  for (const l of locs) {
    if (!['country', 'region', 'city'].includes(l.type)) issues.push({ code: 'LOCATION_TYPE_INVALID', field: 'locations' });
    else if (l.type === 'country' && !COUNTRY.test(String(l.key))) issues.push({ code: 'COUNTRY_CODE_INVALID', field: 'locations' });
    else if (l.type !== 'country' && !META_KEY.test(String(l.key))) issues.push({ code: 'LOCATION_KEY_INVALID', field: 'locations' });
    if (!COUNTRY.test(String(l.countryCode ?? ''))) issues.push({ code: 'LOCATION_COUNTRY_INVALID', field: 'locations' });
  }
  const min = Number(intent.ageMin);
  const max = Number(intent.ageMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < META_AGE_MIN || max > META_AGE_MAX || min > max) {
    issues.push({ code: 'AGE_RANGE_INVALID', field: 'age' });
  }
  if (!['ALL', 'MALE', 'FEMALE'].includes(intent.gender)) issues.push({ code: 'GENDER_INVALID', field: 'gender' });
  return [...new Map(issues.map((i) => [i.code, i])).values()];
}

/** A draft that predates targeting (or a malformed one) becomes the market default. */
export function normalizeIntent(raw: unknown, defaultCountries: string[]): TargetingIntent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const locs = Array.isArray(r.locations) ? (r.locations as LocationChoice[]).filter((l) => l && typeof l === 'object') : [];
  return {
    locations: locs.length
      ? locs.slice(0, MAX_LOCATIONS).map((l) => ({
        type: l.type, key: l.type === 'country' ? String(l.key).toUpperCase() : String(l.key), name: String(l.name ?? l.key).slice(0, 120),
        countryCode: String(l.countryCode ?? (l.type === 'country' ? l.key : '')).toUpperCase(),
        radiusKm: l.type === 'city' && Number.isFinite(Number(l.radiusKm)) ? Number(l.radiusKm) : null,
      }))
      : defaultCountries.map((c) => ({ type: 'country' as const, key: c.toUpperCase(), name: c.toUpperCase(), countryCode: c.toUpperCase() })),
    ageMin: Number.isInteger(Number(r.ageMin)) ? Number(r.ageMin) : META_AGE_MIN,
    ageMax: Number.isInteger(Number(r.ageMax)) ? Number(r.ageMax) : META_AGE_MAX,
    gender: r.gender === 'MALE' || r.gender === 'FEMALE' ? r.gender : 'ALL',
  };
}

export interface AppliedTargeting {
  /** What Meta receives. */
  spec: Record<string, unknown>;
  /** Every country the ads can reach — Meta's special_ad_category_country. */
  countries: string[];
  /** What HOMATCH changed and why, for the customer and the plan. */
  adjustments: string[];
  effective: { ageMin: number; ageMax: number; gender: Gender };
}

/**
 * The customer's intent, made legal for the ad's category. A country that
 * also has a region or city chosen inside it is sent only as those places
 * (Meta refuses a country together with a location inside it).
 */
export function applyTargeting(intent: TargetingIntent, specialAdCategories: string[], only?: LocationChoice[]): AppliedTargeting {
  const rules = targetingConstraints(specialAdCategories);
  const adjustments: string[] = [];
  const locs = only ?? intent.locations;
  const narrowed = new Set(locs.filter((l) => l.type !== 'country').map((l) => l.countryCode));
  const countries = [...new Set(locs.filter((l) => l.type === 'country' && !narrowed.has(l.key)).map((l) => l.key))];
  const regions = locs.filter((l) => l.type === 'region').map((l) => ({ key: l.key }));
  const cities = locs.filter((l) => l.type === 'city').map((l) => {
    let radius = Math.min(CITY_RADIUS_KM_MAX, Math.max(1, Math.round(Number(l.radiusKm ?? CITY_RADIUS_KM_DEFAULT))));
    if (rules.minRadiusKm && radius < rules.minRadiusKm) {
      radius = rules.minRadiusKm;
      adjustments.push('HOUSING_RADIUS_WIDENED');
    }
    return { key: l.key, radius, distance_unit: 'kilometer' };
  });
  const geo: Record<string, unknown> = {};
  if (countries.length) geo.countries = countries;
  if (regions.length) geo.regions = regions;
  if (cities.length) geo.cities = cities;

  let ageMin = intent.ageMin;
  let ageMax = intent.ageMax;
  let gender = intent.gender;
  if (rules.ageLocked && (ageMin !== META_AGE_MIN || ageMax !== META_AGE_MAX)) {
    ageMin = META_AGE_MIN; ageMax = META_AGE_MAX; adjustments.push('HOUSING_AGE_ALL_ADULTS');
  }
  if (rules.genderLocked && gender !== 'ALL') { gender = 'ALL'; adjustments.push('HOUSING_ALL_GENDERS'); }

  const spec: Record<string, unknown> = { geo_locations: geo, age_min: ageMin, age_max: ageMax };
  if (gender === 'MALE') spec.genders = [1];
  if (gender === 'FEMALE') spec.genders = [2];
  return {
    spec,
    countries: [...new Set(locs.map((l) => l.countryCode))],
    adjustments: [...new Set(adjustments)],
    effective: { ageMin, ageMax, gender },
  };
}

/** Distinct places a budget could test separately: each chosen location. */
export function locationGroups(intent: TargetingIntent): LocationChoice[][] {
  return intent.locations.map((l) => [l]);
}
