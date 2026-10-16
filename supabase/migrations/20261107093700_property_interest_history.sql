-- Customer property-interest history and multi-interest demand profiles.
--
-- property_interest_events  the append-only timeline: searches, executions, views,
--                           saves, contacts, viewings, paid campaigns, preference
--                           changes, listings. One row per thing that happened.
-- customer_demand_interests one row per DISTINCT interest of a person (side × city ×
--                           property type × budget band). A new interest never
--                           overwrites an older one; each keeps its own counts.
-- saved_property_listings   the customer's saved listings (native or portal).
--
-- Intent basis is explicit on every event:
--   EXPLICIT  the person stated it (a search, a confirmed plan, a listing, a paid campaign)
--   OBSERVED  the person did it (viewed, saved, revealed a contact, asked for a viewing)
--   INFERRED  derived by HOMATCH from other rows; never used to create a match
-- Seller / landlord sides exist ONLY on explicit events (a listing, a declared
-- search for buyers): a CHECK makes "seller inferred from browsing" impossible.
-- Observed behaviour is telemetry, not intent: nothing here creates intent_profiles,
-- subscriptions or matches.
--
-- Minimisation: normalised criteria only — no free text, no contact data, no phone.
-- Retention: admin_settings.interest_history_retention_days (default 730); purging
-- runs only when admin_settings.interest_history_purge_enabled is true (default false).
-- Deletion: delete_my_property_interest_history(); account deletion cascades.
-- Instrumentation triggers never block the source write (exceptions become warnings).
--
-- Rollback: drop the triggers named *_interest_event; the tables are additive.

create table if not exists public.property_interest_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  event_type       text not null check (event_type in (
                     'SEARCH', 'DEMAND_DECLARED', 'PREFERENCE_CHANGED', 'DEMAND_WITHDRAWN',
                     'VIEWED', 'RESULT_OPENED', 'SAVED', 'UNSAVED', 'CONTACT_REVEALED',
                     'VIEWING_REQUESTED', 'PAID_CAMPAIGN_STARTED', 'PROPERTY_LISTED')),
  intent_basis     text not null check (intent_basis in ('EXPLICIT', 'OBSERVED', 'INFERRED')),
  side             text check (side in ('BUY', 'RENT', 'SELL', 'LET')),
  property_id      uuid references public.properties(id) on delete set null,
  listing_key      text check (listing_key is null or length(listing_key) between 1 and 300),
  search_id        uuid,
  discovery_run_id uuid,
  subscription_id  uuid,
  city             text check (city is null or length(city) <= 80),
  districts        text[] not null default '{}',
  property_type    text check (property_type is null or length(property_type) <= 40),
  budget_min       numeric check (budget_min is null or budget_min >= 0),
  budget_max       numeric check (budget_max is null or budget_max >= 0),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  bedrooms_min     integer, bedrooms_max integer, rooms_min integer, rooms_max integer,
  area_min         numeric, area_max numeric,
  source_host      text check (source_host is null or source_host ~ '^[a-z0-9.-]{1,80}$'),
  surface          text not null default 'unknown' check (surface ~ '^[a-z0-9_.-]{1,40}$'),
  provenance       text not null check (provenance in ('TRIGGER', 'CLIENT', 'BACKFILL')),
  dedupe_key       text unique,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  /* Never infer a seller or landlord from behaviour. */
  constraint property_interest_sell_side_explicit check (
    side is null or side in ('BUY', 'RENT')
    or (intent_basis = 'EXPLICIT' and event_type in ('PROPERTY_LISTED', 'DEMAND_DECLARED', 'PREFERENCE_CHANGED', 'DEMAND_WITHDRAWN', 'PAID_CAMPAIGN_STARTED'))),
  constraint property_interest_observed_kinds check (
    intent_basis <> 'OBSERVED' or event_type in ('VIEWED', 'RESULT_OPENED', 'SAVED', 'UNSAVED', 'CONTACT_REVEALED', 'VIEWING_REQUESTED'))
);
comment on table public.property_interest_events is
  'Customer property-interest timeline (append-only). Normalised criteria only. EXPLICIT/OBSERVED/INFERRED basis; seller sides only on explicit events. Own rows readable by the customer; admins through audited RPCs.';
create index if not exists property_interest_events_user_idx on public.property_interest_events (user_id, occurred_at desc);
create index if not exists property_interest_events_type_idx on public.property_interest_events (event_type, occurred_at desc);
create index if not exists property_interest_events_occurred_idx on public.property_interest_events (occurred_at);

create table if not exists public.customer_demand_interests (
  user_id            uuid not null references public.users(id) on delete cascade,
  interest_key       text not null,
  side               text check (side in ('BUY', 'RENT', 'SELL', 'LET')),
  city               text,
  property_type      text,
  budget_band        text not null,
  districts          text[] not null default '{}',
  budget_min         numeric, budget_max numeric, currency text,
  bedrooms_min       integer, bedrooms_max integer, rooms_min integer, rooms_max integer,
  area_min           numeric, area_max numeric,
  explicit_events    integer not null default 0,
  observed_events    integer not null default 0,
  inferred_events    integer not null default 0,
  searches           integer not null default 0,
  declarations       integer not null default 0,
  preference_changes integer not null default 0,
  views              integer not null default 0,
  saves              integer not null default 0,
  contacts           integer not null default 0,
  viewings           integer not null default 0,
  paid_campaigns     integer not null default 0,
  listings           integer not null default 0,
  withdrawn_at       timestamptz,
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  last_event_id      uuid,
  primary key (user_id, interest_key)
);
comment on table public.customer_demand_interests is
  'One row per distinct interest of a customer (side x city x type x budget band). Built only from property_interest_events; strength is computed on read (demand_interest_strength) and explained.';
