-- Minimal fixture of the production objects 20261028090000_homatch_leads_marketplace.sql
-- reads or writes (columns as in production information_schema, 2026-10-10). The wallet
-- functions keep their production signatures and the behaviours the unlock relies on
-- (service_role only, idempotency key, INSUFFICIENT_CREDITS, PRODUCT_DISABLED, a ledger
-- row and a usage event per settle); their lot accounting is covered by the billing suite.
-- Run: tests/sql/run-homatch-leads.sh
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'authenticated') $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on all functions in schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;

create table public.users (
  id uuid primary key default gen_random_uuid(), auth_id uuid not null, email text not null,
  full_name text, nickname text, phone text, preferred_language text default 'en',
  is_admin boolean not null default false, suspended_at timestamptz
);
create or replace function public.is_admin() returns boolean language sql stable set search_path to ''
  as $$ select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin = true) $$;
create or replace function public.current_homatch_user_id() returns uuid language sql stable security definer set search_path = public
  as $$ select id from public.users where auth_id = auth.uid() limit 1 $$;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_homatch_user_id() to authenticated;

create table public.admin_settings (id uuid primary key default gen_random_uuid(), key text unique not null, value jsonb);
insert into public.admin_settings (key, value) values ('credits_per_usd', '10');
create or replace function public.billing_setting_num(p_key text, p_default numeric) returns numeric language sql stable as $$
  select coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = p_key), p_default) $$;
create or replace function public.fx_to_usd(p_amount numeric, p_currency text, p_at timestamptz) returns numeric language sql stable as $$
  select case upper(p_currency) when 'USD' then p_amount when 'GEL' then round(p_amount / 2.7, 2) when 'EUR' then round(p_amount * 1.08, 2) else null end $$;

create type public.transaction_type as enum ('SALE', 'RENT');
create type public.property_type as enum ('APARTMENT', 'HOUSE');
create table public.properties (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  homatch_id integer, title text, transaction_type public.transaction_type, property_type public.property_type,
  matching_status text default 'ACTIVE', is_deleted boolean not null default false, archived_at timestamptz
);
create table public.property_facts (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  city text, district text, total_price numeric, currency text, area numeric, rooms integer, bedrooms integer
);
create type public.intent_type as enum ('BUYER', 'TENANT');
create table public.intent_profiles (
  id uuid primary key default gen_random_uuid(), intent_type public.intent_type, country text, city text, district text,
  neighborhoods text[], transaction_type text, property_types text[], bedrooms_min int, bedrooms_max int,
  rooms_min int, rooms_max int, area_min numeric, area_max numeric, budget_min numeric, budget_max numeric,
  currency text, timeline text, original_text text, created_at timestamptz not null default now()
);
create table public.active_search_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id), intent_id uuid,
  side text, is_active boolean default true, created_at timestamptz default now()
);
create table public.supply_matches (
  id uuid primary key default gen_random_uuid(), intent_profile_id uuid, property_id uuid, supply_user_id uuid,
  demand_user_id uuid, source_kind text, compatibility text, match_score numeric, agreed text[], conflicted text[],
  unknown_dimensions text[], preference_misses text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.native_property_relationships (id uuid primary key default gen_random_uuid(), property_id uuid,
  supply_user_id uuid, demand_user_id uuid, state text default 'ACTIVE', conversation_id uuid, updated_at timestamptz);
create table public.conversation_blocks (id uuid primary key default gen_random_uuid(), blocker_id uuid, blocked_id uuid, created_at timestamptz default now());
create table public.conversations (
  id uuid primary key default gen_random_uuid(), property_id uuid, initiator_id uuid, recipient_id uuid,
  status text default 'ACTIVE', last_message_at timestamptz, created_at timestamptz default now()
);
create type public.message_status as enum ('SENT', 'DELIVERED', 'SEEN', 'FAILED');
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid references public.conversations(id),
  sender_id uuid, body text not null, status public.message_status default 'SENT', created_at timestamptz default now()
);
create table public.contact_disclosures (id uuid primary key default gen_random_uuid(), viewer_user_id uuid, subject_user_id uuid,
  property_id uuid, relationship_kind text, relationship_id uuid, created_at timestamptz default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  priority text, deep_link text, entity_type text, entity_id uuid, dedupe_key text unique, metadata jsonb, created_at timestamptz default now());

