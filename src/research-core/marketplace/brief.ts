// HOMATCH MARKETPLACE SEARCH — the Search Intelligence Brief.
//
// OpenAI reads the customer's first sentence and returns ONE FIXED SHAPE
// (`SEARCH_BRIEF_JSON_SCHEMA`, strict structured output). This module turns that
// untrusted shape into a brief in which every value came out of a closed set or
// is absent, exactly the contract search-plan.ts established for the older plan.
//
// THREE STATUSES, AND THE DIFFERENCE IS THE PRODUCT
//
//   STATED     the customer said it. A number is only STATED when it can be
//              traced to digits in the customer's own words; a model that
//              "reads" 150000 out of "around 150k, maybe a bit more" produced a
//              range nobody typed, and it is demoted to PROPOSED.
//   PROPOSED   the model suggests it. Shown, never searched on.
//   CONFIRMED  the customer accepted or edited it.
//
// Readiness (readiness.ts) counts STATED and CONFIRMED only. A proposed value
// is not a confirmed value.

import {
  type Amenity, type BuildingChoice, type FloorPreference, type MarketplacePropertyType,
  type MarketplaceTransaction, type RenovationChoice,
  AMENITIES, BUILDING_STATUSES, FLOOR_PREFERENCES, MARKETPLACE_PROPERTY_TYPES, MARKETPLACE_TRANSACTIONS,
  RENOVATION_STATUSES, SEARCH_LANGUAGES,
  asAmenity, asBuildingStatus, asFloorPreference, asPropertyType, asRenovationStatus, asTransaction,
  planPropertyTypeOf, searchGoalOf,
} from './taxonomy.ts';
import { resolvePlace } from '../normalize/place.ts';

export const SEARCH_BRIEF_VERSION = 'search-brief-1';

export type FieldStatus = 'STATED' | 'PROPOSED' | 'CONFIRMED';
export interface BriefField<T> { value: T; status: FieldStatus }
export interface NumericRange { min: number | null; max: number | null }

export type BriefFieldName =
  | 'transactionType' | 'propertyType' | 'city' | 'districts' | 'price' | 'area' | 'rooms'
  | 'bedrooms' | 'bathrooms' | 'buildingStatuses' | 'renovationPreferences' | 'furnished' | 'parking';

export const BRIEF_FIELD_NAMES: readonly BriefFieldName[] = [
  'transactionType', 'propertyType', 'city', 'districts', 'price', 'area', 'rooms',
  'bedrooms', 'bathrooms', 'buildingStatuses', 'renovationPreferences', 'furnished', 'parking',
];

export interface SearchIntelligenceBrief {
  version: typeof SEARCH_BRIEF_VERSION;
  transactionType: BriefField<MarketplaceTransaction> | null;
  propertyType: BriefField<MarketplacePropertyType> | null;
  /** ISO-3166 alpha-2. The market; Georgia unless the customer named another. */
  country: string;
  city: BriefField<string> | null;
  districts: BriefField<string[]> | null;
  locationPreferences: string[];
  /** USD. Total price for BUY, per month for MONTHLY_RENT, per night for DAILY_RENT. */
  price: BriefField<NumericRange> | null;
  area: BriefField<NumericRange> | null;
  rooms: BriefField<NumericRange> | null;
  bedrooms: BriefField<NumericRange> | null;
  bathrooms: BriefField<NumericRange> | null;
  buildingStatuses: BriefField<BuildingChoice[]> | null;
  renovationPreferences: BriefField<RenovationChoice[]> | null;
  furnished: BriefField<boolean> | null;
  parking: BriefField<boolean> | null;
  floorPreferences: FloorPreference[];
  mustHave: Amenity[];
  niceToHave: Amenity[];
  exclusions: Amenity[];
  userLanguage: string | null;
  relevantSearchLanguages: string[];
  /** The customer's own words, verbatim. The brief is a reading of this. */
  originalText: string;
  /** Things the model said that could not be kept, as i18n key + the customer's value. */
  dropped: Array<{ key: string; value: string }>;
}

