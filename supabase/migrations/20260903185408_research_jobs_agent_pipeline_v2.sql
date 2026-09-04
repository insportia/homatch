alter table public.research_jobs
  add column if not exists response_id text,
  add column if not exists progress jsonb not null default '{}'::jsonb,
  add column if not exists captcha jsonb,
  add column if not exists documents jsonb not null default '[]'::jsonb,
  add column if not exists evidence_bundle jsonb not null default '[]'::jsonb;

create index if not exists research_jobs_status_idx on public.research_jobs(status, updated_at desc);
