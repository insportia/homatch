-- ============================================================================
-- HOMATCH UNIFIED BUYER INTELLIGENCE — one derived, permission-appropriate
-- summary per HOMATCH account of what that person has EXPLICITLY said they
-- are looking for, for the Admin only.
--
-- Built from existing authorised sources and nothing else. No new collection.
--
--   source                     where                                   level
--   FIND_PROPERTY_PLAN         active_search_subscriptions (side       ACTIVE_SEARCH (active)
--                              SUPPLY = watching for listings) →       SAVED_REQUIREMENTS (inactive)
--                              intent_profiles 'search-plan-1.0.0'
--   STATED_IN_CONVERSATION     same join, intent_profiles projected    EXPLICIT_INTENT (active)
--                              by _shared/nativeDemand.ts from the     SAVED_REQUIREMENTS (inactive)
--                              person's OWN words (attribution SELF)
--   SAVED_SEARCH               same join, any other projection         SAVED_REQUIREMENTS
--   BROKER_CLIENT_SEARCH       same join, on_behalf = true (a broker   SAVED_REQUIREMENTS
--                              searching for a client — flagged)
--   FIND_PROPERTY_MARKETPLACE  discovery_marketplace_searches.request  ACTIVE_SEARCH (≤14 days)
--                              (the confirmed structured brief)        EXPLICIT_INTENT (older)
--   VIEWING_REQUEST            intent_signals PROPERTY_INTEREST /      EXPLICIT_INTENT
--                              TRANSACTION_INTENT (a viewing asked for)
--   PROPERTY_ENQUIRY           intent_signals PROPERTY_INTEREST,       REPEATED_INTEREST (≥2 properties)
--                              other positive self-attributed acts     EXPLORATORY (one)
--   (CASUAL_BROWSING is a level no source feeds: telemetry is not intent.)
--
-- NEVER READ: mortgage_scenarios / mortgage inputs, chat or AI TALK text,
-- brief.originalText, intent_profiles.original_text / translated_text,
-- raw_signals, external intent_profiles (no subscription = not a HOMATCH
-- user), find_buyers_leads people. A budget appears ONLY where the person
-- typed it as a requirement; a viewed property's price is never read as
-- anybody's budget. Nothing here infers wealth.
--
-- Freshness mirrors src/research-core/match/demand-freshness.ts:
--   FRESH ≤14d · AGING ≤60d · OLD ≤180d · STALE >180d · ANCIENT > ceiling
--   (ceiling RENT 180d, SALE 365d). Stale = STALE/ANCIENT or nothing active.
--
-- Objects
--   type       buyer_intelligence_source_t, buyer_intelligence_summary_t
--   helpers    buyer_intelligence_level_rank, buyer_intelligence_freshness,
--              buyer_intelligence_sources, buyer_intelligence_summaries,
--              buyer_intelligence_filtered
--   admin RPC  admin_buyer_intelligence_list, admin_buyer_intelligence_stats,
--              admin_buyer_intelligence_detail
--   indexes    discovery_marketplace_searches (user_id, created_at desc),
--              intent_signals (actor_user_id) partial, supply_matches
--              (demand_user_id) partial
--
-- Requires 20261024100000_market_segmentation.sql (place keys, comparables).
-- Additive only. The runner owns the transaction.
-- ============================================================================

do $$ begin
  create type public.buyer_intelligence_source_t as (
    user_id uuid, source text, source_id uuid, intent_level text, role text, is_active boolean,
    on_behalf boolean, confidence numeric, observed_at timestamptz, transaction text,
    property_types text[], country text, city text, districts text[], neighborhoods text[],
    budget_min numeric, budget_max numeric, currency text, budget_min_usd numeric, budget_max_usd numeric,
    budget_confirmed boolean, bedrooms_min int, bedrooms_max int, rooms_min int, rooms_max int,
    area_min numeric, area_max numeric, property_id uuid);
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.buyer_intelligence_summary_t as (
    user_id uuid, email text, full_name text, role text, intent_level text, level_rank int,
    sources text[], source_count int, latest_at timestamptz, age_days int, freshness text, stale boolean,
    is_active boolean, confidence numeric, transactions text[], property_types text[], countries text[],
    cities text[], city_keys text[], districts text[], district_keys text[], neighborhood_keys text[],
    budget_min_usd numeric, budget_max_usd numeric, budget_confirmed boolean,
    bedrooms_min int, bedrooms_max int, area_min numeric, area_max numeric,
    internal_matches int, compatible_matches int, best_match_score numeric, segments text[]);
