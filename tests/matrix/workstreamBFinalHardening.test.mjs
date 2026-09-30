// WORKSTREAM B — FINAL HARDENING. The rules this pass added, read from the
// sources that enforce them, so a later edit cannot quietly undo one:
//
//   * the Meta maintenance token lives in Vault and is checked by a
//     service-role-only RPC — never compared against a table an admin reads
//   * the Meta ledger refuses a debit the balance cannot cover, under a lock
//   * a launch cannot use a property the caller does not own, and a spent
//     idempotency key is refused rather than re-charged
//   * tokens are never stored unencrypted when Meta is live
//   * forum scheduling no longer depends on the Telegram refresh switch
//   * an unchanged forum post keeps its classification
//   * one running Find Clients search per property
//   * Telegram "not configured" is a neutral state with an owner hand-off
//   * lead states follow a transition table; the directory view exposes only
//     public columns and the whole-row table policy is gone
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const M = read('supabase/migrations/20261001120000_workstream_b_final_hardening.sql');
const fnBody = (name) => {
  const at = M.indexOf(`create or replace function public.${name}(`);
  assert.ok(at >= 0, `${name} is defined`);
  return M.slice(at, M.indexOf('end $$;', at));
};

test('the maintenance token is in Vault, checked by a service-role RPC, and gone from admin_settings', () => {
  assert.match(M, /vault\.create_secret\(v_token, 'meta_ads_maintenance_token'/);
  assert.match(M, /revoke all on function public\.meta_ads_maintenance_token_ok\(text\) from public, anon, authenticated/);
  assert.match(M, /grant execute on function public\.meta_ads_maintenance_token_ok\(text\) to service_role/);
  assert.match(M, /delete from public\.admin_settings where key = 'meta_ads_maintenance_token'/);
  assert.match(M, /'x-cron-token', \(select decrypted_secret from vault\.decrypted_secrets/);
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /rpc\('meta_ads_maintenance_token_ok', \{ p_token: cronToken \}\)/);
  assert.doesNotMatch(api, /key', 'meta_ads_maintenance_token'/, 'the edge function no longer reads the token from admin_settings');
});

test('the ledger refuses a debit beyond the balance, one debit at a time per customer', () => {
  const guard = fnBody('meta_ads_ledger_balance_guard');
  assert.match(guard, /entry_type not in \('RESERVE', 'HOMATCH_FEE'\)/);
  assert.match(guard, /pg_advisory_xact_lock\(hashtextextended\('meta_ads_ledger:' \|\| new\.user_id::text, 0\)\)/);
  assert.match(guard, /raise exception 'INSUFFICIENT_FUNDS'/);
  assert.match(M, /before insert on public\.meta_ads_ledger/);
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /includes\('INSUFFICIENT_FUNDS'\)[\s\S]{0,400}refundAttempt\(sb, c, idem\)/, 'a refused debit gives back what the attempt took');
});

test('a launch is refused for a property the caller does not own, and a spent key is never re-charged', () => {
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /propertyAuthorized\(sb, uid, c\.property_id\)/);
  assert.match(api, /PROPERTY_NOT_OWNED/);
  assert.match(api, /IDEMPOTENCY_KEY_USED/);
  assert.match(read('supabase/functions/meta-ads-api/engine.ts'), /add\('property_owned'/);
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /if \(code !== 'LAUNCH_IN_PROGRESS'\) launchKey\.current = crypto\.randomUUID\(\)/);
});

test('with Meta live, a token is never stored without encryption', () => {
  const shared = read('supabase/functions/_shared/metaAds.ts');
  assert.match(shared, /class TokenEncryptionMissingError/);
  assert.match(shared, /metaMode\(\) === 'REAL'\) throw new TokenEncryptionMissingError/);
  const oauth = read('supabase/functions/meta-oauth/index.ts');
  assert.ok(oauth.indexOf('await sealToken(token)') < oauth.indexOf("status: 'CONNECTED'"), 'sealed before the connection is marked CONNECTED');
});

test('the review shows what HOMATCH charges now, apart from what Meta bills', () => {
  const budget = read('src/components/metaAds/builder/BudgetStep.tsx');
  assert.match(budget, /data-charged-now/);
  assert.match(budget, /viaWallet \? totals\.totalCents : totals\.feeCents/);
  assert.match(budget, /madsb_money_meta_bills/);
});

