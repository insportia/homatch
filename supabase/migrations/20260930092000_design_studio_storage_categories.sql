-- ═══════════════════════════════════════════════════════════════════════
-- HOMATCH DESIGN STUDIO — object storage categories on the existing R2 path.
--
-- Design Studio uploads (customer floor plans, customer GLB/GLTF models,
-- version thumbnails) use the SAME Cloudflare R2 + storage-sign architecture
-- as every other account file: presigned single-object URLs, a
-- storage_objects metadata row, and this function deciding who may act.
-- The database stores only keys and metadata; no bytes live in Postgres.
--
-- storage_authorize() keeps its category allowlist in SQL, so adding the
-- three categories means re-creating the function. This is the definition
-- from 20260918213458_storage_account_scope_and_explorer.sql, VERBATIM,
-- with one added branch (marked "HOMATCH Design Studio"). Nothing else in
-- it changes. Grants are restated exactly as that migration left them.
-- ═══════════════════════════════════════════════════════════════════════

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
