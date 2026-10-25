-- My Georgia by HOMI · the expat profile, its Matching search, the 5 credit lead, Admin.
--
-- 1 · expat_profiles gains the onboarding answers (owner-approved questionnaire,
--     2026-10-24): name, property interest, cities, budget or monthly rent, visit
--     status, arrival, length of stay, the support topics, an optional private note,
--     and where the person is in the five steps (autosave and resume).
--     The table stays owner-only (expat_profiles_own). The personal note is read by
--     the owner and by HOMI in the owner's own conversation; nothing in Matching,
--     Admin or any seller-facing function reads it.
--
-- 2 · A completed profile with a genuine property intent (buy, rent, invest) and a
--     city becomes ONE ordinary member search in the existing Matching engine
--     (intent_profiles + active_search_subscriptions, demand_source EXPAT). It is
--     created and removed only by the server: the link columns cannot be written
--     from a client, so the "expat" origin cannot be forged.
--
-- 3 · Price: a person whose Matching row comes from their expat profile is an EXPAT
--     lead at 5 credits ($0.50). A PREMIUM (high budget) search of their own keeps
--     its 10. Mortgage 3 and 5 are unchanged for everyone else. One payment per
--     account and person, by any route, through the existing internal_leads_unlock.
--
-- 4 · Admin: counts only.
--
-- Idempotent: if not exists, create or replace, on conflict do nothing.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · the profile
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.expat_profiles
  add column if not exists first_name text check (first_name is null or length(first_name) <= 80),
  add column if not exists last_name text check (last_name is null or length(last_name) <= 80),
  add column if not exists property_intent text check (property_intent is null or property_intent in ('BUY', 'RENT', 'INVEST', 'BROWSING')),
  add column if not exists cities text[] not null default '{}'
    check (cardinality(cities) <= 5 and cities <@ array['TBILISI', 'BATUMI', 'KUTAISI', 'ZUGDIDI', 'OTHER']::text[]),
  add column if not exists budget_band text check (budget_band is null or budget_band in ('UP_TO_100K', 'FROM_100K_TO_200K', 'OVER_200K', 'UNDECIDED')),
  add column if not exists rent_band text check (rent_band is null or rent_band in ('UP_TO_500', 'FROM_500_TO_1000', 'FROM_1000_TO_2000', 'OVER_2000', 'CUSTOM', 'UNDECIDED')),
  add column if not exists rent_amount numeric(12, 2) check (rent_amount is null or (rent_amount > 0 and rent_amount < 1000000)),
  add column if not exists budget_currency text check (budget_currency is null or budget_currency in ('USD', 'GEL', 'EUR')),
  add column if not exists visit_status text check (visit_status is null or visit_status in ('FIRST_TIME', 'BEEN_BEFORE', 'LIVING_HERE')),
  add column if not exists arrival_unknown boolean,
  add column if not exists stay_length text check (stay_length is null or stay_length in ('WEEKS', 'M1_3', 'M3_12', 'LONG_TERM', 'UNDECIDED')),
  add column if not exists support_topics text[] not null default '{}'
    check (support_topics <@ array['HOUSING', 'BANKING', 'VISA', 'DOCUMENTS', 'TRANSPORT', 'CONNECTIVITY',
                                   'HEALTHCARE', 'EDUCATION', 'BUSINESS', 'TRAVEL']::text[]),
  add column if not exists personal_notes text check (personal_notes is null or length(personal_notes) <= 2000),
  add column if not exists onboarding_step smallint not null default 0 check (onboarding_step between 0 and 6),
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists matching_intent_profile_id uuid references public.intent_profiles(id) on delete set null,
  add column if not exists matching_subscription_id uuid references public.active_search_subscriptions(id) on delete set null;

create unique index if not exists expat_profiles_matching_profile
  on public.expat_profiles (matching_intent_profile_id) where matching_intent_profile_id is not null;

/* The Matching link is the server's: a client write keeps what was there. */
create or replace function public.expat_profiles_guard_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' then
      new.matching_intent_profile_id := null;
      new.matching_subscription_id := null;
    else
      new.matching_intent_profile_id := old.matching_intent_profile_id;
      new.matching_subscription_id := old.matching_subscription_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.expat_profiles_guard_links() from public, anon, authenticated;

drop trigger if exists trg_expat_profiles_guard_links on public.expat_profiles;
create trigger trg_expat_profiles_guard_links
  before insert or update on public.expat_profiles
  for each row execute function public.expat_profiles_guard_links();

