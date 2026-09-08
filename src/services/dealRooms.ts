// HOMATCH — Deal Room data access.
//
// The Deal Room is the buyer's persistent workspace for ONE property. A
// completed Verify creates or attaches to one; the customer comes back days
// later and continues from where they stopped.
//
// WHAT THIS FILE IS AND IS NOT
// ----------------------------
// It is a thin, ownership-safe persistence layer. Every business rule —
// which actions to generate, what the verdict is, which facts are grounded —
// lives in src/dealroom/domain and is already decided before anything here is
// called. That separation is what keeps the rules testable without a database
// and the queries reviewable without reading the rules.
//
// Every write goes through ordinary RLS (`user_id = auth.uid()`, plus a parent
// ownership re-check on child tables). There is no service-role path here and
// there must not be one: a Deal Room contains a customer's private
// due-diligence work, and the only account that may read it is theirs.

import { supabase } from '@/db/supabase';
import { projectVerify, toWriteModel } from '@/dealroom/domain/assemble';
import type { DealRoomProjection } from '@/dealroom/domain/assemble';
import type { VerifySnapshot } from '@/dealroom/domain/verifyExtract';

export interface DealRoomRecord {
  id: string;
  user_id: string;
  cadastral_code: string | null;
  title: string | null;
  address: string | null;
  verify_job_id: string | null;
  verify_snapshot: VerifySnapshot | Record<string, never>;
  verify_refreshed_at: string | null;
  property_type: string;
  status: string;
  budget: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ActionItemRecord {
  id: string;
  deal_room_id: string;
  action_key: string;
  title: string;
  why: string | null;
  category: string | null;
  priority: number;
  grounded_in: string[];
  state: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED';
  completed_at: string | null;
}

export interface QuestionRecord {
  id: string;
  deal_room_id: string;
  question_key: string;
  question: string;
  why: string | null;
  audience: string;
  category: string | null;
  grounded_in: string[];
  asked: boolean;
  answer: string | null;
  answered_at: string | null;
}

export interface DocumentRecord {
  id: string;
  deal_room_id: string;
  doc_key: string;
  label: string;
  state: string;
  evidence_ref: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  analysis_state: string;
  notes: string | null;
}

const ROOM_COLUMNS =
  'id,user_id,cadastral_code,title,address,verify_job_id,verify_snapshot,verify_refreshed_at,' +
  'property_type,status,budget,created_at,updated_at,deleted_at';

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error('not_authenticated');
  return id;
}

/* ------------------------------------------------------------------ *
 * Reads                                                               *
 * ------------------------------------------------------------------ */

