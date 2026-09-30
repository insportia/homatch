// META ADS — OAuth callback, Deauthorize callback and Data Deletion Request
// callback (REAL mode only for the OAuth exchange; MOCK connects through
// meta-ads-api:oauth_mock_connect and never reaches Facebook).
//
// GET ?code=&state=
//   Meta redirects here after the Facebook Login for Business dialog
//   (config_id, code grant — see src/lib/metaAds/oauth.ts). The state is
//   HMAC-signed with the app secret and expires after 15 minutes
//   (verifyOAuthState); it carries {uid, nonce}, and the nonce must also equal
//   the one oauth_start wrote to that user's own meta_connections.oauth_nonce.
//   A forged, replayed or stale state connects nobody. Tokens are sealed and
//   go into meta_tokens (service-role-only) — never into a URL, a log or the
//   browser.
//
// POST signed_request=…                      (Deauthorize Callback URL)
//   The person removed the app. The connection becomes REVOKED and the stored
//   token is deleted.
//
// POST ?action=data_deletion signed_request=… (Data Deletion Request URL)
//   The person asked Meta to have their data deleted. The token, the Facebook
//   assets listed from their account and the link to their Facebook identity
//   are deleted at once; the answer is Meta's required
//   { url, confirmation_code }, and the url shows the request's status.
//
// GET ?deletion_status=CODE
//   The status page that url points at: the date and what was done. Nothing
//   about the person is shown.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  exchangeCodeForToken, metaMode, graph, verifyOAuthState, sealToken, parseSignedRequest, scrubText, TokenEncryptionMissingError,
  metaAppId, metaAppSecret, metaLoginConfigId,
} from '../_shared/metaAds.ts';
import {
  CONFIRMATION_CODE, connectionIdentities, deletionResponse, hashMetaUserId, newConfirmationCode, signedRequestIdentities,
} from '../../../src/lib/metaAds/oauth.ts';

