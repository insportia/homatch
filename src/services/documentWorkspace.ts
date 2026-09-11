// HOMATCH — everything a customer can do to their own document.
//
// The old service offered upload, list, analyse and delete. That is a viewer
// with a bin, and it made a document feel like something Homatch was keeping
// rather than something the customer owned (PART D §53).
//
// Every action here is a real one. Nothing in this file fakes a capability:
// "download original" mints a signed URL from the private bucket, "view
// extracted text" reads the text the analyser actually kept, and where a
// thing genuinely cannot be done — re-extracting a scan we could not read —
// the caller is told so rather than shown a button that shrugs.
//
// AUTHORISATION IS NOT HERE
//
// Every statement below goes through ordinary RLS as the signed-in customer.
// There is no service-role path in this file, so none of these can reach a
// document that is not theirs even if an id were guessed (§57).

import { supabase } from '@/db/supabase';
import { SIGNED_URL_TTL_SECONDS } from './uploadValidation';
import {
  normalizeDocumentAnalysis, documentStatus, suggestCategory,
  type NormalDocumentAnalysis, type DocumentStatus, type DocumentCategory,
} from '@/documents/documentModel';
import type { JobState } from '@/jobs/jobState';
import { reportError } from '@/lib/errorReporting';
import { startJobBestEffort, type BackgroundJob } from '@/services/backgroundJobs';

/* ------------------------------------------------------------------ *
 * The row                                                             *
 * ------------------------------------------------------------------ */

const COLUMNS =
  'id,deal_room_id,user_id,doc_key,label,display_name,category,state,storage_path,mime_type,' +
  'size_bytes,uploaded_at,created_at,updated_at,original_filename,sha256,analysis_state,' +
  'analysis_error,analyzed_at,analysis,archived_at,extracted_pages,headline_summary,sort_index';

export interface WorkspaceDocument {
  id: string;
  /** The verification case. The COLUMN is still deal_room_id — those live
   *  tables were deliberately never renamed — but no name a customer or a
   *  URL can see says so. */
  caseId: string;
  /** What to CALL it: the customer's name if they chose one, else the file's. */
  name: string;
  /** Always the name of the file they uploaded. Evidence, never overwritten. */
  originalFilename: string | null;
  displayName: string | null;
  category: DocumentCategory;
  /** Set only when the customer chose it, so a suggestion never looks decided. */
  categoryChosen: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
  storagePath: string | null;
  archivedAt: string | null;
  analysisState: string;
  /** Internal. Shown to an admin, never rendered to the customer. */
  analysisError: string | null;
  analyzedAt: string | null;
  analysis: NormalDocumentAnalysis | null;
  headlineSummary: string | null;
  extractedPages: number | null;
  sortIndex: number | null;
  status: DocumentStatus;
}

function toWorkspaceDocument(row: Record<string, unknown>, job?: { state: JobState; stage: string | null } | null): WorkspaceDocument {
  const analysis = normalizeDocumentAnalysis(row.analysis);
  const displayName = (row.display_name as string | null) ?? null;
  const originalFilename = (row.original_filename as string | null) ?? null;
  const chosen = (row.category as string | null) ?? null;

  return {
    id: row.id as string,
    caseId: row.deal_room_id as string,
    name: displayName || originalFilename || (row.label as string) || '',
    originalFilename,
    displayName,
    category: suggestCategory({
      chosen,
      documentType: analysis?.documentType ?? null,
      filename: originalFilename,
    }),
    categoryChosen: !!chosen,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    uploadedAt: (row.uploaded_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    storagePath: (row.storage_path as string | null) ?? null,
    archivedAt: (row.archived_at as string | null) ?? null,
    analysisState: (row.analysis_state as string) ?? 'NONE',
    analysisError: (row.analysis_error as string | null) ?? null,
    analyzedAt: (row.analyzed_at as string | null) ?? null,
    analysis,
    headlineSummary: (row.headline_summary as string | null) ?? null,
    extractedPages: (row.extracted_pages as number | null) ?? null,
    sortIndex: (row.sort_index as number | null) ?? null,
    status: documentStatus({
      analysisState: (row.analysis_state as string) ?? 'NONE',
      hasAnalysis: !!analysis,
      archivedAt: (row.archived_at as string | null) ?? null,
      jobState: job?.state ?? null,
      jobStage: job?.stage ?? null,
    }),
  };
}

/**
 * Every document in the case, archived ones included.
 *
 * Archived rows are returned rather than filtered out server-side, because
 * "show archived" is a toggle and a second round trip to flip it would make
 * a local control feel like a page load.
 */
export async function listWorkspaceDocuments(
  roomId: string,
  jobsBySubject?: Map<string, { state: JobState; stage: string | null }>
): Promise<WorkspaceDocument[]> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select(COLUMNS)
    .eq('deal_room_id', roomId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  // `as unknown as`: COLUMNS is built by concatenation, so supabase-js cannot
  // parse it into a row type and falls back to GenericStringError[]. That is a
  // type-level artefact of the select string, not the shape Postgres returns
  // — the same note applies in services/researchJobs.ts.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows
    .map((r) => toWorkspaceDocument(r, jobsBySubject?.get(r.id as string)))
    // A row with no file is a recommendation, not a document the customer gave us.
    .filter((d) => !!d.storagePath);
}

export async function getWorkspaceDocument(documentId: string): Promise<WorkspaceDocument | null> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select(COLUMNS)
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  return data ? toWorkspaceDocument(data as unknown as Record<string, unknown>) : null;
}

