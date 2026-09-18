/* ══════════════════════════════════════════════════════════════════════
 * HOMATCH — the Research Core's source graph.
 *
 * ADDITIVE ONLY. No DROP, no column rewrite, no RLS weakened, no existing
 * policy replaced. Every statement is idempotent and safe to re-run.
 *
 * WHY THERE IS NO NEW SOURCE TABLE
 *
 * `source_registry` already exists and already carries platform, source_type,
 * external_id, url, country_code, language, active, priority, quality_score,
 * last_collected_at, last_successful_at and failure_count. `raw_signals`
 * already carries source_url, author_public_name, author_public_url,
 * original_text, language, published_at, discovered_at, last_seen_at,
 * content_fingerprint and classification_status — it is already the canonical
 * public-signal shape, and classify-signals-v2, intent_profiles,
 * property_signal_candidates and the matching engine all read it today.
 *
 * A parallel "research sources" family would mean two answers to "where do we
 * research" and two places to keep in step. So this migration ADDS what those
 * tables are missing and creates exactly two genuinely new things: the
 * authenticated-access connections, and the human access queue.
 *
 * WHAT IS BEING ADDED
 *
 *   source_registry     access state, city/region, plural languages, job
 *                       compatibility, property categories, an incremental
 *                       scan cursor, and a usefulness record
 *   raw_signals         parent context for comments, content type, how it was
 *                       accessed, and the deterministic direction verdict
 *   research_access_connections   an operator-connected session, stored as a
 *                       CREDENTIAL REFERENCE and never a credential
 *   research_access_requests      sources that need a human to obtain access
 *
 * THE SECURITY POSTURE, IN THE SCHEMA
 *
 * research_access_connections.credential_ref holds the NAME of a secret held
 * by the platform, never the secret — the same pattern
 * dev_ad_connections.credential_ref already uses. A CHECK constraint refuses
 * anything that looks like a cookie or a token, so a mistake in application
 * code is rejected by the database rather than stored forever.
 *
 * Neither new table is readable by `authenticated`. Admin-only and
 * service-role, like research_providers.
 * ══════════════════════════════════════════════════════════════════════ */

/* ------------------------------------------------------------------ *
 * 1. source_registry — what the registry has to remember              *
 * ------------------------------------------------------------------ */

alter table public.source_registry
  /*
   * How, and whether, we can read it.
   *
   * PUBLIC              readable with no credentials
   * AUTHENTICATED_ACCESS readable by a session an operator connected
   * JOIN_REQUIRED       needs membership; queued for a human, NEVER auto-joined
   * INACCESSIBLE        confirmed unreadable
   * DEGRADED            was readable, currently failing; backed off, not dropped
   */
  add column if not exists access_state text not null default 'PUBLIC',
  add column if not exists city text,
  add column if not exists region text,
  /*
   * Plural. A Tbilisi housing group carries Georgian, Russian and English in
   * one thread, and the existing singular `language` column cannot say so.
   * That column is kept and kept populated, so every current reader keeps
   * working unchanged.
   */
  add column if not exists languages text[],
  /* Which research jobs this source has proved useful for. Learned. */
  add column if not exists compatible_profiles text[],
  /* Property categories seen here, so a land job can skip a rentals group. */
  add column if not exists property_terms text[],
  /*
   * Where the last SUCCESSFUL scan stopped. Opaque and adapter-defined — a
   * timestamp for a chronological feed, a paging token otherwise. Only ever
   * advanced on success: advancing it after a failure would permanently skip
   * the window that failed.
   */
  add column if not exists scan_cursor text,
  /*
   * True only when the source really is ordered by time. Most social feeds
   * reorder by engagement, and assuming otherwise silently drops new posts
   * that appear below old ones.
   */
  add column if not exists chronological boolean not null default false,
  add column if not exists last_useful_at timestamptz,
  add column if not exists useful_signal_count integer not null default 0,
  add column if not exists scanned_signal_count integer not null default 0,
  add column if not exists last_failure_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'source_registry_access_state_check'
  ) then
    alter table public.source_registry
      add constraint source_registry_access_state_check
      check (access_state in (
        'PUBLIC','AUTHENTICATED_ACCESS','JOIN_REQUIRED','INACCESSIBLE','DEGRADED'
      ));
  end if;
end $$;

