-- Extra production shapes the FIND BUYERS migration touches (columns copied
-- from production 2026-10-04), on top of phase2_fixture.sql + the Phase 2 migration.
create type public.signal_platform as enum ('GOOGLE','BING','FACEBOOK','TELEGRAM','INSTAGRAM','VK','FORUM','WEBSITE','OTHER');
create type public.source_type as enum ('FACEBOOK_GROUP','TELEGRAM_GROUP','VK_COMMUNITY','INSTAGRAM_PROFILE','FORUM','WEBSITE','SEARCH_RESULT');
create type public.cost_provider as enum ('DATAFORSEO','APIFY','ZENROWS','SCRAPINGBEE','BRIGHTDATA','OPENAI','OTHER');
create table public.source_registry (id uuid primary key default gen_random_uuid(), platform public.signal_platform not null, source_type public.source_type, external_id text, name text, url text, country_code text not null default 'GE', language text, active boolean not null default true, provider text, city text, languages text[], lifecycle text not null default 'DISCOVERED', access_state text not null default 'PUBLIC', quality_score numeric, created_at timestamptz not null default now(), unique (platform, external_id));
create table public.cost_events (id uuid primary key default gen_random_uuid(), provider public.cost_provider not null, operation_type text, source text, market text, request_id text, units numeric, cost_usd numeric, success boolean, cache_hit boolean, property_id uuid, signal_id uuid, timestamp timestamptz default now(), job_id uuid, discovery_job_id uuid, pricing_state text);
create table public.usage_reservations (id uuid primary key default gen_random_uuid(), settled_credits numeric, status text);
alter table public.discovery_query_queue add column if not exists processed_at timestamptz;

-- Supabase's default privileges: every new table is fully granted to anon,
-- authenticated and service_role. Without this the column-grant check would
-- pass here and fail in production.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
