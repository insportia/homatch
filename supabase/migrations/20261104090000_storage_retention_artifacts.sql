-- HOMATCH — Storage retention v2: object-level retention for an explicit
-- allowlist of disposable storage objects (docs/infra/STORAGE_RETENTION.md §10).
--
-- OWNER DECISION 2026-10-16. Retention deletes ONLY storage objects that are
-- either a regenerable internal cache or an explicitly temporary generated
-- artifact. It never deletes, clears or hides:
--   * Verify structured results, evidence (verify-evidence) or report visuals
--     (verify-official-visuals);
--   * Contracts originals (deal-room-documents) or any other customer upload;
--   * Design Studio's catalog or users' Design Studio files;
--   * accounts, properties, listings, billing, transactions, audit records.
--
-- So the record-level behaviour of 20261102090000 (clearing a Verify report's
-- payload, deleting a Contract's file, expiring access after 30 days) is
-- RETIRED here: its claim returns nothing and its configuration refuses every
-- record-level setting. Nothing in that migration ever ran in production.
--
-- WHAT THIS MIGRATION DOES ON APPLY: creates two empty tables, seeds the
-- category allowlist with every real category DISABLED, adds one settings row
-- (notices off, not paused) and replaces two functions. Deletes nothing,
-- schedules nothing, registers nothing.
--
-- PROSPECTIVE ONLY: enabling a category stamps active_since; only objects
-- created at or after it are ever registered. Historical objects are never in
-- scope.

/* ------------------------------------------------------------------ *
 * 0. Settings (separate row; the record-level row is left as is)       *
 * ------------------------------------------------------------------ */

insert into public.admin_settings (key, value, description)
values ('storage_retention_artifacts', jsonb_build_object(
          'paused', false,
          'notifications_enabled', false,
          'batch_size', 10,
          'max_attempts', 5),
        'Object-level retention (allowlisted disposable storage objects). paused stops every deletion at once; notifications_enabled sends expiry notices for user-visible temporary files.')
on conflict (key) do nothing;

/* ------------------------------------------------------------------ *
 * 1. The allowlist                                                    *
 * ------------------------------------------------------------------ */

-- THE strict allowlist. An object is eligible for retention only if its
-- location has one of these exact shapes. Everything else — the Design Studio
-- catalog, every customer upload, Verify evidence and visuals, Contracts
-- originals, every other bucket and namespace — is protected. Extending this
-- list requires a reviewed migration; no setting or category can.
create or replace function public.retention_location_eligible(p_provider text, p_bucket text, p_key text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_key is not null and p_key !~ '\.\.' and p_key !~ '^/' and (
       -- Verify's official-document cache: a copy of a public registry file,
       -- re-fetched by research-agent document_file whenever it is missing.
       (p_provider = 'SUPABASE_STORAGE' and p_bucket = 'verify-documents'
         and p_key ~ '^files/[0-9]{1,12}\.(pdf|jpg|png)$')
       -- Explicitly temporary generated files, owned by one account.
    or (p_provider = 'R2' and p_bucket = 'users'
         and p_key ~ '^users/[0-9a-f-]{36}/generated-reports/[0-9a-f-]{36}\.[a-z0-9]{2,5}$')
       -- Self-test objects the engine itself creates.
    or (p_provider = 'SUPABASE_STORAGE' and p_bucket = 'verify-documents'
         and p_key ~ '^retention-selftest/[0-9a-f-]{36}\.pdf$')
    or (p_provider = 'R2' and p_bucket = 'retention-selftest'
         and p_key ~ '^retention-selftest/[0-9a-f-]{36}\.txt$'))
$$;

-- What the Admin page lists as never deleted. Documentation the screen reads,
-- not the enforcement (the allowlist above is the enforcement).
create or replace function public.retention_protected_areas()
returns jsonb
language sql
immutable
set search_path to ''
as $$
  select jsonb_build_array(
    jsonb_build_object('area', 'design-studio', 'what', 'Design Studio catalog (HDRIs, materials, models) and users'' Design Studio files'),
    jsonb_build_object('area', 'contracts-originals', 'what', 'Contracts originals uploaded by customers, and their R2 copies'),
    jsonb_build_object('area', 'verify-evidence', 'what', 'Verify evidence: complete source text behind reports'),
    jsonb_build_object('area', 'verify-official-visuals', 'what', 'Verify report galleries'),
    jsonb_build_object('area', 'verify-results', 'what', 'Verify structured results and Contracts analyses (database)'),
    jsonb_build_object('area', 'customer-uploads', 'what', 'Every customer upload: property photos, ad media, voice, chat, developer and broker files'),
    jsonb_build_object('area', 'records', 'what', 'Accounts, profiles, properties, listings, billing, transactions and audit records'))
$$;

create table if not exists public.retention_categories (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label text not null,
  kind text not null check (kind in ('REGENERABLE_CACHE', 'TEMPORARY_ARTIFACT', 'SELFTEST')),
  provider text not null check (provider in ('SUPABASE_STORAGE', 'R2')),
  bucket text not null,
  key_pattern text not null check (key_pattern ~ '^\^.*\$$'),
  ttl interval not null default interval '30 days',
  -- User-visible temporary files: the owner is told before the file goes.
  notify_owner boolean not null default false,
  -- How a regenerable cache proves it can be rebuilt before it is deleted.
  regeneration text check (regeneration in ('VERIFY_TAS_DOCUMENT')),
  enabled boolean not null default false,
  -- Stamped the first time the category is enabled. Only objects created at
  -- or after it are registered: retention is prospective, never retroactive.
  active_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'REGENERABLE_CACHE' or (regeneration is not null and not notify_owner)),
  check (kind = 'SELFTEST' or ttl >= interval '30 days'),
  check (kind <> 'SELFTEST' or (key_pattern like '^retention-selftest/%' and ttl <= interval '1 hour'))
);

comment on table public.retention_categories is
  'Allowlist of disposable storage-object categories. Only locations accepted by retention_location_eligible() can ever be deleted.';

-- Real categories start DISABLED (active_since null). The self-test
-- categories only ever match keys the engine's own selftest action creates.
insert into public.retention_categories (key, label, kind, provider, bucket, key_pattern, ttl, notify_owner, regeneration, enabled, active_since)
values
  ('verify_document_cache', 'Verify official-document cache', 'REGENERABLE_CACHE', 'SUPABASE_STORAGE', 'verify-documents',
   '^files/[0-9]{1,12}\.(pdf|jpg|png)$', interval '30 days', false, 'VERIFY_TAS_DOCUMENT', false, null),
  ('generated_report', 'Generated report files', 'TEMPORARY_ARTIFACT', 'R2', 'users',
   '^users/[0-9a-f-]{36}/generated-reports/[0-9a-f-]{36}\.[a-z0-9]{2,5}$', interval '30 days', true, null, false, null),
  ('selftest_supabase', 'Retention self-test (Supabase)', 'SELFTEST', 'SUPABASE_STORAGE', 'verify-documents',
   '^retention-selftest/[0-9a-f-]{36}\.pdf$', interval '2 minutes', true, null, true, now()),
  ('selftest_r2', 'Retention self-test (R2)', 'SELFTEST', 'R2', 'retention-selftest',
   '^retention-selftest/[0-9a-f-]{36}\.txt$', interval '2 minutes', false, null, true, now())
on conflict (key) do nothing;

/* ------------------------------------------------------------------ *
 * 2. The artifact registry                                            *
 * ------------------------------------------------------------------ */

create table if not exists public.retention_artifacts (
  id uuid primary key default gen_random_uuid(),
  category text not null references public.retention_categories(key) on delete restrict,
  provider text not null check (provider in ('SUPABASE_STORAGE', 'R2')),
  bucket text not null,
  object_key text not null,
  -- public.storage_objects row of an R2 object, when the index has one.
  storage_object_id uuid,
  owner_user_id uuid,
  label text,
  -- Where the owner downloads the file while it exists (user-visible files).
  deep_link text check (deep_link is null or deep_link ~ '^/[^/]'),
  entity_type text,
  entity_id uuid,
  byte_size bigint,
  object_created_at timestamptz not null,
  expires_at timestamptz not null,
  -- ACTIVE: present. PURGING: claimed. DELETED: provider delete confirmed.
  -- FAILED: retried with backoff. DEAD_LETTER: needs a person.
  -- PROTECTED: refused at claim time by the allowlist (never deleted).
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'PURGING', 'DELETED', 'FAILED', 'DEAD_LETTER', 'PROTECTED')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  -- Notices (user-visible files only): queued notification ids, never "delivered".
  notice_7d_at timestamptz,
  notice_7d_id uuid,
  notice_1d_at timestamptz,
  notice_1d_id uuid,
  notice_attempts integer not null default 0,
  notice_next_at timestamptz,
  notice_error text,
  regeneration_proof jsonb,
  deleted_at timestamptz,
  verified_at timestamptz,
  reclaimed_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A regenerated cache file (same key, new creation) is a new artifact.
  unique (provider, bucket, object_key, object_created_at)
);

