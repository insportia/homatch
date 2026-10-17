// External leads, one search at a time (owner, 2026-10-15). Read by the External Discovery results (useExternalResults).
//
// Kept apart from services/findBuyers (which the application shell imports) so the
// results list can change without touching the shell. Both reads go through RLS on
// find_buyers_current_leads: the owner's own rows only. A read error is reported as
// `failed` and never shown as "no results".

import { supabase } from '@/db/supabase';
import type { PotentialLead } from '@/services/findBuyers';
import {
  buildCampaignList, parseClearOutcome, parseClearPreview,
  type CampaignRow, type ClearOutcome, type ClearPreview, type JobRow, type LeadCampaign, type LeadSummaryRow,
} from '@/findBuyers/leadCampaigns';
import { parseResearchRows, type ResearchOpportunityRow } from '@/findBuyers/externalResults';

export type { LeadCampaign, ClearPreview, ClearOutcome };

const LEAD_COLUMNS = 'id,matching_job_id,counterpart,source,intent_class,overall_score,strength,similarity,intent_score,score_components,evidence,signal_count,signal_at,seen_before,language,created_at,author_name,author_profile_url';
const QUALIFICATION_COLUMNS = 'match_category,budget_fit,location_fit,qualification';
/* The qualification role (a seller, broker or service is never listed), the market and the
   review version: in the table, absent from older databases — read with the same fallback. */
const ROLE_COLUMNS = 'role,transaction,qualification_version';
/** Richest read first; each fallback drops the newest columns a database may not have yet. */
const COLUMN_SETS = [`${LEAD_COLUMNS},${QUALIFICATION_COLUMNS},${ROLE_COLUMNS},person_id`, `${LEAD_COLUMNS},${QUALIFICATION_COLUMNS},${ROLE_COLUMNS}`, `${LEAD_COLUMNS},${QUALIFICATION_COLUMNS}`, LEAD_COLUMNS];

async function readWithFallback<R extends { error: unknown }>(read: (columns: string) => PromiseLike<R>): Promise<R> {
  let res = await read(COLUMN_SETS[0]);
  for (let i = 1; res.error && i < COLUMN_SETS.length; i += 1) res = await read(COLUMN_SETS[i]);
  return res;
}

/** The property's external searches, newest first. Light: three columns per lead. */
export async function getPropertyLeadCampaigns(propertyId: string): Promise<{ campaigns: LeadCampaign[]; failed: boolean }> {
  const res = await getPropertyCampaignRows(propertyId);
  if (res.failed) return { campaigns: [], failed: true };
  return { campaigns: buildCampaignList(res), failed: false };
}

export interface PropertyCampaignRows { campaigns: CampaignRow[]; jobs: JobRow[]; leads: LeadSummaryRow[]; failed: boolean }

const LEAD_SUMMARY_SETS = ['id,matching_job_id,match_category,created_at,seen_before,person_id,author_profile_url', 'id,matching_job_id,match_category,created_at,seen_before', 'matching_job_id,match_category,created_at'];

/**
 * Every search of the property and every current lead's summary (owner RLS on all three):
 *   find_buyers_campaigns  one row per Find Buyers search (matching_job_id, created_at);
 *   matching_jobs          its status and timestamps;
 *   find_buyers_current_leads  per-lead job, category, created_at, seen_before, person.
 * Newest first. A search with zero leads is still a search. The campaigns / jobs reads are
 * enrichment: an error there degrades to the lead-derived list; only a failed lead read is
 * `failed` (never shown as "no results").
 */
export async function getPropertyCampaignRows(propertyId: string): Promise<PropertyCampaignRows> {
  const campaignsRead = Promise.resolve(supabase.from('find_buyers_campaigns')
    .select('matching_job_id,created_at,finalized_at,stop_reason')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(50)).then((r) => (r.error ? [] : ((r.data ?? []) as CampaignRow[]))).catch(() => [] as CampaignRow[]);
  const leadsRead = (async () => {
    let last: { data: unknown; error: unknown } = { data: null, error: true };
    for (const columns of LEAD_SUMMARY_SETS) {
      last = await supabase.from('find_buyers_current_leads').select(columns).eq('property_id', propertyId)
        .order('created_at', { ascending: false }).limit(2000);
      if (!last.error) break;
    }
    return last;
  })();
  const [campaigns, leadsRes] = await Promise.all([campaignsRead, leadsRead]);
  if (leadsRes.error) return { campaigns: [], jobs: [], leads: [], failed: true };
  const leads = (Array.isArray(leadsRes.data) ? leadsRes.data : []) as LeadSummaryRow[];
  const ids = [...new Set([...campaigns.map((c) => c.matching_job_id), ...leads.map((l) => l.matching_job_id)].filter((x): x is string => Boolean(x)))].slice(0, 100);
  let jobs: JobRow[] = [];
  if (ids.length) {
    try {
      const r = await supabase.from('matching_jobs').select('id,status,created_at,started_at,completed_at,updated_at').in('id', ids);
      jobs = r.error || !Array.isArray(r.data) ? [] : (r.data as JobRow[]);
    } catch { jobs = []; }
  }
  return { campaigns, jobs, leads, failed: false };
}

