create table if not exists public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('cadastral','property')),
  query text not null,
  status text not null default 'CREATED',
  stage text not null default 'CREATED',
  target_url text,
  verification_url text,
  verification_instructions text,
  evidence jsonb not null default '[]'::jsonb,
  result_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.research_jobs enable row level security;

drop policy if exists research_jobs_select_own on public.research_jobs;
create policy research_jobs_select_own on public.research_jobs for select to authenticated using (auth.uid() = user_id);

drop policy if exists research_jobs_insert_own on public.research_jobs;
create policy research_jobs_insert_own on public.research_jobs for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists research_jobs_update_own on public.research_jobs;
create policy research_jobs_update_own on public.research_jobs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists research_jobs_user_created_idx on public.research_jobs(user_id, created_at desc);
