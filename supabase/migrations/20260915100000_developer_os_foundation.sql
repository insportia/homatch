-- ============================================================================
-- HOMATCH FOR DEVELOPERS — the tenant, the team, and the inventory it sells.
--
-- WHY NEW TABLES RATHER THAN THE ONES THAT ALREADY CARRY THE WORD "DEVELOPER"
--
-- public.developer_profiles and public.developer_projects already exist, and
-- they are NOT this. They are the PUBLIC REGISTRY: a reputation record about
-- a construction company that Homatch assembles from public evidence —
-- score, score_breakdown, permits, restrictions, public_risk_evidence,
-- is_sponsored — and shows to a BUYER on /developer/:id so they can judge who
-- they are buying from. Nobody at the construction company writes those rows,
-- and they must stay readable by strangers.
--
-- What this migration adds is the opposite object: a PRIVATE WORKSPACE that a
-- developer signs into to run their own sales department. Its contents —
-- which apartment is reserved, at what discount, for which buyer, with how
-- much still unpaid — are the most confidential rows in the product.
--
-- Putting both meanings in one table would mean one RLS policy trying to be
-- "world-readable" and "workspace-private" at once, and the first mistake in
-- it leaks a competitor's price list. So: two tables, one optional link
-- (dev_workspaces.developer_profile_id), and a workspace may claim its public
-- profile without the profile ever depending on a workspace existing.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No second contacts table. A buyer is a public.outreach_contacts row — that
-- is where consent, suppression, phone normalisation and channel opt-outs
-- already live, and a CRM that invents a parallel person is a CRM that will
-- eventually call somebody who asked not to be called. The sales-side facts
-- about that person (stage, assignment, which units they want) hang off it in
-- the next migration.
-- ============================================================================

-- ── 1. THE TENANT ──────────────────────────────────────────────────────────

