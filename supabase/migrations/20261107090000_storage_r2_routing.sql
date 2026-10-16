-- HOMATCH — Cloudflare R2 as the primary object store: write routing, Meta Ads
-- authorisation and the storage inventory (docs/infra/R2_STORAGE_ARCHITECTURE.md).
--
-- WHAT APPLYING THIS DOES: replaces storage_authorize with the identical
-- function plus one branch (meta-ads-media), adds one settings row whose every
-- bucket starts on SUPABASE, and adds four functions. It moves, copies, deletes
-- and re-routes nothing: every upload keeps going where it goes today until an
-- admin switches that bucket's write target to R2 (storage_admin_set_write_target).
--
-- WHY A PER-BUCKET SWITCH: new uploads move to R2 bucket by bucket, each only
-- after its copy and its reads are verified in production, and each can be put
-- back on SUPABASE in one call without a deploy. Readers never depend on the
-- switch: they read R2 first and fall back to Supabase Storage, so an object in
-- either place keeps working (_shared/storage/routed.ts, services/storage/routed.ts).
--
-- KEYS DO NOT CHANGE: a routed object keeps the path the product already stores
-- (meta_creatives.media[].path, deal_room_documents.storage_path, ...); in R2
-- it lives at <bucket>/<that path> (keys.ts keyForLegacyObject). No row is
-- rewritten, which is what makes the rollback "read from the old place again".

/* ------------------------------------------------------------------ *
 * 1. Authorisation: storage_authorize + the meta-ads-media branch     *
 * ------------------------------------------------------------------ */

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

    -- HOMATCH Design Studio: the design project in the key is the relationship.
    -- users/<account>/design-studio-<kind>/<ds_projects.id>/<object>.<ext>
    -- Owner only; Admin may read and never write or delete.
    if v_cat in ('design-studio-floorplans', 'design-studio-models', 'design-studio-thumbnails') then
      if v_n < 5 or v_seg[4] !~ v_uuid_re then return 'INVALID_KEY'; end if;
      select dp.user_id into v_owner from public.ds_projects dp where dp.id = v_seg[4]::uuid limit 1;
      if v_owner is null then
        if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
        return 'NOT_OWNER';
      end if;
      if v_owner = v_me and v_acct = v_me then return 'ALLOW'; end if;
      if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
      return 'NOT_OWNER';
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

  -- Meta Ads creatives (20261107090000): meta-ads-media/<users.id>/... — the
  -- rule the live bucket policies already enforce (meta_ads_media_read /
  -- meta_ads_media_upload): the account in the first segment reads, writes and
  -- removes its own files; an admin may read; nobody else.
  if v_ns = 'meta-ads-media' then
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    if v_seg[2] !~ v_uuid_re then return 'INVALID_KEY'; end if;
    if v_me is not null and v_seg[2] = v_me::text then return 'ALLOW'; end if;
    if v_admin and p_action = 'READ' then return 'ALLOW'; end if;
    return 'NOT_OWNER';
  end if;

  -- ══ DESIGN STUDIO CATALOGUE ════════════════════════════════════════════
  -- design-studio/catalog/<delivery>/<area>/<hma>/<hmv>/<file>. The delivery
  -- class in the key is the whole rule: public = anyone (CC0 and previews),
  -- licensed = any signed-in user (runtime derivatives a licence allows
  -- in-app), restricted = staff only (provider source packages). Nobody
  -- writes here through signing: the importer writes with the service role.
  if v_ns = 'design-studio' then
    if v_n < 7 or v_seg[2] <> 'catalog'
       or v_seg[3] not in ('public', 'licensed', 'restricted')
       or v_seg[4] not in ('models', 'materials', 'hdri', 'thumbnails', 'metadata')
       or v_seg[5] !~ '^hma_[0-9a-z]{26}$' or v_seg[6] !~ '^hmv_[0-9a-z]{26}$' then
      return 'INVALID_KEY';
    end if;
    if p_action = 'READ' then
      if v_seg[3] = 'public' then return 'ALLOW'; end if;
      if v_uid is null then return 'UNAUTHENTICATED'; end if;
      if v_seg[3] = 'licensed' then return 'ALLOW'; end if;
      return case when v_admin then 'ALLOW' else 'NOT_ADMIN' end;
    end if;
    if v_uid is null then return 'UNAUTHENTICATED'; end if;
    return 'NOT_ADMIN';
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

/* ------------------------------------------------------------------ *
 * 2. Write routing                                                    *
 * ------------------------------------------------------------------ */

