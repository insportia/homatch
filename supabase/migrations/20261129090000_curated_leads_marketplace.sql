-- HOMATCH MATCHING WORKSPACE — CURATED INTERNATIONAL LEADS + CONTROLS (owner brief, 2026-10-24)
--
-- The matching workspace sells two products, never mixed:
--   A · HOMATCH Internal Matches — unchanged matching, scoring, pricing and unlock (internal_leads_*).
--       The feed gains country / language / interest / keyword filters and a 100-row page.
--   B · HOMATCH External Leads Database — a SHARED catalog of administrator-imported potential
--       buyers, tenants and investors. One price per lead (CURATED_LEAD, $0.10 = 1 credit at
--       10 credits = $1). A lead never disappears when someone buys it: each account unlocks it
--       once, for itself (curated_lead_unlocks is UNIQUE per account and lead).
--
-- Legacy paid external discovery (Apify / Actor campaigns) is hidden and closed to NEW customer
-- runs by its own service key find_buyers_external (fail-closed, seeded OFF). History stays.
--
--   1 · service controls   internal_matching, curated_leads (live), find_buyers_external (OFF)
--   2 · settings           matching_maintenance_mode = false (owner switches it on by hand)
--   3 · catalog            curated_lead_batches, curated_lead_import_rows, curated_leads
--   4 · entitlements       curated_lead_unlocks, curated_lead_unlock_batches
--   5 · product            CURATED_LEAD (billable_products + finance_services)
--   6 · customer reads     matching_workspace_state, curated_leads_catalog, curated_leads_quote
--   7 · unlock             curated_leads_unlock (service role, via atomic-unlock)
--   8 · CRM                outreach source kinds CURATED_LEAD / INTERNAL_MATCH; save-to-list RPCs
--   9 · admin              import (stage → validate → fix → commit), publish, browse, export,
--                          price, overview, user-uploaded lists (audited)
--  10 · internal feed      internal_leads_feed_v2 + country / language / interest / keyword
--
-- Discovery is not consent. A curated lead reaches a customer's email list as CONSENTED only when
-- its import batch records that the person agreed to receive property offers from HOMATCH partners
-- (legal_basis = CONSENT_PARTNER_OFFERS) and the admin verified the right to disclose it; any
-- other lead is saved with consent UNKNOWN and the existing send rules keep it out of campaigns.

/* ════════════════════════════════════════════════════════════════════════
 * 1 · service controls
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.service_controls drop constraint service_controls_service_key_check;
alter table public.service_controls add constraint service_controls_service_key_check check (service_key in (
  'publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio',
  'find_property', 'find_property_deep', 'find_buyers', 'find_buyers_external',
  'internal_matching', 'curated_leads',
  'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns',
  'ai_assistant',
  'brokers_directory', 'broker_desk', 'developers'));

insert into public.service_controls (service_key, frontend_enabled, backend_enabled, service_group, reason) values
  ('internal_matching',    true,  true,  'discovery', 'Matching workspace: HOMATCH internal matches (owner, 2026-10-24)'),
  ('curated_leads',        true,  true,  'discovery', 'Matching workspace: curated external leads database (owner, 2026-10-24)'),
  ('find_buyers_external', false, false, 'discovery', 'Legacy paid external discovery (Apify / Actor campaigns): hidden, closed to new customer runs (owner, 2026-10-24)')
on conflict (service_key) do nothing;

/* ════════════════════════════════════════════════════════════════════════
 * 2 · maintenance switch (OFF; the owner turns it on by hand from Admin)
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.admin_settings (key, value, updated_at)
values ('matching_maintenance_mode', 'false'::jsonb, now()),
       /* The "Unlocked Leads" entry in the workspace (SHOW). Hiding it never touches ownership:
          purchased contacts stay in the account's email contact manager and readable here. */
       ('matching_unlocked_library_visible', 'true'::jsonb, now())
on conflict (key) do nothing;

/* ════════════════════════════════════════════════════════════════════════
 * 3 · catalog
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.curated_lead_batches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) between 1 and 160),
  file_name          text,
  source_class       text not null default 'OTHER'
                       check (source_class in ('PARTNER', 'EVENT', 'WEB_FORM', 'REFERRAL', 'DIRECTORY', 'OTHER')),
  source_description text,
  acquired_at        date,
  legal_basis        text not null default 'UNVERIFIED'
                       check (legal_basis in ('CONSENT_PARTNER_OFFERS', 'CONSENT_HOMATCH_ONLY', 'LEGITIMATE_INTEREST', 'UNVERIFIED')),
  rights_verified    boolean not null default false,
  rights_verified_by uuid references public.users(id),
  rights_verified_at timestamptz,
  status             text not null default 'STAGING'
                       check (status in ('STAGING', 'COMMITTED', 'ARCHIVED')),
  total_rows         integer not null default 0,
  valid_rows         integer not null default 0,
  invalid_rows       integer not null default 0,
  duplicate_rows     integer not null default 0,
  imported_rows      integer not null default 0,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  committed_at       timestamptz
);
alter table public.curated_lead_batches enable row level security;
revoke all on public.curated_lead_batches from anon, authenticated;
comment on table public.curated_lead_batches is
  'Curated leads: one administrator import (file, source, acquisition date, legal basis, disclosure-rights verification).';

create table if not exists public.curated_leads (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid references public.curated_lead_batches(id) on delete set null,
  first_name          text not null check (length(btrim(first_name)) between 1 and 120),
  last_name           text not null check (length(btrim(last_name)) between 1 and 120),
  email               text not null check (length(email) <= 254),
  email_norm          text not null unique check (email_norm ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  interests           text[] not null check (cardinality(interests) between 1 and 3
                        and interests <@ array['BUY', 'RENT', 'INVEST']::text[]),
  country             text not null check (country ~ '^[A-Z]{2}$'),
  languages           text[] not null default '{}' check (cardinality(languages) <= 8),
  category            text check (category in ('PRIVATE', 'CORPORATE', 'DIASPORA', 'EXPAT', 'OTHER')),
  phone               text check (length(phone) <= 40),
  whatsapp            text check (length(whatsapp) <= 60),
  telegram            text check (length(telegram) <= 120),
  facebook            text check (length(facebook) <= 300),
  linkedin            text check (length(linkedin) <= 300),
  other_social        text check (length(other_social) <= 300),
  city                text check (length(city) <= 120),
  region              text check (length(region) <= 120),
  preferred_location  text check (length(preferred_location) <= 200),
  budget_min          numeric check (budget_min >= 0),
  budget_max          numeric check (budget_max >= 0),
  currency            text check (currency ~ '^[A-Z]{3}$'),
  property_type       text check (length(property_type) <= 80),
  area_min            numeric check (area_min >= 0),
  area_max            numeric check (area_max >= 0),
  rooms_min           numeric check (rooms_min >= 0),
  rooms_max           numeric check (rooms_max >= 0),
  investment_prefs    text check (length(investment_prefs) <= 500),
  description         text check (length(description) <= 600),
  source_description  text check (length(source_description) <= 600),
  collected_at        date,
  last_verified_at    date,
  tags                text[] not null default '{}',
  admin_notes         text check (length(admin_notes) <= 2000),
  status              text not null default 'HIDDEN' check (status in ('HIDDEN', 'PUBLISHED')),
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.curated_leads enable row level security;
revoke all on public.curated_leads from anon, authenticated;
comment on table public.curated_leads is
  'Curated leads: the shared catalog. Never read directly by customers: curated_leads_catalog masks every '
  'contact detail until the caller holds an unlock (curated_lead_unlocks).';
create index if not exists curated_leads_published on public.curated_leads (status, created_at desc, id);
create index if not exists curated_leads_country on public.curated_leads (country) where status = 'PUBLISHED';
create index if not exists curated_leads_interests on public.curated_leads using gin (interests);
create index if not exists curated_leads_languages on public.curated_leads using gin (languages);
create index if not exists curated_leads_batch on public.curated_leads (batch_id);

/* The staging area: every uploaded row, its normalised form, its problems and its fate. */
create table if not exists public.curated_lead_import_rows (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.curated_lead_batches(id) on delete cascade,
  row_no        integer not null,
  raw           jsonb not null default '{}',
  data          jsonb not null default '{}',
  errors        text[] not null default '{}',
  warnings      text[] not null default '{}',
  status        text not null default 'INVALID' check (status in ('VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED')),
  duplicate_of  uuid references public.curated_leads(id) on delete set null,
  duplicate_row integer,
  lead_id       uuid references public.curated_leads(id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (batch_id, row_no)
);
alter table public.curated_lead_import_rows enable row level security;
revoke all on public.curated_lead_import_rows from anon, authenticated;
create index if not exists curated_lead_import_rows_status on public.curated_lead_import_rows (batch_id, status, row_no);

/* ════════════════════════════════════════════════════════════════════════
 * 4 · entitlements
 * ════════════════════════════════════════════════════════════════════════ */

create table if not exists public.curated_lead_unlock_batches (
  id              uuid primary key default gen_random_uuid(),
  account_user_id uuid not null references public.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  unique (account_user_id, idempotency_key)
);
alter table public.curated_lead_unlock_batches enable row level security;
revoke all on public.curated_lead_unlock_batches from anon, authenticated;

create table if not exists public.curated_lead_unlocks (
  id                 uuid primary key default gen_random_uuid(),
  account_user_id    uuid not null references public.users(id) on delete cascade,
  lead_id            uuid not null references public.curated_leads(id),
  unit_price_credits numeric not null,
  credits_charged    numeric not null,
  reservation_id     uuid,
  batch_id           uuid references public.curated_lead_unlock_batches(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (account_user_id, lead_id)
);
alter table public.curated_lead_unlocks enable row level security;
revoke all on public.curated_lead_unlocks from anon, authenticated;
create index if not exists curated_lead_unlocks_lead on public.curated_lead_unlocks (lead_id);
create index if not exists curated_lead_unlocks_account on public.curated_lead_unlocks (account_user_id, created_at desc);

/* ════════════════════════════════════════════════════════════════════════
 * 5 · product
 * ════════════════════════════════════════════════════════════════════════ */

insert into public.billable_products
  (code, name, billing_mode, requires_reservation, standard_retail_cents,
   reference_landed_cogs_cents, min_gross_margin_bps, estimate_strategy,
   enabled, pricing_active, sort_order, config, min_viable_budget_credits)
values
  ('CURATED_LEAD', 'HOMATCH External Leads Database — contact unlock', 'FIXED',
   true, 10, 0, 0, 'PER_UNIT', true, true, 95,
   jsonb_build_object('unit', 'CURATED_LEAD', 'vat_inclusive', true), 0)
on conflict (code) do nothing;

insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note, service_control_key, sort_order)
values ('curated_leads', 'External Leads Database unlocks', '{CURATED_LEAD}', 'fixed_retail_v1', 'FIXED',
        'Per contact: $0.10 (billable_products CURATED_LEAD)', 'curated_leads', 52)
on conflict (service_key) do nothing;

create or replace function public.curated_lead_price()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'credits', round(p.standard_retail_cents * public.billing_setting_num('credits_per_usd', 10) / 100.0, 2),
    'cents', p.standard_retail_cents,
    'active', p.enabled and not p.kill_switch and p.pricing_active)
    from public.billable_products p where p.code = 'CURATED_LEAD'
$$;
revoke all on function public.curated_lead_price() from public, anon;
grant execute on function public.curated_lead_price() to authenticated, service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 6 · customer reads
 * ════════════════════════════════════════════════════════════════════════ */

/* One service flag, honoured the same way the edge gate honours it: an explicit row decides. */
create or replace function public.matching_service_on(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.backend_enabled from public.service_controls s where s.service_key = p_key),
                  p_key not in ('find_buyers_external'))
$$;
revoke all on function public.matching_service_on(text) from public, anon, authenticated;
grant execute on function public.matching_service_on(text) to service_role;

create or replace function public.matching_maintenance_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.value = 'true'::jsonb from public.admin_settings s where s.key = 'matching_maintenance_mode'), false)
$$;
revoke all on function public.matching_maintenance_on() from public, anon, authenticated;
grant execute on function public.matching_maintenance_on() to service_role;

