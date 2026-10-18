-- FIND PROPERTY — batched paid social runs (owner, 2026-10-18).
--
-- A paid campaign now runs a few LARGE memo23 runs instead of dozens of one-community
-- probes: every Facebook group of the city in one group run per keyword, Telegram
-- channels in batches, TikTok with every keyword in one search. The reservation used to
-- cap a run at the Actor's per-run max_results (100 posts for 25 groups = 4 a group),
-- which made batching useless.
--
-- find_property_reserve_actor_run gains p_target_count (default 1 = the old behaviour):
--   limit   = min(requested, max_results x targets (targets <= 25), 1000)
--   timeout = the Actor's timeout per max_results block, at most 20 minutes (the campaign
--             deadline is 30, and runs may wait for one of the shared memo23 slots).
-- Everything that protects money is unchanged and applies to the whole run: the
-- campaign's 63% provider budget (find_property_committed_micros), the switches
-- (find_property_social_enabled, APIFY), pricing freshness, per-Actor concurrency, the
-- global memo23 lane, and the Admin per-campaign / per-day Actor caps. Apify still
-- caps every run at maxTotalChargeUsd = its reservation.
-- Find Buyers' reservation function is not touched.

/* Replaced, not overloaded: one signature, so a call with eight named arguments
   (the deployed edge code) still resolves to it with p_target_count = 1. */
drop function if exists public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer);