create unique index if not exists retention_artifacts_live_key
  on public.retention_artifacts (provider, bucket, object_key)
  where state in ('ACTIVE', 'PURGING', 'FAILED');
create index if not exists retention_artifacts_due_idx
  on public.retention_artifacts (expires_at) where state in ('ACTIVE', 'FAILED', 'PURGING');
create index if not exists retention_artifacts_owner_idx on public.retention_artifacts (owner_user_id);

alter table public.retention_categories enable row level security;
alter table public.retention_artifacts enable row level security;
revoke all on public.retention_categories, public.retention_artifacts from public, anon, authenticated;

alter table public.retention_events add column if not exists artifact_id uuid;
create index if not exists retention_events_artifact_idx on public.retention_events (artifact_id, created_at)
  where artifact_id is not null;

create or replace function public.retention_artifacts_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.expires_at is distinct from old.expires_at then
    raise exception 'retention: expires_at is immutable' using errcode = 'check_violation';
  end if;
  if new.object_created_at is distinct from old.object_created_at
     or new.object_key is distinct from old.object_key or new.bucket is distinct from old.bucket
     or new.provider is distinct from old.provider then
    raise exception 'retention: an artifact''s location is immutable' using errcode = 'check_violation';
  end if;
  if old.state = 'DELETED' and new.state <> 'DELETED' then
    raise exception 'retention: DELETED is terminal' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists retention_artifacts_guard on public.retention_artifacts;
