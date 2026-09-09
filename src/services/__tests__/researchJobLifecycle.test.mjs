import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * VERIFY REPORT LIFECYCLE + EVIDENCE INTEGRITY — STATIC CONTRACT.
 *
 * Like migrationContract.test.mjs, these do NOT execute SQL. Runtime
 * behaviour was proved separately against production inside rolled-back
 * transactions (13/13 for the lifecycle migration, plus a TRUNCATE probe for
 * the grant migration). What these pin is the structure, so a later edit
 * cannot quietly restore rights that were deliberately removed.
 *
 * Each assertion corresponds to something actually found in production:
 *
 *   - research_jobs_update_own had no column restriction, so a customer could
 *     rewrite their own result_json / evidence / status — the evidence of
 *     record that the verdict, the Deal Room synthesis and every grounded AI
 *     answer are derived from
 *   - research_jobs_insert_own let a customer create a Verify report Homatch
 *     never produced, even though the client never inserts (research-agent
 *     does, as service role)
 *   - `deleted_at` meant "removed from history", but the UI called it delete
 *   - anon/authenticated held TRUNCATE on 79 tables, and TRUNCATE is not
 *     subject to RLS
 */

const MIG = path.join(process.cwd(), 'supabase', 'migrations');
const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');

const codeOnly = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/--.*$/gm, ' ');

const LIFECYCLE = read('20260911090000_research_job_lifecycle.sql');
const REVOKE = read('20260911091000_revoke_truncate_from_client_roles.sql');
const LIFE = codeOnly(LIFECYCLE);
const REV = codeOnly(REVOKE);

/** Columns a customer is allowed to write. Evidence is not on this list and
 * must never be. */
const GRANTED_UPDATE = [
  'title',
  'case_id',
  'supersedes_job_id',
  'deleted_at',
  'lifecycle_state',
  'archived_at',
  'deletion_requested_at',
];

/** Columns that carry the evidence of record. */
const EVIDENCE_COLUMNS = [
  'result_json',
  'evidence',
  'evidence_bundle',
  'documents',
  'status',
  'stage',
  'progress',
  'captcha',
  'error',
];

/* ---------------------------------------------------------------- *
 * Evidence integrity                                                *
 * ---------------------------------------------------------------- */

test('the blanket INSERT/UPDATE grant is revoked from authenticated', () => {
  assert.match(LIFE, /revoke\s+insert\s*,\s*update\s+on\s+public\.research_jobs\s+from\s+authenticated/i);
});

test('the UPDATE grant is column-scoped, not table-wide', () => {
  const m = LIFE.match(/grant\s+update\s*\(([\s\S]*?)\)\s*on\s+public\.research_jobs/i);
  assert.ok(m, 'expected a column-scoped GRANT UPDATE (...) on research_jobs');
  const cols = m[1].split(',').map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(cols.sort(), [...GRANTED_UPDATE].sort());
});

test('no evidence column is writable by a customer', () => {
  const m = LIFE.match(/grant\s+update\s*\(([\s\S]*?)\)\s*on\s+public\.research_jobs/i);
  const granted = m[1];
  for (const col of EVIDENCE_COLUMNS) {
    assert.ok(
      !new RegExp(`\\b${col}\\b`).test(granted),
      `${col} must NOT be customer-writable — it is the evidence of record`
    );
  }
});

test('the INSERT grant cannot carry a fabricated report', () => {
  const m = LIFE.match(/grant\s+insert\s*\(([\s\S]*?)\)\s*on\s+public\.research_jobs/i);
  assert.ok(m, 'expected a column-scoped GRANT INSERT (...)');
  const granted = m[1];
  for (const col of EVIDENCE_COLUMNS) {
    assert.ok(!new RegExp(`\\b${col}\\b`).test(granted), `${col} must not be insertable by a client`);
  }
});

test('service_role is never narrowed — the pipeline must keep writing evidence', () => {
  assert.ok(
    !/revoke[\s\S]{0,80}from\s+service_role/i.test(LIFE),
    'this migration must not touch service_role'
  );
});

/* ---------------------------------------------------------------- *
 * The write set the shipped UI actually needs                        *
 * ---------------------------------------------------------------- */

