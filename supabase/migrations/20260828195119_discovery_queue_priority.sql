alter table public.discovery_query_queue
  add column if not exists priority int not null default 50,
  add column if not exists query_kind text;
create index if not exists discovery_query_queue_priority_idx
  on public.discovery_query_queue(property_id,status,priority desc,language,platform,created_at);
alter view public.cost_events_daily set (security_invoker = true);
alter view public.cost_events_monthly set (security_invoker = true);
alter view public.admin_matching_stats set (security_invoker = true);
