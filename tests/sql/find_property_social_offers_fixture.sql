-- Objects 20261107095700_find_property_social_offers.sql reads or writes, on top of
-- homatch_leads_fixture.sql (users, admin_settings, current_homatch_user_id).
create type public.cost_provider as enum ('DATAFORSEO','APIFY','ZENROWS','SCRAPINGBEE','BRIGHTDATA','OPENAI','OTHER','APIFY_MEMO23');
create type public.signal_platform as enum ('GOOGLE','BING','FACEBOOK','TELEGRAM','INSTAGRAM','VK','FORUM','WEBSITE','OTHER');
create type public.source_type as enum ('FACEBOOK_GROUP','TELEGRAM_GROUP','VK_COMMUNITY','INSTAGRAM_PROFILE','FORUM','WEBSITE','SEARCH_RESULT','SOCIAL_PROFILE');
create table public.source_registry (id uuid primary key default gen_random_uuid(), platform public.signal_platform not null, source_type public.source_type not null,
  name text, url text not null, external_id text, country_code text not null default 'GE', active boolean not null default true,
  lifecycle text not null default 'DISCOVERED', access_state text not null default 'PUBLIC', city text, unique (platform, external_id));
create table public.cost_events (id uuid primary key default gen_random_uuid(), provider public.cost_provider not null, operation_type text, source text,
  request_id text, units numeric, cost_usd numeric, success boolean, pricing_state text, timestamp timestamptz default now());
create table public.discovery_runs (id uuid primary key default gen_random_uuid(), user_id uuid, subscription_id uuid, intent_profile_id uuid,
  status text not null default 'SEARCHING', stage text, billing_grant jsonb, deadline_at timestamptz, completed_at timestamptz, failure_reason text,
  provider_cost_usd numeric, credits_charged numeric, results_found int, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.discovery_query_queue (id uuid primary key default gen_random_uuid(), discovery_run_id uuid, provider text, status text, metadata jsonb default '{}');
create table public.find_buyers_actor_registry (actor_key text primary key, actor_id text not null, enabled boolean not null default true,
  emergency_disabled boolean not null default false, health text not null default 'HEALTHY', pricing_model text not null default 'PRICE_PER_DATASET_ITEM',
  pricing_verified_at timestamptz, price_per_1k_micros bigint, start_fee_micros bigint not null default 0, probe_size int not null default 20,
  max_results int not null default 100, timeout_seconds int not null default 300, concurrency int not null default 2, input_contract jsonb,
  campaign_spend_cap_micros bigint, daily_spend_cap_micros bigint);
create table public.find_buyers_actor_runs (id uuid primary key default gen_random_uuid(), actor_key text, status text, cost_booked_at timestamptz, created_at timestamptz default now(),
  reserved_micros bigint default 0, actual_micros bigint);
insert into public.find_buyers_actor_registry (actor_key, actor_id, pricing_verified_at, price_per_1k_micros, start_fee_micros, probe_size, concurrency) values
  ('FB_GROUP_POSTS', 'memo23~apify-facebook-group-scraper', now(), 1500000, 8000, 20, 500),
  ('TELEGRAM_CHANNEL', 'memo23~telegram-channel-scraper', now(), 250000, 1000, 30, 50),
  ('VK_POSTS_COMMENTS', 'memo23~vk-posts-comments-scraper', null, 3600000, 10000, 20, 2);
insert into public.admin_settings (key, value) values ('discovery_provider_concurrency', '{"APIFY_MEMO23": 500}'), ('provider_disabled_list', '[]');
create or replace function public.paid_discovery_provider_share_bps() returns integer language sql immutable as $$ select 6300 $$;
