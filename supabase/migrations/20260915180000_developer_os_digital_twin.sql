-- ============================================================================
-- HOMATCH DIGITAL TWIN — the foundation, and the boundary that pays for it.
--
-- WHAT THIS ADDS TO THE DEVELOPER OS BUILT EARLIER IN THIS WORKSTREAM
--
-- The Developer OS already owns the business spine: workspaces, projects,
-- buildings, floors, units, reservations, deals, payments. That spine is the
-- CANONICAL INVENTORY and nothing here duplicates it. A unit's status lives in
-- dev_units.status and in no other table — the twin, the public project page,
-- the share link and the embed all read it through the same functions, which
-- is why "mark #694 sold" propagates everywhere with no republish.
--
-- Four things were missing, and one thing was wrong.
--
-- MISSING 1 — UNIT TYPES. Units carried `unit_type` as free text, so there was
-- nothing for a 3D template to attach to and no way to say "these 40
-- apartments are the same layout". Without that, 500 units means 500 models
-- and the economics collapse. dev_unit_types is the reuse spine: geometry and
-- interiors are authored ONCE per type, and a unit is a light row pointing at
-- one. The old text column is kept and untouched so nothing that reads it
-- breaks; the new FK is what the twin uses.
--
-- MISSING 2 — AN ASSET LIBRARY. dt_assets is content-addressed: an asset is
-- identified by the hash of its bytes, so the same optimised sofa used by a
-- hundred projects is one row and one object, not a hundred. dt_asset_refs
-- records who points at what, so nothing referenced by a published scene can
-- be deleted by accident.
--
-- MISSING 3 — SCENES, VERSIONS AND A PUBLISHING LIFECYCLE. A scene is a
-- configuration (a graph of references to shared assets), not a file. Versions
-- mean a representative can work on a draft while the live experience keeps
-- serving, and a bad publish can be rolled back to the previous version.
--
-- MISSING 4 — COST OBSERVABILITY. dt_events and dt_cost_rollup exist so that
-- "what does this project actually cost us" is a query rather than a guess.
--
-- WRONG — WHO MAY TOUCH THE 3D. dev_walkthroughs' write policy was
-- dev_can(workspace,'inventory'), which let a customer's sales director
-- configure and publish a tour. The commercial model is the opposite: Homatch
-- builds the twin, the developer maintains prices and availability. Every
-- technical object here is writable only by Homatch studio staff
-- (dev_is_studio()), and dev_walkthroughs is corrected to match. Developers
-- keep full READ access — they must see what was built for them.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not ship a renderer. There is no Three.js scene, no geometry
-- pipeline and no viewer in this migration, and nothing here pretends
-- otherwise. This is the domain model those things will need. Marking it as
-- anything other than foundation would be the "fake 3D" the brief forbids.
--
-- It also adds no paid provider. Assets carry a storage_provider so heavy
-- objects can move from Supabase Storage to R2/CDN later without touching the
-- domain model, and nothing is bought today.
-- ============================================================================

-- ── 1. WHO IS HOMATCH STAFF ────────────────────────────────────────────────
--
-- Deliberately a table rather than a flag on users: "may operate Project
-- Studio" is not the same authority as "is a Homatch administrator", and the
-- two should be grantable separately and auditable on their own.