/* ------------------------------------------------------------------ *
 * OpenAI structured-output schema (strict)                           *
 * ------------------------------------------------------------------ */

const nullable = (type: string) => ({ type: [type, 'null'] });
const enumOrNull = (values: readonly string[]) => ({ type: ['string', 'null'], enum: [...values, null] });
const enumArray = (values: readonly string[]) => ({ type: 'array', items: { type: 'string', enum: [...values] } });

/**
 * The only shape the model may return. Strict mode: every key required, nothing
 * additional. `proposals` is the one place a model may suggest a value the
 * customer did not state; it never lands in a field directly.
 */
export const SEARCH_BRIEF_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'transactionType', 'propertyType', 'country', 'city', 'districts', 'locationPreferences',
    'priceMinUsd', 'priceMaxUsd', 'priceCurrencyStated', 'areaMinSqm', 'areaMaxSqm',
    'roomsMin', 'roomsMax', 'bedroomsMin', 'bedroomsMax', 'bathroomsMin',
    'buildingStatuses', 'renovationPreferences', 'furnished', 'parking', 'floorPreferences',
    'mustHave', 'niceToHave', 'exclusions', 'userLanguage', 'relevantSearchLanguages', 'proposals',
  ],
  properties: {
    transactionType: enumOrNull(MARKETPLACE_TRANSACTIONS),
    propertyType: enumOrNull(MARKETPLACE_PROPERTY_TYPES),
    country: nullable('string'),
    city: nullable('string'),
    districts: { type: 'array', items: { type: 'string' } },
    locationPreferences: { type: 'array', items: { type: 'string' } },
    priceMinUsd: nullable('number'),
    priceMaxUsd: nullable('number'),
    priceCurrencyStated: enumOrNull(['USD', 'GEL', 'EUR']),
    areaMinSqm: nullable('number'),
    areaMaxSqm: nullable('number'),
    roomsMin: nullable('integer'),
    roomsMax: nullable('integer'),
    bedroomsMin: nullable('integer'),
    bedroomsMax: nullable('integer'),
    bathroomsMin: nullable('integer'),
    buildingStatuses: enumArray([...BUILDING_STATUSES, 'ANY']),
    renovationPreferences: enumArray([...RENOVATION_STATUSES, 'ANY']),
    furnished: nullable('boolean'),
    parking: nullable('boolean'),
    floorPreferences: enumArray(FLOOR_PREFERENCES),
    mustHave: enumArray(AMENITIES),
    niceToHave: enumArray(AMENITIES),
    exclusions: enumArray(AMENITIES),
    userLanguage: enumOrNull(SEARCH_LANGUAGES),
    relevantSearchLanguages: enumArray(SEARCH_LANGUAGES),
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'min', 'max'],
        properties: {
          field: { type: 'string', enum: ['price', 'area', 'rooms', 'bedrooms'] },
          min: nullable('number'),
          max: nullable('number'),
        },
      },
    },
  },
} as const;

/** The system prompt for OpenAI call 1. Behaviour lives in the schema; this states the rules. */
export const SEARCH_BRIEF_INSTRUCTIONS = [
  'You read one message from a person looking for real estate and return ONLY what they said, in the given JSON schema.',
  'Never invent a value. A field the person did not state is null (or an empty array).',
  'Prices are USD. If the person stated a price in another currency, set priceCurrencyStated to it and leave priceMinUsd/priceMaxUsd null.',
  'For a maximum only ("up to $150000"), set priceMaxUsd to that maximum and priceMinUsd to null. HOMATCH computes the default minimum; do not calculate or propose it. Preserve both ends when the person explicitly states a range.',
  'A single approximate price ("around 150000") is NOT a range: leave priceMinUsd and priceMaxUsd null and add a proposal for field "price".',
  'Rooms and bedrooms are different fields: "3 ოთახიანი" / "3-room" is rooms, "2 საძინებლიანი" / "2-bedroom" is bedrooms.',
  'transactionType: BUY for purchase, MONTHLY_RENT for monthly/long-term rent, DAILY_RENT for daily/short-term rent.',
  'buildingStatuses: NEW_BUILD for new/ახალაშენებული, UNDER_CONSTRUCTION for მშენებარე/under construction, OLD_BUILD for old/ძველი, ANY when they say it does not matter.',
  'Distinguish cities from neighborhoods: Varketili/ვარკეთილი is a Tbilisi neighborhood, never a city. A known neighborhood implies its parent city. Put the neighborhood in districts; keep streets, microdistrict preferences and relative directions in locationPreferences, never in city or districts.',
  'Copy named places without inventing extra neighborhoods or street filters. If their parent city is unknown, leave city null so the person is asked.',
  'relevantSearchLanguages: only languages listings for this market are realistically published in.',
  'Proposals are suggestions for missing ranges only; they are shown to the person, never searched on.',
].join('\n');

