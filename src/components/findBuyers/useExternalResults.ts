// External Discovery results for one property, one search at a time (Find Buyers 3.0).
//
// Reads the property's searches (find_buyers_campaigns ⨝ matching_jobs, with each search's
// own lead counts; RLS: the owner's rows only), then every current
// lead of the chosen search, classifies each into DIRECT / INTEREST / EXCLUDED with the
// pure gate, places it in one of the three tabs (placeLead) and builds the research
// opportunities: lead-derived posts merged with find_buyers_research_opportunities (when
// the database has it). A failed lead read is `failed`, never empty.
//
// While a search runs, `liveJobId` names it: it is the default search even before its
// first lead exists, and `refreshKey` (the status poll's activity mark) re-reads it in
// place — the list on screen is kept while the new read is in flight.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPropertyCampaignRows, getResearchOpportunities, getSearchLeads, type PropertyCampaignRows } from '@/services/findBuyersLeads';
import { buildCampaignList, personKey, uniquePeople, type CampaignSummary, type LiveCampaign } from '@/findBuyers/leadCampaigns';
import {
  buildOpportunities, classifyLead, listableLeads, mergeOpportunities, tabCounts,
  type ClassifiedLead, type OpportunityItem, type OwnerFacts, type ResearchOpportunityRow, type ResultLead, type TabCounts,
} from '@/findBuyers/externalResults';

const EMPTY: ResearchOpportunityRow[] = [];

export interface ExternalResults {
  /** The property's searches, newest first, each with its own counts (zero-lead searches included). */
  campaigns: CampaignSummary[] | null;
  /** Every search together, each person once. */
  allPeople: { total: number; qualified: number } | null;
  /** The search shown: the chosen one, else the live one, else the latest; null = all searches. */
  jobId: string | null;
  /** Every listable lead of the search (sellers, brokers, rejected readings removed). */
  leads: ClassifiedLead[] | null;
  /** Lead-derived post opportunities (each has its own HOMATCH page). */
  opportunities: ReturnType<typeof buildOpportunities>;
  /** The Research Opportunities tab: lead-derived posts and research rows, one per post. */
  items: OpportunityItem[];
  counts: TabCounts;
  failed: boolean;
  capped: boolean;
  reload: () => void;
  /** Drops every cached row (campaigns, leads, research) and reads again: after a clear. */
  reset: () => void;
}

/**
 * @param chosen undefined = follow the live / latest search; null = every search; else one search id.
 */
export function useExternalResults(
  propertyId: string | undefined, chosen: string | null | undefined, owner: OwnerFacts | null,
  opts: {
    liveJobId?: string | null; liveStartedAt?: string | null; liveState?: string | null; refreshKey?: string | number | null;
    /** The server's latest search (find_buyers_campaign_status), live or finished: its state outranks a lagging stored job status. */
    statusJob?: LiveCampaign | null;
  } = {},
): ExternalResults {
  const { liveJobId = null, liveStartedAt = null, liveState = null, refreshKey = null, statusJob = null } = opts;
  const [stored, setStored] = useState<PropertyCampaignRows | null>(null);
  const [rows, setRows] = useState<{ jobId: string | null; rows: ResultLead[] } | null>(null);
  const [research, setResearch] = useState<{ jobId: string | null; rows: ResearchOpportunityRow[] }>({ jobId: null, rows: [] });
  const [failed, setFailed] = useState(false);
  const [capped, setCapped] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const reset = useCallback(() => {
    setStored(null); setRows(null); setResearch({ jobId: null, rows: [] }); setFailed(false); setCapped(false);
    setTick((n) => n + 1);
  }, []);
  /* The first status read only names the search; later changes (new results, a new state) re-read it. */
  const seenKey = useRef<string | number | null>(null);
  useEffect(() => {
    if (refreshKey == null) return;
    if (seenKey.current != null && seenKey.current !== refreshKey) setTick((n) => n + 1);
    seenKey.current = refreshKey;
  }, [refreshKey]);

  useEffect(() => {
    if (!propertyId) return undefined;
    let alive = true;
    getPropertyCampaignRows(propertyId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); return; }
      setFailed(false);
      setStored(res);
    });
    return () => { alive = false; };
  }, [propertyId, tick]);

  /* The searches themselves (not their leads): a running search is listed before its first
     lead, and a newer search with zero leads is still the latest one. */
  const statusKey = statusJob ? `${statusJob.jobId}|${statusJob.state}|${statusJob.createdAt ?? ''}|${statusJob.startedAt ?? ''}|${statusJob.completedAt ?? ''}` : '';
  const campaigns = useMemo(() => {
    if (!stored) return null;
    const live: LiveCampaign | null = statusJob
      ?? (liveJobId ? { jobId: liveJobId, state: liveState ?? 'SEARCHING', startedAt: liveStartedAt, createdAt: liveStartedAt } : null);
    return buildCampaignList({ ...stored, live });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusKey stands for statusJob's fields
  }, [stored, liveJobId, liveStartedAt, liveState, statusKey]);
  const allPeople = useMemo(() => (stored ? uniquePeople(stored.leads) : null), [stored]);

  const jobId = chosen === undefined ? (liveJobId ?? campaigns?.[0]?.jobId ?? null) : chosen;
  const ready = campaigns !== null;
  const lastJob = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!propertyId || !ready) return undefined;
    let alive = true;
    /* A different search clears the list (and its flags); a refresh of the same one keeps it on screen. */
    if (lastJob.current !== jobId) { setCapped(false); lastJob.current = jobId; }
    setRows((prev) => (prev && prev.jobId === jobId ? prev : null));
    getSearchLeads(propertyId, jobId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); setRows({ jobId, rows: [] }); return; }
      setCapped(res.capped);
      /* Every search together: a person found by two searches is one person (the strongest reading, read first, is kept). */
      const all = res.rows as unknown as Array<ResultLead & { person_id?: string | null }>;
      const seen = new Set<string>();
      const list = jobId !== null ? all : all.filter((l) => { const k = personKey(l); if (seen.has(k)) return false; seen.add(k); return true; });
      setRows({ jobId, rows: list });
    });
    getResearchOpportunities(jobId).then((r) => { if (alive) setResearch({ jobId, rows: r }); });
    return () => { alive = false; };
  }, [propertyId, jobId, ready, tick]);

  const market = owner?.market ?? null;
  const current = rows && rows.jobId === jobId ? rows.rows : null;
  const leads = useMemo(() => (current ? listableLeads(current.map((r) => classifyLead(r, market))) : null), [current, market]);
  const opportunities = useMemo(() => (leads ? buildOpportunities(leads, owner) : []), [leads, owner]);
  const researchRows = research.jobId === jobId ? research.rows : EMPTY;
  const items = useMemo(() => mergeOpportunities(opportunities, researchRows), [opportunities, researchRows]);
  const counts = useMemo(() => tabCounts(leads ?? [], items), [leads, items]);
  return { campaigns, allPeople, jobId, leads, opportunities, items, counts, failed, capped, reload, reset };
}