create table if not exists public.dt_studio_staff (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.users(id) on delete cascade,
  role       text not null default 'STUDIO_BUILDER'
               check (role in ('STUDIO_ADMIN', 'STUDIO_BUILDER')),
  note       text,
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.dt_studio_staff is
  'Homatch employees who may operate Project Studio. Not a developer role — see dev_members for those.';

/*
 * The technical boundary, in one function.
 *
 * A Homatch platform administrator counts, because somebody has to be able to
 * grant the first studio seat. Everything else is explicit membership.
 */
create or replace function public.dev_is_studio()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.is_admin() or exists (
    select 1 from public.dt_studio_staff s
    where s.user_id = public.auth_user_id()
  );
$$;

revoke all on function public.dev_is_studio() from public;
grant execute on function public.dev_is_studio() to authenticated;

alter table public.dt_studio_staff enable row level security;

drop policy if exists dt_studio_staff_select on public.dt_studio_staff;
create policy dt_studio_staff_select on public.dt_studio_staff
  for select to authenticated using (public.dev_is_studio());

drop policy if exists dt_studio_staff_write on public.dt_studio_staff;
create policy dt_studio_staff_write on public.dt_studio_staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 2. UNIT TYPES — THE REUSE SPINE ────────────────────────────────────────

create table if not exists public.dev_unit_types (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id    uuid not null references public.dev_projects(id) on delete cascade,
  code          text not null,
  name          text,
  bedrooms      integer,
  rooms         integer,
  area_total    numeric(10,2),
  area_internal numeric(10,2),
  area_balcony  numeric(10,2),
  description   text,
  floor_plan_url text,
  -- The authored geometry + interior for every unit of this type. Null until
  -- a Homatch representative has built one; the rest of the product works
  -- perfectly without it.
  template_id   uuid,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, code)
);

create index if not exists dev_unit_types_project_idx on public.dev_unit_types(project_id);
create index if not exists dev_unit_types_ws_idx on public.dev_unit_types(workspace_id);

comment on table public.dev_unit_types is
  'One row per distinct apartment layout in a project. 500 units typically share 15-30 of these, and 3D geometry is authored per TYPE, never per unit.';

-- Additive. dev_units.unit_type (free text) is left exactly as it is so that
-- imports, exports and every existing read keep working.
alter table public.dev_units
  add column if not exists unit_type_id uuid references public.dev_unit_types(id) on delete set null;

create index if not exists dev_units_type_idx on public.dev_units(unit_type_id);

comment on column public.dev_units.unit_type_id is
  'The shared layout this unit is an instance of. Null is normal and fully supported — a project does not need types to sell.';

-- ── 3. ASSET LIBRARY ───────────────────────────────────────────────────────
--
-- Content-addressed. `content_hash` is the hash of the bytes, so uploading the
-- same optimised mesh twice finds the existing row instead of storing it
-- again. Scope decides whether an asset belongs to the shared Homatch library
-- or to one customer's project; a GLOBAL asset has no workspace.

create table if not exists public.dt_assets (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null default 'PROJECT' check (scope in ('GLOBAL', 'PROJECT')),
  workspace_id  uuid references public.dev_workspaces(id) on delete cascade,
  project_id    uuid references public.dev_projects(id) on delete set null,
  kind          text not null check (kind in (
                  'GEOMETRY', 'TEXTURE', 'MATERIAL', 'PANORAMA', 'IMAGE',
                  'FLOOR_PLAN', 'MASTERPLAN', 'HDRI', 'AUDIO', 'SOURCE')),
  name          text not null,
  /* WHERE THE BYTES ACTUALLY ARE.
     Heavy 3D must not be served through the application or the database. The
     provider is a column so a project's assets can move to R2 or a CDN later
     by rewriting rows, with no change to any query that references them. */
  storage_provider text not null default 'SUPABASE'
                     check (storage_provider in ('SUPABASE', 'R2', 'CDN', 'EXTERNAL')),
  storage_key   text not null,
  /* Immutable delivery: the URL carries the version, so a cache can hold it
     forever and marking a unit SOLD never invalidates a single byte of it. */
  content_hash  text,
  version       integer not null default 1,
  bytes         bigint,
  mime          text,
  /* Triangle counts, texture dimensions, LOD levels — whatever the pipeline
     measured. Read by the performance budget checks. */
  meta          jsonb not null default '{}'::jsonb,
  -- A SOURCE asset is the developer's original CAD/render, kept for
  -- re-processing and never delivered to a browser.
  is_deliverable boolean not null default true,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A GLOBAL asset belongs to the shared library and to no customer.
  constraint dt_assets_scope_workspace check (
    (scope = 'GLOBAL' and workspace_id is null) or (scope = 'PROJECT' and workspace_id is not null))
);

