-- FIND BUYERS / FIND TENANTS — $5 MINIMUM CAMPAIGN AND THE EXECUTION BUDGET (owner, 2026-10-19)
--
--   1 · minimum   a paid discovery campaign starts at exactly 50 credits = $5 (VAT-inclusive
--                 where VAT applies). match-campaign enforces it in code (paidDiscoveryPolicy
--                 minimumCampaignCredits); these rows only make every read agree with it:
--                 find_buyers_min_usd 10 → 5, the public config, and the research presets
--                 now begin at 50. Larger budgets stay supported; the reservation is the
--                 customer's whole chosen budget, as before.
--   2 · AI inside the ceiling
--                 OpenAI already counted as committed when an Actor run was reserved, but the
--                 classification of a run's OWN items happens after it returns. A run that took
--                 the last of the budget therefore left nothing for its classification, which
--                 was booked on top. The reserve now also holds classification headroom for
--                 every in-flight run's items, this one's included (per-item allowance:
--                 admin_settings.find_buyers_ai_headroom_micros_per_item, default 250 µ$ —
--                 production AI_REPLAY ≈ 170 µ$ per item). The worker additionally refuses any
--                 OpenAI call the remaining budget cannot cover (executionBudget.ts).
--
-- The split of the price (37/63 today; VAT-first under Global Finance V2) is NOT touched here:
-- it stays the central policy's (paid_discovery_provider_share_bps / paidDiscoveryPolicy.ts),
-- read back through find_buyers_campaigns.provider_budget_micros.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · the $5 minimum, everywhere it is read
 * ════════════════════════════════════════════════════════════════════════ */

update public.admin_settings set value = '5'::jsonb
 where key = 'find_buyers_min_usd' and value is distinct from '5'::jsonb;
insert into public.admin_settings (key, value)
values ('find_buyers_min_usd', '5'::jsonb)
on conflict (key) do nothing;

update public.admin_settings set value = '[50, 100, 500, 1000, 1500, 2000]'::jsonb
 where key = 'search_budget_presets_find_clients';
insert into public.admin_settings (key, value)
values ('search_budget_presets_find_clients', '[50, 100, 500, 1000, 1500, 2000]'::jsonb)
on conflict (key) do nothing;

create or replace function public.find_buyers_public_config()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with s as (
    select
      5::numeric as min_usd,
      coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = 'credits_per_usd'), 10) as rate,
      greatest(50, coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = 'campaign_min_credits'), 50)) as floor_credits
  )
  select jsonb_build_object(
    'minUsd', min_usd,
    'creditsPerUsd', rate,
    'minCredits', greatest(ceil(min_usd * rate), floor_credits),
    'languages', jsonb_build_array('ka','ru','en','ar','he','tr'))
  from s;
$function$;

create or replace function public.find_buyers_research_budget(p_job_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := public.current_homatch_user_id(); v_camp record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_camp from public.find_buyers_campaigns where matching_job_id = p_job_id and user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'jobId', p_job_id,
    'totalCredits', v_camp.credits_committed,
    'finished', v_camp.finalized_at is not null,
    'presets', coalesce((select value from public.admin_settings where key = 'search_budget_presets_find_clients'), '[50,100,500,1000,1500,2000]'::jsonb),
    'maxCredits', public.billing_setting_num('campaign_max_credits', 100000),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = v_me),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('additionalCredits', e.additional_credits,
                                   'totalAfterCredits', e.total_after_credits, 'status', e.status,
                                   'settledCredits', e.settled_credits, 'createdAt', e.created_at) order by e.created_at)
                              from public.find_buyers_budget_extensions e where e.matching_job_id = p_job_id), '[]'::jsonb));
end $function$;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · classification headroom inside the atomic reserve
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.admin_settings (key, value, description)
values ('find_buyers_ai_headroom_micros_per_item', '250'::jsonb,
        'Find Buyers: OpenAI classification headroom (micro-USD) held from the campaign execution budget per item an in-flight Actor run may return.')
on conflict (key) do nothing;