exception when duplicate_object then null; end $$;

create index if not exists discovery_marketplace_searches_user_created_idx
  on public.discovery_marketplace_searches (user_id, created_at desc);
create index if not exists intent_signals_property_interest_actor_idx
  on public.intent_signals (actor_user_id) where side = 'PROPERTY_INTEREST';
create index if not exists supply_matches_demand_user_internal_idx
  on public.supply_matches (demand_user_id) where source_kind = 'INTERNAL_HOMATCH';

create or replace function public.buyer_intelligence_level_rank(p text)
returns int language sql immutable set search_path = pg_catalog as $$
  select case p when 'CASUAL_BROWSING' then 1 when 'EXPLORATORY' then 2 when 'REPEATED_INTEREST' then 3
                when 'SAVED_REQUIREMENTS' then 4 when 'EXPLICIT_INTENT' then 5 when 'ACTIVE_SEARCH' then 6 else 0 end
$$;

/* Mirror of judgeDemandFreshness(): the reason only. */
create or replace function public.buyer_intelligence_freshness(p_at timestamptz, p_transactions text[])
returns text language sql stable set search_path = pg_catalog as $$
  select case
    when p_at is null or p_at > now() then 'UNDATED'
    when floor(extract(epoch from now() - p_at) / 86400) >
         (case when p_transactions is not null and 'SALE' = any (p_transactions) then 365
               when p_transactions is not null and 'RENT' = any (p_transactions) then 180 else 365 end) then 'ANCIENT'
    when floor(extract(epoch from now() - p_at) / 86400) <= 14 then 'FRESH'
    when floor(extract(epoch from now() - p_at) / 86400) <= 60 then 'AGING'
    when floor(extract(epoch from now() - p_at) / 86400) <= 180 then 'OLD'
    else 'STALE' end
$$;

