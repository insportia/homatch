import { supabase } from '@/db/supabase';
import type {
  FinanceSummary, ProviderRow, ProviderConnection, ProductRow, PlanRow,
  CreditEconomics, UserEconomicsRow, BudgetRow, AlertRow, CostEventPage,
  TimeseriesPoint, MonthRow, MarginMonitor, UnpricedRow, FxStatus, ProviderRegistry,
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

export const getVerifyDeepDive = (days = 30) =>
  rpc<Record<string, unknown>>('finance_verify_deep_dive', { p_days: days });

export const getOpenAiBreakdown = (days = 30) =>
  rpc<Record<string, unknown>>('finance_openai_breakdown', { p_days: days });

export const getLiveFeed = (limit = 50) =>
  rpc<Record<string, unknown>[]>('finance_live_feed', { p_limit: limit });

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