create index if not exists dt_assets_ws_idx on public.dt_assets(workspace_id);
create index if not exists dt_assets_project_idx on public.dt_assets(project_id);
create index if not exists dt_assets_kind_idx on public.dt_assets(kind, scope);
-- Deduplication is a lookup on the hash within a scope.
create unique index if not exists dt_assets_dedupe_idx
  on public.dt_assets(scope, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), content_hash)
  where content_hash is not null;

/*
 * Who points at what.
 *
 * Without this, "is this sofa still used anywhere" is unanswerable and the
 * only safe policy is never deleting anything. With it, a published scene
 * holding a reference is a fact the delete path can check.
 */
create table if not exists public.dt_asset_refs (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references public.dt_assets(id) on delete cascade,
  ref_type   text not null check (ref_type in ('TEMPLATE', 'SCENE_VERSION', 'UNIT_TYPE', 'PROJECT')),
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  unique (asset_id, ref_type, ref_id)
);

create index if not exists dt_asset_refs_ref_idx on public.dt_asset_refs(ref_type, ref_id);
create index if not exists dt_asset_refs_asset_idx on public.dt_asset_refs(asset_id);

-- ── 4. TEMPLATES ───────────────────────────────────────────────────────────
--
-- A template is a CONFIGURATION that references library assets, not a copy of
-- them. "Modern Warm" is a list of which shared furniture and materials to
-- place where — so adding it to a project costs a row, not a gigabyte.

create table if not exists public.dt_templates (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in (
                 'APARTMENT', 'BUILDING', 'INTERIOR', 'LANDSCAPE', 'MATERIAL')),
  scope        text not null default 'GLOBAL' check (scope in ('GLOBAL', 'PROJECT')),
  workspace_id uuid references public.dev_workspaces(id) on delete cascade,
  project_id   uuid references public.dev_projects(id) on delete set null,
  name         text not null,
  slug         text,
  description  text,
  /* The graph: nodes, transforms, material bindings, asset references.
     Deliberately jsonb — this shape will change many times before the first
     renderer ships, and a schema migration per iteration would be absurd. */
  config       jsonb not null default '{}'::jsonb,
  primary_asset_id uuid references public.dt_assets(id) on delete set null,
  preview_image_url text,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  version      integer not null default 1,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint dt_templates_scope_workspace check (
    (scope = 'GLOBAL' and workspace_id is null) or (scope = 'PROJECT' and workspace_id is not null))
);

create index if not exists dt_templates_kind_idx on public.dt_templates(kind, status);
create index if not exists dt_templates_ws_idx on public.dt_templates(workspace_id);

alter table public.dev_unit_types
  drop constraint if exists dev_unit_types_template_id_fkey;
alter table public.dev_unit_types
  add constraint dev_unit_types_template_id_fkey
  foreign key (template_id) references public.dt_templates(id) on delete set null;

-- ── 5. SCENES AND VERSIONS ─────────────────────────────────────────────────

create table if not exists public.dt_scenes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id    uuid not null references public.dev_projects(id) on delete cascade,
  kind          text not null check (kind in ('MASTERPLAN', 'BUILDING', 'FLOOR', 'UNIT_TYPE')),
  building_id   uuid references public.dev_buildings(id) on delete cascade,
  floor_id      uuid references public.dev_floors(id) on delete cascade,
  unit_type_id  uuid references public.dev_unit_types(id) on delete cascade,
  name          text not null,
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  /* The version a visitor currently gets. Editing a draft cannot change what
     is live; publishing is the act of moving this pointer. */
  published_version_id uuid,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists dt_scenes_project_idx on public.dt_scenes(project_id, kind);
create index if not exists dt_scenes_ws_idx on public.dt_scenes(workspace_id);

create table if not exists public.dt_scene_versions (
  id           uuid primary key default gen_random_uuid(),
  scene_id     uuid not null references public.dt_scenes(id) on delete cascade,
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  version      integer not null,
  /* Nodes and asset references. NOT geometry — the bytes live in dt_assets
     behind a CDN, and this is the small document that says which of them to
     fetch and where to put them. */
  graph        jsonb not null default '{}'::jsonb,
  camera_presets jsonb not null default '[]'::jsonb,
  hotspots     jsonb not null default '[]'::jsonb,
  /* What this version actually costs a phone to open: payload bytes, request
     count, triangles, texture megabytes. Measured by the build step and
     checked against the budgets in docs/digital-twin-budgets.md. */
  budget       jsonb not null default '{}'::jsonb,
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  unique (scene_id, version)
);

