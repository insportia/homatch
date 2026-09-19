-- OBJECT STORAGE, PART THREE: WHOSE FILE IS THIS?
--
-- Part two made Postgres the authority on who may touch an object. This part
-- makes it possible to answer the question an operator actually asks, which
-- is not "who may read key X" but "what does this account have stored, and
-- how much of it".
--
-- THE KEY CARRIES THE ACCOUNT, AND NOTHING ELSE ABOUT THE PERSON
--
--   users/<users.id>/<category>/<entity uuid>/<object uuid>.<ext>
--   users/<users.id>/<category>/<object uuid>.<ext>
--
-- A uuid, because an email address changes and is personal information, and
-- because a key ends up in logs, in a dashboard and inside a URL. The display
-- filename is metadata in the row below, never a path segment.
--
-- R2 IS NOT THE INDEX. Cloudflare's dashboard can be browsed by prefix and
-- that is all it is for. Searching by email, by registration date, by
-- category or by size happens here, against rows, with indexes behind it.
--
-- ACCOUNTS COME FROM POSTGRES, NOT FROM R2
--
-- Registering creates no object and no prefix — a prefix in object storage is
-- a substring of a key, not a directory, and there is nothing to create until
-- the first upload. So a brand-new account is found by the explorer with zero
-- files and zero bytes, because the explorer starts from `users` and left
-- joins the objects.

-- ════════════════════════════════════════════════════════════════════════
-- 1. THE INDEX GROWS A CATEGORY AND AN OWNER IT CAN JOIN ON
-- ════════════════════════════════════════════════════════════════════════

-- `namespace` is the top-level prefix ('users', 'site-assets', 'diagnostics',
-- or a legacy bucket name). `category` is what the object IS. For a key under
-- users/ the two differ, and every admin filter is on the category.
alter table public.storage_objects add column if not exists category text;

-- owner_user_id is public.users.id — the Homatch ACCOUNT — because that is
-- what joins to the email and the registration date the explorer searches on,
-- and what the key itself carries. The auth uid is one join away and is what
-- storage_authorize compares; conflating the two is the classic bug here.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'storage_objects_owner_fk'
  ) then
    alter table public.storage_objects
      add constraint storage_objects_owner_fk
      foreign key (owner_user_id) references public.users(id) on delete set null;
  end if;
end $$;

comment on column public.storage_objects.owner_user_id is
  'public.users.id — the Homatch account. Null means system-owned or ownership unresolved.';
comment on column public.storage_objects.category is
  'What the object is: property-photos, deal-room-documents, generated-reports, ...';

-- The indexes are the admin filters, one for one. An explorer that table
-- scans is fine at fourteen rows and useless at a million, and the moment it
-- becomes useless is exactly the moment nobody can afford to fix it.
create index if not exists storage_objects_owner_created_idx
  on public.storage_objects (owner_user_id, created_at desc);
create index if not exists storage_objects_category_idx
  on public.storage_objects (category, created_at desc);
create index if not exists storage_objects_created_idx
  on public.storage_objects (created_at desc);
create index if not exists storage_objects_content_type_idx
  on public.storage_objects (content_type);
create index if not exists storage_objects_lifecycle_idx
  on public.storage_objects (lifecycle);

-- ════════════════════════════════════════════════════════════════════════
-- 2. THE AUTHORITY, NOW ACCOUNT-SCOPED
-- ════════════════════════════════════════════════════════════════════════

/*
 * storage_authorize, second edition.
 *
 * Adds the users/ namespace. Two things about it are worth stating plainly,
 * because both are places where a reasonable-looking shortcut would be wrong:
 *
 * 1. THE ACCOUNT SEGMENT IS NEVER THE AUTHORISATION.
 *    `users/<id>/...` says who the file belongs to. Whether the CALLER may
 *    touch it is still decided by a relationship: the property's owner, the
 *    deal room's owner, the workspace capability. Knowing somebody's uuid —
 *    and it is not a secret, it is in their own keys — must buy nothing.
 *
 * 2. DEVELOPER FILES ARE WORKSPACE-OWNED, NOT ACCOUNT-OWNED.
 *    A workspace has members. So under users/<uploader>/developer-documents/
 *    the account segment records WHO UPLOADED IT, for traceability, and the
 *    decision is still dev_can(workspace, capability). If the uploader leaves
 *    the workspace, their colleagues keep the file and they lose it, which is
 *    the correct behaviour and the opposite of what a prefix check would do.
 *
 * Admin may READ a user-owned object — the storage explorer has to be able to
 * open a file — and may not write or delete one. Every admin read is written
 * to admin_audit_log by the caller, not here: this function is STABLE and
 * must stay side-effect free.
 */
