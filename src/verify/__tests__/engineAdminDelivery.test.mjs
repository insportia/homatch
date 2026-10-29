// Verify engine controls in Admin → Providers, with delivery counted correctly
// (stabilization 2026-10-30). The engine is stamped once at job creation;
// running jobs never switch; existing reports are never rewritten by an engine
// change or by the delivery work; the stats count DELIVERED reports, not
// finished research.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineForNewJob, engineVersionOf } from '../engine.ts';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const RA = read('supabase/functions/research-agent/index.ts');
const VS = read('supabase/functions/verify-synthesis/index.ts');
const SQL = read('supabase/migrations/20261208130000_verify_report_delivery.sql');

test('Admin → Providers carries every engine control: selection, admin preview, V3 on/off, stats, delivery', () => {
  const page = read('src/pages/admin/AdminProvidersPage.tsx');
  for (const c of ['<VerifyEngineCard />', '<VerifyV2ResearchCard />', '<VerifyV3ResearchCard />', '<VerifyEngineStatsCard />', '<VerifyDeliveryCard />']) assert.ok(page.includes(c), c);
  const card = read('src/components/admin/VerifyEngineCard.tsx');
  assert.match(card, /row\('active', t\('adm_engine_customers'\)\)/, 'customer engine (active for new jobs)');
  assert.match(card, /row\('adminPreview', t\('adm_engine_admin_preview'\)\)/, 'admin-only preview');
  assert.match(card, /setTarget\(\{ field: 'v3Enabled', enabled: !setting\.v3Enabled \}\)/, 'enable / disable V3');
  assert.match(card, /updateAdminSetting\(VERIFY_ENGINE_SETTING_KEY, next, reason\.trim\(\)\)/, 'one audited write with a reason');
  assert.match(card, /listAudit\(\{ action: 'SETTING_UPDATED' \}/, 'history of changes');
});

test('the engine setting is read once, at job creation, and stamped; verify-synthesis never reads it', () => {
  assert.equal((RA.match(/adminSettingJson\(sb, VERIFY_ENGINE_SETTING_KEY\)/g) ?? []).length, 1);
  const at = RA.indexOf('adminSettingJson(sb, VERIFY_ENGINE_SETTING_KEY)');
  const around = RA.slice(at, at + 1500);
  assert.match(around, /engineForNewJob\(engineSetting/);
  assert.match(around, /_engine: stamped/);
  assert.equal(/VERIFY_ENGINE_SETTING_KEY|'verify_engine'/.test(VS), false, 'the report builder reads the job stamp, never the live setting');
});

test('a running job keeps its stamp whatever the setting says now', () => {
  const stampedV2 = { _engine: engineForNewJob({ active: 'V1', adminPreview: 'V2' }, '2026-10-30T00:00:00Z', false, { isAdmin: true }) };
  assert.equal(engineVersionOf(stampedV2), 'V2');
  // The setting moves to V3 afterwards: the job's stamp is what every later step reads.
  engineForNewJob({ active: 'V3', adminPreview: 'V3', v3Enabled: true }, '2026-10-30T01:00:00Z', false, { isAdmin: true });
  assert.equal(engineVersionOf(stampedV2), 'V2');
  assert.equal(engineVersionOf({}), 'V1', 'jobs from before the selector are V1');
});

test('the delivery migration never rewrites a job, a report, a billing or a usage row', () => {
  assert.equal(/update\s+public\.(research_jobs|verify_billing|saas_usage|saas_trials)/i.test(SQL), false);
  assert.equal(/delete\s+from/i.test(SQL), false);
  assert.equal(/synthesis_json\s*=/.test(SQL), false);
  assert.equal(/insert\s+into\s+public\.(?!verify_report_failures)/i.test(SQL), false);
});

test('engine stats count delivered reports, not finished research; old keys kept for older readers', () => {
  const fn = SQL.slice(SQL.indexOf('create or replace function public.admin_verify_engine_stats'));
  assert.match(fn, /'complete', e\.delivered/);
  assert.match(fn, /'failed', e\.report_failed \+ e\.research_failed/);
  for (const k of ['researchComplete', 'delivered', 'reportFailed', 'reportPending', 'researchFailed', 'stopped', 'successRate', 'avgReportSeconds', 'avgSeconds', 'avgCogsUsd', 'pricedJobs']) {
    assert.ok(fn.includes(`'${k}'`), k);
  }
  assert.match(fn, /count\(\*\) filter \(where delivery = 'DELIVERED'\) as delivered/);
  assert.match(fn, /if not public\.is_admin\(\) then raise exception 'FORBIDDEN'/);
  const card = read('src/components/admin/VerifyEngineStatsCard.tsx');
  for (const k of ['adm_engine_stats_delivered', 'adm_engine_stats_report_failed', 'adm_engine_stats_report_pending', 'adm_engine_stats_success_rate']) assert.ok(card.includes(k), k);
});