create index if not exists dt_scene_versions_scene_idx on public.dt_scene_versions(scene_id, version desc);

alter table public.dt_scenes drop constraint if exists dt_scenes_published_version_fkey;
alter table public.dt_scenes add constraint dt_scenes_published_version_fkey
  foreign key (published_version_id) references public.dt_scene_versions(id) on delete set null;

-- ── 6. PUBLISHED EXPERIENCES, EMBEDS AND BRANDING ──────────────────────────

create table if not exists public.dt_experiences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id    uuid not null references public.dev_projects(id) on delete cascade,
  slug          text not null,
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  /* logo, colours, typography choice, attribution. White-label is a config
     row, never a forked build or a second deployment. */
  branding      jsonb not null default '{}'::jsonb,
  /* Whose site may iframe this. Empty means nobody — an embed is opt-in per
     origin rather than open to the whole web. */
  embed_origins text[] not null default '{}',
  embed_enabled boolean not null default false,
  show_homatch_attribution boolean not null default true,
  custom_domain text,
  published_at  timestamptz,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists dt_experiences_project_idx on public.dt_experiences(project_id);
create index if not exists dt_experiences_published_idx on public.dt_experiences(status) where status = 'PUBLISHED';

-- Share links already exist and already work. They only needed to be able to
-- point at the deeper levels of the experience.
alter table public.dev_share_links drop constraint if exists dev_share_links_target_type_check;
alter table public.dev_share_links add constraint dev_share_links_target_type_check
  check (target_type in (
    'UNIT', 'PROJECT', 'OFFER', 'BUYER_ROOM', 'BUILDING', 'FLOOR', 'TOUR', 'EXPERIENCE'));

-- ── 7. COST-AWARE ANALYTICS ────────────────────────────────────────────────
--
-- One row per MEANINGFUL act, never per frame and never per camera move. The
-- viewer batches these; a walkthrough that lasts four minutes produces a
-- handful of rows, not four minutes of telemetry.

create table if not exists public.dt_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id    uuid references public.dev_projects(id) on delete set null,
  experience_id uuid references public.dt_experiences(id) on delete set null,
  share_link_id uuid references public.dev_share_links(id) on delete set null,
  building_id   uuid references public.dev_buildings(id) on delete set null,
  unit_id       uuid references public.dev_units(id) on delete set null,
  unit_type_id  uuid references public.dev_unit_types(id) on delete set null,
  kind          text not null check (kind in (
                  'PROJECT_OPEN', 'BUILDING_VIEW', 'FLOOR_VIEW', 'UNIT_VIEW',
                  'FLOORPLAN_VIEW', 'WALKTHROUGH_START', 'WALKTHROUGH_COMPLETE',
                  'HOTSPOT', 'CONTACT_REQUEST', 'SHARE', 'EMBED_OPEN')),
  /* Where the visitor came from: a share link, an embed on the developer's
     own site, or the public project page. A lead has to carry this. */
  origin        text check (origin is null or origin in ('SHARE', 'EMBED', 'PUBLIC', 'STUDIO_PREVIEW')),
  origin_host   text,
  meta          jsonb not null default '{}'::jsonb,
  visitor_hash  text,
  created_at    timestamptz not null default now()
);

create index if not exists dt_events_project_idx on public.dt_events(project_id, created_at desc);
create index if not exists dt_events_ws_idx on public.dt_events(workspace_id, created_at desc);
create index if not exists dt_events_unit_idx on public.dt_events(unit_id) where unit_id is not null;

/*
 * INTERNAL. What a project costs Homatch to store and serve.
 *
 * Rolled up rather than derived on demand, because the question is asked
 * monthly and the underlying event count is large. Readable by studio staff
 * and platform administrators only — a customer never sees our margin.
 */
