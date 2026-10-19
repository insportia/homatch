-- FINANCE V2 — one financial engine (owner brief "Global Finance Engine V2", 2026-10-19).
-- Evidence and conflicts: docs/claude/FINANCE_V2_MATRIX.md. Rules: docs/claude/BILLING.md.
--
-- Owner decisions (2026-10-19):
--   * Every customer price is final and VAT-inclusive: Georgian VAT 18% applies to every
--     customer (one tax profile; foreign/B2B exceptions are not guessed — a profile change).
--   * Paid discovery campaigns started from this release use paid_discovery_37_63_vat_v2:
--     VAT out first, then 37% HOMATCH / 63% execution of the VAT-exclusive revenue; all
--     provider and AI cost is paid from the 63%. v1 (gross split) campaigns keep their terms.
--   * The 18% COGS uplift (billing_cogs_tax_bps) stays in pricing and is reported apart
--     from actual provider/AI cost.
--
-- What this migration does:
--   1. finance_tax_profiles + finance_vat_bps_at() + finance_split_gross(): the one VAT rule.
--   2. finance_commercial_policies: every pricing policy, versioned, nothing deleted.
--   3. Paid discovery v2: SQL twins of src/research-core/billing/paidDiscoveryPolicy.ts,
--      the pricing_policy checks widened, three functions patched from their exact
--      production bodies to follow the campaign's own policy, and
--      find_buyers_campaign_spend_micros() (the spend a v2 campaign is charged for).
--   4. provider_price_book: gpt-4o-mini (also seeded by 20261119130000_find_property_costs;
--      this insert is skipped when that row exists). Find Property search AI cost is read from
--      the correlated cost_events that migration introduced — one record, never re-priced here.
--   5. finance_services + read-only ledger views (finance_v2_revenue_lines,
--      finance_v2_cost_lines) and admin RPCs for the per-service dashboards.
--
-- Nothing here changes a settled transaction, a wallet balance, a fixed price, Verify's
-- pricing, or a service switch. Views read the existing source tables; no row is rewritten.
-- Rollback: drop the new views/functions/tables; restore the three function bodies from
-- 20261107091700 / 20261114090000 / 20261110100000; the widened checks are harmless.

/* ── 1. VAT ─────────────────────────────────────────────────────────────── */

