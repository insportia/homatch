// THE NATIVE PIPELINE IS CONNECTED, AND STAYS CONNECTED.
//
// Every stage of "somebody said something in Homatch → a native match two real accounts
// can act on" existed as code before this file and none of it was reachable: the intent
// upsert named a conflict target the database could not honour, the native match upsert
// named a partial index PostgREST cannot target, the chat reader called a function that
// refused its credentials, and nothing woke either worker. Each of those was a line of
// code that looked right. These assertions hold the joints, because the joints are where
// it broke.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const migration = read('supabase', 'migrations', '20260928010000_native_intent_pipeline.sql');
const pipeline = read('supabase', 'functions', '_shared', 'nativeDemand.ts');
const reader = read('supabase', 'functions', 'ingest-live-chat', 'index.ts');
const matcher = read('supabase', 'functions', 'supply-matching', 'index.ts');
const sender = read('supabase', 'functions', 'send-message', 'index.ts');
const viewing = read('supabase', 'functions', 'viewing-request', 'index.ts');
const planner = read('supabase', 'functions', 'find-property-plan', 'index.ts');

test('the reader is woken by a committed message and by a schedule', () => {
  assert.match(migration, /create trigger live_chat_messages_wake_native_intent/);
  assert.match(migration, /after insert or update of body, edited_at, deleted_at on public\.live_chat_messages/);
  assert.match(migration, /create trigger ai_messages_wake_native_intent/);
  assert.match(migration, /'homatch-native-intent',\s*'\* \* \* \* \*'/);
  assert.match(migration, /'homatch-supply-matching',\s*'\*\/15 \* \* \* \*'/);
  /* A wake-up is a hint and carries nothing anybody wrote. */
  assert.match(migration, /body := jsonb_build_object\('source', tg_table_name\)/);
  assert.ok(!/new\.body|NEW\.body|new\.content/.test(migration), 'a message body travels in a wake-up');
});

test('the scheduled matcher runs against the Homatch network only', () => {
  assert.match(migration, /"nativeOnly":true/, 'the schedule starts external matching');
  assert.match(pipeline, /nativeOnly: true/, 'a chat requirement asks for external matching');
  assert.match(matcher, /nativeOnly \? \{ data: \[\] as Record<string, unknown>\[\] \} : await db/,
    'a network-only run still reads external supply');
});

test('reading a conversation calls no model and charges nothing', () => {
  for (const source of [reader, pipeline]) {
    assert.ok(!/openai|OPENAI_API_KEY|functions\.invoke\('find-property-plan'/i.test(source));
    assert.ok(!/reserve|capture_credits|credit_ledger|wallet/i.test(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')),
      'the intent pipeline touches billing');
  }
  assert.match(reader, /charged: \{ credits: 0 \}/);
});

test('edits are re-read under their own revision and deletions withdraw', () => {
  assert.match(reader, /withdrawIntentFor\(db, 'LIVE_CHAT', String\(row\.id\), 'SOURCE_EDITED', revision\)/);
  assert.match(reader, /withdrawIntentFor\(db, 'LIVE_CHAT', String\(row\.id\), 'SOURCE_DELETED'\)/);
  assert.match(reader, /CHANGED_CURSOR/, 'edits are found by rescanning the room');
  assert.match(migration, /add column if not exists source_revision text not null default ''/);
});

test('legacy AI chat extractions are not read; new AI messages are, as the author', () => {
  assert.ok(!/ai_chat_leads/.test(reader.replace(/\/\/.*$/gm, '')), 'the legacy extraction is being read');
  assert.match(reader, /\.from\('ai_messages'\)/);
  assert.match(reader, /String\(row\.role\) !== 'user'/, 'the assistant\'s own words are read as a requirement');
  assert.match(reader, /\.eq\('auth_id', authId\)/, 'the AI actor is not resolved to a Homatch account');
});

test('only the author\'s own words become their search', () => {
  assert.match(pipeline, /if \(effective !== 'SELF'\) return \{ demand: 'NOT_SELF'/);
  /* Somebody talking about their own listing is not interested in it. */
  assert.match(reader, /row\.user_id !== message\.actorUserId/);
  assert.match(sender, /propertyOwner !== sender\.id/);
  assert.match(migration, /if v_owner is null or v_owner = \(p->>'demand_user_id'\)::uuid then return null/);
});

test('no body is copied into the intent layer, a relationship or a match', () => {
  assert.ok(!/^\s*(body|content|message|message_text|text_body|excerpt)\s/m.test(
    (migration.match(/create table if not exists public\.native_property_relationships \(([\s\S]*?)\);/) ?? ['', ''])[1]
      .replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
  ), 'native_property_relationships has a column for what somebody wrote');
  assert.ok(!/text: event\.text|text: message\.text/.test(
    pipeline.slice(pipeline.indexOf('await recordIntent(')),
  ));
});

test('every surface feeds the same pipeline', () => {
  assert.match(reader, /recordDemandFrom\(db,/);
  assert.match(sender, /recordDemandFrom\(supabase,/);
  assert.match(sender, /projectPropertyInterest\(supabase, sender\.id, propertyContext/);
  assert.match(viewing, /projectPropertyInterest\(supabase,actor\.id,property_id/);
  assert.match(viewing, /withdrawIntentFor\(supabase,'VIEWING_REQUEST'/);
  assert.match(planner, /requestNativeMatching\(\[String\(intent\.id\)\]\)/);
});

test('one conversation per pair and property, decided by the database', () => {
  assert.match(migration, /create unique index if not exists conversations_canonical_pair_key/);
  assert.match(migration, /least\(initiator_id, recipient_id\),\s*greatest\(initiator_id, recipient_id\)/);
  assert.match(sender, /rpc\('ensure_conversation'/);
  assert.ok(!/from\('conversations'\)\.insert/.test(sender), 'send-message still inserts conversations itself');
});

test('the customer actions decide authorisation on the server', () => {
  for (const fn of ['open_native_conversation', 'reveal_native_contact', 'my_native_matches']) {
    const body = migration.slice(migration.indexOf(`create or replace function public.${fn}`));
    assert.match(body.slice(0, 4000), /current_homatch_user_id\(\)/, `${fn} does not resolve the caller`);
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`),
      `${fn} is callable anonymously`);
  }
  const reveal = migration.slice(migration.indexOf('create or replace function public.reveal_native_contact'));
  assert.match(reveal, /v_me not in \(v_supply, v_demand\)/, 'a stranger can ask for a number');
  assert.match(reveal, /conversation_contact_shares/, 'the owner reaches a number that was never shared');
  assert.match(reveal, /insert into public\.contact_disclosures/, 'a disclosure is not recorded');
  /* Internal service functions are not reachable from a browser at all. */
  for (const fn of ['ensure_conversation', 'upsert_native_match', 'upsert_property_relationship', 'retire_native_matches']) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
  }
});

test('the customer list shows people by the name they chose, never contact details', () => {
  const list = migration.slice(migration.indexOf('create or replace function public.my_native_matches'),
    migration.indexOf('grant execute on function public.my_native_matches'));
  assert.ok(!/email|phone|contact_phone/.test(list), 'the native match list exposes contact details');
  assert.match(list, /r\.state = 'INTERESTED' or r\.viewing_requested/,
    'an enquiry alone is presented to an owner as interest');
});
