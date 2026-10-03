// HOMATCH MARKETPLACE SEARCH — the closed vocabularies a marketplace search speaks.
//
// Every value here already exists somewhere in HOMATCH; nothing is invented:
//
//   property types    the `property_type` enum (types.ts PropertyType, part1 schema)
//   building status   AI TALK's shell-state codes NEW_BUILD / OLD_BUILD /
//                     UNDER_CONSTRUCTION, and `condition_type` NEW / UNDER_CONSTRUCTION
//   renovation        the Georgian shell states BLACK_FRAME / WHITE_FRAME /
//                     GREEN_FRAME, RENOVATED, and `condition_type` NEEDS_RENOVATION
//   transactions      BUY / MONTHLY_RENT / DAILY_RENT, which map onto the matcher's
//                     DealKind SALE / RENT / SHORT_STAY (participants.ts)
//
// A marketplace worker translates THESE into a site's own filters; it never adds
// a vocabulary of its own to the core.

export type MarketplaceTransaction = 'BUY' | 'MONTHLY_RENT' | 'DAILY_RENT';
export const MARKETPLACE_TRANSACTIONS: readonly MarketplaceTransaction[] = ['BUY', 'MONTHLY_RENT', 'DAILY_RENT'];

export type MarketplacePropertyType =
  | 'APARTMENT' | 'HOUSE' | 'PENTHOUSE' | 'LAND' | 'COMMERCIAL' | 'OFFICE'
  | 'VILLA' | 'TOWNHOUSE' | 'STUDIO' | 'OTHER';
export const MARKETPLACE_PROPERTY_TYPES: readonly MarketplacePropertyType[] = [
  'APARTMENT', 'HOUSE', 'PENTHOUSE', 'LAND', 'COMMERCIAL', 'OFFICE', 'VILLA', 'TOWNHOUSE', 'STUDIO', 'OTHER',
];

export type BuildingStatus = 'NEW_BUILD' | 'OLD_BUILD' | 'UNDER_CONSTRUCTION';
export const BUILDING_STATUSES: readonly BuildingStatus[] = ['NEW_BUILD', 'OLD_BUILD', 'UNDER_CONSTRUCTION'];
/** 'ANY' is an answer ("does not matter"), not a missing value. */
export type BuildingChoice = BuildingStatus | 'ANY';

export type RenovationStatus = 'RENOVATED' | 'GREEN_FRAME' | 'WHITE_FRAME' | 'BLACK_FRAME' | 'NEEDS_RENOVATION';
export const RENOVATION_STATUSES: readonly RenovationStatus[] = [
  'RENOVATED', 'GREEN_FRAME', 'WHITE_FRAME', 'BLACK_FRAME', 'NEEDS_RENOVATION',
];
export type RenovationChoice = RenovationStatus | 'ANY';

/** Closed amenity vocabulary; free text never becomes a filter. */
export type Amenity =
  | 'PARKING' | 'BALCONY' | 'TERRACE' | 'ELEVATOR' | 'GARDEN' | 'POOL' | 'FURNISHED'
  | 'CENTRAL_HEATING' | 'VIEW' | 'PET_FRIENDLY' | 'STORAGE' | 'AIR_CONDITIONING';
export const AMENITIES: readonly Amenity[] = [
  'PARKING', 'BALCONY', 'TERRACE', 'ELEVATOR', 'GARDEN', 'POOL', 'FURNISHED',
  'CENTRAL_HEATING', 'VIEW', 'PET_FRIENDLY', 'STORAGE', 'AIR_CONDITIONING',
];

export type FloorPreference = 'NOT_FIRST' | 'NOT_LAST' | 'LOW' | 'MIDDLE' | 'HIGH';
export const FLOOR_PREFERENCES: readonly FloorPreference[] = ['NOT_FIRST', 'NOT_LAST', 'LOW', 'MIDDLE', 'HIGH'];

export const SEARCH_LANGUAGES: readonly string[] = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/** Property classes for requirement rules. */
export type PropertyClass = 'RESIDENTIAL_UNIT' | 'RESIDENTIAL_HOUSE' | 'STUDIO' | 'LAND' | 'NON_RESIDENTIAL' | 'OTHER';

export function propertyClassOf(type: MarketplacePropertyType): PropertyClass {
  switch (type) {
    case 'APARTMENT': case 'PENTHOUSE': return 'RESIDENTIAL_UNIT';
    case 'HOUSE': case 'VILLA': case 'TOWNHOUSE': return 'RESIDENTIAL_HOUSE';
    case 'STUDIO': return 'STUDIO';
    case 'LAND': return 'LAND';
    case 'COMMERCIAL': case 'OFFICE': return 'NON_RESIDENTIAL';
    default: return 'OTHER';
  }
}

/** The matcher's DealKind for a marketplace transaction (participants.ts vocabulary). */
export function dealKindOf(t: MarketplaceTransaction): 'SALE' | 'RENT' | 'SHORT_STAY' {
  return t === 'BUY' ? 'SALE' : t === 'MONTHLY_RENT' ? 'RENT' : 'SHORT_STAY';
}

/** The existing SearchPlan goal (search-plan.ts) a marketplace transaction corresponds to. */
export function searchGoalOf(t: MarketplaceTransaction): 'BUY' | 'RENT' | 'SHORT_STAY' {
  return t === 'BUY' ? 'BUY' : t === 'MONTHLY_RENT' ? 'RENT' : 'SHORT_STAY';
}

/** The coarse PlanPropertyType (search-plan.ts) the matcher compares in. */
export function planPropertyTypeOf(type: MarketplacePropertyType): 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'OFFICE' | 'OTHER' {
  switch (type) {
    case 'APARTMENT': case 'PENTHOUSE': case 'STUDIO': return 'APARTMENT';
    case 'HOUSE': case 'VILLA': case 'TOWNHOUSE': return 'HOUSE';
    case 'LAND': return 'LAND';
    case 'COMMERCIAL': return 'COMMERCIAL';
    case 'OFFICE': return 'OFFICE';
    default: return 'OTHER';
  }
}

/** `condition_type` (properties) → building status, where it says one. */
export function buildingStatusFromCondition(condition: string | null | undefined): BuildingStatus | null {
  const c = String(condition ?? '').toUpperCase();
  if (c === 'NEW' || c === 'NEW_BUILD') return 'NEW_BUILD';
  if (c === 'UNDER_CONSTRUCTION') return 'UNDER_CONSTRUCTION';
  if (c === 'OLD_BUILD') return 'OLD_BUILD';
  return null;
}

const oneOf = <T extends string>(set: readonly T[], raw: unknown): T | null => {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (set as readonly string[]).includes(v) ? v as T : null;
};

export const asTransaction = (raw: unknown) => oneOf(MARKETPLACE_TRANSACTIONS, raw);
export const asPropertyType = (raw: unknown) => oneOf(MARKETPLACE_PROPERTY_TYPES, raw);
export const asBuildingStatus = (raw: unknown) => oneOf(BUILDING_STATUSES, raw);
export const asRenovationStatus = (raw: unknown) => oneOf(RENOVATION_STATUSES, raw);
export const asAmenity = (raw: unknown) => oneOf(AMENITIES, raw);
export const asFloorPreference = (raw: unknown) => oneOf(FLOOR_PREFERENCES, raw);
