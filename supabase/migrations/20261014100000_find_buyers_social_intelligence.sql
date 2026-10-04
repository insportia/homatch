-- FIND BUYERS / FIND TENANTS — memo23 social intelligence (additive).
--
-- One product: an owner's property → public demand signals across social
-- sources and six languages → explainable potential buyers/tenants. It extends
-- the Phase 2 primitives and creates no second queue, wallet or lifecycle:
--
--   lifecycle   matching_jobs (match-campaign → discovery driver → finalize)
--   wallet      usage_reservations via beginExecution(FIND_CLIENTS)
--   queue       discovery_query_queue, new provider APIFY_MEMO23
--   sources     source_registry (platform, external_id)
--   content     raw_signals (platform, external_id)
--   COGS        cost_events (what settlement reads) + an auditable ledger here
--
-- APIFY_MEMO23 is NOT the retired generic APIFY provider: that name stays
-- retired, locked and in provider_disabled_list. memo23 Actors run only
-- through supabase/functions/_shared/findBuyers/memo23Client.ts, only when
-- find_buyers_social_enabled is on, the Actor is enabled, and its price was
-- verified recently. Every switch below defaults OFF.
--
-- Money is integer microdollars (1 USD = 1,000,000). Nothing here is
-- floating-point dollars except the cost_events.cost_usd mirror settlement
-- already reads.

------------------------------------------------------------------------------
-- 0. Enum values for the two networks the platform enums did not know.
--    (Added, never used inside this transaction.)
------------------------------------------------------------------------------
alter type public.signal_platform add value if not exists 'TIKTOK';
alter type public.signal_platform add value if not exists 'LINKEDIN';
alter type public.signal_platform add value if not exists 'REDDIT';
alter type public.signal_platform add value if not exists 'QUORA';
alter type public.signal_platform add value if not exists 'X';
alter type public.signal_platform add value if not exists 'THREADS';
alter type public.signal_platform add value if not exists 'BLUESKY';
alter type public.signal_platform add value if not exists 'YOUTUBE';
alter type public.source_type add value if not exists 'TIKTOK_SOURCE';
alter type public.source_type add value if not exists 'LINKEDIN_GROUP';
alter type public.source_type add value if not exists 'SOCIAL_PROFILE';

