-- ============================================================================
-- HOMATCH VERIFY — private cache for the secure official-document viewer.
--
-- verify-documents (PRIVATE bucket)
--
--   Official TAS attachments (pdf / jpg / png) a customer opened from their
--   own Verify report. docs.tbilisi.gov.ge's DownloadServlet answers many
--   customer browsers with "Access Denied", so research-agent's
--   `document_file` action fetches ONE file through the official worker
--   (/verify/tas-file, token-only), stores it here as `files/<attachedFileId>.<ext>`
--   and returns a short-lived signed URL. The attachedFileId must exist in the
--   caller's own job ledger (src/verify/officialDocumentLibrary.ts).
--
--   No storage.objects policy is created: anon and authenticated have NO
--   access. Only the service role writes and signs. 30 MB per file, matching
--   the worker's byte bound. verify-evidence is not reused: it only admits
--   text/plain and application/json.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verify-documents', 'verify-documents', false, 31457280, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
