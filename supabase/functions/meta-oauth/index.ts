// META ADS — OAuth callback (REAL mode only; MOCK connects through
// meta-ads-api:oauth_mock_connect and never reaches Facebook).
//
// GET ?code=&state= — Meta redirects here after the consent dialog. The
// state carries {uid, nonce}; the nonce was written into the caller's own
// meta_connections row by oauth_start, so a forged or replayed state fails
// the nonce comparison and connects nobody. Tokens go into meta_tokens
// (service-role-only) and never into a URL, a log or the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { exchangeCodeForToken, metaMode, graph } from '../_shared/metaAds.ts';

const HOME = Deno.env.get('META_OAUTH_RETURN') ?? 'https://www.homatch.live/outreach/meta';

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

Deno.serve(async (req) => {
  if (metaMode() !== 'REAL') return redirect(`${HOME}?connect=mock_mode`);
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (!code || !stateRaw) return redirect(`${HOME}?connect=denied`);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let uid = ''; let nonce = '';
  try {
    const parsed = JSON.parse(atob(stateRaw));
    uid = String(parsed.uid ?? ''); nonce = String(parsed.nonce ?? '');
  } catch { return redirect(`${HOME}?connect=bad_state`); }

  const { data: conn } = await sb.from('meta_connections')
    .select('id,last_error').eq('user_id', uid).maybeSingle();
  if (!conn || conn.last_error !== nonce) return redirect(`${HOME}?connect=bad_state`);

  try {
    const { token, expiresIn } = await exchangeCodeForToken(code);
    const meRes = await graph('/me?fields=id,name', { token });
    const grantedRes = await graph('/me/permissions', { token });
    const granted = ((grantedRes.data as any[]) ?? [])
      .filter((p) => p.status === 'granted').map((p) => String(p.permission));
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    await sb.from('meta_connections').update({
      status: 'CONNECTED', meta_user_external_id: String(meRes.id),
      granted_scopes: granted, token_expires_at: expiresAt,
      last_checked_at: new Date().toISOString(), last_error: null,
    }).eq('id', conn.id);
    await sb.from('meta_tokens').upsert({
      connection_id: conn.id, access_token: token, expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    await sb.from('meta_funnel_events').insert({ event: 'meta_connected', user_id: uid });
    return redirect(`${HOME}?connect=ok`);
  } catch (err) {
    console.error('[meta-oauth]', err);
    await sb.from('meta_connections').update({
      status: 'ERROR', last_error: 'OAUTH_EXCHANGE_FAILED',
    }).eq('id', conn.id);
    return redirect(`${HOME}?connect=error`);
  }
});