create table if not exists public.finance_tax_profiles (
  profile_id     text primary key,
  jurisdiction   text not null,
  vat_rate_bps   integer not null check (vat_rate_bps between 0 and 10000),
  price_basis    text not null check (price_basis in ('VAT_INCLUSIVE')),
  applies_to     text not null check (applies_to in ('ALL_CUSTOMERS')),
  effective_from timestamptz not null,
  effective_to   timestamptz,
  note           text not null,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
alter table public.finance_tax_profiles enable row level security;
revoke all on public.finance_tax_profiles from anon, authenticated;
comment on table public.finance_tax_profiles is
  'Finance V2: output VAT rule by period. Customer prices are final and VAT-inclusive; VAT is extracted (gross/1.18), never added on top. Change = a new row, never an edit.';

insert into public.finance_tax_profiles (profile_id, jurisdiction, vat_rate_bps, price_basis, applies_to, effective_from, note)
values ('GE_VAT_18_ALL', 'GE', 1800, 'VAT_INCLUSIVE', 'ALL_CUSTOMERS', '2020-01-01T00:00:00Z',
        'Owner decision 2026-10-19: Georgian VAT 18% inside every customer price, for every customer (HOMATCH stores no customer country or business status). Wallet top-ups are deposits (no VAT); VAT is recognised on consumption.')
on conflict (profile_id) do nothing;

create or replace function public.finance_vat_bps_at(p_at timestamptz)
returns integer language sql stable set search_path = public as $$
  select t.vat_rate_bps from public.finance_tax_profiles t
   where t.effective_from <= p_at and (t.effective_to is null or t.effective_to > p_at)
   order by t.effective_from desc limit 1
$$;
comment on function public.finance_vat_bps_at(timestamptz) is 'Output VAT rate (bps) inside customer prices at a moment; NULL = no profile (reported as tax UNKNOWN, never 0).';

/* gross is VAT-inclusive: net = gross × 10000 / (10000 + bps), VAT = gross − net. Never gross × 18%. */
create or replace function public.finance_split_gross(p_gross_usd numeric, p_vat_bps integer)
returns table (net_usd numeric, vat_usd numeric) language sql immutable set search_path = public, pg_temp as $$
  select case when p_vat_bps is null then null else round(p_gross_usd * 10000 / (10000 + p_vat_bps), 6) end,
         case when p_vat_bps is null then null else p_gross_usd - round(p_gross_usd * 10000 / (10000 + p_vat_bps), 6) end
$$;

/* ── 2. Commercial policies ─────────────────────────────────────────────── */

create table if not exists public.finance_commercial_policies (
  policy_id   text primary key,
  kind        text not null check (kind in ('PERCENT_SPLIT','COST_BASED','COST_BASED_PROFIT_FLOOR','FIXED','FEE_PERCENT','FREE','LEGACY_QUOTE')),
  params      jsonb not null default '{}'::jsonb,
  status      text not null check (status in ('CURRENT','HISTORICAL')),
  description text not null,
  created_at  timestamptz not null default now()
);
alter table public.finance_commercial_policies enable row level security;
revoke all on public.finance_commercial_policies from anon, authenticated;
comment on table public.finance_commercial_policies is
  'Finance V2: every customer pricing policy, versioned. A changed rule is a new policy_id; a campaign/transaction keeps the policy it started under.';

insert into public.finance_commercial_policies (policy_id, kind, params, status, description) values
  ('paid_discovery_37_63_vat_v2', 'PERCENT_SPLIT', '{"executionBps":6300,"homatchBps":3700,"base":"VAT_EXCLUSIVE","vatBps":1800,"charge":"spend x 11800/6300, ceil cent, capped at authorised"}', 'CURRENT',
   'Paid discovery from Finance V2: VAT out first, then 37% HOMATCH / 63% execution of the VAT-exclusive revenue. All provider and AI cost is paid from the execution share. No profit floor.'),
  ('paid_discovery_37_63_v1', 'PERCENT_SPLIT', '{"executionBps":6300,"homatchBps":3700,"base":"GROSS","charge":"spend / 0.63, ceil cent, capped at authorised"}', 'HISTORICAL',
   'Paid discovery 2026-10-16 .. Finance V2: 37/63 of the gross price; VAT outside the split. Campaigns stamped with it keep it.'),
  ('verify_cost_floor_v1', 'COST_BASED_PROFIT_FLOOR', '{"targetMarginBps":5500,"contingencyBps":1000,"minNetProfitUsd":1,"floorAppliesTo":"COMPLETED","vat":"added once on net","source":"billable_products.VERIFY.config.verify_budget"}', 'CURRENT',
   'Verify: net = max((landed + contingency) / (1 - margin), landed + $1 on a completed report); gross = net x 1.18; within the customer authorisation (25 + 25 ... max 100 credits).'),
  ('cost_based_margin_floor_v1', 'COST_BASED', '{"minGrossMarginBps":"admin_settings.billing_min_gross_margin_bps","cogsTaxUpliftBps":"admin_settings.billing_cogs_tax_bps","quote":"billing_price_quote"}', 'CURRENT',
   'AI Chat, Contract Intelligence, Meta Ads AI images, Design Studio renders: billing_price_quote on measured landed COGS with the gross-margin floor. No 37/63, no $ floor.'),
  ('fixed_retail_v1', 'FIXED', '{"source":"billable_products.standard_retail_cents"}', 'CURRENT',
   'Fixed retail price (HOMATCH Leads unlocks, broker directory listing, broker discovery, match unlock price on the match). No split, no floor.'),
  ('meta_ads_fee_v1', 'FEE_PERCENT', '{"feePercent":"admin_settings.meta_ads_fee_percent","base":"media spend","wallet":"meta_ads_ledger (USD)"}', 'CURRENT',
   'Meta Ads service fee: a percentage of media spend; media itself is billed on the customer''s ad account.'),
  ('free_v1', 'FREE', '{}', 'CURRENT', 'Free to the customer. Revenue 0; every provider/AI cost is still recorded as operating cost.'),
  ('legacy_find_buyers_quote', 'LEGACY_QUOTE', '{"providerShareBps":"admin_settings.find_buyers_provider_share_bps","quote":"billing_price_quote"}', 'HISTORICAL',
   'Find Buyers before 2026-10-16: provider ceiling by find_buyers_provider_share_bps, charge by billing_price_quote.'),
  ('legacy_find_property_quote', 'LEGACY_QUOTE', '{"quote":"per delivered listing (findPropertySettlement)"}', 'HISTORICAL',
   'Find Property paid runs before the paid social policy: per-delivered-listing quote.')
on conflict (policy_id) do nothing;

/* ── 3. Paid discovery v2 ───────────────────────────────────────────────── */

/* Widen the pricing_policy CHECKs. Drop whatever check constrains pricing_policy, whatever its
   name, so a differently named v1-only check can never survive and refuse v2 starts; add the
   new one NOT VALID and validate it separately (no long ACCESS EXCLUSIVE scan). */
do $$
declare c record;
begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
            where conrelid in ('public.find_buyers_campaigns'::regclass, 'public.discovery_runs'::regclass)
              and contype = 'c' and pg_get_constraintdef(oid) ilike '%pricing_policy%' loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;
alter table public.find_buyers_campaigns add constraint find_buyers_campaigns_pricing_policy_check
  check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1', 'paid_discovery_37_63_vat_v2')) not valid;
alter table public.find_buyers_campaigns validate constraint find_buyers_campaigns_pricing_policy_check;
alter table public.discovery_runs add constraint discovery_runs_pricing_policy_check
  check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1', 'paid_discovery_37_63_vat_v2')) not valid;
alter table public.discovery_runs validate constraint discovery_runs_pricing_policy_check;

/* SQL twins of allocatePriceMicros / grossForSpendMicros (integer µ$, identical rounding). */
create or replace function public.paid_discovery_execution_micros(p_policy text, p_price_micros numeric)
returns bigint language sql immutable parallel safe as $$
  select case p_policy
    when 'paid_discovery_37_63_vat_v2' then floor(p_price_micros * 6300 / 11800)::bigint
    when 'paid_discovery_37_63_v1'     then floor(p_price_micros * 6300 / 10000)::bigint
  end
$$;
create or replace function public.paid_discovery_gross_for_spend_micros(p_policy text, p_spend_micros numeric)
returns bigint language sql immutable parallel safe as $$
  select case p_policy
    when 'paid_discovery_37_63_vat_v2' then ceil(greatest(p_spend_micros, 0) * 11800 / 6300)::bigint
    when 'paid_discovery_37_63_v1'     then ceil(greatest(p_spend_micros, 0) * 10000 / 6300)::bigint
  end
$$;
revoke all on function public.paid_discovery_execution_micros(text, numeric) from public, anon;
revoke all on function public.paid_discovery_gross_for_spend_micros(text, numeric) from public, anon;
grant execute on function public.paid_discovery_execution_micros(text, numeric) to authenticated, service_role;
grant execute on function public.paid_discovery_gross_for_spend_micros(text, numeric) to authenticated, service_role;

/* What a v2 Find Buyers CUSTOMER is charged for — the find_property_customer_micros rule:
   only Actor runs the provider confirmed (a provider run id), never an ambiguous start
   (HOMATCH's cost of goods); a confirmed run at its actual cost, or at its reservation while
   running / when its cost is unknown (never 0); plus every OpenAI ledger row (analysis AND
   translation) booked while the campaign was open. An UNKNOWN OpenAI row adds nothing here
   (HOMATCH carries it; the ledger reports it UNPRICED). This deliberately differs from the
   BUDGET rule in find_buyers_reserve_actor_run, which holds every reservation to cap spend. */
create or replace function public.find_buyers_campaign_spend_micros(p_matching_job_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select (coalesce((select sum(case
             when r.provider_run_id is null then 0
             when r.status = 'RELEASED' then 0
             when coalesce(r.cost_basis, '') = 'START_AMBIGUOUS' then 0
             when r.actual_micros is not null then r.actual_micros
             else r.reserved_micros end)
           from public.find_buyers_actor_runs r where r.matching_job_id = p_matching_job_id), 0)
        + coalesce((select sum(coalesce(l.actual_micros, l.estimated_micros, 0))
           from public.find_buyers_cost_ledger l
          where l.matching_job_id = p_matching_job_id and l.provider = 'OPENAI'
            and coalesce(l.cost_state, '') not in ('UNKNOWN', 'RELEASED')
            and not coalesce(l.after_settlement, false)), 0))::bigint
$$;
revoke all on function public.find_buyers_campaign_spend_micros(uuid) from public, anon, authenticated;
grant execute on function public.find_buyers_campaign_spend_micros(uuid) to service_role;

/* The three functions below are their exact production bodies (verified by md5 of prosrc,
   2026-10-19) with only the policy lines changed. */
create or replace function public.find_buyers_extend_budget(
  p_user_id uuid, p_job_id uuid, p_total_credits integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_camp record;
  v_existing record;
  v_add integer;
  v_rate numeric := public.billing_setting_num('credits_per_usd', 10);
  v_share numeric;
  v_max numeric := public.billing_setting_num('campaign_max_credits', 100000);
  v_value_micros bigint;
  v_provider_micros bigint;
  v_res record;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_existing from public.find_buyers_budget_extensions where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('duplicate', true, 'totalCredits', v_existing.total_after_credits,
                              'additionalCredits', v_existing.additional_credits, 'reservationId', v_existing.reservation_id);
  end if;

  select * into v_camp from public.find_buyers_campaigns where matching_job_id = p_job_id for update;
  if not found or v_camp.user_id <> p_user_id then raise exception 'UNKNOWN_CAMPAIGN'; end if;
  if v_camp.finalized_at is not null then raise exception 'CAMPAIGN_FINISHED'; end if;
  if p_total_credits is null or p_total_credits > v_max then raise exception 'ABOVE_CAMPAIGN_MAXIMUM'; end if;
  v_add := p_total_credits - coalesce(v_camp.credits_committed, 0);
  if v_add <= 0 then raise exception 'TOTAL_NOT_HIGHER'; end if;

  select * into v_res from public.wallet_reserve(
    p_user_id, 'FIND_CLIENTS', v_add, 'fb-extend:' || p_idempotency_key, v_add, v_add,
    'find_buyers:' || p_job_id::text,
    jsonb_build_object('campaignId', v_camp.campaign_id, 'propertyId', v_camp.property_id,
                       'kind', 'BUDGET_EXTENSION', 'totalAfterCredits', p_total_credits));

  /* The campaign keeps the split it started under: v2 (VAT-first 37/63), v1 (37/63 of
     the gross price), or the legacy admin share for older ones. */
  v_share := case when v_camp.pricing_policy = 'paid_discovery_37_63_v1'
                  then public.paid_discovery_provider_share_bps()
                  else greatest(0, least(9000, public.billing_setting_num('find_buyers_provider_share_bps', 5000))) end;
  v_value_micros := floor((v_add * 1000000.0) / v_rate);
  /* Finance V2: a VAT-first campaign adds 63% of the extension's VAT-exclusive value. */
  v_provider_micros := case when v_camp.pricing_policy = 'paid_discovery_37_63_vat_v2'
                            then public.paid_discovery_execution_micros(v_camp.pricing_policy, v_value_micros)
                            else floor((v_value_micros * v_share) / 10000.0) end;

  insert into public.find_buyers_budget_extensions
    (matching_job_id, user_id, reservation_id, previous_total_credits, additional_credits, total_after_credits,
     provider_budget_added_micros, idempotency_key)
  values (p_job_id, p_user_id, v_res.reservation_id, coalesce(v_camp.credits_committed, 0), v_add, p_total_credits,
          v_provider_micros, p_idempotency_key);

  update public.find_buyers_campaigns
     set credits_committed = p_total_credits,
         customer_value_micros = coalesce(customer_value_micros, 0) + v_value_micros,
         provider_budget_micros = coalesce(provider_budget_micros, 0) + v_provider_micros
   where matching_job_id = p_job_id;

  return jsonb_build_object('duplicate', false, 'totalCredits', p_total_credits, 'additionalCredits', v_add,
                            'reservationId', v_res.reservation_id, 'balanceAfter', v_res.balance_after,
                            'providerBudgetAddedMicros', v_provider_micros);
end $$;

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
  if coalesce(v_run.pricing_policy, '') not in ('paid_discovery_37_63_v1', 'paid_discovery_37_63_vat_v2') or v_run.provider_budget_micros is null then
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

create or replace function public.my_find_property_campaign(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_run public.discovery_runs%rowtype;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_run from public.discovery_runs where id = p_run_id and user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', v_run.id, 'status', v_run.status, 'stage', v_run.stage, 'createdAt', v_run.created_at,
    'deadlineAt', v_run.deadline_at, 'completedAt', v_run.completed_at, 'failureReason', v_run.failure_reason,
    'networks', coalesce(to_jsonb(v_run.offer_networks), '[]'::jsonb), 'policy', v_run.pricing_policy,
    'creditsAuthorized', (v_run.billing_grant ->> 'authorizedMaxCredits')::numeric,
    'creditsCharged', v_run.credits_charged,
    /* Credits the CONFIRMED work so far would cost under the campaign's policy (v1 ÷ 0.63,
       v2 × 1.18 ÷ 0.63), up to the cent, never above the authorised price — the customer's
       figure; provider dollars stay in Admin. */
    'creditsUsed', least(coalesce((v_run.billing_grant ->> 'authorizedMaxCredits')::numeric, 0),
      round(ceil(public.paid_discovery_gross_for_spend_micros(coalesce(v_run.pricing_policy, 'paid_discovery_37_63_v1'),
                   public.find_property_customer_micros(v_run.id)) / 10000.0)
            * coalesce(v_run.credits_per_usd, 10) / 100.0, 2)),
    'offersFound', v_run.offers_found, 'resultsFound', v_run.results_found,
    'unavailable', coalesce(v_run.offer_plan -> 'unavailable', '[]'::jsonb),
    'skippedForBudget', coalesce((v_run.offer_plan ->> 'skippedForBudget')::int, 0),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('network', n, 'planned', planned, 'done', done, 'running', running,
                                 'failed', failed, 'budget', budget) order by n) from (
        select coalesce(q.metadata ->> 'network', q.provider) n,
               count(*) planned,
               count(*) filter (where q.status = 'DONE') done,
               count(*) filter (where q.status in ('PROCESSING', 'RETRY_WAIT', 'PENDING')) running,
               count(*) filter (where q.status = 'FAILED') failed,
               count(*) filter (where q.status = 'BUDGET_REACHED') budget
          from public.discovery_query_queue q where q.discovery_run_id = v_run.id group by 1) s), '[]'::jsonb));
