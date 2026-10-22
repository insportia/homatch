-- FIND BUYERS 2.0 — SMART INTERNAL MATCH EXPANSION AND TIERED UNLOCK PRICING (owner, 2026-10-18)
--
-- Internal matching reaches beyond the exact area a member named, without losing precision:
-- supply-matching (the native worker) now classifies every member search against every
-- listing with research-core/match/internalTiers.ts and writes the result here. Searching and
-- browsing stay free; only an explicit, authorised contact unlock is charged.
--
--   1 · prices       EXACT $0.50 = 5 credits (new INTERNAL_LEAD_EXACT), NEARBY / SIMILAR $0.30 =
--                    3 credits (INTERNAL_LEAD_STANDARD), VIP $1.00 = 10 credits
--                    (INTERNAL_LEAD_PREMIUM). VIP overrides; one price per unlock, never stacked.
--   2 · geography    internal_match_place_geo: each area's median position and price level,
--                    MEASURED from the geocoded portal listings HOMATCH has observed. "Nearby"
--                    is decided from these medians — never from string similarity or a guess.
--   3 · settings     admin_settings.internal_match_expansion (tolerance bands, distance,
--                    sample floor, price-level ratio, similar on/off) — read by the worker.
--   4 · candidates   internal_match_candidates: one row per (member search, listing) with the
--                    category, kind, confidence and the evidence behind it. Written only by the
--                    worker (service role); RLS on, no policies.
--   5 · owner controls  internal_match_preferences per listing: nearby on/off + distance,
--                    budget tolerance on/off, similar on/off, city-wide on/off. Applied at read
--                    time, instantly and free.
--   6 · reads        internal_lead_rows (same signature) now reads the classified candidates: one
--                    person once per listing, preferring their EXACT reading. Feed v2, quote,
--                    unlock, entitlement, saved and the CRM profile follow it.
--   7 · re-scan      every active listing is queued once so its candidates are written.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · prices
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  ('INTERNAL_LEAD_EXACT', 'HOMATCH Leads — Exact match contact unlock', 'FIXED',
   true, 50, 0, 0, 'PER_UNIT', true, true, 90,
   jsonb_build_object('unit', 'INTERNAL_LEAD', 'segment', 'EXACT'), 0)
on conflict (code) do nothing;
update public.billable_products set name = 'HOMATCH Leads — Nearby or similar match contact unlock', updated_at = now()
 where code = 'INTERNAL_LEAD_STANDARD';

create or replace function public.internal_lead_prices()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'STANDARD', (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_STANDARD'),
    'EXACT',    (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_EXACT'),
    'PREMIUM',  (select round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2)
                   from public.billable_products p where p.code = 'INTERNAL_LEAD_PREMIUM'),
    'active', coalesce((select bool_and(p.enabled and not p.kill_switch and p.pricing_active) and count(*) = 3
                          from public.billable_products p
                         where p.code in ('INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM')), false))
$$;
revoke all on function public.internal_lead_prices() from public, anon;
grant execute on function public.internal_lead_prices() to authenticated, service_role;

alter table public.internal_lead_unlocks drop constraint if exists internal_lead_unlocks_segment_check;
alter table public.internal_lead_unlocks add constraint internal_lead_unlocks_segment_check
  check (segment in ('STANDARD', 'EXACT', 'PREMIUM'));

/* ════════════════════════════════════════════════════════════════════════
 * 2 · measured geography
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.internal_match_place_geo (
  city_key     text not null,
  place_key    text not null,
  samples      integer not null check (samples > 0),
  lat          double precision not null,
  lon          double precision not null,
  ppsqm_usd    numeric,
  sources      text[] not null default '{}',
  refreshed_at timestamptz not null default now(),
  primary key (city_key, place_key)
);
comment on table public.internal_match_place_geo is
  'Each area''s median position and median USD/m², measured from geocoded portal listings (discovery_marketplace_listings). Keys are market_place_key(). Read by supply-matching to decide which areas are neighbours. Service role only.';
alter table public.internal_match_place_geo enable row level security;
revoke all on public.internal_match_place_geo from public, anon, authenticated;
grant select, insert, update, delete on public.internal_match_place_geo to service_role;

/*
 * Rebuild the area medians. One listing counts once (by canonical URL); points more than
 * 3 km from their area's median are treated as bad geocodes and dropped before the final
 * median; a price level needs at least 3 USD sale listings with a price per m².
 */
