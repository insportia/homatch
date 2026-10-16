-- Admin Demand Intelligence: customers by demand, analytics, profile, export.
--
-- Every function is security definer, checks public.is_admin() first, and reads
-- only. Opening a customer profile and every export write an admin_audit_log row
-- (who, whom / which filters, how many rows). Nothing here is fabricated: counts
-- come from property_interest_events / customer_demand_interests (20261107093700),
-- campaign money from the wallet (usage_reservations) and cost_events /
-- discovery_runs, supply from properties and supply_observations. A figure that
-- cannot be computed is returned as null, never as 0.
--
-- Rollback: drop the admin_demand_* functions.

/* Interest rows matching the interest-level filters. */
create or replace function public.admin_demand_interest_match(i public.customer_demand_interests, f jsonb)
returns boolean language sql stable set search_path = public as $$
  select
        (coalesce(f->>'side', '') = '' or i.side = f->>'side')
    and (coalesce(f->>'basis', '') = '' or (public.demand_interest_strength(i)->>'basis') = f->>'basis')
    and (coalesce(f->>'city', '') = '' or i.city = public.interest_canonical_place(f->>'city'))
    and (coalesce(f->>'district', '') = '' or public.interest_canonical_place(f->>'district') = any (i.districts))
    and (coalesce(f->>'property_type', '') = '' or i.property_type = upper(f->>'property_type'))
    and (coalesce(f->>'budget_min', '') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(i.budget_max, i.budget_min) >= (f->>'budget_min')::numeric)
    and (coalesce(f->>'budget_max', '') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(i.budget_min, i.budget_max) <= (f->>'budget_max')::numeric)
    and (coalesce(f->>'rooms_min', '') !~ '^[0-9]{1,2}$' or coalesce(i.bedrooms_max, i.rooms_max, i.bedrooms_min, i.rooms_min) >= (f->>'rooms_min')::int)
    and (coalesce(f->>'rooms_max', '') !~ '^[0-9]{1,2}$' or coalesce(i.bedrooms_min, i.rooms_min, i.bedrooms_max, i.rooms_max) <= (f->>'rooms_max')::int)
    and (coalesce(f->>'area_min', '') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(i.area_max, i.area_min) >= (f->>'area_min')::numeric)
    and (coalesce(f->>'area_max', '') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(i.area_min, i.area_max) <= (f->>'area_max')::numeric)
    and (coalesce(f->>'active_days', '') !~ '^[0-9]{1,4}$' or i.last_seen_at >= now() - make_interval(days => (f->>'active_days')::int))
    and (coalesce(f->>'strength_min', '') !~ '^[0-9]{1,3}$' or (public.demand_interest_strength(i)->>'score')::numeric >= (f->>'strength_min')::numeric)
    and (coalesce(f->>'freshness', '') = '' or (public.demand_interest_strength(i)->>'freshness') = f->>'freshness')
$$;
revoke all on function public.admin_demand_interest_match(public.customer_demand_interests, jsonb) from public, anon, authenticated;

/* One row per customer: their matching interests rolled up. */
create or replace function public.admin_demand_rows(f jsonb)
returns table (
  user_id uuid, email text, full_name text, registered_at timestamptz, last_seen_at timestamptz,
  sides text[], cities text[], property_types text[], interests integer, top_strength numeric, events integer,
  searches integer, views integer, saves integer, contacts integer, viewings integer, paid_campaigns integer, listings integer,
  explicit_events integer, observed_events integer, budget_min numeric, budget_max numeric, top_interest jsonb)
