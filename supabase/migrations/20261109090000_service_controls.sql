-- SERVICE CONTROL CENTER — one owner-controlled on/off pair per paused service.
--
-- Six services can be paused without deleting anything: publishing, ai_call_center,
-- ai_talk, whatsapp, live_chat, design_studio. Each has two independent switches:
--
--   frontend_enabled   the service appears in its customer-facing places
--   backend_enabled    the server may START new work for it (jobs, sessions, sends,
--                      paid provider calls, credit reservations, retries)
--
-- A visible service whose backend is off would promise something that cannot run,
-- so the pair (frontend on, backend off) cannot be stored (CHECK). Enabling goes
-- backend → frontend; disabling may drop both at once.
--
-- These switches sit IN FRONT of every existing per-feature setting (ai_talk_enabled,
-- outreach_calling_enabled, …), which stay untouched: a service runs only when its
-- control row AND its own configuration allow it. Readiness (credentials, schema,
-- workers) is computed by the service-control edge function; a switch never claims
-- a service is ready.
--
-- Writes: only service_control_set / service_control_pause_all (SECURITY DEFINER,
-- is_admin() on the caller), compare-and-set on `version` so a stale browser cannot
-- overwrite a newer change, every attempt audited in admin_audit_log.
-- Reads: customers and anonymous visitors get only (key, frontend, backend) through
-- service_controls_public(); the full rows are service-role only.
--
-- Initial state: all six OFF (owner decision, 2026-10-16). Additive only.

create table public.service_controls (
  service_key text primary key check (service_key in ('publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio')),
  frontend_enabled boolean not null default false,
  backend_enabled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  reason text check (reason is null or length(reason) <= 500),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  constraint service_controls_visible_needs_backend check (not frontend_enabled or backend_enabled)
);
alter table public.service_controls enable row level security;
revoke all on public.service_controls from anon, authenticated;
grant all on public.service_controls to service_role;
-- No policies: browsers never read or write the table. Admins read it through the
-- service-control edge function (is_admin() on their own token); customers read
-- service_controls_public().

insert into public.service_controls (service_key, reason)
values ('publishing', 'Initial state: paused by the owner'),
       ('ai_call_center', 'Initial state: paused by the owner'),
       ('ai_talk', 'Initial state: paused by the owner'),
       ('whatsapp', 'Initial state: paused by the owner'),
       ('live_chat', 'Initial state: paused by the owner'),
       ('design_studio', 'Initial state: paused by the owner')
on conflict (service_key) do nothing;

