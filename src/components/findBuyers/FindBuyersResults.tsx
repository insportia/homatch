// Potential buyers / tenants from public conversations, for one property.
// Strongest first; one card per person (several signals fold into one lead).
// Server pages in a stable order. While a search runs, new leads never
// reshuffle the page being read: a banner offers them instead (unless the
// list is still empty, then they simply appear).
//
// Each search keeps its own results (owner, 2026-10-15): the list opens on the
// latest search and the owner can switch to an earlier one or to all of them, so
// a new search's leads are never buried behind an older search's. A failed read
// says so and offers a retry; it is never shown as "no results".

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarCheck2, History, RefreshCw, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND } from '@/components/findBuyers/brand';
import { PotentialBuyerCard } from '@/components/findBuyers/PotentialBuyerCard';
import { PageNav } from '@/components/findBuyers/PageNav';
import type { PotentialLead } from '@/services/findBuyers';
import { getPropertyLeadCampaigns, getSearchLeadsPage, type LeadCampaign } from '@/services/findBuyersLeads';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { arrivalAction } from '@/findBuyers/campaignView';
import { groupLeads } from '@/findBuyers/campaignReport';

export const LEADS_PAGE_SIZE = 9;

export function FindBuyersResults({
  propertyId, counterpart, liveSignal, page, onPage, onCount, onCampaigns,
}: {
  propertyId: string;
  counterpart: 'BUYER' | 'TENANT' | null;
  /** Grows when the server reports new leads (status.campaign.newLeads); null until the first read. */
  liveSignal: number | null;
  page: number;
  onPage: (p: number) => void;
  onCount?: (n: number) => void;
  /** The property's searches, newest first, once read (for the dashboard). */
  onCampaigns?: (campaigns: LeadCampaign[]) => void;
}) {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<PotentialLead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [campaigns, setCampaigns] = useState<LeadCampaign[] | null>(null);
  /* undefined = follow the latest search; null = every search; else one search. */
  const [chosenJob, setChosenJob] = useState<string | null | undefined>(undefined);
  const jobId = chosenJob === undefined ? (campaigns?.[0]?.jobId ?? null) : chosenJob;
  /* The first server read is the baseline, not an arrival. */
  const seenSignal = useRef<number | null>(liveSignal);
  const topRef = useRef<HTMLElement | null>(null);

  const loadCampaigns = useCallback(async () => {
    const res = await getPropertyLeadCampaigns(propertyId);
    if (res.failed) { setFailed(true); return; }
    setCampaigns(res.campaigns);
    onCampaigns?.(res.campaigns);
    onCount?.(res.campaigns.reduce((n, c) => n + c.total, 0));
  }, [propertyId, onCampaigns, onCount]);

  const load = useCallback(async (p: number) => {
    const res = await getSearchLeadsPage(propertyId, p, LEADS_PAGE_SIZE, jobId);
    setFailed(res.failed);
    setRows(res.rows);
    setTotal(res.total);
    setPending(false);
  }, [propertyId, jobId]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => { if (campaigns !== null) void load(page); }, [load, page, campaigns]);

  /* New leads reported by the live search. */
  useEffect(() => {
    if (liveSignal === null || liveSignal === seenSignal.current) return;
    if (seenSignal.current === null) { seenSignal.current = liveSignal; return; }
    const action = arrivalAction(rows?.length ?? 0, seenSignal.current, liveSignal);
    seenSignal.current = liveSignal;
    if (action === 'auto') { void loadCampaigns(); void load(page); }
    else if (action === 'offer') setPending(true);
  }, [liveSignal, rows, load, loadCampaigns, page]);

  const tenant = counterpart === 'TENANT';
  if (failed) {
    return (
      <section role="alert" data-testid="fbx-results-error"
        className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-[hsl(0_70%_85%)] sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-[hsl(218_45%_14%)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(0_65%_45%)]" aria-hidden="true" />{t('fbx_results_failed')}
        </p>
        <button type="button" onClick={() => { setFailed(false); void loadCampaigns(); void load(page); }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ring-[hsl(40_70%_70%)]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('fbx_results_retry')}
        </button>
      </section>
    );
  }
  const anyLeads = (campaigns ?? []).some((c) => c.total > 0);
  if (rows === null || campaigns === null || !anyLeads) return null;
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric' });
  const choose = (next: string | null | undefined) => { setChosenJob(next); onPage(1); };

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
      {campaigns.length > 1 && (
        <div role="tablist" aria-label={t('fbx_campaigns_label')} data-testid="fbx-campaigns" className="flex flex-wrap gap-2">
          {campaigns.map((c, i) => (
            <button key={c.jobId} type="button" role="tab" aria-selected={jobId === c.jobId} data-testid="fbx-campaign" data-job={c.jobId}
              onClick={() => choose(i === 0 ? undefined : c.jobId)}
              className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset',
                jobId === c.jobId ? cn(NAVY_BAND, 'text-white ring-transparent') : 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_30%_84%)]')}>
              {i === 0 ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <History className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{t(i === 0 ? 'fbx_campaign_latest' : 'fbx_campaign_earlier', { date: fmtDate(c.firstAt) })}</span>
              <span className="tabular-nums opacity-80">{c.total}</span>
            </button>
          ))}
          <button type="button" role="tab" aria-selected={jobId === null} data-testid="fbx-campaign-all" onClick={() => choose(null)}
            className={cn('inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset',
              jobId === null ? cn(NAVY_BAND, 'text-white ring-transparent') : 'bg-white text-[hsl(218_45%_14%)] ring-[hsl(40_30%_84%)]')}>
            {t('fbx_campaign_all')}
          </button>
        </div>
      )}
      {rows.length === 0 && (
        <p data-testid="fbx-campaign-empty" className="rounded-2xl bg-white p-4 text-sm text-[hsl(218_28%_38%)] ring-1 ring-inset ring-[hsl(40_30%_88%)]">{t('fbx_campaign_empty')}</p>
      )}
      {pending && (
        <button type="button" onClick={() => { onPage(1); void loadCampaigns(); void load(1); topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}
          className={cn('flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.5)]', NAVY_BAND)}
          role="status">
          <Sparkles className={cn('h-4 w-4', GOLD_TEXT)} aria-hidden="true" />
          <span>{t('fbl_new_results_banner')}</span>
          <RefreshCw className="h-4 w-4 opacity-80" aria-hidden="true" />
        </button>
      )}
      {/* Grouped by match category (Strong → Potential → Weak; leads found before
          match review follow as "not yet reviewed"). Rejected leads never reach
          this list: find_buyers_current_leads excludes them. */}
      {groupLeads(rows).map((g) => (
        <div key={g.category} className="space-y-2" data-testid="fbx-lead-group" data-category={g.category}>
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)]">
            <span className={cn('h-2.5 w-2.5 rounded-full', g.category === 'STRONG' ? 'bg-[hsl(40_94%_50%)]'
              : g.category === 'POTENTIAL' ? 'bg-[hsl(40_80%_65%)]' : g.category === 'WEAK' ? 'bg-[hsl(218_30%_70%)]' : 'border border-dashed border-[hsl(218_30%_55%)]')} aria-hidden="true" />
            <span>{t(`fbr_cat_${g.category}`)}</span>
            <span className="rounded-full bg-[hsl(218_70%_96%)] px-2 py-px text-2xs font-bold tabular-nums text-[hsl(220_60%_30%)]">{g.rows.length}</span>
          </h3>
          {g.category === 'UNCATEGORISED' && <p className="text-2xs text-[hsl(218_28%_38%)]">{t('fbr_cat_explain_UNCATEGORISED')}</p>}
          {g.category === 'WEAK' && <p className="text-2xs text-[hsl(218_28%_38%)]" data-testid="fbx-weak-explain">{t('fbr_cat_explain_WEAK')}</p>}
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {g.rows.map((lead) => <PotentialBuyerCard key={lead.id} lead={lead} propertyId={propertyId} />)}
          </div>
        </div>
      ))}
      <PageNav page={Math.min(page, totalPages)} totalPages={totalPages} onPage={onPage} label={t('fbl_leads_pages')} />
    </section>
  );
}

export default FindBuyersResults;
