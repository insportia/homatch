-- HOMI workstream · Mortgage workspace, and Home Financing buyers in HOMATCH Matching.
--
-- 1 · mortgage_scenarios.engine_version: which payment engine produced a
--     saved result, so an old snapshot is never silently re-read as new.
--
-- 2 · BUYER INTENT FROM HOME FINANCING, BY EXPLICIT CONSENT ONLY.
--     Home Financing is not a lead marketplace and sells nothing. A mortgage
--     calculation is not permission to share anybody. A person who ticks nothing
--     shares nothing. A person who opts in to receive property offers shares
--     exactly the fields on the opt-in form (area, property type, a budget they
--     confirmed, rooms, timeframe, which contact channels) and nothing from
--     mortgage_scenarios: no income, debts, credit history, employer, bank,
--     guarantor, residency or co-borrower data. The opt-in is a statement the
--     person made, not an inference from their finances.
--
--     One row per HOMATCH account (users.id, the canonical member identity the
--     Matching engine already uses). While active, the consent is represented by
--     ONE ordinary member search in the existing Matching engine (intent_profiles +
--     active_search_subscriptions, demand_source MORTGAGE): supply-matching scores
--     it against listings like every other search, and it appears in the existing
--     Matching feed alongside the other buyer leads, deduplicated per member by the
--     feed's existing one-row-per-person rule.
--
-- 3 · PRICE IN MATCHING: a member whose matched search came from Home Financing is
--     the MORTGAGE segment of HOMATCH Leads, product INTERNAL_LEAD_MORTGAGE, 30 US
--     cents = 3 credits at 1 credit = 10 cents. It is charged only when a Matching
--     user unlocks the contact, through the existing internal_leads_unlock (same
--     wallet reserve + settle, same idempotency, same per-account advisory lock,
--     same internal_lead_unlocks entitlement whose unique (account, member) means an
--     account never pays twice for the same person by any route). STANDARD, EXACT
--     and PREMIUM keep their products, prices and rules exactly.
--
-- The Matching functions redefined here are the production definitions with the one
-- segment added. Idempotent: create or replace, if not exists, on conflict do nothing.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · saved scenario engine version
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.mortgage_scenarios
  add column if not exists engine_version text not null default 'mortgage-engine-1';

/* ════════════════════════════════════════════════════════════════════════
 * 2 · consented buyer intent
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.mortgage_buyer_intents (
  user_id          uuid primary key references public.users(id) on delete cascade,
  status           text not null check (status in ('ACTIVE', 'WITHDRAWN')),
  consent_version  text not null,
  consented_at     timestamptz not null,
  withdrawn_at     timestamptz,
  city             text check (city is null or length(city) <= 80),
  district         text check (district is null or length(district) <= 80),
  property_types   text[] not null default '{}',
  rooms_min        integer check (rooms_min is null or rooms_min between 1 and 20),
  budget_min       numeric(14,2) check (budget_min is null or budget_min >= 0),
  budget_max       numeric(14,2) check (budget_max is null or budget_max >= 0),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  timeframe        text check (timeframe is null or timeframe in ('NOW', 'MONTHS_3', 'MONTHS_6', 'LATER')),
  property_id      uuid references public.properties(id) on delete set null,
  -- Every listing the person calculated a mortgage for while opted in (latest last, at most 20).
  property_ids     uuid[] not null default '{}' check (cardinality(property_ids) <= 20),
  share_phone      boolean not null default false,
  share_email      boolean not null default false,
  signal_count     integer not null default 1 check (signal_count >= 1),
  first_signal_at  timestamptz not null default now(),
  last_signal_at   timestamptz not null default now(),
  -- The ordinary Matching search this consent is represented by, while it is active.
  intent_profile_id uuid references public.intent_profiles(id) on delete set null,
  subscription_id   uuid references public.active_search_subscriptions(id) on delete set null,
  updated_at       timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create unique index if not exists mortgage_buyer_intents_profile
  on public.mortgage_buyer_intents (intent_profile_id) where intent_profile_id is not null;
alter table public.mortgage_buyer_intents enable row level security;
revoke all on public.mortgage_buyer_intents from anon, authenticated;
drop policy if exists mortgage_buyer_intents_own_read on public.mortgage_buyer_intents;
create policy mortgage_buyer_intents_own_read on public.mortgage_buyer_intents
  for select using (user_id = public.current_homatch_user_id());
grant select on public.mortgage_buyer_intents to authenticated;

-- Every grant, change and withdrawal, for the record a data-protection request needs.
create table if not exists public.mortgage_buyer_consent_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  action           text not null check (action in ('GRANTED', 'UPDATED', 'WITHDRAWN')),
  consent_version  text not null,
  shared           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists mortgage_buyer_consent_events_user on public.mortgage_buyer_consent_events (user_id, created_at desc);
alter table public.mortgage_buyer_consent_events enable row level security;
revoke all on public.mortgage_buyer_consent_events from anon, authenticated;

/*
 * THE CONSENT, AS A MATCHING SEARCH.
 *
 * An active opt-in is represented by one ordinary member search: an intent_profiles row
 * (requirement only, no person) and an active_search_subscriptions row (the person, side
 * SUPPLY like every Find Property search, demand_source MORTGAGE). The supply-matching
 * worker scores it against listings exactly as it scores any other member's search, and
 * the Matching feed shows it with the other buyer leads. The area comes from the form, or
 * from the listing the person calculated for when the form left it empty; without an area
 * there is nothing to match on, and no search is written.
 *
 * Withdrawal deletes the search outright: its match rows go with it (ON DELETE CASCADE),
 * so the person leaves every seller's Matching list at once and none of the stated
 * preferences survive anywhere but the consent record.
 */