create or replace function public.internal_match_refresh_place_geo()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  create temporary table if not exists pg_temp.imgeo_points (
    city_key text, place_key text, lat double precision, lon double precision, ppsqm numeric, source text
  ) on commit drop;
  truncate pg_temp.imgeo_points;

  insert into pg_temp.imgeo_points
  select public.market_place_key(l.raw->>'city'), public.market_place_key(l.raw->>'district'),
         (l.raw->>'latitude')::double precision, (l.raw->>'longitude')::double precision,
         case when upper(coalesce(l.raw->>'transactionType', '')) in ('BUY', 'SALE')
                   and upper(coalesce(l.raw->>'currency', '')) = 'USD' then
                coalesce(case when l.raw->>'pricePerSqm' ~ '^[0-9]+(\.[0-9]+)?$' then (l.raw->>'pricePerSqm')::numeric end,
                         case when l.raw->>'price' ~ '^[0-9]+(\.[0-9]+)?$' and l.raw->>'areaSqm' ~ '^[0-9]+(\.[0-9]+)?$'
                                   and (l.raw->>'areaSqm')::numeric >= 15
                              then round((l.raw->>'price')::numeric / (l.raw->>'areaSqm')::numeric) end)
         end,
         l.raw->>'source'
    from (select distinct on (coalesce(d.raw->>'canonicalUrl', d.raw->>'exactUrl', d.id::text)) d.raw
            from public.discovery_marketplace_listings d
           where d.raw->>'latitude' ~ '^-?[0-9]+(\.[0-9]+)?$' and d.raw->>'longitude' ~ '^-?[0-9]+(\.[0-9]+)?$'
             and nullif(trim(coalesce(d.raw->>'district', '')), '') is not null
             and nullif(trim(coalesce(d.raw->>'city', '')), '') is not null
           order by coalesce(d.raw->>'canonicalUrl', d.raw->>'exactUrl', d.id::text), d.observed_at desc) l
   where (l.raw->>'latitude')::double precision between 41.0 and 43.7
     and (l.raw->>'longitude')::double precision between 40.0 and 46.8;

  with med as (
    select city_key, place_key,
           percentile_cont(0.5) within group (order by lat) as mlat,
           percentile_cont(0.5) within group (order by lon) as mlon
      from pg_temp.imgeo_points where city_key is not null and place_key is not null group by 1, 2
  ), kept as (
    select p.* from pg_temp.imgeo_points p join med m using (city_key, place_key)
     where sqrt(power((p.lat - m.mlat) * 111.0, 2) + power((p.lon - m.mlon) * 111.0 * cos(radians(m.mlat)), 2)) <= 3.0
  ), agg as (
    select city_key, place_key, count(*)::integer as samples,
           percentile_cont(0.5) within group (order by lat) as lat,
           percentile_cont(0.5) within group (order by lon) as lon,
           case when count(ppsqm) >= 3 then round((percentile_cont(0.5) within group (order by ppsqm::double precision))::numeric) end as ppsqm_usd,
           array_agg(distinct source) filter (where source is not null) as sources
      from kept group by 1, 2
  ), up as (
    insert into public.internal_match_place_geo (city_key, place_key, samples, lat, lon, ppsqm_usd, sources, refreshed_at)
    select city_key, place_key, samples, lat, lon, ppsqm_usd, coalesce(sources, '{}'), now() from agg
    on conflict (city_key, place_key) do update
      set samples = excluded.samples, lat = excluded.lat, lon = excluded.lon, ppsqm_usd = excluded.ppsqm_usd,
          sources = excluded.sources, refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*) into v_n from up;
  delete from public.internal_match_place_geo g where g.refreshed_at < now();
  return v_n;
end $$;
revoke all on function public.internal_match_refresh_place_geo() from public, anon, authenticated;
grant execute on function public.internal_match_refresh_place_geo() to service_role;

select public.internal_match_refresh_place_geo();

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'homatch-internal-match-geo';
    perform cron.schedule('homatch-internal-match-geo', '17 3 * * 1', $c$ select public.internal_match_refresh_place_geo(); $c$);
  end if;
end $$;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · settings (the owner's defaults; Admin can change them)
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.admin_settings (key, value, description)
values ('internal_match_expansion',
        '{"saleBands": [{"upTo": 50000, "tolerance": 5000}, {"upTo": 119999, "tolerance": 10000}, {"upTo": null, "tolerance": 15000}],
          "bandsCurrency": "USD", "rentTolerancePct": 0, "nearbyMaxKm": 2.5, "minGeoSamples": 5,
          "priceLevelMaxRatio": 1.35, "similarEnabled": true}'::jsonb,
        'Find Buyers internal match expansion: discovery budget tolerance (not purchasing capacity), measured nearby distance, geocoded-sample floor, comparable price level, similar-property tier.')
on conflict (key) do nothing;

create or replace function public.internal_match_expansion_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.admin_settings where key = 'internal_match_expansion'), '{}'::jsonb)
$$;
revoke all on function public.internal_match_expansion_config() from public, anon;
grant execute on function public.internal_match_expansion_config() to authenticated, service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 4 · the classified candidates
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.internal_match_candidates (
  id                 uuid primary key default gen_random_uuid(),
  intent_profile_id  uuid not null references public.intent_profiles(id) on delete cascade,
  property_id        uuid not null references public.properties(id) on delete cascade,
  supply_user_id     uuid not null references public.users(id) on delete cascade,
  demand_user_id     uuid not null references public.users(id) on delete cascade,
  category           text not null check (category in ('EXACT', 'NEARBY_SIMILAR')),
  kind               text not null check (kind in ('EXACT_LOCATION', 'SAME_AREA_BUDGET_FLEX', 'NEARBY_AREA', 'CITY_WIDE', 'SIMILAR_PROPERTY')),
  confidence         text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  score              numeric not null check (score >= 0 and score <= 1),
  budget_verdict     text not null check (budget_verdict in ('WITHIN', 'BELOW_MIN_TOLERANCE', 'ABOVE_MAX_TOLERANCE', 'UNKNOWN')),
  geo_level          text not null check (geo_level in ('EXACT_AREA', 'NEARBY_AREA', 'CITY_WIDE', 'OTHER_AREA')),
  geo_km             numeric,
  explanation        jsonb not null default '{}'::jsonb,
  agreed             text[] not null default '{}',
  conflicted         text[] not null default '{}',
  preference_misses  text[] not null default '{}',
  unknown_dimensions text[] not null default '{}',
  version            text not null,
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz not null default now(),
  constraint internal_match_candidates_not_self check (supply_user_id <> demand_user_id),
  constraint internal_match_candidates_exact_is_documented check (
    category <> 'EXACT' or (kind = 'EXACT_LOCATION' and geo_level = 'EXACT_AREA' and budget_verdict = 'WITHIN'))
);
create unique index if not exists internal_match_candidates_pair on public.internal_match_candidates (intent_profile_id, property_id);
create index if not exists internal_match_candidates_property on public.internal_match_candidates (property_id, supply_user_id);
create index if not exists internal_match_candidates_demand on public.internal_match_candidates (demand_user_id);
comment on table public.internal_match_candidates is
  'Find Buyers 2.0: every member search classified against every listing (EXACT / NEARBY_SIMILAR) with its evidence. Written by supply-matching (internalTiers.ts) only.';
