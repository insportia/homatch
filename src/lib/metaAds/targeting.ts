// META ADS — WHO SEES THE AD. The customer's choice (where, which ages,
// which gender, which languages) and the Meta targeting spec it becomes.
//
// The customer picks places from Meta's own location search, so every
// region/city carries the key Meta issued; nothing here invents an id. A
// "pin" is a point the customer placed on the map (or their property's own
// coordinates): Meta's custom_locations, a latitude/longitude and a radius.
// Languages carry the locale key Meta's own locale search issued. Pure: no
// React, no Deno, no network. Used by the builder (to show what applies), by
// preflight (to refuse what Meta would refuse) and by the ad-set payload.
//
// SPECIAL AD CATEGORY: HOUSING — ONLY WHERE META REQUIRES IT.
// Meta requires a housing ad to run as a Special Ad Category when it reaches
// the United States (and its territories), Canada or a listed set of European
// countries (Meta Business Help, "About audiences for credit, employment or
// housing campaigns"; checked 2026-10-01). There, the audience is all adults
// (18–65+) of every gender, a city or pin reaches at least 25 km (US, Canada)
// or 15 km (the European list), and detailed targeting is restricted. A
// residential offer that reaches only other countries — Georgia, for one — is
// not restricted: its ages and gender are the customer's choice. HOMATCH never
// sends a narrowing Meta would reject; where Meta's rule applies it applies it
// and names the countries that cause it.

export type Gender = 'ALL' | 'MALE' | 'FEMALE';
export type LocationType = 'country' | 'region' | 'city' | 'pin';

export interface LocationChoice {
  type: LocationType;
  /** ISO-3166 alpha-2 for a country; Meta's location key for a region or
   *  city; "lat,lng" (5 decimals) for a pin. */
  key: string;
  name: string;
  countryCode: string;
  /** Cities and pins: radius around it, kilometres. */
  radiusKm?: number | null;
  /** Pins: the point Meta receives. Cities: where the map draws it (display only). */
  lat?: number | null;
  lng?: number | null;
}

/** A language the ads are shown in — Meta's locale key, from Meta's locale search. */
export interface LanguageChoice { key: string; name: string; code?: string | null }

/** What the customer wants from an international campaign. Intent only:
 *  HOMATCH turns it into places and languages the customer sees and confirms. */
export const INTERNATIONAL_INTENTS = ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE', 'INVESTORS_ABROAD', 'LANGUAGE_SPEAKERS', 'COUNTRY_CONNECTED'] as const;
export type InternationalIntent = (typeof INTERNATIONAL_INTENTS)[number];
export interface InternationalChoice {
  enabled: boolean;
  intents: InternationalIntent[];
  /** Countries the people are from / connected to (ISO-3166 alpha-2). */
  markets: string[];
}

export interface TargetingIntent {
  locations: LocationChoice[];
  ageMin: number;
  ageMax: number;
  gender: Gender;
  languages?: LanguageChoice[];
  international?: InternationalChoice | null;
}

/** Meta's own bounds: 18..65, where 65 means "65 and older". */
export const META_AGE_MIN = 18;
export const META_AGE_MAX = 65;
/** Housing ads in the US and Canada: the smallest radius Meta accepts (15 miles). */
export const HOUSING_MIN_RADIUS_KM = 25;
/** Housing ads in the European list: the smallest radius Meta accepts (9 miles). */
export const HOUSING_MIN_RADIUS_KM_EUROPE = 15;
export const CITY_RADIUS_KM_DEFAULT = 17;
export const CITY_RADIUS_KM_MAX = 80;
export const PIN_RADIUS_KM_MIN = 1;
export const MAX_LOCATIONS = 25;
export const MAX_LANGUAGES = 6;
export const MAX_MARKETS = 10;

/** Where Meta's housing restrictions apply, with the radius floor each needs. */
export const HOUSING_COUNTRIES_25KM: readonly string[] = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'CA'];
export const HOUSING_COUNTRIES_15KM: readonly string[] = [
  'AD', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GF', 'DE', 'GR', 'GP', 'HU', 'IS', 'IE', 'IM', 'IT',
  'LV', 'LI', 'LT', 'LU', 'MT', 'MQ', 'YT', 'MC', 'NL', 'NO', 'PL', 'PT', 'RE', 'RO', 'MF', 'SM', 'SK', 'SI', 'ES', 'SE',
  'CH', 'GB', 'GG', 'JE', 'VA',
];

