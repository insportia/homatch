/*
 * Buyer intelligence and market segmentation — typed doors to the admin_* SQL
 * functions in 20261024100000_market_segmentation.sql and
 * 20261024110000_buyer_intelligence.sql. Every one of them checks is_admin()
 * itself; nothing here is authorisation. Errors are thrown, never turned into
 * an empty list.
 */
import { supabase } from '@/db/supabase';

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

/** Drops empty values so an unset filter means "any". */
export function compactFilters(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export interface PagedResult<T> { rows: T[]; total: number; page: number; page_size: number }

/* A missing field is an empty answer, never a crash: the server always sends
   both, and anything else (a proxy, a stub) must still render honestly. */
function paged<T>(data: Partial<PagedResult<T>> | null | undefined): PagedResult<T> {
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total ?? 0),
    page: Number(data?.page ?? 1),
    page_size: Number(data?.page_size ?? 0),
  };
}

/* ── buyer intelligence ───────────────────────────────────────────── */

export type IntentLevel =
  | 'CASUAL_BROWSING' | 'EXPLORATORY' | 'REPEATED_INTEREST'
  | 'SAVED_REQUIREMENTS' | 'EXPLICIT_INTENT' | 'ACTIVE_SEARCH';
export const INTENT_LEVELS: IntentLevel[] = [
  'ACTIVE_SEARCH', 'EXPLICIT_INTENT', 'SAVED_REQUIREMENTS', 'REPEATED_INTEREST', 'EXPLORATORY', 'CASUAL_BROWSING',
];
export const INTENT_SOURCES = [
  'FIND_PROPERTY_PLAN', 'FIND_PROPERTY_MARKETPLACE', 'STATED_IN_CONVERSATION', 'SAVED_SEARCH',
  'BROKER_CLIENT_SEARCH', 'VIEWING_REQUEST', 'PROPERTY_ENQUIRY',
] as const;
export type IntentSource = typeof INTENT_SOURCES[number];

export interface BuyerSummary {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: 'BUYER' | 'TENANT' | 'BOTH';
  intent_level: IntentLevel;
  level_rank: number;
  sources: IntentSource[];
  source_count: number;
  latest_at: string | null;
  age_days: number | null;
  freshness: 'FRESH' | 'AGING' | 'OLD' | 'STALE' | 'ANCIENT' | 'UNDATED';
  stale: boolean;
  is_active: boolean;
  confidence: number | null;
  transactions: string[];
  property_types: string[];
  countries: string[];
  cities: string[];
  city_keys: string[];
  districts: string[];
  district_keys: string[];
  neighborhood_keys: string[];
  budget_min_usd: number | null;
  budget_max_usd: number | null;
  budget_confirmed: boolean;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  area_min: number | null;
  area_max: number | null;
  internal_matches: number;
  compatible_matches: number;
  best_match_score: number | null;
  segments: Array<'PREMIUM' | 'MIDDLE' | 'ECONOMY'>;
}

export interface BuyerEvidence {
  source: IntentSource;
  source_id: string;
  intent_level: IntentLevel;
  role: 'BUYER' | 'TENANT';
  is_active: boolean;
  on_behalf: boolean;
  confidence: number | null;
  observed_at: string | null;
  freshness: string;
  transaction: string | null;
  property_types: string[] | null;
  country: string | null;
  city: string | null;
  districts: string[] | null;
  neighborhoods: string[] | null;
  budget: { min: number | null; max: number | null; currency: string | null; min_usd: number | null; max_usd: number | null } | null;
  budget_confirmed: boolean;
  bedrooms: { min: number | null; max: number | null };
  rooms: { min: number | null; max: number | null };
  area: { min: number | null; max: number | null };
  property: { id: string; homatch_id: number | null } | null;
}

export interface BuyerDetail {
  summary: BuyerSummary | null;
  evidence: BuyerEvidence[];
  internal_matches: Array<{
    id: string; property_homatch_id: number | null; compatibility: string; score: number | null;
    deal_kind: string | null; agreed: string[] | null; conflicted: string[] | null;
    unknown_dimensions: string[] | null; created_at: string;
  }>;
}

