// HOMATCH — handing a browser an anonymous identity it can later cash in.
//
// The ownership model already exists: anonymous work belongs to a session, the
// session is proven by a secret the browser holds, only the sha256 is stored,
// and claim_anonymous_session() transfers everything to whoever signs in.
// What was missing was the first step — somewhere for a browser to GET one.
//
// This mints, and nothing else. It never reads or returns anybody's work, so
// the worst a stolen response can do is give an attacker an empty session of
// their own.
//
// The raw token is returned EXACTLY once, in this response, and is never
// recoverable afterwards: the row keeps only its hash. A browser that loses it
// has lost that anonymous work, which is the correct trade — the alternative
// is a token we could hand back to anybody who asks.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Rate-limit key, reusing the table the rest of the platform already uses. */
const RATE_LIMIT_OPERATION = 'anon_session_mint';
/** Per IP per day. Generous for real people, useless for bulk minting. */
const MINTS_PER_IP_PER_DAY = 20;

/**
 * 48 random bytes, base64url.
 *
 * Comfortably past the 32-character floor claim_anonymous_session() enforces,
 * and far past anything that could be guessed. crypto.getRandomValues is the
 * platform CSPRNG — Math.random would be a real vulnerability here, since this
 * value is the only thing standing between a stranger and somebody's research.
 */
function mintToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    if (String(body?.action ?? 'mint') !== 'mint') return json({ error: 'unknown action' }, 400);

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';

    // Anonymous research and anonymous model calls both cost money, so the
    // number of identities one address can create is bounded.
    const now = new Date();
    const dayStartUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();
    const { count } = await sb
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .eq('operation', RATE_LIMIT_OPERATION)
      .gte('created_at', dayStartUtc);

    if ((count ?? 0) >= MINTS_PER_IP_PER_DAY) {
      return json({ error: 'too many sessions from this address today', code: 'RATE_LIMIT_EXCEEDED' }, 429);
    }

    const token = mintToken();
    const { data, error } = await sb
      .from('anonymous_sessions')
      .insert({
        token_sha256: await sha256Hex(token),
        // A hint for abuse review only. Hashed, because it is not ours to keep
        // in the clear and we never need to read it back.
        user_agent_sha: await sha256Hex(req.headers.get('user-agent') ?? ''),
      })
      .select('id, expires_at')
      .single();

    if (error) {
      console.error('anon-session: could not mint', error.message ?? error);
      return json({ error: 'could not start a session' }, 500);
    }

    await sb.from('rate_limit_events').insert({ ip_address: ip, operation: RATE_LIMIT_OPERATION });

    // The only time this value exists outside the browser that asked for it.
    return json({ token, sessionId: data.id, expiresAt: data.expires_at });
  } catch (e) {
    console.error('anon-session failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'could not start a session' }, 500);
  }
});