create or replace function public.storage_authorize(p_key text, p_action text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_me      uuid;
  v_admin   boolean := false;
  v_seg     text[];
  v_n       int;
  v_ns      text;
  v_rest    text;
  v_cat     text;
  v_acct    uuid;
  v_owner   uuid;
  v_vis     text;
  v_ws      uuid;
  v_uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_action is null or p_action not in ('READ', 'WRITE', 'DELETE') then
    return 'INVALID_KEY';
  end if;
  if p_key is null or p_key = '' or length(p_key) > 1024 then
    return 'INVALID_KEY';
  end if;
  if left(p_key, 1) = '/' or right(p_key, 1) = '/'
     or position('\' in p_key) > 0
     or p_key ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']') then
    return 'INVALID_KEY';
  end if;

  v_seg := string_to_array(p_key, '/');
  v_n := coalesce(array_length(v_seg, 1), 0);
  if v_n < 2 then return 'INVALID_KEY'; end if;
  if exists (select 1 from unnest(v_seg) s where s = '' or s = '.' or s = '..') then
    return 'INVALID_KEY';
  end if;

  v_ns := v_seg[1];
  v_rest := array_to_string(v_seg[2:v_n], '/');

  if v_uid is not null then
    select u.id, u.is_admin into v_me, v_admin
    from public.users u where u.auth_id = v_uid limit 1;
    v_admin := coalesce(v_admin, false);
  end if;

  -- ══ ACCOUNT-SCOPED KEYS ═══════════════════════════════════════════════
  if v_ns = 'users' then
    if v_n < 4 then return 'INVALID_KEY'; end if;      -- users/<id>/<cat>/<object>
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    v_acct := v_seg[2]::uuid;
    v_cat := v_seg[3];

    if v_uid is null then return 'UNAUTHENTICATED'; end if;

    -- Workspace files: the capability decides, not the prefix.
    if v_cat in ('developer-documents', 'developer-media') then
      if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      v_ws := v_seg[4]::uuid;
      if v_cat = 'developer-media' and p_action = 'READ' then return 'ALLOW'; end if;
      if public.dev_can(v_ws,
           case when v_cat = 'developer-media' then 'inventory' else 'documents' end)
      then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NO_CAPABILITY';
    end if;

    if v_cat not in ('property-photos', 'deal-room-documents', 'mortgage-documents',
                     'expat-attachments', 'generated-reports') then
      return 'INVALID_KEY';
    end if;

    -- Property photos keep their own visibility rule: the column the product
    -- has always carried and nothing ever read.
    if v_cat = 'property-photos' then
      select p.user_id, ph.visibility::text into v_owner, v_vis
      from public.property_photos ph
      join public.properties p on p.id = ph.property_id
      where ph.storage_path = p_key limit 1;

      if v_owner is not null and p_action = 'READ' then
        if v_vis in ('PUBLIC', 'AUTHENTICATED') then return 'ALLOW'; end if;
        if v_owner = v_me or v_admin then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      -- No row yet: the upload. The PROPERTY says who owns it.
      if v_owner is null then
        if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
        select p.user_id into v_owner from public.properties p
        where p.id = v_seg[4]::uuid and p.is_deleted = false limit 1;
        if v_owner is null then
          if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
          return 'NOT_OWNER';
        end if;
      end if;
    elsif v_cat = 'deal-room-documents' then
      -- The deal room is the relationship; the account segment is not.
      if v_n >= 5 and v_seg[4] ~ v_uuid_re then
        select dr.user_id into v_owner from public.deal_rooms dr
        where dr.id = v_seg[4]::uuid and dr.deleted_at is null limit 1;
        -- deal_rooms.user_id is an auth uid; translate to the account id.
        if v_owner is not null then
          select u.id into v_owner from public.users u where u.auth_id = v_owner limit 1;
        end if;
      end if;
      if v_owner is null then v_owner := v_acct; end if;
    else
      -- mortgage-documents, expat-attachments, generated-reports: the account
      -- in the key is the owner, and there is no other relationship to check.
      v_owner := v_acct;
    end if;

    if v_owner = v_me and v_acct = v_me then return 'ALLOW'; end if;
    -- Admin may look. Admin may not change or remove somebody's file.
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  -- ══ LEGACY FUNCTIONAL NAMESPACES ══════════════════════════════════════
  -- Objects that were already in Supabase Storage keep the path they had, so
  -- that the copy is a copy and the rollback is "read from the old place".

  if v_ns = 'property-photos' then
    select p.user_id, ph.visibility::text into v_owner, v_vis
    from public.property_photos ph
    join public.properties p on p.id = ph.property_id
    where ph.storage_path = v_rest limit 1;

    if v_owner is not null then
      if p_action = 'READ' then
        if v_vis = 'PUBLIC' then return 'ALLOW'; end if;
        if v_uid is null then return 'UNAUTHENTICATED'; end if;
        if v_vis = 'AUTHENTICATED' then return 'ALLOW'; end if;
        if v_owner = v_me or v_admin then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      if v_uid is null then return 'UNAUTHENTICATED'; end if;
      if v_owner = v_me then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;

    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_n < 4 then return 'INVALID_KEY'; end if;
    if v_seg[2] !~ v_uuid_re or v_seg[3] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    select p.user_id into v_owner from public.properties p
    where p.id = v_seg[3]::uuid and p.is_deleted = false limit 1;
    if v_owner is null or v_owner is distinct from v_me then
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;
    if v_seg[2] <> v_me::text then return 'NOT_OWNER'; end if;
    return 'ALLOW';
  end if;

  if v_ns = 'deal-room-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    select d.user_id into v_owner from public.deal_room_documents d
    where d.storage_path = v_rest limit 1;
    if v_owner is not null then
      if v_owner = v_uid then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
    end if;
    if v_seg[2] = v_uid::text then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  if v_ns = 'developer-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    select d.workspace_id into v_ws from public.dev_documents d
    where d.storage_path = v_rest limit 1;
    if v_ws is null then
      if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      v_ws := v_seg[2]::uuid;
    end if;
    if public.dev_can(v_ws, 'documents') then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NO_CAPABILITY';
  end if;

  if v_ns = 'developer-media' then
    if p_action = 'READ' then return 'ALLOW'; end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    return case when public.dev_can(v_seg[2]::uuid, 'inventory') then 'ALLOW' else 'NO_CAPABILITY' end;
  end if;

  if v_ns = 'mortgage-offer-documents' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] = v_uid::text then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  -- ══ SYSTEM NAMESPACES ═════════════════════════════════════════════════
  if v_ns = 'site-assets' then
    if p_action = 'READ' then return 'ALLOW'; end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  if v_ns in ('voice-auditions', 'diagnostics', 'system', 'research') then
    -- Recordings of real people, self-test objects, generated system assets
    -- and research evidence. Staff only, in every direction.
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
  end if;

  return 'INVALID_KEY';

