-- Fixture for tests/sql/verify_credit_budget.sql: the wallet as production has
-- it. Table shapes copied from production (information_schema, 2026-10-10);
-- wallet/billing functions are the latest definitions in this repo's
-- migrations (identical to production's pg_get_functiondef); price_per_unit_at
-- exists only in production and is copied verbatim. Runs AFTER
-- verify_durable_execution_fixture.sql + the queue migration.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claim.role', true), 'service_role') $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

alter table public.research_jobs add column if not exists mode text default 'cadastral';
alter table public.research_jobs add column if not exists status text default 'CREATED';
alter table public.research_jobs add column if not exists stage text default 'QUEUED';
alter table public.research_jobs add column if not exists result_json jsonb default '{}'::jsonb;
alter table public.research_jobs add column if not exists synthesis_json jsonb;

create table if not exists public.billable_products (code text not null, name text not null, billing_mode text default 'VARIABLE'::text not null, requires_reservation boolean default true not null, standard_retail_cents numeric(14,6) default 0 not null, reference_landed_cogs_cents numeric(12,4) default 0 not null, min_gross_margin_bps integer default 3000 not null, estimate_strategy text default 'RANGE'::text not null, pricing_version integer default 1 not null, enabled boolean default true not null, pricing_active boolean default true not null, kill_switch boolean default false not null, sort_order integer default 0 not null, config jsonb default '{}'::jsonb not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, min_viable_budget_credits numeric(18,4) default 0 not null, primary key (code));
create table if not exists public.billing_plans (code text not null, name text not null, monthly_price_cents integer default 0 not null, membership_credits_grant numeric(18,4) default 0 not null, membership_rollover_cap numeric(18,4) default 0 not null, quality_tier text default 'STANDARD'::text not null, profit_share_to_customer_bps integer default 0 not null, badge_key text, priority_level integer default 0 not null, ai_fair_use_key text default 'ai_chat_daily_limit_free'::text not null, marketing_label_key text, sort_order integer default 0 not null, enabled boolean default true not null, config jsonb default '{}'::jsonb not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, primary key (code));
create table if not exists public.cost_events (id uuid default gen_random_uuid() not null, provider text not null, operation_type text not null, source text, market text, request_id text, units numeric(12,4), cost_usd numeric(12,6) default 0 not null, success boolean default true not null, cache_hit boolean default false not null, property_id uuid, signal_id uuid, "timestamp" timestamptz default now() not null, job_id uuid, discovery_job_id uuid, pricing_state text, primary key (id));
create table if not exists public.credit_accounts (id uuid default gen_random_uuid() not null, user_id uuid not null unique, balance numeric(12,4) default 0 not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, reserved numeric(18,4) default 0 not null, primary key (id));
create table if not exists public.credit_ledger (id uuid default gen_random_uuid() not null, user_id uuid not null, amount numeric(12,4) not null, balance_before numeric(12,4) not null, balance_after numeric(12,4) not null, type text not null, reference text, payment_id uuid, created_at timestamptz default now() not null, metadata jsonb default '{}'::jsonb not null, primary key (id));
create table if not exists public.credit_lot_allocations (id uuid default gen_random_uuid() not null, reservation_id uuid not null, lot_id uuid not null, allocated_credits numeric(18,4) not null, settled_credits numeric(18,4) default 0 not null, released_credits numeric(18,4) default 0 not null, spend_rank integer default 0 not null, created_at timestamptz default now() not null, primary key (id));
create table if not exists public.credit_lots (id uuid default gen_random_uuid() not null, user_id uuid not null, kind text not null, credits_granted numeric(18,4) not null, credits_consumed numeric(18,4) default 0 not null, credits_reserved numeric(18,4) default 0 not null, credits_expired numeric(18,4) default 0 not null, credits_available numeric(18,4) generated always as ((((credits_granted - credits_consumed) - credits_reserved) - credits_expired)) stored, expires_at timestamptz, granted_at timestamptz default now() not null, source_type text not null, source_ref text, plan_code text, ledger_entry_id uuid, status text default 'ACTIVE'::text not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, primary key (id));
create table if not exists public.fx_rates (id uuid default gen_random_uuid() not null, base_currency text not null, quote_currency text default 'USD'::text not null, rate numeric(20,10) not null, source text default 'MANUAL'::text not null, effective_from timestamptz default now() not null, effective_to timestamptz, created_at timestamptz default now() not null, primary key (id));
create table if not exists public.product_plan_entitlements (product_code text not null, plan_code text not null, included_per_period integer default 0 not null, period text default 'CALENDAR_MONTH'::text not null, quality_tier text default 'STANDARD'::text not null, result_ceiling integer, provider_budget_ceiling_cents integer, priority_level integer default 0 not null, config jsonb default '{}'::jsonb not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, primary key (product_code,plan_code));
create table if not exists public.provider_price_book (id uuid default gen_random_uuid() not null, provider text not null, model text, unit text not null, rate numeric not null, per_units numeric default 1000000 not null, currency text default 'USD'::text not null, effective_from timestamptz default now() not null, effective_to timestamptz, source text, notes text, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, updated_by uuid, primary key (id));
create table if not exists public.usage_events (id uuid default gen_random_uuid() not null, user_id uuid not null, reservation_id uuid, product_code text not null, plan_code text not null, quality_tier text not null, pricing_version integer default 1 not null, provider text, provider_operation text, provider_request_id text, model text, input_tokens bigint, cached_tokens bigint, output_tokens bigint, search_count integer, provider_units numeric(18,4), enrichment_units numeric(18,4), duration_ms integer, raw_provider_cost_cents numeric(14,4) default 0 not null, ai_cost_cents numeric(14,4) default 0 not null, tax_cents numeric(14,4) default 0 not null, fee_cents numeric(14,4) default 0 not null, landed_cogs_cents numeric(14,4) default 0 not null, charged_credits numeric(18,4) default 0 not null, reserved_credits numeric(18,4) default 0 not null, released_credits numeric(18,4) default 0 not null, allowance_funded boolean default false not null, billable boolean default true not null, outcome text default 'SUCCESS'::text not null, failure_reason text, job_ref text, metadata jsonb default '{}'::jsonb not null, created_at timestamptz default now() not null, pricing_state text, primary key (id));
create table if not exists public.usage_reservations (id uuid default gen_random_uuid() not null, user_id uuid not null, product_code text not null, status text default 'RESERVED'::text not null, plan_code_snapshot text not null, quality_tier_snapshot text not null, pricing_version_snapshot integer default 1 not null, profit_share_bps_snapshot integer default 0 not null, result_ceiling_snapshot integer, provider_budget_ceiling_cents_snapshot integer, estimate_min_credits numeric(18,4) default 0 not null, estimate_max_credits numeric(18,4) default 0 not null, authorized_max_credits numeric(18,4) not null, reserved_credits numeric(18,4) default 0 not null, settled_credits numeric(18,4) default 0 not null, released_credits numeric(18,4) default 0 not null, allowance_consumption_id uuid, job_ref text, idempotency_key text not null unique, ledger_reserve_id uuid, ledger_capture_id uuid, ledger_release_id uuid, failure_reason text, metadata jsonb default '{}'::jsonb not null, expires_at timestamptz default (now() + '01:00:00'::interval) not null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null, settled_at timestamptz, primary key (id));
create table if not exists public.user_subscriptions (user_id uuid, plan_code text, status text, current_period_end timestamptz);

create or replace function public.price_per_unit_at(p_provider text, p_model text, p_unit text, p_at timestamp with time zone)
 returns numeric language sql stable set search_path to 'public' as $function$
  select (b.rate / b.per_units)
  from public.provider_price_book b
  where b.provider = p_provider
    and b.unit = p_unit
    and b.effective_from <= p_at
    and (b.effective_to is null or b.effective_to > p_at)
    and (b.model = p_model or b.model is null)
  order by (b.model = p_model) desc nulls last, b.effective_from desc
  limit 1
$function$;
create or replace function public.billing_release_allowance(p_allowance_id uuid, p_reason text) returns void language sql as $$ select $$;

CREATE OR REPLACE FUNCTION public.billing_setting_num(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT CASE
      WHEN (s.value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
      THEN trim(s.value #>> '{}')::numeric
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT CASE lower(trim(s.value #>> '{}'))
      WHEN 'true' THEN true WHEN 't' THEN true WHEN '1' THEN true WHEN 'yes' THEN true
      WHEN 'false' THEN false WHEN 'f' THEN false WHEN '0' THEN false WHEN 'no' THEN false
    END
    FROM public.admin_settings s WHERE s.key = p_key
  ), p_default);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_cents_to_credits(p_cents numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round(p_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 4);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_credits_to_cents(p_credits numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT round(p_credits * 100.0 / public.billing_setting_num('credits_per_usd', 10), 4);
$fn$;

CREATE OR REPLACE FUNCTION public.billing_landed_cogs_cents(
  p_raw_provider_cents numeric,
  p_ai_cents numeric DEFAULT 0,
  p_enrichment_cents numeric DEFAULT 0,
  p_infra_cents numeric DEFAULT 0
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_base numeric;
  v_tax_bps numeric := public.billing_setting_num('billing_cogs_tax_bps', 1800);
  v_fee_bps numeric := public.billing_setting_num('billing_cogs_fee_bps', 0);
begin
  v_base := COALESCE(p_raw_provider_cents,0) + COALESCE(p_ai_cents,0)
          + COALESCE(p_enrichment_cents,0) + COALESCE(p_infra_cents,0);
  if v_base < 0 then raise exception 'NEGATIVE_COGS'; end if;
  return round(v_base * (1 + v_tax_bps/10000.0 + v_fee_bps/10000.0), 4);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.billing_current_plan(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    (SELECT s.plan_code FROM public.user_subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('ACTIVE','PAST_DUE')
        AND s.current_period_end > now()
      ORDER BY s.current_period_end DESC LIMIT 1),
    'FREE');
$fn$;

CREATE OR REPLACE FUNCTION public.billing_budget_to_cogs_ceiling(
  p_product_code text,
  p_plan_code text,
  p_authorized_credits numeric
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_p record;
  v_plan record;
  v_multiple numeric;
  v_effective numeric;
  v_floor_multiple numeric;
  v_min_bps numeric;
  v_cents numeric;
begin
  select * into v_p from public.billable_products where code = p_product_code;
  if not found or v_p.reference_landed_cogs_cents <= 0 then return 0; end if;
  select * into v_plan from public.billing_plans where code = p_plan_code;
  if not found then return 0; end if;

  v_multiple := v_p.standard_retail_cents::numeric / v_p.reference_landed_cogs_cents;
  v_effective := 1 + (v_multiple - 1) * (1 - v_plan.profit_share_to_customer_bps / 10000.0);

  v_min_bps := greatest(
    COALESCE(v_p.min_gross_margin_bps, 3000),
    public.billing_setting_num('billing_min_gross_margin_bps', 3000));
  v_floor_multiple := 1 / (1 - v_min_bps/10000.0);

  -- The stricter of the two: a budget must never authorise spend we could not
  -- charge for at the floor.
  v_effective := greatest(v_effective, v_floor_multiple);
  if v_effective <= 0 then return 0; end if;

  v_cents := public.billing_credits_to_cents(greatest(COALESCE(p_authorized_credits, 0), 0));
  return round(v_cents / v_effective, 4);
end;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_reserve(
  p_user_id uuid,
  p_product_code text,
  p_authorized_max_credits numeric,
  p_idempotency_key text,
  p_estimate_min_credits numeric DEFAULT 0,
  p_estimate_max_credits numeric DEFAULT 0,
  p_job_ref text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (reservation_id uuid, reserved_credits numeric, balance_after numeric, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_existing record;
  v_plan_code text;
  v_plan record;
  v_ent record;
  v_product record;
  v_before numeric;
  v_after numeric;
  v_need numeric;
  v_take numeric;
  v_lot record;
  v_rank integer := 0;
  v_res uuid;
  v_ledger uuid;
  v_alloc jsonb := '[]'::jsonb;
  v_budget_cents numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_authorized_max_credits is null or p_authorized_max_credits <= 0 then raise exception 'INVALID_AUTHORIZED_MAX'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_existing from public.usage_reservations where idempotency_key = p_idempotency_key;
  if found then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_existing.user_id;
    return query select v_existing.id, v_existing.reserved_credits, v_after, true;
    return;
  end if;

  select * into v_product from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT'; end if;
  if not v_product.enabled then raise exception 'PRODUCT_DISABLED'; end if;
  if v_product.kill_switch then raise exception 'PRODUCT_KILL_SWITCH'; end if;
  if not v_product.pricing_active then raise exception 'PRODUCT_PRICING_INACTIVE'; end if;
  if not public.billing_setting_bool('billing_payg_enabled', true) then raise exception 'PAYG_DISABLED'; end if;

  -- A budget below the minimum useful one buys a search not worth running.
  -- Refusing here is kinder than spending the customer's last credits on it.
  if p_authorized_max_credits < COALESCE(v_product.min_viable_budget_credits, 0) then
    raise exception 'BELOW_MIN_VIABLE_BUDGET: % < %',
      p_authorized_max_credits, v_product.min_viable_budget_credits;
  end if;

  v_plan_code := public.billing_current_plan(p_user_id);
  select * into v_plan from public.billing_plans where code = v_plan_code;
  select * into v_ent from public.product_plan_entitlements
   where plan_code = v_plan_code and product_code = p_product_code;

  v_need := round(p_authorized_max_credits, 4);

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < v_need then raise exception 'INSUFFICIENT_CREDITS'; end if;

  v_after := v_before - v_need;
  update public.credit_accounts
     set balance = v_after, reserved = reserved + v_need, updated_at = now()
   where user_id = p_user_id;

  -- The provider spend this budget authorises, at THIS plan's member rate.
  -- Snapshotted as the stricter of the plan's operational ceiling and what the
  -- money actually buys, so the worker has one number to obey.
  v_budget_cents := public.billing_budget_to_cogs_ceiling(p_product_code, v_plan_code, v_need);
  if v_ent.provider_budget_ceiling_cents is not null then
    v_budget_cents := least(v_budget_cents, v_ent.provider_budget_ceiling_cents);
  end if;

  insert into public.usage_reservations (
    user_id, product_code, status,
    plan_code_snapshot, quality_tier_snapshot, pricing_version_snapshot,
    profit_share_bps_snapshot, result_ceiling_snapshot, provider_budget_ceiling_cents_snapshot,
    estimate_min_credits, estimate_max_credits, authorized_max_credits, reserved_credits,
    job_ref, idempotency_key, metadata, expires_at
  ) values (
    p_user_id, p_product_code, 'RESERVED',
    v_plan_code, COALESCE(v_ent.quality_tier, v_plan.quality_tier),
    public.billing_setting_num('billing_pricing_version', 1)::integer,
    v_plan.profit_share_to_customer_bps, v_ent.result_ceiling, floor(v_budget_cents)::integer,
    round(COALESCE(p_estimate_min_credits,0),4), round(COALESCE(p_estimate_max_credits,0),4),
    v_need, v_need,
    p_job_ref, p_idempotency_key,
    COALESCE(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'budget_mode', case when v_need < round(COALESCE(p_estimate_max_credits,0),4) then 'PARTIAL' else 'FULL' end),
    now() + (public.billing_setting_num('billing_reservation_ttl_minutes', 60) || ' minutes')::interval
  ) returning id into v_res;

  for v_lot in
    select * from public.credit_lots
     where user_id = p_user_id and status = 'ACTIVE' and credits_available > 0
       and (expires_at is null or expires_at > now())
     order by case kind when 'PROMOTIONAL' then 0 when 'MEMBERSHIP' then 1
                        when 'ADJUSTMENT' then 2 else 3 end,
              expires_at asc nulls last,
              granted_at asc
     for update
  loop
    exit when v_need <= 0;
    v_take := least(v_lot.credits_available, v_need);
    if v_take <= 0 then continue; end if;

    update public.credit_lots
       set credits_reserved = credits_reserved + v_take, updated_at = now()
     where id = v_lot.id;

    insert into public.credit_lot_allocations (reservation_id, lot_id, allocated_credits, spend_rank)
    values (v_res, v_lot.id, v_take, v_rank);

    v_alloc := v_alloc || jsonb_build_object('lot_id', v_lot.id, 'kind', v_lot.kind, 'credits', v_take);
    v_need := round(v_need - v_take, 4);
    v_rank := v_rank + 1;
  end loop;

  if v_need > 0 then
    raise exception 'WALLET_LOT_DRIFT: balance covered the reservation but lots are short by % credits', v_need;
  end if;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (p_user_id, -round(p_authorized_max_credits,4), v_before, v_after, 'SERVICE_RESERVE',
          'res:' || v_res::text,
          jsonb_build_object('reservation_id', v_res, 'product_code', p_product_code,
                             'plan_code', v_plan_code, 'allocations', v_alloc,
                             'provider_budget_cents', floor(v_budget_cents)::integer))
  returning id into v_ledger;

  update public.usage_reservations set ledger_reserve_id = v_ledger where id = v_res;

  return query select v_res, round(p_authorized_max_credits,4), v_after, false;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_settle(
  p_reservation_id uuid,
  p_actual_credits numeric,
  p_usage jsonb DEFAULT '{}'::jsonb,
  p_outcome text DEFAULT 'SUCCESS'
) RETURNS TABLE (reservation_id uuid, settled_credits numeric, released_credits numeric, balance_after numeric, was_duplicate boolean, clamped boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_res record;
  v_charge numeric;
  v_release numeric;
  v_clamped boolean := false;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_left numeric;
  v_take numeric;
  v_ledger_cap uuid;
  v_ledger_rel uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations r where r.id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.settled_credits, v_res.released_credits, v_after, true, false;
    return;
  end if;

  v_charge := round(greatest(COALESCE(p_actual_credits, 0), 0), 4);
  if v_charge > v_res.authorized_max_credits then
    v_charge := v_res.authorized_max_credits;
    v_clamped := true;
  end if;
  v_release := round(v_res.reserved_credits - v_charge, 4);

  v_left := v_charge;
  for v_alloc in
    select a.* from public.credit_lot_allocations a
     where a.reservation_id = p_reservation_id order by a.spend_rank
     for update
  loop
    v_take := least(v_alloc.allocated_credits, greatest(v_left, 0));
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits,
           credits_consumed = credits_consumed + v_take,
           status = case when (credits_granted - credits_consumed - v_take - (credits_reserved - v_alloc.allocated_credits) - credits_expired) <= 0
                         then 'EXHAUSTED' else status end,
           updated_at = now()
     where id = v_alloc.lot_id;

    update public.credit_lot_allocations
       set settled_credits = v_take, released_credits = v_alloc.allocated_credits - v_take
     where id = v_alloc.id;

    v_left := round(v_left - v_take, 4);
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_release;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, 0, v_before, v_before, 'SERVICE_CAPTURE', 'res:' || p_reservation_id::text || ':cap',
          jsonb_build_object('reservation_id', p_reservation_id, 'product_code', v_res.product_code,
                             'charged_credits', v_charge, 'authorized_max', v_res.authorized_max_credits,
                             'clamped', v_clamped, 'outcome', p_outcome,
                             'plan_code', v_res.plan_code_snapshot))
  returning id into v_ledger_cap;

  if v_release > 0 then
    insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
    values (v_res.user_id, v_release, v_before, v_after, 'SERVICE_RELEASE', 'res:' || p_reservation_id::text || ':rel',
            jsonb_build_object('reservation_id', p_reservation_id, 'reason', 'unused_reservation'))
    returning id into v_ledger_rel;
  end if;

  update public.usage_reservations
     set status = 'SETTLED', settled_credits = v_charge, released_credits = v_release,
         ledger_capture_id = v_ledger_cap, ledger_release_id = COALESCE(v_ledger_rel, ledger_release_id),
         settled_at = now(), updated_at = now(),
         metadata = metadata || jsonb_build_object('clamped', v_clamped)
   where id = p_reservation_id;

  insert into public.usage_events (
    user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
    provider, provider_operation, provider_request_id, model,
    input_tokens, cached_tokens, output_tokens, search_count, provider_units, enrichment_units, duration_ms,
    raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
    charged_credits, reserved_credits, released_credits,
    allowance_funded, billable, outcome, failure_reason, job_ref, metadata
  ) values (
    v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
    v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
    p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id', p_usage->>'model',
    (p_usage->>'input_tokens')::bigint, (p_usage->>'cached_tokens')::bigint, (p_usage->>'output_tokens')::bigint,
    (p_usage->>'search_count')::integer, (p_usage->>'provider_units')::numeric,
    (p_usage->>'enrichment_units')::numeric, (p_usage->>'duration_ms')::integer,
    COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
    COALESCE((p_usage->>'tax_cents')::numeric, 0),
    COALESCE((p_usage->>'fee_cents')::numeric, 0),
    COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
    v_charge, v_res.reserved_credits, v_release,
    false, (v_charge > 0), p_outcome, p_usage->>'failure_reason', v_res.job_ref,
    COALESCE(p_usage->'metadata', '{}'::jsonb) || jsonb_build_object('clamped', v_clamped)
  );

  return query select p_reservation_id, v_charge, v_release, v_after, false, v_clamped;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_release(
  p_reservation_id uuid,
  p_reason text DEFAULT 'execution_failed',
  p_usage jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (reservation_id uuid, released_credits numeric, balance_after numeric, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_res record;
  v_before numeric;
  v_after numeric;
  v_alloc record;
  v_ledger uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  perform set_config('homatch.lots_managed', 'on', true);

  select * into v_res from public.usage_reservations r where r.id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status <> 'RESERVED' then
    select ca.balance into v_after from public.credit_accounts ca where ca.user_id = v_res.user_id;
    return query select v_res.id, v_res.released_credits, v_after, true;
    return;
  end if;

  for v_alloc in
    select a.* from public.credit_lot_allocations a where a.reservation_id = p_reservation_id for update
  loop
    update public.credit_lots
       set credits_reserved = credits_reserved - v_alloc.allocated_credits, updated_at = now()
     where id = v_alloc.lot_id;
    update public.credit_lot_allocations
       set released_credits = v_alloc.allocated_credits where id = v_alloc.id;
  end loop;

  select ca.balance into v_before from public.credit_accounts ca where ca.user_id = v_res.user_id for update;
  v_after := v_before + v_res.reserved_credits;
  update public.credit_accounts
     set balance = v_after, reserved = reserved - v_res.reserved_credits, updated_at = now()
   where user_id = v_res.user_id;

  insert into public.credit_ledger(user_id, amount, balance_before, balance_after, type, reference, metadata)
  values (v_res.user_id, v_res.reserved_credits, v_before, v_after, 'SERVICE_RELEASE',
          'res:' || p_reservation_id::text || ':rel',
          jsonb_build_object('reservation_id', p_reservation_id, 'reason', p_reason))
  returning id into v_ledger;

  update public.usage_reservations
     set status = 'RELEASED', released_credits = v_res.reserved_credits, settled_credits = 0,
         ledger_release_id = v_ledger, failure_reason = p_reason, settled_at = now(), updated_at = now()
   where id = p_reservation_id;

  if v_res.allowance_consumption_id is not null then
    perform public.billing_release_allowance(v_res.allowance_consumption_id, p_reason);
  end if;

  if COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0) > 0
     or COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0) > 0 then
    insert into public.usage_events (
      user_id, reservation_id, product_code, plan_code, quality_tier, pricing_version,
      provider, provider_operation, provider_request_id,
      raw_provider_cost_cents, ai_cost_cents, tax_cents, fee_cents, landed_cogs_cents,
      charged_credits, reserved_credits, released_credits,
      allowance_funded, billable, outcome, failure_reason, job_ref, metadata
    ) values (
      v_res.user_id, p_reservation_id, v_res.product_code, v_res.plan_code_snapshot,
      v_res.quality_tier_snapshot, v_res.pricing_version_snapshot,
      p_usage->>'provider', p_usage->>'provider_operation', p_usage->>'provider_request_id',
      COALESCE((p_usage->>'raw_provider_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'ai_cost_cents')::numeric, 0),
      COALESCE((p_usage->>'tax_cents')::numeric, 0),
      COALESCE((p_usage->>'fee_cents')::numeric, 0),
      COALESCE((p_usage->>'landed_cogs_cents')::numeric, 0),
      0, v_res.reserved_credits, v_res.reserved_credits,
      false, false, 'FAILED', p_reason, v_res.job_ref, COALESCE(p_usage->'metadata','{}'::jsonb)
    );
  end if;

  return query select p_reservation_id, v_res.reserved_credits, v_after, false;
end;
$fn$;

-- Production values (2026-10-10).
insert into public.admin_settings (key, value) values
  ('credits_per_usd', '10'), ('vat_rate_bps', '1800'), ('billing_cogs_tax_bps', '1800'), ('billing_cogs_fee_bps', '0'),
  ('billing_min_gross_margin_bps', '5500'), ('billing_credit_rounding_dp', '2'), ('billing_pricing_version', '2'),
  ('billing_payg_enabled', 'true'), ('billing_reservation_ttl_minutes', '60')
on conflict (key) do nothing;
insert into public.billable_products (code, name, standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps, min_viable_budget_credits, config)
values ('VERIFY', 'Property Verification', 50, 11.8, 3000, 3, '{"pricing_policy":"COST_BASED","estimate_spread_bps":2500}')
on conflict (code) do nothing;
insert into public.billing_plans (code, name, profit_share_to_customer_bps, quality_tier) values
  ('FREE', 'Free', 0, 'STANDARD'), ('VIP', 'VIP', 2500, 'ENHANCED'), ('PREMIUM', 'Premium', 5000, 'MAXIMUM')
on conflict (code) do nothing;
insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, quality_tier, provider_budget_ceiling_cents) values
  ('VERIFY', 'FREE', 3, 'STANDARD', 40), ('VERIFY', 'VIP', 3, 'ENHANCED', 120), ('VERIFY', 'PREMIUM', 3, 'MAXIMUM', 300)
on conflict do nothing;
insert into public.provider_price_book (provider, model, unit, rate, per_units, effective_from) values
  ('OPENAI', 'gpt-5.6-terra', 'INPUT_TOKEN', 2, 1000000, '2026-07-30'),
  ('OPENAI', 'gpt-5.6-terra', 'CACHED_INPUT_TOKEN', 0.2, 1000000, '2026-07-30'),
  ('OPENAI', 'gpt-5.6-terra', 'OUTPUT_TOKEN', 12, 1000000, '2026-07-30'),
  ('OPENAI', 'gpt-5.6-luna', 'INPUT_TOKEN', 0.2, 1000000, '2026-07-30'),
  ('OPENAI', 'gpt-5.6-luna', 'CACHED_INPUT_TOKEN', 0.02, 1000000, '2026-07-30'),
  ('OPENAI', 'gpt-5.6-luna', 'OUTPUT_TOKEN', 1.2, 1000000, '2026-07-30'),
  ('OPENAI', null, 'WEB_SEARCH_CALL', 10, 1000, '2026-07-30');
insert into public.fx_rates (base_currency, quote_currency, rate, source, effective_from) values ('USD', 'USD', 1, 'IDENTITY', '2000-01-01');