/* Every authorised source row. Internal; never granted. */
create or replace function public.buyer_intelligence_sources()
returns setof public.buyer_intelligence_source_t
language sql stable security definer set search_path = public, pg_temp as $$
  /* 1. Saved requirements: a subscription watching for listings, and its intent. */
  select s.user_id,
         case when s.on_behalf then 'BROKER_CLIENT_SEARCH'
              when ip.classifier_version = 'search-plan-1.0.0' then 'FIND_PROPERTY_PLAN'
              when ip.classifier_version in ('native-intent-1.0.0', 'live-chat-1.0.0') then 'STATED_IN_CONVERSATION'
              else 'SAVED_SEARCH' end,
         s.id,
         case when not s.is_active or s.on_behalf then 'SAVED_REQUIREMENTS'
              when ip.classifier_version = 'search-plan-1.0.0' then 'ACTIVE_SEARCH'
              when ip.classifier_version in ('native-intent-1.0.0', 'live-chat-1.0.0') then 'EXPLICIT_INTENT'
              else 'SAVED_REQUIREMENTS' end,
         case when public.market_transaction_key(coalesce(ip.transaction_type, ip.intent_type::text)) = 'RENT'
                or ip.intent_type::text in ('RENT', 'RELOCATE_RENT') then 'TENANT' else 'BUYER' end,
         s.is_active, coalesce(s.on_behalf, false),
         coalesce(ip.intent_confidence, 0), greatest(s.created_at, ip.created_at),
         coalesce(public.market_transaction_key(ip.transaction_type),
                  case when ip.intent_type::text in ('RENT', 'RELOCATE_RENT') then 'RENT' else 'SALE' end),
         ip.property_types, ip.country, ip.city,
         case when ip.district is null then null else array[ip.district] end, ip.neighborhoods,
         ip.budget_min, ip.budget_max, ip.currency,
         public.fx_to_usd(ip.budget_min, ip.currency), public.fx_to_usd(ip.budget_max, ip.currency),
         (ip.budget_min is not null or ip.budget_max is not null),
         ip.bedrooms_min, ip.bedrooms_max, ip.rooms_min, ip.rooms_max, ip.area_min, ip.area_max, null::uuid
    from public.active_search_subscriptions s
    join public.intent_profiles ip on ip.id = s.intent_id
   where s.side = 'SUPPLY'
  union all
  /* 2. Find Property marketplace searches: the confirmed structured request only. */
  select m.user_id, 'FIND_PROPERTY_MARKETPLACE', m.id,
         case when m.created_at >= now() - interval '14 days' and m.status <> 'FAILED' then 'ACTIVE_SEARCH'
              else 'EXPLICIT_INTENT' end,
         case when public.market_transaction_key(m.request->>'transactionType') = 'RENT' then 'TENANT' else 'BUYER' end,
         m.created_at >= now() - interval '14 days' and m.status <> 'FAILED', false,
         case when m.brief->'readiness'->>'state' = 'READY' then 1.0 else 0.7 end,
         m.created_at,
         public.market_transaction_key(m.request->>'transactionType'),
         case when m.request->>'propertyType' is null then null else array[m.request->>'propertyType'] end,
         coalesce(m.request->>'country', m.request->>'market'), m.request->>'city',
         case when jsonb_typeof(m.request->'districts') = 'array'
              then array(select jsonb_array_elements_text(m.request->'districts')) end,
         null::text[],
         public.market_num(m.request->>'priceMinUsd'), public.market_num(m.request->>'priceMaxUsd'), 'USD',
         public.market_num(m.request->>'priceMinUsd'), public.market_num(m.request->>'priceMaxUsd'),
         coalesce(m.brief->'price'->>'status', '') = 'STATED'
           and (m.request->>'priceMinUsd' is not null or m.request->>'priceMaxUsd' is not null),
         public.market_num(m.request->'bedrooms'->>'min')::int, public.market_num(m.request->'bedrooms'->>'max')::int,
         public.market_num(m.request->'rooms'->>'min')::int, public.market_num(m.request->'rooms'->>'max')::int,
         public.market_num(m.request->>'areaMinSqm'), public.market_num(m.request->>'areaMaxSqm'), null::uuid
    from public.discovery_marketplace_searches m
   where m.user_id is not null and m.status <> 'CANCELLED' and m.request is not null
  union all
  /* 3. Interest in a specific HOMATCH property, as structured acts only. The
        property's place and type describe the interest; its price is never
        anybody's budget. */
  select g.actor_user_id,
         case when g.source_surface = 'VIEWING_REQUEST' then 'VIEWING_REQUEST' else 'PROPERTY_ENQUIRY' end,
         g.id,
         case when g.act = 'TRANSACTION_INTENT' then 'EXPLICIT_INTENT'
              when (select count(distinct g2.property_id) from public.intent_signals g2
                     where g2.actor_user_id = g.actor_user_id and g2.side = 'PROPERTY_INTEREST'
                       and g2.polarity = 'POSITIVE' and g2.explicit and g2.superseded_by is null and g2.withdrawn_at is null) >= 2
                then 'REPEATED_INTEREST'
              else 'EXPLORATORY' end,
         case when public.market_transaction_key(p.transaction_type::text) = 'RENT' then 'TENANT' else 'BUYER' end,
         true, false, coalesce(g.confidence, 0), g.source_at,
         public.market_transaction_key(p.transaction_type::text),
         array[p.property_type::text], fx.country_code, fx.city,
         case when fx.district is null then null else array[fx.district] end,
         case when fx.neighborhood is null then null else array[fx.neighborhood] end,
         null::numeric, null::numeric, null::text, null::numeric, null::numeric, false,
         null::int, null::int, null::int, null::int, null::numeric, null::numeric, g.property_id
    from public.intent_signals g
    join public.properties p on p.id = g.property_id
    left join lateral (select pf.country_code, pf.city, pf.district, pf.neighborhood from public.property_facts pf
                        where pf.property_id = p.id order by pf.updated_at desc nulls last limit 1) fx on true
   where g.side = 'PROPERTY_INTEREST' and g.polarity = 'POSITIVE' and g.attribution = 'SELF'
     and g.explicit /* what the person did/said, never an inference (telemetry ≠ intent) */
     and g.superseded_by is null and g.withdrawn_at is null and g.actor_user_id is not null
$$;
revoke all on function public.buyer_intelligence_sources() from public, anon, authenticated;

/*
 * One row per person. Segments are the market segments their STATED budget
 * and area can reach in their stated place (district band if it has enough
 * comparables, else city), under the active segmentation rule — mirror of
 * buyerSegmentCompatibility().
 */
create or replace function public.buyer_intelligence_summaries()
returns setof public.buyer_intelligence_summary_t
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rules jsonb := public.market_segment_rules_normalise(coalesce((public.market_segment_active_rule()).params, '{}'::jsonb));
  v_min int := (v_rules->>'minComparables')::int;
  v_econ float8 := (v_rules->>'economyPercentile')::float8;
  v_prem float8 := (v_rules->>'premiumPercentile')::float8;
