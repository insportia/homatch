// The migration, read as a document.
//
// A migration is the one artefact in this repository that cannot be rolled
// back by editing a file, so the properties that matter are structural: it
// must be additive, idempotent, and it must not weaken anything that already
// protects data.
//
// It also must not create a parallel source family. `source_registry` and
// `raw_signals` already exist and are already read by classify-signals-v2,
// intent_profiles, property_signal_candidates and the matching engine. Two
// answers to "where do we research" would be two things to keep in step, and
// the second one would rot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const FILE = '20260918120000_research_core_source_graph.sql';
const SQL = readFileSync(join(MIGRATIONS, FILE), 'utf8');

/** Statements only — the reasoning lives in comments and must stay readable. */
const STATEMENTS = SQL
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

test('it sorts after every migration that already exists', () => {
  const others = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f !== FILE).sort();
  const last = others[others.length - 1];
  assert.ok(FILE > last, `${FILE} sorts before ${last}`);
});

test('nothing is dropped, renamed or rewritten', () => {
  for (const destructive of [
    /\bdrop\s+table\b/i,
    /\bdrop\s+column\b/i,
    /\bdrop\s+type\b/i,
    /\bdrop\s+function\b/i,
    /\bdrop\s+index\b/i,
    /\brename\s+to\b/i,
    /\balter\s+column\b[\s\S]{0,40}\btype\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
  ]) {
    assert.ok(!destructive.test(STATEMENTS), `contains ${destructive}`);
  }
});

test('no existing policy is dropped or replaced', () => {
  // Dropping a policy to recreate it leaves a window with no policy at all.
  assert.ok(!/\bdrop\s+policy\b/i.test(STATEMENTS));
  assert.ok(!/\balter\s+policy\b/i.test(STATEMENTS));
});

test('every statement is idempotent, so a re-run is safe', () => {
  const creates = STATEMENTS.match(/create\s+(table|index|unique index)[^;]*/gi) ?? [];
  assert.ok(creates.length > 0);
  for (const statement of creates) {
    assert.match(statement, /if not exists/i, statement.slice(0, 80));
  }

  const alters = STATEMENTS.match(/add column\s+[a-z_]+/gi) ?? [];
  assert.ok(alters.length > 0, 'no columns are added');
  for (const statement of STATEMENTS.match(/add column[^,;]*/gi) ?? []) {
    assert.match(statement, /add column if not exists/i, statement.slice(0, 60));
  }

  // Constraints are guarded by an existence check rather than blind ADD.
  for (const name of ['source_registry_access_state_check', 'raw_signals_research_direction_check']) {
    assert.ok(STATEMENTS.includes(name));
  }
  assert.match(STATEMENTS, /from pg_constraint where conname/i);
  assert.match(STATEMENTS, /from pg_policies/i);
});

test('it extends the tables that exist instead of creating a parallel family', () => {
  assert.match(STATEMENTS, /alter table public\.source_registry/i);
  assert.match(STATEMENTS, /alter table public\.raw_signals/i);

  const created = [...STATEMENTS.matchAll(/create table if not exists public\.([a-z_]+)/gi)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(created, ['research_access_connections', 'research_access_requests']);

  // Nothing that would shadow what already exists.
  for (const shadow of ['sources', 'research_sources', 'signals', 'research_signals', 'discovered_sources']) {
    assert.ok(!created.includes(shadow), `created a parallel ${shadow} table`);
  }
});

test('the existing singular language column is kept, not replaced', () => {
  // Every current reader of source_registry.language keeps working; the
  // plural array is added beside it.
  assert.ok(!/drop column\s+language/i.test(STATEMENTS));
  assert.match(STATEMENTS, /add column if not exists languages text\[\]/i);
});

test('the direction column sits beside intent_type rather than replacing it', () => {
  // Direction is a coarser, earlier, cheaper question than intent, and
  // classify-signals-v2 keeps owning intent_type.
  assert.match(STATEMENTS, /add column if not exists research_direction text/i);
  assert.ok(!/drop column\s+intent_type/i.test(STATEMENTS));
  assert.match(SQL, /intent_type.{0,120}classify-signals-v2/s);
});

test('both new tables enable RLS and are admin-or-service only', () => {
  for (const table of ['research_access_connections', 'research_access_requests']) {
    assert.match(STATEMENTS, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(STATEMENTS, new RegExp(`${table}_admin_only`));
    assert.match(STATEMENTS, new RegExp(`${table}_service_all`));
  }
  // No `to authenticated using (true)` anywhere — that would expose the
  // access queue and the connection health to every signed-in customer.
  assert.ok(!/to authenticated\s+using \(true\)/i.test(STATEMENTS));
});

test('every check constraint states its full allowed set', () => {
  assert.match(STATEMENTS, /'PUBLIC','AUTHENTICATED_ACCESS','JOIN_REQUIRED','INACCESSIBLE','DEGRADED'/);
  assert.match(STATEMENTS, /'DEMAND','SUPPLY','REFERENCE','UNKNOWN'/);
  assert.match(STATEMENTS, /'PUBLIC','AUTHENTICATED','FIRST_PARTY'/);
  assert.match(STATEMENTS, /'REQUESTED','IN_PROGRESS','APPROVED','REJECTED','DENIED_BY_PLATFORM'/);
});

test('there is no access-request state meaning "joined automatically"', () => {
  const states = STATEMENTS.match(/state in \(\s*([^)]+)\)/i);
  assert.ok(states);
  assert.ok(!/AUTO/i.test(states[1]), states[1]);
});

test('the health view reports NULL, not zero, for a source nothing has been read from', () => {
  // A zero would read as "this source produces nothing", which is a claim
  // about the source. NULL reads as "we have not looked" — the true one.
  assert.match(STATEMENTS, /else null[\s\S]{0,20}end as useful_rate/i);
  // ...and the view's own comment says so, for whoever meets it in psql.
  assert.match(
    SQL.replace(/\s+/g, ' '),
    /useful_rate is NULL ' 'when nothing has been scanned, never 0/,
  );
});

test('the view is not exposed to anonymous callers', () => {
  assert.match(STATEMENTS, /revoke all on public\.research_source_health from anon/i);
});

test('one queue entry per source, however many jobs discover it', () => {
  assert.match(STATEMENTS, /create unique index if not exists research_access_requests_source_idx/i);
  assert.match(STATEMENTS, /lower\(source_url\)/i);
});

test('the selection query has an index behind it', () => {
  assert.match(STATEMENTS, /source_registry_selection_idx/);
  assert.match(STATEMENTS, /country_code, access_state, active/);
});

test('the reasoning survives in the file, not only in a commit message', () => {
  for (const phrase of [
    'ADDITIVE ONLY',
    'WHY THERE IS NO NEW SOURCE TABLE',
    'NEVER auto-joined',
    'nothing in Homatch joins a group automatically',
    'THE NAME OF A SECRET, NEVER THE SECRET',
  ]) {
    assert.ok(SQL.includes(phrase), `the migration no longer explains: ${phrase}`);
  }
});