export interface BuyerStats {
  people: number; buyers: number; tenants: number;
  eligible_buyers: number; eligible_tenants: number;
  strong: number; exploratory: number; stale: number; uncertain: number;
  budget_confirmed: number; budget_unknown: number;
  by_city: Array<{ city: string; count: number }>;
  by_district: Array<{ district: string; count: number }>;
  by_source: Record<string, number>;
  by_level: Record<string, number>;
  by_segment: Record<string, number>;
  budget_ranges: { sale: Record<string, number>; rent: Record<string, number> };
  internal_matches: { total: number; compatible: number; uncertain: number; stale: number };
  external_leads: { available: boolean; total: number | null; qualified: number | null; reason?: string };
}

export interface BuyerFilters {
  q?: string; role?: string; transaction?: string; status?: string; country?: string; city?: string;
  district?: string; neighborhood?: string; property_types?: string[]; segments?: string[];
  sources?: string[]; levels?: string[]; confidence?: string; match_strength?: string; budget?: string;
  strength?: string; origin?: string; currency?: string; recency_days?: string;
  min_price?: string; max_price?: string; min_bedrooms?: string; max_bedrooms?: string;
  min_area?: string; max_area?: string;
}

export const listBuyers = (f: BuyerFilters, sort: string, page: number, pageSize: number) =>
  call<Partial<PagedResult<BuyerSummary>>>('admin_buyer_intelligence_list', {
    p_filters: compactFilters(f as Record<string, unknown>), p_sort: sort, p_page: page, p_page_size: pageSize,
  }).then((d) => paged(d));

function normaliseStats(d: Partial<BuyerStats> | null | undefined): BuyerStats {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    people: n(d?.people), buyers: n(d?.buyers), tenants: n(d?.tenants),
    eligible_buyers: n(d?.eligible_buyers), eligible_tenants: n(d?.eligible_tenants),
    strong: n(d?.strong), exploratory: n(d?.exploratory), stale: n(d?.stale), uncertain: n(d?.uncertain),
    budget_confirmed: n(d?.budget_confirmed), budget_unknown: n(d?.budget_unknown),
    by_city: d?.by_city ?? [], by_district: d?.by_district ?? [],
    by_source: d?.by_source ?? {}, by_level: d?.by_level ?? {}, by_segment: d?.by_segment ?? {},
    budget_ranges: { sale: d?.budget_ranges?.sale ?? {}, rent: d?.budget_ranges?.rent ?? {} },
    internal_matches: {
      total: n(d?.internal_matches?.total), compatible: n(d?.internal_matches?.compatible),
      uncertain: n(d?.internal_matches?.uncertain), stale: n(d?.internal_matches?.stale),
    },
    external_leads: d?.external_leads ?? { available: false, total: null, qualified: null },
  };
}
export const getBuyerStats = (f: BuyerFilters) =>
  call<Partial<BuyerStats>>('admin_buyer_intelligence_stats', { p_filters: compactFilters(f as Record<string, unknown>) })
    .then((d) => normaliseStats(d));
export const getBuyerDetail = (userId: string) =>
  call<Partial<BuyerDetail>>('admin_buyer_intelligence_detail', { p_user_id: userId })
    .then((d): BuyerDetail => ({ summary: d?.summary ?? null, evidence: d?.evidence ?? [], internal_matches: d?.internal_matches ?? [] }));

/* ── market segmentation ──────────────────────────────────────────── */

export type Segment = 'PREMIUM' | 'MIDDLE' | 'ECONOMY' | 'UNKNOWN';
export const SEGMENTS: Segment[] = ['PREMIUM', 'MIDDLE', 'ECONOMY', 'UNKNOWN'];

export interface SegmentParams {
  minComparables: number;
  premiumPercentile: number;
  economyPercentile: number;
  levels: Array<'STREET' | 'NEIGHBORHOOD' | 'DISTRICT' | 'CITY'>;
  minAreaSqm: number;
}

export interface SegmentRule {
  id: string; version: number; params: SegmentParams; status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  note: string | null; created_at: string; activated_at: string | null; retired_at: string | null;
}

export interface SegmentAuditRow {
  id: string; rule_id: string | null; version: number | null;
  action: 'DRAFT_CREATED' | 'APPLIED' | 'RETIRED' | 'RECOMPUTED';
  actor: { id: string; email: string | null; full_name: string | null } | null;
  params: SegmentParams | null; before_counts: Record<string, number> | null;
  after_counts: Record<string, number> | null; changed_count: number | null; created_at: string;
}

export interface SegmentRulesView {
  rules: SegmentRule[];
  audit: SegmentAuditRow[];
  stored: Record<string, number> & { last_computed_at: string | null };
}

