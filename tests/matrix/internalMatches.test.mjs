// HOMATCH INTERNAL MATCHES — source-level guards.
//
//   * the DEMO lives only in demo_* tables: the migration never writes a real table,
//     never notifies, never creates a user, never touches credits, and every RPC is
//     gated on the demo audience;
//   * the owner's page counts HOMATCH members and external leads apart (no merged
//     headline) and keeps FindBuyersResults as-is under its own heading;
//   * the worker and the profile view share one native-pair mapping;
//   * the demo UI never reaches the real messaging stack.
// The behavioural proof is tests/sql/run-internal-match-demo.sh (local Postgres).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = read('supabase', 'migrations', '20261024120000_internal_match_demo.sql');
/* SQL without comments, so prose about what it does NOT do cannot satisfy or trip a check. */
const SQL = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

const fnBody = (name) => {
  const start = SQL.search(new RegExp(`create or replace function public\\.${name}\\(`));
  assert.ok(start >= 0, `${name} is defined`);
  const end = SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2);
  return SQL.slice(start, end);
};

const DEMO_RPCS = ['demo_internal_match_for_property', 'demo_open_conversation', 'demo_send_message', 'demo_list_messages', 'demo_unlock_contact'];

test('the demo writes only demo tables', () => {
  const writes = [...SQL.matchAll(/\b(insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)/gi)].map((m) => m[2]);
  const allowed = new Set(['demo_buyer_profiles', 'demo_conversations', 'demo_messages', 'admin_settings']);
  const offenders = writes.filter((table) => !allowed.has(table));
  assert.deepEqual(offenders, [], `the demo migration writes a real table: ${offenders.join(', ')}`);
  /* admin_settings: only the testers key, only on first apply. */
  assert.match(SQL, /insert into public\.admin_settings[\s\S]*?'internal_match_demo_testers'[\s\S]*?on conflict \(key\) do nothing/);
  assert.doesNotMatch(SQL, /update\s+public\.admin_settings/);
});

test('no notification, no push, no network, no credits, no user', () => {
  assert.doesNotMatch(SQL, /notify|push_send|net\.http_post|pg_notify/i, 'the demo never notifies');
  assert.doesNotMatch(SQL, /public\.(credit|billing|wallet|usage_reservation|cost_event|ledger|unlock)/i, 'the demo never touches money');
  assert.doesNotMatch(SQL, /insert\s+into\s+public\.(conversations|messages|message_receipts|supply_matches|matches|find_buyers_leads|notifications)\b/i);
  assert.doesNotMatch(SQL, /insert\s+into\s+(public\.users|auth\.users)/i, 'never fabricates a HOMATCH user');
});

