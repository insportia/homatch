// impersonate-user — "Log in as user", for real, and read-only.
//
// WHAT USED TO HAPPEN
//
// This function recorded a session row and an audit row and returned a banner.
// The browser kept the ADMIN's own login, navigated to /dashboard and showed
// the admin's own dashboard under a banner claiming otherwise. Nothing an
// operator saw was the customer's view.
//
// WHAT HAPPENS NOW
//
//   start   (admin only, admin_impersonation_enabled must be true)
//           1. writes the audit row, then the impersonation_sessions row —
//              no audit, no session;
//           2. generates a magic-link token for the target WITH THE ADMIN API
//              and verifies it HERE, server-side. The link is never sent and
//              never leaves this function;
//           3. records the new session's `session_id` claim on the row, which
//              is what Postgres and the money paths use to refuse writes;
//           4. returns the ACCESS token and its expiry. Never the refresh
//              token: the session cannot outlive its access token, and the
//              target's existing sessions and password are never touched.
//   end_self (the impersonated session itself — the Exit button)
//           ends the row, revokes the minted session (scope 'local': that
//           session only, never the customer's own devices) and audits.
//   end     (admin only) ends one of the admin's own rows by id.
//   status  (admin only) whether impersonation is enabled.
//
// WHO CANNOT BE IMPERSONATED
//
// Another administrator (that would be a privilege path, not support), a
// profile with no sign-in, and an account whose email is unconfirmed — because
// verifying a magic link CONFIRMS the email, and support must not do that on
// somebody's behalf.
//
// KNOWN SIDE EFFECT, STATED RATHER THAN HIDDEN
//
// Verifying the link updates the target's auth.users.last_sign_in_at. The
// audit row and impersonation_sessions say which sign-in was ours.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sessionIdOf } from '../_shared/impersonation.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Svc = ReturnType<typeof createClient>;

interface SessionRow {
  id: string;
  admin_id: string;
  target_user_id: string;
  ended_at: string | null;
}

