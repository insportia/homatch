-- What 20261116090000_find_property_capacity.sql reads beyond the marketplace fixture:
-- public.users.created_at and Supabase's auth.users confirmation columns.
alter table public.users add column if not exists created_at timestamptz not null default now();
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email_confirmed_at timestamptz, phone_confirmed_at timestamptz);