test('every column the service layer writes is actually granted', () => {
  // Drift guard: if someone adds a new client-side update to research_jobs
  // and forgets the grant, that write fails in production with 42501. This
  // catches it at test time instead.
  const svc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'services', 'researchJobs.ts'),
    'utf8'
  );
  const updates = [...svc.matchAll(/\.update\(\s*(\{[\s\S]*?\}|patch)\s*\)/g)].map((m) => m[1]);
  assert.ok(updates.length > 0, 'expected researchJobs.ts to contain client updates');

  const written = new Set();
  for (const u of updates) {
    // Object keys only: anchored to `{` or `,`, so a ternary's colon inside a
    // value (`title: trimmed.length ? trimmed : null`) is not mistaken for one.
    for (const key of u.matchAll(/[{,]\s*([a-z_]+)\s*:/g)) written.add(key[1]);
  }
  // linkResearchJobToCase builds a typed `patch` object rather than an inline
  // literal, so pick its keys up from the declaration.
  for (const key of svc.matchAll(/patch(?:\.|\[')([a-z_]+)/g)) written.add(key[1]);
  for (const key of svc.matchAll(/const patch:\s*\{([^}]*)\}/g)) {
    for (const k of key[1].matchAll(/([a-z_]+)\??\s*:/g)) written.add(k[1]);
  }

  for (const col of written) {
    assert.ok(
      GRANTED_UPDATE.includes(col),
      `researchJobs.ts writes "${col}" but the migration does not grant it`
    );
  }
});

/* ---------------------------------------------------------------- *
 * Lifecycle state machine                                           *
 * ---------------------------------------------------------------- */

test('lifecycle_state is constrained to the four real states', () => {
  assert.match(LIFE, /research_jobs_lifecycle_state_ck/);
  for (const s of ['ACTIVE', 'ARCHIVED', 'DELETION_REQUESTED', 'PURGED']) {
    assert.match(LIFE, new RegExp(`'${s}'`));
  }
});

test('deleted_at and lifecycle_state stay in sync in BOTH directions', () => {
  // The shipped UI still writes deleted_at; a lifecycle-aware caller writes
  // lifecycle_state. Either must produce the same truthful end state.
  assert.match(LIFE, /new\.deleted_at is distinct from old\.deleted_at/i);
  assert.match(LIFE, /new\.lifecycle_state\s*:=\s*'ARCHIVED'/i);
  assert.match(LIFE, /new\.lifecycle_state\s*:=\s*'ACTIVE'/i);
  assert.match(LIFE, /new\.deleted_at\s*:=\s*coalesce\(new\.deleted_at,\s*now\(\)\)/i);
});

test('a client can never set or leave PURGED', () => {
  assert.match(LIFE, /PURGED is not settable by a client/i);
  assert.match(LIFE, /old\.lifecycle_state\s*=\s*'PURGED'\s+or\s+new\.lifecycle_state\s*=\s*'PURGED'/i);
});

test('illegal lifecycle transitions raise rather than silently succeeding', () => {
  assert.match(LIFE, /illegal lifecycle transition/i);
  assert.match(LIFE, /raise exception/i);
});

test('the lifecycle trigger fires on both insert and update', () => {
  assert.match(LIFE, /before insert or update on public\.research_jobs/i);
});

test('nothing in the lifecycle migration destroys evidence', () => {
  assert.ok(!/\bdrop\s+table\b/i.test(LIFE), 'must not drop a table');
  assert.ok(!/\btruncate\b/i.test(LIFE), 'must not truncate');
  assert.ok(
    !/\bdelete\s+from\s+public\.research_jobs\b/i.test(LIFE),
    'must not delete rows — soft-delete-only is the whole design'
  );
});

/* ---------------------------------------------------------------- *
 * Telling the customer the truth                                    *
 * ---------------------------------------------------------------- */

test('the dependents RPC refuses an unauthenticated caller explicitly', () => {
  assert.match(LIFE, /research_job_dependents/);
  assert.match(LIFE, /if v_uid is null then[\s\S]{0,120}raise exception/i);
});

test('the dependents RPC checks ownership before returning anything', () => {
  const fn = LIFE.slice(LIFE.indexOf('research_job_dependents'));
  assert.match(fn, /v_owner is null or v_owner <> v_uid/i);
});

test('the dependents RPC is not callable by anon', () => {
  assert.match(LIFE, /revoke all on function public\.research_job_dependents\(uuid\) from public, anon/i);
  assert.match(LIFE, /grant execute on function public\.research_job_dependents\(uuid\) to authenticated/i);
});

test('"retained" is derived from real references, not assumed', () => {
  const fn = LIFE.slice(LIFE.indexOf('research_job_dependents'));
  assert.match(fn, /deal_rooms/);
  assert.match(fn, /transaction_cases/);
  assert.match(fn, /supersedes_job_id/);
  assert.match(fn, /'retained',\s*\(v_rooms \+ v_cases \+ v_supersedes\) > 0/);
});

/* ---------------------------------------------------------------- *
 * TRUNCATE hardening                                                *
 * ---------------------------------------------------------------- */

test('TRUNCATE, REFERENCES and TRIGGER are revoked from both client roles', () => {
  assert.match(REV, /revoke truncate, references, trigger on public\.%I from anon, authenticated/i);
});

test('the sweep covers views as well as tables, so the invariant is checkable', () => {
  assert.match(REV, /relkind in \('r','p','v','m'\)/);
});

test('future tables cannot silently re-acquire TRUNCATE', () => {
  assert.match(REV, /alter default privileges[\s\S]{0,120}revoke truncate, references, trigger on tables from anon, authenticated/i);
});

test('the hardening does not touch the privileges RLS actually governs', () => {
  // SELECT/INSERT/UPDATE/DELETE are governed by policies; narrowing them is
  // per-table product work, not a blanket sweep.
  assert.ok(!/revoke[^;]*\bselect\b/i.test(REV), 'must not revoke SELECT');
  assert.ok(!/revoke[^;]*\bdelete\b/i.test(REV), 'must not revoke DELETE');
  assert.ok(!/\bdrop policy\b/i.test(REV), 'must not drop a policy');
});

test('neither migration weakens RLS anywhere', () => {
  for (const [name, sql] of Object.entries({ LIFE, REV })) {
    assert.ok(!/disable row level security/i.test(sql), `${name} must not disable RLS`);
    assert.ok(!/no force row level security/i.test(sql), `${name} must not unforce RLS`);
    assert.ok(!/using\s*\(\s*true\s*\)/i.test(sql), `${name} must not add an open policy`);
  }
});
