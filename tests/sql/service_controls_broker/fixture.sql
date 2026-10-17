-- Stand-ins for the objects the production broker functions read (production: 20260926270000,
-- 20260930140000, 20261001120000). Columns are the ones those functions touch. The purchase
-- function, the purchases table, the public directory view and the expiry sweep are NOT
-- stand-ins: run.sh extracts all four verbatim from the production migrations.
create type public.ledger_type as enum ('PURCHASE', 'BROKER_DIRECTORY_LISTING');
create type public.notification_type as enum ('BROKER_APPLICATION');
create function public.auth_user_id() returns uuid language sql stable as $$
  select u.id from public.users u where u.auth_id = auth.uid() $$;
create function public.is_user_suspended(p_user_id uuid) returns boolean language sql stable as $$ select false $$;
grant execute on function public.auth_user_id() to authenticated;
create table public.notifications_sent (user_id uuid, title text, dedupe text);
create function public.notify_emit(p_user uuid, p_type public.notification_type, p_title text, p_body text,
  p_priority text, p_link text, p_entity text, p_entity_id uuid, p_dedupe text) returns void language sql as $$
  insert into public.notifications_sent values (p_user, p_title, p_dedupe) $$;
create table public.broker_directory_listings (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null, broker_id uuid default gen_random_uuid(),
  display_name text, role text default 'BROKER', country_code text default 'GE', cities text[], languages text[],
  contact_phone text, contact_email text, website text, about text, contact_person text, logo_url text,
  property_types text[], deal_kinds text[], districts text[], experience_years integer, whatsapp text, telegram text,
  segments text[], verification_state text default 'UNVERIFIED',
  status text not null, paid_until timestamptz, updated_at timestamptz not null default now());
alter table public.broker_directory_listings enable row level security;
create table public.billable_products (
  code text primary key, enabled boolean, kill_switch boolean, pricing_active boolean,
  standard_retail_cents int, config jsonb);
create table public.credit_accounts (user_id uuid primary key, balance numeric not null, updated_at timestamptz);
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, balance_before numeric,
  balance_after numeric, type public.ledger_type, reference text, metadata jsonb, created_at timestamptz default now());
insert into public.users values
  ('cccccccc-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', false),
  ('dddddddd-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000d', false);
-- Nino (bbbb…): 500 credits, an ACTIVE listing paid for 5 more days.
-- Giorgi (cccc…): ACTIVE, paid until 2 hours from now — his period ends during the pause.
-- Tamar (dddd…): EXPIRED yesterday.
insert into public.broker_directory_listings (owner_user_id, display_name, status, paid_until) values
  ('b0000000-0000-0000-0000-00000000000b', 'Nino Broker', 'ACTIVE', now() + interval '5 days'),
  ('c0000000-0000-0000-0000-00000000000c', 'Giorgi Realty', 'ACTIVE', now() + interval '2 hours'),
  ('d0000000-0000-0000-0000-00000000000d', 'Tamar Homes', 'EXPIRED', now() - interval '1 day');
insert into public.billable_products values ('BROKER_DIRECTORY_LISTING', true, false, true, 1000, '{"duration_days": 30}');
insert into public.credit_accounts values ('bbbbbbbb-0000-0000-0000-00000000000b', 500, now()),
  ('cccccccc-0000-0000-0000-00000000000c', 500, now());