exception when others then
  return 'UNAVAILABLE';
end;
$fn$;

revoke all on function public.storage_authorize(text, text) from public;
grant execute on function public.storage_authorize(text, text) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 3. THE STORAGE EXPLORER'S QUERIES
-- ════════════════════════════════════════════════════════════════════════

/*
 * Accounts, with their storage totals, found the way an operator looks for
 * them: by email, by uuid, by when they registered.
 *
 * It starts from `users` and LEFT JOINs the objects, which is the whole
 * reason a newly registered account with nothing stored is findable at all.
 * Enumerating R2 would never show it, because there is nothing there to
 * enumerate — a prefix is a substring of a key, not a folder.
 *
 * One aggregate, one pass. No per-account follow-up query.
 */
create or replace function public.storage_admin_accounts(
  p_email       text default null,
  p_user_id     uuid default null,
  p_registered_from timestamptz default null,
  p_registered_to   timestamptz default null,
  p_only_with_files boolean default false,
  p_limit       int default 50,
  p_offset      int default 0
)
returns table (
  user_id        uuid,
  email          text,
  full_name      text,
  is_admin       boolean,
  registered_at  timestamptz,
  object_count   bigint,
  total_bytes    bigint,
  categories     text[],
  last_upload_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $fn$
  with allowed as (select public.is_admin() as ok)
  select
    u.id, u.email, u.full_name, u.is_admin, u.created_at,
    count(o.id) filter (where o.id is not null),
    coalesce(sum(o.byte_size) filter (where o.lifecycle <> 'DELETED'), 0),
    coalesce(array_agg(distinct o.category) filter (where o.category is not null), '{}'),
    max(o.created_at)
  from public.users u
  left join public.storage_objects o
    on o.owner_user_id = u.id and o.lifecycle <> 'DELETED'
  where (select ok from allowed)
    and (p_email is null or u.email ilike '%' || p_email || '%')
    and (p_user_id is null or u.id = p_user_id)
    and (p_registered_from is null or u.created_at >= p_registered_from)
    and (p_registered_to   is null or u.created_at <= p_registered_to)
  group by u.id, u.email, u.full_name, u.is_admin, u.created_at
  having (not p_only_with_files) or count(o.id) > 0
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

/*
 * The objects themselves, filtered the way the explorer filters.
 *
 * Email resolves through users rather than being duplicated onto every
 * storage row: an address that is copied in a thousand places is an address
 * that is wrong in a thousand places the day somebody changes it.
 */
create or replace function public.storage_admin_objects(
  p_email        text default null,
  p_user_id      uuid default null,
  p_category     text default null,
  p_entity_type  text default null,
  p_entity_id    uuid default null,
  p_content_type text default null,
  p_visibility   text default null,
  p_lifecycle    text default null,
  p_provider     text default null,
  p_uploaded_from timestamptz default null,
  p_uploaded_to   timestamptz default null,
  p_registered_from timestamptz default null,
  p_registered_to   timestamptz default null,
  p_min_bytes    bigint default null,
  p_max_bytes    bigint default null,
  p_limit        int default 100,
  p_offset       int default 0
)
returns table (
  id                uuid,
  provider          text,
  namespace         text,
  category          text,
  object_key        text,
  owner_user_id     uuid,
  owner_email       text,
  owner_registered_at timestamptz,
  entity_type       text,
  entity_id         uuid,
  purpose           text,
  original_filename text,
  content_type      text,
  byte_size         bigint,
  checksum_sha256   text,
  visibility        text,
  lifecycle         text,
  source_bucket     text,
  source_path       text,
  verified_at       timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz,
  total_matched     bigint
)
language sql
stable
security definer
set search_path to ''
as $fn$
  with allowed as (select public.is_admin() as ok),
  matched as (
    select o.*, u.email as owner_email, u.created_at as owner_registered_at
    from public.storage_objects o
    left join public.users u on u.id = o.owner_user_id
    where (select ok from allowed)
      and (p_email        is null or u.email ilike '%' || p_email || '%')
      and (p_user_id      is null or o.owner_user_id = p_user_id)
      and (p_category     is null or o.category = p_category)
      and (p_entity_type  is null or o.entity_type = p_entity_type)
      and (p_entity_id    is null or o.entity_id = p_entity_id)
      and (p_content_type is null or o.content_type ilike p_content_type || '%')
      and (p_visibility   is null or o.visibility = p_visibility)
      and (p_lifecycle    is null or o.lifecycle = p_lifecycle)
      and (p_provider     is null or o.provider = p_provider)
      and (p_uploaded_from is null or o.created_at >= p_uploaded_from)
      and (p_uploaded_to   is null or o.created_at <= p_uploaded_to)
      and (p_registered_from is null or u.created_at >= p_registered_from)
      and (p_registered_to   is null or u.created_at <= p_registered_to)
      and (p_min_bytes    is null or o.byte_size >= p_min_bytes)
      and (p_max_bytes    is null or o.byte_size <= p_max_bytes)
  )
  select
    m.id, m.provider, m.namespace, m.category, m.object_key,
    m.owner_user_id, m.owner_email, m.owner_registered_at,
    m.entity_type, m.entity_id, m.purpose, m.original_filename,
    m.content_type, m.byte_size, m.checksum_sha256, m.visibility, m.lifecycle,
    m.source_bucket, m.source_path, m.verified_at, m.created_at, m.updated_at,
    -- The total travels with the page so the UI never asks twice.
    count(*) over () as total_matched
  from matched m
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$fn$;

/* One account's storage, broken down the way the explorer displays it. */
create or replace function public.storage_account_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $fn$
  select case when not public.is_admin() then null else jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'full_name', u.full_name,
        'is_admin', u.is_admin, 'plan', u.plan, 'registered_at', u.created_at)
      from public.users u where u.id = p_user_id
    ),
    'totals', (
      select jsonb_build_object(
        'object_count', count(*),
        'total_bytes', coalesce(sum(o.byte_size), 0),
        'last_upload_at', max(o.created_at))
      from public.storage_objects o
      where o.owner_user_id = p_user_id and o.lifecycle <> 'DELETED'
    ),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c.category, 'object_count', c.n, 'total_bytes', c.bytes)
        order by c.bytes desc)
      from (
        select o.category, count(*) as n, sum(o.byte_size) as bytes
        from public.storage_objects o
        where o.owner_user_id = p_user_id and o.lifecycle <> 'DELETED'
        group by o.category
      ) c
    ), '[]'::jsonb)
  ) end;
$fn$;

revoke all on function public.storage_admin_accounts(text, uuid, timestamptz, timestamptz, boolean, int, int) from public;
revoke all on function public.storage_admin_objects(text, uuid, text, text, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, bigint, bigint, int, int) from public;
revoke all on function public.storage_account_summary(uuid) from public;

-- `authenticated` may CALL them; every one of them returns nothing at all
-- unless is_admin() is true, checked inside, under the caller's own token.
-- Hiding a page in the frontend is not access control.
grant execute on function public.storage_admin_accounts(text, uuid, timestamptz, timestamptz, boolean, int, int) to authenticated, service_role;
grant execute on function public.storage_admin_objects(text, uuid, text, text, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, bigint, bigint, int, int) to authenticated, service_role;
grant execute on function public.storage_account_summary(uuid) to authenticated, service_role;
