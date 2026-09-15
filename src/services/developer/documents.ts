// HOMATCH FOR DEVELOPERS — the document centre and what we do with what a
// document appears to say.
//
// THE ONE RULE (§38)
//
// Extraction is a READING. It is stored beside the document, shown to a
// person with the confidence and the evidence, and applied to nothing. A row
// in dev_payments appears because somebody looked at the receipt and pressed
// Confirm; never because a model was fairly sure.
//
// So there are two functions here that look similar and are not:
// saveExtraction() writes what was read, and confirmExtractionAsPayment()
// creates the payment — and only the second one changes any figure in this
// product.

import { run, runList, supabase, rpc } from './client';
import type { DevDocument, DocumentType, DocumentExtraction } from './types';

export const MEDIA_BUCKET = 'developer-media';
export const DOCUMENT_BUCKET = 'developer-documents';

/** Twenty-five megabytes, matching the bucket, checked before the upload starts. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const DOCUMENT_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const MEDIA_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
]);

/**
 * A filename from a browser is a string a person typed, and it arrives with
 * whatever they typed in it — slashes, dots, right-to-left overrides. It is
 * used for the DISPLAY title and never for the storage key, which is built
 * from a uuid and the extension we validated.
 */
export function safeExtension(fileName: string, mime: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1]?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return mime.slice(6).replace('jpeg', 'jpg');
  return 'bin';
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadResult {
  storagePath: string;
  bucket: string;
}