alter table public.internal_match_candidates enable row level security;
revoke all on public.internal_match_candidates from public, anon, authenticated;
grant select, insert, update, delete on public.internal_match_candidates to service_role;

create or replace function public.internal_match_upsert(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.internal_match_candidates (
    intent_profile_id, property_id, supply_user_id, demand_user_id, category, kind, confidence, score,
    budget_verdict, geo_level, geo_km, explanation, agreed, conflicted, preference_misses, unknown_dimensions,
    version, confirmed_at)
  values (
    (p->>'intent_profile_id')::uuid, (p->>'property_id')::uuid, (p->>'supply_user_id')::uuid, (p->>'demand_user_id')::uuid,
    p->>'category', p->>'kind', p->>'confidence', greatest(0, least(1, coalesce((p->>'score')::numeric, 0))),
    p->>'budget_verdict', p->>'geo_level', nullif(p->>'geo_km', '')::numeric, coalesce(p->'explanation', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p->'agreed')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'conflicted')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'preference_misses')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p->'unknown_dimensions')), '{}'),
    coalesce(nullif(p->>'version', ''), 'unknown'), now())
  on conflict (intent_profile_id, property_id) do update set
    supply_user_id = excluded.supply_user_id, demand_user_id = excluded.demand_user_id,
    category = excluded.category, kind = excluded.kind, confidence = excluded.confidence, score = excluded.score,
    budget_verdict = excluded.budget_verdict, geo_level = excluded.geo_level, geo_km = excluded.geo_km,
    explanation = excluded.explanation, agreed = excluded.agreed, conflicted = excluded.conflicted,
    preference_misses = excluded.preference_misses, unknown_dimensions = excluded.unknown_dimensions,
    version = excluded.version, confirmed_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.internal_match_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.internal_match_upsert(jsonb) to service_role;

/*
 * After a COMPLETE pass of one member search: candidates it no longer produces are removed.
 * p_property_ids limits it to the listings a property-scoped pass judged; a full pass removes
 * what was not re-confirmed since the pass began.
 */
