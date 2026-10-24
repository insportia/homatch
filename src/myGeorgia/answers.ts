// MY GEORGIA BY HOMI — the five onboarding answers, as data.
//
// The questionnaire is owner-approved copy (2026-10-24); this module holds the
// shape behind it and nothing presentational: which step asks what, which
// question is conditional on which answer, when a step may continue, and how
// the answers feed the existing For Expats plan engine (roadmapFor) so the
// checklist on My Georgia is the same tested roadmap, not a second one.
//
// Stored on public.expat_profiles (migration 20261203091000). The personal
// note is owner-only: it goes to HOMI in the owner's own conversation and
// nowhere else, least of all Matching.

import type { ExpatIntent, ExpatProfile, HousingPlan } from '@/expats/types';

export const PROPERTY_INTENTS = ['BUY', 'RENT', 'INVEST', 'BROWSING'] as const;
export type PropertyIntent = (typeof PROPERTY_INTENTS)[number];

export const GEORGIA_CITIES = ['TBILISI', 'BATUMI', 'KUTAISI', 'ZUGDIDI', 'OTHER'] as const;
export type GeorgiaCity = (typeof GEORGIA_CITIES)[number];

export const BUDGET_BANDS = ['UP_TO_100K', 'FROM_100K_TO_200K', 'OVER_200K', 'UNDECIDED'] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

/** Monthly rent: the same bands in whichever currency the person thinks in. */
export const RENT_BANDS = ['UP_TO_500', 'FROM_500_TO_1000', 'FROM_1000_TO_2000', 'OVER_2000', 'CUSTOM', 'UNDECIDED'] as const;
export type RentBand = (typeof RENT_BANDS)[number];

export const RENT_CURRENCIES = ['USD', 'GEL', 'EUR'] as const;
export type RentCurrency = (typeof RENT_CURRENCIES)[number];

