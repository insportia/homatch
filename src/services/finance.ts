import { supabase } from '@/db/supabase';
import type {
  FinanceSummary, ProviderRow, ProviderConnection, ProductRow, PlanRow,
  CreditEconomics, UserEconomicsRow, BudgetRow, AlertRow, CostEventPage,
  TimeseriesPoint, MonthRow, MarginMonitor, UnpricedRow, FxStatus, ProviderRegistry,
  FixedCosts, PriceBook, LiveFeed,
  FinanceV2Service, FinanceV2ServiceDetail, FinanceV2Execution, FinanceV2Quote,
  FinanceV2SharedCosts, FinanceV2PriceDrift,
} from '@/types/finance';

/**
 * ADMIN FINANCE SERVICE.
 *
 * Every function here calls an RPC that checks finance_require_admin() on the
 * server BEFORE returning a single row. The AdminLayout route guard is a
 * convenience, not the control: a non-admin calling these directly gets
 * "FORBIDDEN: finance data is admin only" from Postgres, which is the point.
 *
 * Nothing in this file computes money. Every figure is server-calculated;
 * the client formats and nothing more.
 */

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // A FORBIDDEN here is the authorization gate working, not a bug.
    console.error(`[finance] ${fn} failed:`, error.message);
    throw new Error(error.message);
  }
  return (data ?? null) as T | null;
}

export const getFinanceSummary = () =>
  rpc<FinanceSummary>('finance_summary');

export const getFinanceProviders = (days = 30) =>
  rpc<ProviderRow[]>('finance_providers', { p_days: days });

export const getProviderConnections = () =>
  rpc<ProviderConnection[]>('finance_provider_connections');

export const getProviderRegistry = (days = 30, includeInactive = true) =>
  rpc<ProviderRegistry>('finance_provider_registry_list', {
    p_days: days, p_include_inactive: includeInactive,
  });

export const getFinanceProducts = (days = 30) =>
  rpc<ProductRow[]>('finance_products', { p_days: days });

export const getFinancePlans = (days = 30) =>
  rpc<PlanRow[]>('finance_plans', { p_days: days });

export const getCreditEconomics = () =>
  rpc<CreditEconomics>('finance_credits');

export const getUserEconomics = (days = 30, sort = 'cogs', limit = 50) =>
  rpc<UserEconomicsRow[]>('finance_users', { p_days: days, p_sort: sort, p_limit: limit });

export const getBudgetStatus = () =>
  rpc<BudgetRow[]>('finance_budget_status');

export const getAlerts = (includeResolved = false) =>
  rpc<AlertRow[]>('finance_alert_list', { p_include_resolved: includeResolved });

export const evaluateAlerts = () =>
  rpc<{ raised: number; auto_resolved: number; evaluated_at: string }>('finance_evaluate_alerts');

export const acknowledgeAlert = (id: string) =>
  rpc<{ ok: boolean }>('finance_acknowledge_alert', { p_id: id });

export const getTimeseries = (days = 30, bucket: 'day' | 'week' | 'month' = 'day') =>
  rpc<TimeseriesPoint[]>('finance_timeseries', { p_days: days, p_bucket: bucket });

export const getMonthlySummary = (months = 12) =>
  rpc<MonthRow[]>('finance_monthly_summary', { p_months: months });

export const getMarginMonitor = (days = 30) =>
  rpc<MarginMonitor>('finance_margin_monitor', { p_days: days });

export const getUnpriced = () =>
  rpc<UnpricedRow[]>('finance_unpriced');

export const getFxStatus = () =>
  rpc<FxStatus>('finance_fx_status');

export const getFixedCosts = () =>
  rpc<FixedCosts>('finance_fixed_costs');

export const getPriceBook = () =>
  rpc<PriceBook>('finance_price_book');

export const getVerifyDeepDive = (days = 30) =>
  rpc<Record<string, unknown>>('finance_verify_deep_dive', { p_days: days });