create index if not exists customer_demand_interests_city_idx on public.customer_demand_interests (city, side);
create index if not exists customer_demand_interests_last_idx on public.customer_demand_interests (last_seen_at desc);

create table if not exists public.saved_property_listings (
  user_id     uuid not null references public.users(id) on delete cascade,
  listing_key text not null check (length(listing_key) between 1 and 300),
  property_id uuid references public.properties(id) on delete set null,
  snapshot    jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object' and length(snapshot::text) <= 4000),
  saved_at    timestamptz not null default now(),
  primary key (user_id, listing_key)
);
comment on table public.saved_property_listings is 'Listings a customer saved (native or portal). Snapshot holds normalised, public listing fields only.';

create table if not exists public.interest_tracking_preferences (
  user_id            uuid primary key references public.users(id) on delete cascade,
  observed_tracking  boolean not null default true,
  updated_at         timestamptz not null default now()
);
comment on table public.interest_tracking_preferences is 'A customer may switch off recording of OBSERVED behaviour (views/opens). Explicit searches remain part of the product they asked for.';

alter table public.property_interest_events enable row level security;
alter table public.customer_demand_interests enable row level security;
alter table public.saved_property_listings enable row level security;
alter table public.interest_tracking_preferences enable row level security;
revoke all on public.property_interest_events, public.customer_demand_interests,
  public.saved_property_listings, public.interest_tracking_preferences from public, anon, authenticated;
grant select on public.property_interest_events, public.customer_demand_interests,
  public.saved_property_listings, public.interest_tracking_preferences to authenticated;
grant select, insert, update, delete on public.property_interest_events, public.customer_demand_interests,
  public.saved_property_listings, public.interest_tracking_preferences to service_role;
drop policy if exists property_interest_events_own on public.property_interest_events;
create policy property_interest_events_own on public.property_interest_events for select to authenticated
  using (user_id = public.current_homatch_user_id());
drop policy if exists customer_demand_interests_own on public.customer_demand_interests;
create policy customer_demand_interests_own on public.customer_demand_interests for select to authenticated
  using (user_id = public.current_homatch_user_id());
drop policy if exists saved_property_listings_own on public.saved_property_listings;
create policy saved_property_listings_own on public.saved_property_listings for select to authenticated
  using (user_id = public.current_homatch_user_id());
drop policy if exists interest_tracking_preferences_own on public.interest_tracking_preferences;
create policy interest_tracking_preferences_own on public.interest_tracking_preferences for select to authenticated
  using (user_id = public.current_homatch_user_id());

insert into public.admin_settings (key, value) values
  ('interest_history_retention_days', '730'::jsonb),
  ('interest_history_purge_enabled', 'false'::jsonb)
on conflict (key) do nothing;

/* ── Normalisation ─────────────────────────────────────────────────────────
 * ka / en / ru spellings of one place resolve to one Latin key. The rows are the
 * PLACES table of src/research-core/normalize/place.ts; a test pins them. */
create or replace function public.interest_canonical_place(p_name text)
returns text language sql immutable parallel safe set search_path = public as $$
  with places(names) as (values
    (array['tbilisi', 'თბილისი', 'тбилиси', 'tiflis']),
    (array['batumi', 'ბათუმი', 'батуми']),
    (array['kutaisi', 'ქუთაისი', 'кутаиси']),
    (array['rustavi', 'რუსთავი', 'рустави']),
    (array['gudauri', 'გუდაური', 'гудаури']),
    (array['bakuriani', 'ბაკურიანი', 'бакуриани']),
    (array['chakvi', 'ჩაქვი', 'чакви']),
    (array['kobuleti', 'ქობულეთი', 'кобулети']),
    (array['saburtalo', 'საბურთალო', 'сабуртало']),
    (array['vake', 'ვაკე', 'ваке']),
    (array['chughureti', 'ჩუღურეთი', 'чугурети']),
    (array['didube', 'დიდუბე', 'дидубе']),
    (array['krtsanisi', 'კრწანისი', 'крцаниси']),
    (array['sololaki', 'სოლოლაკი', 'сололаки']),
    (array['vera', 'ვერა', 'вера']),
    (array['digomi', 'დიღომი', 'дигоми']),
    (array['didi digomi', 'დიდი დიღომი', 'диди дигоми']),
    (array['gldani', 'გლდანი', 'глдани']),
    (array['isani', 'ისანი', 'исани']),
    (array['samgori', 'სამგორი', 'самгори']),
    (array['mtatsminda', 'მთაწმინდა', 'мтацминда']),
    (array['nadzaladevi', 'ნაძალადევი', 'надзаладеви']),
    (array['avlabari', 'ავლაბარი', 'авлабари']),
    (array['ortachala', 'ორთაჭალა', 'ортачала'])
  )
  select coalesce(
    (select names[1] from places where lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) = any (names) limit 1),
    nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')), '')
  )
$$;