end $$;


/* ── 4. Price book: gpt-4o-mini ─────────────────────────────────────────── */
/* Find Property search and Find Buyers call gpt-4o-mini; with no row here every such call
   was recorded as a "$0 ESTIMATED" cost (estimatedProviderCost turned SQL NULL into 0).
   Public list price, the same figures find_buyers_openai_price_book already uses. */
insert into public.provider_price_book (provider, model, unit, rate, per_units, currency, effective_from, source, notes)
select v.provider, v.model, v.unit, v.rate, 1000000, 'USD', '2024-07-18T00:00:00Z',
       'openai.com/api/pricing (gpt-4o-mini list price; matches admin_settings.find_buyers_openai_price_book)', v.notes
  from (values ('OPENAI', 'gpt-4o-mini', 'INPUT_TOKEN', 0.15::numeric, 'Finance V2 2026-10-19.'),
               ('OPENAI', 'gpt-4o-mini', 'CACHED_INPUT_TOKEN', 0.075::numeric, 'Subset of input_tokens; priced instead of, never in addition to, input.'),
               ('OPENAI', 'gpt-4o-mini', 'OUTPUT_TOKEN', 0.60::numeric, 'Finance V2 2026-10-19.')) v(provider, model, unit, rate, notes)
 where not exists (select 1 from public.provider_price_book b
                    where b.provider = v.provider and b.model = v.model and b.unit = v.unit and b.effective_to is null);