/* ════════════════════════════════════════════════════════════════════════
 * 2 · the Matching search
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.expat_profile_sync_matching(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.expat_profiles;
  v_city text;
  v_profile uuid;
  v_sub uuid;
  v_lang text;
  v_intent text;
  v_tx text;
  v_min numeric;
  v_max numeric;
  v_currency text;
begin
  select * into v from public.expat_profiles where user_id = p_user_id for update;
  if not found then return null; end if;

  v_city := case
    when 'TBILISI' = any (v.cities) then 'Tbilisi'
    when 'BATUMI' = any (v.cities) then 'Batumi'
    when 'KUTAISI' = any (v.cities) then 'Kutaisi'
    when 'ZUGDIDI' = any (v.cities) then 'Zugdidi'
  end;

  /* Only a finished profile, a real property intent and a city we can match on. */
  if v.onboarding_completed_at is null or v.property_intent is null or v.property_intent = 'BROWSING' or v_city is null then
    if v.matching_subscription_id is not null then delete from public.active_search_subscriptions where id = v.matching_subscription_id; end if;
    if v.matching_intent_profile_id is not null then delete from public.intent_profiles where id = v.matching_intent_profile_id; end if;
    update public.expat_profiles set matching_intent_profile_id = null, matching_subscription_id = null where user_id = p_user_id;
    return null;
  end if;

  v_intent := case v.property_intent when 'RENT' then 'RENT' when 'INVEST' then 'INVEST' else 'BUY' end;
  v_tx := case v.property_intent when 'RENT' then 'RENT' else 'SALE' end;
  if v.property_intent = 'RENT' then
    v_currency := coalesce(v.budget_currency, 'USD');
    v_max := case v.rent_band when 'UP_TO_500' then 500 when 'FROM_500_TO_1000' then 1000 when 'FROM_1000_TO_2000' then 2000
                              when 'CUSTOM' then v.rent_amount end;
    v_min := case v.rent_band when 'FROM_500_TO_1000' then 500 when 'FROM_1000_TO_2000' then 1000 when 'OVER_2000' then 2000 end;
  else
    v_currency := 'USD';
    v_max := case v.budget_band when 'UP_TO_100K' then 100000 when 'FROM_100K_TO_200K' then 200000 end;
    v_min := case v.budget_band when 'FROM_100K_TO_200K' then 100000 when 'OVER_200K' then 200000 end;
  end if;

  select u.preferred_language::text into v_lang from public.users u where u.id = p_user_id;
  v_profile := v.matching_intent_profile_id;
  if v_profile is not null and exists (select 1 from public.intent_profiles where id = v_profile) then
    update public.intent_profiles set
      intent_type = v_intent::intent_type, country = 'GE', city = v_city, transaction_type = v_tx,
      budget_min = v_min, budget_max = v_max, currency = v_currency, language = v_lang,
      relocation_intent = true, investment_intent = (v.property_intent = 'INVEST'), last_active_at = now()
     where id = v_profile;
  else
    insert into public.intent_profiles
      (intent_type, country, city, transaction_type, budget_min, budget_max, currency, language,
       intent_confidence, classifier_version, relocation_intent, investment_intent, last_active_at)
    values (v_intent::intent_type, 'GE', v_city, v_tx, v_min, v_max, v_currency, v_lang,
            1, 'expat-profile-1', true, (v.property_intent = 'INVEST'), now())
    returning id into v_profile;
  end if;

  v_sub := v.matching_subscription_id;
  if v_sub is not null and exists (select 1 from public.active_search_subscriptions where id = v_sub) then
    update public.active_search_subscriptions
       set intent_id = v_profile, is_active = true, last_active_at = now(),
           search_criteria = jsonb_build_object('origin', 'EXPAT')
     where id = v_sub;
  else
    insert into public.active_search_subscriptions (user_id, intent_id, side, is_active, demand_source, search_criteria, last_active_at, notify_in_app)
    values (p_user_id, v_profile, 'SUPPLY', true, 'EXPAT', jsonb_build_object('origin', 'EXPAT'), now(), false)
    returning id into v_sub;
  end if;

  update public.expat_profiles set matching_intent_profile_id = v_profile, matching_subscription_id = v_sub where user_id = p_user_id;
  return v_profile;
end $$;
revoke all on function public.expat_profile_sync_matching(uuid) from public, anon, authenticated;

/* Every save of the answers that shape the search keeps it current (autosave included). */
create or replace function public.expat_profiles_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'INSERT'
     or new.onboarding_completed_at is distinct from old.onboarding_completed_at
     or new.property_intent is distinct from old.property_intent
     or new.cities is distinct from old.cities
     or new.budget_band is distinct from old.budget_band
     or new.rent_band is distinct from old.rent_band
     or new.rent_amount is distinct from old.rent_amount
     or new.budget_currency is distinct from old.budget_currency then
    perform public.expat_profile_sync_matching(new.user_id);
  end if;
  return null;
end $$;
revoke all on function public.expat_profiles_after_change() from public, anon, authenticated;

drop trigger if exists trg_expat_profiles_after_change on public.expat_profiles;
create trigger trg_expat_profiles_after_change
  after insert or update on public.expat_profiles
  for each row execute function public.expat_profiles_after_change();

/* ════════════════════════════════════════════════════════════════════════
 * 3 · the 5 credit lead
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  ('INTERNAL_LEAD_EXPAT', 'HOMATCH Leads — expat profile', 'FIXED',
   true, 50, 0, 0, 'PER_UNIT', true, true, 97,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'EXPAT'), 0)
on conflict (code) do nothing;

alter table public.internal_lead_unlocks drop constraint if exists internal_lead_unlocks_segment_check;
alter table public.internal_lead_unlocks add constraint internal_lead_unlocks_segment_check
  check (segment in ('STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH', 'EXPAT'));

create or replace function public.internal_lead_prices()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'STANDARD', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_STANDARD'),
    'EXACT',    (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_EXACT'),
    'PREMIUM',  (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_PREMIUM'),
    'MORTGAGE', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE'),
    'MORTGAGE_MATCH', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE_MATCH'),
    'EXPAT',    (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_EXPAT'),
    'active', coalesce((select bool_and(p.enabled and not p.kill_switch and p.pricing_active) and count(*) = 3
                          from public.billable_products p
                         where p.code in ('INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM')), false),
    'mortgageActive', coalesce((select p.enabled and not p.kill_switch and p.pricing_active
                                  from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE'), false),
    'mortgageMatchActive', coalesce((select p.enabled and not p.kill_switch and p.pricing_active
                                       from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE_MATCH'), false),
    'expatActive', coalesce((select p.enabled and not p.kill_switch and p.pricing_active
                               from public.billable_products p where p.code = 'INTERNAL_LEAD_EXPAT'), false))
$$;

/*
 * THE PRICE OF ONE PERSON FOR ONE LISTING, AND WHY (expat added).
 *
 *   their own PREMIUM search matches ............ PREMIUM         10   (a signal never lowers a price)
 *   their expat profile's search matches ......... EXPAT           5
 *   mortgage interest and a search of their own .. MORTGAGE_MATCH  5
 *   mortgage interest only ....................... MORTGAGE        3
 *   otherwise their best search .................. STANDARD 3 / EXACT 5
 * Reasons: HIGH_BUDGET, EXPAT_PROFILE, MORTGAGE_INTEREST, SEARCH_MATCH or EXACT_SEARCH_MATCH.
 */
