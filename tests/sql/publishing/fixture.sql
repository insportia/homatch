-- Stand-ins for the production objects the publishing migrations reference.
-- Throwaway database only (tests/sql/publishing/run.sh).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create table public.users (id uuid primary key, auth_id uuid);
create table public.properties (id uuid primary key, user_id uuid not null references public.users(id), is_deleted boolean not null default false, title text);
create function public.get_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function public.get_user_id() to authenticated, anon;
insert into public.users values ('aaaaaaaa-0000-0000-0000-00000000000a', null), ('bbbbbbbb-0000-0000-0000-00000000000b', null);
insert into public.properties (id, user_id, title) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A1'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'A2'),
  ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'B1');