------------------------------------------------------------------------------
-- 1. Actor registry — one row per memo23 Actor, admin-editable.
------------------------------------------------------------------------------
create table if not exists public.find_buyers_actor_registry (
  actor_key text primary key,
  actor_id text not null,
  source text not null check (source in ('FACEBOOK','INSTAGRAM','TIKTOK','VK','TELEGRAM','LINKEDIN','REDDIT','QUORA','X','THREADS','BLUESKY','YOUTUBE')),
  purpose text not null check (purpose in (
    'GROUP_SEARCH','GROUP_POSTS','COMMENTS','PROFILE_POSTS','SEARCH','POSTS','POSTS_AND_COMMENTS','CHANNEL_MESSAGES','QUESTIONS_AND_ANSWERS')),
  role text not null default 'PRIMARY' check (role in ('PRIMARY','FALLBACK')),
  enabled boolean not null default false,
  emergency_disabled boolean not null default false,
  execution_mode text not null default 'ASYNC_RUN' check (execution_mode in ('ASYNC_RUN')),
  pricing_model text not null default 'UNKNOWN' check (pricing_model in ('PAY_PER_RESULT','PAY_PER_EVENT','UNKNOWN')),
  price_per_1k_micros bigint check (price_per_1k_micros is null or price_per_1k_micros >= 0),
  start_fee_micros bigint not null default 0 check (start_fee_micros >= 0),
  currency text not null default 'USD',
  pricing_source text,
  pricing_verified_at timestamptz,
  input_contract jsonb not null default '{}'::jsonb,
  input_contract_verified_at timestamptz,
  priority integer not null default 50,
  max_results integer not null default 100 check (max_results between 1 and 5000),
  probe_size integer not null default 20 check (probe_size between 1 and 500),
  deepen_steps integer[] not null default array[30, 50],
  timeout_seconds integer not null default 300 check (timeout_seconds between 30 and 3600),
  retry_cap integer not null default 1 check (retry_cap between 0 and 5),
  concurrency integer not null default 2 check (concurrency between 1 and 20),
  daily_spend_cap_micros bigint not null default 5000000 check (daily_spend_cap_micros >= 0),
  campaign_spend_cap_micros bigint not null default 2000000 check (campaign_spend_cap_micros >= 0),
  fallback_actor_key text references public.find_buyers_actor_registry(actor_key) on delete set null,
  health text not null default 'UNKNOWN' check (health in ('HEALTHY','DEGRADED','FAILED','DISABLED','UNKNOWN')),
  last_error text,
  last_run_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

/* The memo23 Actors, by their public Apify store slug (owner~name). Prices are
   the store listing seen while building (2026-10-04) and are NOT verified:
   pricing_verified_at stays null, so nothing runs until an admin verifies the
   Actor from Apify (/admin/discovery → Find Buyers → Actors → Verify). */
insert into public.find_buyers_actor_registry
  (actor_key, actor_id, source, purpose, role, priority, pricing_model, price_per_1k_micros, pricing_source, probe_size, max_results, notes)
values
  ('FB_GROUP_SEARCH', 'memo23~facebook-search-groups-scraper', 'FACEBOOK', 'GROUP_SEARCH', 'PRIMARY', 80, 'UNKNOWN', null,
   'store listing; not verified', 10, 40, 'Public group discovery by keyword (no login)'),
  ('FB_GROUP_POSTS', 'memo23~apify-facebook-group-scraper', 'FACEBOOK', 'GROUP_POSTS', 'PRIMARY', 80, 'UNKNOWN', null,
   'store listing; not verified', 20, 100, 'Recent posts of public groups'),
  ('FB_COMMENTS', 'memo23~facebook-comments-scraper', 'FACEBOOK', 'COMMENTS', 'PRIMARY', 85, 'PAY_PER_RESULT', 500000,
   'store listing $0.49-0.50/1k; not verified', 20, 100, 'Comments of qualifying public posts only'),
  ('IG_PROFILE_POSTS', 'memo23~apify-instagram-profile-scraper', 'INSTAGRAM', 'PROFILE_POSTS', 'PRIMARY', 60, 'UNKNOWN', null,
   'store listing; not verified', 12, 60, 'Public profile posts/reels (monitoring mode = only new)'),
  ('IG_COMMENTS', 'memo23~apify-instagram-comments-scraper', 'INSTAGRAM', 'COMMENTS', 'PRIMARY', 70, 'PAY_PER_RESULT', 800000,
   'store listing $0.80/1k; not verified', 20, 100, 'Comments of qualifying posts only'),
  ('TIKTOK', 'memo23~tiktok-scraper', 'TIKTOK', 'SEARCH', 'PRIMARY', 60, 'UNKNOWN', null,
   'store listing; not verified', 15, 60, 'search / hashtag / comments modes'),
  ('VK_POSTS_COMMENTS', 'memo23~vk-posts-comments-scraper', 'VK', 'POSTS_AND_COMMENTS', 'PRIMARY', 50, 'UNKNOWN', null,
   'store listing; not verified', 20, 100, 'Wall posts filtered by keyword/date, comments in the same result'),
  ('TELEGRAM_CHANNEL', 'memo23~telegram-channel-scraper', 'TELEGRAM', 'CHANNEL_MESSAGES', 'FALLBACK', 30, 'PAY_PER_RESULT', 250000,
   'store listing from $0.25/1k; not verified', 30, 150, 'Fallback only: native HOMATCH Telegram is primary'),
  ('LINKEDIN_GROUPS', 'memo23~linkedin-search-groups-scraper', 'LINKEDIN', 'GROUP_SEARCH', 'PRIMARY', 30, 'PAY_PER_RESULT', 800000,
   'store listing $0.80/1k; not verified', 10, 30, 'Group discovery only (no comment text)'),
  ('LINKEDIN_POSTS', 'memo23~linkedin-posts-scraper', 'LINKEDIN', 'POSTS', 'PRIMARY', 35, 'UNKNOWN', null,
   'store listing; not verified', 10, 40, 'Public posts by keyword; comment COUNTS only'),
  ('REDDIT', 'memo23~reddit-scraper', 'REDDIT', 'SEARCH', 'PRIMARY', 55, 'PAY_PER_RESULT', 500000,
   'store listing from $0.50/1k; not verified', 20, 100, 'Site-wide keyword search (last month); comments only for qualifying posts'),
  ('QUORA', 'memo23~quora-scraper', 'QUORA', 'QUESTIONS_AND_ANSWERS', 'PRIMARY', 35, 'PAY_PER_RESULT', 2000000,
   'store listing from $2.00/1k; not verified', 10, 40, 'Questions by keyword with their answers'),
  ('BLUESKY', 'memo23~bluesky-scraper', 'BLUESKY', 'SEARCH', 'PRIMARY', 30, 'UNKNOWN', null,
   'store listing; not verified', 15, 60, 'Keyword search filtered by date'),
  ('X_PROFILE', 'memo23~twitter-x-scraper', 'X', 'PROFILE_POSTS', 'PRIMARY', 30, 'UNKNOWN', null,
   'store listing; not verified', 15, 60, 'Known public profiles from the registry (no search)'),
  ('THREADS_PROFILE', 'memo23~threads-scraper', 'THREADS', 'PROFILE_POSTS', 'PRIMARY', 25, 'UNKNOWN', null,
   'store listing; not verified', 15, 60, 'Known public profiles from the registry (no search)'),
  ('YOUTUBE_COMMENTS', 'memo23~youtube-comments-scraper', 'YOUTUBE', 'COMMENTS', 'PRIMARY', 40, 'PAY_PER_RESULT', 400000,
   'store listing $0.40/1k; not verified', 20, 100, 'Comments of known property videos from the registry')
on conflict (actor_key) do nothing;

------------------------------------------------------------------------------
-- 2. Per-campaign economics anchor (one row per matching job that searches
--    social sources). It is the row the budget check locks.
------------------------------------------------------------------------------
create table if not exists public.find_buyers_campaigns (
  matching_job_id uuid primary key references public.matching_jobs(id) on delete cascade,
  campaign_id uuid,
  property_id uuid not null,
  user_id uuid not null,
  transaction text not null check (transaction in ('SALE','RENT')),
  credits_committed integer not null check (credits_committed > 0),
  credits_per_usd numeric not null check (credits_per_usd > 0),
  customer_value_micros bigint not null check (customer_value_micros >= 0),
  provider_budget_micros bigint not null check (provider_budget_micros >= 0),
  languages text[] not null default '{}',
  dna jsonb not null default '{}'::jsonb,
  query_plan jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  stop_reason text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists find_buyers_campaigns_user_idx on public.find_buyers_campaigns (user_id, created_at desc);
create index if not exists find_buyers_campaigns_property_idx on public.find_buyers_campaigns (property_id, created_at desc);

------------------------------------------------------------------------------
-- 3. Actor runs — one row per provider run, reserved before it starts.
------------------------------------------------------------------------------
create table if not exists public.find_buyers_actor_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  matching_job_id uuid not null references public.find_buyers_campaigns(matching_job_id) on delete cascade,
  queue_job_id uuid,
  actor_key text not null references public.find_buyers_actor_registry(actor_key),
  actor_id text not null,
  source text not null,
  operation text not null,
  language text,
  tranche integer not null default 0,
  attempt integer not null default 1,
  retry_of uuid references public.find_buyers_actor_runs(id) on delete set null,
  requested_limit integer not null,
  /* STARTING is written BEFORE the provider call: a run in STARTING may have
     been created at the provider even if its id never came back. */
  status text not null default 'RESERVED' check (status in
    ('RESERVED','STARTING','RUNNING','SUCCEEDED','FAILED','ABORTED','TIMED_OUT','RELEASED')),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  estimated_micros bigint not null default 0 check (estimated_micros >= 0),
  actual_micros bigint check (actual_micros is null or actual_micros >= 0),
  cost_basis text check (cost_basis is null or cost_basis in
    ('PROVIDER_REPORTED','RUN_PRICE_X_BILLED_UNITS','REGISTRY_PRICE_X_BILLED_UNITS','UNKNOWN','NOT_STARTED')),
  provider_run_id text unique,
  dataset_id text,
  results_billed integer,
  items_fetched integer not null default 0,
  useful_results integer not null default 0,
  qualified_leads integer not null default 0,
  strong_leads integer not null default 0,
  /* 30-day rule: items older than 30 days / undated, dropped before persistence. */
  stale_dropped integer not null default 0,
  /* Source/query stats are added once per run, even if processing is replayed. */
  stats_applied_at timestamptz,
  reason jsonb not null default '{}'::jsonb,
  provider_billing jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cost_booked_at timestamptz,
  latency_ms integer
);
create index if not exists find_buyers_actor_runs_job_idx on public.find_buyers_actor_runs (matching_job_id, status);
create index if not exists find_buyers_actor_runs_actor_day_idx on public.find_buyers_actor_runs (actor_key, created_at desc);
create index if not exists find_buyers_actor_runs_open_idx on public.find_buyers_actor_runs (status) where status in ('RESERVED','STARTING','RUNNING');

------------------------------------------------------------------------------
-- 4. Cost ledger — every attributable cent, provider and AI alike.
------------------------------------------------------------------------------
create table if not exists public.find_buyers_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  matching_job_id uuid references public.find_buyers_campaigns(matching_job_id) on delete set null,
  property_id uuid,
  kind text not null check (kind in ('PROVIDER','AI','TRANSLATION','OTHER')),
  provider text not null,
  actor_key text,
  actor_run_id uuid references public.find_buyers_actor_runs(id) on delete set null,
  provider_run_id text,
  operation text not null,
  model text,
  requested_limit integer,
  billed_units integer,
  input_tokens integer,
  output_tokens integer,
  estimated_micros bigint not null default 0 check (estimated_micros >= 0),
  actual_micros bigint check (actual_micros is null or actual_micros >= 0),
  cost_state text not null check (cost_state in ('ACTUAL','ESTIMATED','UNKNOWN','RELEASED')),
  cost_basis text,
  status text not null default 'OK',
  error text,
  retry_of uuid,
  after_settlement boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists find_buyers_cost_ledger_job_idx on public.find_buyers_cost_ledger (matching_job_id, occurred_at);
create index if not exists find_buyers_cost_ledger_time_idx on public.find_buyers_cost_ledger (occurred_at desc);

------------------------------------------------------------------------------
-- 5. Persons, assessments, leads.
------------------------------------------------------------------------------
/* A public identity on one network. Two rows are never merged without a
   shared public identifier (profile URL / numeric id / handle). */
create table if not exists public.find_buyers_persons (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  person_key text not null,
  display_name text,
  profile_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  signal_count integer not null default 0,
  campaigns_seen integer not null default 0,
  unique (network, person_key)
);

/* One piece of content judged against one campaign's property. */
create table if not exists public.find_buyers_assessments (
  id uuid primary key default gen_random_uuid(),
  matching_job_id uuid not null references public.find_buyers_campaigns(matching_job_id) on delete cascade,
  signal_id uuid not null,
  parent_signal_id uuid,
  content_kind text not null check (content_kind in ('POST','COMMENT','MESSAGE','GROUP','PROFILE')),
  similarity integer check (similarity between 0 and 100),
  similarity_components jsonb not null default '{}'::jsonb,
  intent_class text check (intent_class in ('BUYER_HIGH','BUYER_MEDIUM','TENANT_HIGH','TENANT_MEDIUM','QUESTION',
    'AGENT','SELLER','OWNER','SERVICE_PROVIDER','NOISE','UNCERTAIN')),
  intent_score integer check (intent_score between 0 and 100),
  intent_method text,
  comments_decision text,
  explanation text,
  language text,
  created_at timestamptz not null default now(),
  unique (matching_job_id, signal_id)
);

create table if not exists public.find_buyers_leads (
  id uuid primary key default gen_random_uuid(),
  matching_job_id uuid not null references public.find_buyers_campaigns(matching_job_id) on delete cascade,
  campaign_id uuid,
  property_id uuid not null,
  user_id uuid not null,
  person_id uuid not null references public.find_buyers_persons(id),
  /* Public author identity exactly as the source shows it (never invented). */
  author_name text,
  author_profile_url text,
  counterpart text not null check (counterpart in ('BUYER','TENANT')),
  source text not null,
  intent_class text not null,
  overall_score integer not null check (overall_score between 0 and 100),
  strength text not null check (strength in ('STRONG','GOOD','POSSIBLE')),
  similarity integer,
  intent_score integer,
  score_components jsonb not null default '{}'::jsonb,
  explanation text,
  best_signal_id uuid,
  parent_signal_id uuid,
  evidence jsonb not null default '[]'::jsonb,
  signal_count integer not null default 1,
  signal_at timestamptz,
  seen_before boolean not null default false,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matching_job_id, person_id)
);
create index if not exists find_buyers_leads_property_idx on public.find_buyers_leads (property_id, overall_score desc);
create index if not exists find_buyers_leads_user_idx on public.find_buyers_leads (user_id, created_at desc);

