// Contract revisions: the stored contract text, and the signer's saved decisions.
// Both are read and written under the caller's own session and RLS.

import { supabase } from '@/db/supabase';
import type { Decision } from '@/contracts/revisions';

export async function getContractText(documentId: string): Promise<string | null> {
  const { data, error } = await supabase.from('deal_room_documents').select('extracted_text').eq('id', documentId).maybeSingle();
  if (error) throw error;
  return (data?.extracted_text as string | null) ?? null;
}

export interface SavedRevision {
  id: string;
  version: number;
  /** Identity of the analysis the decisions were made against (analysisIdentity). */
  analysisSha: string;
  decisions: Decision[];
  applied: number;
  unplaced: number;
  createdAt: string;
}

export async function listRevisions(documentId: string): Promise<SavedRevision[]> {
  const { data, error } = await supabase
    .from('contract_revisions')
    .select('id,version,analysis_sha,decisions,applied,unplaced,created_at')
    .eq('document_id', documentId)
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string, version: r.version as number, analysisSha: r.analysis_sha as string, decisions: (r.decisions ?? []) as Decision[],
    applied: r.applied as number, unplaced: r.unplaced as number, createdAt: r.created_at as string,
  }));
}

export async function saveRevision(args: { documentId: string; analysisSha: string; decisions: Decision[]; applied: number; unplaced: number; nextVersion: number }): Promise<SavedRevision> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('not signed in');
  const { data, error } = await supabase
    .from('contract_revisions')
    .insert({ document_id: args.documentId, user_id: auth.user.id, version: args.nextVersion, analysis_sha: args.analysisSha, decisions: args.decisions, applied: args.applied, unplaced: args.unplaced })
    .select('id,version,analysis_sha,decisions,applied,unplaced,created_at')
    .single();
  if (error) throw error;
  return { id: data.id, version: data.version, analysisSha: data.analysis_sha, decisions: data.decisions as Decision[], applied: data.applied, unplaced: data.unplaced, createdAt: data.created_at };
}
