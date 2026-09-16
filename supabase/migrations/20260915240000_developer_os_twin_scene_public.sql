-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the published scene, readable by a visitor.
--
-- THE GAP THIS CLOSES
--
-- dt_experience_manifest already tells an anonymous visitor which buildings a
-- development has and which scene each one points at. It does not tell them
-- what that scene IS — the geometry references, the camera positions, the
-- hotspots — because dt_scenes and dt_scene_versions are readable only by
-- workspace members (dev_is_member) and by studio staff.
--
-- Which meant the viewer could name a scene and never load one. Everything the
-- Digital Twin was for stopped at the last step.
--
-- This is the missing read, and it is deliberately narrow:
--
--   * Only the PUBLISHED version of a scene, never a draft somebody is still
--     working on. A studio editor's half-finished floor must not appear on a
--     developer's website because the row existed.
--   * Only a scene whose PROJECT is published and whose experience is
--     PUBLISHED. Three gates, because the visitor is anonymous.
--   * Assets are returned as their addressing fields, not as URLs. The client
--     builds the URL through assetUrl(), which is the one place that knows
--     whether the bytes live in Supabase, R2 or a CDN — so moving them later
--     stays a column change.
--   * Nothing about cost, nothing about who made it, no draft notes.
--
-- WHAT THE VIEWER DOES WHEN THERE IS NO SCENE. It says so, and falls back to
-- the floor selector built from the real inventory. It does NOT invent a
-- building. Geometry is authored by Homatch studio staff, and until they have
-- authored some there is none — pretending otherwise would be exactly the
-- fake 3D this product refuses to ship.
-- ============================================================================

create or replace function public.dt_scene(p_scene_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'kind', s.kind,
    'name', s.name,
    'building_id', s.building_id,
    'unit_type_id', s.unit_type_id,
    'version', v.version,
    'graph', v.graph,
    'camera_presets', v.camera_presets,
    'hotspots', v.hotspots,
    -- The measured cost of this scene, which the viewer uses to decide how
    -- much to load before first paint. Published deliberately: a page that
    -- knows its own weight can stage itself.
    'budget', v.budget,
    /*
     * Every asset this scene's graph refers to, resolved once here rather
     * than in n round trips from the browser. Deliverable assets only — a
     * source .blend or a 200MB master that happens to be attached is ours,
     * not something to hand a phone.
     */
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'kind', a.kind,
        'name', a.name,
        'storage_provider', a.storage_provider,
        'storage_key', a.storage_key,
        'content_hash', a.content_hash,
        'version', a.version,
        'bytes', a.bytes,
        'mime', a.mime,
        'meta', a.meta))
      from public.dt_asset_refs r
      join public.dt_assets a on a.id = r.asset_id
       where r.ref_type = 'SCENE_VERSION' and r.ref_id = v.id
         and a.is_deliverable), '[]'::jsonb)
  )
  from public.dt_scenes s
  join public.dt_scene_versions v on v.id = s.published_version_id
  join public.dev_projects p on p.id = s.project_id
  where s.id = p_scene_id
    -- THE THREE GATES.
    and s.status = 'PUBLISHED'
    and v.published_at is not null
    and p.is_published
    and exists (
      select 1 from public.dt_experiences e
       where e.project_id = s.project_id and e.status = 'PUBLISHED');
$$;

comment on function public.dt_scene(uuid) is
  'The published version of one scene, for an anonymous viewer. Drafts, unpublished projects and non-deliverable assets are excluded in SQL, not by the caller.';

-- ── The unit-type scene, which is the reuse spine paying off ───────────────
--
-- 500 apartments across 20 layouts means 20 interiors, not 500. A viewer
-- opening apartment 1408 asks for its TYPE's scene, and that scene has very
-- probably already been downloaded and cached by the browser from apartment
-- 1108 twenty minutes ago. This is the entire cost model in one function.

create or replace function public.dt_unit_scene(p_unit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_scene uuid;
begin
  select s.id into v_scene
    from public.dev_units u
    join public.dev_unit_types ut on ut.id = u.unit_type_id
    join public.dt_scenes s
      on s.unit_type_id = ut.id and s.kind = 'UNIT_TYPE' and s.status = 'PUBLISHED'
    join public.dev_projects p on p.id = u.project_id
   where u.id = p_unit_id
     and u.is_published
     and p.is_published
   limit 1;

  if v_scene is null then return jsonb_build_object('error', 'NO_SCENE'); end if;
  return coalesce(public.dt_scene(v_scene), jsonb_build_object('error', 'NO_SCENE'));
end;
$$;

-- ── Surface ────────────────────────────────────────────────────────────────
--
-- Both are public entry points, so they join the sweep's own list rather than
-- being granted by hand — otherwise the next migration that adds a function
-- would revoke them again.

create or replace function public.dev_lockdown_rpc_surface()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  fn record;
  v_closed integer := 0;

  /* THE PUBLIC SURFACE OF HOMATCH FOR DEVELOPERS, IN FULL.
     A visitor with no account may call these and nothing else. Each returns
     named, publishable columns of published rows; none reads a dev_* or dt_*
     table directly, because anon holds no table grant at all. */
  public_fns constant text[] := array[
    'dev_share_resolve',        -- one shared apartment
    'dev_share_track',          -- activity on a link the workspace itself sent
    'dev_public_project',       -- a published project page
    'dev_buyer_room',           -- a buyer's own purchase, by their own token
    'dev_buyer_room_document',  -- a document deliberately shared with that buyer
    'dt_experience_manifest',   -- the shell of a development
    'dt_building_floors',       -- one building's floors
    'dt_floor_units',           -- one floor's units
    'dt_scene',                 -- one published scene's geometry
    'dt_unit_scene',            -- the scene for an apartment's TYPE
    'dt_track'                  -- batched, capped viewer analytics
  ];

  /* Callable only from inside another SECURITY DEFINER function, which has
     already established who the caller is and what they may do. */
  internal_fns constant text[] := array[
    'dev_contact_list', 'dev_refresh_schedule', 'dev_new_token',
    'dev_units_guard_status', 'dev_units_record_history',
    'dt_guard_unit_type_template', 'dt_guard_experience_publishing',
    'dev_lockdown_rpc_surface'
  ];
begin
  for fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'dev\_%' or p.proname like 'dt\_%')
  loop
    if fn.proname = any(public_fns) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated',
                     fn.proname, fn.args);
      continue;
    end if;

    -- BOTH revokes, every time. The inherited grant and the direct one.
    execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.args);
    execute format('revoke all on function public.%I(%s) from anon', fn.proname, fn.args);
    v_closed := v_closed + 1;

    if fn.proname = any(internal_fns) then
      execute format('revoke all on function public.%I(%s) from authenticated',
                     fn.proname, fn.args);
    else
      -- Includes dev_storage_workspace, which a storage policy evaluates and
      -- which therefore needs EXECUTE for the role running the query.
      execute format('grant execute on function public.%I(%s) to authenticated',
                     fn.proname, fn.args);
    end if;
  end loop;

  return v_closed;
end;
$$;

select public.dev_lockdown_rpc_surface();

revoke all on function public.dev_lockdown_rpc_surface() from public;
revoke all on function public.dev_lockdown_rpc_surface() from anon;
revoke all on function public.dev_lockdown_rpc_surface() from authenticated;