/* Budget bands are coarse on purpose: an interest is "Tbilisi flats around $100-200k", not one price. */
create or replace function public.interest_budget_band(p_side text, p_min numeric, p_max numeric, p_currency text)
returns text language sql immutable parallel safe as $$
  select case
    when coalesce(p_max, p_min) is null then 'any'
    when coalesce(p_currency, 'USD') <> 'USD' then 'non_usd'
    when p_side in ('RENT', 'LET') then case
      when coalesce(p_max, p_min) < 500 then 'rent_lt_500'
      when coalesce(p_max, p_min) < 1000 then 'rent_500_1000'
      when coalesce(p_max, p_min) < 2000 then 'rent_1000_2000'
      else 'rent_2000_plus' end
    else case
      when coalesce(p_max, p_min) < 50000 then 'buy_lt_50k'
      when coalesce(p_max, p_min) < 100000 then 'buy_50k_100k'
      when coalesce(p_max, p_min) < 200000 then 'buy_100k_200k'
      when coalesce(p_max, p_min) < 400000 then 'buy_200k_400k'
      else 'buy_400k_plus' end
  end
$$;

create or replace function public.interest_side_from(p_value text, p_owner boolean default false)
returns text language sql immutable parallel safe as $$
  select case upper(coalesce(p_value, ''))
    when 'BUY' then case when p_owner then 'SELL' else 'BUY' end
    when 'SALE' then case when p_owner then 'SELL' else 'BUY' end
    when 'INVESTMENT' then case when p_owner then 'SELL' else 'BUY' end
    when 'INVEST' then case when p_owner then 'SELL' else 'BUY' end
    when 'RENT' then case when p_owner then 'LET' else 'RENT' end
    when 'DAILY_RENT' then case when p_owner then 'LET' else 'RENT' end
    else null end
$$;

/* ── The interest roll-up: every event lands in exactly one interest row. ── */
create or replace function public.property_interest_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_city text := public.interest_canonical_place(new.city);
  v_type text := nullif(upper(coalesce(new.property_type, '')), '');
  v_band text := public.interest_budget_band(new.side, new.budget_min, new.budget_max, new.currency);
  v_key text;
begin
  if new.side is null and v_city is null then return new; end if;
  v_key := coalesce(new.side, 'ANY') || '|' || coalesce(v_city, 'any') || '|' || coalesce(v_type, 'ANY') || '|' || v_band;
  insert into public.customer_demand_interests as i (
    user_id, interest_key, side, city, property_type, budget_band, districts,
    budget_min, budget_max, currency, bedrooms_min, bedrooms_max, rooms_min, rooms_max, area_min, area_max,
    explicit_events, observed_events, inferred_events, searches, declarations, preference_changes,
    views, saves, contacts, viewings, paid_campaigns, listings, withdrawn_at, first_seen_at, last_seen_at, last_event_id)
  values (
    new.user_id, v_key, new.side, v_city, v_type, v_band,
    coalesce((select array_agg(distinct public.interest_canonical_place(d)) from unnest(new.districts) d where btrim(d) <> ''), '{}'),
    new.budget_min, new.budget_max, new.currency, new.bedrooms_min, new.bedrooms_max, new.rooms_min, new.rooms_max, new.area_min, new.area_max,
    (new.intent_basis = 'EXPLICIT')::int, (new.intent_basis = 'OBSERVED')::int, (new.intent_basis = 'INFERRED')::int,
    (new.event_type = 'SEARCH')::int, (new.event_type = 'DEMAND_DECLARED')::int, (new.event_type = 'PREFERENCE_CHANGED')::int,
    (new.event_type in ('VIEWED', 'RESULT_OPENED'))::int, (new.event_type = 'SAVED')::int, (new.event_type = 'CONTACT_REVEALED')::int,
    (new.event_type = 'VIEWING_REQUESTED')::int, (new.event_type = 'PAID_CAMPAIGN_STARTED')::int, (new.event_type = 'PROPERTY_LISTED')::int,
    case when new.event_type = 'DEMAND_WITHDRAWN' then new.occurred_at end,
    new.occurred_at, new.occurred_at, new.id)
  on conflict (user_id, interest_key) do update set
    districts = (select coalesce(array_agg(distinct d), '{}') from unnest(i.districts || excluded.districts) d),
    /* Stated criteria: the latest explicit statement wins; observations never overwrite them. */
    budget_min   = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.budget_min, i.budget_min) else i.budget_min end,
    budget_max   = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.budget_max, i.budget_max) else i.budget_max end,
    currency     = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.currency, i.currency) else i.currency end,
    bedrooms_min = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.bedrooms_min, i.bedrooms_min) else i.bedrooms_min end,
    bedrooms_max = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.bedrooms_max, i.bedrooms_max) else i.bedrooms_max end,
    rooms_min    = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.rooms_min, i.rooms_min) else i.rooms_min end,
    rooms_max    = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.rooms_max, i.rooms_max) else i.rooms_max end,
    area_min     = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.area_min, i.area_min) else i.area_min end,
    area_max     = case when new.intent_basis = 'EXPLICIT' then coalesce(excluded.area_max, i.area_max) else i.area_max end,
    explicit_events    = i.explicit_events + excluded.explicit_events,
    observed_events    = i.observed_events + excluded.observed_events,
    inferred_events    = i.inferred_events + excluded.inferred_events,
    searches           = i.searches + excluded.searches,
    declarations       = i.declarations + excluded.declarations,
    preference_changes = i.preference_changes + excluded.preference_changes,
    views              = i.views + excluded.views,
    saves              = greatest(0, i.saves + excluded.saves - (new.event_type = 'UNSAVED')::int),
    contacts           = i.contacts + excluded.contacts,
    viewings           = i.viewings + excluded.viewings,
    paid_campaigns     = i.paid_campaigns + excluded.paid_campaigns,
    listings           = i.listings + excluded.listings,
    withdrawn_at       = case when new.event_type = 'DEMAND_WITHDRAWN' then new.occurred_at
                              when new.intent_basis = 'EXPLICIT' then null else i.withdrawn_at end,
    first_seen_at      = least(i.first_seen_at, excluded.first_seen_at),
    last_seen_at       = greatest(i.last_seen_at, excluded.last_seen_at),
    last_event_id      = case when excluded.last_seen_at >= i.last_seen_at then excluded.last_event_id else i.last_event_id end;
  return new;
