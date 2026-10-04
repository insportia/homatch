// Potential buyers / tenants from public conversations, for one property.
// Strongest first; one card per person (several signals fold into one lead).
// Server pages in a stable order. While a search runs, new leads never
// reshuffle the page being read: a banner offers them instead (unless the
// list is still empty, then they simply appear).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck2, RefreshCw, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND } from '@/components/findBuyers/brand';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { PageNav } from '@/components/findBuyers/PageNav';
import { getPropertyLeadsPage, type PotentialLead } from '@/services/findBuyers';
import { arrivalAction } from '@/findBuyers/campaignView';

export const LEADS_PAGE_SIZE = 9;

export function FindBuyersResults({
  propertyId, counterpart, liveSignal, page, onPage, onCount,
}: {
  propertyId: string;
  counterpart: 'BUYER' | 'TENANT' | null;
  /** Grows when the server reports new leads (status.campaign.newLeads); null until the first read. */
  liveSignal: number | null;
  page: number;
  onPage: (p: number) => void;
  onCount?: (n: number) => void;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<PotentialLead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  /* The first server read is the baseline, not an arrival. */
  const seenSignal = useRef<number | null>(liveSignal);
  const topRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (p: number) => {
    const res = await getPropertyLeadsPage(propertyId, p, LEADS_PAGE_SIZE);
    setRows(res.rows);
    setTotal(res.total);
    onCount?.(res.total);
    setPending(false);
  }, [propertyId, onCount]);

  useEffect(() => { void load(page); }, [load, page]);

  /* New leads reported by the live search. */
  useEffect(() => {
    if (liveSignal === null || liveSignal === seenSignal.current) return;
    if (seenSignal.current === null) { seenSignal.current = liveSignal; return; }
    const action = arrivalAction(rows?.length ?? 0, seenSignal.current, liveSignal);
    seenSignal.current = liveSignal;
    if (action === 'auto') void load(page);
    else if (action === 'offer') setPending(true);
  }, [liveSignal, rows, load, page]);

  const tenant = counterpart === 'TENANT';
  if (rows === null || (rows.length === 0 && total === 0)) return null;
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));

  return (
    <section ref={topRef} aria-labelledby="fbx-results-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_6px_16px_-8px_hsl(38_92%_45%/0.8)]', GOLD_FILL)}>
          <Users className="h-[18px] w-[18px] text-[hsl(218_52%_11%)]" aria-hidden="true" />
        </span>
        <h2 id="fbx-results-title" className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">
          {t(tenant ? 'fbx_results_title_tenants' : 'fbx_results_title_buyers')}
        </h2>
        <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-2xs font-bold tabular-nums', NAVY_BAND, GOLD_TEXT)}>{total}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(42_100%_94%)] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_32%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]">
          <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />{t('fbx_fresh_badge')}
        </span>
      </div>
      {pending && (
        <button type="button" onClick={() => { onPage(1); void load(1); topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}
          className={cn('flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.5)]', NAVY_BAND)}
          role="status">
          <Sparkles className={cn('h-4 w-4', GOLD_TEXT)} aria-hidden="true" />
          <span>{t('fbl_new_results_banner')}</span>
          <RefreshCw className="h-4 w-4 opacity-80" aria-hidden="true" />
        </button>
      )}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((lead) => <PotentialBuyerCard key={lead.id} lead={lead} propertyId={propertyId} />)}
      </div>
      <PageNav page={Math.min(page, totalPages)} totalPages={totalPages} onPage={onPage} label={t('fbl_leads_pages')} />
    </section>
  );
}

export default FindBuyersResults;