test('forum scheduling has its own switch and never waits on Telegram', () => {
  assert.match(M, /'forum_schedule_enabled', 'false'::jsonb/);
  const cron = M.slice(M.indexOf("'homatch-forum-discovery',"), M.indexOf('$cron$', M.indexOf("'homatch-forum-discovery',") + 60) + 400);
  assert.match(cron, /forum_schedule_enabled/);
  assert.doesNotMatch(cron, /discovery_background_refresh_enabled/);
  const dd = read('supabase/functions/demand-discovery/index.ts');
  assert.match(dd, /body\.source === 'cron' && !discovery\.forumScheduleEnabled/);
  assert.match(read('src/services/adminDiscovery.ts'), /'forum_schedule_enabled'/);
});

test('an unchanged forum post keeps its classification; a campaign reads only live-proven boards', () => {
  const dd = read('supabase/functions/demand-discovery/index.ts');
  assert.match(dd, /const \{ classification_status: _pending, \.\.\.unchanged \} = shared/);
  assert.match(dd, /\.\.\.\(changed \? shared : unchanged\)/);
  assert.match(dd, /body\.source === 'campaign' \? \['LIVE_TESTED', 'PRODUCTIVE'\]/);
});

test('one running Find Clients search per property; source jobs are claimed one per tick', () => {
  const mc = read('supabase/functions/match-campaign/index.ts');
  const guard = mc.indexOf('alreadyRunning: true');
  assert.ok(guard > 0 && guard < mc.indexOf('const grant = await beginExecution'), 'checked before any Credits are reserved');
  assert.match(read('supabase/functions/discovery-queue-worker/driver.ts'), /Number\(body\.limit\) \|\| 1\)/);
});

test('Telegram "not configured" is neutral, testable by an admin, and handed off by variable name', () => {
  const sync = read('supabase/functions/community-sync/index.ts');
  assert.match(sync, /outcome\.error === 'NOT_CONFIGURED' \|\| outcome\.error === 'DISABLED' \? outcome\.error : 'DEGRADED'/);
  assert.match(sync, /!settings\.telegramEnabled && !force && action !== 'health'/);
  const worker = read('supabase/functions/discovery-queue-worker/index.ts');
  const at = worker.indexOf("mode === 'admin_telegram_health'");
  assert.ok(at > 0 && worker.slice(at, at + 200).includes('isAdminCaller'), 'admin only');
  const page = read('src/pages/admin/AdminDiscoveryPage.tsx');
  for (const name of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'TELEGRAM_ENABLED']) {
    assert.ok(page.includes(name), `the hand-off names ${name}`);
  }
});

test('lead states follow the transition table on both sides', () => {
  const lead = fnBody('set_match_lead_state');
  assert.match(lead, /for update of m/);
  assert.match(lead, /INVALID_TRANSITION/);
  assert.match(lead, /MATCH_CLOSED/);
  assert.match(lead, /when 'WON'\s+then array\['CLOSED'\]/);
  const desk = read('src/services/brokerDesk.ts');
  assert.match(desk, /WON: \['CLOSED'\]/);
  assert.match(desk, /CLOSED: \['REVIEWED'\]/);
});

test('the public directory exposes only public columns; the whole-row policy is dropped', () => {
  const rows = M.slice(M.indexOf('create or replace function public.broker_directory_public_rows('), M.indexOf('$$;', M.indexOf('create or replace function public.broker_directory_public_rows(')));
  for (const secret of ['review_note', 'verification_note', 'owner_user_id']) {
    assert.doesNotMatch(rows, new RegExp(secret), `${secret} never leaves through the public view`);
  }
  assert.match(M, /drop policy if exists broker_directory_current_is_public on public\.broker_directory_listings/);
  assert.match(M, /select \* from public\.broker_directory_public_rows\(\)/);
});

test('an expired directory period is swept and its owner told; a finished search tells its owner', () => {
  const sweep = fnBody('broker_directory_expiry_sweep');
  assert.match(sweep, /set status = 'EXPIRED'/);
  assert.match(sweep, /broker-listing-expired:/);
  assert.match(sweep, /broker-listing-expiring:/);
  assert.match(M, /'homatch-broker-directory-expiry'/);
  const notify = fnBody('matching_jobs_notify_finished');
  assert.match(notify, /'matching-job-finished:' \|\| new\.id::text/, 'deduped per job');
  assert.match(notify, /exception when others then/, 'a notification never fails the job');
});

test('every new callable function is closed to anon', () => {
  for (const n of ['meta_ads_maintenance_token_ok', 'meta_ads_ledger_balance_guard', 'broker_directory_expiry_sweep',
    'matching_jobs_notify_finished', 'set_match_lead_state', 'admin_broker_detail', 'admin_discovery_overview']) {
    assert.match(M, new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon`), `${n} is not revoked from anon`);
  }
});
