// HOMATCH — upload validation and object naming.
//
// Split out of dealRoomDocuments.ts so it can be unit tested: this module has
// NO imports at all, which means node:test can load it directly, while the
// service layer around it needs the Vite `@/` alias and a Supabase client.
//
// These are security controls, not conveniences. The same rules are enforced
// again by the storage bucket (file_size_limit, allowed_mime_types) and by RLS
// on storage.objects; this layer exists so a customer gets an understandable
// reason instead of a raw storage error, and it must never be MORE permissive
// than the server-side checks.

/** Kept in sync with the bucket's allowed_mime_types. */
export const ALLOWED_MIME = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const MAX_BYTES = 20 * 1024 * 1024;

/** The same number, for copy that has to state the limit out loud. */
export const MAX_MB = Math.round(MAX_BYTES / (1024 * 1024));

/**
 * What the ANALYSER can actually read — not what the bucket will store.
 *
 * These two lists were conflated, and customers paid for it. The bucket, RLS
 * and `ALLOWED_MIME` above all accept JPEG, PNG, WEBP and legacy `.doc`,
 * while deal-room-document-analyze rejects everything except PDF and DOCX
 * (`ANALYSABLE_MIME` in that function). So a photographed contract uploaded
 * cleanly, showed a progress state, and then terminated as UNSUPPORTED —
 * which `canReanalyze()` refuses to retry. The customer was told to upload a
 * contract, allowed to, and then told it could not be read.
 *
 * A file picker that offers only what the pipeline can genuinely process is
 * the honest fix. Images are still storable as case documents; they are just
 * not offered where the promise is "we will read this contract".
 *
 * MUST mirror ANALYSABLE_MIME in supabase/functions/deal-room-document-analyze.
 * contractUpload.test.mjs asserts the two lists stay identical.
 */
export const ANALYSABLE_MIME = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** The `accept` attribute for a contract picker: MIME *and* extensions,
 *  because Android pickers routinely honour only one of the two. */
export const CONTRACT_ACCEPT = `${ANALYSABLE_MIME.join(',')},.pdf,.docx`;

/** Human-readable format list for error copy. Never translated: these are
 *  format names, identical in every language. */
export const CONTRACT_FORMATS = 'PDF, DOCX';

/**
 * Validates a file the customer intends to have READ, not merely stored.
 *
 * Deliberately a wrapper rather than a second implementation: every rule in
 * validateUpload still applies, and this only narrows the accepted types.
 */
export function validateContractUpload(file: { name: string; size: number; type: string }): UploadRejection {
  const base = validateUpload(file);
  if (!base.ok) return base;
  if (!ANALYSABLE_MIME.includes(file.type)) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  return { ok: true };
}

/** Signed URLs are minted per view and expire quickly: a leaked link should
 * stop working long before it can be passed around. */
export const SIGNED_URL_TTL_SECONDS = 120;

export type UploadRejection =
  | { ok: true }
  | { ok: false; reason: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'SUSPICIOUS_NAME' };

/**
 * Validates a file BEFORE it is uploaded.
 *
 * Extension is checked as well as MIME because a browser will happily report
 * `application/pdf` for a file the user renamed; the two disagreeing is a
 * reason to stop and ask rather than to store.
 */
export function validateUpload(file: { name: string; size: number; type: string }): UploadRejection {
  if (!file || file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, reason: 'UNSUPPORTED_TYPE' };

  const name = String(file.name ?? '');
  // Path traversal and control characters have no business in a filename, and
  // a double extension is the classic way to smuggle one type as another.
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(name) ||
    /\.(exe|js|sh|bat|cmd|scr|jar|msi|dll|ps1)(\.|$)/i.test(name)
  ) {
    return { ok: false, reason: 'SUSPICIOUS_NAME' };
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const EXT_FOR: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  };
  if (!(EXT_FOR[file.type] ?? []).includes(ext)) return { ok: false, reason: 'UNSUPPORTED_TYPE' };

  return { ok: true };
}

/**
 * The storage path.
 *
 * `<userId>/<roomId>/<documentId>.<ext>` — the first segment is what the
 * storage policies compare against auth.uid(), so this shape is load-bearing
 * and must not be changed without changing the policies with it.
 */
export function storagePathFor(userId: string, roomId: string, documentId: string, filename: string): string {
  const ext = (filename.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${userId}/${roomId}/${documentId}.${ext || 'bin'}`;
}