/* ── 5. Services and the read-only ledger ───────────────────────────────── */

create table if not exists public.finance_services (
  service_key         text primary key,
  name                text not null,
  product_codes       text[] not null default '{}',
  policy_id           text not null references public.finance_commercial_policies(policy_id),
  pricing_kind        text not null check (pricing_kind in ('FIXED','VARIABLE','FREE','FEE_PERCENT','SHARED')),
  price_note          text not null,
  service_control_key text,
  sort_order          integer not null default 100
);
alter table public.finance_services enable row level security;
revoke all on public.finance_services from anon, authenticated;
comment on table public.finance_services is 'Finance V2: every HOMATCH service, its products, current policy and price source (docs/claude/FINANCE_V2_MATRIX.md).';

insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note, service_control_key, sort_order) values
  ('verify', 'Verify', '{VERIFY}', 'verify_cost_floor_v1', 'VARIABLE', 'Cost-based; $1 net-profit floor on completed reports; 25 credits to start, +25 per approval, max 100', 'verify', 10),
  ('find_buyers', 'Find Buyers / Tenants', '{FIND_CLIENTS}', 'paid_discovery_37_63_vat_v2', 'VARIABLE', 'Customer budget (minimum find_buyers_min_usd); charged for execution consumed, capped', 'find_buyers', 20),
  ('find_property_search', 'Find Property search', '{}', 'free_v1', 'FREE', 'Free (HOMATCH + portals)', 'find_property', 30),
  ('find_property_paid', 'Find Property paid campaigns', '{FIND_PROPERTY}', 'paid_discovery_37_63_vat_v2', 'VARIABLE', 'From 50 credits ($5); charged for execution consumed, capped (paused)', 'find_property_deep', 40),
  ('homatch_leads', 'HOMATCH Leads unlocks', '{INTERNAL_LEAD_EXACT,INTERNAL_LEAD_STANDARD,INTERNAL_LEAD_PREMIUM}', 'fixed_retail_v1', 'FIXED', 'Per contact: Exact $0.50 / Nearby or similar $0.30 / VIP $1.00 (billable_products)', 'find_buyers', 50),
  ('match_unlocks', 'Match contact unlocks', '{}', 'fixed_retail_v1', 'FIXED', 'Price stored on each match (matches.unlock_price_credits)', 'find_buyers', 55),
  ('contract_intelligence', 'Contract Intelligence', '{CONTRACT_INTELLIGENCE}', 'cost_based_margin_floor_v1', 'VARIABLE', 'Cost-based quote, 55% margin floor', 'contracts', 60),
  ('ai_chat', 'HOMATCH AI chat', '{AI_CHAT_RESPONSE}', 'cost_based_margin_floor_v1', 'VARIABLE', 'Cost-based quote per answer; anonymous turns free', 'ai_assistant', 70),
  ('meta_ads_ai', 'Meta Ads AI', '{META_AD_IMAGE_GEN}', 'cost_based_margin_floor_v1', 'VARIABLE', 'AI images: cost-based quote per delivered image; analysis free', 'meta_ads', 80),
  ('meta_ads_fee', 'Meta Ads service fee', '{}', 'meta_ads_fee_v1', 'FEE_PERCENT', 'meta_ads_fee_percent of media spend (USD wallet)', 'meta_ads', 85),
  ('broker_directory', 'Broker directory listing', '{BROKER_DIRECTORY_LISTING}', 'fixed_retail_v1', 'FIXED', '$29 per 30 days', 'brokers_directory', 90),
  ('broker_discovery', 'Broker discovery', '{BROKER_DISCOVERY}', 'fixed_retail_v1', 'FIXED', '$0.20 per new broker found', null, 95),
  ('design_studio', 'Design Studio', '{DS_FLOORPLAN_READ,DS_AI_DESIGN,DS_RECONSTRUCT,DS_MASTER_RENDER,DS_ROOM_RENDER,DS_RENDER_EDIT,DS_WALKTHROUGH}', 'free_v1', 'FREE', 'Free while design_studio_billing_enabled is off', 'design_studio', 100),
  ('ai_talk', 'AI Talk', '{AI_TALK}', 'free_v1', 'FREE', 'Free allowance (seconds per session/day)', 'ai_talk', 110),
  ('email_studio', 'Email Studio', '{EMAIL_CAMPAIGN}', 'free_v1', 'FREE', 'Free (sending disabled)', 'email_campaigns', 120),
  ('shared_platform', 'Shared platform intelligence', '{}', 'free_v1', 'SHARED', 'Background AI not tied to one customer execution (signal classification, chat assistants)', null, 900),
  ('retired_providers', 'Retired providers (history)', '{}', 'free_v1', 'SHARED', 'DATAFORSEO / generic APIFY spend before retirement — preserved history, never reactivated', null, 950),
  ('unattributed', 'Unattributed provider cost', '{}', 'free_v1', 'SHARED', 'Recorded provider cost with no service mapping yet — never dropped', null, 999)
