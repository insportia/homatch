// Native matching has no total caps: every demand is compared with every
// candidate, every changed property with every active search, page by page,
// resumably, and nothing is retired until a pass is complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SRC = read('supabase/functions/supply-matching/index.ts');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const MIGRATION = read('supabase/migrations/20261107092700_exhaustive_native_matching.sql');

test('the 500 / 600 / newest-N windows are gone', () => {
  assert.doesNotMatch(CODE, /MAX_CANDIDATES|PROPERTY_MODE_MAX_DEMAND/);
  assert.doesNotMatch(CODE, /limit \* 4|\.slice\(0, limit\)|\.slice\(0, 50\)|\.slice\(0, MAX_DEMAND\)/);
  assert.doesNotMatch(CODE, /native_match_claim_properties/, 'the deleting claim is not used');
});

test('both candidate reads are keyset scans that throw on error', () => {
  const scans = CODE.match(/await scanAll</g) ?? [];
  assert.ok(scans.length >= 4, 'external, native, property walk, sweep walk');
  assert.match(CODE, /\.from\('supply_observations'\)[\s\S]{0,700}\.order\('id', \{ ascending: true \}\)[\s\S]{0,80}if \(after\) q = q\.gt\('id', after\);[\s\S]{0,80}if \(error\) throw error;/);
  assert.match(CODE, /\.from\('properties'\)[\s\S]{0,700}\.order\('id', \{ ascending: true \}\)[\s\S]{0,120}if \(after\) nativeQuery = nativeQuery\.gt\('id', after\);[\s\S]{0,200}if \(error\) throw error;/);
});

test('retirement waits for a complete pass and a clean write', () => {
  const incomplete = CODE.indexOf("if (!nativeScan.complete)");
  const retire = CODE.indexOf("retire_native_matches_unconfirmed");
  assert.ok(incomplete > 0 && retire > incomplete, 'incomplete passes return before retiring');
  assert.match(CODE, /if \(!dryRun && !nativeWriteFailed\)/);
  assert.match(CODE, /retire_native_matches_for_properties/);
  assert.doesNotMatch(CODE, /rpc\('retire_native_matches',/, 'the windowed keep-list retirement is gone');
});

test('an invocation out of time stores its resume point; the response says so', () => {
  assert.match(CODE, /native_match_lease_properties/);
  assert.match(CODE, /native_match_checkpoint_properties/);
  assert.match(CODE, /native_match_complete_properties/);
  assert.match(CODE, /from\('match_scan_checkpoints'\)/);
  assert.match(CODE, /coverage,/);
  assert.match(CODE, /coverage\.complete = false/);
});

test('migration: additive, service-role only, indexed', () => {
  assert.match(MIGRATION, /alter table public\.match_scan_checkpoints enable row level security/);
  assert.match(MIGRATION, /revoke all on public\.match_scan_checkpoints from public, anon, authenticated/);
  for (const fn of ['native_match_lease_properties(integer, integer)', 'native_match_complete_properties(jsonb)',
    'native_match_checkpoint_properties(jsonb, text, timestamptz, text)', 'retire_native_matches_unconfirmed(uuid, timestamptz, uuid[])',
    'retire_native_matches_for_properties(uuid, uuid[])']) {
    assert.ok(MIGRATION.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(MIGRATION.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
  assert.doesNotMatch(MIGRATION, /\bdrop table\b|\bdelete from public\.supply_matches\b|truncate/i);
  assert.match(MIGRATION, /active_search_subscriptions_active_intent_idx/);
});