-- Buckets whose new uploads may be routed to R2. Each has an R2 namespace
-- (keys.ts NAMESPACES) and a storage_authorize branch. Every one starts on
-- SUPABASE; never overwrites an owner's later choice.
insert into public.admin_settings (key, value, description)
values ('storage_r2_routing', jsonb_build_object(
          'meta-ads-media', 'SUPABASE',
          'deal-room-documents', 'SUPABASE',
          'mortgage-offer-documents', 'SUPABASE',
          'developer-documents', 'SUPABASE'),
        'Where NEW uploads of each bucket go (SUPABASE or R2). Reads try R2 first and fall back to Supabase Storage regardless of this setting.')
on conflict (key) do nothing;

-- The write target for one bucket. Anything unknown or unset is SUPABASE.
create or replace function public.storage_write_target(p_bucket text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case when (select value ->> p_bucket from public.admin_settings where key = 'storage_r2_routing') = 'R2'
              then 'R2' else 'SUPABASE' end
$$;

create or replace function public.storage_admin_set_write_target(p_bucket text, p_target text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid;
  v_old jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  if p_target not in ('R2', 'SUPABASE') then raise exception 'STORAGE_BAD_TARGET'; end if;
  select value into v_old from public.admin_settings where key = 'storage_r2_routing' for update;
  if v_old is null then raise exception 'STORAGE_ROUTING_NOT_INSTALLED'; end if;
  if not (v_old ? p_bucket) then raise exception 'STORAGE_BUCKET_NOT_ROUTABLE' using detail = p_bucket; end if;
  update public.admin_settings set value = v_old || jsonb_build_object(p_bucket, p_target)
   where key = 'storage_r2_routing';
  select u.id into v_me from public.users u where u.auth_id = auth.uid() limit 1;
  if v_me is not null then
    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    values (v_me, 'STORAGE_WRITE_TARGET_CHANGED', 'storage_bucket', p_bucket,
            jsonb_build_object('from', v_old ->> p_bucket, 'to', p_target, 'reason', left(p_reason, 200)));
  end if;
  return (select value from public.admin_settings where key = 'storage_r2_routing');
end $$;

/* ------------------------------------------------------------------ *
 * 3. Inventory: what lives where, by service                          *
 * ------------------------------------------------------------------ */

-- Counts and bytes from the two indexes HOMATCH has: storage.objects (Supabase
-- Storage) and public.storage_objects (R2, written by every R2 writer). No
-- cost figure: the bill is Cloudflare's and Supabase's to state.
create or replace function public.storage_admin_inventory()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'routing', coalesce((select value from public.admin_settings where key = 'storage_r2_routing'), '{}'::jsonb),
    'supabase', (select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', b.id, 'public', b.public, 'objects', coalesce(s.n, 0), 'bytes', coalesce(s.bytes, 0),
        'copied_to_r2', coalesce(s.copied, 0), 'last_upload', s.last) order by coalesce(s.bytes, 0) desc, b.id), '[]'::jsonb)
      from storage.buckets b
      left join lateral (
        select count(*) n, sum(coalesce((o.metadata ->> 'size')::bigint, 0)) bytes, max(o.created_at) last,
               count(*) filter (where exists (select 1 from public.storage_objects so
                                               where so.source_bucket = o.bucket_id and so.source_path = o.name
                                                 and so.verified_at is not null)) copied
          from storage.objects o where o.bucket_id = b.id) s on true),
    'r2', (select coalesce(jsonb_agg(jsonb_build_object(
        'namespace', namespace, 'category', category, 'lifecycle', lifecycle,
        'objects', n, 'bytes', bytes, 'last_upload', last) order by bytes desc), '[]'::jsonb)
      from (select so.namespace, coalesce(so.category, so.namespace) category, so.lifecycle,
                   count(*) n, sum(so.byte_size) bytes, max(so.created_at) last
              from public.storage_objects so where so.provider = 'R2'
             group by 1, 2, 3) r),
    'totals', jsonb_build_object(
      'supabase_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
      'supabase_objects', (select count(*) from storage.objects),
      'r2_bytes', (select coalesce(sum(byte_size), 0) from public.storage_objects where provider = 'R2' and lifecycle = 'ACTIVE'),
      'r2_objects', (select count(*) from public.storage_objects where provider = 'R2' and lifecycle = 'ACTIVE')));
end $$;

/* ------------------------------------------------------------------ *
 * 4. Privileges                                                       *
 * ------------------------------------------------------------------ */

revoke all on function public.storage_write_target(text) from public, anon;
grant execute on function public.storage_write_target(text) to authenticated, service_role;
revoke all on function public.storage_admin_set_write_target(text, text, text) from public, anon;
grant execute on function public.storage_admin_set_write_target(text, text, text) to authenticated, service_role;
revoke all on function public.storage_admin_inventory() from public, anon;
grant execute on function public.storage_admin_inventory() to authenticated, service_role;
