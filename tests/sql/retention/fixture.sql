-- Minimal stand-ins for the production objects that
-- 20261102090000_storage_retention_lifecycle.sql reads or writes. Column
-- names and types match production (checked read-only 2026-10-15); only what
-- the migration touches is present.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator nologin; exception when duplicate_object then null; end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;

create table public.admin_settings (key text primary key, value jsonb, description text);
create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, is_admin boolean default false);
create function public.is_admin() returns boolean language sql stable as $$
  select coalesce((select is_admin from public.users where auth_id = auth.uid()), false) $$;

create type public.notification_type as enum ('VERIFY_COMPLETE', 'DOCUMENT_ANALYZED');
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type public.notification_type,
  title text, body text, dedupe_key text, metadata jsonb, created_at timestamptz default now(), unique (user_id, dedupe_key));
create function public.notify_emit(p_user_id uuid, p_type public.notification_type, p_title text, p_body text default null,
  p_priority text default 'NORMAL', p_deep_link text default null, p_entity_type text default null, p_entity_id uuid default null,
  p_dedupe_key text default null, p_group_key text default null, p_group_window interval default interval '5 minutes',
  p_group_title_template text default null, p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer as $$
declare v uuid;
begin
  insert into public.notifications (user_id, type, title, body, dedupe_key, metadata)
  values (p_user_id, p_type, p_title, p_body, p_dedupe_key, p_metadata)
  on conflict (user_id, dedupe_key) do update set title = public.notifications.title returning id into v;
  return v;
end $$;

create table public.research_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid, mode text not null default 'property', query text not null default 'q',
  status text not null default 'CREATED', target_url text, verification_url text, verification_instructions text,
  evidence jsonb not null default '[]', result_json jsonb, error text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), completed_at timestamptz, response_id text, progress jsonb not null default '{}',
  captcha jsonb, documents jsonb not null default '[]', evidence_bundle jsonb not null default '[]', title text,
  deleted_at timestamptz, lifecycle_state text not null default 'ACTIVE', purged_at timestamptz,
  synthesis_json jsonb, synthesis_state text not null default 'NONE', synthesis_at timestamptz, anon_session_id uuid);
alter table public.research_jobs enable row level security;
alter table public.research_jobs force row level security;
create policy research_jobs_owner on public.research_jobs for select to authenticated using (auth.uid() = user_id);
grant select on public.research_jobs to authenticated;

create table public.verify_billing (job_id uuid primary key references public.research_jobs(id) on delete restrict, amount numeric);
create table public.human_verification_handoffs (id uuid primary key default gen_random_uuid(),
  research_job_id uuid not null references public.research_jobs(id) on delete cascade, status text not null default 'PENDING',
  expires_at timestamptz not null);

create table public.deal_rooms (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  verify_job_id uuid references public.research_jobs(id) on delete set null, verify_snapshot jsonb, deleted_at timestamptz);
create table public.deal_room_documents (
  id uuid primary key default gen_random_uuid(), deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null, doc_key text not null, label text not null, state text not null default 'RECOMMENDED',
  evidence_ref text, storage_path text, mime_type text, size_bytes bigint, uploaded_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), original_filename text,
  sha256 text, analysis_state text not null default 'NONE', analysis_error text, analyzed_at timestamptz, analysis jsonb,
  analysis_sha256 text, display_name text, category text, archived_at timestamptz, extracted_text text,
  extracted_pages integer, headline_summary text, unique (deal_room_id, doc_key));
alter table public.deal_room_documents enable row level security;
create policy deal_room_documents_owner on public.deal_room_documents for select to authenticated using (user_id = auth.uid());
grant select on public.deal_room_documents to authenticated;
create table public.deal_room_document_findings (id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.deal_room_documents(id) on delete cascade, deal_room_id uuid not null,
  user_id uuid not null, finding_type text not null, label text not null, value text, quote text,
  severity text not null default 'INFO');
alter table public.deal_room_document_findings enable row level security;
create policy deal_room_document_findings_owner on public.deal_room_document_findings for select to authenticated using (user_id = auth.uid());
grant select on public.deal_room_document_findings to authenticated;
create table public.deal_room_document_events (id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.deal_room_documents(id) on delete cascade, deal_room_id uuid not null,
  user_id uuid not null, event_type text not null, detail jsonb not null default '{}');

create schema storage;
grant usage on schema storage to authenticated;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create policy deal_room_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-room-documents' and split_part(name, '/', 1) = auth.uid()::text);
grant select on storage.objects to authenticated;

create table public.storage_objects (id uuid primary key default gen_random_uuid(), provider text not null, namespace text not null,
  object_key text unique not null, byte_size bigint not null default 0, lifecycle text not null default 'ACTIVE',
  source_bucket text, source_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz);

-- pg_cron stand-in (names and columns the schedule toggle touches).
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  delete from cron.job where jobname = p_name returning true $$;
