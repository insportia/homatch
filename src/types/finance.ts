// Admin Finance types. These mirror the jsonb returned by the finance_* RPCs.
//
// Everything here is INTERNAL. None of it may be rendered on a customer
// surface: it carries landed COGS, provider cost, margin and provider
// capability detail.
//
// Money arrives as a decimal string or number from Postgres numeric. It is
// formatted for display, never used for arithmetic on the client — the
// server is the only thing that computes money.

export type AccessLevel =
  | 'NONE' | 'PARTIAL' | 'FULL' | 'CALCULATED' | 'PERMISSION_MISSING' | 'UNKNOWN';

export type AccessStatus =
  | 'CONNECTED_BILLING_ACCESS'
  | 'CONNECTED_USAGE_ACCESS'
  | 'CONNECTED_LOCAL_COST_CALCULATION'
  | 'CONNECTED_BILLING_PERMISSION_MISSING'
  | 'CONNECTED_SERVICE_ONLY'
  | 'NOT_CONFIGURED';

/** How a cost figure was arrived at. Never mixed silently. */
export type CostSource =
  | 'PROVIDER_REPORTED' | 'MEASURED' | 'CALCULATED' | 'ALLOCATED'
  | 'MANUAL' | 'ESTIMATED' | 'UNPRICED' | 'IMPORTED' | 'INVOICE' | 'PRICE_BOOK';

export type DataQuality = 'GOOD' | 'PARTIAL' | 'POOR' | 'NO_DATA' | 'UNVERIFIED' | 'NONE';

export type ReconciliationStatus =
  | 'MATCHED' | 'WITHIN_TOLERANCE' | 'MISMATCH' | 'INCOMPLETE' | 'UNAVAILABLE';

export interface FinanceSummary {
  currency: string;
  timezone: string;
  days_elapsed: number;
  days_in_month: number;
  spend_today: number;
  spend_mtd: number;
  spend_prev_month: number;
  revenue_today: number;
  revenue_mtd: number;
  /** False when the payment provider is not configured. Never shown as $0. */
  revenue_data_available: boolean;
  gross_profit_mtd: number;
  gross_margin_bps: number | null;
  variable_cogs_mtd: number;
  fixed_monthly: number;
  total_company_spend_mtd: number;
  operating_contribution_mtd: number;
  burn_daily_avg: number;
  burn_projected_month_end: number;
  unpriced_events: number;
  unpriced_quantity: number;
  credits_reserved: number;
  payment_provider_configured: boolean;
}

export interface ProviderRow {
  provider_id: string;
  provider_name: string;
  category: string;
  category_label: string;
  billing_unit: string;
  currency: string;
  icon_key: string | null;
  active: boolean;
  credentials_present: boolean;
  supports_live_metering: boolean;
  supports_usage_import: boolean;
  supports_manual_invoice: boolean;
  supports_effective_dated_pricing: boolean;
  spend_usd: number;
  spend_today_usd: number;
  events: number;
  quantity: number;
  cost_per_unit_usd: number | null;
  unpriced_events: number;
  unpriced_quantity: number;
  cache_hits: number;
  last_seen_at: string | null;
  share_bps: number;
  by_product: { product: string; usd: number; events: number }[];
  invoiced_usd: number;
  metered_vs_invoiced_delta_usd: number | null;
}

/** One row of the Provider Connections audit screen. */
export interface ProviderConnection {
  provider_id: string;
  provider_name: string;
  category: string;
  category_label: string;
  sort_order: number;
  icon_key: string | null;
  homatch_use: string | null;
  access_status: AccessStatus;
  service_access: AccessLevel;
  usage_access: AccessLevel;
  billing_access: AccessLevel;
  invoice_access: AccessLevel;
  credential_sufficient: boolean | null;
  missing_permission: string | null;
  /** The NAME of the environment variable. Never its value. */
  credential_env_var: string | null;
  credentials_present: boolean;
  cost_source: CostSource | null;
  sync_mode: string;
  supports_live_metering: boolean;
  supports_provider_reported_cost: boolean;
  supports_usage_import: boolean;
  supports_invoice_import: boolean;
  supports_manual_cost: boolean;
  supports_effective_dated_pricing: boolean;
  health_status: string | null;
  last_tested_at: string | null;
  last_success_at: string | null;
  latency_ms: number | null;
  last_error: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  last_cost_event_at: string | null;
  cost_events_30d: number;
  spend_30d_usd: number;
  unpriced_30d: number;
  stale: boolean;
  stale_after_hours: number;
  data_quality: DataQuality;
  action_required: string | null;
  reconciliation: {
    status: ReconciliationStatus;
    local_usd: number | null;
    provider_usd: number | null;
    delta_usd: number | null;
    period_start: string;
    period_end: string;
  } | null;
  notes: string | null;
}