create trigger retention_artifacts_guard before update on public.retention_artifacts
  for each row execute function public.retention_artifacts_guard();

-- A category can only describe allowlisted locations (checked on a sample key
-- built from its own pattern would be fragile, so the bucket pair is checked).
create or replace function public.retention_categories_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if not ((new.provider = 'SUPABASE_STORAGE' and new.bucket = 'verify-documents')
       or (new.provider = 'R2' and new.bucket in ('users', 'retention-selftest'))) then
    raise exception 'retention: % / % is not an allowlisted location', new.provider, new.bucket
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.provider, new.bucket, new.key_pattern, new.kind)
       is distinct from (old.provider, old.bucket, old.key_pattern, old.kind) then
    raise exception 'retention: a category''s scope is fixed by migration' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.active_since is not null and new.active_since is distinct from old.active_since then
    raise exception 'retention: active_since never moves' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists retention_categories_guard on public.retention_categories;
create trigger retention_categories_guard before insert or update on public.retention_categories
  for each row execute function public.retention_categories_guard();

/* ------------------------------------------------------------------ *
 * 3. Settings and caller helpers                                      *
 * ------------------------------------------------------------------ */

create or replace function public.retention_artifacts_config()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((select case when jsonb_typeof(value) = 'object' then value end
                     from public.admin_settings where key = 'storage_retention_artifacts'),
                  '{"paused": true}'::jsonb)
$$;

-- An admin JWT, the service role (the storage-retention function), or a direct
-- database session (an operator's SQL console; every API call arrives as
-- session_user 'authenticator'). Never anon, never a non-admin user.
create or replace function public.retention_operator_allowed()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.is_admin()
      or session_user <> 'authenticator'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

/* ------------------------------------------------------------------ *
 * 4. Registration                                                     *
 * ------------------------------------------------------------------ */

