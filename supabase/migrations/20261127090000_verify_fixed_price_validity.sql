-- HOMATCH Verify — one admin-editable fixed price, and 30-day report validity.
--
-- Owner decisions (2026-10-23):
--   * ONE customer price per Verify, the same for V1 and V2, edited by an admin
--     without a redeploy. Initial $1.90 = 19 credits (10 credits = $1). VAT is
--     INCLUDED in that price. A price must be a whole number of credits: it is
--     refused, never rounded.
--   * Charged ONLY when the report is delivered (report READY). A stopped,
--     failed or never-delivered run costs nothing. No budget pauses, no "+25"
--     extensions in fixed mode.
--   * Each job keeps the price it started with (snapshot on verify_billing);
--     a later price change never touches it. A start that quoted a different
--     price than the one now in force is refused (PRICE_CHANGED) instead of
--     debiting an amount the customer did not see.
--   * A report completed after this migration is available for 30 days from
--     completed_at, then inaccessible (access expiry only — nothing is deleted).
--     Reports that already exist stay permanent.
--
-- No second pricing system: the price is billable_products.VERIFY
-- (billing_mode FIXED, standard_retail_cents), charged through the same
-- verify_billing / sessions / wallet_reserve / wallet_settle / wallet_release
-- path as before, audited in admin_audit_log like admin_set_setting. Validity
-- reuses retention_records and the existing read-time gates
-- (research_jobs_retention_gate RLS, retentionGuard 410 REPORT_EXPIRED).
-- verify_billing rows without a snapshot (jobs in flight at deploy) keep the
-- previous cost-based behaviour to the end.

/* ------------------------------------------------------------------ *
 * 1. The price                                                        *
 * ------------------------------------------------------------------ */

update public.billable_products
   set billing_mode = 'FIXED', standard_retail_cents = 190, pricing_version = pricing_version + 1, updated_at = now()
 where code = 'VERIFY' and billing_mode <> 'FIXED';

insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
select '00000000-0000-0000-0000-000000000000'::uuid, 'VERIFY_PRICE_UPDATED', 'billable_products', 'VERIFY',
       jsonb_build_object('old', jsonb_build_object('mode', 'VARIABLE'),
                          'new', jsonb_build_object('mode', 'FIXED', 'cents', 190, 'credits', 19),
                          'reason', 'Fixed Verify price introduced (owner decision 2026-10-23)', 'actor', 'migration')
 where not exists (select 1 from public.admin_audit_log where action = 'VERIFY_PRICE_UPDATED' and entity_id = 'VERIFY');

-- The current customer price, from the one place it is kept.
create or replace function public.verify_fixed_price()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select case when p.billing_mode = 'FIXED' then jsonb_build_object(
           'mode', 'FIXED',
           'cents', p.standard_retail_cents,
           'credits', round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100, 4),
           'pricingVersion', p.pricing_version,
           'validityDays', 30)
         else jsonb_build_object('mode', 'VARIABLE', 'validityDays', 30) end
    from public.billable_products p
   where p.code = 'VERIFY'
$$;
revoke all on function public.verify_fixed_price() from public, anon;
grant execute on function public.verify_fixed_price() to authenticated, service_role;

-- The price a job runs at, fixed when its billing opens.
alter table public.verify_billing
  add column if not exists price_mode text check (price_mode in ('FIXED', 'VARIABLE')),
  add column if not exists price_credits numeric(14, 4),
  add column if not exists price_cents numeric(14, 6),
  add column if not exists pricing_version integer;
comment on column public.verify_billing.price_mode is 'FIXED: charged price_credits once, only when the report is delivered. NULL: opened before the fixed price (cost-based to the end).';

/* ------------------------------------------------------------------ *
 * 2. Opening: snapshot, quoted-price check, no extensions             *
 * ------------------------------------------------------------------ */

drop function if exists public.verify_billing_open(uuid, uuid, text, boolean, integer);

