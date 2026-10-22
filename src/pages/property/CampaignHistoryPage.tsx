// EXTERNAL MATCHING CAMPAIGN HISTORY — /property/:id/campaigns and /campaigns
//
// Every external search run the owner started, newest first, read from the
// server (find_buyers_my_campaigns). Each card opens that run's own workspace.
// The count on a card is that campaign's own results; nothing about HOMATCH's
// internal inventory is shown.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarDays, Coins, History, Languages, Loader2, PlayCircle, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RouteGuard } from '@/components/common/RouteGuard';
import { AppLayout } from '@/components/layouts/AppLayout';
import { CustomerSurface, DISCOVERY_SURFACE, EmptyState, PageHero } from '@/components/customer/surface';
import { GOLD_FILL, GOLD_TEXT, NAVY_BAND, PRIMARY_ACTION } from '@/components/findBuyers/brand';
import { ServiceBadge } from '@/components/matching/ServiceIdentity';
import { useLanguage } from '@/contexts/LanguageContext';
import { campaignOutcome } from '@/findBuyers/campaignView';
import { type CampaignHistoryRow, listMyCampaigns } from '@/services/findBuyers';

const TONE: Record<string, string> = {
  running: 'bg-[hsl(40_94%_64%)] text-[hsl(218_52%_11%)]',
  paused: 'bg-white/10 text-white ring-1 ring-inset ring-[hsl(40_80%_60%/0.6)]',
  results: 'bg-[hsl(158_64%_36%)] text-white',
  partial: 'bg-[hsl(158_50%_30%)] text-white',
  empty: 'bg-white/10 text-white ring-1 ring-inset ring-white/25',
  failed: 'bg-[hsl(350_60%_45%)] text-white',
  cancelled: 'bg-white/10 text-white ring-1 ring-inset ring-white/25',
};

function HistoryCard({ row, showProperty }: { row: CampaignHistoryRow; showProperty: boolean }) {
  const { t, lang } = useLanguage();
  const outcome = row.state ? campaignOutcome(row.state, row.results) : 'failed';
  return (
    <li>
      <Link to={`/property/${row.propertyId}/campaigns/${row.jobId}`}
        className="group block min-w-0 overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-[hsl(40_70%_82%)] shadow-[0_10px_28px_-20px_hsl(218_60%_15%/0.5)] transition-all hover:-translate-y-0.5 hover:ring-[hsl(38_92%_56%)] hover:shadow-[0_22px_44px_-24px_hsl(218_60%_15%/0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
        <div className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-3', NAVY_BAND)}>
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', GOLD_FILL)}>
              <Radar className={cn('h-4 w-4 text-[hsl(218_52%_11%)]', row.active && 'motion-safe:animate-spin')} style={row.active ? { animationDuration: '3s' } : undefined} aria-hidden="true" />
            </span>
            <span className={cn('min-w-0 truncate text-2xs font-bold uppercase tracking-[0.12em]', GOLD_TEXT)}>{t('svc_external_name')}</span>
          </span>
          <span className={cn('rounded-full px-2.5 py-0.5 text-2xs font-semibold', TONE[outcome])}>{t(`cw_outcome_${outcome}`)}</span>
        </div>
        <div className="space-y-2.5 p-4">
          {showProperty && (
            <p className="min-w-0 truncate font-display text-base font-semibold text-[hsl(218_45%_14%)]">{row.propertyTitle || t('matches_rail_untitled')}</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-3xl font-bold tabular-nums text-[hsl(218_45%_14%)]">{row.results}</span>
            <span className="text-sm text-[hsl(218_28%_38%)]">{t('cw_results_found')}</span>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-2xs text-[hsl(218_28%_38%)]">
            <div className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              <dt className="sr-only">{t('cw_started')}</dt>
              <dd>{new Date(row.createdAt).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            </div>
            {row.creditsCommitted != null && (
              <div className="flex items-center gap-1"><Coins className="h-3.5 w-3.5" aria-hidden="true" />
                <dt className="sr-only">{t('cw_budget')}</dt>
                <dd dir="ltr" className="tabular-nums">{t('cw_budget_credits', { n: String(row.creditsCommitted) })}</dd>
              </div>
            )}
            {row.languages && row.languages.length > 0 && (
              <div className="flex min-w-0 items-center gap-1"><Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <dt className="sr-only">{t('cw_languages')}</dt>
                <dd className="min-w-0 truncate uppercase">{row.languages.join(' · ')}</dd>
              </div>
            )}
          </dl>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-[hsl(34_90%_36%)]">
            {t(row.active ? 'cw_open_live' : 'cw_open_campaign')}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </li>
  );
}

function HistoryContent() {
  const { t } = useLanguage();
  const { id: propertyId } = useParams<{ id?: string }>();
  const [rows, setRows] = useState<CampaignHistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    listMyCampaigns(propertyId ?? null, 50)
      .then((r) => { if (alive) { setRows(r); setFailed(false); } })
      .catch(() => { if (alive) { setRows([]); setFailed(true); } });
    return () => { alive = false; };
  }, [propertyId]);

  const title = rows?.find((r) => r.propertyTitle)?.propertyTitle ?? null;

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="space-y-5 pb-16">
        <div className="space-y-2 pt-4 sm:pt-5">
          <ServiceBadge service="external" />
          <PageHero compact eyebrow={propertyId ? title : null} title={t('cw_history_title')} subtitle={t('cw_history_subtitle')}
            actions={propertyId ? (
              <Link to={`/property/${propertyId}/matches?launch=1`} className={cn(PRIMARY_ACTION, 'text-sm')}>
                <PlayCircle className="h-4 w-4" aria-hidden="true" />{t('cw_start_new')}
              </Link>
            ) : null} />
        </div>
        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-[hsl(218_28%_38%)]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('cw_loading')}</div>
        ) : failed ? (
          <EmptyState icon={History} title={t('cw_history_error')} body={t('cw_history_error_body')} />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title={t('cw_history_empty')} body={t('cw_history_empty_body')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => <HistoryCard key={r.jobId} row={r} showProperty={!propertyId} />)}
          </ul>
        )}
      </CustomerSurface>
    </AppLayout>
  );
}

export default function CampaignHistoryPage() {
  return (
    <RouteGuard>
      <HistoryContent />
    </RouteGuard>
  );
}