end $$;
drop trigger if exists property_interest_rollup on public.property_interest_events;
create trigger property_interest_rollup after insert on public.property_interest_events
  for each row execute function public.property_interest_rollup();

/*
 * Strength, explained. 0-100 from what the person did, decayed by recency. Every
 * component is returned, so a score is never a number without a reason. No model,
 * no guessed confidence: an interest with only views stays weak by construction.
 */
create or replace function public.demand_interest_strength(i public.customer_demand_interests, p_now timestamptz default now())
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select
      least(25, 25 * least(i.searches + i.declarations, 1) + 5 * greatest(least(i.searches + i.declarations, 3) - 1, 0)) as stated,
      least(10, 5 * i.preference_changes) as refined,
      least(10, 2 * i.views) as viewed,
      least(15, 5 * i.saves) as saved,
      least(20, 10 * (i.contacts + i.viewings)) as contacted,
      least(20, 20 * least(i.paid_campaigns + i.listings, 1)) as committed,
      extract(epoch from (p_now - i.last_seen_at)) / 86400.0 as age_days
  )
  select jsonb_build_object(
    'score', round((least(100, stated + refined + viewed + saved + contacted + committed)
      * case when i.withdrawn_at is not null then 0.25
             when age_days <= 7 then 1 when age_days <= 30 then 0.75 when age_days <= 90 then 0.5 else 0.25 end)::numeric, 0),
    'components', jsonb_build_object('stated', stated, 'refined', refined, 'viewed', viewed, 'saved', saved,
                                     'contacted', contacted, 'committed', committed),
    'freshness', case when i.withdrawn_at is not null then 'WITHDRAWN'
                      when age_days <= 7 then 'ACTIVE' when age_days <= 30 then 'RECENT' when age_days <= 90 then 'COOLING' else 'DORMANT' end,
    'basis', case when i.explicit_events > 0 then 'EXPLICIT' when i.observed_events > 0 then 'OBSERVED' else 'INFERRED' end)
  from c
$$;

/* ── Writers ─────────────────────────────────────────────────────────────── */
create or replace function public.record_interest_event(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.property_interest_events (
    user_id, event_type, intent_basis, side, property_id, listing_key, search_id, discovery_run_id, subscription_id,
    city, districts, property_type, budget_min, budget_max, currency, bedrooms_min, bedrooms_max, rooms_min, rooms_max,
    area_min, area_max, source_host, surface, provenance, dedupe_key, occurred_at)
  values (
    (p->>'user_id')::uuid, p->>'event_type', p->>'intent_basis', p->>'side', nullif(p->>'property_id', '')::uuid,
    left(nullif(p->>'listing_key', ''), 300), nullif(p->>'search_id', '')::uuid, nullif(p->>'discovery_run_id', '')::uuid,
    nullif(p->>'subscription_id', '')::uuid, left(nullif(btrim(p->>'city'), ''), 80),
    coalesce(array(select left(btrim(x), 80) from jsonb_array_elements_text(case when jsonb_typeof(p->'districts') = 'array' then p->'districts' else '[]'::jsonb end) x where btrim(x) <> '' limit 20), '{}'),
    left(nullif(upper(btrim(p->>'property_type')), ''), 40),
    case when (p->>'budget_min') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'budget_min')::numeric end,
    case when (p->>'budget_max') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'budget_max')::numeric end,
    case when upper(p->>'currency') ~ '^[A-Z]{3}$' then upper(p->>'currency') end,
    case when (p->>'bedrooms_min') ~ '^[0-9]{1,2}$' then (p->>'bedrooms_min')::int end,
    case when (p->>'bedrooms_max') ~ '^[0-9]{1,2}$' then (p->>'bedrooms_max')::int end,
    case when (p->>'rooms_min') ~ '^[0-9]{1,2}$' then (p->>'rooms_min')::int end,
    case when (p->>'rooms_max') ~ '^[0-9]{1,2}$' then (p->>'rooms_max')::int end,
    case when (p->>'area_min') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'area_min')::numeric end,
    case when (p->>'area_max') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'area_max')::numeric end,
    case when lower(p->>'source_host') ~ '^[a-z0-9.-]{1,80}$' then lower(p->>'source_host') end,
    coalesce(nullif(p->>'surface', ''), 'unknown'), p->>'provenance', nullif(p->>'dedupe_key', ''),
    coalesce((p->>'occurred_at')::timestamptz, now()))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_interest_event(jsonb) from public, anon, authenticated;
grant execute on function public.record_interest_event(jsonb) to service_role;

