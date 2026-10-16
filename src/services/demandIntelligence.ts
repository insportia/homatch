/*
 * Demand Intelligence — typed doors to the admin_demand_* SQL functions
 * (20261107094700_admin_demand_intelligence.sql) and the customer's own
 * interest-history RPCs (20261107093700_property_interest_history.sql).
 * Every admin function checks is_admin() itself and audits profile views and
 * exports; nothing here is authorisation. Errors are thrown, never turned into
 * an empty list.
 */
import { supabase } from '@/db/supabase';
import { compactFilters } from '@/services/buyerIntelligence';

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export type DemandSide = 'BUY' | 'RENT' | 'SELL' | 'LET';
export type IntentBasis = 'EXPLICIT' | 'OBSERVED' | 'INFERRED';
export type Freshness = 'ACTIVE' | 'RECENT' | 'COOLING' | 'DORMANT' | 'WITHDRAWN';

export interface InterestStrength {
  score: number;
  basis: IntentBasis;
  freshness: Freshness;
  components: { stated: number; refined: number; viewed: number; saved: number; contacted: number; committed: number };
}

export interface DemandInterest {
  interest_key: string;
  side: DemandSide | null;
  city: string | null;
  property_type: string | null;
  budget_band: string;
  districts: string[];
  budget_min: number | null; budget_max: number | null; currency: string | null;
  bedrooms_min: number | null; bedrooms_max: number | null; rooms_min: number | null; rooms_max: number | null;
  area_min: number | null; area_max: number | null;
  explicit_events: number; observed_events: number; inferred_events: number;
  searches: number; declarations: number; preference_changes: number; views: number; saves: number;
  contacts: number; viewings: number; paid_campaigns: number; listings: number;
  withdrawn_at: string | null; first_seen_at: string; last_seen_at: string;
  strength?: InterestStrength;
  score?: number;
}

export interface InterestEvent {
  id: string;
  event_type: string;
  intent_basis: IntentBasis;
  side: DemandSide | null;
  property_id: string | null;
  listing_key: string | null;
  search_id: string | null;
  city: string | null;
  districts: string[];
  property_type: string | null;
  budget_min: number | null; budget_max: number | null; currency: string | null;
  source_host: string | null;
  surface: string;
  provenance: 'TRIGGER' | 'CLIENT' | 'BACKFILL';
  occurred_at: string;
}

export interface DemandCustomer {
  user_id: string; email: string | null; full_name: string | null; registered_at: string | null; last_seen_at: string | null;
  sides: DemandSide[] | null; cities: string[] | null; property_types: string[] | null;
  interests: number; top_strength: number | null; events: number;
  searches: number; views: number; saves: number; contacts: number; viewings: number; paid_campaigns: number; listings: number;
  explicit_events: number; observed_events: number; budget_min: number | null; budget_max: number | null;
  top_interest?: DemandInterest | null;
}

export interface DemandFilters {
  q?: string; side?: string; basis?: string; city?: string; district?: string; property_type?: string;
  budget_min?: string; budget_max?: string; rooms_min?: string; rooms_max?: string; area_min?: string; area_max?: string;
  active_days?: string; strength_min?: string; freshness?: string; frequency_min?: string;
  has_saved?: string; has_contacts?: string; has_paid?: string;
}

export const DEMAND_SORTS = ['last_seen_desc', 'strength_desc', 'events_desc', 'budget_desc', 'budget_asc', 'registered_desc', 'last_seen_asc'] as const;
export type DemandSort = typeof DEMAND_SORTS[number];

export async function listDemandCustomers(filters: DemandFilters, sort: DemandSort, limit: number, offset: number) {
  const data = await call<{ total?: number; rows?: DemandCustomer[] }>('admin_demand_customers', {
    p_filters: compactFilters(filters as Record<string, unknown>), p_sort: sort, p_limit: limit, p_offset: offset,
  });
  return { total: Number(data?.total ?? 0), rows: Array.isArray(data?.rows) ? data.rows : [] };
}

