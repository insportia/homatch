// External leads, one search at a time (owner, 2026-10-15). Read by FindBuyersResults.
//
// Kept apart from services/findBuyers (which the application shell imports) so the
// results list can change without touching the shell. Both reads go through RLS on
// find_buyers_current_leads: the owner's own rows only. A read error is reported as
// `failed` and never shown as "no results".

import { supabase } from '@/db/supabase';
import type { PotentialLead } from '@/services/findBuyers';
import { indexLeadCampaigns, type LeadCampaign } from '@/findBuyers/leadCampaigns';

export type { LeadCampaign };

const LEAD_COLUMNS = 'id,matching_job_id,counterpart,source,intent_class,overall_score,strength,similarity,intent_score,score_components,evidence,signal_count,signal_at,seen_before,language,created_at,author_name,author_profile_url';
const QUALIFICATION_COLUMNS = 'match_category,budget_fit,location_fit';

/** The property's external searches, newest first. Light: three columns per lead. */
export async function getPropertyLeadCampaigns(propertyId: string): Promise<{ campaigns: LeadCampaign[]; failed: boolean }> {
  const { data, error } = await supabase
    .from('find_buyers_current_leads')
    .select('matching_job_id,match_category,created_at')
    .eq('property_id', propertyId)
    .limit(2000);
  if (error) return { campaigns: [], failed: true };
  return { campaigns: indexLeadCampaigns((data ?? []) as Array<{ matching_job_id: string; match_category: string | null; created_at: string }>), failed: false };
}

/** One page of leads, strongest first, stable order. `jobId` scopes it to one search; null reads all. */
export async function getSearchLeadsPage(propertyId: string, page: number, pageSize: number, jobId: string | null): Promise<{ rows: PotentialLead[]; total: number; failed: boolean }> {
  const from = Math.max(0, page - 1) * pageSize;
  const read = (columns: string) => {
    let q = supabase.from('find_buyers_current_leads').select(columns, { count: 'exact' }).eq('property_id', propertyId);
    if (jobId) q = q.eq('matching_job_id', jobId);
    return q
      .order('overall_score', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
  };
  /* Qualification columns first; a database without them still answers with the legacy columns. */
  let { data, error, count } = await read(`${LEAD_COLUMNS},${QUALIFICATION_COLUMNS}`);
  if (error) ({ data, error, count } = await read(LEAD_COLUMNS));
  if (error) return { rows: [], total: 0, failed: true };
  return {
    rows: ((data ?? []) as unknown as PotentialLead[]).map((l) => ({ ...l, evidence: Array.isArray(l.evidence) ? l.evidence : [] })),
    total: Number(count ?? 0),
    failed: false,
  };
}