test('every demo RPC is gated on the demo audience and closed to anon', () => {
  for (const name of DEMO_RPCS) {
    const body = fnBody(name);
    assert.match(body, /security definer/i, `${name} is security definer`);
    assert.match(body, /internal_match_demo_allowed\(\)|demo_conversation_guard\(/, `${name} checks the demo audience`);
    assert.match(SQL, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`), `${name} revoked from anon`);
  }
  assert.match(fnBody('internal_match_demo_allowed'), /is_admin\(\)[\s\S]*internal_match_demo_testers/);
  assert.match(fnBody('demo_conversation_guard'), /internal_match_demo_allowed\(\)/);
  assert.match(fnBody('demo_conversation_guard'), /owner_user_id = public\.current_homatch_user_id\(\)/, 'a viewer only reaches their own conversation');
  for (const table of ['demo_buyer_profiles', 'demo_conversations', 'demo_messages']) {
    assert.match(SQL, new RegExp(`alter table public\\.${table}\\s+enable row level security`), `${table} has RLS`);
    assert.match(SQL, new RegExp(`create policy [a-z_]+ on public\\.${table}[\\s\\S]*?internal_match_demo_allowed\\(\\)`), `${table} policy checks the audience`);
  }
});

test('exactly one demo buyer, idempotent on a fixed key, for HOMATCH 244486', () => {
  const seeds = [...SQL.matchAll(/insert into public\.demo_buyer_profiles/g)];
  assert.equal(seeds.length, 1);
  assert.match(SQL, /demo_key\s+text not null unique/);
  assert.match(SQL, /'internal-match-demo-244486'[\s\S]*?c5c1a6a4-6fed-4764-91c2-3cd7ad090407[\s\S]*?on conflict \(demo_key\) do nothing/);
  /* The property's facts are read at runtime, never copied into the seed. */
  assert.doesNotMatch(SQL, /213840|97\.2/);
  assert.match(fnBody('demo_internal_match_for_property'), /from public\.property_facts/);
});

test('the simulated reply is a fixed, labelled template in six languages', () => {
  const template = fnBody('demo_reply_template');
  for (const lang of ['ka', 'ru', 'tr', 'ar', 'he']) assert.match(template, new RegExp(`when '${lang}' then array\\[`));
  const send = fnBody('demo_send_message');
  assert.match(send, /'DEMO_BUYER', public\.demo_reply_template\([^)]*\), true/, 'the reply row is is_simulated = true');
  assert.match(send, /delivered_at[\s\S]*seen_at/, 'delivery clock recorded');
  assert.match(fnBody('demo_unlock_contact'), /'charged_credits', 0/);
});

test('the owner page counts internal and external apart, never merged', () => {
  const page = read('src', 'pages', 'property', 'MatchesPage.tsx');
  assert.doesNotMatch(page, /counts\.total \+ leadCount\)/, 'the merged headline is gone');
  assert.doesNotMatch(page, /matches_count_line/);
  assert.match(page, /t\('im_count_line', \{[\s\S]*?internal: String\(sectionTotals\.internal\)[\s\S]*?external: String\(sectionTotals\.external\)/);
  assert.match(page, /<InternalMatchesSection/);
  assert.match(page, /<ExternalLeadsHeader/);
  assert.match(page, /<FindBuyersResults\s/, 'external leads still render through the unchanged component');
  assert.doesNotMatch(page, /NativeMatchesPanel/, 'members render in the HOMATCH section only');
  const section = read('src', 'components', 'matching', 'internal', 'InternalMatchesSection.tsx');
  assert.match(section, /groupByPerson\(/, 'one person, one card');
  assert.doesNotMatch(section, /FindBuyersResults|find_buyers/, 'nothing external is counted internally');
});

test('the worker and the profile view share one mapping', () => {
  const worker = read('supabase', 'functions', 'supply-matching', 'index.ts');
  assert.match(worker, /from '\.\.\/\.\.\/\.\.\/src\/research-core\/match\/native-pair\.ts'/);
  assert.match(worker, /demandSideFromIntentProfile\(/);
  assert.match(worker, /strengthFromCriteria\(criteria\)/);
  assert.match(worker, /const MIN_AGREEMENTS = NATIVE_MIN_AGREEMENTS;/);
  const view = read('src', 'matching', 'internalMatch.ts');
  assert.match(view, /assessNativePair\(demand, supply\)/);
  assert.doesNotMatch(view, /score:\s*\d/, 'no hard-coded score');
});

test('the demo UI never reaches the real messaging stack', () => {
  for (const file of [
    ['src', 'services', 'internalMatchDemo.ts'],
    ['src', 'pages', 'property', 'DemoConversationPage.tsx'],
  ]) {
    const src = read(...file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /send-message|from\('messages'\)|from\('conversations'\)|api3|ensure_conversation|notify/, `${file.join('/')} stays in the demo channel`);
  }
  const routes = read('src', 'routes.tsx');
  assert.match(routes, /path: '\/property\/:id\/matches\/demo\/:conversationId'/);
  assert.doesNotMatch(read('src', 'pages', 'property', 'DemoConversationPage.tsx'), /seed-demo-matches/);
});
