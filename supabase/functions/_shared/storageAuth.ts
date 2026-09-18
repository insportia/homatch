// storageAuth — both halves of the decision, in order.
//
// Supabase Storage answered "may this person touch this object?" by running a
// policy inside the query. R2 cannot: it has one all-powerful credential and
// no idea who is asking. So the question is asked here, BEFORE anything is
// signed, and it is put to the same database under the CALLER'S OWN JWT —
// never the service role.
//
// That last detail is the whole design. `storage_authorize`, `dev_can` and
// `is_admin` all read `auth.uid()`. Called with the service key they answer
// for nobody; called with the caller's token they answer for the caller,
// exactly as they did when Postgres was enforcing the policy itself.
//
// TWO GATES, AND BOTH MUST SAY YES
//
//   localGate()          pure, exhaustively tested, sees no rows: shape,
//                        namespace, category, content type, size.
//   storage_authorize()  sees the rows, and is the authority on ownership.
//
// An ALLOW from the first is provisional. An object is reachable only if the
// second agrees, and anything the second does not recognise is a refusal.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { localGate, reasonFromSql, type Decision } from './storage/decide.ts';
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

export interface AuthorizeOptions {
  /** Declared by the caller; the content policy is checked against it. */
  contentType?: string;
  byteSize?: number;
}

export async function authorize(
  req: Request, key: unknown, action: StorageAction, options: AuthorizeOptions = {},
): Promise<Decision> {
  const client = callerClient(req);
  if (!client) {
    return {
      allowed: false,
      reason: 'UNAVAILABLE',
      caller: { authUid: null, authenticated: false, isAdmin: null },
      parsed: null,
    };
  }

  // Who is asking. With only the anon key presented this is null, which is
  // the correct answer and not an error: two namespaces allow it.
  const { data } = await client.auth.getUser();
  const authUid = data?.user?.id ?? null;

  const local = await localGate({
    key,
    action,
    authUid,
    contentType: options.contentType,
    byteSize: options.byteSize,
    isAdmin: async () => {
      const res = await client.rpc('is_admin');
      if (res.error) {
        console.error('storageAuth: is_admin failed', res.error.code ?? 'unknown');
        return null;
      }
      return res.data === true;
    },
  });
  if (!local.allowed) return local;

  // ── The authority ─────────────────────────────────────────────────────
  const verdict = await client.rpc('storage_authorize', {
    p_key: `${local.parsed.namespace}/${local.parsed.rest}`,
    p_action: action,
  });
  if (verdict.error) {
    console.error('storageAuth: storage_authorize failed', verdict.error.code ?? 'unknown');
    return { allowed: false, reason: 'UNAVAILABLE', caller: local.caller, parsed: local.parsed };
  }

  const reason = reasonFromSql(verdict.data);
  if (reason !== 'ALLOW') {
    return { allowed: false, reason, caller: local.caller, parsed: local.parsed };
  }
  return local;
}