------------------------------------------------------------------------------
-- 6. Caches: translations, query plans, query performance.
------------------------------------------------------------------------------
create table if not exists public.find_buyers_translations (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null,
  source_lang text not null,
  target_lang text not null,
  model_version text not null,
  translated_text text not null,
  cost_micros bigint not null default 0,
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  unique (content_hash, source_lang, target_lang, model_version)
);

create table if not exists public.find_buyers_query_cache (
  dna_key text not null,
  plan_version text not null,
  queries jsonb not null,
  model text,
  cost_micros bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (dna_key, plan_version)
);

create table if not exists public.find_buyers_query_stats (
  source text not null,
  language text not null,
  query_hash text not null,
  query text not null,
  market text not null default 'GE',
  runs integer not null default 0,
  spend_micros bigint not null default 0,
  items integer not null default 0,
  qualified integer not null default 0,
  strong integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (source, language, query_hash)
);

------------------------------------------------------------------------------
-- 7. Source registry: reusable intelligence columns (additive).
------------------------------------------------------------------------------
alter table public.source_registry
  add column if not exists description text,
  add column if not exists member_count integer,
  add column if not exists discovered_via text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists posts_observed integer not null default 0,
  add column if not exists fb_spend_micros bigint not null default 0,
  add column if not exists fb_qualified_leads integer not null default 0,
  add column if not exists fb_strong_leads integer not null default 0,
  add column if not exists supported_intents text[];

------------------------------------------------------------------------------
-- 8. Switches (all OFF / conservative) and queue integration.
------------------------------------------------------------------------------
insert into public.admin_settings (key, value) values
  ('find_buyers_social_enabled', 'false'::jsonb),
  ('find_buyers_min_usd', '10'::jsonb),
  ('find_buyers_provider_share_bps', '5000'::jsonb),
  ('find_buyers_pricing_max_age_days', '30'::jsonb),
  ('find_buyers_comment_gate', '{"skipBelow":70,"eligibleFrom":85}'::jsonb),
  ('find_buyers_sampling', '{"probe":20,"steps":[50,100],"minQualifiedPerDollar":2,"maxProbesPerArm":2}'::jsonb),
  ('find_buyers_openai_price_book', '{"model":"gpt-4o-mini","inputPerMTokMicros":150000,"outputPerMTokMicros":600000}'::jsonb)
on conflict (key) do nothing;

update public.admin_settings
   set value = value || '{"APIFY_MEMO23":4}'::jsonb
 where key = 'discovery_provider_concurrency' and not (value ? 'APIFY_MEMO23');

/* The fair claim learns one provider: APIFY_MEMO23. Body otherwise identical
   to 20261009100000 §5. Each claim of an APIFY_MEMO23 job is short (start or
   poll a provider run); waiting happens between claims, never under a lease. */