export interface ProductRow {
  product_code: string;
  product_name?: string;
  executions: number;
  cogs_usd: number;
  revenue_usd: number;
  gross_profit_usd: number;
  gross_margin_bps: number | null;
  cogs_per_execution_usd: number | null;
  unpriced_events?: number;
}

export interface PlanRow {
  plan_code: string;
  plan_name: string;
  monthly_price_usd: number;
  active_users: number;
  active_subscriptions: number;
  mrr_usd: number;
  membership_credits_granted: number;
  membership_credits_spent: number;
  included_executions: number;
  included_usage_cogs_usd: number;
  payg_executions: number;
  payg_revenue_usd: number;
  provider_cogs_usd: number;
  gross_profit_usd: number;
}

export interface CreditKindRow {
  kind: string;
  lots: number;
  issued: number;
  consumed: number;
  reserved: number;
  expired: number;
  remaining: number;
  nominal_usd: number;
  /** Only PURCHASED credits correspond to cash a customer actually paid. */
  is_cash_backed: boolean;
}

export interface CreditEconomics {
  credits_per_usd: number;
  by_kind: CreditKindRow[];
  cash_collected_usd: number;
  liability_outstanding_credits: number;
  liability_outstanding_usd: number;
  ledger_by_type: { type: string; entries: number; net_credits: number }[];
  first_topup_promo: {
    redemptions: number;
    promo_credits_granted: number;
    promo_credits_consumed: number;
    cash_from_qualifying_topups_usd: number;
  };
}

export interface UserEconomicsRow {
  user_id: string;
  email: string | null;
  plan: string;
  subscription_revenue_usd: number;
  topup_revenue_usd: number;
  payg_revenue_usd: number;
  credits_issued: number;
  credits_consumed: number;
  included_consumed: number;
  provider_cogs_usd: number;
  verify_runs: number;
  gross_profit_usd: number;
}

export interface BudgetRow {
  code: string;
  label: string;
  scope: string;
  scope_value: string | null;
  period: string;
  budget_usd: number;
  spent_usd: number;
  used_bps: number | null;
  warn_at_bps: number;
  state: 'OK' | 'WARN' | 'OVER' | 'UNSET';
  hard_stop: boolean;
  /** The admin_settings key that actually stops spending, if any. */
  enforcement_setting_key: string | null;
  enforcement_usd: number | null;
  drifts_from_enforcement: boolean;
}

