// HOMATCH — ONE PLACE TO CONNECT A SOCIAL ACCOUNT, AND AN HONEST ACCOUNT OF WHAT
// THAT BUYS.
//
// The operator experience is meant to be four buttons and a truthful status. The
// hard part is the second half: a connection is easy to light up green, and green
// is a lie for most of these surfaces most of the time.
//
// WHAT THIS FUNCTION IS CAREFUL ABOUT
//
// CONNECTED IS NOT READABLE. An authorized Facebook account can see its groups;
// Meta exposes no supported programmatic mechanism to read them since the Groups
// API was removed on 2024-04-22. So a group is reported MEMBER ·
// API_UNAVAILABLE, and that is not a failure state to be hidden — it is the
// answer. `readability` is computed from the acquisition matrix in research-core,
// never inferred from membership.
//
// A CONNECT BUTTON THAT CANNOT WORK SAYS SO BEFORE REDIRECTING. With no Meta app
// configured there is no client id to send, and redirecting anyway produces a
// Facebook error page that looks like Homatch is broken. `start` refuses with
// CONFIGURATION_REQUIRED and names the secret an operator must provision.
//
// NO TOKEN CROSSES THIS BOUNDARY. The response shape is built field by field —
// never a `select *` spread — so a column added later cannot leak by default. The
// tables hold no token anyway (secret_ref names a platform secret), and that is
// belt and braces on purpose.
//
// WHY THE OAUTH STATE IS A DATABASE ROW
//
// It must be verifiable server-side without trusting anything the browser returns
// beyond the opaque value, single-use so a replayed callback collides, and
// short-lived so an abandoned authorization stops being usable. A signed cookie
// would satisfy the first and not the second.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  requestableScopes,
  META_CAPABILITY_MATRIX,
  META_CAPABILITIES_VERIFIED_ON,
} from '../../../src/research-core/social/meta-capabilities.ts';
import {
  ACQUISITION_MATRIX,
  ACQUISITION_VERIFIED_ON,
  platformSummary,
} from '../../../src/research-core/social/acquisition.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Send the operator's browser back to the admin screen after a callback.
 *
 * The platform redirected HERE, not to the app, so the authorization code never
 * entered browser JavaScript — it is not in a history entry, not in a referrer
 * and not reachable by an extension. What goes back is an outcome word.
 *
 * APP_ORIGIN is read from the environment rather than from the request, because
 * a redirect target taken from a header is an open redirect: anybody could send
 * an operator to a Homatch-looking page of their own.
 */
function backToAdmin(outcome: string, provider: string): Response {
  const origin = Deno.env.get('APP_ORIGIN') ?? 'https://homatch.ge';
  const target = new URL('/admin/social-discovery', origin);
  target.searchParams.set('result', outcome);
  target.searchParams.set('provider', provider);
  return new Response(null, { status: 302, headers: { ...CORS, Location: target.toString() } });
}

