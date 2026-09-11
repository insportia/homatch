-- wallet_settle and wallet_release declare RETURNS TABLE(reservation_id uuid, ...).
-- That OUT parameter shadows credit_lot_allocations.reservation_id inside the
-- function body, and Postgres refuses the ambiguous reference at RUNTIME rather
-- than at CREATE time -- so it only surfaced on the first real settle, with
-- "column reference reservation_id is ambiguous".
--
-- Fixed by aliasing the table in the two FOR loops (and the usage_reservations
-- lookup, for the same reason). Nothing else changes; the full bodies are
-- restated because CREATE OR REPLACE FUNCTION has no partial form.

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

REVOKE ALL ON FUNCTION public.wallet_settle(uuid, numeric, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_settle(uuid, numeric, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.wallet_release(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_release(uuid, text, jsonb) TO service_role;