export interface HousingRule {
  /** Meta's restrictions apply to this campaign. */
  restricted: boolean;
  /** The reached countries that cause it (empty when not restricted). */
  countries: string[];
  minRadiusKm: number | null;
}

/**
 * Whether a housing offer runs under Meta's restrictions: it reaches a listed
 * country, OR the advertiser's ad account belongs to a US business (Meta:
 * "any United States advertiser"). The advertiser country is the ad
 * account's business_country_code when Meta reported it; unknown is unknown,
 * never guessed.
 */
export function housingRule(housingOffer: boolean, countries: string[], advertiserCountry?: string | null): HousingRule {
  if (!housingOffer) return { restricted: false, countries: [], minRadiusKm: null };
  const set = [...new Set(countries.map((c) => String(c).toUpperCase()))];
  if (String(advertiserCountry ?? '').toUpperCase() === 'US' && !set.some((c) => HOUSING_COUNTRIES_25KM.includes(c) || HOUSING_COUNTRIES_15KM.includes(c))) {
    return { restricted: true, countries: ['US_ADVERTISER'], minRadiusKm: HOUSING_MIN_RADIUS_KM };
  }
  const strict = set.filter((c) => HOUSING_COUNTRIES_25KM.includes(c));
  const europe = set.filter((c) => HOUSING_COUNTRIES_15KM.includes(c));
  if (!strict.length && !europe.length) return { restricted: false, countries: [], minRadiusKm: null };
  return { restricted: true, countries: [...strict, ...europe], minRadiusKm: strict.length ? HOUSING_MIN_RADIUS_KM : HOUSING_MIN_RADIUS_KM_EUROPE };
}

/**
 * The places the ads actually run in: a country with a city, region or pin
 * chosen inside it runs only as those places (Meta refuses a country together
 * with a location inside it), so the refined country itself drops out.
 */
export function effectiveLocations(locations: LocationChoice[]): LocationChoice[] {
  const refined = new Set(locations.filter((l) => l.type !== 'country').map((l) => String(l.countryCode).toUpperCase()));
  return locations.filter((l) => l.type !== 'country' || !refined.has(String(l.key).toUpperCase()));
}

/** Every country a targeting intent reaches. */
export function reachedCountries(intent: Pick<TargetingIntent, 'locations'>): string[] {
  return [...new Set((intent.locations ?? []).map((l) => String(l.countryCode ?? '').toUpperCase()).filter(Boolean))];
}

/**
 * The categories the campaign DECLARES to Meta: the offer's own classification
 * (strategy.classifySpecialAdCategories), kept only where Meta requires it.
 */
export function declaredSpecialAdCategories(offerCategories: string[], intent: Pick<TargetingIntent, 'locations'>, advertiserCountry?: string | null): string[] {
  const housingOffer = offerCategories.includes('HOUSING');
  const rest = offerCategories.filter((c) => c !== 'HOUSING');
  return housingRule(housingOffer, reachedCountries(intent), advertiserCountry).restricted ? ['HOUSING', ...rest] : rest;
}

/**
 * WHO DECIDES AN AUDIENCE SETTING — three explicit authorities, never mixed:
 *   META_REQUIRED      Meta's rule for this campaign (housing in restricted
 *                      countries / US advertiser) — applied, named, explained.
 *   HOMATCH_RECOMMENDED HOMATCH's advice (broad ages and gender, a balanced
 *                      area) — shown beside the choice, never applied by itself.
 *   USER_CHOICE         everything Meta allows — saved and sent exactly as chosen.
 */
export type AudienceAuthority = 'META_REQUIRED' | 'HOMATCH_RECOMMENDED' | 'USER_CHOICE';
export function audienceAuthority(rule: HousingRule, setting: 'AGE' | 'GENDER' | 'RADIUS', chosen: { narrow: boolean }): AudienceAuthority {
  if (rule.restricted) return 'META_REQUIRED';
  return chosen.narrow && setting !== 'RADIUS' ? 'HOMATCH_RECOMMENDED' : 'USER_CHOICE';
}

export interface TargetingConstraints {
  ageLocked: boolean;
  genderLocked: boolean;
  minRadiusKm: number | null;
  detailedTargetingAllowed: boolean;
  reason: 'HOUSING_SPECIAL_AD_CATEGORY' | null;
}

