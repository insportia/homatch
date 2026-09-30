-- META ADS FINANCE CONTROL: one canonical, database-enforced home for the
-- HOMATCH advertising service fee and for Admin money actions.
--
--   meta_effective_fee_percent(user)        the percent a customer pays: the
--                                           admin policy over the standard
--                                           setting (admin_settings
--                                           meta_ads_fee_percent). Launch,
--                                           preview and plan edits all use it.
--   meta_service_fee_quote(user, planned)   the fee on a planned budget.
--   admin_set_meta_fee_policy(...)          STANDARD_PERCENT / FEE_EXEMPT /
--                                           CUSTOM_PERCENT, admin only, audited.
--   admin_meta_adjust_balance(...)          a ledger ADJUSTMENT, admin only,
--                                           with direction, reason, actor and
--                                           balance before/after on record.
--   admin_meta_customer_finance(user)       what Admin sees for one customer.
--
-- The exemption is HOMATCH's fee only. Meta media spend (billed by Meta to the
-- customer's own ad account) and HOMATCH's AI/provider costs are unaffected
-- and stay visible. Advertising service balance is non-refundable to cash and
-- non-withdrawable; released reservations return to the reusable balance.

-- ── 1. THE PERCENT AND THE QUOTE ─────────────────────────────────────────
create or replace function public.meta_effective_fee_percent(p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_standard numeric;
  v_kind text;
  v_percent numeric;
begin
  -- The customer themself, an admin, or the server. Nobody reads another's terms.
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin()
     and p_user is distinct from public.auth_user_id() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric
              when jsonb_typeof(value) = 'string' and (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into v_standard from public.admin_settings where key = 'meta_ads_fee_percent';
  if p_user is null then raise exception 'USER_REQUIRED'; end if;
  -- Percent to two decimals (basis points): the TS fee maths is exact at that precision.
  v_standard := round(least(100, greatest(0, coalesce(v_standard, 9))), 2);
  select kind, percent into v_kind, v_percent from public.meta_fee_policies where user_id = p_user;
  if v_kind is null or v_kind = 'STANDARD_PERCENT' then return v_standard; end if;
  if v_kind = 'FEE_EXEMPT' then return 0; end if;
  return round(least(100, greatest(0, coalesce(v_percent, v_standard))), 2);
end $$;
revoke all on function public.meta_effective_fee_percent(uuid) from public, anon;
grant execute on function public.meta_effective_fee_percent(uuid) to authenticated, service_role;

create or replace function public.meta_service_fee_quote(p_user uuid, p_planned_media_cents bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pct numeric := public.meta_effective_fee_percent(p_user);  -- carries the access check
  v_kind text;
  v_planned bigint := greatest(0, coalesce(p_planned_media_cents, 0));
begin
  select kind into v_kind from public.meta_fee_policies where user_id = p_user;
  return jsonb_build_object(
    'policy', coalesce(v_kind, 'STANDARD_PERCENT'),
    'fee_percent', v_pct,
    'planned_media_cents', v_planned,
    -- Basis points, half-up: identical to billing.ts serviceFeeCents / strategy.ts computeTotals.
    'service_fee_cents', round(v_planned * round(v_pct * 100) / 10000)::bigint
  );
end $$;
revoke all on function public.meta_service_fee_quote(uuid, bigint) from public, anon;
grant execute on function public.meta_service_fee_quote(uuid, bigint) to authenticated, service_role;

-- ── 2. FEE POLICY: admin only, audited ───────────────────────────────────
create or replace function public.admin_set_meta_fee_policy(p_user uuid, p_kind text, p_percent numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_admin uuid := public.auth_user_id();
  v_prev jsonb;
  v_next jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() or v_admin is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_admin and suspended_at is not null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_user is null or p_kind is null or p_kind not in ('STANDARD_PERCENT', 'FEE_EXEMPT', 'CUSTOM_PERCENT') then raise exception 'BAD_KIND'; end if;
  if p_kind = 'CUSTOM_PERCENT' and p_percent <> round(p_percent, 2) then raise exception 'PERCENT_INVALID'; end if;
  -- An admin may set their own fee policy (the owner-operator's account is the
  -- canonical example); it is recorded with them as both actor and target.
  if length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_kind = 'CUSTOM_PERCENT' and (p_percent is null or p_percent < 0 or p_percent > 100) then raise exception 'PERCENT_INVALID'; end if;
  if not exists (select 1 from public.users where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;

  select jsonb_build_object('kind', kind, 'percent', percent) into v_prev from public.meta_fee_policies where user_id = p_user;
  v_next := jsonb_build_object('kind', p_kind, 'percent', case when p_kind = 'CUSTOM_PERCENT' then p_percent end);
  insert into public.meta_fee_policies (user_id, kind, percent, reason, set_by, updated_at)
  values (p_user, p_kind, case when p_kind = 'CUSTOM_PERCENT' then p_percent end, v_reason, v_admin, now())
  on conflict (user_id) do update set kind = excluded.kind, percent = excluded.percent, reason = excluded.reason,
    set_by = excluded.set_by, updated_at = now();
  insert into public.meta_fee_policy_audit (user_id, admin_user_id, previous, next, reason)
  values (p_user, v_admin, v_prev, v_next, v_reason);
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (v_admin, p_user, 'META_FEE_POLICY_SET', 'META_ADS_FEE_POLICY', p_user::text,
          jsonb_build_object('previous', v_prev, 'next', v_next, 'reason', v_reason));
  -- Live campaigns keep the percent they launched with (meta_campaigns.fee_percent).
  return jsonb_build_object('previous', v_prev, 'next', v_next, 'effective_percent', public.meta_effective_fee_percent(p_user));
end $$;
revoke all on function public.admin_set_meta_fee_policy(uuid, text, numeric, text) from public, anon;
grant execute on function public.admin_set_meta_fee_policy(uuid, text, numeric, text) to authenticated;

-- ── 3. ADJUSTMENTS: through the ledger, never around it ──────────────────
create table if not exists public.meta_finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  ledger_id bigint not null references public.meta_ads_ledger(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  admin_user_id uuid not null references public.users(id) on delete restrict,
  direction text not null check (direction in ('CREDIT', 'DEBIT')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null,
  reason text not null check (length(btrim(reason)) >= 3),
  campaign_id uuid references public.meta_campaigns(id) on delete set null,
  related_ledger_id bigint references public.meta_ads_ledger(id) on delete restrict,
  balance_before_cents bigint not null,
  balance_after_cents bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists meta_finance_adjustments_user_idx on public.meta_finance_adjustments (user_id, created_at desc);
alter table public.meta_finance_adjustments enable row level security;
-- A money audit record: written once, never changed or removed, by anyone.
create or replace function public.meta_finance_adjustments_immutable()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  raise exception 'META_FINANCE_ADJUSTMENTS_IMMUTABLE';
end $$;
revoke all on function public.meta_finance_adjustments_immutable() from public, anon, authenticated;
drop trigger if exists trg_meta_finance_adjustments_immutable on public.meta_finance_adjustments;
create trigger trg_meta_finance_adjustments_immutable before update or delete on public.meta_finance_adjustments
  for each row execute function public.meta_finance_adjustments_immutable();
drop policy if exists meta_finance_adjustments_admin on public.meta_finance_adjustments;
create policy meta_finance_adjustments_admin on public.meta_finance_adjustments for select to authenticated using (public.is_admin());
revoke all on public.meta_finance_adjustments from anon;
revoke insert, update, delete, truncate on public.meta_finance_adjustments from authenticated;
grant select on public.meta_finance_adjustments to authenticated;  -- rows: admins only (RLS)

create or replace function public.admin_meta_adjust_balance(
  p_user uuid, p_direction text, p_amount_cents bigint, p_reason text,
  p_currency text default 'USD', p_campaign uuid default null, p_related_ledger bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_admin uuid := public.auth_user_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'USD'));
  v_before bigint;
  v_after bigint;
  v_signed bigint;
  v_ledger bigint;
  v_adj uuid;
begin
  if not public.is_admin() or v_admin is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_admin and suspended_at is not null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  -- Nobody moves money in their own balance: another admin must.
  if p_user = v_admin then raise exception 'CANNOT_ADJUST_SELF'; end if;
  if p_user is null or p_direction is null or p_direction not in ('CREDIT', 'DEBIT') then raise exception 'BAD_DIRECTION'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then raise exception 'AMOUNT_INVALID'; end if;
  if length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'CURRENCY_INVALID'; end if;
  if not exists (select 1 from public.users where id = p_user) then raise exception 'USER_NOT_FOUND'; end if;
  if p_campaign is not null and not exists (select 1 from public.meta_campaigns where id = p_campaign and user_id = p_user) then
    raise exception 'CAMPAIGN_NOT_THIS_CUSTOMER';
  end if;
  if p_related_ledger is not null and not exists (select 1 from public.meta_ads_ledger where id = p_related_ledger and user_id = p_user) then
    raise exception 'LEDGER_ENTRY_NOT_THIS_CUSTOMER';
  end if;

  -- The ledger guard's own lock key: one money movement per customer at a time.
  perform pg_advisory_xact_lock(hashtextextended('meta_ads_ledger:' || p_user::text, 0));
  select coalesce(sum(amount_cents), 0)::bigint into v_before from public.meta_ads_ledger where user_id = p_user and currency = v_currency;
  v_signed := case when p_direction = 'CREDIT' then p_amount_cents else -p_amount_cents end;
  -- A debit never takes the balance below zero (also enforced by the ledger guard below).
  if p_direction = 'DEBIT' and v_before - p_amount_cents < 0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
  insert into public.meta_ads_ledger (user_id, entry_type, amount_cents, currency, campaign_id, idempotency_key, note, created_by)
  values (p_user, 'ADJUSTMENT', v_signed, v_currency, p_campaign, 'adj:' || gen_random_uuid()::text, v_reason, v_admin)
  returning id into v_ledger;
  -- This adjustment's own effect (a concurrent deposit cannot misstate it).
  v_after := v_before + v_signed;

  insert into public.meta_finance_adjustments (ledger_id, user_id, admin_user_id, direction, amount_cents, currency, reason,
    campaign_id, related_ledger_id, balance_before_cents, balance_after_cents)
  values (v_ledger, p_user, v_admin, p_direction, p_amount_cents, v_currency, v_reason, p_campaign, p_related_ledger, v_before, v_after)
  returning id into v_adj;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (v_admin, p_user, 'META_BALANCE_ADJUSTMENT', 'META_ADS_LEDGER', v_ledger::text,
          jsonb_build_object('direction', p_direction, 'amount_cents', p_amount_cents, 'currency', v_currency, 'reason', v_reason,
                             'campaign_id', p_campaign, 'related_ledger_id', p_related_ledger,
                             'balance_before_cents', v_before, 'balance_after_cents', v_after, 'adjustment_id', v_adj));
  return jsonb_build_object('adjustment_id', v_adj, 'ledger_id', v_ledger, 'balance_before_cents', v_before, 'balance_after_cents', v_after);
end $$;
revoke all on function public.admin_meta_adjust_balance(uuid, text, bigint, text, text, uuid, bigint) from public, anon;
grant execute on function public.admin_meta_adjust_balance(uuid, text, bigint, text, text, uuid, bigint) to authenticated;

-- ── 4. WHAT ADMIN SEES FOR ONE CUSTOMER ──────────────────────────────────
create or replace function public.admin_meta_customer_finance(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  with camp as (
    select c.id, c.name, c.status, c.currency, c.fee_percent, c.daily_budget_cents, c.duration_days, c.spend_cents,
           c.launched_at, c.ended_at, c.settled_at,
           coalesce(sum(-l.amount_cents) filter (where l.entry_type = 'HOMATCH_FEE'), 0) as fee_taken,
           coalesce(sum(l.amount_cents) filter (where l.entry_type in ('FEE_RELEASE', 'REFUND')), 0) as fee_released
      from public.meta_campaigns c left join public.meta_ads_ledger l on l.campaign_id = c.id
     where c.user_id = p_user group by c.id
  ), money as (
    select currency,
           coalesce(sum(fee_taken - fee_released) filter (where settled_at is null), 0) as reserved,
           coalesce(sum(fee_taken - fee_released) filter (where settled_at is not null), 0) as consumed,
           coalesce(sum(fee_released), 0) as released,
           coalesce(sum(spend_cents), 0) as meta_media_spend
      from camp group by currency
  )
  select jsonb_build_object(
    'policy', (select jsonb_build_object('kind', kind, 'percent', percent, 'reason', reason, 'updated_at', updated_at) from public.meta_fee_policies where user_id = p_user),
    'effective_fee_percent', public.meta_effective_fee_percent(p_user),
    'balances', coalesce((select jsonb_agg(jsonb_build_object(
        'currency', b.currency, 'deposited_cents', b.deposited_cents, 'available_cents', b.available_cents,
        'reserved_service_cents', b.reserved_service_cents, 'consumed_service_cents', b.consumed_service_cents,
        'released_cents', b.released_cents)) from public.meta_service_balances b where b.user_id = p_user), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'status', status, 'currency', currency, 'fee_percent', fee_percent,
        'planned_media_cents', coalesce(daily_budget_cents, 0) * coalesce(duration_days, 0),
        'service_fee_taken_cents', fee_taken, 'service_fee_released_cents', fee_released,
        'service_fee_held_cents', fee_taken - fee_released, 'meta_media_spend_cents', spend_cents,
        'launched_at', launched_at, 'ended_at', ended_at, 'settled_at', settled_at) order by launched_at desc nulls last) from camp), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'entry_type', entry_type, 'amount_cents', amount_cents,
        'currency', currency, 'campaign_id', campaign_id, 'note', note, 'created_by', created_by, 'created_at', created_at) order by created_at desc)
        from (select * from public.meta_ads_ledger where user_id = p_user order by created_at desc limit 200) l), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (select * from public.meta_finance_adjustments where user_id = p_user order by created_at desc limit 100) a), '[]'::jsonb),
    'policy_history', coalesce((select jsonb_agg(jsonb_build_object('previous', previous, 'next', next, 'reason', reason,
        'admin_user_id', admin_user_id, 'created_at', created_at) order by created_at desc)
        from (select * from public.meta_fee_policy_audit where user_id = p_user order by created_at desc limit 100) h), '[]'::jsonb),
    -- HOMATCH revenue is the service fee actually consumed; real costs stay visible whatever the policy.
    'revenue_and_costs', coalesce((select jsonb_agg(jsonb_build_object(
        'currency', m.currency, 'service_fee_revenue_cents', m.consumed, 'service_fee_reserved_cents', m.reserved,
        'meta_media_spend_cents', m.meta_media_spend)) from money m), '[]'::jsonb),
    'ai_costs_usd', (select jsonb_build_object('calls', count(*), 'raw_cost_usd', coalesce(sum(raw_cost_usd), 0),
        'landed_cost_usd', coalesce(sum(landed_cost_usd), 0), 'unpriced_calls', count(*) filter (where raw_cost_usd is null))
        from public.meta_ai_summaries where user_id = p_user),
    'semantics', jsonb_build_object('non_refundable_to_cash', true, 'withdrawable', false,
        'released_reservations_return_to', 'HOMATCH_BALANCE')
  ) into v;
  return v;
