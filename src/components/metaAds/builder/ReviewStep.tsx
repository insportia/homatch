// PLACEMENTS and REVIEW.
//
// "What HOMATCH handles" lists only work this codebase actually performs for
// the chosen goal (payload.ts, engine.ts, meta-webhooks, the maintenance
// cron). A line is added here only when the code behind it exists.
import React from 'react';
import { CheckCircle2, Loader2, ShieldCheck, Wand2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { checkMedia, GOAL_SPECS, PLACEMENTS, type Placement } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import type { MetaCampaignRow, MetaCreativeRow, MetaStatus, PreflightResult, StrategyPreview } from '@/services/metaAds';
import { ChoiceCard, StepShell, VerdictBadge } from './ui';
import { selectedAsset, preflightDetails, handledTasks } from './steps';
import { FinancialSummary, type Totals } from './BudgetStep';
import { StrategyCard } from './StrategyCard';
import { FundingCard } from './FundingCard';
import { regionName } from './LocationPicker';
import { isHousingCampaign } from './masterLogic';

export function PlacementsStep({ campaign, status, creatives, recommended, patch }: {
  campaign: MetaCampaignRow; status: MetaStatus | null; creatives: MetaCreativeRow[]; recommended: Placement[];
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
}) {
  const { t } = useLanguage();
  const mode = campaign.placements?.mode === 'CUSTOM' ? 'CUSTOM' : 'RECOMMENDED';
  const list = (campaign.placements?.list ?? []) as Placement[];
  const hasIg = !!selectedAsset(status, 'INSTAGRAM');
  const hasVideo = creatives.some((c) => c.media[0]?.mime?.startsWith('video'));
  const disabledReason = (p: Placement): string | null => {
    if (p.startsWith('instagram') && !hasIg) return 'madsb_pl_needs_instagram';
    if (p === 'instagram_reels' && !hasVideo) return 'madsb_pl_needs_video';
    return null;
  };
  const verdictFor = (p: Placement) => {
    const vs = creatives.filter((c) => c.media[0]).map((c) => {
      const m = c.media[0];
      return checkMedia({ mime: m.mime, sizeBytes: Number(m.size ?? 0), width: m.width, height: m.height, durationSeconds: m.duration }, [p]).placements[p];
    });
    return vs.includes('INCOMPATIBLE') ? 'INCOMPATIBLE' : vs.includes('WARNING') ? 'WARNING' : vs.length ? 'READY' : null;
  };

  return (
    <StepShell eyebrow={t('madsb_step_placements')} title={t('madsb_pl_title')} lead={t('madsb_pl_lead')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceCard active={mode === 'RECOMMENDED'} icon={<Wand2 className="h-4 w-4" />} title={t('mads_placements_reco')} body={t('madsb_pl_reco_d')}
          onClick={() => patch({ placements: { mode: 'RECOMMENDED' } }, { immediate: true })} />
        <ChoiceCard active={mode === 'CUSTOM'} title={t('mads_placements_custom')} body={t('madsb_pl_custom_d')}
          onClick={() => patch({ placements: { mode: 'CUSTOM', list: recommended.length ? recommended : ['facebook_feed'] } }, { immediate: true })} />
      </div>
      {mode === 'RECOMMENDED' ? (
        <div className="rounded-xl border border-border bg-[hsl(var(--secondary))]/40 p-3.5">
          <p className="text-[13px] font-medium text-foreground">{t('madsb_pl_reco_result')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recommended.map((p) => <span key={p} className="rounded-full border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-2xs font-medium">{t(`mads_pl_${p}` as never)}</span>)}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t('madsb_pl_reco_why')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {PLACEMENTS.map((p) => {
            const reason = disabledReason(p);
            const on = list.includes(p);
            const v = verdictFor(p);
            return (
              <div key={p} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5', on ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/50' : 'border-border')}>
                <label className={cn('flex items-center gap-2.5 text-sm', reason && 'opacity-55')}>
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--gold))]" checked={on} disabled={!!reason}
                    onChange={() => patch({ placements: { mode: 'CUSTOM', list: on ? list.filter((x) => x !== p) : [...list, p] } }, { immediate: true })} />
                  <span className="font-medium text-foreground">{t(`mads_pl_${p}` as never)}</span>
                </label>
                <span className="flex items-center gap-2">
                  {reason ? <span className="text-2xs text-muted-foreground">{t(reason as never)}</span>
                    : on && v ? <VerdictBadge verdict={v} label={t(`madsb_pl_media_${v.toLowerCase()}` as never)} /> : null}
                </span>
              </div>
            );
          })}
          {list.length === 0 && <p className="text-[13px] text-destructive">{t('madsb_gap_placements')}</p>}
          {list.some((p) => verdictFor(p) === 'INCOMPATIBLE') && (
            <p className="text-[13px] text-destructive">{t('madsb_pl_fix_incompatible')}</p>
          )}
        </div>
      )}
    </StepShell>
  );
}

