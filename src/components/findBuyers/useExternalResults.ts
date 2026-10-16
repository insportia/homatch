// External Discovery results for one property, one search at a time (Find Buyers 3.0).
//
// Reads the property's searches (from its own current leads, RLS), then every current
// lead of the chosen search, classifies each into DIRECT / INTEREST / EXCLUDED with the
// pure gate, places it in one of the three tabs (placeLead) and builds the research
// opportunities: lead-derived posts merged with find_buyers_research_opportunities (when
// the database has it). A failed lead read is `failed`, never empty.
//
// While a search runs, `liveJobId` names it: it is the default search even before its
// first lead exists, and `refreshKey` (the status poll's activity mark) re-reads it in
// place — the list on screen is kept while the new read is in flight.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPropertyLeadCampaigns, getResearchOpportunities, getSearchLeads, type LeadCampaign } from '@/services/findBuyersLeads';
import {
  buildOpportunities, classifyLead, listableLeads, mergeOpportunities, tabCounts,
  type ClassifiedLead, type OpportunityItem, type OwnerFacts, type ResearchOpportunityRow, type ResultLead, type TabCounts,
} from '@/findBuyers/externalResults';

const EMPTY: ResearchOpportunityRow[] = [];

export interface ExternalResults {
  campaigns: LeadCampaign[] | null;
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
}

/**
 * @param chosen undefined = follow the live / latest search; null = every search; else one search id.
 */
export function useExternalResults(
  propertyId: string | undefined, chosen: string | null | undefined, owner: OwnerFacts | null,
  opts: { liveJobId?: string | null; liveStartedAt?: string | null; refreshKey?: string | number | null } = {},
): ExternalResults {
  const { liveJobId = null, liveStartedAt = null, refreshKey = null } = opts;
  const [stored, setStored] = useState<LeadCampaign[] | null>(null);
  const [rows, setRows] = useState<{ jobId: string | null; rows: ResultLead[] } | null>(null);
  const [research, setResearch] = useState<{ jobId: string | null; rows: ResearchOpportunityRow[] }>({ jobId: null, rows: [] });
  const [failed, setFailed] = useState(false);
  const [capped, setCapped] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
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
    getPropertyLeadCampaigns(propertyId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); return; }
      setFailed(false);
      setStored(res.campaigns);
    });
    return () => { alive = false; };
  }, [propertyId, tick]);

  /* A running search is a search of this property before its first lead is stored. */
  const campaigns = useMemo(() => {
    if (!stored) return null;
    if (!liveJobId || stored.some((c) => c.jobId === liveJobId)) return stored;
    return [{ jobId: liveJobId, firstAt: liveStartedAt ?? new Date(0).toISOString(), total: 0, strong: 0, potential: 0, weak: 0, uncategorised: 0 }, ...stored];
  }, [stored, liveJobId, liveStartedAt]);

  const jobId = chosen === undefined ? (liveJobId ?? campaigns?.[0]?.jobId ?? null) : chosen;
  const ready = campaigns !== null;

  useEffect(() => {
    if (!propertyId || !ready) return undefined;
    let alive = true;
    /* A different search clears the list; a refresh of the same one keeps it on screen. */
    setRows((prev) => (prev && prev.jobId === jobId ? prev : null));
    getSearchLeads(propertyId, jobId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); setRows({ jobId, rows: [] }); return; }
      setCapped(res.capped);
      setRows({ jobId, rows: res.rows as unknown as ResultLead[] });
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
  return { campaigns, jobId, leads, opportunities, items, counts, failed, capped, reload };
}