/* A free / native search request (marketplace-worker-1 shape) as interest criteria. */
create or replace function public.interest_criteria_from_request(p_request jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'side', public.interest_side_from(p_request->>'transactionType'),
    'city', p_request->>'city',
    'districts', case when jsonb_typeof(p_request->'districts') = 'array' then p_request->'districts' end,
    'property_type', p_request->>'propertyType',
    'budget_min', p_request->>'priceMinUsd', 'budget_max', p_request->>'priceMaxUsd',
    'currency', case when coalesce(p_request->>'priceMinUsd', p_request->>'priceMaxUsd') is not null then 'USD' end,
    'bedrooms_min', p_request#>>'{bedrooms,min}', 'bedrooms_max', p_request#>>'{bedrooms,max}',
    'rooms_min', p_request#>>'{rooms,min}', 'rooms_max', p_request#>>'{rooms,max}',
    'area_min', p_request->>'areaMinSqm', 'area_max', p_request->>'areaMaxSqm'))
$$;

/* A confirmed plan's subscription criteria (Find Property search_criteria) as interest criteria. */
/* Two shapes exist: a confirmed Find Property plan ({city:{value}}, goal/deal, budget.value)
   and the /active-search form ({city, transaction, property_type, budget_max}). */
create or replace function public.interest_criteria_from_subscription(p_criteria jsonb, p_owner boolean)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'side', public.interest_side_from(coalesce(p_criteria->>'goal', p_criteria->>'deal', p_criteria->>'transaction'), p_owner),
    'city', case when jsonb_typeof(p_criteria->'city') = 'object' then p_criteria#>>'{city,value}' else p_criteria->>'city' end,
    'districts', case when jsonb_typeof(p_criteria#>'{districts,value}') = 'array' then p_criteria#>'{districts,value}' end,
    'property_type', coalesce(p_criteria#>>'{propertyTypes,value,0}', p_criteria->>'property_type'),
    'budget_min', coalesce(p_criteria#>>'{budget,value,min}', p_criteria->>'budget_min'),
    'budget_max', coalesce(p_criteria#>>'{budget,value,max}', p_criteria->>'budget_max'),
    'currency', p_criteria#>>'{budget,value,currency}',
    'bedrooms_min', p_criteria#>>'{bedrooms,value,min}', 'bedrooms_max', p_criteria#>>'{bedrooms,value,max}',
    'area_min', p_criteria#>>'{areaSqm,value,min}', 'area_max', p_criteria#>>'{areaSqm,value,max}'))
$$;

/* A HOMATCH property's own facts as interest criteria, for the person acting on it. */
create or replace function public.interest_criteria_from_property(p_property_id uuid, p_owner boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'side', public.interest_side_from(p.transaction_type::text, p_owner),
    'city', f.city, 'districts', case when f.district is not null then jsonb_build_array(f.district) end,
    'property_type', p.property_type::text,
    'budget_min', f.total_price, 'budget_max', f.total_price, 'currency', f.currency,
    'bedrooms_min', f.bedrooms, 'bedrooms_max', f.bedrooms, 'rooms_min', f.rooms, 'rooms_max', f.rooms,
    'area_min', f.area, 'area_max', f.area))
  from public.properties p
  left join lateral (select * from public.property_facts pf where pf.property_id = p.id limit 1) f on true
  where p.id = p_property_id
$$;
revoke all on function public.interest_criteria_from_property(uuid, boolean) from public, anon, authenticated;

/* ── Instrumentation triggers (never block the source write) ─────────────── */
create or replace function public.interest_event_from_search()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.user_id is not null then
      perform public.record_interest_event(public.interest_criteria_from_request(coalesce(new.request, '{}'::jsonb)) || jsonb_build_object(
        'user_id', new.user_id, 'event_type', 'SEARCH', 'intent_basis', 'EXPLICIT', 'search_id', new.id,
        'surface', 'find_property', 'provenance', 'TRIGGER', 'dedupe_key', 'search:' || new.id, 'occurred_at', new.created_at));
    end if;
  exception when others then raise warning 'interest_event_from_search: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists marketplace_search_interest_event on public.discovery_marketplace_searches;
create trigger marketplace_search_interest_event after insert on public.discovery_marketplace_searches
  for each row execute function public.interest_event_from_search();

create or replace function public.interest_event_from_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner boolean; v_type text; v_crit jsonb;
begin
  begin
    /* An owner's subscription carries their property (side differs by surface:
       /active-search writes SUPPLY+property_id, HOMATCH Leads DEMAND+property_id). */
    v_owner := new.property_id is not null;
    v_crit := case when v_owner
                   then public.interest_criteria_from_property(new.property_id, true)
                   else public.interest_criteria_from_subscription(coalesce(new.search_criteria, '{}'::jsonb), false) end;
    if tg_op = 'INSERT' then
      v_type := 'DEMAND_DECLARED';
    elsif old.is_active and not new.is_active then
      v_type := 'DEMAND_WITHDRAWN';
    elsif new.search_criteria is distinct from old.search_criteria or (new.is_active and not old.is_active) then
      v_type := 'PREFERENCE_CHANGED';
    end if;
    if v_type is not null and new.user_id is not null then
      perform public.record_interest_event(coalesce(v_crit, '{}'::jsonb) || jsonb_build_object(
        'user_id', new.user_id, 'event_type', v_type, 'intent_basis', 'EXPLICIT', 'subscription_id', new.id,
        'property_id', new.property_id, 'surface', case when v_owner then 'homatch_leads' else 'find_property' end,
        'provenance', 'TRIGGER',
        'dedupe_key', case when tg_op = 'INSERT' then 'subscription:' || new.id end));
    end if;
  exception when others then raise warning 'interest_event_from_subscription: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists active_search_interest_event on public.active_search_subscriptions;
create trigger active_search_interest_event after insert or update of search_criteria, is_active on public.active_search_subscriptions
  for each row execute function public.interest_event_from_subscription();

create or replace function public.interest_event_from_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_property uuid; v_type text; v_key text;
begin
  begin
    if tg_table_name = 'contact_disclosures' then
      v_user := new.viewer_user_id; v_property := new.property_id; v_type := 'CONTACT_REVEALED'; v_key := 'contact:' || new.id;
    else
      v_user := new.requester_id; v_property := new.property_id; v_type := 'VIEWING_REQUESTED'; v_key := 'viewing:' || new.id;
    end if;
    /* The owner of the property is not a buyer of it. */
    if v_user is not null and not exists (select 1 from public.properties p where p.id = v_property and p.user_id = v_user) then
      perform public.record_interest_event(coalesce(public.interest_criteria_from_property(v_property, false), '{}'::jsonb) || jsonb_build_object(
        'user_id', v_user, 'event_type', v_type, 'intent_basis', 'OBSERVED', 'property_id', v_property,
        'listing_key', case when v_property is not null then 'property:' || v_property end,
        'surface', 'native', 'provenance', 'TRIGGER', 'dedupe_key', v_key, 'occurred_at', new.created_at));
    end if;
  exception when others then raise warning 'interest_event_from_contact: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists contact_disclosure_interest_event on public.contact_disclosures;
create trigger contact_disclosure_interest_event after insert on public.contact_disclosures
  for each row execute function public.interest_event_from_contact();
drop trigger if exists viewing_request_interest_event on public.viewing_requests;
create trigger viewing_request_interest_event after insert on public.viewing_requests
  for each row execute function public.interest_event_from_contact();

create or replace function public.interest_event_from_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.user_id is not null and not coalesce(new.is_deleted, false) then
      perform public.record_interest_event(jsonb_build_object(
        'user_id', new.user_id, 'event_type', 'PROPERTY_LISTED', 'intent_basis', 'EXPLICIT',
        'side', public.interest_side_from(new.transaction_type::text, true),
        'property_id', new.id, 'property_type', new.property_type::text, 'listing_key', 'property:' || new.id,
        'surface', 'owner', 'provenance', 'TRIGGER', 'dedupe_key', 'listed:' || new.id, 'occurred_at', new.created_at));
    end if;
  exception when others then raise warning 'interest_event_from_listing: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists property_listed_interest_event on public.properties;
create trigger property_listed_interest_event after insert on public.properties
  for each row execute function public.interest_event_from_listing();

create or replace function public.interest_event_from_paid_run()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ip record;
begin
  begin
    select transaction_type, city, district, property_types, budget_min, budget_max, currency,
           bedrooms_min, bedrooms_max, rooms_min, rooms_max, area_min, area_max
      into v_ip from public.intent_profiles where id = new.intent_profile_id;
    if new.user_id is not null then
      perform public.record_interest_event(jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id, 'event_type', 'PAID_CAMPAIGN_STARTED', 'intent_basis', 'EXPLICIT',
        'side', public.interest_side_from(v_ip.transaction_type), 'city', v_ip.city,
        'districts', case when v_ip.district is not null then jsonb_build_array(v_ip.district) end,
        'property_type', v_ip.property_types[1], 'budget_min', v_ip.budget_min, 'budget_max', v_ip.budget_max,
        'currency', v_ip.currency, 'bedrooms_min', v_ip.bedrooms_min, 'bedrooms_max', v_ip.bedrooms_max,
        'rooms_min', v_ip.rooms_min, 'rooms_max', v_ip.rooms_max, 'area_min', v_ip.area_min, 'area_max', v_ip.area_max,
        'discovery_run_id', new.id, 'subscription_id', new.subscription_id, 'surface', 'find_property_paid',
        'provenance', 'TRIGGER', 'dedupe_key', 'paidrun:' || new.id, 'occurred_at', new.created_at)));
    end if;
  exception when others then raise warning 'interest_event_from_paid_run: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists discovery_run_interest_event on public.discovery_runs;
create trigger discovery_run_interest_event after insert on public.discovery_runs
  for each row execute function public.interest_event_from_paid_run();

/* ── Customer RPCs ───────────────────────────────────────────────────────── */

/* Views, result opens, saves from the Find Property UI. Own account only; minimised snapshot. */
create or replace function public.record_my_property_interest(
  p_event_type text, p_listing_key text, p_property_id uuid default null, p_search_id uuid default null,
  p_snapshot jsonb default '{}'::jsonb, p_surface text default 'find_property')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_snap jsonb := coalesce(p_snapshot, '{}'::jsonb); v_id uuid; v_crit jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_event_type not in ('VIEWED', 'RESULT_OPENED', 'SAVED', 'UNSAVED') then raise exception 'EVENT_NOT_ALLOWED'; end if;
  if p_listing_key is null or length(p_listing_key) not between 1 and 300 then raise exception 'LISTING_KEY_REQUIRED'; end if;
  if jsonb_typeof(v_snap) <> 'object' or length(v_snap::text) > 4000 then raise exception 'SNAPSHOT_TOO_LARGE'; end if;
  if p_property_id is not null and exists (select 1 from public.properties where id = p_property_id and user_id = v_me) then
    return jsonb_build_object('recorded', false, 'reason', 'OWN_PROPERTY');
  end if;

  if p_event_type in ('SAVED', 'UNSAVED') then
    if p_event_type = 'SAVED' then
      insert into public.saved_property_listings (user_id, listing_key, property_id, snapshot)
      values (v_me, p_listing_key, p_property_id, jsonb_strip_nulls(jsonb_build_object(
        'title', left(v_snap->>'title', 160), 'city', left(v_snap->>'city', 80), 'district', left(v_snap->>'district', 80),
        'price', v_snap->'price', 'currency', left(v_snap->>'currency', 3), 'transaction', left(v_snap->>'transaction', 12),
        'propertyType', left(v_snap->>'propertyType', 40), 'areaSqm', v_snap->'areaSqm', 'rooms', v_snap->'rooms',
        'url', case when v_snap->>'url' ~ '^https://' then left(v_snap->>'url', 500) end,
        'sourceHost', left(lower(v_snap->>'sourceHost'), 80), 'imageUrl', case when v_snap->>'imageUrl' ~ '^https://' then left(v_snap->>'imageUrl', 500) end)))
      on conflict (user_id, listing_key) do nothing;
      if not found then return jsonb_build_object('recorded', false, 'saved', true, 'reason', 'ALREADY_SAVED'); end if;
    else
      delete from public.saved_property_listings where user_id = v_me and listing_key = p_listing_key;
      if not found then return jsonb_build_object('recorded', false, 'saved', false, 'reason', 'NOT_SAVED'); end if;
    end if;
  elsif exists (select 1 from public.interest_tracking_preferences where user_id = v_me and not observed_tracking) then
    return jsonb_build_object('recorded', false, 'reason', 'TRACKING_OFF');
  end if;

  /* Facts of a HOMATCH property are copied only when it is publicly matchable: a draft,
     archived or deleted listing's facts are owner-only and never reach another account. */
  v_crit := case when p_property_id is not null and exists (
                   select 1 from public.properties p where p.id = p_property_id and not p.is_deleted
                      and p.archived_at is null and p.matching_status::text = 'ACTIVE')
                 then public.interest_criteria_from_property(p_property_id, false)
    else jsonb_strip_nulls(jsonb_build_object(
      'side', public.interest_side_from(v_snap->>'transaction'), 'city', v_snap->>'city',
      'districts', case when v_snap->>'district' is not null then jsonb_build_array(v_snap->>'district') end,
      'property_type', v_snap->>'propertyType',
      'budget_min', v_snap->>'price', 'budget_max', v_snap->>'price', 'currency', v_snap->>'currency',
      'rooms_min', v_snap->>'rooms', 'rooms_max', v_snap->>'rooms', 'area_min', v_snap->>'areaSqm', 'area_max', v_snap->>'areaSqm',
      'source_host', v_snap->>'sourceHost')) end;
  v_id := public.record_interest_event(coalesce(v_crit, '{}'::jsonb) || jsonb_build_object(
    'user_id', v_me, 'event_type', p_event_type, 'intent_basis', 'OBSERVED', 'property_id', p_property_id,
    'listing_key', p_listing_key, 'search_id', p_search_id, 'surface', coalesce(nullif(p_surface, ''), 'find_property'),
    'provenance', 'CLIENT',
    /* A view of the same listing counts once per hour: a re-render is not interest. */
    'dedupe_key', case when p_event_type in ('VIEWED', 'RESULT_OPENED')
      then p_event_type || ':' || v_me || ':' || md5(p_listing_key) || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24') end));
  return jsonb_build_object('recorded', v_id is not null, 'saved', case when p_event_type = 'SAVED' then true when p_event_type = 'UNSAVED' then false end);
end $$;
revoke all on function public.record_my_property_interest(text, text, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.record_my_property_interest(text, text, uuid, uuid, jsonb, text) to authenticated;

create or replace function public.my_property_interest_history(p_limit integer default 100, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'user_id' - 'dedupe_key' order by e.occurred_at desc) from (
      select * from public.property_interest_events where user_id = v_me and (p_before is null or occurred_at < p_before)
       order by occurred_at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) e), '[]'::jsonb),
    'interests', coalesce((select jsonb_agg(to_jsonb(i) - 'user_id' || jsonb_build_object('strength', public.demand_interest_strength(i)) order by i.last_seen_at desc)
      from public.customer_demand_interests i where i.user_id = v_me), '[]'::jsonb),
    'saved', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.saved_at desc) from public.saved_property_listings s where s.user_id = v_me), '[]'::jsonb),
    'observedTracking', coalesce((select observed_tracking from public.interest_tracking_preferences where user_id = v_me), true),
    'retentionDays', public.billing_setting_num('interest_history_retention_days', 730));
