// THE AI READS THE SENTENCE. THIS DECIDES WHAT THE SEARCH IS.
//
// A customer says "2 bedrooms in Vake or Saburtalo, up to 150k, ideally a balcony,
// I'm flexible on the floor" and something has to turn that into a search. A model is
// genuinely the right tool for the reading: six languages, free prose, and a hundred
// ways to say the same requirement.
//
// It is the wrong tool for everything after the reading, and this module is the line.
//
// WHAT THE MODEL IS ALLOWED TO DO
//
// Produce a draft of ONE FIXED SHAPE, and nothing else. It cannot introduce a field,
// cannot widen a vocabulary, cannot express a rule and cannot emit anything that gets
// executed. Its output arrives here as untrusted text and leaves as a `SearchPlan` in
// which every value came out of a closed set — or is absent, which is a real answer.
//
// THAT IS THE WHOLE SAFETY ARGUMENT, so it is worth being precise about it. The danger
// is not a model that hallucinates a district; a wrong district is visible and the
// customer corrects it. The danger is a plan that carries something the rest of the
// system then treats as instruction — a city string that reaches a query, a currency
// that reaches arithmetic, a "strength" that reaches the matcher having never been one
// of the four strengths. `normalisePlan()` is where every one of those is either
// recognised or discarded, and `rejected` names what was thrown away so the interface
// can tell the customer rather than silently narrowing their search.
//
// AND WHAT THE CUSTOMER IS ALLOWED TO DO: everything. The plan is shown before it runs
// and every field is editable, because the model's reading of somebody's requirements
// is a suggestion about their own life and they are the authority on it. What executes
// is the plan they confirmed, not the draft that was proposed.
//
// WHY THE STRENGTHS ARE THE MATCHER'S OWN
//
// REQUIRED / PREFERRED / FLEXIBLE / UNKNOWN are imported from compatibility.ts rather
// than redeclared. "Must be in Vake" and "ideally Vake" are different searches, and a
// plan vocabulary that did not distinguish them would flatten the distinction on the
// way in — before the matcher that exists to honour it ever saw the difference.

import {
  type ConstraintStrength,
  CONSTRAINT_STRENGTHS,
} from '../match/compatibility.ts';
import { type DealKind, dealKindFrom } from '../match/participants.ts';
import { foldCase } from '../normalize/script-case.ts';

/* ------------------------------------------------------------------ *
 * The fixed shape                                                    *
 * ------------------------------------------------------------------ */

/** What the customer is trying to do. The demand side of DealKind. */
export type SearchGoal = 'BUY' | 'RENT' | 'SHORT_STAY' | 'INVEST' | 'COMMERCIAL' | 'LAND';

export const SEARCH_GOALS: readonly SearchGoal[] = [
  'BUY', 'RENT', 'SHORT_STAY', 'INVEST', 'COMMERCIAL', 'LAND',
];

/**
 * The property classes a plan may name.
 *
 * Deliberately the same coarse set propertyClass() compares in, because a plan that
 * could say FLAT while the matcher only understands APARTMENT would produce a
 * conflict on every single result and look like a matching bug.
 */
export type PlanPropertyType =
  | 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'OFFICE' | 'HOTEL' | 'OTHER';

export const PLAN_PROPERTY_TYPES: readonly PlanPropertyType[] = [
  'APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL', 'OFFICE', 'HOTEL', 'OTHER',
];

/** The currencies this market actually quotes in. */
export const PLAN_CURRENCIES: readonly string[] = ['USD', 'GEL', 'EUR'];

/**
 * One requirement, with how strongly it is held.
 *
 * `strength` is the point of this type. A budget ceiling that is REQUIRED disqualifies;
 * the same number PREFERRED ranks down and says so. Storing the two identically is how
 * a product either rejects good results or ignores stated limits.
 */
export interface PlanConstraint<T> {
  value: T;
  strength: ConstraintStrength;
}

