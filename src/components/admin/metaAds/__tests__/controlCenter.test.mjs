// The Meta Ads Admin Control Center, read from source: every control is a
// server act (role checked, reason required, validated, audited), campaign
// state is the canonical one, and API health carries booleans, never values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../../../../${p}`, import.meta.url), 'utf8');
const page = read('src/pages/admin/AdminMetaAdsPage.tsx');
const actions = read('supabase/functions/meta-ads-api/actions.ts');
const index = read('supabase/functions/meta-ads-api/index.ts');
const health = read('src/components/admin/metaAds/ApiHealthPanel.tsx');

/** The body of one `case 'name':` up to the next case/default at the same indent. */
const caseBody = (src, name) => {
  const start = src.indexOf(`case '${name}':`);
  assert.ok(start >= 0, `${name} exists`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {6}(case '|default:)/);
  return rest.slice(0, next < 0 ? undefined : next);
};

test('every admin action refuses a non-admin before it does anything', () => {
  const names = [...`${actions}\n${index}`.matchAll(/case '(admin_\w+)':/g)].map((m) => m[1]);
  assert.ok(names.length >= 10, names.join(','));
  for (const n of names) {
    const body = caseBody(actions.includes(`case '${n}':`) ? actions : index, n);
    const firstStatement = body.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').slice(1).map((l) => l.trim()).find((l) => l && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('//'));
    assert.match(firstStatement, /if \(!me\.is_admin/, `${n} checks the role first`);
  }
});

test('Overview and Campaigns count and filter with the canonical status, not a raw status column', () => {
  assert.doesNotMatch(page, /q\.eq\('status', 'ACTIVE'\)/, 'the old raw ACTIVE count is gone');
  assert.doesNotMatch(page, /if \(status !== 'ALL'\) q = q\.eq\('status'/, 'no raw-status server filter');
  assert.match(page, /adminCounts\(\(campaigns \?\? \[\]\)\.map\(asRow\), Date\.now\(\)\)/);
  assert.match(page, /matchesAdminFilter\(c, view, now\)/, 'the list a KPI opens uses the same rule');
  assert.match(read('src/lib/metaAds/adminView.ts'), /from '\.\/uiStatus\.ts'/, 'built on the customer dashboard\'s function');
  // HOMATCH lifecycle, canonical delivery and Meta's word are all on the row.
  for (const attr of ['data-mm-lifecycle', 'data-mm-meta-status', 'data-mm-sync', 'data-mm-discrepancy', '<CampaignStatusChip campaign={c} />']) assert.ok(page.includes(attr), attr);
});

test('settings and moderation are never written from the browser', () => {
  assert.doesNotMatch(page, /from\('admin_settings'\)\s*\.update/);
  assert.doesNotMatch(page, /from\('meta_moderation_cases'\)\s*\.update/);
  assert.doesNotMatch(page, /window\.prompt/);
  assert.match(page, /action: 'admin_setting_set', key: settingKey, value: check\.value, reason/);
  assert.match(page, /action: 'admin_moderation_decide', caseId, decision, note/);
});

test('admin_setting_set: admin and not suspended, a reason, a known key, server validation, audit with before/after — or nothing changes', () => {
  const b = caseBody(actions, 'admin_setting_set');
  assert.match(b, /!me\.is_admin \|\| me\.suspended_at/);
  assert.match(b, /REASON_REQUIRED/);
  assert.match(b, /isCredentialKey\(key\)/);
  assert.match(b, /validateSetting\(key, body\.value, current\)/);
  assert.match(b, /from\('admin_audit_log'\)\.insert/);
  assert.match(b, /metadata: \{ key, previous, next: check\.value, reason \}/);
  assert.match(b, /if \(aErr\) \{\s*await sb\.from\('admin_settings'\)\.update\(\{ value: previous \}\)/, 'an unaudited change is put back');
  assert.match(b, /if \(!\(key in current\)\)/, 'no new keys are created');
});

test('admin_moderation_decide: open cases only, a note, the canonical transition map, audited; approval readies nothing', () => {
  const b = caseBody(actions, 'admin_moderation_decide');
  assert.match(b, /\.eq\('status', 'OPEN'\)/);
  assert.match(b, /NOT_OPEN/);
  assert.match(b, /REASON_REQUIRED/);
  assert.match(b, /canTransition\(c\.status, to\)/);
  assert.match(b, /decision !== 'APPROVED'/);
  assert.match(b, /x\.audit\(sb, uid, `META_MODERATION_\$\{decision\}`/);
});

test('Guard, fees, balance adjustments and manual sync stay on their audited server paths', () => {
  const guard = caseBody(actions, 'admin_guard_act');
  assert.match(guard, /REASON_REQUIRED/);
  assert.match(guard, /meta_guard_admin_actions/);
  assert.match(guard, /x\.audit\(/);
  assert.match(caseBody(actions, 'admin_fee_policy_set'), /x\.userClient\.rpc\('admin_set_meta_fee_policy'/);
  assert.match(caseBody(index, 'admin_adjust'), /userClient\.rpc\('admin_meta_adjust_balance'/);
  assert.match(caseBody(index, 'admin_sync'), /audit\(sb, uid, 'META_ADMIN_SYNC'/);
});

test('API health is sanitized by construction: every secret is reported as a boolean', () => {
  const b = caseBody(index, 'admin_test_connection');
  const envReads = [...b.matchAll(/(.{2})Deno\.env\.get\(/g)].map((m) => m[1]);
  assert.ok(envReads.length >= 3);
  assert.ok(envReads.every((p) => p === '!!'), 'only !!Deno.env.get(...) — never a value');
  assert.doesNotMatch(b, /access_token|meta_tokens|oauth_nonce|app_secret/);
  assert.match(b, /lastStatusSyncAt/);
  assert.match(b, /lastUsageReportAt/);
  assert.doesNotMatch(health, /access_token|app_secret|appsecret|oauth_nonce/i);
  assert.match(health, /data-mm-probe-value=\{on \? 'set' : 'missing'\}/);
});