end $$;
revoke all on function public.admin_meta_customer_finance(uuid) from public, anon;
grant execute on function public.admin_meta_customer_finance(uuid) to authenticated;

-- ── 5. LEDGER GUARD: every debit that is not Meta-reported spend ─────────
-- It guarded RESERVE and HOMATCH_FEE only, so an ADJUSTMENT or WITHDRAWAL debit
-- could take a balance negative. META_SPEND stays exempt: it records what
-- Meta already spent against a reservation, which the balance cannot refuse.
create or replace function public.meta_ads_ledger_balance_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_balance numeric;
begin
  if new.amount_cents >= 0 or new.entry_type not in ('RESERVE', 'HOMATCH_FEE', 'ADJUSTMENT', 'WITHDRAWAL') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('meta_ads_ledger:' || new.user_id::text, 0));
  if new.idempotency_key is not null
     and exists (select 1 from public.meta_ads_ledger where idempotency_key = new.idempotency_key) then
    return new;
  end if;
  select coalesce(sum(amount_cents), 0) into v_balance
    from public.meta_ads_ledger where user_id = new.user_id and currency = new.currency;
  if v_balance + new.amount_cents < 0 then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;
  return new;
end $$;
revoke all on function public.meta_ads_ledger_balance_guard() from public, anon, authenticated;

-- ── 6. LEDGER + POLICY TABLES: no client writes, ever ────────────────────
-- RLS already limits writes to the service role; the explicit revoke is the repo convention.
revoke insert, update, delete, truncate on public.meta_ads_ledger from authenticated;
revoke all on public.meta_ads_ledger from anon;
-- Percents are kept to two decimals so every fee is computed exactly (basis points).
alter table public.meta_fee_policies drop constraint if exists meta_fee_policies_percent_2dp;
alter table public.meta_fee_policies add constraint meta_fee_policies_percent_2dp check (percent is null or percent = round(percent, 2));
revoke insert, update, delete, truncate on public.meta_fee_policies, public.meta_fee_policy_audit from authenticated;
-- Reads stay RLS-scoped (own policy; audit admin-only).
grant select on public.meta_ads_ledger, public.meta_fee_policies, public.meta_fee_policy_audit to authenticated;
