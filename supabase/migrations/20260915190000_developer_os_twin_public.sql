-- ============================================================================
-- HOMATCH DIGITAL TWIN — the public read path, and the cheap way to record it.
--
-- THE MANIFEST IS THE WHOLE COST ARGUMENT
--
-- dt_experience_manifest() returns the SHELL of a development: the project,
-- its buildings, how many units are available in each, and the scene
-- references — and no unit rows, no floors, no geometry, no textures. For a
-- 500-unit scheme that is a few kilobytes of json, and it is what opening the
-- link costs.
--
-- Everything deeper is fetched only when a visitor asks for it:
--   dt_building_floors()  after they pick a building
--   dt_floor_units()      after they pick a floor
-- so a person who looks at one apartment never pays for the other 499.
--
-- SEPARATING WHAT CHANGES FROM WHAT DOES NOT
--
-- These functions return small, always-fresh business data: status, price,
-- availability. The heavy assets they POINT at are immutable and versioned,
-- so marking #694 SOLD changes a row that is never cached and invalidates no
-- geometry at all. That split is what lets the twin be cheap and correct at
-- the same time, and it is why nothing here embeds an asset's bytes.
--
-- WHAT A STRANGER CAN SEE
--
-- Only published rows of a published project of an ACTIVE workspace, column
-- by named column. No CRM, no buyer, no note, no document, no payment, no
-- price rule beyond the published price. anon holds no grant on any dev_* or
-- dt_* table; these functions are the entire public surface.
-- ============================================================================

-- ── 1. THE SHELL ───────────────────────────────────────────────────────────