-- Explicit registration, called by the code that creates a temporary file, at
-- creation time. User-visible categories need an owner and a download path.
create or replace function public.retention_register_artifact(
  p_category text, p_object_key text, p_owner_user_id uuid default null, p_byte_size bigint default null,
  p_label text default null, p_deep_link text default null, p_entity_type text default null,
  p_entity_id uuid default null, p_created_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.retention_categories;
  v_id uuid;
  v_so uuid;
begin
  select * into c from public.retention_categories where key = p_category;
  if not found then raise exception 'RETENTION_UNKNOWN_CATEGORY'; end if;
  if not c.enabled then raise exception 'RETENTION_CATEGORY_DISABLED'; end if;
  if p_object_key !~ c.key_pattern or not public.retention_location_eligible(c.provider, c.bucket, p_object_key) then
    raise exception 'RETENTION_NOT_ELIGIBLE';
  end if;
  if c.notify_owner and (p_owner_user_id is null or p_deep_link is null) then
    raise exception 'RETENTION_NEEDS_OWNER_AND_LINK';
  end if;
  if c.active_since is null or p_created_at < c.active_since then
    raise exception 'RETENTION_NOT_PROSPECTIVE';
  end if;
  if c.provider = 'R2' then
    select id into v_so from public.storage_objects where provider = 'R2' and object_key = p_object_key limit 1;
  end if;
  insert into public.retention_artifacts (category, provider, bucket, object_key, storage_object_id, owner_user_id, label,
         deep_link, entity_type, entity_id, byte_size, object_created_at, expires_at)
  values (c.key, c.provider, c.bucket, p_object_key, v_so, p_owner_user_id, left(p_label, 120), p_deep_link,
          p_entity_type, p_entity_id, p_byte_size, p_created_at, p_created_at + c.ttl)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.retention_events (artifact_id, event, detail)
    values (v_id, 'REGISTERED', jsonb_build_object('category', c.key, 'expires_at', p_created_at + c.ttl));
  end if;
  return v_id;
end $$;

-- Discovery for internal caches (categories without owner notices): objects
-- created since the category was enabled, in its exact location, not yet
-- registered. User-visible categories are never discovered — they need the
-- producer's owner and download path.
create or replace function public.retention_register_artifacts(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.retention_categories;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_n integer := 0;
  v_k integer;
begin
  for c in select * from public.retention_categories
            where enabled and active_since is not null and not notify_owner and kind <> 'SELFTEST'
  loop
    if c.provider = 'SUPABASE_STORAGE' then
      with ins as (
        insert into public.retention_artifacts (category, provider, bucket, object_key, byte_size, label,
               object_created_at, expires_at)
        select c.key, c.provider, c.bucket, o.name, (o.metadata ->> 'size')::bigint, c.label, o.created_at, o.created_at + c.ttl
          from storage.objects o
         where o.bucket_id = c.bucket and o.name ~ c.key_pattern and o.created_at >= c.active_since
           and public.retention_location_eligible(c.provider, c.bucket, o.name)
           and not exists (select 1 from public.retention_artifacts a
                            where a.provider = c.provider and a.bucket = c.bucket and a.object_key = o.name
                              and a.object_created_at = o.created_at)
         order by o.created_at
         limit v_limit
        on conflict do nothing
        returning id, expires_at)
      insert into public.retention_events (artifact_id, event, detail)
      select id, 'REGISTERED', jsonb_build_object('category', c.key, 'expires_at', expires_at) from ins;
    else
      with ins as (
        insert into public.retention_artifacts (category, provider, bucket, object_key, storage_object_id, owner_user_id,
               byte_size, label, object_created_at, expires_at)
        select c.key, c.provider, c.bucket, so.object_key, so.id, so.owner_user_id, so.byte_size, c.label,
               so.created_at, so.created_at + c.ttl
          from public.storage_objects so
         where so.provider = 'R2' and so.namespace = c.bucket and so.object_key ~ c.key_pattern
           and so.lifecycle = 'ACTIVE' and so.created_at >= c.active_since
           and public.retention_location_eligible(c.provider, c.bucket, so.object_key)
           and not exists (select 1 from public.retention_artifacts a
                            where a.provider = 'R2' and a.object_key = so.object_key and a.object_created_at = so.created_at)
         order by so.created_at
         limit v_limit
        on conflict do nothing
        returning id, expires_at)
      insert into public.retention_events (artifact_id, event, detail)
      select id, 'REGISTERED', jsonb_build_object('category', c.key, 'expires_at', expires_at) from ins;
    end if;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end $$;

/* ------------------------------------------------------------------ *
 * 5. Notices (only where a user genuinely loses access)               *
 * ------------------------------------------------------------------ */

create or replace function public.retention_artifact_notices(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cfg jsonb := public.retention_artifacts_config();
  r record;
  v_id uuid;
  v_final boolean;
  v_sent integer := 0;
  v_failed integer := 0;
  v_when text;
begin
  if not coalesce((v_cfg ->> 'notifications_enabled')::boolean, false) then
    return jsonb_build_object('skipped', 'notifications_disabled');
  end if;
  for r in
    select a.* from public.retention_artifacts a
      join public.retention_categories c on c.key = a.category
     where c.notify_owner and a.state = 'ACTIVE' and a.owner_user_id is not null and a.deep_link is not null
       and a.expires_at > now() - interval '1 day'
       and (a.notice_next_at is null or a.notice_next_at <= now())
       and ((a.notice_1d_at is null and a.expires_at <= now() + interval '1 day')
         or (a.notice_7d_at is null and a.notice_1d_at is null and a.expires_at <= now() + interval '7 days'))
     order by a.expires_at
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)
     for update of a skip locked
  loop
    v_final := r.expires_at <= now() + interval '1 day';
    v_when := to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
    begin
      -- Stored English is for the push payload; the app renders the localized
      -- text from metadata.kind (src/components/notifications/presentation.tsx).
      v_id := public.notify_emit(
        r.owner_user_id, 'RETENTION_EXPIRING'::public.notification_type,
        'A file will be deleted soon',
        coalesce(r.label, 'Your file') || ' can be downloaded until ' || v_when || '.',
        case when v_final then 'HIGH' else 'NORMAL' end,
        r.deep_link, 'retention_artifact', r.id,
        'retention-artifact:' || r.id::text || case when v_final then ':1d' else ':7d' end,
        null, interval '5 minutes', null,
        jsonb_build_object('kind', 'RETENTION_ARTIFACT_EXPIRING', 'label', r.label, 'expires_at', r.expires_at,
                           'category', r.category, 'artifact_id', r.id));
    exception when others then
      v_id := null;
    end;
    if v_id is null then
      update public.retention_artifacts
         set notice_attempts = notice_attempts + 1,
             notice_error = 'NOTICE_NOT_QUEUED',
             notice_next_at = now() + make_interval(mins => least(power(2, notice_attempts + 1)::integer, 1440))
       where id = r.id;
      insert into public.retention_events (artifact_id, event, detail)
      values (r.id, 'NOTICE_FAILED', jsonb_build_object('attempt', r.notice_attempts + 1));
      v_failed := v_failed + 1;
    else
      if v_final then
        update public.retention_artifacts set notice_1d_at = now(), notice_1d_id = v_id, notice_error = null,
               notice_next_at = null where id = r.id;
      else
        update public.retention_artifacts set notice_7d_at = now(), notice_7d_id = v_id, notice_error = null,
               notice_next_at = null where id = r.id;
      end if;
      insert into public.retention_events (artifact_id, event, detail)
      values (r.id, 'NOTICE_QUEUED', jsonb_build_object('notification_id', v_id, 'window', case when v_final then '1d' else '7d' end));
      v_sent := v_sent + 1;
    end if;
  end loop;
  return jsonb_build_object('queued', v_sent, 'failed', v_failed);
end $$;

/* ------------------------------------------------------------------ *
 * 6. Engine: claim -> (regenerate check) -> delete -> confirm          *
 * ------------------------------------------------------------------ */

create or replace function public.retention_artifacts_claim(p_limit integer default 10, p_lease_seconds integer default 600)
returns table (artifact_id uuid, category text, kind text, regeneration text, provider text, bucket text,
               object_key text, storage_object_id uuid, lease_token uuid)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_cfg jsonb := public.retention_artifacts_config();
  v_limit integer := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch_size')::integer, 10), 1), 50);
  v_token uuid := gen_random_uuid();
  r record;
begin
  -- THE kill switch. While paused nothing is claimed, by cron or by hand.
  if coalesce((v_cfg ->> 'paused')::boolean, true) then
    return;
  end if;
  for r in
    select a.id, a.provider, a.bucket, a.object_key, c.notify_owner
      from public.retention_artifacts a
      join public.retention_categories c on c.key = a.category
     where c.enabled and a.expires_at <= now()
       and (a.state in ('ACTIVE', 'FAILED') or (a.state = 'PURGING' and a.lease_until < now()))
       and (a.next_attempt_at is null or a.next_attempt_at <= now())
     order by a.expires_at
     limit v_limit * 3
     for update of a skip locked
  loop
    -- The allowlist is re-checked at the moment of deletion, not trusted from
    -- registration.
    if not public.retention_location_eligible(r.provider, r.bucket, r.object_key) then
      update public.retention_artifacts set state = 'PROTECTED', last_error = 'NOT_ELIGIBLE' where id = r.id;
      insert into public.retention_events (artifact_id, event) values (r.id, 'PROTECTED_AT_CLAIM');
      continue;
    end if;
    -- A user-visible file is never deleted before its owner was told.
    if r.notify_owner and not exists (select 1 from public.retention_artifacts x
                                       where x.id = r.id and (x.notice_1d_id is not null or x.notice_7d_id is not null)) then
      update public.retention_artifacts set last_error = 'BLOCKED:AWAITING_NOTICE',
             next_attempt_at = now() + interval '1 hour' where id = r.id;
      continue;
    end if;
    update public.retention_artifacts x
       set state = 'PURGING', lease_token = v_token,
           lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 600), 60)),
           attempts = x.attempts + 1, last_attempt_at = now()
     where x.id = r.id;
    insert into public.retention_events (artifact_id, event) values (r.id, 'CLAIMED');
    return query
      select a.id, a.category, c.kind, c.regeneration, a.provider, a.bucket, a.object_key, a.storage_object_id, a.lease_token
        from public.retention_artifacts a join public.retention_categories c on c.key = a.category
       where a.id = r.id;
    v_limit := v_limit - 1;
    exit when v_limit <= 0;
  end loop;