begin
  return query
  with src as (select * from public.buyer_intelligence_sources()),
  bands as materialized (
    select c.transaction, c.type_family, c.city_key, c.district_key, count(*) as n,
           round((percentile_cont(v_econ) within group (order by c.ppsqm_usd::float8))::numeric, 2) as econ_max,
           round((percentile_cont(v_prem) within group (order by c.ppsqm_usd::float8))::numeric, 2) as prem_min
      from public.market_comparables((v_rules->>'minAreaSqm')::numeric) c
     where c.ppsqm_usd is not null and c.transaction is not null and c.type_family is not null and c.city_key is not null
     group by grouping sets ((c.transaction, c.type_family, c.city_key),
                             (c.transaction, c.type_family, c.city_key, c.district_key))
    having count(*) >= v_min and not (grouping(c.district_key) = 0 and c.district_key is null)
  ),
  per_user as (
    select s.user_id,
           case when bool_or(s.role = 'BUYER') and bool_or(s.role = 'TENANT') then 'BOTH'
                when bool_or(s.role = 'TENANT') then 'TENANT' else 'BUYER' end as role,
           max(public.buyer_intelligence_level_rank(s.intent_level)) as level_rank,
           array_agg(distinct s.source) as sources,
           count(distinct s.source_id)::int as source_count,
           max(s.observed_at) as latest_at,
           bool_or(s.is_active) as is_active,
           max(s.confidence) as confidence,
           array_remove(array_agg(distinct s.transaction), null) as transactions,
           array_remove(array_agg(distinct upper(t.pt)), null) as property_types,
           array_remove(array_agg(distinct upper(s.country)), null) as countries,
           array_remove(array_agg(distinct s.city), null) as cities,
           array_remove(array_agg(distinct public.market_place_key(s.city)), null) as city_keys,
           array_remove(array_agg(distinct d.dist), null) as districts,
           array_remove(array_agg(distinct public.market_place_key(d.dist)), null) as district_keys,
           array_remove(array_agg(distinct public.market_place_key(nb.nb)), null) as neighborhood_keys,
           min(s.budget_min_usd) filter (where s.budget_confirmed) as budget_min_usd,
           max(s.budget_max_usd) filter (where s.budget_confirmed) as budget_max_usd,
           bool_or(s.budget_confirmed) as budget_confirmed,
           min(s.bedrooms_min) as bedrooms_min, max(s.bedrooms_max) as bedrooms_max,
           min(s.area_min) as area_min, max(s.area_max) as area_max
      from src s
      left join lateral unnest(coalesce(s.property_types, array[null::text])) as t(pt) on true
      left join lateral unnest(coalesce(s.districts, array[null::text])) as d(dist) on true
      left join lateral unnest(coalesce(s.neighborhoods, array[null::text])) as nb(nb) on true
     group by s.user_id
  ),
  matches as (
    select m.demand_user_id as user_id, count(*)::int as n,
           count(*) filter (where m.compatibility = 'COMPATIBLE')::int as compatible,
           max(m.match_score) as best
      from public.supply_matches m
     where m.source_kind = 'INTERNAL_HOMATCH' and m.demand_user_id is not null
     group by m.demand_user_id
  ),
  segs as (
    select pu.user_id,
           (select coalesce(b_d.econ_max, b_c.econ_max) from (select 1) x
              left join bands b_d on b_d.transaction = pu.transactions[1]
                                 and b_d.type_family = public.market_type_family(pu.property_types[1])
                                 and b_d.city_key = pu.city_keys[1] and b_d.district_key = pu.district_keys[1]
              left join bands b_c on b_c.transaction = pu.transactions[1]
                                 and b_c.type_family = public.market_type_family(pu.property_types[1])
                                 and b_c.city_key = pu.city_keys[1] and b_c.district_key is null) as econ_max,
           (select coalesce(b_d.prem_min, b_c.prem_min) from (select 1) x
              left join bands b_d on b_d.transaction = pu.transactions[1]
                                 and b_d.type_family = public.market_type_family(pu.property_types[1])
                                 and b_d.city_key = pu.city_keys[1] and b_d.district_key = pu.district_keys[1]
              left join bands b_c on b_c.transaction = pu.transactions[1]
                                 and b_c.type_family = public.market_type_family(pu.property_types[1])
                                 and b_c.city_key = pu.city_keys[1] and b_c.district_key is null) as prem_min,
           case when pu.budget_min_usd > 0 then pu.budget_min_usd / coalesce(pu.area_max, pu.area_min) else 0 end as lo,
           case when pu.budget_max_usd > 0 then pu.budget_max_usd / coalesce(pu.area_min, pu.area_max) end as hi,
           coalesce(pu.budget_confirmed, false)
             and coalesce(pu.budget_min_usd, pu.budget_max_usd) is not null
             and coalesce(pu.area_min, pu.area_max) is not null as has_basis
      from per_user pu
  )
  select pu.user_id, u.email, u.full_name, pu.role,
         case pu.level_rank when 1 then 'CASUAL_BROWSING' when 2 then 'EXPLORATORY' when 3 then 'REPEATED_INTEREST'
                            when 4 then 'SAVED_REQUIREMENTS' when 5 then 'EXPLICIT_INTENT' when 6 then 'ACTIVE_SEARCH' end,
         pu.level_rank, pu.sources, pu.source_count, pu.latest_at,
         floor(extract(epoch from now() - pu.latest_at) / 86400)::int,
         public.buyer_intelligence_freshness(pu.latest_at, pu.transactions),
         (not pu.is_active) or public.buyer_intelligence_freshness(pu.latest_at, pu.transactions) in ('STALE', 'ANCIENT'),
         pu.is_active, pu.confidence, pu.transactions, pu.property_types, pu.countries, pu.cities, pu.city_keys,
         pu.districts, pu.district_keys, pu.neighborhood_keys,
         pu.budget_min_usd, pu.budget_max_usd, coalesce(pu.budget_confirmed, false),
         pu.bedrooms_min, pu.bedrooms_max, pu.area_min, pu.area_max,
         coalesce(mt.n, 0), coalesce(mt.compatible, 0), mt.best,
         case when not coalesce(sg.has_basis, false) or sg.econ_max is null then '{}'::text[]
              else array_remove(array[
                case when sg.lo <= sg.econ_max then 'ECONOMY' end,
                case when (sg.hi is null or sg.hi > sg.econ_max) and sg.lo < sg.prem_min then 'MIDDLE' end,
                case when sg.hi is null or sg.hi >= sg.prem_min then 'PREMIUM' end], null) end
    from per_user pu
    join public.users u on u.id = pu.user_id
    left join matches mt on mt.user_id = pu.user_id
    left join segs sg on sg.user_id = pu.user_id;
