import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * ADMIN OPERATIONS — STATIC.
 *
 * Proven in production as a real admin (is_admin = true), rolled back:
 *
 *   markets_toggle_rows=0   admin_settings_rows=1   missing_key_rows=0
 *
 * The markets switch has never worked. public.markets has RLS enabled and one
 * policy -- markets_public_read [SELECT]. There is no UPDATE policy for
 * anyone, so the page's `.update({enabled})` matched zero rows, PostgREST
 * returned 204 with no error, the `if (error)` branch never fired, and the
 * toast said "Market enabled". Which markets are enabled decides where the
 * product operates.
 *
 * A settings key with no row had the same shape: UPDATE ... WHERE key = $1
 * matches nothing, reports nothing, and the spend cap or pricing knob the
 * admin thought they had set does not exist.
 *
 * And nothing was audited. admin_audit_log has existed since 00033_phase7 and
 * held ZERO rows -- across provider_kill_switch, the spend caps and the credit
 * pricing table.
 *
 * After the fix, same probe, rolled back:
 *
 *   market t->f  created_key=1  audit_rows=2  nonadmin=FORBIDDEN
 */

const ROOT = process.cwd();
const sql = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260911210000_admin_mutations_audited.sql'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'src', 'services', 'api.ts'), 'utf8');
const marketsPage = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'admin', 'AdminMarketsPage.tsx'), 'utf8');

const apiCode = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const marketsCode = marketsPage.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every admin mutation checks that the caller is an admin', () => {
  for (const fn of ['admin_set_setting', 'admin_set_market_enabled']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
    assert.match(body.slice(0, 2000), /u\.auth_id = auth\.uid\(\) and u\.is_admin = true/,
      `${fn} must verify the caller`);
    assert.match(body.slice(0, 2000), /raise exception 'FORBIDDEN'/, `${fn} must refuse a non-admin`);
  }
});

test('every admin mutation writes an audit row', () => {
  for (const fn of ['admin_set_setting', 'admin_set_market_enabled']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
    assert.match(body.slice(0, 3000), /insert into public\.admin_audit_log/, `${fn} must be auditable`);
    // Both sides of the change, so the log says what actually happened.
    assert.match(body.slice(0, 3000), /'old', v_old/, `${fn} must record the previous value`);
  }
});

test('a settings key that was never seeded is created, not skipped', () => {
  assert.match(sql, /insert into public\.admin_settings \(key, value, updated_at\)/);
  assert.match(sql, /on conflict \(key\) do update/);
});

test('the markets toggle goes through the RPC', () => {
  assert.match(marketsCode, /supabase\.rpc\('admin_set_market_enabled'/);
  assert.ok(
    !/from\('markets'\)\s*\n?\s*\.update\(/.test(marketsCode),
    'markets has no UPDATE policy — a direct write can only be a silent no-op'
  );
});

test('a market that does not exist is an error, not a quiet success', () => {
  assert.match(sql, /raise exception 'MARKET_NOT_FOUND'/);
});

test('admin settings writes go through the RPC and throw on failure', () => {
  assert.match(apiCode, /supabase\.rpc\('admin_set_setting'/);
  const fn = apiCode.slice(apiCode.indexOf('export async function updateAdminSetting'));
  assert.match(fn.slice(0, 500), /if \(error\) throw new Error/);

  // The screens already had try/catch around these calls; the helper never
  // threw, so those branches were unreachable.
  assert.ok(
    !/from\('admin_settings'\)\s*\n?\s*\.update\(/.test(apiCode),
    'no direct admin_settings UPDATE should remain'
  );
});

test('pricing and spend caps reuse the audited path', () => {
  for (const name of ['updatePricingConfig', 'updateSpendCaps']) {
    const fn = apiCode.slice(apiCode.indexOf(`export async function ${name}`));
    assert.match(fn.slice(0, 900), /updateAdminSetting\(/, `${name} must not write admin_settings directly`);
  }
});

test('anonymous callers cannot reach an admin mutation', () => {
  assert.match(sql, /revoke all on function public\.admin_set_setting\(text, jsonb, text\) from public, anon/);
  assert.match(sql, /revoke all on function public\.admin_set_market_enabled\(uuid, boolean\) from public, anon/);
});
