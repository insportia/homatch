-- Finance V2 fixture: the production column shapes (2026-10-19, enums as text) of every
-- table the finance ledger reads, on top of the Find Property paid social fixtures.
\set ON_ERROR_STOP on
create table if not exists public.cost_events (id uuid primary key default gen_random_uuid(), provider text, operation_type text, source text, market text, request_id text, units numeric, cost_usd numeric, success boolean, cache_hit boolean, property_id uuid, signal_id uuid, "timestamp" timestamptz default now(), job_id uuid, discovery_job_id uuid, pricing_state text);
create table if not exists public.credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, balance_before numeric, balance_after numeric, type text, reference text, payment_id uuid, created_at timestamptz default now(), metadata jsonb);
create table if not exists public.discovery_marketplace_searches (id uuid primary key default gen_random_uuid(), user_id uuid, status text, telemetry jsonb, properties_count integer, created_at timestamptz default now());
create table if not exists public.find_buyers_actor_runs (id uuid primary key default gen_random_uuid(), idempotency_key text, matching_job_id uuid, actor_key text, operation text, status text, reserved_micros bigint, estimated_micros bigint, actual_micros bigint, cost_basis text, results_billed integer, created_at timestamptz default now(), finished_at timestamptz);
create table if not exists public.find_buyers_budget_extensions (id uuid primary key default gen_random_uuid(), matching_job_id uuid, user_id uuid, reservation_id uuid, previous_total_credits integer, additional_credits integer, total_after_credits integer, provider_budget_added_micros bigint, idempotency_key text unique, status text, settled_credits numeric, created_at timestamptz default now(), settled_at timestamptz);
create table if not exists public.find_buyers_campaigns (matching_job_id uuid primary key, campaign_id uuid, property_id uuid, user_id uuid, transaction text, credits_committed integer, credits_per_usd numeric, customer_value_micros bigint, provider_budget_micros bigint, finalized_at timestamptz, created_at timestamptz default now(),
  pricing_policy text constraint find_buyers_campaigns_pricing_policy_check check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1')));
create table if not exists public.find_buyers_cost_ledger (id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(), matching_job_id uuid, kind text, provider text, operation text, model text, input_tokens integer, output_tokens integer, estimated_micros bigint, actual_micros bigint, cost_state text, after_settlement boolean);
create table if not exists public.meta_ads_ledger (id bigserial primary key, user_id uuid, entry_type text, amount_cents bigint, currency text, campaign_id uuid, created_at timestamptz default now());
create table if not exists public.provider_price_book (id uuid primary key default gen_random_uuid(), provider text, model text, unit text, rate numeric, per_units numeric, currency text, effective_from timestamptz, effective_to timestamptz, source text, notes text);
create table if not exists public.verify_captcha_events (id uuid primary key default gen_random_uuid(), job_id uuid, provider text, kind text, cost_usd numeric, created_at timestamptz default now());
create table if not exists public.voice_usage_events (id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(), session_id uuid, provider text, role text, model text, characters integer, audio_seconds numeric, input_tokens integer, output_tokens integer, cost_usd numeric, cached_input_tokens integer);
alter table public.find_buyers_actor_runs add column if not exists matching_job_id uuid, add column if not exists actor_key text,
  add column if not exists operation text, add column if not exists status text, add column if not exists reserved_micros bigint,
  add column if not exists estimated_micros bigint, add column if not exists actual_micros bigint, add column if not exists cost_basis text,
  add column if not exists results_billed integer, add column if not exists created_at timestamptz default now(), add column if not exists finished_at timestamptz;
alter table public.usage_events add column if not exists provider text, add column if not exists provider_operation text, add column if not exists provider_request_id text,
  add column if not exists model text, add column if not exists input_tokens bigint, add column if not exists cached_tokens bigint, add column if not exists output_tokens bigint,
  add column if not exists raw_provider_cost_cents numeric, add column if not exists ai_cost_cents numeric, add column if not exists released_credits numeric,
  add column if not exists job_ref text, add column if not exists metadata jsonb default '{}'::jsonb, add column if not exists pricing_state text;
alter table public.discovery_runs add column if not exists pricing_policy text;
alter table public.discovery_runs drop constraint if exists discovery_runs_pricing_policy_check;
alter table public.discovery_runs add constraint discovery_runs_pricing_policy_check check (pricing_policy is null or pricing_policy in ('paid_discovery_37_63_v1'));

/* Production functions the finance layer calls (exact bodies where it matters). */
create or replace function public.price_per_unit_at(p_provider text, p_model text, p_unit text, p_at timestamptz)
returns numeric language sql stable set search_path to 'public' as $$
  select (b.rate / b.per_units) from public.provider_price_book b
   where b.provider = p_provider and b.unit = p_unit and b.effective_from <= p_at
     and (b.effective_to is null or b.effective_to > p_at) and (b.model = p_model or b.model is null)
   order by (b.model = p_model) desc nulls last, b.effective_from desc limit 1
$$;
create or replace function public.finance_require_admin() returns void language plpgsql as $$
begin if coalesce(current_setting('app.finance_admin', true), '') <> 'yes' then raise exception 'FORBIDDEN'; end if; end $$;
create or replace function public.service_controls_public()
returns table (service_key text, frontend_enabled boolean, backend_enabled boolean) language sql stable as $$
  values ('verify', true, true), ('find_buyers', true, true), ('find_property_deep', false, false), ('brokers_directory', false, false)
$$;
insert into public.admin_settings (key, value) values ('credits_per_usd', '10') on conflict (key) do nothing;
insert into public.credit_ledger (user_id, amount, type, reference, created_at) values (gen_random_uuid(), 0, 'REDENOMINATION', 'redenomination', '2026-09-11T19:35:00Z');

/* Tables an earlier fixture created with fewer columns: add what the finance views read. */
do $$
declare spec text[] := array[
  'cost_events:provider text,operation_type text,source text,request_id text,units numeric,cost_usd numeric,timestamp timestamptz,job_id uuid,discovery_job_id uuid,pricing_state text',
  'credit_ledger:user_id uuid,amount numeric,type text,reference text,created_at timestamptz',
  'find_property_actor_runs:discovery_run_id uuid,actor_key text,stage text,status text,reserved_micros bigint,actual_micros bigint,results_billed integer,created_at timestamptz',
  'discovery_marketplace_searches:telemetry jsonb,created_at timestamptz',
  'find_buyers_cost_ledger:occurred_at timestamptz,matching_job_id uuid,kind text,provider text,operation text,model text,input_tokens integer,output_tokens integer,estimated_micros bigint,actual_micros bigint,cost_state text,after_settlement boolean'];
  t text; c text;
begin
  foreach t in array spec loop
    foreach c in array string_to_array(split_part(t, ':', 2), ',') loop
      execute format('alter table public.%I add column if not exists %s %s', split_part(t, ':', 1), quote_ident(split_part(c, ' ', 1)), split_part(c, ' ', 2));
    end loop;
  end loop;
end $$;
