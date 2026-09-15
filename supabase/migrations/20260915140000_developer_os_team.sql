-- ============================================================================
-- HOMATCH FOR DEVELOPERS — putting somebody on the team.
--
-- FOUND BY TESTING, NOT BY READING
--
-- The foundation migration gave dev_members a write policy gated on the
-- 'team' capability and stopped there, which looked complete and was not. An
-- owner pressing "add my sales agent" would have run
--
--     insert into dev_members (workspace_id, user_id, role)
--     select <workspace>, id, 'SALES_AGENT' from users where email = ...
--
-- and public.users has row level security on it: an owner cannot see anybody
-- else's row. The select matches nothing, the insert adds nothing, Postgres
-- reports success, and the screen says the invitation was sent. Then the
-- agent signs in and the workspace is not there.
--
-- Nothing about that fails loudly. It was only caught by adding a second
-- account to a workspace in a real end-to-end run and finding one member row
-- where there should have been three.
--
-- SO: membership is managed by functions, and the team list is read through a
-- view, for the same reason buyers are — the identity of another human being
-- is not something a policy on a workspace table can be asked about.
--
-- AND: an invitation to somebody who has no Homatch account yet is kept,
-- rather than refused. Waiting until they sign up and then failing to
-- remember who invited them is how a sales director ends up doing it twice.
-- ============================================================================

-- ── 1. READING THE TEAM ────────────────────────────────────────────────────
--
-- Owner rights to reach past users' RLS; dev_is_member() in the WHERE is what
-- restricts it. Exactly the dev_lead_contacts pattern, for the same reason.
-- Only the three fields a team screen actually shows.

create or replace view public.dev_team as
select
  m.id           as member_id,
  m.workspace_id,
  m.user_id,
  m.role,
  m.title,
  m.status,
  m.created_at,
  u.full_name,
  u.email,
  u.avatar_url
from public.dev_members m
join public.users u on u.id = m.user_id
where public.dev_is_member(m.workspace_id);

comment on view public.dev_team is
  'Team roster for workspaces the caller belongs to. Owner rights to reach past users RLS; dev_is_member() restricts it. Never granted to anon.';

revoke all on public.dev_team from public;
grant select on public.dev_team to authenticated;

-- ── 2. INVITATIONS WAITING FOR AN ACCOUNT ──────────────────────────────────

create table if not exists public.dev_member_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  email        text not null,
  role         text not null check (role in (
                 'ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_AGENT',
                 'MARKETING_MANAGER','FINANCE','LEGAL','VIEWER')),
  title        text,
  invited_by   uuid references public.users(id) on delete set null,
  status       text not null default 'PENDING'
                 check (status in ('PENDING','ACCEPTED','REVOKED')),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);

comment on table public.dev_member_invites is
  'An invitation to an email address with no Homatch account yet. Claimed by dev_claim_invites() the first time that address signs in.';

create index if not exists dev_member_invites_email_idx
  on public.dev_member_invites(lower(email)) where status = 'PENDING';

alter table public.dev_member_invites enable row level security;

drop policy if exists dev_member_invites_select on public.dev_member_invites;
create policy dev_member_invites_select on public.dev_member_invites
  for select to authenticated
  using (public.dev_can(workspace_id, 'team') or public.is_admin());

-- No insert/update/delete policy: invitations are only ever written by the
-- functions below, which check the capability and normalise the address.

-- OWNER is deliberately absent from the invitable roles above. A workspace
-- has exactly one owner, it is the account that created it, and handing that
-- away is a different operation from adding a colleague.

-- ── 3. INVITING ────────────────────────────────────────────────────────────