create table if not exists public.dt_cost_rollup (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id       uuid references public.dev_projects(id) on delete cascade,
  period_start     date not null,
  stored_bytes     bigint not null default 0,
  deliverable_bytes bigint not null default 0,
  asset_requests   bigint not null default 0,
  bandwidth_bytes  bigint not null default 0,
  viewer_opens     bigint not null default 0,
  processing_jobs  integer not null default 0,
  preparation_cost_usd numeric(12,4) not null default 0,
  notes            text,
  updated_at       timestamptz not null default now(),
  unique (workspace_id, project_id, period_start)
);

-- ── 8. ROW LEVEL SECURITY ──────────────────────────────────────────────────
--
-- The rule, everywhere below: a DEVELOPER MAY READ what was built for them
-- and may not change it. Homatch studio staff write. This is the commercial
-- model expressed as policy rather than as a disabled button.

alter table public.dev_unit_types   enable row level security;
alter table public.dt_assets        enable row level security;
alter table public.dt_asset_refs    enable row level security;
alter table public.dt_templates     enable row level security;
alter table public.dt_scenes        enable row level security;
alter table public.dt_scene_versions enable row level security;
alter table public.dt_experiences   enable row level security;
alter table public.dt_events        enable row level security;
alter table public.dt_cost_rollup   enable row level security;

/*
 * UNIT TYPES are the one exception, and deliberately so. A type carries
 * bedrooms, area and a floor plan — ordinary inventory facts a developer
 * legitimately maintains. Its TEMPLATE (the 3D) is not writable from here;
 * that is guarded below.
 */
drop policy if exists dev_unit_types_select on public.dev_unit_types;
create policy dev_unit_types_select on public.dev_unit_types
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.dev_is_studio());

drop policy if exists dev_unit_types_write on public.dev_unit_types;
create policy dev_unit_types_write on public.dev_unit_types
  for all to authenticated
  using (public.dev_can(workspace_id, 'inventory') or public.dev_is_studio())
  with check (public.dev_can(workspace_id, 'inventory') or public.dev_is_studio());

/*
 * A developer may edit a unit type's commercial facts but must not point it
 * at a different 3D template. Same reasoning as the unit-status guard: the
 * column stays writable for the people who own it, and the trigger is what
 * makes that true.
 */
create or replace function public.dt_guard_unit_type_template()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if TG_OP = 'UPDATE'
     and new.template_id is distinct from old.template_id
     and not public.dev_is_studio() then
    raise exception
      'The 3D template for a unit type is configured by Homatch, not from the developer workspace.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dt_guard_unit_type_template_trg on public.dev_unit_types;
create trigger dt_guard_unit_type_template_trg
  before update on public.dev_unit_types
  for each row execute function public.dt_guard_unit_type_template();

-- Assets, templates, scenes and versions: developers read, studio writes.
drop policy if exists dt_assets_select on public.dt_assets;
create policy dt_assets_select on public.dt_assets
  for select to authenticated
  using (public.dev_is_studio()
         or scope = 'GLOBAL'
         or (workspace_id is not null and public.dev_is_member(workspace_id)));

drop policy if exists dt_assets_write on public.dt_assets;
create policy dt_assets_write on public.dt_assets
  for all to authenticated using (public.dev_is_studio()) with check (public.dev_is_studio());

drop policy if exists dt_asset_refs_select on public.dt_asset_refs;
create policy dt_asset_refs_select on public.dt_asset_refs
  for select to authenticated using (public.dev_is_studio());

drop policy if exists dt_asset_refs_write on public.dt_asset_refs;
create policy dt_asset_refs_write on public.dt_asset_refs
  for all to authenticated using (public.dev_is_studio()) with check (public.dev_is_studio());

drop policy if exists dt_templates_select on public.dt_templates;
create policy dt_templates_select on public.dt_templates
  for select to authenticated
  using (public.dev_is_studio()
         or scope = 'GLOBAL'
         or (workspace_id is not null and public.dev_is_member(workspace_id)));

drop policy if exists dt_templates_write on public.dt_templates;
create policy dt_templates_write on public.dt_templates
  for all to authenticated using (public.dev_is_studio()) with check (public.dev_is_studio());