/* ── Clear old results (owner-scoped RPCs, explicit confirmation in the UI) ── */

/** What a clear would hide. null = the server cannot answer (e.g. the RPC is not deployed yet). */
export async function getClearResultsPreview(propertyId: string): Promise<ClearPreview | null> {
  try {
    const { data, error } = await supabase.rpc('find_buyers_clear_results_preview', { p_property_id: propertyId });
    if (error) return null;
    return parseClearPreview(data);
  } catch {
    return null;
  }
}

/** Hides the property's completed searches' results for its owner. Never deletes the property, credits, payments or audit. */
export async function clearOldResults(propertyId: string): Promise<ClearOutcome | null> {
  try {
    const { data, error } = await supabase.rpc('find_buyers_clear_results', { p_property_id: propertyId });
    if (error) return null;
    return parseClearOutcome(data);
  } catch {
    return null;
  }
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
  /* Qualification and role columns first; a database without them still answers with the legacy columns. */
  const { data, error, count } = await readWithFallback(read);
  if (error) return { rows: [], total: 0, failed: true };
  return {
    rows: ((data ?? []) as unknown as PotentialLead[]).map((l) => ({ ...l, evidence: Array.isArray(l.evidence) ? l.evidence : [] })),
    total: Number(count ?? 0),
    failed: false,
  };
}

/**
 * Every current lead of one search (or of all searches when jobId is null), for the
 * external results tabs and post opportunities. Bounded: a search never stores
 * thousands of people, and the cap is stated rather than silently truncated.
 */
export const SEARCH_LEADS_CAP = 500;
export async function getSearchLeads(propertyId: string, jobId: string | null): Promise<{ rows: PotentialLead[]; failed: boolean; capped: boolean }> {
  const read = (columns: string) => {
    let q = supabase.from('find_buyers_current_leads').select(columns).eq('property_id', propertyId);
    if (jobId) q = q.eq('matching_job_id', jobId);
    return q.order('overall_score', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true }).limit(SEARCH_LEADS_CAP);
  };
  const { data, error } = await readWithFallback(read);
  if (error) return { rows: [], failed: true, capped: false };
  const rows = ((data ?? []) as unknown as PotentialLead[]).map((l) => ({ ...l, evidence: Array.isArray(l.evidence) ? l.evidence : [] }));
  return { rows, failed: false, capped: rows.length >= SEARCH_LEADS_CAP };
}

/**
 * One lead, for its detail page (/property/:id/buyers/lead/:leadId). Same view, same RLS
 * (the owner's own rows only), same columns as the list. `missing` = no such current lead
 * for this property (expired by the 30-day rule, another owner's, or a typed id).
 */
export async function getLead(propertyId: string, leadId: string): Promise<{ lead: PotentialLead | null; failed: boolean }> {
  const read = (columns: string) => supabase.from('find_buyers_current_leads').select(columns)
    .eq('property_id', propertyId).eq('id', leadId).limit(1);
  const { data, error } = await readWithFallback(read);
  if (error) return { lead: null, failed: true };
  const row = ((data ?? []) as unknown as PotentialLead[])[0];
  return { lead: row ? { ...row, evidence: Array.isArray(row.evidence) ? row.evidence : [] } : null, failed: false };
}

/**
 * Comparable posts worth reading for one search (find_buyers_research_opportunities). Optional
 * by design: a database without the function, or any error, answers [] and the tab shows the
 * lead-derived opportunities alone.
 */
export async function getResearchOpportunities(jobId: string | null): Promise<ResearchOpportunityRow[]> {
  if (!jobId) return [];
  try {
    const { data, error } = await supabase.rpc('find_buyers_research_opportunities', { p_job_id: jobId });
    if (error) return [];
    return parseResearchRows(data);
  } catch {
    return [];
  }
}