/**
 * What the DECLARED categories impose. `countries` refines the radius floor
 * (15 km when only the European list is reached); without it the stricter
 * 25 km applies.
 */
export function targetingConstraints(specialAdCategories: string[], countries?: string[]): TargetingConstraints {
  const housing = specialAdCategories.includes('HOUSING');
  if (!housing) return { ageLocked: false, genderLocked: false, minRadiusKm: null, detailedTargetingAllowed: true, reason: null };
  const rule = countries ? housingRule(true, countries) : null;
  return {
    ageLocked: true, genderLocked: true,
    minRadiusKm: rule?.restricted ? rule.minRadiusKm : HOUSING_MIN_RADIUS_KM,
    detailedTargetingAllowed: false, reason: 'HOUSING_SPECIAL_AD_CATEGORY',
  };
}

const COUNTRY = /^[A-Z]{2}$/;
const META_KEY = /^[0-9]{1,20}$/;

export const pinKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
const validLat = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= -90 && Number(v) <= 90;
const validLng = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= -180 && Number(v) <= 180;

export interface TargetingIssue { code: string; field: 'locations' | 'age' | 'gender' | 'languages' | 'international' }

/** Structural validation. Meta itself is the final judge of a key; this
 *  refuses what can never be valid, so a bad draft never reaches Graph. */
export function validateTargeting(intent: TargetingIntent): TargetingIssue[] {
  const issues: TargetingIssue[] = [];
  const locs = Array.isArray(intent.locations) ? intent.locations : [];
  if (locs.length === 0) issues.push({ code: 'LOCATION_REQUIRED', field: 'locations' });
  if (locs.length > MAX_LOCATIONS) issues.push({ code: 'TOO_MANY_LOCATIONS', field: 'locations' });
  for (const l of locs) {
    if (!['country', 'region', 'city', 'pin'].includes(l.type)) issues.push({ code: 'LOCATION_TYPE_INVALID', field: 'locations' });
    else if (l.type === 'country' && !COUNTRY.test(String(l.key))) issues.push({ code: 'COUNTRY_CODE_INVALID', field: 'locations' });
    else if ((l.type === 'region' || l.type === 'city') && !META_KEY.test(String(l.key))) issues.push({ code: 'LOCATION_KEY_INVALID', field: 'locations' });
    else if (l.type === 'pin' && (!validLat(l.lat) || !validLng(l.lng))) issues.push({ code: 'PIN_INVALID', field: 'locations' });
    if (!COUNTRY.test(String(l.countryCode ?? ''))) issues.push({ code: 'LOCATION_COUNTRY_INVALID', field: 'locations' });
  }
  const min = Number(intent.ageMin);
  const max = Number(intent.ageMax);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < META_AGE_MIN || max > META_AGE_MAX || min > max) {
    issues.push({ code: 'AGE_RANGE_INVALID', field: 'age' });
  }
  if (!['ALL', 'MALE', 'FEMALE'].includes(intent.gender)) issues.push({ code: 'GENDER_INVALID', field: 'gender' });
  const langs = intent.languages ?? [];
  if (langs.length > MAX_LANGUAGES) issues.push({ code: 'TOO_MANY_LANGUAGES', field: 'languages' });
  if (langs.some((l) => !META_KEY.test(String(l?.key ?? '')))) issues.push({ code: 'LANGUAGE_KEY_INVALID', field: 'languages' });
  return [...new Map(issues.map((i) => [i.code, i])).values()];
}

