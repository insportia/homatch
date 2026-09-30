// META ADS — one campaign's drill-down: status and controls, honest results
// from ONE KPI source, the week-over-week view, placements / audience /
// geography / timing / creatives, the leads funnel, recommendations (recommend
// only), Campaign Guard, billing and data freshness. Every number comes from
// campaignDetail(); a section without data says so instead of inventing one.
// Deep links: ?tab=performance|placements|audience|creatives|leads|optimization|integrity.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { EmptyState, FilterRail, PageHero } from '@/components/customer/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { campaignDetail, moneyIn, type CampaignDetail } from '@/services/metaAds';
import { CampaignStatusChip } from './MetaAdsPage';
import { makeFmt, Chip } from '@/components/metaAds/campaign/shared';
import { ControlsBar } from '@/components/metaAds/campaign/ControlsBar';
import { EditBudgetDialog } from '@/components/metaAds/campaign/EditBudgetDialog';
import { EditDurationDialog } from '@/components/metaAds/campaign/EditDurationDialog';
import { ProvenanceNote } from '@/components/metaAds/campaign/ProvenanceNote';
import { OverviewSection } from '@/components/metaAds/campaign/OverviewSection';
import { PerformanceSection } from '@/components/metaAds/campaign/PerformanceSection';
import { PlacementsSection } from '@/components/metaAds/campaign/PlacementsSection';
import { AudienceSection } from '@/components/metaAds/campaign/AudienceSection';
import { GeoSection } from '@/components/metaAds/campaign/GeoSection';
import { TimeSection } from '@/components/metaAds/campaign/TimeSection';
import { CreativesSection } from '@/components/metaAds/campaign/CreativesSection';
import { LeadsFunnelSection } from '@/components/metaAds/campaign/LeadsFunnelSection';
import { OptimizationSection } from '@/components/metaAds/campaign/OptimizationSection';
import { IntegritySection, SuspendedBanner } from '@/components/metaAds/campaign/IntegritySection';
import { BillingSection } from '@/components/metaAds/campaign/BillingSection';

export const CAMPAIGN_TABS = [
  'overview', 'performance', 'placements', 'audience', 'geo', 'time', 'creatives', 'leads', 'optimization', 'integrity', 'billing',
] as const;
type Tab = typeof CAMPAIGN_TABS[number];

