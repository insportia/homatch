-- Fixture for 20261127090000_verify_fixed_price_validity.sql, on top of the
-- verify_credit_budget fixture + migrations (tests/sql/run-verify-billing.sh).
-- Only what that migration reads or writes, shaped as in production.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null, target_id uuid,
  action text not null, entity_type text, entity_id text, metadata jsonb default '{}'::jsonb, created_at timestamptz not null default now());

create table if not exists public.finance_services (
  service_key text primary key, name text not null, product_codes text[] not null default '{}', policy_id text not null,
  pricing_kind text not null, price_note text not null, service_control_key text, sort_order integer not null default 100);
insert into public.finance_services (service_key, name, product_codes, policy_id, pricing_kind, price_note)
values ('verify', 'Verify', '{VERIFY}', 'verify_cost_floor_v1', 'VARIABLE', 'Cost-based')
on conflict do nothing;

alter table public.research_jobs add column if not exists synthesis_state text default 'NONE';
alter table public.research_jobs add column if not exists completed_at timestamptz;

create table if not exists public.retention_records (
  id uuid primary key default gen_random_uuid(), product text not null, source_id uuid not null, owner_user_id uuid,
  available_at timestamptz not null, expires_at timestamptz, policy text not null, state text not null default 'ACTIVE',
  label text, payload_bytes bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (product, source_id));

-- As in 20261102090000_storage_retention_lifecycle.sql.
create or replace function public.retention_expiry(p_available_at timestamptz)
returns timestamptz language sql immutable parallel safe set search_path to '' as $$
  select ((p_available_at at time zone 'UTC') + interval '30 days') at time zone 'UTC'
$$;
create or replace function public.retention_access_blocked(p_product text, p_source_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.retention_records r
                  where r.product = p_product and r.source_id = p_source_id
                    and r.expires_at is not null and r.expires_at <= now())
$$;
