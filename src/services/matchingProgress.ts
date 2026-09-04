import { supabase } from '@/db/supabase';
import { MATCHING_JOB_TERMINAL_STATUSES } from '@/components/matching/MatchingJobProgress';

// Live matching-run status, sourced from the real `matching_jobs` table (the
// one the actual matching pipeline — run-matching-v2 / the continuous worker
// — writes to). This used to read from a separate `matching_run_progress`
// table that belonged to an older, now-disabled pipeline (see
// supabase/functions/seed-demo-matches, which now returns 423 and writes
// nothing); that table stopped being written to entirely, so anything
// reading it silently went stale. `matching_jobs` is the one real system.
export interface LiveMatchingJob {
  id: string;
  property_id: string;
  status: string;
  progress: number;
  current_step: string | null;
  query_packs_created: number;
  queries_run: number;
  signals_collected: number;
  signals_classified: number;
  signals_rejected: number;
  candidates_after_filter: number;
  matches_created: number;
  tiers_run: number;
  provider_results: Record<string, string> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const TERMINAL = new Set<string>(MATCHING_JOB_TERMINAL_STATUSES);
export function isMatchingJobLive(status: string): boolean {
  return !TERMINAL.has(status);
}

const JOB_COLUMNS = 'id,property_id,status,progress,current_step,query_packs_created,queries_run,signals_collected,signals_classified,signals_rejected,candidates_after_filter,matches_created,tiers_run,provider_results,started_at,completed_at,created_at';

/** Latest matching_jobs row (any status) for each of the given properties, keyed by property_id. */
export async function getLatestProgressForProperties(propertyIds: string[]): Promise<Record<string, LiveMatchingJob>> {
  if (!propertyIds.length) return {};
  const { data, error } = await supabase
    .from('matching_jobs')
    .select(JOB_COLUMNS)
    .in('property_id', propertyIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[matchingProgress] failed to load matching_jobs:', error);
    return {};
  }

  const out: Record<string, LiveMatchingJob> = {};
  for (const row of (data ?? []) as LiveMatchingJob[]) {
    if (!out[row.property_id]) out[row.property_id] = row;
  }
  return out;
}

export async function getUserMatchSummary(propertyIds: string[]) {
  if (!propertyIds.length) return { total: 0, newCount: 0, bestScore: 0, topPropertyId: null as string | null };
  const { data, error } = await supabase
    .from('matches')
    .select('id,status,match_score,property_id')
    .in('property_id', propertyIds)
    .neq('status', 'REJECTED');
  if (error) console.error('[matchingProgress] failed to load match summary:', error);
  const rows = Array.isArray(data) ? data : [];

  // The dashboard's "View Matches" action is aggregate (matches across every
  // property the user owns), but the only real matches route is per-property
  // (/property/:id/matches) — there is no "all matches" page. topPropertyId
  // picks a real, useful destination: whichever property has the most unseen
  // (NEW) matches, tie-broken by total match volume, so the button always
  // lands somewhere with something worth looking at instead of no-op'ing back
  // onto the dashboard it was already on.
  const byProperty = new Map<string, { count: number; newCount: number }>();
  for (const row of rows) {
    const entry = byProperty.get(row.property_id) || { count: 0, newCount: 0 };
    entry.count += 1;
    if (row.status === 'NEW') entry.newCount += 1;
    byProperty.set(row.property_id, entry);
  }
  let topPropertyId: string | null = null;
  let topRank = -1;
  for (const [propertyId, entry] of byProperty) {
    const rank = entry.newCount * 100000 + entry.count;
    if (rank > topRank) { topRank = rank; topPropertyId = propertyId; }
  }

  return {
    total: rows.length,
    newCount: rows.filter(r => r.status === 'NEW').length,
    bestScore: rows.reduce((m, r) => Math.max(m, Number(r.match_score || 0)), 0),
    topPropertyId,
  };
}