create table if not exists public.dev_workspaces (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.users(id) on delete restrict,
  name                  text not null,
  slug                  text unique,
  legal_name            text,
  country               text,
  city                  text,
  website               text,
  -- The claim on the public reputation record, when there is one. Nullable
  -- forever: a workspace is useful on day one and the registry row may not
  -- exist yet, or may never be claimed.
  developer_profile_id  uuid references public.developer_profiles(id) on delete set null,
  brand_logo_url        text,
  brand_color           text,
  default_currency      text not null default 'USD',
  status                text not null default 'ACTIVE'
                          check (status in ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  -- Entitlements are resolved from billing, not stored per customer. This is
  -- only for the handful of switches an operator flips per workspace (3D
  -- provider on, document AI on) and is read server-side.
  feature_flags         jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.dev_workspaces is
  'A real-estate developer''s private sales workspace. NOT the public developer_profiles reputation record — see the migration header.';

create index if not exists dev_workspaces_owner_idx on public.dev_workspaces(owner_id);

-- ── 2. THE TEAM ────────────────────────────────────────────────────────────
--
-- Roles are a fixed vocabulary, not free text, because every permission check
-- in this product is a comparison against them and a typo in a role name must
-- fail loudly at write time rather than silently granting nothing at read
-- time.

create table if not exists public.dev_members (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null check (role in (
                  'OWNER', 'ADMIN', 'SALES_DIRECTOR', 'SALES_MANAGER',
                  'SALES_AGENT', 'MARKETING_MANAGER', 'FINANCE', 'LEGAL', 'VIEWER')),
  title         text,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  invited_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists dev_members_user_idx on public.dev_members(user_id) where status = 'ACTIVE';
create index if not exists dev_members_ws_idx on public.dev_members(workspace_id);

-- ── 3. WHO MAY DO WHAT ─────────────────────────────────────────────────────
--
-- Every RLS policy below, and every RPC in the next migration, asks these two
-- functions and nothing else. They are SECURITY DEFINER so that a policy on
-- dev_units can ask "is this person a member" without the asker needing read
-- access to dev_members — which is also what stops the membership table's own
-- policy from recursing into itself.

create or replace function public.dev_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select m.role
  from public.dev_members m
  where m.workspace_id = p_workspace
    and m.user_id = public.auth_user_id()
    and m.status = 'ACTIVE'
  limit 1;
$$;

comment on function public.dev_role(uuid) is
  'The signed-in user''s role in a developer workspace, or null if they are not an active member.';

create or replace function public.dev_is_member(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.dev_role(p_workspace) is not null;
$$;

-- The capability matrix. One place, in SQL, on the server.
--
-- Capabilities, and the honest meaning of each:
--   view       read the workspace at all
--   inventory  create/edit projects, buildings, units, prices
--   crm        work leads (an agent, only their own — enforced per-policy)
--   crm_all    see and reassign every lead in the workspace
--   marketing  campaigns and audiences
--   finance    record and confirm payments, see receivables
--   legal      contracts and legal documents
--   documents  upload and read the document centre
--   team       invite people and change roles
--   publish    make a project or unit publicly visible
--   discount   approve a discount beyond list price
--   sale       move a unit into RESERVED / SOLD through the deal workflow
create or replace function public.dev_can(p_workspace uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case public.dev_role(p_workspace)
    when 'OWNER'             then true
    when 'ADMIN'             then true
    when 'SALES_DIRECTOR'    then p_capability in ('view','inventory','crm','crm_all','marketing','documents','publish','discount','sale')
    when 'SALES_MANAGER'     then p_capability in ('view','crm','crm_all','documents','sale')
    when 'SALES_AGENT'       then p_capability in ('view','crm','documents')
    when 'MARKETING_MANAGER' then p_capability in ('view','marketing','documents')
    when 'FINANCE'           then p_capability in ('view','finance','documents')
    when 'LEGAL'             then p_capability in ('view','legal','documents')
    when 'VIEWER'            then p_capability = 'view'
    else false
  end;
$$;

comment on function public.dev_can(uuid, text) is
  'Server-side capability check for a developer workspace. The only authority on permissions — the UI hides things, this decides them.';

revoke all on function public.dev_role(uuid) from public;
revoke all on function public.dev_is_member(uuid) from public;
revoke all on function public.dev_can(uuid, text) from public;
grant execute on function public.dev_role(uuid) to authenticated;
grant execute on function public.dev_is_member(uuid) to authenticated;
grant execute on function public.dev_can(uuid, text) to authenticated;

-- ── 4. PROJECTS ────────────────────────────────────────────────────────────

create table if not exists public.dev_projects (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.dev_workspaces(id) on delete cascade,
  name                text not null,
  slug                text,
  -- The public registry project this corresponds to, when the workspace has
  -- claimed one. Same reasoning as dev_workspaces.developer_profile_id.
  registry_project_id uuid references public.developer_projects(id) on delete set null,
  country             text,
  city                text,
  district            text,
  address             text,
  latitude            numeric(10,7),
  longitude           numeric(10,7),
  description         text,
  project_type        text,
  construction_status text not null default 'PLANNED'
                        check (construction_status in ('PLANNED','UNDER_CONSTRUCTION','FINISHING','COMPLETED','HANDED_OVER')),
  handover_date       date,
  currency            text not null default 'USD',
  amenities           jsonb not null default '[]'::jsonb,
  legal_info          jsonb not null default '{}'::jsonb,
  cover_image_url     text,
  master_plan_url     text,
  brochure_url        text,
  -- Publication is a deliberate state, never a side effect of filling a form.
  is_published        boolean not null default false,
  published_at        timestamptz,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists dev_projects_ws_idx on public.dev_projects(workspace_id);
create index if not exists dev_projects_published_idx on public.dev_projects(is_published) where is_published;

create table if not exists public.dev_buildings (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id       uuid not null references public.dev_projects(id) on delete cascade,
  name             text not null,
  code             text,
  floors_count     integer,
  -- The render the interactive inventory map is drawn on top of. Units carry
  -- their own polygon in dev_units.hotspot; this is the picture underneath.
  facade_image_url text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists dev_buildings_project_idx on public.dev_buildings(project_id);
create index if not exists dev_buildings_ws_idx on public.dev_buildings(workspace_id);

create table if not exists public.dev_floors (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.dev_workspaces(id) on delete cascade,
  building_id    uuid not null references public.dev_buildings(id) on delete cascade,
  level          integer not null,
  name           text,
  plan_image_url text,
  created_at     timestamptz not null default now(),
  unique (building_id, level)
);

create index if not exists dev_floors_ws_idx on public.dev_floors(workspace_id);

-- ── 5. UNITS ───────────────────────────────────────────────────────────────
--
-- The unit is the object the entire product turns around: it is what is
-- shown, shared, reserved, contracted, paid for and reported on. Its status
-- is therefore never written directly by the client — see the transition RPCs
-- in the sales migration. The column is writable by RLS for the plain
-- editorial states (HIDDEN, back to AVAILABLE) and guarded by a trigger for
-- the ones that mean money.

create table if not exists public.dev_units (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id     uuid not null references public.dev_projects(id) on delete cascade,
  building_id    uuid references public.dev_buildings(id) on delete set null,
  floor_id       uuid references public.dev_floors(id) on delete set null,
  unit_number    text not null,
  floor_level    integer,
  status         text not null default 'AVAILABLE'
                   check (status in ('AVAILABLE','ON_HOLD','RESERVED','NEGOTIATION','CONTRACT_PENDING','SOLD','HIDDEN')),
  unit_type      text,
  bedrooms       integer,
  rooms          integer,
  area_total     numeric(10,2),
  area_internal  numeric(10,2),
  area_balcony   numeric(10,2),
  area_terrace   numeric(10,2),
  orientation    text,
  view_text      text,
  ceiling_height numeric(5,2),
  condition      text,
  parking        integer not null default 0,
  storage        integer not null default 0,
  floor_plan_url text,
  photos         jsonb not null default '[]'::jsonb,
  video_url      text,
  price          numeric(14,2),
  currency       text not null default 'USD',
  -- Derived, never typed. A price per square metre that disagrees with the
  -- price and the area is the single most common error in a sales sheet.
  price_per_sqm  numeric(14,2) generated always as (
                   case when area_total is not null and area_total > 0 and price is not null
                        then round(price / area_total, 2) end
                 ) stored,
  payment_plan_id uuid,
  notes          text,
  -- Polygon on the building facade, as percentages: [{x,y}, ...]. Percentages
  -- rather than pixels so the same mapping survives a re-rendered image at a
  -- different resolution.
  hotspot        jsonb,
  is_published   boolean not null default false,
  published_at   timestamptz,
  sort_order     integer not null default 0,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, unit_number)
);

create index if not exists dev_units_ws_idx on public.dev_units(workspace_id);
create index if not exists dev_units_project_status_idx on public.dev_units(project_id, status);
create index if not exists dev_units_building_idx on public.dev_units(building_id);
create index if not exists dev_units_published_idx on public.dev_units(project_id) where is_published;
-- The inventory table's default sort and the visual building's floor grouping.
create index if not exists dev_units_floor_idx on public.dev_units(building_id, floor_level, sort_order);

-- ── 6. WHAT HAPPENED TO A UNIT, AND WHAT HAPPENED TO ANYTHING ──────────────
--
-- Two tables on purpose. dev_unit_events is the unit's own visible history
-- (price went up, it was reserved, it was released) and is shown to the
-- customer. dev_audit_log is the compliance record for everything else and is
-- never edited or deleted by a customer.

create table if not exists public.dev_unit_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  unit_id      uuid not null references public.dev_units(id) on delete cascade,
  kind         text not null check (kind in (
                 'CREATED','PRICE_CHANGED','STATUS_CHANGED','PUBLISHED','UNPUBLISHED',
                 'RESERVED','RESERVATION_RELEASED','OFFER_SENT','VIEWING','SOLD','NOTE')),
  from_value   text,
  to_value     text,
  note         text,
  meta         jsonb not null default '{}'::jsonb,
  actor_id     uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists dev_unit_events_unit_idx on public.dev_unit_events(unit_id, created_at desc);
create index if not exists dev_unit_events_ws_idx on public.dev_unit_events(workspace_id);

create table if not exists public.dev_audit_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  actor_id     uuid references public.users(id) on delete set null,
  entity_type  text not null,
  entity_id    uuid,
  action       text not null,
  before_state jsonb,
  after_state  jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists dev_audit_ws_idx on public.dev_audit_log(workspace_id, created_at desc);
create index if not exists dev_audit_entity_idx on public.dev_audit_log(entity_type, entity_id);

-- ── 7. THE UNIT STATUS GUARD ───────────────────────────────────────────────
--
-- A unit is not allowed to become RESERVED, CONTRACT_PENDING or SOLD by
-- somebody editing a dropdown, because those three words are the difference
-- between an apartment being for sale and not, and each of them is supposed
-- to be accompanied by a reservation, a deal and an audit row. The RPCs that
-- create those records set this flag for the duration of their own
-- transaction; a plain UPDATE from the client has no way to set it.
--
-- Editorial transitions (hide it, show it again, mark it under negotiation)
-- stay freely writable, because they carry no money.

create or replace function public.dev_units_guard_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_money_states constant text[] := array['RESERVED','CONTRACT_PENDING','SOLD'];
begin
  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if (new.status = any(v_money_states) or old.status = any(v_money_states))
       and coalesce(current_setting('homatch.dev_sales_txn', true), '') <> 'on' then
      raise exception
        'Unit status % -> % must go through the reservation or deal workflow, not a direct update.',
        old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dev_units_guard_status_trg on public.dev_units;
create trigger dev_units_guard_status_trg
  before update on public.dev_units
  for each row execute function public.dev_units_guard_status();

-- The unit's own visible history, written by the database rather than by
-- whichever screen happened to make the change.
create or replace function public.dev_units_record_history()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.dev_unit_events (workspace_id, unit_id, kind, to_value, actor_id)
    values (new.workspace_id, new.id, 'CREATED', new.status, public.auth_user_id());
    return new;
  end if;

  if new.price is distinct from old.price then
    insert into public.dev_unit_events (workspace_id, unit_id, kind, from_value, to_value, actor_id)
    values (new.workspace_id, new.id, 'PRICE_CHANGED', old.price::text, new.price::text, public.auth_user_id());
  end if;

  if new.status is distinct from old.status then
    insert into public.dev_unit_events (workspace_id, unit_id, kind, from_value, to_value, actor_id)
    values (new.workspace_id, new.id, 'STATUS_CHANGED', old.status, new.status, public.auth_user_id());
  end if;

  if new.is_published is distinct from old.is_published then
    insert into public.dev_unit_events (workspace_id, unit_id, kind, to_value, actor_id)
    values (new.workspace_id, new.id,
            case when new.is_published then 'PUBLISHED' else 'UNPUBLISHED' end,
            null, public.auth_user_id());
  end if;

  return new;
end;
$$;

drop trigger if exists dev_units_history_trg on public.dev_units;
create trigger dev_units_history_trg
  after insert or update on public.dev_units
  for each row execute function public.dev_units_record_history();

-- ── 8. updated_at ──────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'dev_workspaces','dev_members','dev_projects','dev_buildings','dev_units'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ── 9. ROW LEVEL SECURITY ──────────────────────────────────────────────────
--
-- Read is membership. Write is capability. Nothing is readable by anon here —
-- the public project and unit pages are served by SECURITY DEFINER functions
-- in the sales migration that return only published fields, because "publish
-- a project" and "let strangers read the table this project lives in" are not
-- the same permission and should never be the same policy.

alter table public.dev_workspaces  enable row level security;
alter table public.dev_members     enable row level security;
alter table public.dev_projects    enable row level security;
alter table public.dev_buildings   enable row level security;
alter table public.dev_floors      enable row level security;
alter table public.dev_units       enable row level security;
alter table public.dev_unit_events enable row level security;
alter table public.dev_audit_log   enable row level security;

-- Workspaces
drop policy if exists dev_workspaces_select on public.dev_workspaces;
create policy dev_workspaces_select on public.dev_workspaces
  for select to authenticated
  using (public.dev_is_member(id) or public.is_admin());

-- Anybody signed in may create a workspace; they become its owner, and the
-- OWNER membership row is created alongside it by the bootstrap RPC.
drop policy if exists dev_workspaces_insert on public.dev_workspaces;
create policy dev_workspaces_insert on public.dev_workspaces
  for insert to authenticated
  with check (owner_id = public.auth_user_id());

drop policy if exists dev_workspaces_update on public.dev_workspaces;
create policy dev_workspaces_update on public.dev_workspaces
  for update to authenticated
  using (public.dev_can(id, 'team'))
  with check (public.dev_can(id, 'team'));

-- Members. A person may always see their own membership row (that is how the
-- app knows which workspaces to offer them); seeing the rest of the team
-- needs membership, and changing it needs 'team'.
drop policy if exists dev_members_select on public.dev_members;
create policy dev_members_select on public.dev_members
  for select to authenticated
  using (user_id = public.auth_user_id() or public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_members_write on public.dev_members;
create policy dev_members_write on public.dev_members
  for all to authenticated
  using (public.dev_can(workspace_id, 'team'))
  with check (public.dev_can(workspace_id, 'team'));

-- Projects / buildings / floors / units: read by any member, write by
-- 'inventory'.
do $$
declare t text;
begin
  foreach t in array array['dev_projects','dev_buildings','dev_floors','dev_units'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (public.dev_is_member(workspace_id) or public.is_admin())', t, t);

    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (public.dev_can(workspace_id, ''inventory''))
       with check (public.dev_can(workspace_id, ''inventory''))', t, t);
  end loop;
end $$;

-- History is readable by members and written by the database. No customer
-- update or delete policy exists at all, which is what makes it history.
drop policy if exists dev_unit_events_select on public.dev_unit_events;
create policy dev_unit_events_select on public.dev_unit_events
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.is_admin());

drop policy if exists dev_unit_events_insert on public.dev_unit_events;
create policy dev_unit_events_insert on public.dev_unit_events
  for insert to authenticated
  with check (public.dev_is_member(workspace_id));

drop policy if exists dev_audit_select on public.dev_audit_log;
create policy dev_audit_select on public.dev_audit_log
  for select to authenticated
  using (public.dev_can(workspace_id, 'team') or public.is_admin());

-- ── 10. CREATING A WORKSPACE ───────────────────────────────────────────────
--
-- A workspace and its first membership row have to appear together: a
-- workspace with no OWNER member is a workspace nobody — including the person
-- who just made it — can read, because dev_is_member() would say no.

create or replace function public.dev_create_workspace(
  p_name text,
  p_country text default null,
  p_city text default null,
  p_currency text default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := public.auth_user_id();
  v_id uuid;
  v_slug text;
begin
  if v_user is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A workspace needs a name.' using errcode = 'check_violation';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'workspace'; end if;
  -- Collisions are expected across tenants; suffix rather than fail.
  if exists (select 1 from public.dev_workspaces w where w.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.dev_workspaces (owner_id, name, slug, country, city, default_currency)
  values (v_user, trim(p_name), v_slug, p_country, p_city, coalesce(p_currency, 'USD'))
  returning id into v_id;

  insert into public.dev_members (workspace_id, user_id, role, status)
  values (v_id, v_user, 'OWNER', 'ACTIVE');

  insert into public.dev_audit_log (workspace_id, actor_id, entity_type, entity_id, action, after_state)
  values (v_id, v_user, 'workspace', v_id, 'CREATED', jsonb_build_object('name', trim(p_name)));

  return v_id;
end;
$$;

revoke all on function public.dev_create_workspace(text, text, text, text) from public;
grant execute on function public.dev_create_workspace(text, text, text, text) to authenticated;

grant select, insert, update, delete on
  public.dev_workspaces, public.dev_members, public.dev_projects,
  public.dev_buildings, public.dev_floors, public.dev_units
  to authenticated;
grant select, insert on public.dev_unit_events to authenticated;
grant select on public.dev_audit_log to authenticated;
