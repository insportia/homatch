-- ============================================================================
-- HOMATCH FOR DEVELOPERS — closing the RPC surface.
--
-- WHAT THE LINTER FOUND THAT THE MIGRATIONS DID NOT
--
-- Every function in this workstream ends with
--
--     revoke all on function ... from public;
--     grant execute on function ... to authenticated;
--
-- which reads like a lock and is not one. `PUBLIC` is the pseudo-role meaning
-- "everyone"; `anon` is a real role that Supabase grants EXECUTE to in the
-- public schema by default. Revoking from PUBLIC does not take away a grant
-- held by anon directly, so all thirty of these were reachable, unsigned-in,
-- at /rest/v1/rpc/<name>.
--
-- HOW BAD IT ACTUALLY WAS
--
-- Most of them fail closed on their own: auth_user_id() is null for an
-- anonymous caller, dev_can() returns false, and the function raises 42501
-- before touching a row. That is defence in depth working, not a design.
--
-- Two did not have that protection, because they were written as internal
-- helpers called by other functions and never meant to be entry points:
--
--   dev_contact_list(workspace)   no permission check at all. An anonymous
--                                 caller could name any workspace uuid and
--                                 have it return — and, the first time,
--                                 CREATE — that workspace's contact list.
--   dev_refresh_schedule(deal)    no permission check. Recomputes from
--                                 confirmed payments so it cannot forge a
--                                 total, but nothing outside should be able
--                                 to make the database do work on demand.
--
-- The trigger functions were exposed too. Calling one over REST fails for
-- want of a trigger context, but a function that only ever makes sense
-- inside a trigger should not have a URL.
--
-- THE RULE FROM HERE
--
-- Three functions are public, because the product needs an anonymous visitor
-- to open a shared apartment and a published project. Everything else is
-- revoked from anon explicitly, and the internal helpers are revoked from
-- authenticated as well, so they can only ever be reached the way they are
-- meant to be: from inside another SECURITY DEFINER function.
-- ============================================================================

do $$
declare
  fn record;
  -- The entire public surface of Homatch for Developers. Adding to this list
  -- is a deliberate act; anything not on it is unreachable without a session.
  public_fns constant text[] := array[
    'dev_share_resolve', 'dev_share_track', 'dev_public_project'
  ];
  -- Called only from inside other SECURITY DEFINER functions, which have
  -- already established who the caller is and what they may do.
  internal_fns constant text[] := array[
    'dev_contact_list', 'dev_refresh_schedule', 'dev_new_token',
    'dev_units_guard_status', 'dev_units_record_history'
  ];
begin
  for fn in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'dev\_%'
  loop
    -- Nobody is anonymous here except on the three public entry points.
    --
    -- BOTH revokes are needed and the first attempt at this migration only
    -- did the second. `anon` can hold EXECUTE two ways: granted to the role
    -- itself, or granted to PUBLIC and inherited. Revoking the role grant
    -- while PUBLIC still holds one changes nothing at all —
    -- has_function_privilege('anon', ...) stayed true for the three functions
    -- whose original migration had no `revoke ... from public` line, and they
    -- were still live at /rest/v1/rpc after the "lockdown" ran.
    if not (fn.proname = any(public_fns)) then
      execute format('revoke all on function public.%I(%s) from public',
                     fn.proname, fn.args);
      execute format('revoke all on function public.%I(%s) from anon',
                     fn.proname, fn.args);
      -- Revoking from PUBLIC also takes the signed-in grant away from any
      -- function that was relying on it, so put that back deliberately for
      -- everything that is not an internal helper.
      if not (fn.proname = any(internal_fns)) then
        execute format('grant execute on function public.%I(%s) to authenticated',
                       fn.proname, fn.args);
      end if;
    end if;

    -- Internal helpers lose the signed-in grant too.
    if fn.proname = any(internal_fns) then
      execute format('revoke all on function public.%I(%s) from authenticated',
                     fn.proname, fn.args);
      execute format('revoke all on function public.%I(%s) from anon',
                     fn.proname, fn.args);
    end if;
  end loop;
end $$;

-- Re-assert the three that are supposed to be open, so this migration is the
-- single place the public surface is stated and re-running it is harmless.
grant execute on function public.dev_share_resolve(text) to anon, authenticated;
grant execute on function public.dev_share_track(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.dev_public_project(text, text) to anon, authenticated;

comment on function public.dev_share_resolve(text) is
  'PUBLIC ENTRY POINT. Returns only the publishable fields of one shared unit or project, named column by column. Adding a column to dev_units does not publish it.';
comment on function public.dev_share_track(text, text, jsonb, text) is
  'PUBLIC ENTRY POINT. Records first-party activity on a link the workspace itself created. Unknown event names are dropped silently rather than reported.';
comment on function public.dev_public_project(text, text) is
  'PUBLIC ENTRY POINT. One published project and its published, unsold units.';
comment on function public.dev_contact_list(uuid) is
  'INTERNAL. No permission check of its own — callable only from other SECURITY DEFINER functions that have already authorised the caller.';
comment on function public.dev_refresh_schedule(uuid) is
  'INTERNAL. Recomputes instalment status from confirmed payments. Called by the payment functions, not by clients.';