language sql stable security definer set search_path = public as $$
  with m as (
    select i.*, (public.demand_interest_strength(i)->>'score')::numeric as score
      from public.customer_demand_interests i
     where public.admin_demand_interest_match(i, f)
  ), u as (
    select m.user_id,
           max(m.last_seen_at) last_seen_at,
           array_agg(distinct m.side) filter (where m.side is not null) sides,
           array_agg(distinct m.city) filter (where m.city is not null) cities,
           array_agg(distinct m.property_type) filter (where m.property_type is not null) property_types,
           count(*)::int interests, max(m.score) top_strength,
           sum(m.explicit_events + m.observed_events + m.inferred_events)::int events,
           sum(m.searches)::int searches, sum(m.views)::int views, sum(m.saves)::int saves, sum(m.contacts)::int contacts,
           sum(m.viewings)::int viewings, sum(m.paid_campaigns)::int paid_campaigns, sum(m.listings)::int listings,
           sum(m.explicit_events)::int explicit_events, sum(m.observed_events)::int observed_events,
           min(m.budget_min) budget_min, max(m.budget_max) budget_max,
           (array_agg(to_jsonb(m) - 'user_id' order by m.score desc, m.last_seen_at desc))[1] top_interest
      from m group by m.user_id
  )
  select u.user_id, us.email, us.full_name, us.created_at, u.last_seen_at, u.sides, u.cities, u.property_types, u.interests,
         u.top_strength, u.events, u.searches, u.views, u.saves, u.contacts, u.viewings, u.paid_campaigns, u.listings,
         u.explicit_events, u.observed_events, u.budget_min, u.budget_max, u.top_interest
    from u join public.users us on us.id = u.user_id
   where (coalesce(f->>'q', '') = '' or us.email ilike '%' || (f->>'q') || '%' or us.full_name ilike '%' || (f->>'q') || '%')
     and (coalesce(f->>'frequency_min', '') !~ '^[0-9]{1,5}$' or u.events >= (f->>'frequency_min')::int)
     and (coalesce(f->>'has_saved', '') <> 'true' or exists (select 1 from public.saved_property_listings s where s.user_id = u.user_id))
     and (coalesce(f->>'has_contacts', '') <> 'true' or u.contacts + u.viewings > 0)
     and (coalesce(f->>'has_paid', '') <> 'true' or u.paid_campaigns > 0
          or exists (select 1 from public.find_buyers_campaigns c where c.user_id = u.user_id))
$$;
revoke all on function public.admin_demand_rows(jsonb) from public, anon, authenticated;

create or replace function public.admin_demand_customers(p_filters jsonb default '{}'::jsonb, p_sort text default 'last_seen_desc',
  p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_rows jsonb; f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select count(*) into v_total from public.admin_demand_rows(f);
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
    select * from public.admin_demand_rows(f)
     order by
       case when p_sort = 'strength_desc' then top_strength end desc nulls last,
       case when p_sort = 'events_desc' then events end desc nulls last,
       case when p_sort = 'budget_desc' then budget_max end desc nulls last,
       case when p_sort = 'budget_asc' then budget_min end asc nulls last,
       case when p_sort = 'registered_desc' then registered_at end desc nulls last,
       case when p_sort = 'last_seen_asc' then last_seen_at end asc nulls last,
       last_seen_at desc nulls last, user_id
     limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0))) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
revoke all on function public.admin_demand_customers(jsonb, text, integer, integer) from public, anon;
grant execute on function public.admin_demand_customers(jsonb, text, integer, integer) to authenticated;

/* Authorized export: admin only, audited with the filters and the row count. Paged (max 1000 per call). */
create or replace function public.admin_demand_export(p_filters jsonb default '{}'::jsonb, p_limit integer default 1000, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_count int; v_me uuid := public.current_homatch_user_id(); f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) - 'top_interest'), '[]'::jsonb), count(*) into v_rows, v_count from (
    select * from public.admin_demand_rows(f) order by last_seen_at desc nulls last, user_id
     limit greatest(1, least(coalesce(p_limit, 1000), 1000)) offset greatest(0, coalesce(p_offset, 0))) r;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (v_me, null, 'DEMAND_INTELLIGENCE_EXPORT', 'demand_intelligence', null,
          jsonb_build_object('filters', f, 'offset', p_offset, 'rows', v_count));
  return jsonb_build_object('rows', v_rows, 'count', v_count);
end $$;
revoke all on function public.admin_demand_export(jsonb, integer, integer) from public, anon;
grant execute on function public.admin_demand_export(jsonb, integer, integer) to authenticated;

