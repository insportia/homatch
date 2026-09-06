// HOMATCH — read-side access to research_jobs (the Verify due-diligence
// pipeline) for case-history purposes: listing every report ever run for a
// transaction case, and reopening one specific past report by id. Also backs
// the global Verify History sidebar (mandate section 29): every research run
// a user has ever started, across every case, searchable/filterable/
// renamable/(soft-)deletable — see
// supabase/migrations/20260906130000_research_jobs_verify_history.sql.
//
// This file never starts, resumes, or skips a research run — that stays
// entirely inside VerifyPage's existing `research-agent` function calls
// (action: start/status/resume/skip). Opening a history entry is always a
// plain SELECT (getResearchJob), never a new research-agent invocation —
// this is what makes "open report" cost zero new research. It only ever
// reads existing rows and writes the columns explicitly listed below; every
// write goes through ordinary RLS (research_jobs_update_own,
// `auth.uid() = user_id`, unrestricted by column) — no service-role bypass,
// consistent with transactionCases.ts.

import { supabase } from '@/db/supabase';
import type { ResearchJobRecord } from '@/types/types';

const LIST_COLUMNS =
  'id,mode,query,status,stage,error,case_id,supersedes_job_id,created_at,updated_at,completed_at,' +
  'title,deleted_at,entity_name,project_name,address,developer_name,company_name,coverage_level,outstanding_count';
const FULL_COLUMNS = `${LIST_COLUMNS},result_json`;

// Fetches one job WITH its result_json — used to open a specific report
// (including reopening an old, already-COMPLETE one without re-running
// anything: this is a plain SELECT, the same read research-agent's own
// 'status' action performs).
export async function getResearchJob(jobId: string): Promise<ResearchJobRecord | null> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select(FULL_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ResearchJobRecord | null;
}

// Every research run ever attached to a case, newest first — result_json is
// deliberately excluded here (it can be a large dossier per row); fetch it
// per-job via getResearchJob() only when the user actually opens one.
// Excludes soft-deleted rows (deleted_at) so "delete" from the Verify
// History sidebar consistently hides an entry everywhere, not just there —
// getResearchJob() itself still allows opening one by id directly, so a
// case's own case.research_job_id link never breaks even if that job was
// separately hidden from history.
export async function listResearchJobsForCase(caseId: string): Promise<ResearchJobRecord[]> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select(LIST_COLUMNS)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ResearchJobRecord[];
}

// Points a research_jobs row at the case it belongs to (and, for a
// "Refresh Research" run, at the job it replaces). RLS lets the owner
// update any column of their own row; the DB trigger added alongside these
// columns additionally rejects a case_id/supersedes_job_id that isn't
// owned by the same user, so this can never attach a job to someone else's
// case even if the id were guessed.
export async function linkResearchJobToCase(
  jobId: string,
  caseId: string,
  supersedesJobId?: string | null
): Promise<void> {
  const patch: { case_id: string; supersedes_job_id?: string | null } = { case_id: caseId };
  if (supersedesJobId) patch.supersedes_job_id = supersedesJobId;
  const { error } = await supabase.from('research_jobs').update(patch).eq('id', jobId);
  if (error) throw error;
}

// listVerifyHistory(): every research run this user has ever started, across
// every case (or none), newest first, excluding soft-deleted rows — the
// exact query the Verify History sidebar needs. result_json is deliberately
// excluded (see FULL_COLUMNS/getResearchJob) so opening the sidebar is cheap
// regardless of how many large dossiers the user has accumulated. Search/
// filter (by title/cadastral/address/project/company/type) happens
// client-side over this same list — see VerifyPage.tsx's VerifyHistorySidebar.
export async function listVerifyHistory(userId: string): Promise<ResearchJobRecord[]> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select(LIST_COLUMNS)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as ResearchJobRecord[];
}

// renameResearchJob() / softDeleteResearchJob(): the sidebar's Rename and
// Delete actions. Delete is ALWAYS a soft delete (sets deleted_at) — never a
// real DELETE, since a row can still be referenced by
// transaction_cases.research_job_id or by another row's supersedes_job_id
// (see the migration's own header comment for why). "Undo delete" is
// therefore always possible in principle (clear deleted_at) even though the
// current UI does not yet expose that — nothing is destroyed.
export async function renameResearchJob(jobId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  const { error } = await supabase
    .from('research_jobs')
    .update({ title: trimmed.length ? trimmed : null })
    .eq('id', jobId);
  if (error) throw error;
}

export async function softDeleteResearchJob(jobId: string): Promise<void> {
  const { error } = await supabase.from('research_jobs').update({ deleted_at: new Date().toISOString() }).eq('id', jobId);
  if (error) throw error;
}
