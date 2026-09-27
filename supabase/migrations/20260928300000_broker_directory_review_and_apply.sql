-- THE BROKER DIRECTORY GETS A WAY IN, AND A REVIEWER.
--
-- WHAT WAS FOUND (production, read-only, 2026-09-27)
--
--   broker_directory_listings    0 rows     broker_directory_public   0 rows
--   broker_intelligence          0 rows     broker_intelligence_sources 0 rows
--   policies on the listings     two, both SELECT (owner reads; current is public)
--   functions mentioning broker  none
--
-- So the directory had a door out (the public view) and no door in. /brokers
-- told a broker to "get in touch" because there was nothing to apply through,
-- and an admin had no way to see, approve or suspend a registration because
-- there was nothing to review and no policy that let an admin read the table.
--
-- WHAT THIS ADDS
--
--   broker_directory_apply            signed-in user, SECURITY DEFINER. Inserts a
--                                     PENDING_REVIEW row owned by the caller and
--                                     nothing else: no status argument, no
--                                     paid_until argument, no broker_id argument.
--   admin_list_broker_directory       admin read of every registration + owner.
--   admin_list_broker_intelligence    admin read of discovered firms, with
--                                     provenance. The tables have RLS and no
--                                     policies, so this is the only way in.
--   admin_set_broker_listing_status   admin write, audited to admin_audit_log.
--
-- WHY AN RPC AND NOT AN INSERT POLICY
--
-- An owner INSERT policy would let the owner choose status and paid_until on
-- the row they insert; a WITH CHECK can pin them, but every future column would
-- need remembering. A function whose signature does not HAVE those arguments
-- cannot be talked into setting them.
--
-- WHY THERE IS STILL NO PATH FROM INTELLIGENCE TO A LISTING
--
-- None of these functions reads broker_intelligence into
-- broker_directory_listings. The apply function takes its fields from the
-- applicant; the admin functions read intelligence for display only and write
-- only status/paid_until on an existing registration. A discovered firm becomes
-- a listing by registering, or not at all -- the rule the 20260926270000
-- migration made structural.
--
-- PAYMENT
--
-- There is no payment path for directory listings yet: no product row, no
-- checkout, no webhook. ACTIVE therefore requires the admin to state paid_until
-- explicitly, in the future, together with a written basis (an invoice or
-- payment reference), and the audit row records it as ADMIN_ASSERTED. When a
-- real payment path exists it should set paid_until itself and this rule
-- should require its reference instead.
--
-- Idempotent: create or replace throughout; grants restated.

begin;

/* ---------------- apply (the one owner-side writer) ---------------- */

