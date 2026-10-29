-- Minimal production shapes 20261207140000_email_marketing_hidden.sql reads (columns as in
-- production; only what the migration and its proofs touch). Throwaway database only.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, is_admin boolean default false);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null, target_id uuid, action text not null,
  entity_type text, entity_id text, metadata jsonb default '{}'::jsonb, created_at timestamptz not null default now());

create table public.service_controls (
  service_key text primary key,
  frontend_enabled boolean not null default false, backend_enabled boolean not null default false,
  version integer not null default 1, reason text, updated_by uuid, updated_at timestamptz not null default now(),
  service_group text not null default 'other',
  constraint service_controls_visible_needs_backend check (not frontend_enabled or backend_enabled),
  constraint service_controls_service_key_check check (service_key in (
    'publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio',
    'find_property', 'find_property_deep', 'find_buyers', 'find_buyers_external', 'internal_matching', 'curated_leads',
    'verify', 'contracts', 'mortgage', 'investment', 'for_expats', 'meta_ads', 'email_campaigns', 'ai_assistant',
    'brokers_directory', 'broker_desk', 'developers')));
insert into public.service_controls (service_key, frontend_enabled, backend_enabled, service_group, reason) values
  ('ai_call_center', false, false, 'communications', 'Initial state: paused by the owner'),
  ('email_campaigns', true, true, 'marketing', null),
  ('meta_ads', true, true, 'marketing', 'Initial state: live');

create function public.service_backend_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.backend_enabled from public.service_controls c where c.service_key = p_key), false);
$$;

create table public.finance_services (service_key text primary key, service_control_key text);
insert into public.finance_services values ('email_marketing', 'email_campaigns'), ('email_studio', 'email_campaigns'), ('verify', 'verify');

create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(), owner_id uuid, name text, campaign_type text not null, status text not null default 'DRAFT',
  scheduled_at timestamptz, launched_at timestamptz, updated_at timestamptz not null default now(),
  send_eligibility text not null default 'PRODUCTION', approved_content_hash text, content_hash text,
  contact_list_id uuid, contact_list_ids uuid[], metadata jsonb not null default '{}'::jsonb, last_send_error text);

-- Production: the next batch of recipients. Here: one recipient while the list is set.
create function public.outreach_email_campaign_batch(p_campaign uuid, p_limit integer)
returns table (contact_id uuid) language sql stable as $$
  select gen_random_uuid() from public.outreach_campaigns c where c.id = p_campaign and c.contact_list_id is not null limit p_limit;
$$;

create table public.email_studio_campaigns (
  id uuid primary key default gen_random_uuid(), owner_user_id uuid, status text not null default 'DRAFT', name text,
  scheduled_at timestamptz, scheduled_hash text, schedule_timezone text, schedule_state text, schedule_attempted_at timestamptz,
  updated_at timestamptz not null default now());
