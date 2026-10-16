// FIND BUYERS DASHBOARD — two compact summaries, each opening its own results page
// (owner, 2026-10-15; Find Buyers 3.0). No lead lists live here.
//
//   HOMATCH Match       free internal matching. "Start Free Matching" only queues the
//                       property for the native matcher (internal_leads_request_matching):
//                       no credits, no Actor. Contacts are paid through the existing unlock.
//   External Discovery  the paid research campaign. Its start button only OPENS the
//                       budget step; nothing is charged until the owner confirms there.
//
// "Expand search externally" appears when HOMATCH Match has nobody yet and opens the same
// budget step — it never starts or charges anything by itself.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Globe2, Loader2, MessageCircle, Search, ShieldCheck, Sparkles, Target, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { showExpandOffer } from '@/findBuyers/leadCampaigns';
import type { ResultCounts } from '@/findBuyers/externalResults';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_10px_28px_-22px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_84%)]';
const ICON = 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)]';
const PRIMARY = 'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(218_52%_11%)] px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 disabled:opacity-60';
const SECONDARY = 'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]';
const BADGE = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(42_100%_95%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_80%)]';
const STAT = 'min-w-0 rounded-xl bg-[hsl(40_33%_98%)] px-1.5 py-1.5 text-center ring-1 ring-inset ring-[hsl(40_30%_90%)]';

export type InternalStart = 'idle' | 'starting' | 'requested' | 'failed';

export function FindBuyersDashboard({
  tenant, internalCount, internalStart, onStartInternal, internalHref,
  counts, externalRunning, onStartExternal, externalHref,
}: {
  tenant: boolean;
  /** HOMATCH members matched to this property; null while loading. */
  internalCount: number | null;
  internalStart: InternalStart;
  onStartInternal: () => void;
  internalHref: string;
  /** The latest external search's results; null while loading. */
  counts: ResultCounts | null;
  externalRunning: boolean;
  /** Opens the paid budget selection (no charge until confirmed there). */
  onStartExternal: () => void;
  externalHref: string;
}) {
  const { t } = useLanguage();
  const ext = ([['direct', Target, counts?.direct], ['interest', MessageCircle, counts?.interest], ['opportunities', Sparkles, counts?.opportunities]] as const);

  return (
    <section aria-label={t('fbd_label')} data-testid="fb-dashboard" className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {/* ── HOMATCH Match: free ── */}
        <article className={CARD} data-testid="fbd-internal">
          <div className="flex items-center gap-2.5">
            <span className={ICON}><Users className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('fbd_internal_title')}</h2>
            <span className={BADGE}><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('fbd_free_badge')}</span>
          </div>
          <p className="flex items-baseline gap-2 text-[hsl(218_45%_14%)]">
            <span className="font-display text-3xl font-semibold tabular-nums" data-testid="fbd-internal-count">{internalCount ?? '—'}</span>
            <span className="min-w-0 truncate text-sm text-[hsl(218_28%_38%)]">{t(tenant ? 'fbd_internal_count_tenants' : 'fbd_internal_count_buyers')}</span>
          </p>
          {internalStart === 'requested' ? (
            <p role="status" data-testid="fbd-internal-requested" className="flex items-start gap-1.5 text-xs font-medium text-[hsl(150_45%_28%)]">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('fbd_internal_requested')}
            </p>
          ) : internalStart === 'failed' ? (
            <p role="alert" className="text-xs font-medium text-[hsl(0_65%_42%)]">{t('fbd_internal_failed')}</p>
          ) : <p className="text-2xs text-[hsl(218_28%_38%)]">{t('fbd_internal_pricing')}</p>}
          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={onStartInternal} disabled={internalStart === 'starting'} data-testid="fbd-internal-start">
              {internalStart === 'starting' ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              <span className="truncate">{t('fbd_internal_start')}</span>
            </button>
            <Link to={internalHref} className={SECONDARY} data-testid="fbd-internal-view">
              <span className="truncate">{t('fbd_internal_view')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </article>

        {/* ── External Discovery: paid ── */}
        <article className={CARD} data-testid="fbd-external">
          <div className="flex items-center gap-2.5">
            <span className={ICON}><Globe2 className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('fbd_external_title')}</h2>
            <span className={BADGE}>{t('fbd_paid_badge')}</span>
          </div>
          <dl className="grid grid-cols-3 gap-1.5" data-testid="fbd-external-counts">
            {ext.map(([k, Icon, n]) => (
              <div key={k} className={STAT}>
                <dd className="flex items-center justify-center gap-1 font-display text-lg font-semibold tabular-nums text-[hsl(218_45%_14%)]" data-testid={`fbd-ext-${k}`}>
                  <Icon className="h-3.5 w-3.5 text-[hsl(34_90%_40%)]" aria-hidden="true" />{n ?? '—'}
                </dd>
                <dt className="truncate text-2xs text-[hsl(218_28%_38%)]">{t(`fbx_tab_${k}`)}</dt>
              </div>
            ))}
          </dl>
          <p className="text-2xs text-[hsl(218_28%_38%)]">{externalRunning ? t('fbd_external_running') : t('fbd_external_pricing')}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={onStartExternal} disabled={externalRunning} data-testid="fbd-external-start">
              <Globe2 className="h-4 w-4" aria-hidden="true" /><span className="truncate">{t('fbd_external_start')}</span>
            </button>
            <Link to={externalHref} className={SECONDARY} data-testid="fbd-external-view">
              <span className="truncate">{t('fbd_external_view')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
        </article>
      </div>

      {showExpandOffer(internalCount, externalRunning) && (
        <div data-testid="fbd-expand" className="flex flex-col gap-2 rounded-2xl bg-[hsl(42_100%_97%)] px-4 py-3 ring-1 ring-inset ring-[hsl(40_80%_80%)] sm:flex-row sm:items-center sm:gap-3">
          <p className="min-w-0 flex-1 text-sm text-[hsl(218_45%_14%)]">{t(tenant ? 'fbd_expand_short_tenants' : 'fbd_expand_short_buyers')}</p>
          <button type="button" className={cn(SECONDARY, 'w-full flex-none sm:w-auto')} onClick={onStartExternal} data-testid="fbd-expand-open">
            <span className="min-w-0 break-words text-center">{t('fbd_expand_cta')}</span><ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

export default FindBuyersDashboard;