/* The selection query: this job, this market, best first. */
create index if not exists source_registry_selection_idx
  on public.source_registry (country_code, access_state, active, last_useful_at desc nulls last);

create index if not exists source_registry_url_idx
  on public.source_registry (url);

comment on column public.source_registry.access_state is
  'PUBLIC / AUTHENTICATED_ACCESS / JOIN_REQUIRED / INACCESSIBLE / DEGRADED. '
  'JOIN_REQUIRED sources are queued for a human in research_access_requests; '
  'nothing in Homatch joins a group automatically.';

comment on column public.source_registry.scan_cursor is
  'Opaque, adapter-defined. Advanced only on a successful scan.';

/* ------------------------------------------------------------------ *
 * 2. raw_signals — parent context and the deterministic verdict       *
 * ------------------------------------------------------------------ */

alter table public.raw_signals
  /*
   * A comment without its parent is a fragment. "Is this still available?"
   * is a strong buyer signal under a listing and noise on its own, so the
   * parent travels with it as structured metadata rather than being
   * concatenated into the text — the text stays exactly what was written.
   */
  add column if not exists parent_url text,
  add column if not exists parent_excerpt text,
  add column if not exists content_type text not null default 'POST',
  /* How this particular item was obtained. Per signal, not per source. */
  add column if not exists access_class text not null default 'PUBLIC',
  /*
   * DEMAND / SUPPLY / REFERENCE / UNKNOWN, decided deterministically before
   * any model sees the text.
   *
   * This is the column that stops a buyer's comment being returned as a
   * property, and a listing being returned as a lead. `intent_type` stays
   * exactly as it is and stays owned by classify-signals-v2: direction is a
   * coarser, earlier, cheaper question, and having both is the point.
   */
  add column if not exists research_direction text not null default 'UNKNOWN',
  add column if not exists direction_confidence numeric(4,3) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'raw_signals_research_direction_check'
  ) then
    alter table public.raw_signals
      add constraint raw_signals_research_direction_check
      check (research_direction in ('DEMAND','SUPPLY','REFERENCE','UNKNOWN'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'raw_signals_access_class_check'
  ) then
    alter table public.raw_signals
      add constraint raw_signals_access_class_check
      check (access_class in ('PUBLIC','AUTHENTICATED','FIRST_PARTY'));
  end if;
end $$;

create index if not exists raw_signals_direction_idx
  on public.raw_signals (research_direction, discovered_at desc);

comment on column public.raw_signals.research_direction is
  'Is the author ASKING or OFFERING? Decided deterministically in '
  'src/research-core/signals/direction.ts across seven languages, before any '
  'model is involved. A DEMAND job and a SUPPLY job filter on this column and '
  'can never return each other''s results.';

/* ------------------------------------------------------------------ *
 * 3. research_access_connections                                      *
 *                                                                     *
 * An operator-connected session for a platform that serves public      *
 * content more reliably to an authenticated request.                   *
 * ------------------------------------------------------------------ */

create table if not exists public.research_access_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('FACEBOOK','INSTAGRAM')),
  label text not null,

  /*
   * THE NAME OF A SECRET, NEVER THE SECRET.
   *
   * An operator provisions the value in the platform secret store out of
   * band; this column holds only the reference. The CHECK below refuses
   * anything cookie- or token-shaped, so an application-code mistake is
   * rejected here rather than persisted. Same pattern as
   * dev_ad_connections.credential_ref.
   */
  credential_ref text,

  status text not null default 'NOT_CONNECTED' check (status in (
    'NOT_CONNECTED','PENDING_CREDENTIALS','CONNECTED','ACTION_REQUIRED','DISABLED'
  )),
  status_detail text,

  last_validated_at timestamptz,
  /* Only when the platform stated one. Never guessed. */
  expires_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  consecutive_failures integer not null default 0,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * A reference is short and boring: a slug an operator chose. A credential
   * is long, or contains a known session-cookie name, or an equals sign.
   * Refusing that shape here is the difference between a bug and a breach.
   */
  constraint research_access_connections_ref_is_a_reference check (
    credential_ref is null
    or (
      length(credential_ref) between 3 and 120
      and credential_ref ~ '^[A-Za-z0-9_.:-]+$'
      and credential_ref !~* '(c_user|xs=|sessionid|csrftoken|datr|access_token|bearer)'
    )
  )
);