create or replace function public.claim_discovery_source_jobs_v2(
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 4,
  p_executor text default 'EDGE',
  p_providers text[] default null
)
returns setof public.discovery_query_queue
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed text[] := array['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23'];
  v_caps jsonb := coalesce((select value from public.admin_settings where key = 'discovery_provider_concurrency'), '{}'::jsonb);
  v_executor text := upper(coalesce(p_executor, 'EDGE'));
begin
  if p_providers is not null then
    v_allowed := array(select upper(x) from unnest(p_providers) x where upper(x) = any (v_allowed));
  end if;

  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'CAMPAIGN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.matching_jobs j
   where j.id = q.matching_job_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and j.status::text in ('completed','partially_completed','failed','cancelled','budget_reached');

  update public.discovery_query_queue q
     set status = 'CANCELLED', cancel_reason = 'RUN_ENDED', finished_at = now(),
         lease_expires_at = null, claim_token = null
    from public.discovery_runs r
   where r.id = q.discovery_run_id
     and q.status in ('PROCESSING', 'PENDING', 'RETRY_WAIT', 'PAUSED')
     and (q.status <> 'PROCESSING' or (q.lease_expires_at is not null and q.lease_expires_at < now()))
     and r.status in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED');

  update public.discovery_query_queue q
     set status = case when q.attempts >= p_max_attempts then 'FAILED' else 'RETRY_WAIT' end,
         last_error = 'LEASE_EXPIRED: the worker holding this job stopped before finishing',
         next_attempt_at = now() + make_interval(secs => least(600, 30 * power(2, greatest(q.attempts - 1, 0)))),
         finished_at = case when q.attempts >= p_max_attempts then now() else q.finished_at end,
         lease_expires_at = null, claim_token = null
   where q.status = 'PROCESSING'
     and q.lease_expires_at is not null and q.lease_expires_at < now()
     and upper(coalesce(q.provider, '')) in ('TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL', 'APIFY_MEMO23');

  return query
  with busy as (
    select upper(q.provider) as provider, count(*) as n
      from public.discovery_query_queue q
     where q.status = 'PROCESSING'
     group by 1
  ),
  runnable as (
    select q.id, q.priority, q.created_at, upper(q.provider) as provider,
           coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key
      from public.discovery_query_queue q
      left join public.matching_jobs j on j.id = q.matching_job_id
      left join public.discovery_runs r on r.id = q.discovery_run_id
     where q.status in ('PENDING', 'RETRY_WAIT')
       and coalesce(q.next_attempt_at, now()) <= now()
       and q.executor = v_executor
       and upper(coalesce(q.provider, '')) = any (v_allowed)
       and (j.id is null or j.status::text = 'searching_sources')
       and (r.id is null or r.status = 'SEARCHING')
       and coalesce(
             (select b.n from busy b where b.provider = upper(q.provider)), 0
           ) < coalesce((v_caps ->> upper(q.provider))::int, 1)
  ),
  last_claim as (
    select coalesce(q.matching_job_id, q.discovery_run_id, q.id) as run_key, max(q.claimed_at) as at
      from public.discovery_query_queue q
     where q.claimed_at is not null and q.claimed_at > now() - interval '1 day'
     group by 1
  ),
  ranked as (
    select rn.id,
           row_number() over (partition by rn.run_key order by rn.priority desc, rn.created_at) as per_run,
           lc.at as run_last_claim, rn.priority, rn.created_at
      from runnable rn
      left join last_claim lc on lc.run_key = rn.run_key
  ),
  candidates as (
    select id from ranked
     where per_run = 1
     order by run_last_claim asc nulls first, priority desc, created_at asc
     limit greatest(1, least(p_limit, 25)) * 4
  ),
  picked as (
    select q.id
      from public.discovery_query_queue q
     where q.id in (select id from candidates)
       and q.status in ('PENDING', 'RETRY_WAIT')
     for update of q skip locked
     limit greatest(1, least(p_limit, 25))
  )
  update public.discovery_query_queue q
     set status = 'PROCESSING',
         claimed_at = now(),
         claim_token = gen_random_uuid(),
         started_at = coalesce(q.started_at, now()),
         attempts = coalesce(q.attempts, 0) + 1,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800)))
    from picked
   where q.id = picked.id
  returning q.*;
end;
$function$;

revoke all on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_discovery_source_jobs_v2(integer, integer, integer, text, text[]) to service_role;

/* "Still running at the provider; look again in N seconds." A poll is not a
   failed attempt, so the attempt the claim counted is given back. */