-- Production ensure_conversation (20260928010000_native_intent_pipeline.sql), verbatim logic.
create or replace function public.ensure_conversation(p_initiator uuid, p_recipient uuid, p_property uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_initiator is null or p_recipient is null or p_initiator = p_recipient then
    raise exception 'a conversation needs two different people';
  end if;
  select id into v_id from public.conversations
   where least(initiator_id, recipient_id) = least(p_initiator, p_recipient)
     and greatest(initiator_id, recipient_id) = greatest(p_initiator, p_recipient)
     and coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_property, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_id is not null then return v_id; end if;
  insert into public.conversations (initiator_id, recipient_id, property_id, status) values (p_initiator, p_recipient, p_property, 'ACTIVE')
  returning id into v_id;
  return v_id;
end $$;

/* Wallet (billing v2 surface). */
create table public.billable_products (
  code text primary key, name text, billing_mode text, requires_reservation boolean, standard_retail_cents numeric,
  reference_landed_cogs_cents numeric, min_gross_margin_bps integer, estimate_strategy text, enabled boolean,
  pricing_active boolean, kill_switch boolean not null default false, sort_order integer, config jsonb,
  min_viable_budget_credits numeric, pricing_version integer default 1
);
create table public.credit_accounts (user_id uuid primary key, balance numeric(12,4) not null check (balance >= 0), reserved numeric(18,4) not null default 0);
create table public.credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, balance_before numeric,
  balance_after numeric, type text, reference text, metadata jsonb, created_at timestamptz default now());
create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(), user_id uuid, product_code text, status text, authorized_max_credits numeric,
  reserved_credits numeric, settled_credits numeric default 0, released_credits numeric default 0, idempotency_key text unique,
  job_ref text, metadata jsonb, created_at timestamptz default now()
);
create table public.usage_events (id uuid primary key default gen_random_uuid(), reservation_id uuid, user_id uuid, product_code text,
  charged_credits numeric, created_at timestamptz default now());

create or replace function public.wallet_reserve(p_user_id uuid, p_product_code text, p_authorized_max_credits numeric,
  p_idempotency_key text, p_estimate_min_credits numeric default 0, p_estimate_max_credits numeric default 0,
  p_job_ref text default null, p_metadata jsonb default '{}'::jsonb)
returns table (reservation_id uuid, reserved_credits numeric, balance_after numeric, was_duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare v_ex record; v_p record; v_before numeric; v_res uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) = 0 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into v_ex from public.usage_reservations u where u.idempotency_key = p_idempotency_key;
  if found then return query select v_ex.id, v_ex.reserved_credits, (select balance from public.credit_accounts where user_id = v_ex.user_id), true; return; end if;
  select * into v_p from public.billable_products where code = p_product_code;
  if not found then raise exception 'UNKNOWN_PRODUCT'; end if;
  if not v_p.enabled then raise exception 'PRODUCT_DISABLED'; end if;
  if v_p.kill_switch then raise exception 'PRODUCT_KILL_SWITCH'; end if;
  select balance into v_before from public.credit_accounts where user_id = p_user_id for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if v_before < p_authorized_max_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;
  update public.credit_accounts set balance = balance - p_authorized_max_credits, reserved = reserved + p_authorized_max_credits where user_id = p_user_id;
  insert into public.usage_reservations (user_id, product_code, status, authorized_max_credits, reserved_credits, idempotency_key, job_ref, metadata)
  values (p_user_id, p_product_code, 'RESERVED', p_authorized_max_credits, p_authorized_max_credits, p_idempotency_key, p_job_ref, p_metadata)
  returning id into v_res;
  insert into public.credit_ledger (user_id, amount, balance_before, balance_after, type, reference)
  values (p_user_id, -p_authorized_max_credits, v_before, v_before - p_authorized_max_credits, 'SERVICE_RESERVE', 'res:' || v_res);
  return query select v_res, p_authorized_max_credits, v_before - p_authorized_max_credits, false;
end $$;