create unique index if not exists research_access_connections_platform_label_idx
  on public.research_access_connections (platform, lower(label));

alter table public.research_access_connections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='research_access_connections'
      and policyname='research_access_connections_admin_only'
  ) then
    create policy research_access_connections_admin_only
      on public.research_access_connections for all to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='research_access_connections'
      and policyname='research_access_connections_service_all'
  ) then
    create policy research_access_connections_service_all
      on public.research_access_connections for all to service_role
      using (true) with check (true);
  end if;
end $$;

comment on table public.research_access_connections is
  'Operator-connected research sessions. Holds a credential REFERENCE and '
  'health only — never a cookie, token or password. The account is an access '
  'layer; source_registry and raw_signals are the durable knowledge layer, so '
  'an expired session costs reach and not knowledge.';

/* ------------------------------------------------------------------ *
 * 4. research_access_requests — the human access queue                *
 *                                                                     *
 * A source that needs membership is RECORDED and waits for a person.   *
 * There is deliberately no state meaning "joined automatically",       *
 * because there is no code that joins: no bulk joining, no account     *
 * rotation, no challenge or CAPTCHA handling, no stealth.              *
 * ------------------------------------------------------------------ */

create table if not exists public.research_access_requests (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  source_id uuid references public.source_registry(id) on delete set null,
  platform text not null check (platform in ('FACEBOOK','INSTAGRAM')),
  source_name text,

  /* Why an operator should spend time on this one. Shown in the queue. */
  rationale text not null,
  country_code text,
  city text,
  languages text[],
  /* Which jobs would benefit, so the queue can be prioritised. */
  profiles text[],

  state text not null default 'REQUESTED' check (state in (
    'REQUESTED','IN_PROGRESS','APPROVED','REJECTED','DENIED_BY_PLATFORM'
  )),

  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_attempt_status text,
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* One queue entry per source, however many jobs discover it. */
create unique index if not exists research_access_requests_source_idx
  on public.research_access_requests (lower(source_url));

create index if not exists research_access_requests_state_idx
  on public.research_access_requests (state, requested_at desc);

alter table public.research_access_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='research_access_requests'
      and policyname='research_access_requests_admin_only'
  ) then
    create policy research_access_requests_admin_only
      on public.research_access_requests for all to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='research_access_requests'
      and policyname='research_access_requests_service_all'
  ) then
    create policy research_access_requests_service_all
      on public.research_access_requests for all to service_role
      using (true) with check (true);
  end if;
end $$;

comment on table public.research_access_requests is
  'Sources that need membership or approval. A human decides; nothing joins '
  'automatically. APPROVED moves the source to AUTHENTICATED_ACCESS — never '
  'to PUBLIC, because a source behind a membership wall is not public just '
  'because we are now inside it.';

/* ------------------------------------------------------------------ *
 * 5. Source health, for the admin area                                *
 *                                                                     *
 * A view rather than a table: the numbers are already in the columns   *
 * above, and a second copy would be a second thing to keep in step.    *
 * ------------------------------------------------------------------ */

create or replace view public.research_source_health as
select
  s.id,
  s.platform,
  s.source_type,
  s.url,
  s.name,
  s.country_code,
  s.city,
  s.languages,
  s.compatible_profiles,
  s.property_terms,
  s.access_state,
  s.active,
  s.last_collected_at as last_scan_at,
  s.last_successful_at,
  s.last_useful_at,
  s.scanned_signal_count,
  s.useful_signal_count,
  /*
   * Yield, reported as NULL rather than 0 when nothing has been scanned.
   *
   * A zero would read as "this source produces nothing", which is a claim
   * about the source. NULL reads as "we have not looked", which is a claim
   * about us — and it is the true one.
   */
  case
    when s.scanned_signal_count > 0
      then round(s.useful_signal_count::numeric / s.scanned_signal_count, 4)
    else null
  end as useful_rate,
  s.failure_count,
  s.last_failure_reason,
  (select count(*) from public.research_access_requests r
     where lower(r.source_url) = lower(s.url) and r.state in ('REQUESTED','IN_PROGRESS')
  ) as pending_access_requests
from public.source_registry s;

comment on view public.research_source_health is
  'Operator view of the source graph: what exists, how it is reached, when it '
  'was last scanned, and what it has actually produced. useful_rate is NULL '
  'when nothing has been scanned, never 0.';

revoke all on public.research_source_health from anon;
