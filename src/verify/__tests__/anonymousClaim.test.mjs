// Trying Verify before signing up, without making anybody's report public.
//
// An anonymous visitor has no auth.uid(), so RLS cannot identify them, and a
// UUID they happen to know must never be what authorises access —
// research_jobs.id appears in URLs. So anonymous work is owned by a SESSION,
// proven by a secret the browser holds, and only the server sees the secret.
//
// Every assertion here was first run against production with disposable data
// (all cleaned up); this file is what stops the guarantees drifting.
//
//   claimed with a valid token      conversations=1, researchJobs=1, already=false
//   the same token again            already=true, nothing moved twice
//   expired / another user's /
//   unknown / too short / empty     400, all with the SAME message
//   a stranger reading by exact id  0 rows, before the claim
//   after the claim                 same job id, evidence intact, all messages kept

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const migration = (needle) => {
  const f = readdirSync(MIGRATIONS).find((n) => n.includes(needle));
  assert.ok(f, `no migration matching ${needle}`);
  return readFileSync(join(MIGRATIONS, f), 'utf8').replace(/\r\n/g, '\n');
};

const schema = () => migration('anonymous_sessions_and_claim');
/** The function as it now stands, after the oracle fix superseded the first. */
const claimFn = () => migration('claim_anonymous_session_no_oracle');

/* ── the secret ──────────────────────────────────────────────────────── */

test('only the hash of a session token is ever stored', () => {
  const sql = schema();
  assert.ok(/token_sha256\s+text\s+not null unique/.test(sql), 'the token column is not a unique hash');
  assert.ok(!/\btoken\s+text\b/.test(sql), 'a raw token column exists');
});

test('the lookup is by hash, never by the token itself', () => {
  const sql = claimFn();
  assert.ok(/encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/.test(sql),
    'the token is not hashed before lookup');
  assert.ok(/where token_sha256 = v_hash/.test(sql), 'the lookup does not use the hash');
});

test('a short token is refused before anything is looked up', () => {
  const sql = claimFn();
  assert.ok(/length\(p_token\) < 32/.test(sql), 'a guessable-length token is accepted');
});

/* ── no role gets new access ─────────────────────────────────────────── */

test('the session table is closed to every role', () => {
  const sql = schema();
  assert.ok(/alter table public\.anonymous_sessions enable row level security/.test(sql));
  assert.ok(/alter table public\.anonymous_sessions force row level security/.test(sql),
    'RLS is not forced, so a table owner bypasses it');
  assert.ok(!/create policy/i.test(sql), 'a policy grants some role direct access');
});

test('the anon role is granted nothing at all', () => {
  const sql = claimFn();
  assert.ok(/revoke all on function public\.claim_anonymous_session\(text\) from public, anon/.test(sql),
    'anon can call the claim function');
  assert.ok(/grant execute on function public\.claim_anonymous_session\(text\) to authenticated/.test(sql),
    'no one can call the claim function');
});

test('anonymous work is invisible to signed-in users by construction', () => {
  // An anonymous row has user_id IS NULL, which no existing policy matches.
  // Verified in production: a signed-in user reading the anonymous job by its
  // exact id got 0 rows.
  const sql = schema();
  assert.ok(/alter column user_id drop not null/.test(sql), 'a row cannot be owned by a session');
  assert.ok(/num_nonnulls\(user_id, anon_session_id\) = 1/.test(sql),
    'a row could have two owners, or none');
});

/* ── the claim ───────────────────────────────────────────────────────── */

test('the caller must be signed in for there to be anyone to give the work to', () => {
  assert.ok(/if auth\.uid\(\) is null then/.test(claimFn()), 'an anonymous caller can claim');
});

test('the row is locked, so two tabs finishing sign-in cannot both claim', () => {
  assert.ok(/for update;/.test(claimFn()), 'the session row is not locked during the claim');
});

test('a repeat claim by the same person is success, not an error', () => {
  // A browser refresh during the sign-in round trip is the ordinary case.
  const sql = claimFn();
  assert.ok(/if s\.claimed_by = auth\.uid\(\) then[\s\S]{0,200}'already', true/.test(sql),
    'a refresh mid-claim looks like a failure');
});

test('claiming clears the session link, so it cannot be claimed twice', () => {
  const sql = claimFn();
  assert.ok(/set user_id = auth\.uid\(\), anon_session_id = null/.test(sql),
    'the anonymous link survives the claim');
  // And the one-owner CHECK makes a second claim impossible rather than
  // merely unlikely.
  assert.ok(/num_nonnulls/.test(schema()));
});

test('both kinds of anonymous work move together', () => {
  const sql = claimFn();
  assert.ok(/update public\.ai_conversations/.test(sql), 'conversations are not claimed');
  assert.ok(/update public\.research_jobs/.test(sql), 'research jobs are not claimed');
});

/* ── nothing can be probed ───────────────────────────────────────────── */

test('every unusable token gives exactly the same answer', () => {
  // Unknown, expired, already someone else's and too short must be
  // indistinguishable, or the endpoint becomes an existence oracle.
  const sql = claimFn();
  assert.ok(/c_unusable constant text := 'session cannot be claimed'/.test(sql),
    'there is no single refusal message');
  const refusals = sql.match(/raise exception '%', c_unusable/g) ?? [];
  assert.ok(refusals.length >= 4,
    `only ${refusals.length} refusals use the shared message; some case is still distinguishable`);
  for (const leak of ['session not found', 'session already claimed', 'session has expired']) {
    assert.ok(!sql.includes(`raise exception '${leak}'`), `"${leak}" still identifies the failure`);
  }
});

test('a bad token is a client error, not a server fault', () => {
  const sql = claimFn();
  assert.ok(!/errcode = 'no_data_found'/.test(sql),
    'an unknown token still raises no_data_found, which PostgREST returns as 500');
});

/* ── spending is bounded ─────────────────────────────────────────────── */

test('an anonymous session records what it has spent', () => {
  const sql = schema();
  assert.ok(/user_messages\s+smallint/.test(sql), 'anonymous messages are not counted');
  assert.ok(/research_jobs\s+smallint/.test(sql), 'anonymous research is not counted');
});

test('an unclaimed session expires', () => {
  const sql = schema();
  assert.ok(/expires_at\s+timestamptz\s+not null/.test(sql), 'a session never expires');
  assert.ok(/if s\.expires_at <= now\(\) then/.test(claimFn()), 'an expired session can still be claimed');
});