create or replace function public.find_buyers_reserve_actor_run(p_matching_job_id uuid, p_actor_key text, p_idempotency_key text, p_queue_job_id uuid, p_operation text, p_language text, p_tranche integer, p_requested_limit integer, p_reason jsonb DEFAULT '{}'::jsonb, p_retry_of uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c public.find_buyers_campaigns%rowtype;
  v_a public.find_buyers_actor_registry%rowtype;
  v_existing public.find_buyers_actor_runs%rowtype;
  v_enabled boolean;
  v_max_age integer;
  v_limit integer;
  v_estimate bigint;
  v_committed bigint;
  v_ai bigint;
  v_per_item bigint;
  v_ai_hold bigint;
  v_actor_campaign bigint;
  v_actor_day bigint;
  v_running integer;
  v_global_cap integer;
  v_global_running integer;
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
  /* Apify switched off on Admin → Providers: no memo23 run is reserved (no money moves). */
  if coalesce((select case jsonb_typeof(value) when 'array' then value ? 'APIFY' when 'string' then upper(value #>> '{}') like '%"APIFY"%' else false end
                 from public.admin_settings where key = 'provider_disabled_list'), false) then
    return jsonb_build_object('ok', false, 'reason', 'APIFY_DISABLED_BY_ADMIN');
  end if;

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

  /* GLOBAL SLOTS: at most N memo23 runs in flight across every actor and
     campaign (N = discovery_provider_concurrency.APIFY_MEMO23, default 4).
     A run holds its slot from reservation until its cost is booked, so a
     finished or released run frees the slot for the next queued job. The
     advisory lock serialises this check across actors (the actor row lock
     above only serialises one actor). */
  perform pg_advisory_xact_lock(hashtext('find_buyers:memo23_global_slots'));
  v_global_cap := greatest(1, coalesce((select (value ->> 'APIFY_MEMO23')::int from public.admin_settings
                                         where key = 'discovery_provider_concurrency'), 4));
  select count(*) into v_global_running from public.find_buyers_actor_runs
   where status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null
     and created_at > now() - interval '2 hours';
  if v_global_running >= v_global_cap then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_BUSY', 'retry', true,
                              'running', v_global_running, 'cap', v_global_cap);
  end if;

  /* Committed = held reservations + booked actuals (+ the reservation of a
     run whose cost is still unknown: never treated as zero). */
  select coalesce(sum(case
           when status in ('RESERVED', 'STARTING', 'RUNNING') then reserved_micros
           when actual_micros is not null then actual_micros
           when status = 'RELEASED' then 0
           else reserved_micros end), 0)
    into v_committed from public.find_buyers_actor_runs where matching_job_id = p_matching_job_id;
  /* OpenAI is paid from the same provider budget (2026-10-12): every OpenAI
     ledger row booked for this campaign while it is open counts as committed. */
  select coalesce(sum(coalesce(actual_micros, estimated_micros, 0)), 0) into v_ai
    from public.find_buyers_cost_ledger
   where matching_job_id = p_matching_job_id and provider = 'OPENAI' and not coalesce(after_settlement, false);
  v_committed := v_committed + v_ai;
  /* ...and the classification still owed (2026-10-19): every in-flight run's items and this
     run's own are classified after they return, from the same budget. */
  v_per_item := greatest(0, coalesce((select (value #>> '{}')::bigint from public.admin_settings
                                       where key = 'find_buyers_ai_headroom_micros_per_item'), 250));
  select coalesce(sum(requested_limit), 0) * v_per_item into v_ai_hold
    from public.find_buyers_actor_runs
   where matching_job_id = p_matching_job_id and status in ('RESERVED', 'STARTING', 'RUNNING') and cost_booked_at is null;
  v_ai_hold := v_ai_hold + v_limit * v_per_item;
  if v_committed + v_estimate + v_ai_hold > v_c.provider_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'CAMPAIGN_BUDGET', 'committedMicros', v_committed,
                              'estimateMicros', v_estimate, 'budgetMicros', v_c.provider_budget_micros, 'openAiMicros', v_ai,
                              'aiHoldMicros', v_ai_hold);
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_campaign from public.find_buyers_actor_runs
   where matching_job_id = p_matching_job_id and actor_key = p_actor_key;
  /* Per-Actor caps are optional (NULL = none, the default since 2026-10-12);
     an admin-set cap still applies. The campaign budget above always does. */
  if v_a.campaign_spend_cap_micros is not null and v_actor_campaign + v_estimate > v_a.campaign_spend_cap_micros then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_CAMPAIGN_CAP');
  end if;

  select coalesce(sum(case when status in ('RESERVED','STARTING','RUNNING') then reserved_micros
                           when status = 'RELEASED' then 0
                           else coalesce(actual_micros, reserved_micros) end), 0)
    into v_actor_day from public.find_buyers_actor_runs
   where actor_key = p_actor_key and created_at >= date_trunc('day', now());
  if v_a.daily_spend_cap_micros is not null and v_actor_day + v_estimate > v_a.daily_spend_cap_micros then
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
    'aiHoldMicros', v_ai_hold,
    'remainingMicros', v_c.provider_budget_micros - v_committed - v_estimate - v_ai_hold);
end;
$function$;
revoke all on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_reserve_actor_run(uuid, text, text, uuid, text, text, integer, integer, jsonb, uuid) to service_role;