/* The customer profile. Opening it is audited. */
create or replace function public.admin_demand_customer_profile(p_user_id uuid, p_event_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (v_me, p_user_id, 'DEMAND_PROFILE_VIEWED', 'user', p_user_id::text, '{}'::jsonb);
  select jsonb_build_object(
    'identity', (select jsonb_build_object('id', u.id, 'email', u.email, 'fullName', u.full_name, 'phone', u.phone,
                   'language', u.preferred_language, 'registeredAt', u.created_at, 'suspendedAt', u.suspended_at)
                   from public.users u where u.id = p_user_id),
    'lastActivityAt', (select max(occurred_at) from public.property_interest_events where user_id = p_user_id),
    'interests', coalesce((select jsonb_agg(to_jsonb(i) - 'user_id' || jsonb_build_object('strength', public.demand_interest_strength(i))
                   order by i.last_seen_at desc) from public.customer_demand_interests i where i.user_id = p_user_id), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(to_jsonb(e) - 'user_id' - 'dedupe_key' order by e.occurred_at desc) from (
                   select * from public.property_interest_events where user_id = p_user_id
                    order by occurred_at desc limit greatest(1, least(coalesce(p_event_limit, 200), 1000))) e), '[]'::jsonb),
    'eventsTotal', (select count(*) from public.property_interest_events where user_id = p_user_id),
    'saved', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.saved_at desc) from public.saved_property_listings s where s.user_id = p_user_id), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('propertyId', c.property_id, 'at', c.created_at, 'kind', c.relationship_kind) order by c.created_at desc)
                   from public.contact_disclosures c where c.viewer_user_id = p_user_id), '[]'::jsonb),
    'freeSearches', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'at', s.created_at,
                   'properties', s.properties_count, 'strong', s.strong_matches, 'city', s.request->>'city',
                   'transaction', s.request->>'transactionType', 'propertyType', s.request->>'propertyType') order by s.created_at desc)
                   from (select * from public.discovery_marketplace_searches where user_id = p_user_id order by created_at desc limit 100) s), '[]'::jsonb),
    'paidDiscovery', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'at', r.created_at,
                   'credits', r.credits_charged, 'providerCostUsd', r.provider_cost_usd, 'results', r.results_found) order by r.created_at desc)
                   from public.discovery_runs r where r.user_id = p_user_id), '[]'::jsonb),
    'findBuyersCampaigns', coalesce((select jsonb_agg(jsonb_build_object('jobId', c.matching_job_id, 'propertyId', c.property_id,
                   'at', c.created_at, 'credits', c.credits_committed, 'providerBudgetUsd', c.provider_budget_micros / 1e6,
                   'policy', c.pricing_policy, 'finalizedAt', c.finalized_at) order by c.created_at desc)
                   from public.find_buyers_campaigns c where c.user_id = p_user_id), '[]'::jsonb),
    'credits', (select jsonb_build_object('balance', ca.balance, 'reserved', ca.reserved) from public.credit_accounts ca where ca.user_id = p_user_id),
    'matches', jsonb_build_object(
      'asSeeker', (select count(*) from public.supply_matches m where m.demand_user_id = p_user_id and m.compatibility = 'COMPATIBLE'),
      'asOwner', (select count(*) from public.supply_matches m where m.supply_user_id = p_user_id and m.compatibility = 'COMPATIBLE')),
    'listings', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'homatchId', p.homatch_id, 'title', p.title,
                   'transaction', p.transaction_type, 'type', p.property_type, 'status', p.matching_status) order by p.created_at desc)
                   from public.properties p where p.user_id = p_user_id and not p.is_deleted), '[]'::jsonb),
    'observedTracking', coalesce((select observed_tracking from public.interest_tracking_preferences where user_id = p_user_id), true)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_demand_customer_profile(uuid, integer) from public, anon;
grant execute on function public.admin_demand_customer_profile(uuid, integer) to authenticated;

/*
 * Analytics. Window p_days (default 90). Money:
 *   Find Buyers campaigns: charged = the wallet's settled credits of the
 *   campaign's reservation (matching_jobs.billing_grant.reservationId), provider
 *   spend = cost_events booked for the property during the job (the same read
 *   settlement uses). Find Property paid runs: discovery_runs.credits_charged and
 *   provider_cost_usd. HOMATCH profit = charged − provider spend, only where both
 *   are known; campaigns still running are counted apart.
 */
