// HOMATCH — the browser's half of anonymous ownership.
//
// The server model already exists: anonymous work belongs to a session, the
// session is proven by a secret, only its sha256 is stored, and
// claim_anonymous_session() hands everything to whoever signs in. This is the
// small piece that lives in the browser: hold the secret, send it, and cash it
// in once there is an account to give the work to.
//
// The token is the ONLY thing standing between a stranger and this visitor's
// research, so it is never put in a URL, never sent to anything but our own
// functions, and never logged.

import { supabase } from '@/db/supabase';

const STORAGE_KEY = 'homatch.anon.session';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * localStorage, deliberately.
 *
 * sessionStorage would lose the conversation on the sign-in round trip, which
 * is exactly the moment the token has to survive. A cookie would be sent to
 * every request whether or not it was needed.
 *
 * Every access is guarded: a browser in private mode, or one configured to
 * block site data, throws rather than returning null, and an anonymous visitor
 * is precisely the kind of person likely to have that turned on. Losing the
 * token degrades to "no anonymous session", never to a crash.
 */
function readToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.length >= 32 ? raw : null;
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* The session still works for this page; it will not survive a reload. */
  }
}

export function clearAnonymousSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function currentAnonymousToken(): string | null {
  return readToken();
}

/**
 * The browser's anonymous session, minting one the first time.
 *
 * Returns null when a session cannot be obtained — offline, rate-limited, or
 * storage unavailable — and every caller treats that as "no anonymous
 * session", never as an error worth showing.
 */
export async function ensureAnonymousSession(): Promise<string | null> {
  const existing = readToken();
  if (existing) return existing;

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/anon-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ action: 'mint' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = typeof data?.token === 'string' ? data.token : null;
    if (!token) return null;
    writeToken(token);
    return token;
  } catch {
    return null;
  }
}

export interface ClaimResult {
  claimed: boolean;
  conversations: number;
  researchJobs: number;
  /** True when this browser had already claimed it — a refresh, not a failure. */
  already: boolean;
}

/**
 * Hand everything this browser did anonymously to the account that just
 * signed in.
 *
 * Safe to call on every sign-in: with no token it does nothing, and the server
 * treats a repeat as success rather than an error, so a refresh in the middle
 * of the round trip cannot break it.
 *
 * The token is cleared afterwards in every terminal case — claimed, or
 * unusable. Keeping a spent token would mean retrying a claim that can never
 * succeed on every subsequent sign-in.
 */
export async function claimAnonymousWork(): Promise<ClaimResult> {
  const none: ClaimResult = { claimed: false, conversations: 0, researchJobs: 0, already: false };
  const token = readToken();
  if (!token) return none;

  const { data, error } = await supabase.rpc('claim_anonymous_session', { p_token: token });

  if (error) {
    // The server gives one answer for every unusable token, deliberately, so
    // there is nothing to interpret here. It cannot become usable later.
    clearAnonymousSession();
    return none;
  }

  clearAnonymousSession();
  return {
    claimed: true,
    already: data?.already === true,
    conversations: Number(data?.conversations ?? 0),
    researchJobs: Number(data?.researchJobs ?? 0),
  };
}