/** A draft that predates targeting (or a malformed one) becomes the market default. */
export function normalizeIntent(raw: unknown, defaultCountries: string[]): TargetingIntent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const locs = Array.isArray(r.locations) ? (r.locations as LocationChoice[]).filter((l) => l && typeof l === 'object') : [];
  const coord = (v: unknown, ok: (x: unknown) => boolean) => (v != null && ok(v) ? Math.round(Number(v) * 1e5) / 1e5 : null);
  const intl = (r.international && typeof r.international === 'object' ? r.international : null) as Record<string, unknown> | null;
  const languages = Array.isArray(r.languages)
    ? (r.languages as LanguageChoice[]).filter((l) => l && typeof l === 'object' && META_KEY.test(String(l.key)))
      .slice(0, MAX_LANGUAGES)
      .map((l) => ({ key: String(l.key), name: String(l.name ?? l.key).slice(0, 80), code: l.code ? String(l.code).slice(0, 8) : null }))
    : [];
  const out: TargetingIntent = {
    locations: locs.length
      ? locs.slice(0, MAX_LOCATIONS).map((l) => {
        const lat = coord(l.lat, validLat);
        const lng = coord(l.lng, validLng);
        const radius = Number.isFinite(Number(l.radiusKm)) ? Number(l.radiusKm) : null;
        return {
          type: l.type,
          key: l.type === 'country' ? String(l.key).toUpperCase() : l.type === 'pin' && lat != null && lng != null ? pinKey(lat, lng) : String(l.key),
          name: String(l.name ?? l.key).slice(0, 120),
          countryCode: String(l.countryCode ?? (l.type === 'country' ? l.key : '')).toUpperCase(),
          radiusKm: l.type === 'city' || l.type === 'pin' ? radius : null,
          ...(l.type === 'city' || l.type === 'pin' ? { lat, lng } : {}),
        };
      })
      : defaultCountries.map((c) => ({ type: 'country' as const, key: c.toUpperCase(), name: c.toUpperCase(), countryCode: c.toUpperCase() })),
    ageMin: Number.isInteger(Number(r.ageMin)) ? Number(r.ageMin) : META_AGE_MIN,
    ageMax: Number.isInteger(Number(r.ageMax)) ? Number(r.ageMax) : META_AGE_MAX,
    gender: r.gender === 'MALE' || r.gender === 'FEMALE' ? r.gender : 'ALL',
  };
  if (languages.length) out.languages = languages;
  if (intl) {
    out.international = {
      enabled: intl.enabled === true,
      intents: (Array.isArray(intl.intents) ? intl.intents : []).map(String)
        .filter((x): x is InternationalIntent => (INTERNATIONAL_INTENTS as readonly string[]).includes(x)),
      markets: [...new Set((Array.isArray(intl.markets) ? intl.markets : []).map((m) => String(m).toUpperCase()).filter((m) => COUNTRY.test(m)))].slice(0, MAX_MARKETS),
    };
  }
  return out;
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
 * The customer's intent, made legal for the ad's declared category. A country
 * that also has a region, city or pin chosen inside it is sent only as those
 * places (Meta refuses a country together with a location inside it).
 */
export function applyTargeting(intent: TargetingIntent, specialAdCategories: string[], only?: LocationChoice[]): AppliedTargeting {
  const rules = targetingConstraints(specialAdCategories, reachedCountries(intent));
  const adjustments: string[] = [];
  const locs = only ?? intent.locations;
  const narrowed = new Set(locs.filter((l) => l.type !== 'country').map((l) => l.countryCode));
  const countries = [...new Set(locs.filter((l) => l.type === 'country' && !narrowed.has(l.key)).map((l) => l.key))];
  const regions = locs.filter((l) => l.type === 'region').map((l) => ({ key: l.key }));
  const radiusOf = (l: LocationChoice, min: number) => {
    let radius = Math.min(CITY_RADIUS_KM_MAX, Math.max(min, Math.round(Number(l.radiusKm ?? CITY_RADIUS_KM_DEFAULT))));
    if (rules.minRadiusKm && radius < rules.minRadiusKm) {
      radius = rules.minRadiusKm;
      adjustments.push('HOUSING_RADIUS_WIDENED');
    }
    return radius;
  };
  const cities = locs.filter((l) => l.type === 'city').map((l) => ({ key: l.key, radius: radiusOf(l, 1), distance_unit: 'kilometer' }));
  const pins = locs.filter((l) => l.type === 'pin' && validLat(l.lat) && validLng(l.lng)).map((l) => ({
    latitude: Number(l.lat), longitude: Number(l.lng), radius: radiusOf(l, PIN_RADIUS_KM_MIN), distance_unit: 'kilometer',
  }));
  const geo: Record<string, unknown> = {};
  if (countries.length) geo.countries = countries;
  if (regions.length) geo.regions = regions;
  if (cities.length) geo.cities = cities;
  if (pins.length) geo.custom_locations = pins;

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
  const locales = (intent.languages ?? []).map((l) => Number(l.key)).filter((k) => Number.isInteger(k) && k > 0);
  if (locales.length) spec.locales = locales;
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