create or replace function public.admin_demand_analytics(p_days integer default 90, p_city text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 90), 730));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));
  v_city text := nullif(public.interest_canonical_place(p_city), '');
  v_rate numeric := public.billing_setting_num('credits_per_usd', 10);
  v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with act as (
    select i.* from public.customer_demand_interests i
     where i.last_seen_at >= v_since and (v_city is null or i.city = v_city)
  ), camp as (
    /* Money per campaign. Charged = settled credits of the original reservation plus
       every settled budget extension. Provider spend = cost_events booked for the
       matching job of the campaign; a run whose cost was never priced (UNPRICED) makes
       the spend of the campaign UNKNOWN (null), never zero dollars. */
    select c.matching_job_id, c.pricing_policy, c.finalized_at, c.provider_budget_micros, c.credits_per_usd,
           (select r.settled_credits from public.usage_reservations r where r.id::text = j.billing_grant->>'reservationId')
             + coalesce((select sum(e.settled_credits) from public.find_buyers_budget_extensions e
                          where e.matching_job_id = c.matching_job_id and e.status = 'SETTLED'), 0) settled_credits,
           case when exists (select 1 from public.cost_events ce where ce.job_id = c.matching_job_id and ce.pricing_state = 'UNPRICED') then null
                else (select coalesce(sum(ce.cost_usd), 0) from public.cost_events ce where ce.job_id = c.matching_job_id) end spend_usd
      from public.find_buyers_campaigns c left join public.matching_jobs j on j.id = c.matching_job_id
     where c.created_at >= v_since
  )
  select jsonb_build_object(
    'windowDays', v_days, 'city', v_city,
    'people', jsonb_build_object(
      'buyers',   (select count(distinct user_id) from act where side = 'BUY'),
      'tenants',  (select count(distinct user_id) from act where side = 'RENT'),
      'sellers',  (select count(distinct user_id) from act where side = 'SELL'),
      'landlords',(select count(distinct user_id) from act where side = 'LET'),
      'explicit', (select count(distinct user_id) from act where explicit_events > 0),
      'observedOnly', (select count(distinct a.user_id) from act a where not exists (select 1 from act b where b.user_id = a.user_id and b.explicit_events > 0))),
    'byDistrict', coalesce((select jsonb_agg(jsonb_build_object('label', d, 'value', n) order by n desc) from (
        select d, count(distinct user_id) n from act, unnest(districts) d where side in ('BUY', 'RENT') group by d order by n desc limit 25) x), '[]'::jsonb),
    'byCity', coalesce((select jsonb_agg(jsonb_build_object('label', city, 'value', n) order by n desc) from (
        select city, count(distinct user_id) n from act where city is not null and side in ('BUY', 'RENT') group by city order by n desc limit 25) x), '[]'::jsonb),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('label', property_type, 'value', n) order by n desc) from (
        select property_type, count(distinct user_id) n from act where property_type is not null and side in ('BUY', 'RENT') group by property_type order by n desc) x), '[]'::jsonb),
    'byBudget', coalesce((select jsonb_agg(jsonb_build_object('label', budget_band, 'value', n) order by budget_band) from (
        select budget_band, count(distinct user_id) n from act where side in ('BUY', 'RENT') group by budget_band) x), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('week', w, 'buy', b, 'rent', r, 'sell', s, 'let', l) order by w) from (
        select date_trunc('week', e.occurred_at)::date w,
               count(*) filter (where e.side = 'BUY') b, count(*) filter (where e.side = 'RENT') r,
               count(*) filter (where e.side = 'SELL') s, count(*) filter (where e.side = 'LET') l
          from public.property_interest_events e
         where e.occurred_at >= v_since and (v_city is null or public.interest_canonical_place(e.city) = v_city)
         group by 1) x), '[]'::jsonb),
    'demandVsSupply', coalesce((select jsonb_agg(jsonb_build_object('label', k, 'demand', dem, 'nativeSupply', nat, 'portalSupply', por) order by dem desc) from (
        select k, sum(dem) dem, sum(nat) nat, sum(por) por from (
          select coalesce(d, city) k, count(distinct user_id) dem, 0 nat, 0 por
            from act left join lateral unnest(case when v_city is null then array[null::text] else districts end) d on true
           where side in ('BUY', 'RENT') group by 1
          union all
          select coalesce(case when v_city is null then public.interest_canonical_place(f.city) else public.interest_canonical_place(f.district) end, 'unknown'), 0, count(*), 0
            from public.properties p join public.property_facts f on f.property_id = p.id
           where not p.is_deleted and p.archived_at is null and p.matching_status = 'ACTIVE'
             and (v_city is null or public.interest_canonical_place(f.city) = v_city) group by 1
          union all
          select coalesce(case when v_city is null then public.interest_canonical_place(o.city) else public.interest_canonical_place(o.district) end, 'unknown'), 0, 0, count(*)
            from public.supply_observations o
           where o.last_seen_at >= now() - interval '30 days' and (v_city is null or public.interest_canonical_place(o.city) = v_city) group by 1
        ) z where k is not null group by k order by sum(dem) desc, sum(nat + por) desc limit 25) y), '[]'::jsonb),
    'searches', jsonb_build_object(
      'free', (select count(*) from public.discovery_marketplace_searches s where s.created_at >= v_since
                 and (v_city is null or public.interest_canonical_place(s.request->>'city') = v_city)),
      /* Free search has no reservation path at all (marketplace-search never calls the wallet). */
      'freeCreditsCharged', 0,
      'paidFindProperty', (select count(*) from public.discovery_runs r where r.created_at >= v_since),
      'findBuyersCampaigns', (select count(*) from camp)),
    'campaignEconomics', jsonb_build_object(
      'policy', jsonb_build_object('id', 'paid_discovery_37_63_v1', 'providerShareBps', public.paid_discovery_provider_share_bps(),
                                   'homatchShareBps', 10000 - public.paid_discovery_provider_share_bps()),
      'findBuyers', (select jsonb_agg(jsonb_build_object(
          'policy', coalesce(pricing_policy, 'legacy'), 'campaigns', n, 'running', running,
          'chargedUsd', charged_usd, 'providerSpendUsd', spend_usd, 'providerBudgetUsd', budget_usd,
          'unknownCostCampaigns', unknown_cost,
          'homatchProfitUsd', case when charged_usd is not null and spend_usd is not null then round(charged_usd - spend_usd, 2) end))
        from (select pricing_policy, count(*) n, count(*) filter (where finalized_at is null) running,
                     count(*) filter (where finalized_at is not null and spend_usd is null) unknown_cost,
                     /* A group with any unknown cost or unsettled charge has no honest total. */
                     case when bool_and(settled_credits is not null) filter (where finalized_at is not null) is false then null
                          else round(sum(settled_credits / nullif(credits_per_usd, 0)) filter (where finalized_at is not null), 2) end charged_usd,
                     case when bool_or(spend_usd is null) filter (where finalized_at is not null) then null
                          else round(sum(spend_usd) filter (where finalized_at is not null), 2) end spend_usd,
                     round(sum(provider_budget_micros) / 1e6, 2) budget_usd
                from camp group by pricing_policy) g),
      'findProperty', (select jsonb_build_object('runs', count(*),
          'unknownCostRuns', count(*) filter (where provider_cost_usd is null),
          'chargedUsd', round(sum(credits_charged / nullif(coalesce(credits_per_usd, v_rate), 0)), 2),
          'providerSpendUsd', case when bool_or(provider_cost_usd is null) then null else round(sum(provider_cost_usd), 2) end,
          'homatchProfitUsd', case when bool_or(provider_cost_usd is null) or bool_or(credits_charged is null) then null
                                   else round(sum(credits_charged / nullif(coalesce(credits_per_usd, v_rate), 0)) - sum(provider_cost_usd), 2) end)
        from public.discovery_runs where created_at >= v_since and status in ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'BUDGET_REACHED'))))
  into v;
  return v;
end $$;
revoke all on function public.admin_demand_analytics(integer, text) from public, anon;
grant execute on function public.admin_demand_analytics(integer, text) to authenticated;
