// HOMATCH — the one place that decides whether an anonymous token is usable.
//
// Two edge functions now accept anonymous callers: homatch-ai, and the Verify
// orchestrator. Both have to answer the same question — does this secret prove
// a session that may still act? — and if the two answers ever drift, the
// looser one becomes the real rule. A claimed session that could still talk
// after being handed to an account, or an expired one that could still start
// research, is not a small inconsistency: it is anonymous work spending money
// on behalf of an identity that no longer exists.
//
// So the rule lives here once and is imported by both. The edge runtime can
// import from src/ by relative path — verify-synthesis and research-agent
// already do, and the CLI bundles the closure.
//
// Everything here is deliberately free of any Supabase or Deno type: it takes
// the row and the clock, and returns a verdict.

/**
 * The floor claim_anonymous_session() also enforces in SQL.
 *
 * Shorter than this is not a token we ever minted — the real ones are 48
 * random bytes — so it is refused before anything is looked up. That is not
 * only about guessing: a lookup is an oracle, and refusing early means an
 * attacker cannot use response timing on obviously-invalid input.
 */
export const ANON_TOKEN_MIN_LENGTH = 32;

/** The columns any caller must select for {@link anonSessionUsable} to judge. */
export interface AnonSessionRow {
  id: string;
  expires_at: string;
  claimed_at: string | null;
  user_messages?: number;
  research_jobs?: number;
}

/**
 * Hex sha256, using the platform's own crypto.
 *
 * The raw token is never stored, never logged and never compared directly;
 * only this value ever reaches the database.
 */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when a token is the right SHAPE to be worth looking up. Not a check that it is valid. */
export function anonTokenPlausible(token: unknown): token is string {
  return typeof token === 'string' && token.length >= ANON_TOKEN_MIN_LENGTH;
}

/**
 * Whether this session may still act.
 *
 * A CLAIMED session is finished, even though its row still exists and its
 * token still hashes correctly. The work now belongs to an account, and RLS is
 * what protects it there — continuing to honour the old secret would be a
 * second, weaker key to the same data that outlives the handover. The person
 * holding it is signed in; they can carry on as themselves.
 *
 * An EXPIRED session is finished for the same reason the expiry exists: an
 * anonymous identity that never converts must stop being able to spend.
 */
export function anonSessionUsable(row: AnonSessionRow | null | undefined, nowMs: number = Date.now()): boolean {
  if (!row) return false;
  if (row.claimed_at) return false;
  return new Date(row.expires_at).getTime() > nowMs;
}