end $$;

create or replace function public.retention_artifacts_outcome(
  p_artifact_id uuid, p_lease_token uuid, p_outcome text, p_error text default null, p_detail jsonb default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  a public.retention_artifacts;
  v_max integer := coalesce((public.retention_artifacts_config() ->> 'max_attempts')::integer, 5);
begin
  select * into a from public.retention_artifacts where id = p_artifact_id for update;
  if not found or a.state <> 'PURGING' or a.lease_token is distinct from p_lease_token then
    raise exception 'retention: lease lost' using errcode = 'lock_not_available';
  end if;
  if p_outcome in ('VERIFIED_DELETED', 'ALREADY_GONE') then
    update public.retention_artifacts
       set state = 'DELETED', deleted_at = now(), verified_at = now(), lease_token = null, lease_until = null,
           last_error = null, regeneration_proof = coalesce(p_detail, regeneration_proof),
           reclaimed_bytes = case when p_outcome = 'VERIFIED_DELETED' then coalesce(byte_size, 0) else 0 end
     where id = a.id;
    if a.provider = 'R2' and a.storage_object_id is not null then
      update public.storage_objects set lifecycle = 'DELETED', deleted_at = coalesce(deleted_at, now()), updated_at = now()
       where id = a.storage_object_id;
    end if;
    insert into public.retention_events (artifact_id, event, detail)
    values (a.id, case when p_outcome = 'VERIFIED_DELETED' then 'OBJECT_DELETED' else 'OBJECT_ALREADY_GONE' end,
            jsonb_build_object('provider', a.provider, 'bucket', a.bucket, 'bytes', a.byte_size, 'proof', p_detail));
  elsif p_outcome = 'NOT_REGENERABLE' then
    -- Kept: a cache that cannot be rebuilt is not disposable today.
    update public.retention_artifacts
       set state = case when attempts >= v_max then 'DEAD_LETTER' else 'ACTIVE' end,
           lease_token = null, lease_until = null, next_attempt_at = now() + interval '1 day',
           last_error = left('NOT_REGENERABLE: ' || coalesce(p_error, ''), 300), regeneration_proof = p_detail
     where id = a.id;
    insert into public.retention_events (artifact_id, event, detail)
    values (a.id, 'KEPT_NOT_REGENERABLE', jsonb_build_object('error', left(p_error, 300), 'proof', p_detail));
  elsif p_outcome = 'FAILED' then
    update public.retention_artifacts
       set state = case when attempts >= v_max then 'DEAD_LETTER' else 'FAILED' end,
           lease_token = null, lease_until = null, last_error = left(p_error, 300),
           next_attempt_at = now() + make_interval(mins => least(power(2, attempts)::integer, 1440))
     where id = a.id;
    insert into public.retention_events (artifact_id, event, detail)
    values (a.id, 'DELETE_FAILED', jsonb_build_object('error', left(p_error, 300), 'attempt', a.attempts));
  else
    raise exception 'retention: unknown outcome %', p_outcome;
  end if;
end $$;

-- One line per tick in the audit log (counts only).
create or replace function public.retention_artifacts_log_tick(p_report jsonb)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into public.retention_events (event, detail) values ('TICK', coalesce(p_report, '{}'::jsonb))
$$;

/* ------------------------------------------------------------------ *
 * 7. Admin: status, lists, preview, configure, retry, audit           *
 * ------------------------------------------------------------------ */

create or replace function public.retention_artifacts_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'settings', public.retention_artifacts_config(),
    'auto_run', public.retention_scheduled(),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', c.key, 'label', c.label, 'kind', c.kind, 'provider', c.provider, 'bucket', c.bucket,
        'ttl_seconds', extract(epoch from c.ttl)::bigint, 'notify_owner', c.notify_owner, 'enabled', c.enabled,
        'active_since', c.active_since,
        'tracked', (select count(*) from public.retention_artifacts a where a.category = c.key and a.state in ('ACTIVE', 'PURGING', 'FAILED')),
        'tracked_bytes', (select coalesce(sum(byte_size), 0) from public.retention_artifacts a where a.category = c.key and a.state in ('ACTIVE', 'PURGING', 'FAILED')),
        'expiring_7d', (select count(*) from public.retention_artifacts a where a.category = c.key and a.state = 'ACTIVE'
                          and a.expires_at > now() and a.expires_at <= now() + interval '7 days'),
        'due', (select count(*) from public.retention_artifacts a where a.category = c.key
                  and a.state in ('ACTIVE', 'FAILED') and a.expires_at <= now()),
        'deleted', (select count(*) from public.retention_artifacts a where a.category = c.key and a.state = 'DELETED'),
        'reclaimed_bytes', (select coalesce(sum(reclaimed_bytes), 0) from public.retention_artifacts a where a.category = c.key),
        'problems', (select count(*) from public.retention_artifacts a where a.category = c.key
                       and (a.state in ('FAILED', 'DEAD_LETTER', 'PROTECTED') or a.notice_error is not null))
      ) order by c.kind, c.key), '[]'::jsonb) from public.retention_categories c),
    'notices', jsonb_build_object(
      'queued', (select count(*) from public.retention_events where event = 'NOTICE_QUEUED'),
      'failed', (select count(*) from public.retention_events where event = 'NOTICE_FAILED')),
    'protected', public.retention_protected_areas(),
    'last_tick', (select jsonb_build_object('at', created_at, 'detail', detail) from public.retention_events
                   where event = 'TICK' order by created_at desc limit 1),
    'last_change', (select jsonb_build_object('at', created_at, 'detail', detail) from public.retention_events
                     where event = 'ARTIFACT_CONFIG_CHANGED' order by created_at desc limit 1));