create or replace function public.broker_directory_apply(
  p_display_name  text,
  p_role          text,
  p_cities        text[] default '{}',
  p_languages     text[] default '{}',
  p_contact_phone text default null,
  p_contact_email text default null,
  p_website       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_web   text := nullif(btrim(coalesce(p_website, '')), '');
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if p_role is null or p_role not in ('AGENCY', 'BROKER') then
    raise exception 'INVALID_ROLE';
  end if;
  -- A listing nobody can contact is not a listing.
  if v_phone is null and v_email is null and v_web is null then
    raise exception 'CONTACT_REQUIRED';
  end if;
  if coalesce(array_length(p_cities, 1), 0) > 20
     or coalesce(array_length(p_languages, 1), 0) > 12 then
    raise exception 'TOO_MANY_VALUES';
  end if;
  if length(coalesce(v_phone, '')) > 40
     or length(coalesce(v_email, '')) > 200
     or length(coalesce(v_web, '')) > 300 then
    raise exception 'VALUE_TOO_LONG';
  end if;

  -- One open application per account. A second submission while the first is
  -- still being reviewed is a duplicate, not a second firm.
  if exists (
    select 1 from public.broker_directory_listings l
     where l.owner_user_id = v_uid and l.status = 'PENDING_REVIEW'
  ) then
    raise exception 'ALREADY_PENDING';
  end if;

  insert into public.broker_directory_listings (
    owner_user_id, broker_id, display_name, role, country_code,
    cities, languages, contact_phone, contact_email, website,
    status, paid_until
  ) values (
    v_uid, null, v_name, p_role, 'GE',
    coalesce(array(select btrim(c) from unnest(p_cities) c where btrim(c) <> ''), '{}'),
    coalesce(array(select lower(btrim(l)) from unnest(p_languages) l where btrim(l) <> ''), '{}'),
    v_phone, v_email, v_web,
    'PENDING_REVIEW', null
  )
  returning id into v_id;

  return v_id;
end $$;

comment on function public.broker_directory_apply(text, text, text[], text[], text, text, text) is
  'Signed-in user applies for a HOMATCH broker directory listing. Always PENDING_REVIEW, '
  'never paid, never linked to broker_intelligence. Admin review and payment make it ACTIVE.';

/* ---------------- admin: registrations ---------------- */

create or replace function public.admin_list_broker_directory()
returns table (
  id uuid,
  owner_user_id uuid,
  owner_email text,
  owner_name text,
  display_name text,
  role text,
  cities text[],
  languages text[],
  contact_phone text,
  contact_email text,
  website text,
  status text,
  paid_until timestamptz,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select l.id, l.owner_user_id, u.email, u.full_name,
           l.display_name, l.role, l.cities, l.languages,
           l.contact_phone, l.contact_email, l.website,
           l.status, l.paid_until,
           -- The same test the public view applies, so the admin sees exactly
           -- what customers see rather than re-deriving it in the browser.
           (l.status = 'ACTIVE' and l.paid_until is not null and l.paid_until > now()),
           l.created_at, l.updated_at
      from public.broker_directory_listings l
      left join public.users u on u.auth_id = l.owner_user_id
     order by (l.status = 'PENDING_REVIEW') desc, l.created_at desc;
end $$;

/* ---------------- admin: discovered intelligence ---------------- */

create or replace function public.admin_list_broker_intelligence(p_limit integer default 500)
returns table (
  id uuid,
  key_kind text,
  natural_key text,
  role text,
  display_name text,
  country_code text,
  cities text[],
  languages text[],
  deal_kinds text[],
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_verified_at timestamptz,
  validation_state text,
  observation_count integer,
  source_count integer,
  provenance_rows bigint,
  distinct_sources bigint,
  adapters text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select b.id, b.key_kind, b.natural_key, b.role, b.display_name, b.country_code,
           b.cities, b.languages, b.deal_kinds,
           b.first_seen_at, b.last_seen_at, b.last_verified_at, b.validation_state,
           b.observation_count, b.source_count,
           count(s.id), count(distinct s.source_id),
           coalesce(array_agg(distinct s.adapter_id) filter (where s.adapter_id is not null), '{}')
      from public.broker_intelligence b
      left join public.broker_intelligence_sources s on s.broker_id = b.id
     group by b.id
     order by b.last_seen_at desc
     limit greatest(1, least(coalesce(p_limit, 500), 2000));
end $$;

/* ---------------- admin: status changes, audited ---------------- */

create or replace function public.admin_set_broker_listing_status(
  p_listing_id uuid,
  p_status     text,
  p_paid_until timestamptz default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  uuid;
  v_old    public.broker_directory_listings%rowtype;
  v_paid   timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  select u.id into v_admin from public.users u where u.auth_id = auth.uid();

  if p_listing_id is null or p_status is null
     or p_status not in ('ACTIVE', 'SUSPENDED', 'EXPIRED') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select * into v_old from public.broker_directory_listings where id = p_listing_id for update;
  if not found then
    raise exception 'LISTING_NOT_FOUND';
  end if;

  v_paid := v_old.paid_until;

  if p_status = 'ACTIVE' then
    -- ACTIVE is a paid, current listing. There is no payment path yet, so the
    -- admin states the paid-until instant AND the basis for it. Neither is
    -- inferred, defaulted or carried over silently from an earlier period.
    if p_paid_until is null or p_paid_until <= now() then
      raise exception 'PAID_UNTIL_REQUIRED_IN_FUTURE';
    end if;
    if v_reason is null then
      raise exception 'PAYMENT_BASIS_REQUIRED';
    end if;
    v_paid := p_paid_until;
  elsif p_paid_until is not null then
    -- Suspending or expiring never extends a paid period.
    raise exception 'PAID_UNTIL_ONLY_WITH_ACTIVE';
  end if;

  update public.broker_directory_listings
     set status = p_status, paid_until = v_paid, updated_at = now()
   where id = p_listing_id;

  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid),
    v_old.owner_user_id,
    'BROKER_LISTING_' || p_status,
    'broker_directory_listings',
    p_listing_id::text,
    jsonb_build_object(
      'old_status', v_old.status,
      'new_status', p_status,
      'old_paid_until', v_old.paid_until,
      'new_paid_until', v_paid,
      'reason', v_reason,
      'payment_basis', case when p_status = 'ACTIVE' then 'ADMIN_ASSERTED' else null end
    )
  );

  return jsonb_build_object(
    'id', p_listing_id,
    'status', p_status,
    'paid_until', v_paid,
    'is_public', (p_status = 'ACTIVE' and v_paid is not null and v_paid > now())
  );
end $$;

comment on function public.admin_set_broker_listing_status(uuid, text, timestamptz, text) is
  'Admin-only, audited status change on a broker directory registration. ACTIVE requires an '
  'explicit future paid_until and a written payment basis; it never touches broker_intelligence.';

/* ---------------- grants ---------------- */
--
-- Revoked from the named roles and not only from PUBLIC: Supabase's default
-- privileges grant EXECUTE to anon, and a SECURITY DEFINER function left with
-- that grant is callable over PostgREST without signing in. Each function
-- checks its caller in its own body as well.

revoke all on function public.broker_directory_apply(text, text, text[], text[], text, text, text) from public, anon, authenticated;
revoke all on function public.admin_list_broker_directory() from public, anon, authenticated;
revoke all on function public.admin_list_broker_intelligence(integer) from public, anon, authenticated;
revoke all on function public.admin_set_broker_listing_status(uuid, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.broker_directory_apply(text, text, text[], text[], text, text, text) to authenticated;
grant execute on function public.admin_list_broker_directory() to authenticated;
grant execute on function public.admin_list_broker_intelligence(integer) to authenticated;
grant execute on function public.admin_set_broker_listing_status(uuid, text, timestamptz, text) to authenticated;

commit;
