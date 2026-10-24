-- HOMI workstream · Contract Intelligence revision history.
--
-- The analysis now proposes, for each flagged clause, a replacement the
-- signer can accept, edit or reject. Each time they save their decisions a
-- new numbered revision is written; nothing is overwritten, so the history
-- of what was proposed and what was chosen stays readable. The revised text
-- itself is rebuilt from the stored contract text and the decisions, so no
-- second copy of the contract is kept.
--
-- Ownership follows deal_room_documents exactly: user_id is the auth uid of
-- the document's owner, and a revision can only be written for a document
-- the caller owns. Additive and idempotent.

create table if not exists public.contract_revisions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.deal_room_documents(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  version      integer not null check (version >= 1),
  -- [{ key: 'c:3' | 'm:0', status: 'ACCEPTED' | 'EDITED' | 'REJECTED', text?: string }]
  decisions    jsonb not null check (jsonb_typeof(decisions) = 'array'),
  applied      integer not null default 0 check (applied >= 0),
  unplaced     integer not null default 0 check (unplaced >= 0),
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);
create index if not exists contract_revisions_document on public.contract_revisions (document_id, version desc);

alter table public.contract_revisions enable row level security;
revoke all on public.contract_revisions from anon;
grant select, insert, delete on public.contract_revisions to authenticated;

drop policy if exists contract_revisions_own_read on public.contract_revisions;
create policy contract_revisions_own_read on public.contract_revisions
  for select using (user_id = auth.uid());

drop policy if exists contract_revisions_own_insert on public.contract_revisions;
create policy contract_revisions_own_insert on public.contract_revisions
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.deal_room_documents d where d.id = document_id and d.user_id = auth.uid())
  );

drop policy if exists contract_revisions_own_delete on public.contract_revisions;
create policy contract_revisions_own_delete on public.contract_revisions
  for delete using (user_id = auth.uid());
-- No UPDATE policy: a saved revision is history.