drop function if exists public.internal_lead_member_price(uuid, uuid, uuid);
create or replace function public.internal_lead_member_price(p_owner uuid, p_property_id uuid, p_member uuid)
returns table (price_key text, reasons text[], mortgage boolean, search_match boolean, expat boolean)
language sql stable security definer set search_path = public as $$
  with c as (
    select c.category, c.intent_profile_id, c.score,
           exists (select 1 from public.mortgage_buyer_intents i
                    where i.intent_profile_id = c.intent_profile_id and i.status = 'ACTIVE') as is_mortgage,
           exists (select 1 from public.expat_profiles e
                    where e.matching_intent_profile_id = c.intent_profile_id) as is_expat
      from public.internal_match_candidates c
     where c.property_id = p_property_id and c.supply_user_id = p_owner and c.demand_user_id = p_member
       and public.internal_match_visible(c.property_id, c.kind, c.budget_verdict, c.geo_km)
       and exists (select 1 from public.active_search_subscriptions s
                    where s.user_id = c.demand_user_id and s.intent_id = c.intent_profile_id and s.is_active)
  ), m as (
    select coalesce(bool_or(c.is_mortgage), false) as yes, coalesce(bool_or(c.is_expat), false) as expat from c
  ), s as (
    select c.category, public.internal_lead_price_key(c.category, c.intent_profile_id) as key
      from c where not c.is_mortgage and not c.is_expat
     order by (c.category = 'EXACT') desc, c.score desc
     limit 1
  )
  select case when s.key = 'PREMIUM' then 'PREMIUM'
              when m.expat then 'EXPAT'
              when m.yes and s.key is not null then 'MORTGAGE_MATCH'
              when m.yes then 'MORTGAGE'
              else coalesce(s.key, 'STANDARD') end,
         array_remove(array[
           case when s.key = 'PREMIUM' then 'HIGH_BUDGET' end,
           case when m.expat then 'EXPAT_PROFILE' end,
           case when m.yes then 'MORTGAGE_INTEREST' end,
           case when s.category = 'EXACT' then 'EXACT_SEARCH_MATCH' when s.key is not null then 'SEARCH_MATCH' end
         ]::text[], null),
         m.yes,
         s.key is not null,
         m.expat
    from m left join s on true