/** Providers the Admin screen offers. Telegram is configured, not OAuth'd. */
const PROVIDERS = ['META', 'INSTAGRAM', 'REDDIT', 'VK', 'TELEGRAM'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * Which platform a provider's evidence is filed under.
 *
 * META covers Facebook; Instagram is its own provider because it authorizes
 * separately even though it rides the same Meta app.
 */
const PLATFORM_FOR: Record<Provider, string> = {
  META: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  REDDIT: 'FORUM',
  VK: 'VK',
  TELEGRAM: 'TELEGRAM',
};

/**
 * The app credentials each provider needs, by secret name.
 *
 * Read from the environment, which is where the platform keeps secrets. Their
 * PRESENCE is reported; their values never leave this function.
 */
const APP_CREDENTIALS: Record<Provider, string[]> = {
  META: ['META_APP_ID', 'META_APP_SECRET'],
  INSTAGRAM: ['META_APP_ID', 'META_APP_SECRET'],
  REDDIT: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  VK: ['VK_APP_ID', 'VK_APP_SECRET'],
  TELEGRAM: ['TELEGRAM_BOT_TOKEN'],
};

/** Where the platform sends the operator to authorize. */
const AUTHORIZE_URL: Partial<Record<Provider, string>> = {
  META: 'https://www.facebook.com/v21.0/dialog/oauth',
  INSTAGRAM: 'https://www.facebook.com/v21.0/dialog/oauth',
  REDDIT: 'https://www.reddit.com/api/v1/authorize',
  VK: 'https://oauth.vk.com/authorize',
};

const REDDIT_SCOPES = ['read', 'identity'];
const VK_SCOPES = ['groups', 'wall', 'offline'];

function credentialState(provider: Provider): { ready: boolean; missing: string[] } {
  const missing = APP_CREDENTIALS[provider].filter((name) => !Deno.env.get(name));
  return { ready: missing.length === 0, missing };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);
  const db = createClient(baseUrl, serviceKey);

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') ?? 'status').toLowerCase();

  /*
   * The OAuth callback arrives as a browser redirect from the platform and
   * carries no Homatch session, so it authenticates on the single-use state row
   * instead. Every other action requires an admin.
   */
  if (action === 'callback') return await callback(db, url);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);

  let admin = false;
  if (token === serviceKey) {
    admin = true;
  } else {
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return json({ error: 'Unauthorized' }, 401);
    const { data: row } = await db.from('users').select('id,is_admin')
      .eq('auth_id', auth.user.id).maybeSingle();
    admin = row?.is_admin === true;
  }
  if (!admin) return json({ error: 'Forbidden' }, 403);

  try {
    if (action === 'status') return await status(db);
    if (action === 'start') return await start(db, req);
    if (action === 'disconnect') return await disconnect(db, req);
    return json({ error: `unknown action "${action}"` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * STATUS — what an operator sees, and nothing they should not
 * ═══════════════════════════════════════════════════════════════════════════ */
async function status(db: ReturnType<typeof createClient>) {
  const { data: connections } = await db
    .from('integration_connections')
    .select('id,provider,status,status_detail,external_account_id,external_account_name,'
      + 'granted_scopes,capabilities,token_expires_at,connected_at,last_validated_at,'
      + 'last_success_at,last_error_at,last_error_code')
    .order('provider');

  const { data: targets } = await db
    .from('community_targets')
    .select('id,platform,external_id,name,url,connection_id,membership_state,readability,'
      + 'acquisition_mode,lifecycle,discovery_enabled,last_success_at,last_error_code,'
      + 'items_read,comments_read,demand_found,supply_found');

  const byProvider = new Map((connections ?? []).map((c) => [String(c.provider), c]));

  const cards = PROVIDERS.map((provider) => {
    const connection = byProvider.get(provider) ?? null;
    const credentials = credentialState(provider);
    const platform = PLATFORM_FOR[provider];
    const mine = (targets ?? []).filter((t) => String(t.platform) === platform);

    /*
     * STATUS IS DERIVED, never just read back. A stored CONNECTED means an
     * authorization once succeeded; whether the operator can do anything today
     * also depends on app credentials still being present and the token not
     * having expired. Reporting the stored value alone is how a screen shows
     * green over a connection that cannot make a call.
     */
    let effective = connection ? String(connection.status) : 'NOT_CONFIGURED';
    if (!credentials.ready) {
      effective = connection ? 'CREDENTIALS_MISSING' : 'NOT_CONFIGURED';
    } else if (!connection) {
      effective = 'CONFIGURATION_READY';
    } else if (connection.token_expires_at
      && Date.parse(String(connection.token_expires_at)) < Date.now()) {
      effective = 'TOKEN_EXPIRED';
    }

    return {
      provider,
      platform,
      /* Telegram authorizes with a bot token, not a redirect. The button differs. */
      connectMechanism: provider === 'TELEGRAM' ? 'CREDENTIALS' : 'OAUTH',
      status: effective,
      statusDetail: connection?.status_detail
        ?? (credentials.ready
          ? 'ready to connect'
          : `waiting on ${credentials.missing.join(' and ')}`),
      /* NAMES of missing secrets, never values. */
      missingAppCredentials: credentials.missing,
      account: connection
        ? { id: connection.external_account_id, name: connection.external_account_name }
        : null,
      connectionId: connection?.id ?? null,
      connectedAt: connection?.connected_at ?? null,
      lastValidatedAt: connection?.last_validated_at ?? null,
      lastSuccessAt: connection?.last_success_at ?? null,
      lastErrorAt: connection?.last_error_at ?? null,
      lastErrorCode: connection?.last_error_code ?? null,
      tokenExpiresAt: connection?.token_expires_at ?? null,
      grantedScopes: connection?.granted_scopes ?? [],

      /*
       * WHAT THIS PLATFORM CAN REACH AT ALL, from the acquisition matrix. Shown
       * whether or not a connection exists, because "what would connecting buy
       * me" is the question an operator has before they click.
       */
      surfaces: platformSummary(platform as never),

      targets: {
        total: mine.length,
        readable: mine.filter((t) => t.readability === 'READABLE').length,
        /* The honest middle: we can see it, the platform will not serve it. */
        memberButUnreadable: mine.filter((t) =>
          (t.membership_state === 'MEMBER' || t.membership_state === 'ADMIN')
          && t.readability === 'API_UNAVAILABLE').length,
        joinRequired: mine.filter((t) => t.membership_state === 'JOIN_REQUIRED').length,
        enabled: mine.filter((t) => t.discovery_enabled).length,
      },
      volume: {
        itemsRead: mine.reduce((n, t) => n + Number(t.items_read ?? 0), 0),
        commentsRead: mine.reduce((n, t) => n + Number(t.comments_read ?? 0), 0),
        demandFound: mine.reduce((n, t) => n + Number(t.demand_found ?? 0), 0),
        supplyFound: mine.reduce((n, t) => n + Number(t.supply_found ?? 0), 0),
      },
    };
  });

  return json({
    success: true,
    cards,
    /*
     * The detail an operator only wants when something is wrong. Kept out of the
     * default view deliberately — the brief asked for four buttons and a truthful
     * status, not an engineering console.
     */
    diagnostics: {
      metaCapabilities: META_CAPABILITY_MATRIX.map((s) => ({
        capability: s.capability,
        availability: s.availability,
        permissions: s.permissions,
        externalSteps: s.externalSteps,
        evidence: s.evidence,
      })),
      metaCapabilitiesVerifiedOn: META_CAPABILITIES_VERIFIED_ON,
      acquisitionMatrix: ACQUISITION_MATRIX.map((r) => ({
        platform: r.platform, surface: r.surface, mode: r.mode,
        availability: r.availability, requires: r.requires,
        liveVerified: r.liveVerified, evidence: r.evidence,
      })),
      acquisitionVerifiedOn: ACQUISITION_VERIFIED_ON,
    },
    note: 'A connected account is not a readable community. readability comes from the '
      + 'acquisition matrix and is never inferred from membership: a Facebook group we belong to '
      + 'is MEMBER + API_UNAVAILABLE, because Meta removed the Groups API on 2024-04-22.',
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * START — issue a single-use state and hand back the platform's own URL
 * ═══════════════════════════════════════════════════════════════════════════ */
async function start(db: ReturnType<typeof createClient>, req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider ?? '').toUpperCase() as Provider;
  if (!PROVIDERS.includes(provider)) return json({ error: 'unknown provider' }, 400);

  if (provider === 'TELEGRAM') {
    /*
     * Telegram has no authorization redirect: the adapter takes a bot or MTProto
     * credential. Saying so is better than inventing a button that goes nowhere.
     */
    const credentials = credentialState(provider);
    return json({
      error: 'Telegram connects with a credential, not an authorization redirect.',
      reasonCode: 'CREDENTIALS_MECHANISM',
      missingAppCredentials: credentials.missing,
    }, 409);
  }

  /*
   * THE BUTTON REFUSES BEFORE IT MISLEADS. With no app id there is nothing to
   * put in the redirect, and sending the operator to the platform anyway
   * produces somebody else's error page with Homatch's name on it.
   */
  const credentials = credentialState(provider);
  if (!credentials.ready) {
    return json({
      error: 'This platform needs an app configured before an account can be connected.',
      reasonCode: 'CONFIGURATION_REQUIRED',
      missingAppCredentials: credentials.missing,
    }, 409);
  }

  const authorizeUrl = AUTHORIZE_URL[provider];
  if (!authorizeUrl) return json({ error: 'no authorization endpoint', reasonCode: 'NOT_SUPPORTED' }, 409);

  const redirectUri = String(body.redirectUri ?? '');
  if (!redirectUri) return json({ error: 'redirectUri required' }, 400);

  /*
   * Scopes we may legitimately ask for. For Meta this excludes every permission
   * Meta has removed — requesting a dead permission gets the whole authorization
   * rejected, and the operator sees "authorization failed" with no clue that the
   * cause was a string we chose.
   */
  const scopes = provider === 'REDDIT' ? REDDIT_SCOPES
    : provider === 'VK' ? VK_SCOPES
      : requestableScopes();

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

  const { error: stateErr } = await db.from('integration_oauth_states').insert({
    state, provider, redirect_uri: redirectUri, requested_scopes: scopes,
  });
  if (stateErr) throw stateErr;

  const appId = Deno.env.get(APP_CREDENTIALS[provider][0] as string) ?? '';
  const authorize = new URL(authorizeUrl);
  authorize.searchParams.set('client_id', appId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', provider === 'VK' ? scopes.join(',') : scopes.join(' '));
  if (provider === 'REDDIT') authorize.searchParams.set('duration', 'permanent');

  await db.from('integration_connections')
    .upsert({
      provider,
      status: 'AUTHORIZING',
      status_detail: 'waiting for the operator to authorize on the platform',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,external_account_id' })
    .then(() => undefined, () => undefined);

  return json({
    success: true,
    provider,
    /* The platform's own page. Homatch never renders a password field. */
    authorizeUrl: authorize.toString(),
    requestedScopes: scopes,
    note: 'requested scopes are a request. What Meta actually grants is read back on callback and '
      + 'is the only thing capabilities are computed from.',
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CALLBACK — validate hard, then record what was ACTUALLY granted
 * ═══════════════════════════════════════════════════════════════════════════ */
async function callback(db: ReturnType<typeof createClient>, url: URL) {
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const denied = url.searchParams.get('error') ?? url.searchParams.get('error_reason') ?? '';

  if (!state) return backToAdmin('STATE_MISSING', 'UNKNOWN');

  /*
   * Single-use. The row is the authentication: it proves this callback belongs to
   * an authorization Homatch started, and consuming it means a replayed callback
   * finds nothing.
   */
  const { data: issued } = await db
    .from('integration_oauth_states')
    .select('state,provider,redirect_uri,requested_scopes,expires_at,consumed_at')
    .eq('state', state)
    .maybeSingle();

  if (!issued) return backToAdmin('STATE_UNKNOWN', 'UNKNOWN');
  if (issued.consumed_at) return backToAdmin('STATE_REPLAYED', String(issued.provider));
  if (Date.parse(String(issued.expires_at)) < Date.now()) {
    return backToAdmin('STATE_EXPIRED', String(issued.provider));
  }

  await db.from('integration_oauth_states')
    .update({ consumed_at: new Date().toISOString() }).eq('state', state);

  const provider = String(issued.provider) as Provider;

  /*
   * DENIAL IS A RESULT. An operator who declines on the platform's screen must
   * not leave a half-built CONNECTED row behind, and must not be told something
   * went wrong — nothing did.
   */
  if (denied || !code) {
    await db.from('integration_connections').upsert({
      provider,
      status: 'NOT_CONFIGURED',
      status_detail: denied
        ? `the operator declined on the platform: ${denied}`
        : 'the platform returned no authorization code',
      last_error_at: new Date().toISOString(),
      last_error_code: denied ? 'AUTHORIZATION_DENIED' : 'NO_CODE',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,external_account_id' });

    return backToAdmin(denied ? 'AUTHORIZATION_DENIED' : 'NO_CODE', provider);
  }

  /*
   * EXCHANGING THE CODE IS WHERE THIS STOPS.
   *
   * The exchange needs the app secret, and no app is configured in this
   * deployment — so there is nothing to exchange with and no token to inspect.
   * What is recorded is exactly that, rather than a CONNECTED row with no
   * secret_ref behind it, which the table's own check constraint would refuse
   * anyway.
   *
   * When credentials arrive, the remaining work is: POST the code to the
   * provider's token endpoint, read the granted scopes back from the platform
   * (NEVER the requested ones), store the token in the platform secret store
   * under a name, and put that NAME in secret_ref. resolveMetaCapabilities()
   * already turns granted scopes into the capability map, and this function
   * already reports it.
   */
  const credentials = credentialState(provider);
  await db.from('integration_connections').upsert({
    provider,
    status: 'CREDENTIALS_MISSING',
    status_detail: credentials.ready
      ? 'authorization returned a code; the token exchange is not yet implemented'
      : `cannot exchange the code: ${credentials.missing.join(' and ')} are not provisioned`,
    granted_scopes: [],
    capabilities: {},
    last_error_at: new Date().toISOString(),
    last_error_code: 'TOKEN_EXCHANGE_UNAVAILABLE',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_account_id' });

  /*
   * The state was valid and single-use and has been consumed. The code was NOT
   * exchanged: no app secret is provisioned, so no token exists to store and no
   * capability can be claimed. Recorded CREDENTIALS_MISSING, never CONNECTED —
   * which the table's own check constraint would refuse anyway, since a CONNECTED
   * row requires a secret_ref.
   */
  return backToAdmin('TOKEN_EXCHANGE_UNAVAILABLE', provider);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DISCONNECT — real, and history survives
 * ═══════════════════════════════════════════════════════════════════════════ */
async function disconnect(db: ReturnType<typeof createClient>, req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider ?? '').toUpperCase();
  if (!PROVIDERS.includes(provider as Provider)) return json({ error: 'unknown provider' }, 400);

  const { data: connection } = await db.from('integration_connections')
    .select('id').eq('provider', provider).maybeSingle();
  if (!connection) return json({ success: true, note: 'nothing was connected' });

  /*
   * Stop the work, drop the secret reference, keep the record. Targets are
   * disabled rather than deleted and evidence is not touched at all: content
   * legitimately collected while the connection was live remains legitimately
   * collected, with its provenance. Deleting it would destroy history to tidy a
   * status column.
   */
  await db.from('community_targets')
    .update({
      discovery_enabled: false,
      readability: 'AUTHORIZATION_REQUIRED',
      updated_at: new Date().toISOString(),
    })
    .eq('connection_id', connection.id);

  await db.from('integration_connections').update({
    status: 'DISABLED',
    status_detail: 'disconnected by an administrator',
    secret_ref: null,
    granted_scopes: [],
    capabilities: {},
    token_expires_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);

  return json({
    success: true,
    provider,
    note: 'connection disabled and its secret reference cleared; targets disabled. Evidence '
      + 'collected earlier is kept with its provenance — a disconnect is not a retraction of '
      + 'history.',
  });
}
