-- Homatch Deal Room — private document storage + contract analysis
--
-- Depends on 20260909120000_deal_rooms.sql (deal_rooms, deal_room_documents).
--
-- SECURITY POSTURE
-- ----------------
-- Purchase contracts, extracts and bank documents are among the most
-- sensitive things a customer will ever hand us. The bucket is therefore
-- PRIVATE (public = false): there is no unauthenticated URL that can reach an
-- object, and access is only ever granted through a short-lived signed URL
-- minted for a user who already passes the ownership check below.
--
-- Path convention, enforced by policy rather than by convention alone:
--
--     <user_id>/<deal_room_id>/<document_id>.<ext>
--
-- storage.foldername(name)[1] is therefore the owning user's id, and every
-- policy compares it to auth.uid(). A user cannot read, write, or delete
-- outside their own first-level folder even if they guess another object's
-- full path.
--
-- NOT APPLIED. Written locally for review; deployment is a separate decision.

-- ---------------------------------------------------------------------------
-- Private bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-room-documents',
  'deal-room-documents',
  false,                       -- never public; signed URLs only
  20971520,                    -- 20 MB, enforced by storage itself, not just the client
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Object-level policies: first path segment must be the caller's own user id
-- ---------------------------------------------------------------------------
drop policy if exists deal_room_docs_read   on storage.objects;
drop policy if exists deal_room_docs_insert on storage.objects;
drop policy if exists deal_room_docs_update on storage.objects;
drop policy if exists deal_room_docs_delete on storage.objects;

create policy deal_room_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-room-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy deal_room_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deal-room-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy deal_room_docs_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'deal-room-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'deal-room-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy deal_room_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'deal-room-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Upload metadata that storage does not track for us
-- ---------------------------------------------------------------------------
alter table public.deal_room_documents
  add column if not exists original_filename text,
  add column if not exists sha256            text,
  add column if not exists analysis_state    text not null default 'NONE'
    check (analysis_state in ('NONE','QUEUED','RUNNING','DONE','FAILED','UNSUPPORTED')),
  add column if not exists analysis_error    text,
  add column if not exists analyzed_at       timestamptz;

-- Same file uploaded twice into the same room is the same document.
create unique index if not exists deal_room_documents_room_sha_uidx
  on public.deal_room_documents (deal_room_id, sha256)
  where sha256 is not null;

-- ---------------------------------------------------------------------------
-- deal_room_document_findings
--
-- One extracted, evidenced statement about ONE document. Deliberately a table
-- rather than a jsonb blob on the document, because these are cross-checked
-- against Verify facts and need to be queried, ordered and individually
-- dismissed by the customer.
--
-- `quote` and `page` are what keep this honest: an extraction that cannot
-- point at the text it came from is not shown as a contract fact. This is the
-- same NO EVIDENCE = NO FACT rule the Verify side already enforces.
-- ---------------------------------------------------------------------------
create table if not exists public.deal_room_document_findings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.deal_room_documents(id) on delete cascade,
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- What kind of statement this is.
  finding_type text not null check (finding_type in (
    'PARTY','DATE','AMOUNT','OBLIGATION','TERMINATION','PENALTY',
    'DELIVERY_DATE','AREA','PAYMENT_SCHEDULE','CLAUSE','MISSING_EXPECTED'
  )),
  label text not null,
  value text,

  -- Provenance INSIDE the document.
  quote text,
  page integer,

  -- Cross-check against Verify. CONTRADICTS is the highest-value output of
  -- the whole feature: the contract says 94.1 m2 and the registry says 88.0.
  verify_relation text not null default 'UNRELATED'
    check (verify_relation in ('UNRELATED','AGREES','CONTRADICTS','UNVERIFIABLE')),
  verify_fact_type text,
  verify_fact_value text,

  -- Set when the contract omits something a contract of this kind normally
  -- has. An omission is reported as a QUESTION, never as a legal conclusion.
  severity text not null default 'INFO'
    check (severity in ('INFO','ATTENTION','IMPORTANT')),

  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists deal_room_document_findings_doc_idx
  on public.deal_room_document_findings (document_id, finding_type);
create index if not exists deal_room_document_findings_room_idx
  on public.deal_room_document_findings (deal_room_id, verify_relation)
  where dismissed = false;

alter table public.deal_room_document_findings enable row level security;
alter table public.deal_room_document_findings force row level security;

drop policy if exists deal_room_document_findings_owner on public.deal_room_document_findings;
create policy deal_room_document_findings_owner on public.deal_room_document_findings
  for all to authenticated
  using (user_id = (select auth.uid()) and public.owns_deal_room(deal_room_id))
  with check (user_id = (select auth.uid()) and public.owns_deal_room(deal_room_id));

revoke all on public.deal_room_document_findings from anon;
