-- ════════════════════════════════════════════════════════════════════════
-- DISCOVERY ENGINE: one queue for every source, one freshness rule, and a
-- campaign that is billed and finished truthfully.
--
-- Measured in production on 2026-09-29, before this migration:
--
--   * discovery_query_queue held 6,557 APIFY/DATAFORSEO rows in PENDING that
--     nothing could ever run -- both providers are retired, and the only
--     claim function accepted nothing else. A crashed claim had no lease, so a
--     PROCESSING row stayed PROCESSING forever.
--   * a Find Buyers campaign reported "74 real matches". It created none; the
--     74 were every match the property already had, and not one rested on
--     demand published in the last 30 days.
--   * that campaign was funded by a FREE plan allowance. HOMATCH is PAYG-only
--     (docs/claude/BILLING.md); the allowance path is dormant plan machinery
--     that must not be live.
--   * nothing scheduled the collectors or the classifier.
--
-- What this does, in order:
--   1. makes the queue source-agnostic with leases and truthful end states,
--      and moves the dead retired-provider rows to CANCELLED (history kept)
--   2. records WHEN the demand behind every match was published, so the
--      30-day active-demand rule can be applied where matches are shown
--   3. campaign job columns for the asynchronous run
--   4. settings: the canonical freshness policy, the 50-credit campaign
--      minimum, and every new switch -- all OFF
--   5. FIND_CLIENTS becomes PAYG-only with a 50-credit minimum budget
--   6. Telegram in the provider registry, at zero provider cost
--   7. the schedules. Each one's function refuses to do work until its
--      admin switch is on, so creating a schedule starts nothing.
--
-- Append-only. The runner owns the transaction.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. THE QUEUE ─────────────────────────────────────────────────────────

alter table public.discovery_query_queue
  add column if not exists matching_job_id uuid references public.matching_jobs(id) on delete set null,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists cancel_reason text;

create index if not exists discovery_query_queue_matching_job_idx
  on public.discovery_query_queue(matching_job_id) where matching_job_id is not null;
create index if not exists discovery_query_queue_lease_idx
  on public.discovery_query_queue(lease_expires_at) where status = 'PROCESSING';

alter table public.discovery_query_queue drop constraint if exists discovery_query_queue_status_check;
alter table public.discovery_query_queue add constraint discovery_query_queue_status_check
  check (status in ('PENDING','PROCESSING','RETRY_WAIT','DONE','FAILED','CANCELLED','BUDGET_REACHED'));

/*
 * The dead rows. They were created for providers that are retired and will
 * never be called again, so PENDING was a lie about them. CANCELLED keeps
 * every column -- query, language, property, attempts -- and says why.
 */
update public.discovery_query_queue
   set status = 'CANCELLED',
       cancel_reason = 'PROVIDER_RETIRED',
       finished_at = coalesce(finished_at, now()),
       last_error = coalesce(last_error, 'PROVIDER_RETIRED: the provider is retired and is never called')
 where status = 'PENDING'
   and upper(coalesce(provider, '')) in ('APIFY', 'DATAFORSEO');

/*
 * Claim source jobs for the discovery driver.
 *
 * Recovery first, in the same statement's transaction: a PROCESSING job whose
 * lease ran out belonged to a worker that died. It goes back to RETRY_WAIT, or
 * to FAILED once it has used its attempts -- never left PROCESSING.
 *
 * Only providers the driver can execute are claimed. Retired providers are
 * excluded by name here AND refused by the driver, so neither alone is the
 * only thing standing between a PENDING row and a retired API.
 */
