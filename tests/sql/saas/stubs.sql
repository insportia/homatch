do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key, email_confirmed_at timestamptz, phone_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'service_role') $$;
create type notification_type as enum ('LOW_CREDITS');
create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, email text, is_admin boolean default false, suspended_at timestamptz,
  full_name text, username text, account_type text default 'PERSONAL', created_at timestamptz not null default now());
create table public.credit_accounts (user_id uuid primary key, balance numeric default 0, reserved numeric default 0);
create table public.admin_settings (key text primary key, value jsonb);
create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid not null, target_id uuid, action text not null,
  entity_type text, entity_id text, metadata jsonb, created_at timestamptz not null default now());
create table public.billing_plans (code text primary key, name text, monthly_price_cents int default 0, quality_tier text, sort_order int, enabled boolean, config jsonb);
insert into public.billing_plans values ('FREE','Free',0,'STANDARD',1,true,'{}'),('VIP','VIP',900,'ENHANCED',2,true,'{}'),('PREMIUM','Premium',2900,'MAXIMUM',3,true,'{}');
create or replace function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin) $$;
create or replace function public.auth_user_id() returns uuid language sql stable as $$ select u.id from public.users u where u.auth_id = auth.uid() $$;
create or replace function public.billing_setting_num(p_key text, p_default numeric) returns numeric language sql stable as $$
  select coalesce((select (value #>> '{}')::numeric from public.admin_settings where key = p_key), p_default) $$;
create or replace function public.verify_wallet_user(p_auth_id uuid) returns uuid language sql stable as $$ select u.id from public.users u where u.auth_id = p_auth_id $$;
create table public.research_jobs (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.verify_billing (job_id uuid primary key);
create or replace function public.verify_billing_open(p_job_id uuid, p_user_id uuid, p_idempotency_key text,
  p_extend boolean default false, p_expected_authorizations integer default null, p_expected_credits numeric default null)
returns jsonb language plpgsql as $$
declare v_bal numeric;
begin
  select balance into v_bal from public.credit_accounts where user_id = public.verify_wallet_user(p_user_id);
  if coalesce(v_bal, 0) < 19 then return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS'); end if;
  insert into public.verify_billing values (p_job_id) on conflict do nothing;
  return jsonb_build_object('ok', true, 'priceMode', 'FIXED', 'priceCredits', 19);
end $$;
create or replace function public.verify_billing_close(p_job_id uuid, p_outcome text) returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'wallet', true, 'outcome', p_outcome) $$;
create or replace function public.verify_launch_quote() returns jsonb language sql stable as $$ select jsonb_build_object('priceCredits', 19) $$;
-- internal leads (minimal)
create table public.internal_lead_unlock_batches (id uuid primary key, account_user_id uuid, idempotency_key text, result jsonb);
create table public.internal_lead_unlocks (id uuid primary key default gen_random_uuid(), account_user_id uuid, lead_user_id uuid, first_match_id uuid,
  first_property_id uuid, segment text, unit_price_credits numeric, credits_charged numeric, reservation_id uuid, batch_id uuid);
create table public.lead_crm_entries (id uuid primary key default gen_random_uuid(), owner_user_id uuid, lead_user_id uuid, unlock_id uuid, property_id uuid,
  status text, updated_at timestamptz, unique (owner_user_id, lead_user_id));
create table public.lead_crm_events (entry_id uuid, kind text, detail jsonb);
create or replace function public.internal_lead_prices() returns jsonb language sql stable as $$
  select '{"STANDARD":3,"EXACT":5,"PREMIUM":10,"MORTGAGE":3,"MORTGAGE_MATCH":5,"EXPAT":5,"active":true,"mortgageActive":true,"mortgageMatchActive":true,"expatActive":true}'::jsonb $$;
create or replace function public.internal_lead_pick(p_user uuid, p_ids uuid[])
returns table (match_id uuid, lead_user_id uuid, intent_profile_id uuid, property_id uuid, price_key text) language sql stable as $$
  select x, x, null::uuid, null::uuid, 'STANDARD' from unnest(p_ids) x $$;
create or replace function public.wallet_reserve(p_user uuid, p_product text, p_amt numeric, p_key text, a numeric, b numeric, c text, d jsonb)
returns table (reservation_id uuid) language plpgsql as $$
begin
  update public.credit_accounts set balance = balance - p_amt where user_id = p_user and balance >= p_amt;
  if not found then raise exception 'INSUFFICIENT_CREDITS'; end if;
  return query select gen_random_uuid();
end $$;
create or replace function public.wallet_settle(p_res uuid, p_amt numeric, p_meta jsonb, p_state text) returns void language sql as $$ select $$;
create or replace function public.internal_leads_unlock_quote_for(p_user_id uuid, p_match_ids uuid[]) returns jsonb language sql stable as $$
  select jsonb_build_object('totalCredits', 3 * coalesce(array_length(p_match_ids, 1), 0),
    'balance', (select balance from public.credit_accounts where user_id = p_user_id)) $$;
create or replace function public.internal_leads_unlock(p_user_id uuid, p_match_ids uuid[], p_idempotency_key text, p_expected_credits numeric default null)
returns jsonb language sql as $$ select '{}'::jsonb $$;