on conflict (service_key) do nothing;

create or replace function public.finance_cost_status(p_state text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case upper(coalesce(p_state, 'ESTIMATED'))
    when 'ACTUAL' then 'ACTUAL' when 'ZERO_REAL' then 'ACTUAL'
    when 'PARTIAL' then 'PARTIALLY_PRICED' when 'UNPRICED' then 'UNPRICED' when 'UNKNOWN' then 'UNPRICED'
    else 'ESTIMATED' end
$$;

/* Credits → USD at the time of the line (1 credit = $1 before the 2026-09-11 redenomination). */
create or replace function public.finance_credits_to_usd(p_credits numeric, p_at timestamptz)
returns numeric language sql stable set search_path = public as $$
  select round(p_credits / case when p_at < coalesce((select min(created_at) from public.credit_ledger where type::text = 'REDENOMINATION'), '-infinity'::timestamptz)
                                then 1 else public.billing_setting_num('credits_per_usd', 10) end, 6)
$$;

/* Every customer charge, one row each. gross is the VAT-inclusive amount the customer paid. */
create or replace view public.finance_v2_revenue_lines with (security_invoker = true) as
with base as (
  /* A charged product no service lists still counts — as 'unattributed', never dropped. */
  select 'usage:' || u.id::text as line_id, coalesce(s.service_key, 'unattributed') as service_key,
         case when u.product_code in ('FIND_CLIENTS', 'FIND_PROPERTY') then coalesce(u.provider_request_id, u.job_ref, u.id::text)
              else coalesce(u.job_ref, u.id::text) end as execution_id,
         u.created_at as occurred_at, u.user_id, u.product_code, u.charged_credits as credits,
         public.finance_credits_to_usd(u.charged_credits, u.created_at) as gross_usd,
         u.released_credits,
         case when u.product_code = 'FIND_CLIENTS' then coalesce(fbc.pricing_policy, 'legacy_find_buyers_quote')
              when u.product_code = 'FIND_PROPERTY' then coalesce(dr.pricing_policy, 'legacy_find_property_quote')
              else s.policy_id end as policy_id,
         coalesce((u.metadata ->> 'profit_floor_shortfall')::boolean, false) as profit_floor_shortfall,
         'usage_events'::text as source
    from public.usage_events u
    left join public.finance_services s on u.product_code = any (s.product_codes)
    left join public.find_buyers_campaigns fbc on u.product_code = 'FIND_CLIENTS' and fbc.matching_job_id::text = u.provider_request_id
    left join public.discovery_runs dr on u.product_code = 'FIND_PROPERTY' and dr.id::text = u.provider_request_id
   where u.charged_credits > 0
  union all
  select 'ledger:' || l.id::text,
         case l.type::text when 'MATCH_UNLOCK' then 'match_unlocks' when 'BROKER_DIRECTORY_LISTING' then 'broker_directory' else 'broker_discovery' end,
         coalesce(l.reference, l.id::text), l.created_at, l.user_id, l.type::text, -l.amount,
         public.finance_credits_to_usd(-l.amount, l.created_at), 0, 'fixed_retail_v1', false, 'credit_ledger'
    from public.credit_ledger l
   where l.type::text in ('MATCH_UNLOCK', 'BROKER_DIRECTORY_LISTING', 'BROKER_DISCOVERY') and l.amount < 0
  union all
  select 'meta:' || m.id::text, 'meta_ads_fee', coalesce(m.campaign_id::text, m.id::text), m.created_at, m.user_id, m.entry_type::text, null,
         -m.amount_cents / 100.0, 0, /* HOMATCH_FEE is stored negative (revenue), FEE_RELEASE positive (refund) */
         'meta_ads_fee_v1', false, 'meta_ads_ledger'
    from public.meta_ads_ledger m
   where m.entry_type::text in ('HOMATCH_FEE', 'FEE_RELEASE') and upper(coalesce(m.currency, 'USD')) = 'USD'
)
select b.*, t.vat_bps, sp.net_usd, sp.vat_usd,
       case when b.policy_id = 'paid_discovery_37_63_vat_v2' then round(sp.net_usd * 0.37, 6)
            when b.policy_id = 'paid_discovery_37_63_v1' then round(b.gross_usd * 0.37, 6) end as homatch_allocation_usd,
       case when b.policy_id = 'paid_discovery_37_63_vat_v2' then round(sp.net_usd * 0.63, 6)
            when b.policy_id = 'paid_discovery_37_63_v1' then round(b.gross_usd * 0.63, 6) end as execution_allocation_usd
  from base b
  cross join lateral (select public.finance_vat_bps_at(b.occurred_at) as vat_bps) t
  cross join lateral public.finance_split_gross(b.gross_usd, t.vat_bps) sp;
comment on view public.finance_v2_revenue_lines is
  'Finance V2: every customer charge (wallet settlements, direct debits, Meta fee; fee releases negative). gross = VAT-inclusive; VAT extracted per finance_tax_profiles; allocation only for 37/63 policies (v1 on gross, v2 on VAT-exclusive).';

/* Every directly attributable provider / AI cost, one row each, from its authoritative source.
   cost_usd is NULL (never 0) when the line cannot be priced. */
create or replace view public.finance_v2_cost_lines with (security_invoker = true) as
with ce as (
  select c.*,
         case
           when c.job_id is not null and (c.operation_type like 'VERIFY\_%' or c.operation_type in ('REPORT_TRANSLATION_VERIFY', 'DEVELOPER_ADS_VERIFY')) then 'verify'
           /* Find Property search AI: cost_events is the correlated record (20261119130000_find_property_costs:
              search id in correlation_id, model, tokens; PARTIAL = lower bound) — read here, never re-priced. */
           when c.operation_type like 'MARKETPLACE\_%' then 'find_property_search'
           when c.operation_type like 'FIND\_BUYERS%' or c.operation_type in ('FIND_PROPERTY_ACTOR_RUN', 'CAPTCHA_SOLVE') then null
           when c.operation_type = 'MATCH_UNLOCK' then null /* a $0 marker row, not a cost */
           when c.provider::text in ('DATAFORSEO', 'APIFY') then 'retired_providers'
           when c.operation_type ilike 'meta\_ads%' then 'meta_ads_ai'
           when c.operation_type ilike '%email%' or c.source ilike '%email%' then 'email_studio'
           when c.operation_type = 'CLASSIFY_SIGNALS_V2' or c.operation_type ilike '%chat%' then 'shared_platform'
           else 'unattributed' end as service_key
    from public.cost_events c
)
select 'ce:' || ce.id::text as line_id, ce.service_key, coalesce(ce.job_id::text, ce.correlation_id, ce.request_id, ce.discovery_job_id::text) as execution_id,
       ce."timestamp" as occurred_at, ce.provider::text as provider, ce.operation_type as operation, ce.model,
       ce.units, case when ce.input_tokens is not null or ce.output_tokens is not null then 'TOKENS' else 'UNIT' end as unit_label,
       ce.input_tokens::bigint, ce.cached_input_tokens::bigint as cached_tokens, ce.output_tokens::bigint,
       null::numeric as unit_price_usd,
       case when public.finance_cost_status(ce.pricing_state) = 'UNPRICED' then null else ce.cost_usd end as cost_usd,
       public.finance_cost_status(ce.pricing_state) as cost_status, 'cost_events'::text as cost_source, true as is_direct
  from ce where ce.service_key is not null
union all
select 'captcha:' || v.id::text, 'verify', v.job_id::text, v.created_at, coalesce(v.provider, '2CAPTCHA'), 'CAPTCHA_SOLVE ' || coalesce(v.kind, ''), null,
       1, 'SOLVE', null, null, null, v.cost_usd, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'verify_captcha_events', true
  from public.verify_captcha_events v where v.job_id is not null
union all
select 'fbrun:' || r.id::text, 'find_buyers', r.matching_job_id::text, coalesce(r.finished_at, r.created_at), 'APIFY_MEMO23',
       coalesce(r.operation, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null and r.cost_basis = 'PROVIDER_REPORTED' then 'ACTUAL' else 'ESTIMATED' end,
       'find_buyers_actor_runs', true
  from public.find_buyers_actor_runs r where r.status <> 'RELEASED'
union all
select 'fbai:' || l.id::text, 'find_buyers', l.matching_job_id::text, l.occurred_at, 'OPENAI', l.kind || ' · ' || coalesce(l.operation, ''), l.model,
       coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0), 'TOKENS', l.input_tokens, null, l.output_tokens, null,
       case when upper(coalesce(l.cost_state, '')) = 'UNKNOWN' then null else coalesce(l.actual_micros, l.estimated_micros) / 1e6 end,
       public.finance_cost_status(l.cost_state), 'find_buyers_cost_ledger', true
  from public.find_buyers_cost_ledger l where l.provider = 'OPENAI' and upper(coalesce(l.cost_state, '')) <> 'RELEASED'
union all
select 'fprun:' || r.id::text, 'find_property_paid', r.discovery_run_id::text, r.created_at, 'APIFY_MEMO23',
       coalesce(r.stage, 'ACTOR_RUN') || ' · ' || r.actor_key, null, r.results_billed, 'RESULTS', null, null, null, null,
       coalesce(r.actual_micros, r.reserved_micros) / 1e6,
       case when r.actual_micros is not null then 'ACTUAL' else 'ESTIMATED' end, 'find_property_actor_runs', true
  from public.find_property_actor_runs r where r.status <> 'RELEASED'
union all
select 'usage:' || u.id::text, coalesce(s.service_key, 'unattributed'), coalesce(u.job_ref, u.id::text), u.created_at, coalesce(u.provider, 'OPENAI'),
       coalesce(u.provider_operation, u.product_code), u.model,
       coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0), 'TOKENS', u.input_tokens, u.cached_tokens, u.output_tokens, null,
       case when st.status = 'UNPRICED' then null else round((coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0)) / 100.0, 8) end,
       st.status, 'usage_events', true
  from public.usage_events u
  left join public.finance_services s on u.product_code = any (s.product_codes)
  cross join lateral (select case
      /* An OpenAI call with tokens but no rate at the time is UNPRICED, whatever 0 was stored
         (billing_ai_cost_cents turns a missing rate into 0). */
      when coalesce(u.provider, 'OPENAI') = 'OPENAI' and u.model is not null and coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0
       and (public.price_per_unit_at('OPENAI', u.model, 'INPUT_TOKEN', u.created_at) is null
            or public.price_per_unit_at('OPENAI', u.model, 'OUTPUT_TOKEN', u.created_at) is null) then 'UNPRICED'
      else public.finance_cost_status(coalesce(u.metadata ->> 'pricing_state', u.pricing_state)) end as status) st
 where u.product_code not in ('VERIFY', 'FIND_CLIENTS', 'FIND_PROPERTY')
   and (coalesce(u.raw_provider_cost_cents, 0) + coalesce(u.ai_cost_cents, 0) > 0 or coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0) > 0)
