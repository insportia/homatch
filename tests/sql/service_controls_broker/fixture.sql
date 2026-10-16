-- Stand-ins for the objects broker_directory_purchase() reads (production: 20260930140000_broker_lifecycle
-- and earlier). Columns are the ones the function touches. The function and the purchases table
-- themselves are NOT stand-ins: run.sh extracts both verbatim from the production migration.
create type public.ledger_type as enum ('PURCHASE', 'BROKER_DIRECTORY_LISTING');
create function public.auth_user_id() returns uuid language sql stable as $$
  select u.id from public.users u where u.auth_id = auth.uid() $$;
create function public.is_user_suspended(p_user_id uuid) returns boolean language sql stable as $$ select false $$;
grant execute on function public.auth_user_id() to authenticated;
create table public.broker_directory_listings (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid not null, display_name text,
  status text not null, paid_until timestamptz, updated_at timestamptz not null default now());
create table public.billable_products (
  code text primary key, enabled boolean, kill_switch boolean, pricing_active boolean,
  standard_retail_cents int, config jsonb);
create table public.credit_accounts (user_id uuid primary key, balance numeric not null, updated_at timestamptz);
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, balance_before numeric,
  balance_after numeric, type public.ledger_type, reference text, metadata jsonb, created_at timestamptz default now());
-- The broker (users.id bbbb…, signs in as b000…): 500 credits, an ACTIVE listing paid for 5 more days.
insert into public.broker_directory_listings (owner_user_id, display_name, status, paid_until)
  values ('b0000000-0000-0000-0000-00000000000b', 'Nino Broker', 'ACTIVE', now() + interval '5 days');
insert into public.billable_products values ('BROKER_DIRECTORY_LISTING', true, false, true, 1000, '{"duration_days": 30}');
insert into public.credit_accounts values ('bbbbbbbb-0000-0000-0000-00000000000b', 500, now());