/** Every matching row, page by page (each page is audited server-side). */
export async function exportDemandCustomers(filters: DemandFilters): Promise<DemandCustomer[]> {
  const out: DemandCustomer[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await call<{ rows?: DemandCustomer[]; count?: number }>('admin_demand_export', {
      p_filters: compactFilters(filters as Record<string, unknown>), p_limit: 1000, p_offset: offset,
    });
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export interface MoneyRow {
  policy: string; campaigns: number; running: number;
  chargedUsd: number | null; providerSpendUsd: number | null; providerBudgetUsd: number | null; homatchProfitUsd: number | null;
}

export interface DemandAnalytics {
  windowDays: number;
  city: string | null;
  people: { buyers: number; tenants: number; sellers: number; landlords: number; explicit: number; observedOnly: number };
  byDistrict: Array<{ label: string; value: number }>;
  byCity: Array<{ label: string; value: number }>;
  byType: Array<{ label: string; value: number }>;
  byBudget: Array<{ label: string; value: number }>;
  trend: Array<{ week: string; buy: number; rent: number; sell: number; let: number }>;
  demandVsSupply: Array<{ label: string; demand: number; nativeSupply: number; portalSupply: number }>;
  searches: { free: number; freeCreditsCharged: number; paidFindProperty: number; findBuyersCampaigns: number };
  campaignEconomics: {
    policy: { id: string; providerShareBps: number; homatchShareBps: number };
    findBuyers: MoneyRow[] | null;
    findProperty: { runs: number; chargedUsd: number | null; providerSpendUsd: number | null; homatchProfitUsd: number | null } | null;
  };
}

export const getDemandAnalytics = (days: number, city: string | null) =>
  call<DemandAnalytics>('admin_demand_analytics', { p_days: days, p_city: city || null });

export interface DemandProfile {
  identity: { id: string; email: string | null; fullName: string | null; phone: string | null; language: string | null; registeredAt: string | null; suspendedAt: string | null };
  lastActivityAt: string | null;
  interests: DemandInterest[];
  timeline: InterestEvent[];
  eventsTotal: number;
  saved: Array<{ listing_key: string; property_id: string | null; snapshot: Record<string, unknown>; saved_at: string }>;
  contacts: Array<{ propertyId: string | null; at: string; kind: string | null }>;
  freeSearches: Array<{ id: string; status: string; at: string; properties: number | null; strong: number | null; city: string | null; transaction: string | null; propertyType: string | null }>;
  paidDiscovery: Array<{ id: string; status: string; at: string; credits: number | null; providerCostUsd: number | null; results: number | null }>;
  findBuyersCampaigns: Array<{ jobId: string; propertyId: string; at: string; credits: number; providerBudgetUsd: number; policy: string | null; finalizedAt: string | null }>;
  credits: { balance: number; reserved: number } | null;
  matches: { asSeeker: number; asOwner: number };
  listings: Array<{ id: string; homatchId: number | null; title: string | null; transaction: string | null; type: string | null; status: string | null }>;
  observedTracking: boolean;
}

export const getDemandProfile = (userId: string) =>
  call<DemandProfile>('admin_demand_customer_profile', { p_user_id: userId, p_event_limit: 200 });

/* ── The customer's own history ──────────────────────────────────────── */

export interface MyInterestHistory {
  events: InterestEvent[];
  interests: DemandInterest[];
  saved: Array<{ listing_key: string; property_id: string | null; snapshot: Record<string, unknown>; saved_at: string }>;
  observedTracking: boolean;
  retentionDays: number;
}

/* A malformed answer (a proxy, a stub, an older server) is an error, never a half-rendered panel. */
export async function getMyInterestHistory(limit = 100): Promise<MyInterestHistory> {
  const d = await call<Partial<MyInterestHistory> | null>('my_property_interest_history', { p_limit: limit, p_before: null });
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.events) || !Array.isArray(d.saved) || !Array.isArray(d.interests)) {
    throw new Error('UNEXPECTED_HISTORY_SHAPE');
  }
  return {
    events: d.events, interests: d.interests, saved: d.saved,
    observedTracking: d.observedTracking !== false, retentionDays: Number(d.retentionDays) || 730,
  };
}
export const setMyInterestTracking = (observed: boolean) => call<boolean>('set_my_interest_tracking', { p_observed: observed });
export const deleteMyInterestHistory = () => call<{ events: number; interests: number; saved: number }>('delete_my_property_interest_history');

export interface ListingSnapshot {
  title?: string | null; city?: string | null; district?: string | null; price?: number | null; currency?: string | null;
  transaction?: string | null; propertyType?: string | null; areaSqm?: number | null; rooms?: number | null;
  url?: string | null; sourceHost?: string | null; imageUrl?: string | null;
}

/**
 * A view, an opened result, a save or an unsave. Fire-and-forget for views (a
 * failed telemetry write must never break the page); saves report back.
 */
export async function recordListingInterest(
  eventType: 'VIEWED' | 'RESULT_OPENED' | 'SAVED' | 'UNSAVED',
  listingKey: string,
  opts: { propertyId?: string | null; searchId?: string | null; snapshot?: ListingSnapshot; surface?: string } = {},
): Promise<{ recorded: boolean; saved?: boolean; reason?: string }> {
  return call('record_my_property_interest', {
    p_event_type: eventType, p_listing_key: listingKey.slice(0, 300), p_property_id: opts.propertyId ?? null,
    p_search_id: opts.searchId ?? null, p_snapshot: opts.snapshot ?? {}, p_surface: opts.surface ?? 'find_property',
  });
}