create or replace function public.finish_discovery_source_job_wait(
  p_job_id uuid,
  p_claim_token uuid,
  p_retry_seconds integer default 20,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.discovery_query_queue%rowtype;
begin
  select * into v_job from public.discovery_query_queue where id = p_job_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v_job.status <> 'PROCESSING' or v_job.claim_token is distinct from p_claim_token then
    return 'NOT_HELD';
  end if;
  update public.discovery_query_queue
     set status = 'RETRY_WAIT',
         attempts = greatest(0, coalesce(attempts, 1) - 1),
         next_attempt_at = now() + make_interval(secs => greatest(10, least(coalesce(p_retry_seconds, 20), 600))),
         lease_expires_at = null,
         claim_token = null,
         processed_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
   where id = p_job_id;
  return 'RETRY_WAIT';
end;
$function$;
revoke all on function public.finish_discovery_source_job_wait(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.finish_discovery_source_job_wait(uuid, uuid, integer, jsonb) to service_role;

------------------------------------------------------------------------------
-- 9. Budget: reserve a provider run atomically against every cap.
------------------------------------------------------------------------------
create or replace function public.find_buyers_reserve_actor_run(
  p_matching_job_id uuid,
  p_actor_key text,
  p_idempotency_key text,
  p_queue_job_id uuid,
  p_operation text,
  p_language text,
  p_tranche integer,
  p_requested_limit integer,
  p_reason jsonb default '{}'::jsonb,
  p_retry_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c public.find_buyers_campaigns%rowtype;
  v_a public.find_buyers_actor_registry%rowtype;
  v_existing public.find_buyers_actor_runs%rowtype;
  v_enabled boolean;
  v_max_age integer;
  v_limit integer;
  v_estimate bigint;
  v_committed bigint;
  v_actor_campaign bigint;
  v_actor_day bigint;
  v_running integer;
  v_id uuid;
begin
  /* Locks in one fixed order — campaign, then actor — so concurrent reserves
     for different campaigns serialise on the actor's caps too. */
  select * into v_c from public.find_buyers_campaigns where matching_job_id = p_matching_job_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_CAMPAIGN'); end if;
  perform 1 from public.find_buyers_actor_registry where actor_key = p_actor_key for update;

  /* Replay check AFTER the locks: a concurrent twin waits, then replays. */
  select * into v_existing from public.find_buyers_actor_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.matching_job_id <> p_matching_job_id then
      return jsonb_build_object('ok', false, 'reason', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
    return jsonb_build_object('ok', true, 'replay', true, 'runId', v_existing.id, 'status', v_existing.status,
                              'reservedMicros', v_existing.reserved_micros, 'requestedLimit', v_existing.requested_limit,
                              'actorId', v_existing.actor_id, 'timeoutSeconds', v_a.timeout_seconds,
                              'actorEnabled', v_a.enabled and not v_a.emergency_disabled and v_a.health <> 'DISABLED');
  end if;
  if v_c.finalized_at is not null then return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_FINALIZED'); end if;

  select coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_buyers_social_enabled'), false)
    into v_enabled;
  if not v_enabled then return jsonb_build_object('ok', false, 'reason', 'SOCIAL_DISABLED'); end if;

  select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACTOR'); end if;
  if not v_a.enabled or v_a.emergency_disabled or v_a.health = 'DISABLED' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DISABLED');
  end if;
  select coalesce((select (value #>> '{}')::int from public.admin_settings where key = 'find_buyers_pricing_max_age_days'), 30)
    into v_max_age;
  if v_a.pricing_verified_at is null or v_a.pricing_verified_at < now() - make_interval(days => v_max_age)
     or v_a.pricing_model = 'UNKNOWN' or v_a.price_per_1k_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_VERIFIED');
  end if;

  v_limit := greatest(1, least(coalesce(p_requested_limit, v_a.probe_size), v_a.max_results));
  v_estimate := v_a.start_fee_micros + ceil(v_limit::numeric * v_a.price_per_1k_micros / 1000)::bigint;

  select count(*) into v_running from public.find_buyers_actor_runs
   where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null
     and created_at > now() - interval '2 hours';
  if v_running >= v_a.concurrency then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_BUSY', 'retry', true);
  end if;

  /* Committed = held reservations + booked actuals (+ the reservation of a
     run whose cost is still unknown: never treated as zero). */
  select coalesce(sum(case
           when status in ('RESERVED', 'STARTING', 'RUNNING') then reserved_micros
           when actual_micros is not null then actual_micros
           when status = 'RELEASED' then 0
           else reserved_micros end), 0)
    into v_committed from public.find_buyers_actor_runs where matching_job_id = p_matching_job_id;
  if v_committed + v_estimate > v_c.provider_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_BUDGET', 'committedMicros', v_committed,
                              'estimateMicros', v_estimate, 'budgetMicros', v_c.provider_budget_micros);
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_campaign from public.find_buyers_actor_runs
   where matching_job_id = p_matching_job_id and actor_key = p_actor_key;
  if v_actor_campaign + v_estimate > v_a.campaign_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_CAMPAIGN_CAP');
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_day from public.find_buyers_actor_runs
   where actor_key = p_actor_key and created_at >= date_trunc('day', now());
  if v_actor_day + v_estimate > v_a.daily_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DAILY_CAP');
  end if;

  insert into public.find_buyers_actor_runs (
    idempotency_key, matching_job_id, queue_job_id, actor_key, actor_id, source, operation, language,
    tranche, retry_of, attempt, requested_limit, status, reserved_micros, estimated_micros, reason)
  values (
    p_idempotency_key, p_matching_job_id, p_queue_job_id, v_a.actor_key, v_a.actor_id, v_a.source, p_operation,
    p_language, coalesce(p_tranche, 0), p_retry_of,
    case when p_retry_of is null then 1
         else 1 + coalesce((select attempt from public.find_buyers_actor_runs where id = p_retry_of), 0) end,
    v_limit, 'RESERVED', v_estimate, v_estimate, coalesce(p_reason, '{}'::jsonb))
  returning id into v_id;

  insert into public.find_buyers_cost_ledger (
    idempotency_key, matching_job_id, property_id, kind, provider, actor_key, actor_run_id, operation,
    requested_limit, estimated_micros, cost_state, cost_basis, status, retry_of, metadata)
  values (
    'reserve:' || v_id, p_matching_job_id, v_c.property_id, 'PROVIDER', 'APIFY_MEMO23', v_a.actor_key, v_id,
    p_operation, v_limit, v_estimate, 'ESTIMATED', 'RESERVATION', 'RESERVED', p_retry_of,
    jsonb_build_object('language', p_language, 'tranche', p_tranche, 'queueJobId', p_queue_job_id));

  update public.find_buyers_campaigns set last_activity_at = now() where matching_job_id = p_matching_job_id;
  return jsonb_build_object('ok', true, 'runId', v_id, 'requestedLimit', v_limit, 'reservedMicros', v_estimate,
    'actorId', v_a.actor_id, 'timeoutSeconds', v_a.timeout_seconds,
    'pricePer1kMicros', v_a.price_per_1k_micros, 'pricingModel', v_a.pricing_model,
    'remainingMicros', v_c.provider_budget_micros - v_committed - v_estimate);
end;
$function$;
revoke all on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) to service_role;

/* Book a run's final cost exactly once. A replayed poll/finaliser finds
   cost_booked_at set and books nothing. A run that never started is
   RELEASED (0, NOT_STARTED). A FAILED run that the provider billed is still
   booked: failure does not make spend disappear, and it is never counted as
   a successful result either. */
create or replace function public.find_buyers_book_run_cost(
  p_run_id uuid,
  p_status text,
  p_actual_micros bigint,
  p_cost_basis text,
  p_results_billed integer,
  p_items_fetched integer,
  p_error text default null,
  p_billing jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_run public.find_buyers_actor_runs%rowtype;
  v_c public.find_buyers_campaigns%rowtype;
  v_status text := upper(coalesce(p_status, 'FAILED'));
  v_state text;
  v_amount bigint;
begin
  if v_status not in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED_OUT', 'RELEASED') then
    raise exception 'BAD_STATUS %', v_status;
  end if;
  /* RELEASED (cost 0) only for a run that never reached the provider: still
     RESERVED, no provider run id. Anything that may have started is booked
     with its real or UNKNOWN cost, never silently as zero. */
  if v_status = 'RELEASED' and exists (
    select 1 from public.find_buyers_actor_runs
     where id = p_run_id and (status <> 'RESERVED' or provider_run_id is not null)) then
    return jsonb_build_object('booked', false, 'reason', 'RELEASE_REFUSED_RUN_MAY_HAVE_STARTED');
  end if;
  update public.find_buyers_actor_runs
     set status = v_status,
         actual_micros = case when v_status = 'RELEASED' then 0 else p_actual_micros end,
         cost_basis = case when v_status = 'RELEASED' then 'NOT_STARTED' else coalesce(p_cost_basis, 'UNKNOWN') end,
         results_billed = p_results_billed,
         items_fetched = greatest(coalesce(p_items_fetched, 0), items_fetched),
         error = left(coalesce(p_error, error), 1000),
         provider_billing = coalesce(p_billing, '{}'::jsonb),
         finished_at = coalesce(finished_at, now()),
         latency_ms = coalesce(latency_ms, (extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::int),
         cost_booked_at = now()
   where id = p_run_id and cost_booked_at is null
  returning * into v_run;
  if not found then
    return jsonb_build_object('booked', false, 'reason', 'ALREADY_BOOKED_OR_MISSING');
  end if;

  select * into v_c from public.find_buyers_campaigns where matching_job_id = v_run.matching_job_id;
  v_amount := v_run.actual_micros;
  v_state := case when v_status = 'RELEASED' then 'RELEASED'
                  when v_amount is null then 'UNKNOWN'
                  when v_run.cost_basis = 'PROVIDER_REPORTED' then 'ACTUAL'
                  when v_run.cost_basis in ('RUN_PRICE_X_BILLED_UNITS') then 'ACTUAL'
                  else 'ESTIMATED' end;

  update public.find_buyers_cost_ledger set status = 'SETTLED'
   where idempotency_key = 'reserve:' || v_run.id;

  insert into public.find_buyers_cost_ledger (
    idempotency_key, matching_job_id, property_id, kind, provider, actor_key, actor_run_id, provider_run_id,
    operation, requested_limit, billed_units, estimated_micros, actual_micros, cost_state, cost_basis, status,
    error, retry_of, after_settlement, metadata)
  values (
    'book:' || v_run.id, v_run.matching_job_id, v_c.property_id, 'PROVIDER', 'APIFY_MEMO23', v_run.actor_key, v_run.id,
    v_run.provider_run_id, v_run.operation, v_run.requested_limit, p_results_billed, v_run.estimated_micros,
    v_amount, v_state, v_run.cost_basis, v_status, left(p_error, 500), v_run.retry_of,
    v_c.finalized_at is not null,
    jsonb_build_object('language', v_run.language, 'tranche', v_run.tranche, 'itemsFetched', p_items_fetched))
  on conflict (idempotency_key) do nothing;

  /* The figure settlement reads. An unknown cost is recorded as UNPRICED at
     the reservation amount (never silently 0). After the campaign settled the
     row carries no property, so it cannot leak into the next campaign's COGS. */
  if v_status <> 'RELEASED' then
    insert into public.cost_events (provider, operation_type, source, market, request_id, units, cost_usd, success,
                                    cache_hit, property_id, job_id, pricing_state)
    values ('APIFY_MEMO23', 'FIND_BUYERS_ACTOR_RUN', 'memo23:' || v_run.actor_key, 'GE', v_run.provider_run_id,
            coalesce(p_results_billed, 0), coalesce(v_amount, v_run.reserved_micros)::numeric / 1000000,
            v_status = 'SUCCEEDED', false,
            case when v_c.finalized_at is null then v_c.property_id else null end, v_run.matching_job_id,
            case when v_state = 'ACTUAL' then 'ACTUAL' when v_state = 'ESTIMATED' then 'ESTIMATED' else 'UNPRICED' end);
  end if;

  update public.find_buyers_actor_registry
     set last_run_at = now(),
         last_error = case when v_status = 'SUCCEEDED' then last_error else left(coalesce(p_error, v_status), 500) end
   where actor_key = v_run.actor_key;

  return jsonb_build_object('booked', true, 'status', v_status, 'actualMicros', v_amount, 'costState', v_state);
end;
$function$;
revoke all on function public.find_buyers_book_run_cost(uuid, text, bigint, text, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.find_buyers_book_run_cost(uuid, text, bigint, text, integer, integer, text, jsonb) to service_role;

/* An attributable AI / translation cost, once per idempotency key. Campaign
   AI cost enters cost_events (settlement COGS) while the campaign is open;
   translation is COGS in the ledger only (it is requested after results). */
create or replace function public.find_buyers_record_ai_cost(
  p_idempotency_key text,
  p_matching_job_id uuid,
  p_kind text,
  p_operation text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_micros bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c public.find_buyers_campaigns%rowtype;
  v_inserted integer;
begin
  if p_matching_job_id is not null then
    select * into v_c from public.find_buyers_campaigns where matching_job_id = p_matching_job_id;
  end if;
  insert into public.find_buyers_cost_ledger (
    idempotency_key, matching_job_id, property_id, kind, provider, operation, model, input_tokens, output_tokens,
    estimated_micros, actual_micros, cost_state, cost_basis, after_settlement, metadata)
  values (
    p_idempotency_key, case when v_c.matching_job_id is not null then p_matching_job_id end, v_c.property_id,
    upper(p_kind), 'OPENAI', p_operation, p_model, p_input_tokens, p_output_tokens,
    greatest(0, coalesce(p_micros, 0)), case when p_micros is null then null else greatest(0, p_micros) end,
    case when p_micros is null then 'UNKNOWN' else 'ESTIMATED' end, 'TOKENS_X_PRICE_BOOK',
    v_c.finalized_at is not null, coalesce(p_metadata, '{}'::jsonb))
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 and upper(p_kind) = 'AI' and v_c.matching_job_id is not null and v_c.finalized_at is null then
    insert into public.cost_events (provider, operation_type, source, market, units, cost_usd, success, cache_hit,
                                    property_id, job_id, pricing_state)
    values ('OPENAI', 'FIND_BUYERS_' || upper(p_operation), 'find-buyers', 'GE',
            coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0),
            greatest(0, coalesce(p_micros, 0))::numeric / 1000000, true, false, v_c.property_id, p_matching_job_id,
            case when p_micros is null then 'UNPRICED' else 'ESTIMATED' end);
  end if;
  return v_inserted = 1;
end;
$function$;
revoke all on function public.find_buyers_record_ai_cost(text, uuid, text, text, text, integer, integer, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.find_buyers_record_ai_cost(text, uuid, text, text, text, integer, integer, bigint, jsonb) to service_role;

------------------------------------------------------------------------------
-- 10. RLS: owners read their own campaigns and leads; admins read all;
--     every write goes through the service role.
------------------------------------------------------------------------------
alter table public.find_buyers_actor_registry enable row level security;
alter table public.find_buyers_campaigns enable row level security;
alter table public.find_buyers_actor_runs enable row level security;
alter table public.find_buyers_cost_ledger enable row level security;
alter table public.find_buyers_persons enable row level security;
alter table public.find_buyers_assessments enable row level security;
alter table public.find_buyers_leads enable row level security;
alter table public.find_buyers_translations enable row level security;
alter table public.find_buyers_query_cache enable row level security;
alter table public.find_buyers_query_stats enable row level security;

do $$
declare t text;
begin
  foreach t in array array['find_buyers_actor_registry','find_buyers_actor_runs','find_buyers_cost_ledger',
                           'find_buyers_persons','find_buyers_assessments','find_buyers_translations',
                           'find_buyers_query_cache','find_buyers_query_stats'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;
end $$;

drop policy if exists find_buyers_campaigns_owner_read on public.find_buyers_campaigns;
create policy find_buyers_campaigns_owner_read on public.find_buyers_campaigns
  for select to authenticated using (user_id = public.auth_user_id() or public.is_admin());
drop policy if exists find_buyers_leads_owner_read on public.find_buyers_leads;
create policy find_buyers_leads_owner_read on public.find_buyers_leads
  for select to authenticated using (user_id = public.auth_user_id() or public.is_admin());

/* Supabase's default privileges give anon and authenticated everything on a
   new table; a column grant restricts nothing on top of a table grant. So all
   of it is revoked first, then exactly what each audience reads is granted
   back (precedent: 20260911194022_usage_events_cogs_column_grants.sql). */
revoke all on public.find_buyers_actor_registry, public.find_buyers_campaigns, public.find_buyers_actor_runs,
  public.find_buyers_cost_ledger, public.find_buyers_persons, public.find_buyers_assessments, public.find_buyers_leads,
  public.find_buyers_translations, public.find_buyers_query_cache, public.find_buyers_query_stats from anon, authenticated;
grant all on public.find_buyers_actor_registry, public.find_buyers_campaigns, public.find_buyers_actor_runs,
  public.find_buyers_cost_ledger, public.find_buyers_persons, public.find_buyers_assessments, public.find_buyers_leads,
  public.find_buyers_translations, public.find_buyers_query_cache, public.find_buyers_query_stats to service_role;
/* Owners see stats and leads but never the internal economics columns. */
grant select (matching_job_id, campaign_id, property_id, user_id, transaction, credits_committed, languages,
              stats, stop_reason, finalized_at, created_at, last_activity_at)
  on public.find_buyers_campaigns to authenticated;
grant select on public.find_buyers_leads to authenticated;
grant select on public.find_buyers_actor_registry, public.find_buyers_actor_runs, public.find_buyers_cost_ledger,
  public.find_buyers_persons, public.find_buyers_assessments, public.find_buyers_query_stats to authenticated;

------------------------------------------------------------------------------
-- 11. Admin: the control center read, and the actor/settings writes.
------------------------------------------------------------------------------
create or replace function public.admin_find_buyers_center(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_since timestamptz := case when coalesce(p_days, 0) <= 0 then '-infinity'::timestamptz
                              else now() - make_interval(days => p_days) end;
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  with camp as (
    select c.*,
      coalesce((select sum(coalesce(l.actual_micros, l.estimated_micros)) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'PROVIDER' and l.idempotency_key like 'book:%'), 0) as provider_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'AI'), 0) as ai_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'TRANSLATION'), 0) as translation_micros,
      coalesce((select sum(l.actual_micros) from public.find_buyers_cost_ledger l
                 where l.matching_job_id = c.matching_job_id and l.kind = 'OTHER'), 0) as other_micros,
      coalesce((select sum(r.reserved_micros) from public.find_buyers_actor_runs r
                 where r.matching_job_id = c.matching_job_id and r.status in ('RESERVED','STARTING','RUNNING')), 0) as reserved_micros,
      (select count(*) from public.find_buyers_leads fl where fl.matching_job_id = c.matching_job_id) as leads,
      (select count(*) from public.find_buyers_leads fl where fl.matching_job_id = c.matching_job_id and fl.strength = 'STRONG') as strong,
      (select u.settled_credits from public.usage_reservations u
        where u.id = nullif(j.billing_grant->>'reservationId','')::uuid) as credits_charged,
      j.status::text as job_status
      from public.find_buyers_campaigns c
      join public.matching_jobs j on j.id = c.matching_job_id
     where c.created_at >= v_since
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', p_days,
    'switches', coalesce((select jsonb_object_agg(key, value) from public.admin_settings
                           where key like 'find_buyers_%' and key not like '%token%'), '{}'::jsonb),
    'overview', (select jsonb_build_object(
        'campaigns', count(*),
        'credits_committed', coalesce(sum(credits_committed), 0),
        'customer_value_micros', coalesce(sum(customer_value_micros), 0),
        /* Revenue = what settlement actually charged, never the authorised budget. */
        'revenue_micros', coalesce(sum(floor(coalesce(credits_charged, 0) * 1000000 / credits_per_usd)), 0)::bigint,
        'provider_micros', coalesce(sum(provider_micros), 0),
        'ai_micros', coalesce(sum(ai_micros), 0),
        'translation_micros', coalesce((select sum(actual_micros) from public.find_buyers_cost_ledger
                                         where kind = 'TRANSLATION' and occurred_at >= v_since), 0),
        'other_micros', coalesce(sum(other_micros), 0),
        'qualified_leads', coalesce(sum(leads), 0),
        'strong_leads', coalesce(sum(strong), 0)) from camp),
    'campaigns', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select matching_job_id, campaign_id, property_id, user_id, transaction, credits_committed, credits_per_usd,
               credits_charged, floor(coalesce(credits_charged, 0) * 1000000 / credits_per_usd)::bigint as revenue_micros,
               customer_value_micros, provider_budget_micros, reserved_micros, provider_micros, ai_micros,
               translation_micros, other_micros,
               provider_micros + ai_micros + translation_micros + other_micros as total_cogs_micros,
               languages, stats, leads, strong, job_status, stop_reason, created_at, last_activity_at, finalized_at
          from camp order by created_at desc limit 100) x), '[]'::jsonb),
    'actors', coalesce((select jsonb_agg(a order by a.source, a.priority desc) from (
        select g.actor_key, g.actor_id, g.source, g.purpose, g.role, g.enabled, g.emergency_disabled,
               case when not g.enabled or g.emergency_disabled then 'DISABLED' else g.health end as health,
               g.pricing_model, g.price_per_1k_micros, g.start_fee_micros, g.currency, g.pricing_source,
               g.pricing_verified_at, g.input_contract_verified_at, g.priority, g.max_results, g.probe_size,
               g.deepen_steps, g.timeout_seconds, g.retry_cap, g.concurrency, g.daily_spend_cap_micros,
               g.campaign_spend_cap_micros, g.fallback_actor_key, g.last_error, g.last_run_at,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as runs,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since and r.status = 'SUCCEEDED') as succeeded,
               (select count(*) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since and r.status in ('FAILED','ABORTED','TIMED_OUT')) as failed,
               (select coalesce(sum(r.results_billed), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as results_billed,
               (select coalesce(sum(r.useful_results), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as useful_results,
               (select coalesce(sum(r.qualified_leads), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as qualified_leads,
               (select coalesce(sum(r.strong_leads), 0) from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as strong_leads,
               (select coalesce(sum(coalesce(r.actual_micros, case when r.status in ('RESERVED','STARTING','RUNNING','RELEASED') then 0 else r.reserved_micros end)), 0)
                  from public.find_buyers_actor_runs r where r.actor_key = g.actor_key and r.created_at >= v_since) as spend_micros,
               (select percentile_disc(0.5) within group (order by r.latency_ms) from public.find_buyers_actor_runs r
                 where r.actor_key = g.actor_key and r.created_at >= v_since and r.latency_ms is not null) as latency_p50_ms
          from public.find_buyers_actor_registry g) a), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(s) from (
        select sr.id, sr.platform::text as platform, sr.name, sr.url, sr.city, sr.languages, sr.member_count,
               sr.discovered_via, sr.created_at as first_discovered, sr.last_checked_at, sr.posts_observed,
               sr.fb_spend_micros, sr.fb_qualified_leads, sr.fb_strong_leads, sr.quality_score, sr.access_state, sr.lifecycle,
               case when sr.fb_qualified_leads > 0 then sr.fb_spend_micros / sr.fb_qualified_leads end as cost_per_qualified_micros
          from public.source_registry sr
         where sr.discovered_via like 'memo23:%' or sr.fb_spend_micros > 0 or sr.fb_qualified_leads > 0
         order by sr.fb_qualified_leads desc, sr.last_checked_at desc nulls last limit 200) s), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(lg) from (
        select lang,
               coalesce((select sum(coalesce(r.actual_micros, case when r.status in ('RESERVED','STARTING','RUNNING','RELEASED') then 0 else r.reserved_micros end))
                           from public.find_buyers_actor_runs r
                          where r.language = lang and r.created_at >= v_since), 0) as spend_micros,
               (select count(*) from public.find_buyers_assessments fa where fa.language = lang and fa.created_at >= v_since) as signals,
               (select count(*) from public.find_buyers_leads fl where fl.language = lang and fl.created_at >= v_since) as qualified,
               (select count(*) from public.find_buyers_leads fl where fl.language = lang and fl.created_at >= v_since and fl.strength = 'STRONG') as strong
          from unnest(array['ka','ru','en','ar','he','tr']) as lang) lg), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(l order by l.occurred_at desc) from (
        select l.id, l.occurred_at, l.matching_job_id, l.kind, l.provider, l.actor_key, l.actor_run_id, l.provider_run_id,
               l.operation, l.model, l.requested_limit, l.billed_units, l.estimated_micros, l.actual_micros, l.cost_state,
               l.cost_basis, l.status, l.error, l.retry_of, l.after_settlement, r.source
          from public.find_buyers_cost_ledger l
          left join public.find_buyers_actor_runs r on r.id = l.actor_run_id
         where l.occurred_at >= v_since
         order by l.occurred_at desc limit 300) l), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;
revoke all on function public.admin_find_buyers_center(integer) from public, anon;
grant execute on function public.admin_find_buyers_center(integer) to authenticated;

/* Admin edits of one Actor. Whitelisted fields only; a price change resets
   nothing silently — pricing_verified_at is stamped only when the admin says
   the price was verified (p_patch.pricingVerified = true). */
create or replace function public.admin_find_buyers_actor_update(p_actor_key text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.find_buyers_actor_registry%rowtype;
  v_price_changed boolean := false;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.find_buyers_actor_registry where actor_key = p_actor_key for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  v_price_changed := (p_patch ? 'pricePer1kMicros' and (p_patch->>'pricePer1kMicros')::bigint is distinct from v_row.price_per_1k_micros)
                  or (p_patch ? 'pricingModel' and p_patch->>'pricingModel' is distinct from v_row.pricing_model)
                  or (p_patch ? 'startFeeMicros' and (p_patch->>'startFeeMicros')::bigint is distinct from v_row.start_fee_micros);
  update public.find_buyers_actor_registry set
    enabled = coalesce((p_patch->>'enabled')::boolean, enabled),
    emergency_disabled = coalesce((p_patch->>'emergencyDisabled')::boolean, emergency_disabled),
    priority = coalesce((p_patch->>'priority')::int, priority),
    max_results = coalesce((p_patch->>'maxResults')::int, max_results),
    probe_size = coalesce((p_patch->>'probeSize')::int, probe_size),
    concurrency = coalesce((p_patch->>'concurrency')::int, concurrency),
    timeout_seconds = coalesce((p_patch->>'timeoutSeconds')::int, timeout_seconds),
    retry_cap = coalesce((p_patch->>'retryCap')::int, retry_cap),
    daily_spend_cap_micros = coalesce((p_patch->>'dailySpendCapMicros')::bigint, daily_spend_cap_micros),
    campaign_spend_cap_micros = coalesce((p_patch->>'campaignSpendCapMicros')::bigint, campaign_spend_cap_micros),
    pricing_model = coalesce(p_patch->>'pricingModel', pricing_model),
    price_per_1k_micros = case when p_patch ? 'pricePer1kMicros' then (p_patch->>'pricePer1kMicros')::bigint else price_per_1k_micros end,
    start_fee_micros = coalesce((p_patch->>'startFeeMicros')::bigint, start_fee_micros),
    pricing_source = case when coalesce((p_patch->>'pricingVerified')::boolean, false) then 'admin verified'
                          when v_price_changed then 'admin edited; not verified' else pricing_source end,
    pricing_verified_at = case when coalesce((p_patch->>'pricingVerified')::boolean, false) then now()
                               when v_price_changed then null else pricing_verified_at end,
    health = case when (p_patch->>'emergencyDisabled')::boolean then 'DISABLED'
                  when (p_patch->>'emergencyDisabled')::boolean is false and health = 'DISABLED' then 'UNKNOWN'
                  else health end,
    updated_at = now(),
    updated_by = public.auth_user_id()
  where actor_key = p_actor_key;
  return jsonb_build_object('ok', true, 'pricingReset', v_price_changed and not coalesce((p_patch->>'pricingVerified')::boolean, false));
end;
$function$;
revoke all on function public.admin_find_buyers_actor_update(text, jsonb) from public, anon;
grant execute on function public.admin_find_buyers_actor_update(text, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 12. The customer's read of the product rules: minimum budget in the wallet's
--     own credits. No costs, no provider names.
------------------------------------------------------------------------------
create or replace function public.find_buyers_public_config()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with s as (
    select
      coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = 'find_buyers_min_usd'), 10) as min_usd,
      coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = 'credits_per_usd'), 10) as rate,
      coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = 'campaign_min_credits'), 50) as floor_credits
  )
  select jsonb_build_object(
    'minUsd', min_usd,
    'creditsPerUsd', rate,
    'minCredits', greatest(ceil(min_usd * rate), floor_credits),
    'languages', jsonb_build_array('ka','ru','en','ar','he','tr'))
  from s;
$function$;
revoke all on function public.find_buyers_public_config() from public, anon;
grant execute on function public.find_buyers_public_config() to authenticated;