const HOME = Deno.env.get('META_OAUTH_RETURN') ?? 'https://www.homatch.live/outreach/meta';
const FUNCTION_URL = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/meta-oauth`;

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Sb = any;

/**
 * The connections a verified callback names: those that recorded one of its
 * ids when they were made (meta_connection_identities), or whose /me id is
 * one of them. Exactly those — never a connection another identity made.
 */
async function connectionsFor(sb: Sb, ids: string[]): Promise<Array<{ id: string; user_id: string }>> {
  if (ids.length === 0) return [];
  const [{ data: mapped }, { data: direct }] = await Promise.all([
    sb.from('meta_connection_identities').select('connection_id').in('external_id', ids),
    sb.from('meta_connections').select('id').in('meta_user_external_id', ids),
  ]);
  const connIds = [...new Set([...(mapped ?? []).map((r: any) => r.connection_id), ...(direct ?? []).map((r: any) => r.id)])];
  if (connIds.length === 0) return [];
  const { data } = await sb.from('meta_connections').select('id,user_id').in('id', connIds);
  return (data ?? []) as Array<{ id: string; user_id: string }>;
}

/** Deauthorize: revoke every connection this Facebook identity made. */
async function deauthorize(sb: Sb, ids: string[]): Promise<number> {
  const conns = await connectionsFor(sb, ids);
  for (const c of conns) {
    await sb.from('meta_tokens').delete().eq('connection_id', c.id);
    await sb.from('meta_connections').update({ status: 'REVOKED', last_error: 'DEAUTHORIZED_BY_USER' }).eq('id', c.id);
  }
  return conns.length;
}

/**
 * Data deletion: what HOMATCH holds that came from this Facebook identity —
 * the access token, the Pages / ad accounts / Instagram accounts listed from
 * it, and every link to the identity — is deleted now. Campaign, billing and
 * lead records are the HOMATCH customer's own business and accounting records
 * and are kept; the status page says so.
 */
async function deleteMetaData(sb: Sb, ids: string[]): Promise<{ connections: number; assets: number }> {
  const conns = await connectionsFor(sb, ids);
  let assets = 0;
  for (const c of conns) {
    await sb.from('meta_tokens').delete().eq('connection_id', c.id);
    const { count } = await sb.from('meta_assets').delete({ count: 'exact' }).eq('user_id', c.user_id);
    assets += Number(count ?? 0);
    await sb.from('meta_connection_identities').delete().eq('connection_id', c.id);
    await sb.from('meta_connections').update({
      status: 'DISCONNECTED', meta_user_external_id: null, granted_scopes: [], declined_scopes: [],
      token_expires_at: null, oauth_nonce: null, last_error: 'DATA_DELETION_REQUESTED',
    }).eq('id', c.id);
  }
  return { connections: conns.length, assets };
}

function statusPage(row: { status: string; created_at: string; completed_at: string | null } | null): Response {
  const state = row?.status === 'COMPLETED' ? 'Completed' : row?.status === 'UNMATCHED' ? 'Under review' : 'In progress';
  const body = row
    ? `<p>Request received: ${row.created_at.slice(0, 10)}</p>`
      + `<p>Status: ${state}${row.completed_at ? ` (${row.completed_at.slice(0, 10)})` : ''}</p>`
      + (row.status === 'COMPLETED'
        ? '<p>Your Facebook access token, the Facebook Pages, ad accounts and Instagram accounts HOMATCH listed from your account, and every link to your Facebook identity have been deleted.</p>'
        : row.status === 'UNMATCHED'
          ? '<p>HOMATCH could not automatically link the Facebook identity in this request to a HOMATCH connection. HOMATCH staff will review the request and complete it within 30 days.</p>'
          : '<p>Your request is being processed.</p>')
      + '<p>Advertising campaign, billing and lead records belong to the HOMATCH account that created them and are kept as business and accounting records. To ask about them, contact HOMATCH support.</p>'
    : '<p>No deletion request was found for this confirmation code.</p>';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>HOMATCH — Facebook data deletion</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">`
      + `<h1>Facebook data deletion</h1>${body}</body></html>`,
    { status: row ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const url = new URL(req.url);

  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const parsed = await parseSignedRequest(String(form?.get('signed_request') ?? ''));
    if (!parsed) return new Response('bad signed_request', { status: 400 });

    if (url.searchParams.get('action') === 'data_deletion') {
      const code = newConfirmationCode();
      const userHash = await hashMetaUserId(parsed.user_id);
      const { data: row, error } = await sb.from('meta_data_deletion_requests')
        .insert({ confirmation_code: code, meta_user_hash: userHash, status: 'RECEIVED' }).select('id').single();
      if (error || !row) {
        console.error('[meta-oauth] deletion request not recorded', scrubText(String(error?.message ?? '')));
        return new Response('deletion request could not be recorded', { status: 500 });
      }
      try {
        const done = await deleteMetaData(sb, signedRequestIdentities(parsed));
        /* Nothing linked is NOT reported as done: staff review it. */
        await sb.from('meta_data_deletion_requests').update(done.connections > 0
          ? { status: 'COMPLETED', completed_at: new Date().toISOString(), connections_deleted: done.connections, assets_deleted: done.assets }
          : { status: 'UNMATCHED' }).eq('id', row.id);
      } catch (err) {
        /* Recorded and answered; the status page says "in progress" and the
           admin sees FAILED until an operator finishes it. */
        await sb.from('meta_data_deletion_requests').update({
          status: 'FAILED', last_error: scrubText(err instanceof Error ? err.message : String(err)).slice(0, 300),
        }).eq('id', row.id);
      }
      return jsonResponse(deletionResponse(FUNCTION_URL, code));
    }

    await deauthorize(sb, signedRequestIdentities(parsed));
    return jsonResponse({ ok: true });
  }

  const statusCode = url.searchParams.get('deletion_status');
  if (statusCode !== null) {
    if (!CONFIRMATION_CODE.test(statusCode)) return statusPage(null);
    const { data: row } = await sb.from('meta_data_deletion_requests')
      .select('status,created_at,completed_at').eq('confirmation_code', statusCode).maybeSingle();
    return statusPage(row ?? null);
  }

  if (metaMode() !== 'REAL') return redirect(`${HOME}?tab=connections&connect=mock_mode`);
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
    /* With a Login for Business configuration the token belongs to a
       business-integration system user; /me and /me/permissions answer for it. */
    const meRes = await graph('/me?fields=id', { token });
    /* debug_token (app token) names the token's own ids and granted scopes.
       Its failure never fails the connection — /me is always recorded. */
    let debug: { user_id?: unknown; profile_id?: unknown; scopes?: unknown } | null = null;
    try {
      const d = await graph(`/debug_token?input_token=${encodeURIComponent(token)}`, { token: `${metaAppId()}|${metaAppSecret()}`, attempts: 1 });
      debug = (d.data ?? null) as typeof debug;
    } catch { /* recorded without the token's own ids */ }
    /* /me/permissions is the authoritative grant list; when a system-user
       token cannot answer it, debug_token's scopes are, and nothing is
       reported as declined that Meta did not say was declined. */
    let granted: string[] = [];
    let declined: string[] = [];
    try {
      const grantedRes = await graph('/me/permissions', { token });
      const rows = (grantedRes.data as Array<{ status?: string; permission?: string }>) ?? [];
      granted = rows.filter((p) => p.status === 'granted').map((p) => String(p.permission));
      declined = rows.filter((p) => p.status === 'declined').map((p) => String(p.permission));
    } catch {
      granted = Array.isArray(debug?.scopes) ? (debug!.scopes as unknown[]).map(String) : [];
    }
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    /* Sealed BEFORE the connection says CONNECTED: a credential that cannot
       be stored safely must never leave a "Connected" row behind. */
    const sealed = await sealToken(token);
    await sb.from('meta_connections').update({
      status: 'CONNECTED', meta_user_external_id: String(meRes.id),
      granted_scopes: granted, declined_scopes: declined, token_expires_at: expiresAt,
      last_checked_at: new Date().toISOString(), last_error: null,
    }).eq('id', conn.id);
    await sb.from('meta_tokens').upsert({
      connection_id: conn.id, access_token: sealed, expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    /* Every Meta identity this connection is known by, so Deauthorize and
       Data Deletion find it whichever id Meta sends (see migration
       20261001130000). debug_token uses the app token; its failure never
       fails the connection — /me is always recorded. */
    await sb.from('meta_connection_identities').delete().eq('connection_id', conn.id);
    const identities = connectionIdentities(meRes.id, debug, !!metaLoginConfigId());
    if (identities.length) {
      await sb.from('meta_connection_identities').insert(identities.map((i) => ({ connection_id: conn.id, ...i })));
    }
    /* A real connection replaces any TEST-mode assets from before Meta was
       live: they are unselected and marked unavailable, never offered again. */
    await sb.from('meta_assets').update({ selected: false, status: 'UNAVAILABLE' })
      .eq('user_id', state.uid).contains('capabilities', { mock: true });
    await sb.from('meta_funnel_events').insert({ event: 'meta_connected', user_id: state.uid });
    return redirect(`${HOME}?tab=connections&connect=ok`);
  } catch (err) {
    if (err instanceof TokenEncryptionMissingError) {
      await sb.from('meta_connections').update({ status: 'ERROR', last_error: 'TOKEN_ENCRYPTION_NOT_CONFIGURED' }).eq('id', conn.id);
      return redirect(`${HOME}?tab=connections&connect=encryption_missing`);
    }
    console.error('[meta-oauth] exchange failed', scrubText(err instanceof Error ? err.message : String(err)));
    await sb.from('meta_connections').update({ status: 'ERROR', last_error: 'OAUTH_EXCHANGE_FAILED' }).eq('id', conn.id);
    return redirect(`${HOME}?tab=connections&connect=error`);
  }
});