end $$;
revoke all on function public.buyer_intelligence_summaries() from public, anon, authenticated;

/*
 * The shared filter. p_filters keys (all optional, combinable):
 *   segments[] (PREMIUM/MIDDLE/ECONOMY — budget-compatible segments),
 *   country, city, district, neighborhood (any script; canonical place keys),
 *   property_types[], transaction (SALE/RENT), role (BUYER/TENANT),
 *   min_price / max_price (USD; overlaps the stated budget), currency
 *   (USD only — budgets are normalised), min_bedrooms / max_bedrooms,
 *   min_area / max_area (overlap), confidence (HIGH ≥0.8 / MEDIUM ≥0.5 / LOW),
 *   sources[], levels[], match_strength (STRONG / ANY / NONE),
 *   recency_days, origin (INTERNAL / EXTERNAL — every row here is INTERNAL),
 *   status (ACTIVE / INACTIVE / STALE), budget (CONFIRMED / UNKNOWN),
 *   strength (STRONG / EXPLORATORY), q (email or name).
 *   street and price/sqm do not apply to a person's requirement and are ignored.
 */
create or replace function public.buyer_intelligence_filtered(p_filters jsonb)
returns setof public.buyer_intelligence_summary_t
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_segments text[]; v_types text[]; v_sources text[]; v_levels text[];
  v_q text := nullif(btrim(coalesce(f->>'q', '')), '');