export interface SegmentPreview {
  params: SegmentParams;
  before: Record<string, number>;
  after: Record<string, number>;
  changed_count: number;
  changed: Array<{
    property_id: string; homatch_id: number | null; before: Segment | null; after: Segment;
    level: string | null; sample_size: number; confidence: number; reason: string;
  }>;
  confirmation_token: string;
}

export interface SegmentArea {
  level: 'CITY' | 'DISTRICT'; transaction: string; property_type: string; city: string; district: string | null;
  sample_size: number; sufficient: boolean; economy_max: number | null; median: number | null;
  premium_min: number | null; dispersion: number | null; no_fx_rate: number; confidence: number;
  sources: string[]; price_kind: 'ASKING'; currency: 'USD';
}

export interface LevelAttempt { level: string; key: string | null; sampleSize: number; sufficient: boolean }
export interface PropertySegmentRow {
  property_id: string; homatch_id: number | null; title: string | null;
  owner: { id: string; email: string | null; full_name: string | null } | null;
  transaction: string | null; property_type: string | null; country: string | null; city: string | null;
  district: string | null; neighborhood: string | null; street: string | null;
  price: number | null; currency: string | null; area: number | null; bedrooms: number | null; rooms: number | null;
  price_per_sqm: number | null; price_per_sqm_usd: number | null;
  segment: Segment | 'UNCOMPUTED'; confidence: number | null; confidence_band: string | null; level: string | null;
  sample_size: number | null; percentile: number | null; version: number | null; computed_at: string | null;
  basis: {
    reason?: string; levelsTried?: LevelAttempt[]; dispersion?: number | null; subjectPricePerSqmUsd?: number | null;
    thresholds?: { economyMax: number; premiumMin: number; median: number; currency: 'USD' } | null;
  } | null;
}

export interface PropertySegmentFilters {
  q?: string; segments?: string[]; confidence?: string[]; level?: string; country?: string; city?: string;
  district?: string; neighborhood?: string; street?: string; property_types?: string[]; transaction?: string;
  currency?: string; min_price?: string; max_price?: string; min_ppsqm?: string; max_ppsqm?: string;
  min_bedrooms?: string; max_bedrooms?: string; min_area?: string; max_area?: string;
}

export const getSegmentRules = () =>
  call<Partial<SegmentRulesView>>('admin_market_segment_rules', { p_audit_limit: 50 })
    .then((d): SegmentRulesView => ({
      rules: d?.rules ?? [], audit: d?.audit ?? [],
      stored: (d?.stored ?? { last_computed_at: null }) as SegmentRulesView['stored'],
    }));
export const previewSegmentRule = (params: SegmentParams) =>
  call<SegmentPreview>('admin_market_segment_preview', { p_params: params });
export const saveSegmentDraft = (params: SegmentParams, note: string) =>
  call<SegmentRule>('admin_market_segment_save_draft', { p_params: params, p_note: note || null });
export const applySegmentRule = (ruleId: string, expectedChanges: number, token: string) =>
  call<{ rows_written: number; changed_count: number }>('admin_market_segment_apply', {
    p_rule_id: ruleId, p_expected_changes: expectedChanges, p_confirmation: token,
  });
export const getSegmentAreas = (params?: SegmentParams | null) =>
  call<{ params?: SegmentParams; areas?: SegmentArea[] }>('admin_market_segment_areas', { p_params: params ?? null })
    .then((d) => ({ params: d?.params ?? null, areas: Array.isArray(d?.areas) ? d.areas : [] }));
export const listPropertySegments = (f: PropertySegmentFilters, sort: string, page: number, pageSize: number) =>
  call<Partial<PagedResult<PropertySegmentRow>>>('admin_property_segments_list', {
    p_filters: compactFilters(f as Record<string, unknown>), p_sort: sort, p_page: page, p_page_size: pageSize,
  }).then((d) => paged(d));

/** Same params, regardless of key order or number formatting. */
export function sameParams(a: SegmentParams | null | undefined, b: SegmentParams | null | undefined): boolean {
  if (!a || !b) return false;
  return Number(a.minComparables) === Number(b.minComparables)
    && Number(a.premiumPercentile) === Number(b.premiumPercentile)
    && Number(a.economyPercentile) === Number(b.economyPercentile)
    && Number(a.minAreaSqm) === Number(b.minAreaSqm)
    && [...a.levels].sort().join() === [...b.levels].sort().join();
}