/* ------------------------------------------------------------------ *
 * Traceability: is a number really in the customer's words?          *
 * ------------------------------------------------------------------ */

const THOUSAND = /^(k|к|ათას|тыс|bin|thousand|ألف|אלף)/iu;
const MILLION = /^(m\b|mln|მლნ|million|млн|milyon|مليون|מיליון)/iu;

/** Every number the text states, with thousand/million words applied. */
export function statedNumbers(text: string): number[] {
  const out = new Set<number>();
  const re = /(\d{1,3}(?:[ ,. ]\d{3})+|\d+(?:[.,]\d+)?)\s*([^\s\d]{0,9})/gu;
  for (const m of String(text ?? '').matchAll(re)) {
    const digits = m[1];
    const grouped = /^\d{1,3}(?:[ ,. ]\d{3})+$/.test(digits);
    const base = grouped ? Number(digits.replace(/[ ,. ]/g, '')) : Number(digits.replace(',', '.'));
    if (!Number.isFinite(base)) continue;
    out.add(base);
    const unit = (m[2] ?? '').replace(/^[$€₾]/, '');
    if (THOUSAND.test(unit)) out.add(Math.round(base * 1000));
    if (MILLION.test(unit)) out.add(Math.round(base * 1_000_000));
  }
  return [...out];
}

const traceable = (value: number | null, numbers: readonly number[]) =>
  value === null || numbers.some((n) => Math.abs(n - value) < 0.5);

/* ------------------------------------------------------------------ *
 * Normalising the model's output                                     *
 * ------------------------------------------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A finite non-negative number, or null. */