begin
  v_segments := case when jsonb_typeof(f->'segments') = 'array' then array(select upper(jsonb_array_elements_text(f->'segments'))) end;
  v_types := case when jsonb_typeof(f->'property_types') = 'array' then array(select upper(jsonb_array_elements_text(f->'property_types'))) end;
  v_sources := case when jsonb_typeof(f->'sources') = 'array' then array(select upper(jsonb_array_elements_text(f->'sources'))) end;
  v_levels := case when jsonb_typeof(f->'levels') = 'array' then array(select upper(jsonb_array_elements_text(f->'levels'))) end;
  if cardinality(v_segments) = 0 then v_segments := null; end if;
  if cardinality(v_types) = 0 then v_types := null; end if;
  if cardinality(v_sources) = 0 then v_sources := null; end if;
  if cardinality(v_levels) = 0 then v_levels := null; end if;
  if upper(coalesce(f->>'origin', '')) = 'EXTERNAL' then return; end if;

  return query
  select s.* from public.buyer_intelligence_summaries() s
   where (v_segments is null or s.segments && v_segments)
     and (v_types is null or s.property_types && v_types
          or exists (select 1 from unnest(s.property_types) t where public.market_type_family(t) = any (v_types)))
     and (v_sources is null or s.sources && v_sources)
     and (v_levels is null or s.intent_level = any (v_levels))
     and (nullif(f->>'country', '') is null or upper(f->>'country') = any (s.countries))
     and (nullif(f->>'city', '') is null or public.market_place_key(f->>'city') = any (s.city_keys))
     and (nullif(f->>'district', '') is null or public.market_place_key(f->>'district') = any (s.district_keys))
     and (nullif(f->>'neighborhood', '') is null or public.market_place_key(f->>'neighborhood') = any (s.neighborhood_keys))
     and (nullif(f->>'transaction', '') is null or public.market_transaction_key(f->>'transaction') = any (s.transactions))
     and (nullif(f->>'role', '') is null or s.role = upper(f->>'role') or s.role = 'BOTH')
     and (nullif(f->>'currency', '') is null or upper(f->>'currency') = 'USD')
     and (public.market_num(f->>'min_price') is null
          or coalesce(s.budget_max_usd, s.budget_min_usd) >= public.market_num(f->>'min_price'))
     and (public.market_num(f->>'max_price') is null
          or coalesce(s.budget_min_usd, s.budget_max_usd) <= public.market_num(f->>'max_price'))
     and (public.market_num(f->>'min_bedrooms') is null or coalesce(s.bedrooms_max, s.bedrooms_min) >= public.market_num(f->>'min_bedrooms'))
     and (public.market_num(f->>'max_bedrooms') is null or coalesce(s.bedrooms_min, s.bedrooms_max) <= public.market_num(f->>'max_bedrooms'))
     and (public.market_num(f->>'min_area') is null or coalesce(s.area_max, s.area_min) >= public.market_num(f->>'min_area'))
     and (public.market_num(f->>'max_area') is null or coalesce(s.area_min, s.area_max) <= public.market_num(f->>'max_area'))
     and (nullif(f->>'confidence', '') is null
          or (upper(f->>'confidence') = 'HIGH' and s.confidence >= 0.8)
          or (upper(f->>'confidence') = 'MEDIUM' and s.confidence >= 0.5 and s.confidence < 0.8)
          or (upper(f->>'confidence') = 'LOW' and s.confidence < 0.5))
     and (nullif(f->>'match_strength', '') is null
          or (upper(f->>'match_strength') = 'STRONG' and s.compatible_matches > 0)
          or (upper(f->>'match_strength') = 'ANY' and s.internal_matches > 0)
          or (upper(f->>'match_strength') = 'NONE' and s.internal_matches = 0))
     and (public.market_num(f->>'recency_days') is null
          or s.latest_at >= now() - make_interval(days => public.market_num(f->>'recency_days')::int))
     and (nullif(f->>'status', '') is null
          or (upper(f->>'status') = 'ACTIVE' and s.is_active and not s.stale)
          or (upper(f->>'status') = 'INACTIVE' and not s.is_active)
          or (upper(f->>'status') = 'STALE' and s.stale))
     and (nullif(f->>'budget', '') is null
          or (upper(f->>'budget') = 'CONFIRMED' and s.budget_confirmed)
          or (upper(f->>'budget') = 'UNKNOWN' and not s.budget_confirmed))
     and (nullif(f->>'strength', '') is null
          or (upper(f->>'strength') = 'STRONG' and s.level_rank >= 4 and not s.stale)
          or (upper(f->>'strength') = 'EXPLORATORY' and (s.level_rank < 4 or s.stale)))
     and (v_q is null or coalesce(s.email, '') ilike '%' || public.homatch_ilike_escape(v_q) || '%' escape '\'
          or coalesce(s.full_name, '') ilike '%' || public.homatch_ilike_escape(v_q) || '%' escape '\'
          or s.user_id::text = v_q);
end $$;
revoke all on function public.buyer_intelligence_filtered(jsonb) from public, anon, authenticated;