end $$;

create or replace function public.retention_artifacts_list(p_filter text, p_limit integer default 50)
returns table (id uuid, category text, label text, provider text, bucket text, object_key text, owner_user_id uuid,
               byte_size bigint, object_created_at timestamptz, expires_at timestamptz, state text, attempts integer,
               last_error text, notice_7d_at timestamptz, notice_1d_at timestamptz, notice_error text,
               notification_id uuid, notification_read boolean, notification_pushed_at timestamptz,
               deleted_at timestamptz, reclaimed_bytes bigint)
language plpgsql
stable
security definer
set search_path to ''
as $$
#variable_conflict use_column
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  return query
  select a.id, a.category, a.label, a.provider, a.bucket, a.object_key, a.owner_user_id, a.byte_size,
         a.object_created_at, a.expires_at, a.state, a.attempts, a.last_error, a.notice_7d_at, a.notice_1d_at,
         a.notice_error, n.id, n.read, n.pushed_at, a.deleted_at, a.reclaimed_bytes
    from public.retention_artifacts a
    left join public.notifications n on n.id = coalesce(a.notice_1d_id, a.notice_7d_id)
   where case p_filter
           when 'PENDING' then a.state in ('ACTIVE', 'FAILED', 'PURGING') and a.expires_at <= now() + interval '7 days'
           when 'PROBLEMS' then a.state in ('FAILED', 'DEAD_LETTER', 'PROTECTED') or a.notice_error is not null
                                or (a.state = 'ACTIVE' and a.last_error is not null)
           when 'DELETED' then a.state = 'DELETED'
           when 'NOTICES' then a.notice_7d_id is not null or a.notice_1d_id is not null or a.notice_error is not null
           when 'ALL' then true
           else false
         end
   order by case when p_filter = 'DELETED' then a.deleted_at end desc nulls last, a.expires_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- What the next run would delete under the CURRENT settings. Read-only.
