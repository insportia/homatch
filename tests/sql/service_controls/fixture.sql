-- Stand-ins for the production objects the service-controls migration depends on.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
-- auth.uid() as Supabase defines it: the JWT subject of the current request.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.users (id uuid primary key, auth_id uuid unique, is_admin boolean not null default false);
create function public.is_admin() returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_admin = true) $$;
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null, target_id uuid,
  action text not null, entity_type text, entity_id text, metadata jsonb, created_at timestamptz not null default now());
insert into public.users values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', true),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', false);
-- Live Chat stand-ins (production: 20260831130000_live_chat_v1 / 20260929120000_live_chat_messenger_v2),
-- each with an existing BEFORE INSERT trigger like production's burst guard.
create table public.live_chat_messages (id bigint generated always as identity primary key, user_id uuid, body text);
create table public.live_chat_reactions (id bigint generated always as identity primary key, message_id bigint, user_id uuid, emoji text);
create table public.burst_log (n int);
create function public.live_chat_burst_guard() returns trigger language plpgsql as $$ begin insert into public.burst_log values (1); return new; end $$;
create trigger trg_live_chat_burst_guard before insert on public.live_chat_messages for each row execute function public.live_chat_burst_guard();
insert into public.live_chat_messages (user_id, body) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'history before the pause');
create table public.ds_projects (id uuid primary key default gen_random_uuid(), owner_id uuid, name text);
insert into public.ds_projects (owner_id, name) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'existing project');