end $$;
revoke all on function public.my_property_interest_history(integer, timestamptz) from public, anon;
grant execute on function public.my_property_interest_history(integer, timestamptz) to authenticated;

create or replace function public.set_my_interest_tracking(p_observed boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.interest_tracking_preferences (user_id, observed_tracking, updated_at) values (v_me, coalesce(p_observed, true), now())
  on conflict (user_id) do update set observed_tracking = excluded.observed_tracking, updated_at = now();
  return coalesce(p_observed, true);
end $$;
revoke all on function public.set_my_interest_tracking(boolean) from public, anon;
grant execute on function public.set_my_interest_tracking(boolean) to authenticated;

/* The customer's own erasure of their interest history (searches themselves stay where the product keeps them). */
create or replace function public.delete_my_property_interest_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id(); v_e int; v_i int; v_s int;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.property_interest_events where user_id = v_me; get diagnostics v_e = row_count;
  delete from public.customer_demand_interests where user_id = v_me; get diagnostics v_i = row_count;
  delete from public.saved_property_listings where user_id = v_me; get diagnostics v_s = row_count;
  return jsonb_build_object('events', v_e, 'interests', v_i, 'saved', v_s);
end $$;
revoke all on function public.delete_my_property_interest_history() from public, anon;
grant execute on function public.delete_my_property_interest_history() to authenticated;

/* Retention: off unless the owner enables it; never touches anything but expired timeline rows. */
create or replace function public.purge_expired_property_interest()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  if coalesce((select value #>> '{}' from public.admin_settings where key = 'interest_history_purge_enabled'), 'false') <> 'true' then
    return 0;
  end if;
  delete from public.property_interest_events
   where occurred_at < now() - make_interval(days => greatest(30, public.billing_setting_num('interest_history_retention_days', 730)::int));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purge_expired_property_interest() from public, anon, authenticated;
grant execute on function public.purge_expired_property_interest() to service_role;

/* ── Backfill from rows that already exist (insert-only; sources untouched). ── */
insert into public.property_interest_events (
  user_id, event_type, intent_basis, side, search_id, city, districts, property_type, budget_min, budget_max, currency,
  bedrooms_min, bedrooms_max, rooms_min, rooms_max, area_min, area_max, surface, provenance, dedupe_key, occurred_at)
select s.user_id, 'SEARCH', 'EXPLICIT', c->>'side', s.id, left(c->>'city', 80),
       coalesce(array(select left(x, 80) from jsonb_array_elements_text(coalesce(c->'districts', '[]'::jsonb)) x limit 20), '{}'),
       left(upper(c->>'property_type'), 40),
       case when (c->>'budget_min') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'budget_min')::numeric end,
       case when (c->>'budget_max') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'budget_max')::numeric end,
       c->>'currency',
       case when (c->>'bedrooms_min') ~ '^[0-9]{1,2}$' then (c->>'bedrooms_min')::int end,
       case when (c->>'bedrooms_max') ~ '^[0-9]{1,2}$' then (c->>'bedrooms_max')::int end,
       case when (c->>'rooms_min') ~ '^[0-9]{1,2}$' then (c->>'rooms_min')::int end,
       case when (c->>'rooms_max') ~ '^[0-9]{1,2}$' then (c->>'rooms_max')::int end,
       case when (c->>'area_min') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'area_min')::numeric end,
       case when (c->>'area_max') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'area_max')::numeric end,
       'find_property', 'BACKFILL', 'search:' || s.id, s.created_at
  from public.discovery_marketplace_searches s
  cross join lateral (select public.interest_criteria_from_request(coalesce(s.request, '{}'::jsonb)) c) x
 where s.user_id is not null and exists (select 1 from public.users u where u.id = s.user_id)
