-- ============================================================================
-- HOMATCH PROJECT STUDIO — the internal side of the Digital Twin.
--
-- THE GAP THIS CLOSES, AND WHY IT IS NOT A POLICY CHANGE
--
-- Studio staff can already WRITE every technical table: dt_scenes,
-- dt_scene_versions, dt_assets, dt_templates and dev_unit_types all carry
-- `dev_is_studio()` write policies.
--
-- They cannot READ dev_projects, dev_buildings or dev_units, whose select
-- policies are `dev_is_member(workspace_id) or is_admin()`. So the studio
-- could author a scene for a building it had no way to list. The tool was
-- unusable for the exact people it exists for.
--
-- The obvious fix — adding `or dev_is_studio()` to those three policies —
-- would hand every Homatch 3D artist read access to every customer's prices,
-- and prices are not a technical fact. So instead the studio gets its own
-- purpose-built read: the geometry-relevant shape of a project and nothing
-- else. No price, no buyer, no lead, no payment, no commission. Not filtered
-- out in the client — absent from the SELECT list.
--
-- No existing policy is touched by this migration.
--
-- THE OTHER HALF OF THE BOUNDARY. Everything here raises 42501 for anybody
-- who is not studio staff, so the separation between "Homatch builds the 3D"
-- and "the developer maintains prices and availability" is enforced twice:
-- once by these functions, and once by the RLS policies underneath them.
-- ============================================================================

-- ── 1. WHAT THE STUDIO MAY SEE ─────────────────────────────────────────────

/*
 * Every project in the system, with the state of its twin. This is the
 * studio's work queue: which developments have geometry, which have a
 * published experience, and which are waiting.
 */
create or replace function public.dt_studio_projects()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case when not public.dev_is_studio() then null else coalesce((
    select jsonb_agg(x order by x->>'workspace_name', x->>'name')
      from (
        select jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'slug', p.slug,
          'city', p.city,
          'construction_status', p.construction_status,
          'is_published', p.is_published,
          'workspace_id', p.workspace_id,
          'workspace_name', w.name,
          'workspace_slug', w.slug,
          'buildings', (select count(*) from public.dev_buildings b where b.project_id = p.id),
          'units', (select count(*) from public.dev_units u where u.project_id = p.id),
          'unit_types', (select count(*) from public.dev_unit_types ut where ut.project_id = p.id),
          'scenes', (select count(*) from public.dt_scenes s where s.project_id = p.id),
          'published_scenes', (
            select count(*) from public.dt_scenes s
             where s.project_id = p.id and s.status = 'PUBLISHED'),
          'experience_status', (
            select e.status from public.dt_experiences e
             where e.project_id = p.id limit 1)
        ) as x
        from public.dev_projects p
        join public.dev_workspaces w on w.id = p.workspace_id
      ) t), '[]'::jsonb) end;
$$;

/*
 * One project, in the shape geometry is authored against.
 *
 * Buildings and their floor levels; the unit TYPES, which is what geometry is
 * actually built per; and the scenes that already exist. Unit numbers appear
 * because a scene's hotspots have to point at real apartments — but no price,
 * because a 3D artist has no business knowing what floor eleven costs.
 */
