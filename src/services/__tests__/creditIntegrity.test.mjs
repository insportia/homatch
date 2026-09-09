import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * CREDITS AND UNLOCKS — STATIC.
 *
 * atomic-unlock was not atomic. It debited, wrote the ledger and created the
 * unlock row in three separate PostgREST calls, undoing the earlier ones by
 * hand when a later one failed.
 *
 * The debit was:
 *
 *   .update({ balance: newBalance }).eq('user_id', userId).eq('balance', balance)
 *
 * and only its ERROR was checked. When that optimistic guard did its job --
 * when a concurrent unlock or top-up had moved the balance -- the statement
 * matched ZERO rows, and PostgREST answers a zero-row UPDATE with 204 and no
 * error. The code then wrote the ledger entry, the unlock row and the full
 * seller reveal having charged nothing.
 *
 * Verified live after the fix, rolled back:
 *
 *   charged=0.1600 bal 999->998.84 ledger_rows=1 already=f
 *   second_already=t second_bal=998.84
 *   foreign=NOT_YOUR_PROPERTY  negative=REJECTED
 */

const ROOT = process.cwd();
const MIG = path.join(ROOT, 'supabase', 'migrations');
const sql = fs.readFileSync(path.join(MIG, '20260911180000_atomic_match_unlock.sql'), 'utf8');
const fn = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'atomic-unlock', 'index.ts'), 'utf8');

/** The function body with comments removed: the header quotes the old broken
 *  code at length, and scanning the raw file would find the explanation. */
const fnCode = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the unlock is one transaction, not three round trips', () => {
  assert.match(fnCode, /supabaseAdmin\.rpc\('atomic_match_unlock'/);

  // None of the three hand-rolled steps may remain in the Edge Function.
  assert.ok(!/from\('credit_accounts'\)\s*\n?\s*\.update\(/.test(fnCode), 'no client-side debit');
  assert.ok(!/from\('credit_ledger'\)\s*\n?\s*\.insert\(/.test(fnCode), 'no client-side ledger write');
  assert.ok(!/from\('match_unlocks'\)\s*\n?\s*\.insert\(/.test(fnCode), 'no client-side unlock write');
});

test('nothing deletes a ledger row any more', () => {
  // The old rollback removed the credit_ledger entry it had just written. A
  // ledger is append-only; an audit trail that can be erased is not one.
  assert.ok(!/from\('credit_ledger'\)[\s\S]{0,80}\.delete\(/.test(fnCode));
});

test('a failed unlock tells the customer nothing was charged', () => {
  assert.match(fnCode, /Unlock failed, no credits were charged/);
});

test('the RPC holds a lock on the account it is spending from', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.atomic_match_unlock'));
  assert.match(body, /from public\.credit_accounts ca\s*\n\s*where ca\.user_id = p_user_id\s*\n\s*for update/i);
  assert.match(body, /from public\.matches m\s*\n\s*where m\.id = p_match_id\s*\n\s*for update/i);
});

test('the RPC refuses to spend for someone else', () => {
  assert.match(sql, /auth\.role\(\) <> 'service_role' and p_user_id <> public\.auth_user_id\(\)/);
  assert.match(sql, /raise exception 'FORBIDDEN'/);
  // And refuses a match on a property the caller does not own.
  assert.match(sql, /NOT_YOUR_PROPERTY/);
});

test('a repeat unlock returns the first one instead of charging again', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.atomic_match_unlock'));
  const early = body.slice(0, body.indexOf('for update'));
  assert.match(early, /from public\.match_unlocks mu/, 'the existing-unlock check must come before any charge');
  assert.match(early, /return query select v_existing\.id/);
});

test('insufficient credits is checked before the debit', () => {
  const body = sql.slice(sql.indexOf('create or replace function public.atomic_match_unlock'));
  const check = body.indexOf("raise exception 'INSUFFICIENT_CREDITS'");
  const debit = body.indexOf('update public.credit_accounts');
  assert.ok(check > 0 && debit > check, 'the balance check must precede the debit');
});

test('the RPC is not callable by a customer directly', () => {
  // `authenticated` must be named in the REVOKE, not just PUBLIC: Supabase's
  // default privileges grant EXECUTE on new public functions directly to anon
  // and authenticated, so revoking from PUBLIC alone leaves the grant standing.
  // That is not theoretical -- after the first apply,
  // has_function_privilege('authenticated', 'atomic_match_unlock', 'execute')
  // still returned true.
  assert.match(sql, /revoke all on function public\.atomic_match_unlock\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.atomic_match_unlock\(uuid, uuid\) to service_role/);
  assert.ok(
    !/grant execute on function public\.atomic_match_unlock\(uuid, uuid\) to [^;]*authenticated/.test(sql),
    'a customer must not be able to call the spend path directly'
  );
});

test('a credit balance cannot go negative', () => {
  assert.match(sql, /add constraint credit_accounts_balance_non_negative\s*\n?\s*check \(balance >= 0\)/i);
});

test('the reveal precedence is preserved', () => {
  // pending mock row > raw_signals > intent_profiles. Getting this order wrong
  // would show a customer generated mock text for a real paid unlock.
  const body = sql.slice(sql.indexOf('create or replace function public.atomic_match_unlock'));
  const pending = body.indexOf('match_unlocks_pending p');
  const raw = body.indexOf('public.raw_signals rs');
  const intent = body.indexOf('public.intent_profiles ip');
  assert.ok(pending > 0 && raw > pending && intent > raw, 'mock, then raw_signals, then intent_profiles');
});

/* ---------------- the reservation state machine ---------------- */

test('credit_ledger idempotency covers every money type', () => {
  // reserve / capture / release / top-up / unlock all write a reference, and
  // the unique index on (user_id, type, reference) is what makes a retry fail
  // instead of charging twice.
  const idem = fs.readFileSync(path.join(MIG, '20260911130000_credit_ledger_idempotency.sql'), 'utf8');
  const stmt = idem.slice(idem.toLowerCase().indexOf('create unique index'));
  assert.match(stmt, /credit_ledger \(user_id, type, reference\)/i);
  assert.match(stmt, /where reference is not null/i);
});
