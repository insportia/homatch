// HOMATCH Communications — the auth matrix, in code.
//
// §140 asks for it to be documented AND implemented:
//
//   user-invoked      JWT required, and the user id comes from the VERIFIED
//                     token, never from the request body
//   provider webhook  JWT disabled, provider signature verified in the body
//   internal worker   service authentication
//   admin             JWT plus a server-side admin check
//
// §126 is why it is one file: "Avoid copy-paste security logic across Edge
// Functions." Nine functions each re-deriving "is this person an admin" is
// nine chances to get it wrong, and the one that gets it wrong is the one
// nobody reviews.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

/**
 * The same CORS headers, for a response that is not JSON.
 *
 * Streamed replies build their own Response, and a stream without these is a
 * stream the browser refuses to read.
 */
export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

export function preflight(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}

/** Full privileges. Only ever constructed inside a function, never handed out. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export interface Caller {
  userId: string;
  email: string | null;
  /** A client carrying the CALLER's token, so RLS applies to whatever it reads. */
  sb: SupabaseClient;
}

/**
 * Identify the caller from the Authorization header.
 *
 * The user id is taken from the verified token and from nowhere else. A
 * `userId` or `owner_id` in a request body is attacker-controlled input, and
 * every function here ignores it.
 */
export async function authenticate(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: header } }, auth: { persistSession: false } },
  );

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null, sb };
}

/**
 * Admin, checked on the SERVER.
 *
 * §72: "Do not depend solely on `is_admin` passed from client." The token is
 * verified first, then public.is_admin() is evaluated in Postgres for that
 * token's own identity. A claim in the JWT body would be trusting whatever the
 * client sent; this is asking the database.
 */
export async function requireAdmin(req: Request): Promise<{ caller: Caller; sb: SupabaseClient } | null> {
  const caller = await authenticate(req);
  if (!caller) return null;

  const { data, error } = await caller.sb.rpc('is_admin');
  if (error || data !== true) return null;

  // Admin work runs with the service role because it legitimately reads across
  // tenants — but only AFTER is_admin() said yes for this specific caller.
  return { caller, sb: serviceClient() };
}

/**
 * A worker calling in.
 *
 * The shared secret is compared in constant time and the function refuses
 * outright when it is unset, rather than defaulting to open. An internal
 * endpoint whose guard silently disables itself when a secret is missing is
 * the exact shape of the bug that let the whole internet into the worker guard
 * once already (see commit "The worker guard let the whole internet in").
 */
export function isInternalWorker(req: Request): boolean {
  const expected = Deno.env.get('WORKER_TOKEN') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!expected) return false;

  const presented = req.headers.get('x-worker-secret')
    ?? (req.headers.get('Authorization')?.startsWith('Bearer ')
      ? req.headers.get('Authorization')!.slice(7)
      : null);
  if (!presented) return false;

  return timingSafeEqual(presented, expected);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/**
 * A rate limit that is actually a limit.
 *
 * Counted in Postgres against rate_limit_events, which the platform already
 * has, because an in-memory counter in an edge function is per-isolate and
 * resets whenever the platform feels like it — which is to say, it is not a
 * limit, it is a suggestion.
 */
export async function checkRateLimit(
  sb: SupabaseClient,
  /** Goes into rate_limit_events.operation, which is the column that exists. */
  operation: string,
  limit: number,
  windowSeconds: number,
  subject: { userId?: string | null; ipAddress?: string | null } = {},
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  let query = sb.from('rate_limit_events')
    .select('*', { count: 'exact', head: true })
    .eq('operation', operation)
    .gte('created_at', since);
  // Scope to whoever is being limited. Without this every caller shares one
  // bucket and the first busy customer locks out the rest.
  if (subject.userId) query = query.eq('user_id', subject.userId);
  else if (subject.ipAddress) query = query.eq('ip_address', subject.ipAddress);

  const { count, error } = await query;

  if (error) {
    // Fail CLOSED for anything that costs money. The caller decides what this
    // means for it; returning "allowed" on an error would turn a database
    // hiccup into an unmetered send.
    return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };
  }

  const used = count ?? 0;
  if (used >= limit) return { allowed: false, remaining: 0, retryAfterSeconds: windowSeconds };

  await sb.from('rate_limit_events').insert({
    operation,
    user_id: subject.userId ?? null,
    ip_address: subject.ipAddress ?? null,
  });
  return { allowed: true, remaining: Math.max(0, limit - used - 1), retryAfterSeconds: 0 };
}

// ── Logging that does not leak ──────────────────────────────────────────────

/**
 * §74. Phone numbers, emails and transcripts do not belong in logs.
 *
 * Every function here logs through this, so redaction is the default rather
 * than something each author has to remember. The reference that IS safe — an
 * id — is what makes a log line useful anyway.
 */
export function redact(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => `${m.slice(0, 4)}***${m.slice(-2)}`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => `${m[0]}***@${m.split('@')[1]}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***')
    .slice(0, 2_000);
}

export function logEvent(scope: string, event: string, detail: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    safe[k] = typeof v === 'number' || typeof v === 'boolean' || v === null ? v : redact(v);
  }
  console.log(JSON.stringify({ scope, event, ...safe }));
}