create or replace function public.retention_artifacts_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_cfg jsonb := public.retention_artifacts_config();
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  return (
    with due as (
      select a.*, c.notify_owner, c.kind
        from public.retention_artifacts a join public.retention_categories c on c.key = a.category
       where c.enabled and a.expires_at <= now() and a.state in ('ACTIVE', 'FAILED')
         and (a.next_attempt_at is null or a.next_attempt_at <= now())
         and public.retention_location_eligible(a.provider, a.bucket, a.object_key)
         and (not c.notify_owner or a.notice_1d_id is not null or a.notice_7d_id is not null))
    select jsonb_build_object(
      'paused', coalesce((v_cfg ->> 'paused')::boolean, true),
      'count', (select count(*) from due),
      'bytes', (select coalesce(sum(byte_size), 0) from due),
      'awaiting_notice', (select count(*) from public.retention_artifacts a join public.retention_categories c on c.key = a.category
                           where c.enabled and c.notify_owner and a.state in ('ACTIVE', 'FAILED') and a.expires_at <= now()
                             and a.notice_1d_id is null and a.notice_7d_id is null),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'category', category, 'label', label,
                  'object_key', object_key, 'bytes', byte_size, 'expires_at', expires_at,
                  'needs_regeneration_check', kind = 'REGENERABLE_CACHE') order by expires_at), '[]'::jsonb)
                  from (select * from due order by expires_at limit 50) d)));
end $$;