create or replace function public.find_property_reserve_actor_run(
  p_run_id uuid, p_actor_key text, p_idempotency_key text, p_queue_job_id uuid,
  p_stage text, p_network text, p_source_id uuid, p_requested_limit integer, p_target_count integer default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run public.discovery_runs%rowtype;
  v_a public.find_buyers_actor_registry%rowtype;
  v_existing public.find_property_actor_runs%rowtype;
  v_max_age int; v_limit int; v_estimate bigint; v_committed bigint;
  v_running int; v_global_cap int; v_global_running int; v_id uuid; v_targets int; v_timeout int;
begin
  select * into v_run from public.discovery_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'NO_RUN'); end if;
  perform 1 from public.find_buyers_actor_registry where actor_key = p_actor_key for update;

  select * into v_existing from public.find_property_actor_runs where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.discovery_run_id <> p_run_id then return jsonb_build_object('ok', false, 'reason', 'IDEMPOTENCY_KEY_REUSED'); end if;
    select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
    return jsonb_build_object('ok', true, 'replay', true, 'runId', v_existing.id, 'status', v_existing.status,
      'reservedMicros', v_existing.reserved_micros, 'requestedLimit', v_existing.requested_limit,
      'actorId', v_existing.actor_id, 'inputContract', v_a.input_contract,
      'timeoutSeconds', least(1200, v_a.timeout_seconds * greatest(1, ceil(v_existing.requested_limit::numeric / greatest(1, v_a.max_results))::int)));
  end if;

  if v_run.status <> 'SEARCHING' then return jsonb_build_object('ok', false, 'reason', 'RUN_NOT_SEARCHING'); end if;
  if v_run.pricing_policy is distinct from 'paid_discovery_37_63_v1' or v_run.provider_budget_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_A_SOCIAL_CAMPAIGN');
  end if;
  if not coalesce((select (value #>> '{}')::boolean from public.admin_settings where key = 'find_property_social_enabled'), false) then
    return jsonb_build_object('ok', false, 'reason', 'SOCIAL_DISABLED');
  end if;
  if coalesce((select case jsonb_typeof(value) when 'array' then value ? 'APIFY' when 'string' then upper(value #>> '{}') like '%"APIFY"%' else false end
                 from public.admin_settings where key = 'provider_disabled_list'), false) then
    return jsonb_build_object('ok', false, 'reason', 'APIFY_DISABLED_BY_ADMIN');
  end if;

  select * into v_a from public.find_buyers_actor_registry where actor_key = p_actor_key;
  if not found then return jsonb_build_object('ok', false, 'reason', 'UNKNOWN_ACTOR'); end if;
  if not v_a.enabled or v_a.emergency_disabled or v_a.health = 'DISABLED' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DISABLED');
  end if;
  select coalesce((select (value #>> '{}')::int from public.admin_settings where key = 'find_buyers_pricing_max_age_days'), 30) into v_max_age;
  if v_a.pricing_verified_at is null or v_a.pricing_verified_at < now() - make_interval(days => v_max_age)
     or v_a.pricing_model = 'UNKNOWN' or v_a.price_per_1k_micros is null then
    return jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_VERIFIED');
  end if;

  /* A batched run reads up to 25 communities (or keywords) at once: it may ask for the
     Actor's per-run maximum for EACH of them, never more than 1000 items, and gets the
     time to read them. The money checks below are unchanged and apply to the whole run. */
  v_targets := greatest(1, least(coalesce(p_target_count, 1), 25));
  v_limit := greatest(1, least(coalesce(p_requested_limit, v_a.probe_size), v_a.max_results * v_targets, 1000));
  v_timeout := least(1200, v_a.timeout_seconds * greatest(1, ceil(v_limit::numeric / greatest(1, v_a.max_results))::int));
  v_estimate := v_a.start_fee_micros + ceil(v_limit::numeric * v_a.price_per_1k_micros / 1000)::bigint;

  select count(*) into v_running from (
    select 1 from public.find_buyers_actor_runs where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING')
       and cost_booked_at is null and created_at > now() - interval '2 hours'
    union all
    select 1 from public.find_property_actor_runs where actor_key = p_actor_key and status in ('RESERVED', 'STARTING', 'RUNNING')
       and cost_booked_at is null and created_at > now() - interval '2 hours') x;
  if v_running >= v_a.concurrency then return jsonb_build_object('ok', false, 'reason', 'ACTOR_BUSY', 'retry', true); end if;

  /* The same global memo23 lane Find Buyers uses (same lock, both tables counted). */
  perform pg_advisory_xact_lock(hashtext('find_buyers:memo23_global_slots'));
  v_global_cap := greatest(1, coalesce((select (value ->> 'APIFY_MEMO23')::int from public.admin_settings where key = 'discovery_provider_concurrency'), 4));
  select count(*) into v_global_running from (
    select 1 from public.find_buyers_actor_runs where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null and created_at > now() - interval '2 hours'
    union all
    select 1 from public.find_property_actor_runs where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null and created_at > now() - interval '2 hours') x;
  if v_global_running >= v_global_cap then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_BUSY', 'retry', true, 'running', v_global_running, 'cap', v_global_cap);
  end if;

  v_committed := public.find_property_committed_micros(p_run_id);
  if v_committed + v_estimate > v_run.provider_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_BUDGET', 'committedMicros', v_committed,
                              'estimateMicros', v_estimate, 'budgetMicros', v_run.provider_budget_micros);
  end if;

  /* Admin-set per-Actor caps (NULL = none) apply here exactly as for Find Buyers:
     per campaign, and per day across BOTH products. */
  if v_a.campaign_spend_cap_micros is not null and coalesce((
       select sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros when status = 'RELEASED' then 0
                       else coalesce(actual_micros, reserved_micros) end)
         from public.find_property_actor_runs where discovery_run_id = p_run_id and actor_key = p_actor_key), 0) + v_estimate
     > v_a.campaign_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_CAMPAIGN_CAP');
  end if;
  if v_a.daily_spend_cap_micros is not null and coalesce((
       select sum(x) from (
         select case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros when status = 'RELEASED' then 0
                     else coalesce(actual_micros, reserved_micros) end x
           from public.find_property_actor_runs where actor_key = p_actor_key and created_at >= date_trunc('day', now())
         union all
         select case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros when status = 'RELEASED' then 0
                     else coalesce(actual_micros, reserved_micros) end
           from public.find_buyers_actor_runs where actor_key = p_actor_key and created_at >= date_trunc('day', now())) d), 0) + v_estimate
     > v_a.daily_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_DAILY_CAP');
  end if;

  insert into public.find_property_actor_runs (idempotency_key, discovery_run_id, queue_job_id, actor_key, actor_id, stage, network,
    source_id, requested_limit, status, reserved_micros)
  values (p_idempotency_key, p_run_id, p_queue_job_id, v_a.actor_key, v_a.actor_id, p_stage, p_network, p_source_id, v_limit, 'RESERVED', v_estimate)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'runId', v_id, 'requestedLimit', v_limit, 'reservedMicros', v_estimate,
    'actorId', v_a.actor_id, 'timeoutSeconds', v_timeout, 'startFeeMicros', v_a.start_fee_micros,
    'pricePer1kMicros', v_a.price_per_1k_micros, 'inputContract', v_a.input_contract,
    'remainingMicros', v_run.provider_budget_micros - v_committed - v_estimate);
end $$;
revoke all on function public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.find_property_reserve_actor_run(uuid, text, text, uuid, text, text, uuid, integer, integer) to service_role;

/* A batched run's post that cannot be traced to one of its communities (and every TikTok
   search result, which has none) is stored under its network's inactive holder row, as
   Facebook keyword results already are (homatch:fp-fb-post-search, 20261107095700). */
insert into public.source_registry (platform, source_type, name, url, external_id, country_code, active, lifecycle, access_state)
values ('TIKTOK', 'SEARCH_RESULT', 'TikTok public video search (memo23, Find Property)',
        'https://www.tiktok.com/search', 'homatch:fp-tiktok-search', 'GE', false, 'DISCOVERED', 'PUBLIC'),
       ('TELEGRAM', 'SEARCH_RESULT', 'Telegram channels, unattributed posts (memo23, Find Property)',
        'https://t.me/', 'homatch:fp-telegram-offers', 'GE', false, 'DISCOVERED', 'PUBLIC'),
       ('INSTAGRAM', 'SEARCH_RESULT', 'Instagram profiles, unattributed posts (memo23, Find Property)',
        'https://www.instagram.com/', 'homatch:fp-instagram-offers', 'GE', false, 'DISCOVERED', 'PUBLIC')
on conflict (platform, external_id) do nothing;
