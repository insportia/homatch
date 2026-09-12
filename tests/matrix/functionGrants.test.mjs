// `revoke ... from public` does not revoke from anon. This makes sure the
// migration says so.
//
// WHAT WENT WRONG, ONCE, IN PRODUCTION
//
// Every comm_ function was written as:
//
//   create or replace function public.comm_x(...) ... security definer ...;
//   revoke all on function public.comm_x(...) from public;
//   grant execute on function public.comm_x(...) to service_role;
//
// which reads exactly like least privilege and is not. Supabase ships
//
//   alter default privileges in schema public
//     grant execute on functions to anon, authenticated, service_role;
//
// so the function was created, immediately handed EXECUTE to three NAMED
// ROLES by that default, and then had the PUBLIC grant — a different thing —
// revoked. `anon` and `authenticated` kept theirs.
//
// PostgREST publishes the public schema as RPC, so the result was that anyone
// holding only the publishable anon key could POST to
// /rest/v1/rpc/comm_purge_expired (SECURITY DEFINER, DELETEs rows),
// /rest/v1/rpc/comm_record_inbound (writes a conversation and a message under
// any owner_id it is handed), /rest/v1/rpc/comm_enqueue_campaign, and
// /rest/v1/rpc/comm_claim_sends.
//
// It was found by reading the live catalogue after applying the migration, not
// by any test — which is why this file exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_SQL = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260912110500_communications_functions.sql'), 'utf8');

/** Every comm_ function the migration creates. */
function declaredFunctions(sql) {
  return [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(comm_[a-z_]+)\s*\(/gi)]
    .map((m) => m[1]);
}

test('the migration revokes from the named roles, not only from PUBLIC', () => {
  /*
   * The specific fix. A revoke that lists only `public` is the bug; it has to
   * name anon and authenticated too, or Supabase's default privilege survives.
   */
  const revokesNamedRoles = /revoke\s+all\s+on\s+function\s+%s\s+from\s+public,\s*anon,\s*authenticated,\s*service_role/i
    .test(FUNCTIONS_SQL);
  assert.ok(revokesNamedRoles,
    'the migration must revoke EXECUTE from public, anon, authenticated AND service_role.\n' +
    'Revoking from PUBLIC alone leaves Supabase\'s ALTER DEFAULT PRIVILEGES grant to anon in place,\n' +
    'and every SECURITY DEFINER function here becomes callable over PostgREST with the anon key.');
});

test('the revoke sweeps the catalogue rather than a hand-written list', () => {
  // A hand-list is a list somebody forgets to extend. The migration loops over
  // pg_proc so a function added later is covered by construction.
  assert.match(FUNCTIONS_SQL, /from pg_proc p join pg_namespace n[\s\S]{0,200}proname like 'comm/i,
    'the revoke should iterate the real catalogue, not a fixed list of names');
});

test('every function the migration creates is either granted deliberately or left with nothing', () => {
  const created = new Set(declaredFunctions(FUNCTIONS_SQL));
  assert.ok(created.size >= 13, `expected at least 13 comm_ functions, found ${created.size}`);

  // The grant block that runs AFTER the sweeping revoke.
  const grantBlock = FUNCTIONS_SQL.slice(FUNCTIONS_SQL.lastIndexOf('revoke all on function %s'));
  const granted = new Map();
  for (const m of grantBlock.matchAll(/grant execute on function public\.(comm_[a-z_]+)\([^)]*\)\s+to\s+([a-z_,\s]+);/gi)) {
    granted.set(m[1], m[2].split(',').map((s) => s.trim()).sort().join(','));
  }

  /*
   * The four a signed-in customer may call. Each one either runs SECURITY
   * INVOKER (so RLS decides) or checks ownership itself and raises 42501.
   * Anything not on this list must be service_role only.
   */
  const CUSTOMER_CALLABLE = new Set([
    'comm_audience_summary',
    'comm_set_conversation_mode',
    'comm_publish_agent',
    'comm_user_resume_campaign',
  ]);

  const wrong = [];
  for (const fn of created) {
    const roles = granted.get(fn);
    if (!roles) {
      wrong.push(`${fn}: created but never granted to anything — it will be uncallable`);
      continue;
    }
    if (roles.includes('anon')) {
      wrong.push(`${fn}: granted to anon. Nothing in this product should be callable without signing in.`);
    }
    if (!CUSTOMER_CALLABLE.has(fn) && roles.includes('authenticated')) {
      wrong.push(`${fn}: granted to authenticated, but it is a dispatcher/webhook tool. ` +
        `A customer calling it directly bypasses every check in the edge function that is supposed to be its only caller.`);
    }
    if (CUSTOMER_CALLABLE.has(fn) && !roles.includes('authenticated')) {
      wrong.push(`${fn}: a customer is supposed to be able to call this and cannot`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n  '));
});

test('the trigger function is granted to nobody', () => {
  /*
   * comm_touch_updated_at runs as part of an UPDATE, under the table owner.
   * Nobody calls it directly, so an EXECUTE grant on it is attack surface with
   * no purpose. Asserted because it is the one function easy to sweep back in
   * by a well-meaning "grant everything we created" edit.
   */
  const grantBlock = FUNCTIONS_SQL.slice(FUNCTIONS_SQL.lastIndexOf('revoke all on function %s'));
  assert.ok(!/grant execute on function public\.comm_touch_updated_at/i.test(grantBlock),
    'comm_touch_updated_at must not be granted to any role');
});

test('a SECURITY DEFINER function callable by a customer checks ownership itself', () => {
  /*
   * The two comm_ functions a signed-in user may call which are also SECURITY
   * DEFINER — so RLS does NOT protect them and the function body is the only
   * thing standing between one tenant and another's data.
   *
   * Supabase's own advisor flags both; they are intentional, and this is what
   * makes "intentional" mean something.
   */
  const checks = [
    ['comm_publish_agent', /where id = p_agent_id and owner_id = p_actor/],
    ['comm_set_conversation_mode', /owner_id = p_actor or exists/],
  ];
  for (const [fn, guard] of checks) {
    const start = FUNCTIONS_SQL.indexOf(`create or replace function public.${fn}`);
    assert.ok(start > -1, `${fn} is not in the migration`);
    const body = FUNCTIONS_SQL.slice(start, FUNCTIONS_SQL.indexOf('grant execute', start));
    assert.match(body, guard,
      `${fn} is SECURITY DEFINER and callable by any signed-in user, so RLS does not apply to it. ` +
      `It must check ownership in its own body, and that check is missing or has changed shape.`);
  }
});

test('no comm_ function is SECURITY DEFINER without a pinned search_path', () => {
  /*
   * A SECURITY DEFINER function with a mutable search_path can be hijacked by
   * a caller who creates a shadowing object in a schema earlier on their path.
   * Supabase's linter flags this class; none of ours should appear in it.
   */
  const missing = [];
  for (const m of FUNCTIONS_SQL.matchAll(
    /create\s+or\s+replace\s+function\s+public\.(comm_[a-z_]+)\s*\([\s\S]*?\bas\s+\$\$/gi)) {
    const header = m[0];
    if (/security\s+definer/i.test(header) && !/set\s+search_path\s*=/i.test(header)) {
      missing.push(m[1]);
    }
  }
  assert.deepEqual(missing, [],
    'these are SECURITY DEFINER with a mutable search_path: ' + missing.join(', '));
});
