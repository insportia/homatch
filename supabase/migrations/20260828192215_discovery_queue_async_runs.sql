alter table public.discovery_query_queue
  add column if not exists external_run_id text,
  add column if not exists dataset_id text,
  add column if not exists provider text,
  add column if not exists actor_id text,
  add column if not exists started_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists discovery_query_queue_async_idx
  on public.discovery_query_queue(status,next_attempt_at,platform,created_at);
