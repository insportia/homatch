-- HOMATCH — documents become things the customer owns, not rows they may delete.
--
-- WHAT THE DOCUMENT AREA WAS
--
-- Upload, a spinner, and a bin icon. Every analysed document rendered its
-- entire contract analysis inline and permanently expanded, so three uploads
-- produced a wall nobody could navigate, and the only action beside "read the
-- wall" was to destroy the file. A customer could not rename a document,
-- could not put it away, could not re-read the text we extracted from it,
-- could not ask for it to be read again, and could not undo a deletion.
--
-- That is a viewer with a delete button. This migration gives the rows the
-- columns a workspace needs:
--
--   display_name     a name the customer chose, WITHOUT touching
--                    original_filename — the name of the file they uploaded
--                    is evidence and must stay exactly what it was.
--   category         ownership / contract / registry extract / floor plan /
--                    invoice / other, for grouping (§13).
--   archived_at      putting something away is not destroying it (§19).
--   extracted_text   the reader (§8). The analyser has always extracted this
--                    and always thrown it away, so "view extracted text" was
--                    an action the product could not honestly offer. Now it
--                    is kept, under the same RLS as the document itself.
--   headline_summary one sentence a human can read in the collapsed card,
--                    so a card never has to show raw OCR output (§14).
--   sort_index       the customer's own order (§16).
--
-- and one new table: what has happened to each document (§18).
--
-- NOTHING IS RENAMED AND NOTHING IS DROPPED. Every existing column keeps its
-- meaning, so a document uploaded before today reads exactly as it did.

alter table public.deal_room_documents
  add column if not exists display_name text,
  add column if not exists category text,
  add column if not exists archived_at timestamptz,
  add column if not exists extracted_text text,
  add column if not exists extracted_pages integer,
  add column if not exists headline_summary text,
  add column if not exists sort_index integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.deal_room_documents'::regclass
       and conname = 'deal_room_documents_category_check'
  ) then
    alter table public.deal_room_documents
      add constraint deal_room_documents_category_check
      check (category is null or category in (
        'OWNERSHIP', 'CONTRACT', 'REGISTRY_EXTRACT', 'FLOOR_PLAN', 'INVOICE', 'OTHER'
      ));
  end if;
end;
$$;

comment on column public.deal_room_documents.display_name is
  'A name the customer chose. original_filename is left untouched: the name of the file they actually uploaded is evidence.';
comment on column public.deal_room_documents.extracted_text is
  'The text the analyser read. Kept so the customer can read their own document without us extracting it a second time. Same RLS as the row; never logged.';
comment on column public.deal_room_documents.archived_at is
  'Put away, not destroyed. Archive is the normal way to remove a document from view; permanent deletion is a separate, confirmed action.';

create index if not exists deal_room_documents_room_active_idx
  on public.deal_room_documents (deal_room_id, created_at desc)
  where archived_at is null;

-- ── Activity (§18) ─────────────────────────────────────────────────────────
--
-- What happened to this document, in order. Not an audit log of ours — a
-- history the OWNER reads, which is why it is insert-only and carries no
-- internal detail: "analysis completed", never "openai returned 200".

create table if not exists public.deal_room_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.deal_room_documents(id) on delete cascade,
  deal_room_id uuid not null references public.deal_rooms(id) on delete cascade,
  user_id uuid not null,
  event_type text not null check (event_type in (
    'UPLOADED', 'QUEUED', 'EXTRACTION_STARTED', 'EXTRACTION_COMPLETED',
    'ANALYSIS_STARTED', 'ANALYSIS_COMPLETED', 'ANALYSIS_FAILED',
    'REANALYZED', 'RENAMED', 'RECATEGORIZED', 'ARCHIVED', 'RESTORED', 'DELETED'
  )),
  -- Ids, counts and the customer's own chosen name. Never document content.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deal_room_document_events_doc_idx
  on public.deal_room_document_events (document_id, created_at desc);

alter table public.deal_room_document_events enable row level security;

drop policy if exists ddoc_events_select_own on public.deal_room_document_events;
create policy ddoc_events_select_own on public.deal_room_document_events
  for select to authenticated
  using (user_id = auth.uid());

-- Insert is allowed for the owner so the client can record its own actions
-- (rename, archive) without a round trip through an edge function. The
-- user_id is pinned to auth.uid() by the policy, so an event cannot be
-- written into somebody else's history.
drop policy if exists ddoc_events_insert_own on public.deal_room_document_events;
create policy ddoc_events_insert_own on public.deal_room_document_events
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.deal_room_documents d
       where d.id = document_id and d.user_id = auth.uid()
         and d.deal_room_id = deal_room_id
    )
  );

-- History is not editable. A record that can be rewritten is not a record.

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Every document that already exists gets the upload event it always had,
-- so a workspace opened today does not show an empty history for a file the
-- customer uploaded last week.

insert into public.deal_room_document_events (document_id, deal_room_id, user_id, event_type, detail, created_at)
select d.id, d.deal_room_id, d.user_id, 'UPLOADED',
       jsonb_build_object('backfilled', true),
       coalesce(d.uploaded_at, d.created_at)
  from public.deal_room_documents d
 where d.storage_path is not null
   and not exists (
     select 1 from public.deal_room_document_events e
      where e.document_id = d.id and e.event_type = 'UPLOADED'
   );

insert into public.deal_room_document_events (document_id, deal_room_id, user_id, event_type, detail, created_at)
select d.id, d.deal_room_id, d.user_id, 'ANALYSIS_COMPLETED',
       jsonb_build_object('backfilled', true),
       coalesce(d.analyzed_at, d.updated_at)
  from public.deal_room_documents d
 where d.analysis_state = 'DONE'
   and not exists (
     select 1 from public.deal_room_document_events e
      where e.document_id = d.id and e.event_type = 'ANALYSIS_COMPLETED'
   );

-- ── The stuck marker ───────────────────────────────────────────────────────
--
-- deal-room-document-analyze sets analysis_state = 'RUNNING' before it starts
-- and only moves it at the end, so any abandonment in between — a navigation,
-- a refresh, an edge-function timeout — leaves the marker set forever. That
-- is the "Reading document…" that never stops.
--
-- jobs-worker now sweeps these continuously. This clears the ones already
-- stranded, with the same rule it uses: an analysis that is actually THERE is
-- repaired to DONE rather than thrown away and re-bought, and one that is not
-- becomes FAILED so the customer is offered a retry instead of a spinner.

update public.deal_room_documents
   set analysis_state = 'DONE', analysis_error = null
 where analysis_state = 'RUNNING'
   and updated_at < now() - interval '6 minutes'
   and analysis is not null
   and jsonb_typeof(analysis -> 'clauses') = 'array';

update public.deal_room_documents
   set analysis_state = 'FAILED',
       analysis_error = 'analysis stopped before it finished',
       analyzed_at = coalesce(analyzed_at, now())
 where analysis_state = 'RUNNING'
   and updated_at < now() - interval '6 minutes';