export default function MetaAdsCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = (CAMPAIGN_TABS as readonly string[]).includes(String(raw)) ? (raw as Tab) : 'overview';
  const setTab = (next: Tab) => setParams((prev) => { prev.set('tab', next); return prev; }, { replace: true });

  const [d, setD] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<'budget' | 'duration' | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    if (!quiet) setLoading(true);
    setFailed(false);
    try {
      setD(await campaignDetail(id));
    } catch {
      if (!quiet) setFailed(true);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(() => { void load(true); }, [load]);

  const fmt = useMemo(() => makeFmt(lang, d?.campaign.currency || 'USD'), [lang, d?.campaign.currency]);

  if (loading) {
    return (
      <RouteGuard><AppLayout noPadding>
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6 sm:px-6">
          <Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" />
        </div>
      </AppLayout></RouteGuard>
    );
  }

  if (failed || !d || !id) {
    return (
      <RouteGuard><AppLayout noPadding>
        <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6 sm:px-6">
          <EmptyState icon={Megaphone} title={t('mm_c_load_failed')}
            actions={<button type="button" onClick={() => void load()}
              className="inline-flex min-h-10 items-center rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">{t('mm_c_retry')}</button>} />
        </div>
      </AppLayout></RouteGuard>
    );
  }

  const c = d.campaign;
  const suspended = d.guard?.account?.status === 'SUSPENDED';
  const tabs = CAMPAIGN_TABS.map((value) => ({ value, label: t(`mm_c_tab_${value}`) }));
  const subtitle = c.daily_budget_cents
    ? t('mm_c_budget_line', { amount: moneyIn(c.daily_budget_cents, c.currency || 'USD', lang), days: c.duration_days ?? '—' })
    : undefined;

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
          <Link to="/outreach/meta?tab=campaigns"
            className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('mm_c_back')}
          </Link>

          <PageHero compact eyebrow={t('mm_c_eyebrow')}
            title={c.name || t(`mads_goal_${c.goal.toLowerCase()}`)}
            subtitle={subtitle} />

          {String(c.external_campaign_id ?? '').startsWith('mock_') && (
            <div className="rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-2.5 text-[13px] text-[hsl(var(--gold-ink))]">{t('madsb_campaign_mock')}</div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <CampaignStatusChip status={c.status} />
            <Chip>{t('mm_c_goal')}: {t(`mads_goal_${c.goal.toLowerCase()}`)}</Chip>
            <Chip>{t('mm_c_currency')}: <span dir="ltr">{c.currency || 'USD'}</span></Chip>
            {c.special_ad_categories?.length > 0 && <Chip>{t('mads_housing_note')}</Chip>}
          </div>
          <LifecycleStrip status={c.status} />
          <ProvenanceNote t={t} fmt={fmt} provenance={d.provenance} />

          {suspended && tab !== 'integrity' && <SuspendedBanner t={t} />}

          <ControlsBar t={t} fmt={fmt} d={d} onChanged={refresh}
            onEditBudget={() => setEdit('budget')} onEditDuration={() => setEdit('duration')} />

          <FilterRail<Tab> options={tabs} value={tab} onChange={setTab} ariaLabel={t('mm_c_tabs_label')} />

          <div className="min-w-0" data-mm-tab={tab}>
            {tab === 'overview' && <OverviewSection t={t} fmt={fmt} d={d} />}
            {tab === 'performance' && <PerformanceSection t={t} fmt={fmt} d={d} />}
            {tab === 'placements' && <PlacementsSection t={t} fmt={fmt} d={d} />}
            {tab === 'audience' && <AudienceSection t={t} fmt={fmt} d={d} />}
            {tab === 'geo' && <GeoSection t={t} fmt={fmt} d={d} />}
            {tab === 'time' && <TimeSection t={t} fmt={fmt} d={d} />}
            {tab === 'creatives' && <CreativesSection t={t} fmt={fmt} d={d} />}
            {tab === 'leads' && <LeadsFunnelSection t={t} fmt={fmt} d={d} campaignId={id} />}
            {tab === 'optimization' && <OptimizationSection t={t} fmt={fmt} d={d} onChanged={refresh} />}
            {tab === 'integrity' && <IntegritySection t={t} fmt={fmt} d={d} />}
            {tab === 'billing' && <BillingSection t={t} fmt={fmt} d={d} />}
          </div>

          <EditBudgetDialog t={t} fmt={fmt} open={edit === 'budget'} onOpenChange={(o) => setEdit(o ? 'budget' : null)} onDone={refresh} campaign={c} />
          <EditDurationDialog t={t} fmt={fmt} open={edit === 'duration'} onOpenChange={(o) => setEdit(o ? 'duration' : null)} onDone={refresh} campaign={c} />
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

/**
 * Where the campaign is, in the order it actually travels. HOMATCH's own
 * check and Meta's review are separate steps, and ACTIVE only lights up when
 * Meta reports delivery — never because our own write succeeded.
 */
const LIFECYCLE = ['READY', 'SUBMITTED', 'META_REVIEW', 'ACTIVE', 'COMPLETED'] as const;
function LifecycleStrip({ status }: { status: string }) {
  const { t } = useLanguage();
  const off = ['REJECTED', 'FAILED', 'PAUSED', 'ARCHIVED'].includes(status);
  const at = LIFECYCLE.indexOf(status as never);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-2xs" aria-label={t('madsb_lifecycle_label')}>
      {LIFECYCLE.map((s, i) => (
        <li key={s} aria-current={i === at && !off ? 'step' : undefined}
          className={`rounded-full border px-2.5 py-1 ${i <= at && !off ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground'}`}>
          {t(`madsb_lifecycle_${s.toLowerCase()}`)}
        </li>
      ))}
      {off && <li className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">{t(`mads_status_${status.toLowerCase()}`)}</li>}
    </ol>
  );
}
