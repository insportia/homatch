-- ════════════════════════════════════════════════════════════════════════
-- BROKER LIFECYCLE: from registration to daily use.
--
-- Before this migration a broker existed only as a paid directory listing:
-- nothing made a HOMATCH account professional, editing a listing created a
-- duplicate row, verification meant "paid", an approved broker could not pay,
-- agency posts the classifier recognised went nowhere, and a match had no
-- lead state after unlock. Measured in production 2026-09-29: 12 users,
-- 0 listings, 0 broker intelligence rows -- so every change here lands on
-- empty broker tables.
--
-- Everything reuses the canonical architecture:
--   * the professional profile IS broker_directory_listings (one per owner)
--   * properties stay the one property model -- provenance is two columns
--   * a broker's client search is an active_search_subscriptions row
--   * leads are matches; the lead state is one column on matches
--   * money moves exactly the way broker_discovery_deliver already moves it
--     (locked account, one ledger row, lots follow via trigger), idempotent
--
-- Sections:
--   1. account type + suspension on users (protected like is_admin)
--   2. professional profile: one row per owner, draft -> review, contact
--      channels, segments, agency link for the future
--   3. verification: private documents, explicit states, admin decision
--   4. logo uploads (public bucket, owner folder) -- no arbitrary logo URLs
--   5. paid directory listing bought with credits (idempotent)
--   6. property provenance: listed by OWNER / BROKER / AGENCY
--   7. a broker's client searches: a private label on canonical demand
--   8. lead state on matches
--   9. the Broker Review queue: agency posts the classifier recognised
--  10. the discovered-broker library returns the contact it was paid for
--  11. engagement events keyed server-side, not by the client
--  12. the broker desk's one read, and admin reads/actions
--
-- Append-only. The runner owns the transaction.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. ACCOUNT TYPE + SUSPENSION ─────────────────────────────────────────

alter table public.users
  add column if not exists account_type text not null default 'PERSONAL',
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

alter table public.users drop constraint if exists users_account_type_check;
alter table public.users add constraint users_account_type_check
  check (account_type in ('PERSONAL', 'BROKER', 'AGENCY'));

/*
 * authenticated holds a table-level UPDATE on users (users_update_own), so a
 * new column is self-editable unless the privileged-column trigger resets it.
 * The same trigger already guards is_admin and plan; it now guards the
 * account type (changed only through set_my_account_type) and the suspension
 * (changed only by an admin through admin_set_user_suspension).
 */
create or replace function public.protect_privileged_user_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('homatch.billing_engine', true), '') <> 'on' then
    new.is_admin := old.is_admin;
    new.plan := old.plan;
  end if;
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('homatch.account_rpc', true), '') <> 'on' then
    new.account_type := old.account_type;
    new.suspended_at := old.suspended_at;
    new.suspension_reason := old.suspension_reason;
  end if;
  return new;
end;
$function$;

create or replace function public.is_user_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.users u where u.id = p_user_id and u.suspended_at is not null)
$$;
revoke all on function public.is_user_suspended(uuid) from public, anon;
grant execute on function public.is_user_suspended(uuid) to authenticated, service_role;

