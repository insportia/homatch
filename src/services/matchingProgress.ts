import { supabase } from '@/db/supabase';

export interface MatchingRunProgress {
  id: string;
  property_id: string;
  campaign_id?: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
  stage: string;
  progress_percent: number;
  sources: Record<string, string>;
  counters: Record<string, any>;
  search_profile?: Record<string, any> | null;
  message?: string | null;
  error?: string | null;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export async function getLatestMatchingProgress(propertyId: string): Promise<MatchingRunProgress | null> {
  const { data } = await supabase
    .from('matching_run_progress')
    .select('*')
    .eq('property_id', propertyId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getLatestProgressForProperties(propertyIds: string[]): Promise<Record<string, MatchingRunProgress>> {
  if (!propertyIds.length) return {};
  const { data } = await supabase
    .from('matching_run_progress')
    .select('*')
    .in('property_id', propertyIds)
    .order('started_at', { ascending: false });

  const out: Record<string, MatchingRunProgress> = {};
  for (const row of Array.isArray(data) ? data : []) {
    if (!out[row.property_id]) out[row.property_id] = row as MatchingRunProgress;
  }
  return out;
}

export async function getUserMatchSummary(propertyIds: string[]) {
  if (!propertyIds.length) return { total: 0, newCount: 0, bestScore: 0 };
  const { data } = await supabase
    .from('matches')
    .select('id,status,match_score,property_id')
    .in('property_id', propertyIds)
    .neq('status', 'REJECTED');
  const rows = Array.isArray(data) ? data : [];
  return {
    total: rows.length,
    newCount: rows.filter(r => r.status === 'NEW').length,
    bestScore: rows.reduce((m, r) => Math.max(m, Number(r.match_score || 0)), 0),
  };
}