async function finish(svc: Svc, row: SessionRow, mintedToken: string | null, reason: string) {
  const now = new Date().toISOString();
  const wasOpen = !row.ended_at;
  if (wasOpen) {
    await svc.from('impersonation_sessions')
      .update({ ended_at: now, ended_reason: reason })
      .eq('id', row.id).is('ended_at', null);
  }
  let revoked = false;
  if (mintedToken) {
    /* 'local' = this one session. The default, 'global', would sign the
       customer out of every device they own. */
    const { error } = await svc.auth.admin.signOut(mintedToken, 'local');
    revoked = !error;
    if (revoked) await svc.from('impersonation_sessions').update({ revoked_at: now }).eq('id', row.id);
  }
  if (wasOpen) {
    await svc.from('admin_audit_log').insert({
      admin_id: row.admin_id,
      target_id: row.target_user_id,
      action: 'IMPERSONATION_END',
      entity_type: 'user',
      entity_id: row.target_user_id,
      metadata: { session_id: row.id, reason, revoked },
    });
  }
  return { revoked, wasOpen };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await svc.auth.getUser(callerToken);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');

    /* ── Exit, from inside the impersonated session ────────────────── */
    if (action === 'end_self') {
      const sid = sessionIdOf(authHeader);
      if (!sid) return json({ error: 'Not an impersonation session' }, 403);
      const { data: row } = await svc.from('impersonation_sessions')
        .select('id,admin_id,target_user_id,ended_at').eq('auth_session_id', sid).maybeSingle();
      if (!row) return json({ error: 'Not an impersonation session' }, 403);
      const result = await finish(svc, row as SessionRow, callerToken, 'EXITED');
      return json({ ended: true, session_id: (row as SessionRow).id, revoked: result.revoked });
    }

    /* ── Everything else is for administrators ─────────────────────── */
    const { data: adminRow } = await svc.from('users')
      .select('id,is_admin,email').eq('auth_id', user.id).maybeSingle();
    if (!adminRow?.is_admin) return json({ error: 'Forbidden: admin required' }, 403);

    const { data: flagRow } = await svc.from('admin_settings')
      .select('value').eq('key', 'admin_impersonation_enabled').maybeSingle();
    const enabled = flagRow?.value === true || flagRow?.value === 'true';

    if (action === 'status') return json({ enabled });

    if (action === 'end') {
      const sessionId = String(body.session_id ?? '');
      if (!UUID.test(sessionId)) return json({ error: 'session_id required' }, 400);
      const { data: row } = await svc.from('impersonation_sessions')
        .select('id,admin_id,target_user_id,ended_at').eq('id', sessionId).eq('admin_id', user.id).maybeSingle();
      if (!row) return json({ error: 'Session not found or not yours' }, 404);
      const result = await finish(svc, row as SessionRow, null, 'ADMIN_ENDED');
      return json({ ended: true, session_id: sessionId, was_open: result.wasOpen });
    }

    if (action !== 'start') {
      return json({ error: 'action must be "start", "end", "end_self" or "status"' }, 400);
    }

    /* ── start ─────────────────────────────────────────────────────── */
    if (!enabled) return json({ error: 'Impersonation is disabled', code: 'DISABLED' }, 403);

    const targetId = String(body.target_user_id ?? '');
    const reason = String(body.reason ?? '').trim().slice(0, 500);
    if (!UUID.test(targetId)) return json({ error: 'target_user_id required' }, 400);
    if (reason.length < 5) return json({ error: 'A reason of at least 5 characters is required', code: 'REASON_REQUIRED' }, 400);

    const { data: target } = await svc.from('users')
      .select('id,auth_id,email,full_name,is_admin').eq('id', targetId).maybeSingle();
    if (!target) return json({ error: 'Target user not found' }, 404);
    if (target.is_admin) return json({ error: 'Administrators cannot be impersonated', code: 'TARGET_IS_ADMIN' }, 403);
    if (target.auth_id === user.id) return json({ error: 'That is your own account' }, 400);
    if (!target.auth_id) return json({ error: 'This profile has no sign-in', code: 'NO_LOGIN' }, 409);

    const { data: authTarget } = await svc.auth.admin.getUserById(target.auth_id);
    const authUser = authTarget?.user;
    if (!authUser?.email) return json({ error: 'This account has no email sign-in', code: 'NO_EMAIL' }, 409);
    if (!authUser.email_confirmed_at) {
      return json({ error: 'The account email is unconfirmed; signing in would confirm it', code: 'EMAIL_UNCONFIRMED' }, 409);
    }
    const bannedUntil = (authUser as { banned_until?: string | null }).banned_until;
    if (bannedUntil && Date.parse(bannedUntil) > Date.now()) {
      return json({ error: 'This account is banned', code: 'BANNED' }, 409);
    }

    /* One open session per admin: a new start closes the last one. */
    await svc.from('impersonation_sessions')
      .update({ ended_at: new Date().toISOString(), ended_reason: 'SUPERSEDED' })
      .eq('admin_id', user.id).is('ended_at', null);

    const { data: auditRow, error: auditErr } = await svc.from('admin_audit_log').insert({
      admin_id: user.id,
      target_id: target.id,
      action: 'IMPERSONATION_START',
      entity_type: 'user',
      entity_id: target.id,
      metadata: { reason, admin_email: adminRow.email ?? user.email, target_email: target.email },
    }).select('id').maybeSingle();
    if (auditErr || !auditRow) return json({ error: 'Could not write the audit record; nothing was started' }, 500);

    const { data: sessionRow, error: sessionErr } = await svc.from('impersonation_sessions').insert({
      admin_id: user.id,
      target_user_id: target.id,
      target_auth_id: target.auth_id,
      reason,
      audit_log_id: auditRow.id,
    }).select('id,admin_id,target_user_id,ended_at,started_at').maybeSingle();
    if (sessionErr || !sessionRow) return json({ error: 'Could not record the session; nothing was started' }, 500);
    const row = sessionRow as SessionRow & { started_at: string };

    const fail = async (message: string, status = 502) => {
      await finish(svc, row, null, 'MINT_FAILED');
      return json({ error: message, code: 'MINT_FAILED' }, status);
    };

    const { data: link, error: linkErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: authUser.email });
    const hashed = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
    if (linkErr || !hashed) return fail('Could not create a sign-in for this account');

    const minting = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: verifyErr } = await minting.auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
    const minted = verified?.session;
    if (verifyErr || !minted?.access_token) return fail('Could not sign in as this account');

    const authSessionId = sessionIdOf(`Bearer ${minted.access_token}`);
    const expiresAt = minted.expires_at
      ? new Date(minted.expires_at * 1000).toISOString()
      : new Date(Date.now() + (minted.expires_in ?? 3600) * 1000).toISOString();

    const { error: recordErr } = authSessionId
      ? await svc.from('impersonation_sessions')
        .update({ auth_session_id: authSessionId, expires_at: expiresAt }).eq('id', row.id)
      : { error: { message: 'token carries no session_id' } };
    if (recordErr) {
      /* A session Postgres cannot recognise would be a WRITABLE login. Revoke
         it before anyone can use it. */
      await svc.auth.admin.signOut(minted.access_token, 'local');
      return fail('Could not record the session; it was revoked', 500);
    }

    const u = minted.user;
    return json({
      session_id: row.id,
      started_at: row.started_at,
      expires_at: minted.expires_at ?? Math.floor(Date.parse(expiresAt) / 1000),
      access_token: minted.access_token,
      token_type: 'bearer',
      /* What the browser needs to render the account, and nothing that
         identifies how else to reach it. No refresh token, ever. */
      user: {
        id: u.id,
        aud: u.aud,
        role: u.role,
        email: u.email,
        created_at: u.created_at,
        app_metadata: { provider: u.app_metadata?.provider ?? 'email' },
        user_metadata: {},
      },
      target_user: { id: target.id, email: target.email, full_name: target.full_name },
      reason,
    });
  } catch (err) {
    console.error('[impersonate-user] error:', err instanceof Error ? err.message : String(err));
    return json({ error: 'Impersonation failed' }, 500);
  }
});
