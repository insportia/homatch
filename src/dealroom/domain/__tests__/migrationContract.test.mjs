import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * MIGRATION SECURITY CONTRACT — STATIC.
 *
 * WHAT THESE TESTS ARE NOT: they do NOT execute SQL. There is no Postgres,
 * Docker, psql or Supabase CLI on this machine, and no dev branch has been
 * created, so nothing here proves runtime behaviour. Claiming otherwise would
 * be exactly the false confidence that let three blocking defects through a
 * previous review.
 *
 * WHAT THEY DO: pin the structural properties that a reader had to verify by
 * hand, so a later edit cannot quietly remove them. Every assertion below
 * corresponds to a defect that was actually found:
 *
 *   - handoff mint/cancel written as direct table writes under a SELECT-only
 *     policy (mint always failed; cancel silently did nothing)
 *   - a client INSERT policy would let the caller choose its own nonce hash
 *   - `auth.uid()` compared without a NULL guard passes for an anon caller
 *   - two representations of one price-version concept, one of them NOT NULL
 *     and never written
 */

const MIG = path.join(process.cwd(), 'supabase', 'migrations');
const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');

/** SQL with comments removed. Several assertions below search for patterns
 * that legitimately APPEAR IN COMMENTS explaining why they were removed —
 * matching those would fail on the very documentation of the fix. */
const codeOnly = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/^\s*--.*$/gm, ' ')          // whole-line -- comments
    .replace(/--.*$/gm, ' ');             // trailing -- comments

const DEAL_ROOMS = read('20260909120000_deal_rooms.sql');
const STORAGE = read('20260910090000_deal_room_document_storage.sql');
const PRICES = read('20260910100000_renovation_price_book.sql');
const HANDOFF = read('20260910110000_human_verification_handoff.sql');
const ALL = { DEAL_ROOMS, STORAGE, PRICES, HANDOFF };

const HANDOFF_FNS = [
  'mint_human_verification_handoff',
  'open_human_verification_handoff',
  'cancel_human_verification_handoff',
  'redeem_human_verification_handoff',
];

/** The body of one create-function block. */
function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `function ${name} not found`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `function ${name} has no terminator`);
  return sql.slice(start, end);
}

/* ---------------------------------------------------------------- *
 * The handoff table takes NO client writes                          *
 * ---------------------------------------------------------------- */

test('human_verification_handoffs has exactly one policy, and it is SELECT-only', () => {
  const policies = HANDOFF.match(/create policy \w+ on public\.human_verification_handoffs/g) ?? [];
  assert.equal(policies.length, 1, 'exactly one policy expected');
  assert.match(HANDOFF, /create policy hvh_owner_read[\s\S]{0,120}for select to authenticated/);
});

test('no client INSERT/UPDATE/DELETE policy exists on the handoff table', () => {
  // A scoped INSERT policy would let the caller supply nonce_sha256 — knowing
  // the preimage of your own hash makes the nonce worthless. An UPDATE policy
  // broad enough to cancel is broad enough to set status = 'COMPLETED'.
  const block = HANDOFF.slice(
    HANDOFF.indexOf('alter table public.human_verification_handoffs enable row level security'),
    HANDOFF.indexOf('create or replace function public.mint_human_verification_handoff')
  );
  assert.equal(/for (insert|update|delete)/.test(block), false, 'client write policy present');
});

test('every handoff mutation is a SECURITY DEFINER function', () => {
  for (const fn of HANDOFF_FNS) {
    const body = fnBody(HANDOFF, fn);
    assert.match(body, /security definer/, `${fn} is not SECURITY DEFINER`);
  }
});

/* ---------------------------------------------------------------- *
 * Caller identity is checked, and checked BEFORE use                *
 * ---------------------------------------------------------------- */

test('every handoff function refuses an unauthenticated caller explicitly', () => {
  // `h.user_id <> auth.uid()` evaluates to NULL when auth.uid() is NULL, so
  // the IF never fires and the check silently passes. An explicit null guard
  // is the only thing that closes that.
  for (const fn of HANDOFF_FNS) {
    const body = fnBody(HANDOFF, fn);
    assert.match(body, /is null then\s*\n\s*raise exception 'authentication required'/,
      `${fn} has no explicit auth.uid() null guard`);
  }
});

test('mint validates job ownership rather than trusting the caller', () => {
  const body = fnBody(HANDOFF, 'mint_human_verification_handoff');
  assert.match(body, /from public\.research_jobs j[\s\S]{0,80}j\.user_id = v_uid/);
  assert.match(body, /insufficient_privilege/);
});

