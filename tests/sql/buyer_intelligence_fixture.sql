-- Minimal fixture of the production objects the market-segmentation and
-- buyer-intelligence migrations read (columns copied from production
-- information_schema, 2026-10-09). Run: tests/sql/run-buyer-intelligence.sh
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.auth', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;

create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, email text, full_name text, is_admin boolean default false);
create or replace function public.auth_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('app.admin', true), '') = 'on' $$;
create or replace function public.homatch_ilike_escape(p text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_') $$;

create table public.fx_rates (id uuid primary key default gen_random_uuid(), base_currency text not null, quote_currency text not null default 'USD',
  rate numeric(20,10) not null, source text default 'MANUAL', effective_from timestamptz not null default now(), effective_to timestamptz);
create or replace function public.fx_to_usd(p_amount numeric, p_currency text, p_at timestamptz default now())
returns numeric language sql stable as $fn$
  select case when p_amount is null then null
    when upper(coalesce(p_currency, 'USD')) = 'USD' then round(p_amount, 6)
    else (select round(p_amount * r.rate, 6) from public.fx_rates r
           where r.base_currency = upper(p_currency) and r.quote_currency = 'USD' and r.effective_from <= p_at
             and (r.effective_to is null or r.effective_to > p_at) order by r.effective_from desc limit 1) end $fn$;

create type public.transaction_type as enum ('SALE', 'RENT', 'INVESTMENT');
create type public.property_type as enum ('APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','OFFICE','PENTHOUSE','STUDIO','TOWNHOUSE','OTHER');
create type public.intent_type as enum ('BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT','SELLER','AGENT_AD','PROPERTY_AD','SPAM','NOISE','UNKNOWN');

create table public.properties (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id), title text,
  transaction_type public.transaction_type, property_type public.property_type, is_deleted boolean default false,
  archived_at timestamptz, homatch_id integer, contact_phone_e164 text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.property_facts (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id),
  source_url text, canonical_url text, country text, city text, district text, neighborhood text, address text,
  total_price numeric, price_per_sqm numeric, currency text, area numeric, rooms int, bedrooms int,
  listing_updated_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  source_domain text, country_code text, source_listing_id text);
create table public.discovery_marketplace_listings (id uuid primary key default gen_random_uuid(), search_id uuid,
  source_key text not null, source_listing_id text not null, exact_url text, raw jsonb not null,
  observed_at timestamptz not null default now(), created_at timestamptz default now(), updated_at timestamptz default now());
create table public.discovery_marketplace_searches (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
  status text not null, brief jsonb, request jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.raw_signals (id uuid primary key default gen_random_uuid());
create table public.intent_profiles (id uuid primary key default gen_random_uuid(), signal_id uuid references public.raw_signals(id),
  intent_type public.intent_type not null default 'BUY', country text, city text, district text, neighborhoods text[],
  transaction_type text, property_types text[], bedrooms_min int, bedrooms_max int, area_min numeric, area_max numeric,
  budget_min numeric, budget_max numeric, currency text, intent_confidence numeric(4,3) default 0, original_text text,
  classifier_version text, rooms_min int, rooms_max int, created_at timestamptz not null default now());
create table public.active_search_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  intent_id uuid, search_criteria jsonb, property_id uuid, side text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), on_behalf boolean default false);
create table public.intent_signals (id uuid primary key default gen_random_uuid(), actor_user_id uuid, source_surface text, source_at timestamptz,
  side text, polarity text, attribution text, explicit boolean, confidence numeric, property_id uuid, act text,
  superseded_by uuid, withdrawn_at timestamptz, created_at timestamptz default now());
create table public.supply_matches (id uuid primary key default gen_random_uuid(), compatibility text, match_score numeric, deal_kind text,
  agreed text[], conflicted text[], unknown_dimensions text[], property_id uuid, supply_user_id uuid, demand_user_id uuid,
  source_kind text default 'EXTERNAL_INTELLIGENCE', created_at timestamptz default now());
create table public.find_buyers_leads (id uuid primary key default gen_random_uuid(), property_id uuid, created_at timestamptz default now());
