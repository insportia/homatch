-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the import populates the reuse spine.
--
-- dev_import_units already wrote `unit_type` as free text, which is what the
-- developer's own spreadsheet calls the layout ("A2", "2+1", "Type C"). That
-- string is exactly the grouping the 3D economics depend on, and it was being
-- thrown into a text column where nothing could attach to it.
--
-- Now the same import also finds-or-creates a dev_unit_types row per distinct
-- code within the project and links the unit to it. A 500-row sheet with 20
-- layout codes produces 20 type rows and 500 light unit rows pointing at them,
-- which is the shape that lets geometry be authored twenty times instead of
-- five hundred.
--
-- The text column is still written, unchanged, so every existing read, filter
-- and export keeps working exactly as before. The new link is additive.
--
-- A type created this way carries only what the sheet knew — bedrooms, rooms
-- and area. It carries NO template: attaching 3D is Homatch studio work and
-- an import has no business doing it.
-- ============================================================================

create or replace function public.dev_import_units(
  p_project_id uuid,
  p_rows jsonb,
  p_mode text default 'INSERT'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_project public.dev_projects%rowtype;
  v_row jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_types_created integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_num text;
  v_building uuid;
  v_type_code text;
  v_type uuid;
  v_idx integer := 0;
begin
  select * into v_project from public.dev_projects where id = p_project_id;
  if not found then raise exception 'Project not found.' using errcode = 'no_data_found'; end if;
  if not public.dev_can(v_project.workspace_id, 'inventory') then
    raise exception 'You do not have permission to import inventory.' using errcode = '42501';
  end if;
  if p_mode not in ('INSERT', 'UPSERT') then
    raise exception 'Unknown import mode %.', p_mode using errcode = 'check_violation';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    v_num := nullif(trim(coalesce(v_row->>'unit_number', '')), '');

    if v_num is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'missing unit number');
      continue;
    end if;

    -- Building: find or create, unchanged.
    v_building := null;
    if nullif(trim(coalesce(v_row->>'building', '')), '') is not null then
      select id into v_building from public.dev_buildings
       where project_id = p_project_id and name = trim(v_row->>'building') limit 1;
      if v_building is null then
        insert into public.dev_buildings (workspace_id, project_id, name)
        values (v_project.workspace_id, p_project_id, trim(v_row->>'building'))
        returning id into v_building;
      end if;
    end if;

    /* THE REUSE SPINE.
       The sheet's own layout label becomes a type. Area and bedrooms are
       taken from the FIRST row that introduced the code — later rows of the
       same code do not overwrite it, because a spreadsheet with one typo in
       one row should not redefine a layout shared by forty apartments. */
    v_type := null;
    v_type_code := nullif(trim(coalesce(v_row->>'unit_type', '')), '');
    if v_type_code is not null then
      select id into v_type from public.dev_unit_types
       where project_id = p_project_id and code = v_type_code limit 1;
      if v_type is null then
        insert into public.dev_unit_types (
          workspace_id, project_id, code, bedrooms, rooms, area_total, created_by)
        values (
          v_project.workspace_id, p_project_id, v_type_code,
          (nullif(v_row->>'bedrooms', ''))::integer,
          (nullif(v_row->>'rooms', ''))::integer,
          (nullif(v_row->>'area_total', ''))::numeric,
          v_user)
        returning id into v_type;
        v_types_created := v_types_created + 1;
      end if;
    end if;

    if exists (select 1 from public.dev_units u
                where u.project_id = p_project_id and u.unit_number = v_num) then
      if p_mode = 'INSERT' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      update public.dev_units set
        building_id   = coalesce(v_building, building_id),
        unit_type_id  = coalesce(v_type, unit_type_id),
        floor_level   = coalesce((nullif(v_row->>'floor_level', ''))::integer, floor_level),
        unit_type     = coalesce(nullif(v_row->>'unit_type', ''), unit_type),
        bedrooms      = coalesce((nullif(v_row->>'bedrooms', ''))::integer, bedrooms),
        rooms         = coalesce((nullif(v_row->>'rooms', ''))::integer, rooms),
        area_total    = coalesce((nullif(v_row->>'area_total', ''))::numeric, area_total),
        area_internal = coalesce((nullif(v_row->>'area_internal', ''))::numeric, area_internal),
        area_balcony  = coalesce((nullif(v_row->>'area_balcony', ''))::numeric, area_balcony),
        orientation   = coalesce(nullif(v_row->>'orientation', ''), orientation),
        view_text     = coalesce(nullif(v_row->>'view_text', ''), view_text),
        price         = coalesce((nullif(v_row->>'price', ''))::numeric, price),
        currency      = coalesce(nullif(v_row->>'currency', ''), currency),
        notes         = coalesce(nullif(v_row->>'notes', ''), notes)
      where project_id = p_project_id and unit_number = v_num;
      v_updated := v_updated + 1;
    else
      begin
        insert into public.dev_units (
          workspace_id, project_id, building_id, unit_type_id, unit_number,
          floor_level, unit_type, bedrooms, rooms, area_total, area_internal,
          area_balcony, orientation, view_text, price, currency, notes,
          created_by, sort_order)
        values (
          v_project.workspace_id, p_project_id, v_building, v_type, v_num,
          (nullif(v_row->>'floor_level', ''))::integer,
          nullif(v_row->>'unit_type', ''),
          (nullif(v_row->>'bedrooms', ''))::integer,
          (nullif(v_row->>'rooms', ''))::integer,
          (nullif(v_row->>'area_total', ''))::numeric,
          (nullif(v_row->>'area_internal', ''))::numeric,
          (nullif(v_row->>'area_balcony', ''))::numeric,
          nullif(v_row->>'orientation', ''),
          nullif(v_row->>'view_text', ''),
          (nullif(v_row->>'price', ''))::numeric,
          coalesce(nullif(v_row->>'currency', ''), v_project.currency),
          nullif(v_row->>'notes', ''),
          v_user, v_idx);
        v_inserted := v_inserted + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'unit', v_num, 'error', SQLERRM);
      end;
    end if;
  end loop;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_project.workspace_id, v_user, 'project', p_project_id, 'INVENTORY_IMPORT',
          jsonb_build_object('mode', p_mode, 'inserted', v_inserted, 'updated', v_updated,
                             'skipped', v_skipped, 'unit_types_created', v_types_created));

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped,
    'unit_types_created', v_types_created, 'errors', v_errors);
end;
$$;

revoke all on function public.dev_import_units(uuid, jsonb, text) from public;
revoke all on function public.dev_import_units(uuid, jsonb, text) from anon;
grant execute on function public.dev_import_units(uuid, jsonb, text) to authenticated;