create or replace function public.verify_billing_open(
  p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null, p_expected_credits numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_fixed jsonb := public.verify_fixed_price();
  v_initial numeric := coalesce((v_pol->>'initial_credits')::numeric, 25);
  v_inc numeric := coalesce((v_pol->>'increment_credits')::numeric, 25);
  v_max numeric := coalesce((v_pol->>'max_budget_credits')::numeric, 100);
  v_max_auth integer := coalesce((v_pol->>'max_authorizations')::integer, 4);
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_count integer;
  v_new numeric := 0;
  v_kind text;
  v_remaining numeric;
  v_res record;
  v_seq integer;
  v_can_extend boolean;
  v_wallet_user uuid;
  v_is_fixed boolean;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if not exists (select 1 from public.research_jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'JOB_NOT_OWNED';
  end if;

  -- research_jobs.user_id is the AUTH id; the wallet is keyed by public.users.id.
  v_wallet_user := public.verify_wallet_user(p_user_id);

  -- The price is fixed for this job the moment its billing row exists.
  insert into public.verify_billing (job_id, user_id, authorized_total_credits, price_mode, price_credits, price_cents, pricing_version)
  values (p_job_id, p_user_id, 0, v_fixed->>'mode',
          case when v_fixed->>'mode' = 'FIXED' then (v_fixed->>'credits')::numeric end,
          case when v_fixed->>'mode' = 'FIXED' then (v_fixed->>'cents')::numeric end,
          (v_fixed->>'pricingVersion')::integer)
  on conflict (job_id) do nothing;
  -- Serialises every open, approval, stop and settlement of this job.
  select * into v_b from public.verify_billing where job_id = p_job_id for update;
  select count(*) into v_count from public.verify_billing_authorizations where job_id = p_job_id;
  v_is_fixed := v_b.price_mode = 'FIXED';

  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED';
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'sessionId', v_s.id, 'reservationId', v_s.reservation_id,
      'reservedCredits', v_s.reserved_credits, 'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
      'authorizations', v_count, 'priceMode', coalesce(v_b.price_mode, 'VARIABLE'), 'priceCredits', v_b.price_credits);
  end if;

  -- A session already opened under this key (a retried request after it closed) is not reopened.
  if exists (select 1 from public.verify_billing_sessions vs join public.usage_reservations r on r.id = vs.reservation_id
              where vs.job_id = p_job_id and r.idempotency_key = p_idempotency_key) then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_ALREADY_CLOSED');
  end if;

  -- The customer saw a price; a different one is never debited in its place.
  if v_is_fixed and v_count = 0 and p_expected_credits is not null and p_expected_credits <> v_b.price_credits then
    if not exists (select 1 from public.verify_billing_sessions where job_id = p_job_id) then
      delete from public.verify_billing where job_id = p_job_id;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'PRICE_CHANGED', 'priceCredits', v_b.price_credits, 'priceCents', v_b.price_cents,
      'pricingVersion', v_b.pricing_version);
  end if;

  v_can_extend := not v_is_fixed and v_count < v_max_auth and v_b.authorized_total_credits + v_inc <= v_max;

  if v_count = 0 then
    v_new := case when v_is_fixed then v_b.price_credits else v_initial end; v_kind := 'INITIAL';
  elsif p_extend and not v_is_fixed then
    if p_expected_authorizations is not null and p_expected_authorizations <> v_count then
      return jsonb_build_object('ok', false, 'reason', 'STALE_REQUEST', 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
    end if;
    if not v_can_extend then
      return jsonb_build_object('ok', false, 'reason', 'BUDGET_LIMIT', 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits, 'maxBudget', v_max);
    end if;
    v_new := v_inc; v_kind := 'EXTENSION';
  end if;
  -- Fixed: a resumed run holds the same single price again (a stop charged nothing).

  v_remaining := round(v_b.authorized_total_credits + v_new - v_b.charged_total_credits, 4);
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'canExtend', v_can_extend, 'authorizations', v_count,
      'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
  end if;

  begin
    if v_wallet_user is null then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
    select * into v_res from public.wallet_reserve(v_wallet_user, 'VERIFY', v_remaining, p_idempotency_key, 0, v_remaining, p_job_id::text,
      jsonb_build_object('verify_job_id', p_job_id, 'session', coalesce((select max(seq) from public.verify_billing_sessions where job_id = p_job_id), 0) + 1,
                         'authorized_total', v_b.authorized_total_credits + v_new, 'charged_before', v_b.charged_total_credits,
                         'authorization', case when v_new > 0 then v_kind end,
                         'price_mode', coalesce(v_b.price_mode, 'VARIABLE'), 'price_credits', v_b.price_credits, 'pricing_version', v_b.pricing_version));
  exception when others then
    -- Nothing was held: a job that never held money leaves no billing row.
    if not exists (select 1 from public.verify_billing_sessions where job_id = p_job_id)
       and not exists (select 1 from public.verify_billing_authorizations where job_id = p_job_id) then
      delete from public.verify_billing where job_id = p_job_id;
    end if;
    if sqlerrm like '%INSUFFICIENT_CREDITS%' or sqlerrm like '%CREDIT_ACCOUNT_NOT_FOUND%' then
      return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'requiredCredits', v_remaining,
        'availableCredits', coalesce((select balance from public.credit_accounts where user_id = v_wallet_user), 0),
        'authorizations', v_count, 'canExtend', v_can_extend);
    elsif sqlerrm like '%BELOW_MIN_VIABLE_BUDGET%' then
      return jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'canExtend', v_can_extend, 'authorizations', v_count,
        'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits);
    end if;
    raise;
  end;

  if v_res.was_duplicate and not exists (select 1 from public.usage_reservations r where r.id = v_res.reservation_id and r.job_ref = p_job_id::text and r.status = 'RESERVED') then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;
  -- The authorisation counts only once the money it stands for is held.
  if v_new > 0 then
    insert into public.verify_billing_authorizations (job_id, seq, kind, credits, idempotency_key, reservation_id)
    values (p_job_id, v_count + 1, v_kind, v_new, 'verify:' || p_job_id || ':auth' || (v_count + 1), v_res.reservation_id);
    update public.verify_billing set authorized_total_credits = authorized_total_credits + v_new, updated_at = now()
     where job_id = p_job_id returning * into v_b;
    v_count := v_count + 1;
  end if;

  -- A Verify can outlive the generic reservation TTL; the job keeps it alive.
  update public.usage_reservations
     set expires_at = now() + make_interval(hours => coalesce((v_pol->>'reservation_ttl_hours')::integer, 12))
   where id = v_res.reservation_id and status = 'RESERVED';

  select coalesce(max(seq), 0) + 1 into v_seq from public.verify_billing_sessions where job_id = p_job_id;
  insert into public.verify_billing_sessions (job_id, seq, reservation_id, reserved_credits, charged_before)
  values (p_job_id, v_seq, v_res.reservation_id, v_res.reserved_credits, v_b.charged_total_credits)
  returning * into v_s;
  update public.verify_billing set state = 'ACTIVE', updated_at = now() where job_id = p_job_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'sessionId', v_s.id, 'reservationId', v_s.reservation_id,
    'reservedCredits', v_s.reserved_credits, 'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
    'authorizations', v_count, 'extended', v_kind = 'EXTENSION', 'balanceAfter', v_res.balance_after,
    'priceMode', coalesce(v_b.price_mode, 'VARIABLE'), 'priceCredits', v_b.price_credits);