create or replace function public.dt_studio_project(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case when not public.dev_is_studio() then null else (
    select jsonb_build_object(
      'project', jsonb_build_object(
        'id', p.id, 'name', p.name, 'slug', p.slug,
        'city', p.city, 'district', p.district,
        'construction_status', p.construction_status,
        'is_published', p.is_published,
        'master_plan_url', p.master_plan_url,
        'cover_image_url', p.cover_image_url,
        'workspace_id', p.workspace_id,
        'workspace_name', w.name,
        'workspace_slug', w.slug),
      'buildings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'code', b.code,
          'floors_count', b.floors_count,
          'facade_image_url', b.facade_image_url,
          'units', (select count(*) from public.dev_units u where u.building_id = b.id),
          'levels', (
            select coalesce(jsonb_agg(distinct u.floor_level), '[]'::jsonb)
              from public.dev_units u
             where u.building_id = b.id and u.floor_level is not null))
          order by b.sort_order, b.name)
        from public.dev_buildings b where b.project_id = p.id), '[]'::jsonb),
      /* THE REUSE SPINE. Geometry is authored per TYPE, so this is the list
         that actually determines how much work a 500-unit scheme is. */
      'unit_types', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ut.id, 'code', ut.code, 'name', ut.name,
          'bedrooms', ut.bedrooms, 'rooms', ut.rooms,
          'area_total', ut.area_total,
          'floor_plan_url', ut.floor_plan_url,
          'template_id', ut.template_id,
          'units', (select count(*) from public.dev_units u where u.unit_type_id = ut.id),
          'scene_id', (
            select s.id from public.dt_scenes s
             where s.unit_type_id = ut.id and s.kind = 'UNIT_TYPE' limit 1))
          order by ut.code)
        from public.dev_unit_types ut where ut.project_id = p.id), '[]'::jsonb),
      'scenes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'kind', s.kind, 'name', s.name, 'status', s.status,
          'building_id', s.building_id, 'unit_type_id', s.unit_type_id,
          'published_version_id', s.published_version_id,
          'versions', (
            select count(*) from public.dt_scene_versions v where v.scene_id = s.id),
          'updated_at', s.updated_at)
          order by s.kind, s.name)
        from public.dt_scenes s where s.project_id = p.id), '[]'::jsonb),
      'experience', (
        select jsonb_build_object(
          'id', e.id, 'slug', e.slug, 'status', e.status,
          'branding', e.branding, 'embed_enabled', e.embed_enabled,
          'embed_origins', e.embed_origins,
          'show_homatch_attribution', e.show_homatch_attribution,
          'custom_domain', e.custom_domain, 'published_at', e.published_at)
        from public.dt_experiences e where e.project_id = p.id limit 1),
      /* Unit numbers WITHOUT prices — a hotspot has to point at a real
         apartment, and that is all a hotspot needs to know. */
      'units', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', u.id, 'unit_number', u.unit_number,
          'building_id', u.building_id, 'floor_level', u.floor_level,
          'unit_type_id', u.unit_type_id)
          order by u.building_id, u.floor_level, u.unit_number)
        from public.dev_units u where u.project_id = p.id), '[]'::jsonb)
    )
    from public.dev_projects p
    join public.dev_workspaces w on w.id = p.workspace_id
    where p.id = p_project_id) end;
$$;

-- ── 2. AUTHORING ───────────────────────────────────────────────────────────