/**
 * The text we read out of the document (§8).
 *
 * Fetched separately and only when the reader is opened: a contract's full
 * text is tens of kilobytes and pulling it for every card in a list would
 * make opening the documents tab slower for everyone to serve the one person
 * who wanted to read one.
 */
export async function getExtractedText(documentId: string): Promise<{ text: string; pages: number | null }> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select('extracted_text,extracted_pages')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  return {
    text: ((data?.extracted_text as string | null) ?? '').trim(),
    pages: (data?.extracted_pages as number | null) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Activity (§18)                                                      *
 * ------------------------------------------------------------------ */

export interface DocumentEvent {
  id: string;
  eventType: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export async function listDocumentEvents(documentId: string): Promise<DocumentEvent[]> {
  const { data, error } = await supabase
    .from('deal_room_document_events')
    .select('id,event_type,detail,created_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    eventType: r.event_type as string,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    createdAt: r.created_at as string,
  }));
}

/**
 * Record something that happened.
 *
 * Best-effort by design: a history entry that fails to write must never undo
 * the rename it was describing. The action is what the customer asked for;
 * the note about it is bookkeeping.
 */
async function recordEvent(
  doc: Pick<WorkspaceDocument, 'id' | 'caseId'>,
  eventType: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    await supabase.from('deal_room_document_events').insert({
      document_id: doc.id,
      deal_room_id: doc.caseId,
      user_id: userId,
      event_type: eventType,
      detail,
    });
  } catch (e) {
    reportError(e, { subjectType: 'DOCUMENT', subjectId: doc.id, boundary: 'recordEvent' });
  }
}

/* ------------------------------------------------------------------ *
 * Actions                                                             *
 * ------------------------------------------------------------------ */

/**
 * Rename.
 *
 * Sets display_name and leaves original_filename exactly as it was. A
 * customer renaming "scan_0012.pdf" to "Sale agreement" is labelling their
 * copy, not rewriting what they handed us — and if a dispute ever turns on
 * which file was uploaded, the answer must still be in the row.
 * An empty name clears the label rather than storing a blank.
 */
export async function renameDocument(doc: WorkspaceDocument, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 200);
  const { error } = await supabase
    .from('deal_room_documents')
    .update({ display_name: trimmed || null })
    .eq('id', doc.id);
  if (error) throw error;
  await recordEvent(doc, 'RENAMED', { to: trimmed || null });
}

export async function setDocumentCategory(doc: WorkspaceDocument, category: DocumentCategory): Promise<void> {
  const { error } = await supabase
    .from('deal_room_documents')
    .update({ category })
    .eq('id', doc.id);
  if (error) throw error;
  await recordEvent(doc, 'RECATEGORIZED', { category });
}

/**
 * Archive — the normal way to remove something from view (§19).
 *
 * Nothing is destroyed: the file stays in storage, the analysis stays on the
 * row, and Restore is one click. This is what Delete should have been all
 * along, and it is why Delete is no longer the only visible action.
 */
export async function archiveDocument(doc: WorkspaceDocument): Promise<void> {
  const { error } = await supabase
    .from('deal_room_documents')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', doc.id);
  if (error) throw error;
  await recordEvent(doc, 'ARCHIVED');
}

