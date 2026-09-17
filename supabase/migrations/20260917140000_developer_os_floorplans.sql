-- THE 2D → 3D PIPELINE'S ONE TABLE.
--
-- A floor plan being turned into geometry passes through three states that
-- must never be collapsed into one another:
--
--   extraction    what the model said. Written once, never edited.
--   corrections   what a person changed, keyed by element id.
--   verified      the document the deterministic generator consumes.
--
-- They are three columns rather than one because the question somebody will
-- ask a year from now is "did the model put that wall there, or did we?" and
-- a single mutable document cannot answer it. The audit is the shape of the
-- table, not a log somebody has to remember to write.
--
-- WHO MAY DO WHAT
--
-- Reading is a workspace member's right: a developer paying for a Digital Twin
-- is entitled to see where their own plan stands and what the model made of
-- it. WRITING IS RESERVED TO dev_is_studio(), the same gate every other dt_*
-- table already uses, because verifying a floor plan is our 3D team's job and
-- an unverified plan that a customer could mark VERIFIED would defeat the
-- whole point of the gate.
--
-- Nothing here is granted to anon. A floor plan is not public; the SCENE
-- generated from it becomes public through dt_scenes, which has its own three
-- gates and is untouched by this file.

create table if not exists public.dt_floorplans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  project_id uuid references public.dev_projects(id) on delete set null,
  /* The layout this plan describes. One plan per TYPE, not per apartment:
     forty apartments of the same layout share one extraction, one
     verification and one shell. See the reuse rule in the studio. */
  unit_type_id uuid references public.dev_unit_types(id) on delete set null,
  /* The drawing itself, in dt_assets, which is where heavy bytes live. */
  asset_id uuid not null references public.dt_assets(id) on delete cascade,

  status text not null default 'EXTRACTING'
    check (status in ('EXTRACTING', 'NEEDS_REVIEW', 'VERIFIED', 'GENERATED', 'FAILED')),

  extraction jsonb,
  corrections jsonb not null default '{}'::jsonb,
  verified jsonb,

  /* The LOWEST element confidence, never the average: a reading with thirty
     certain walls and one doubtful one is a doubtful reading. */
  extraction_confidence numeric(4, 3),
  extraction_error text,

  /* Cost, kept per category so the pipeline's bill can be read apart.
     See dt_pipeline_costs below. */
  model text,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dt_floorplans_workspace_idx
  on public.dt_floorplans (workspace_id, created_at desc);
create index if not exists dt_floorplans_unit_type_idx
  on public.dt_floorplans (unit_type_id) where unit_type_id is not null;

alter table public.dt_floorplans enable row level security;

drop policy if exists dt_floorplans_select on public.dt_floorplans;
create policy dt_floorplans_select on public.dt_floorplans
  for select using (public.dev_is_member(workspace_id) or public.dev_is_studio());

drop policy if exists dt_floorplans_write on public.dt_floorplans;
create policy dt_floorplans_write on public.dt_floorplans
  for all using (public.dev_is_studio()) with check (public.dev_is_studio());

-- ── What the pipeline costs, by category ───────────────────────────────────
--
-- §K: we must know exactly what money the POC spends and on which step. The
-- deterministic geometry generation has NO row here and never will, because
-- it calls nothing — that absence is the point of the architecture, and a
-- table with a category for it would invite somebody to fill it in.

create table if not exists public.dt_pipeline_costs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.dev_workspaces(id) on delete cascade,
  floorplan_id uuid references public.dt_floorplans(id) on delete cascade,
  category text not null check (category in (
    'OPENAI_FLOORPLAN_EXTRACTION',
    'OPENAI_OPTIONAL_STYLE_PREVIEW',
    'OPENAI_OPTIONAL_LAYOUT_ASSIST',
    'ASSET_PROCESSING',
    'STORAGE',
    'CDN_DELIVERY'
  )),
  /* Whole cents. Providers bill in fractions; rounding up once here is
     honest, and a float would make the total drift. */
  cost_cents integer not null default 0,
  /* Whatever the provider reported: tokens, bytes, seconds. */
  units jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists dt_pipeline_costs_workspace_idx
  on public.dt_pipeline_costs (workspace_id, created_at desc);

alter table public.dt_pipeline_costs enable row level security;

drop policy if exists dt_pipeline_costs_select on public.dt_pipeline_costs;
create policy dt_pipeline_costs_select on public.dt_pipeline_costs
  for select using (public.dev_is_studio() or public.is_admin());

drop policy if exists dt_pipeline_costs_write on public.dt_pipeline_costs;
create policy dt_pipeline_costs_write on public.dt_pipeline_costs
  for all using (public.is_admin()) with check (public.is_admin());

-- ── updated_at, the same trigger the rest of the schema uses ───────────────

create or replace function public.dt_floorplans_touch()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.dt_floorplans_touch() from public, anon, authenticated;

drop trigger if exists dt_floorplans_touch_trg on public.dt_floorplans;
create trigger dt_floorplans_touch_trg
  before update on public.dt_floorplans
  for each row execute function public.dt_floorplans_touch();

-- ── Grants ─────────────────────────────────────────────────────────────────
--
-- Supabase grants new tables to anon by default, and `revoke from public` is
-- NOT the same as `revoke from anon`. Both, explicitly, on both tables.

revoke all on table public.dt_floorplans from anon;
revoke all on table public.dt_pipeline_costs from anon;
grant select on table public.dt_floorplans to authenticated;
grant insert, update, delete on table public.dt_floorplans to authenticated;
grant select on table public.dt_pipeline_costs to authenticated;