create or replace function public.dt_experience_manifest(
  p_workspace_slug text,
  p_project_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug,
      'city', p.city, 'district', p.district, 'address', p.address,
      'description', p.description, 'construction_status', p.construction_status,
      'handover_date', p.handover_date, 'currency', p.currency,
      'cover_image_url', p.cover_image_url, 'master_plan_url', p.master_plan_url,
      'brochure_url', p.brochure_url,
      'latitude', p.latitude, 'longitude', p.longitude,
      'amenities', p.amenities),
    'developer', jsonb_build_object(
      'name', w.name, 'slug', w.slug, 'logo_url', w.brand_logo_url,
      'brand_color', w.brand_color, 'website', w.website),
    /* Branding and attribution come from the experience when one exists, so a
       white-labelled project is a config lookup rather than a second build. */
    'experience', case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'branding', e.branding,
      'embed_enabled', e.embed_enabled,
      'show_homatch_attribution', e.show_homatch_attribution) end,
    /* Counts, not rows. This is what makes the payload independent of how
       many apartments the development has. */
    'buildings', coalesce((
      select jsonb_agg(b ORDER BY b->>'sort_order', b->>'name')
        from (
          select jsonb_build_object(
            'id', bl.id, 'name', bl.name, 'code', bl.code,
            'floors_count', bl.floors_count,
            'facade_image_url', bl.facade_image_url,
            'sort_order', bl.sort_order,
            'available', count(*) filter (where u.status = 'AVAILABLE'),
            'reserved', count(*) filter (where u.status in ('RESERVED','ON_HOLD','NEGOTIATION','CONTRACT_PENDING')),
            'sold', count(*) filter (where u.status = 'SOLD'),
            'total', count(u.id),
            'price_from', min(u.price) filter (where u.status = 'AVAILABLE'),
            'scene_id', (select s.id from public.dt_scenes s
                          where s.building_id = bl.id and s.status = 'PUBLISHED' limit 1)
          ) as b
          from public.dev_buildings bl
          left join public.dev_units u
            on u.building_id = bl.id and u.is_published and u.status <> 'HIDDEN'
          where bl.project_id = p.id
          group by bl.id
        ) buildings), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'available', count(*) filter (where status = 'AVAILABLE'),
        'total', count(*),
        'price_from', min(price) filter (where status = 'AVAILABLE'),
        'price_to', max(price) filter (where status = 'AVAILABLE'))
      from public.dev_units
      where project_id = p.id and is_published and status <> 'HIDDEN'),
    'masterplan_scene_id', (
      select s.id from public.dt_scenes s
       where s.project_id = p.id and s.kind = 'MASTERPLAN' and s.status = 'PUBLISHED' limit 1)
  ) into v_payload
  from public.dev_projects p
  join public.dev_workspaces w on w.id = p.workspace_id
  left join public.dt_experiences e
    on e.project_id = p.id and e.status = 'PUBLISHED'
  where p.is_published and w.status = 'ACTIVE'
    and w.slug = p_workspace_slug and p.slug = p_project_slug;

  return coalesce(v_payload, jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

-- ── 2. ONE BUILDING'S FLOORS ───────────────────────────────────────────────
--
-- Fetched after a visitor picks a building. Still counts rather than units.

create or replace function public.dt_building_floors(p_building_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'building', jsonb_build_object('id', b.id, 'name', b.name,
                                  'facade_image_url', b.facade_image_url),
    'floors', coalesce((
      select jsonb_agg(f order by (f->>'level')::int desc)
        from (
          select jsonb_build_object(
            'level', u.floor_level,
            'available', count(*) filter (where u.status = 'AVAILABLE'),
            'total', count(*),
            'price_from', min(u.price) filter (where u.status = 'AVAILABLE'),
            'plan_image_url', (select fl.plan_image_url from public.dev_floors fl
                                where fl.building_id = b.id and fl.level = u.floor_level limit 1)
          ) as f
          from public.dev_units u
          where u.building_id = b.id and u.is_published and u.status <> 'HIDDEN'
            and u.floor_level is not null
          group by u.floor_level
        ) floors), '[]'::jsonb)
  ) into v_payload
  from public.dev_buildings b
  join public.dev_projects p on p.id = b.project_id
  join public.dev_workspaces w on w.id = p.workspace_id
  where b.id = p_building_id and p.is_published and w.status = 'ACTIVE';

  return coalesce(v_payload, jsonb_build_object('error', 'NOT_FOUND'));
end;
$$;

-- ── 3. ONE FLOOR'S UNITS ───────────────────────────────────────────────────
--
-- The first call that returns unit rows at all, and only for the one floor
-- somebody is actually looking at.

create or replace function public.dt_floor_units(p_building_id uuid, p_floor_level integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_payload jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'unit_number', u.unit_number,
      /* The canonical inventory state, read live. This is the ONLY place the
         public experience learns whether #694 is sold, which is why marking
         it sold needs no republish of anything. */
      'status', u.status,
      'bedrooms', u.bedrooms, 'rooms', u.rooms,
      'area_total', u.area_total, 'area_balcony', u.area_balcony,
      'orientation', u.orientation, 'view_text', u.view_text,
      'price', case when u.status = 'AVAILABLE' then u.price else null end,
      'currency', u.currency,
      'price_per_sqm', case when u.status = 'AVAILABLE' then u.price_per_sqm else null end,
      'floor_plan_url', coalesce(u.floor_plan_url, ut.floor_plan_url),
      'photos', u.photos,
      'hotspot', u.hotspot,
      'unit_type', case when ut.id is null then null else jsonb_build_object(
        'id', ut.id, 'code', ut.code, 'name', ut.name,
        /* The shared model every unit of this type reuses. One download
           serves all of them, and the browser caches it across floors. */
        'template_id', ut.template_id) end,
      'has_walkthrough', exists (
        select 1 from public.dev_walkthroughs t
         where t.unit_id = u.id and t.status = 'PUBLISHED'
           and t.visibility in ('PUBLIC', 'UNLISTED'))
    ) order by u.unit_number), '[]'::jsonb)
  into v_payload
  from public.dev_units u
  join public.dev_buildings b on b.id = u.building_id
  join public.dev_projects p on p.id = u.project_id
  join public.dev_workspaces w on w.id = p.workspace_id
  left join public.dev_unit_types ut on ut.id = u.unit_type_id
  where u.building_id = p_building_id
    and u.floor_level = p_floor_level
    and u.is_published and u.status <> 'HIDDEN'
    and p.is_published and w.status = 'ACTIVE';

  return v_payload;
end;
$$;

-- ── 4. RECORDING WHAT HAPPENED, CHEAPLY ────────────────────────────────────
--
-- One call, many events. The viewer batches — a visitor who opens a project,
-- looks at two buildings and three apartments produces ONE request, not six.
-- Nothing frame-based is accepted, and unknown event names are dropped rather
-- than reported, so a public endpoint never enumerates what it will take.