/* What the workspace may show: the three independent switches, plus the curated price. */
create or replace function public.matching_workspace_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'maintenance', public.matching_maintenance_on(),
    'internal', public.matching_service_on('internal_matching')
                and coalesce((select s.frontend_enabled from public.service_controls s where s.service_key = 'internal_matching'), true),
    'curated', public.matching_service_on('curated_leads')
               and coalesce((select s.frontend_enabled from public.service_controls s where s.service_key = 'curated_leads'), true),
    'unlockedLibrary', coalesce((select s.value <> 'false'::jsonb from public.admin_settings s
                                  where s.key = 'matching_unlocked_library_visible'), true),
    'externalDiscovery', public.matching_service_on('find_buyers_external'),
    'curatedPrice', public.curated_lead_price())
$$;
revoke all on function public.matching_workspace_state() from public, anon;
grant execute on function public.matching_workspace_state() to authenticated;

/* The filter every catalog read, quote and unlock shares — one definition, so a count, a page and
   a "select all matching" purchase can never disagree. Codes are upper-cased; languages lower. */
/* One text[] from a filter key (parsed once per call, never per row). */
create or replace function public.curated_filter_arr(f jsonb, k text, p_upper boolean)
returns text[] language sql immutable as $$
  select coalesce(array_agg(case when p_upper then upper(btrim(x)) else lower(btrim(x)) end), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(f->k) = 'array' then f->k else '[]'::jsonb end) x
   where btrim(x) <> ''