union all
select 'voice:' || v.id::text, 'ai_talk', v.session_id::text, v.occurred_at, v.provider, coalesce(v.role, 'VOICE'), v.model,
       coalesce(v.characters::numeric, v.audio_seconds::numeric, (coalesce(v.input_tokens, 0) + coalesce(v.output_tokens, 0))::numeric),
       case when v.characters is not null then 'CHARACTERS' when v.audio_seconds is not null then 'AUDIO_SECONDS' else 'TOKENS' end,
       v.input_tokens, v.cached_input_tokens, v.output_tokens, null, v.cost_usd,
       case when v.cost_usd is null then 'UNPRICED' else 'ESTIMATED' end, 'voice_usage_events', true
  from public.voice_usage_events v;
comment on view public.finance_v2_cost_lines is
  'Finance V2: every directly attributable provider/AI cost, from its authoritative source (Verify cost_events + CAPTCHA, Find Buyers actor runs + OpenAI ledger, Find Property search telemetry + paid actor runs, usage_events for cost-based products, voice_usage_events). cost_usd NULL = UNPRICED, never 0. Superseded duplicates (cost_events copies of ledgered rows) are excluded.';

revoke all on public.finance_v2_revenue_lines, public.finance_v2_cost_lines from anon, authenticated;

/* ── 6. Admin RPCs: per-service dashboards, execution drill-down, quote ──── */