export interface SearchPlan {
  goal: SearchGoal;
  /** The deal kind the matcher will compare in. Derived, never taken from the model. */
  deal: DealKind;
  countryCode: string;
  city: PlanConstraint<string> | null;
  /** More than one is normal: "Vake or Saburtalo" is one search, not two. */
  districts: PlanConstraint<string[]> | null;
  propertyTypes: PlanConstraint<PlanPropertyType[]> | null;
  budget: PlanConstraint<{ min: number | null; max: number | null; currency: string }> | null;
  bedrooms: PlanConstraint<{ min: number | null; max: number | null }> | null;
  areaSqm: PlanConstraint<{ min: number | null; max: number | null }> | null;
  /** The languages to search in. Empty means "whatever the sources are in". */
  languages: string[];
  /** The customer's own words, kept verbatim. The plan is a reading of this. */
  originalText: string;
  /** Which language the original was written in, when it could be told. */
  originalLanguage: string | null;
}

/* ------------------------------------------------------------------ *
 * Normalising an untrusted draft                                     *
 * ------------------------------------------------------------------ */

export interface PlanDraft {
  goal?: unknown;
  countryCode?: unknown;
  city?: unknown;
  cityStrength?: unknown;
  districts?: unknown;
  districtsStrength?: unknown;
  propertyTypes?: unknown;
  propertyTypesStrength?: unknown;
  budgetMin?: unknown;
  budgetMax?: unknown;
  currency?: unknown;
  budgetStrength?: unknown;
  bedroomsMin?: unknown;
  bedroomsMax?: unknown;
  bedroomsStrength?: unknown;
  areaMin?: unknown;
  areaMax?: unknown;
  areaStrength?: unknown;
  languages?: unknown;
  originalText?: unknown;
  originalLanguage?: unknown;
}

export interface NormalisedPlan {
  plan: SearchPlan | null;
  /**
   * What was discarded and why, in plain words.
   *
   * Returned rather than logged, because a silently narrowed search is the worst
   * outcome here: the customer said something, it was dropped, and they are shown
   * results for a question they did not ask. The interface surfaces these.
   */
  rejected: string[];
}

/**
 * A scalar, or nothing. The first gate every untrusted field passes through.
 *
 * `String()` is far too accommodating to be a type check. `String(['BUY'])` is `'BUY'`,
 * so an array containing a goal read as that goal while an array containing two read as
 * neither -- a model emitting `{"goal": ["BUY"]}` was silently accepted and
 * `{"goal": ["BUY","RENT"]}` silently dropped, which is two different behaviours for one
 * mistake. `String({})` is `'[object Object]'`, and `String(['Tbilisi'])` is a perfectly
 * well-formed city name that nobody typed.
 *
 * So a field is a string, a number or a boolean, or it is not a value.
 */
const scalarText = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const kind = typeof raw;
  if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') return null;
  return String(raw);
};

const strengthOf = (raw: unknown, fallback: ConstraintStrength): ConstraintStrength => {
  const text = String(raw ?? '').trim().toUpperCase();
  return (CONSTRAINT_STRENGTHS as readonly string[]).includes(text)
    ? text as ConstraintStrength
    : fallback;
};