create or replace function public.mortgage_intent_sync_matching(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_i public.mortgage_buyer_intents;
  v_city text;
  v_district text;
  v_types text[];
  v_profile uuid;
  v_sub uuid;
  v_lang text;
begin
  select * into v_i from public.mortgage_buyer_intents where user_id = p_user_id for update;
  if not found then return null; end if;

  if v_i.status <> 'ACTIVE' then
    if v_i.subscription_id is not null then delete from public.active_search_subscriptions where id = v_i.subscription_id; end if;
    if v_i.intent_profile_id is not null then delete from public.intent_profiles where id = v_i.intent_profile_id; end if;
    update public.mortgage_buyer_intents set intent_profile_id = null, subscription_id = null where user_id = p_user_id;
    return null;
  end if;

  select coalesce(v_i.city, f.city), coalesce(v_i.district, case when v_i.city is null then f.district end),
         case when cardinality(v_i.property_types) > 0 then v_i.property_types
              when pr.property_type is not null then array[pr.property_type::text] end
    into v_city, v_district, v_types
    from (select 1) one
    left join public.properties pr on pr.id = v_i.property_id
    left join public.property_facts f on f.property_id = pr.id;

  if v_city is null then
    -- Nothing to match on yet: no search, and none left over from an earlier answer.
    if v_i.subscription_id is not null then delete from public.active_search_subscriptions where id = v_i.subscription_id; end if;
    if v_i.intent_profile_id is not null then delete from public.intent_profiles where id = v_i.intent_profile_id; end if;
    update public.mortgage_buyer_intents set intent_profile_id = null, subscription_id = null where user_id = p_user_id;
    return null;
  end if;

  select u.preferred_language::text into v_lang from public.users u where u.id = p_user_id;
  v_profile := v_i.intent_profile_id;
  if v_profile is not null and exists (select 1 from public.intent_profiles where id = v_profile) then
    update public.intent_profiles set
      city = v_city, district = v_district, property_types = v_types,
      rooms_min = v_i.rooms_min, budget_min = v_i.budget_min, budget_max = v_i.budget_max, currency = v_i.currency,
      timeline = v_i.timeframe, language = v_lang, last_active_at = now()
     where id = v_profile;
  else
    insert into public.intent_profiles
      (intent_type, country, city, district, transaction_type, property_types, rooms_min,
       budget_min, budget_max, currency, timeline, language, intent_confidence, classifier_version, last_active_at)
    values ('BUY', 'GE', v_city, v_district, 'SALE', v_types, v_i.rooms_min,
            v_i.budget_min, v_i.budget_max, v_i.currency, v_i.timeframe, v_lang, 1, 'mortgage-optin-1', now())
    returning id into v_profile;
  end if;

  v_sub := v_i.subscription_id;
  if v_sub is not null and exists (select 1 from public.active_search_subscriptions where id = v_sub) then
    update public.active_search_subscriptions
       set intent_id = v_profile, is_active = true, last_active_at = now(),
           search_criteria = jsonb_build_object('origin', 'MORTGAGE')
     where id = v_sub;
  else
    insert into public.active_search_subscriptions (user_id, intent_id, side, is_active, demand_source, search_criteria, last_active_at)
    values (p_user_id, v_profile, 'SUPPLY', true, 'MORTGAGE', jsonb_build_object('origin', 'MORTGAGE'), now())
    returning id into v_sub;
  end if;

  update public.mortgage_buyer_intents set intent_profile_id = v_profile, subscription_id = v_sub where user_id = p_user_id;
  return v_profile;
end $$;
revoke all on function public.mortgage_intent_sync_matching(uuid) from public, anon, authenticated;

create or replace function public.my_mortgage_buyer_intent()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when i.user_id is null then null else jsonb_build_object(
    'status', i.status, 'consentedAt', i.consented_at, 'withdrawnAt', i.withdrawn_at,
    'city', i.city, 'district', i.district, 'propertyTypes', to_jsonb(i.property_types),
    'roomsMin', i.rooms_min, 'budgetMin', i.budget_min, 'budgetMax', i.budget_max, 'currency', i.currency,
    'timeframe', i.timeframe, 'propertyId', i.property_id, 'propertyIds', to_jsonb(i.property_ids),
    'sharePhone', i.share_phone, 'shareEmail', i.share_email, 'lastSignalAt', i.last_signal_at,
    -- Whether sellers can find this person in Matching right now, and why not when they cannot.
    'inMatching', i.status = 'ACTIVE' and i.intent_profile_id is not null,
    'acceptsOffers', (select p.accept_property_offers from public.lead_contact_prefs_of(i.user_id) p)) end
    from (select 1) one
    left join public.mortgage_buyer_intents i on i.user_id = public.current_homatch_user_id()
$$;
revoke all on function public.my_mortgage_buyer_intent() from public, anon;
grant execute on function public.my_mortgage_buyer_intent() to authenticated;

/* Opt in, or refresh the stated preferences. Only the listed keys are read. */
create or replace function public.set_my_mortgage_buyer_intent(p jsonb, p_consent_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_prev public.mortgage_buyer_intents;
  v_types text[];
  v_shared jsonb;
  v_property uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_consent_version is null or length(p_consent_version) not between 3 and 40 then raise exception 'CONSENT_VERSION_REQUIRED'; end if;
  if not coalesce((p->>'sharePhone')::boolean, false) and not coalesce((p->>'shareEmail')::boolean, false) then
    raise exception 'CHANNEL_REQUIRED';
  end if;
  v_types := coalesce((select array_agg(distinct upper(btrim(x))) from jsonb_array_elements_text(
               case when jsonb_typeof(p->'propertyTypes') = 'array' then p->'propertyTypes' else '[]'::jsonb end) x
             where upper(btrim(x)) in ('APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','OFFICE','PENTHOUSE','STUDIO','TOWNHOUSE','OTHER')), '{}');
  -- A property reference is kept only if it is a live listing: never a way to probe ids.
  select pr.id into v_property from public.properties pr
   where pr.id = nullif(p->>'propertyId', '')::uuid and not pr.is_deleted;
  select * into v_prev from public.mortgage_buyer_intents where user_id = v_me for update;

  insert into public.mortgage_buyer_intents as i
    (user_id, status, consent_version, consented_at, withdrawn_at, city, district, property_types, rooms_min,
     budget_min, budget_max, currency, timeframe, property_id, property_ids, share_phone, share_email,
     signal_count, first_signal_at, last_signal_at, updated_at)
  values
    (v_me, 'ACTIVE', p_consent_version, now(), null,
     nullif(left(btrim(coalesce(p->>'city', '')), 80), ''), nullif(left(btrim(coalesce(p->>'district', '')), 80), ''),
     v_types, nullif(p->>'roomsMin', '')::integer,
     round(nullif(p->>'budgetMin', '')::numeric, -3), round(nullif(p->>'budgetMax', '')::numeric, -3),
     nullif(upper(p->>'currency'), ''), nullif(p->>'timeframe', ''), v_property,
     case when v_property is null then '{}'::uuid[] else array[v_property] end,
     coalesce((p->>'sharePhone')::boolean, false), coalesce((p->>'shareEmail')::boolean, false),
     1, now(), now(), now())
  on conflict (user_id) do update set
    status = 'ACTIVE',
    consent_version = excluded.consent_version,
    consented_at = case when i.status = 'ACTIVE' then i.consented_at else now() end,
    withdrawn_at = null,
    city = excluded.city, district = excluded.district, property_types = excluded.property_types,
    rooms_min = excluded.rooms_min, budget_min = excluded.budget_min, budget_max = excluded.budget_max,
    currency = excluded.currency, timeframe = excluded.timeframe,
    property_id = coalesce(excluded.property_id, i.property_id),
    -- A new listing joins the list (moved to the end if already there); the oldest drop off past 20.
    property_ids = case when excluded.property_id is null then i.property_ids else
      (select coalesce(array_agg(x order by o), '{}') from (
         select x, o from unnest(array_remove(i.property_ids, excluded.property_id) || excluded.property_id) with ordinality as t(x, o)
         order by o desc limit 20) last20) end,
    share_phone = excluded.share_phone, share_email = excluded.share_email,
    signal_count = i.signal_count + 1, last_signal_at = now(), updated_at = now();

  perform public.mortgage_intent_sync_matching(v_me);

  select jsonb_build_object('city', city, 'district', district, 'propertyTypes', to_jsonb(property_types),
           'roomsMin', rooms_min, 'budgetMin', budget_min, 'budgetMax', budget_max, 'currency', currency,
           'timeframe', timeframe, 'propertyId', property_id, 'propertyIds', to_jsonb(property_ids),
           'sharePhone', share_phone, 'shareEmail', share_email, 'inMatching', intent_profile_id is not null)
    into v_shared from public.mortgage_buyer_intents where user_id = v_me;
  insert into public.mortgage_buyer_consent_events (user_id, action, consent_version, shared)
  values (v_me, case when v_prev.user_id is null or v_prev.status = 'WITHDRAWN' then 'GRANTED' else 'UPDATED' end,
          p_consent_version, v_shared);
  return public.my_mortgage_buyer_intent();
end $$;
revoke all on function public.set_my_mortgage_buyer_intent(jsonb, text) from public, anon;
grant execute on function public.set_my_mortgage_buyer_intent(jsonb, text) to authenticated;

/* Withdraw: out of Matching at once, no new unlocks, contact reads stop, and the stated
   preferences are erased (the consent events keep the record of what was shared and when). */
create or replace function public.withdraw_my_mortgage_buyer_intent()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_version text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update public.mortgage_buyer_intents
     set status = 'WITHDRAWN', withdrawn_at = now(),
         share_phone = false, share_email = false,
         city = null, district = null, property_types = '{}', rooms_min = null,
         budget_min = null, budget_max = null, currency = null, timeframe = null,
         property_id = null, property_ids = '{}', updated_at = now()
   where user_id = v_me and status = 'ACTIVE'
  returning consent_version into v_version;
  if found then
    perform public.mortgage_intent_sync_matching(v_me);
    insert into public.mortgage_buyer_consent_events (user_id, action, consent_version) values (v_me, 'WITHDRAWN', v_version);
  end if;
  return public.my_mortgage_buyer_intent();
end $$;
revoke all on function public.withdraw_my_mortgage_buyer_intent() from public, anon;
grant execute on function public.withdraw_my_mortgage_buyer_intent() to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · value-based price for Home Financing buyer intent in HOMATCH Leads
 *
 *   Mortgage interest only ........................................ MORTGAGE        3 credits
 *   Mortgage interest + the person's own property search also
 *   matching this listing (two independent, verified signals) ..... MORTGAGE_MATCH  5 credits
 *   Anything else keeps its existing price: STANDARD 3, EXACT 5, PREMIUM 10. A PREMIUM
 *   (high-budget) search stays PREMIUM when mortgage interest is added: a signal never
 *   lowers a price.
 *
 * The price belongs to the person and the listing, not to one search row: every Matching
 * surface asks internal_lead_member_price, so the feeds, the quote and the unlock agree, and
 * each price comes with the reasons that produced it. The production segment and price-key
 * functions are not changed.
 *
 * One person, one payment per account: internal_lead_unlocks (unique account, member) is the
 * entitlement for every route, checked under the per-account advisory lock before any charge.
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  -- Internal member data, no external cost: the same zero landed COGS as the other HOMATCH Leads products.
  ('INTERNAL_LEAD_MORTGAGE', 'HOMATCH Leads — mortgage interest', 'FIXED',
   true, 30, 0, 0, 'PER_UNIT', true, true, 95,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'MORTGAGE'), 0),
  ('INTERNAL_LEAD_MORTGAGE_MATCH', 'HOMATCH Leads — mortgage interest and a matching property search', 'FIXED',
   true, 50, 0, 0, 'PER_UNIT', true, true, 96,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'MORTGAGE_MATCH'), 0)
