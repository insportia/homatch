// Potential buyers / tenants from public conversations, for one property.
// Strongest first; one card per person (several signals fold into one lead).
// The empty state promises nothing: it says what happened and what a larger
// budget would do.

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2, Radar, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND } from '@/components/findBuyers/brand';
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
      <section className={cn('relative overflow-hidden rounded-2xl px-6 py-10 text-center text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.35)]', NAVY_BAND)}>
        <span className={cn('mx-auto flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_10px_26px_-10px_hsl(38_92%_50%/0.8)]', GOLD_FILL)}>
          <Radar className="h-7 w-7 text-[hsl(218_52%_11%)]" aria-hidden="true" />
        </span>
        <p className="mt-4 font-display text-lg font-semibold">{t(tenant ? 'fbx_empty_title_tenants' : 'fbx_empty_title_buyers')}</p>
        <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-[hsl(218_40%_85%)]">{t('fbx_empty_body')}</p>
        <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-2xs text-[hsl(218_40%_85%)] ring-1 ring-inset ring-white/10">
          <CalendarCheck2 className={cn('h-3.5 w-3.5', GOLD_TEXT)} aria-hidden="true" />{t('fbx_fresh_rule')}
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="fbx-results-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_6px_16px_-8px_hsl(38_92%_45%/0.8)]', GOLD_FILL)}>
          <Users className="h-[18px] w-[18px] text-[hsl(218_52%_11%)]" aria-hidden="true" />
        </span>
        <h2 id="fbx-results-title" className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">
          {t(tenant ? 'fbx_results_title_tenants' : 'fbx_results_title_buyers')}
        </h2>
        <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-2xs font-bold tabular-nums', NAVY_BAND, GOLD_TEXT)}>{leads.length}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(42_100%_94%)] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_32%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]">
          <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />{t('fbx_fresh_badge')}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {leads.map((lead) => <PotentialBuyerCard key={lead.id} lead={lead} propertyId={propertyId} />)}
      </div>
    </section>
  );
}

export default FindBuyersResults;