create or replace function public.wallet_settle(p_reservation_id uuid, p_actual_credits numeric, p_usage jsonb default '{}'::jsonb, p_outcome text default 'SUCCESS')
returns table (reservation_id uuid, settled_credits numeric, released_credits numeric, balance_after numeric, was_duplicate boolean, clamped boolean)
language plpgsql security definer set search_path = public as $$
declare v_r record; v_charge numeric; v_release numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into v_r from public.usage_reservations u where u.id = p_reservation_id for update;
  if v_r.status <> 'RESERVED' then return query select v_r.id, v_r.settled_credits, v_r.released_credits, null::numeric, true, false; return; end if;
  v_charge := least(p_actual_credits, v_r.authorized_max_credits); v_release := v_r.authorized_max_credits - v_charge;
  update public.credit_accounts set balance = balance + v_release, reserved = reserved - v_r.authorized_max_credits where user_id = v_r.user_id;
  update public.usage_reservations set status = 'SETTLED', settled_credits = v_charge, released_credits = v_release where id = v_r.id;
  insert into public.credit_ledger (user_id, amount, type, reference) values (v_r.user_id, 0, 'SERVICE_CAPTURE', 'res:' || v_r.id);
  insert into public.usage_events (reservation_id, user_id, product_code, charged_credits) values (v_r.id, v_r.user_id, v_r.product_code, v_charge);
  return query select v_r.id, v_charge, v_release, (select balance from public.credit_accounts where user_id = v_r.user_id), false, false;
end $$;

/* People. a1 = seller (owner of P1, P2), a2 = second seller (owns P3), b1..b4 = members looking. */
insert into public.users (id, auth_id, email, full_name, nickname, phone, preferred_language) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'seller@x.test', 'Nino Seller', null, '+995555000001', 'ka'),
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', 'seller2@x.test', 'Giorgi Two', null, null, 'ka'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'buyer1@x.test', 'Layla Buyer', 'Layla', '+971500000001', 'ar'),
  ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', 'buyer2@x.test', 'Ivan Premium', null, '+79000000002', 'ru'),
  ('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000b3', 'buyer3@x.test', 'Opted Out', null, null, 'en'),
  ('00000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-0000000000b4', 'buyer4@x.test', 'Inactive Search', null, null, 'en');
insert into public.credit_accounts (user_id, balance) values
  ('00000000-0000-0000-0000-0000000000a1', 20), ('00000000-0000-0000-0000-0000000000a2', 3);

insert into public.properties (id, user_id, homatch_id, title, transaction_type, property_type) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 100001, 'Krtsanisi 2BR', 'SALE', 'APARTMENT'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 100002, 'Ortachala 2BR', 'SALE', 'APARTMENT'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 100003, 'Other seller', 'SALE', 'APARTMENT');

insert into public.intent_profiles (id, intent_type, country, city, district, transaction_type, property_types, bedrooms_min, budget_min, budget_max, currency, original_text) values
  ('00000000-0000-0000-0000-0000000000c1', 'BUYER', 'GE', 'Tbilisi', 'Krtsanisi', 'SALE', '{APARTMENT}', 2, 150000, 220000, 'USD', 'PRIVATE TEXT b1'),
  ('00000000-0000-0000-0000-0000000000c2', 'BUYER', 'GE', 'Tbilisi', 'Krtsanisi', 'SALE', '{APARTMENT}', 2, 300000, 450000, 'USD', 'PRIVATE TEXT b2'),
  ('00000000-0000-0000-0000-0000000000c3', 'BUYER', 'GE', 'Tbilisi', null, 'SALE', '{APARTMENT}', 2, null, 200000, 'USD', 'PRIVATE TEXT b3'),
  ('00000000-0000-0000-0000-0000000000c4', 'BUYER', 'GE', 'Tbilisi', null, 'SALE', '{APARTMENT}', 2, null, 200000, 'USD', 'PRIVATE TEXT b4');
insert into public.active_search_subscriptions (user_id, intent_id, side, is_active) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'SUPPLY', true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'SUPPLY', true),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c3', 'SUPPLY', true),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c4', 'SUPPLY', false);

-- b1 and b2 match both of a1's listings; b3 opted out; b4's search is inactive; b1 also matches a2's listing.
insert into public.supply_matches (id, intent_profile_id, property_id, supply_user_id, demand_user_id, source_kind, compatibility, match_score, agreed, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.62, '{TRANSACTION,CITY,DISTRICT,PROPERTY_TYPE}', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.91, '{TRANSACTION,CITY,DISTRICT,PROPERTY_TYPE,PRICE}', now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b3', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.95, '{TRANSACTION,CITY}', now()),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b4', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.95, '{TRANSACTION,CITY}', now()),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.70, '{TRANSACTION,CITY,PROPERTY_TYPE}', now()),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'INTERNAL_HOMATCH', 'COMPATIBLE', 0.66, '{TRANSACTION,CITY,PROPERTY_TYPE}', now());
