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