create or replace function public.internal_match_retire(p_intent_profile_id uuid, p_scan_started_at timestamptz,
                                                       p_property_ids uuid[] default null, p_keep uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_property_ids is null and p_scan_started_at is null then raise exception 'SCAN_START_REQUIRED'; end if;
  delete from public.internal_match_candidates c
   where c.intent_profile_id = p_intent_profile_id
     and (case when p_property_ids is not null
               then c.property_id = any (p_property_ids) and not (c.property_id = any (coalesce(p_keep, '{}')))
                    and (p_scan_started_at is null or c.confirmed_at < p_scan_started_at)
               else c.confirmed_at < p_scan_started_at end);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.internal_match_retire(uuid, timestamptz, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.internal_match_retire(uuid, timestamptz, uuid[], uuid[]) to service_role;

/* A member whose search stops being active stops being a candidate (also filtered on read). */
create or replace function public.internal_match_candidates_on_inactive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_active is distinct from old.is_active and not new.is_active and new.intent_id is not null then
    delete from public.internal_match_candidates c where c.intent_profile_id = new.intent_id
       and not exists (select 1 from public.active_search_subscriptions s
                        where s.intent_id = new.intent_id and s.is_active and s.id <> new.id);
  end if;
  return new;
end $$;
revoke all on function public.internal_match_candidates_on_inactive() from public, anon, authenticated;
drop trigger if exists internal_match_candidates_on_inactive on public.active_search_subscriptions;
create trigger internal_match_candidates_on_inactive after update of is_active on public.active_search_subscriptions
  for each row execute function public.internal_match_candidates_on_inactive();

/* The worker also needs a re-scan when the facts the tiers read change (area, address, quality). */
drop trigger if exists native_match_enqueue_property_facts on public.property_facts;
create trigger native_match_enqueue_property_facts
  after insert or update of total_price, currency, city, district, neighborhood, address, area, rooms, bedrooms,
                            condition, construction_status, new_build, parking, elevator, balcony, terrace, furnished,
                            air_conditioning, yard
  on public.property_facts for each row execute function public.native_match_enqueue_property();

/* ════════════════════════════════════════════════════════════════════════
 * 5 · the owner's controls (per listing, free, instant)
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.internal_match_preferences (
  property_id       uuid primary key references public.properties(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  nearby_enabled    boolean not null default true,
  nearby_km         numeric check (nearby_km is null or (nearby_km >= 0 and nearby_km <= 10)),
  budget_tolerance  boolean not null default true,
  similar_enabled   boolean not null default true,
  city_wide_enabled boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table public.internal_match_preferences enable row level security;
revoke all on public.internal_match_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.internal_match_preferences to service_role;

/* Is a candidate visible under the owner's controls for that listing? (No row = defaults.) */
create or replace function public.internal_match_visible(p_property_id uuid, p_kind text, p_budget text, p_km numeric)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when pf.property_id is null then true
    when p_kind = 'NEARBY_AREA' and (not pf.nearby_enabled or (pf.nearby_km is not null and coalesce(p_km, 0) > pf.nearby_km)) then false
    when p_kind = 'SIMILAR_PROPERTY' and not pf.similar_enabled then false
    when p_kind = 'CITY_WIDE' and not pf.city_wide_enabled then false
    when p_budget in ('ABOVE_MAX_TOLERANCE', 'BELOW_MIN_TOLERANCE') and not pf.budget_tolerance then false
    else true end
    from (select 1) one left join public.internal_match_preferences pf on pf.property_id = p_property_id
$$;
revoke all on function public.internal_match_visible(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.internal_match_visible(uuid, text, text, numeric) to service_role;

create or replace function public.internal_match_preferences_of(p_property_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_pf record;
  v_cfg jsonb := public.internal_match_expansion_config();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = v_me and not p.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  select * into v_pf from public.internal_match_preferences where property_id = p_property_id;
  return jsonb_build_object(
    'nearbyEnabled', coalesce(v_pf.nearby_enabled, true),
    'nearbyKm', coalesce(v_pf.nearby_km, (v_cfg->>'nearbyMaxKm')::numeric, 2.5),
    'maxNearbyKm', coalesce((v_cfg->>'nearbyMaxKm')::numeric, 2.5),
    'budgetTolerance', coalesce(v_pf.budget_tolerance, true),
    'similarEnabled', coalesce(v_pf.similar_enabled, true) and coalesce((v_cfg->>'similarEnabled')::boolean, true),
    'similarAvailable', coalesce((v_cfg->>'similarEnabled')::boolean, true),
    'cityWideEnabled', coalesce(v_pf.city_wide_enabled, true),
    'saleBands', coalesce(v_cfg->'saleBands', '[]'::jsonb),
    'bandsCurrency', coalesce(v_cfg->>'bandsCurrency', 'USD'),
    'rentTolerancePct', coalesce((v_cfg->>'rentTolerancePct')::numeric, 0));
end $$;
revoke all on function public.internal_match_preferences_of(uuid) from public, anon;
grant execute on function public.internal_match_preferences_of(uuid) to authenticated;

create or replace function public.internal_match_preferences_set(p_property_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_max numeric := coalesce((public.internal_match_expansion_config()->>'nearbyMaxKm')::numeric, 2.5);
  v_km numeric;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties pr where pr.id = p_property_id and pr.user_id = v_me and not pr.is_deleted) then
    raise exception 'not found' using errcode = '42501';
  end if;
  /* The worker stores candidates out to the configured maximum; an owner can only narrow it. */
  v_km := case when p ? 'nearbyKm' and nullif(p->>'nearbyKm', '') is not null
               then greatest(0, least(v_max, (p->>'nearbyKm')::numeric)) end;
  insert into public.internal_match_preferences
    (property_id, owner_user_id, nearby_enabled, nearby_km, budget_tolerance, similar_enabled, city_wide_enabled, updated_at)
  values (p_property_id, v_me,
          coalesce((p->>'nearbyEnabled')::boolean, true), v_km,
          coalesce((p->>'budgetTolerance')::boolean, true),
          coalesce((p->>'similarEnabled')::boolean, true),
          coalesce((p->>'cityWideEnabled')::boolean, true), now())
  on conflict (property_id) do update set
    nearby_enabled = case when p ? 'nearbyEnabled' then (p->>'nearbyEnabled')::boolean else internal_match_preferences.nearby_enabled end,
    nearby_km = case when p ? 'nearbyKm' then v_km else internal_match_preferences.nearby_km end,
    budget_tolerance = case when p ? 'budgetTolerance' then (p->>'budgetTolerance')::boolean else internal_match_preferences.budget_tolerance end,
    similar_enabled = case when p ? 'similarEnabled' then (p->>'similarEnabled')::boolean else internal_match_preferences.similar_enabled end,
    city_wide_enabled = case when p ? 'cityWideEnabled' then (p->>'cityWideEnabled')::boolean else internal_match_preferences.city_wide_enabled end,
    updated_at = now();
  return public.internal_match_preferences_of(p_property_id);
end $$;
revoke all on function public.internal_match_preferences_set(uuid, jsonb) from public, anon;
grant execute on function public.internal_match_preferences_set(uuid, jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 6 · reads: one person once per listing, eligible, visible
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.internal_lead_rows(p_owner uuid, p_property_id uuid)
returns table (
  match_id uuid, lead_user_id uuid, intent_profile_id uuid, match_score numeric,
  agreed text[], conflicted text[], unknown_dimensions text[], preference_misses text[],
  matched_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (c.demand_user_id)
         c.id, c.demand_user_id, c.intent_profile_id, c.score,
         c.agreed, c.conflicted, c.unknown_dimensions, c.preference_misses,
         c.created_at, c.confirmed_at
    from public.internal_match_candidates c
    join public.users u on u.id = c.demand_user_id and u.suspended_at is null
   where c.property_id = p_property_id
     and c.supply_user_id = p_owner
     and c.demand_user_id <> p_owner
     and public.internal_match_visible(c.property_id, c.kind, c.budget_verdict, c.geo_km)
     and exists (select 1 from public.active_search_subscriptions s
                  where s.user_id = c.demand_user_id and s.intent_id = c.intent_profile_id and s.is_active)
     and (select p.accept_property_offers from public.lead_contact_prefs_of(c.demand_user_id) p)
     and not exists (select 1 from public.conversation_blocks b
                      where (b.blocker_id = c.demand_user_id and b.blocked_id = p_owner)
                         or (b.blocker_id = p_owner and b.blocked_id = c.demand_user_id))
   /* A person with several searches appears once: their EXACT reading first, then the best. */
   order by c.demand_user_id, (c.category = 'EXACT') desc, c.score desc, c.confirmed_at desc
$$;
revoke all on function public.internal_lead_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_rows(uuid, uuid) to service_role;

/* VIP (documented high budget) overrides; otherwise EXACT or STANDARD (nearby / similar). Never stacked. */
create or replace function public.internal_lead_price_key(p_category text, p_intent_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when (select s.segment from public.internal_lead_segment(p_intent_profile_id) s) = 'PREMIUM' then 'PREMIUM'
              when p_category = 'EXACT' then 'EXACT'
              else 'STANDARD' end
$$;
revoke all on function public.internal_lead_price_key(text, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_price_key(text, uuid) to service_role;

/* The candidates in a selection the caller may actually unlock (eligible + visible + one per person). */
create or replace function public.internal_lead_pick(p_user_id uuid, p_match_ids uuid[])
returns table (match_id uuid, lead_user_id uuid, intent_profile_id uuid, property_id uuid, price_key text)
language sql stable security definer set search_path = public as $$
  select distinct on (c.demand_user_id) c.id, c.demand_user_id, c.intent_profile_id, c.property_id,
         public.internal_lead_price_key(c.category, c.intent_profile_id)
    from public.internal_match_candidates c
   where c.id = any (coalesce(p_match_ids, '{}'::uuid[]))
     and c.supply_user_id = p_user_id
     and exists (select 1 from public.internal_lead_rows(p_user_id, c.property_id) r where r.match_id = c.id)
   order by c.demand_user_id, (c.category = 'EXACT') desc, c.score desc
$$;
revoke all on function public.internal_lead_pick(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.internal_lead_pick(uuid, uuid[]) to service_role;

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
    'standardCredits', coalesce(sum((v_prices->>'STANDARD')::numeric) filter (where not already and price_key = 'STANDARD'), 0),
    'exactCredits', coalesce(sum((v_prices->>'EXACT')::numeric) filter (where not already and price_key = 'EXACT'), 0),
    'premiumCredits', coalesce(sum((v_prices->>'PREMIUM')::numeric) filter (where not already and price_key = 'PREMIUM'), 0),
    'totalCredits', coalesce(sum((v_prices->>price_key)::numeric) filter (where not already), 0),
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id),
    'prices', v_prices)
    into v_out from priced;
  return v_out;
end $$;
revoke all on function public.internal_leads_unlock_quote_for(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock_quote_for(uuid, uuid[]) to service_role;

/*
 * internal_leads_unlock — unchanged guarantees (one transaction, advisory lock per account,
 * idempotency key, members already unlocked never charged, one person once, all-or-nothing),
 * now with three price keys: one reservation per key, each settled for exactly n × its price.
 */
create or replace function public.internal_leads_unlock(p_user_id uuid, p_match_ids uuid[], p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_prices jsonb;
  v_batch uuid := gen_random_uuid();
  v_seg text;
  v_n integer;
  v_unit numeric;
  v_total numeric;
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

  insert into pg_temp.ilu_pick
  select p.match_id, p.lead_user_id, p.intent_profile_id, p.property_id, p.price_key,
         exists (select 1 from public.internal_lead_unlocks u where u.account_user_id = p_user_id and u.lead_user_id = p.lead_user_id)
    from public.internal_lead_pick(p_user_id, p_match_ids) p;

  select coalesce(jsonb_agg(match_id), '[]'::jsonb) into v_already from pg_temp.ilu_pick where already;

  foreach v_seg in array array['STANDARD', 'EXACT', 'PREMIUM'] loop
    select count(*) into v_n from pg_temp.ilu_pick where not already and segment = v_seg;
    continue when v_n = 0;
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
revoke all on function public.internal_leads_unlock(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.internal_leads_unlock(uuid, uuid[], text) to service_role;

/* A handle → the lead the CALLER has unlocked (a candidate, or a native match from before). */
create or replace function public.internal_lead_entitled(p_me uuid, p_match_id uuid)
returns table (lead_user_id uuid, property_id uuid, unlock_id uuid)
language sql stable security definer set search_path = public as $$
  select x.lead_user_id, x.property_id, x.unlock_id from (
    select c.demand_user_id as lead_user_id, c.property_id, u.id as unlock_id, 1 as pref
      from public.internal_match_candidates c
      join public.internal_lead_unlocks u on u.account_user_id = p_me and u.lead_user_id = c.demand_user_id
     where c.id = p_match_id and c.supply_user_id = p_me
    union all
    select m.demand_user_id, m.property_id, u.id, 2
      from public.supply_matches m
      join public.internal_lead_unlocks u on u.account_user_id = p_me and u.lead_user_id = m.demand_user_id
     where m.id = p_match_id and m.supply_user_id = p_me and m.source_kind = 'INTERNAL_HOMATCH'
  ) x order by x.pref limit 1
$$;
revoke all on function public.internal_lead_entitled(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_lead_entitled(uuid, uuid) to service_role;

create or replace function public.internal_lead_toggle_saved(p_match_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.internal_match_candidates c where c.id = p_match_id and c.supply_user_id = v_me)
     and not exists (select 1 from public.supply_matches m where m.id = p_match_id and m.supply_user_id = v_me
                      and m.source_kind = 'INTERNAL_HOMATCH') then
    raise exception 'not found' using errcode = '42501';
  end if;
  if exists (select 1 from public.internal_lead_saved where account_user_id = v_me and match_id = p_match_id) then
    delete from public.internal_lead_saved where account_user_id = v_me and match_id = p_match_id;
    return false;
  end if;
  insert into public.internal_lead_saved (account_user_id, match_id) values (v_me, p_match_id);
  return true;
end $$;
revoke all on function public.internal_lead_toggle_saved(uuid) from public, anon;
grant execute on function public.internal_lead_toggle_saved(uuid) to authenticated;

/* The explanation, as the owner reads it: no identifier, only what was measured and stated. */
create or replace function public.internal_lead_explanation(p_c public.internal_match_candidates)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'geo', jsonb_build_object(
        'level', p_c.geo_level,
        'demandPlace', p_c.explanation #>> '{geo,demandPlace}',
        'supplyPlace', p_c.explanation #>> '{geo,supplyPlace}',
        'km', p_c.geo_km,
        'samples', p_c.explanation #> '{geo,samples}',
        'priceLevelRatio', p_c.explanation #> '{geo,priceLevelRatio}',
        'streetMentioned', coalesce((p_c.explanation #>> '{geo,streetMentioned}')::boolean, false)),
    'budget', jsonb_build_object(
        'verdict', p_c.budget_verdict,
        'outsideBy', p_c.explanation #> '{budget,outsideBy}',
        'tolerance', p_c.explanation #> '{budget,tolerance}',
        'currency', p_c.explanation #>> '{budget,currency}',
        'flexible', coalesce((p_c.explanation #>> '{budget,flexible}')::boolean, false)),
    'similarity', p_c.explanation -> 'similarity',
    'uncertainty', coalesce(p_c.explanation -> 'uncertainty', '[]'::jsonb)))
$$;
revoke all on function public.internal_lead_explanation(public.internal_match_candidates) from public, anon, authenticated;
grant execute on function public.internal_lead_explanation(public.internal_match_candidates) to service_role;

create or replace function public.crm_entry_profile(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_e record;
  v_c public.internal_match_candidates;
  v_m record;
  v_ip record;
  v_u record;
  v_intent uuid;
  v_match jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_e from public.lead_crm_entries where id = p_entry_id and owner_user_id = v_me;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select ul.segment, ul.created_at, ul.credits_charged into v_u from public.internal_lead_unlocks ul where ul.id = v_e.unlock_id;
  select c.* into v_c from public.internal_match_candidates c
   where c.demand_user_id = v_e.lead_user_id and c.supply_user_id = v_me
     and (v_e.property_id is null or c.property_id = v_e.property_id)
   order by (c.category = 'EXACT') desc, c.score desc, c.confirmed_at desc limit 1;
  if v_c.id is not null then
    v_intent := v_c.intent_profile_id;
    v_match := jsonb_build_object(
        'matchId', v_c.id, 'propertyId', v_c.property_id, 'score', round(v_c.score * 100),
        'category', v_c.category, 'kind', v_c.kind, 'confidence', v_c.confidence,
        'explanation', public.internal_lead_explanation(v_c),
        'agreed', to_jsonb(v_c.agreed), 'conflicted', to_jsonb(v_c.conflicted), 'unknown', to_jsonb(v_c.unknown_dimensions),
        'matchedAt', v_c.created_at);
  else
    select m.* into v_m from public.supply_matches m
     where m.demand_user_id = v_e.lead_user_id and m.supply_user_id = v_me and m.source_kind = 'INTERNAL_HOMATCH'
       and (v_e.property_id is null or m.property_id = v_e.property_id)
     order by m.match_score desc, m.updated_at desc limit 1;
    if v_m.id is not null then
      v_intent := v_m.intent_profile_id;
      v_match := jsonb_build_object(
          'matchId', v_m.id, 'propertyId', v_m.property_id, 'score', round(v_m.match_score * 100), 'agreed', to_jsonb(coalesce(v_m.agreed, '{}')),
          'conflicted', to_jsonb(coalesce(v_m.conflicted, '{}')), 'unknown', to_jsonb(coalesce(v_m.unknown_dimensions, '{}')),
          'matchedAt', v_m.created_at);
    end if;
  end if;
  if v_intent is not null then select * into v_ip from public.intent_profiles where id = v_intent; end if;
  return jsonb_build_object(
    'entryId', v_e.id,
    'source', 'HOMATCH_MEMBER_SEARCH',
    'segment', v_u.segment,
    'unlockedAt', coalesce(v_u.created_at, v_e.created_at),
    'creditsCharged', v_u.credits_charged,
    'match', v_match,
    'demand', case when v_ip.id is null then null else jsonb_strip_nulls(jsonb_build_object(
        'transaction', case when upper(coalesce(v_ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end,
        'propertyTypes', to_jsonb(coalesce(v_ip.property_types, '{}'::text[])),
        'city', v_ip.city, 'district', v_ip.district, 'neighborhoods', to_jsonb(coalesce(v_ip.neighborhoods, '{}'::text[])),
        'budgetMin', v_ip.budget_min, 'budgetMax', v_ip.budget_max, 'currency', v_ip.currency,
        'bedroomsMin', v_ip.bedrooms_min, 'bedroomsMax', v_ip.bedrooms_max,
        'roomsMin', v_ip.rooms_min, 'roomsMax', v_ip.rooms_max, 'areaMin', v_ip.area_min, 'areaMax', v_ip.area_max,
        'features', public.internal_lead_features(v_ip.requirements),
        'statedAt', v_ip.created_at, 'activeAt', coalesce(v_ip.last_active_at, v_ip.created_at))) end,
    'drafts', coalesce((select jsonb_agg(jsonb_build_object('createdAt', ev.created_at, 'detail', ev.detail) order by ev.created_at desc)
                          from (select * from public.lead_crm_events where entry_id = v_e.id and kind = 'AI_DRAFT'
                                 order by created_at desc limit 10) ev), '[]'::jsonb));
end $$;
revoke all on function public.crm_entry_profile(uuid) from public, anon;
grant execute on function public.crm_entry_profile(uuid) to authenticated;

/*
 * internal_leads_feed_v2 — the same anonymised, owner-only, free feed, now carrying each
 * person's display category (VIP when their documented budget qualifies, else EXACT or
 * NEARBY_SIMILAR), the kind, the confidence, the explanation and the one price that applies.
 *   new filters  EXACT · NEARBY · VIP · HIGH_CONFIDENCE
 *   new sort     CATEGORY (VIP, EXACT, NEARBY_SIMILAR, then best)
 */
create or replace function public.internal_leads_feed_v2(p_property_id uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_seen timestamptz;
  v_limit integer := greatest(1, least(coalesce((p->>'limit')::integer, 24), 60));
  v_offset integer := greatest(0, coalesce((p->>'offset')::integer, 0));
  v_sort text := upper(coalesce(nullif(p->>'sort', ''), 'BEST'));
  v_filters text[] := coalesce((select array_agg(upper(x)) from jsonb_array_elements_text(
                        case when jsonb_typeof(p->'filters') = 'array' then p->'filters' else '[]'::jsonb end) x), '{}');
  v_district text := nullif(lower(trim(coalesce(p->>'district', ''))), '');
  v_ptype text := nullif(upper(trim(coalesce(p->>'propertyType', ''))), '');
  v_prices jsonb := public.internal_lead_prices();
  v_result jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
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
           case when seg.segment = 'PREMIUM' then 'VIP' else c.category end as display_category,
           case when seg.segment = 'PREMIUM' then 'PREMIUM' when c.category = 'EXACT' then 'EXACT' else 'STANDARD' end as price_key,
           case when upper(coalesce(ip.transaction_type, '')) in ('RENT', 'LEASE', 'RENTAL') then 'RENT' else 'SALE' end as tx,
           case when r.match_score >= 0.8 then 'STRONG' when r.match_score >= 0.5 then 'POTENTIAL' else 'WEAK' end as band,
           (u.id is not null) as unlocked,
           cr.status as crm_status, cr.id as crm_entry_id,
           exists (select 1 from public.internal_lead_saved sv where sv.account_user_id = v_me and sv.match_id = r.match_id) as saved,
           (cr.status is not null and cr.status <> 'UNLOCKED') as contacted,
           ((v_seen is null and r.matched_at > now() - interval '7 days') or (v_seen is not null and r.matched_at > v_seen)) as fresh,
           prefs.share_phone_on_unlock, prefs.share_email_on_unlock,
           usr.phone is not null and length(usr.phone) > 4 as has_phone,
           usr.email is not null and position('@' in usr.email) > 1 as has_email,
           usr.nickname, usr.full_name, usr.preferred_language
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
      left join public.internal_lead_unlocks u on u.account_user_id = v_me and u.lead_user_id = r.lead_user_id
      left join public.lead_crm_entries cr on cr.owner_user_id = v_me and cr.lead_user_id = r.lead_user_id
  ), marked as (
    select b.*, (b.active_at < now() - interval '45 days') as stale from base b
  ), filtered as (
    select * from marked b
     where (not ('STRONG' = any (v_filters)) or b.band = 'STRONG')
       and (not ('POTENTIAL' = any (v_filters)) or b.band = 'POTENTIAL')
       and (not ('STANDARD' = any (v_filters)) or b.segment = 'STANDARD')
       and (not ('PREMIUM' = any (v_filters)) or b.segment = 'PREMIUM')
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
        'propertyTypes', coalesce((select jsonb_agg(distinct t order by t) from marked b, unnest(coalesce(b.property_types, '{}'::text[])) t), '[]'::jsonb)),
    'prices', v_prices,
    'preferences', public.internal_match_preferences_of(p_property_id),
    'lastSeenAt', v_seen,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'matchId', pg.match_id,
        'score', round(pg.match_score * 100),
        'band', pg.band,
        'segment', pg.segment,
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
revoke all on function public.internal_leads_feed_v2(uuid, jsonb) from public, anon;
grant execute on function public.internal_leads_feed_v2(uuid, jsonb) to authenticated;

/* Email Studio "Create email" from a lead: its handle is now a classified candidate (or a native
   match from before) — the lead is resolved from either; eligibility is unchanged. */
create or replace function public.email_studio_eligible_recipients(p_match_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.users where id = v_me and suspended_at is not null) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  with picked as (
    select distinct on (coalesce(u.lead_user_id::text, h.mid::text))
           h.mid as match_id, u.id as unlock_id, u.lead_user_id, u.created_at
      from unnest(coalesce(p_match_ids, '{}'::uuid[])) as h(mid)
      left join public.internal_match_candidates c on c.id = h.mid and c.supply_user_id = v_me
      left join public.supply_matches m on m.id = h.mid and m.supply_user_id = v_me
                                       and m.source_kind = 'INTERNAL_HOMATCH'
      left join public.internal_lead_unlocks u on u.account_user_id = v_me
                                              and u.lead_user_id = coalesce(c.demand_user_id, m.demand_user_id)
     where p_match_ids is not null
    union all
    select null::uuid, u.id, u.lead_user_id, u.created_at
      from public.internal_lead_unlocks u
     where p_match_ids is null and u.account_user_id = v_me
  ), rows as (
    select p.match_id, p.unlock_id, p.created_at,
           case when p.unlock_id is null then null else public.email_studio_display_name(p.lead_user_id) end as display_name,
           case when p.unlock_id is null then null
                else (select preferred_language::text from public.users where id = p.lead_user_id) end as language,
           case when p.unlock_id is null then 'NOT_UNLOCKED'
                else public.email_studio_lead_eligibility(v_me, p.lead_user_id) end as reason
      from picked p
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'eligibleCount', (select count(*) from rows where reason is null),
    'reasons', coalesce((select jsonb_object_agg(reason, n) from
                           (select reason, count(*) n from rows where reason is not null group by reason) x), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'unlockId', r.unlock_id, 'matchId', r.match_id, 'displayName', r.display_name,
                         'language', r.language, 'eligible', r.reason is null, 'reason', r.reason)
                       order by (r.reason is null) desc, r.created_at desc nulls last) from rows r), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.email_studio_eligible_recipients(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.email_studio_eligible_recipients(uuid[]) to authenticated;

/* Admin revenue: the EXACT price key counts too, and how many candidates each category holds. */
create or replace function public.admin_internal_leads_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'prices', public.internal_lead_prices(),
    'expansion', public.internal_match_expansion_config(),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.transaction_type, r.updated_at desc)
                         from public.internal_lead_premium_rules r), '[]'::jsonb),
    'unlocks', (select jsonb_build_object(
                  'standard', count(*) filter (where segment = 'STANDARD'),
                  'exact', count(*) filter (where segment = 'EXACT'),
                  'premium', count(*) filter (where segment = 'PREMIUM'),
                  'standardCredits', coalesce(sum(credits_charged) filter (where segment = 'STANDARD'), 0),
                  'exactCredits', coalesce(sum(credits_charged) filter (where segment = 'EXACT'), 0),
                  'premiumCredits', coalesce(sum(credits_charged) filter (where segment = 'PREMIUM'), 0),
                  'accounts', count(distinct account_user_id),
                  'leads', count(distinct lead_user_id))
                  from public.internal_lead_unlocks
                 where created_at > now() - make_interval(days => greatest(1, coalesce(p_days, 30)))),
    'candidates', (select jsonb_build_object(
                  'exact', count(*) filter (where category = 'EXACT'),
                  'nearbySimilar', count(*) filter (where category = 'NEARBY_SIMILAR'),
                  'byKind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.internal_match_candidates group by kind) k), '{}'::jsonb),
                  'areasMeasured', (select count(*) from public.internal_match_place_geo))
                  from public.internal_match_candidates),
    'crm', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
              from (select status, count(*) n from public.lead_crm_entries group by status) s));
end $$;
revoke all on function public.admin_internal_leads_overview(integer) from public, anon;
grant execute on function public.admin_internal_leads_overview(integer) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 7 · one re-scan of every active listing, so its candidates are written
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.native_match_property_queue (property_id, reason, enqueued_at)
select p.id, 'MATCH_EXPANSION_V1', now()
  from public.properties p
 where not p.is_deleted and p.archived_at is null and p.matching_status = 'ACTIVE'
on conflict (property_id) do update set reason = excluded.reason, enqueued_at = excluded.enqueued_at;