create or replace function public.finance_v2_services(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.finance_require_admin();
  return coalesce((
    with rev as (
      select service_key, count(*) filter (where gross_usd > 0) charges, sum(gross_usd) gross, sum(vat_usd) vat, sum(net_usd) net,
             sum(homatch_allocation_usd) homatch_alloc, sum(execution_allocation_usd) exec_alloc,
             sum(case when gross_usd < 0 then -gross_usd else 0 end) refunds,
             sum(public.finance_credits_to_usd(coalesce(released_credits, 0), occurred_at)) unused_usd,
             count(*) filter (where profit_floor_shortfall) floor_shortfalls,
             count(*) filter (where vat_bps is null) tax_unknown
        from public.finance_v2_revenue_lines where occurred_at >= p_from and occurred_at < p_to group by 1),
    cost as (
      select service_key, count(*) lines, sum(cost_usd) cogs,
             sum(cost_usd) filter (where upper(provider) in ('OPENAI', 'ANTHROPIC', 'GEMINI', 'GOOGLE', 'CARTESIA', 'ELEVENLABS')) ai_cogs,
             sum(cost_usd) filter (where cost_status = 'ACTUAL') actual_cogs,
             sum(cost_usd) filter (where cost_status = 'ESTIMATED') estimated_cogs,
             count(*) filter (where cost_status = 'UNPRICED') unpriced_lines,
             count(*) filter (where cost_status = 'PARTIALLY_PRICED') partial_lines
        from public.finance_v2_cost_lines where occurred_at >= p_from and occurred_at < p_to group by 1),
    ex as (
      select service_key, count(distinct execution_id) executions from (
        select service_key, execution_id from public.finance_v2_revenue_lines where occurred_at >= p_from and occurred_at < p_to
        union select service_key, execution_id from public.finance_v2_cost_lines where occurred_at >= p_from and occurred_at < p_to) x group by 1),
    sc as (select service_key, frontend_enabled, backend_enabled from public.service_controls_public())
    select jsonb_agg(jsonb_build_object(
      'service', s.service_key, 'name', s.name, 'policy', s.policy_id, 'pricingKind', s.pricing_kind, 'priceNote', s.price_note,
      'productCodes', to_jsonb(s.product_codes),
      'live', case when s.service_control_key is null then null else jsonb_build_object('frontend', sc.frontend_enabled, 'backend', sc.backend_enabled) end,
      'executions', coalesce(ex.executions, 0), 'charges', coalesce(rev.charges, 0),
      'grossUsd', round(coalesce(rev.gross, 0), 6), 'vatUsd', round(coalesce(rev.vat, 0), 6), 'netUsd', round(coalesce(rev.net, 0), 6),
      'homatchAllocationUsd', round(rev.homatch_alloc, 6), 'executionAllocationUsd', round(rev.exec_alloc, 6),
      'refundsUsd', round(coalesce(rev.refunds, 0), 6), 'unusedBudgetUsd', round(coalesce(rev.unused_usd, 0), 6),
      'cogsUsd', round(coalesce(cost.cogs, 0), 8), 'aiCogsUsd', round(coalesce(cost.ai_cogs, 0), 8),
      'providerCogsUsd', round(coalesce(cost.cogs, 0) - coalesce(cost.ai_cogs, 0), 8),
      'actualCogsUsd', round(coalesce(cost.actual_cogs, 0), 8), 'estimatedCogsUsd', round(coalesce(cost.estimated_cogs, 0), 8),
      'costLines', coalesce(cost.lines, 0), 'unpricedLines', coalesce(cost.unpriced_lines, 0), 'partialLines', coalesce(cost.partial_lines, 0),
      'profitUsd', round(coalesce(rev.net, 0) - coalesce(cost.cogs, 0), 6),
      'marginBps', case when coalesce(rev.net, 0) > 0 then round((rev.net - coalesce(cost.cogs, 0)) / rev.net * 10000) end,
      'avgCostPerExecutionUsd', case when coalesce(ex.executions, 0) > 0 then round(coalesce(cost.cogs, 0) / ex.executions, 8) end,
      'profitFloorShortfalls', coalesce(rev.floor_shortfalls, 0), 'taxUnknownLines', coalesce(rev.tax_unknown, 0))
      order by s.sort_order)
    from public.finance_services s
    left join rev on rev.service_key = s.service_key
    left join cost on cost.service_key = s.service_key
    left join ex on ex.service_key = s.service_key
    left join sc on sc.service_key = s.service_control_key
  ), '[]'::jsonb);
end $$;

create or replace function public.finance_v2_service_detail(p_service text, p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_summary jsonb;
begin
  perform public.finance_require_admin();
  select e into v_summary from jsonb_array_elements(public.finance_v2_services(p_from, p_to)) e where e ->> 'service' = p_service;
  if v_summary is null then raise exception 'UNKNOWN_SERVICE'; end if;
  return jsonb_build_object(
    'summary', v_summary,
    'policy', (select to_jsonb(p) from public.finance_commercial_policies p where p.policy_id = v_summary ->> 'policy'),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'executions', n, 'grossUsd', round(g, 6), 'netUsd', round(nt, 6), 'cogsUsd', round(c, 8), 'profitUsd', round(nt - c, 6)) order by d)
      from (select d, count(distinct execution_id) n, sum(gross) g, sum(net) nt, sum(cogs) c from (
              select occurred_at::date d, execution_id, gross_usd gross, net_usd net, 0::numeric cogs from public.finance_v2_revenue_lines
               where service_key = p_service and occurred_at >= p_from and occurred_at < p_to
              union all
              select occurred_at::date, execution_id, 0, 0, coalesce(cost_usd, 0) from public.finance_v2_cost_lines
               where service_key = p_service and occurred_at >= p_from and occurred_at < p_to) x group by d) t), '[]'::jsonb),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'lines', n, 'costUsd', round(c, 8), 'unpriced', u) order by c desc nulls last)
      from (select provider, model, count(*) n, sum(cost_usd) c, count(*) filter (where cost_status = 'UNPRICED') u
              from public.finance_v2_cost_lines where service_key = p_service and occurred_at >= p_from and occurred_at < p_to group by 1, 2) t), '[]'::jsonb),
    'executions', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('executionId', execution_id, 'at', max(at), 'grossUsd', round(sum(gross), 6), 'vatUsd', round(sum(vat), 6),
               'netUsd', round(sum(net), 6), 'executionAllocationUsd', round(sum(alloc), 6), 'cogsUsd', round(sum(cogs), 8),
               'profitUsd', round(sum(net) - sum(cogs), 6), 'costLines', sum(lines), 'unpricedLines', sum(unpriced)) x
        from (select execution_id, occurred_at at, gross_usd gross, vat_usd vat, net_usd net, execution_allocation_usd alloc, 0::numeric cogs, 0 lines, 0 unpriced
                from public.finance_v2_revenue_lines where service_key = p_service and occurred_at >= p_from and occurred_at < p_to
              union all
              select execution_id, occurred_at, 0, 0, 0, null, coalesce(cost_usd, 0), 1, case when cost_status = 'UNPRICED' then 1 else 0 end
                from public.finance_v2_cost_lines where service_key = p_service and occurred_at >= p_from and occurred_at < p_to) y
       group by execution_id order by max(at) desc limit 200) z), '[]'::jsonb));
