// PLACEMENTS and REVIEW.
//
// "What HOMATCH handles" lists only work this codebase actually performs for
// the chosen goal (payload.ts, engine.ts, meta-webhooks, the maintenance
// cron). A line is added here only when the code behind it exists.
import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, Wand2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from './MetaButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { checkMedia, GOAL_SPECS, PLACEMENTS, type Placement, resolveCta } from '@/lib/metaAds/payload';
import type { MetaGoal } from '@/lib/metaAds/strategy';
import { money, type MetaCampaignRow, type MetaCreativeRow, type MetaStatus, type PreflightResult, type StrategyPreview } from '@/services/metaAds';
import { ChoiceCard, StepShell, SummaryRow, VerdictBadge } from './ui';
import { selectedAsset, preflightDetails, handledTasks } from './steps';
import { checkTitleKey, issueTarget, severityOf, type IssueTarget } from '@/lib/metaAds/readiness';
import { FinancialSummary, type Totals } from './BudgetStep';
import { StrategyCard } from './StrategyCard';
import { FundingCard } from './FundingCard';
import { regionName } from './LocationPicker';
import { advertiserCountryOf, effectiveRadiusKm, geographyGroups, housingRuleFor } from './masterLogic';
import { Hint, More } from './FinishKit';
import { languageName } from './AudienceStep';

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
    <StepShell eyebrow={t('madsb_step_placements')} title={t('madsb_pl_title')} lead={t('madsb_pl_lead')} data-mm-field="placements">
      <Hint k="mm_c_hint_placements" />
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

/**
 * The campaign's HOMATCH name: prefilled with a suggestion, editable here and
 * later on the campaign page. A display name only — not part of what the
 * HOMATCH check approves, so editing it never asks for a new check.
 */
export function CampaignNameField({ value, suggestion, onSave }: { value: string; suggestion: string; onSave: (name: string) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value || suggestion);
  useEffect(() => { setDraft(value || suggestion); }, [value, suggestion]);
  const clean = draft.replace(/\s+/g, ' ').trim();
  const invalid = clean.length < 3 || clean.length > 120;
  const commit = () => { if (!invalid && clean !== value) onSave(clean); };
  return (
    <div className="rounded-xl border border-border p-3.5" data-mm-name-field="">
      <label htmlFor="mm-b-name" className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mm_b_name_label')}</label>
      <input id="mm-b-name" value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        aria-invalid={invalid} aria-describedby="mm-b-name-note" dir="auto"
        className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]" />
      <p id="mm-b-name-note" className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{t('mm_b_name_note')}</p>
    </div>
  );
}

