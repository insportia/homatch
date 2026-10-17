// The property's Find Buyers searches as the owner's summary panels read them (owner, 2026-10-17):
// the searches themselves (find_buyers_campaigns ⨝ matching_jobs) with each search's own lead
// counts — never the legacy `matches` table. `refreshKey` re-reads (e.g. when a live search ends).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPropertyCampaignRows, type PropertyCampaignRows } from '@/services/findBuyersLeads';
import { buildCampaignList, featuredCampaign, uniquePeople, type CampaignSummary } from '@/findBuyers/leadCampaigns';

export interface FindBuyersSummary {
  /** null while loading. */
  campaigns: CampaignSummary[] | null;
  featured: CampaignSummary | null;
  allPeople: { total: number; qualified: number } | null;
  failed: boolean;
  reload: () => void;
}

export function useFindBuyersSummary(propertyId: string | undefined, refreshKey: string | number | null = null): FindBuyersSummary {
  const [rows, setRows] = useState<PropertyCampaignRows | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!propertyId) return undefined;
    let alive = true;
    getPropertyCampaignRows(propertyId).then((r) => {
      if (!alive) return;
      setFailed(r.failed);
      setRows(r.failed ? { campaigns: [], jobs: [], leads: [], failed: true } : r);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [propertyId, tick, refreshKey]);
  const campaigns = useMemo(() => (rows ? buildCampaignList(rows) : null), [rows]);
  return {
    campaigns,
    featured: featuredCampaign(campaigns),
    allPeople: rows ? uniquePeople(rows.leads) : null,
    failed,
    reload,
  };
}
