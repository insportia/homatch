-- Backs the "Report" item in ChatPage's conversation menu, which previously
-- had no onClick handler at all — clicking it did nothing, silently.
create table if not exists public.conversation_reports (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reporter_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'PENDING' check (status in ('PENDING', 'REVIEWED', 'DISMISSED')),
  created_at timestamptz not null default now()
);

alter table public.conversation_reports enable row level security;

-- A user may only report a conversation they are actually part of, and only
-- ever as themselves.
create policy "conversation_reports_insert_participant"
  on public.conversation_reports for insert
  to authenticated
  with check (
    reporter_id = public.get_user_id()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.initiator_id = public.get_user_id() or c.recipient_id = public.get_user_id())
    )
  );

-- Reporters can see their own reports; admins can see (and later triage) all.
create policy "conversation_reports_select_own_or_admin"
  on public.conversation_reports for select
  to public
  using (reporter_id = public.get_user_id() or public.is_admin());

create policy "conversation_reports_admin_update"
  on public.conversation_reports for update
  to public
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists idx_conversation_reports_conversation_id on public.conversation_reports (conversation_id);
create index if not exists idx_conversation_reports_status on public.conversation_reports (status) where status = 'PENDING';
