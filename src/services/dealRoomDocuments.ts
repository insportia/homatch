// HOMATCH — Deal Room documents: secure upload and access.
//
// Purchase contracts and registry extracts are the most sensitive things a
// customer hands us, so the rules here are deliberately strict and are
// enforced in three independent places:
//
//   1. HERE, before the network call, so the customer gets an immediate,
//      understandable rejection instead of a storage error.
//   2. In the STORAGE BUCKET itself (file_size_limit, allowed_mime_types),
//      because a client check is advice and a server check is a control.
//   3. In RLS on storage.objects, keyed on the first path segment being the
//      caller's own user id, so no path can be forged into another user's
//      folder.
//
// The bucket is private. There is no public URL. Access is always a
// short-lived signed URL minted for a user who already passed the check.

import { supabase } from '@/db/supabase';
import { validateUpload, storagePathFor } from './uploadValidation';

// Validation and object naming live in a dependency-free module so they can
// be unit tested; re-exported here so callers have one import site.
export {
  ALLOWED_MIME, MAX_BYTES, SIGNED_URL_TTL_SECONDS,
  validateUpload, storagePathFor,
} from './uploadValidation';
export type { UploadRejection } from './uploadValidation';

/** sha256 of the file, used to recognise a re-upload of the same document
 * rather than storing it twice. Computed in the browser via WebCrypto. */
export async function sha256Of(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadDocument(args: {
  roomId: string;
  file: File;
  docKey?: string;
  label?: string;
}): Promise<{ documentId: string; storagePath: string }> {
  const check = validateUpload(args.file);
  if (!check.ok) throw new Error(`upload_rejected:${check.reason}`);

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error('not_authenticated');

  const sha = await sha256Of(args.file);

  // The row is created first so the object can be named after its id, which
  // keeps storage free of customer-supplied path fragments entirely.
  const { data: row, error: insErr } = await supabase
    .from('deal_room_documents')
    .insert({
      deal_room_id: args.roomId,
      user_id: userId,
      doc_key: args.docKey ?? `upload:${sha.slice(0, 16)}`,
      label: args.label ?? args.file.name,
      state: 'PROVIDED',
      original_filename: args.file.name,
      mime_type: args.file.type,
      size_bytes: args.file.size,
      sha256: sha,
      uploaded_at: new Date().toISOString(),
      analysis_state: 'NONE',
    })
    .select('id')
    .single();
  if (insErr) throw insErr;

  const path = storagePathFor(userId, args.roomId, row.id as string, args.file.name);
  const { error: upErr } = await supabase.storage
    .from('deal-room-documents')
    .upload(path, args.file, { contentType: args.file.type, upsert: false });

  if (upErr) {
    // Do not leave a row pointing at an object that does not exist.
    await supabase.from('deal_room_documents').delete().eq('id', row.id);
    throw upErr;
  }

  const { error: updErr } = await supabase
    .from('deal_room_documents')
    .update({ storage_path: path })
    .eq('id', row.id);
  if (updErr) throw updErr;

  return { documentId: row.id as string, storagePath: path };
}

/** Mints a short-lived signed URL. Never returns a public URL, because the
 * bucket has none. */
export async function signedUrlFor(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('deal-room-documents')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteDocument(documentId: string, storagePath: string | null): Promise<void> {
  if (storagePath) {
    const { error } = await supabase.storage.from('deal-room-documents').remove([storagePath]);
    if (error) throw error;
  }
  const { error } = await supabase.from('deal_room_documents').delete().eq('id', documentId);
  if (error) throw error;
}

export interface DocumentFinding {
  id: string;
  finding_type: string;
  label: string;
  value: string | null;
  quote: string | null;
  page: number | null;
  verify_relation: 'UNRELATED' | 'AGREES' | 'CONTRADICTS' | 'UNVERIFIABLE';
  verify_fact_type: string | null;
  verify_fact_value: string | null;
  severity: 'INFO' | 'ATTENTION' | 'IMPORTANT';
}

export async function listFindings(roomId: string): Promise<DocumentFinding[]> {
  const { data, error } = await supabase
    .from('deal_room_document_findings')
    .select('id,finding_type,label,value,quote,page,verify_relation,verify_fact_type,verify_fact_value,severity')
    .eq('deal_room_id', roomId)
    .eq('dismissed', false)
    // Contradictions first: a contract that disagrees with the registry is
    // the single most valuable thing this feature can surface.
    .order('verify_relation', { ascending: true })
    .order('severity', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocumentFinding[];
}