on conflict (dedupe_key) do nothing;

insert into public.property_interest_events (
  user_id, event_type, intent_basis, side, subscription_id, property_id, city, districts, property_type, budget_min, budget_max,
  currency, bedrooms_min, bedrooms_max, area_min, area_max, surface, provenance, dedupe_key, occurred_at)
select a.user_id, 'DEMAND_DECLARED', 'EXPLICIT', c->>'side', a.id, a.property_id, left(c->>'city', 80),
       coalesce(array(select left(x, 80) from jsonb_array_elements_text(coalesce(c->'districts', '[]'::jsonb)) x limit 20), '{}'),
       left(upper(c->>'property_type'), 40),
       case when (c->>'budget_min') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'budget_min')::numeric end,
       case when (c->>'budget_max') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'budget_max')::numeric end,
       case when upper(c->>'currency') ~ '^[A-Z]{3}$' then upper(c->>'currency') end,
       case when (c->>'bedrooms_min') ~ '^[0-9]{1,2}$' then (c->>'bedrooms_min')::int end,
       case when (c->>'bedrooms_max') ~ '^[0-9]{1,2}$' then (c->>'bedrooms_max')::int end,
       case when (c->>'area_min') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'area_min')::numeric end,
       case when (c->>'area_max') ~ '^[0-9]+(\.[0-9]+)?$' then (c->>'area_max')::numeric end,
       case when a.property_id is not null then 'homatch_leads' else 'find_property' end, 'BACKFILL', 'subscription:' || a.id, a.created_at
  from public.active_search_subscriptions a
  cross join lateral (select case when a.property_id is not null
                                  then public.interest_criteria_from_property(a.property_id, true)
                                  else public.interest_criteria_from_subscription(coalesce(a.search_criteria, '{}'::jsonb), false) end c) x
 where a.user_id is not null
   /* No FK on active_search_subscriptions.property_id: a deleted property must not abort the backfill. */
   and (a.property_id is null or exists (select 1 from public.properties p where p.id = a.property_id))
   and exists (select 1 from public.users u where u.id = a.user_id)
on conflict (dedupe_key) do nothing;

insert into public.property_interest_events (user_id, event_type, intent_basis, side, property_id, property_type, listing_key,
  surface, provenance, dedupe_key, occurred_at)
select p.user_id, 'PROPERTY_LISTED', 'EXPLICIT', public.interest_side_from(p.transaction_type::text, true), p.id,
       p.property_type::text, 'property:' || p.id, 'owner', 'BACKFILL', 'listed:' || p.id, p.created_at
  from public.properties p
 where p.user_id is not null and not p.is_deleted and exists (select 1 from public.users u where u.id = p.user_id)
on conflict (dedupe_key) do nothing;
