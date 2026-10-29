-- ============================================================================
-- SUBSCRIPTIONS (2/2): Verify, internal lead unlock and the launch quote read
-- the subscription ledger (20261207100000). Additive: the wallet functions are
-- renamed, never edited, and the new functions keep their exact signatures, so
-- the deployed research-agent / atomic-unlock keep working before and after
-- their own update.
--
-- Verify funding order (a job keeps the funding it started with):
--   trial -> plan allowance -> legacy fixed-price wallet path (credit holders only)
--   -> SUBSCRIPTION_REQUIRED / ALLOWANCE_EXHAUSTED.
-- Trial and plan uses are committed only by verify_billing_close('COMPLETE');
-- STOPPED / PARTIAL / SYSTEM_FAILED release them.
-- ============================================================================

-- What saas_usage_begin WOULD choose now, without reserving anything. For quotes and badges.
create or replace function public.saas_usage_preview(p_user_id uuid, p_feature text)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_f public.saas_features;
  v_t public.saas_trials;
  v_sub public.saas_subscriptions;
  v_e public.saas_plan_entitlements;
  v_used integer := 0;
  v_balance numeric;
  v_eligible boolean := public.saas_account_eligible(p_user_id);
begin
  select * into v_f from public.saas_features where feature = p_feature;
  if not found then return jsonb_build_object('funding', 'NONE', 'reason', 'FEATURE_UNKNOWN'); end if;
  if v_f.trial_enabled and v_eligible then
    select * into v_t from public.saas_trials where user_id = p_user_id and feature = p_feature;
    if not found or v_t.state = 'RELEASED' then return jsonb_build_object('funding', 'TRIAL'); end if;
  end if;
  v_sub := public.saas_live_subscription(p_user_id);
  if v_sub.id is not null then
    select * into v_e from public.saas_plan_entitlements where plan_code = v_sub.plan_code and feature = p_feature;
    if found and v_e.enabled then
      if v_e.unlimited then return jsonb_build_object('funding', 'PLAN', 'unlimited', true, 'planCode', v_sub.plan_code); end if;
      select count(*) into v_used from public.saas_usage
       where subscription_id = v_sub.id and feature = p_feature and funding = 'PLAN'
         and period_start = v_sub.current_period_start and state in ('RESERVED', 'COMMITTED');
      if v_used < coalesce(v_e.limit_per_period, 0) then
        return jsonb_build_object('funding', 'PLAN', 'unlimited', false, 'planCode', v_sub.plan_code,
          'used', v_used, 'limit', v_e.limit_per_period, 'remaining', v_e.limit_per_period - v_used);
      end if;
    end if;
  end if;
  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
  if coalesce(v_balance, 0) > 0 then
    return jsonb_build_object('funding', 'LEGACY_CREDITS', 'legacyBalance', v_balance,
      'fallbackReason', case when v_sub.id is not null then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end);
  end if;
  return jsonb_build_object('funding', 'NONE',
    'reason', case when v_sub.id is not null then 'ALLOWANCE_EXHAUSTED' else 'SUBSCRIPTION_REQUIRED' end,
    'planCode', v_sub.plan_code);
end $$;
revoke all on function public.saas_usage_preview(uuid, text) from public, anon, authenticated;
grant execute on function public.saas_usage_preview(uuid, text) to service_role;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.verify_billing_open_wallet(uuid, uuid, text, boolean, integer, numeric)') is null then
    alter function public.verify_billing_open(uuid, uuid, text, boolean, integer, numeric) rename to verify_billing_open_wallet;
  end if;
  if to_regprocedure('public.verify_billing_close_wallet(uuid, text)') is null then
    alter function public.verify_billing_close(uuid, text) rename to verify_billing_close_wallet;
  end if;
  if to_regprocedure('public.verify_launch_quote_wallet()') is null then
    alter function public.verify_launch_quote() rename to verify_launch_quote_wallet;
  end if;
