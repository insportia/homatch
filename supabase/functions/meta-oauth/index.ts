// META ADS — OAuth callback + deauthorize callback (REAL mode only; MOCK
// connects through meta-ads-api:oauth_mock_connect and never reaches
// Facebook).
//
// GET ?code=&state=
//   Meta redirects here after the consent dialog. The state is HMAC-signed
//   with the app secret and expires after 15 minutes (verifyOAuthState); it
//   carries {uid, nonce}, and the nonce must also equal the one oauth_start
//   wrote to that user's own meta_connections.oauth_nonce. A forged,
//   replayed or stale state connects nobody. Tokens are sealed and go into
//   meta_tokens (service-role-only) — never into a URL, a log or the browser.
//
// POST signed_request=…
//   Meta's "Deauthorize Callback": the person removed the app. The
//   connection becomes REVOKED and the stored token is deleted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  exchangeCodeForToken, metaMode, graph, verifyOAuthState, sealToken, parseSignedRequest, scrubText,
} from '../_shared/metaAds.ts';

const HOME = Deno.env.get('META_OAUTH_RETURN') ?? 'https://www.homatch.live/outreach/meta';

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const parsed = await parseSignedRequest(String(form?.get('signed_request') ?? ''));
    if (!parsed?.user_id) return new Response('bad signed_request', { status: 400 });
    const { data: conns } = await sb.from('meta_connections').select('id').eq('meta_user_external_id', String(parsed.user_id));
    for (const c of conns ?? []) {
      await sb.from('meta_tokens').delete().eq('connection_id', c.id);
      await sb.from('meta_connections').update({ status: 'REVOKED', last_error: 'DEAUTHORIZED_BY_USER' }).eq('id', c.id);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (metaMode() !== 'REAL') return redirect(`${HOME}?tab=connections&connect=mock_mode`);
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return redirect(`${HOME}?tab=connections&connect=denied`);
  const code = url.searchParams.get('code');
  const state = await verifyOAuthState(url.searchParams.get('state') ?? '');
  if (!code || !state) return redirect(`${HOME}?tab=connections&connect=bad_state`);

  const { data: conn } = await sb.from('meta_connections')
    .select('id,oauth_nonce').eq('user_id', state.uid).maybeSingle();
  if (!conn || !conn.oauth_nonce || conn.oauth_nonce !== state.nonce) {
    return redirect(`${HOME}?tab=connections&connect=bad_state`);
  }
  // One use only.
  await sb.from('meta_connections').update({ oauth_nonce: null }).eq('id', conn.id);

  try {
    const { token, expiresIn } = await exchangeCodeForToken(code);
    const [meRes, grantedRes] = await Promise.all([
      graph('/me?fields=id', { token }),
      graph('/me/permissions', { token }),
    ]);
    const granted = ((grantedRes.data as Array<{ status?: string; permission?: string }>) ?? [])
      .filter((p) => p.status === 'granted').map((p) => String(p.permission));
    const declined = ((grantedRes.data as Array<{ status?: string; permission?: string }>) ?? [])
      .filter((p) => p.status === 'declined').map((p) => String(p.permission));
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    await sb.from('meta_connections').update({
      status: 'CONNECTED', meta_user_external_id: String(meRes.id),
      granted_scopes: granted, declined_scopes: declined, token_expires_at: expiresAt,
      last_checked_at: new Date().toISOString(), last_error: null,
    }).eq('id', conn.id);
    await sb.from('meta_tokens').upsert({
      connection_id: conn.id, access_token: await sealToken(token), expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    await sb.from('meta_funnel_events').insert({ event: 'meta_connected', user_id: state.uid });
    return redirect(`${HOME}?tab=connections&connect=ok`);
  } catch (err) {
    console.error('[meta-oauth] exchange failed', scrubText(err instanceof Error ? err.message : String(err)));
    await sb.from('meta_connections').update({ status: 'ERROR', last_error: 'OAUTH_EXCHANGE_FAILED' }).eq('id', conn.id);
    return redirect(`${HOME}?tab=connections&connect=error`);
  }
});
