-- ============================================================================
-- HOMATCH FOR DEVELOPERS — where the files live.
--
-- TWO BUCKETS, BECAUSE THERE ARE TWO KINDS OF FILE
--
-- A facade render, a floor plan and an apartment photo exist to be looked at
-- by strangers: they are the product. A signed contract, a passport scan and
-- a bank payment receipt exist to be looked at by four people in one company.
-- Putting both behind the same door means either the marketing images need a
-- signed URL to render on a public page, or the contracts do not.
--
--   developer-media      public read. Marketing assets only. Nothing is
--                        written here that a screenshot on a listing site
--                        would embarrass anybody.
--   developer-documents  private. Every read is a signed URL with an expiry,
--                        issued only to a workspace member.
--
-- THE PATH IS THE PERMISSION
--
-- Every object is stored under `<workspace_id>/...`, and both policies read
-- that first segment and ask dev_is_member() about it. A path that does not
-- begin with a uuid belonging to a workspace the caller is in cannot be
-- written and cannot be read. This is the same tenancy check as every table,
-- asked of a filename.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('developer-media', 'developer-media', true, 10485760, array[
    'image/jpeg','image/jpg','image/png','image/webp','image/avif','image/gif']),
  ('developer-documents', 'developer-documents', false, 26214400, array[
    'application/pdf','image/jpeg','image/jpg','image/png','image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'])
on conflict (id) do nothing;

-- The first path segment, as a workspace id, or null if the path is not
-- shaped like one. Deliberately total: a policy that raises on a malformed
-- name turns a bad upload into a 500 instead of a refusal.
create or replace function public.dev_storage_workspace(p_name text)
returns uuid
language plpgsql
immutable
set search_path to ''
as $$
declare v_first text;
begin
  v_first := split_part(coalesce(p_name, ''), '/', 1);
  if v_first !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return v_first::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.dev_storage_workspace(text) from public;
grant execute on function public.dev_storage_workspace(text) to authenticated, anon;

-- ── developer-media ────────────────────────────────────────────────────────
-- Anyone may read (the bucket is public and a listing page has no session).
-- Only somebody who can edit that workspace's inventory may write.

drop policy if exists dev_media_read on storage.objects;
create policy dev_media_read on storage.objects
  for select to public
  using (bucket_id = 'developer-media');

drop policy if exists dev_media_write on storage.objects;
create policy dev_media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'developer-media'
    and public.dev_can(public.dev_storage_workspace(name), 'inventory'));

drop policy if exists dev_media_update on storage.objects;
create policy dev_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'developer-media'
         and public.dev_can(public.dev_storage_workspace(name), 'inventory'))
  with check (bucket_id = 'developer-media'
         and public.dev_can(public.dev_storage_workspace(name), 'inventory'));

drop policy if exists dev_media_delete on storage.objects;
create policy dev_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'developer-media'
         and public.dev_can(public.dev_storage_workspace(name), 'inventory'));

-- ── developer-documents ────────────────────────────────────────────────────
-- A contract is readable by a workspace member with the documents capability
-- and by nobody else, signed URL or not: Supabase checks this policy when it
-- issues one.

drop policy if exists dev_docs_read on storage.objects;
create policy dev_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'developer-documents'
         and public.dev_can(public.dev_storage_workspace(name), 'documents'));

drop policy if exists dev_docs_write on storage.objects;
create policy dev_docs_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'developer-documents'
         and public.dev_can(public.dev_storage_workspace(name), 'documents'));

drop policy if exists dev_docs_update on storage.objects;
create policy dev_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'developer-documents'
         and public.dev_can(public.dev_storage_workspace(name), 'documents'))
  with check (bucket_id = 'developer-documents'
         and public.dev_can(public.dev_storage_workspace(name), 'documents'));

-- No delete policy on documents, on purpose. A contract or a receipt that has
-- been attached to a deal is part of the record; the product archives rather
-- than destroys, and there is no screen offering otherwise.
