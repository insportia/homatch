// Potential buyers / tenants from public conversations, for one property.
// Strongest first; one card per person (several signals fold into one lead).
// The empty state promises nothing: it says what happened and what a larger
// budget would do.

import React, { useCallback, useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyState } from '@/components/customer/surface';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { getLatestCampaignState, getPropertyLeads, type PotentialLead } from '@/services/findBuyers';

export function FindBuyersResults({
  propertyId,
  counterpart,
  refreshKey,
  searching,
  onCount,
}: {
  propertyId: string;
  counterpart: 'BUYER' | 'TENANT' | null;
  refreshKey: number;
  searching: boolean;
  onCount?: (n: number) => void;
}) {
  const { t } = useLanguage();
  const [leads, setLeads] = useState<PotentialLead[] | null>(null);
  const [finishedEmpty, setFinishedEmpty] = useState(false);

  const load = useCallback(async () => {
    const rows = await getPropertyLeads(propertyId);
    setLeads(rows);
    onCount?.(rows.length);
    if (!rows.length && !searching) {
      const last = await getLatestCampaignState(propertyId).catch(() => null);
      setFinishedEmpty(Boolean(last?.finalized_at));
    } else setFinishedEmpty(false);
  }, [propertyId, searching, onCount]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const tenant = counterpart === 'TENANT';
  if (leads === null) return null;
  if (!leads.length) {
    if (!finishedEmpty) return null;
    return (
      <EmptyState
        icon={Radar}
        className="hm-discovery-panel"
        title={t(tenant ? 'fbx_empty_title_tenants' : 'fbx_empty_title_buyers')}
        body={t('fbx_empty_body')}
      />
    );
  }
  return (
    <section aria-labelledby="fbx-results-title" className="space-y-2.5">
      <h2 id="fbx-results-title" className="font-display text-sm font-semibold text-foreground">
        {t(tenant ? 'fbx_results_title_tenants' : 'fbx_results_title_buyers')}
        <span className="ms-2 inline-block text-2xs font-medium tabular-nums text-muted-foreground">{leads.length}</span>
      </h2>
      <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
        {leads.map((lead) => <PotentialBuyerCard key={lead.id} lead={lead} propertyId={propertyId} />)}
      </div>
    </section>
  );
}

export default FindBuyersResults;
