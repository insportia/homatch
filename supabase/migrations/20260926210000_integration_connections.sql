-- AN AUTHORIZED CONNECTION TO SOMEBODY ELSE'S PLATFORM, AND NO SECRET IN SIGHT.
--
-- Homatch needs to read a Facebook Page an agency client manages, an Instagram
-- Professional account linked to it, a Reddit app's public endpoints, a Telegram
-- client. Each of those is an authorization somebody granted, with a state that
-- changes on its own — a token expires, a permission is revoked, an account is
-- unlinked — and a set of capabilities that is narrower than the product would
-- like and must be recorded as it actually is.
--
-- WHY THERE IS NO TOKEN COLUMN
--
-- The precedent is dev_ad_connections, whose comment says it outright: "Holds no
-- secret: credential_ref names a platform secret an operator provisions." That
-- table was right and this one copies it. An access token in a Postgres column
-- is a token in every backup, every logical replica, every `select *` an
-- operator runs while debugging, and every row a misconfigured RLS policy hands
-- to a browser. `secret_ref` names a secret held by the platform's own secret
-- store; the value never enters this database.
--
-- A NOTE ON WHAT granted_scopes IS FOR
--
-- It is what Meta SAID IT GRANTED, read back after the callback — not what we
-- asked for. A user can untick individual permissions on Meta's own consent
-- screen, so the requested set is a wish and the granted set is a fact. Storing
-- the wish and calling it a capability is how an adapter ends up issuing a call
-- that 403s, and an unclassified 403 reads exactly like an empty group.
--
-- `capabilities` is then DERIVED from granted_scopes by
-- src/research-core/social/meta-capabilities.ts, which also knows the things no
-- scope can unlock: the Groups API was removed on 2024-04-22, so no grant makes
-- FACEBOOK_GROUP_POSTS possible. That judgement lives in code with its citation,
-- and this column is a cache of its answer so the admin screen does not have to
-- recompute it per render.
--
-- STATUS IS NOT A BOOLEAN
--
-- "Connected" is the answer to a different question than "can it do the thing".
-- A connection can be perfectly authorized and still unable to read a Page
-- because App Review has not happened. Those are two columns, on purpose.

create table if not exists public.integration_connections (
  id                  uuid primary key default gen_random_uuid(),

  provider            text not null
                        check (provider in ('META','INSTAGRAM','REDDIT','TELEGRAM','VK','LINKEDIN')),

  /*
   * The lifecycle of the AUTHORIZATION, not of any one capability.
   *
   * AUTHORIZING exists because an OAuth round trip has a middle: a state token
   * has been issued and the operator is on Meta's screen. A row in that state is
   * how the callback proves the request came from us.
   */
  status              text not null default 'NOT_CONFIGURED'
                        check (status in (
                          'NOT_CONFIGURED',
                          'CONFIGURATION_READY',
                          'AUTHORIZING',
                          'CONNECTED',
                          'CONNECTED_PARTIAL',
                          'CREDENTIALS_MISSING',
                          'PERMISSION_MISSING',
                          'APP_REVIEW_REQUIRED',
                          'BUSINESS_VERIFICATION_REQUIRED',
                          'TOKEN_EXPIRING',
                          'TOKEN_EXPIRED',
                          'REAUTH_REQUIRED',
                          'DEGRADED',
                          'DISABLED',
                          'BLOCKED',
                          'NOT_SUPPORTED'
                        )),
  /* Plain words for the admin screen. Never a code an operator must decode. */
  status_detail       text,

  connected_by        uuid references public.users(id) on delete set null,

  /* The account on the OTHER side, as that platform identifies it. */
  external_account_id   text,
  external_account_name text,

  /*
   * WHAT META SAID IT GRANTED. Read back from the platform after the callback.
   * Never the scopes we requested — see the header.
   */
  granted_scopes      text[] not null default '{}',

  /*
   * The derived capability map, cached from meta-capabilities.ts. A cache of a
   * judgement, not the judgement: the code stays authoritative so a stale row
   * cannot claim a capability the current documentation denies.
   */
  capabilities        jsonb not null default '{}'::jsonb,

  /*
   * The NAME of a secret in the platform secret store. Never a secret.
   * A row with a null secret_ref and status CONNECTED is a contradiction, and
   * the constraint below refuses it.
   */
  secret_ref          text,

  token_expires_at    timestamptz,
  connected_at        timestamptz,
  /* Only a CONCLUSIVE check moves this. A timeout leaves it alone, for the same
     reason last_verified_at does in the evidence freshness contract. */
  last_validated_at   timestamptz,
  last_success_at     timestamptz,
  last_error_at       timestamptz,
  last_error_code     text,

  /*
   * Operator notes and platform metadata. NO SECRETS: the check below refuses
   * the obvious key names outright, because "just this once, in metadata" is
   * exactly how a token ends up in a jsonb column nobody audits.
   */
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint integration_connections_connected_needs_secret
    check (status <> 'CONNECTED' or secret_ref is not null),

  constraint integration_connections_metadata_holds_no_secret
    check (
      not (metadata ?| array[
        'access_token','accessToken','token','refresh_token','refreshToken',
        'client_secret','clientSecret','password','app_secret','appSecret',
        'api_key','apiKey','bearer','authorization'
      ])
    )
);

