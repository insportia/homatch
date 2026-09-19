// HOMATCH — CONTRACTS, the product.
//
// A contract analysis was previously something that happened *inside* a Deal
// Room: to have a document read, a customer first had to understand a
// workspace concept, create one, and then find the upload inside it. That is
// a container the customer never asked for. Contracts is now its own product,
// entered directly, and nothing here requires the customer to know what a
// deal room is.
//
// WHAT CHANGED UNDERNEATH: NOTHING.
//
// Deliberately so. `deal_room_documents` already carries `user_id` on every
// row (uploadDocument sets it), so "every contract this person has ever
// uploaded" is a plain user-scoped select — no join, no backfill, and no
// migration. Every document uploaded under the old Deal Room UI therefore
// appears in Contracts history the first time this code runs, because it was
// always addressable this way and nothing was ever asking the question.
//
// The `deal_rooms` row survives as a storage container, because the storage
// path is <userId>/<roomId>/<documentId> and the RLS policy on the bucket is
// written against it. Renaming that concept in the database would mean moving
// every stored object of every existing customer, which is a large and
// entirely invisible risk taken for no customer benefit. So the container
// stays, and stops being a thing anyone is shown.

import { supabase } from '@/db/supabase';
import { createDocumentVerificationCase } from '@/services/dealRooms';
import { uploadDocument, analyzeDocument, type AnalysisState } from '@/services/dealRoomDocuments';

/** One contract in the customer's own list. */
export interface ContractSummary {
  id: string;
  label: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  analysisState: AnalysisState;
  /** The storage container. Never shown; needed for findings and re-reads. */
  roomId: string;
  /** Present when this contract was uploaded against a verified property. */
  cadastralCode: string | null;
  address: string | null;
  /** The verification this property's facts came from, when there is one. */
  verifyJobId: string | null;
}

const DOC_COLUMNS =
  'id,deal_room_id,label,original_filename,mime_type,size_bytes,uploaded_at,analysis_state,created_at';

interface DocRow {
  id: string;
  deal_room_id: string;
  label: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  analysis_state: string | null;
  created_at: string | null;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error('not_authenticated');
  return id;
}

/**
 * Every contract this customer has uploaded, newest first.
 *
 * `limit` exists so the entry page can ask for the recent few without paying
 * for the whole history; the history page asks for all of them.
 *
 * Property context is read through the container in the same round trip, so a
 * contract uploaded from a verified property can show which property it was
 * about without a second query per row.
 */
export async function listContracts(limit?: number): Promise<ContractSummary[]> {
  const userId = await requireUserId();
  let q = supabase
    .from('deal_room_documents')
    .select(`${DOC_COLUMNS},deal_rooms(cadastral_code,address,verify_job_id)`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (limit && limit > 0) q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((raw): ContractSummary => {
    const r = raw as unknown as DocRow & {
      deal_rooms?: unknown;
    };
    // Supabase returns an embedded to-one relation as an object, but types it
    // as possibly an array depending on how the FK is introspected. Normalise
    // rather than trust either shape.
    const roomRaw = r.deal_rooms as unknown;
    const room = (Array.isArray(roomRaw) ? roomRaw[0] : roomRaw) as
      | { cadastral_code: string | null; address: string | null; verify_job_id: string | null }
      | null
      | undefined;
    return {
      id: r.id,
      label: r.label || r.original_filename || '',
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      uploadedAt: r.uploaded_at ?? r.created_at,
      analysisState: (r.analysis_state ?? 'NONE') as AnalysisState,
      roomId: r.deal_room_id,
      cadastralCode: room?.cadastral_code ?? null,
      address: room?.address ?? null,
      verifyJobId: room?.verify_job_id ?? null,
    };
  });
}

/** One contract by id, for the result page and for Previous/Next. */
export async function getContract(documentId: string): Promise<ContractSummary | null> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select(`${DOC_COLUMNS},deal_rooms(cadastral_code,address,verify_job_id)`)
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as DocRow & { deal_rooms?: unknown };
  const roomRaw = r.deal_rooms;
  const room = (Array.isArray(roomRaw) ? roomRaw[0] : roomRaw) as
    | { cadastral_code: string | null; address: string | null; verify_job_id: string | null }
    | null
    | undefined;
  return {
    id: r.id,
    label: r.label || r.original_filename || '',
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at ?? r.created_at,
    analysisState: (r.analysis_state ?? 'NONE') as AnalysisState,
    roomId: r.deal_room_id,
    cadastralCode: room?.cadastral_code ?? null,
    address: room?.address ?? null,
    verifyJobId: room?.verify_job_id ?? null,
  };
}

/**
 * Take a contract in and start reading it.
 *
 * ONE STEP, BECAUSE THE CUSTOMER ASKED FOR ONE THING. Uploading a contract
 * and having it read are not two decisions; the old flow made the customer
 * press a second button to start the analysis, which produced the documents
 * that sat forever in NONE. This uploads and requests the analysis together.
 *
 * `roomId` is passed when the contract belongs to a property the customer has
 * already verified, so the analysis can be cross-checked against what Homatch
 * established. Without it a private container is created for this upload, and
 * the customer is never told it exists.
 */
export async function startContractAnalysis(args: {
  file: File;
  roomId?: string | null;
  language?: string;
}): Promise<{ documentId: string; state: AnalysisState }> {
  const roomId =
    args.roomId ?? (await createDocumentVerificationCase(args.file.name)).id;

  const { documentId } = await uploadDocument({ roomId, file: args.file });

  // A failure here must not lose the upload: the document row and its bytes
  // are already safe, the result page polls the row, and it offers a retry.
  // Throwing away a successful upload because the analyser was briefly busy
  // would be the worse outcome.
  try {
    const { state } = await analyzeDocument(documentId, { language: args.language });
    return { documentId, state };
  } catch {
    return { documentId, state: 'QUEUED' };
  }
}

/**
 * The contracts already read for ONE verification.
 *
 * Scoped to the verification's own container, which is precise: re-verifying
 * a property reuses the same container (one live room per user and cadastral
 * code), so every contract ever uploaded against this property is here and
 * nothing belonging to another property is.
 *
 * This is the one read that fetches `analysis`, because the caller has to
 * know whether a contract disagrees with the verification before it can say
 * so — and a disagreement is the single most useful thing this section can
 * report. It is affordable precisely because it is scoped: a property has a
 * handful of contracts, not a history of them. The unscoped list() above
 * deliberately does not select it.
 */
export async function listContractsForRoom(
  roomId: string
): Promise<(ContractSummary & { analysis: unknown })[]> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select(`${DOC_COLUMNS},analysis,deal_rooms(cadastral_code,address,verify_job_id)`)
    .eq('deal_room_id', roomId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((raw) => {
    const r = raw as unknown as DocRow & { analysis?: unknown; deal_rooms?: unknown };
    const roomRaw = r.deal_rooms;
    const room = (Array.isArray(roomRaw) ? roomRaw[0] : roomRaw) as
      | { cadastral_code: string | null; address: string | null; verify_job_id: string | null }
      | null
      | undefined;
    return {
      id: r.id,
      label: r.label || r.original_filename || '',
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      uploadedAt: r.uploaded_at ?? r.created_at,
      analysisState: (r.analysis_state ?? 'NONE') as AnalysisState,
      roomId: r.deal_room_id,
      cadastralCode: room?.cadastral_code ?? null,
      address: room?.address ?? null,
      verifyJobId: room?.verify_job_id ?? null,
      analysis: r.analysis ?? null,
    };
  });
}