export async function listDealRooms(): Promise<DealRoomRecord[]> {
  const { data, error } = await supabase
    .from('deal_rooms')
    .select(ROOM_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DealRoomRecord[];
}

export async function getDealRoom(id: string): Promise<DealRoomRecord | null> {
  const { data, error } = await supabase
    .from('deal_rooms')
    .select(ROOM_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as DealRoomRecord | null;
}

export async function listActionItems(roomId: string): Promise<ActionItemRecord[]> {
  const { data, error } = await supabase
    .from('deal_room_action_items')
    .select('id,deal_room_id,action_key,title,why,category,priority,grounded_in,state,completed_at')
    .eq('deal_room_id', roomId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ActionItemRecord[];
}

export async function listQuestions(roomId: string): Promise<QuestionRecord[]> {
  const { data, error } = await supabase
    .from('deal_room_questions')
    .select('id,deal_room_id,question_key,question,why,audience,category,grounded_in,asked,answer,answered_at')
    .eq('deal_room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as QuestionRecord[];
}

export async function listDocuments(roomId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from('deal_room_documents')
    .select(
      'id,deal_room_id,doc_key,label,state,evidence_ref,storage_path,original_filename,' +
        'mime_type,size_bytes,uploaded_at,analysis_state,notes'
    )
    .eq('deal_room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as DocumentRecord[];
}

/* ------------------------------------------------------------------ *
 * Verify -> Deal Room                                                 *
 * ------------------------------------------------------------------ */

/**
 * Creates the Deal Room for a completed Verify, or returns the existing one.
 *
 * REUSE, NOT DUPLICATION. The migration carries a unique index on
 * (user_id, cadastral_code) for live rooms, because re-verifying the same
 * property must continue the same workspace rather than fragmenting the
 * buyer's history across near-identical rooms. So this looks for an existing
 * room first and re-points it at the newer Verify, preserving every decision
 * artefact — notes, answered questions, uploaded documents — which is exactly
 * what a room is for.
 *
 * Generated content (actions, questions, the document checklist) is upserted
 * on its stable key, so a re-run refreshes wording and grounding WITHOUT
 * resetting the customer's own progress: an action already marked DONE stays
 * DONE, because `state` is not in the update set.
 */
export async function createDealRoomFromVerify(args: {
  jobId: string;
  report: Record<string, unknown> | null;
  /** Set when the caller already computed the projection, to avoid doing it
   * twice on a page that has it in hand. */
  projection?: DealRoomProjection;
}): Promise<{ room: DealRoomRecord; created: boolean }> {
  const userId = await requireUserId();
  const projection = args.projection ?? projectVerify({ jobId: args.jobId, report: args.report });
  const wm = toWriteModel(projection);

  const existing = await findExistingRoom(wm.room.cadastral_code, args.jobId);

  let room: DealRoomRecord;
  let created = false;

  if (existing) {
    const { data, error } = await supabase
      .from('deal_rooms')
      .update({
        verify_job_id: wm.room.verify_job_id,
        verify_snapshot: wm.room.verify_snapshot,
        verify_refreshed_at: new Date().toISOString(),
        property_type: wm.room.property_type,
        // Only fill title/address if the room does not already have them; a
        // customer may have renamed their own room and that must survive.
        title: existing.title ?? wm.room.title,
        address: existing.address ?? wm.room.address,
      })
      .eq('id', existing.id)
      .select(ROOM_COLUMNS)
      .single();
    if (error) throw error;
    room = data as unknown as DealRoomRecord;
  } else {
    const { data, error } = await supabase
      .from('deal_rooms')
      .insert({ ...wm.room, user_id: userId, verify_refreshed_at: new Date().toISOString() })
      .select(ROOM_COLUMNS)
      .single();
    if (error) throw error;
    room = data as unknown as DealRoomRecord;
    created = true;
  }

  await syncGeneratedContent(room.id, userId, wm);
  return { room, created };
}

async function findExistingRoom(cadastral: string | null, jobId: string): Promise<DealRoomRecord | null> {
  if (cadastral) {
    const { data, error } = await supabase
      .from('deal_rooms')
      .select(ROOM_COLUMNS)
      .eq('cadastral_code', cadastral)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as DealRoomRecord;
  }
  // A property with no cadastral code still must not create a second room for
  // the same job.
  const { data, error } = await supabase
    .from('deal_rooms')
    .select(ROOM_COLUMNS)
    .eq('verify_job_id', jobId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as DealRoomRecord | null;
}

/** Upserts generated content on its stable key. Customer state columns
 * (`state`, `asked`, `answer`, everything about an uploaded file) are
 * deliberately absent from the payload so a refresh cannot clobber them. */
async function syncGeneratedContent(
  roomId: string,
  userId: string,
  wm: ReturnType<typeof toWriteModel>
): Promise<void> {
  if (wm.actionItems.length) {
    const { error } = await supabase.from('deal_room_action_items').upsert(
      wm.actionItems.map((a) => ({ ...a, deal_room_id: roomId, user_id: userId })),
      { onConflict: 'deal_room_id,action_key' }
    );
    if (error) throw error;
  }

  if (wm.questions.length) {
    const { error } = await supabase.from('deal_room_questions').upsert(
      wm.questions.map((q) => ({ ...q, deal_room_id: roomId, user_id: userId })),
      { onConflict: 'deal_room_id,question_key' }
    );
    if (error) throw error;
  }

  if (wm.documents.length) {
    const { error } = await supabase.from('deal_room_documents').upsert(
      wm.documents.map((d) => ({
        deal_room_id: roomId,
        user_id: userId,
        doc_key: d.doc_key,
        label: d.label,
        state: d.state,
        evidence_ref: d.evidence_ref,
        notes: d.notes,
      })),
      // `state` IS included here, but only ever moves a checklist entry
      // between RECOMMENDED and VERIFIED_BY_VERIFY, which is derived from
      // evidence rather than from customer action. An uploaded document has a
      // storage_path and its own lifecycle states, and is never regenerated
      // because it has no matching doc_key in the checklist.
      { onConflict: 'deal_room_id,doc_key', ignoreDuplicates: false }
    );
    if (error) throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Customer mutations                                                  *
 * ------------------------------------------------------------------ */

export async function setActionState(
  itemId: string,
  state: ActionItemRecord['state']
): Promise<void> {
  const { error } = await supabase
    .from('deal_room_action_items')
    .update({ state, completed_at: state === 'DONE' ? new Date().toISOString() : null })
    .eq('id', itemId);
  if (error) throw error;
}

export async function answerQuestion(questionId: string, answer: string): Promise<void> {
  const trimmed = answer.trim();
  const { error } = await supabase
    .from('deal_room_questions')
    .update({
      answer: trimmed || null,
      asked: true,
      answered_at: trimmed ? new Date().toISOString() : null,
    })
    .eq('id', questionId);
  if (error) throw error;
}

export async function renameDealRoom(roomId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('deal_rooms')
    .update({ title: title.trim() || null })
    .eq('id', roomId);
  if (error) throw error;
}

export async function archiveDealRoom(roomId: string): Promise<void> {
  const { error } = await supabase.from('deal_rooms').update({ status: 'ARCHIVED' }).eq('id', roomId);
  if (error) throw error;
}

/** Soft delete. The row is kept so a Verify job that references it still
 * resolves, and so an accidental deletion is recoverable by support. */
export async function deleteDealRoom(roomId: string): Promise<void> {
  const { error } = await supabase
    .from('deal_rooms')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', roomId);
  if (error) throw error;
}

export async function addNote(roomId: string, body: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from('deal_room_notes')
    .insert({ deal_room_id: roomId, user_id: userId, body: body.trim() });
  if (error) throw error;
}

export async function listNotes(roomId: string): Promise<{ id: string; body: string; created_at: string }[]> {
  const { data, error } = await supabase
    .from('deal_room_notes')
    .select('id,body,created_at')
    .eq('deal_room_id', roomId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as { id: string; body: string; created_at: string }[];
}
