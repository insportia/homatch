/**
 * THREE ANSWERS TO "IS SOMEBODY SIGNED IN?", NOT TWO.
 *
 * On every mobile refresh an authenticated customer was shown the guest
 * header — HOMATCH, language, Login, Register — and then, a moment later, the
 * real one. They had not been signed out. supabase-js restores the session
 * from storage asynchronously, so for the first frames `session` is null, and
 * every consumer that asked `session ? authenticated : guest` answered
 * "guest" about a question that had no answer yet.
 *
 * The bug is the shape of the question. `session` is a two-valued thing being
 * asked to carry three states, and the third one — we do not know yet — has
 * to collapse into one of the other two. It collapsed into the worst one: a
 * signed-in customer being offered a Register button, and a full shell swap
 * (sidebar layout replacing top-nav layout) the instant the truth arrived.
 *
 * WHY THIS IS NOT SOLVED WITH A DELAY
 *
 * A timeout would trade a wrong header for a slow one, and would still be
 * wrong on a slow connection — the failure mode it is meant to hide is
 * exactly the one where restoration takes longest.
 *
 * What is actually knowable synchronously is whether a session was PERSISTED.
 * supabase-js writes it to localStorage under `sb-<ref>-auth-token` and reads
 * that same key back on start. So before any await:
 *
 *   a token is present   → somebody was signed in on this device. We do not
 *                          yet know whether it is still valid, so the honest
 *                          state is UNKNOWN and the honest UI is a neutral
 *                          shell that commits to neither answer.
 *   no token at all      → there is nothing to restore. This is not a guess
 *                          and not a wait: the visitor is a guest, now, and
 *                          gets the guest header immediately with no flash.
 *
 * That is the whole design. It never claims someone is authenticated before
 * the session is verified — an expired or tampered token still resolves to
 * UNAUTHENTICATED a moment later, because the answer comes from supabase-js
 * and not from here.
 */

export type AuthStatus =
  /** Restoration is in flight and a session may exist. Commit to nothing. */
  | 'UNKNOWN'
  /** A session has been verified. */
  | 'AUTHENTICATED'
  /** There is no session, and that is established rather than assumed. */
  | 'UNAUTHENTICATED';

/** supabase-js's default persistence key, whatever the project ref is. */
const TOKEN_KEY = /^sb-.+-auth-token$/;

/**
 * Was a session persisted on this device?
 *
 * Read synchronously, before the first paint. Says nothing about whether the
 * token is still VALID — only that restoration has something to attempt, so
 * the interface should not yet claim the visitor is a guest.
 */
export function hasPersistedSession(storage?: Storage | null): boolean {
  try {
    const s = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!s) return false;
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (!key || !TOKEN_KEY.test(key)) continue;
      const value = s.getItem(key);
      // supabase-js writes the session object itself. An empty string, "null"
      // or a cleared entry is a key left behind by a sign-out, not a session.
      if (value && value !== 'null' && value !== '{}' && value.length > 2) return true;
    }
  } catch {
    // Storage can throw outright in private modes and locked-down browsers.
    // Someone whose browser refuses storage cannot have a restorable session,
    // so treating that as "no session" is both safe and correct.
  }
  return false;
}

/**
 * The one place the three states are decided.
 *
 * `persisted` must be sampled ONCE, at startup, before restoration runs.
 * Re-reading it later would make a sign-out look like a hydration.
 */
export function deriveAuthStatus(input: {
  /** AuthContext's restoration-in-flight flag. */
  loading: boolean;
  /** The verified session, once there is one. */
  session: unknown | null;
  /** hasPersistedSession(), sampled at startup. */
  persisted: boolean;
}): AuthStatus {
  // Resolved: the answer is whatever supabase-js established, including for
  // an expired or invalid token, which arrives here as no session.
  if (!input.loading) return input.session ? 'AUTHENTICATED' : 'UNAUTHENTICATED';

  // Still restoring. A session already in hand (a second tab, a fast read)
  // is authenticated now; there is nothing left to wait for.
  if (input.session) return 'AUTHENTICATED';

  return input.persisted ? 'UNKNOWN' : 'UNAUTHENTICATED';
}

/** Never show a Login/Register call to action while this is true. */
export function isAuthUnresolved(status: AuthStatus): boolean {
  return status === 'UNKNOWN';
}