-- What every visitor may know: which services are visible and which may run.
create function public.service_controls_public()
returns table (service_key text, frontend_enabled boolean, backend_enabled boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.service_key, c.frontend_enabled, c.backend_enabled from public.service_controls c order by c.service_key;
$$;
revoke all on function public.service_controls_public() from public;
grant execute on function public.service_controls_public() to anon, authenticated, service_role;

-- One service's switches, compare-and-set on version. Never raises for a business
-- outcome, so the audit row of a refused attempt is kept:
--   {result: 'CHANGED' | 'UNCHANGED' | 'CONFLICT', control: <row>}
create function public.service_control_set(
  p_key text, p_frontend boolean, p_backend boolean, p_expected_version integer, p_reason text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid;
  v_before public.service_controls;
  v_after public.service_controls;
  v_result text;
begin
  select u.id into v_admin from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v_admin is null then raise exception 'FORBIDDEN'; end if;
  if p_key is null or p_frontend is null or p_backend is null or p_expected_version is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_frontend and not p_backend then raise exception 'FRONTEND_REQUIRES_BACKEND'; end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_request_id is not null and length(p_request_id) > 100 then raise exception 'INVALID_ARGUMENT'; end if;

  select * into v_before from public.service_controls where service_key = p_key for update;
  if not found then raise exception 'SERVICE_UNKNOWN'; end if;

  if v_before.version <> p_expected_version then
    v_result := 'CONFLICT';
    v_after := v_before;
  elsif v_before.frontend_enabled = p_frontend and v_before.backend_enabled = p_backend then
    v_result := 'UNCHANGED';
    v_after := v_before;
  else
    v_result := 'CHANGED';
    update public.service_controls set
      frontend_enabled = p_frontend, backend_enabled = p_backend, version = version + 1,
      reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = v_admin, updated_at = now()
     where service_key = p_key returning * into v_after;
  end if;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'SERVICE_CONTROL_SET', 'service_controls', p_key, jsonb_build_object(
    'result', v_result, 'request_id', p_request_id, 'reason', p_reason,
    'expected_version', p_expected_version,
    'before', jsonb_build_object('frontend', v_before.frontend_enabled, 'backend', v_before.backend_enabled, 'version', v_before.version),
    'after', jsonb_build_object('frontend', v_after.frontend_enabled, 'backend', v_after.backend_enabled, 'version', v_after.version)));

  return jsonb_build_object('result', v_result, 'control', to_jsonb(v_after));
end $$;
revoke all on function public.service_control_set(text, boolean, boolean, integer, text, text) from public, anon;
grant execute on function public.service_control_set(text, boolean, boolean, integer, text, text) to authenticated, service_role;

-- Pause all six at once, in one transaction; one audit row per service that changed.
-- Touches nothing but service_controls.
create function public.service_control_pause_all(p_reason text, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin uuid;
  v_row public.service_controls;
  v_changed text[] := '{}';
begin
  select u.id into v_admin from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v_admin is null then raise exception 'FORBIDDEN'; end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'INVALID_ARGUMENT'; end if;
  if p_request_id is not null and length(p_request_id) > 100 then raise exception 'INVALID_ARGUMENT'; end if;
  for v_row in select * from public.service_controls order by service_key for update loop
    if v_row.frontend_enabled or v_row.backend_enabled then
      update public.service_controls set frontend_enabled = false, backend_enabled = false, version = version + 1,
        reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = v_admin, updated_at = now()
       where service_key = v_row.service_key;
      insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
      values (v_admin, 'SERVICE_CONTROL_PAUSE_ALL', 'service_controls', v_row.service_key, jsonb_build_object(
        'result', 'CHANGED', 'request_id', p_request_id, 'reason', p_reason,
        'before', jsonb_build_object('frontend', v_row.frontend_enabled, 'backend', v_row.backend_enabled, 'version', v_row.version),
        'after', jsonb_build_object('frontend', false, 'backend', false, 'version', v_row.version + 1)));
      v_changed := v_changed || v_row.service_key;
    end if;
  end loop;
  return jsonb_build_object('result', case when cardinality(v_changed) = 0 then 'UNCHANGED' else 'CHANGED' end, 'changed', to_jsonb(v_changed));
end $$;
revoke all on function public.service_control_pause_all(text, text) from public, anon;
grant execute on function public.service_control_pause_all(text, text) to authenticated, service_role;

-- For database-level boundaries (services the browser writes to directly) and for
-- callers that only need the boolean. Unknown key or missing row → false.
create function public.service_backend_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.backend_enabled from public.service_controls c where c.service_key = p_key), false);
$$;
revoke all on function public.service_backend_enabled(text) from public;
grant execute on function public.service_backend_enabled(text) to anon, authenticated, service_role;

-- Refuses NEW rows of a paused service: BEFORE INSERT, argument = service key.
create function public.service_control_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.service_backend_enabled(tg_argv[0]) then
    raise exception 'SERVICE_DISABLED' using hint = tg_argv[0];
  end if;
  return new;
end $$;
revoke all on function public.service_control_guard() from public, anon, authenticated;

-- LIVE CHAT (the community room at /live-chat) is written by the browser straight
-- into live_chat_messages / live_chat_reactions under RLS — no edge function — so
-- its kill switch is here. Named to fire before the existing burst / impersonation
-- guards. Existing messages, reactions, reports, moderation and the native-intent
-- reader are untouched; private messages (/chat) are a different table.
create trigger trg_0_service_control_guard before insert on public.live_chat_messages
  for each row execute function public.service_control_guard('live_chat');
create trigger trg_0_service_control_guard before insert on public.live_chat_reactions
  for each row execute function public.service_control_guard('live_chat');

-- DESIGN STUDIO: a project is created by the browser inserting into ds_projects
-- directly (everything after it runs through the gated edge functions). Paused → no
-- new project. Existing projects, versions, renders, shares and R2 assets are untouched.
create trigger trg_0_service_control_guard before insert on public.ds_projects
  for each row execute function public.service_control_guard('design_studio');