on conflict (code) do nothing;

alter table public.internal_lead_unlocks drop constraint if exists internal_lead_unlocks_segment_check;
alter table public.internal_lead_unlocks add constraint internal_lead_unlocks_segment_check
  check (segment in ('STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH'));

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
    'active', coalesce((select bool_and(p.enabled and not p.kill_switch and p.pricing_active) and count(*) = 3
                          from public.billable_products p
                         where p.code in ('INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM')), false),
    -- Separate switches, so turning a mortgage price off never stops the other segments.
    'mortgageActive', coalesce((select p.enabled and not p.kill_switch and p.pricing_active
                                  from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE'), false),
    'mortgageMatchActive', coalesce((select p.enabled and not p.kill_switch and p.pricing_active
                                       from public.billable_products p where p.code = 'INTERNAL_LEAD_MORTGAGE_MATCH'), false))
$$;

/* The public prices of the two mortgage segments, for Home Financing copy and Admin. */
create or replace function public.mortgage_lead_price()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cents', m.standard_retail_cents,
    'credits', round(m.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2),
    'active', m.enabled and not m.kill_switch and m.pricing_active,
    'withSearch', (select jsonb_build_object(
        'cents', x.standard_retail_cents,
        'credits', round(x.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2),
        'active', x.enabled and not x.kill_switch and x.pricing_active)
      from public.billable_products x where x.code = 'INTERNAL_LEAD_MORTGAGE_MATCH'))
    from public.billable_products m where m.code = 'INTERNAL_LEAD_MORTGAGE'