async function uploadTo(
  bucket: string, workspaceId: string, folder: string, file: File,
  allowed: Set<string>, maxBytes: number,
): Promise<UploadResult> {
  const { DevError } = await import('./client');
  if (file.size > maxBytes) {
    throw new DevError('dev_err_file_too_large', `file ${file.size} > ${maxBytes}`, null);
  }
  // The MIME the browser reports is a hint, not proof — but combined with the
  // bucket's own allowed_mime_types, which the server enforces, it is enough
  // to refuse the obvious cases before spending the upload.
  if (!allowed.has(file.type)) {
    throw new DevError('dev_err_file_type', `mime ${file.type} not allowed`, null);
  }

  const path = `${workspaceId}/${folder}/${randomKey()}.${safeExtension(file.name, file.type)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type,
  });
  if (error) {
    const { toDevError } = await import('./client');
    throw toDevError(error, { op: 'upload', subjectId: workspaceId });
  }
  return { storagePath: path, bucket };
}

/** Marketing images. Public bucket, so the returned URL is stable and cacheable. */
export async function uploadMedia(
  workspaceId: string, folder: 'units' | 'projects' | 'buildings' | 'plans', file: File,
): Promise<string> {
  const { storagePath } = await uploadTo(
    MEDIA_BUCKET, workspaceId, folder, file, MEDIA_MIMES, MAX_MEDIA_BYTES);
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export interface CreateDocumentInput {
  file: File;
  docType: DocumentType;
  title?: string;
  projectId?: string | null;
  unitId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  reservationId?: string | null;
  visibility?: DevDocument['visibility'];
}

export async function uploadDocument(
  workspaceId: string, input: CreateDocumentInput,
): Promise<DevDocument> {
  const { storagePath } = await uploadTo(
    DOCUMENT_BUCKET, workspaceId, 'documents', input.file, DOCUMENT_MIMES, MAX_DOCUMENT_BYTES);

  return run<DevDocument>(
    'uploadDocument',
    supabase.from('dev_documents').insert({
      workspace_id: workspaceId,
      doc_type: input.docType,
      title: input.title?.trim() || input.file.name,
      storage_path: storagePath,
      mime: input.file.type,
      size_bytes: input.file.size,
      project_id: input.projectId ?? null,
      unit_id: input.unitId ?? null,
      deal_id: input.dealId ?? null,
      lead_id: input.leadId ?? null,
      reservation_id: input.reservationId ?? null,
      // A contract defaults to PRIVATE and the UI does not offer PUBLIC for
      // it at all. Marketing documents are the only ones a person can open up.
      visibility: input.visibility ?? 'PRIVATE',
      status: 'UPLOADED',
    }).select().single(),
    workspaceId,
  );
}

export interface DocumentQuery {
  docType?: DocumentType[];
  dealId?: string | null;
  leadId?: string | null;
  unitId?: string | null;
  projectId?: string | null;
  status?: DevDocument['status'][];
  search?: string;
}

export async function listDocuments(
  workspaceId: string, q: DocumentQuery = {},
): Promise<DevDocument[]> {
  let query = supabase.from('dev_documents').select('*').eq('workspace_id', workspaceId);
  if (q.docType && q.docType.length > 0) query = query.in('doc_type', q.docType);
  if (q.status && q.status.length > 0) query = query.in('status', q.status);
  if (q.dealId) query = query.eq('deal_id', q.dealId);
  if (q.leadId) query = query.eq('lead_id', q.leadId);
  if (q.unitId) query = query.eq('unit_id', q.unitId);
  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.search?.trim()) {
    query = query.ilike('title', `%${q.search.trim().replace(/[%,()]/g, '')}%`);
  }
  return runList<DevDocument>(
    'listDocuments', query.order('created_at', { ascending: false }).limit(300), workspaceId);
}

/** Documents waiting for a human decision. The finance and legal queue (§123). */
export async function listReviewQueue(workspaceId: string): Promise<DevDocument[]> {
  return listDocuments(workspaceId, { status: ['EXTRACTED', 'ANALYZING'] });
}

/**
 * A private document is never served from a durable URL. Sixty seconds is
 * enough to open it and short enough that a link pasted into a chat is dead
 * before it arrives.
 */
export async function signedDocumentUrl(storagePath: string, seconds = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET).createSignedUrl(storagePath, seconds);
  if (error) {
    const { toDevError } = await import('./client');
    throw toDevError(error, { op: 'signedDocumentUrl' });
  }
  return data.signedUrl;
}

export async function updateDocument(
  documentId: string, patch: Partial<DevDocument>,
): Promise<DevDocument> {
  return run<DevDocument>(
    'updateDocument',
    supabase.from('dev_documents').update(patch).eq('id', documentId).select().single(),
    documentId,
  );
}

/** What a reader thought it said. Changes no figure anywhere. */
export async function saveExtraction(
  documentId: string, extraction: DocumentExtraction, confidence: number | null,
): Promise<DevDocument> {
  return updateDocument(documentId, {
    extraction, extraction_confidence: confidence, status: 'EXTRACTED', extraction_error: null,
  });
}

export async function saveExtractionFailure(
  documentId: string, message: string,
): Promise<DevDocument> {
  return updateDocument(documentId, { status: 'FAILED', extraction_error: message });
}

/**
 * The confirm step, and the only place an extraction becomes money.
 *
 * Everything it writes comes from `confirmed`, which is what the person had
 * on screen and edited — not from document.extraction. If they corrected the
 * amount before pressing the button, the corrected amount is what is stored,
 * and the original reading stays on the document for whoever asks later why
 * the two differ.
 */
export async function confirmExtractionAsPayment(
  workspaceId: string,
  document: DevDocument,
  confirmed: {
    dealId: string;
    scheduleId?: string | null;
    amount: number;
    currency: string;
    paidAt: string;
    method?: string | null;
    reference?: string | null;
  },
): Promise<void> {
  const { recordPayment } = await import('./sales');
  const payment = await recordPayment(workspaceId, {
    dealId: confirmed.dealId,
    scheduleId: confirmed.scheduleId ?? null,
    amount: confirmed.amount,
    currency: confirmed.currency,
    paidAt: confirmed.paidAt,
    method: confirmed.method ?? null,
    reference: confirmed.reference ?? null,
    documentId: document.id,
  });

  await updateDocument(document.id, {
    status: 'CONFIRMED',
    deal_id: confirmed.dealId,
    confirmed_at: new Date().toISOString(),
  } as Partial<DevDocument>);

  const { addActivity } = await import('./crm');
  await addActivity(workspaceId, {
    dealId: confirmed.dealId, leadId: document.lead_id, unitId: document.unit_id,
    kind: 'DOCUMENT', provenance: 'DOCUMENT',
    title: 'Receipt reviewed and recorded as a payment',
    meta: { document_id: document.id, payment_id: payment.id, amount: confirmed.amount },
  });
}

/**
 * ASK FOR THE DOCUMENT TO BE READ.
 *
 * Returns what happened rather than throwing on every unhappy path, because
 * most of them are not errors: a brochure has no contract number, a
 * photographed contract has no text layer, and both are facts a person needs
 * told plainly. Only an unreachable function throws.
 *
 * Nothing this returns has changed a figure. The reading lands on the
 * document and waits for a human; see applyExtraction below.
 */
export type ExtractionState =
  | 'EXTRACTED' | 'NOTHING_FOUND' | 'REQUIRES_OCR' | 'NOT_EXTRACTABLE'
  | 'BILLING_REQUIRED' | 'FAILED';

export interface ExtractionRunResult {
  state: ExtractionState;
  reason?: string;
  fields?: number;
  dropped?: number;
  confidence?: number | null;
}

export async function requestExtraction(documentId: string): Promise<ExtractionRunResult> {
  const { data, error } = await supabase.functions.invoke<ExtractionRunResult>(
    'developer-document-extract',
    { body: { documentId } },
  );
  if (error) {
    // A 402 is a real answer, not a transport failure: the edge client
    // surfaces it as an error, so it is unwrapped rather than thrown.
    const context = (error as { context?: { status?: number } }).context;
    if (context?.status === 402) return { state: 'BILLING_REQUIRED' };
    throw error;
  }
  return data ?? { state: 'FAILED', reason: 'NO_RESPONSE' };
}

/**
 * APPLYING WHAT A REVIEWER ACCEPTED — and only that.
 *
 * `fields` is the subset of the proposal a person ticked on screen, not the
 * extraction object. That distinction is the whole safety property: an
 * unattended process cannot reach this function with a full payload and
 * quietly rewrite a contract, because the payload is assembled from
 * checkboxes.
 *
 * The database refuses a field whose current value disagrees with the
 * proposal unless `overwrite` is set, and it returns what it applied AND what
 * it declined, with the reason. A receipt becomes a RECORDED payment and
 * never a confirmed one — confirming money stays finance's deliberate act.
 */
export interface ExtractionApplyResult {
  applied: Array<{ field: string; from?: unknown; to: unknown; note?: string; payment_id?: string }>;
  skipped: Array<{ field: string; existing?: unknown; proposed: unknown; reason: string }>;
  /**
   * Something the change left inconsistent that a person has to decide about.
   *
   * Correcting a sale price does NOT re-derive the instalments: those are what
   * the buyer agreed to and one of them is usually already paid, so rewriting
   * them would silently change a signed payment plan. The gap between the new
   * price and the plan's total is reported here instead.
   */
  warnings: Array<{
    kind: 'SCHEDULE_TOTAL_MISMATCH';
    sale_price: number;
    schedule_total: number;
    difference: number;
  }>;
}

export async function applyExtraction(
  documentId: string,
  fields: Record<string, string | number | null>,
  overwrite = false,
): Promise<ExtractionApplyResult> {
  return rpc<ExtractionApplyResult>('dev_apply_extraction', {
    p_document_id: documentId,
    p_fields: fields,
    p_overwrite: overwrite,
  }, documentId);
}

export async function rejectExtraction(documentId: string, reason: string): Promise<void> {
  await rpc<void>('dev_reject_extraction', {
    p_document_id: documentId, p_reason: reason,
  }, documentId);
}

/**
 * Which deal a receipt is probably about.
 *
 * Suggestion only, and it says why. A weak match is offered as one of several
 * alternatives, never applied (§39). Matching is deliberately simple and
 * explainable — a reference string that appears in the deal, a unit number, an
 * amount that equals an outstanding instalment — because a person has to be
 * able to agree or disagree with the reason, not just the answer.
 */
export interface DocumentMatch {
  dealId: string;
  scheduleId: string | null;
  label: string;
  reasons: string[];
  strength: 'STRONG' | 'POSSIBLE';
}

export function suggestMatches(
  extraction: DocumentExtraction | null,
  candidates: Array<{
    dealId: string; unitNumber: string; buyer: string | null; contractNumber: string | null;
    currency: string;
    schedule: Array<{ id: string; label: string; amount: number; paidAmount: number; status: string }>;
  }>,
): DocumentMatch[] {
  if (!extraction) return [];
  const amount = extraction.suggested_amount ?? null;
  const unitHint = extraction.suggested_unit_number?.toLowerCase().trim() ?? null;
  const reference = extraction.suggested_reference?.toLowerCase().trim() ?? null;

  const matches: DocumentMatch[] = [];
  for (const c of candidates) {
    const reasons: string[] = [];
    if (unitHint && c.unitNumber.toLowerCase() === unitHint) reasons.push('unit');
    if (reference && c.contractNumber && reference.includes(c.contractNumber.toLowerCase())) {
      reasons.push('contract');
    }

    let scheduleId: string | null = null;
    if (amount != null) {
      const due = c.schedule.find(
        (s) => s.status !== 'PAID' && Math.abs((s.amount - s.paidAmount) - amount) < 0.01);
      if (due) {
        scheduleId = due.id;
        reasons.push('amount');
      }
    }

    if (reasons.length === 0) continue;
    matches.push({
      dealId: c.dealId,
      scheduleId,
      label: `${c.unitNumber}${c.buyer ? ` — ${c.buyer}` : ''}`,
      reasons,
      // Two independent agreements is a strong match. One is worth offering
      // and is not worth acting on by itself.
      strength: reasons.length >= 2 ? 'STRONG' : 'POSSIBLE',
    });
  }

  return matches.sort((a, b) => (b.reasons.length - a.reasons.length));
}