export async function restoreDocument(doc: WorkspaceDocument): Promise<void> {
  const { error } = await supabase
    .from('deal_room_documents')
    .update({ archived_at: null })
    .eq('id', doc.id);
  if (error) throw error;
  await recordEvent(doc, 'RESTORED');
}

/**
 * Permanent deletion.
 *
 * The object goes first: a row pointing at an object that is gone is
 * recoverable confusion, whereas an object with no row is an orphan nobody
 * can reach or delete. The history row goes WITH the document (the events
 * table cascades), because keeping a trail of a file the customer asked us to
 * destroy is not a courtesy.
 */
export async function deleteDocumentPermanently(doc: WorkspaceDocument): Promise<void> {
  if (doc.storagePath) {
    const { error } = await supabase.storage.from('deal-room-documents').remove([doc.storagePath]);
    if (error) throw error;
  }
  const { error } = await supabase.from('deal_room_documents').delete().eq('id', doc.id);
  if (error) throw error;
}

/** A short-lived link to the file the customer uploaded. The bucket is
 *  private and has no public URL, so this is the only way to reach it. */
export async function downloadUrlFor(doc: WorkspaceDocument): Promise<string | null> {
  if (!doc.storagePath) return null;
  const { data, error } = await supabase.storage
    .from('deal-room-documents')
    .createSignedUrl(doc.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: doc.originalFilename ?? true,
    });
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function reorderDocuments(docs: WorkspaceDocument[]): Promise<void> {
  await Promise.all(
    docs.map((d, i) =>
      supabase.from('deal_room_documents').update({ sort_index: i }).eq('id', d.id)
    )
  );
}

/* ------------------------------------------------------------------ *
 * Asking for it to be read (§20, §40)                                 *
 * ------------------------------------------------------------------ */

/**
 * Analyse, or analyse again.
 *
 * WHAT CHANGED: this used to invoke deal-room-document-analyze and await it.
 * The customer's browser was the only thing driving the work, so navigating
 * away, refreshing, or an edge-function timeout abandoned the request with
 * analysis_state stranded at RUNNING — which is exactly how a production
 * document sat on "Reading document…" for nine hours while holding a complete
 * nine-clause analysis.
 *
 * Now it registers a durable job and returns. jobs-worker picks it up and
 * runs it server-side, so closing the tab is irrelevant.
 *
 * IDEMPOTENCY is the document id, deliberately, and not a timestamp: a
 * double-click must return the SAME job rather than reading — and paying for
 * — the same contract twice. Once that job reaches a terminal state the key
 * is free again, which is what makes a genuine re-analysis possible later.
 *
 * The row is marked QUEUED immediately so the card stops saying "not read
 * yet" the instant the customer asks, without claiming work has begun.
 */
export async function requestAnalysis(
  doc: WorkspaceDocument,
  opts?: { reanalyze?: boolean }
): Promise<BackgroundJob | null> {
  const job = await startJobBestEffort({
    productType: 'DOCUMENT_ANALYSIS',
    subjectType: 'DOCUMENT',
    subjectId: doc.id,
    subjectLabel: doc.name,
    idempotencyKey: `document:${doc.id}`,
    resultRef: `/verify/${doc.caseId}?tab=documents&doc=${doc.id}`,
    metadata: { reanalyze: opts?.reanalyze === true },
  });

  const { error } = await supabase
    .from('deal_room_documents')
    .update({ analysis_state: 'QUEUED', analysis_error: null })
    .eq('id', doc.id);
  if (error) throw error;

  await recordEvent(doc, opts?.reanalyze ? 'REANALYZED' : 'QUEUED', { jobId: job?.id ?? null });
  return job;
}

/**
 * Whether asking again can honestly help.
 *
 * A scan with no text layer will not become readable by being read again, and
 * a file type we cannot open will not change type. Offering Retry there is
 * offering a button that is guaranteed to disappoint (§9: "if an action
 * cannot genuinely work, do not fake it").
 */
export function canReanalyze(doc: WorkspaceDocument): boolean {
  const state = doc.analysisState.toUpperCase();
  if (state === 'UNSUPPORTED' || state === 'REQUIRES_OCR') return false;
  return !!doc.storagePath && doc.status !== 'ARCHIVED' && doc.status !== 'QUEUED';
}
