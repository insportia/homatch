// Meta's own usage headers decide how hard HOMATCH may call the Marketing API.
// A throttle is never mistaken for "reconnect your account", never retried in
// the same call, and the every-minute status pass reads each ad account with
// two grouped calls — never one call per campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBucHeader, parseAdAccountUsage, pressureOf, allowance, isThrottleError } from '../rateLimit.ts';
import { normalizeMetaError } from '../errors.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

test('X-Business-Use-Case-Usage parses per bucket and type; junk yields nothing', () => {
  const raw = JSON.stringify({ '1234': [
    { type: 'ads_management', call_count: 3, total_cputime: 1, total_time: 2, estimated_time_to_regain_access: 0, ads_api_access_tier: 'development_access' },
    { type: 'ads_insights', call_count: 12, total_cputime: 4, total_time: 9, estimated_time_to_regain_access: 0, ads_api_access_tier: 'development_access' },
  ] });
  const e = parseBucHeader(raw);
  assert.equal(e.length, 2);
  assert.deepEqual(e[1], { bucket: '1234', type: 'ads_insights', callCount: 12, totalCputime: 4, totalTime: 9, regainMinutes: 0, tier: 'development_access' });
  assert.deepEqual(parseBucHeader(null), []);
  assert.deepEqual(parseBucHeader('{not json'), []);
  assert.deepEqual(parseBucHeader('"x"'), []);
  assert.deepEqual(parseAdAccountUsage('{"acc_id_util_pct":7.5,"reset_time_duration":0,"ads_api_access_tier":"standard_access"}'), { utilPct: 7.5, resetSeconds: 0, tier: 'standard_access' });
  assert.equal(parseAdAccountUsage('nope'), null);
});

test('pressure follows the highest of Meta\'s percentages; a regain time means stop', () => {
  const e = (c, cpu = 0, t = 0, regain = 0) => ({ callCount: c, totalCputime: cpu, totalTime: t, regainMinutes: regain });
  assert.equal(pressureOf([]), 'NORMAL');
  assert.equal(pressureOf([e(10, 20, 49)]), 'NORMAL');
  assert.equal(pressureOf([e(50)]), 'ELEVATED');
  assert.equal(pressureOf([e(1, 76)]), 'HIGH');
  assert.equal(pressureOf([e(1), e(1, 1, 95)]), 'CRITICAL');
  assert.equal(pressureOf([e(1, 1, 1, 12)]), 'THROTTLED');
});

test('under pressure the optional work stops first and campaign state last', () => {
  assert.deepEqual(allowance('NORMAL', 7), { status: true, insights: true, insightsSlowdown: 1, breakdowns: true });
  assert.deepEqual(allowance('ELEVATED', 7), { status: true, insights: true, insightsSlowdown: 2, breakdowns: false });
  assert.deepEqual(allowance('HIGH', 7), { status: true, insights: false, insightsSlowdown: 1, breakdowns: false });
  assert.equal(allowance('CRITICAL', 7).status, false);
  assert.equal(allowance('CRITICAL', 10).status, true, 'every fifth minute only');
  assert.equal(allowance('THROTTLED', 10).status, false, 'nothing until Meta says so');
});

test('a throttle is a throttle even when Meta labels it OAuthException', () => {
  for (const code of ['4', '17', '32', '613']) {
    const n = normalizeMetaError({ code, type: 'OAuthException', message: 'limit' });
    assert.equal(n.throttled, true, code);
    assert.notEqual(n.action, 'RECONNECT', code);
    assert.ok(isThrottleError(code, ''));
  }
  const buc = normalizeMetaError({ code: 80004, error_subcode: 80004, type: 'OAuthException' });
  assert.equal(buc.throttled, true);
  assert.ok(isThrottleError('80004', '80004'));
  assert.ok(isThrottleError('100', '80000'));
  assert.equal(normalizeMetaError({ code: 190, type: 'OAuthException' }).action, 'RECONNECT');
  assert.equal(isThrottleError('190', ''), false);
});

test('every Graph response feeds the usage record, and a throttle is not retried in-call', () => {
  const shared = read('supabase/functions/_shared/metaAds.ts');
  assert.match(shared, /captureUsage\(res\.headers\)/);
  assert.match(shared, /x-business-use-case-usage/);
  assert.match(shared, /normalized\.throttled/);
  assert.match(shared, /upsert\(rows, \{ onConflict: 'bucket,type' \}\)/);
  const mig = read('supabase/migrations/20261002130000_meta_api_usage.sql');
  assert.match(mig, /enable row level security/i);
  const cols = mig.slice(mig.indexOf('create table'), mig.indexOf(');')).replace(/--.*$/gm, '');
  assert.doesNotMatch(cols, /token|secret|credential/i, 'usage rows carry percentages, never credentials');
});

test('the every-minute pass groups by ad account: two Graph reads per account, pressure-gated', () => {
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const recon = engine.slice(engine.indexOf('export async function reconcileAccountStatuses'), engine.indexOf('export async function applyStatus'));
  assert.equal((recon.match(/await graphAll\(/g) ?? []).length, 2, 'campaigns + ads, once per account');
  assert.match(recon, /operator: 'IN', value: ids/);
  assert.doesNotMatch(recon, /for \(const c of rows\)[\s\S]*graph(All)?\(/, 'no per-campaign Graph call');
  const idx = read('supabase/functions/meta-ads-api/index.ts');
  const sync = idx.slice(idx.indexOf('async function statusSync'), idx.indexOf('/* ── MAINTENANCE'));
  assert.match(sync, /\$\{c\.user_id\}\|\$\{c\.ad_account_external_id\}/);
  assert.match(sync, /allowance\(pressureOf\(mine\), minute\)\.status/);
  assert.match(sync, /minute % 5 === 0 \? \[[^\]]*'PAUSED'\]/, 'paused every fifth minute');
  assert.match(sync, /last_synced_at\.lt\.\$\{fresh\}/, 'recently synced campaigns are skipped');
  assert.match(sync, /await flushApiUsage\(sb\)/);
  assert.match(read('supabase/migrations/20261002120000_meta_ads_status_sync_cron.sql'), /'\* \* \* \* \*'/);
});