create or replace function public.claim_discovery_source_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 4
)
returns setof public.discovery_query_queue
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.discovery_query_queue q
     set status = case when q.attempts >= p_max_attempts then 'FAILED' else 'RETRY_WAIT' end,
         last_error = 'LEASE_EXPIRED: the worker holding this job stopped before finishing',
         next_attempt_at = now() + make_interval(secs => least(600, 30 * power(2, greatest(q.attempts - 1, 0)))),
         finished_at = case when q.attempts >= p_max_attempts then now() else q.finished_at end,
         lease_expires_at = null,
         claim_token = null
   where q.status = 'PROCESSING'
     and q.lease_expires_at is not null
     and q.lease_expires_at < now()
     and upper(coalesce(q.provider, '')) in ('TELEGRAM', 'FORUM', 'TELEGRAM_SOURCES');

  return query
  with picked as (
    select q.id
      from public.discovery_query_queue q
      left join public.matching_jobs j on j.id = q.matching_job_id
     where q.status in ('PENDING', 'RETRY_WAIT')
       and coalesce(q.next_attempt_at, now()) <= now()
       and upper(coalesce(q.provider, '')) in ('TELEGRAM', 'FORUM', 'TELEGRAM_SOURCES')
       and (j.id is null or j.status::text not in ('completed','partially_completed','failed','cancelled','paused'))
     order by q.priority desc, q.created_at asc
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

revoke all on function public.claim_discovery_source_jobs(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_discovery_source_jobs(integer, integer, integer) to service_role;

/* Finish a claimed job. The claim token proves the caller still holds it. */
create or replace function public.finish_discovery_source_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_result_count integer default 0,
  p_cost_usd numeric default 0,
  p_error text default null,
  p_retry_seconds integer default null,
  p_max_attempts integer default 4,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.discovery_query_queue%rowtype;
  v_status text;
begin
  select * into v_job from public.discovery_query_queue where id = p_job_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v_job.status <> 'PROCESSING' or v_job.claim_token is distinct from p_claim_token then
    return 'NOT_HELD';
  end if;

  v_status := case upper(p_outcome)
    when 'DONE' then 'DONE'
    when 'BUDGET_REACHED' then 'BUDGET_REACHED'
    when 'CANCELLED' then 'CANCELLED'
    when 'RETRY' then case when v_job.attempts >= p_max_attempts then 'FAILED' else 'RETRY_WAIT' end
    else 'FAILED'
  end;

  update public.discovery_query_queue
     set status = v_status,
         result_count = greatest(0, coalesce(p_result_count, 0)),
         actual_cost_usd = coalesce(actual_cost_usd, 0) + greatest(0, coalesce(p_cost_usd, 0)),
         last_error = case when v_status in ('DONE') then null else left(coalesce(p_error, last_error), 500) end,
         next_attempt_at = case when v_status = 'RETRY_WAIT'
           then now() + make_interval(secs => greatest(15, least(coalesce(p_retry_seconds, 60), 3600))) else next_attempt_at end,
         finished_at = case when v_status = 'RETRY_WAIT' then null else now() end,
         processed_at = now(),
         lease_expires_at = null,
         claim_token = null,
         cancel_reason = case when v_status in ('CANCELLED', 'BUDGET_REACHED') then coalesce(p_error, v_status) else cancel_reason end,
         metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
   where id = p_job_id;
  return v_status;
end;
$function$;

revoke all on function public.finish_discovery_source_job(uuid, uuid, text, integer, numeric, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.finish_discovery_source_job(uuid, uuid, text, integer, numeric, text, integer, integer, jsonb) to service_role;

-- ── 2. WHEN THE DEMAND WAS PUBLISHED ─────────────────────────────────────

alter table public.matches add column if not exists demand_published_at timestamptz;

update public.matches m
   set demand_published_at = r.published_at
  from public.raw_signals r
 where r.id = m.signal_id
   and m.demand_published_at is null
   and r.published_at is not null;

create index if not exists matches_property_demand_published_idx
  on public.matches(property_id, demand_published_at desc);

-- ── 3. THE ASYNCHRONOUS CAMPAIGN JOB ─────────────────────────────────────

alter type public.matching_job_status add value if not exists 'budget_reached';

alter table public.matching_jobs
  /* The grant the run was funded by, so the driver can settle it later. It is
     the reservation's ids and ceilings -- no secret, nothing a customer did
     not already see. */
  add column if not exists billing_grant jsonb,
  add column if not exists discovery_deadline_at timestamptz,
  /* New matches THIS run created on demand inside the active window. The
     completion message counts these and nothing else. */
  add column if not exists fresh_matches_created integer not null default 0;

create index if not exists matching_jobs_driver_idx
  on public.matching_jobs(status, discovery_deadline_at)
  where discovery_deadline_at is not null;

-- ── 4. SETTINGS (everything new is OFF) ──────────────────────────────────

insert into public.admin_settings (key, value) values
  ('discovery_freshness_policy', jsonb_build_object(
      'activeMaxDays', 30, 'strongestDays', 7, 'veryFreshDays', 14, 'hardMaxDays', 60,
      'sourceMaxDays', '{}'::jsonb, 'customerMayWiden', false, 'customerMaxDays', 45,
      'undatedEligible', false, 'futureSkewHours', 24)),
  ('telegram_discovery_enabled', 'false'::jsonb),
  ('telegram_integration_mode', '"MTPROTO_USER"'::jsonb),
  ('telegram_source_auto_enable', 'true'::jsonb),
  ('telegram_source_min_relevance', '0.2'::jsonb),
  ('discovery_background_refresh_enabled', 'false'::jsonb),
  ('forum_discovery_enabled', 'false'::jsonb),
  ('classifier_schedule_enabled', 'false'::jsonb),
  ('campaign_source_discovery_enabled', 'false'::jsonb),
  ('campaign_min_credits', '50'::jsonb),
  ('campaign_default_credits', '50'::jsonb),
  ('discovery_job_max_attempts', '4'::jsonb),
  ('discovery_job_lease_seconds', '180'::jsonb),
  ('campaign_discovery_minutes', '30'::jsonb),
  ('search_budget_presets_find_clients', '[50, 100, 200, 500]'::jsonb),
  ('search_budget_recommended_find_clients', '50'::jsonb),
  ('discovery_driver_token', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

/*
 * The evidence window (evidence_delivery_window_days) is left as it is: it
 * answers "have we seen this post recently enough to trust it is still up",
 * which is a different question from "was it published recently enough to
 * still be demand". The second is discovery_freshness_policy.
 */

/*
 * Product-scoped presets. The ladder a campaign offers starts at its minimum;
 * every other product keeps the global ladder it has today.
 */
create or replace function public.billing_my_budget_choices(p_product_code text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := public.auth_user_id();
  v_balance numeric := 0;
  v_product record;
  v_presets jsonb;
  v_recommended numeric;
  v_min numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'ANONYMOUS');
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found or not v_product.enabled then
    return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_PRODUCT');
  end if;
  if not v_product.pricing_active then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_INACTIVE');
  end if;

  select coalesce(balance, 0) into v_balance
    from public.credit_accounts where user_id = v_uid;
  v_balance := coalesce(v_balance, 0);

  v_presets := coalesce(
    (select value from public.admin_settings where key = 'search_budget_presets_' || lower(p_product_code)),
    (select value from public.admin_settings where key = 'search_budget_presets'),
    '[10, 20, 30, 40, 50, 100]'::jsonb);
  v_recommended := coalesce(
    (select (value #>> '{}')::numeric from public.admin_settings
      where key = 'search_budget_recommended_' || lower(p_product_code)),
    public.billing_setting_num('search_budget_recommended', 0));
  v_min := coalesce(v_product.min_viable_budget_credits, 0);

  return jsonb_build_object(
    'ok', true,
    'product_code', p_product_code,
    'balance', v_balance,
    'min_viable', v_min,
    'allow_custom', public.billing_setting_bool('search_budget_allow_custom', true),
    'recommended', v_recommended,
    'presets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'credits', c,
        'affordable', c <= v_balance,
        'viable', c >= v_min,
        'recommended', c = v_recommended
      ) order by c), '[]'::jsonb)
      from jsonb_array_elements_text(v_presets) as e(v)
      cross join lateral (select (e.v)::numeric as c) as x
    ));
end;
$function$;

revoke all on function public.billing_my_budget_choices(text) from public, anon;
grant execute on function public.billing_my_budget_choices(text) to authenticated;

-- ── 5. FIND_CLIENTS IS PAY-AS-YOU-GO, 50 CREDITS MINIMUM ────────────────

update public.billable_products
   set min_viable_budget_credits = 50, updated_at = now()
 where code = 'FIND_CLIENTS';

/* No plan includes a free campaign. The rows stay (history, and the dormant
   machinery reads them); they simply include nothing. */
update public.product_plan_entitlements
   set included_per_period = 0
 where product_code = 'FIND_CLIENTS'
   and included_per_period <> 0;

-- ── 6. TELEGRAM IN THE PROVIDER REGISTRY ─────────────────────────────────

insert into public.finance_provider_registry
 (provider_id, provider_name, category, billing_unit, currency,
  supports_live_metering, supports_usage_import, supports_manual_invoice,
  supports_effective_dated_pricing, supports_provider_reported_cost,
  active, credentials_present, icon_key, sort_order,
  service_access, usage_access, billing_access, invoice_access, access_status,
  credential_sufficient, default_cost_source, sync_mode, counts_as_cogs, homatch_use, notes)
values
 ('TELEGRAM', 'Telegram', 'RESEARCH_SEARCH', 'REQUESTS', 'USD',
  false, false, false, false, false,
  true, false, 'send', 250,
  'NONE', 'NONE', 'NONE', 'NONE', 'NOT_CONFIGURED',
  false, 'CALCULATED', 'NONE', false,
  'Public Telegram channels and groups read through the official worker (MTProto user session).',
  'The Telegram API charges nothing per request: provider cost is 0. Classification of what it reads is metered separately under OPENAI. Credentials live only in the Railway worker.')
on conflict (provider_id) do nothing;

-- ── 7. SCHEDULES ─────────────────────────────────────────────────────────
--
-- Every function below checks its own admin switch before doing anything, so
-- these schedules are inert until an operator turns the matching switch on.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'homatch-discovery-driver') then
    perform cron.unschedule('homatch-discovery-driver');
  end if;
  perform cron.schedule(
    'homatch-discovery-driver',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/discovery-queue-worker',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'discovery_driver_token')),
      body := '{"mode":"drive","source":"cron"}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'homatch-telegram-sync') then
    perform cron.unschedule('homatch-telegram-sync');
  end if;
  perform cron.schedule(
    'homatch-telegram-sync',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/community-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'community_sync_token')),
      body := '{"action":"sync","source":"cron","maxTargets":5}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'homatch-forum-discovery') then
    perform cron.unschedule('homatch-forum-discovery');
  end if;
  perform cron.schedule(
    'homatch-forum-discovery',
    '17 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/demand-discovery',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'demand_discovery_token')),
      body := '{"source":"cron","maxThreads":3}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );

  if exists (select 1 from cron.job where jobname = 'homatch-classify-signals') then
    perform cron.unschedule('homatch-classify-signals');
  end if;
  perform cron.schedule(
    'homatch-classify-signals',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/classify-signals-v2',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'classify_signals_token')),
      body := '{"source":"cron","batchSize":100}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
end $$;

-- ── 8. THE ADMIN DISCOVERY CONTROL CENTER'S ONE READ ─────────────────────
--
-- Everything the control center shows, in one admin-only call. It returns
-- counts, states and ids -- never message text, never a token (the *_token
-- settings are excluded by name), never a Telegram credential (those live only
-- in the Railway worker and are not in this database at all).

create or replace function public.admin_discovery_overview()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'settings', (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        from public.admin_settings
       where key in (
         'discovery_freshness_policy', 'telegram_discovery_enabled', 'telegram_integration_mode',
         'telegram_source_auto_enable', 'telegram_source_min_relevance',
         'discovery_background_refresh_enabled', 'forum_discovery_enabled', 'classifier_schedule_enabled',
         'campaign_source_discovery_enabled', 'campaign_min_credits', 'campaign_default_credits',
         'campaign_max_credits', 'campaign_discovery_minutes', 'discovery_job_max_attempts',
         'discovery_job_lease_seconds')
         and key not like '%token%'),
    'telegram_health', (
      select to_jsonb(h) - 'id'
        from public.provider_health h where h.provider = 'TELEGRAM' limit 1),
    'targets', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select lifecycle, readability, discovery_enabled, count(*)::int as targets,
               coalesce(sum(items_read), 0)::int as items_read,
               coalesce(sum(demand_found), 0)::int as demand_found,
               max(last_checked_at) as last_checked_at
          from public.community_targets where platform = 'TELEGRAM'
         group by 1, 2, 3 order by 4 desc) t),
    'queue', (
      select coalesce(jsonb_agg(q), '[]'::jsonb) from (
        select coalesce(provider, 'NONE') as provider, status, count(*)::int as jobs,
               max(coalesce(finished_at, processed_at, created_at)) as last_activity
          from public.discovery_query_queue group by 1, 2 order by 1, 2) q),
    'labels_7d', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select coalesce(intent_json->>'discoveryLabel', 'UNLABELLED') as label, count(*)::int as signals
          from public.raw_signals where discovered_at > now() - interval '7 days'
         group by 1 order by 2 desc) l),
    'pending_classification', (
      select count(*)::int from public.raw_signals where classification_status = 'PENDING'),
    'current_demand', jsonb_build_object(
      'd7',  (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - interval '7 days'),
      'd14', (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - interval '14 days'),
      'd30', (select count(*)::int from public.raw_signals where classification_status = 'CLASSIFIED' and published_at > now() - interval '30 days')),
    'jobs', (
      select coalesce(jsonb_agg(j), '[]'::jsonb) from (
        select mj.id, mj.property_id, mj.status::text as status, mj.progress, mj.current_step,
               mj.fresh_matches_created, mj.failure_reason, mj.started_at, mj.completed_at,
               mj.discovery_deadline_at,
               (mj.billing_grant->>'authorizedMaxCredits')::numeric as budget_credits,
               (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (
                  select status, count(*)::int as n from public.discovery_query_queue
                   where matching_job_id = mj.id group by 1) s) as source_jobs
          from public.matching_jobs mj
         order by mj.created_at desc limit 25) j)
  );
end;
$function$;

revoke all on function public.admin_discovery_overview() from public, anon;
grant execute on function public.admin_discovery_overview() to authenticated;