$$;
revoke all on function public.mortgage_lead_price() from public, anon;
grant execute on function public.mortgage_lead_price() to authenticated, service_role;

/*
 * THE PRICE OF ONE PERSON FOR ONE LISTING, AND WHY.
 *
 * Evidence is the engine's own match rows for this owner, listing and person that Matching
 * would show (active search, visible under the owner's preferences): a row from the person's
 * Home Financing consent is mortgage interest; the best other row is their property search.
 * Reasons: MORTGAGE_INTEREST, SEARCH_MATCH or EXACT_SEARCH_MATCH, HIGH_BUDGET.
 */
create or replace function public.internal_lead_member_price(p_owner uuid, p_property_id uuid, p_member uuid)
returns table (price_key text, reasons text[], mortgage boolean, search_match boolean)
language sql stable security definer set search_path = public as $$
  with c as (
    select c.category, c.intent_profile_id, c.score,
           exists (select 1 from public.mortgage_buyer_intents i
                    where i.intent_profile_id = c.intent_profile_id and i.status = 'ACTIVE') as is_mortgage
      from public.internal_match_candidates c
     where c.property_id = p_property_id and c.supply_user_id = p_owner and c.demand_user_id = p_member
       and public.internal_match_visible(c.property_id, c.kind, c.budget_verdict, c.geo_km)
       and exists (select 1 from public.active_search_subscriptions s
                    where s.user_id = c.demand_user_id and s.intent_id = c.intent_profile_id and s.is_active)
  ), m as (
    select coalesce(bool_or(c.is_mortgage), false) as yes from c
  ), s as (
    select c.category, public.internal_lead_price_key(c.category, c.intent_profile_id) as key
      from c where not c.is_mortgage
     order by (c.category = 'EXACT') desc, c.score desc
     limit 1
  )
  select case when m.yes and s.key = 'PREMIUM' then 'PREMIUM'
              when m.yes and s.key is not null then 'MORTGAGE_MATCH'
              when m.yes then 'MORTGAGE'
              else coalesce(s.key, 'STANDARD') end,
         array_remove(array[
           case when s.key = 'PREMIUM' then 'HIGH_BUDGET' end,
           case when m.yes then 'MORTGAGE_INTEREST' end,
           case when s.category = 'EXACT' then 'EXACT_SEARCH_MATCH' when s.key is not null then 'SEARCH_MATCH' end
         ]::text[], null),
         m.yes,
         s.key is not null
    from m left join s on true
