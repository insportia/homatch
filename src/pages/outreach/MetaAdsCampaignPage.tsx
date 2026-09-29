// META ADS — one campaign's workspace: status, honest results, its leads,
// pause/resume, sync. No internal topology here — that is Admin's view.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { PageHero, EmptyState } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Pause, Play, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getMetaCampaign, listMetaLeads, pauseCampaign, resumeCampaign, syncCampaign, money,
  type MetaCampaignRow, type MetaLeadRow,
} from '@/services/metaAds';
import { CampaignStatusChip } from './MetaAdsPage';

export default function MetaAdsCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [c, setC] = useState<MetaCampaignRow | null>(null);
  const [leads, setLeads] = useState<MetaLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [camp, ls] = await Promise.all([getMetaCampaign(id), listMetaLeads({ campaignId: id })]);
      setC(camp); setLeads(ls);
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (kind: 'pause' | 'resume' | 'sync') => {
    if (!id) return;
    setBusy(kind);
    try {
      if (kind === 'pause') await pauseCampaign(id);
      else if (kind === 'resume') await resumeCampaign(id);
      else await syncCampaign(id);
      await load();
    } catch (e: any) {
      toast.error(t(String(e.message).startsWith('meta_err') ? e.message : 'mads_load_failed'));
    } finally { setBusy(null); }
  };

  if (loading || !c) {
    return (
      <RouteGuard><AppLayout noPadding>
        <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6 sm:px-6">
          <Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" />
        </div>
      </AppLayout></RouteGuard>
    );
  }

  const r = (c.results ?? {}) as Record<string, string>;
  const results: Array<[string, string]> = [];
  if (c.spend_cents > 0) results.push([t('mads_r_spent'), money(c.spend_cents)]);
  if (r.reach) results.push([t('mads_r_reach'), String(r.reach)]);
  if (r.impressions) results.push([t('mads_r_impressions'), String(r.impressions)]);
  if (r.clicks) results.push([t('mads_r_clicks'), String(r.clicks)]);
  if (leads.length > 0) results.push([t('mads_r_leads'), String(leads.length)]);

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
          <PageHero compact eyebrow="Meta Ads"
            title={c.name || t(`mads_goal_${c.goal.toLowerCase()}` as never)}
            subtitle={c.daily_budget_cents ? `${money(c.daily_budget_cents)}/day · ${c.duration_days}d` : undefined}
            actions={
              <>
                {['ACTIVE', 'META_REVIEW', 'SUBMITTED'].includes(c.status) && (
                  <button type="button" onClick={() => act('pause')} disabled={busy !== null}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/40 bg-white px-3.5 text-2xs font-semibold text-[#0C1119] hover:bg-white/90">
                    {busy === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}{t('mads_pause')}
                  </button>
                )}
                {c.status === 'PAUSED' && (
                  <button type="button" onClick={() => act('resume')} disabled={busy !== null}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
                    {busy === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('mads_resume')}
                  </button>
                )}
                {c.external_campaign_id && (
                  <button type="button" onClick={() => act('sync')} disabled={busy !== null}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/25 px-3.5 text-2xs font-medium text-white/85 hover:bg-white/10">
                    <RefreshCw className={busy === 'sync' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{t('mads_sync')}
                  </button>
                )}
              </>
            } />

          {String(c.external_campaign_id ?? '').startsWith('mock_') && (
            <div className="rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-2.5 text-[13px] text-[hsl(var(--gold-ink))]">{t('madsb_campaign_mock')}</div>
          )}

          <LifecycleStrip status={c.status} />

          <div className="flex flex-wrap items-center gap-2">
            <CampaignStatusChip status={c.status} />
            {c.special_ad_categories.length > 0 && (
              <span className="rounded-full border border-border bg-[hsl(var(--secondary))] px-2 py-0.5 text-[13px] text-muted-foreground">
                {t('mads_housing_note')}
              </span>
            )}
            {c.last_error?.key && <span className="text-[13px] text-destructive">{t(c.last_error.key as never)}</span>}
            {c.last_synced_at && (
              <span className="text-2xs text-muted-foreground">{t('madsb_last_synced', { when: new Date(c.last_synced_at).toLocaleString() })}</span>
            )}
          </div>
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{t(`madsb_status_explain_${c.status.toLowerCase()}` as never)}</p>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <h2 className="mb-3 font-display text-base font-semibold text-foreground">{t('mads_results_title')}</h2>
            {results.length === 0 ? (
              <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{t('mads_results_none')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {results.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
                    <p className="text-2xs text-muted-foreground">{label}</p>
                    <p className="font-display text-lg font-bold tabular-nums" dir="ltr">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <h2 className="mb-3 font-display text-base font-semibold text-foreground">{t('mads_tab_leads')}</h2>
            {leads.length === 0 ? (
              <EmptyState icon={Users} title={t('mads_leads_empty_title')} body={t('mads_leads_empty_body')} className="border-0 shadow-none" />
            ) : (
              <div className="space-y-2">
                {leads.slice(0, 20).map(l => {
                  const f = l.fields ?? {};
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{(f.full_name ?? f.name ?? t('mads_lead_unnamed')) as string}</p>
                        <p className="truncate text-2xs text-muted-foreground" dir="ltr">{[f.email, f.phone_number ?? f.phone].filter(Boolean).join(' · ')}</p>
                      </div>
                      <span className="shrink-0 text-2xs text-muted-foreground">{new Date(l.received_at).toLocaleDateString()}</span>
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => navigate('/outreach/meta?tab=leads')}>{t('mads_all_leads')}</Button>
              </div>
            )}
          </section>
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
        <li key={s} className={`rounded-full border px-2.5 py-1 ${i <= at && !off ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground'}`}>
          {t(`madsb_lifecycle_${s.toLowerCase()}` as never)}
        </li>
      ))}
      {off && <li className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">{t(`mads_status_${status.toLowerCase()}` as never)}</li>}
    </ol>
  );
}