/** Design Studio AI COGS samples (priced rows only in every statistic). */
export const getDesignStudioEconomics = (days = 90) =>
  rpc<Record<string, unknown>>('finance_design_studio_economics', { p_days: days });

export const getOpenAiBreakdown = (days = 30) =>
  rpc<Record<string, unknown>>('finance_openai_breakdown', { p_days: days });

/* ── Finance V2: one ledger per service (gross → VAT → net → allocation → COGS → profit). ── */

export const getFinanceV2Services = (from: string, to: string) =>
  rpc<FinanceV2Service[]>('finance_v2_services', { p_from: from, p_to: to });

export const getFinanceV2ServiceDetail = (service: string, from: string, to: string) =>
  rpc<FinanceV2ServiceDetail>('finance_v2_service_detail', { p_service: service, p_from: from, p_to: to });

export const getFinanceV2Execution = (service: string, executionId: string) =>
  rpc<FinanceV2Execution>('finance_v2_execution', { p_service: service, p_execution_id: executionId });

/** The server's own policy formula — the simulator never re-implements it. */
export const getFinanceV2Quote = (policy: string, grossUsd: number, costUsd = 0) =>
  rpc<FinanceV2Quote>('finance_v2_quote', { p_policy: policy, p_gross_usd: grossUsd, p_cost_usd: costUsd });

/** V2.1: shared infrastructure for the period (prorated monthly rates; unconfigured ≠ free). */
export const getFinanceV2SharedCosts = (from: string, to: string) =>
  rpc<FinanceV2SharedCosts>('finance_v2_shared_costs', { p_from: from, p_to: to });

/** V2.1: live drift between price copies (e.g. the Find Buyers OpenAI setting) and provider_price_book. */
export const getFinanceV2PriceDrift = () =>
  rpc<FinanceV2PriceDrift[]>('finance_v2_price_drift');

export const getLiveFeed = (limit = 50) =>
  rpc<LiveFeed>('finance_live_feed', { p_limit: limit });

export interface CostEventFilters {
  from?: string; to?: string; provider?: string; product?: string;
  unpricedOnly?: boolean; jobRef?: string; minCost?: number;
  limit?: number; offset?: number;
}

export const getCostEvents = (f: CostEventFilters = {}) =>
  rpc<CostEventPage>('finance_cost_events', {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_provider: f.provider ?? null,
    p_product: f.product ?? null,
    p_unpriced_only: f.unpricedOnly ?? false,
    p_job_ref: f.jobRef ?? null,
    p_min_cost: f.minCost ?? null,
    p_limit: f.limit ?? 200,
    p_offset: f.offset ?? 0,
  });

export const getExecutionDetail = (jobRef: string) =>
  rpc<Record<string, unknown>>('finance_execution_detail', { p_job_ref: jobRef });

/** Preview only. Writes nothing — repricing requires a separate confirmation. */
export const previewReprice = (args: {
  provider: string; operation?: string; market?: string;
  newUnitCost: number; currency?: string; from?: string; to?: string;
}) =>
  rpc<Record<string, unknown>>('finance_reprice_preview', {
    p_provider: args.provider,
    p_operation: args.operation ?? '*',
    p_market: args.market ?? '*',
    p_new_unit_cost: args.newUnitCost,
    p_currency: args.currency ?? 'USD',
    p_from: args.from ?? null,
    p_to: args.to ?? null,
  });

export const reconcileProvider = (args: {
  provider: string; periodStart: string; periodEnd: string;
  providerUsd?: number | null; toleranceBps?: number; note?: string;
}) =>
  rpc<Record<string, unknown>>('finance_reconcile', {
    p_provider_id: args.provider,
    p_period_start: args.periodStart,
    p_period_end: args.periodEnd,
    p_provider_usd: args.providerUsd ?? null,
    p_tolerance_bps: args.toleranceBps ?? 200,
    p_note: args.note ?? null,
  });

