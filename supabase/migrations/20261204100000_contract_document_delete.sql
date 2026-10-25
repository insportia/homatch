-- UX Contracts · a customer deletes a contract they no longer want.
--
-- Contracts history lists every document a customer has had read. Until now
-- there was no way to remove one from that list. The table's owner policy
-- (deal_room_documents_owner, `for all`) would let the browser delete its own
-- row directly, but a bare DELETE knows nothing about the two states in which
-- a document must stay:
--
--   * the analysis is QUEUED or RUNNING: the edge function holds a billing
--     reservation and is about to write the result onto this row; removing
--     the row underneath it turns a settle into an orphaned reservation;
--   * the retention registry holds the record (legal_hold), or the retention
--     engine is purging it right now (state PURGING).
--
-- So deletion goes through this one function. It checks ownership itself
-- (security definer, auth.uid() must own the row), refuses the states above
-- with a named reason the client turns into words, and deletes the row. The
-- foreign keys do the rest: findings, document events and contract revisions
-- are all `on delete cascade`.
--
-- The stored FILE is removed by the client afterwards, through the routed
-- storage helper, with the path this function returns: the bucket policy
-- (first path segment = caller's uid) already lets the owner remove it, and
-- R2 removal lives behind the storage edge function, not in SQL. If that
-- removal fails, nothing is exposed (the bucket is private and the row that
-- pointed at the object is gone) and the retention engine's object sweep
-- deletes an object no live row references.
--
-- The retention_records row, when one exists, is left as it is: it is an
-- operator ledger, not customer data, and the purge engine already tolerates a
-- source row that no longer exists.
--
-- Additive and idempotent. No table, column or policy changes.

create or replace function public.contract_document_delete(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_state text;
  v_path text;
  v_hold boolean;
  v_purging boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select d.user_id, d.analysis_state, d.storage_path
    into v_owner, v_state, v_path
    from public.deal_room_documents d
   where d.id = p_document_id
   for update;

  -- Someone else's document and a document that does not exist answer the
  -- same way, so the function cannot be used to probe for ids.
  if not found or v_owner is distinct from v_uid then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;

  if v_state in ('QUEUED', 'RUNNING') then
    raise exception 'contract_busy' using errcode = '55006';
  end if;

  select coalesce(bool_or(r.legal_hold), false), coalesce(bool_or(r.state = 'PURGING'), false)
    into v_hold, v_purging
    from public.retention_records r
   where r.product = 'CONTRACT_DOCUMENT' and r.source_id = p_document_id;

  if v_hold then
    raise exception 'contract_on_hold' using errcode = '55006';
  end if;
  if v_purging then
    raise exception 'contract_busy' using errcode = '55006';
  end if;

  delete from public.deal_room_documents where id = p_document_id;

  return jsonb_build_object('deleted', true, 'storage_path', v_path);
end $$;

comment on function public.contract_document_delete(uuid) is
  'Owner-only deletion of one contract document (deal_room_documents row; findings, events and revisions cascade). Refuses QUEUED/RUNNING analyses, legal holds and rows the retention engine is purging. Returns the storage path so the client can remove the stored file.';

revoke all on function public.contract_document_delete(uuid) from public, anon;
grant execute on function public.contract_document_delete(uuid) to authenticated;
