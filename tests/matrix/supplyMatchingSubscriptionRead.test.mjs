// THE EMBED THAT HAD NO RELATIONSHIP.
//
// supply-matching read demand as
//   intent_profiles?select=...,subscriptions:active_search_subscriptions!intent_id(...)
// but active_search_subscriptions.intent_id has never carried a foreign key
// (20260911140000_phase3_schema.sql declares it as a bare uuid). PostgREST
// embeds only along a relationship it can see, so every cron tick failed with
// PGRST200 and the catch rendered the PostgrestError plain object as
// `{"error":"[object Object]"}` — HTTP 500 every 15 minutes in production
// (measured 2026-10-09 in net._http_response) and no supply_matches row
// written after 2026-09-27.
//
// The fix reads subscriptions in a second query and attaches them under the
// same `subscriptions` name, and the catch now names a non-Error failure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(path.join(root, 'supabase/functions/supply-matching/index.ts'), 'utf8');
const MIGRATIONS = readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'))
  .join('\n');

test('premise: no migration gives active_search_subscriptions.intent_id a foreign key', () => {
  // If one is ever added, the embed becomes possible again — revisit this test then.
  assert.doesNotMatch(MIGRATIONS, /intent_id\s+uuid[^,;\n]*references\s+(public\.)?intent_profiles/i);
  assert.doesNotMatch(MIGRATIONS, /foreign key\s*\(\s*intent_id\s*\)\s*references\s+(public\.)?intent_profiles/i);
});

test('supply-matching does not embed active_search_subscriptions through intent_id', () => {
  assert.doesNotMatch(SRC, /active_search_subscriptions[^'`]*!intent_id/);
});

test('subscriptions are read explicitly by intent_id and attached to each demand row', () => {
  assert.match(SRC, /\.from\('active_search_subscriptions'\)\s*\.select\('intent_id,user_id,is_active,side,search_criteria'\)\s*\.in\('intent_id', profileIds\)/);
  assert.match(SRC, /subscriptions: subscriptionsByIntent\.get\(String\(row\.id\)\) \?\? \[\]/);
  // A network-only run keeps only demand with an active subscription (was the !inner join).
  assert.match(SRC, /!nativeOnly \|\| row\.subscriptions\.some\(\(sub\) => sub\.is_active === true\)/);
});

test('a PostgrestError is never rendered as [object Object]', () => {
  assert.match(SRC, /return json\(\{ error: describeError\(error\) \}, 500\)/);
  assert.match(SRC, /function describeError\(error: unknown\): string/);
  assert.doesNotMatch(SRC, /error instanceof Error \? error\.message : String\(error\) \}, 500/);
});

test('native demand projection recognises its own subscriptions without the FK-less embed', () => {
  const NATIVE = readFileSync(path.join(root, 'supabase/functions/_shared/nativeDemand.ts'), 'utf8');
  assert.doesNotMatch(NATIVE, /intent_profiles!intent_id/);
  assert.match(NATIVE, /\.from\('intent_profiles'\)\.select\('id,transaction_type,classifier_version'\)\.in\('id', intentIds\)/);
});
