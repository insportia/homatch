-- Homatch — storage for contract analysis.
--
-- deal_room_documents already carried the analysis state model
-- (NONE / QUEUED / RUNNING / DONE / FAILED / UNSUPPORTED), a sha256 and a
-- unique (deal_room_id, sha256) index. That model is reused rather than
-- replaced; this migration adds only the two things it was missing.
--
-- 1. REQUIRES_OCR
--
--    UNSUPPORTED already meant "we cannot analyse this file type". A PDF whose
--    pages are images is a different situation and needs different words to
--    the customer: the file IS supported, it simply carries no text layer, and
--    the honest answer is "this looks like a scan — we cannot read it" rather
--    than "unsupported". Folding the two together would produce a message that
--    is wrong in one of the two cases, and the scanned case is the common one.
--
--    Nothing is invented for a scan: no text, no findings, no analysis.
--
-- 2. analysis (jsonb)
--
--    The analyst output a buyer actually needs — plain-language summary,
--    clause-by-clause explanation, obligations, deadlines, financial terms,
--    missing protections, questions — has no natural home in
--    deal_room_document_findings, which is deliberately a narrow row shape for
--    the registry cross-check. Forcing paragraphs into that table would either
--    distort it or lose the structure.
--
--    Stored as jsonb on the document it describes. analysis_sha256 records
--    WHICH file content the analysis was produced from, so replacing a file
--    invalidates its analysis rather than silently presenting the previous
--    document's explanation next to the new one.
--
-- No policy, grant or RLS change: deal_room_documents already has a single
-- owner policy and RLS enabled + forced, and analysis inherits it because it
-- lives on the same row.
--
-- Idempotent.

alter table public.deal_room_documents
  add column if not exists analysis        jsonb,
  add column if not exists analysis_sha256 text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_room_documents'::regclass
      and conname = 'deal_room_documents_analysis_state_check'
  ) then
    alter table public.deal_room_documents
      drop constraint deal_room_documents_analysis_state_check;
  end if;

  alter table public.deal_room_documents
    add constraint deal_room_documents_analysis_state_check
    check (analysis_state in (
      'NONE','QUEUED','RUNNING','DONE','FAILED','UNSUPPORTED','REQUIRES_OCR'
    ));
end $$;

-- Finding the documents that still need work, per owner.
create index if not exists deal_room_documents_analysis_state_idx
  on public.deal_room_documents (user_id, analysis_state);
