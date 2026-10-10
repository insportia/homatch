-- Fixture for 20261027100000_property_conversations.sql. Loaded AFTER
-- homatch_leads_fixture.sql (and the Leads migration is applied before ours), so the
-- CRM triggers on messages are the real ones and run during these checks.
--
-- Adds the production columns/tables the Leads fixture leaves out (00026 chat schema:
-- mute flags, receipts, block reason/unique, message timestamps; properties.cover_photo_url;
-- property_facts.photo_visibility; users.avatar_url), the 00026 message policies the
-- migration replaces, Supabase's default table grants, and a minimal storage schema.
-- Run: tests/sql/run-property-conversations.sh

alter table public.users add column if not exists avatar_url text;
alter table public.properties add column if not exists cover_photo_url text;
do $$ begin create type public.photo_visibility as enum ('PUBLIC', 'PRIVATE', 'AUTHENTICATED');
exception when duplicate_object then null; end $$;
alter table public.property_facts add column if not exists photo_visibility public.photo_visibility not null default 'PUBLIC';

alter table public.conversations
  add column if not exists match_id uuid,
  add column if not exists initiator_muted boolean not null default false,
  add column if not exists recipient_muted boolean not null default false,
  add column if not exists first_contact_email_sent boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
alter table public.conversation_blocks add column if not exists reason text;
alter table public.conversation_blocks add constraint conversation_blocks_pair unique (blocker_id, blocked_id);
alter table public.messages
  add column if not exists delivered_at timestamptz,
  add column if not exists seen_at timestamptz;
alter table public.messages alter column sender_id set not null;

create table if not exists public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status public.message_status not null default 'DELIVERED',
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

-- 00026 policies (auth_user_id() == users.id of the caller) and Supabase default grants.
create or replace function public.auth_user_id() returns uuid language sql stable security definer set search_path = ''
  as $$ select u.id from public.users u where u.auth_id = auth.uid() limit 1 $$;
grant execute on function public.auth_user_id() to authenticated;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
create policy "conv_select" on public.conversations for select
  using (initiator_id = public.auth_user_id() or recipient_id = public.auth_user_id());
create policy "msg_select" on public.messages for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id
    and (c.initiator_id = public.auth_user_id() or c.recipient_id = public.auth_user_id())));
create policy "msg_insert" on public.messages for insert
  with check (sender_id = public.auth_user_id() and exists (
    select 1 from public.conversations c where c.id = conversation_id
      and (c.initiator_id = public.auth_user_id() or c.recipient_id = public.auth_user_id())));
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;

-- Minimal Supabase storage.
create schema if not exists storage;
grant usage on schema storage to authenticated, anon, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Facts for the conversation's property (f1, owned by a1).
insert into public.property_facts (property_id, city, district, total_price, currency, area, bedrooms)
values ('00000000-0000-0000-0000-0000000000f1', 'Tbilisi', 'Krtsanisi', 185000, 'USD', 85, 2);
update public.properties set cover_photo_url = 'users/a1/cover.jpg' where id = '00000000-0000-0000-0000-0000000000f1';