export const exportCostFacts = async (f: CostEventFilters = {}): Promise<string> => {
  const { data, error } = await supabase.rpc('finance_export_cost_facts', {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_provider: f.provider ?? null,
    p_product: f.product ?? null,
    p_limit: f.limit ?? 10000,
  });
  if (error) throw new Error(error.message);
  return (data as string[] | null)?.join('\n') ?? '';
};

// ── Formatting ──────────────────────────────────────────────
// Money comes back as a Postgres numeric, which arrives as a string. Number()
// is only ever applied for DISPLAY. No arithmetic on money happens here.

/** Full precision for small provider costs, which are often fractions of a cent. */
export function usd(v: number | string | null | undefined, maxFrac = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  // A cost of $0.00042 must not render as "$0.00" — that reads as free.
  const frac = abs > 0 && abs < 0.01 ? 6 : maxFrac;
  return n.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Math.min(frac, 2), maximumFractionDigits: frac,
  });
}

export function num(v: number | string | null | undefined, frac = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

/** Basis points as a percentage. Null means "not calculable", not zero. */
export function bps(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${(Number(v) / 100).toFixed(2)}%`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/* ── Find Property: HOMATCH's own operating cost (admin only; Find Property is free) ── */
export type FpCompleteness = 'VERIFIED' | 'ESTIMATED' | 'PARTIAL' | 'UNKNOWN';
export interface FpSearchRow {
  id: string; created_at: string; status: string; properties: number | null; workers: string[]; runs: number;
  ai_usd: number; ai_upper_usd: number; ai_calls: number; provider_usd: number; other_usd: number | null; total_usd: number;
  completeness: FpCompleteness;
}
export interface FpCosts {
  generated_at: string;
  summary: {
    today_usd: number; yesterday_usd: number; last7_usd: number; month_usd: number; month_upper_usd: number;
    searches: number; searches_in_range: number; properties: number;
    avg_per_search_usd: number | null; avg_per_property_usd: number | null;
    most_expensive: { id: string; created_at: string; usd: number } | null;
    run_rate_month_usd: number; unlinked_brief_usd: number; unlinked_brief_upper_usd: number; unlinked_brief_calls: number;
    incomplete_searches: number;
  };
  infrastructure: { monthly_fixed_usd: number; amounts_entered: boolean; share: number | null; allocated_per_search_usd: number | null; status: FpCompleteness };
  daily: Array<{ day: string; searches: number; properties: number; ai_usd: number; ai_upper_usd: number; provider_usd: number }>;
  providers: Array<{ worker: string; runs: number; pages: number; listings: number; failed: number; empty: number; warm_index: number; shared: number; direct_usd: number; billing: string }>;
  cache: { runs: number; shared_runs: number; warm_index_runs: number; pool_listings: number; hit_rate: number | null };
  optimisation: { repeated_ai_searches: number; retries: number; failed_runs: number; empty_runs: number };
  searches: FpSearchRow[];
}
export interface FpSearchCost {
  search: { id: string; created_at: string; status: string; properties: number | null; ai_status: string; brief_cost_refs: string[] };
  ai: Array<{ id: string; at: string; operation: string; model: string | null; input_tokens: number | null; output_tokens: number | null; units: number;
    input_rate_per_1m: number | null; output_rate_per_1m: number | null; usd: number; upper_usd: number | null; state: string; success: boolean }>;
  workers: Array<{ worker: string; status: string; attempts: number; returned: number; discovered: number; pages: number | null; actions: number | null;
    bytes: number | null; duration_ms: number | null; index: string | null; shared_run_id: string | null; cached_listings: number; direct_usd: number; billing: string }>;
}
export const getFindPropertyCosts = (from: string, to: string) =>
  rpc<FpCosts>('finance_find_property_costs', { p_from: from, p_to: to });
export const getFindPropertySearchCost = (searchId: string) =>
  rpc<FpSearchCost>('finance_find_property_search_cost', { p_search_id: searchId });
