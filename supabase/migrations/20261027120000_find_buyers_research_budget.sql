-- FIND BUYERS — the Research budget in credits, and taking a running search further.
--
-- 1. The approved budget ladder: 100 / 500 / 1,000 / 1,500 / 2,000 credits plus a
--    custom amount, starting at 100 (10 credits = $1). The customer chooses the TOTAL
--    research budget.
-- 2. "Expand Research": raising a campaign's TOTAL budget authorises only the
--    difference (100 → 500 reserves 400), as its own wallet reservation, and widens the
--    campaign's provider ceiling by what that difference buys. Findings already saved
--    stay; nothing already done is bought twice.
-- 3. At finalize the campaign is charged once for what it actually used: the original
--    reservation first, then each extension in order, every unused credit released.
--
-- External research only. Internal HOMATCH Leads unlocks are a separate product
-- (20261027090000) and never touch these reservations. Append-only; applies twice.

insert into public.admin_settings (key, value)
values ('search_budget_presets_find_clients', '[100, 500, 1000, 1500, 2000]'::jsonb),
       ('search_budget_recommended_find_clients', '100'::jsonb)
on conflict (key) do update set value = excluded.value
  where public.admin_settings.value in ('[50, 100, 200, 500]'::jsonb, '50'::jsonb);

create table if not exists public.find_buyers_budget_extensions (
  id                    uuid primary key default gen_random_uuid(),
  matching_job_id       uuid not null references public.find_buyers_campaigns(matching_job_id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  reservation_id        uuid not null references public.usage_reservations(id),
  previous_total_credits integer not null,
  additional_credits    integer not null check (additional_credits > 0),
  total_after_credits   integer not null,
  provider_budget_added_micros bigint not null default 0,
  idempotency_key       text not null unique,
  status                text not null default 'RESERVED' check (status in ('RESERVED', 'SETTLED')),
  settled_credits       numeric(12,4),
  created_at            timestamptz not null default now(),
  settled_at            timestamptz
);
create index if not exists find_buyers_budget_extensions_job on public.find_buyers_budget_extensions (matching_job_id, created_at);
alter table public.find_buyers_budget_extensions enable row level security;
revoke all on public.find_buyers_budget_extensions from anon, authenticated;

/*
 * find_buyers_extend_budget(user, job, new TOTAL credits, idempotency key) — service_role
 * (match-campaign, which has authenticated the owner). Serialised on the campaign row.
 */
create or replace function public.find_buyers_extend_budget(
  p_user_id uuid, p_job_id uuid, p_total_credits integer, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_camp record;
  v_existing record;
  v_add integer;
  v_rate numeric := public.billing_setting_num('credits_per_usd', 10);
  v_share numeric := greatest(0, least(9000, public.billing_setting_num('find_buyers_provider_share_bps', 5000)));
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

/*
 * Settle the extensions with what the campaign used beyond its original reservation.
 * p_remaining_credits = 0 releases every extension in full (a failed run, or a run the
 * original reservation already covered). Idempotent: settled rows are skipped.
 */
create or replace function public.find_buyers_settle_extensions(p_job_id uuid, p_remaining_credits numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_left numeric := greatest(0, coalesce(p_remaining_credits, 0));
  v_ext record;
  v_take numeric;
  v_charged numeric := 0;
  v_released numeric := 0;
  v_row record;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  for v_ext in
    select e.*, r.authorized_max_credits from public.find_buyers_budget_extensions e
      join public.usage_reservations r on r.id = e.reservation_id
     where e.matching_job_id = p_job_id and e.status = 'RESERVED'
     order by e.created_at
     for update of e
  loop
    v_take := least(v_left, v_ext.authorized_max_credits);
    select * into v_row from public.wallet_settle(v_ext.reservation_id, v_take,
      jsonb_build_object('provider', 'homatch_matching', 'provider_operation', 'find_clients_budget_extension',
                         'provider_request_id', p_job_id::text, 'landed_cogs_cents', 0), 'SUCCESS');
    update public.find_buyers_budget_extensions
       set status = 'SETTLED', settled_credits = coalesce(v_row.settled_credits, v_take), settled_at = now()
     where id = v_ext.id;
    v_charged := v_charged + coalesce(v_row.settled_credits, v_take);
    v_released := v_released + coalesce(v_row.released_credits, v_ext.authorized_max_credits - v_take);
    v_left := v_left - v_take;
  end loop;
  return jsonb_build_object('chargedCredits', v_charged, 'releasedCredits', v_released, 'uncovered', v_left);
end $$;
revoke all on function public.find_buyers_settle_extensions(uuid, numeric) from public, anon, authenticated;
grant execute on function public.find_buyers_settle_extensions(uuid, numeric) to service_role;

/* What the owner sees: the campaign's total research budget and how it was built. */
create or replace function public.find_buyers_research_budget(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_camp record;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_camp from public.find_buyers_campaigns where matching_job_id = p_job_id and user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'jobId', p_job_id,
    'totalCredits', v_camp.credits_committed,
    'finished', v_camp.finalized_at is not null,
    'presets', coalesce((select value from public.admin_settings where key = 'search_budget_presets_find_clients'), '[100,500,1000,1500,2000]'::jsonb),
    'maxCredits', public.billing_setting_num('campaign_max_credits', 100000),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = v_me),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('additionalCredits', e.additional_credits,
                                   'totalAfterCredits', e.total_after_credits, 'status', e.status,
                                   'settledCredits', e.settled_credits, 'createdAt', e.created_at) order by e.created_at)
                              from public.find_buyers_budget_extensions e where e.matching_job_id = p_job_id), '[]'::jsonb));
end $$;
revoke all on function public.find_buyers_research_budget(uuid) from public, anon;
grant execute on function public.find_buyers_research_budget(uuid) to authenticated;