$$;
revoke all on function public.internal_lead_member_price(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_member_price(uuid, uuid, uuid) to service_role;

/* The person behind each selected row, once, priced for the listing that row belongs to. */
create or replace function public.internal_lead_pick(p_user_id uuid, p_match_ids uuid[])
returns table (match_id uuid, lead_user_id uuid, intent_profile_id uuid, property_id uuid, price_key text)
language sql stable security definer set search_path = public as $$
  select x.id, x.demand_user_id, x.intent_profile_id, x.property_id,
         (select mp.price_key from public.internal_lead_member_price(p_user_id, x.property_id, x.demand_user_id) mp)
    from (
      select distinct on (c.demand_user_id) c.id, c.demand_user_id, c.intent_profile_id, c.property_id
        from public.internal_match_candidates c
       where c.id = any (coalesce(p_match_ids, '{}'::uuid[]))
         and c.supply_user_id = p_user_id
         and exists (select 1 from public.internal_lead_rows(p_user_id, c.property_id) r where r.lead_user_id = c.demand_user_id)
       order by c.demand_user_id, (c.category = 'EXACT') desc, c.score desc
    ) x
$$;

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
    'standardCredits', coalesce(sum((v_prices->>'STANDARD')::numeric) filter (where not already and price_key = 'STANDARD'), 0),
    'exactCredits', coalesce(sum((v_prices->>'EXACT')::numeric) filter (where not already and price_key = 'EXACT'), 0),
    'premiumCredits', coalesce(sum((v_prices->>'PREMIUM')::numeric) filter (where not already and price_key = 'PREMIUM'), 0),
    'mortgageCredits', coalesce(sum((v_prices->>'MORTGAGE')::numeric) filter (where not already and price_key = 'MORTGAGE'), 0),
    'mortgageMatchCredits', coalesce(sum((v_prices->>'MORTGAGE_MATCH')::numeric) filter (where not already and price_key = 'MORTGAGE_MATCH'), 0),
    'totalCredits', coalesce(sum((v_prices->>price_key)::numeric) filter (where not already), 0),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id),
    'prices', v_prices)
    into v_out from priced;
  return v_out;
