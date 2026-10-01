// META ADS — WHAT AN ADMIN MAY WRITE TO A SETTING. Pure.
//
// Shared by the Control Center (to say "invalid" before sending) and by
// meta-ads-api's admin_setting_set (the only write path), so the browser can
// never be the place a rule lives. Every key the engine reads (engine.ts
// loadSettings) is listed with its shape; anything else is refused, and a
// credential-looking key is never writable or readable here.

export const ADMIN_KILL_SWITCHES = [
  'meta_ads_enabled', 'meta_ads_publishing_enabled', 'meta_ads_lead_sync_enabled',
  'meta_ads_lead_import_enabled', 'meta_ads_audience_creation_enabled',
  'meta_ads_retargeting_enabled', 'meta_ads_lookalike_enabled',
  'meta_ads_autopilot_enabled', 'meta_ads_ai_assist_enabled',
  'meta_ads_guard_enabled', 'meta_ads_ai_summary_enabled', 'meta_ads_whatsapp_enabled',
] as const;

/** Parameter objects: code defaults apply for {}; the engine sanitises each field. */
export const ADMIN_JSON_OBJECT_SETTINGS = ['meta_ads_strategy_params', 'meta_ads_analysis_params', 'meta_ads_guard_policy'] as const;

/** Numbers, with the bounds the server enforces. */
export const ADMIN_NUMERIC_SETTINGS: Record<string, { min: number; max: number; integer: boolean }> = {
  // The canonical fee function clamps to 0–100 at two decimals; refuse what it would clamp.
  meta_ads_fee_percent: { min: 0, max: 100, integer: false },
  // The engine floors this at 2 days whatever is stored.
  meta_ads_min_duration_days: { min: 2, max: 365, integer: true },
  meta_ads_daily_budget_min_cents: { min: 1, max: 100_000_000_000, integer: true },
  meta_ads_daily_budget_max_cents: { min: 1, max: 100_000_000_000, integer: true },
};

export const ADMIN_GOALS = ['LEADS_ON_META', 'LEADS_ON_WEBSITE', 'SITE_REGISTRATIONS', 'ENGAGEMENT', 'MESSAGES', 'PROMOTE'];
export const ADMIN_BUDGET_BILLING = ['CUSTOMER_AD_ACCOUNT', 'HOMATCH_WALLET'];

const OTHER = ['meta_ads_goals_enabled', 'meta_ads_default_countries', 'meta_ads_budget_billing', 'meta_ads_api_version'];

export const ADMIN_SETTING_KEYS: string[] = [
  ...ADMIN_KILL_SWITCHES, ...ADMIN_JSON_OBJECT_SETTINGS, ...Object.keys(ADMIN_NUMERIC_SETTINGS), ...OTHER,
];

/** Never a setting: credentials live in Vault / env, not in admin_settings. */
export const isCredentialKey = (key: string) => /token|secret|password|credential|api_key|apikey/i.test(key);

export type SettingError =
  | 'UNKNOWN_SETTING' | 'NOT_BOOLEAN' | 'NOT_NUMBER' | 'OUT_OF_RANGE' | 'NOT_INTEGER' | 'TOO_PRECISE'
  | 'NOT_OBJECT' | 'TOO_LARGE' | 'BAD_GOAL' | 'BAD_COUNTRY' | 'BAD_BILLING' | 'BAD_VERSION' | 'MIN_ABOVE_MAX' | 'EMPTY_LIST';

export type SettingCheck = { ok: true; value: unknown } | { ok: false; error: SettingError };

/**
 * Validate one setting write. `current` is the stored settings map, for the
 * rules that span two keys (the daily budget min must not exceed the max).
 */
export function validateSetting(key: string, value: unknown, current: Record<string, unknown> = {}): SettingCheck {
  if (isCredentialKey(key) || !ADMIN_SETTING_KEYS.includes(key)) return { ok: false, error: 'UNKNOWN_SETTING' };

  if ((ADMIN_KILL_SWITCHES as readonly string[]).includes(key)) {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'NOT_BOOLEAN' };
  }

  const num = ADMIN_NUMERIC_SETTINGS[key];
  if (num) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'NOT_NUMBER' };
    if (num.integer && !Number.isInteger(value)) return { ok: false, error: 'NOT_INTEGER' };
    if (!num.integer && Math.round(value * 100) / 100 !== value) return { ok: false, error: 'TOO_PRECISE' };
    if (value < num.min || value > num.max) return { ok: false, error: 'OUT_OF_RANGE' };
    const min = key === 'meta_ads_daily_budget_min_cents' ? value : Number(current.meta_ads_daily_budget_min_cents);
    const max = key === 'meta_ads_daily_budget_max_cents' ? value : Number(current.meta_ads_daily_budget_max_cents);
    if ((key === 'meta_ads_daily_budget_min_cents' || key === 'meta_ads_daily_budget_max_cents')
      && Number.isFinite(min) && Number.isFinite(max) && min > max) return { ok: false, error: 'MIN_ABOVE_MAX' };
    return { ok: true, value };
  }

  if ((ADMIN_JSON_OBJECT_SETTINGS as readonly string[]).includes(key)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'NOT_OBJECT' };
    if (JSON.stringify(value).length > 8_000) return { ok: false, error: 'TOO_LARGE' };
    return { ok: true, value };
  }

  if (key === 'meta_ads_goals_enabled') {
    if (!Array.isArray(value)) return { ok: false, error: 'BAD_GOAL' };
    if (value.length === 0) return { ok: false, error: 'EMPTY_LIST' };
    if (!value.every((g) => ADMIN_GOALS.includes(String(g)))) return { ok: false, error: 'BAD_GOAL' };
    return { ok: true, value: [...new Set(value.map(String))] };
  }
  if (key === 'meta_ads_default_countries') {
    if (!Array.isArray(value)) return { ok: false, error: 'BAD_COUNTRY' };
    if (value.length === 0) return { ok: false, error: 'EMPTY_LIST' };
    if (!value.every((c) => /^[A-Z]{2}$/.test(String(c)))) return { ok: false, error: 'BAD_COUNTRY' };
    return { ok: true, value: [...new Set(value.map(String))] };
  }
  if (key === 'meta_ads_budget_billing') {
    return ADMIN_BUDGET_BILLING.includes(String(value)) && typeof value === 'string' ? { ok: true, value } : { ok: false, error: 'BAD_BILLING' };
  }
  if (key === 'meta_ads_api_version') {
    return typeof value === 'string' && /^v\d{2}\.\d$/.test(value) ? { ok: true, value } : { ok: false, error: 'BAD_VERSION' };
  }
  return { ok: false, error: 'UNKNOWN_SETTING' };
}
