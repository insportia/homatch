// IS THIS REQUEST AN ADMINISTRATOR VIEWING AS SOMEBODY?
//
// impersonate-user mints a real Supabase session for the target and records
// that session's id (the `session_id` claim every access token of it carries)
// on impersonation_sessions.auth_session_id. So the answer is one lookup on a
// SIGNED claim: the browser cannot drop it, rename it or clear it.
//
// Postgres enforces read-only for anything written under the caller's own
// token (restrictive RLS + triggers, migration 20260928230000). This file is
// for the other path: an edge function that authenticates the caller and then
// writes with the SERVICE ROLE on their behalf — top-ups, unlocks, purchases,
// messages. Those writes carry no customer JWT into Postgres, so the function
// itself has to ask, and refuse.
//
// Pure on purpose: no imports, the database lookup is passed in. That keeps it
// importable from a node:test file, and keeps the decision in one place.

/** The JWT payload, decoded WITHOUT verification. Only call after the caller
 *  has been authenticated (auth.getUser succeeded), which verified it. */
export function jwtClaims(authHeader: string | null | undefined): Record<string, unknown> | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const text = typeof atob === 'function'
      ? new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
      : '';
    const claims = JSON.parse(text);
    return claims && typeof claims === 'object' ? claims as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Supabase auth session this token belongs to, when it names one. */
export function sessionIdOf(authHeader: string | null | undefined): string | null {
  const sid = jwtClaims(authHeader)?.session_id;
  return typeof sid === 'string' && UUID.test(sid) ? sid : null;
}

export interface LookupResult {
  found: boolean;
  error?: { code?: string; message?: string } | null;
}

/**
 * Errors that mean "the impersonation columns do not exist yet".
 *
 * Before migration 20260928230000 is applied there is no auth_session_id
 * column — and no way for impersonate-user to have minted a session either,
 * because it refuses to hand out a token it could not record. So "cannot
 * look" is, in exactly that case, "cannot be impersonated", and billing keeps
 * working through the deploy window. Every OTHER lookup failure refuses.
 */
const SCHEMA_NOT_YET_MIGRATED = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

export type ImpersonationVerdict = 'NOT_IMPERSONATING' | 'IMPERSONATING' | 'UNKNOWN';

export async function impersonationVerdict(
  authHeader: string | null | undefined,
  lookup: (sessionId: string) => Promise<LookupResult>,
): Promise<ImpersonationVerdict> {
  const sid = sessionIdOf(authHeader);
  if (!sid) return 'NOT_IMPERSONATING';
  let result: LookupResult;
  try {
    result = await lookup(sid);
  } catch {
    return 'UNKNOWN';
  }
  if (result.error) {
    return SCHEMA_NOT_YET_MIGRATED.has(String(result.error.code ?? '')) ? 'NOT_IMPERSONATING' : 'UNKNOWN';
  }
  return result.found ? 'IMPERSONATING' : 'NOT_IMPERSONATING';
}

/* The slice of a supabase-js client this needs, structurally — so this file
   imports nothing and any client version satisfies it. */
interface QueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>;
      };
    };
  };
}

export function lookupWith(client: unknown) {
  const db = client as QueryClient;
  return async (sessionId: string): Promise<LookupResult> => {
    const { data, error } = await db
      .from('impersonation_sessions').select('id').eq('auth_session_id', sessionId).limit(1);
    return { found: Array.isArray(data) && data.length > 0, error };
  };
}

/**
 * A 403 to return as-is when the caller is an impersonation session, or null
 * to carry on. UNKNOWN refuses too (503): a money path that cannot tell who is
 * asking does not guess.
 */
export async function refuseIfImpersonating(
  client: unknown,
  authHeader: string | null | undefined,
  headers: Record<string, string>,
): Promise<Response | null> {
  const verdict = await impersonationVerdict(authHeader, lookupWith(client));
  if (verdict === 'NOT_IMPERSONATING') return null;
  const status = verdict === 'IMPERSONATING' ? 403 : 503;
  return new Response(JSON.stringify({
    error: verdict === 'IMPERSONATING'
      ? 'READ_ONLY_IMPERSONATION: an administrator is viewing as this account; this action is disabled.'
      : 'IMPERSONATION_CHECK_UNAVAILABLE: could not confirm this is not an impersonation session.',
    code: verdict === 'IMPERSONATING' ? 'READ_ONLY_IMPERSONATION' : 'IMPERSONATION_CHECK_UNAVAILABLE',
  }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