end $$;

/*
 * The unlock: production's, with the two mortgage segments and a price guard. The client
 * sends the total it showed (p_expected_credits); if new evidence raised a price since the
 * quote, nothing is charged and PRICE_CHANGED asks for a fresh quote. A lower total goes
 * through. An older caller that sends no expected total behaves exactly as before.
 */
drop function if exists public.internal_leads_unlock(uuid, uuid[], text);
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

  foreach v_seg in array array['STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH'] loop
    select count(*) into v_n from pg_temp.ilu_pick where not already and segment = v_seg;
    continue when v_n = 0;
    if v_seg = 'MORTGAGE' and not coalesce((v_prices->>'mortgageActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
    if v_seg = 'MORTGAGE_MATCH' and not coalesce((v_prices->>'mortgageMatchActive')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
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

/* Contact after an unlock: the member's general preferences, plus the channels they ticked
   in their Home Financing consent while it is active. Every read that shows a channel is recorded. */
create or replace function public.internal_lead_contact(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_ent record;
  v_user record;
  v_prefs record;
  v_mi public.mortgage_buyer_intents;
  v_blocked boolean;
  v_phone text;
  v_email text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_ent from public.internal_lead_entitled(v_me, p_match_id);
  if v_ent.lead_user_id is null then raise exception 'not unlocked' using errcode = '42501'; end if;
  select * into v_user from public.users where id = v_ent.lead_user_id;
  if not found or v_user.suspended_at is not null then
    return jsonb_build_object('restricted', true, 'reason', 'UNAVAILABLE');
  end if;
  select * into v_prefs from public.lead_contact_prefs_of(v_ent.lead_user_id);
  select * into v_mi from public.mortgage_buyer_intents where user_id = v_ent.lead_user_id and status = 'ACTIVE';
  select exists (select 1 from public.conversation_blocks b
                  where (b.blocker_id = v_ent.lead_user_id and b.blocked_id = v_me)
                     or (b.blocker_id = v_me and b.blocked_id = v_ent.lead_user_id)) into v_blocked;
  if v_blocked then return jsonb_build_object('restricted', true, 'reason', 'BLOCKED'); end if;
  if not v_prefs.accept_property_offers then
    return jsonb_build_object('restricted', true, 'reason', 'NOT_ACCEPTING_OFFERS');
  end if;
  if (v_prefs.share_phone_on_unlock or coalesce(v_mi.share_phone, false)) and v_user.phone is not null and length(v_user.phone) > 4 then
    v_phone := v_user.phone;
  end if;
  if v_prefs.share_email_on_unlock or coalesce(v_mi.share_email, false) then v_email := v_user.email; end if;
  if v_phone is not null or (v_email is not null and coalesce(v_mi.share_email, false)) then
    insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
    values (v_me, v_ent.lead_user_id, v_ent.property_id, 'INTERNAL_LEAD_UNLOCK', v_ent.unlock_id);
  end if;
  return jsonb_build_object(
    'restricted', false,
    'displayName', coalesce(nullif(v_user.nickname, ''), nullif(split_part(coalesce(v_user.full_name, ''), ' ', 1), '')),
    'language', v_user.preferred_language::text,
    'canMessage', true,
    'phone', v_phone,
    'email', v_email,
    'marketingEmail', v_prefs.accept_marketing_email and v_email is not null);
end $$;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · the Matching feeds: mortgage-origin members among the other buyer leads
 *
 * Production definitions, with: the price, its key and its reasons from
 * internal_lead_member_price (one person, one listing); 'origin' (SEARCH, MORTGAGE or
 * MORTGAGE_AND_SEARCH); a MORTGAGE filter and count (anyone with mortgage interest here); and,
 * with mortgage interest, the indicators the person agreed to share: that they used the
 * mortgage calculator (once or repeatedly, and the month of the latest use), whether it was
 * for THIS listing, and their timeframe.
 * Budget, area and property type are the search itself and are shown like any other.
 * Nothing from the mortgage calculation (income, debts, rate, payment, readiness answers,
 * guarantor, residency) exists in these tables, so nothing of it can be shown.
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
           prefs.share_phone_on_unlock or coalesce(mi.share_phone, false) as share_phone_on_unlock,
           prefs.share_email_on_unlock or coalesce(mi.share_email, false) as share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.nickname, usr.full_name, usr.preferred_language,
           mp.price_key as member_key, mp.reasons as price_reasons, mp.mortgage as has_mortgage, mp.search_match as has_search,
           mi.signal_count as mi_signals, mi.last_signal_at as mi_last, mi.timeframe as mi_timeframe,
           (p_property_id = any (coalesce(mi.property_ids, '{}'::uuid[]))) as mi_listing
      from public.internal_lead_rows(v_me, p_property_id) r
      join public.intent_profiles ip on ip.id = r.intent_profile_id
      join public.users usr on usr.id = r.lead_user_id
      cross join lateral public.internal_lead_segment(r.intent_profile_id) seg
      cross join lateral public.lead_contact_prefs_of(r.lead_user_id) prefs
      cross join lateral public.internal_lead_member_price(v_me, p_property_id, r.lead_user_id) mp
      left join public.mortgage_buyer_intents mi on mi.user_id = r.lead_user_id and mi.status = 'ACTIVE'
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
        'segment', case when p.member_key in ('MORTGAGE', 'MORTGAGE_MATCH') then p.member_key else p.segment end,
        'origin', case when p.has_mortgage and p.has_search then 'MORTGAGE_AND_SEARCH' when p.has_mortgage then 'MORTGAGE' else 'SEARCH' end,
        'priceKey', p.member_key,
        'priceReasons', to_jsonb(p.price_reasons),
        'mortgage', case when p.has_mortgage then jsonb_build_object(
            'calculatorUse', case when p.mi_signals > 1 then 'REPEATED' else 'ONCE' end,
            'lastUseMonth', to_char(p.mi_last, 'YYYY-MM'),
            'thisListing', p.mi_listing,
            'timeframe', p.mi_timeframe) end,
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
           prefs.share_phone_on_unlock or coalesce(mi.share_phone, false) as share_phone_on_unlock,
           prefs.share_email_on_unlock or coalesce(mi.share_email, false) as share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.email is not null and position('@' in usr.email) > 1 as has_email,
           usr.nickname, usr.full_name, usr.preferred_language,
           mp.price_key as member_key, mp.reasons as price_reasons, mp.mortgage as has_mortgage, mp.search_match as has_search,
           mi.signal_count as mi_signals, mi.last_signal_at as mi_last, mi.timeframe as mi_timeframe,
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
        'segment', case when pg.price_key in ('MORTGAGE', 'MORTGAGE_MATCH') then pg.price_key else pg.segment end,
        'origin', case when pg.has_mortgage and pg.has_search then 'MORTGAGE_AND_SEARCH' when pg.has_mortgage then 'MORTGAGE' else 'SEARCH' end,
        'priceReasons', to_jsonb(pg.price_reasons),
        'mortgage', case when pg.has_mortgage then jsonb_build_object(
            'calculatorUse', case when pg.mi_signals > 1 then 'REPEATED' else 'ONCE' end,
            'lastUseMonth', to_char(pg.mi_last, 'YYYY-MM'),
            'thisListing', pg.mi_listing,
            'timeframe', pg.mi_timeframe) end,
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
 * 5 · admin: the funnel, from counts only
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.admin_mortgage_lead_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'savedScenarios', (select count(*) from public.mortgage_scenarios),
    'scenarioOwners', (select count(distinct user_id) from public.mortgage_scenarios),
    'consentedActive', (select count(*) from public.mortgage_buyer_intents where status = 'ACTIVE'),
    'inMatching', (select count(*) from public.mortgage_buyer_intents where status = 'ACTIVE' and intent_profile_id is not null),
    'withdrawn', (select count(*) from public.mortgage_buyer_intents where status = 'WITHDRAWN'),
    'matchedListings', (select count(*) from public.internal_match_candidates c
                          join public.mortgage_buyer_intents i on i.intent_profile_id = c.intent_profile_id and i.status = 'ACTIVE'),
    'uniqueUnlocks', (select count(*) from public.internal_lead_unlocks where segment in ('MORTGAGE', 'MORTGAGE_MATCH')),
    'unlocksWithSearch', (select count(*) from public.internal_lead_unlocks where segment = 'MORTGAGE_MATCH'),
    'unlockCredits', (select coalesce(sum(credits_charged), 0) from public.internal_lead_unlocks where segment in ('MORTGAGE', 'MORTGAGE_MATCH')),
    'price', public.mortgage_lead_price());
end $$;
revoke all on function public.admin_mortgage_lead_stats() from public, anon;
grant execute on function public.admin_mortgage_lead_stats() to authenticated;