$$;
revoke all on function public.curated_filter_arr(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.curated_filter_arr(jsonb, text, boolean) to service_role;

/* The per-row test: a single SQL expression over arguments (no SET, no FROM), so the planner
   inlines it into the calling query — 100k rows filter in milliseconds, not seconds. It is STABLE,
   not IMMUTABLE: concat_ws / array_to_string are STABLE, and a function declared less volatile than
   its body is never inlined (measured on Postgres 17: 2.2 s IMMUTABLE vs 29 ms STABLE at 100k). */
create or replace function public.curated_lead_hit(l public.curated_leads, p_countries text[], p_languages text[], p_interests text[],
  p_channels text[], p_categories text[], p_batches uuid[], p_q text, p_added date, p_verified date, p_location text)
returns boolean language sql stable as $$
  select (cardinality(p_countries) = 0 or l.country = any (p_countries))
    /* Language is its own field: never inferred from country. UNKNOWN = none recorded. */
    and (cardinality(p_languages) = 0 or l.languages && p_languages
         or ('unknown' = any (p_languages) and cardinality(l.languages) = 0))
    /* BUY never returns a tenant unless that person is explicitly both. */
    and (cardinality(p_interests) = 0 or l.interests && p_interests)
    and (cardinality(p_categories) = 0 or l.category = any (p_categories))
    and (p_batches is null or l.batch_id = any (p_batches))
    and (not ('PHONE' = any (p_channels)) or l.phone is not null)
    and (not ('WHATSAPP' = any (p_channels)) or l.whatsapp is not null)
    and (not ('TELEGRAM' = any (p_channels)) or l.telegram is not null)
    and (not ('FACEBOOK' = any (p_channels)) or l.facebook is not null)
    and (not ('LINKEDIN' = any (p_channels)) or l.linkedin is not null)
    and (not ('SOCIAL' = any (p_channels)) or coalesce(l.facebook, l.linkedin, l.other_social, l.telegram) is not null)
    and (p_added is null or l.created_at >= p_added)
    and (p_verified is null or l.last_verified_at >= p_verified)
    and (p_location is null or position(p_location in lower(concat_ws(' ', l.city, l.region, l.preferred_location))) > 0)
    and (p_q is null or position(p_q in lower(concat_ws(' ', l.first_name, l.city, l.region, l.preferred_location,
                                                       l.property_type, l.investment_prefs, l.description,
                                                       array_to_string(l.tags, ' ')))) > 0)
$$;
revoke all on function public.curated_lead_hit(public.curated_leads, text[], text[], text[], text[], text[], uuid[], text, date, date, text) from public, anon, authenticated;
grant execute on function public.curated_lead_hit(public.curated_leads, text[], text[], text[], text[], text[], uuid[], text, date, date, text) to service_role;

/* Every catalog lead matching a filter — the one definition every count, page, quote, purchase
   and export shares, so they can never disagree. */
create or replace function public.curated_filtered(f jsonb)
returns setof public.curated_leads language plpgsql stable security definer set search_path = public as $$
declare
  v_countries text[] := public.curated_filter_arr(f, 'countries', true);
  v_langs text[] := public.curated_filter_arr(f, 'languages', false);
  v_interests text[] := public.curated_filter_arr(f, 'interests', true);
  v_channels text[] := public.curated_filter_arr(f, 'channels', true);
  v_categories text[] := public.curated_filter_arr(f, 'categories', true);
  v_sources text[] := public.curated_filter_arr(f, 'sources', true);
  v_batches uuid[];
  v_q text := nullif(lower(btrim(coalesce(f->>'q', ''))), '');
  v_added date;
  v_verified date;
  v_location text := nullif(lower(btrim(coalesce(f->>'location', ''))), '');
begin
  begin
    v_added := nullif(f->>'addedSince', '')::date;
    v_verified := nullif(f->>'verifiedSince', '')::date;
  exception when others then raise exception 'INVALID_ARGUMENT';
  end;
  if cardinality(v_sources) > 0 then
    select coalesce(array_agg(b.id), '{}') into v_batches from public.curated_lead_batches b where b.source_class = any (v_sources);
  end if;
  return query
    select l.* from public.curated_leads l
     where public.curated_lead_hit(l, v_countries, v_langs, v_interests, v_channels, v_categories, v_batches,
                                   v_q, v_added, v_verified, v_location);
end $$;
revoke all on function public.curated_filtered(jsonb) from public, anon, authenticated;
grant execute on function public.curated_filtered(jsonb) to service_role;

create or replace function public.curated_lead_channels(p_phone text, p_whatsapp text, p_telegram text, p_facebook text,
  p_linkedin text, p_other text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('email', true, 'phone', p_phone is not null, 'whatsapp', p_whatsapp is not null,
    'telegram', p_telegram is not null, 'facebook', p_facebook is not null, 'linkedin', p_linkedin is not null,
    'otherSocial', p_other is not null)
$$;
revoke all on function public.curated_lead_channels(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.curated_lead_channels(text, text, text, text, text, text) to service_role;

/* Before purchase, free text never carries a way to reach the person (the importer refuses it;
   this is the second line of defence). */
create or replace function public.curated_mask_text(t text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(t,
           '[^@\s]+@[^@\s]+', '•••', 'g'),
           '(https?://|www\.)\S+', '•••', 'gi'),
           '\+?[0-9][0-9 ()./-]{7,}[0-9]', '•••', 'g')
$$;
revoke all on function public.curated_mask_text(text) from public, anon, authenticated;
grant execute on function public.curated_mask_text(text) to service_role;

/*
 * curated_leads_catalog — one paginated, server-filtered view of the catalog for the caller.
 *   view AVAILABLE: published leads the caller has NOT unlocked, contacts masked.
 *   view UNLOCKED : leads the caller unlocked (whatever their status now), full contact details.
 * Page sizes 100 / 200 / 500; counts are exact for the same filter. Facets (countries, languages)
 * are computed over the view so every option shows a real count.
 */
create or replace function public.curated_leads_catalog(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_view text := upper(coalesce(nullif(p->>'view', ''), 'AVAILABLE'));
  v_size integer := case when (p->>'pageSize') in ('100', '200', '500') then (p->>'pageSize')::integer else 100 end;
  v_page integer := greatest(1, coalesce(nullif(p->>'page', '')::integer, 1));
  v_sort text := upper(coalesce(nullif(p->>'sort', ''), 'NEWEST'));
  v_f jsonb := coalesce(p->'filters', '{}'::jsonb);
  v_nofilter boolean;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_nofilter := not exists (select 1 from jsonb_each(case when jsonb_typeof(v_f) = 'object' then v_f else '{}'::jsonb end) e
                             where e.value not in ('[]'::jsonb, '""'::jsonb, 'null'::jsonb));
  if v_view not in ('AVAILABLE', 'UNLOCKED') then raise exception 'INVALID_ARGUMENT'; end if;
  /* Sales off (or maintenance) closes the marketplace — never what the account already bought. */
  if v_view = 'AVAILABLE' and (public.matching_maintenance_on() or not public.matching_service_on('curated_leads')) then
    raise exception 'SERVICE_DISABLED' using errcode = 'P0001';
  end if;

  with scope as (
    select l.*, u.created_at as unlocked_at, u.credits_charged
      from public.curated_leads l
      left join public.curated_lead_unlocks u on u.lead_id = l.id and u.account_user_id = v_me
     where (v_view = 'AVAILABLE' and l.status = 'PUBLISHED' and u.id is null)
        or (v_view = 'UNLOCKED' and u.id is not null)
  ), hits as (
    select s.* from scope s where v_nofilter or s.id in (select f.id from public.curated_filtered(v_f) f)
  ), ranked as (
    select h.*, row_number() over (order by
      case when v_sort = 'NAME' then lower(h.first_name || ' ' || h.last_name) end asc nulls last,
      case when v_sort = 'COUNTRY' then h.country end asc nulls last,
      case when v_sort = 'VERIFIED' then h.last_verified_at end desc nulls last,
      case when v_sort = 'UNLOCKED' then h.unlocked_at end desc nulls last,
      h.created_at desc, h.id) as rn
      from hits h
  )
  select jsonb_build_object(
    'view', v_view,
    'page', v_page,
    'pageSize', v_size,
    'total', (select count(*) from hits),
    'counts', jsonb_build_object(
       'available', (select count(*) from public.curated_leads l where l.status = 'PUBLISHED'
                       and not exists (select 1 from public.curated_lead_unlocks u where u.lead_id = l.id and u.account_user_id = v_me)),
       'unlocked', (select count(*) from public.curated_lead_unlocks u where u.account_user_id = v_me)),
    'facets', jsonb_build_object(
       'countries', coalesce((select jsonb_object_agg(c, n) from (select s.country c, count(*) n from scope s group by 1) x), '{}'::jsonb),
       'languages', coalesce((select jsonb_object_agg(lg, n) from (
                      select coalesce(x, 'unknown') lg, count(*) n
                        from scope s left join lateral unnest(nullif(s.languages, '{}'::text[])) x on true group by 1) y), '{}'::jsonb),
       'interests', coalesce((select jsonb_object_agg(i, n) from (select i, count(*) n from scope s, unnest(s.interests) i group by 1) z), '{}'::jsonb)),
    'price', public.curated_lead_price(),
    'items', coalesce((select jsonb_agg(
       case when v_view = 'UNLOCKED' then jsonb_build_object(
         'id', r.id, 'firstName', r.first_name, 'lastName', r.last_name, 'email', r.email,
         'phone', r.phone, 'whatsapp', r.whatsapp, 'telegram', r.telegram, 'facebook', r.facebook,
         'linkedin', r.linkedin, 'otherSocial', r.other_social,
         'country', r.country, 'languages', to_jsonb(r.languages), 'interests', to_jsonb(r.interests),
         'category', r.category, 'city', r.city, 'region', r.region, 'preferredLocation', r.preferred_location,
         'budget', case when r.budget_min is null and r.budget_max is null then null
                        else jsonb_build_object('min', r.budget_min, 'max', r.budget_max, 'currency', r.currency) end,
         'propertyType', r.property_type, 'investmentPrefs', r.investment_prefs, 'description', r.description,
         'addedAt', r.created_at, 'lastVerifiedAt', r.last_verified_at,
         'unlockedAt', r.unlocked_at, 'creditsCharged', r.credits_charged,
         'channels', public.curated_lead_channels(r.phone, r.whatsapp, r.telegram, r.facebook, r.linkedin, r.other_social))
       else jsonb_build_object(
         'id', r.id, 'displayName', r.first_name || ' ' || left(r.last_name, 1) || '.',
         'country', r.country, 'languages', to_jsonb(r.languages), 'interests', to_jsonb(r.interests),
         'category', r.category, 'city', r.city, 'region', r.region,
         'preferredLocation', public.curated_mask_text(r.preferred_location),
         'budget', case when r.budget_min is null and r.budget_max is null then null
                        else jsonb_build_object('min', r.budget_min, 'max', r.budget_max, 'currency', r.currency) end,
         'propertyType', r.property_type, 'investmentPrefs', public.curated_mask_text(r.investment_prefs),
         'description', public.curated_mask_text(r.description),
         'addedAt', r.created_at, 'lastVerifiedAt', r.last_verified_at,
         'channels', public.curated_lead_channels(r.phone, r.whatsapp, r.telegram, r.facebook, r.linkedin, r.other_social)) end
       order by r.rn) from ranked r where r.rn > (v_page - 1) * v_size and r.rn <= v_page * v_size), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.curated_leads_catalog(jsonb) from public, anon;
grant execute on function public.curated_leads_catalog(jsonb) to authenticated;

/*
 * The selection a quote or an unlock acts on. Either explicit ids (individual / page selection) or
 * "everything matching these filters" minus explicit exclusions — resolved on the server, so the
 * browser never holds the database. Only published leads; at most 5,000 per purchase.
 */
create or replace function public.curated_lead_selection(p_user_id uuid, p jsonb)
returns table (lead_id uuid, already boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_ex uuid[];
begin
  begin
    v_ids := array(select (x)::uuid from jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) x);
    v_ex := array(select (x)::uuid from jsonb_array_elements_text(case when jsonb_typeof(p->'exclude') = 'array' then p->'exclude' else '[]'::jsonb end) x);
  exception when others then raise exception 'INVALID_ARGUMENT';
  end;
  if coalesce((p->>'allMatching')::boolean, false) then
    return query
      select f.id, exists (select 1 from public.curated_lead_unlocks u where u.account_user_id = p_user_id and u.lead_id = f.id)
        from public.curated_filtered(coalesce(p->'filters', '{}'::jsonb)) f
       where f.status = 'PUBLISHED' and not (f.id = any (v_ex));
  else
    return query
      select l.id, exists (select 1 from public.curated_lead_unlocks u where u.account_user_id = p_user_id and u.lead_id = l.id)
        from public.curated_leads l
       where l.status = 'PUBLISHED' and l.id = any (v_ids);
  end if;
end $$;
revoke all on function public.curated_lead_selection(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.curated_lead_selection(uuid, jsonb) to service_role;

create or replace function public.curated_leads_quote_for(p_user_id uuid, p jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select * from public.curated_lead_selection(p_user_id, p)), pr as (select public.curated_lead_price() v)
  select jsonb_build_object(
    'selected', (select count(*) from s),
    'alreadyUnlocked', (select count(*) from s where already),
    'newCount', (select count(*) from s where not already),
    'unitCredits', (pr.v->>'credits')::numeric,
    'totalCredits', round((select count(*) from s where not already) * (pr.v->>'credits')::numeric, 2),
    'active', (pr.v->>'active')::boolean,
    'maxPerPurchase', 5000,
    'balance', (select ca.balance from public.credit_accounts ca where ca.user_id = p_user_id))
  from pr
$$;
revoke all on function public.curated_leads_quote_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.curated_leads_quote_for(uuid, jsonb) to service_role;

create or replace function public.curated_leads_quote(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.current_homatch_user_id();
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if public.matching_maintenance_on() or not public.matching_service_on('curated_leads') then
    raise exception 'SERVICE_DISABLED' using errcode = 'P0001';
  end if;
  return public.curated_leads_quote_for(v_me, p);
end $$;
revoke all on function public.curated_leads_quote(jsonb) from public, anon;
grant execute on function public.curated_leads_quote(jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 8 · CRM: outreach source kinds and the save-to-list path (before 7, which uses it)
 * ════════════════════════════════════════════════════════════════════════ */

alter table public.outreach_contacts
  add column if not exists source_curated_lead_id uuid references public.curated_leads(id) on delete set null,
  add column if not exists source_internal_lead_user_id uuid,
  /* A per-language copy made by outreach_list_split_by_language points at the contact it came from. */
  add column if not exists split_from_contact_id uuid references public.outreach_contacts(id) on delete set null;
alter table public.outreach_contacts drop constraint if exists outreach_contacts_source_kind_check;
alter table public.outreach_contacts add constraint outreach_contacts_source_kind_check
  check (source_kind is null or source_kind in ('IMPORT', 'MANUAL', 'FIND_BUYERS', 'CURATED_LEAD', 'INTERNAL_MATCH'));
create unique index if not exists outreach_contacts_curated_per_list
  on public.outreach_contacts (list_id, source_curated_lead_id) where source_curated_lead_id is not null;
create unique index if not exists outreach_contacts_internal_per_list
  on public.outreach_contacts (list_id, source_internal_lead_user_id) where source_internal_lead_user_id is not null;
create index if not exists outreach_contacts_owner_source on public.outreach_contacts (owner_id, source_kind);
create unique index if not exists outreach_contacts_split_per_list
  on public.outreach_contacts (list_id, split_from_contact_id) where split_from_contact_id is not null;

alter table public.outreach_contact_lists
  add column if not exists source_kind text,
  add column if not exists selection_hash text;
alter table public.outreach_contact_lists drop constraint if exists outreach_contact_lists_source_kind_check;
alter table public.outreach_contact_lists add constraint outreach_contact_lists_source_kind_check
  check (source_kind is null or source_kind in ('IMPORT', 'MANUAL', 'FIND_BUYERS', 'CURATED_LEAD', 'INTERNAL_MATCH', 'MIXED'));
create unique index if not exists outreach_contact_lists_selection
  on public.outreach_contact_lists (owner_id, selection_hash) where selection_hash is not null;

/* Contacts imported by a user are user-uploaded: record it from now on. */
update public.outreach_contacts c
   set source_kind = case when (select upper(l.source_format) from public.outreach_contact_lists l where l.id = c.list_id) = 'MANUAL'
                          then 'MANUAL' else 'IMPORT' end
 where c.source_kind is null and c.source_lead_id is null
   and exists (select 1 from public.outreach_contact_lists l where l.id = c.list_id and l.source_format is not null);

/* A list for a source: the owner's standing library list, or a selection list identified by the
   hash of what was selected (re-sending the same selection returns the same list, no duplicates). */
create or replace function public.outreach_source_list(p_auth uuid, p_kind text, p_name text, p_hash text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_list uuid;
begin
  if p_hash is not null then
    select l.id into v_list from public.outreach_contact_lists l where l.owner_id = p_auth and l.selection_hash = p_hash;
  else
    select l.id into v_list from public.outreach_contact_lists l
     where l.owner_id = p_auth and l.source_kind = p_kind and l.selection_hash is null and l.name = p_name
     order by l.created_at limit 1;
  end if;
  if v_list is null then
    insert into public.outreach_contact_lists (owner_id, name, description, import_status, source_kind, selection_hash)
    values (p_auth, left(p_name, 160), p_description, 'READY', p_kind, p_hash)
    on conflict (owner_id, selection_hash) where selection_hash is not null do nothing
    returning id into v_list;
    if v_list is null then
      select l.id into v_list from public.outreach_contact_lists l where l.owner_id = p_auth and l.selection_hash = p_hash;
    end if;
  end if;
  return v_list;
end $$;
revoke all on function public.outreach_source_list(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.outreach_source_list(uuid, text, text, text, text) to service_role;

/* Insert the given curated leads (all already unlocked by p_user_id) into one list. Consent follows
   the batch: CONSENTED only with an explicit partner-offers consent AND verified disclosure rights. */
create or replace function public.curated_leads_into_list(p_user_id uuid, p_list uuid, p_lead_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_auth uuid; v_n integer;
begin
  select u.auth_id into v_auth from public.users u where u.id = p_user_id;
  if v_auth is null then raise exception 'USER_NOT_FOUND'; end if;
  /* The list's phone and e-mail are unique (outreach_send_integrity): a phone already in the list
     (or repeated in this selection) is left off the new row instead of blocking it; an e-mail the
     owner already has in this list keeps their existing contact. */
  insert into public.outreach_contacts
    (list_id, owner_id, full_name, email, email_valid, phone, language, country, city, lead_type, lead_stage,
     consent_status, consent_source, consent_lawful_basis, consent_recorded_at,
     source_kind, source_curated_lead_id, contact_detail_origin, notes, budget_min, budget_max, currency, property_type, tags)
  select p_list, v_auth, x.first_name || ' ' || x.last_name, x.email_norm, true,
         case when x.phone is null or x.phone_rank > 1
                   or exists (select 1 from public.outreach_contacts d where d.list_id = p_list and d.phone = x.phone)
              then null else x.phone end,
         nullif(x.languages[1], ''), x.country, x.city,
         case when 'INVEST' = any (x.interests) and not ('BUY' = any (x.interests)) then 'INVESTOR'
              when x.interests = array['RENT'] then 'TENANT' else 'BUYER' end, 'NEW',
         case when x.consented then 'CONSENTED' else 'UNKNOWN' end,
         'homatch_curated:' || coalesce(x.batch_id::text, 'none'),
         case when x.consented then 'CONSENT' end,
         case when x.consented then now() end,
         'CURATED_LEAD', x.id, 'PERSON_PROVIDED', left(x.description, 2000), x.budget_min, x.budget_max, x.currency,
         x.property_type, array(select 'interest:' || lower(i) from unnest(x.interests) i)
    from (select l.*, (b.legal_basis = 'CONSENT_PARTNER_OFFERS' and coalesce(b.rights_verified, false)) as consented,
                 row_number() over (partition by l.phone order by l.id) as phone_rank
            /* Driven by the given ids, entitlement checked through its index: inside the purchase
               transaction the just-inserted unlocks have no statistics, and a join on them planned
               badly (3,750 leads: 4 s joined, 0.27 s driven — Postgres 17 benchmark, 2026-10-24). */
            from (select distinct unnest(p_lead_ids) as id) sel
            join public.curated_leads l on l.id = sel.id
            left join public.curated_lead_batches b on b.id = l.batch_id
           where exists (select 1 from public.curated_lead_unlocks u where u.account_user_id = p_user_id and u.lead_id = sel.id)
             and not exists (select 1 from public.outreach_contacts d where d.list_id = p_list and d.source_curated_lead_id = sel.id)) x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  update public.outreach_contact_lists l
     set total_rows = (select count(*) from public.outreach_contacts c where c.list_id = l.id),
         valid_rows = (select count(*) from public.outreach_contacts c where c.list_id = l.id and c.email is not null),
         updated_at = now()
   where l.id = p_list;
  return v_n;
end $$;
revoke all on function public.curated_leads_into_list(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.curated_leads_into_list(uuid, uuid, uuid[]) to service_role;

/* "Create email campaign" from the Unlocked library: never charges; only the caller's unlocked
   leads; the same selection always returns the same list. */
create or replace function public.curated_leads_save_to_list(p_lead_ids uuid[], p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_auth uuid := auth.uid();
  v_ids uuid[];
  v_hash text;
  v_list uuid;
  v_added integer;
begin
  if v_me is null or v_auth is null then raise exception 'FORBIDDEN'; end if;
  select array_agg(u.lead_id order by u.lead_id) into v_ids
    from public.curated_lead_unlocks u where u.account_user_id = v_me and u.lead_id = any (coalesce(p_lead_ids, '{}'::uuid[]));
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if cardinality(v_ids) > 5000 then raise exception 'TOO_MANY_SELECTED'; end if;
  v_hash := 'curated:' || md5(array_to_string(v_ids, ','));
  v_list := public.outreach_source_list(v_auth, 'CURATED_LEAD',
              coalesce(nullif(btrim(p_name), ''), 'HOMATCH Curated Leads · ' || to_char(now(), 'YYYY-MM-DD') || ' · ' || cardinality(v_ids)),
              v_hash, 'Contacts unlocked from the HOMATCH External Leads Database.');
  v_added := public.curated_leads_into_list(v_me, v_list, v_ids);
  return jsonb_build_object('listId', v_list, 'contacts', cardinality(v_ids), 'added', v_added);
end $$;
revoke all on function public.curated_leads_save_to_list(uuid[], text) from public, anon;
grant execute on function public.curated_leads_save_to_list(uuid[], text) to authenticated;

/* Internal matches → the caller's email lists. Only members the caller unlocked; a phone or an
   email only where that member chose to share it on unlock; CONSENTED only when the member both
   accepts property offers and shares their email (their own, recorded choice). */
create or replace function public.internal_leads_save_to_list(p_match_ids uuid[], p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_homatch_user_id();
  v_auth uuid := auth.uid();
  v_people uuid[];
  v_hash text;
  v_list uuid;
  v_n integer;
begin
  if v_me is null or v_auth is null then raise exception 'FORBIDDEN'; end if;
  /* Exactly the people internal_lead_contact would show today: entitled, not suspended, not
     blocked either way, accepting property offers. */
  create temporary table if not exists pg_temp.ils_people (lead_user_id uuid, property_id uuid, unlock_id uuid) on commit drop;
  truncate pg_temp.ils_people;
  insert into pg_temp.ils_people
  select distinct on (e.lead_user_id) e.lead_user_id, e.property_id, e.unlock_id
    from unnest(coalesce(p_match_ids, '{}'::uuid[])) m(id)
    cross join lateral public.internal_lead_entitled(v_me, m.id) e
    join public.users u on u.id = e.lead_user_id and u.suspended_at is null
   where (select pr.accept_property_offers from public.lead_contact_prefs_of(e.lead_user_id) pr)
     and not exists (select 1 from public.conversation_blocks b
                      where (b.blocker_id = e.lead_user_id and b.blocked_id = v_me)
                         or (b.blocker_id = v_me and b.blocked_id = e.lead_user_id));
  select array_agg(lead_user_id order by lead_user_id) into v_people from pg_temp.ils_people;
  if coalesce(cardinality(v_people), 0) = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if cardinality(v_people) > 2000 then raise exception 'TOO_MANY_SELECTED'; end if;
  v_hash := 'internal:' || md5(array_to_string(v_people, ','));
  v_list := public.outreach_source_list(v_auth, 'INTERNAL_MATCH',
              coalesce(nullif(btrim(p_name), ''), 'HOMATCH Internal Matches · ' || to_char(now(), 'YYYY-MM-DD') || ' · ' || cardinality(v_people)),
              v_hash, 'Members unlocked from HOMATCH internal matches.');
  insert into public.outreach_contacts
    (list_id, owner_id, full_name, email, email_valid, phone, language, lead_type, lead_stage,
     consent_status, consent_source, consent_lawful_basis, consent_recorded_at,
     source_kind, source_internal_lead_user_id, contact_detail_origin)
  select v_list, v_auth, coalesce(nullif(u.nickname, ''), nullif(split_part(coalesce(u.full_name, ''), ' ', 1), ''), 'HOMATCH member'),
         case when pr.share_email_on_unlock then lower(u.email) end,
         pr.share_email_on_unlock and u.email is not null,
         case when pr.share_phone_on_unlock and length(coalesce(u.phone, '')) > 4
                   and not exists (select 1 from public.outreach_contacts d where d.list_id = v_list and d.phone = u.phone)
              then u.phone end,
         u.preferred_language, 'UNKNOWN', 'NEW',
         /* Marketing e-mail only with the member's own marketing consent (internal_lead_contact.marketingEmail). */
         case when pr.share_email_on_unlock and pr.accept_marketing_email and u.email is not null then 'CONSENTED' else 'UNKNOWN' end,
         'homatch_internal_match',
         case when pr.share_email_on_unlock and pr.accept_marketing_email and u.email is not null then 'CONSENT' end,
         case when pr.share_email_on_unlock and pr.accept_marketing_email and u.email is not null then now() end,
         'INTERNAL_MATCH', u.id, 'PERSON_PROVIDED'
    from pg_temp.ils_people p
    join public.users u on u.id = p.lead_user_id
    cross join lateral public.lead_contact_prefs_of(u.id) pr
   where not exists (select 1 from public.outreach_contacts d where d.list_id = v_list and d.source_internal_lead_user_id = u.id)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  /* A phone handed over is a disclosure, recorded like internal_lead_contact records it. */
  insert into public.contact_disclosures (viewer_user_id, subject_user_id, property_id, relationship_kind, relationship_id)
  select v_me, p.lead_user_id, p.property_id, 'INTERNAL_LEAD_UNLOCK', p.unlock_id
    from pg_temp.ils_people p
    join public.outreach_contacts c on c.list_id = v_list and c.source_internal_lead_user_id = p.lead_user_id and c.phone is not null;
  update public.outreach_contact_lists l
     set total_rows = (select count(*) from public.outreach_contacts c where c.list_id = l.id),
         valid_rows = (select count(*) from public.outreach_contacts c where c.list_id = l.id and c.email is not null),
         updated_at = now()
   where l.id = v_list;
  return jsonb_build_object('listId', v_list, 'contacts', cardinality(v_people), 'added', v_n);
end $$;
revoke all on function public.internal_leads_save_to_list(uuid[], text) from public, anon;
grant execute on function public.internal_leads_save_to_list(uuid[], text) to authenticated;

/* A member's later choice wins over a copy in someone's list: withdrawing sharing removes that
   detail, withdrawing offers or marketing consent stops campaigns to them. */
create or replace function public.internal_match_contacts_resync(p_lead_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pr record;
begin
  select * into v_pr from public.lead_contact_prefs_of(p_lead_user);
  update public.outreach_contacts c set
    email = case when v_pr.share_email_on_unlock then c.email end,
    email_valid = v_pr.share_email_on_unlock and c.email is not null,
    phone = case when v_pr.share_phone_on_unlock then c.phone end,
    do_not_contact = case when not v_pr.accept_property_offers then true else c.do_not_contact end,
    /* The member's own consent, in both directions (an opt-out recorded on the contact still wins at send time). */
    consent_status = case when c.consent_source <> 'homatch_internal_match' then c.consent_status
                          when v_pr.share_email_on_unlock and v_pr.accept_marketing_email and c.email is not null then 'CONSENTED'
                          else 'UNKNOWN' end,
    consent_lawful_basis = case when c.consent_source <> 'homatch_internal_match' then c.consent_lawful_basis
                                when v_pr.share_email_on_unlock and v_pr.accept_marketing_email and c.email is not null then 'CONSENT'
                                else null end,
    updated_at = now()
   where c.source_internal_lead_user_id = p_lead_user;
end $$;
revoke all on function public.internal_match_contacts_resync(uuid) from public, anon, authenticated;
grant execute on function public.internal_match_contacts_resync(uuid) to service_role;

create or replace function public.internal_match_contacts_on_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.internal_match_contacts_resync(new.user_id);
  return new;
end $$;
revoke all on function public.internal_match_contacts_on_prefs() from public, anon, authenticated;
grant execute on function public.internal_match_contacts_on_prefs() to service_role;
drop trigger if exists internal_match_contacts_on_prefs on public.lead_contact_preferences;
create trigger internal_match_contacts_on_prefs after insert or update on public.lead_contact_preferences
  for each row execute function public.internal_match_contacts_on_prefs();

/* A block either way: the owner's copies of that member stop receiving anything. */
create or replace function public.internal_match_contacts_on_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.outreach_contacts c set do_not_contact = true, updated_at = now()
   where c.source_internal_lead_user_id in (new.blocker_id, new.blocked_id)
     and c.owner_id in (select u.auth_id from public.users u where u.id in (new.blocker_id, new.blocked_id));
  return new;
end $$;
revoke all on function public.internal_match_contacts_on_block() from public, anon, authenticated;
grant execute on function public.internal_match_contacts_on_block() to service_role;
drop trigger if exists internal_match_contacts_on_block on public.conversation_blocks;
create trigger internal_match_contacts_on_block after insert on public.conversation_blocks
  for each row execute function public.internal_match_contacts_on_block();

/* ════════════════════════════════════════════════════════════════════════
 * 7 · unlock — one transaction, advisory lock per account, idempotency key, never charges a lead
 *     the account already holds, all-or-nothing; the unlocked contacts land in the account's
 *     standing "HOMATCH Curated Leads" email list in the same transaction.
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.curated_leads_unlock(p_user_id uuid, p jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing jsonb;
  v_price jsonb;
  v_unit numeric;
  v_batch uuid := gen_random_uuid();
  v_new uuid[];
  v_already integer;
  v_n integer;
  v_total numeric := 0;
  v_res uuid;
  v_balance numeric;
  v_expected numeric := nullif(p->>'expectedCredits', '')::numeric;
  v_auth uuid;
  v_list uuid;
  v_granted integer;
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_user_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if v_expected is null then raise exception 'PRICE_CHANGED'; end if;
  if public.matching_maintenance_on() or not public.matching_service_on('curated_leads') then raise exception 'SERVICE_DISABLED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('curated_lead_unlock:' || p_user_id::text, 0));

  select b.result into v_existing from public.curated_lead_unlock_batches b
   where b.account_user_id = p_user_id and b.idempotency_key = p_idempotency_key;
  if found then return v_existing || jsonb_build_object('duplicate', true); end if;

  v_price := public.curated_lead_price();
  if v_price is null or not coalesce((v_price->>'active')::boolean, false) then raise exception 'PRODUCT_DISABLED'; end if;
  v_unit := (v_price->>'credits')::numeric;

  select coalesce(array_agg(s.lead_id) filter (where not s.already), '{}'), count(*) filter (where s.already)
    into v_new, v_already
    from public.curated_lead_selection(p_user_id, p) s;
  v_n := cardinality(v_new);
  if v_n + v_already = 0 then raise exception 'NOTHING_SELECTED'; end if;
  if v_n > 5000 then raise exception 'TOO_MANY_SELECTED'; end if;
  v_total := round(v_unit * v_n, 4);
  /* The customer confirmed a price: a selection that grew since the quote is not silently charged. */
  if v_total > v_expected then raise exception 'PRICE_CHANGED'; end if;

  if v_total > 0 then
    select r.reservation_id into v_res
      from public.wallet_reserve(p_user_id, 'CURATED_LEAD', v_total,
                                 'curated-leads:' || p_user_id::text || ':' || p_idempotency_key,
                                 v_total, v_total, 'curated-leads:' || v_batch::text,
                                 jsonb_build_object('units', v_n, 'unit_credits', v_unit, 'batch_id', v_batch)) r;
    perform public.wallet_settle(v_res, v_total,
                                 jsonb_build_object('units', v_n, 'unit_credits', v_unit, 'landed_cogs_cents', 0,
                                                    'cogs_basis', 'NO_MARGINAL_COGS'), 'SUCCESS');
  end if;

  insert into public.curated_lead_unlock_batches (id, account_user_id, idempotency_key, result)
  values (v_batch, p_user_id, p_idempotency_key, '{}'::jsonb);

  insert into public.curated_lead_unlocks (account_user_id, lead_id, unit_price_credits, credits_charged, reservation_id, batch_id)
  select p_user_id, x, v_unit, v_unit, v_res, v_batch from unnest(v_new) x
  on conflict (account_user_id, lead_id) do nothing;
  /* Defence in depth: never a charge for a lead that was not granted (the lock makes this unreachable). */
  get diagnostics v_granted = row_count;
  if v_granted <> v_n then raise exception 'UNLOCK_MISMATCH'; end if;

  if v_n > 0 then
    select u.auth_id into v_auth from public.users u where u.id = p_user_id;
    v_list := public.outreach_source_list(v_auth, 'CURATED_LEAD', 'HOMATCH Curated Leads', null,
                'Every contact you unlocked from the HOMATCH External Leads Database.');
    perform public.curated_leads_into_list(p_user_id, v_list, v_new);
  end if;

  select ca.balance into v_balance from public.credit_accounts ca where ca.user_id = p_user_id;
  v_result := jsonb_build_object(
    'batchId', v_batch,
    'unlocked', to_jsonb(v_new),
    'unlockedCount', v_n,
    'alreadyUnlocked', v_already,
    'chargedCredits', v_total,
    'unitCredits', v_unit,
    'reservationId', v_res,
    'balanceAfter', v_balance,
    'listId', v_list,
    'duplicate', false);
  update public.curated_lead_unlock_batches set result = v_result where id = v_batch;
  return v_result;
end $$;
revoke all on function public.curated_leads_unlock(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.curated_leads_unlock(uuid, jsonb, text) to service_role;

/* ════════════════════════════════════════════════════════════════════════
 * 9 · admin
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.curated_admin_guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := public.current_homatch_user_id();
begin
  if v_admin is null or not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return v_admin;
end $$;
revoke all on function public.curated_admin_guard() from public, anon, authenticated;
grant execute on function public.curated_admin_guard() to service_role;

create or replace function public.admin_curated_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.curated_admin_guard();
  return jsonb_build_object(
    'total', (select count(*) from public.curated_leads),
    'published', (select count(*) from public.curated_leads where status = 'PUBLISHED'),
    'hidden', (select count(*) from public.curated_leads where status = 'HIDDEN'),
    'unverifiedRights', (select count(*) from public.curated_leads l left join public.curated_lead_batches b on b.id = l.batch_id
                          where not coalesce(b.rights_verified, false)),
    'countries', (select count(distinct country) from public.curated_leads),
    'languages', (select count(distinct x) from public.curated_leads, unnest(languages) x),
    'unlocks', (select count(*) from public.curated_lead_unlocks),
    'buyers', (select count(distinct account_user_id) from public.curated_lead_unlocks),
    'revenueCredits', (select coalesce(sum(credits_charged), 0) from public.curated_lead_unlocks),
    'revenueUsd', round((select coalesce(sum(credits_charged), 0) from public.curated_lead_unlocks)
                        / nullif(public.billing_setting_num('credits_per_usd', 10), 0), 2),
    'price', public.curated_lead_price(),
    'maintenance', public.matching_maintenance_on(),
    'controls', (select coalesce(jsonb_object_agg(s.service_key, jsonb_build_object(
                    'frontend', s.frontend_enabled, 'backend', s.backend_enabled, 'version', s.version)), '{}'::jsonb)
                   from public.service_controls s
                  where s.service_key in ('internal_matching', 'curated_leads', 'find_buyers_external', 'find_buyers')),
    'recentBatches', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (
        select id, name, file_name, status, source_class, legal_basis, rights_verified, total_rows, valid_rows,
               invalid_rows, duplicate_rows, imported_rows, created_at, committed_at
          from public.curated_lead_batches order by created_at desc limit 8) b), '[]'::jsonb));
end $$;
revoke all on function public.admin_curated_overview() from public, anon;
grant execute on function public.admin_curated_overview() to authenticated;

create or replace function public.admin_curated_batches(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 50), 1), 200);
        v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
begin
  perform public.curated_admin_guard();
  return jsonb_build_object(
    'total', (select count(*) from public.curated_lead_batches),
    'items', coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object(
        'published', (select count(*) from public.curated_leads l where l.batch_id = b.id and l.status = 'PUBLISHED'),
        'leads', (select count(*) from public.curated_leads l where l.batch_id = b.id),
        'createdByEmail', (select u.email from public.users u where u.id = b.created_by)) order by b.created_at desc)
      from (select * from public.curated_lead_batches order by created_at desc offset v_offset limit v_limit) b), '[]'::jsonb));
end $$;
revoke all on function public.admin_curated_batches(jsonb) from public, anon;
grant execute on function public.admin_curated_batches(jsonb) to authenticated;

create or replace function public.admin_curated_batch_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.curated_admin_guard();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_verified boolean := coalesce((p->>'rightsVerified')::boolean, false);
  v_row public.curated_lead_batches;
begin
  if v_id is null then
    insert into public.curated_lead_batches (name, file_name, source_class, source_description, acquired_at, legal_basis,
                                             rights_verified, rights_verified_by, rights_verified_at, notes, created_by)
    values (btrim(p->>'name'), nullif(p->>'fileName', ''), coalesce(nullif(upper(p->>'sourceClass'), ''), 'OTHER'),
            nullif(p->>'sourceDescription', ''), nullif(p->>'acquiredAt', '')::date,
            coalesce(nullif(upper(p->>'legalBasis'), ''), 'UNVERIFIED'),
            v_verified, case when v_verified then v_admin end, case when v_verified then now() end,
            nullif(p->>'notes', ''), v_admin)
    returning * into v_row;
  else
    update public.curated_lead_batches b set
      name = coalesce(nullif(btrim(p->>'name'), ''), b.name),
      source_class = coalesce(nullif(upper(p->>'sourceClass'), ''), b.source_class),
      source_description = case when p ? 'sourceDescription' then nullif(p->>'sourceDescription', '') else b.source_description end,
      acquired_at = case when p ? 'acquiredAt' then nullif(p->>'acquiredAt', '')::date else b.acquired_at end,
      legal_basis = coalesce(nullif(upper(p->>'legalBasis'), ''), b.legal_basis),
      rights_verified = case when p ? 'rightsVerified' then v_verified else b.rights_verified end,
      rights_verified_by = case when p ? 'rightsVerified' then case when v_verified then v_admin end else b.rights_verified_by end,
      rights_verified_at = case when p ? 'rightsVerified' then case when v_verified then now() end else b.rights_verified_at end,
      status = case when upper(coalesce(p->>'status', '')) = 'ARCHIVED' then 'ARCHIVED' else b.status end,
      notes = case when p ? 'notes' then nullif(p->>'notes', '') else b.notes end,
      updated_at = now()
     where b.id = v_id returning * into v_row;
    if not found then raise exception 'NOT_FOUND'; end if;
    /* Rights withdrawn → nothing of this batch stays on sale. */
    if not v_row.rights_verified or v_row.status = 'ARCHIVED' then
      update public.curated_leads set status = 'HIDDEN', updated_at = now() where batch_id = v_id and status = 'PUBLISHED';
    end if;
  end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, case when v_id is null then 'CURATED_BATCH_CREATE' else 'CURATED_BATCH_UPDATE' end,
          'curated_lead_batches', v_row.id::text, p - 'rows');
  return to_jsonb(v_row);
end $$;
revoke all on function public.admin_curated_batch_save(jsonb) from public, anon;
grant execute on function public.admin_curated_batch_save(jsonb) to authenticated;

/* Normalise one row. Interest synonyms in six languages; country must already be ISO-2 (the
   browser maps names in any language to codes, the server checks); languages ISO-639 codes. */
create or replace function public.curated_normalise_row(r jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(r->>'email', '')));
  v_interests text[] := '{}';
  v_tok text;
  v_langs text[] := '{}';
  v_errors text[] := '{}';
  v_warn text[] := '{}';
  v_country text := upper(btrim(coalesce(r->>'country', '')));
  v_out jsonb;
  v_num text;
begin
  foreach v_tok in array regexp_split_to_array(lower(coalesce(r->>'interests', r->>'interest', '')), '\s*[,;/|+]\s*|\s+and\s+|\s*&\s*') loop
    v_tok := btrim(v_tok);
    continue when v_tok = '';
    if v_tok in ('buy', 'buyer', 'buyers', 'purchase', 'sale', 'ყიდვა', 'მყიდველი', 'купить', 'покупка', 'покупатель', 'satın al', 'satin al', 'alıcı', 'شراء', 'קנייה') then
      v_interests := array_append(v_interests, 'BUY');
    elsif v_tok in ('rent', 'renter', 'tenant', 'tenants', 'lease', 'rental', 'ქირა', 'მოიჯარე', 'аренда', 'арендатор', 'снять', 'kiralık', 'kira', 'kiracı', 'إيجار', 'استئجار', 'שכירות') then
      v_interests := array_append(v_interests, 'RENT');
    elsif v_tok in ('invest', 'investor', 'investors', 'investment', 'ინვესტიცია', 'ინვესტორი', 'инвестиция', 'инвестиции', 'инвестор', 'yatırım', 'yatirim', 'yatırımcı', 'استثمار', 'مستثمر', 'השקעה', 'משקיע') then
      v_interests := array_append(v_interests, 'INVEST');
    else
      v_errors := array_append(v_errors, 'INTEREST_UNKNOWN:' || left(v_tok, 30));
    end if;
  end loop;
  v_interests := array(select distinct x from unnest(v_interests) x order by 1);

  foreach v_tok in array regexp_split_to_array(lower(coalesce(r->>'languages', r->>'language', '')), '\s*[,;/|]\s*') loop
    v_tok := btrim(v_tok);
    continue when v_tok = '' or v_tok in ('unknown', '-', 'n/a');
    if v_tok ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})?$' then v_langs := array_append(v_langs, split_part(v_tok, '-', 1));
    else v_errors := array_append(v_errors, 'LANGUAGE_INVALID:' || left(v_tok, 30)); end if;
  end loop;
  v_langs := array(select distinct x from unnest(v_langs) x);

  if coalesce(btrim(r->>'first_name'), '') = '' then v_errors := array_append(v_errors, 'FIRST_NAME_REQUIRED'); end if;
  if coalesce(btrim(r->>'last_name'), '') = '' then v_errors := array_append(v_errors, 'LAST_NAME_REQUIRED'); end if;
  if v_email = '' then v_errors := array_append(v_errors, 'EMAIL_REQUIRED');
  elsif v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(v_email) > 254 then v_errors := array_append(v_errors, 'EMAIL_INVALID'); end if;
  if cardinality(v_interests) = 0 and not exists (select 1 from unnest(v_errors) e where e like 'INTEREST_UNKNOWN%') then
    v_errors := array_append(v_errors, 'INTEREST_REQUIRED');
  end if;
  if v_country = '' then v_errors := array_append(v_errors, 'COUNTRY_REQUIRED');
  elsif v_country !~ '^[A-Z]{2}$' then v_errors := array_append(v_errors, 'COUNTRY_INVALID'); end if;
  if cardinality(v_langs) = 0 then v_warn := array_append(v_warn, 'LANGUAGE_UNKNOWN'); end if;
  if upper(coalesce(r->>'category', '')) not in ('', 'PRIVATE', 'CORPORATE', 'DIASPORA', 'EXPAT', 'OTHER') then
    v_errors := array_append(v_errors, 'CATEGORY_INVALID');
  end if;
  foreach v_tok in array array['budget_min', 'budget_max', 'area_min', 'area_max', 'rooms_min', 'rooms_max'] loop
    v_num := replace(replace(btrim(coalesce(r->>v_tok, '')), ' ', ''), ',', '');
    if v_num <> '' and v_num !~ '^[0-9]+(\.[0-9]+)?$' then v_errors := array_append(v_errors, upper(v_tok) || '_INVALID'); end if;
  end loop;
  if coalesce(btrim(r->>'currency'), '') <> '' and upper(btrim(r->>'currency')) !~ '^[A-Z]{3}$' then
    v_errors := array_append(v_errors, 'CURRENCY_INVALID');
  end if;
  begin
    perform nullif(btrim(coalesce(r->>'collected_at', '')), '')::date, nullif(btrim(coalesce(r->>'last_verified_at', '')), '')::date;
  exception when others then v_errors := array_append(v_errors, 'DATE_INVALID');
  end;
  if cardinality(v_langs) > 8 then v_errors := array_append(v_errors, 'LANGUAGES_TOO_MANY'); end if;
  /* Every length the table enforces, checked here so one row can never abort a whole commit. */
  foreach v_tok in array array['first_name:120', 'last_name:120', 'phone:40', 'whatsapp:60', 'telegram:120', 'facebook:300',
                               'linkedin:300', 'other_social:300', 'city:120', 'region:120', 'preferred_location:200',
                               'property_type:80', 'investment_prefs:500', 'description:600', 'source_description:600',
                               'admin_notes:2000'] loop
    if length(btrim(coalesce(r->>split_part(v_tok, ':', 1), ''))) > split_part(v_tok, ':', 2)::integer then
      v_errors := array_append(v_errors, upper(split_part(v_tok, ':', 1)) || '_TOO_LONG');
    end if;
  end loop;
  /* What a buyer sees before paying must not contain a way to reach the person. */
  foreach v_tok in array array['description', 'investment_prefs', 'preferred_location', 'city', 'region', 'property_type'] loop
    if coalesce(r->>v_tok, '') ~* '[^@\s]+@[^@\s]+\.[a-z]{2,}|(https?://|www\.)|\+?[0-9][0-9 ()./-]{7,}[0-9]' then
      v_errors := array_append(v_errors, 'CONTACT_IN_TEXT:' || v_tok);
    end if;
  end loop;

  v_out := jsonb_strip_nulls(jsonb_build_object(
    'first_name', nullif(btrim(r->>'first_name'), ''), 'last_name', nullif(btrim(r->>'last_name'), ''),
    'email', nullif(v_email, ''), 'interests', to_jsonb(v_interests), 'country', nullif(v_country, ''),
    'languages', to_jsonb(v_langs), 'category', nullif(upper(btrim(coalesce(r->>'category', ''))), ''),
    'phone', nullif(btrim(r->>'phone'), ''), 'whatsapp', nullif(btrim(r->>'whatsapp'), ''),
    'telegram', nullif(btrim(r->>'telegram'), ''), 'facebook', nullif(btrim(r->>'facebook'), ''),
    'linkedin', nullif(btrim(r->>'linkedin'), ''), 'other_social', nullif(btrim(r->>'other_social'), ''),
    'city', nullif(btrim(r->>'city'), ''), 'region', nullif(btrim(r->>'region'), ''),
    'preferred_location', nullif(btrim(r->>'preferred_location'), ''),
    'budget_min', nullif(replace(replace(btrim(coalesce(r->>'budget_min', '')), ' ', ''), ',', ''), ''),
    'budget_max', nullif(replace(replace(btrim(coalesce(r->>'budget_max', '')), ' ', ''), ',', ''), ''),
    'currency', nullif(upper(btrim(coalesce(r->>'currency', ''))), ''),
    'property_type', nullif(btrim(r->>'property_type'), ''),
    'area_min', nullif(replace(replace(btrim(coalesce(r->>'area_min', '')), ' ', ''), ',', ''), ''),
    'area_max', nullif(replace(replace(btrim(coalesce(r->>'area_max', '')), ' ', ''), ',', ''), ''),
    'rooms_min', nullif(replace(replace(btrim(coalesce(r->>'rooms_min', '')), ' ', ''), ',', ''), ''),
    'rooms_max', nullif(replace(replace(btrim(coalesce(r->>'rooms_max', '')), ' ', ''), ',', ''), ''),
    'investment_prefs', nullif(btrim(r->>'investment_prefs'), ''), 'description', nullif(btrim(r->>'description'), ''),
    'source_description', nullif(btrim(r->>'source_description'), ''),
    'collected_at', nullif(btrim(r->>'collected_at'), ''), 'last_verified_at', nullif(btrim(r->>'last_verified_at'), ''),
    'tags', case when coalesce(btrim(r->>'tags'), '') = '' then null
                 else to_jsonb(array(select btrim(t) from unnest(string_to_array(r->>'tags', ',')) t where btrim(t) <> '')) end,
    'admin_notes', nullif(btrim(r->>'admin_notes'), '')));
  return jsonb_build_object('data', v_out, 'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warn));
end $$;
revoke all on function public.curated_normalise_row(jsonb) from public, anon, authenticated;
grant execute on function public.curated_normalise_row(jsonb) to service_role;

/* Re-derive one staged row's status: errors → INVALID; an email already in the catalog or earlier
   in this batch → DUPLICATE (never merged by name); else VALID. */
create or replace function public.curated_stage_status(p_row_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r public.curated_lead_import_rows; v_dup uuid; v_dup_row integer;
begin
  select * into v_r from public.curated_lead_import_rows where id = p_row_id;
  if v_r.status in ('IMPORTED', 'SKIPPED') then return; end if;
  if cardinality(v_r.errors) > 0 then
    update public.curated_lead_import_rows set status = 'INVALID', duplicate_of = null, duplicate_row = null, updated_at = now() where id = p_row_id;
    return;
  end if;
  select l.id into v_dup from public.curated_leads l where l.email_norm = v_r.data->>'email';
  select min(o.row_no) into v_dup_row from public.curated_lead_import_rows o
   where o.batch_id = v_r.batch_id and o.row_no < v_r.row_no and o.data->>'email' = v_r.data->>'email'
     and o.status in ('VALID', 'IMPORTED', 'DUPLICATE');
  update public.curated_lead_import_rows
     set status = case when v_dup is not null or v_dup_row is not null then 'DUPLICATE' else 'VALID' end,
         duplicate_of = v_dup, duplicate_row = v_dup_row, updated_at = now()
   where id = p_row_id;
end $$;
revoke all on function public.curated_stage_status(uuid) from public, anon, authenticated;
grant execute on function public.curated_stage_status(uuid) to service_role;

create or replace function public.curated_batch_recount(p_batch uuid)
returns void language sql security definer set search_path = public as $$
  update public.curated_lead_batches b set
    total_rows = (select count(*) from public.curated_lead_import_rows r where r.batch_id = b.id),
    valid_rows = (select count(*) from public.curated_lead_import_rows r where r.batch_id = b.id and r.status = 'VALID'),
    invalid_rows = (select count(*) from public.curated_lead_import_rows r where r.batch_id = b.id and r.status = 'INVALID'),
    duplicate_rows = (select count(*) from public.curated_lead_import_rows r where r.batch_id = b.id and r.status = 'DUPLICATE'),
    imported_rows = (select count(*) from public.curated_lead_import_rows r where r.batch_id = b.id and r.status = 'IMPORTED'),
    updated_at = now()
   where b.id = p_batch
$$;
revoke all on function public.curated_batch_recount(uuid) from public, anon, authenticated;
grant execute on function public.curated_batch_recount(uuid) to service_role;

/* Stage a chunk of rows (≤ 2,000 per call; any file size in chunks). Row numbers come from the
   file, so re-sending a chunk replaces it instead of duplicating it. */
create or replace function public.admin_curated_stage_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.curated_admin_guard();
  v_item jsonb;
  v_norm jsonb;
  v_id uuid;
  v_n integer := 0;
begin
  if not exists (select 1 from public.curated_lead_batches where id = p_batch and status = 'STAGING') then raise exception 'BATCH_NOT_STAGING'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'INVALID_ARGUMENT'; end if;
  for v_item in select * from jsonb_array_elements(p_rows) order by (value->>'row_no')::integer loop
    v_norm := public.curated_normalise_row(coalesce(v_item->'data', '{}'::jsonb));
    insert into public.curated_lead_import_rows (batch_id, row_no, raw, data, errors, warnings)
    values (p_batch, (v_item->>'row_no')::integer, coalesce(v_item->'raw', v_item->'data', '{}'::jsonb), v_norm->'data',
            array(select jsonb_array_elements_text(v_norm->'errors')), array(select jsonb_array_elements_text(v_norm->'warnings')))
    on conflict (batch_id, row_no) do update set raw = excluded.raw, data = excluded.data, errors = excluded.errors,
      warnings = excluded.warnings, status = 'INVALID', updated_at = now()
    returning id into v_id;
    perform public.curated_stage_status(v_id);
    v_n := v_n + 1;
  end loop;
  perform public.curated_batch_recount(p_batch);
  return jsonb_build_object('staged', v_n) || (select jsonb_build_object('total', total_rows, 'valid', valid_rows,
           'invalid', invalid_rows, 'duplicate', duplicate_rows) from public.curated_lead_batches where id = p_batch);
end $$;
revoke all on function public.admin_curated_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.admin_curated_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.admin_curated_batch_rows(p_batch uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_status text := nullif(upper(coalesce(p->>'status', '')), '');
        v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 100), 1), 500);
        v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
begin
  perform public.curated_admin_guard();
  return jsonb_build_object(
    'batch', (select to_jsonb(b) from public.curated_lead_batches b where b.id = p_batch),
    'total', (select count(*) from public.curated_lead_import_rows r where r.batch_id = p_batch and (v_status is null or r.status = v_status)),
    'errorSummary', coalesce((select jsonb_object_agg(code, n) from (
        select split_part(e, ':', 1) code, count(*) n from public.curated_lead_import_rows r, unnest(r.errors) e
         where r.batch_id = p_batch and r.status = 'INVALID' group by 1) x), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'rowNo', r.row_no, 'data', r.data, 'errors', to_jsonb(r.errors),
        'warnings', to_jsonb(r.warnings), 'status', r.status, 'duplicateOf', r.duplicate_of, 'duplicateRow', r.duplicate_row) order by r.row_no)
      from (select * from public.curated_lead_import_rows r where r.batch_id = p_batch and (v_status is null or r.status = v_status)
             order by r.row_no offset v_offset limit v_limit) r), '[]'::jsonb));
end $$;
revoke all on function public.admin_curated_batch_rows(uuid, jsonb) from public, anon;
grant execute on function public.admin_curated_batch_rows(uuid, jsonb) to authenticated;

/* Correct one staged row in place — the rest of the import is untouched. */
create or replace function public.admin_curated_row_fix(p_row_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.curated_admin_guard(); v_norm jsonb; v_batch uuid;
begin
  select r.batch_id into v_batch from public.curated_lead_import_rows r where r.id = p_row_id and r.status not in ('IMPORTED');
  if v_batch is null then raise exception 'NOT_FOUND'; end if;
  v_norm := public.curated_normalise_row(p_data);
  update public.curated_lead_import_rows set data = v_norm->'data',
    errors = array(select jsonb_array_elements_text(v_norm->'errors')),
    warnings = array(select jsonb_array_elements_text(v_norm->'warnings')), status = 'INVALID', updated_at = now()
   where id = p_row_id;
  perform public.curated_stage_status(p_row_id);
  perform public.curated_batch_recount(v_batch);
  return (select jsonb_build_object('id', r.id, 'rowNo', r.row_no, 'data', r.data, 'errors', to_jsonb(r.errors),
            'warnings', to_jsonb(r.warnings), 'status', r.status, 'duplicateOf', r.duplicate_of, 'duplicateRow', r.duplicate_row)
            from public.curated_lead_import_rows r where r.id = p_row_id);
end $$;
revoke all on function public.admin_curated_row_fix(uuid, jsonb) from public, anon;
grant execute on function public.admin_curated_row_fix(uuid, jsonb) to authenticated;

create or replace function public.curated_lead_from_data(d jsonb)
returns public.curated_leads language plpgsql stable set search_path = public as $$
declare v public.curated_leads;
begin
  v.first_name := d->>'first_name'; v.last_name := d->>'last_name';
  v.email := d->>'email'; v.email_norm := lower(d->>'email');
  v.interests := array(select jsonb_array_elements_text(coalesce(d->'interests', '[]'::jsonb)));
  v.country := d->>'country';
  v.languages := array(select jsonb_array_elements_text(coalesce(d->'languages', '[]'::jsonb)));
  v.category := d->>'category';
  v.phone := d->>'phone'; v.whatsapp := d->>'whatsapp'; v.telegram := d->>'telegram';
  v.facebook := d->>'facebook'; v.linkedin := d->>'linkedin'; v.other_social := d->>'other_social';
  v.city := d->>'city'; v.region := d->>'region'; v.preferred_location := d->>'preferred_location';
  v.budget_min := (d->>'budget_min')::numeric; v.budget_max := (d->>'budget_max')::numeric; v.currency := d->>'currency';
  v.property_type := d->>'property_type';
  v.area_min := (d->>'area_min')::numeric; v.area_max := (d->>'area_max')::numeric;
  v.rooms_min := (d->>'rooms_min')::numeric; v.rooms_max := (d->>'rooms_max')::numeric;
  v.investment_prefs := d->>'investment_prefs'; v.description := d->>'description'; v.source_description := d->>'source_description';
  v.collected_at := (d->>'collected_at')::date; v.last_verified_at := (d->>'last_verified_at')::date;
  v.tags := array(select jsonb_array_elements_text(coalesce(d->'tags', '[]'::jsonb)));
  v.admin_notes := d->>'admin_notes';
  v.status := 'HIDDEN';
  return v;
end $$;
revoke all on function public.curated_lead_from_data(jsonb) from public, anon, authenticated;
grant execute on function public.curated_lead_from_data(jsonb) to service_role;

/* Commit: VALID rows become HIDDEN catalog leads (never auto-published). Duplicates are skipped,
   or — on explicit request — update the existing lead with this row's non-empty fields. */
create or replace function public.admin_curated_batch_commit(p_batch uuid, p_update_duplicates boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.curated_admin_guard();
  v_r record;
  v_l public.curated_leads;
  v_id uuid;
  v_new integer := 0;
  v_upd integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('curated_batch_commit:' || p_batch::text, 0));
  perform 1 from public.curated_lead_batches where id = p_batch and status = 'STAGING' for update;
  if not found then raise exception 'BATCH_NOT_STAGING'; end if;
  for v_r in select * from public.curated_lead_import_rows where batch_id = p_batch and status in ('VALID', 'DUPLICATE') order by row_no loop
    v_l := public.curated_lead_from_data(v_r.data);
    if v_r.status = 'VALID' then
      insert into public.curated_leads (batch_id, first_name, last_name, email, email_norm, interests, country, languages, category,
        phone, whatsapp, telegram, facebook, linkedin, other_social, city, region, preferred_location, budget_min, budget_max,
        currency, property_type, area_min, area_max, rooms_min, rooms_max, investment_prefs, description, source_description,
        collected_at, last_verified_at, tags, admin_notes)
      values (p_batch, v_l.first_name, v_l.last_name, v_l.email, lower(v_l.email), v_l.interests, v_l.country, v_l.languages, v_l.category,
        v_l.phone, v_l.whatsapp, v_l.telegram, v_l.facebook, v_l.linkedin, v_l.other_social, v_l.city, v_l.region, v_l.preferred_location,
        v_l.budget_min, v_l.budget_max, v_l.currency, v_l.property_type, v_l.area_min, v_l.area_max, v_l.rooms_min, v_l.rooms_max,
        v_l.investment_prefs, v_l.description, v_l.source_description, v_l.collected_at, v_l.last_verified_at, v_l.tags, v_l.admin_notes)
      on conflict (email_norm) do nothing
      returning id into v_id;
      if v_id is null then
        update public.curated_lead_import_rows set status = 'DUPLICATE',
          duplicate_of = (select id from public.curated_leads where email_norm = lower(v_l.email)), updated_at = now() where id = v_r.id;
      else
        update public.curated_lead_import_rows set status = 'IMPORTED', lead_id = v_id, updated_at = now() where id = v_r.id;
        v_new := v_new + 1;
      end if;
    elsif p_update_duplicates and v_r.duplicate_of is not null then
      update public.curated_leads c set
        first_name = v_l.first_name, last_name = v_l.last_name, interests = v_l.interests, country = v_l.country,
        languages = case when cardinality(v_l.languages) > 0 then v_l.languages else c.languages end,
        category = coalesce(v_l.category, c.category), phone = coalesce(v_l.phone, c.phone), whatsapp = coalesce(v_l.whatsapp, c.whatsapp),
        telegram = coalesce(v_l.telegram, c.telegram), facebook = coalesce(v_l.facebook, c.facebook), linkedin = coalesce(v_l.linkedin, c.linkedin),
        other_social = coalesce(v_l.other_social, c.other_social), city = coalesce(v_l.city, c.city), region = coalesce(v_l.region, c.region),
        preferred_location = coalesce(v_l.preferred_location, c.preferred_location), budget_min = coalesce(v_l.budget_min, c.budget_min),
        budget_max = coalesce(v_l.budget_max, c.budget_max), currency = coalesce(v_l.currency, c.currency),
        property_type = coalesce(v_l.property_type, c.property_type), description = coalesce(v_l.description, c.description),
        last_verified_at = greatest(v_l.last_verified_at, c.last_verified_at), updated_at = now()
       where c.id = v_r.duplicate_of;
      update public.curated_lead_import_rows set status = 'IMPORTED', lead_id = v_r.duplicate_of, updated_at = now() where id = v_r.id;
      v_upd := v_upd + 1;
    end if;
    v_id := null;
  end loop;
  update public.curated_lead_batches set status = 'COMMITTED', committed_at = now() where id = p_batch;
  perform public.curated_batch_recount(p_batch);
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'CURATED_BATCH_COMMIT', 'curated_lead_batches', p_batch::text,
          jsonb_build_object('created', v_new, 'updated', v_upd, 'updateDuplicates', p_update_duplicates));
  return jsonb_build_object('created', v_new, 'updated', v_upd);
end $$;
revoke all on function public.admin_curated_batch_commit(uuid, boolean) from public, anon;
grant execute on function public.admin_curated_batch_commit(uuid, boolean) to authenticated;

/* Publish / hide. Publishing requires verified disclosure rights on the lead's batch. */
create or replace function public.admin_curated_publish(p jsonb, p_publish boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.curated_admin_guard();
  v_ids uuid[] := array(select (x)::uuid from jsonb_array_elements_text(case when jsonb_typeof(p->'ids') = 'array' then p->'ids' else '[]'::jsonb end) x);
  v_batch uuid := nullif(p->>'batchId', '')::uuid;
  v_n integer;
  v_blocked integer := 0;
begin
  if p_publish then
    select count(*) into v_blocked from public.curated_leads l left join public.curated_lead_batches b on b.id = l.batch_id
     where (l.id = any (v_ids) or (v_batch is not null and l.batch_id = v_batch))
       and not (coalesce(b.rights_verified, false) and b.status <> 'ARCHIVED');
    update public.curated_leads l set status = 'PUBLISHED', published_at = coalesce(l.published_at, now()), updated_at = now()
      from public.curated_lead_batches b
     where b.id = l.batch_id and b.rights_verified and b.status <> 'ARCHIVED' and l.status <> 'PUBLISHED'
       and (l.id = any (v_ids) or (v_batch is not null and l.batch_id = v_batch));
  else
    update public.curated_leads l set status = 'HIDDEN', updated_at = now()
     where l.status <> 'HIDDEN' and (l.id = any (v_ids) or (v_batch is not null and l.batch_id = v_batch));
  end if;
  get diagnostics v_n = row_count;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, case when p_publish then 'CURATED_PUBLISH' else 'CURATED_HIDE' end, 'curated_leads',
          coalesce(v_batch::text, 'selection'), jsonb_build_object('changed', v_n, 'blocked', v_blocked, 'ids', cardinality(v_ids)));
  return jsonb_build_object('changed', v_n, 'blockedUnverified', v_blocked);
end $$;
revoke all on function public.admin_curated_publish(jsonb, boolean) from public, anon;
grant execute on function public.admin_curated_publish(jsonb, boolean) to authenticated;

create or replace function public.admin_curated_leads(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_size integer := least(greatest(coalesce((p->>'pageSize')::integer, 100), 1), 500);
  v_page integer := greatest(coalesce((p->>'page')::integer, 1), 1);
  v_status text := nullif(upper(coalesce(p->>'status', '')), '');
  v_batch uuid := nullif(p->>'batchId', '')::uuid;
  v_q text := nullif(lower(btrim(coalesce(p->>'q', ''))), '');
  v_f jsonb := coalesce(p->'filters', '{}'::jsonb);
begin
  perform public.curated_admin_guard();
  return (with hits as (
    select l.* from public.curated_filtered(v_f - 'q') l
     where (v_status is null or l.status = v_status) and (v_batch is null or l.batch_id = v_batch)
       and (v_q is null or position(v_q in lower(l.first_name || ' ' || l.last_name || ' ' || l.email_norm)) > 0)
  )
  select jsonb_build_object('total', (select count(*) from hits), 'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(to_jsonb(h) - 'email_norm' || jsonb_build_object(
        'unlocks', (select count(*) from public.curated_lead_unlocks u where u.lead_id = h.id),
        'batchName', (select b.name from public.curated_lead_batches b where b.id = h.batch_id)) order by h.created_at desc, h.id)
      from (select * from hits order by created_at desc, id offset (v_page - 1) * v_size limit v_size) h), '[]'::jsonb)));
end $$;
revoke all on function public.admin_curated_leads(jsonb) from public, anon;
grant execute on function public.admin_curated_leads(jsonb) to authenticated;

create or replace function public.admin_curated_lead_update(p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.curated_admin_guard(); v_norm jsonb; v_l public.curated_leads;
begin
  v_norm := public.curated_normalise_row(p_data);
  if jsonb_array_length(v_norm->'errors') > 0 then
    return jsonb_build_object('ok', false, 'errors', v_norm->'errors');
  end if;
  v_l := public.curated_lead_from_data(v_norm->'data');
  if exists (select 1 from public.curated_leads where email_norm = lower(v_l.email) and id <> p_id) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('EMAIL_DUPLICATE'));
  end if;
  update public.curated_leads set first_name = v_l.first_name, last_name = v_l.last_name, email = v_l.email,
    email_norm = lower(v_l.email), interests = v_l.interests, country = v_l.country, languages = v_l.languages,
    category = v_l.category, phone = v_l.phone, whatsapp = v_l.whatsapp, telegram = v_l.telegram, facebook = v_l.facebook,
    linkedin = v_l.linkedin, other_social = v_l.other_social, city = v_l.city, region = v_l.region,
    preferred_location = v_l.preferred_location, budget_min = v_l.budget_min, budget_max = v_l.budget_max,
    currency = v_l.currency, property_type = v_l.property_type, area_min = v_l.area_min, area_max = v_l.area_max,
    rooms_min = v_l.rooms_min, rooms_max = v_l.rooms_max, investment_prefs = v_l.investment_prefs,
    description = v_l.description, source_description = v_l.source_description, collected_at = v_l.collected_at,
    last_verified_at = v_l.last_verified_at, tags = v_l.tags, admin_notes = v_l.admin_notes, updated_at = now()
   where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'CURATED_LEAD_UPDATE', 'curated_leads', p_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_curated_lead_update(uuid, jsonb) from public, anon;
grant execute on function public.admin_curated_lead_update(uuid, jsonb) to authenticated;

/* Every admin export: an administrator, a stated reason (10–500 characters), at most 10 exports per
   administrator per hour, and an audit row. Direct API calls meet the same checks. */
create or replace function public.admin_export_guard(p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.curated_admin_guard();
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 or length(p_reason) > 500 then raise exception 'REASON_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_export:' || v_admin::text, 0));
  if (select count(*) from public.admin_audit_log a
       where a.admin_id = v_admin and a.action in ('CURATED_EXPORT', 'OUTREACH_LIST_EXPORT')
         and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'EXPORT_RATE_LIMITED';
  end if;
  return v_admin;
end $$;
revoke all on function public.admin_export_guard(text) from public, anon, authenticated;
grant execute on function public.admin_export_guard(text) to service_role;

/* Export of AUTHORISED records only (verified disclosure rights), for a stated reason, audited. */
create or replace function public.admin_curated_export(p jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.admin_export_guard(p_reason); v_rows jsonb; v_n integer;
begin
  select coalesce(jsonb_agg(to_jsonb(l) - 'email_norm' - 'admin_notes' order by l.created_at), '[]'::jsonb), count(*)
    into v_rows, v_n
    from (select l.* from public.curated_filtered(coalesce(p->'filters', '{}'::jsonb)) l
            join public.curated_lead_batches b on b.id = l.batch_id and b.rights_verified
           where (nullif(upper(coalesce(p->>'status', '')), '') is null or l.status = upper(p->>'status'))
             and (nullif(p->>'batchId', '') is null or l.batch_id = (p->>'batchId')::uuid)
           order by l.created_at limit 50000) l;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'CURATED_EXPORT', 'curated_leads', 'export', jsonb_build_object('rows', v_n, 'reason', left(p_reason, 500), 'filter', p));
  return jsonb_build_object('rows', v_rows, 'count', v_n);
end $$;
revoke all on function public.admin_curated_export(jsonb, text) from public, anon;
grant execute on function public.admin_curated_export(jsonb, text) to authenticated;

/* Price is set in cents (VAT-inclusive, final): $0.10 = 10. Audited. */
create or replace function public.admin_curated_set_price(p_cents integer, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.curated_admin_guard(); v_old integer;
begin
  if p_cents is null or p_cents < 1 or p_cents > 10000 then raise exception 'INVALID_ARGUMENT'; end if;
  select standard_retail_cents into v_old from public.billable_products where code = 'CURATED_LEAD' for update;
  update public.billable_products set standard_retail_cents = p_cents, pricing_version = pricing_version + 1, updated_at = now()
   where code = 'CURATED_LEAD';
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'CURATED_PRICE_SET', 'billable_products', 'CURATED_LEAD',
          jsonb_build_object('old_cents', v_old, 'new_cents', p_cents, 'reason', p_reason));
  return public.curated_lead_price();
end $$;
revoke all on function public.admin_curated_set_price(integer, text) from public, anon;
grant execute on function public.admin_curated_set_price(integer, text) to authenticated;

/* User-uploaded contact lists: metadata for oversight; contents only through an audited export
   with a stated reason. A private list never becomes catalog inventory. */
create or replace function public.admin_outreach_lists(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 50), 1), 200);
        v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
        v_q text := nullif(lower(btrim(coalesce(p->>'q', ''))), '');
begin
  perform public.curated_admin_guard();
  return (with l as (
    select l.*, u.email as owner_email, coalesce(u.full_name, u.nickname) as owner_name
      from public.outreach_contact_lists l left join public.users u on u.auth_id = l.owner_id
     where v_q is null or position(v_q in lower(coalesce(l.name, '') || ' ' || coalesce(u.email, '') || ' ' || coalesce(l.source_filename, ''))) > 0
  )
  select jsonb_build_object('total', (select count(*) from l),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'ownerEmail', x.owner_email,
        'ownerName', x.owner_name, 'sourceKind', x.source_kind, 'sourceFormat', x.source_format,
        'sourceFilename', x.source_filename, 'importStatus', x.import_status, 'totalRows', x.total_rows,
        'validRows', x.valid_rows, 'contacts', (select count(*) from public.outreach_contacts c where c.list_id = x.id),
        'createdAt', x.created_at, 'updatedAt', x.updated_at) order by x.created_at desc)
      from (select * from l order by created_at desc offset v_offset limit v_limit) x), '[]'::jsonb)));
