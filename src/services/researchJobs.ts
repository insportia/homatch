// HOMATCH — read-side access to research_jobs (the Verify due-diligence
// pipeline) for case-history purposes: listing every report ever run for a
// transaction case, and reopening one specific past report by id.
//
// This file never starts, resumes, or skips a research run — that stays
// entirely inside VerifyPage's existing `research-agent` function calls
// (action: start/status/resume/skip). It only ever reads existing rows and
// sets the two linking columns (case_id, supersedes_job_id) added by
// supabase/migrations/20260906120000_research_case_persistence.sql — both
// writes research-agent itself never touches. Every query here goes through
// ordinary RLS (research_jobs_select_own / research_jobs_update_own) — no
// service-role bypass, consistent with transactionCases.ts.

import { supabase } from '@/db/supabase';
import type { ResearchJobRecord } from '@/types/types';

const LIST_COLUMNS = 'id,mode,query,status,stage,error,case_id,supersedes_job_id,created_at,updated_at,completed_at';
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
export async function listResearchJobsForCase(caseId: string): Promise<ResearchJobRecord[]> {
  const { data, error } = await supabase
    .from('research_jobs')
    .select(LIST_COLUMNS)
    .eq('case_id', caseId)
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