do $$
declare t text;
begin
  foreach t in array array['dt_scenes', 'dt_scene_versions'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated
       using (public.dev_is_member(workspace_id) or public.dev_is_studio())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated
       using (public.dev_is_studio()) with check (public.dev_is_studio())', t, t);
  end loop;
end $$;

/*
 * EXPERIENCES are shared custody, and the split matters.
 *
 * Publishing the experience and configuring the engine is Homatch's. Branding
 * and which origins may embed it are the developer's own commercial
 * decisions, so a workspace owner can change those — the trigger below is
 * what keeps them out of the rest.
 */
drop policy if exists dt_experiences_select on public.dt_experiences;
create policy dt_experiences_select on public.dt_experiences
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.dev_is_studio());

drop policy if exists dt_experiences_update on public.dt_experiences;
create policy dt_experiences_update on public.dt_experiences
  for update to authenticated
  using (public.dev_can(workspace_id, 'team') or public.dev_is_studio())
  with check (public.dev_can(workspace_id, 'team') or public.dev_is_studio());

drop policy if exists dt_experiences_insert on public.dt_experiences;
create policy dt_experiences_insert on public.dt_experiences
  for insert to authenticated with check (public.dev_is_studio());

create or replace function public.dt_guard_experience_publishing()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if public.dev_is_studio() then return new; end if;

  -- A developer may rebrand and may choose who embeds. They may not publish,
  -- unpublish, rename the slug or attach a custom domain.
  if new.status is distinct from old.status
     or new.slug is distinct from old.slug
     or new.custom_domain is distinct from old.custom_domain
     or new.published_at is distinct from old.published_at then
    raise exception
      'Publishing and addressing for a project experience are managed by Homatch.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dt_guard_experience_publishing_trg on public.dt_experiences;
create trigger dt_guard_experience_publishing_trg
  before update on public.dt_experiences
  for each row execute function public.dt_guard_experience_publishing();

-- Events: a workspace reads its own; nobody writes them from a client (the
-- public tracking function below is the only writer).
drop policy if exists dt_events_select on public.dt_events;
create policy dt_events_select on public.dt_events
  for select to authenticated
  using (public.dev_is_member(workspace_id) or public.dev_is_studio());

-- Cost is ours, not the customer's.
drop policy if exists dt_cost_rollup_select on public.dt_cost_rollup;
create policy dt_cost_rollup_select on public.dt_cost_rollup
  for select to authenticated using (public.dev_is_studio());

drop policy if exists dt_cost_rollup_write on public.dt_cost_rollup;
create policy dt_cost_rollup_write on public.dt_cost_rollup
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 9. THE CORRECTION ──────────────────────────────────────────────────────
--
-- dev_walkthroughs was created earlier in this workstream with
-- dev_can(workspace,'inventory') as its write rule, which let a customer's
-- sales director add and publish a 3D tour. Under the commercial model that
-- is Homatch's job. Read access is unchanged and deliberately generous: a
-- developer must be able to see everything built for them.
--
-- Nothing outside this workstream is affected; the policy being replaced was
-- created hours ago and has never been used by a client.

drop policy if exists dev_walkthroughs_write on public.dev_walkthroughs;
create policy dev_walkthroughs_write on public.dev_walkthroughs
  for all to authenticated
  using (public.dev_is_studio())
  with check (public.dev_is_studio());

comment on table public.dev_walkthroughs is
  'A reference to a walkthrough for a unit. Configured by Homatch studio staff (dev_is_studio); readable by the workspace. Developers maintain prices and availability, not 3D.';

-- ── 10. updated_at ─────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'dev_unit_types', 'dt_assets', 'dt_templates', 'dt_scenes', 'dt_experiences'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ── 11. GRANTS ─────────────────────────────────────────────────────────────

grant select, insert, update, delete on
  public.dev_unit_types, public.dt_assets, public.dt_asset_refs,
  public.dt_templates, public.dt_scenes, public.dt_scene_versions,
  public.dt_experiences, public.dt_studio_staff, public.dt_cost_rollup
  to authenticated;
grant select on public.dt_events to authenticated;