/* The caller's own professional choice. A suspended account cannot change it. */
create or replace function public.set_my_account_type(p_type text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := public.auth_user_id();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_type is null or p_type not in ('PERSONAL', 'BROKER', 'AGENCY') then raise exception 'INVALID_ACCOUNT_TYPE'; end if;
  if public.is_user_suspended(v_uid) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  perform set_config('homatch.account_rpc', 'on', true);
  update public.users set account_type = p_type, updated_at = now() where id = v_uid;
  perform set_config('homatch.account_rpc', '', true);
  return p_type;
end $$;
revoke all on function public.set_my_account_type(text) from public, anon;
grant execute on function public.set_my_account_type(text) to authenticated;

/* Admin suspension. Audited, and the owner is told in their own centre. */
create or replace function public.admin_set_user_suspension(p_user_id uuid, p_suspend boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_admin uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rows integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null or p_suspend is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_suspend and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  if v_admin = p_user_id then raise exception 'CANNOT_SUSPEND_SELF'; end if;
  perform set_config('homatch.account_rpc', 'on', true);
  update public.users
     set suspended_at = case when p_suspend then coalesce(suspended_at, now()) else null end,
         suspension_reason = case when p_suspend then v_reason else null end,
         updated_at = now()
   where id = p_user_id;
  get diagnostics v_rows = row_count;
  perform set_config('homatch.account_rpc', '', true);
  if v_rows = 0 then raise exception 'USER_NOT_FOUND'; end if;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), p_user_id,
          case when p_suspend then 'USER_SUSPENDED' else 'USER_UNSUSPENDED' end,
          'users', p_user_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('user_id', p_user_id, 'suspended', p_suspend);
end $$;
revoke all on function public.admin_set_user_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_suspension(uuid, boolean, text) to authenticated;

-- ── 2. THE PROFESSIONAL PROFILE ──────────────────────────────────────────

alter table public.broker_directory_listings
  add column if not exists whatsapp text,
  add column if not exists telegram text,
  add column if not exists segments text[] not null default '{}',
  /* Future agency teams: an agent's profile points at its agency's profile.
     Nothing grants membership yet; the column exists so the model does not
     have to change shape when teams arrive. */
  add column if not exists agency_listing_id uuid references public.broker_directory_listings(id) on delete set null,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists verification_state text not null default 'UNVERIFIED',
  add column if not exists verification_note text,
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verified_at timestamptz;

alter table public.broker_directory_listings drop constraint if exists broker_directory_listings_verification_state_check;
alter table public.broker_directory_listings add constraint broker_directory_listings_verification_state_check
  check (verification_state in ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'));

/* DRAFT: a profile the broker is still filling in, not yet sent for review. */
alter table public.broker_directory_listings drop constraint if exists broker_directory_listings_status_check;
alter table public.broker_directory_listings add constraint broker_directory_listings_status_check
  check (status in ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED',
                    'ACTIVE', 'SUSPENDED', 'EXPIRED'));

/* ONE profile per owner. Editing an approved listing used to insert a second
   row (broker_id is null, so the old unique key never bit) and hide the live
   one. Production holds no listings, so the index is created on an empty set. */
create unique index if not exists broker_directory_listings_one_per_owner
  on public.broker_directory_listings(owner_user_id);

create or replace view public.broker_directory_public
with (security_invoker = true) as
select
  l.id, l.broker_id, l.display_name, l.role, l.country_code, l.cities, l.languages,
  l.contact_phone, l.contact_email, l.website, l.paid_until, l.about, l.contact_person,
  l.logo_url, l.property_types, l.deal_kinds, l.districts, l.experience_years,
  l.whatsapp, l.telegram, l.segments,
  (l.verification_state = 'VERIFIED') as verified
from public.broker_directory_listings l
where l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now();
grant select on public.broker_directory_public to anon, authenticated;

/* A logo is an upload to the broker-logos bucket in the owner's own folder,
   never an arbitrary URL rendered on a public page. */
create or replace function public.broker_logo_url_ok(p_url text, p_owner uuid)
returns boolean language sql immutable as $$
  select p_url is null
      or p_url like 'https://ptxajsjhobhvsfhmutjn.supabase.co/storage/v1/object/public/broker-logos/' || p_owner::text || '/%'
$$;

/*
 * Create or edit the caller's ONE professional profile. New profiles start as
 * DRAFT; an existing one is edited in place whatever its status (a SUSPENDED
 * listing cannot be edited). Nothing here can set a status beyond DRAFT, a
 * paid_until, a verification state or a broker link. Also makes the account
 * professional if it was still PERSONAL.
 */
create or replace function public.broker_profile_save(
  p_display_name text,
  p_role text,
  p_cities text[] default '{}',
  p_districts text[] default '{}',
  p_languages text[] default '{}',
  p_deal_kinds text[] default '{}',
  p_property_types text[] default '{}',
  p_segments text[] default '{}',
  p_contact_phone text default null,
  p_contact_email text default null,
  p_whatsapp text default null,
  p_telegram text default null,
  p_website text default null,
  p_about text default null,
  p_contact_person text default null,
  p_experience_years integer default null,
  p_logo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_auth uuid := auth.uid();
  v_user uuid := public.auth_user_id();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id uuid;
  v_status text;
  v_logo text := nullif(btrim(coalesce(p_logo_url, '')), '');
  clean text[];
begin
  if v_auth is null or v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if public.is_user_suspended(v_user) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'INVALID_NAME'; end if;
  if p_role is null or p_role not in ('AGENCY', 'BROKER') then raise exception 'INVALID_ROLE'; end if;
  if coalesce(array_length(p_cities, 1), 0) > 20 or coalesce(array_length(p_districts, 1), 0) > 40
     or coalesce(array_length(p_languages, 1), 0) > 12 or coalesce(array_length(p_deal_kinds, 1), 0) > 4
     or coalesce(array_length(p_property_types, 1), 0) > 12 or coalesce(array_length(p_segments, 1), 0) > 4 then
    raise exception 'TOO_MANY_VALUES';
  end if;
  if length(coalesce(p_contact_phone, '')) > 40 or length(coalesce(p_whatsapp, '')) > 40
     or length(coalesce(p_telegram, '')) > 64 or length(coalesce(p_contact_email, '')) > 200
     or length(coalesce(p_website, '')) > 300 or length(coalesce(p_about, '')) > 4000
     or length(coalesce(p_contact_person, '')) > 120 or length(coalesce(v_logo, '')) > 500 then
    raise exception 'VALUE_TOO_LONG';
  end if;
  if p_experience_years is not null and (p_experience_years < 0 or p_experience_years > 80) then
    raise exception 'INVALID_EXPERIENCE';
  end if;
  if exists (select 1 from unnest(coalesce(p_deal_kinds, '{}')) d where upper(d) not in ('SALE', 'RENT', 'SHORT_STAY', 'INVESTMENT')) then
    raise exception 'INVALID_DEAL_KIND';
  end if;
  if exists (select 1 from unnest(coalesce(p_segments, '{}')) s where upper(s) not in ('RESIDENTIAL', 'COMMERCIAL', 'LAND', 'NEW_BUILD')) then
    raise exception 'INVALID_SEGMENT';
  end if;
  if not public.broker_logo_url_ok(v_logo, v_auth) then raise exception 'INVALID_LOGO_URL'; end if;

  select l.id, l.status into v_id, v_status
    from public.broker_directory_listings l where l.owner_user_id = v_auth for update;
  if v_status = 'SUSPENDED' then raise exception 'LISTING_SUSPENDED'; end if;

  if v_id is null then
    insert into public.broker_directory_listings (owner_user_id, broker_id, display_name, role, country_code, status)
    values (v_auth, null, v_name, p_role, 'GE', 'DRAFT')
    returning id into v_id;
  end if;

  update public.broker_directory_listings
     set display_name = v_name,
         role = p_role,
         cities = coalesce(array(select btrim(c) from unnest(p_cities) c where btrim(c) <> ''), '{}'),
         districts = coalesce(array(select btrim(d) from unnest(p_districts) d where btrim(d) <> ''), '{}'),
         languages = coalesce(array(select lower(btrim(x)) from unnest(p_languages) x where btrim(x) <> ''), '{}'),
         deal_kinds = coalesce(array(select upper(btrim(x)) from unnest(p_deal_kinds) x where btrim(x) <> ''), '{}'),
         property_types = coalesce(array(select upper(btrim(x)) from unnest(p_property_types) x where btrim(x) <> ''), '{}'),
         segments = coalesce(array(select upper(btrim(x)) from unnest(p_segments) x where btrim(x) <> ''), '{}'),
         contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
         contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
         whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
         telegram = nullif(btrim(coalesce(p_telegram, '')), ''),
         website = nullif(btrim(coalesce(p_website, '')), ''),
         about = nullif(btrim(coalesce(p_about, '')), ''),
         contact_person = nullif(btrim(coalesce(p_contact_person, '')), ''),
         experience_years = p_experience_years,
         logo_url = v_logo,
         updated_at = now()
   where id = v_id;

  perform set_config('homatch.account_rpc', 'on', true);
  update public.users set account_type = p_role, updated_at = now()
   where id = v_user and account_type = 'PERSONAL';
  perform set_config('homatch.account_rpc', '', true);
  return v_id;
end $$;
revoke all on function public.broker_profile_save(text, text, text[], text[], text[], text[], text[], text[], text, text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.broker_profile_save(text, text, text[], text[], text[], text[], text[], text[], text, text, text, text, text, text, text, integer, text) to authenticated;

create or replace function public.broker_complete_onboarding()
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.broker_directory_listings
     set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now()
   where owner_user_id = auth.uid();
  return found;
end $$;
revoke all on function public.broker_complete_onboarding() from public, anon;
grant execute on function public.broker_complete_onboarding() to authenticated;

/* Send the profile to the directory review. Admins hear once. */
create or replace function public.broker_directory_submit()
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.broker_directory_listings%rowtype;
  v_admin record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if public.is_user_suspended(public.auth_user_id()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select * into v_row from public.broker_directory_listings where owner_user_id = auth.uid() for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  if v_row.status = 'PENDING_REVIEW' then raise exception 'ALREADY_PENDING'; end if;
  if v_row.status not in ('DRAFT', 'NEEDS_CHANGES', 'REJECTED') then raise exception 'NOT_SUBMITTABLE'; end if;
  if v_row.contact_phone is null and v_row.contact_email is null and v_row.website is null
     and v_row.whatsapp is null and v_row.telegram is null then
    raise exception 'CONTACT_REQUIRED';
  end if;
  update public.broker_directory_listings
     set status = 'PENDING_REVIEW', review_note = null, updated_at = now()
   where id = v_row.id;
  for v_admin in select u.id from public.users u where u.is_admin loop
    perform public.notify_emit(v_admin.id, 'BROKER_APPLICATION'::public.notification_type,
      'Broker application: ' || v_row.display_name,
      'A ' || lower(v_row.role) || ' asked to join the HOMATCH broker directory.',
      'NORMAL', '/admin/brokers', 'broker_directory_listings', v_row.id,
      'broker-application:' || v_row.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;
  return v_row.id;
end $$;
revoke all on function public.broker_directory_submit() from public, anon;
grant execute on function public.broker_directory_submit() to authenticated;

/*
 * The old apply entry point, kept for compatibility, now goes through the one
 * profile: save, then submit. It can no longer create a second row.
 */
create or replace function public.broker_directory_apply(
  p_display_name text, p_role text, p_cities text[] default '{}', p_languages text[] default '{}',
  p_contact_phone text default null, p_contact_email text default null, p_website text default null,
  p_about text default null, p_contact_person text default null, p_property_types text[] default '{}',
  p_deal_kinds text[] default '{}', p_districts text[] default '{}', p_experience_years integer default null,
  p_logo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_status text;
begin
  select status into v_status from public.broker_directory_listings where owner_user_id = auth.uid();
  if v_status = 'PENDING_REVIEW' then raise exception 'ALREADY_PENDING'; end if;
  v_id := public.broker_profile_save(p_display_name, p_role, p_cities, p_districts, p_languages, p_deal_kinds,
    p_property_types, '{}', p_contact_phone, p_contact_email, null, null, p_website, p_about,
    p_contact_person, p_experience_years, p_logo_url);
  if coalesce(v_status, 'DRAFT') in ('DRAFT', 'NEEDS_CHANGES', 'REJECTED') then
    perform public.broker_directory_submit();
  end if;
  return v_id;
end $$;
revoke all on function public.broker_directory_apply(text, text, text[], text[], text, text, text, text, text, text[], text[], text[], integer, text) from public, anon;
grant execute on function public.broker_directory_apply(text, text, text[], text[], text, text, text, text, text, text[], text[], text[], integer, text) to authenticated;

-- ── 3. VERIFICATION ──────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('broker-verification', 'broker-verification', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists broker_verification_owner_write on storage.objects;
create policy broker_verification_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'broker-verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists broker_verification_owner_read on storage.objects;
create policy broker_verification_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'broker-verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists broker_verification_owner_delete on storage.objects;
create policy broker_verification_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'broker-verification' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.broker_verification_documents (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.broker_directory_listings(id) on delete cascade,
  owner_auth_id uuid not null,
  kind text not null check (kind in ('LICENSE', 'COMPANY_REGISTRATION', 'ID_DOCUMENT', 'OTHER')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (listing_id, storage_path)
);
alter table public.broker_verification_documents enable row level security;
drop policy if exists bvd_owner_reads on public.broker_verification_documents;
create policy bvd_owner_reads on public.broker_verification_documents for select
  using (owner_auth_id = auth.uid() or public.is_admin());

create or replace function public.broker_verification_add_document(p_kind text, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_listing uuid;
  v_state text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if public.is_user_suspended(public.auth_user_id()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if p_kind not in ('LICENSE', 'COMPANY_REGISTRATION', 'ID_DOCUMENT', 'OTHER') then raise exception 'INVALID_KIND'; end if;
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> auth.uid()::text or length(p_storage_path) > 300 then
    raise exception 'INVALID_PATH';
  end if;
  select id, verification_state into v_listing, v_state from public.broker_directory_listings where owner_user_id = auth.uid();
  if v_listing is null then raise exception 'PROFILE_REQUIRED'; end if;
  if v_state in ('VERIFIED', 'SUSPENDED') then raise exception 'VERIFICATION_CLOSED'; end if;
  if (select count(*) from public.broker_verification_documents where listing_id = v_listing) >= 10 then
    raise exception 'TOO_MANY_DOCUMENTS';
  end if;
  insert into public.broker_verification_documents (listing_id, owner_auth_id, kind, storage_path)
  values (v_listing, auth.uid(), p_kind, p_storage_path)
  on conflict (listing_id, storage_path) do update set kind = excluded.kind
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.broker_verification_add_document(text, text) from public, anon;
grant execute on function public.broker_verification_add_document(text, text) to authenticated;

create or replace function public.broker_verification_submit()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.broker_directory_listings%rowtype;
  v_admin record;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if public.is_user_suspended(public.auth_user_id()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select * into v_row from public.broker_directory_listings where owner_user_id = auth.uid() for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  if v_row.verification_state not in ('UNVERIFIED', 'REJECTED') then raise exception 'NOT_SUBMITTABLE'; end if;
  if not exists (select 1 from public.broker_verification_documents where listing_id = v_row.id) then
    raise exception 'DOCUMENT_REQUIRED';
  end if;
  update public.broker_directory_listings
     set verification_state = 'PENDING', verification_submitted_at = now(), verification_note = null, updated_at = now()
   where id = v_row.id;
  for v_admin in select u.id from public.users u where u.is_admin loop
    perform public.notify_emit(v_admin.id, 'BROKER_APPLICATION'::public.notification_type,
      'Broker verification: ' || v_row.display_name,
      'Documents were submitted for professional verification.',
      'NORMAL', '/admin/brokers', 'broker_directory_listings', v_row.id,
      'broker-verification:' || v_row.id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;
  return 'PENDING';
end $$;
revoke all on function public.broker_verification_submit() from public, anon;
grant execute on function public.broker_verification_submit() to authenticated;

create or replace function public.admin_set_broker_verification(p_listing_id uuid, p_state text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_admin uuid;
  v_old public.broker_directory_listings%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_owner uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_state not in ('VERIFIED', 'REJECTED', 'SUSPENDED', 'UNVERIFIED') then raise exception 'INVALID_STATE'; end if;
  if p_state in ('REJECTED', 'SUSPENDED') and v_note is null then raise exception 'NOTE_REQUIRED'; end if;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  select * into v_old from public.broker_directory_listings where id = p_listing_id for update;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;
  if p_state = 'VERIFIED' and not exists (select 1 from public.broker_verification_documents where listing_id = p_listing_id) then
    raise exception 'NO_DOCUMENTS';
  end if;
  update public.broker_directory_listings
     set verification_state = p_state,
         verification_note = v_note,
         verified_at = case when p_state = 'VERIFIED' then now() else null end,
         updated_at = now()
   where id = p_listing_id;
  select u.id into v_owner from public.users u where u.auth_id = v_old.owner_user_id;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(v_owner, v_old.owner_user_id),
          'BROKER_VERIFICATION_' || p_state, 'broker_directory_listings', p_listing_id::text,
          jsonb_build_object('old_state', v_old.verification_state, 'new_state', p_state, 'note', v_note));
  if v_owner is not null then
    perform public.notify_emit(v_owner, 'BROKER_APPLICATION'::public.notification_type,
      case p_state when 'VERIFIED' then 'Professional verification approved'
                   when 'REJECTED' then 'Professional verification needs attention'
                   when 'SUSPENDED' then 'Professional verification suspended'
                   else 'Professional verification reset' end,
      v_note, 'NORMAL', '/broker', 'broker_directory_listings', p_listing_id,
      'broker-verification-decision:' || p_listing_id::text || ':' || p_state || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end if;
  return jsonb_build_object('id', p_listing_id, 'verification_state', p_state);
end $$;
revoke all on function public.admin_set_broker_verification(uuid, text, text) from public, anon;
grant execute on function public.admin_set_broker_verification(uuid, text, text) to authenticated;

-- ── 4. LOGO UPLOADS ──────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('broker-logos', 'broker-logos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists broker_logos_owner_write on storage.objects;
create policy broker_logos_owner_write on storage.objects for insert to authenticated
  with check (bucket_id = 'broker-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists broker_logos_owner_update on storage.objects;
create policy broker_logos_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'broker-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists broker_logos_owner_delete on storage.objects;
create policy broker_logos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'broker-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 5. THE PAID DIRECTORY LISTING, BOUGHT WITH CREDITS ───────────────────

alter type public.ledger_type add value if not exists 'BROKER_DIRECTORY_LISTING';

create table if not exists public.broker_listing_purchases (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.broker_directory_listings(id) on delete restrict,
  user_id uuid not null references public.users(id),
  idempotency_key text not null unique,
  credits numeric not null check (credits >= 0),
  ledger_entry_id uuid,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.broker_listing_purchases enable row level security;
drop policy if exists blp_owner_reads on public.broker_listing_purchases;
create policy blp_owner_reads on public.broker_listing_purchases for select
  using (user_id = public.auth_user_id() or public.is_admin());

/*
 * Buy (or renew) the listing's public period with credits. Server-priced from
 * billable_products; the account row is locked for the purchase; the
 * idempotency key makes a double click or a refresh return the first result
 * instead of charging again. Only an APPROVED, ACTIVE or EXPIRED listing whose
 * owner is not suspended can buy -- the directory review still decides who is
 * listed.
 */
create or replace function public.broker_directory_purchase(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := public.auth_user_id();
  v_row public.broker_directory_listings%rowtype;
  v_product public.billable_products%rowtype;
  v_prior public.broker_listing_purchases%rowtype;
  v_price numeric;
  v_days integer;
  v_before numeric;
  v_after numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_ledger uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 120 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select * into v_prior from public.broker_listing_purchases where idempotency_key = p_idempotency_key;
  if found then
    if v_prior.user_id <> v_user then raise exception 'FORBIDDEN'; end if;
    return jsonb_build_object('duplicate', true, 'charged_credits', v_prior.credits,
      'paid_until', v_prior.period_end, 'listing_id', v_prior.listing_id);
  end if;
  if public.is_user_suspended(v_user) then raise exception 'ACCOUNT_SUSPENDED'; end if;

  select * into v_row from public.broker_directory_listings where owner_user_id = auth.uid() for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  if v_row.status not in ('APPROVED', 'ACTIVE', 'EXPIRED') then raise exception 'NOT_APPROVED'; end if;

  select * into v_product from public.billable_products where code = 'BROKER_DIRECTORY_LISTING';
  if not found or not v_product.enabled or v_product.kill_switch or not v_product.pricing_active then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;
  v_price := round(v_product.standard_retail_cents / 10.0, 2);
  v_days := coalesce((v_product.config->>'duration_days')::integer, 30);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_user for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_price then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_start := greatest(now(), coalesce(v_row.paid_until, now()));
  v_end := v_start + make_interval(days => v_days);
  v_after := v_before - v_price;

  if v_price > 0 then
    update public.credit_accounts set balance = v_after, updated_at = now() where user_id = v_user;
    insert into public.credit_ledger (user_id, amount, balance_before, balance_after, type, reference, metadata)
    values (v_user, -v_price, v_before, v_after, 'BROKER_DIRECTORY_LISTING'::public.ledger_type,
            'broker-listing:' || v_row.id::text,
            jsonb_build_object('listing_id', v_row.id, 'period_start', v_start, 'period_end', v_end))
    returning id into v_ledger;
  end if;

  insert into public.broker_listing_purchases (listing_id, user_id, idempotency_key, credits, ledger_entry_id, period_start, period_end)
  values (v_row.id, v_user, p_idempotency_key, v_price, v_ledger, v_start, v_end);

  update public.broker_directory_listings
     set status = 'ACTIVE', paid_until = v_end, updated_at = now()
   where id = v_row.id;

  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values ('00000000-0000-0000-0000-000000000000'::uuid, v_user, 'BROKER_LISTING_PURCHASED',
          'broker_directory_listings', v_row.id::text,
          jsonb_build_object('credits', v_price, 'period_start', v_start, 'period_end', v_end,
                             'payment_basis', 'CREDITS', 'ledger_entry_id', v_ledger));

  return jsonb_build_object('duplicate', false, 'charged_credits', v_price, 'balance_after', v_after,
                            'paid_until', v_end, 'listing_id', v_row.id);
end $$;
revoke all on function public.broker_directory_purchase(text) from public, anon;
grant execute on function public.broker_directory_purchase(text) to authenticated;

-- ── 6. PROPERTY PROVENANCE ───────────────────────────────────────────────

alter table public.properties
  add column if not exists listed_by_role text not null default 'OWNER',
  add column if not exists broker_listing_id uuid references public.broker_directory_listings(id) on delete set null;
alter table public.properties drop constraint if exists properties_listed_by_role_check;
alter table public.properties add constraint properties_listed_by_role_check
  check (listed_by_role in ('OWNER', 'BROKER', 'AGENCY'));

/*
 * Set by the server from the account, never by the client: a property a
 * broker adds is listed by that broker. (authenticated has no UPDATE grant on
 * these columns; the only way to change them later is
 * set_my_property_listed_by.)
 */
create or replace function public.properties_set_listed_by()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_type text;
  v_auth uuid;
begin
  select u.account_type, u.auth_id into v_type, v_auth from public.users u where u.id = new.user_id;
  if v_type in ('BROKER', 'AGENCY') then
    new.listed_by_role := v_type;
    select l.id into new.broker_listing_id from public.broker_directory_listings l where l.owner_user_id = v_auth;
  else
    new.listed_by_role := 'OWNER';
    new.broker_listing_id := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_properties_set_listed_by on public.properties;
create trigger trg_properties_set_listed_by before insert on public.properties
  for each row execute function public.properties_set_listed_by();

create or replace function public.set_my_property_listed_by(p_property_id uuid, p_role text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := public.auth_user_id();
  v_type text;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select account_type into v_type from public.users where id = v_user;
  if p_role not in ('OWNER', 'BROKER', 'AGENCY') or (p_role <> 'OWNER' and p_role <> v_type) then
    raise exception 'INVALID_ROLE';
  end if;
  update public.properties p
     set listed_by_role = p_role,
         broker_listing_id = case when p_role = 'OWNER' then null
           else (select l.id from public.broker_directory_listings l join public.users u on u.auth_id = l.owner_user_id where u.id = v_user) end,
         updated_at = now()
   where p.id = p_property_id and p.user_id = v_user and not p.is_deleted;
  if not found then raise exception 'PROPERTY_NOT_FOUND'; end if;
  return p_role;
end $$;
revoke all on function public.set_my_property_listed_by(uuid, text) from public, anon;
grant execute on function public.set_my_property_listed_by(uuid, text) to authenticated;

-- ── 7. A BROKER'S CLIENT SEARCHES ────────────────────────────────────────
--
-- Canonical demand (active_search_subscriptions), owned by the broker, with a
-- PRIVATE label so the broker can tell their clients apart. The label never
-- leaves the owner's rows (active_search_own).

alter table public.active_search_subscriptions
  add column if not exists client_label text,
  add column if not exists on_behalf boolean not null default false;
alter table public.active_search_subscriptions drop constraint if exists active_search_client_label_len;
alter table public.active_search_subscriptions add constraint active_search_client_label_len
  check (client_label is null or length(client_label) <= 80);

-- ── 8. LEAD STATE ON MATCHES ─────────────────────────────────────────────

alter table public.matches
  add column if not exists lead_state text not null default 'NEW',
  add column if not exists lead_state_changed_at timestamptz;
alter table public.matches drop constraint if exists matches_lead_state_check;
alter table public.matches add constraint matches_lead_state_check
  check (lead_state in ('NEW', 'REVIEWED', 'CONTACTED', 'IN_PROGRESS', 'WON', 'CLOSED'));

/*
 * The owner moves a lead along. Contact states need the contact: a lead
 * cannot be CONTACTED, IN_PROGRESS or WON unless it was opened (match_unlocks).
 * Server-checked ownership; a suspended account cannot act.
 */
create or replace function public.set_match_lead_state(p_match_id uuid, p_state text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := public.auth_user_id();
  v_owner uuid;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_state not in ('NEW', 'REVIEWED', 'CONTACTED', 'IN_PROGRESS', 'WON', 'CLOSED') then raise exception 'INVALID_STATE'; end if;
  if public.is_user_suspended(v_user) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  select p.user_id into v_owner from public.matches m join public.properties p on p.id = m.property_id where m.id = p_match_id;
  if v_owner is null then raise exception 'MATCH_NOT_FOUND'; end if;
  if v_owner <> v_user then raise exception 'NOT_YOUR_PROPERTY'; end if;
  if p_state in ('CONTACTED', 'IN_PROGRESS', 'WON')
     and not exists (select 1 from public.match_unlocks u where u.match_id = p_match_id) then
    raise exception 'UNLOCK_REQUIRED';
  end if;
  update public.matches set lead_state = p_state, lead_state_changed_at = now() where id = p_match_id;
  return p_state;
end $$;
revoke all on function public.set_match_lead_state(uuid, text) from public, anon;
grant execute on function public.set_match_lead_state(uuid, text) to authenticated;

-- ── 9. THE BROKER REVIEW QUEUE ───────────────────────────────────────────
--
-- The classifier labels an agency speaking as BROKER_AGENCY and keeps it out
-- of matching. It used to stop there. Now each such post becomes one review
-- item an admin resolves: ACCEPT records the firm in broker_intelligence (the
-- store the discovered-broker library sells from), DISMISS closes it,
-- DUPLICATE says the firm is already known. It never becomes demand.

create table if not exists public.broker_review_items (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references public.raw_signals(id) on delete cascade,
  platform text,
  source_url text,
  author_public_name text,
  author_public_url text,
  city text,
  language text,
  published_at timestamptz,
  confidence numeric,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DISMISSED', 'DUPLICATE')),
  broker_id uuid references public.broker_intelligence(id) on delete set null,
  note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists broker_review_items_status_idx on public.broker_review_items(status, created_at desc);
alter table public.broker_review_items enable row level security;

create or replace function public.admin_list_broker_review(p_status text default 'PENDING', p_limit integer default 100)
returns setof public.broker_review_items
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query select * from public.broker_review_items
   where p_status is null or status = p_status
   order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;
revoke all on function public.admin_list_broker_review(text, integer) from public, anon;
grant execute on function public.admin_list_broker_review(text, integer) to authenticated;

create or replace function public.admin_resolve_broker_review(p_item_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_admin uuid;
  v_item public.broker_review_items%rowtype;
  v_kind text;
  v_key text;
  v_broker uuid;
  v_status text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_action not in ('ACCEPT', 'DISMISS') then raise exception 'INVALID_ACTION'; end if;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();
  select * into v_item from public.broker_review_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_item.status <> 'PENDING' then raise exception 'ALREADY_RESOLVED'; end if;

  if p_action = 'DISMISS' then
    v_status := 'DISMISSED';
  else
    /* The firm's public identity, from what the post itself published. */
    if v_item.author_public_url ~* '^(https?://)?(t\.me|telegram\.me)/[A-Za-z0-9_]{4,}' then
      v_kind := 'TELEGRAM';
      v_key := lower(regexp_replace(v_item.author_public_url, '^(https?://)?(t\.me|telegram\.me)/([A-Za-z0-9_]+).*$', '\3', 'i'));
    elsif nullif(btrim(coalesce(v_item.author_public_url, '')), '') is not null then
      v_kind := 'PROFILE_URL';
      v_key := lower(btrim(v_item.author_public_url));
    else
      raise exception 'NO_PUBLIC_IDENTITY';
    end if;
    select id into v_broker from public.broker_intelligence where key_kind = v_kind and natural_key = v_key;
    if v_broker is not null then
      v_status := 'DUPLICATE';
      update public.broker_intelligence
         set observation_count = observation_count + 1,
             last_seen_at = greatest(last_seen_at, coalesce(v_item.published_at, now())),
             updated_at = now()
       where id = v_broker;
    else
      insert into public.broker_intelligence (key_kind, natural_key, role, display_name, country_code,
        cities, languages, deal_kinds, first_seen_at, last_seen_at, validation_state, observation_count, source_count)
      values (v_kind, v_key, 'AGENCY', nullif(btrim(coalesce(v_item.author_public_name, '')), ''), 'GE',
        case when v_item.city is null then '{}' else array[v_item.city] end,
        case when v_item.language is null then '{}' else array[v_item.language] end,
        '{}', coalesce(v_item.published_at, now()), coalesce(v_item.published_at, now()), 'UNVERIFIED', 1, 1)
      returning id into v_broker;
      v_status := 'ACCEPTED';
    end if;
  end if;

  update public.broker_review_items
     set status = v_status, broker_id = v_broker, note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = v_admin, reviewed_at = now()
   where id = p_item_id;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(v_broker, p_item_id),
          'BROKER_REVIEW_' || v_status, 'broker_review_items', p_item_id::text,
          jsonb_build_object('signal_id', v_item.signal_id, 'broker_id', v_broker, 'note', p_note));
  return jsonb_build_object('id', p_item_id, 'status', v_status, 'broker_id', v_broker);
end $$;
revoke all on function public.admin_resolve_broker_review(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_broker_review(uuid, text, text) to authenticated;

-- ── 10. THE DISCOVERED-BROKER LIBRARY RETURNS WHAT WAS PAID FOR ──────────
--
-- A customer is charged per new broker delivered, and the library used to
-- show a name and a city -- no way to reach the firm. The public contact key
-- the firm published (its site, profile, Telegram or listing phone) is now
-- returned to the customer who paid for it, and to nobody else.

drop function if exists public.list_my_discovered_brokers(integer);
create or replace function public.list_my_discovered_brokers(p_limit integer default 200)
returns table (
  id uuid, broker_id uuid, role text, display_name text, key_kind text, natural_key text,
  country_code text, cities text[], languages text[], deal_kinds text[],
  first_seen_at timestamptz, last_seen_at timestamptz, validation_state text,
  observation_count integer, source_count integer, first_intent text, first_campaign_id uuid,
  context jsonb, discovered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.auth_user_id();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return query
    select d.id, b.id, b.role, b.display_name, b.key_kind, b.natural_key,
           b.country_code, b.cities, b.languages, b.deal_kinds,
           b.first_seen_at, b.last_seen_at, b.validation_state,
           b.observation_count, b.source_count,
           d.first_intent, d.first_campaign_id, d.context, d.created_at
      from public.user_broker_discoveries d
      join public.broker_intelligence b on b.id = d.broker_id
     where d.user_id = v_uid
     order by d.created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke all on function public.list_my_discovered_brokers(integer) from public, anon;
grant execute on function public.list_my_discovered_brokers(integer) to authenticated;

-- ── 11. ENGAGEMENT EVENTS KEYED BY THE SERVER ────────────────────────────
--
-- The viewer key was whatever the browser sent, so rotating it inflated a
-- broker's stats. When the request carries a client address it is used
-- (hashed, never stored raw); the client key is only the fallback.

create or replace function public.record_broker_profile_event(
  p_listing_id uuid, p_event text, p_surface text default null, p_viewer_key text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_addr text := split_part(coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1);
  v_key text;
begin
  v_key := case
    when btrim(v_addr) <> '' then 'ip:' || left(md5(btrim(v_addr) || coalesce(v_headers->>'user-agent', '')), 24)
    else 'c:' || left(coalesce(nullif(btrim(coalesce(p_viewer_key, '')), ''), 'anon'), 78)
  end;
  if p_listing_id is null or p_event is null
     or p_event not in ('IMPRESSION', 'PROFILE_OPEN', 'PHONE_CLICK', 'EMAIL_CLICK',
                        'WHATSAPP_CLICK', 'WEBSITE_CLICK', 'MESSAGE_CLICK') then
    return false;
  end if;
  perform 1 from public.broker_directory_listings l
   where l.id = p_listing_id and l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now();
  if not found then return false; end if;
  insert into public.broker_profile_events (listing_id, event_type, surface, viewer_key, bucket)
  values (p_listing_id, p_event, left(coalesce(nullif(btrim(coalesce(p_surface, '')), ''), 'unknown'), 40),
          v_key, to_char(now(), 'YYYY-MM-DD-HH24'))
  on conflict (listing_id, event_type, viewer_key, bucket) do nothing;
  return true;
end $function$;

-- ── 12. THE BROKER DESK'S ONE READ, AND ADMIN READS ──────────────────────

/*
 * Everything the broker desk and the dashboard's professional panel show,
 * for the caller only. Counts use the canonical 30-day active-demand window
 * (discovery_freshness_policy): an unopened match on demand older than the
 * window -- or undated -- is history, not a new or current lead. An opened
 * contact stays the customer's whatever its age.
 */
create or replace function public.broker_desk_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid := public.auth_user_id();
  v_auth uuid := auth.uid();
  v_days integer;
  v_since timestamptz;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_days := coalesce((select (value->>'activeMaxDays')::integer from public.admin_settings where key = 'discovery_freshness_policy'), 30);
  v_since := now() - make_interval(days => v_days);
  return jsonb_build_object(
    'active_window_days', v_days,
    'account', (select jsonb_build_object('account_type', u.account_type, 'suspended', u.suspended_at is not null,
                                          'suspension_reason', u.suspension_reason)
                  from public.users u where u.id = v_user),
    'profile', (select to_jsonb(l) - 'owner_user_id' from public.broker_directory_listings l where l.owner_user_id = v_auth),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'created_at', d.created_at)
                    order by d.created_at), '[]'::jsonb)
                    from public.broker_verification_documents d where d.owner_auth_id = v_auth),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = v_user),
    'properties', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
        select p.id, p.homatch_id, p.title, p.transaction_type, p.property_type, p.matching_status,
               p.listed_by_role, p.created_at, p.archived_at,
               (select count(*) from public.matches m where m.property_id = p.id and m.status <> 'REJECTED'
                  and not exists (select 1 from public.match_unlocks u where u.match_id = m.id)
                  and m.demand_published_at >= v_since)::int as current_leads,
               (select count(*) from public.matches m where m.property_id = p.id
                  and exists (select 1 from public.match_unlocks u where u.match_id = m.id))::int as opened_contacts,
               (select mc.status_v2::text from public.matching_campaigns mc where mc.property_id = p.id limit 1) as campaign_status
          from public.properties p where p.user_id = v_user and not p.is_deleted) x),
    'leads', (select coalesce(jsonb_object_agg(s.lead_state, s.n), '{}'::jsonb) from (
        select m.lead_state, count(*)::int n from public.matches m join public.properties p on p.id = m.property_id
         where p.user_id = v_user and not p.is_deleted and m.status <> 'REJECTED'
           and (exists (select 1 from public.match_unlocks u where u.match_id = m.id) or m.demand_published_at >= v_since)
         group by 1) s),
    'client_searches', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'side', a.side, 'client_label', a.client_label,
                          'on_behalf', a.on_behalf, 'is_active', a.is_active, 'created_at', a.created_at, 'criteria', a.search_criteria)
                          order by a.created_at desc), '[]'::jsonb)
                          from public.active_search_subscriptions a where a.user_id = v_user),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('credits', b.credits, 'period_end', b.period_end, 'created_at', b.created_at)
                    order by b.created_at desc), '[]'::jsonb)
                    from public.broker_listing_purchases b where b.user_id = v_user),
    'listing_price_credits', (select round(standard_retail_cents / 10.0, 2) from public.billable_products where code = 'BROKER_DIRECTORY_LISTING'),
    'listing_duration_days', (select coalesce((config->>'duration_days')::integer, 30) from public.billable_products where code = 'BROKER_DIRECTORY_LISTING')
  );
end $$;
revoke all on function public.broker_desk_summary() from public, anon;
grant execute on function public.broker_desk_summary() to authenticated;

/* Admin: everything about one broker, including documents' storage paths
   (signed by the admin's client, never public). */
create or replace function public.admin_broker_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.broker_directory_listings%rowtype;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.broker_directory_listings where id = p_listing_id;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;
  return jsonb_build_object(
    'listing', to_jsonb(v_row),
    'user', (select jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'account_type', u.account_type,
                                      'suspended_at', u.suspended_at, 'suspension_reason', u.suspension_reason, 'created_at', u.created_at)
               from public.users u where u.auth_id = v_row.owner_user_id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'path', d.storage_path, 'created_at', d.created_at)), '[]'::jsonb)
                    from public.broker_verification_documents d where d.listing_id = p_listing_id),
    'properties', (select count(*) from public.properties p join public.users u on u.id = p.user_id
                    where u.auth_id = v_row.owner_user_id and not p.is_deleted),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('credits', b.credits, 'period_start', b.period_start, 'period_end', b.period_end)), '[]'::jsonb)
                    from public.broker_listing_purchases b where b.listing_id = p_listing_id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'metadata', a.metadata) order by a.created_at desc), '[]'::jsonb)
                from public.admin_audit_log a where a.entity_type = 'broker_directory_listings' and a.entity_id = p_listing_id::text)
  );
end $$;
revoke all on function public.admin_broker_detail(uuid) from public, anon;
grant execute on function public.admin_broker_detail(uuid) to authenticated;

/* Admin: the verification queue (and every other verification state on
   request), with how many documents each profile sent and whether the owner's
   account is suspended. */
create or replace function public.admin_list_broker_verification(p_state text default 'PENDING')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(x order by x.submitted_at desc nulls last), '[]'::jsonb) from (
    select l.id, l.display_name, l.role, l.status, l.verification_state, l.verification_note,
           l.verification_submitted_at as submitted_at, l.verified_at, l.created_at,
           u.email as owner_email, u.id as owner_id, (u.suspended_at is not null) as owner_suspended,
           (select count(*) from public.broker_verification_documents d where d.listing_id = l.id)::int as documents
      from public.broker_directory_listings l
      left join public.users u on u.auth_id = l.owner_user_id
     where p_state is null or l.verification_state = p_state
     limit 500) x);
end $$;
revoke all on function public.admin_list_broker_verification(text) from public, anon;
grant execute on function public.admin_list_broker_verification(text) to authenticated;