/** A finite positive number, or null. Never NaN, never Infinity, never negative. */
const amountOf = (raw: unknown): number | null => {
  const scalar = scalarText(raw);
  if (scalar === null || scalar === '') return null;
  const value = Number(scalar);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const intOf = (raw: unknown): number | null => {
  const value = amountOf(raw);
  return value === null ? null : Math.trunc(value);
};

/** A short, single-line, length-capped place name. Not a query and not a sentence. */
const placeOf = (raw: unknown): string | null => {
  const scalar = scalarText(raw);
  if (scalar === null) return null;
  const text = scalar.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text || text.length > 60) return null;
  /*
   * A NAME, NOT AN EXPRESSION. A "city" carrying a comma, a quote, a percent sign or a
   * SQL or PostgREST operator is not a city -- it is something trying to be read as
   * more than a name by whatever receives it, and the correct response to that is to
   * discard it rather than to escape it and hope.
   */
  if (/[,;()'"`%*=<>|&{}[\]\\]|\bor\b|\band\b/i.test(text)) return null;
  return text;
};

const GOAL_FROM: Readonly<Record<string, SearchGoal>> = {
  BUY: 'BUY', PURCHASE: 'BUY', SALE: 'BUY',
  RENT: 'RENT', LEASE: 'RENT', TENANT: 'RENT',
  SHORT_STAY: 'SHORT_STAY', SHORTSTAY: 'SHORT_STAY', DAILY: 'SHORT_STAY', NIGHTLY: 'SHORT_STAY',
  INVEST: 'INVEST', INVESTMENT: 'INVEST',
  COMMERCIAL: 'COMMERCIAL', OFFICE: 'COMMERCIAL', RETAIL: 'COMMERCIAL',
  LAND: 'LAND', PLOT: 'LAND',
};

/**
 * The deal kind a goal transacts in.
 *
 * Routed through dealKindFrom() where it can be, so this table cannot drift from the
 * matcher's own reading. SHORT_STAY and INVEST are stated here because they are goals
 * rather than transaction verbs and dealKindFrom has nothing to read them from.
 */
function dealFor(goal: SearchGoal): DealKind {
  switch (goal) {
    case 'BUY': return dealKindFrom({ transaction: 'SALE' }) ?? 'SALE';
    case 'RENT': return dealKindFrom({ transaction: 'RENT' }) ?? 'RENT';
    case 'SHORT_STAY': return 'SHORT_STAY';
    case 'INVEST': return 'INVESTMENT';
    case 'COMMERCIAL': return 'COMMERCIAL';
    case 'LAND': return 'LAND';
  }
}

/** The intent_type enum value production stores for this goal. */
export function intentTypeFor(goal: SearchGoal): string {
  switch (goal) {
    case 'RENT': return 'RENT';
    case 'SHORT_STAY': return 'RENT';
    case 'INVEST': return 'INVEST';
    /* BUY, COMMERCIAL and LAND are all purchases; the property type carries the rest. */
    default: return 'BUY';
  }
}

const LANGUAGES: readonly string[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he'];

/**
 * Turn an untrusted draft into a plan, or into nothing with reasons.
 *
 * Pure and total: any input at all produces a result, and the only way a value
 * survives is by being recognised. Unrecognised values are DROPPED rather than
 * corrected — a mis-corrected requirement is worse than a missing one, because the
 * customer cannot see that it happened.
 */
export function normalisePlan(draft: PlanDraft): NormalisedPlan {
  const rejected: string[] = [];

  const goalText = foldCase(scalarText(draft.goal)).replace(/[\s-]+/g, '_');
  const goal = GOAL_FROM[goalText] ?? null;
  if (!goal) {
    /*
     * WITHOUT A GOAL THERE IS NO SEARCH. Not defaulted to BUY: guessing that somebody
     * wants to buy when they said something we could not read is how a renter is shown
     * sale listings and told it is what they asked for.
     */
    return {
      plan: null,
      rejected: [`goal ${JSON.stringify(String(draft.goal ?? ''))} is not one of ${SEARCH_GOALS.join(', ')}`],
    };
  }

  const countryRaw = String(draft.countryCode ?? 'GE').trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : 'GE';
  if (countryCode !== countryRaw) {
    rejected.push(`country ${JSON.stringify(countryRaw)} is not a two-letter code; using GE`);
  }

  /* ── city ── */
  let city: SearchPlan['city'] = null;
  if (draft.city !== null && draft.city !== undefined && String(draft.city).trim() !== '') {
    const name = placeOf(draft.city);
    if (name) city = { value: name, strength: strengthOf(draft.cityStrength, 'REQUIRED') };
    else rejected.push(`city ${JSON.stringify(String(draft.city))} is not a place name`);
  }

  /* ── districts ── */
  let districts: SearchPlan['districts'] = null;
  const districtList = Array.isArray(draft.districts) ? draft.districts : [];
  if (districtList.length) {
    const names: string[] = [];
    for (const entry of districtList.slice(0, 8)) {
      const name = placeOf(entry);
      if (name) names.push(name);
      else rejected.push(`district ${JSON.stringify(String(entry))} is not a place name`);
    }
    if (names.length) {
      /*
       * PREFERRED by default, and this is a product judgement worth stating. Somebody
       * who names two districts is usually describing where they would like to be, not
       * refusing every street outside them -- and a REQUIRED default would silently
       * hide a better flat one block over. They can make it REQUIRED, deliberately.
       */
      districts = { value: names, strength: strengthOf(draft.districtsStrength, 'PREFERRED') };
    }
  }

  /* ── property types ── */
  let propertyTypes: SearchPlan['propertyTypes'] = null;
  const typeList = Array.isArray(draft.propertyTypes) ? draft.propertyTypes : [];
  if (typeList.length) {
    const kinds: PlanPropertyType[] = [];
    for (const entry of typeList.slice(0, 7)) {
      const text = foldCase(scalarText(entry));
      const kind = (PLAN_PROPERTY_TYPES as readonly string[]).includes(text)
        ? text as PlanPropertyType
        : null;
      if (kind && !kinds.includes(kind)) kinds.push(kind);
      else if (!kind) rejected.push(`property type ${JSON.stringify(String(entry))} is not recognised`);
    }
    if (kinds.length) {
      propertyTypes = { value: kinds, strength: strengthOf(draft.propertyTypesStrength, 'REQUIRED') };
    }
  }

  /* ── budget ── */
  let budget: SearchPlan['budget'] = null;
  const min = amountOf(draft.budgetMin);
  const max = amountOf(draft.budgetMax);
  if (min !== null || max !== null) {
    const currencyRaw = String(draft.currency ?? 'USD').trim().toUpperCase();
    const currency = PLAN_CURRENCIES.includes(currencyRaw) ? currencyRaw : 'USD';
    if (currency !== currencyRaw) {
      rejected.push(`currency ${JSON.stringify(currencyRaw)} is not quoted in this market; using USD`);
    }
    /*
     * A RANGE THAT RUNS BACKWARDS IS NOT A RANGE. Swapped rather than dropped, because
     * "150k to 100k" is unambiguous about what the customer meant, and stated in
     * `rejected` so the swap is visible rather than quietly assumed.
     */
    if (min !== null && max !== null && min > max) {
      rejected.push(`budget ${min}-${max} runs backwards; read as ${max}-${min}`);
      budget = {
        value: { min: max, max: min, currency },
        strength: strengthOf(draft.budgetStrength, 'REQUIRED'),
      };
    } else {
      budget = { value: { min, max, currency }, strength: strengthOf(draft.budgetStrength, 'REQUIRED') };
    }
  }

  /* ── bedrooms ── */
  let bedrooms: SearchPlan['bedrooms'] = null;
  const bedMin = intOf(draft.bedroomsMin);
  const bedMax = intOf(draft.bedroomsMax);
  if (bedMin !== null || bedMax !== null) {
    const lo = bedMin !== null && bedMax !== null ? Math.min(bedMin, bedMax) : bedMin;
    const hi = bedMin !== null && bedMax !== null ? Math.max(bedMin, bedMax) : bedMax;
    bedrooms = { value: { min: lo, max: hi }, strength: strengthOf(draft.bedroomsStrength, 'PREFERRED') };
  }

  /* ── area ── */
  let areaSqm: SearchPlan['areaSqm'] = null;
  const areaMin = amountOf(draft.areaMin);
  const areaMax = amountOf(draft.areaMax);
  if (areaMin !== null || areaMax !== null) {
    const lo = areaMin !== null && areaMax !== null ? Math.min(areaMin, areaMax) : areaMin;
    const hi = areaMin !== null && areaMax !== null ? Math.max(areaMin, areaMax) : areaMax;
    areaSqm = { value: { min: lo, max: hi }, strength: strengthOf(draft.areaStrength, 'PREFERRED') };
  }

  /* ── languages ── */
  const languages: string[] = [];
  for (const entry of Array.isArray(draft.languages) ? draft.languages.slice(0, 6) : []) {
    const code = (scalarText(entry) ?? '').trim().toLowerCase();
    if (LANGUAGES.includes(code) && !languages.includes(code)) languages.push(code);
    else if (!LANGUAGES.includes(code)) rejected.push(`language ${JSON.stringify(code)} is not supported`);
  }

  const originalText = String(draft.originalText ?? '').slice(0, 4000);
  const originalLanguageRaw = String(draft.originalLanguage ?? '').trim().toLowerCase();
  const originalLanguage = LANGUAGES.includes(originalLanguageRaw) ? originalLanguageRaw : null;

  return {
    plan: {
      goal,
      deal: dealFor(goal),
      countryCode,
      city,
      districts,
      propertyTypes,
      budget,
      bedrooms,
      areaSqm,
      languages,
      originalText,
      originalLanguage,
    },
    rejected,
  };
}

/* ------------------------------------------------------------------ *
 * Is it enough to search on?                                         *
 * ------------------------------------------------------------------ */

export interface PlanReadiness {
  ready: boolean;
  /** i18n keys for what is still needed. Keys, not sentences: six languages. */
  missingKeys: string[];
}

/**
 * Whether this plan describes a search rather than a wish.
 *
 * A goal and a place is the floor. Not because the matcher cannot run without a
 * budget -- it can, and UNKNOWN is handled honestly at every dimension -- but because
 * a search with no location returns the whole market, and a customer shown the whole
 * market has been given a directory instead of an answer.
 */
export function planReadiness(plan: SearchPlan | null): PlanReadiness {
  if (!plan) return { ready: false, missingKeys: ['plan_missing_goal'] };
  const missingKeys: string[] = [];
  if (!plan.city && !(plan.districts?.value.length)) missingKeys.push('plan_missing_location');
  return { ready: missingKeys.length === 0, missingKeys };
}

/* ------------------------------------------------------------------ *
 * The row the matcher reads                                          *
 * ------------------------------------------------------------------ */

/**
 * The `intent_profiles` row this plan becomes.
 *
 * ONE VOCABULARY, WRITTEN ONCE. supply-matching reads intent_profiles and knows
 * nothing about plans; a customer-authored search and a discovered forum post have to
 * arrive at the matcher in the same shape or the reverse direction acquires a second
 * definition of what a demand is.
 *
 * `signal_id` is deliberately absent: there is no signal. Nobody posted this
 * anywhere -- the customer told us directly, which is a better provenance than a
 * scraped post and must not be dressed up as one.
 */
export function planToIntentProfile(plan: SearchPlan, options: {
  language: string | null;
}): Record<string, unknown> {
  return {
    intent_type: intentTypeFor(plan.goal),
    country: plan.countryCode,
    city: plan.city?.value ?? null,
    district: plan.districts?.value[0] ?? null,
    neighborhoods: plan.districts?.value ?? null,
    transaction_type: plan.deal === 'INVESTMENT' ? 'SALE' : plan.deal,
    property_types: plan.propertyTypes?.value ?? null,
    bedrooms_min: plan.bedrooms?.value.min ?? null,
    bedrooms_max: plan.bedrooms?.value.max ?? null,
    area_min: plan.areaSqm?.value.min ?? null,
    area_max: plan.areaSqm?.value.max ?? null,
    budget_min: plan.budget?.value.min ?? null,
    budget_max: plan.budget?.value.max ?? null,
    currency: plan.budget?.value.currency ?? null,
    investment_intent: plan.goal === 'INVEST',
    relocation_intent: false,
    language: options.language ?? plan.originalLanguage,
    /*
     * CONFIDENCE IS 1, AND IT IS THE ONE PLACE THAT IS HONEST.
     *
     * Every other intent_profile row carries a classifier's confidence that it read a
     * stranger's post correctly. This row was written by the person whose requirements
     * they are, from a plan they were shown and confirmed. There is no inference to be
     * uncertain about.
     */
    intent_confidence: 1,
    original_text: plan.originalText || null,
    classifier_version: 'search-plan-1.0.0',
  };
}