create or replace function public.dev_invite_member(
  p_workspace uuid,
  p_email text,
  p_role text,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target uuid;
begin
  if not public.dev_can(p_workspace, 'team') then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  if v_email = '' or v_email not like '%_@_%.__%' then
    raise exception 'That does not look like an email address.' using errcode = 'check_violation';
  end if;
  if p_role = 'OWNER' then
    raise exception 'A workspace has one owner and it cannot be granted from here.'
      using errcode = 'check_violation';
  end if;
  if p_role not in ('ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_AGENT',
                    'MARKETING_MANAGER','FINANCE','LEGAL','VIEWER') then
    raise exception 'Unknown role %.', p_role using errcode = 'check_violation';
  end if;

  select id into v_target from public.users where lower(email) = v_email limit 1;

  if v_target is not null then
    insert into public.dev_members (workspace_id, user_id, role, title, invited_by, status)
    values (p_workspace, v_target, p_role, p_title, v_user, 'ACTIVE')
    on conflict (workspace_id, user_id) do update
      set role = excluded.role, title = coalesce(excluded.title, public.dev_members.title),
          status = 'ACTIVE';

    insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
    values (p_workspace, v_user, 'member', v_target, 'ADDED',
            jsonb_build_object('role', p_role, 'email', v_email));

    return jsonb_build_object('status', 'ADDED', 'user_id', v_target, 'role', p_role);
  end if;

  insert into public.dev_member_invites (workspace_id, email, role, title, invited_by)
  values (p_workspace, v_email, p_role, p_title, v_user)
  on conflict (workspace_id, email) do update
    set role = excluded.role, title = excluded.title,
        status = 'PENDING', invited_by = excluded.invited_by;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (p_workspace, v_user, 'member_invite', null, 'INVITED',
          jsonb_build_object('role', p_role, 'email', v_email));

  return jsonb_build_object('status', 'INVITED', 'email', v_email, 'role', p_role);
end;
$$;

-- ── 4. CLAIMING ────────────────────────────────────────────────────────────
--
-- Called once after sign-in. Safe to call on every sign-in: with no pending
-- invitation it does nothing, and a second call finds them already ACCEPTED.

create or replace function public.dev_claim_invites()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_email text;
  v_count integer := 0;
  v_inv record;
begin
  if v_user is null then return 0; end if;
  select lower(email) into v_email from public.users where id = v_user;
  if v_email is null then return 0; end if;

  for v_inv in
    select * from public.dev_member_invites
     where lower(email) = v_email and status = 'PENDING'
  loop
    insert into public.dev_members (workspace_id, user_id, role, title, invited_by, status)
    values (v_inv.workspace_id, v_user, v_inv.role, v_inv.title, v_inv.invited_by, 'ACTIVE')
    on conflict (workspace_id, user_id) do update set status = 'ACTIVE';

    update public.dev_member_invites
       set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;

    insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
    values (v_inv.workspace_id, v_user, 'member', v_user, 'INVITE_ACCEPTED',
            jsonb_build_object('role', v_inv.role));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ── 5. CHANGING AND REMOVING ───────────────────────────────────────────────
--
-- The last owner cannot be demoted or removed. A workspace whose every
-- member is a VIEWER is a workspace nobody can ever fix.

create or replace function public.dev_set_member_role(
  p_workspace uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_current text;
begin
  if not public.dev_can(p_workspace, 'team') then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;

  select role into v_current from public.dev_members
   where workspace_id = p_workspace and user_id = p_user_id;
  if v_current is null then
    raise exception 'That person is not on this team.' using errcode = 'no_data_found';
  end if;

  if v_current = 'OWNER' and p_role <> 'OWNER'
     and (select count(*) from public.dev_members
           where workspace_id = p_workspace and role = 'OWNER' and status = 'ACTIVE') <= 1 then
    raise exception 'A workspace needs an owner. Make somebody else the owner first.'
      using errcode = 'check_violation';
  end if;

  update public.dev_members set role = p_role
   where workspace_id = p_workspace and user_id = p_user_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (p_workspace, v_user, 'member', p_user_id, 'ROLE_CHANGED',
          jsonb_build_object('role', v_current), jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.dev_remove_member(p_workspace uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_current text;
begin
  if not public.dev_can(p_workspace, 'team') then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;

  select role into v_current from public.dev_members
   where workspace_id = p_workspace and user_id = p_user_id;
  if v_current is null then return; end if;

  if v_current = 'OWNER' then
    raise exception 'The owner cannot be removed from their own workspace.'
      using errcode = 'check_violation';
  end if;

  -- Their leads do not leave with them. Reassignment is a deliberate act by
  -- whoever is left, and §144 says the history has to survive it, so the rows
  -- stay exactly where they are and simply point at somebody who is no longer
  -- on the team until a human decides otherwise.
  delete from public.dev_members where workspace_id = p_workspace and user_id = p_user_id;

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state)
  values (p_workspace, v_user, 'member', p_user_id, 'REMOVED',
          jsonb_build_object('role', v_current));
end;
$$;

-- ── 6. REASSIGNING WORK ────────────────────────────────────────────────────

create or replace function public.dev_reassign_lead(p_lead_id uuid, p_to_user uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_lead public.dev_leads%rowtype;
begin
  select * into v_lead from public.dev_leads where id = p_lead_id;
  if not found then raise exception 'Lead not found.' using errcode = 'no_data_found'; end if;

  if not public.dev_can(v_lead.workspace_id, 'crm_all') then
    raise exception 'You do not have permission to reassign leads.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dev_members m
                  where m.workspace_id = v_lead.workspace_id and m.user_id = p_to_user
                    and m.status = 'ACTIVE') then
    raise exception 'That person is not on this workspace''s team.' using errcode = 'check_violation';
  end if;

  update public.dev_leads set assigned_to = p_to_user, last_activity_at = now()
   where id = p_lead_id;

  insert into public.dev_activities (
    workspace_id, lead_id, contact_id, kind, provenance, title, meta, actor_id)
  values (v_lead.workspace_id, p_lead_id, v_lead.contact_id, 'ASSIGNMENT', 'HOMATCH',
          'Lead reassigned',
          jsonb_build_object('from', v_lead.assigned_to, 'to', p_to_user), v_user);

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, before_state, after_state)
  values (v_lead.workspace_id, v_user, 'lead', p_lead_id, 'REASSIGNED',
          jsonb_build_object('assigned_to', v_lead.assigned_to),
          jsonb_build_object('assigned_to', p_to_user));
end;
$$;

-- ── 7. GRANTS ──────────────────────────────────────────────────────────────

revoke all on function public.dev_invite_member(uuid, text, text, text) from public;
revoke all on function public.dev_claim_invites() from public;
revoke all on function public.dev_set_member_role(uuid, uuid, text) from public;
revoke all on function public.dev_remove_member(uuid, uuid) from public;
revoke all on function public.dev_reassign_lead(uuid, uuid) from public;

grant execute on function public.dev_invite_member(uuid, text, text, text) to authenticated;
grant execute on function public.dev_claim_invites() to authenticated;
grant execute on function public.dev_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.dev_remove_member(uuid, uuid) to authenticated;
grant execute on function public.dev_reassign_lead(uuid, uuid) to authenticated;
grant select on public.dev_member_invites to authenticated;