$$;
revoke all on function public.internal_lead_member_price(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_member_price(uuid, uuid, uuid) to service_role;


create or replace function public.internal_leads_unlock_quote_for(p_user_id uuid, p_match_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_prices jsonb := public.internal_lead_prices();
  v_out jsonb;
begin
  with priced as (
    select p.*, (exists (select 1 from public.internal_lead_unlocks u
                          where u.account_user_id = p_user_id and u.lead_user_id = p.lead_user_id)) as already
      from public.internal_lead_pick(p_user_id, p_match_ids) p
  )
  select jsonb_build_object(
    'requested', coalesce(array_length(p_match_ids, 1), 0),
    'eligible', count(*),
    'alreadyUnlocked', count(*) filter (where already),
    'standardCount', count(*) filter (where not already and price_key = 'STANDARD'),
    'exactCount', count(*) filter (where not already and price_key = 'EXACT'),
    'premiumCount', count(*) filter (where not already and price_key = 'PREMIUM'),
    'mortgageCount', count(*) filter (where not already and price_key = 'MORTGAGE'),
    'mortgageMatchCount', count(*) filter (where not already and price_key = 'MORTGAGE_MATCH'),
    'expatCount', count(*) filter (where not already and price_key = 'EXPAT'),
    'standardCredits', coalesce(sum((v_prices->>'STANDARD')::numeric) filter (where not already and price_key = 'STANDARD'), 0),
    'exactCredits', coalesce(sum((v_prices->>'EXACT')::numeric) filter (where not already and price_key = 'EXACT'), 0),
    'premiumCredits', coalesce(sum((v_prices->>'PREMIUM')::numeric) filter (where not already and price_key = 'PREMIUM'), 0),
    'mortgageCredits', coalesce(sum((v_prices->>'MORTGAGE')::numeric) filter (where not already and price_key = 'MORTGAGE'), 0),
    'mortgageMatchCredits', coalesce(sum((v_prices->>'MORTGAGE_MATCH')::numeric) filter (where not already and price_key = 'MORTGAGE_MATCH'), 0),
    'expatCredits', coalesce(sum((v_prices->>'EXPAT')::numeric) filter (where not already and price_key = 'EXPAT'), 0),
    'totalCredits', coalesce(sum((v_prices->>price_key)::numeric) filter (where not already), 0),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id),
    'prices', v_prices)
    into v_out from priced;
  return v_out;
end $$;


/* The unlock: 093's, with the EXPAT segment and its switch. */
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
  if p_expected_credits is not null and v_due > p_expected_credits then raise exception 'PRICE_CHANGED'; end if;

  foreach v_seg in array array['STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH', 'EXPAT'] loop
    select count(*) into v_n from pg_temp.ilu_pick where not already and segment = v_seg;
    continue when v_n = 0;
    if v_seg = 'MORTGAGE' and not coalesce((v_prices->>'mortgageActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    if v_seg = 'MORTGAGE_MATCH' and not coalesce((v_prices->>'mortgageMatchActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    if v_seg = 'EXPAT' and not coalesce((v_prices->>'expatActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    v_unit := (v_prices->>v_seg)::numeric;
    if v_unit is null then raise exception 'PRODUCT_DISABLED'; end if;
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
    'duplicate', false);

  insert into public.internal_lead_unlock_batches (id, account_user_id, idempotency_key, result)
  values (v_batch, p_user_id, p_idempotency_key, v_result);
  return v_result;
end $$;
revoke all on function public.internal_leads_unlock(uuid, uuid[], text, numeric) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock(uuid, uuid[], text, numeric) to service_role;


/* ════════════════════════════════════════════════════════════════════════
 * 3b · the Matching feeds: expat members among the other buyer leads
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.internal_leads_feed(p_property_id uuid, p_filter text default 'ALL'::text, p_sort text default 'BEST'::text, p_limit integer default 24, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_seen timestamptz;
  v_limit integer := greatest(1, least(coalesce(p_limit, 24), 60));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me and not p.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select s.seen_at into v_seen from public.internal_lead_seen s
   where s.account_user_id = v_me and s.property_id = p_property_id;

  with base as (
    select r.*, ip.transaction_type, ip.intent_type::text as intent_type, ip.property_types,
           ip.country, ip.city, ip.district, ip.neighborhoods,
           ip.budget_min, ip.budget_max, ip.currency,
           ip.bedrooms_min, ip.bedrooms_max, ip.rooms_min, ip.rooms_max, ip.area_min, ip.area_max,
           ip.timeline, ip.created_at as demand_at,
           seg.segment, seg.budget_usd,
           case when upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end as tx,
           case when r.match_score >= 0.8 then 'STRONG' when r.match_score >= 0.5 then 'POTENTIAL' else 'WEAK' end as band,
           (u.id is not null) as unlocked,
           u.id as unlock_id,
           c.status as crm_status, c.id as crm_entry_id,
           exists (select 1 from public.internal_lead_saved sv where sv.account_user_id = v_me and sv.match_id = r.match_id) as saved,
           (c.status is not null and c.status <> 'UNLOCKED') as contacted,
           ((v_seen is null and r.matched_at > now() - interval '7 days') or (v_seen is not null and r.matched_at > v_seen)) as fresh,
           prefs.share_phone_on_unlock, prefs.share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.nickname, usr.full_name, usr.preferred_language,
           mp.price_key as member_key, mp.reasons as price_reasons, mp.mortgage as has_mortgage, mp.search_match as has_search,
           mp.expat as has_expat, ep.nationality as ex_country, ep.arrival_date as ex_arrival,
           ep.arrival_unknown as ex_arrival_unknown, ep.stay_length as ex_stay,
           mi.signal_count as mi_signals, mi.last_signal_at as mi_last,
           (p_property_id = any (coalesce(mi.property_ids, '{}'::uuid[]))) as mi_listing
      from public.internal_lead_rows(v_me, p_property_id) r
      join public.intent_profiles ip on ip.id = r.intent_profile_id
      join public.users usr on usr.id = r.lead_user_id
      cross join lateral public.internal_lead_segment(r.intent_profile_id) seg
      cross join lateral public.lead_contact_prefs_of(r.lead_user_id) prefs
      cross join lateral public.internal_lead_member_price(v_me, p_property_id, r.lead_user_id) mp
      left join public.mortgage_buyer_intents mi on mi.user_id = r.lead_user_id and mi.status = 'ACTIVE'
      /* Only what a seller may see of an expat: country and timing. Never notes, names or documents. */
      left join public.expat_profiles ep on ep.user_id = r.lead_user_id and mp.expat
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
      left join public.lead_crm_entries c on c.owner_user_id = v_me and c.lead_user_id = r.lead_user_id
  ), filtered as (
    select * from base b
     where case upper(coalesce(p_filter, 'ALL'))
             when 'STRONG' then b.band = 'STRONG'
             when 'POTENTIAL' then b.band = 'POTENTIAL'
             when 'STANDARD' then b.segment = 'STANDARD'
             when 'PREMIUM' then b.segment = 'PREMIUM'
             when 'MORTGAGE' then b.has_mortgage
             when 'EXPAT' then b.has_expat
             when 'FRESH' then b.fresh
             when 'UNLOCKED' then b.unlocked
             when 'CONTACTED' then b.contacted
             when 'SAVED' then b.saved
             else true end
  ), page as (
    select f.*, row_number() over (order by
       case when upper(coalesce(p_sort, 'BEST')) = 'BEST' then f.match_score end desc nulls last,
       case when upper(p_sort) = 'NEWEST' then f.demand_at end desc nulls last,
       case when upper(p_sort) = 'UPDATED' then f.updated_at end desc nulls last,
       case when upper(p_sort) = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when upper(p_sort) = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id) as rn
      from filtered f
     order by
       case when upper(coalesce(p_sort, 'BEST')) = 'BEST' then f.match_score end desc nulls last,
       case when upper(p_sort) = 'NEWEST' then f.demand_at end desc nulls last,
       case when upper(p_sort) = 'UPDATED' then f.updated_at end desc nulls last,
       case when upper(p_sort) = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when upper(p_sort) = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object(
        'ALL', count(*),
        'STRONG', count(*) filter (where band = 'STRONG'),
        'POTENTIAL', count(*) filter (where band = 'POTENTIAL'),
        'STANDARD', count(*) filter (where segment = 'STANDARD'),
        'PREMIUM', count(*) filter (where segment = 'PREMIUM'),
        'MORTGAGE', count(*) filter (where has_mortgage),
        'EXPAT', count(*) filter (where has_expat),
        'FRESH', count(*) filter (where fresh),
        'UNLOCKED', count(*) filter (where unlocked),
        'CONTACTED', count(*) filter (where contacted),
        'SAVED', count(*) filter (where saved)) from base),
    'prices', public.internal_lead_prices(),
    'lastSeenAt', v_seen,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'matchId', p.match_id,
        'score', round(p.match_score * 100),
        'band', p.band,
        'segment', case when p.member_key in ('MORTGAGE', 'MORTGAGE_MATCH', 'EXPAT') then p.member_key else p.segment end,
        'origin', case when p.has_expat then 'EXPAT' when p.has_mortgage and p.has_search then 'MORTGAGE_AND_SEARCH' when p.has_mortgage then 'MORTGAGE' else 'SEARCH' end,
        'expat', case when p.has_expat then jsonb_build_object(
            'country', p.ex_country,
            'arrivalMonth', case when coalesce(p.ex_arrival_unknown, false) then null else to_char(p.ex_arrival, 'YYYY-MM') end,
            'stay', p.ex_stay) end,
        'priceKey', p.member_key,
        'priceReasons', to_jsonb(p.price_reasons),
        'mortgage', case when p.has_mortgage then jsonb_build_object(
            'calculatorUse', case when p.mi_signals > 1 then 'REPEATED' else 'ONCE' end,
            'lastUseMonth', to_char(p.mi_last, 'YYYY-MM'),
            'thisListing', p.mi_listing) end,
        -- The price that is charged (the older feed used to show the segment's price for EXACT rows).
        'priceCredits', (public.internal_lead_prices() ->> p.member_key)::numeric,
        'unlocked', p.unlocked,
        'contacted', p.contacted,
        'crmStatus', p.crm_status,
        'crmEntryId', p.crm_entry_id,
        'saved', p.saved,
        'fresh', p.fresh,
        'transaction', p.tx,
        'intentType', p.intent_type,
        'propertyTypes', to_jsonb(coalesce(p.property_types, '{}'::text[])),
        'locations', jsonb_build_object('city', p.city, 'district', p.district,
                                        'neighborhoods', to_jsonb(coalesce(p.neighborhoods, '{}'::text[]))),
        'budget', case when p.budget_min is null and p.budget_max is null then null else jsonb_build_object(
                    'min', public.internal_lead_round_budget(p.budget_min, p.tx),
                    'max', public.internal_lead_round_budget(p.budget_max, p.tx),
                    'currency', p.currency) end,
        'requirements', jsonb_strip_nulls(jsonb_build_object(
                    'bedroomsMin', p.bedrooms_min, 'bedroomsMax', p.bedrooms_max,
                    'roomsMin', p.rooms_min, 'roomsMax', p.rooms_max,
                    'areaMin', p.area_min, 'areaMax', p.area_max)),
        'agreed', to_jsonb(p.agreed),
        'conflicted', to_jsonb(p.conflicted),
        'unknown', to_jsonb(p.unknown_dimensions),
        'demandAt', p.demand_at,
        'matchedAt', p.matched_at,
        'updatedAt', p.updated_at,
        'contactOptions', jsonb_build_object(
            'message', true,
            'phone', p.share_phone_on_unlock and p.has_phone,
            'email', p.share_email_on_unlock),
        -- Only once unlocked: how the member chose to be called. Never before.
        'displayName', case when p.unlocked then coalesce(nullif(p.nickname, ''),
                         nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '')) end,
        'language', case when p.unlocked then p.preferred_language::text end
      ) order by p.rn) from page p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;


create or replace function public.internal_leads_feed_v2(p_property_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_seen timestamptz;
  v_limit integer := greatest(1, least(coalesce((p->>'limit')::integer, 24), 100));
  v_offset integer := greatest(0, coalesce((p->>'offset')::integer, 0));
  v_sort text := upper(coalesce(nullif(p->>'sort', ''), 'BEST'));
  v_filters text[] := coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'filters') = 'array' then p->'filters' else '[]'::jsonb end) x), '{}');
  v_district text := nullif(lower(trim(coalesce(p->>'district', ''))), '');
  v_ptype text := nullif(upper(trim(coalesce(p->>'propertyType', ''))), '');
  v_prices jsonb := public.internal_lead_prices();
  v_countries text[] := coalesce((select array_agg(upper(btrim(x))) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'countries') = 'array' then p->'countries' else '[]'::jsonb end) x where btrim(x) <> ''), '{}');
  v_langs text[] := coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'languages') = 'array' then p->'languages' else '[]'::jsonb end) x where btrim(x) <> ''), '{}');
  v_interests text[] := coalesce((select array_agg(upper(btrim(x))) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'interests') = 'array' then p->'interests' else '[]'::jsonb end) x where btrim(x) <> ''), '{}');
  v_q text := nullif(lower(btrim(coalesce(p->>'q', ''))), '');
  v_with_ids boolean := coalesce((p->>'withIds')::boolean, false);
  v_disabled boolean;
  v_result jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  /* Internal matching off (or maintenance) closes discovery: the feed then answers with the
     members the account already unlocked and nothing about anyone else (disabled = true). */
  v_disabled := public.matching_maintenance_on() or not public.matching_service_on('internal_matching');
  if v_disabled then v_filters := array['UNLOCKED']; end if;
  if not exists (select 1 from public.properties pr where pr.id = p_property_id and pr.user_id = v_me and not pr.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select s.seen_at into v_seen from public.internal_lead_seen s
   where s.account_user_id = v_me and s.property_id = p_property_id;

  with base as (
    select r.*, ip.transaction_type, ip.intent_type::text as intent_type, ip.property_types,
           ip.country, ip.city, ip.district, ip.neighborhoods,
           ip.budget_min, ip.budget_max, ip.currency,
           ip.bedrooms_min, ip.bedrooms_max, ip.rooms_min, ip.rooms_max, ip.area_min, ip.area_max,
           public.internal_lead_features(ip.requirements) as features,
           ip.created_at as demand_at,
           greatest(ip.created_at, coalesce(ip.last_active_at, ip.created_at), coalesce(sub.last_active_at, sub.created_at)) as active_at,
           case when sub.on_behalf then 'BROKER_FOR_CLIENT'
                when usr.account_type::text is distinct from 'PERSONAL' then 'PROFESSIONAL'
                else 'DIRECT' end as searcher,
           seg.segment, seg.budget_usd,
           c.category, c.kind, c.confidence, public.internal_lead_explanation(c) as explanation,
           case when mp.price_key = 'PREMIUM' then 'VIP' else c.category end as display_category,
           mp.price_key,
           case when upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end as tx,
           case when ip.intent_type::text in ('RENT', 'RELOCATE_RENT') or upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT'
                when ip.intent_type::text = 'INVEST' or upper(coalesce(ip.transaction_type, '')) = 'INVESTMENT' then 'INVEST'
                else 'BUY' end as interest,
           case when r.match_score >= 0.8 then 'STRONG' when r.match_score >= 0.5 then 'POTENTIAL' else 'WEAK' end as band,
           (u.id is not null) as unlocked,
           cr.status as crm_status, cr.id as crm_entry_id,
           exists (select 1 from public.internal_lead_saved sv where sv.account_user_id = v_me and sv.match_id = r.match_id) as saved,
           (cr.status is not null and cr.status <> 'UNLOCKED') as contacted,
           ((v_seen is null and r.matched_at > now() - interval '7 days') or (v_seen is not null and r.matched_at > v_seen)) as fresh,
           prefs.share_phone_on_unlock, prefs.share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.email is not null and position('@' in usr.email) > 1 as has_email,
           usr.nickname, usr.full_name, usr.preferred_language,
           mp.price_key as member_key, mp.reasons as price_reasons, mp.mortgage as has_mortgage, mp.search_match as has_search,
           mp.expat as has_expat, ep.nationality as ex_country, ep.arrival_date as ex_arrival,
           ep.arrival_unknown as ex_arrival_unknown, ep.stay_length as ex_stay,
           mi.signal_count as mi_signals, mi.last_signal_at as mi_last,
           (p_property_id = any (coalesce(mi.property_ids, '{}'::uuid[]))) as mi_listing
      from public.internal_lead_rows(v_me, p_property_id) r
      join public.internal_match_candidates c on c.id = r.match_id
      join public.intent_profiles ip on ip.id = r.intent_profile_id
      join public.users usr on usr.id = r.lead_user_id
      left join lateral (select s.on_behalf, s.last_active_at, s.created_at
                           from public.active_search_subscriptions s
                          where s.user_id = r.lead_user_id and s.intent_id = r.intent_profile_id and s.is_active
                          order by s.created_at desc limit 1) sub on true
      cross join lateral public.internal_lead_segment(r.intent_profile_id) seg
      cross join lateral public.lead_contact_prefs_of(r.lead_user_id) prefs
      cross join lateral public.internal_lead_member_price(v_me, p_property_id, r.lead_user_id) mp
      left join public.mortgage_buyer_intents mi on mi.user_id = r.lead_user_id and mi.status = 'ACTIVE'
      /* Only what a seller may see of an expat: country and timing. Never notes, names or documents. */
      left join public.expat_profiles ep on ep.user_id = r.lead_user_id and mp.expat
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
      left join public.lead_crm_entries cr on cr.owner_user_id = v_me and cr.lead_user_id = r.lead_user_id
  ), marked as (
    select b.*, (b.active_at < now() - interval '45 days') as stale from base b where not v_disabled or b.unlocked
  ), filtered as (
    select * from marked b
     where (not ('STRONG' = any (v_filters)) or b.band = 'STRONG')
       and (not ('POTENTIAL' = any (v_filters)) or b.band = 'POTENTIAL')
       and (not ('STANDARD' = any (v_filters)) or b.segment = 'STANDARD')
       and (not ('PREMIUM' = any (v_filters)) or b.segment = 'PREMIUM')
       and (not ('MORTGAGE' = any (v_filters)) or b.has_mortgage)
       and (not ('EXPAT' = any (v_filters)) or b.has_expat)
       and (not ('VIP' = any (v_filters)) or b.display_category = 'VIP')
       and (not ('EXACT' = any (v_filters)) or b.display_category = 'EXACT')
       and (not ('NEARBY' = any (v_filters)) or b.display_category = 'NEARBY_SIMILAR')
       and (not ('HIGH_CONFIDENCE' = any (v_filters)) or b.confidence = 'HIGH')
       and (not ('FRESH' = any (v_filters)) or b.fresh)
       and (not ('UNLOCKED' = any (v_filters)) or b.unlocked)
       and (not ('LOCKED' = any (v_filters)) or not b.unlocked)
       and (not ('CONTACTED' = any (v_filters)) or b.contacted)
       and (not ('SAVED' = any (v_filters)) or b.saved)
       and (not ('DIRECT' = any (v_filters)) or b.searcher = 'DIRECT')
       and (not ('BROKER' = any (v_filters)) or b.searcher <> 'DIRECT')
       and (not ('STALE' = any (v_filters)) or b.stale)
       and (not ('ACTIVE' = any (v_filters)) or not b.stale)
       and (v_district is null or lower(coalesce(b.district, '')) = v_district
            or exists (select 1 from unnest(coalesce(b.neighborhoods, '{}'::text[])) nb where lower(nb) = v_district))
       and (v_ptype is null or v_ptype = any (coalesce(b.property_types, '{}'::text[])))
       and (cardinality(v_countries) = 0 or upper(coalesce(b.country, '')) = any (v_countries))
       and (cardinality(v_langs) = 0 or lower(coalesce(b.preferred_language, '')) = any (v_langs)
            or ('unknown' = any (v_langs) and coalesce(b.preferred_language, '') = ''))
       and (cardinality(v_interests) = 0 or b.interest = any (v_interests))
       and (v_q is null or position(v_q in lower(concat_ws(' ', b.city, b.district, array_to_string(b.neighborhoods, ' '),
                                                         array_to_string(b.property_types, ' '), b.explanation::text))) > 0)
  ), page as (
    select f.*, row_number() over (order by
       case when v_sort = 'CATEGORY' then case f.display_category when 'VIP' then 0 when 'EXACT' then 1 else 2 end end asc nulls last,
       case when v_sort in ('BEST', 'CATEGORY') then f.match_score end desc nulls last,
       case when v_sort = 'NEWEST' then f.demand_at end desc nulls last,
       case when v_sort = 'ACTIVE' then f.active_at end desc nulls last,
       case when v_sort = 'UPDATED' then f.updated_at end desc nulls last,
       case when v_sort = 'BUDGET_DESC' then f.budget_usd end desc nulls last,
       case when v_sort = 'BUDGET_ASC' then f.budget_usd end asc nulls last,
       f.match_score desc, f.match_id) as rn
      from filtered f
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object(
        'ALL', count(*),
        'EXACT', count(*) filter (where display_category = 'EXACT'),
        'NEARBY', count(*) filter (where display_category = 'NEARBY_SIMILAR'),
        'VIP', count(*) filter (where display_category = 'VIP'),
        'HIGH_CONFIDENCE', count(*) filter (where confidence = 'HIGH'),
        'STRONG', count(*) filter (where band = 'STRONG'),
        'POTENTIAL', count(*) filter (where band = 'POTENTIAL'),
        'STANDARD', count(*) filter (where segment = 'STANDARD'),
        'PREMIUM', count(*) filter (where segment = 'PREMIUM'),
        'MORTGAGE', count(*) filter (where has_mortgage),
        'EXPAT', count(*) filter (where has_expat),
        'FRESH', count(*) filter (where fresh),
        'UNLOCKED', count(*) filter (where unlocked),
        'LOCKED', count(*) filter (where not unlocked),
        'CONTACTED', count(*) filter (where contacted),
        'SAVED', count(*) filter (where saved),
        'DIRECT', count(*) filter (where searcher = 'DIRECT'),
        'BROKER', count(*) filter (where searcher <> 'DIRECT'),
        'STALE', count(*) filter (where stale),
        'ACTIVE', count(*) filter (where not stale)) from marked),
    'facets', jsonb_build_object(
        'districts', coalesce((select jsonb_agg(distinct d order by d) from (
            select b.district as d from marked b where b.district is not null
            union select nb from marked b, unnest(coalesce(b.neighborhoods, '{}'::text[])) nb) x), '[]'::jsonb),
        'propertyTypes', coalesce((select jsonb_agg(distinct t order by t) from marked b, unnest(coalesce(b.property_types, '{}'::text[])) t), '[]'::jsonb),
        'countries', coalesce((select jsonb_object_agg(c, n) from (select upper(b.country) c, count(*) n from marked b where coalesce(b.country, '') <> '' group by 1) x), '{}'::jsonb),
        /* Language is filterable on the server, never listed per locked member: the facet counts only
           members this account already unlocked (their language is disclosed to it anyway). */
        'languages', coalesce((select jsonb_object_agg(lg, n) from (select coalesce(nullif(lower(b.preferred_language), ''), 'unknown') lg, count(*) n from marked b where b.unlocked group by 1) x), '{}'::jsonb),
        'interests', coalesce((select jsonb_object_agg(i, n) from (select b.interest i, count(*) n from marked b group by 1) x), '{}'::jsonb)),
    'ids', case when v_with_ids and not v_disabled then coalesce((select jsonb_agg(x.match_id order by x.rn) from (select match_id, rn from page order by rn limit 500) x), '[]'::jsonb) end,
    'disabled', v_disabled,
    'prices', v_prices,
    'preferences', public.internal_match_preferences_of(p_property_id),
    'lastSeenAt', v_seen,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'matchId', pg.match_id,
        'score', round(pg.match_score * 100),
        'band', pg.band,
        'segment', case when pg.price_key in ('MORTGAGE', 'MORTGAGE_MATCH', 'EXPAT') then pg.price_key else pg.segment end,
        'origin', case when pg.has_expat then 'EXPAT' when pg.has_mortgage and pg.has_search then 'MORTGAGE_AND_SEARCH' when pg.has_mortgage then 'MORTGAGE' else 'SEARCH' end,
        'expat', case when pg.has_expat then jsonb_build_object(
            'country', pg.ex_country,
            'arrivalMonth', case when coalesce(pg.ex_arrival_unknown, false) then null else to_char(pg.ex_arrival, 'YYYY-MM') end,
            'stay', pg.ex_stay) end,
        'priceReasons', to_jsonb(pg.price_reasons),
        'mortgage', case when pg.has_mortgage then jsonb_build_object(
            'calculatorUse', case when pg.mi_signals > 1 then 'REPEATED' else 'ONCE' end,
            'lastUseMonth', to_char(pg.mi_last, 'YYYY-MM'),
            'thisListing', pg.mi_listing) end,
        'category', pg.display_category,
        'matchCategory', pg.category,
        'kind', pg.kind,
        'confidence', pg.confidence,
        'explanation', pg.explanation,
        'priceKey', pg.price_key,
        'priceCredits', (v_prices ->> pg.price_key)::numeric,
        'unlocked', pg.unlocked,
        'contacted', pg.contacted,
        'crmStatus', pg.crm_status,
        'crmEntryId', pg.crm_entry_id,
        'saved', pg.saved,
        'fresh', pg.fresh,
        'stale', pg.stale,
        'searcher', pg.searcher,
        'transaction', pg.tx,
        'interest', pg.interest,
        'country', pg.country,
        'intentType', pg.intent_type,
        'propertyTypes', to_jsonb(coalesce(pg.property_types, '{}'::text[])),
        'locations', jsonb_build_object('city', pg.city, 'district', pg.district,
                                        'neighborhoods', to_jsonb(coalesce(pg.neighborhoods, '{}'::text[]))),
        'budget', case when pg.budget_min is null and pg.budget_max is null then null else jsonb_build_object(
                    'min', public.internal_lead_round_budget(pg.budget_min, pg.tx),
                    'max', public.internal_lead_round_budget(pg.budget_max, pg.tx),
                    'currency', pg.currency) end,
        'requirements', jsonb_strip_nulls(jsonb_build_object(
                    'bedroomsMin', pg.bedrooms_min, 'bedroomsMax', pg.bedrooms_max,
                    'roomsMin', pg.rooms_min, 'roomsMax', pg.rooms_max,
                    'areaMin', pg.area_min, 'areaMax', pg.area_max)),
        'features', pg.features,
        'agreed', to_jsonb(pg.agreed),
        'conflicted', to_jsonb(pg.conflicted),
        'unknown', to_jsonb(pg.unknown_dimensions),
        'demandAt', pg.demand_at,
        'activeAt', pg.active_at,
        'matchedAt', pg.matched_at,
        'updatedAt', pg.updated_at,
        'contactOptions', jsonb_build_object(
            'message', true,
            'phone', pg.share_phone_on_unlock and pg.has_phone,
            'email', pg.share_email_on_unlock and pg.has_email),
        'displayName', case when pg.unlocked then coalesce(nullif(pg.nickname, ''),
                         nullif(split_part(coalesce(pg.full_name, ''), ' ', 1), '')) end,
        'language', case when pg.unlocked then pg.preferred_language::text end
      ) order by pg.rn) from page pg where pg.rn > v_offset and pg.rn <= v_offset + v_limit), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;