export const VISIT_STATUSES = ['FIRST_TIME', 'BEEN_BEFORE', 'LIVING_HERE'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const STAY_LENGTHS = ['WEEKS', 'M1_3', 'M3_12', 'LONG_TERM', 'UNDECIDED'] as const;
export type StayLength = (typeof STAY_LENGTHS)[number];

export const SUPPORT_TOPICS = [
  'HOUSING', 'BANKING', 'VISA', 'DOCUMENTS', 'TRANSPORT',
  'CONNECTIVITY', 'HEALTHCARE', 'EDUCATION', 'BUSINESS', 'TRAVEL',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const NOTES_MAX = 2000;
export const TOTAL_STEPS = 5;

export interface MyGeorgiaAnswers {
  firstName: string;
  lastName: string;
  /** ISO 3166-1 alpha-2: the country the person comes from. */
  country: string | null;
  propertyIntent: PropertyIntent | null;
  cities: GeorgiaCity[];
  budgetBand: BudgetBand | null;
  rentBand: RentBand | null;
  rentAmount: number | null;
  rentCurrency: RentCurrency;
  visitStatus: VisitStatus | null;
  /** ISO date, or null with arrivalUnknown. */
  arrivalDate: string | null;
  arrivalUnknown: boolean;
  stayLength: StayLength | null;
  supportTopics: SupportTopic[];
  notes: string;
}

export const EMPTY_ANSWERS: MyGeorgiaAnswers = {
  firstName: '',
  lastName: '',
  country: null,
  propertyIntent: null,
  cities: [],
  budgetBand: null,
  rentBand: null,
  rentAmount: null,
  rentCurrency: 'USD',
  visitStatus: null,
  arrivalDate: null,
  arrivalUnknown: false,
  stayLength: null,
  supportTopics: [],
  notes: '',
};

/** Rent asks for a monthly amount; buying and investing ask for a price band; browsing asks neither. */
export function budgetKind(intent: PropertyIntent | null): 'PURCHASE' | 'RENT' | null {
  if (intent === 'BUY' || intent === 'INVEST') return 'PURCHASE';
  if (intent === 'RENT') return 'RENT';
  return null;
}

/** Arrival is asked only of someone not already living here. */
export function asksArrival(visit: VisitStatus | null): boolean {
  return visit !== 'LIVING_HERE';
}

/**
 * Whether a step may continue. Only what the step cannot do without is
 * required; everything else is optional and the step can be skipped.
 *   1 · a first name (the email comes from the account)
 *   2 · a direction
 *   3 · nothing required
 *   4 · nothing required
 *   5 · nothing required
 */
export function stepComplete(step: number, a: MyGeorgiaAnswers): boolean {
  switch (step) {
    case 1: return a.firstName.trim().length > 0;
    case 2: return a.propertyIntent !== null
      && (a.propertyIntent !== 'RENT' || a.rentBand !== 'CUSTOM' || (a.rentAmount ?? 0) > 0);
    default: return true;
  }
}

/** A step with something optional left blank may be skipped; steps 1 and 2 may not. */
export function stepSkippable(step: number): boolean {
  return step >= 3;
}

/** Clear answers a later choice made irrelevant, so nothing stale is saved. */
export function normalise(a: MyGeorgiaAnswers): MyGeorgiaAnswers {
  const kind = budgetKind(a.propertyIntent);
  const notes = a.notes.slice(0, NOTES_MAX);
  return {
    ...a,
    firstName: a.firstName.slice(0, 80),
    lastName: a.lastName.slice(0, 80),
    cities: [...new Set(a.cities)].filter((c) => (GEORGIA_CITIES as readonly string[]).includes(c)),
    budgetBand: kind === 'PURCHASE' ? a.budgetBand : null,
    rentBand: kind === 'RENT' ? a.rentBand : null,
    rentAmount: kind === 'RENT' && a.rentBand === 'CUSTOM' ? a.rentAmount : null,
    arrivalDate: asksArrival(a.visitStatus) && !a.arrivalUnknown ? a.arrivalDate : null,
    arrivalUnknown: asksArrival(a.visitStatus) ? a.arrivalUnknown : false,
    supportTopics: [...new Set(a.supportTopics)].filter((s) => (SUPPORT_TOPICS as readonly string[]).includes(s)),
    notes,
  };
}

const CITY_NAME: Record<Exclude<GeorgiaCity, 'OTHER'>, string> = {
  TBILISI: 'Tbilisi', BATUMI: 'Batumi', KUTAISI: 'Kutaisi', ZUGDIDI: 'Zugdidi',
};

const STAY_MONTHS: Record<StayLength, number | null> = {
  WEEKS: 1, M1_3: 3, M3_12: 12, LONG_TERM: 36, UNDECIDED: null,
};

const HOUSING: Record<PropertyIntent, HousingPlan> = {
  BUY: 'BUY', INVEST: 'BUY', RENT: 'RENT', BROWSING: 'UNDECIDED',
};

/**
 * The answers as the plan engine's profile. No new question is invented to
 * fill a field the questionnaire does not ask (household, work): those stay
 * as they were.
 */
export function toPlanProfile(a: MyGeorgiaAnswers, base: ExpatProfile): ExpatProfile {
  const intents = new Set<ExpatIntent>(['MOVE', 'LIVE']);
  if (a.propertyIntent === 'BUY') intents.add('BUY');
  if (a.propertyIntent === 'INVEST') intents.add('INVEST');
  if (a.supportTopics.includes('BUSINESS')) intents.add('BUSINESS');
  if (a.supportTopics.includes('EDUCATION')) intents.add('FAMILY');
  const firstCity = a.cities.find((c): c is Exclude<GeorgiaCity, 'OTHER'> => c !== 'OTHER');
  return {
    ...base,
    intents: [...intents],
    nationality: a.country,
    arrivalDate: a.visitStatus === 'LIVING_HERE' ? (base.arrivalDate ?? null) : a.arrivalDate,
    intendedStayMonths: a.stayLength ? STAY_MONTHS[a.stayLength] : base.intendedStayMonths,
    city: firstCity ? CITY_NAME[firstCity] : base.city,
    housingPlan: a.propertyIntent ? HOUSING[a.propertyIntent] : base.housingPlan,
  };
}

/** The guide categories, ordered with what this person asked for first. */
export const GUIDE_CATEGORIES = [
  { key: 'LIVING', topics: ['cost-of-living'], support: [] as SupportTopic[] },
  { key: 'CITIES', topics: ['cities-and-neighbourhoods'], support: ['TRAVEL'] as SupportTopic[] },
  { key: 'TRANSPORT', topics: ['public-transport'], support: ['TRANSPORT'] as SupportTopic[] },
  { key: 'BANKING', topics: ['opening-a-bank-account'], support: ['BANKING'] as SupportTopic[] },
  { key: 'CONNECTIVITY', topics: ['mobile-and-internet'], support: ['CONNECTIVITY'] as SupportTopic[] },
  { key: 'HEALTH', topics: ['healthcare-and-insurance', 'health-and-safety'], support: ['HEALTHCARE'] as SupportTopic[] },
  { key: 'RENTING', topics: ['renting-a-home'], support: ['HOUSING'] as SupportTopic[] },
  { key: 'BUYING', topics: ['buying-property'], support: ['HOUSING'] as SupportTopic[] },
  { key: 'RESIDENCE', topics: ['entry-and-stay', 'residence-permits', 'documents-and-legalisation'], support: ['VISA', 'DOCUMENTS'] as SupportTopic[] },
  { key: 'BUSINESS', topics: ['starting-a-business', 'tax-residency'], support: ['BUSINESS'] as SupportTopic[] },
  { key: 'TRAVEL', topics: ['places-to-visit'], support: ['TRAVEL'] as SupportTopic[] },
  { key: 'TIPS', topics: ['everyday-tips'], support: ['EDUCATION'] as SupportTopic[] },
] as const;
export type GuideCategoryKey = (typeof GUIDE_CATEGORIES)[number]['key'];

export function orderedCategories(topics: readonly SupportTopic[], intent: PropertyIntent | null) {
  const wants = (c: (typeof GUIDE_CATEGORIES)[number]) =>
    c.support.some((s) => topics.includes(s))
    || (c.key === 'RENTING' && intent === 'RENT')
    || (c.key === 'BUYING' && (intent === 'BUY' || intent === 'INVEST'));
  return [...GUIDE_CATEGORIES].sort((x, y) => Number(wants(y)) - Number(wants(x)));
}
