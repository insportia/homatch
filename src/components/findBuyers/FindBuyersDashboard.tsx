// FIND BUYERS DASHBOARD — one property, two independent campaigns (owner, 2026-10-15).
//
//   HOMATCH Match       free internal matching against HOMATCH members' requests.
//                       Starting it only queues the property for the native matcher
//                       (internal_leads_request_matching): no credits, no Actor.
//                       Contacts are paid one by one through the existing unlock quote.
//   External Discovery  the paid research campaign. Its button only OPENS the budget
//                       selection; nothing is charged until the owner confirms there.
//
// "Expand search externally" appears when HOMATCH Match has nobody yet. It opens the
// same budget selection — it never starts or charges anything by itself.

import React from 'react';
import { ArrowRight, CheckCircle2, Globe2, Loader2, Search, ShieldCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LeadCampaign } from '@/findBuyers/leadCampaigns';
import { externalSummary, showExpandOffer } from '@/findBuyers/leadCampaigns';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_10px_28px_-20px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_70%_82%)] sm:p-5';
const ICON = 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] text-[hsl(218_52%_11%)]';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,hsl(40_94%_62%),hsl(34_90%_48%))] px-4 text-sm font-semibold text-[hsl(218_52%_11%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 disabled:opacity-60';
const SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]';
const BADGE = 'inline-flex items-center gap-1 rounded-full bg-[hsl(42_100%_95%)] px-2.5 py-0.5 text-2xs font-semibold text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_78%)]';

export type InternalStart = 'idle' | 'starting' | 'requested' | 'failed';

export function FindBuyersDashboard({
  tenant, internalCount, internalStart, onStartInternal, onViewInternal,
  campaigns, externalRunning, onStartExternal, onViewExternal,
}: {
  tenant: boolean;
  /** HOMATCH members matched to this property; null while loading. */
  internalCount: number | null;
  internalStart: InternalStart;
  onStartInternal: () => void;
  onViewInternal: () => void;
  campaigns: LeadCampaign[] | null;
  externalRunning: boolean;
  /** Opens the paid budget selection (no charge until confirmed there). */
  onStartExternal: () => void;
  onViewExternal: () => void;
}) {
  const { t } = useLanguage();
  const ext = externalSummary(campaigns);

  return (
    <section aria-label={t('fbd_label')} data-testid="fb-dashboard" className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {/* ── HOMATCH Match: free ── */}
        <article className={CARD} data-testid="fbd-internal">
          <div className="flex items-start gap-3">
            <span className={ICON}><Users className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('fbd_internal_title')}</h2>
                <span className={BADGE}><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('fbd_free_badge')}</span>
              </div>
              <p className="mt-0.5 break-words text-sm text-[hsl(218_28%_34%)]">{t(tenant ? 'fbd_internal_subtitle_tenants' : 'fbd_internal_subtitle_buyers')}</p>
            </div>
          </div>
          <p className="text-sm text-[hsl(218_45%_14%)]">
            <span className="font-display text-2xl font-semibold tabular-nums" data-testid="fbd-internal-count">{internalCount ?? '—'}</span>{' '}
            <span className="text-[hsl(218_28%_34%)]">{t('fbd_internal_count_label')}</span>
          </p>
          <p className="text-2xs text-[hsl(218_28%_38%)]">{t('fbd_internal_pricing')}</p>
          {internalStart === 'requested' && (
            <p role="status" data-testid="fbd-internal-requested" className="flex items-start gap-1.5 text-xs font-medium text-[hsl(150_45%_28%)]">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('fbd_internal_requested')}
            </p>
          )}
          {internalStart === 'failed' && <p role="alert" className="text-xs font-medium text-[hsl(0_65%_42%)]">{t('fbd_internal_failed')}</p>}
          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={onStartInternal} disabled={internalStart === 'starting'} data-testid="fbd-internal-start">
              {internalStart === 'starting' ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              {t('fbd_internal_start')}
            </button>
            <button type="button" className={SECONDARY} onClick={onViewInternal} data-testid="fbd-internal-view">
              {t('fbd_internal_view')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        </article>

        {/* ── External Discovery: paid ── */}
        <article className={CARD} data-testid="fbd-external">
          <div className="flex items-start gap-3">
            <span className={ICON}><Globe2 className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-[hsl(218_45%_14%)]">{t('fbd_external_title')}</h2>
                <span className={BADGE}>{t('fbd_paid_badge')}</span>
              </div>
              <p className="mt-0.5 break-words text-sm text-[hsl(218_28%_34%)]">{t(tenant ? 'fbd_external_subtitle_tenants' : 'fbd_external_subtitle_buyers')}</p>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center" data-testid="fbd-external-counts">
            {([['qualified', ext.qualified, t('fbd_ext_qualified')], ['potential', ext.potential, t('fbd_ext_potential')], ['weak', ext.weak, t('fbd_ext_weak')]] as const).map(([k, n, label]) => (
              <div key={k} className="rounded-xl bg-[hsl(40_33%_98%)] px-2 py-2 ring-1 ring-inset ring-[hsl(40_30%_88%)]">
                <dt className="truncate text-2xs text-[hsl(218_28%_38%)]">{label}</dt>
                <dd className="font-display text-lg font-semibold tabular-nums text-[hsl(218_45%_14%)]" data-testid={`fbd-ext-${k}`}>{n}</dd>
              </div>
            ))}
          </dl>
          <p className="text-2xs text-[hsl(218_28%_38%)]">
            {externalRunning ? t('fbd_external_running') : ext.searches > 0 ? t('fbd_external_searches', { n: String(ext.searches) }) : t('fbd_external_none')}
            {' · '}{t('fbd_external_pricing')}
          </p>
          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={onStartExternal} disabled={externalRunning} data-testid="fbd-external-start">
              <Globe2 className="h-4 w-4" aria-hidden="true" />{t('fbd_external_start')}
            </button>
            <button type="button" className={SECONDARY} onClick={onViewExternal} data-testid="fbd-external-view">
              {t('fbd_external_view')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>

      {showExpandOffer(internalCount, externalRunning) && (
        <div data-testid="fbd-expand" className="flex flex-col gap-3 rounded-2xl bg-[hsl(42_100%_97%)] p-4 ring-1 ring-inset ring-[hsl(40_80%_78%)] sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 break-words text-sm text-[hsl(218_45%_14%)]">{t(tenant ? 'fbd_expand_body_tenants' : 'fbd_expand_body_buyers')}</p>
          <button type="button" className={cn(SECONDARY, 'shrink-0')} onClick={onStartExternal} data-testid="fbd-expand-open">
            {t('fbd_expand_cta')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}

export default FindBuyersDashboard;
