-- Finance V2.1 fixture: production shapes the V2.1 migration touches but the earlier fixtures lack.
do $$ begin
  create type public.cost_provider as enum ('DATAFORSEO','APIFY','ZENROWS','SCRAPINGBEE','BRIGHTDATA','OPENAI','OTHER','APIFY_MEMO23');
exception when duplicate_object then null; end $$;
drop view if exists public.finance_v2_cost_lines; -- recreated by the V2.1 migration
alter table public.cost_events alter column provider type public.cost_provider using provider::public.cost_provider;
alter table public.usage_reservations add column if not exists expires_at timestamptz default (now() + interval '1 hour');
create or replace function public.wallet_release(p_reservation_id uuid, p_reason text) returns void language plpgsql as $$
begin update public.usage_reservations set status = 'RELEASED' where id = p_reservation_id and status = 'RESERVED'; end $$;
create table if not exists public.finance_fixed_expenses (id uuid primary key default gen_random_uuid(), name text, vendor text, category text, amount_cents bigint, currency text, billing_frequency text, starts_at date, renews_at date, ends_at date, active boolean, notes text, reference_url text, counts_as_cogs boolean, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(), superseded_by uuid, reversal_of uuid, reversal_reason text);