create or replace function public.admin_buyer_intelligence_list(
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'latest_desc',
  p_page int default 1,
  p_page_size int default 25
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_size int := greatest(1, least(coalesce(p_page_size, 25), 100));
  v_page int := greatest(1, coalesce(p_page, 1));
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  with filtered as materialized (select * from public.buyer_intelligence_filtered(p_filters)),
  paged as materialized (
    select fl.*, count(*) over () as total from filtered fl
     order by
       case when p_sort = 'level_desc' then fl.level_rank end desc nulls last,
       case when p_sort = 'confidence_desc' then fl.confidence end desc nulls last,
       case when p_sort = 'budget_desc' then coalesce(fl.budget_max_usd, fl.budget_min_usd) end desc nulls last,
       case when p_sort = 'budget_asc' then coalesce(fl.budget_min_usd, fl.budget_max_usd) end asc nulls last,
       case when p_sort = 'matches_desc' then fl.internal_matches end desc nulls last,
       case when p_sort = 'latest_asc' then fl.latest_at end asc nulls last,
       fl.latest_at desc nulls last, fl.user_id
     limit v_size offset (v_page - 1) * v_size
  )
  select jsonb_build_object(
    'page', v_page, 'page_size', v_size,
    'total', coalesce((select max(total) from paged), (select count(*) from filtered)),
    'rows', coalesce((select jsonb_agg(to_jsonb(pg) - 'total') from paged pg), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;
revoke all on function public.admin_buyer_intelligence_list(jsonb, text, int, int) from public, anon;
grant execute on function public.admin_buyer_intelligence_list(jsonb, text, int, int) to authenticated;

create or replace function public.admin_buyer_intelligence_stats(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_has_category boolean;
  v_external jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;

  /* find_buyers_leads.match_category arrives with 20261024090000; until then
     the qualified count is reported as unavailable, never as zero. */
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'find_buyers_leads' and column_name = 'match_category')
    into v_has_category;
  if v_has_category then
    execute $q$select jsonb_build_object('available', true, 'total', count(*),
                 'qualified', count(*) filter (where match_category in ('STRONG', 'POTENTIAL')),
                 'strong', count(*) filter (where match_category = 'STRONG'),
                 'potential', count(*) filter (where match_category = 'POTENTIAL'))
               from public.find_buyers_leads$q$ into v_external;
  elsif to_regclass('public.find_buyers_leads') is not null then
    execute $q$select jsonb_build_object('available', false, 'total', count(*), 'qualified', null,
                 'reason', 'MATCH_CATEGORY_NOT_DEPLOYED') from public.find_buyers_leads$q$ into v_external;
  else
    v_external := jsonb_build_object('available', false, 'total', null, 'qualified', null, 'reason', 'NO_TABLE');
  end if;

  with s as materialized (select * from public.buyer_intelligence_filtered(p_filters))
  select jsonb_build_object(
    'people', (select count(*) from s),
    'buyers', (select count(*) from s where role in ('BUYER', 'BOTH')),
    'tenants', (select count(*) from s where role in ('TENANT', 'BOTH')),
    'eligible_buyers', (select count(*) from s where role in ('BUYER', 'BOTH') and is_active and not stale),
    'eligible_tenants', (select count(*) from s where role in ('TENANT', 'BOTH') and is_active and not stale),
    'strong', (select count(*) from s where level_rank >= 4 and not stale),
    'exploratory', (select count(*) from s where level_rank < 4 or stale),
    'stale', (select count(*) from s where stale),
    'uncertain', (select count(*) from s where confidence < 0.5),
    'budget_confirmed', (select count(*) from s where budget_confirmed),
    'budget_unknown', (select count(*) from s where not budget_confirmed),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', c, 'count', n) order by n desc, c), '[]'::jsonb)
                  from (select c, count(*) n from s, unnest(s.city_keys) c group by c) x),
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object('district', d, 'count', n) order by n desc, d), '[]'::jsonb)
                      from (select d, count(*) n from s, unnest(s.district_keys) d group by d) x),
    'by_source', (select coalesce(jsonb_object_agg(src, n), '{}'::jsonb)
                    from (select src, count(*) n from s, unnest(s.sources) src group by src) x),
    'by_level', (select coalesce(jsonb_object_agg(intent_level, n), '{}'::jsonb)
                   from (select intent_level, count(*) n from s group by intent_level) x),
    'by_segment', (select coalesce(jsonb_object_agg(seg, n), '{}'::jsonb)
                     from (select seg, count(*) n from s, unnest(s.segments) seg group by seg) x),
    'budget_ranges', jsonb_build_object(
      'sale', (select jsonb_build_object(
          'lt_50k', count(*) filter (where b < 50000), '50k_100k', count(*) filter (where b >= 50000 and b < 100000),
          '100k_200k', count(*) filter (where b >= 100000 and b < 200000), '200k_400k', count(*) filter (where b >= 200000 and b < 400000),
          'gte_400k', count(*) filter (where b >= 400000), 'unknown', count(*) filter (where b is null))
          from (select coalesce(budget_max_usd, budget_min_usd) b from s where 'SALE' = any (transactions)) x),
      'rent', (select jsonb_build_object(
          'lt_500', count(*) filter (where b < 500), '500_1000', count(*) filter (where b >= 500 and b < 1000),
          '1000_2000', count(*) filter (where b >= 1000 and b < 2000), 'gte_2000', count(*) filter (where b >= 2000),
          'unknown', count(*) filter (where b is null))
          from (select coalesce(budget_max_usd, budget_min_usd) b from s where 'RENT' = any (transactions)) x)),
    'internal_matches', (select jsonb_build_object(
        'total', count(*),
        'compatible', count(*) filter (where m.compatibility = 'COMPATIBLE'),
        'uncertain', count(*) filter (where m.compatibility = 'INSUFFICIENT_INFORMATION'),
        'stale', count(*) filter (where exists (select 1 from s where s.user_id = m.demand_user_id and s.stale)))
        from public.supply_matches m
       where m.source_kind = 'INTERNAL_HOMATCH'
         and (p_filters is null or p_filters = '{}'::jsonb or m.demand_user_id in (select user_id from s))),
    'external_leads', v_external)
    into v;
  return v;
