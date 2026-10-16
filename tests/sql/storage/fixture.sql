-- Minimal stand-ins for what 20261107090000_storage_r2_routing.sql touches.
create extension if not exists pgcrypto;
do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.users (id uuid primary key, auth_id uuid unique, is_admin boolean not null default false);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_admin from public.users u where u.auth_id = auth.uid()), false) $$;
grant execute on function public.is_admin() to anon, authenticated, service_role;
create table public.admin_settings (key text primary key, value jsonb, description text);
create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid not null, target_id uuid,
  action text not null, entity_type text, entity_id text, metadata jsonb, created_at timestamptz not null default now());

create schema if not exists storage;
create table storage.buckets (id text primary key, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, created_at timestamptz default now());
create table public.storage_objects (id uuid primary key default gen_random_uuid(), provider text not null default 'R2', namespace text not null,
  object_key text unique not null, byte_size bigint not null default 0, lifecycle text not null default 'ACTIVE', category text,
  source_bucket text, source_path text, verified_at timestamptz, created_at timestamptz not null default now());
-- tables other storage_authorize branches read (not exercised here)
create table public.ds_projects (id uuid primary key, user_id uuid);
create table public.properties (id uuid primary key, user_id uuid, is_deleted boolean default false);
create table public.property_photos (property_id uuid, storage_path text, visibility text);
create table public.deal_rooms (id uuid primary key, user_id uuid, deleted_at timestamptz);
create table public.deal_room_documents (user_id uuid, storage_path text);
create table public.dev_documents (workspace_id uuid, storage_path text);
create or replace function public.dev_can(p uuid, c text) returns boolean language sql as $$ select false $$;

insert into public.users values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', false),  -- owner
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', false),  -- someone else
  ('cccccccc-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', true);   -- admin
insert into storage.buckets values ('meta-ads-media', false), ('verify-evidence', false);
insert into storage.objects (bucket_id, name, metadata) values
  ('meta-ads-media', 'aaaaaaaa-0000-0000-0000-00000000000a/x.png', '{"size": 100}'),
  ('meta-ads-media', 'aaaaaaaa-0000-0000-0000-00000000000a/y.png', '{"size": 50}'),
  ('verify-evidence', 'sha256/ab/z.txt', '{"size": 7}');
insert into public.storage_objects (namespace, object_key, byte_size, category, source_bucket, source_path, verified_at) values
  ('meta-ads-media', 'meta-ads-media/aaaaaaaa-0000-0000-0000-00000000000a/x.png', 100, 'meta-ads-media', 'meta-ads-media', 'aaaaaaaa-0000-0000-0000-00000000000a/x.png', now()),
  ('design-studio', 'design-studio/catalog/public/x', 1000, 'catalog-public', null, null, null);
