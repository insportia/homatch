// storageAuth — the wiring that turns the storage decision into real queries.
//
// Supabase Storage answered "may this person touch this object?" by running a
// policy inside the query. R2 cannot: it has one all-powerful credential and
// no idea who is asking. So the question is asked here, BEFORE anything is
// signed, and it is put to the same database, through the same functions,
// under the CALLER'S OWN JWT — never the service role.
//
// That last detail is the whole design. `dev_can()` and `is_admin()` read
// `auth.uid()`. Called with the service key they would answer for nobody;
// called with the caller's token they answer for the caller, exactly as they
// did when Postgres was enforcing the policy itself. The rule is not
// re-implemented here — it is re-asked.
//
// The decision itself lives in storage/decide.ts, which has no client and is
// therefore testable. This file exists only to supply it with two real
// answers, and to turn a failed query into `null` — "unknown" — rather than
// letting an exception become an allow.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decide, type Decision } from './storage/decide.ts';
import type { StorageAction } from './storage/keys.ts';

export type { CallerFacts, Decision, DenyReason } from './storage/decide.ts';

declare const Deno: { env: { get(k: string): string | undefined } };

/** A client that acts AS THE CALLER, so RLS and auth.uid() behave normally. */
export function callerClient(req: Request): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authorize(
  req: Request, key: unknown, action: StorageAction,
): Promise<Decision> {
  const client = callerClient(req);
  if (!client) {
    return {
      allowed: false,
      reason: 'UNAVAILABLE',
      caller: { authUid: null, authenticated: false },
      parsed: null,
    };
  }

  // Who is asking. With only the anon key presented this is null, which is
  // the correct answer and not an error: some namespaces allow it.
  const { data } = await client.auth.getUser();

  return decide({
    key,
    action,
    authUid: data?.user?.id ?? null,
    isAdmin: async () => {
      const res = await client.rpc('is_admin');
      if (res.error) {
        console.error('storageAuth: is_admin failed', res.error.code ?? 'unknown');
        return null;
      }
      return res.data === true;
    },
    devCan: async (workspace, capability) => {
      const res = await client.rpc('dev_can', {
        p_workspace: workspace,
        p_capability: capability,
      });
      if (res.error) {
        console.error('storageAuth: dev_can failed', res.error.code ?? 'unknown');
        return null;
      }
      return res.data === true;
    },
  });
}