create or replace function public.dt_track(
  p_experience_slug text,
  p_workspace_slug text,
  p_project_slug text,
  p_events jsonb,
  p_origin text default 'PUBLIC',
  p_origin_host text default null,
  p_visitor text default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_project uuid;
  v_workspace uuid;
  v_experience uuid;
  v_event jsonb;
  v_kind text;
  v_count integer := 0;
  v_hash text;
  v_allowed constant text[] := array[
    'PROJECT_OPEN','BUILDING_VIEW','FLOOR_VIEW','UNIT_VIEW','FLOORPLAN_VIEW',
    'WALKTHROUGH_START','WALKTHROUGH_COMPLETE','HOTSPOT','CONTACT_REQUEST',
    'SHARE','EMBED_OPEN'];
begin
  select p.id, p.workspace_id into v_project, v_workspace
    from public.dev_projects p
    join public.dev_workspaces w on w.id = p.workspace_id
   where p.is_published and w.status = 'ACTIVE'
     and w.slug = p_workspace_slug and p.slug = p_project_slug;

  if v_project is null then return 0; end if;

  select id into v_experience from public.dt_experiences
   where project_id = v_project and status = 'PUBLISHED'
     and (p_experience_slug is null or slug = p_experience_slug)
   limit 1;

  -- Per project, per day. Enough to tell one visit from ten; joinable to
  -- nothing outside this table.
  v_hash := case when p_visitor is null then null
                 else md5(v_project::text || ':' || p_visitor || ':' || current_date::text) end;

  -- A hard ceiling on one request, so a malformed or hostile client cannot
  -- turn a single call into an unbounded write.
  for v_event in
    select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality t(value, n)
    where n <= 50
  loop
    v_kind := upper(coalesce(v_event->>'kind', ''));
    if not (v_kind = any(v_allowed)) then continue; end if;

    insert into public.dt_events (
      workspace_id, project_id, experience_id, building_id, unit_id,
      kind, origin, origin_host, meta, visitor_hash)
    values (
      v_workspace, v_project, v_experience,
      nullif(v_event->>'building_id', '')::uuid,
      nullif(v_event->>'unit_id', '')::uuid,
      v_kind,
      case when p_origin in ('SHARE','EMBED','PUBLIC','STUDIO_PREVIEW') then p_origin else 'PUBLIC' end,
      left(coalesce(p_origin_host, ''), 200),
      coalesce(v_event->'meta', '{}'::jsonb),
      v_hash);

    v_count := v_count + 1;
  end loop;

  return v_count;
exception when others then
  -- Analytics must never break a buyer's page. The failure is swallowed HERE,
  -- at the only place where losing the write is genuinely preferable to
  -- showing somebody an error while they look at an apartment.
  return 0;
end;
$$;

-- ── 5. GRANTS ──────────────────────────────────────────────────────────────

revoke all on function public.dt_experience_manifest(text, text) from public;
revoke all on function public.dt_building_floors(uuid) from public;
revoke all on function public.dt_floor_units(uuid, integer) from public;
revoke all on function public.dt_track(text, text, text, jsonb, text, text, text) from public;

grant execute on function public.dt_experience_manifest(text, text) to anon, authenticated;
grant execute on function public.dt_building_floors(uuid) to anon, authenticated;
grant execute on function public.dt_floor_units(uuid, integer) to anon, authenticated;
grant execute on function public.dt_track(text, text, text, jsonb, text, text, text) to anon, authenticated;

comment on function public.dt_experience_manifest(text, text) is
  'PUBLIC ENTRY POINT. The shell of a development: project, branding, per-building counts. No unit rows, no geometry — the payload does not grow with unit count.';
comment on function public.dt_floor_units(uuid, integer) is
  'PUBLIC ENTRY POINT. One floor''s units, with live canonical status and price. Fetched only after a visitor picks that floor.';
comment on function public.dt_track(text, text, text, jsonb, text, text, text) is
  'PUBLIC ENTRY POINT. Batched, capped at 50 events per call. Never frame-level.';
