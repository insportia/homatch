-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the RPC surface, closed once and closeable again.
--
-- THIS IS THE SECOND TIME, WHICH IS THE POINT
--
-- Supabase grants EXECUTE on every new function in `public` to anon and
-- authenticated. A migration that ends with `revoke all ... from public` looks
-- like it has closed the door and has not: PUBLIC is a pseudo-role, `anon` is
-- a real one holding its own grant, and revoking the first leaves the second.
--
-- That was found and fixed once already for the dev_* functions. Then the
-- Digital Twin migrations created eight more functions and the default grant
-- put three of them straight back on the internet:
--
--   dev_is_studio                   the technical permission boundary itself
--   dt_guard_unit_type_template     a trigger function with no trigger context
--   dt_guard_experience_publishing  the same
--
-- None was exploitable — dev_is_studio() returns false for an anonymous caller
-- and a trigger function invoked over REST errors immediately. That is luck,
-- not design, and the next function might not be so harmless.
--
-- So this migration does not hand-list functions. It sweeps the catalogue, and
-- it leaves behind a function that any future migration can call to sweep it
-- again. The fix stops being something somebody has to remember.
-- ============================================================================

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
    'dt_experience_manifest',   -- the shell of a development
    'dt_building_floors',       -- one building's floors
    'dt_floor_units',           -- one floor's units
    'dt_track'                  -- batched, capped viewer analytics
  ];

  /* Callable only from inside another SECURITY DEFINER function, which has
     already established who the caller is and what they may do. Granted to
     nobody at all. */
  internal_fns constant text[] := array[
    'dev_contact_list', 'dev_refresh_schedule', 'dev_new_token',
    'dev_units_guard_status', 'dev_units_record_history',
    'dt_guard_unit_type_template', 'dt_guard_experience_publishing',
    'dev_lockdown_rpc_surface'
  ];

  /* Evaluated inside a storage policy, so the role running the query needs
     EXECUTE on it. A pure, immutable string parser that returns the first path
     segment as a uuid; it reads nothing and reveals nothing. */
  policy_fns constant text[] := array['dev_storage_workspace'];
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
    elsif fn.proname = any(policy_fns) then
      execute format('grant execute on function public.%I(%s) to authenticated',
                     fn.proname, fn.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated',
                     fn.proname, fn.args);
    end if;
  end loop;

  return v_closed;
end;
$$;

comment on function public.dev_lockdown_rpc_surface() is
  'Re-closes the dev_*/dt_* RPC surface. Call it at the end of any migration that adds functions — Supabase grants new public functions to anon by default, and revoking from PUBLIC alone does not undo that.';

select public.dev_lockdown_rpc_surface();

-- The sweep revoked itself from authenticated on its way past; make sure it is
-- reachable by nobody but a future migration running as the owner.
revoke all on function public.dev_lockdown_rpc_surface() from public;
revoke all on function public.dev_lockdown_rpc_surface() from anon;
revoke all on function public.dev_lockdown_rpc_surface() from authenticated;
