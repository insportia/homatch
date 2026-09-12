// HOMATCH — a short-lived Cartesia grant for an authenticated user.
//
// THIS FUNCTION ALREADY EXISTED IN PRODUCTION AND NOT IN THE REPOSITORY.
//
// It was deployed directly (version 7) and has been returning HTTP 200 with a
// real Cartesia token. Bringing it into source control unchanged would have
// been dishonest about three things it was missing, so this is that function
// with those three fixed and its behaviour otherwise preserved:
//
//   no timeout        a hung fetch held the isolate until the platform killed
//                     it, and the caller saw nothing at all
//   no rate limit     verify_jwt=true is satisfied by Supabase's PUBLISHABLE
//                     anon key, so "authenticated" did not mean "a person".
//                     Anyone with the public key could mint 300-second agent
//                     grants in a loop.
//   fixed 300s TTL    a grant lives as long as it needs to and no longer
//
// The homepage demo does NOT use this endpoint. It uses ai-talk-session, which
// applies the anonymous allowance in §28. This is for authenticated in-product
// voice: Voice Studio's live test, and agent preview.
//
// CARTESIA_API_KEY never reaches the browser (§139).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { authenticate, serviceClient, json, preflight, checkRateLimit, logEvent } from '../_shared/comm/auth.ts';
import { createCartesiaProvider, cartesiaCredentialsPresent, listCartesiaVoices } from '../_shared/comm/cartesia.ts';

/**
 * Enough for a live test of an agent, short enough that a leaked token is
 * worth little. Cartesia's own ceiling is applied in the adapter.
 */
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 600;

/** A person testing voices does that a handful of times, not a hundred. */
const MINTS_PER_HOUR = 30;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  if (!cartesiaCredentialsPresent().ok) {
    return json({ error: 'not_configured' }, 503);
  }

  const sb = serviceClient();

  // GET lists voices for Voice Studio. Read-only, and it costs nothing, so it
  // shares the endpoint rather than needing its own.
  if (req.method === 'GET') {
    const voices = await listCartesiaVoices(100);
    if (!voices.ok) return json({ error: 'voices_unavailable', code: voices.error?.code ?? null }, 502);
    return json({ ok: true, voices: voices.data });
  }

  const limit = await checkRateLimit(sb, 'cartesia_token_mint', MINTS_PER_HOUR, 3600, { userId: caller.userId });
  if (!limit.allowed) {
    logEvent('cartesia-token', 'rate_limited', { userId: caller.userId });
    return json({ error: 'rate_limited', retryAfter: limit.retryAfterSeconds }, 429);
  }

  let requestedTtl = DEFAULT_TTL_SECONDS;
  let scopes = ['agent'];
  try {
    const body = await req.json() as { ttlSeconds?: number; scopes?: string[] };
    if (Number.isFinite(body?.ttlSeconds)) {
      requestedTtl = Math.min(MAX_TTL_SECONDS, Math.max(30, Math.floor(Number(body.ttlSeconds))));
    }
    if (Array.isArray(body?.scopes) && body.scopes.length) {
      // Only scopes this product actually uses. A caller asking for something
      // else gets the default rather than a wider grant.
      scopes = body.scopes.filter((s) => ['agent', 'tts', 'stt'].includes(String(s)));
      if (!scopes.length) scopes = ['agent'];
    }
  } catch {
    /* an empty body is the ordinary case and means "the defaults" */
  }

  const provider = createCartesiaProvider();
  const grant = await provider.mintGrant({ ttlSeconds: requestedTtl, scopes });

  if (!grant.ok || !grant.data) {
    logEvent('cartesia-token', 'mint_failed', { code: grant.error?.code ?? null });
    // The provider's own message is not forwarded: it can echo request
    // details, and a customer has no use for it (§92, §106).
    return json({ error: 'token_unavailable' }, 502);
  }

  logEvent('cartesia-token', 'minted', { userId: caller.userId, ttl: requestedTtl, scopes: scopes.join(',') });

  return json({
    token: grant.data.token,
    expiresAt: grant.data.expiresAt,
    expiresIn: requestedTtl,
    grants: scopes,
    provider: 'CARTESIA',
  });
});