end;
$function$;
revoke all on function public.verify_billing_open(uuid, uuid, text, boolean, integer, numeric) from public, anon, authenticated;
grant execute on function public.verify_billing_open(uuid, uuid, text, boolean, integer, numeric) to service_role;

/* ------------------------------------------------------------------ *
 * 3. Fixed price: never paused for budget                              *
 * ------------------------------------------------------------------ */

create or replace function public.verify_budget_gate(p_job_id uuid, p_stage text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_b public.verify_billing;
  v_stage text := upper(coalesce(p_stage, ''));
  v_landed numeric;
  v_usd numeric;
  v_add numeric;
  v_proj numeric;
  v_n integer;
  v_can boolean;
begin
  select * into v_b from public.verify_billing where job_id = p_job_id;
  if not found or v_b.state <> 'ACTIVE'
     or not exists (select 1 from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED') then
    return jsonb_build_object('decision', 'NONE');
  end if;
  -- One price covers the whole run: there is no budget to run out of.
  if v_b.price_mode = 'FIXED' then
    return jsonb_build_object('decision', 'GO', 'stage', v_stage, 'priceMode', 'FIXED', 'priceCredits', v_b.price_credits,
      'authorizedTotal', v_b.authorized_total_credits, 'authorizations', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id));
  end if;
  begin
    v_landed := (public.verify_job_cost(p_job_id)->>'landedCents')::numeric;
  exception when others then
    v_landed := v_b.landed_charged_cents;
  end;
  v_usd := coalesce(public.verify_num(v_pol->'stage_estimates_usd'->>v_stage), public.verify_num(v_pol->'stage_estimates_usd'->>'DEFAULT'), 0.10);
  if v_stage = 'SYNTHESIS' then
    v_usd := v_usd + coalesce(public.verify_num(v_pol->'stage_estimates_usd'->>'REPORT'), public.verify_num(v_pol->'stage_estimates_usd'->>'DEFAULT'), 0.10);
  end if;
  v_add := public.verify_cost_cents(round(greatest(v_usd, 0) * 100, 4));
  v_proj := (public.verify_price_for_cost(coalesce(v_landed, 0) + v_add, v_stage in ('SYNTHESIS', 'REPORT'))->>'credits')::numeric;
  select count(*) into v_n from public.verify_billing_authorizations where job_id = p_job_id;
  v_can := v_n < coalesce((v_pol->>'max_authorizations')::integer, 4)
           and v_b.authorized_total_credits + coalesce((v_pol->>'increment_credits')::numeric, 25) <= coalesce((v_pol->>'max_budget_credits')::numeric, 100);
  return jsonb_build_object(
    'decision', case when v_proj <= v_b.authorized_total_credits then 'GO' when v_can then 'AWAIT' else 'LIMIT' end,
    'stage', v_stage, 'projectedCredits', v_proj,
    'shortfall', greatest(v_proj - v_b.authorized_total_credits, 0),
    'authorizedTotal', v_b.authorized_total_credits, 'authorizations', v_n);
end;
$function$;

/* ------------------------------------------------------------------ *
 * 4. Closing: the price on delivery, nothing otherwise                 *
 * ------------------------------------------------------------------ */

create or replace function public.verify_billing_close(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_r record;
  v_cost jsonb;
  v_price jsonb;
  v_total numeric;
  v_charge numeric;
  v_set record;
  v_rel record;
  v_landed numeric;
  v_review boolean := false;
begin
  if p_outcome not in ('COMPLETE', 'STOPPED', 'PARTIAL', 'SYSTEM_FAILED') then raise exception 'VERIFY_BAD_OUTCOME'; end if;
  select * into v_b from public.verify_billing where job_id = p_job_id for update;
  if not found then return jsonb_build_object('ok', true, 'billing', false); end if;
  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED' for update;
  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'state', v_b.state, 'chargedTotal', v_b.charged_total_credits);
  end if;

  select * into v_r from public.usage_reservations where id = v_s.reservation_id for update;
  -- Released behind our back (expiry sweep): nothing left to charge. Recorded
  -- for finance review; the customer is never charged outside a reservation.
  if v_r.status <> 'RESERVED' then
    update public.verify_billing_sessions set state = 'EXPIRED', outcome = p_outcome, charged_credits = 0,
           released_credits = v_s.reserved_credits, closed_at = now() where id = v_s.id;
    update public.verify_billing set state = case when p_outcome = 'STOPPED' then 'PAUSED' when p_outcome = 'SYSTEM_FAILED' then 'RELEASED' else 'SETTLED' end,
           needs_review = true, updated_at = now() where job_id = p_job_id;
    return jsonb_build_object('ok', true, 'expired', true, 'charged', 0, 'released', v_s.reserved_credits);
  end if;

  -- The cost is still measured for finance, whatever the customer pays.
  begin
    v_cost := public.verify_job_cost(p_job_id);
    v_landed := (v_cost->>'landedCents')::numeric;
    v_review := (v_cost->>'state') = 'PARTIAL';
  exception when others then
    v_cost := jsonb_build_object('state', 'ERROR', 'error', left(sqlerrm, 200));
    v_landed := null; v_review := true;
  end;

  if v_b.price_mode = 'FIXED' then
    -- Not delivered (stopped, partial, failed): the customer pays nothing.
    if p_outcome <> 'COMPLETE' then
      select * into v_rel from public.wallet_release(v_s.reservation_id,
        case when p_outcome = 'SYSTEM_FAILED' then 'verify_system_failure' else 'verify_fixed_not_delivered' end,
        jsonb_build_object('provider', 'verify', 'provider_operation', 'verify_session', 'landed_cogs_cents', greatest(coalesce(v_landed, 0) - v_b.landed_charged_cents, 0),
                           'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'outcome', p_outcome, 'price_mode', 'FIXED', 'cost', v_cost)));
      update public.verify_billing_sessions set state = 'RELEASED', outcome = p_outcome, charged_credits = 0,
             released_credits = v_s.reserved_credits, cost = v_cost, closed_at = now() where id = v_s.id;
      update public.verify_billing
         set state = case when p_outcome = 'STOPPED' then 'PAUSED' else 'RELEASED' end,
             landed_charged_cents = greatest(landed_charged_cents, coalesce(v_landed, 0)),
             needs_review = needs_review or v_review, updated_at = now()
       where job_id = p_job_id;
      return jsonb_build_object('ok', true, 'charged', 0, 'released', v_s.reserved_credits, 'chargedTotal', v_b.charged_total_credits, 'priceMode', 'FIXED');
    end if;

    -- Delivered: exactly the job's own price, once.
    v_charge := round(least(greatest(v_b.price_credits - v_s.charged_before, 0), v_s.reserved_credits), 4);
    select * into v_set from public.wallet_settle(v_s.reservation_id, v_charge,
      jsonb_build_object(
        'provider', 'verify', 'provider_operation', 'verify_session',
        'raw_provider_cost_cents', round(greatest(coalesce((v_cost->>'rawUsd')::numeric, 0) * 100, 0), 4),
        'landed_cogs_cents', greatest(coalesce(v_landed, 0) - v_b.landed_charged_cents, 0),
        'tax_cents', 0,
        'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'outcome', p_outcome, 'price_mode', 'FIXED',
                                       'price_credits', v_b.price_credits, 'price_cents', v_b.price_cents, 'pricing_version', v_b.pricing_version,
                                       'vat', 'included', 'cost_state', v_cost->>'state', 'charged_before', v_s.charged_before)),
      'SUCCESS');
    update public.verify_billing_sessions
       set state = 'SETTLED', outcome = p_outcome, charged_credits = v_set.settled_credits,
           released_credits = v_set.released_credits, cost = v_cost,
           price = jsonb_build_object('mode', 'FIXED', 'credits', v_b.price_credits, 'cents', v_b.price_cents, 'pricingVersion', v_b.pricing_version),
           closed_at = now()
     where id = v_s.id;
    update public.verify_billing
       set charged_total_credits = charged_total_credits + v_set.settled_credits,
           landed_charged_cents = greatest(landed_charged_cents, coalesce(v_landed, 0)),
           state = 'SETTLED',
           -- A run that cost more than its price is absorbed by HOMATCH and flagged for finance.
           needs_review = needs_review or v_review or v_set.clamped or coalesce(v_landed, 0) > v_b.price_cents,
           updated_at = now()
     where job_id = p_job_id
    returning * into v_b;
    return jsonb_build_object('ok', true, 'charged', v_set.settled_credits, 'released', v_set.released_credits,
      'chargedTotal', v_b.charged_total_credits, 'authorizedTotal', v_b.authorized_total_credits, 'clamped', v_set.clamped, 'priceMode', 'FIXED');
  end if;

  /* ---- cost-based (jobs opened before the fixed price) ---- */
  begin
    v_price := case when v_landed is null then null else public.verify_price_for_cost(v_landed, p_outcome = 'COMPLETE') end;
  exception when others then
    v_price := null; v_review := true;
  end;

  if p_outcome = 'SYSTEM_FAILED' or v_price is null then
    select * into v_rel from public.wallet_release(v_s.reservation_id,
      case when p_outcome = 'SYSTEM_FAILED' then 'verify_system_failure' else 'verify_cost_unavailable' end,
      jsonb_build_object('provider', 'verify', 'provider_operation', 'verify_session', 'landed_cogs_cents', greatest(coalesce(v_landed, 0) - v_b.landed_charged_cents, 0),
                         'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'cost', v_cost)));
    update public.verify_billing_sessions set state = 'RELEASED', outcome = p_outcome, charged_credits = 0,
           released_credits = v_s.reserved_credits, cost = v_cost, price = v_price, closed_at = now() where id = v_s.id;
    update public.verify_billing
       set state = case when p_outcome = 'SYSTEM_FAILED' then 'RELEASED' when p_outcome = 'STOPPED' then 'PAUSED' else 'SETTLED' end,
           landed_charged_cents = greatest(landed_charged_cents, coalesce(v_landed, 0)),
           needs_review = needs_review or v_review, updated_at = now()
     where job_id = p_job_id;
    return jsonb_build_object('ok', true, 'charged', 0, 'released', v_s.reserved_credits, 'chargedTotal', v_b.charged_total_credits);
  end if;

  v_total := least((v_price->>'credits')::numeric, v_b.authorized_total_credits);
  v_charge := round(least(greatest(v_total - v_s.charged_before, 0), v_s.reserved_credits), 4);

  select * into v_set from public.wallet_settle(v_s.reservation_id, v_charge,
    jsonb_build_object(
      'provider', 'verify', 'provider_operation', 'verify_session',
      'raw_provider_cost_cents', round(greatest(((v_cost->>'rawUsd')::numeric * 100) - coalesce((select max(((x.cost->>'rawUsd')::numeric) * 100) from public.verify_billing_sessions x where x.job_id = p_job_id and x.state = 'SETTLED'), 0), 0), 4),
      'landed_cogs_cents', greatest(v_landed - v_b.landed_charged_cents, 0),
      'tax_cents', 0,
      'metadata', jsonb_build_object('verify_job_id', p_job_id, 'session', v_s.seq, 'outcome', p_outcome,
                                     'price', v_price, 'cost_state', v_cost->>'state', 'charged_before', v_s.charged_before,
                                     'overrun_credits', greatest((v_price->>'credits')::numeric - v_b.authorized_total_credits, 0),
                                     'profit_floor_shortfall', (v_price->>'floorApplied')::boolean and (v_price->>'credits')::numeric > v_b.authorized_total_credits)),
    case p_outcome when 'COMPLETE' then 'SUCCESS' when 'STOPPED' then 'CANCELLED' else 'PARTIAL' end);

  update public.verify_billing_sessions
     set state = 'SETTLED', outcome = p_outcome, charged_credits = v_set.settled_credits,
         released_credits = v_set.released_credits, cost = v_cost, price = v_price, closed_at = now()
   where id = v_s.id;
  update public.verify_billing
     set charged_total_credits = charged_total_credits + v_set.settled_credits,
         landed_charged_cents = greatest(landed_charged_cents, v_landed),
         state = case when p_outcome = 'STOPPED' then 'PAUSED' else 'SETTLED' end,
         needs_review = needs_review or v_review or v_set.clamped
                        or (v_price->>'credits')::numeric > v_b.authorized_total_credits,
         updated_at = now()
   where job_id = p_job_id
  returning * into v_b;
  return jsonb_build_object('ok', true, 'charged', v_set.settled_credits, 'released', v_set.released_credits,
    'chargedTotal', v_b.charged_total_credits, 'authorizedTotal', v_b.authorized_total_credits, 'clamped', v_set.clamped);
end;
$function$;

/* ------------------------------------------------------------------ *
 * 5. What the customer sees: live state and the launch quote           *
 * ------------------------------------------------------------------ */

create or replace function public.verify_billing_state(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_b public.verify_billing;
  v_s public.verify_billing_sessions;
  v_cost jsonb;
  v_price jsonb;
  v_total numeric;
  v_accrued numeric := 0;
  v_last public.verify_billing_sessions;
begin
  select * into v_b from public.verify_billing where job_id = p_job_id;
  if not found then return null; end if;
  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED';
  select * into v_last from public.verify_billing_sessions where job_id = p_job_id and state <> 'RESERVED' order by seq desc limit 1;
  if v_s.id is not null then
    update public.usage_reservations
       set expires_at = now() + make_interval(hours => coalesce((v_pol->>'reservation_ttl_hours')::integer, 12))
     where id = v_s.reservation_id and status = 'RESERVED' and expires_at < now() + interval '2 hours';
  end if;

  -- Fixed: one price, held while running, charged only on delivery.
  if v_b.price_mode = 'FIXED' then
    return jsonb_build_object(
      'state', v_b.state, 'priceMode', 'FIXED', 'priceCredits', v_b.price_credits, 'priceCents', v_b.price_cents,
      'pricingVersion', v_b.pricing_version, 'validityDays', 30,
      'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
      'reserved', coalesce(v_s.reserved_credits, 0), 'accrued', 0,
      'used', v_b.charged_total_credits, 'remaining', 0,
      'authorizations', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id),
      'increment', 0, 'incrementUsdCents', 0, 'maxBudget', v_b.price_credits, 'canExtend', false,
      'usageState', case when v_s.id is null then 'SETTLED' else 'FIXED' end,
      'lastSession', case when v_last.id is null then null else jsonb_build_object(
          'outcome', v_last.outcome, 'charged', v_last.charged_credits, 'released', v_last.released_credits, 'closedAt', v_last.closed_at) end,
      'budgetGuard', false,
      'sessions', (select count(*) from public.verify_billing_sessions where job_id = p_job_id));
  end if;

  if v_s.id is not null then
    begin
      v_cost := public.verify_job_cost(p_job_id);
      v_price := public.verify_price_for_cost((v_cost->>'landedCents')::numeric);
      v_total := least((v_price->>'credits')::numeric, v_b.authorized_total_credits);
      v_accrued := least(greatest(v_total - v_s.charged_before, 0), v_s.reserved_credits);
    exception when others then
      v_cost := jsonb_build_object('state', 'PARTIAL', 'error', left(sqlerrm, 200));
      v_accrued := 0;
    end;
  end if;
  return jsonb_build_object(
    'state', v_b.state,
    'priceMode', 'VARIABLE',
    'authorizedTotal', v_b.authorized_total_credits,
    'chargedTotal', v_b.charged_total_credits,
    'reserved', coalesce(v_s.reserved_credits, 0),
    'accrued', v_accrued,
    'used', v_b.charged_total_credits + v_accrued,
    'remaining', greatest(v_b.authorized_total_credits - v_b.charged_total_credits - v_accrued, 0),
    'authorizations', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id),
    'increment', coalesce((v_pol->>'increment_credits')::numeric, 25),
    'incrementUsdCents', round(coalesce((v_pol->>'increment_credits')::numeric, 25) / nullif(coalesce((v_pol->>'credits_per_usd')::numeric, 10), 0) * 100, 2),
    'maxBudget', coalesce((v_pol->>'max_budget_credits')::numeric, 100),
    'canExtend', (select count(*) from public.verify_billing_authorizations where job_id = p_job_id) < coalesce((v_pol->>'max_authorizations')::integer, 4)
                 and v_b.authorized_total_credits + coalesce((v_pol->>'increment_credits')::numeric, 25) <= coalesce((v_pol->>'max_budget_credits')::numeric, 100),
    'usageState', case when v_s.id is null then 'SETTLED' when v_cost->>'state' = 'PARTIAL' then 'CALCULATING' else 'LIVE' end,
    'lastSession', case when v_last.id is null then null else jsonb_build_object(
        'outcome', v_last.outcome, 'charged', v_last.charged_credits, 'released', v_last.released_credits, 'closedAt', v_last.closed_at) end,
    'budgetGuard', v_s.id is not null and (v_b.charged_total_credits + v_accrued) >= v_b.authorized_total_credits * coalesce((v_pol->>'budget_guard_bps')::numeric, 9000) / 10000,
    'sessions', (select count(*) from public.verify_billing_sessions where job_id = p_job_id));
end;
$function$;

create or replace function public.verify_launch_quote()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_pol jsonb := public.verify_budget_policy();
  v_fixed jsonb := public.verify_fixed_price();
  v_is_fixed boolean := v_fixed->>'mode' = 'FIXED';
  -- Fixed: the one price. Otherwise the INITIAL authorisation (25), never the 100 maximum.
  v_max numeric := case when v_is_fixed then (v_fixed->>'credits')::numeric else coalesce((v_pol->>'initial_credits')::numeric, 25) end;
  v_uid uuid := auth.uid();
begin
  return jsonb_build_object(
    'enabled', coalesce((v_pol->>'enabled')::boolean, false),
    'maxCredits', v_max,
    'usdCents', case when v_is_fixed then (v_fixed->>'cents')::numeric else public.billing_credits_to_cents(v_max) end,
    'priceMode', v_fixed->>'mode',
    'priceCredits', case when v_is_fixed then (v_fixed->>'credits')::numeric end,
    'priceCents', case when v_is_fixed then (v_fixed->>'cents')::numeric end,
    'pricingVersion', (v_fixed->>'pricingVersion')::integer,
    'validityDays', 30,
    'availableCredits', case when v_uid is null then null else coalesce((select balance from public.credit_accounts where user_id = public.verify_wallet_user(v_uid)), 0) end,
    -- fx_rates: units of USD per one unit of the currency, effective now.
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', r.base_currency, 'usdPerUnit', r.rate, 'asOf', r.effective_from) order by r.base_currency)
        from public.fx_rates r
       where r.quote_currency = 'USD' and r.base_currency <> 'USD'
         and r.effective_from <= now() and (r.effective_to is null or r.effective_to > now())), '[]'::jsonb));
end;
$function$;

/* ------------------------------------------------------------------ *
 * 6. Admin: edit the price, see its history                            *
 * ------------------------------------------------------------------ */

create or replace function public.admin_set_verify_price(p_cents numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_admin uuid;
  v_cpu numeric := public.billing_setting_num('credits_per_usd', 10);
  v_credits numeric;
  v_old public.billable_products;
  v_new public.billable_products;
begin
  select u.id into v_admin from public.users u where u.auth_id = auth.uid() and u.is_admin = true;
  if v_admin is null and auth.role() <> 'service_role' then raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_cents is null or p_cents <= 0 or p_cents > 100000 or p_cents <> trunc(p_cents) then raise exception 'INVALID_PRICE'; end if;
  v_credits := p_cents * v_cpu / 100;
  -- Credits are whole: a price that is not one is refused, never rounded.
  if v_credits <> trunc(v_credits) then raise exception 'PRICE_NOT_WHOLE_CREDITS'; end if;

  -- One writer at a time; a start reads either the old or the new committed price.
  select * into v_old from public.billable_products where code = 'VERIFY' for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  update public.billable_products
     set billing_mode = 'FIXED', standard_retail_cents = p_cents, pricing_version = pricing_version + 1, updated_at = now()
   where code = 'VERIFY'
  returning * into v_new;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (coalesce(v_admin, '00000000-0000-0000-0000-000000000000'::uuid), 'VERIFY_PRICE_UPDATED', 'billable_products', 'VERIFY',
          jsonb_build_object(
            'old', jsonb_build_object('mode', v_old.billing_mode, 'cents', v_old.standard_retail_cents,
                                      'credits', round(v_old.standard_retail_cents * v_cpu / 100, 4), 'pricingVersion', v_old.pricing_version),
            'new', jsonb_build_object('mode', 'FIXED', 'cents', v_new.standard_retail_cents, 'credits', v_credits, 'pricingVersion', v_new.pricing_version),
            'reason', btrim(p_reason), 'actor', case when v_admin is null then 'service_role' else 'admin' end));
  return public.verify_fixed_price();
end;
$function$;
revoke all on function public.admin_set_verify_price(numeric, text) from public, anon;
grant execute on function public.admin_set_verify_price(numeric, text) to authenticated, service_role;

create or replace function public.admin_verify_price_history(p_limit integer default 20)
returns table (changed_at timestamptz, admin_email text, old_cents numeric, old_credits numeric, new_cents numeric, new_credits numeric, pricing_version integer, reason text)
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin = true) and auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.created_at, coalesce(u.email, a.metadata->>'actor'),
           (a.metadata->'old'->>'cents')::numeric, (a.metadata->'old'->>'credits')::numeric,
           (a.metadata->'new'->>'cents')::numeric, (a.metadata->'new'->>'credits')::numeric,
           (a.metadata->'new'->>'pricingVersion')::integer, a.metadata->>'reason'
      from public.admin_audit_log a
      left join public.users u on u.id = a.admin_id
     where a.action = 'VERIFY_PRICE_UPDATED' and a.entity_id = 'VERIFY'
     -- pricing_version only ever increases: the order holds even within one transaction.
     order by a.created_at desc, (a.metadata->'new'->>'pricingVersion')::integer desc nulls last
     limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$function$;
revoke all on function public.admin_verify_price_history(integer) from public, anon;
grant execute on function public.admin_verify_price_history(integer) to authenticated, service_role;

/* ------------------------------------------------------------------ *
 * 7. Finance: Verify is a fixed-retail service from now on            *
 * ------------------------------------------------------------------ */

update public.finance_services
   set policy_id = 'fixed_retail_v1', pricing_kind = 'FIXED',
       price_note = 'Fixed price per delivered report (billable_products.VERIFY.standard_retail_cents, VAT included); nothing charged when stopped or failed; report valid 30 days'
 where service_key = 'verify';

/* ------------------------------------------------------------------ *
 * 8. 30-day validity for reports completed from now on                 *
 * ------------------------------------------------------------------ */

-- The cutover is this migration: an earlier report has no record and stays permanent.
insert into public.admin_settings (key, value)
values ('verify_report_validity', jsonb_build_object('days', 30, 'effective_at', now()))
on conflict (key) do nothing;

/*
 * Registered at the moment the report becomes READY — never later by a
 * sweep, so there is no window in which a delivered report has no expiry.
 * Only delivered reports are registered (a FAILED job never gets one), and an
 * existing record is never moved (retention_records' own immutability). The
 * global storage_retention policy is NOT switched on: it would also start
 * expiring contract documents. Access is refused at read time by the existing
 * research_jobs_retention_gate policy and retentionGuard, so expiry holds even
 * when no job ever runs.
 */
create or replace function public.verify_register_report_validity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_effective timestamptz;
begin
  if new.synthesis_state = 'READY' and new.status = 'COMPLETE' and new.completed_at is not null
     and (old.synthesis_state is distinct from 'READY' or old.status is distinct from 'COMPLETE') then
    select nullif(s.value->>'effective_at', '')::timestamptz into v_effective
      from public.admin_settings s where s.key = 'verify_report_validity';
    if v_effective is not null and new.completed_at >= v_effective then
      insert into public.retention_records (product, source_id, owner_user_id, available_at, expires_at, policy, label)
      values ('VERIFY_REPORT', new.id, new.user_id, new.completed_at, public.retention_expiry(new.completed_at), 'STANDARD_30D',
              'Verify · ' || coalesce(new.mode, 'report'))
      on conflict (product, source_id) do nothing;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.verify_register_report_validity() from public, anon, authenticated;

drop trigger if exists trg_verify_report_validity on public.research_jobs;
create trigger trg_verify_report_validity
  after update of synthesis_state, status on public.research_jobs
  for each row execute function public.verify_register_report_validity();