export function ReviewStep({ campaign, status, creatives, totals, pricing, recommended, preflight, running, onPreflight, onLaunch, canLaunch, launchHint = null, onEdit, onFix, strategy = null, strategyLoading = false, strategyFailed = false, nameSuggestion = '', onName, insights = null }: {
  /** A readiness item tapped: go to its step and field (lib/metaAds/readiness.ts). */
  onFix?: (target: IssueTarget) => void;
  /** The campaign explained, what to expect and the holistic check (ReviewInsights). */
  insights?: React.ReactNode;
  /** The suggested HOMATCH name and where an edited one is saved. */
  nameSuggestion?: string; onName?: (name: string) => void;
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
  // The server's rule (engine.strategyInputFor → declaredSpecialAdCategories), not a guess.
  const chosenLocs = campaign.targeting?.locations ?? [];
  const rule = housingRuleFor(campaign, chosenLocs, advertiserCountryOf(status));
  const housing = rule.restricted;
  const locs = campaign.targeting?.locations?.length
    ? campaign.targeting.locations.map((l) => (l.type === 'country' ? regionName(l.key, lang) : l.type === 'city' || l.type === 'pin' ? `${l.name} (+${t('mm_b_loc_radius_km', { km: String(effectiveRadiusKm(l.radiusKm, rule.minRadiusKm)) })})` : l.name))
    : [t('mm_c_loc_none_chosen')];
  const langs = (campaign.targeting?.languages ?? []).map((l) => (l.code ? languageName(l.code, lang) : l.name));
  const priorityCount = creatives.filter((c) => c.priority && c.media.length).length;
  const eff = strategy?.targeting?.effective;
  const placements = campaign.placements?.mode === 'CUSTOM' ? (campaign.placements.list ?? []) : recommended;
  const withMedia = creatives.filter((c) => c.media.length);
  const shortfall = Number(strategy?.funding?.shortfallCents ?? 0) > 0;
  const geo = geographyGroups(chosenLocs as never).map((g) => {
    const places = g.places.map((l: { type: string; name: string; radiusKm?: number | null }) =>
      (l.type === 'city' || l.type === 'pin' ? `${l.name} · ${effectiveRadiusKm(l.radiusKm, rule.minRadiusKm)} km` : l.name));
    return places.length ? `${regionName(g.countryCode, lang)} → ${places.join(', ')}` : regionName(g.countryCode, lang);
  }).join(' + ');
  const daily = Number(campaign.daily_budget_cents ?? 0);
  const summary: Array<[string, React.ReactNode, string]> = [
    [t('madsb_review_objective'), t(`mads_goal_${goal.toLowerCase()}` as never), 'goal'],
    [t('madsb_review_location'), geo, 'audience'],
    [t('mads_budget_daily'), <span className="whitespace-nowrap" dir="ltr">{`${money(daily)} × ${campaign.duration_days ?? 0}`}</span>, 'budget'],
    [t('madsb_review_creative'), `${t('madsb_review_media_count', { n: String(withMedia.length) })}${priorityCount ? ` · ★ ${priorityCount}` : ''}`, 'creative'],
  ];

  const Block = ({ title, step, rows }: { title: string; step: string; rows: Array<[string, React.ReactNode]> }) => (
    <div className="rounded-xl border border-border p-3.5" data-mm-review-block={step}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        <button type="button" onClick={() => onEdit(step)} aria-label={`${t('madsb_edit')} · ${title}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-2.5 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">{t('madsb_edit')}</button>
      </div>
      {/* Label above value on phones: never two narrow columns. */}
      <dl className="mt-1 divide-y divide-border/60 text-sm">
        {rows.map(([k, v]) => <SummaryRow key={k} label={k} value={v} editLabel={t('madsb_edit')} dense />)}
      </dl>
    </div>
  );

  return (
    <StepShell eyebrow={t('madsb_step_review')} title={t('madsb_review_title')} lead={t('madsb_review_lead')}>
      {onName && <CampaignNameField value={campaign.name ?? ''} suggestion={nameSuggestion} onSave={onName} />}
      {/* SUMMARY FIRST — about one phone screen: what runs, where, for how much. */}
      <div data-mm-review-summary="" className="overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-card shadow-card">
        <dl className="divide-y divide-border text-sm">
          {summary.map(([k, v, step]) => <SummaryRow key={k} label={k} value={v} onEdit={() => onEdit(step)} editLabel={t('madsb_edit')} />)}
        </dl>
      </div>
      {insights}
      <FinancialSummary totals={totals} pricing={pricing} billing={status?.settings.budgetBilling} />
      {shortfall && <FundingCard funding={strategy?.funding ?? null} loading={strategyLoading}
        currency={campaign.currency || status?.wallet?.currency || 'USD'} billing={status?.settings.budgetBilling} />}

      <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
        <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]"><ShieldCheck className="h-4 w-4" />{t('madsb_preflight_title')}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">{t('madsb_preflight_vs_review')}</p>
        {preflight && (
          <>
            <p className={cn('mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold',
              preflight.status === 'READY' ? 'bg-[hsl(152_54%_28%)]/25 text-[hsl(152_60%_70%)]' : 'bg-[hsl(0_70%_50%)]/20 text-[hsl(0_80%_78%)]')}>
              {t(preflight.status === 'READY' ? (preflight.warnings ? 'madsb_pf_ready_warnings' : 'madsb_pf_ready') : preflight.status === 'MANUAL_REVIEW' ? 'mads_preflight_review' : 'madsb_pf_action')}
            </p>
            {(() => {
              /* BLOCKER first, then WARNING; what is fine stays listed, quietly, last. */
              const rank = (ch: { state?: string; ok?: boolean }) => ({ BLOCKER: 0, WARNING: 1 } as Record<string, number>)[severityOf(ch.state, ch.ok) ?? ''] ?? 2;
              const rows = [...preflight.checks].sort((a, b) => rank(a) - rank(b));
              const open = rows.filter((ch) => severityOf(ch.state, ch.ok) === 'BLOCKER').length;
              return (
                <>
                  {open > 0 && onFix && (
                    <button type="button" data-mm-check-left={open} onClick={() => { const f = rows[0]; onFix(issueTarget(f.key, f.detail)); }}
                      className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/25 px-3 text-[13px] font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]">
                      {t('mm_r_left', { n: String(open) })}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                    </button>
                  )}
                  <ul className="mt-3 space-y-1 text-sm">
                    {rows.map((ch) => {
                      const sev = severityOf(ch.state, ch.ok);
                      const details = ch.detail && sev ? preflightDetails(ch.detail).map(({ key, value }) => t(key as never, { value })).join(' · ') : '';
                      const body = (
                        <>
                          {sev === null ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(152_60%_55%)]" />
                            : sev === 'WARNING' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(38_92%_60%)]" />
                              : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(0_70%_62%)]" />}
                          <span className="min-w-0 flex-1">
                            <span className={sev === null ? 'text-white/85' : 'font-medium text-white'}>{t(checkTitleKey(ch.key) as never)}</span>
                            {sev && <span className="ms-1.5 text-2xs uppercase tracking-wide text-white/50">{t(sev === 'BLOCKER' ? 'mm_r_sev_blocker' : 'mm_r_sev_warning')}</span>}
                            {details && <span className="block text-2xs text-white/60">{details}</span>}
                          </span>
                          {sev && onFix && <span className="shrink-0 self-center text-2xs font-semibold text-[hsl(38_92%_66%)]">{t('mm_r_fix')}</span>}
                        </>
                      );
                      return (
                        <li key={ch.key} data-mm-check={ch.key} data-mm-check-sev={sev ?? 'OK'}>
                          {sev && onFix ? (
                            <button type="button" onClick={() => onFix(issueTarget(ch.key, ch.detail))}
                              className="flex min-h-11 w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-start hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]">
                              {body}
                            </button>
                          ) : <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            })()}
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onPreflight} disabled={running} data-mm-run-check="" className="border border-white/40 bg-white text-[#0C1119] hover:bg-white/90">
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

      {/* Everything else, folded: the full build, the plan, what HOMATCH handles. */}
      <More label={t('mm_m_review_all_details')} data-mm-review-details="">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Block title={t('madsb_review_campaign')} step="goal" rows={[
              [t('madsb_review_objective'), t(`mads_goal_${goal.toLowerCase()}` as never)],
              [t('madsb_review_destination'), spec.needsLeadForm ? (form?.name ?? '—') : spec.needsMessagingApp ? t(`madsb_msg_${String(campaign.destination?.messagingApp ?? 'messenger').toLowerCase().replace('instagram_direct', 'instagram')}` as never) : <span dir="ltr" className="[overflow-wrap:anywhere]">{campaign.destination?.url ?? "—"}</span>],
              [t('madsb_review_identity'), `${page?.name ?? '—'}${ig ? ` · ${ig.name}` : ''}`],
              [t('mads_conn_ad_account'), acct?.name ?? '—'],
            ]} />
            <Block title={t('madsb_review_audience')} step="audience" rows={[
              [t('madsb_review_location'), <span dir="auto">{locs.join(', ')}</span>],
              ...(eff ? [[t('mm_b_who_title'), `${t('mm_b_age_range', { min: String(eff.ageMin), max: eff.ageMax >= 65 ? '65+' : String(eff.ageMax) })} · ${t(`mm_b_gender_${eff.gender === 'MALE' || eff.gender === 'FEMALE' ? eff.gender : 'ALL'}`)}`] as [string, React.ReactNode]] : []),
              [t('mm_f_lang_title'), langs.length ? langs.join(', ') : t('mm_f_lang_all')],
              ...(campaign.targeting?.international?.enabled ? [[t('mm_f_intl_title'), (campaign.targeting.international.markets ?? []).map((m) => regionName(m, lang)).join(', ') || t('mm_f_on')] as [string, React.ReactNode]] : []),
              [t('madsb_review_audience_type'), campaign.audience_id ? t('madsb_audience_retarget') : t('mads_audience_broad')],
              ...(housing ? [[t('madsb_review_audience'), t('mm_f_meta_rule_short')] as [string, React.ReactNode]] : []),
            ]} />
            <Block title={t('madsb_review_creative')} step="creative" rows={[
              [t('madsb_review_media'), t('madsb_review_media_count', { n: String(withMedia.length) })],
              ...(priorityCount ? [[t('mm_f_priority_title'), `⭐ ${priorityCount}`] as [string, React.ReactNode]] : []),
              [t('madsb_field_primary'), <span className="line-clamp-2">{withMedia[0]?.primary_text || '—'}</span>],
              [t('madsb_field_headline'), withMedia[0]?.headline || '—'],
              [t('madsb_field_cta'), t(`madsb_cta_${resolveCta(goal, withMedia[0]?.cta, campaign.destination?.messagingApp ?? null).toLowerCase()}` as never)],
            ]} />
            <Block title={t('madsb_review_delivery')} step="placements" rows={[
              [t('madsb_step_placements'), campaign.placements?.mode === 'CUSTOM' ? t('mads_placements_custom') : t('mads_placements_reco')],
              ['', <span className="text-2xs">{placements.map((p) => t(`mads_pl_${p}` as never)).join(' · ')}</span>],
              ...(spec.needsPixel ? [[t('madsb_review_tracking'), `${pixel?.name ?? '—'} · ${spec.pixelEvent}`] as [string, React.ReactNode]] : []),
              [t('madsb_review_schedule'), t('madsb_review_schedule_v', { days: String(campaign.duration_days ?? 0) })],
            ]} />
          </div>


          <StrategyCard preview={strategy} loading={strategyLoading} failed={strategyFailed} />
          {!shortfall && <FundingCard funding={strategy?.funding ?? null} loading={strategyLoading}
            currency={campaign.currency || status?.wallet?.currency || 'USD'} billing={status?.settings.budgetBilling} />}
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

        </div>
      </More>
    </StepShell>
  );
}