export function ReviewStep({ campaign, status, creatives, totals, pricing, recommended, preflight, running, onPreflight, onLaunch, canLaunch, launchHint = null, onEdit, strategy = null, strategyLoading = false, strategyFailed = false }: {
  campaign: MetaCampaignRow; status: MetaStatus | null; creatives: MetaCreativeRow[]; totals: Totals | null; pricing: boolean;
  recommended: Placement[]; preflight: PreflightResult | null; running: boolean;
  onPreflight: () => void; onLaunch: () => void; canLaunch: boolean; onEdit: (step: string) => void;
  /** Why Launch is unavailable (an i18n key), shown beside it. */
  launchHint?: string | null;
  strategy?: StrategyPreview | null; strategyLoading?: boolean; strategyFailed?: boolean;
}) {
  const { t, lang } = useLanguage();
  const goal = campaign.goal as MetaGoal;
  const spec = GOAL_SPECS[goal];
  const page = selectedAsset(status, 'PAGE');
  const ig = selectedAsset(status, 'INSTAGRAM');
  const acct = selectedAsset(status, 'AD_ACCOUNT');
  const pixel = selectedAsset(status, 'PIXEL');
  const form = (status?.assets ?? []).find((a) => a.kind === 'LEAD_FORM' && a.external_id === campaign.destination?.formId) ?? selectedAsset(status, 'LEAD_FORM');
  // The server's classification (engine.strategyInputFor), not a guess.
  const housing = isHousingCampaign(campaign);
  const locs = campaign.targeting?.locations?.length
    ? campaign.targeting.locations.map((l) => (l.type === 'country' ? regionName(l.key, lang) : l.type === 'city' && l.radiusKm ? `${l.name} (+${t('mm_b_loc_radius_km', { km: String(l.radiusKm) })})` : l.name))
    : (status?.settings.countries ?? ['GE']).map((c) => regionName(c, lang));
  const eff = strategy?.targeting.effective;
  const placements = campaign.placements?.mode === 'CUSTOM' ? (campaign.placements.list ?? []) : recommended;
  const withMedia = creatives.filter((c) => c.media.length);

  const Block = ({ title, step, rows }: { title: string; step: string; rows: Array<[string, React.ReactNode]> }) => (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        <button type="button" onClick={() => onEdit(step)} className="text-2xs font-medium text-[hsl(var(--gold-ink))] hover:underline">{t('madsb_edit')}</button>
      </div>
      <dl className="mt-2 space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 text-end font-medium text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <StepShell eyebrow={t('madsb_step_review')} title={t('madsb_review_title')} lead={t('madsb_review_lead')}>
      <div className="grid gap-3 md:grid-cols-2">
        <Block title={t('madsb_review_campaign')} step="goal" rows={[
          [t('madsb_review_objective'), t(`mads_goal_${goal.toLowerCase()}` as never)],
          [t('madsb_review_destination'), spec.needsLeadForm ? (form?.name ?? '—') : spec.needsMessagingApp ? t(`madsb_msg_${String(campaign.destination?.messagingApp ?? 'messenger').toLowerCase().replace('instagram_direct', 'instagram')}` as never) : <span dir="ltr">{campaign.destination?.url ?? '—'}</span>],
          [t('madsb_review_identity'), `${page?.name ?? '—'}${ig ? ` · ${ig.name}` : ''}`],
          [t('mads_conn_ad_account'), acct?.name ?? '—'],
        ]} />
        <Block title={t('madsb_review_audience')} step="audience" rows={[
          [t('madsb_review_location'), <span dir="auto">{locs.join(', ')}</span>],
          ...(eff ? [[t('mm_b_who_title'), `${t('mm_b_age_range', { min: String(eff.ageMin), max: eff.ageMax >= 65 ? '65+' : String(eff.ageMax) })} · ${t(`mm_b_gender_${eff.gender === 'MALE' || eff.gender === 'FEMALE' ? eff.gender : 'ALL'}`)}`] as [string, React.ReactNode]] : []),
          [t('madsb_review_audience_type'), campaign.audience_id ? t('madsb_audience_retarget') : t('mads_audience_broad')],
          ...(housing ? [[t('madsb_review_policy'), t('madsb_housing_short')] as [string, React.ReactNode]] : []),
        ]} />
        <Block title={t('madsb_review_creative')} step="creative" rows={[
          [t('madsb_review_media'), t('madsb_review_media_count', { n: String(withMedia.length) })],
          [t('madsb_field_primary'), <span className="line-clamp-2">{withMedia[0]?.primary_text || '—'}</span>],
          [t('madsb_field_headline'), withMedia[0]?.headline || '—'],
          [t('madsb_field_cta'), t(`madsb_cta_${(withMedia[0] && spec.allowedCtas.includes(withMedia[0].cta) ? withMedia[0].cta : spec.defaultCta).toLowerCase()}` as never)],
        ]} />
        <Block title={t('madsb_review_delivery')} step="placements" rows={[
          [t('madsb_step_placements'), campaign.placements?.mode === 'CUSTOM' ? t('mads_placements_custom') : t('mads_placements_reco')],
          ['', <span className="text-2xs">{placements.map((p) => t(`mads_pl_${p}` as never)).join(' · ')}</span>],
          ...(spec.needsPixel ? [[t('madsb_review_tracking'), `${pixel?.name ?? '—'} · ${spec.pixelEvent}`] as [string, React.ReactNode]] : []),
          [t('madsb_review_schedule'), t('madsb_review_schedule_v', { days: String(campaign.duration_days ?? 0) })],
        ]} />
      </div>

      <FinancialSummary totals={totals} pricing={pricing} billing={status?.settings.budgetBilling} />
      <StrategyCard preview={strategy} loading={strategyLoading} failed={strategyFailed} />
      <FundingCard funding={strategy?.funding ?? null} loading={strategyLoading}
        currency={campaign.currency || status?.wallet?.currency || 'USD'} billing={status?.settings.budgetBilling} />

      <div className="rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))]/60 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Wand2 className="h-4 w-4 text-[hsl(var(--gold-ink))]" />{t('madsb_handles_title')}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t('madsb_handles_lead')}</p>
        <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {handledTasks(goal, { hasInstagram: !!ig, placementsMode: campaign.placements?.mode ?? 'RECOMMENDED', housing }).map((k) => (
            <li key={k} className="flex items-start gap-2 text-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(152_54%_30%)]" />{t(`madsb_handles_${k}` as never)}</li>
          ))}
        </ul>
        <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">{t('madsb_experience_note')}</p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
        <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]"><ShieldCheck className="h-4 w-4" />{t('madsb_preflight_title')}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">{t('madsb_preflight_vs_review')}</p>
        {preflight && (
          <>
            <p className={cn('mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold',
              preflight.status === 'READY' ? 'bg-[hsl(152_54%_28%)]/25 text-[hsl(152_60%_70%)]' : 'bg-[hsl(0_70%_50%)]/20 text-[hsl(0_80%_78%)]')}>
              {t(preflight.status === 'READY' ? (preflight.warnings ? 'madsb_pf_ready_warnings' : 'madsb_pf_ready') : preflight.status === 'MANUAL_REVIEW' ? 'mads_preflight_review' : 'madsb_pf_action')}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {preflight.checks.map((ch) => {
                const state = ch.state ?? (ch.ok ? 'READY' : 'ACTION_REQUIRED');
                return (
                  <li key={ch.key} className="flex items-start gap-2">
                    {state === 'READY' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_55%)]" />
                      : state === 'WARNING' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(38_92%_60%)]" />
                        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(0_70%_62%)]" />}
                    <span className="min-w-0">
                      <span className={state === 'READY' ? 'text-white/85' : 'text-white'}>{t(`mads_check_${ch.key}` as never)}</span>
                      {ch.detail && state !== 'READY' && (
                        <span className="block text-2xs text-white/55">
                          {preflightDetails(ch.detail).map(({ key, value }) => t(key as never, { value })).join(' · ')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onPreflight} disabled={running} className="border border-white/40 bg-white text-[#0C1119] hover:bg-white/90">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : t(preflight ? 'madsb_preflight_again' : 'mads_run_preflight')}
          </Button>
          <Button onClick={onLaunch} disabled={!canLaunch || running} aria-describedby={launchHint ? 'mm-b-launch-hint' : undefined}
            className="bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:bg-white/[0.14] disabled:text-white/50 disabled:opacity-100">
            {t('mads_launch')}
          </Button>
        </div>
        {launchHint && <p id="mm-b-launch-hint" data-mm-launch-hint="" className="mt-2 text-[13px] font-medium text-[hsl(38_92%_66%)]">{t(launchHint as never)}</p>}
        <p className="mt-3 text-2xs leading-relaxed text-white/60">{t('mads_meta_review_note')}</p>
      </div>
    </StepShell>
  );
}
