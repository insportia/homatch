-- ============================================================================
-- HOMATCH MARKET SEGMENTATION — PREMIUM / MIDDLE / ECONOMY / UNKNOWN,
-- relative to each property's OWN local market.
--
-- The SQL mirror of src/research-core/market/segmentation.ts (the TS module is
-- what a Find Buyers planner calls; this is what the Admin and the owner read).
-- Parity is pinned by src/research-core/__tests__/marketSegmentation.test.mjs
-- (default rule, statistics, confidence constants, street words, place
-- aliases) and exercised by tests/sql/market_segmentation.sql.
--
--   comparables   HOMATCH properties (property_facts) + Find Property
--                 marketplace listings (discovery_marketplace_listings, latest
--                 observation per source listing), deduplicated by URL and by
--                 source listing id
--   market        same transaction (SALE vs RENT, never mixed) and the same
--                 property type family
--   place         STREET → NEIGHBORHOOD → DISTRICT → CITY: the most local
--                 level with at least minComparables comparables
--   currency      USD through public.fx_to_usd(); a price with no known rate
--                 is EXCLUDED (fx_to_usd returns NULL), never converted at 1
--   thresholds    percentile_cont at economyPercentile / premiumPercentile
--   confidence    sample size × dispersion (CV, stddev_pop) × locality
--
-- Every price is an ASKING price from a listing — basis.priceKind = 'ASKING'.
-- None of it is a transaction price.
--
-- Objects
--   tables     market_place_aliases, market_segment_rules,
--              market_segment_rule_audit, property_market_segments
--   helpers    market_norm, market_num, market_place_key, market_street_key,
--              market_transaction_key, market_type_family,
--              market_segment_rules_normalise, market_segment_confidence,
--              market_segment_band, market_comparables, market_segment_eval
--   callable   compute_property_market_segment (owner / admin / service),
--              market_segment_recompute_all (service / admin),
--              admin_market_segment_preview, admin_market_segment_save_draft,
--              admin_market_segment_apply, admin_market_segment_rules,
--              admin_market_segment_areas, admin_property_segments_list
--
-- Additive only. The runner owns the transaction.
-- ============================================================================

/* ── place vocabulary (mirror of src/research-core/normalize/place.ts) ── */

create table if not exists public.market_place_aliases (
  alias     text primary key,
  place_key text not null
);
alter table public.market_place_aliases enable row level security;
drop policy if exists market_place_aliases_admin_read on public.market_place_aliases;
create policy market_place_aliases_admin_read on public.market_place_aliases
  for select to authenticated using (public.is_admin());

insert into public.market_place_aliases (alias, place_key) values
  ('tbilisi', 'tbilisi'), ('თბილისი', 'tbilisi'), ('тбилиси', 'tbilisi'), ('tiflis', 'tbilisi'),
  ('batumi', 'batumi'), ('ბათუმი', 'batumi'), ('батуми', 'batumi'),
  ('kutaisi', 'kutaisi'), ('ქუთაისი', 'kutaisi'), ('кутаиси', 'kutaisi'),
  ('rustavi', 'rustavi'), ('რუსთავი', 'rustavi'), ('рустави', 'rustavi'),
  ('gudauri', 'gudauri'), ('გუდაური', 'gudauri'), ('гудаури', 'gudauri'),
  ('bakuriani', 'bakuriani'), ('ბაკურიანი', 'bakuriani'), ('бакуриани', 'bakuriani'),
  ('chakvi', 'chakvi'), ('ჩაქვი', 'chakvi'), ('чакви', 'chakvi'),
  ('kobuleti', 'kobuleti'), ('ქობულეთი', 'kobuleti'), ('кобулети', 'kobuleti'),
  ('saburtalo', 'saburtalo'), ('საბურთალო', 'saburtalo'), ('сабуртало', 'saburtalo'),
  ('vake', 'vake'), ('ვაკე', 'vake'), ('ваке', 'vake'),
  ('chughureti', 'chughureti'), ('ჩუღურეთი', 'chughureti'), ('чугурети', 'chughureti'),
  ('didube', 'didube'), ('დიდუბე', 'didube'), ('дидубе', 'didube'),
  ('krtsanisi', 'krtsanisi'), ('კრწანისი', 'krtsanisi'), ('крцаниси', 'krtsanisi'),
  ('sololaki', 'sololaki'), ('სოლოლაკი', 'sololaki'), ('сололаки', 'sololaki'),
  ('vera', 'vera'), ('ვერა', 'vera'), ('вера', 'vera'),
  ('digomi', 'digomi'), ('დიღომი', 'digomi'), ('дигоми', 'digomi'),
  ('didi digomi', 'didi digomi'), ('დიდი დიღომი', 'didi digomi'), ('диди дигоми', 'didi digomi'),
  ('gldani', 'gldani'), ('გლდანი', 'gldani'), ('глдани', 'gldani'),
  ('isani', 'isani'), ('ისანი', 'isani'), ('исани', 'isani'),
  ('samgori', 'samgori'), ('სამგორი', 'samgori'), ('самгори', 'samgori'),
  ('mtatsminda', 'mtatsminda'), ('მთაწმინდა', 'mtatsminda'), ('мтацминда', 'mtatsminda'),
  ('nadzaladevi', 'nadzaladevi'), ('ნაძალადევი', 'nadzaladevi'), ('надзаладеви', 'nadzaladevi'),
  ('avlabari', 'avlabari'), ('ავლაბარი', 'avlabari'), ('авлабари', 'avlabari'),
  ('ortachala', 'ortachala'), ('ორთაჭალა', 'ortachala'), ('ортачала', 'ortachala')
