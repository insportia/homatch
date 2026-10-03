// HOMATCH MARKETPLACE SEARCH — the Search Readiness Gate.
//
// A search does not execute until the information it needs exists. The gate is
// the SAME function on both sides: the interface uses it to decide which one
// small question to ask next, and `marketplace-search` runs it again on the
// server and refuses `start` unless it says READY. Client state alone is never
// enough.
//
// What is required depends on what is being searched for. Land has no
// bedrooms; an office has no building-status question; a daily rental is not
// searched by floor area. The rules below are by property class, not one
// residential form forced onto everything.

import {
  type MarketplacePropertyType, type MarketplaceTransaction, propertyClassOf,
} from './taxonomy.ts';
import type { BriefField, NumericRange, SearchIntelligenceBrief } from './brief.ts';

export type RequirementKey =
  | 'transactionType' | 'propertyType' | 'location' | 'price' | 'area' | 'rooms' | 'bedrooms' | 'buildingStatus';

/** The order questions are asked in: the cheapest, most clarifying first. */
export const REQUIREMENT_ORDER: readonly RequirementKey[] = [
  'transactionType', 'propertyType', 'location', 'price', 'area', 'rooms', 'bedrooms', 'buildingStatus',
];

export type ReadinessState = 'INCOMPLETE' | 'READY';

export interface Readiness {
  state: ReadinessState;
  /** Required and not stated at all. */
  missing: RequirementKey[];
  /** Required, holding a PROPOSED value the customer has not confirmed. */
  unconfirmed: RequirementKey[];
  /** Required, present, but not usable (e.g. a price range with only a maximum). */
  invalid: RequirementKey[];
  /** The one thing to ask next, or null when READY. */
  nextQuestion: RequirementKey | null;
  /** Everything this property type requires, in question order. */
  required: RequirementKey[];
}

/**
 * Requirements for a transaction and property type. Until both are known only
 * the universal requirements apply; the rest appear once the type is known.
 */
export function requirementsFor(
  transaction: MarketplaceTransaction | null,
  type: MarketplacePropertyType | null,
): RequirementKey[] {
  const req: RequirementKey[] = ['transactionType', 'propertyType', 'location', 'price'];
  if (!type) return req;
  const cls = propertyClassOf(type);
  const daily = transaction === 'DAILY_RENT';
  /* Area matters for everything except a nightly stay and the catch-all OTHER. */
  if (!daily && cls !== 'OTHER') req.push('area');
  if (cls === 'RESIDENTIAL_UNIT' || cls === 'RESIDENTIAL_HOUSE') req.push('rooms', 'bedrooms');
  /* Building status is a purchase question about flats: new, old or under construction. */
  if (cls === 'RESIDENTIAL_UNIT' && transaction === 'BUY') req.push('buildingStatus');
  if (cls === 'STUDIO' && transaction === 'BUY') req.push('buildingStatus');
  return REQUIREMENT_ORDER.filter((k) => req.includes(k));
}

type Check = 'OK' | 'MISSING' | 'UNCONFIRMED' | 'INVALID';

const usable = (s: BriefField<unknown>['status']) => s === 'STATED' || s === 'CONFIRMED';

function fieldCheck<T>(f: BriefField<T> | null, valid: (v: T) => boolean): Check {
  if (!f) return 'MISSING';
  if (!usable(f.status)) return 'UNCONFIRMED';
  return valid(f.value) ? 'OK' : 'INVALID';
}

/** A closed range: both ends, in order, a positive top. A minimum of 0 is a real answer. */
const closedRange = (r: NumericRange) => r.min !== null && r.max !== null && r.min <= r.max && r.max > 0;
/** A count: at least one end stated. */
const countRange = (r: NumericRange) => r.min !== null || r.max !== null;

function check(brief: SearchIntelligenceBrief, key: RequirementKey): Check {
  switch (key) {
    case 'transactionType': return fieldCheck(brief.transactionType, () => true);
    case 'propertyType': return fieldCheck(brief.propertyType, () => true);
    case 'location': {
      /* An executable market needs a city; districts alone imply one only when the brief resolved it. */
      return fieldCheck(brief.city, (c) => c.trim().length > 0);
    }
    case 'price': return fieldCheck(brief.price, closedRange);
    case 'area': return fieldCheck(brief.area, closedRange);
    case 'rooms': return fieldCheck(brief.rooms, countRange);
    case 'bedrooms': return fieldCheck(brief.bedrooms, countRange);
    case 'buildingStatus': return fieldCheck(brief.buildingStatuses, (l) => l.length > 0);
  }
}

export function evaluateReadiness(brief: SearchIntelligenceBrief): Readiness {
  const transaction = brief.transactionType && usable(brief.transactionType.status) ? brief.transactionType.value : null;
  const type = brief.propertyType && usable(brief.propertyType.status) ? brief.propertyType.value : null;
  const required = requirementsFor(transaction, type);
  const missing: RequirementKey[] = [];
  const unconfirmed: RequirementKey[] = [];
  const invalid: RequirementKey[] = [];
  for (const key of required) {
    const c = check(brief, key);
    if (c === 'MISSING') missing.push(key);
    else if (c === 'UNCONFIRMED') unconfirmed.push(key);
    else if (c === 'INVALID') invalid.push(key);
  }
  const open = required.filter((k) => missing.includes(k) || unconfirmed.includes(k) || invalid.includes(k));
  return {
    state: open.length === 0 ? 'READY' : 'INCOMPLETE',
    missing, unconfirmed, invalid,
    nextQuestion: open[0] ?? null,
    required,
  };
}
