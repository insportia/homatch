// External Discovery results for one property, one search at a time (Find Buyers 3.0).
//
// Reads the property's searches (from its own current leads, RLS), then every current
// lead of the chosen search, classifies each into DIRECT / INTEREST / EXCLUDED with the
// pure gate and builds the post opportunities. A failed read is `failed`, never empty.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPropertyLeadCampaigns, getSearchLeads, type LeadCampaign } from '@/services/findBuyersLeads';
import { buildOpportunities, classifyLead, countResults, type ClassifiedLead, type OwnerFacts, type ResultLead } from '@/findBuyers/externalResults';

export interface ExternalResults {
  campaigns: LeadCampaign[] | null;
  /** The search shown: the chosen one, else the latest; null = all searches. */
  jobId: string | null;
  leads: ClassifiedLead[] | null;
  opportunities: ReturnType<typeof buildOpportunities>;
  counts: ReturnType<typeof countResults>;
  failed: boolean;
  capped: boolean;
  reload: () => void;
}

/**
 * @param chosen undefined = follow the latest search; null = every search; else one search id.
 */
export function useExternalResults(propertyId: string | undefined, chosen: string | null | undefined, owner: OwnerFacts | null): ExternalResults {
  const [campaigns, setCampaigns] = useState<LeadCampaign[] | null>(null);
  const [rows, setRows] = useState<ResultLead[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [capped, setCapped] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!propertyId) return undefined;
    let alive = true;
    setFailed(false);
    getPropertyLeadCampaigns(propertyId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); return; }
      setCampaigns(res.campaigns);
    });
    return () => { alive = false; };
  }, [propertyId, tick]);

  const jobId = chosen === undefined ? (campaigns?.[0]?.jobId ?? null) : chosen;

  useEffect(() => {
    if (!propertyId || campaigns === null) return undefined;
    let alive = true;
    setRows(null);
    getSearchLeads(propertyId, jobId).then((res) => {
      if (!alive) return;
      if (res.failed) { setFailed(true); setRows([]); return; }
      setCapped(res.capped);
      setRows(res.rows as unknown as ResultLead[]);
    });
    return () => { alive = false; };
  }, [propertyId, jobId, campaigns, tick]);

  const leads = useMemo(() => (rows ? rows.map(classifyLead) : null), [rows]);
  const opportunities = useMemo(() => (leads ? buildOpportunities(leads, owner) : []), [leads, owner]);
  const counts = useMemo(() => countResults(leads ?? [], opportunities), [leads, opportunities]);
  return { campaigns, jobId, leads, opportunities, counts, failed, capped, reload };
}
