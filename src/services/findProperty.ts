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

/** One discarded thing, in a form the interface can say in six languages. */
export interface PlanRejection {
  key: string;
  value: string;
}

export interface PlanResponse {
  success: boolean;
  /** Whether the model actually read the text. False is a real, displayable state. */
  interpreted: boolean;
  note: string | null;
  plan: SearchPlan | null;
  /** What the server discarded from the draft, in plain words. English, for operators. */
  rejected: string[];
  /**
   * The same discards, as an i18n key and the customer's own value.
   *
   * Optional because a production server that has not been redeployed yet sends only
   * `rejected`, and a customer on that build must still be told what was dropped.
   */
  rejections?: PlanRejection[];
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
  /** The search (intent) this result answers. */
  intentId?: string | null;
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
  /**
   * Where the result came from, as the source provided it: the exact post or
   * listing, its channel / board / site, the author, and the post as written.
   * Every field is null when the source did not give it; links are server-validated.
   */
  attribution?: SourceAttribution | null;
  supply?: { role: string | null; broker: BrokerDisclosure | null };
}

export interface SourceAttribution {
  platform: string;
  sourceName: string | null;
  sourceUrl: string | null;
  threadUrl: string | null;
  permalink: string | null;
  authorName: string | null;
  authorUrl: string | null;
  originalText: string | null;
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
export async function confirmPlan(
  plan: SearchPlan,
  options?: {
    /*
     * The customer's explicit broker/agency discovery opt-in. Travels beside
     * the plan rather than inside it: it is an execution choice, and the
     * server stores it on the subscription while the plan stays a plan.
     */
    discoverBrokers?: boolean;
  },
): Promise<PlanResponse> {
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
      ...(options?.discoverBrokers === true ? { discoverBrokers: true } : {}),
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
export async function readResults(limit = 20, subscriptionId?: string): Promise<ResultsResponse> {
  const { data, error } = await supabase.functions.invoke('find-property', {
    body: subscriptionId ? { limit, subscriptionId } : { limit },
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

// ── PHASE 2: searching OUTSIDE HOMATCH (find-property-run) ────────────────
//
// A paid, budgeted run that searches live sources for listings that fit the
// confirmed search. The run's state is read from the server every time, so
// it survives a refresh, a second tab and a logout. The client never decides
// a price: the budget is the customer's ceiling, settlement is the server's.

export type OutsideRunStatus =
  | 'QUEUED' | 'SEARCHING' | 'PAUSED' | 'MATCHING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | 'BUDGET_REACHED';

export interface OutsideRun {
  id: string;
  status: OutsideRunStatus;
  stage: string;
  progress: number;
  resultsFound: number;
  creditsCharged: number | null;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

export const OPEN_OUTSIDE_RUN: readonly OutsideRunStatus[] = ['QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING'];

/** The customer's current Find Property search, if they have one. */
export async function latestSupplySearchId(): Promise<string | null> {
  const { data } = await supabase
    .from('active_search_subscriptions')
    .select('id')
    .eq('side', 'SUPPLY')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function latestOutsideRun(subscriptionId: string): Promise<OutsideRun | null> {
  const { data } = await supabase
    .from('discovery_runs')
    .select('id,status,stage,progress,results_found,credits_charged,failure_reason,started_at,completed_at')
    .eq('subscription_id', subscriptionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    status: data.status as OutsideRunStatus,
    stage: String(data.stage ?? ''),
    progress: Number(data.progress ?? 0),
    resultsFound: Number(data.results_found ?? 0),
    creditsCharged: data.credits_charged == null ? null : Number(data.credits_charged),
    failureReason: data.failure_reason ? String(data.failure_reason) : null,
    startedAt: String(data.started_at),
    completedAt: data.completed_at ? String(data.completed_at) : null,
  };
}

/** Customer-safe source activity: finished jobs per source group, never a provider name. */
export async function outsideRunActivity(runId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('discovery_run_events')
    .select('kind,payload')
    .eq('run_id', runId)
    .eq('kind', 'SOURCE_JOB_FINISHED')
    .order('id', { ascending: true })
    .limit(200);
  const groups: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ payload: { sourceGroup?: string } }>) {
    const group = String(row.payload?.sourceGroup ?? 'HOMATCH');
    groups[group] = (groups[group] ?? 0) + 1;
  }
  return groups;
}

export async function startOutsideSearch(
  subscriptionId: string,
  authorizedMaxCredits: number | null,
  idempotencyKey: string,
): Promise<{ runId: string | null; reasonCode: string | null }> {
  const { data, error } = await supabase.functions.invoke('find-property-run', {
    body: { action: 'start', subscriptionId, authorizedMaxCredits, idempotencyKey },
  });
  if (error) {
    /* The function answers refusals with a reasonCode; surface it, never a raw error. */
    const context = (error as { context?: Response }).context;
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null;
    return { runId: null, reasonCode: String(body?.reasonCode ?? 'START_FAILED') };
  }
  return { runId: data?.runId ? String(data.runId) : null, reasonCode: data?.reasonCode ?? null };
}

export async function controlOutsideRun(runId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
  const { data, error } = await supabase.functions.invoke('find-property-run', { body: { action, runId } });
  if (error || !data?.success) throw new Error(`Could not ${action} the search`);
}