export interface AlertRow {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  kind: string;
  title: string;
  detail: string | null;
  subject: string | null;
  metric_value: number | null;
  threshold_value: number | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface CostFactRow {
  fact_key: string;
  occurred_at: string;
  provider: string;
  product: string;
  stage: string | null;
  operation: string;
  model: string | null;
  quantity: number;
  unit: string;
  web_searches: number | null;
  cost_usd: number;
  model_cost_usd: number | null;
  search_cost_usd: number | null;
  cost_source: CostSource;
  is_unpriced: boolean;
  job_ref: string | null;
  user_id: string | null;
  market: string | null;
  cache_hit: boolean;
  source_currency: string;
  source_amount: number | null;
}

export interface CostEventPage {
  total: number;
  sum_usd: number;
  rows: CostFactRow[];
}

export interface TimeseriesPoint {
  bucket: string;
  spend_usd: number;
  revenue_usd: number;
  gross_profit_usd: number;
  events: number;
}

export interface MonthRow {
  month: string;
  month_start: string;
  is_current: boolean;
  variable_cogs_usd: number;
  fixed_costs_usd: number;
  total_spend_usd: number;
  revenue_usd: number;
  gross_profit_usd: number;
  gross_margin_bps: number | null;
  operating_contribution_usd: number;
  cost_events: number;
  unpriced_events: number;
}

export interface MarginMonitor {
  floor_bps: number;
  by_product: {
    product_code: string;
    charged_executions: number;
    revenue_usd: number;
    cogs_usd: number;
    gross_profit_usd: number;
    margin_bps: number | null;
    below_floor: boolean;
  }[];
  worst_executions: {
    job_ref: string | null;
    product_code: string;
    plan_code: string | null;
    created_at: string;
    revenue_usd: number;
    cogs_usd: number;
    gross_profit_usd: number;
    allowance_funded: boolean;
  }[];
}

export interface UnpricedRow {
  provider: string;
  operation: string;
  events: number;
  quantity: number;
  unit: string;
  first_seen: string;
  last_seen: string;
}

export interface FxStatus {
  reporting_currency: string;
  rates: {
    currency: string;
    rate: number;
    source: string;
    effective_from: string;
    effective_to: string | null;
  }[];
  missing: { currency: string; where: string }[];
}

export interface ProviderRegistryEntry {
  provider_id: string;
  provider_name: string;
  category: string;
  category_label: string;
  billing_unit: string;
  unit_label: string;
  unit_precision: number;
  currency: string;
  supports_live_metering: boolean;
  supports_usage_import: boolean;
  supports_manual_invoice: boolean;
  supports_effective_dated_pricing: boolean;
  active: boolean;
  credentials_present: boolean;
  credential_env_var: string | null;
  icon_key: string | null;
  sort_order: number;
  default_product: string | null;
  counts_as_cogs: boolean;
  notes: string | null;
  spend_usd: number;
  events: number;
  quantity: number;
  unpriced_events: number;
  last_seen_at: string | null;
  price_rules: number;
  invoices: number;
  state: 'REGISTERED' | 'NOT_CONFIGURED' | 'UNPRICED' | 'IDLE' | 'LIVE';
}

export interface ProviderRegistry {
  categories: { code: string; label: string; sort_order: number }[];
  units: { code: string; label: string; precision: number }[];
  providers: ProviderRegistryEntry[];
}

/** Admin-entered recurring company costs. Always MANUAL, never measured usage. */
export interface FixedCostRow {
  id: string;
  name: string;
  vendor: string;
  category: string;
  amount_usd: number;
  source_currency: string;
  billing_frequency: 'ONE_OFF' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  monthly_usd: number;
  starts_at: string;
  renews_at: string | null;
  ends_at: string | null;
  active: boolean;
  counts_as_cogs: boolean;
  notes: string | null;
  cost_source: 'MANUAL';
  superseded: boolean;
}

export interface FixedCosts {
  monthly_total_usd: number;
  /** Only the expenses explicitly flagged as cost of goods sold. */
  monthly_cogs_usd: number;
  rows: FixedCostRow[];
  /** Infrastructure providers we pay but hold no fixed-cost row for. */
  missing: { provider_id: string; provider_name: string; hint: string | null }[];
}

export interface ModelRate {
  id: string;
  provider: string;
  model: string | null;
  unit: string;
  rate: number;
  per_units: number;
  currency: string;
  rate_per_unit_usd: number | null;
  effective_from: string;
  effective_to: string | null;
  current: boolean;
  source: string | null;
  notes: string | null;
}

export interface ProviderRate {
  id: number;
  provider_id: string;
  provider_name: string | null;
  operation: string;
  market: string;
  unit: string;
  unit_cost: number;
  currency: string;
  unit_cost_usd: number | null;
  convertible: boolean;
  effective_from: string;
  effective_to: string | null;
  current: boolean;
  note: string | null;
}

export interface PriceBook {
  model_rates: ModelRate[];
  provider_rates: ProviderRate[];
  /** Declares dated pricing but has no rate on file — the source of unpriced usage. */
  declared_but_unpriced: {
    provider_id: string; provider_name: string;
    billing_unit: string; currency: string;
  }[];
  fx: {
    reporting_currency: string;
    rates: { currency: string; rate: number; source: string;
             effective_from: string; effective_to: string | null }[];
  };
}

export interface LiveFeedEvent {
  fact_key: string;
  occurred_at: string;
  provider: string;
  product: string;
  stage: string | null;
  operation: string;
  model: string | null;
  quantity: number;
  unit: string;
  web_searches: number | null;
  cost_usd: number;
  cost_source: CostSource;
  is_unpriced: boolean;
  job_ref: string | null;
  user_id: string | null;
}

export interface LiveFeed {
  spend_5m: number;
  spend_1h: number;
  spend_today: number;
  events_1h: number;
  /** Null below a meaningful sample — noise dressed as a number helps nobody. */
  burn_per_hour: number | null;
  events: LiveFeedEvent[];
}