const num = (raw: unknown): number | null => {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const int = (raw: unknown): number | null => {
  const v = num(raw);
  return v === null || v > 50 ? null : Math.trunc(v);
};

/** A place NAME: short, one line, nothing that could be read as an expression. */
export function placeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text || text.length > 60) return null;
  if (/[,;()'"`%*=<>|&{}[\]\\]/.test(text)) return null;
  return text;
}

function range(min: number | null, max: number | null): NumericRange | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

/** Canonical primary budget; acquisition's upgrade ceiling is calculated separately. */
export function primaryPriceRange(value: NumericRange | null): NumericRange | null {
  return value && value.min === null && value.max !== null
    ? { min: Math.max(0, value.max - 15000), max: value.max }
    : value;
}

const listOf = <T>(raw: unknown, pick: (v: unknown) => T | null, cap = 12): T[] => {
  const out: T[] = [];
  for (const v of Array.isArray(raw) ? raw.slice(0, cap) : []) {
    const p = pick(v);
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out;
};

const lang = (raw: unknown) => {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SEARCH_LANGUAGES.includes(v) ? v : null;
};

const buildingChoice = (v: unknown): BuildingChoice | null =>
  (typeof v === 'string' && v.trim().toUpperCase() === 'ANY') ? 'ANY' : asBuildingStatus(v);
const renovationChoice = (v: unknown): RenovationChoice | null =>
  (typeof v === 'string' && v.trim().toUpperCase() === 'ANY') ? 'ANY' : asRenovationStatus(v);

/** 'ANY' together with specific values is a contradiction; the specific values win. */
const collapseAny = <T extends string>(list: T[]): T[] =>
  list.length > 1 && list.includes('ANY' as T) ? list.filter((v) => v !== 'ANY') : list;

export function emptyBrief(originalText = ''): SearchIntelligenceBrief {
  return {
    version: SEARCH_BRIEF_VERSION,
    transactionType: null, propertyType: null, country: 'GE', city: null, districts: null, locationPreferences: [],
    price: null, area: null, rooms: null, bedrooms: null, bathrooms: null,
    buildingStatuses: null, renovationPreferences: null, furnished: null, parking: null,
    floorPreferences: [], mustHave: [], niceToHave: [], exclusions: [],
    userLanguage: null, relevantSearchLanguages: [], originalText: String(originalText).slice(0, 4000), dropped: [],
  };
}

/**
 * Model output (untrusted JSON) + the customer's words → a brief.
 *
 * Pure and total. Numbers that cannot be traced to the text are demoted to
 * PROPOSED; a price stated in a currency other than USD is not converted (no
 * rate is invented here) and is dropped with a reason so the customer is asked
 * in USD.
 */
export function briefFromModel(raw: unknown, originalText: string): SearchIntelligenceBrief {
  const brief = emptyBrief(originalText);
  if (!isRecord(raw)) return brief;
  const numbers = statedNumbers(originalText);
  const stated = <T>(value: T): BriefField<T> => ({ value, status: 'STATED' });
  const rangeField = (min: number | null, max: number | null): BriefField<NumericRange> | null => {
    const r = range(min, max);
    if (!r) return null;
    return { value: r, status: traceable(r.min, numbers) && traceable(r.max, numbers) ? 'STATED' : 'PROPOSED' };
  };

  const t = asTransaction(raw.transactionType);
  if (t) brief.transactionType = stated(t);
  const p = asPropertyType(raw.propertyType);
  if (p) brief.propertyType = stated(p);

  const country = typeof raw.country === 'string' ? raw.country.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(country)) brief.country = country;

  if (raw.city !== null && raw.city !== undefined) {
    const city = placeName(raw.city);
    if (city) brief.city = stated(city);
    else brief.dropped.push({ key: 'mps_dropped_place', value: String(raw.city) });
  }
  const districts: string[] = [];
  for (const d of Array.isArray(raw.districts) ? raw.districts.slice(0, 8) : []) {
    const name = placeName(d);
    if (name && !districts.includes(name)) districts.push(name);
    else if (!name) brief.dropped.push({ key: 'mps_dropped_place', value: String(d) });
  }
  if (districts.length) brief.districts = stated(districts);
  /* A district HOMATCH knows belongs to Tbilisi implies the city; stated, because the customer named the place. */
  const implied = districts.map((d) => resolvePlace(d)).find((r) => r?.kind === 'DISTRICT');
  if (!brief.city && implied) brief.city = stated(implied.cityKey.charAt(0).toUpperCase() + implied.cityKey.slice(1));
  brief.locationPreferences = listOf(raw.locationPreferences, placeName, 6);

  const currency = typeof raw.priceCurrencyStated === 'string' ? raw.priceCurrencyStated.toUpperCase() : null;
  if (currency && currency !== 'USD') {
    brief.dropped.push({ key: 'mps_dropped_currency', value: currency });
  } else {
    brief.price = rangeField(num(raw.priceMinUsd), num(raw.priceMaxUsd));
    if (brief.price && raw.priceMinUsd == null) brief.price = { ...brief.price, value: primaryPriceRange(brief.price.value)! };
  }
  brief.area = rangeField(num(raw.areaMinSqm), num(raw.areaMaxSqm));
  brief.rooms = rangeField(int(raw.roomsMin), int(raw.roomsMax));
  brief.bedrooms = rangeField(int(raw.bedroomsMin), int(raw.bedroomsMax));
  brief.bathrooms = rangeField(int(raw.bathroomsMin), null);

  const buildings = collapseAny(listOf(raw.buildingStatuses, buildingChoice, 4));
  if (buildings.length) brief.buildingStatuses = stated(buildings);
  const renovations = collapseAny(listOf(raw.renovationPreferences, renovationChoice, 6));
  if (renovations.length) brief.renovationPreferences = stated(renovations);
  if (typeof raw.furnished === 'boolean') brief.furnished = stated(raw.furnished);
  if (typeof raw.parking === 'boolean') brief.parking = stated(raw.parking);

  brief.floorPreferences = listOf(raw.floorPreferences, asFloorPreference, 5);
  brief.mustHave = listOf(raw.mustHave, asAmenity);
  brief.niceToHave = listOf(raw.niceToHave, asAmenity).filter((a) => !brief.mustHave.includes(a));
  brief.exclusions = listOf(raw.exclusions, asAmenity).filter((a) => !brief.mustHave.includes(a));
  brief.userLanguage = lang(raw.userLanguage);
  brief.relevantSearchLanguages = listOf(raw.relevantSearchLanguages, lang, 6);

  /* Proposals fill only fields that are still empty, and always as PROPOSED. */
  for (const prop of Array.isArray(raw.proposals) ? raw.proposals.slice(0, 4) : []) {
    if (!isRecord(prop)) continue;
    const field = prop.field;
    const isInt = field === 'rooms' || field === 'bedrooms';
    const r = range(isInt ? int(prop.min) : num(prop.min), isInt ? int(prop.max) : num(prop.max));
    if (!r) continue;
    if ((field === 'price' || field === 'area' || field === 'rooms' || field === 'bedrooms') && !brief[field]) {
      brief[field] = { value: r, status: 'PROPOSED' };
    }
  }
  return normalizeSearchLocations(brief);
}

/** Marketplace-only geography correction, shared by model output and the start gate. */
export function normalizeSearchLocations(brief: SearchIntelligenceBrief): SearchIntelligenceBrief {
  const known = (name: string) => resolvePlace(name) ??
    (['varketili', 'ვარკეთილი', 'ვარკეთილში', 'варкетили'].includes(name.trim().toLowerCase())
      // Verified MyHome cities dictionary: Tbilisi > Isani-Samgori > Varketili.
      ? { key: 'varketili', kind: 'DISTRICT' as const, cityKey: 'tbilisi' } : null);
  const cityPlace = brief.city ? known(brief.city.value) : null;
  let districts = [...(brief.districts?.value ?? [])];
  let status = brief.districts?.status ?? brief.city?.status ?? 'STATED';
  if (cityPlace?.kind === 'DISTRICT' && brief.city) {
    districts.unshift(cityPlace.key === 'varketili' ? 'Varketili' : brief.city.value);
    status = brief.city.status === 'PROPOSED' ? 'PROPOSED' : status;
    brief.city = { value: 'Tbilisi', status: brief.city.status };
  }
  const preferences = districts.filter(name => !known(name) &&
    (/ქუჩ|\bstreet\b|\bavenue\b|\broad\b/iu.test(name) || /^(მიკროები|microdistricts?)$/iu.test(name.trim())));
  districts = [...new Set(districts.filter(name => !preferences.includes(name)))];
  brief.locationPreferences = [...new Set([...brief.locationPreferences, ...preferences])].slice(0, 12);
  brief.districts = districts.length ? { value: districts, status } : null;
  const implied = districts.map(known).find(place => place?.kind === 'DISTRICT');
  if (!brief.city && implied) brief.city = { value: 'Tbilisi', status };
  return brief;
}

/* ------------------------------------------------------------------ *
 * The customer's edits                                               *
 * ------------------------------------------------------------------ */

export type BriefEdit =
  | { field: 'transactionType'; value: MarketplaceTransaction | null }
  | { field: 'propertyType'; value: MarketplacePropertyType | null }
  | { field: 'city'; value: string | null }
  | { field: 'districts'; value: string[] | null }
  | { field: 'price' | 'area' | 'rooms' | 'bedrooms' | 'bathrooms'; value: NumericRange | null }
  | { field: 'buildingStatuses'; value: BuildingChoice[] | null }
  | { field: 'renovationPreferences'; value: RenovationChoice[] | null }
  | { field: 'furnished' | 'parking'; value: boolean | null }
  | { field: 'confirm'; target: BriefFieldName };

/**
 * Apply one edit. Whatever the customer sets is CONFIRMED; `confirm` accepts a
 * PROPOSED value as it stands. Invalid values clear the field rather than
 * being corrected.
 */
export function applyEdit(brief: SearchIntelligenceBrief, edit: BriefEdit): SearchIntelligenceBrief {
  const next: SearchIntelligenceBrief = { ...brief };
  const set = <K extends BriefFieldName>(k: K, v: unknown) => {
    (next as unknown as Record<string, unknown>)[k] = v === null ? null : { value: v, status: 'CONFIRMED' };
  };
  switch (edit.field) {
    case 'confirm': {
      const current = brief[edit.target] as BriefField<unknown> | null;
      if (current) (next as unknown as Record<string, unknown>)[edit.target] = { ...current, status: 'CONFIRMED' };
      return next;
    }
    case 'transactionType': set('transactionType', edit.value ? asTransaction(edit.value) : null); return next;
    case 'propertyType': set('propertyType', edit.value ? asPropertyType(edit.value) : null); return next;
    case 'city': set('city', edit.value ? placeName(edit.value) : null); return normalizeSearchLocations(next);
    case 'districts': {
      const list = listOf(edit.value ?? [], placeName, 8);
      set('districts', list.length ? list : null);
      return normalizeSearchLocations(next);
    }
    case 'price': case 'area': case 'rooms': case 'bedrooms': case 'bathrooms': {
      const isInt = edit.field !== 'price' && edit.field !== 'area';
      const r = edit.value ? range(isInt ? int(edit.value.min) : num(edit.value.min), isInt ? int(edit.value.max) : num(edit.value.max)) : null;
      set(edit.field, edit.field === 'price' && edit.value?.min == null ? primaryPriceRange(r) : r);
      return next;
    }
    case 'buildingStatuses': {
      const list = collapseAny(listOf(edit.value ?? [], buildingChoice, 4));
      set('buildingStatuses', list.length ? list : null);
      return next;
    }
    case 'renovationPreferences': {
      const list = collapseAny(listOf(edit.value ?? [], renovationChoice, 6));
      set('renovationPreferences', list.length ? list : null);
      return next;
    }
    case 'furnished': case 'parking': set(edit.field, typeof edit.value === 'boolean' ? edit.value : null); return next;
  }
}

/**
 * Re-validate a brief that came back from a client. Field values are re-checked
 * against the closed vocabularies; statuses are kept (CONFIRMED by the customer
 * is the customer's call), but anything unrecognised is dropped.
 */
export function sanitizeBrief(raw: unknown): SearchIntelligenceBrief {
  const brief = emptyBrief(isRecord(raw) ? String(raw.originalText ?? '') : '');
  if (!isRecord(raw)) return brief;
  const field = <T>(v: unknown, pick: (x: unknown) => T | null): BriefField<T> | null => {
    if (!isRecord(v)) return null;
    const status = v.status === 'STATED' || v.status === 'PROPOSED' || v.status === 'CONFIRMED' ? v.status : null;
    const value = pick(v.value);
    return status && value !== null ? { value, status } : null;
  };
  const rangePick = (isInt: boolean) => (v: unknown) => isRecord(v) ? range(isInt ? int(v.min) : num(v.min), isInt ? int(v.max) : num(v.max)) : null;
  const listPick = <T>(pick: (x: unknown) => T | null, cap: number) => (v: unknown) => {
    const l = listOf(v, pick, cap);
    return l.length ? l : null;
  };
  brief.transactionType = field(raw.transactionType, asTransaction);
  brief.propertyType = field(raw.propertyType, asPropertyType);
  const country = typeof raw.country === 'string' ? raw.country.trim().toUpperCase() : 'GE';
  brief.country = /^[A-Z]{2}$/.test(country) ? country : 'GE';
  brief.city = field(raw.city, placeName);
  brief.districts = field(raw.districts, listPick(placeName, 8));
  brief.locationPreferences = listOf(raw.locationPreferences, placeName, 6);
  brief.price = field(raw.price, rangePick(false));
  if (brief.price && isRecord(raw.price) && isRecord(raw.price.value) && raw.price.value.min == null) {
    brief.price = { ...brief.price, value: primaryPriceRange(brief.price.value)! };
  }
  brief.area = field(raw.area, rangePick(false));
  brief.rooms = field(raw.rooms, rangePick(true));
  brief.bedrooms = field(raw.bedrooms, rangePick(true));
  brief.bathrooms = field(raw.bathrooms, rangePick(true));
  brief.buildingStatuses = field(raw.buildingStatuses, (v) => {
    const l = collapseAny(listOf(v, buildingChoice, 4));
    return l.length ? l : null;
  });
  brief.renovationPreferences = field(raw.renovationPreferences, (v) => {
    const l = collapseAny(listOf(v, renovationChoice, 6));
    return l.length ? l : null;
  });
  brief.furnished = field(raw.furnished, (v) => (typeof v === 'boolean' ? v : null));
  brief.parking = field(raw.parking, (v) => (typeof v === 'boolean' ? v : null));
  brief.floorPreferences = listOf(raw.floorPreferences, asFloorPreference, 5);
  brief.mustHave = listOf(raw.mustHave, asAmenity);
  brief.niceToHave = listOf(raw.niceToHave, asAmenity);
  brief.exclusions = listOf(raw.exclusions, asAmenity);
  brief.userLanguage = lang(raw.userLanguage);
  brief.relevantSearchLanguages = listOf(raw.relevantSearchLanguages, lang, 6);
  return normalizeSearchLocations(brief);
}

/** Field names currently holding a PROPOSED value. */
export function proposedFields(brief: SearchIntelligenceBrief): BriefFieldName[] {
  return BRIEF_FIELD_NAMES.filter((k) => (brief[k] as BriefField<unknown> | null)?.status === 'PROPOSED');
}

/** Field names holding a value the customer stated or confirmed. */
export function confirmedFields(brief: SearchIntelligenceBrief): BriefFieldName[] {
  return BRIEF_FIELD_NAMES.filter((k) => {
    const s = (brief[k] as BriefField<unknown> | null)?.status;
    return s === 'STATED' || s === 'CONFIRMED';
  });
}

/** Only values the customer stated or confirmed; proposals never reach a search. */
export function confirmedValue<T>(f: BriefField<T> | null): T | null {
  return f && (f.status === 'STATED' || f.status === 'CONFIRMED') ? f.value : null;
}

/**
 * The existing SearchPlan draft (search-plan.ts) this brief corresponds to, so
 * the native HOMATCH matcher and planToIntentProfile() keep one vocabulary.
 * Only confirmed values pass; all of them are REQUIRED (hard constraints stay hard).
 */
export function toSearchPlanDraft(brief: SearchIntelligenceBrief): Record<string, unknown> {
  const t = confirmedValue(brief.transactionType);
  const p = confirmedValue(brief.propertyType);
  const price = primaryPriceRange(confirmedValue(brief.price));
  const area = confirmedValue(brief.area);
  const bedrooms = confirmedValue(brief.bedrooms);
  return {
    goal: t ? searchGoalOf(t) : null,
    countryCode: brief.country,
    city: confirmedValue(brief.city),
    cityStrength: 'REQUIRED',
    districts: confirmedValue(brief.districts) ?? [],
    districtsStrength: 'REQUIRED',
    propertyTypes: p ? [planPropertyTypeOf(p)] : [],
    propertyTypesStrength: 'REQUIRED',
    budgetMin: price?.min ?? null,
    budgetMax: price?.max ?? null,
    currency: 'USD',
    budgetStrength: 'REQUIRED',
    bedroomsMin: bedrooms?.min ?? null,
    bedroomsMax: bedrooms?.max ?? null,
    bedroomsStrength: 'REQUIRED',
    areaMin: area?.min ?? null,
    areaMax: area?.max ?? null,
    areaStrength: 'REQUIRED',
    languages: brief.relevantSearchLanguages,
    originalText: brief.originalText,
    originalLanguage: brief.userLanguage,
  };
}
