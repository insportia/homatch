-- Paid external discovery pricing policy (owner decision 2026-10-16).
--
-- HOMATCH profit = 37% of the total price P, external provider budget = 63%
-- (55% − 18%·P / 45% + 18%·P). No VAT uplift enters the split. Charging is
-- consumed provider spend ÷ 0.63, capped at the authorised price (the wallet
-- reservation clamps it). TS twin: src/research-core/billing/paidDiscoveryPolicy.ts.
--
-- Prospective only: a campaign is under the policy when its pricing_policy is
-- set, which only campaigns started after this release are. Existing rows,
-- reservations and ledger entries are not touched.
--
-- Rollback: campaigns stamped with the policy keep their stored budgets; to stop
-- applying it to new campaigns, deploy edge code that no longer stamps it. The
-- column and function are additive and can stay.

alter table public.find_buyers_campaigns
  add column if not exists pricing_policy text
  check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1'));

comment on column public.find_buyers_campaigns.pricing_policy is
  'Pricing policy the campaign started under. paid_discovery_37_63_v1 = provider budget 63% of price, charge = provider spend / 0.63 capped at the reservation. NULL = legacy find_buyers_provider_share_bps split and billing_price_quote charge.';

/* The SQL twin of PAID_DISCOVERY_PROVIDER_BPS. Immutable: changing it is a new policy id, never an edit. */
create or replace function public.paid_discovery_provider_share_bps()
returns integer language sql immutable parallel safe as $$ select 6300 $$;
comment on function public.paid_discovery_provider_share_bps() is
  'Paid discovery policy paid_discovery_37_63_v1: external provider share of the total price, basis points (63%). HOMATCH keeps 3700 bps.';
grant execute on function public.paid_discovery_provider_share_bps() to authenticated, service_role;

/* Same body as 20261028120000, except the share follows the campaign's policy. */
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

  /* The campaign keeps the split it started under: the owner's 37/63 policy for
     campaigns stamped with it, the legacy admin share for older ones. */
  v_share := case when v_camp.pricing_policy = 'paid_discovery_37_63_v1'
                  then public.paid_discovery_provider_share_bps()
                  else greatest(0, least(9000, public.billing_setting_num('find_buyers_provider_share_bps', 5000))) end;
  v_value_micros := floor((v_add * 1000000.0) / v_rate);
  v_provider_micros := floor((v_value_micros * v_share) / 10000.0);

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
revoke all on function public.find_buyers_extend_budget(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.find_buyers_extend_budget(uuid, uuid, integer, text) to service_role;