-- One live connection per provider per account. "No account id yet" is still one
-- row, so the coalesce mirrors dev_ad_connections_unique rather than inventing a
-- second convention.
create unique index if not exists integration_connections_unique
  on public.integration_connections (provider, coalesce(external_account_id, ''));

create index if not exists integration_connections_status
  on public.integration_connections (provider, status);

comment on table public.integration_connections is
  'An authorization to read a platform on an operator''s behalf. Holds NO secret: '
  'secret_ref names a platform secret. granted_scopes is what the platform said it '
  'granted, never what was requested; capabilities is derived from it by '
  'src/research-core/social/meta-capabilities.ts, which also knows what no scope can '
  'unlock (the Facebook Groups API was removed 2024-04-22).';

comment on column public.integration_connections.granted_scopes is
  'Read back from the platform after the callback. A user can untick permissions on '
  'the consent screen, so the requested set is a wish and this is the fact.';

comment on column public.integration_connections.secret_ref is
  'The NAME of a secret in the platform secret store. Never a token. A CONNECTED row '
  'without one is refused by a check constraint.';

-- ── The OAuth round trip has a middle, and it needs somewhere to live ────────
--
-- A state token proves a callback belongs to an authorization WE started. It is
-- single-use and short-lived, and it must be verifiable server-side without
-- trusting anything the browser sends back beyond the opaque value itself.
--
-- Separate from integration_connections because most of these rows never become
-- a connection: the operator changes their mind, or Meta denies, and a denial
-- should not leave a half-built connection row behind to be misread as one.

create table if not exists public.integration_oauth_states (
  /* The opaque value sent to the platform as `state`. Primary key so a replayed
     callback collides rather than being processed twice. */
  state             text primary key,
  provider          text not null
                      check (provider in ('META','INSTAGRAM','REDDIT','TELEGRAM','VK','LINKEDIN')),
  /* Pinned at issue time and compared on callback: an attacker-supplied
     redirect_uri is the classic way to have a code delivered elsewhere. */
  redirect_uri      text not null,
  requested_scopes  text[] not null default '{}',
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  /* Short. An authorization the operator abandoned must not stay usable. */
  expires_at        timestamptz not null default (now() + interval '10 minutes'),
  /* Set the moment a callback consumes it, so a replay finds it already used. */
  consumed_at       timestamptz
);

create index if not exists integration_oauth_states_expiry
  on public.integration_oauth_states (expires_at)
  where consumed_at is null;

comment on table public.integration_oauth_states is
  'Single-use CSRF state for an in-flight authorization. Rows are consumed on '
  'callback and expire in ten minutes. Separate from integration_connections because '
  'most never become one: a denial must not leave a half-built connection behind.';

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- Nothing customer-facing reads either table, and no browser needs to: the admin
-- screen goes through an edge function that filters to safe fields. So both are
-- RLS-enabled with NO policy, which denies every anon and authenticated request
-- while leaving the service role unaffected.
--
-- Stated explicitly because an RLS-enabled table with no policy looks like an
-- oversight and is in fact the whole access decision.

alter table public.integration_connections enable row level security;
alter table public.integration_oauth_states enable row level security;

revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_oauth_states from anon, authenticated;