end $$;
revoke all on function public.admin_outreach_lists(jsonb) from public, anon;
grant execute on function public.admin_outreach_lists(jsonb) to authenticated;

create or replace function public.admin_outreach_list_export(p_list_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := public.admin_export_guard(p_reason); v_rows jsonb; v_n integer; v_owner uuid;
begin
  select l.owner_id into v_owner from public.outreach_contact_lists l where l.id = p_list_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select count(*) into v_n from public.outreach_contacts c where c.list_id = p_list_id;
  /* A private list is inspected, not harvested: one export is capped at 5,000 contacts. */
  if v_n > 5000 then raise exception 'EXPORT_TOO_LARGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'language', c.language,
           'country', c.country, 'consent_status', c.consent_status, 'source_kind', c.source_kind, 'unsubscribed', c.unsubscribed,
           'suppressed', c.suppressed, 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
    into v_rows from public.outreach_contacts c where c.list_id = p_list_id;
  insert into public.admin_audit_log (admin_id, target_id, action, entity_type, entity_id, metadata)
  values (v_admin, (select u.id from public.users u where u.auth_id = v_owner), 'OUTREACH_LIST_EXPORT', 'outreach_contact_lists', p_list_id::text,
          jsonb_build_object('rows', v_n, 'reason', left(p_reason, 500)));
  return jsonb_build_object('rows', v_rows, 'count', v_n);
end $$;
revoke all on function public.admin_outreach_list_export(uuid, text) from public, anon;
grant execute on function public.admin_outreach_list_export(uuid, text) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 10 · internal feed: the same feed (matching, scoring, prices, masking unchanged) with
 *      country / language / interest / keyword filters, a 100-row page, facets for the
 *      workspace filters, an id list for "select all matching" (≤ 500), and the
 *      internal_matching + maintenance switches. LOCKED / UNLOCKED stay server-side filters.
 * ════════════════════════════════════════════════════════════════════════ */

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
           case when seg.segment = 'PREMIUM' then 'VIP' else c.category end as display_category,
           case when seg.segment = 'PREMIUM' then 'PREMIUM' when c.category = 'EXACT' then 'EXACT' else 'STANDARD' end as price_key,
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
    select b.*, (b.active_at < now() - interval '45 days') as stale from base b where not v_disabled or b.unlocked
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
revoke all on function public.internal_leads_feed_v2(uuid, jsonb) from public, anon;
grant execute on function public.internal_leads_feed_v2(uuid, jsonb) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 11 · the admin control panel: four independent switches, one audited entry point.
 *      INTERNAL / CURATED → service_controls (frontend + backend together, version bumped);
 *      UNLOCKED_LIBRARY / MAINTENANCE → admin_settings. No switch changes another.
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.admin_matching_control_set(p_control text, p_on boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := public.curated_admin_guard();
  v_control text := upper(coalesce(p_control, ''));
  v_key text;
  v_old jsonb;
begin
  if p_on is null or length(coalesce(p_reason, '')) > 500 then raise exception 'INVALID_ARGUMENT'; end if;
  if v_control in ('INTERNAL', 'CURATED') then
    v_key := case v_control when 'INTERNAL' then 'internal_matching' else 'curated_leads' end;
    select jsonb_build_object('frontend', frontend_enabled, 'backend', backend_enabled) into v_old
      from public.service_controls where service_key = v_key for update;
    update public.service_controls set frontend_enabled = p_on, backend_enabled = p_on, version = version + 1,
           reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = v_admin, updated_at = now()
     where service_key = v_key;
  elsif v_control in ('UNLOCKED_LIBRARY', 'MAINTENANCE') then
    v_key := case v_control when 'MAINTENANCE' then 'matching_maintenance_mode' else 'matching_unlocked_library_visible' end;
    select value into v_old from public.admin_settings where key = v_key;
    insert into public.admin_settings (key, value, updated_at) values (v_key, to_jsonb(p_on), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  else
    raise exception 'INVALID_ARGUMENT';
  end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  values (v_admin, 'MATCHING_CONTROL_SET', case when v_control in ('INTERNAL', 'CURATED') then 'service_controls' else 'admin_settings' end,
          v_key, jsonb_build_object('control', v_control, 'old', v_old, 'new', p_on, 'reason', p_reason));
  return public.matching_workspace_state();
end $$;
revoke all on function public.admin_matching_control_set(text, boolean, text) from public, anon;
grant execute on function public.admin_matching_control_set(text, boolean, text) to authenticated;

/* ════════════════════════════════════════════════════════════════════════
 * 12 · multilingual campaign preparation on the EXISTING contact lists
 *      outreach_list_audience: who a list can really reach (the same rule outreach-send applies:
 *        an address, CONSENTED, not unsubscribed / suppressed / do-not-contact / duplicate),
 *        by language and by source.
 *      outreach_list_split_by_language: one list per recipient language, so each language gets
 *        its own campaign. Contacts with no recorded language go to the fallback the owner CHOSE
 *        — never one guessed from their country; without a fallback they stay in "unknown".
 * ════════════════════════════════════════════════════════════════════════ */

create or replace function public.outreach_list_audience(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_auth uuid := auth.uid();
begin
  if v_auth is null then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.outreach_contact_lists l where l.id = p_list_id and l.owner_id = v_auth) then
    raise exception 'NOT_FOUND';
  end if;
  return (with c as (
    select c.*, (c.email is not null and c.consent_status = 'CONSENTED' and not coalesce(c.unsubscribed, false)
                 and not coalesce(c.suppressed, false) and not coalesce(c.do_not_contact, false)
                 and not coalesce(c.is_duplicate, false)) as eligible,
           coalesce(nullif(lower(btrim(c.language)), ''), 'unknown') as lang
      from public.outreach_contacts c where c.list_id = p_list_id and c.owner_id = v_auth
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'withEmail', (select count(*) from c where email is not null),
    'consented', (select count(*) from c where consent_status = 'CONSENTED'),
    'eligible', (select count(*) from c where eligible),
    'byLanguage', coalesce((select jsonb_object_agg(lang, jsonb_build_object('total', n, 'eligible', e)) from (
        select lang, count(*) n, count(*) filter (where eligible) e from c group by lang) x), '{}'::jsonb),
    'bySource', coalesce((select jsonb_object_agg(src, n) from (
        select coalesce(source_kind, 'IMPORT') src, count(*) n from c group by 1) y), '{}'::jsonb)));
end $$;
revoke all on function public.outreach_list_audience(uuid) from public, anon;
grant execute on function public.outreach_list_audience(uuid) to authenticated;

create or replace function public.outreach_list_split_by_language(p_list_id uuid, p_fallback_language text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_auth uuid := auth.uid();
  v_src public.outreach_contact_lists;
  v_fallback text := nullif(lower(btrim(coalesce(p_fallback_language, ''))), '');
  v_lang text;
  v_list uuid;
  v_out jsonb := '[]'::jsonb;
begin
  if v_auth is null then raise exception 'FORBIDDEN'; end if;
  select * into v_src from public.outreach_contact_lists l where l.id = p_list_id and l.owner_id = v_auth;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_fallback is not null and v_fallback !~ '^[a-z]{2,3}$' then raise exception 'INVALID_LANGUAGE'; end if;
  for v_lang in
    select distinct coalesce(nullif(lower(btrim(c.language)), ''), v_fallback, 'unknown')
      from public.outreach_contacts c where c.list_id = p_list_id and c.owner_id = v_auth order by 1
  loop
    v_list := public.outreach_source_list(v_auth, coalesce(v_src.source_kind, 'MIXED'),
                left(v_src.name, 140) || ' · ' || upper(v_lang),
                'split:' || p_list_id::text || ':' || v_lang,
                'Recipients of "' || left(v_src.name, 120) || '" whose language is ' || v_lang || '.');
    /* source_lead_id is NOT copied: one CRM contact per Find Buyers lead (outreach_contacts_one_per_lead);
       the copy keeps its provenance in source_kind and the source_* fields. */
    insert into public.outreach_contacts
      (list_id, owner_id, full_name, email, email_valid, phone, language, country, city, tags, lead_type, lead_stage, notes,
       consent_status, consent_source, consent_lawful_basis, consent_recorded_at, unsubscribed, suppressed, suppressed_reason,
       do_not_contact, source_kind, source_curated_lead_id, source_internal_lead_user_id, source_property_id,
       source_platform, source_url, source_profile_url, source_match_category, contact_detail_origin, split_from_contact_id)
    select v_list, v_auth, c.full_name, c.email, c.email_valid,
           case when c.phone is null or row_number() over (partition by c.phone order by c.created_at, c.id) > 1
                     or exists (select 1 from public.outreach_contacts d where d.list_id = v_list and d.phone = c.phone)
                then null else c.phone end,
           case when coalesce(nullif(btrim(c.language), ''), '') = '' then v_fallback else c.language end,
           c.country, c.city, c.tags, c.lead_type, c.lead_stage, c.notes,
           c.consent_status, c.consent_source, c.consent_lawful_basis, c.consent_recorded_at, c.unsubscribed, c.suppressed,
           c.suppressed_reason, c.do_not_contact, c.source_kind, c.source_curated_lead_id, c.source_internal_lead_user_id,
           c.source_property_id, c.source_platform, c.source_url, c.source_profile_url,
           c.source_match_category, c.contact_detail_origin, c.id
      from public.outreach_contacts c
     where c.list_id = p_list_id and c.owner_id = v_auth
       and coalesce(nullif(lower(btrim(c.language)), ''), v_fallback, 'unknown') = v_lang
       and not exists (select 1 from public.outreach_contacts d where d.list_id = v_list
                        and (d.split_from_contact_id = c.id
                          or (c.email is not null and lower(d.email) = lower(c.email))
                          or (c.source_curated_lead_id is not null and d.source_curated_lead_id = c.source_curated_lead_id)
                          or (c.source_internal_lead_user_id is not null and d.source_internal_lead_user_id = c.source_internal_lead_user_id)
                          or (c.email is null and c.phone is not null and d.phone = c.phone)))
    on conflict do nothing;
    update public.outreach_contact_lists l
       set total_rows = (select count(*) from public.outreach_contacts x where x.list_id = l.id),
           valid_rows = (select count(*) from public.outreach_contacts x where x.list_id = l.id and x.email is not null),
           updated_at = now()
     where l.id = v_list;
    v_out := v_out || jsonb_build_array(jsonb_build_object('language', v_lang, 'listId', v_list,
               'audience', public.outreach_list_audience(v_list)));
  end loop;
  return v_out;
end $$;
revoke all on function public.outreach_list_split_by_language(uuid, text) from public, anon;
grant execute on function public.outreach_list_split_by_language(uuid, text) to authenticated;
