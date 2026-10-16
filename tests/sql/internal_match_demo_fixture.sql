-- Minimal fixture of the production objects 20261024120000_internal_match_demo.sql
-- reads (columns read from production information_schema, 2026-10-09), plus the
-- real tables the demo must NEVER write, so the test can prove it does not.
-- Run: tests/sql/run-internal-match-demo.sh
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on all functions in schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;

create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid not null, is_admin boolean not null default false);
create or replace function public.is_admin() returns boolean language sql stable set search_path to ''
  as $$ select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin = true) $$;
create or replace function public.current_homatch_user_id() returns uuid language sql stable security definer set search_path = public
  as $$ select id from public.users where auth_id = auth.uid() limit 1 $$;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_homatch_user_id() to authenticated;

create type public.transaction_type as enum ('SALE', 'RENT');
create type public.property_type as enum ('APARTMENT', 'HOUSE');
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  homatch_id integer,
  title text,
  transaction_type public.transaction_type,
  property_type public.property_type,
  listed_by_role text not null default 'OWNER',
  is_deleted boolean not null default false
);
create table public.property_facts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  city text, district text, total_price numeric, currency text, area numeric, rooms integer, bedrooms integer,
  updated_at timestamptz not null default now()
);
create table public.admin_settings (
  id uuid primary key default gen_random_uuid(), key text unique not null, value jsonb, description text,
  updated_by uuid, updated_at timestamptz default now()
);

/* The real surfaces a demo must never reach. */
create table public.supply_matches (id uuid primary key default gen_random_uuid(), property_id uuid, source_kind text, supply_user_id uuid, demand_user_id uuid);
create table public.native_property_relationships (id uuid primary key default gen_random_uuid(), property_id uuid, supply_user_id uuid, demand_user_id uuid);
create table public.matches (id uuid primary key default gen_random_uuid(), property_id uuid);
create table public.find_buyers_leads (id uuid primary key default gen_random_uuid(), property_id uuid);
create table public.conversations (id uuid primary key default gen_random_uuid(), initiator_id uuid, recipient_id uuid, property_id uuid);
create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, body text);
create table public.message_receipts (id uuid primary key default gen_random_uuid(), message_id uuid);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.credit_transactions (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.matching_campaigns (id uuid primary key default gen_random_uuid(), property_id uuid);

/* People: the property's owner (an administrator, as in production), a member who is
   neither admin nor tester, and a member who will be listed as a tester. */
insert into public.users (id, auth_id, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', true),
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', false),
  ('00000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a3', false);
insert into public.properties (id, user_id, homatch_id, title, transaction_type, property_type, listed_by_role)
values ('c5c1a6a4-6fed-4764-91c2-3cd7ad090407', '00000000-0000-0000-0000-0000000000a1', 244486, 'Krtsanisi St 6', 'SALE', 'APARTMENT', 'OWNER'),
       ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3', 100003, 'tester own', 'SALE', 'APARTMENT', 'OWNER');
insert into public.property_facts (property_id, city, district, total_price, currency, area, rooms, bedrooms)
values ('c5c1a6a4-6fed-4764-91c2-3cd7ad090407', 'Tbilisi', 'Krtsanisi', 213840, 'USD', 97.2, 3, 2);
