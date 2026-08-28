create table if not exists public.discovery_query_queue (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  platform text not null,
  language text not null,
  query text not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  attempts int not null default 0,
  result_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(property_id,platform,language,query)
);
create index if not exists discovery_query_queue_work_idx on public.discovery_query_queue(property_id,status,platform,created_at);
alter table public.discovery_query_queue enable row level security;