end $$;
revoke all on function public.admin_buyer_intelligence_stats(jsonb) from public, anon;
grant execute on function public.admin_buyer_intelligence_stats(jsonb) to authenticated;

/*
 * The inspect drawer: the person's authorised matching summary and the
 * evidence for each classification. Structured fields only — no message text,
 * no originalText, no mortgage numbers.
 */
create or replace function public.admin_buyer_intelligence_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'summary', (select to_jsonb(s) from public.buyer_intelligence_summaries() s where s.user_id = p_user_id),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
        'source', e.source, 'source_id', e.source_id, 'intent_level', e.intent_level, 'role', e.role,
        'is_active', e.is_active, 'on_behalf', e.on_behalf, 'confidence', e.confidence, 'observed_at', e.observed_at,
        'freshness', public.buyer_intelligence_freshness(e.observed_at, array[e.transaction]),
        'transaction', e.transaction, 'property_types', e.property_types, 'country', e.country, 'city', e.city,
        'districts', e.districts, 'neighborhoods', e.neighborhoods,
        'budget', case when e.budget_confirmed then jsonb_build_object(
            'min', e.budget_min, 'max', e.budget_max, 'currency', e.currency,
            'min_usd', e.budget_min_usd, 'max_usd', e.budget_max_usd) end,
        'budget_confirmed', e.budget_confirmed,
        'bedrooms', jsonb_build_object('min', e.bedrooms_min, 'max', e.bedrooms_max),
        'rooms', jsonb_build_object('min', e.rooms_min, 'max', e.rooms_max),
        'area', jsonb_build_object('min', e.area_min, 'max', e.area_max),
        'property', case when e.property_id is null then null else
            (select jsonb_build_object('id', p.id, 'homatch_id', p.homatch_id) from public.properties p where p.id = e.property_id) end)
        order by e.observed_at desc), '[]'::jsonb)
        from public.buyer_intelligence_sources() e where e.user_id = p_user_id),
    'internal_matches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'property_homatch_id', p.homatch_id, 'compatibility', m.compatibility, 'score', m.match_score,
        'deal_kind', m.deal_kind, 'agreed', m.agreed, 'conflicted', m.conflicted,
        'unknown_dimensions', m.unknown_dimensions, 'created_at', m.created_at) order by m.match_score desc nulls last), '[]'::jsonb)
        from public.supply_matches m left join public.properties p on p.id = m.property_id
       where m.source_kind = 'INTERNAL_HOMATCH' and m.demand_user_id = p_user_id));
end $$;
revoke all on function public.admin_buyer_intelligence_detail(uuid) from public, anon;
grant execute on function public.admin_buyer_intelligence_detail(uuid) to authenticated;
