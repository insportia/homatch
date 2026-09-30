-- META DATA DELETION REQUESTS
--
-- Meta's Data Deletion Request callback (meta-oauth?action=data_deletion)
-- records every verified request here and answers with a confirmation code
-- and a status URL (meta-oauth?deletion_status=CODE).
--
-- The requester's Facebook user id is NOT kept — only a one-way SHA-256
-- reference — because the row exists to prove the deletion, not to retain
-- the identity it deleted. Written by the service role only; admins read.

create table if not exists public.meta_data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique check (confirmation_code ~ '^[A-F0-9]{24}$'),
  meta_user_hash text not null check (meta_user_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'COMPLETED', 'FAILED')),
  connections_deleted integer not null default 0,
  assets_deleted integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists meta_data_deletion_requests_created_idx
  on public.meta_data_deletion_requests (created_at desc);

alter table public.meta_data_deletion_requests enable row level security;

revoke all on public.meta_data_deletion_requests from anon, authenticated;
grant select on public.meta_data_deletion_requests to authenticated;

drop policy if exists meta_data_deletion_requests_admin_read on public.meta_data_deletion_requests;
create policy meta_data_deletion_requests_admin_read on public.meta_data_deletion_requests
  for select to authenticated using (public.is_admin());
