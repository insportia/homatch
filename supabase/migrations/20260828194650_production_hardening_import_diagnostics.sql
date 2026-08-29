alter table public.property_imports
  add column if not exists fallback_chain jsonb,
  add column if not exists extraction_provider text,
  add column if not exists fields_found int4,
  add column if not exists photos_found int4,
  add column if not exists missing_critical text[],
  add column if not exists provider_cost_usd numeric(10,6),
  add column if not exists fetch_strategy text,
  add column if not exists http_status int4,
  add column if not exists response_size int4,
  add column if not exists cloudflare_blocked boolean not null default false,
  add column if not exists source_domain text,
  add column if not exists source_language text,
  add column if not exists source_listing_id text,
  add column if not exists photos_rejected int4 default 0,
  add column if not exists photos_candidates int4 default 0,
  add column if not exists extraction_sources text[],
  add column if not exists missing_fields text[],
  add column if not exists extraction_confidence numeric(4,3) default 0,
  add column if not exists fallback_reason text,
  add column if not exists duration_ms int4,
  add column if not exists ai_used boolean default false,
  add column if not exists ai_tokens_used int4;

alter table public.property_facts
  add column if not exists rooms int,
  add column if not exists source_domain text,
  add column if not exists source_language text,
  add column if not exists source_listing_id text,
  add column if not exists original_title text,
  add column if not exists extraction_confidence numeric(4,3) default 0;

create index if not exists idx_property_imports_provider on public.property_imports(extraction_provider);
create index if not exists idx_property_imports_strategy on public.property_imports(fetch_strategy);
create index if not exists idx_property_imports_domain on public.property_imports(source_domain);
create index if not exists idx_property_imports_language on public.property_imports(source_language);
create index if not exists idx_property_imports_confidence on public.property_imports(extraction_confidence);

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  ip_address text,
  operation text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_limit_user_op on public.rate_limit_events(user_id, operation, created_at);
create index if not exists idx_rate_limit_ip_op on public.rate_limit_events(ip_address, operation, created_at);
create index if not exists idx_rate_limit_created on public.rate_limit_events(created_at);
alter table public.rate_limit_events enable row level security;
do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='rate_limit_events' and policyname='Service manages rate limits') then
   create policy "Service manages rate limits" on public.rate_limit_events for all using (auth.role()='service_role') with check (auth.role()='service_role');
 end if;
end $$;

create table if not exists public.system_health_log (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  db_reachable boolean not null default false,
  storage_reachable boolean not null default false,
  supabase_reachable boolean not null default false,
  provider_statuses jsonb,
  last_match_run_at timestamptz,
  last_match_run_ok boolean,
  last_failed_run_at timestamptz,
  notes text
);
create index if not exists idx_system_health_checked on public.system_health_log(checked_at desc);
alter table public.system_health_log enable row level security;
do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='system_health_log' and policyname='Admins read health log') then
   create policy "Admins read health log" on public.system_health_log for select using (exists(select 1 from public.users where auth_id=auth.uid() and is_admin=true));
 end if;
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='system_health_log' and policyname='Service manages health log') then
   create policy "Service manages health log" on public.system_health_log for all using (auth.role()='service_role') with check (auth.role()='service_role');
 end if;
end $$;

insert into public.admin_settings(key,value,description) values
 ('spend_cap_global','"250"','Global monthly COGS hard ceiling in USD'),
 ('spend_cap_dataforseo','"40"','DataForSEO monthly cap in USD'),
 ('spend_cap_apify','"100"','Apify monthly cap in USD'),
 ('spend_cap_zenrows','"20"','ZenRows monthly cap in USD'),
 ('spend_cap_scrapingbee','"5"','ScrapingBee monthly cap in USD'),
 ('spend_cap_brightdata','"0"','BrightData disabled'),
 ('spend_cap_openai','"15"','OpenAI monthly cap in USD'),
 ('mock_data_providers','"false"','MUST be false in production'),
 ('max_photos_per_property','"5"','Maximum photos per property'),
 ('rate_limit_imports_per_hour','"10"','Max property imports per user per hour'),
 ('rate_limit_matching_per_day','"20"','Max start-matching per user per day'),
 ('rate_limit_unlocks_per_hour','"30"','Max unlock attempts per user per hour'),
 ('max_import_retries','"3"','Maximum provider retry attempts per import'),
 ('circuit_breaker_threshold','"5"','Consecutive failures before circuit-break'),
 ('cache_ttl_hours','"24"','Hours to cache expensive provider results')
on conflict(key) do update set value=excluded.value,description=excluded.description;

create or replace view public.cost_events_daily as
select date_trunc('day',"timestamp") as "day", provider, count(*) as calls, coalesce(sum(cost_usd),0) as total_cost_usd,
 count(*) filter(where success) as successes, count(*) filter(where not success) as failures
from public.cost_events group by 1,2;
create or replace view public.cost_events_monthly as
select date_trunc('month',"timestamp") as "month", provider, count(*) as calls, coalesce(sum(cost_usd),0) as total_cost_usd,
 count(*) filter(where success) as successes, count(*) filter(where not success) as failures
from public.cost_events group by 1,2;
create or replace view public.admin_matching_stats as
select count(*) as total_matches,
 count(*) filter(where signal_strength='EXCEPTIONAL') as exceptional_count,
 count(*) filter(where signal_strength='VERY_STRONG') as very_strong_count,
 count(*) filter(where signal_strength='STRONG') as strong_count,
 count(*) filter(where signal_strength='GOOD') as good_count,
 count(*) filter(where signal_strength='POTENTIAL') as potential_count,
 round(avg(match_score)::numeric,2) as avg_match_score,
 count(*) filter(where mock_mode=false) as real_matches,
 count(*) filter(where mock_mode=true) as demo_matches
from public.matches;