create or replace function public.dt_studio_upsert_scene(
  p_project_id uuid,
  p_kind text,
  p_name text,
  p_building_id uuid default null,
  p_unit_type_id uuid default null,
  p_scene_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_workspace uuid;
  v_id uuid;
begin
  if not public.dev_is_studio() then
    raise exception 'The 3D is built by Homatch studio staff.' using errcode = '42501';
  end if;

  select workspace_id into v_workspace from public.dev_projects where id = p_project_id;
  if v_workspace is null then
    raise exception 'Project not found.' using errcode = 'no_data_found';
  end if;

  if p_scene_id is not null then
    update public.dt_scenes
       set name = coalesce(p_name, name),
           building_id = coalesce(p_building_id, building_id),
           unit_type_id = coalesce(p_unit_type_id, unit_type_id)
     where id = p_scene_id and project_id = p_project_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Scene not found.' using errcode = 'no_data_found';
    end if;
    return v_id;
  end if;

  insert into public.dt_scenes (
    workspace_id, project_id, kind, building_id, unit_type_id, name, status, created_by)
  values (v_workspace, p_project_id, p_kind, p_building_id, p_unit_type_id, p_name, 'DRAFT', v_user)
  returning id into v_id;
  return v_id;
end;
$$;

/*
 * A NEW VERSION, NEVER AN EDIT IN PLACE.
 *
 * Versions are how a published page stays still while somebody works on the
 * next one. Saving produces a new row; publishing points the scene at it.
 * Nothing a visitor is currently looking at is ever mutated, which is also
 * what makes the asset URLs safe to cache forever.
 */
create or replace function public.dt_studio_save_version(
  p_scene_id uuid,
  p_graph jsonb default '{}'::jsonb,
  p_camera_presets jsonb default '[]'::jsonb,
  p_hotspots jsonb default '[]'::jsonb,
  p_budget jsonb default '{}'::jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_workspace uuid;
  v_next integer;
  v_id uuid;
begin
  if not public.dev_is_studio() then
    raise exception 'The 3D is built by Homatch studio staff.' using errcode = '42501';
  end if;

  select workspace_id into v_workspace from public.dt_scenes where id = p_scene_id;
  if v_workspace is null then
    raise exception 'Scene not found.' using errcode = 'no_data_found';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.dt_scene_versions where scene_id = p_scene_id;

  insert into public.dt_scene_versions (
    scene_id, workspace_id, version, graph, camera_presets, hotspots, budget, notes, created_by)
  values (
    p_scene_id, v_workspace, v_next, coalesce(p_graph, '{}'::jsonb),
    coalesce(p_camera_presets, '[]'::jsonb), coalesce(p_hotspots, '[]'::jsonb),
    coalesce(p_budget, '{}'::jsonb), p_notes, v_user)
  returning id into v_id;

  update public.dt_scenes set status = 'REVIEW' where id = p_scene_id and status = 'DRAFT';
  return v_id;
end;
$$;

create or replace function public.dt_studio_publish_scene(
  p_scene_id uuid, p_version_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_user uuid := public.auth_user_id();
begin
  if not public.dev_is_studio() then
    raise exception 'The 3D is published by Homatch studio staff.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.dt_scene_versions
     where id = p_version_id and scene_id = p_scene_id) then
    raise exception 'That version does not belong to that scene.' using errcode = 'check_violation';
  end if;

  update public.dt_scene_versions
     set published_at = coalesce(published_at, now()) where id = p_version_id;
  update public.dt_scenes
     set published_version_id = p_version_id, status = 'PUBLISHED' where id = p_scene_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  select s.workspace_id, v_user, 'scene', s.id, 'PUBLISHED',
         jsonb_build_object('version_id', p_version_id)
    from public.dt_scenes s where s.id = p_scene_id;
end;
$$;

create or replace function public.dt_studio_unpublish_scene(p_scene_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_user uuid := public.auth_user_id();
begin
  if not public.dev_is_studio() then
    raise exception 'The 3D is published by Homatch studio staff.' using errcode = '42501';
  end if;
  update public.dt_scenes set status = 'ARCHIVED' where id = p_scene_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  select s.workspace_id, v_user, 'scene', s.id, 'UNPUBLISHED', '{}'::jsonb
    from public.dt_scenes s where s.id = p_scene_id;
end;
$$;

-- ── 3. ASSETS, DEDUPLICATED BY CONTENT ─────────────────────────────────────

/*
 * Register an uploaded file, or find the one that is already there.
 *
 * content_hash is the identity. Twenty projects using the same oak floor
 * texture store it once and reference it twenty times, which is the
 * difference between a shared library and twenty copies of the same eight
 * megabytes. The caller hashes the bytes before uploading and passes the
 * digest; a matching row short-circuits the whole upload.
 */
create or replace function public.dt_studio_register_asset(
  p_kind text,
  p_name text,
  p_storage_key text,
  p_content_hash text,
  p_bytes bigint,
  p_mime text,
  p_scope text default 'PROJECT',
  p_workspace_id uuid default null,
  p_project_id uuid default null,
  p_is_deliverable boolean default true,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_existing public.dt_assets%rowtype;
  v_id uuid;
begin
  if not public.dev_is_studio() then
    raise exception 'Assets are managed by Homatch studio staff.' using errcode = '42501';
  end if;

  if p_content_hash is not null then
    select * into v_existing from public.dt_assets
     where content_hash = p_content_hash
       and scope = p_scope
       and workspace_id is not distinct from p_workspace_id
     limit 1;
    if found then
      return jsonb_build_object('id', v_existing.id, 'reused', true,
                                'storage_key', v_existing.storage_key);
    end if;
  end if;

  insert into public.dt_assets (
    scope, workspace_id, project_id, kind, name, storage_provider, storage_key,
    content_hash, version, bytes, mime, meta, is_deliverable, created_by)
  values (
    p_scope, p_workspace_id, p_project_id, p_kind, p_name, 'SUPABASE', p_storage_key,
    p_content_hash, 1, p_bytes, p_mime, coalesce(p_meta, '{}'::jsonb), p_is_deliverable, v_user)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reused', false, 'storage_key', p_storage_key);
end;
$$;

create or replace function public.dt_studio_attach_asset(
  p_asset_id uuid, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.dev_is_studio() then
    raise exception 'Assets are managed by Homatch studio staff.' using errcode = '42501';
  end if;
  insert into public.dt_asset_refs (asset_id, ref_type, ref_id)
  values (p_asset_id, p_ref_type, p_ref_id)
  on conflict (asset_id, ref_type, ref_id) do nothing;
end;
$$;

create or replace function public.dt_studio_detach_asset(
  p_asset_id uuid, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.dev_is_studio() then
    raise exception 'Assets are managed by Homatch studio staff.' using errcode = '42501';
  end if;
  delete from public.dt_asset_refs
   where asset_id = p_asset_id and ref_type = p_ref_type and ref_id = p_ref_id;
end;
$$;

-- ── 4. THE PUBLISHED EXPERIENCE, AND ITS WHITE LABEL ───────────────────────

create or replace function public.dt_studio_upsert_experience(
  p_project_id uuid,
  p_slug text default null,
  p_status text default null,
  p_branding jsonb default null,
  p_embed_enabled boolean default null,
  p_embed_origins text[] default null,
  p_show_attribution boolean default null,
  p_custom_domain text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_workspace uuid;
  v_id uuid;
  v_slug text;
begin
  if not public.dev_is_studio() then
    raise exception 'The published experience is configured by Homatch studio staff.'
      using errcode = '42501';
  end if;

  select workspace_id into v_workspace from public.dev_projects where id = p_project_id;
  if v_workspace is null then
    raise exception 'Project not found.' using errcode = 'no_data_found';
  end if;

  select id into v_id from public.dt_experiences where project_id = p_project_id limit 1;

  if v_id is null then
    select coalesce(p_slug, p.slug) into v_slug
      from public.dev_projects p where p.id = p_project_id;
    insert into public.dt_experiences (
      workspace_id, project_id, slug, status, branding, embed_enabled,
      embed_origins, show_homatch_attribution, custom_domain, created_by)
    values (
      v_workspace, p_project_id, v_slug, coalesce(p_status, 'DRAFT'),
      coalesce(p_branding, '{}'::jsonb), coalesce(p_embed_enabled, true),
      coalesce(p_embed_origins, array[]::text[]),
      coalesce(p_show_attribution, true), p_custom_domain, v_user)
    returning id into v_id;
  else
    update public.dt_experiences set
      slug = coalesce(p_slug, slug),
      status = coalesce(p_status, status),
      branding = coalesce(p_branding, branding),
      embed_enabled = coalesce(p_embed_enabled, embed_enabled),
      embed_origins = coalesce(p_embed_origins, embed_origins),
      show_homatch_attribution = coalesce(p_show_attribution, show_homatch_attribution),
      custom_domain = coalesce(p_custom_domain, custom_domain),
      published_at = case
        when p_status = 'PUBLISHED' then coalesce(published_at, now())
        else published_at end
    where id = v_id;
  end if;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_workspace, v_user, 'experience', v_id, 'CONFIGURED',
          jsonb_build_object('status', p_status, 'embed_enabled', p_embed_enabled));

  return v_id;
end;
$$;

/* Attaching a shared interior template to a layout. The reuse spine, used. */
create or replace function public.dt_studio_set_unit_type_template(
  p_unit_type_id uuid, p_template_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.dev_is_studio() then
    raise exception 'Templates are assigned by Homatch studio staff.' using errcode = '42501';
  end if;
  update public.dev_unit_types set template_id = p_template_id where id = p_unit_type_id;
end;
$$;

-- ── 5. WHAT IT COSTS US ────────────────────────────────────────────────────
--
-- Studio-only, deliberately: a developer must not be able to read what their
-- project costs Homatch to serve. dt_cost_rollup's select policy already says
-- dev_is_studio() and is not touched here.

create or replace function public.dt_studio_costs(p_project_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case when not public.dev_is_studio() then null else jsonb_build_object(
    'rollups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', c.project_id,
        'period_start', c.period_start,
        'stored_bytes', c.stored_bytes,
        'deliverable_bytes', c.deliverable_bytes,
        'asset_requests', c.asset_requests,
        'bandwidth_bytes', c.bandwidth_bytes,
        'viewer_opens', c.viewer_opens,
        'processing_jobs', c.processing_jobs,
        'preparation_cost_usd', c.preparation_cost_usd)
        order by c.period_start desc)
      from (
        select * from public.dt_cost_rollup c2
         where p_project_id is null or c2.project_id = p_project_id
         order by c2.period_start desc limit 24) c), '[]'::jsonb),
    /* Measured now rather than rolled up: what the deliverables for this
       project actually weigh. The one number that predicts the bandwidth
       bill, and the one a studio artist can do something about. */
    'live', (
      select jsonb_build_object(
        'assets', count(*),
        'deliverable_bytes', coalesce(sum(a.bytes) filter (where a.is_deliverable), 0),
        'source_bytes', coalesce(sum(a.bytes) filter (where not a.is_deliverable), 0),
        'shared_assets', count(*) filter (where a.scope = 'GLOBAL'))
      from public.dt_assets a
       where p_project_id is null or a.project_id = p_project_id));
$$;

-- ── 6. SURFACE ─────────────────────────────────────────────────────────────
-- Nothing here is public. The sweep grants authenticated and revokes anon;
-- each function refuses a non-studio caller in its own body as well.

select public.dev_lockdown_rpc_surface();