create or replace function public.retention_artifacts_configure(p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old jsonb := public.retention_artifacts_config();
  v_new jsonb;
  k text;
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'RETENTION_BAD_REQUEST'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('paused', 'notifications_enabled', 'auto_run', 'batch_size') then
      raise exception 'RETENTION_UNKNOWN_SETTING' using detail = k;
    end if;
    if k in ('paused', 'notifications_enabled', 'auto_run') and jsonb_typeof(p_patch -> k) <> 'boolean' then
      raise exception 'RETENTION_BAD_REQUEST' using detail = k;
    end if;
  end loop;
  if p_patch ? 'batch_size' and (jsonb_typeof(p_patch -> 'batch_size') <> 'number'
       or (p_patch ->> 'batch_size')::numeric not between 1 and 50) then
    raise exception 'RETENTION_BAD_REQUEST' using detail = 'batch_size';
  end if;
  v_new := v_old || (p_patch - 'auto_run');
  update public.admin_settings set value = v_new where key = 'storage_retention_artifacts';
  if not found then raise exception 'RETENTION_NOT_INSTALLED'; end if;
  if p_patch ? 'auto_run' then
    perform public.retention_set_schedule((p_patch ->> 'auto_run')::boolean);
  end if;
  insert into public.retention_events (event, detail)
  values ('ARTIFACT_CONFIG_CHANGED', jsonb_build_object('by', auth.uid(), 'via', case when auth.uid() is null then session_user::text else 'admin' end,
          'changed', p_patch, 'before', v_old, 'reason', left(p_reason, 200)));
  return public.retention_artifacts_status();
end $$;

-- Enable or disable one category. Enabling stamps active_since once: the
-- category applies to objects created from that moment on, never before.
create or replace function public.retention_category_set(p_key text, p_enabled boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  c public.retention_categories;
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.retention_categories where key = p_key for update;
  if not found then raise exception 'RETENTION_UNKNOWN_CATEGORY'; end if;
  update public.retention_categories
     set enabled = p_enabled, active_since = case when p_enabled then coalesce(active_since, now()) else active_since end
   where key = p_key;
  insert into public.retention_events (event, detail)
  values ('ARTIFACT_CONFIG_CHANGED', jsonb_build_object('by', auth.uid(), 'via', case when auth.uid() is null then session_user::text else 'admin' end,
          'category', p_key, 'enabled', p_enabled, 'reason', left(p_reason, 200)));
  return public.retention_artifacts_status();
end $$;

create or replace function public.retention_artifacts_requeue(p_artifact_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  update public.retention_artifacts
     set state = case when state = 'DEAD_LETTER' then 'FAILED' else state end,
         attempts = 0, next_attempt_at = null, notice_attempts = 0, notice_next_at = null, notice_error = null
   where id = p_artifact_id and (state in ('FAILED', 'DEAD_LETTER') or notice_error is not null
                                 or (state = 'ACTIVE' and last_error is not null));
  if not found then return false; end if;
  insert into public.retention_events (artifact_id, event, detail)
  values (p_artifact_id, 'REQUEUED', jsonb_build_object('by', auth.uid()));
  return true;
end $$;

create or replace function public.retention_artifacts_events(p_limit integer default 50)
returns table (id bigint, artifact_id uuid, event text, detail jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $$
#variable_conflict use_column
begin
  if not public.retention_operator_allowed() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  return query
  select e.id, e.artifact_id, e.event, e.detail, e.created_at from public.retention_events e
   where e.artifact_id is not null or e.event in ('TICK', 'ARTIFACT_CONFIG_CHANGED')
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

/* ------------------------------------------------------------------ *
 * 8. Record-level retention retired (owner decision 2026-10-16)        *
 * ------------------------------------------------------------------ */

-- Never claims a Verify report or a Contracts document again.
create or replace function public.retention_claim(p_limit integer default 10, p_lease_seconds integer default 600)
returns table (record_id uuid, product text, source_id uuid, lease_token uuid)
language plpgsql
security definer
set search_path to ''
as $$
begin
  return;
end $$;

-- The record-level settings (30-day rule on reports/documents, their deletion,
-- reminders and knowledge extraction) can no longer be changed. The automatic
-- run is controlled by retention_artifacts_configure.
create or replace function public.retention_admin_configure(p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  raise exception 'RETENTION_RECORD_LEVEL_RETIRED';
end $$;

/* ------------------------------------------------------------------ *
 * 9. Privileges                                                       *
 * ------------------------------------------------------------------ */

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.retention_artifacts_config()',
    'public.retention_register_artifact(text, text, uuid, bigint, text, text, text, uuid, timestamptz)',
    'public.retention_register_artifacts(integer)',
    'public.retention_artifact_notices(integer)',
    'public.retention_artifacts_claim(integer, integer)',
    'public.retention_artifacts_outcome(uuid, uuid, text, text, jsonb)',
    'public.retention_artifacts_log_tick(jsonb)',
    'public.retention_claim(integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.retention_operator_allowed()',
    'public.retention_artifacts_status()',
    'public.retention_artifacts_list(text, integer)',
    'public.retention_artifacts_preview()',
    'public.retention_artifacts_configure(jsonb, text)',
    'public.retention_category_set(text, boolean, text)',
    'public.retention_artifacts_requeue(uuid)',
    'public.retention_artifacts_events(integer)',
    'public.retention_admin_configure(jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