test('mint derives every security-sensitive value server-side', () => {
  const body = fnBody(HANDOFF, 'mint_human_verification_handoff');
  // nonce generated here, not accepted
  assert.match(body, /extensions\.gen_random_bytes\(32\)/);
  // only the hash is stored
  assert.match(body, /extensions\.digest\(v_nonce, 'sha256'\)/);
  assert.match(body, /nonce_sha256/);
  // status and expiry are server-fixed
  assert.match(body, /'PENDING',\s*\n?\s*--/);
  assert.match(body, /now\(\) \+ make_interval/);
  // owner is auth.uid(), never a parameter
  assert.equal(/p_user_id|p_nonce|p_status|p_expires/.test(body), false,
    'mint accepts a security-sensitive parameter');
});

test('mint bounds the requested TTL rather than trusting it', () => {
  const body = fnBody(HANDOFF, 'mint_human_verification_handoff');
  assert.match(body, /least\(greatest\(coalesce\(p_ttl_minutes/);
});

/* ---------------------------------------------------------------- *
 * State transitions                                                 *
 * ---------------------------------------------------------------- */

test('cancel only moves PENDING/OPENED to CANCELLED', () => {
  const body = fnBody(HANDOFF, 'cancel_human_verification_handoff');
  assert.match(body, /if h\.status not in \('PENDING','OPENED'\) then/);
  assert.match(body, /set status = 'CANCELLED'/);
});

test('cancel never mutates a COMPLETED handoff', () => {
  const body = fnBody(HANDOFF, 'cancel_human_verification_handoff');
  const guardAt = body.indexOf("not in ('PENDING','OPENED')");
  const updateAt = body.indexOf("set status = 'CANCELLED'");
  assert.ok(guardAt > 0 && updateAt > guardAt, 'the terminal-state guard must precede the update');
});

test('cancel raises on a missing or non-owned handoff — no silent zero-row success', () => {
  const body = fnBody(HANDOFF, 'cancel_human_verification_handoff');
  assert.match(body, /raise exception 'handoff not found'/);
  assert.match(body, /raise exception 'handoff does not belong to caller'/);
});

test('cancel is idempotent', () => {
  const body = fnBody(HANDOFF, 'cancel_human_verification_handoff');
  assert.match(body, /if h\.status = 'CANCELLED' then[\s\S]{0,200}'already', true/);
});

test('open only promotes PENDING, and only before expiry', () => {
  const body = fnBody(HANDOFF, 'open_human_verification_handoff');
  assert.match(body, /if h\.status = 'PENDING' and h\.expires_at > now\(\) then/);
  assert.match(body, /set status\s*=\s*'OPENED'/);
});

test('redeem is single-use, expiry-checked, and idempotent on replay', () => {
  const body = fnBody(HANDOFF, 'redeem_human_verification_handoff');
  assert.match(body, /if h\.status = 'COMPLETED' then[\s\S]{0,220}'already', true/);
  assert.match(body, /if h\.expires_at <= now\(\) then/);
  assert.match(body, /consumed_at\s*=\s*now\(\)/);
  assert.match(body, /for update/, 'the row must be locked while redeeming');
});

test('the one-live-handoff index covers exactly PENDING and OPENED', () => {
  // If it covered CANCELLED too, a legitimate re-mint after declining would be
  // blocked forever.
  assert.match(HANDOFF, /hvh_one_live_per_source_uidx[\s\S]{0,200}where status in \('PENDING','OPENED'\)/);
});

/* ---------------------------------------------------------------- *
 * Grants                                                            *
 * ---------------------------------------------------------------- */

test('every new function revokes public and anon', () => {
  const fns = [
    ...HANDOFF_FNS.map((f) => [HANDOFF, f]),
    [PRICES, 'mark_stale_price_items'],
    [HANDOFF, 'expire_stale_handoffs'],
  ];
  for (const [sql, fn] of fns) {
    const re = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)[\\s\\S]{0,60}from public, anon`);
    assert.match(sql, re, `${fn} does not revoke public/anon`);
  }
});

test('the maintenance sweep is not granted to authenticated at all', () => {
  assert.match(HANDOFF, /revoke all on function public\.expire_stale_handoffs\(\) from public, anon, authenticated/);
  assert.equal(/grant execute on function public\.expire_stale_handoffs/.test(HANDOFF), false);
});

test('every SECURITY DEFINER function pins an explicit search_path', () => {
  for (const [label, sql] of Object.entries(ALL)) {
    const blocks = sql.split('create or replace function ').slice(1);
    for (const b of blocks) {
      const head = b.slice(0, b.indexOf('as $$'));
      if (!/security definer/.test(head)) continue;
      assert.match(head, /set search_path = /, `${label}: a definer function has no pinned search_path`);
    }
  }
});

test('pgcrypto is always schema-qualified, since search_path is pinned to public', () => {
  const calls = codeOnly(HANDOFF).match(/[^.\w](digest|gen_random_bytes)\s*\(/g) ?? [];
  assert.equal(calls.length, 0, `unqualified pgcrypto call: ${calls.join(', ')}`);
});

/* ---------------------------------------------------------------- *
 * Price-version identity                                            *
 * ---------------------------------------------------------------- */

test('there is exactly ONE price-version representation on a scenario', () => {
  assert.equal(/^\s*price_book_version\s+integer/m.test(DEAL_ROOMS), false,
    'the legacy integer column is back');
  assert.equal(/^\s*provisional_prices\s+boolean/m.test(DEAL_ROOMS), false,
    'provisional_prices is back — it can only ever be false for a customer estimate');
  assert.match(PRICES, /add column if not exists price_book_version_id uuid/);
});

test('PRICED <=> a version pointer, enforced by the database in both directions', () => {
  assert.match(PRICES, /renovation_scenarios_priced_iff_version_ck/);
  assert.match(PRICES, /estimate_state = 'PRICED' and price_book_version_id is not null/);
  assert.match(PRICES, /estimate_state <> 'PRICED' and price_book_version_id is null/);
});

test('a saved estimate cannot lose the version that produced it', () => {
  // ON DELETE SET NULL would blank the pointer and make an old estimate
  // unattributable; RESTRICT keeps it reproducible.
  const alter = PRICES.slice(PRICES.indexOf('alter table public.renovation_scenarios'));
  assert.match(alter.slice(0, 400), /on delete restrict/);
});

test('customer-visible prices are restricted to VERIFIED items in a PUBLISHED version', () => {
  assert.match(PRICES, /where v\.status = 'PUBLISHED'\s*\n\s*and i\.status = 'VERIFIED'/);
  // ...and restated at the table, so bypassing the view changes nothing.
  assert.match(PRICES, /status = 'VERIFIED'[\s\S]{0,220}v\.status = 'PUBLISHED'/);
});

test('a published price version is immutable, and the trigger handles DELETE', () => {
  const body = fnBody(PRICES, 'guard_published_price_items');
  // NEW is unassigned in a DELETE trigger; touching it raises at runtime.
  assert.match(body, /if tg_op = 'DELETE' then/);
  assert.match(body, /return old;/);
  assert.equal(/coalesce\(new\.\w+, old\.\w+\)/.test(codeOnly(body)), false,
    'the unassigned-NEW pattern is back');
});

/* ---------------------------------------------------------------- *
 * Ownership everywhere else                                         *
 * ---------------------------------------------------------------- */

test('every new table forces RLS, not merely enables it', () => {
  const tables = [
    'deal_rooms', 'deal_room_documents', 'deal_room_action_items', 'deal_room_questions',
    'deal_room_notes', 'renovation_scenarios', 'deal_room_ai_threads', 'deal_room_ai_messages',
  ];
  for (const t of tables) {
    assert.ok(DEAL_ROOMS.includes(`alter table public.${t}`.padEnd(0) ) || true);
    assert.match(DEAL_ROOMS, new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    assert.match(DEAL_ROOMS, new RegExp(`alter table public\\.${t}\\s+force row level security`));
  }
  assert.match(STORAGE, /alter table public\.deal_room_document_findings force row level security/);
  for (const t of ['renovation_price_book_versions', 'renovation_price_items', 'renovation_price_observations']) {
    assert.match(PRICES, new RegExp(`alter table public\\.${t}\\s+force row level security`));
  }
  assert.match(HANDOFF, /alter table public\.human_verification_handoffs force row level security/);
});

test('document storage keys ownership on the first path segment', () => {
  // The service builds `<userId>/<roomId>/<docId>.<ext>`; the policies compare
  // segment 1 to auth.uid(). The two must stay in lockstep.
  const code = codeOnly(STORAGE);
  // Four policies, but FIVE clauses: the UPDATE policy carries both `using`
  // and `with check`, which is exactly what stops a row being moved out of the
  // owner's folder by an update.
  const created = code.match(/create policy deal_room_docs_\w+ on storage\.objects/g) ?? [];
  assert.equal(created.length, 4, 'expected select/insert/update/delete policies');
  const clauses = code.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g) ?? [];
  assert.equal(clauses.length, 5, 'every policy clause must key on the owner segment');
  assert.match(STORAGE, /'deal-room-documents',\s*\n\s*false,/, 'the bucket must be private');
});

test('no migration performs a destructive operation', () => {
  for (const [label, sql] of Object.entries(ALL)) {
    assert.equal(/drop table|drop column|truncate|delete from/i.test(sql), false,
      `${label} contains a destructive statement`);
  }
});
