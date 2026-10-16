-- Verify wallet owner: resolve the wallet through public.users, not auth.uid().
--
-- credit_accounts.user_id references public.users(id). research_jobs.user_id and
-- auth.uid() are the AUTH id (public.users.auth_id). 20261026100000 passed the
-- auth id straight to wallet_reserve and read the launch balance by auth.uid(),
-- so every signed-in user — the owner included — saw 0 available credits and
-- every billed Verify start failed as INSUFFICIENT_CREDITS (CREDIT_ACCOUNT_NOT_FOUND).
-- Every other product already maps auth_id -> public.users.id before touching
-- the wallet (_shared/billing.ts callers, broker_* functions); Verify now does too.
--
-- Only these two functions change. No balance, ledger row, reservation or
-- policy value is touched; pricing, VAT, margin, floor and the 25/+25/100
-- authorization rules are unchanged.

create or replace function public.verify_wallet_user(p_auth_id uuid)
returns uuid
language sql stable security definer set search_path to ''
as $$
  select u.id from public.users u where u.auth_id = p_auth_id
$$;
revoke all on function public.verify_wallet_user(uuid) from public;
revoke execute on function public.verify_wallet_user(uuid) from anon, authenticated;
grant execute on function public.verify_wallet_user(uuid) to service_role;

create or replace function public.verify_billing_open(
  p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
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
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if not exists (select 1 from public.research_jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'JOB_NOT_OWNED';
  end if;

  -- research_jobs.user_id is the AUTH id; the wallet is keyed by public.users.id.
  v_wallet_user := public.verify_wallet_user(p_user_id);

  insert into public.verify_billing (job_id, user_id, authorized_total_credits)
  values (p_job_id, p_user_id, 0)
  on conflict (job_id) do nothing;
  -- Serialises every open, approval, stop and settlement of this job.
  select * into v_b from public.verify_billing where job_id = p_job_id for update;
  select count(*) into v_count from public.verify_billing_authorizations where job_id = p_job_id;
  v_can_extend := v_count < v_max_auth and v_b.authorized_total_credits + v_inc <= v_max;

  select * into v_s from public.verify_billing_sessions where job_id = p_job_id and state = 'RESERVED';
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'sessionId', v_s.id, 'reservationId', v_s.reservation_id,
      'reservedCredits', v_s.reserved_credits, 'authorizedTotal', v_b.authorized_total_credits, 'chargedTotal', v_b.charged_total_credits,
      'authorizations', v_count);
  end if;

  -- A session already opened under this key (a retried request after it closed) is not reopened.
  if exists (select 1 from public.verify_billing_sessions vs join public.usage_reservations r on r.id = vs.reservation_id
              where vs.job_id = p_job_id and r.idempotency_key = p_idempotency_key) then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_ALREADY_CLOSED');
  end if;

  if v_count = 0 then
    v_new := v_initial; v_kind := 'INITIAL';
  elsif p_extend then
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
                         'authorization', case when v_new > 0 then v_kind end));
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
    'authorizations', v_count, 'extended', v_kind = 'EXTENSION', 'balanceAfter', v_res.balance_after);
end;
$$;


create or replace function public.verify_launch_quote()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_pol jsonb := public.verify_budget_policy();
  -- The launch asks for the INITIAL authorisation only (25), never the 100 maximum.
  v_max numeric := coalesce((v_pol->>'initial_credits')::numeric, 25);
  v_uid uuid := auth.uid();
begin
  return jsonb_build_object(
    'enabled', coalesce((v_pol->>'enabled')::boolean, false),
    'maxCredits', v_max,
    'usdCents', public.billing_credits_to_cents(v_max),
    'availableCredits', case when v_uid is null then null else coalesce((select balance from public.credit_accounts where user_id = public.verify_wallet_user(v_uid)), 0) end,
    -- fx_rates: units of USD per one unit of the currency, effective now.
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', r.base_currency, 'usdPerUnit', r.rate, 'asOf', r.effective_from) order by r.base_currency)
        from public.fx_rates r
       where r.quote_currency = 'USD' and r.base_currency <> 'USD'
         and r.effective_from <= now() and (r.effective_to is null or r.effective_to > now())), '[]'::jsonb));
end;
$$;

-- Re-assert the grants of 20261026100000 (create or replace keeps them; this
-- makes the intended surface explicit).
revoke all on function public.verify_billing_open(uuid, uuid, text, boolean, integer) from public;
revoke execute on function public.verify_billing_open(uuid, uuid, text, boolean, integer) from anon, authenticated;
grant execute on function public.verify_billing_open(uuid, uuid, text, boolean, integer) to service_role;
revoke all on function public.verify_launch_quote() from public, anon;
grant execute on function public.verify_launch_quote() to authenticated, service_role;