/* ════════════════════════════════════════════════════════════════════════
 * 4 · Admin: My Georgia, from counts only
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.admin_expat_profile_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_total bigint;
  v_done bigint;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select count(*), count(*) filter (where onboarding_completed_at is not null) into v_total, v_done from public.expat_profiles;
  return jsonb_build_object(
    'profiles', v_total,
    'completed', v_done,
    'completionRate', case when v_total > 0 then round(v_done::numeric / v_total, 4) end,
    'byStep', coalesce((select jsonb_object_agg(onboarding_step, n) from (
        select onboarding_step, count(*) n from public.expat_profiles where onboarding_completed_at is null group by 1) x), '{}'::jsonb),
    'countries', coalesce((select jsonb_object_agg(c, n) from (
        select coalesce(nationality, 'UNKNOWN') c, count(*) n from public.expat_profiles group by 1 order by 2 desc limit 25) x), '{}'::jsonb),
    'cities', coalesce((select jsonb_object_agg(c, n) from (
        select c, count(*) n from public.expat_profiles, unnest(cities) c group by 1) x), '{}'::jsonb),
    'intents', coalesce((select jsonb_object_agg(i, n) from (
        select coalesce(property_intent, 'UNKNOWN') i, count(*) n from public.expat_profiles group by 1) x), '{}'::jsonb),
    'budgets', coalesce((select jsonb_object_agg(b, n) from (
        select budget_band b, count(*) n from public.expat_profiles where budget_band is not null group by 1) x), '{}'::jsonb),
    'rents', coalesce((select jsonb_object_agg(b, n) from (
        select rent_band b, count(*) n from public.expat_profiles where rent_band is not null group by 1) x), '{}'::jsonb),
    'inMatching', (select count(*) from public.expat_profiles where matching_intent_profile_id is not null),
    'matchedListings', (select count(*) from public.internal_match_candidates c
                          join public.expat_profiles e on e.matching_intent_profile_id = c.intent_profile_id),
    'uniqueUnlocks', (select count(*) from public.internal_lead_unlocks where segment = 'EXPAT'),
    'unlockCredits', (select coalesce(sum(credits_charged), 0) from public.internal_lead_unlocks where segment = 'EXPAT'),
    'price', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                from public.billable_products p where p.code = 'INTERNAL_LEAD_EXPAT'));
end $$;
revoke all on function public.admin_expat_profile_stats() from public, anon;
grant execute on function public.admin_expat_profile_stats() to authenticated;
