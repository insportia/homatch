// HOMATCH SPEECH GATEWAY — the grant, and the question of whether anybody is
// listening on the other end.
//
// WHY THIS IS ITS OWN FILE
//
// Two callers need it now. The AI TALK session mints a grant when it routes a
// visitor to Google; the admin Voice AI screen mints one to PROVE the socket
// works without switching the production route on. Those are different jobs
// with the same cryptography, and the one thing that must never happen is two
// implementations of it.
//
// The worker verifies these grants in Node, in another repository directory,
// on another machine. A separator, a hash or a field order changing on one
// side and not the other is not a compile error anywhere — it is a socket that
// answers 401 forever, discovered by somebody speaking Georgian into a page
// that never replies. official-worker/test/speechGrant.test.mjs reads THIS
// file to check the two halves still agree, which only works while there is
// exactly one half to read.

/**
 * Where the gRPC-capable worker lives.
 *
 * Overridable because staging and production are different hosts, defaulted
 * because a missing variable must not silently mean "no speech".
 */
export function speechWorkerOrigin(): string {
  return Deno.env.get('SPEECH_WORKER_URL')
    || 'https://homatch-official-worker-production.up.railway.app';
}

/** The same origin as a WebSocket, which is the only thing a browser can open. */
export function speechSocketUrl(): string {
  return `${speechWorkerOrigin().replace(/^http/, 'ws')}/speech/stream`;
}

/** How long a minted grant is worth anything. */
export const GRANT_TTL_MS = 5 * 60_000;

/**
 * A short-lived proof that Homatch sent this browser to the worker.
 *
 * WHY AN HMAC AND NOT A LOOKUP
 *
 * AI TALK's visitors are anonymous, so there is no user token to check. The
 * worker and this function already share WORKER_TOKEN and neither gives it to
 * a browser. Signing `sessionId.expiry` with it lets the worker verify the
 * grant with no database round trip in the path of somebody's first word, and
 * lets a stolen grant be worth nothing within minutes.
 *
 * The payload is readable on purpose: it is a session id the holder already
 * has. What it cannot be is edited.
 *
 * Returns null rather than throwing when the secret is absent. A worker with
 * no WORKER_TOKEN refuses every grant, so minting one would be issuing a
 * ticket to a door that is bolted.
 */
export async function mintSpeechGrant(sessionId: string): Promise<string | null> {
  const secret = Deno.env.get('WORKER_TOKEN');
  if (!secret) return null;

  const expiresAt = Date.now() + GRANT_TTL_MS;
  const payload = `${sessionId}.${expiresAt}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${payload}.${hex}`;
}

/**
 * Is Google recognition actually usable right now?
 *
 * Asks the worker rather than assuming: the route being enabled says an
 * operator WANTS it, and /health says whether the instance holding the
 * credential is alive and configured. Those are different facts and only the
 * second one can be trusted in the path of a real conversation.
 *
 * Bounded and swallowed — a health check that delays somebody's first word is
 * worse than the fallback it protects.
 */
export async function googleSpeechReady(
  timeoutMs = 2500,
): Promise<{ model: string; language: string } | null> {
  try {
    const res = await fetch(`${speechWorkerOrigin()}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      speech?: { available?: boolean; model?: string; language?: string };
    };
    if (!body?.speech?.available) return null;
    return {
      model: String(body.speech.model ?? 'chirp_3'),
      language: String(body.speech.language ?? 'ka-GE'),
    };
  } catch {
    return null;
  }
}

/**
 * Why the worker says it cannot serve speech, for an operator's eyes.
 *
 * Separate from googleSpeechReady because the live path does not care WHY —
 * it falls through to Scribe either way — and a diagnostic screen cares about
 * nothing else. The reason is the worker's own short code (a missing
 * credential, a region that does not answer), never a credential value.
 */
export async function googleSpeechDiagnosis(
  timeoutMs = 4000,
): Promise<{ reachable: boolean; available: boolean; reason: string | null; model: string | null; language: string | null }> {
  try {
    const res = await fetch(`${speechWorkerOrigin()}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { reachable: true, available: false, reason: `HTTP_${res.status}`, model: null, language: null };
    }
    const body = await res.json() as {
      speech?: { available?: boolean; reason?: string | null; model?: string; language?: string };
    };
    return {
      reachable: true,
      available: body?.speech?.available === true,
      reason: body?.speech?.reason ? String(body.speech.reason).slice(0, 60) : null,
      model: body?.speech?.model ? String(body.speech.model) : null,
      language: body?.speech?.language ? String(body.speech.language) : null,
    };
  } catch {
    return { reachable: false, available: false, reason: 'WORKER_UNREACHABLE', model: null, language: null };
  }
}
