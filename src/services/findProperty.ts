// FIND PROPERTY — the client side of the customer's own search.
//
// Three calls, and the separation between them is the product's:
//
//   planFromDescription  the model reads the prose and proposes. Nothing is saved.
//   confirmPlan          the plan the CUSTOMER approved becomes a real search.
//   readResults          what the deterministic matcher found.
//
// Nothing here scores, ranks, filters or re-sorts. The order results arrive in is the
// order the matcher recorded, and a screen that re-sorted them would be making a
// compatibility judgement that compatibility.ts makes once, in one place.

import { supabase } from '@/db/supabase';

/** The four strengths, and they are the matcher's own. */
export type ConstraintStrength = 'REQUIRED' | 'PREFERRED' | 'FLEXIBLE' | 'UNKNOWN';

export type SearchGoal = 'BUY' | 'RENT' | 'SHORT_STAY' | 'INVEST' | 'COMMERCIAL' | 'LAND';

export type PlanPropertyType =
  'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'OFFICE' | 'HOTEL' | 'OTHER';

export interface PlanConstraint<T> {
  value: T;
  strength: ConstraintStrength;
}

export interface SearchPlan {
  goal: SearchGoal;
  deal: string;
  countryCode: string;
  city: PlanConstraint<string> | null;
  districts: PlanConstraint<string[]> | null;
  propertyTypes: PlanConstraint<PlanPropertyType[]> | null;
  budget: PlanConstraint<{ min: number | null; max: number | null; currency: string }> | null;
  bedrooms: PlanConstraint<{ min: number | null; max: number | null }> | null;
  areaSqm: PlanConstraint<{ min: number | null; max: number | null }> | null;
  languages: string[];
  originalText: string;
  originalLanguage: string | null;
}

export interface PlanResponse {
  success: boolean;
  /** Whether the model actually read the text. False is a real, displayable state. */
  interpreted: boolean;
  note: string | null;
  plan: SearchPlan | null;
  /** What the server discarded from the draft, in plain words. */
  rejected: string[];
  readiness: { ready: boolean; missingKeys: string[] };
  persisted: boolean;
  charged: { credits: number };
  intentId?: string;
  subscriptionId?: string;
  state?: string;
  error?: string;
}

export interface BrokerDisclosure {
  id: string;
  role: string;
  name: string | null;
  provenance: {
    identifiedBy: string;
    seenOnSources: number;
    listingsAttributed: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastVerifiedAt: string | null;
    validationState: string;
  };
  coverage: { cities: string[]; languages: string[] };
  presentation: 'DIRECTORY_LISTING' | 'MARKET_INTELLIGENCE';
  labelKey: string;
  /** True only for a current paid registration. Nothing else may claim it. */
  registeredWithHomatch: boolean;
}

export interface FindPropertyResult {
  id: string;
  score: number;
  deal: string | null;
  roles: { demand: string | null; supply: string | null };
  whyThisMatches: string | null;
  agreed: string[] | null;
  preferenceMisses: string[] | null;
  notStated: string[] | null;
  flexible: string[] | null;
  freshness: {
    publishedAt: string | null;
    firstSeenAt: string | null;
    lastVerifiedAt: string | null;
    listingAgeCeilingDays: number | null;
    listingAgeCeilingBasis: string | null;
  };
  listing: {
    id: string;
    title: string | null;
    url: string | null;
    city: string | null;
    district: string | null;
    transaction: string | null;
    propertyType: string | null;
    areaSqm: number | null;
    rooms: number | null;
    bedrooms: number | null;
    price: { amount: number | null; currency: string | null };
    language: string | null;
    source: string | null;
  } | null;
  supply?: { role: string | null; broker: BrokerDisclosure | null };
}

export interface ResultsResponse {
  success: boolean;
  searches: number;
  results: FindPropertyResult[];
  /** NO_ACTIVE_SEARCH / SEARCHING / HAS_RESULTS. Three states, not two. */
  state: 'NO_ACTIVE_SEARCH' | 'SEARCHING' | 'HAS_RESULTS';
  note: string | null;
  included?: boolean;
  error?: string;
}

/**
 * Ask the model to read a description. Saves nothing and charges nothing.
 *
 * A failure comes back as a PlanResponse with `interpreted: false` rather than as a
 * thrown error, because "the model could not read it" is a state the interface has to
 * render -- the customer still has their text and can fill the plan in themselves.
 */
export async function planFromDescription(text: string): Promise<PlanResponse> {
  const { data, error } = await supabase.functions.invoke('find-property-plan', {
    body: { mode: 'draft', text },
  });
  if (error) {
    return {
      success: false,
      interpreted: false,
      note: 'request_failed',
      plan: null,
      rejected: [],
      readiness: { ready: false, missingKeys: [] },
      persisted: false,
      charged: { credits: 0 },
      error: error.message,
    };
  }
  return data as PlanResponse;
}

/** Turn the plan the customer approved into a real, running search. */
export async function confirmPlan(plan: SearchPlan): Promise<PlanResponse> {
  /*
   * THE PLAN IS SENT FLATTENED, in the same draft shape the server normalises. The
   * server re-normalises whatever arrives -- it does not trust this call any more than
   * it trusts the model -- so the flattening is a convenience and never a validation.
   */
  const body = {
    mode: 'confirm',
    plan: {
      goal: plan.goal,
      countryCode: plan.countryCode,
      city: plan.city?.value ?? null,
      cityStrength: plan.city?.strength,
      districts: plan.districts?.value ?? [],
      districtsStrength: plan.districts?.strength,
      propertyTypes: plan.propertyTypes?.value ?? [],
      propertyTypesStrength: plan.propertyTypes?.strength,
      budgetMin: plan.budget?.value.min ?? null,
      budgetMax: plan.budget?.value.max ?? null,
      currency: plan.budget?.value.currency,
      budgetStrength: plan.budget?.strength,
      bedroomsMin: plan.bedrooms?.value.min ?? null,
      bedroomsMax: plan.bedrooms?.value.max ?? null,
      bedroomsStrength: plan.bedrooms?.strength,
      areaMin: plan.areaSqm?.value.min ?? null,
      areaMax: plan.areaSqm?.value.max ?? null,
      areaStrength: plan.areaSqm?.strength,
      languages: plan.languages,
      originalText: plan.originalText,
      originalLanguage: plan.originalLanguage,
    },
  };
  const { data, error } = await supabase.functions.invoke('find-property-plan', { body });
  if (error) {
    return {
      success: false,
      interpreted: true,
      note: 'request_failed',
      plan,
      rejected: [],
      readiness: { ready: false, missingKeys: [] },
      persisted: false,
      charged: { credits: 0 },
      error: error.message,
    };
  }
  return data as PlanResponse;
}

/** Read what the matcher found. Costs nothing: these results are already paid for. */
export async function readResults(limit = 20): Promise<ResultsResponse> {
  const { data, error } = await supabase.functions.invoke('find-property', {
    body: { limit },
  });
  if (error) {
    return {
      success: false,
      searches: 0,
      results: [],
      state: 'NO_ACTIVE_SEARCH',
      note: null,
      error: error.message,
    };
  }
  return data as ResultsResponse;
}