on conflict (alias) do update set place_key = excluded.place_key;

/* ── pure helpers ─────────────────────────────────────────────────────── */

create or replace function public.market_norm(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function public.market_num(p text)
returns numeric language sql immutable set search_path = pg_catalog as $$
  select case when p ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then btrim(p)::numeric end
$$;

create or replace function public.market_place_key(p text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce((select a.place_key from public.market_place_aliases a where a.alias = public.market_norm(p)),
                  public.market_norm(p))
$$;

create or replace function public.market_street_key(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(array_to_string(array(
    select t.w
      from regexp_split_to_table(
             regexp_replace(
               regexp_replace(coalesce(public.market_norm(p), ''), '[0-9]+[a-zа-яა-ჰ]?', ' ', 'g'),
               '[.,;:#№/\\()"''«»–—-]+', ' ', 'g'),
             ' ') with ordinality as t(w, i)
     where t.w <> ''
       and not (t.w = any (
         -- STREET_WORDS
         array['ქ', 'ქუჩა', 'გამზ', 'გამზირი', 'ჩიხი', 'შესახვევი',
               'st', 'str', 'street', 'ave', 'avenue', 'rd', 'road', 'lane',
               'ул', 'улица', 'пр', 'проспект', 'пер', 'переулок']))
     order by t.i), ' '), '')
$$;

create or replace function public.market_transaction_key(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when upper(btrim(coalesce(p, ''))) in ('SALE', 'BUY', 'SELL', 'INVESTMENT', 'INVEST', 'PURCHASE') then 'SALE'
    when upper(btrim(coalesce(p, ''))) in ('RENT', 'LEASE', 'RENTAL', 'LONG_TERM_RENT') then 'RENT'
  end
$$;

create or replace function public.market_type_family(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when nullif(btrim(coalesce(p, '')), '') is null then null
    when upper(btrim(p)) in ('APARTMENT', 'FLAT', 'STUDIO', 'PENTHOUSE', 'DUPLEX') then 'APARTMENT'
    when upper(btrim(p)) in ('HOUSE', 'VILLA', 'TOWNHOUSE', 'COTTAGE') then 'HOUSE'
    when upper(btrim(p)) in ('COMMERCIAL', 'OFFICE', 'RETAIL', 'SHOP', 'WAREHOUSE', 'HOTEL') then 'COMMERCIAL'
    when upper(btrim(p)) in ('LAND', 'PLOT') then 'LAND'
    else 'OTHER'
  end
$$;

/* Mirror of normaliseSegmentRules(): bad input falls back to the defaults. */
create or replace function public.market_segment_rules_normalise(p jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_min   int := greatest(3, floor(coalesce(nullif(public.market_num(p->>'minComparables'), 0), 8))::int);
  v_econ  numeric := public.market_num(p->>'economyPercentile');
  v_prem  numeric := public.market_num(p->>'premiumPercentile');
  v_area  numeric := greatest(1, coalesce(nullif(public.market_num(p->>'minAreaSqm'), 0), 10));
  v_given text[];
  v_levels text[];
begin
  if v_econ is null or not (v_econ > 0 and v_econ < 1) then v_econ := 0.3; end if;
  if v_prem is null or not (v_prem > 0 and v_prem < 1) then v_prem := 0.7; end if;
  if v_econ >= v_prem then v_econ := 0.3; v_prem := 0.7; end if;
  if p ? 'levels' and jsonb_typeof(p->'levels') = 'array' then
    select coalesce(array_agg(x), '{}') into v_given from jsonb_array_elements_text(p->'levels') x;
  else
    v_given := array['STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY'];
  end if;
  select coalesce(array_agg(l order by o), '{}') into v_levels
    from unnest(array['STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY']) with ordinality as c(l, o)
   where l = any (v_given);
  return jsonb_build_object('minComparables', v_min, 'premiumPercentile', v_prem, 'economyPercentile', v_econ,
                            'levels', to_jsonb(v_levels), 'minAreaSqm', v_area);
end $$;

create or replace function public.market_segment_confidence(p_n int, p_cv numeric, p_level text, p_min int)
returns numeric language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_cv numeric := coalesce(p_cv, 1);
  v_sample numeric := least(1.0, p_n::numeric / greatest(1, 3 * p_min));
  v_spread numeric;
  v_level numeric;
begin
  v_spread := case when v_cv <= 0.25 then 1.0 when v_cv >= 0.75 then 0.4 else 1 - ((v_cv - 0.25) / 0.5) * 0.6 end;
  v_level := case p_level when 'STREET' then 1.0 when 'NEIGHBORHOOD' then 0.95 when 'DISTRICT' then 0.85 else 0.7 end;
  return round(v_sample * v_spread * v_level, 3);
end $$;

create or replace function public.market_segment_band(p numeric)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when coalesce(p, 0) <= 0 then 'NONE' when p >= 0.7 then 'HIGH' when p >= 0.45 then 'MEDIUM' else 'LOW' end
$$;

/* ── rules, audit, results ────────────────────────────────────────────── */

create table if not exists public.market_segment_rules (
  id           uuid primary key default gen_random_uuid(),
  version      int not null unique,
  params       jsonb not null,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  note         text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  retired_at   timestamptz
);
create unique index if not exists market_segment_rules_one_active
  on public.market_segment_rules ((true)) where status = 'ACTIVE';

insert into public.market_segment_rules (version, params, status, note, activated_at)
select 1,
  -- DEFAULT_RULE_PARAMS
  '{"minComparables":8,"premiumPercentile":0.7,"economyPercentile":0.3,"levels":["STREET","NEIGHBORHOOD","DISTRICT","CITY"],"minAreaSqm":10}'::jsonb,
  'ACTIVE', 'Default rule (matches DEFAULT_SEGMENT_RULES in segmentation.ts).', now()
where not exists (select 1 from public.market_segment_rules);

create table if not exists public.market_segment_rule_audit (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid references public.market_segment_rules(id) on delete set null,
  action        text not null check (action in ('DRAFT_CREATED', 'APPLIED', 'RETIRED', 'RECOMPUTED')),
  actor_user_id uuid references public.users(id) on delete set null,
  params        jsonb,
  before_counts jsonb,
  after_counts  jsonb,
  changed_count int,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists market_segment_rule_audit_created_idx on public.market_segment_rule_audit (created_at desc);

create table if not exists public.property_market_segments (
  property_id      uuid primary key references public.properties(id) on delete cascade,
  segment          text not null check (segment in ('PREMIUM', 'MIDDLE', 'ECONOMY', 'UNKNOWN')),
  confidence       numeric(4,3) not null default 0,
  confidence_band  text not null default 'NONE' check (confidence_band in ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
  level            text check (level in ('STREET', 'NEIGHBORHOOD', 'DISTRICT', 'CITY')),
  sample_size      int not null default 0,
  percentile       numeric(4,3),
  rule_id          uuid references public.market_segment_rules(id) on delete set null,
  version          int not null,
  basis            jsonb not null default '{}'::jsonb,
  computed_at      timestamptz not null default now()
);
create index if not exists property_market_segments_segment_idx on public.property_market_segments (segment, confidence desc);

alter table public.market_segment_rules enable row level security;
alter table public.market_segment_rule_audit enable row level security;
alter table public.property_market_segments enable row level security;

drop policy if exists market_segment_rules_admin_read on public.market_segment_rules;
create policy market_segment_rules_admin_read on public.market_segment_rules
  for select to authenticated using (public.is_admin());
drop policy if exists market_segment_rule_audit_admin_read on public.market_segment_rule_audit;
create policy market_segment_rule_audit_admin_read on public.market_segment_rule_audit
  for select to authenticated using (public.is_admin());
/* An owner reads their own property's segment; an admin reads every row. Writes
   only through the security-definer functions below. */
drop policy if exists property_market_segments_read on public.property_market_segments;
create policy property_market_segments_read on public.property_market_segments
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.properties p
                where p.id = property_market_segments.property_id and p.user_id = public.auth_user_id()));

revoke all on public.market_place_aliases, public.market_segment_rules,
              public.market_segment_rule_audit, public.property_market_segments from anon;
grant select on public.market_place_aliases, public.market_segment_rules,
                public.market_segment_rule_audit, public.property_market_segments to authenticated;

/* ── comparables ──────────────────────────────────────────────────────── */

/*
 * Every comparable, normalised. A HOMATCH property and a marketplace listing
 * of the same advert (same URL, or the same source listing id on the same
 * source) count once — the property wins. Listings keep their latest
 * observation only.
 */
create or replace function public.market_comparables(p_min_area numeric default 10)
returns table (
  comp_key text, property_id uuid, source text, transaction text, type_family text,
  city_key text, district_key text, neighborhood_key text, street_key text,
  ppsqm_local numeric, currency text, ppsqm_usd numeric, observed_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with facts as (
    select distinct on (f.property_id)
           f.property_id, f.city, f.district, f.neighborhood, f.address, f.total_price, f.area,
           f.price_per_sqm, f.currency, f.source_listing_id, f.source_domain,
           lower(coalesce(f.canonical_url, f.source_url)) as url,
           coalesce(f.listing_updated_at, f.updated_at, f.created_at) as observed_at,
           p.transaction_type::text as tx, p.property_type::text as pt
      from public.property_facts f
      join public.properties p on p.id = f.property_id
     where coalesce(p.is_deleted, false) = false and p.archived_at is null
     order by f.property_id, f.updated_at desc nulls last
  ),
  listings as (
    select distinct on (l.source_key, l.source_listing_id)
           l.source_key, l.source_listing_id, l.raw, l.observed_at,
           lower(coalesce(l.raw->>'canonicalUrl', l.exact_url)) as url
      from public.discovery_marketplace_listings l
     order by l.source_key, l.source_listing_id, l.observed_at desc
  ),
  unioned as (
    select 'property:' || f.property_id::text as comp_key, f.property_id, 'HOMATCH'::text as source,
           f.tx as tx, f.pt as pt, f.city, f.district, f.neighborhood, f.address as street,
           case when f.total_price > 0 and f.area >= p_min_area then f.total_price / f.area
                when f.price_per_sqm > 0 then f.price_per_sqm end as ppsqm_local,
           upper(coalesce(nullif(btrim(f.currency), ''), 'USD')) as currency, f.observed_at
      from facts f
    union all
    select 'listing:' || l.source_key || ':' || l.source_listing_id, null::uuid, l.source_key,
           l.raw->>'transactionType', l.raw->>'propertyType', l.raw->>'city', l.raw->>'district',
           l.raw->>'neighborhood', l.raw->>'address',
           case when public.market_num(l.raw->>'price') > 0 and public.market_num(l.raw->>'areaSqm') >= p_min_area
                  then public.market_num(l.raw->>'price') / public.market_num(l.raw->>'areaSqm')
                when public.market_num(l.raw->>'pricePerSqm') > 0 then public.market_num(l.raw->>'pricePerSqm') end,
           upper(coalesce(nullif(btrim(l.raw->>'currency'), ''), 'USD')), l.observed_at
      from listings l
     where not exists (
       select 1 from facts f
        where (f.url is not null and f.url = l.url)
           or (f.source_listing_id is not null and f.source_listing_id = l.source_listing_id
               and replace(lower(coalesce(f.source_domain, '')), '.', '-') = l.source_key))
  )
  select u.comp_key, u.property_id, u.source,
         public.market_transaction_key(u.tx), public.market_type_family(u.pt),
         public.market_place_key(u.city), public.market_place_key(u.district),
         public.market_place_key(u.neighborhood), public.market_street_key(u.street),
         u.ppsqm_local, u.currency,
         case when u.ppsqm_local is null then null else public.fx_to_usd(u.ppsqm_local, u.currency) end,
         u.observed_at
    from unioned u
$$;
revoke all on function public.market_comparables(numeric) from public, anon, authenticated;

/* ── the classifier ───────────────────────────────────────────────────── */

/*
 * Classify HOMATCH properties under `p_params` WITHOUT writing anything.
 * p_property_ids null = every live property that has facts.
 */
create or replace function public.market_segment_eval(p_params jsonb, p_property_ids uuid[] default null)
returns table (
  property_id uuid, segment text, confidence numeric, confidence_band text, level text,
  sample_size int, percentile numeric, basis jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_rules  jsonb := public.market_segment_rules_normalise(p_params);
  v_min    int := (v_rules->>'minComparables')::int;
  v_econ   float8 := (v_rules->>'economyPercentile')::float8;
  v_prem   float8 := (v_rules->>'premiumPercentile')::float8;
  v_area   numeric := (v_rules->>'minAreaSqm')::numeric;
  v_levels text[] := array(select jsonb_array_elements_text(v_rules->'levels'));
begin
  return query
  with comps as materialized (
    select * from public.market_comparables(v_area)
  ),
  subjects as materialized (
    select c.property_id as sid, c.comp_key as skey, c.transaction as stx, c.type_family as sfam,
           c.city_key as scity, c.district_key as sdist, c.neighborhood_key as snb, c.street_key as sstreet,
           c.ppsqm_usd as sx, (c.ppsqm_local is not null and c.ppsqm_usd is null) as snorate
      from comps c
     where c.property_id is not null
       and (p_property_ids is null or c.property_id = any (p_property_ids))
  ),
  attempts as (
    select s.*, l.lvl, l.ord,
           case l.lvl when 'STREET' then s.sstreet when 'NEIGHBORHOOD' then s.snb
                      when 'DISTRICT' then s.sdist else s.scity end as lkey,
           (select array_agg(c.ppsqm_usd::float8 order by c.ppsqm_usd)
              from comps c
             where c.comp_key <> s.skey and c.ppsqm_usd is not null
               and c.transaction = s.stx and c.type_family = s.sfam and c.city_key = s.scity
               and case l.lvl when 'STREET' then c.street_key = s.sstreet
                              when 'NEIGHBORHOOD' then c.neighborhood_key = s.snb
                              when 'DISTRICT' then c.district_key = s.sdist
                              else true end) as vals
      from subjects s
      cross join unnest(v_levels) with ordinality as l(lvl, ord)
  ),
  tried as (
    select a.sid, jsonb_agg(jsonb_build_object(
             'level', a.lvl,
             'key', case when a.lkey is null or a.scity is null then null
                         when a.lvl = 'CITY' then a.scity else a.scity || '|' || a.lkey end,
             'sampleSize', case when a.lkey is null or a.scity is null then 0 else coalesce(cardinality(a.vals), 0) end,
             'sufficient', a.lkey is not null and a.scity is not null and coalesce(cardinality(a.vals), 0) >= v_min)
           order by a.ord) as levels_tried
      from attempts a group by a.sid
  ),
  chosen as (
    select distinct on (a.sid) a.*
      from attempts a
     where a.lkey is not null and a.scity is not null and a.sx is not null
       and coalesce(cardinality(a.vals), 0) >= v_min
     order by a.sid, a.ord
  ),
  stats as (
    select ch.sid, ch.lvl, ch.sx, cardinality(ch.vals) as n,
           round((select percentile_cont(v_econ) within group (order by v) from unnest(ch.vals) v)::numeric, 2) as econ_max,
           round((select percentile_cont(v_prem) within group (order by v) from unnest(ch.vals) v)::numeric, 2) as prem_min,
           round((select percentile_cont(0.5) within group (order by v) from unnest(ch.vals) v)::numeric, 2) as med,
           round((select stddev_pop(v) / nullif(avg(v), 0) from unnest(ch.vals) v)::numeric, 3) as cv,
           round(((select count(*) filter (where v < ch.sx::float8) + count(*) filter (where v = ch.sx::float8) / 2.0
                    from unnest(ch.vals) v) / cardinality(ch.vals))::numeric, 3) as pct
      from chosen ch
  )
  select s.sid,
         case when st.sid is null then 'UNKNOWN'
              when st.sx >= st.prem_min then 'PREMIUM'
              when st.sx <= st.econ_max then 'ECONOMY'
              else 'MIDDLE' end,
         case when st.sid is null then 0 else public.market_segment_confidence(st.n, st.cv, st.lvl, v_min) end,
         public.market_segment_band(case when st.sid is null then 0
                                         else public.market_segment_confidence(st.n, st.cv, st.lvl, v_min) end),
         st.lvl, coalesce(st.n, 0), st.pct,
         jsonb_build_object(
           'priceKind', 'ASKING', 'currency', 'USD',
           'transaction', s.stx, 'propertyType', s.sfam,
           'subjectPricePerSqmUsd', round(s.sx, 2),
           'dispersion', st.cv,
           'thresholds', case when st.sid is null then null else jsonb_build_object(
               'economyMax', st.econ_max, 'premiumMin', st.prem_min, 'median', st.med, 'currency', 'USD') end,
           'levelsTried', coalesce(t.levels_tried, '[]'::jsonb),
           'reason', case
               when s.stx is null then 'NO_TRANSACTION'
               when s.sfam is null then 'NO_PROPERTY_TYPE'
               when s.sx is null and s.snorate then 'SUBJECT_NO_FX_RATE'
               when s.sx is null then 'SUBJECT_NO_PRICE_PER_SQM'
               when s.scity is null then 'NO_CITY'
               when st.sid is null then 'INSUFFICIENT_COMPARABLES'
               else 'CLASSIFIED' end,
           'rules', v_rules)
    from subjects s
    left join stats st on st.sid = s.sid
    left join tried t on t.sid = s.sid;
end $$;
revoke all on function public.market_segment_eval(jsonb, uuid[]) from public, anon, authenticated;

create or replace function public.market_segment_active_rule()
returns public.market_segment_rules language sql stable security definer set search_path = public, pg_temp as $$
  select r.* from public.market_segment_rules r where r.status = 'ACTIVE' limit 1
$$;
revoke all on function public.market_segment_active_rule() from public, anon, authenticated;

/* Write the evaluated rows for some (or all) properties under one rule. */
create or replace function public.market_segment_store(p_rule public.market_segment_rules, p_property_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  insert into public.property_market_segments as pms
    (property_id, segment, confidence, confidence_band, level, sample_size, percentile, rule_id, version, basis, computed_at)
  select e.property_id, e.segment, e.confidence, e.confidence_band, e.level, e.sample_size, e.percentile,
         p_rule.id, p_rule.version, e.basis, now()
    from public.market_segment_eval(p_rule.params, p_property_ids) e
  on conflict (property_id) do update set
    segment = excluded.segment, confidence = excluded.confidence, confidence_band = excluded.confidence_band,
    level = excluded.level, sample_size = excluded.sample_size, percentile = excluded.percentile,
    rule_id = excluded.rule_id, version = excluded.version, basis = excluded.basis, computed_at = excluded.computed_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.market_segment_store(public.market_segment_rules, uuid[]) from public, anon, authenticated;

/* The owner of a property (or an admin, or the service) refreshes its segment. */
create or replace function public.compute_property_market_segment(p_property_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.market_segment_rules;
  v_row  public.property_market_segments;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin()
     and not exists (select 1 from public.properties p where p.id = p_property_id and p.user_id = public.auth_user_id()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_rule := public.market_segment_active_rule();
  if v_rule.id is null then raise exception 'NO_ACTIVE_RULE'; end if;
  perform public.market_segment_store(v_rule, array[p_property_id]);
  select * into v_row from public.property_market_segments where property_id = p_property_id;
  return to_jsonb(v_row);
end $$;
revoke all on function public.compute_property_market_segment(uuid) from public, anon;
grant execute on function public.compute_property_market_segment(uuid) to authenticated, service_role;

/* Every property under the active rule — for a scheduled refresh by the service. */
create or replace function public.market_segment_recompute_all()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rule public.market_segment_rules; v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_rule := public.market_segment_active_rule();
  if v_rule.id is null then raise exception 'NO_ACTIVE_RULE'; end if;
  v_n := public.market_segment_store(v_rule, null);
  insert into public.market_segment_rule_audit (rule_id, action, actor_user_id, params, changed_count, details)
  values (v_rule.id, 'RECOMPUTED', public.auth_user_id(), v_rule.params, null, jsonb_build_object('rows', v_n));
  return v_n;
end $$;
revoke all on function public.market_segment_recompute_all() from public, anon;
grant execute on function public.market_segment_recompute_all() to authenticated, service_role;

/* ── admin: preview → draft → apply ───────────────────────────────────── */

create or replace function public.market_segment_counts(p_rows jsonb)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'PREMIUM', count(*) filter (where r->>'segment' = 'PREMIUM'),
    'MIDDLE',  count(*) filter (where r->>'segment' = 'MIDDLE'),
    'ECONOMY', count(*) filter (where r->>'segment' = 'ECONOMY'),
    'UNKNOWN', count(*) filter (where r->>'segment' = 'UNKNOWN'),
    'UNCOMPUTED', count(*) filter (where r->>'segment' is null))
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
$$;

/*
 * What `p_params` WOULD do, compared with what is stored now. Writes nothing.
 * The confirmation token binds the normalised params to the number of changes,
 * so admin_market_segment_apply refuses an apply whose effect is not the one
 * the admin was shown.
 */
create or replace function public.admin_market_segment_diff(p_params jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rules jsonb := public.market_segment_rules_normalise(p_params);
  v_before jsonb; v_after jsonb; v_changed jsonb; v_changed_count int;
begin
  with ev as (select * from public.market_segment_eval(v_rules, null)),
  joined as (
    select e.property_id, p.homatch_id, s.segment as before_segment, e.segment as after_segment,
           e.level, e.sample_size, e.confidence, e.basis->>'reason' as reason
      from ev e
      join public.properties p on p.id = e.property_id
      left join public.property_market_segments s on s.property_id = e.property_id
  )
  select jsonb_agg(jsonb_build_object('segment', before_segment)),
         jsonb_agg(jsonb_build_object('segment', after_segment)),
         coalesce(jsonb_agg(jsonb_build_object(
             'property_id', property_id, 'homatch_id', homatch_id, 'before', before_segment, 'after', after_segment,
             'level', level, 'sample_size', sample_size, 'confidence', confidence, 'reason', reason)
           order by homatch_id) filter (where before_segment is distinct from after_segment), '[]'::jsonb),
         count(*) filter (where before_segment is distinct from after_segment)
    into v_before, v_after, v_changed, v_changed_count
    from joined;
  return jsonb_build_object(
    'params', v_rules,
    'before', public.market_segment_counts(v_before),
    'after', public.market_segment_counts(v_after),
    'changed_count', coalesce(v_changed_count, 0),
    'changed', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_changed) x limit 200) q),
    'confirmation_token', md5(v_rules::text || ':' || coalesce(v_changed_count, 0)::text));
end $$;
revoke all on function public.admin_market_segment_diff(jsonb) from public, anon, authenticated;

create or replace function public.admin_market_segment_preview(p_params jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  return public.admin_market_segment_diff(p_params);
end $$;
revoke all on function public.admin_market_segment_preview(jsonb) from public, anon;
grant execute on function public.admin_market_segment_preview(jsonb) to authenticated;

create or replace function public.admin_market_segment_save_draft(p_params jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rule public.market_segment_rules;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  insert into public.market_segment_rules (version, params, status, note, created_by)
  values ((select coalesce(max(version), 0) + 1 from public.market_segment_rules),
          public.market_segment_rules_normalise(p_params), 'DRAFT', nullif(btrim(coalesce(p_note, '')), ''),
          public.auth_user_id())
  returning * into v_rule;
  insert into public.market_segment_rule_audit (rule_id, action, actor_user_id, params, details)
  values (v_rule.id, 'DRAFT_CREATED', public.auth_user_id(), v_rule.params, jsonb_build_object('note', v_rule.note));
  return to_jsonb(v_rule);
end $$;
revoke all on function public.admin_market_segment_save_draft(jsonb, text) from public, anon;
grant execute on function public.admin_market_segment_save_draft(jsonb, text) to authenticated;

/*
 * Make a rule ACTIVE and reclassify every property under it.
 *
 * Guarded twice against an accidental mass reclassification: the caller must
 * state how many properties will change (p_expected_changes) and present the
 * confirmation token from the preview of exactly these params. If either
 * disagrees with what the rule would do NOW, nothing is written.
 */
create or replace function public.admin_market_segment_apply(p_rule_id uuid, p_expected_changes int, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.market_segment_rules;
  v_prev public.market_segment_rules;
  v_diff jsonb;
  v_rows int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  select * into v_rule from public.market_segment_rules where id = p_rule_id for update;
  if v_rule.id is null then raise exception 'RULE_NOT_FOUND'; end if;
  if v_rule.status = 'RETIRED' then raise exception 'RULE_RETIRED'; end if;

  v_diff := public.admin_market_segment_diff(v_rule.params);
  if p_expected_changes is null or p_expected_changes <> (v_diff->>'changed_count')::int then
    raise exception 'CONFIRMATION_MISMATCH: expected % change(s), the rule would make %',
      coalesce(p_expected_changes::text, 'null'), v_diff->>'changed_count' using errcode = '22023';
  end if;
  if p_confirmation is null or p_confirmation <> v_diff->>'confirmation_token' then
    raise exception 'CONFIRMATION_MISMATCH: the preview token does not match this rule' using errcode = '22023';
  end if;

  if v_rule.status <> 'ACTIVE' then
    select * into v_prev from public.market_segment_rules where status = 'ACTIVE' for update;
    if v_prev.id is not null then
      update public.market_segment_rules set status = 'RETIRED', retired_at = now() where id = v_prev.id;
      insert into public.market_segment_rule_audit (rule_id, action, actor_user_id, params, details)
      values (v_prev.id, 'RETIRED', public.auth_user_id(), v_prev.params, jsonb_build_object('replaced_by', v_rule.id));
    end if;
    update public.market_segment_rules set status = 'ACTIVE', activated_at = now() where id = v_rule.id
    returning * into v_rule;
  end if;

  v_rows := public.market_segment_store(v_rule, null);
  insert into public.market_segment_rule_audit
    (rule_id, action, actor_user_id, params, before_counts, after_counts, changed_count, details)
  values (v_rule.id, 'APPLIED', public.auth_user_id(), v_rule.params, v_diff->'before', v_diff->'after',
          (v_diff->>'changed_count')::int,
          jsonb_build_object('rows_written', v_rows, 'previous_rule', v_prev.id, 'changed_sample', v_diff->'changed'));
  return jsonb_build_object('rule', to_jsonb(v_rule), 'rows_written', v_rows,
                            'changed_count', (v_diff->>'changed_count')::int,
                            'before', v_diff->'before', 'after', v_diff->'after');
end $$;
revoke all on function public.admin_market_segment_apply(uuid, int, text) from public, anon;
grant execute on function public.admin_market_segment_apply(uuid, int, text) to authenticated;

create or replace function public.admin_market_segment_rules(p_audit_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by r.version desc), '[]'::jsonb) from public.market_segment_rules r),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', a.id, 'rule_id', a.rule_id, 'version', r.version, 'action', a.action,
                'actor', case when u.id is null then null else jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name) end,
                'params', a.params, 'before_counts', a.before_counts, 'after_counts', a.after_counts,
                'changed_count', a.changed_count, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
                from (select * from public.market_segment_rule_audit order by created_at desc
                       limit greatest(1, least(coalesce(p_audit_limit, 50), 200))) a
                left join public.market_segment_rules r on r.id = a.rule_id
                left join public.users u on u.id = a.actor_user_id),
    'stored', (select jsonb_build_object(
                 'PREMIUM', count(*) filter (where segment = 'PREMIUM'),
                 'MIDDLE', count(*) filter (where segment = 'MIDDLE'),
                 'ECONOMY', count(*) filter (where segment = 'ECONOMY'),
                 'UNKNOWN', count(*) filter (where segment = 'UNKNOWN'),
                 'last_computed_at', max(computed_at))
                 from public.property_market_segments));
end $$;
revoke all on function public.admin_market_segment_rules(int) from public, anon;
grant execute on function public.admin_market_segment_rules(int) to authenticated;

/*
 * Thresholds and evidence per area (city, and district within city), per
 * market. `sufficient` is false where an area holds fewer comparables than the
 * rule's minimum — the insufficient-data areas.
 */
create or replace function public.admin_market_segment_areas(p_params jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rules jsonb;
  v_min int; v_econ float8; v_prem float8;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  v_rules := public.market_segment_rules_normalise(coalesce(p_params, (public.market_segment_active_rule()).params, '{}'::jsonb));
  v_min := (v_rules->>'minComparables')::int;
  v_econ := (v_rules->>'economyPercentile')::float8;
  v_prem := (v_rules->>'premiumPercentile')::float8;
  return jsonb_build_object('params', v_rules, 'areas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'level', case when g.district_key is null then 'CITY' else 'DISTRICT' end,
             'transaction', g.transaction, 'property_type', g.type_family,
             'city', g.city_key, 'district', g.district_key,
             'sample_size', g.n, 'sufficient', g.n >= v_min,
             'economy_max', g.econ_max, 'median', g.med, 'premium_min', g.prem_min,
             'dispersion', g.cv, 'no_fx_rate', g.no_rate,
             'confidence', case when g.n >= v_min then public.market_segment_confidence(g.n, g.cv,
                 case when g.district_key is null then 'CITY' else 'DISTRICT' end, v_min) else 0 end,
             'sources', g.sources, 'price_kind', 'ASKING', 'currency', 'USD')
           order by g.city_key, g.district_key nulls first, g.transaction, g.type_family)
      from (
        select c.transaction, c.type_family, c.city_key, c.district_key,
               count(c.ppsqm_usd)::int as n,
               count(*) filter (where c.ppsqm_local is not null and c.ppsqm_usd is null)::int as no_rate,
               round((percentile_cont(v_econ) within group (order by c.ppsqm_usd::float8))::numeric, 2) as econ_max,
               round((percentile_cont(0.5) within group (order by c.ppsqm_usd::float8))::numeric, 2) as med,
               round((percentile_cont(v_prem) within group (order by c.ppsqm_usd::float8))::numeric, 2) as prem_min,
               round((stddev_pop(c.ppsqm_usd) / nullif(avg(c.ppsqm_usd), 0))::numeric, 3) as cv,
               to_jsonb(array_agg(distinct c.source)) as sources
          from public.market_comparables((v_rules->>'minAreaSqm')::numeric) c
         where c.transaction is not null and c.type_family is not null and c.city_key is not null
         group by grouping sets ((c.transaction, c.type_family, c.city_key),
                                 (c.transaction, c.type_family, c.city_key, c.district_key))
        having not (grouping(c.district_key) = 0 and c.district_key is null)
      ) g), '[]'::jsonb));
end $$;
revoke all on function public.admin_market_segment_areas(jsonb) from public, anon;
grant execute on function public.admin_market_segment_areas(jsonb) to authenticated;

/*
 * Properties with their segment, filtered, sorted and paged on the server.
 *
 * p_filters keys (all optional): segments[], confidence[] (HIGH/MEDIUM/LOW/NONE),
 * level, country, city, district, neighborhood, street, property_types[],
 * transaction (SALE/RENT), currency, min_price, max_price, min_ppsqm, max_ppsqm
 * (USD, asking), min_bedrooms, max_bedrooms, min_area, max_area, q (#id/title).
 * Place filters compare canonical place keys, so 'ვაკე', 'Vake' and 'Ваке' agree.
 * Never returns the owner's contact phone.
 */
create or replace function public.admin_property_segments_list(
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'computed_desc',
  p_page int default 1,
  p_page_size int default 25
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_size int := greatest(1, least(coalesce(p_page_size, 25), 100));
  v_page int := greatest(1, coalesce(p_page, 1));
  v_segments text[] := case when jsonb_typeof(f->'segments') = 'array' then array(select upper(jsonb_array_elements_text(f->'segments'))) end;
  v_bands text[] := case when jsonb_typeof(f->'confidence') = 'array' then array(select upper(jsonb_array_elements_text(f->'confidence'))) end;
  v_types text[] := case when jsonb_typeof(f->'property_types') = 'array' then array(select upper(jsonb_array_elements_text(f->'property_types'))) end;
  v_q text := nullif(btrim(coalesce(f->>'q', '')), '');
  v_street text := nullif(btrim(coalesce(f->>'street', '')), '');
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN: admin only' using errcode = '42501'; end if;
  if cardinality(v_segments) = 0 then v_segments := null; end if;
  if cardinality(v_bands) = 0 then v_bands := null; end if;
  if cardinality(v_types) = 0 then v_types := null; end if;

  with base as (
    select p.id, p.homatch_id, p.title, p.transaction_type::text as transaction, p.property_type::text as property_type,
           p.user_id, fx.country_code, fx.city, fx.district, fx.neighborhood, fx.address, fx.total_price, fx.currency,
           fx.area, fx.bedrooms, fx.rooms,
           case when fx.total_price > 0 and fx.area > 0 then round(fx.total_price / fx.area, 2) else fx.price_per_sqm end as ppsqm_local,
           s.segment, s.confidence, s.confidence_band, s.level, s.sample_size, s.percentile, s.version, s.computed_at, s.basis
      from public.properties p
      left join lateral (select * from public.property_facts pf where pf.property_id = p.id
                          order by pf.updated_at desc nulls last limit 1) fx on true
      left join public.property_market_segments s on s.property_id = p.id
     where coalesce(p.is_deleted, false) = false
  ),
  filtered as (
    select b.*, (b.basis->>'subjectPricePerSqmUsd')::numeric as ppsqm_usd
      from base b
     where (v_segments is null or coalesce(b.segment, 'UNCOMPUTED') = any (v_segments))
       and (v_bands is null or coalesce(b.confidence_band, 'NONE') = any (v_bands))
       and (v_types is null or b.property_type = any (v_types)
            or public.market_type_family(b.property_type) = any (v_types))
       and (nullif(f->>'level', '') is null or b.level = upper(f->>'level'))
       and (nullif(f->>'transaction', '') is null
            or public.market_transaction_key(b.transaction) = public.market_transaction_key(f->>'transaction'))
       and (nullif(f->>'country', '') is null or upper(coalesce(b.country_code, 'GE')) = upper(f->>'country'))
       and (nullif(f->>'city', '') is null or public.market_place_key(b.city) = public.market_place_key(f->>'city'))
       and (nullif(f->>'district', '') is null or public.market_place_key(b.district) = public.market_place_key(f->>'district'))
       and (nullif(f->>'neighborhood', '') is null or public.market_place_key(b.neighborhood) = public.market_place_key(f->>'neighborhood'))
       and (v_street is null or b.address ilike '%' || public.homatch_ilike_escape(v_street) || '%' escape '\'
            or public.market_street_key(b.address) = public.market_street_key(v_street))
       and (nullif(f->>'currency', '') is null or upper(coalesce(b.currency, '')) = upper(f->>'currency'))
       and (public.market_num(f->>'min_price') is null or b.total_price >= public.market_num(f->>'min_price'))
       and (public.market_num(f->>'max_price') is null or b.total_price <= public.market_num(f->>'max_price'))
       and (public.market_num(f->>'min_ppsqm') is null or (b.basis->>'subjectPricePerSqmUsd')::numeric >= public.market_num(f->>'min_ppsqm'))
       and (public.market_num(f->>'max_ppsqm') is null or (b.basis->>'subjectPricePerSqmUsd')::numeric <= public.market_num(f->>'max_ppsqm'))
       and (public.market_num(f->>'min_bedrooms') is null or b.bedrooms >= public.market_num(f->>'min_bedrooms'))
       and (public.market_num(f->>'max_bedrooms') is null or b.bedrooms <= public.market_num(f->>'max_bedrooms'))
       and (public.market_num(f->>'min_area') is null or b.area >= public.market_num(f->>'min_area'))
       and (public.market_num(f->>'max_area') is null or b.area <= public.market_num(f->>'max_area'))
       and (v_q is null or b.homatch_id::text = ltrim(v_q, '#')
            or coalesce(b.title, '') ilike '%' || public.homatch_ilike_escape(v_q) || '%' escape '\')
  ),
  counted as (select fl.*, count(*) over () as total from filtered fl),
  paged as (
    select * from counted c
     order by
       case when p_sort = 'price_asc' then c.total_price end asc nulls last,
       case when p_sort = 'price_desc' then c.total_price end desc nulls last,
       case when p_sort = 'ppsqm_asc' then c.ppsqm_usd end asc nulls last,
       case when p_sort = 'ppsqm_desc' then c.ppsqm_usd end desc nulls last,
       case when p_sort = 'confidence_desc' then c.confidence end desc nulls last,
       case when p_sort = 'homatch_id' then c.homatch_id end asc nulls last,
       c.computed_at desc nulls last, c.homatch_id, c.id
     limit v_size offset (v_page - 1) * v_size
  )
  select jsonb_build_object(
    'page', v_page, 'page_size', v_size,
    'total', coalesce((select max(total) from paged), (select count(*) from filtered)),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'property_id', pg.id, 'homatch_id', pg.homatch_id, 'title', pg.title,
      'owner', (select jsonb_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name) from public.users u where u.id = pg.user_id),
      'transaction', pg.transaction, 'property_type', pg.property_type,
      'country', pg.country_code, 'city', pg.city, 'district', pg.district, 'neighborhood', pg.neighborhood, 'street', pg.address,
      'price', pg.total_price, 'currency', pg.currency, 'area', pg.area, 'bedrooms', pg.bedrooms, 'rooms', pg.rooms,
      'price_per_sqm', pg.ppsqm_local, 'price_per_sqm_usd', pg.ppsqm_usd,
      'segment', coalesce(pg.segment, 'UNCOMPUTED'), 'confidence', pg.confidence, 'confidence_band', pg.confidence_band,
      'level', pg.level, 'sample_size', pg.sample_size, 'percentile', pg.percentile, 'version', pg.version,
      'computed_at', pg.computed_at, 'basis', pg.basis)), '[]'::jsonb))
    into v_result
    from paged pg;
  return v_result;
end $$;
revoke all on function public.admin_property_segments_list(jsonb, text, int, int) from public, anon;
grant execute on function public.admin_property_segments_list(jsonb, text, int, int) to authenticated;
