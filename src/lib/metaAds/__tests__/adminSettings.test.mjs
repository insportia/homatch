// What an admin may write to a Meta Ads setting — the rules the server applies
// (meta-ads-api admin_setting_set) and the Control Center checks first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSetting, isCredentialKey, ADMIN_KILL_SWITCHES, ADMIN_SETTING_KEYS } from '../adminSettings.ts';

test('every kill switch the brief names is a boolean switch, and only a boolean is accepted', () => {
  for (const k of ['enabled', 'publishing_enabled', 'lead_sync_enabled', 'lead_import_enabled', 'audience_creation_enabled', 'retargeting_enabled',
    'lookalike_enabled', 'autopilot_enabled', 'ai_assist_enabled', 'guard_enabled', 'ai_summary_enabled']) {
    const key = `meta_ads_${k}`;
    assert.ok(ADMIN_KILL_SWITCHES.includes(key), key);
    assert.deepEqual(validateSetting(key, false), { ok: true, value: false });
    assert.deepEqual(validateSetting(key, 'false'), { ok: false, error: 'NOT_BOOLEAN' });
    assert.deepEqual(validateSetting(key, 0), { ok: false, error: 'NOT_BOOLEAN' });
  }
});

test('the standard fee: 0–100 at two decimals, as the canonical fee function computes it', () => {
  assert.deepEqual(validateSetting('meta_ads_fee_percent', 9), { ok: true, value: 9 });
  assert.deepEqual(validateSetting('meta_ads_fee_percent', 12.5), { ok: true, value: 12.5 });
  assert.deepEqual(validateSetting('meta_ads_fee_percent', 0), { ok: true, value: 0 });
  assert.equal(validateSetting('meta_ads_fee_percent', 9.125).error, 'TOO_PRECISE');
  assert.equal(validateSetting('meta_ads_fee_percent', -1).error, 'OUT_OF_RANGE');
  assert.equal(validateSetting('meta_ads_fee_percent', 101).error, 'OUT_OF_RANGE');
  assert.equal(validateSetting('meta_ads_fee_percent', '9').error, 'NOT_NUMBER');
  assert.equal(validateSetting('meta_ads_fee_percent', Number.NaN).error, 'NOT_NUMBER');
});

test('budget limits and minimum duration: whole numbers, in range, and the minimum never above the maximum', () => {
  const current = { meta_ads_daily_budget_min_cents: 200, meta_ads_daily_budget_max_cents: 100000 };
  assert.equal(validateSetting('meta_ads_daily_budget_min_cents', 500, current).ok, true);
  assert.equal(validateSetting('meta_ads_daily_budget_min_cents', 200000, current).error, 'MIN_ABOVE_MAX');
  assert.equal(validateSetting('meta_ads_daily_budget_max_cents', 100, current).error, 'MIN_ABOVE_MAX');
  assert.equal(validateSetting('meta_ads_daily_budget_min_cents', 2.5, current).error, 'NOT_INTEGER');
  assert.equal(validateSetting('meta_ads_daily_budget_min_cents', 0, current).error, 'OUT_OF_RANGE');
  assert.equal(validateSetting('meta_ads_min_duration_days', 1).error, 'OUT_OF_RANGE', 'the two-day floor');
  assert.equal(validateSetting('meta_ads_min_duration_days', 3).ok, true);
});

test('strategy / analysis / guard parameters: plain objects of bounded size', () => {
  for (const k of ['meta_ads_strategy_params', 'meta_ads_analysis_params', 'meta_ads_guard_policy']) {
    assert.equal(validateSetting(k, {}).ok, true, k);
    assert.equal(validateSetting(k, { maxStrikes: 3 }).ok, true, k);
    assert.equal(validateSetting(k, []).error, 'NOT_OBJECT', k);
    assert.equal(validateSetting(k, null).error, 'NOT_OBJECT', k);
    assert.equal(validateSetting(k, { blob: 'x'.repeat(9000) }).error, 'TOO_LARGE', k);
  }
});

test('lists and enums: known goals, ISO countries, the two billing models, a Graph version', () => {
  assert.deepEqual(validateSetting('meta_ads_goals_enabled', ['LEADS_ON_META', 'LEADS_ON_META']), { ok: true, value: ['LEADS_ON_META'] });
  assert.equal(validateSetting('meta_ads_goals_enabled', ['BUY_FOLLOWERS']).error, 'BAD_GOAL');
  assert.equal(validateSetting('meta_ads_goals_enabled', []).error, 'EMPTY_LIST');
  assert.equal(validateSetting('meta_ads_default_countries', ['GE', 'TR']).ok, true);
  assert.equal(validateSetting('meta_ads_default_countries', ['Georgia']).error, 'BAD_COUNTRY');
  assert.equal(validateSetting('meta_ads_budget_billing', 'CUSTOMER_AD_ACCOUNT').ok, true);
  assert.equal(validateSetting('meta_ads_budget_billing', 'SOMETHING').error, 'BAD_BILLING');
  assert.equal(validateSetting('meta_ads_api_version', 'v26.0').ok, true);
  assert.equal(validateSetting('meta_ads_api_version', 'latest').error, 'BAD_VERSION');
});

test('credentials and unknown keys are never writable', () => {
  for (const k of ['meta_ads_cron_token', 'meta_ads_app_secret', 'meta_ads_worker_token', 'meta_ads_api_key', 'meta_ads_something_new', 'site_title']) {
    assert.equal(validateSetting(k, true).error, 'UNKNOWN_SETTING', k);
  }
  assert.ok(isCredentialKey('meta_ads_maintenance_token'));
  assert.ok(ADMIN_SETTING_KEYS.every((k) => !isCredentialKey(k)), 'no listed setting looks like a credential');
});