end $$;

/* One execution: CUSTOMER PAYMENT → VAT → NET → POLICY ALLOCATION → each provider/AI line → COGS → PROFIT. */
create or replace function public.finance_v2_execution(p_service text, p_execution_id text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rev jsonb; v_cost jsonb; v_gross numeric; v_net numeric; v_vat numeric; v_alloc numeric; v_home numeric; v_cogs numeric; v_unpriced int;
begin
  perform public.finance_require_admin();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at), '[]'::jsonb), sum(gross_usd), sum(net_usd), sum(vat_usd),
         sum(execution_allocation_usd), sum(homatch_allocation_usd)
    into v_rev, v_gross, v_net, v_vat, v_alloc, v_home
    from public.finance_v2_revenue_lines r where r.service_key = p_service and r.execution_id = p_execution_id;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_at), '[]'::jsonb), sum(cost_usd), count(*) filter (where cost_status = 'UNPRICED')
    into v_cost, v_cogs, v_unpriced
    from public.finance_v2_cost_lines c where c.service_key = p_service and c.execution_id = p_execution_id;
  return jsonb_build_object('service', p_service, 'executionId', p_execution_id,
    'chain', jsonb_build_object('grossUsd', round(coalesce(v_gross, 0), 6), 'vatUsd', round(coalesce(v_vat, 0), 6), 'netUsd', round(coalesce(v_net, 0), 6),
      'homatchAllocationUsd', round(v_home, 6), 'executionAllocationUsd', round(v_alloc, 6),
      'cogsUsd', round(coalesce(v_cogs, 0), 8), 'unpricedLines', coalesce(v_unpriced, 0),
      'unusedExecutionUsd', case when v_alloc is not null then round(greatest(v_alloc - coalesce(v_cogs, 0), 0), 6) end,
      'profitUsd', round(coalesce(v_net, 0) - coalesce(v_cogs, 0), 6), 'profitComplete', coalesce(v_unpriced, 0) = 0),
    'revenue', v_rev, 'costs', v_cost);
end $$;

/* The pricing simulator's server formula for a gross price under a policy — the same
   functions production uses, never a frontend copy. */
create or replace function public.finance_v2_quote(p_policy text, p_gross_usd numeric, p_cost_usd numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_bps int := public.finance_vat_bps_at(now()); v_net numeric; v_vat numeric; v_exec numeric; v_home numeric; v_kind text;
begin
  perform public.finance_require_admin();
  select kind into v_kind from public.finance_commercial_policies where policy_id = p_policy;
  if v_kind is null then raise exception 'UNKNOWN_POLICY'; end if;
  if p_gross_usd is null or p_gross_usd < 0 then raise exception 'INVALID_PRICE'; end if;
  select net_usd, vat_usd into v_net, v_vat from public.finance_split_gross(p_gross_usd, v_bps);
  if p_policy in ('paid_discovery_37_63_vat_v2', 'paid_discovery_37_63_v1') then
    v_exec := public.paid_discovery_execution_micros(p_policy, round(p_gross_usd * 1e6)) / 1e6;
    v_home := case when p_policy = 'paid_discovery_37_63_vat_v2' then v_net - v_exec else p_gross_usd - v_exec end;
  end if;
  return jsonb_build_object('policy', p_policy, 'kind', v_kind, 'vatBps', v_bps, 'grossUsd', p_gross_usd,
    'vatUsd', v_vat, 'netUsd', v_net, 'homatchAllocationUsd', round(v_home, 6), 'executionAllocationUsd', round(v_exec, 6),
    'costUsd', coalesce(p_cost_usd, 0),
    'withinExecution', case when v_exec is null then null else coalesce(p_cost_usd, 0) <= v_exec end,
    'chargeForCostCredits', case when v_exec is null then null
         else least(round(p_gross_usd * public.billing_setting_num('credits_per_usd', 10), 2),
                    ceil(public.paid_discovery_gross_for_spend_micros(p_policy, round(coalesce(p_cost_usd, 0) * 1e6)) / 10000.0)
                      * public.billing_setting_num('credits_per_usd', 10) / 100.0) end,
    'profitUsd', round(v_net - coalesce(p_cost_usd, 0), 6));
end $$;

/* Helpers: no implicit PUBLIC/anon execute (Supabase default privileges). The admin RPCs run
   as definer; service_role keeps direct use. */
revoke all on function public.finance_vat_bps_at(timestamptz) from public, anon;
revoke all on function public.finance_split_gross(numeric, integer) from public, anon;
revoke all on function public.finance_cost_status(text) from public, anon;
revoke all on function public.finance_credits_to_usd(numeric, timestamptz) from public, anon;
grant execute on function public.finance_vat_bps_at(timestamptz) to service_role;
grant execute on function public.finance_split_gross(numeric, integer) to service_role;
grant execute on function public.finance_cost_status(text) to service_role;
grant execute on function public.finance_credits_to_usd(numeric, timestamptz) to service_role;
revoke all on function public.finance_v2_services(timestamptz, timestamptz) from public, anon;
revoke all on function public.finance_v2_service_detail(text, timestamptz, timestamptz) from public, anon;
revoke all on function public.finance_v2_execution(text, text) from public, anon;
revoke all on function public.finance_v2_quote(text, numeric, numeric) from public, anon;
grant execute on function public.finance_v2_services(timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_v2_service_detail(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.finance_v2_execution(text, text) to authenticated;
grant execute on function public.finance_v2_quote(text, numeric, numeric) to authenticated;