end $$;
revoke all on function public.verify_billing_open_wallet(uuid, uuid, text, boolean, integer, numeric) from public, anon, authenticated;
grant execute on function public.verify_billing_open_wallet(uuid, uuid, text, boolean, integer, numeric) to service_role;
revoke all on function public.verify_billing_close_wallet(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_billing_close_wallet(uuid, text) to service_role;

create or replace function public.verify_billing_open(
  p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null, p_expected_credits numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid;
  v_key text := 'verify:' || p_job_id::text;
  v_begin jsonb;
  v_wallet jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if not exists (select 1 from public.research_jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'JOB_NOT_OWNED';
  end if;
  -- A job that already held wallet money keeps the wallet path (stop/continue, extensions).
  if exists (select 1 from public.verify_billing where job_id = p_job_id) then
    return public.verify_billing_open_wallet(p_job_id, p_user_id, p_idempotency_key, p_extend, p_expected_authorizations, p_expected_credits)
           || jsonb_build_object('funding', 'LEGACY_CREDITS');
  end if;
  v_user := public.verify_wallet_user(p_user_id);
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'SUBSCRIPTION_REQUIRED');
  end if;

  v_begin := public.saas_usage_begin(v_user, 'VERIFY', v_key, p_job_id::text, true);
  if (v_begin->>'ok')::boolean and v_begin->>'funding' in ('TRIAL', 'PLAN') then
    return jsonb_build_object('ok', true, 'duplicate', coalesce((v_begin->>'duplicate')::boolean, false),
      'funding', v_begin->>'funding', 'usageId', v_begin->>'usageId',
      'priceMode', 'INCLUDED', 'priceCredits', 0, 'reservedCredits', 0, 'chargedTotal', 0, 'authorizations', 0);
  end if;
  if (v_begin->>'ok')::boolean and v_begin->>'funding' = 'LEGACY_CREDITS' then
    v_wallet := public.verify_billing_open_wallet(p_job_id, p_user_id, p_idempotency_key, p_extend, p_expected_authorizations, p_expected_credits);
    if not coalesce((v_wallet->>'ok')::boolean, false) and v_wallet->>'reason' = 'INSUFFICIENT_CREDITS' then
      -- Not enough legacy credits for one Verify: the honest answer is the subscription prompt.
      return v_wallet || jsonb_build_object('reason', v_begin->>'fallbackReason', 'legacyReason', 'INSUFFICIENT_CREDITS');
    end if;
    return v_wallet || jsonb_build_object('funding', 'LEGACY_CREDITS');
  end if;
  return jsonb_build_object('ok', false, 'reason', coalesce(v_begin->>'reason', 'SUBSCRIPTION_REQUIRED'),
    'trialBlocked', v_begin->>'trialBlocked', 'planCode', v_begin->>'planCode');
end;
$function$;
revoke all on function public.verify_billing_open(uuid, uuid, text, boolean, integer, numeric) from public, anon, authenticated;
grant execute on function public.verify_billing_open(uuid, uuid, text, boolean, integer, numeric) to service_role;

create or replace function public.verify_billing_close(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid;
  v_u public.saas_usage;
  v_r jsonb;
begin
  if p_outcome not in ('COMPLETE', 'STOPPED', 'PARTIAL', 'SYSTEM_FAILED') then raise exception 'VERIFY_BAD_OUTCOME'; end if;
  select public.verify_wallet_user(j.user_id) into v_user from public.research_jobs j where j.id = p_job_id;
  if v_user is not null then
    select * into v_u from public.saas_usage
     where user_id = v_user and feature = 'VERIFY' and idempotency_key = 'verify:' || p_job_id::text;
    if found and (v_u.state = 'RESERVED' or (v_u.state = 'RELEASED' and v_u.release_reason = 'EXPIRED' and p_outcome = 'COMPLETE')) then
      if p_outcome = 'COMPLETE' then
        v_r := public.saas_usage_commit(v_user, 'VERIFY', v_u.idempotency_key);
      else
        v_r := public.saas_usage_release(v_user, 'VERIFY', v_u.idempotency_key, p_outcome);
      end if;
      return jsonb_build_object('ok', true, 'billing', false, 'funding', v_u.funding, 'outcome', p_outcome,
        'charged', 0, 'usage', v_r);
    end if;
  end if;
  return public.verify_billing_close_wallet(p_job_id, p_outcome);
end;
$function$;
revoke all on function public.verify_billing_close(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_billing_close(uuid, text) to service_role;

-- The page's quote, plus what the next Verify would be funded by.
create or replace function public.verify_launch_quote()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_user uuid;
begin
  if v_uid is not null then v_user := public.verify_wallet_user(v_uid); end if;
  return public.verify_launch_quote_wallet()
    || jsonb_build_object('entitlement', case when v_user is null then null else public.saas_usage_preview(v_user, 'VERIFY') end);
end;
$function$;
revoke all on function public.verify_launch_quote() from public, anon;
grant execute on function public.verify_launch_quote() to authenticated, service_role;
revoke all on function public.verify_launch_quote_wallet() from public, anon, authenticated;
grant execute on function public.verify_launch_quote_wallet() to service_role;

-- ── Contract analysis: preview for the page (the edge functions do begin/commit/release) ──
create or replace function public.contract_analysis_entitlement_for_me()
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid := public.saas_my_user_id();
begin
  if v_user is null then raise exception 'UNAUTHENTICATED' using errcode = 'insufficient_privilege'; end if;
  return public.saas_usage_preview(v_user, 'CONTRACT_ANALYSIS');
end $$;
revoke all on function public.contract_analysis_entitlement_for_me() from public, anon;
grant execute on function public.contract_analysis_entitlement_for_me() to authenticated;

-- ── Internal lead unlock: free for subscribers ──────────────────────────────
do $$
begin
  if to_regprocedure('public.internal_leads_unlock_quote_priced(uuid, uuid[])') is null then
    alter function public.internal_leads_unlock_quote_for(uuid, uuid[]) rename to internal_leads_unlock_quote_priced;
  end if;
end $$;
revoke all on function public.internal_leads_unlock_quote_priced(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock_quote_priced(uuid, uuid[]) to service_role;

create or replace function public.internal_leads_unlock_quote_for(p_user_id uuid, p_match_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb := public.internal_leads_unlock_quote_priced(p_user_id, p_match_ids);
  v_free boolean := public.saas_user_has_feature(p_user_id, 'INTERNAL_UNLOCK_FREE');
begin
  if v_free then
    return v || jsonb_build_object('standardCredits', 0, 'exactCredits', 0, 'premiumCredits', 0, 'mortgageCredits', 0,
      'mortgageMatchCredits', 0, 'expatCredits', 0, 'totalCredits', 0, 'freeForSubscriber', true, 'subscriptionRequired', false);
  end if;
  return v || jsonb_build_object('freeForSubscriber', false,
    'subscriptionRequired', coalesce((v->>'totalCredits')::numeric, 0) > 0 and coalesce((v->>'balance')::numeric, 0) <= 0);
end $$;
revoke all on function public.internal_leads_unlock_quote_for(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock_quote_for(uuid, uuid[]) to service_role;

/* The unlock: 20261203091000's, unchanged except the subscriber branch (v_free) and the
   SUBSCRIPTION_REQUIRED refusal for an account with neither a plan nor legacy credits. */
create or replace function public.internal_leads_unlock(p_user_id uuid, p_match_ids uuid[], p_idempotency_key text,
                                                         p_expected_credits numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_prices jsonb;
  v_batch uuid := gen_random_uuid();
  v_seg text;
  v_n integer;
  v_unit numeric;
  v_total numeric;
  v_due numeric;
  v_res uuid;
  v_res_ids jsonb := '{}'::jsonb;
  v_unlocked jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_charged numeric := 0;
  v_balance numeric;
  v_row record;
  v_unlock_id uuid;
  v_result jsonb;
  v_free boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if coalesce(array_length(p_match_ids, 1), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if array_length(p_match_ids, 1) > 200 then raise exception 'TOO_MANY_SELECTED'; end if;
  if p_expected_credits is not null and p_expected_credits < 0 then raise exception 'INVALID_ARGUMENT'; end if;

  perform pg_advisory_xact_lock(hashtextextended('internal_lead_unlock:' || p_user_id::text, 0));

  select b.result into v_existing from public.internal_lead_unlock_batches b
   where b.account_user_id = p_user_id and b.idempotency_key = p_idempotency_key;
  if found then return v_existing || jsonb_build_object('duplicate', true); end if;

  -- SUBSCRIPTIONS (20261207100000): every live subscriber unlocks internal members free.
  -- Decided here, under the lock, from the subscription row: never from what the page showed.
  v_free := public.saas_user_has_feature(p_user_id, 'INTERNAL_UNLOCK_FREE');

  v_prices := public.internal_lead_prices();
  if not coalesce((v_prices->>'active')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;

  create temporary table if not exists pg_temp.ilu_pick (
    match_id uuid, lead_user_id uuid, intent_profile_id uuid, property_id uuid, segment text, already boolean
  ) on commit drop;
  truncate pg_temp.ilu_pick;

  -- "already" is read under the lock: a person this account has unlocked by any source,
  -- listing, search or segment is never charged again.
  insert into pg_temp.ilu_pick
  select p.match_id, p.lead_user_id, p.intent_profile_id, p.property_id, p.price_key,
         exists (select 1 from public.internal_lead_unlocks u where u.account_user_id = p_user_id and u.lead_user_id = p.lead_user_id)
    from public.internal_lead_pick(p_user_id, p_match_ids) p;

  select coalesce(jsonb_agg(match_id), '[]'::jsonb) into v_already from pg_temp.ilu_pick where already;

  select coalesce(sum((v_prices->>segment)::numeric), 0) into v_due from pg_temp.ilu_pick where not already;
  if v_free then v_due := 0; end if;
  -- No subscription and no legacy credits left: the priced path is closed (credits are no longer sold).
  if not v_free and v_due > 0
     and coalesce((select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id), 0) <= 0 then
    raise exception 'SUBSCRIPTION_REQUIRED';
  end if;
  if p_expected_credits is not null and v_due > p_expected_credits then raise exception 'PRICE_CHANGED'; end if;

  foreach v_seg in array array['STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH', 'EXPAT'] loop
    select count(*) into v_n from pg_temp.ilu_pick where not already and segment = v_seg;
    continue when v_n = 0;
    if v_seg = 'MORTGAGE' and not coalesce((v_prices->>'mortgageActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    if v_seg = 'MORTGAGE_MATCH' and not coalesce((v_prices->>'mortgageMatchActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    if v_seg = 'EXPAT' and not coalesce((v_prices->>'expatActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    v_unit := (v_prices->>v_seg)::numeric;
    if v_unit is null then raise exception 'PRODUCT_DISABLED'; end if;
    if v_free then v_unit := 0; end if;
    v_total := round(v_unit * v_n, 4);
    v_res := null;
    if v_total > 0 then
      select r.reservation_id into v_res
        from public.wallet_reserve(p_user_id, 'INTERNAL_LEAD_' || v_seg, v_total,
                                   'internal-leads:' || p_user_id::text || ':' || p_idempotency_key || ':' || v_seg,
                                   v_total, v_total, 'internal-leads:' || v_batch::text,
                                   jsonb_build_object('units', v_n, 'unit_credits', v_unit, 'segment', v_seg,
                                                      'batch_id', v_batch)) r;
      perform public.wallet_settle(v_res, v_total,
                                   jsonb_build_object('units', v_n, 'unit_credits', v_unit,
                                                      'landed_cogs_cents', 0, 'segment', v_seg), 'SUCCESS');
      v_res_ids := v_res_ids || jsonb_build_object(v_seg, v_res);
    end if;
    v_charged := v_charged + v_total;

    for v_row in select * from pg_temp.ilu_pick where not already and segment = v_seg loop
      insert into public.internal_lead_unlocks
        (account_user_id, lead_user_id, first_match_id, first_property_id, segment,
         unit_price_credits, credits_charged, reservation_id, batch_id)
      values (p_user_id, v_row.lead_user_id, v_row.match_id, v_row.property_id, v_seg,
              v_unit, v_unit, v_res, v_batch)
      returning id into v_unlock_id;

      insert into public.lead_crm_entries (owner_user_id, lead_user_id, unlock_id, property_id, status)
      values (p_user_id, v_row.lead_user_id, v_unlock_id, v_row.property_id, 'UNLOCKED')
      on conflict (owner_user_id, lead_user_id) do update
        set unlock_id = coalesce(lead_crm_entries.unlock_id, excluded.unlock_id), updated_at = now();

      insert into public.lead_crm_events (entry_id, kind, detail)
      select e.id, 'UNLOCKED', jsonb_build_object('segment', v_seg, 'credits', v_unit, 'property_id', v_row.property_id)
        from public.lead_crm_entries e where e.owner_user_id = p_user_id and e.lead_user_id = v_row.lead_user_id;

      v_unlocked := v_unlocked || to_jsonb(v_row.match_id);
    end loop;
  end loop;

  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;

  v_result := jsonb_build_object(
    'batchId', v_batch,
    'unlocked', v_unlocked,
    'alreadyUnlocked', v_already,
    'skipped', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(p_match_ids) x
                 where x not in (select match_id from pg_temp.ilu_pick)),
    'chargedCredits', v_charged,
    'reservations', v_res_ids,
    'balanceAfter', v_balance,
    'freeForSubscriber', v_free,
    'duplicate', false);

  insert into public.internal_lead_unlock_batches (id, account_user_id, idempotency_key, result)
  values (v_batch, p_user_id, p_idempotency_key, v_result);
  return v_result;
end $$;
revoke all on function public.internal_leads_unlock(uuid, uuid[], text, numeric) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock(uuid, uuid[], text, numeric) to service_role;
