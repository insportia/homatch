// THE REVIEW, EXPLAINED — the campaign told back in sentences (every one a
// fact of the build), what to expect (Meta's own audience estimate when Meta
// gives one, otherwise honest guidance — never a promise), and one holistic
// check for contradictions, each with the single change that resolves it.
// No change is made without the owner pressing its button.
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  campaignConsistency, campaignStory, expectationGuide, type BuildFacts, type ConsistencyIssue, type FixAction,
} from '@/lib/metaAds/audienceGuide';
import { META_AGE_MAX, META_AGE_MIN } from '@/lib/metaAds/targeting';
import { deliveryEstimate, localeSearch, type DeliveryEstimate, type MetaCampaignRow, type MetaCreativeRow, type MetaStatus, type TargetingIntentRow } from '@/services/metaAds';
import { HelperCard, LearningCard, LearningStageCard } from './FinishKit';
import { regionName } from './LocationPicker';
import { languageName } from './AudienceStep';
import { addLocation, isHousingOffer } from './masterLogic';

const EMOJI: Record<string, string> = { goal: '🎯', who: '👥', where: '📍', language: '🌍', creative: '🎨', optimise: '🧠', first_days: '📅', brief: '💬' };

function compact(n: number, lang: string) {
  try { return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
}

export function ReviewInsights({ campaign, status, creatives, patch, onEdit }: {
  campaign: MetaCampaignRow; status: MetaStatus | null; creatives: MetaCreativeRow[];
  patch: (p: Partial<MetaCampaignRow>, o?: { immediate?: boolean }) => void;
  onEdit: (step: string) => void;
}) {
  const { t, lang } = useLanguage();
  // Exactly what the owner chose — never a default country standing in for an empty choice.
  const targeting: TargetingIntentRow = campaign.targeting?.locations?.length ? campaign.targeting : {
    locations: [],
    ageMin: campaign.targeting?.ageMin ?? META_AGE_MIN, ageMax: campaign.targeting?.ageMax ?? META_AGE_MAX, gender: campaign.targeting?.gender ?? 'ALL',
    languages: campaign.targeting?.languages, international: campaign.targeting?.international ?? null,
  };
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const signature = JSON.stringify([targeting, campaign.goal]);
  useEffect(() => {
    let live = true;
    setEstimating(true);
    const h = setTimeout(async () => {
      const r = await deliveryEstimate(campaign.id).catch(() => ({ available: false, reason: 'FAILED' } as DeliveryEstimate));
      if (live) { setEstimate(r); setEstimating(false); }
    }, 700);
    return () => { live = false; clearTimeout(h); };
  }, [campaign.id, signature]);

  const facts: BuildFacts = {
    goal: campaign.goal, dailyBudgetCents: Number(campaign.daily_budget_cents ?? 0), durationDays: Number(campaign.duration_days ?? 0),
    targeting: targeting as never, housingOffer: isHousingOffer(campaign), creatives: creatives as never,
    brief: campaign.brief_understanding ?? null, estimate: estimate?.available ? estimate.audience ?? null : null,
  };
  const placeName = (l: TargetingIntentRow['locations'][number]) => (l.type === 'country' ? regionName(l.key, lang) : l.name);
  const story = useMemo(() => campaignStory({
    ...facts, goalKey: String(campaign.goal).toLowerCase(),
    placeNames: targeting.locations.map(placeName),
    languageNames: (targeting.languages ?? []).map((l) => (l.code ? languageName(l.code, lang) : l.name)),
    marketNames: (targeting.international?.markets ?? []).map((m) => regionName(m, lang)),
  }), [signature, creatives, campaign.brief_understanding, estimate, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => campaignConsistency(facts), [signature, creatives, campaign.brief_understanding, estimate, campaign.daily_budget_cents]); // eslint-disable-line react-hooks/exhaustive-deps
  const guide = expectationGuide(facts);

  const vars = (v?: Record<string, string>) => {
    if (!v) return undefined;
    const out: Record<string, string> = { ...v };
    if (v.gender) out.gender = t(`mm_b_gender_${v.gender}`);
    if (v.lang) out.lang = languageName(v.lang, lang);
    if (v.copy) out.copy = languageName(v.copy, lang);
    if (v.chosen) out.chosen = v.chosen.split(',').map((c) => languageName(c, lang)).join(', ');
    if (v.markets && !/[^A-Z,]/.test(v.markets)) out.markets = v.markets.split(',').map((m) => regionName(m, lang)).join(', ');
    if (v.countries && !/[^A-Z, ]/.test(v.countries)) out.countries = v.countries.split(',').map((c) => regionName(c.trim(), lang)).join(', ');
    if (v.lower) out.lower = compact(Number(v.lower), lang);
    if (v.upper) out.upper = compact(Number(v.upper), lang);
    return out;
  };

  const fix = async (f: FixAction) => {
    switch (f.kind) {
      case 'GO': onEdit(f.step); return;
      case 'WIDEN_AREA': onEdit('audience'); return;
      case 'ADD_CREATIVES': case 'TRANSLATE_COPY': onEdit('creative'); return;
      case 'BROADEN_AGES': patch({ targeting: { ...targeting, ageMin: META_AGE_MIN, ageMax: META_AGE_MAX, gender: 'ALL' } }, { immediate: true }); toast.success(t('mm_f_fix_done')); return;
      case 'ADD_MARKETS': {
        let list = [...targeting.locations];
        for (const m of f.markets) { const r = addLocation(list, { type: 'country', key: m, name: regionName(m, lang), countryCode: m }); if (!r.full) list = r.list; }
        patch({ targeting: { ...targeting, locations: list } }, { immediate: true }); toast.success(t('mm_f_fix_done')); return;
      }
      case 'ADD_LANGUAGE': {
        try {
          const r = await localeSearch(f.code);
          const hit = r.results?.[0];
          if (!hit) { toast.info(t('mm_f_lang_none')); return; }
          patch({ targeting: { ...targeting, languages: [...(targeting.languages ?? []), { key: hit.key, name: hit.name, code: f.code }] } }, { immediate: true });
          toast.success(t('mm_f_fix_done'));
        } catch { toast.error(t('mm_f_lang_error')); }
      }
    }
  };
  const fixLabel = (i: ConsistencyIssue) => (i.fix ? t(`mm_f_fix_${i.fix.kind}`, i.fix.kind === 'ADD_LANGUAGE' || i.fix.kind === 'TRANSLATE_COPY' ? { lang: languageName(i.fix.code, lang) } : undefined) : null);

  const warnings = issues.filter((i) => i.severity === 'WARNING').length;
  const [open, setOpen] = useState(false);
  useEffect(() => { if (warnings) setOpen(true); }, [warnings]);
  const estimateBox = (
    <div className="mt-3 rounded-xl border border-dashed border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))]/40 p-3" data-mm-estimate={estimate?.available ? 'meta' : estimate?.reason ?? 'pending'}>
      {estimating ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('mm_f_estimate_loading')}</p>
      ) : estimate?.available && estimate.audience ? (
        <>
          <p className="text-sm font-semibold text-foreground">👥 {t('mm_f_estimate_audience', { lower: compact(estimate.audience.lower, lang), upper: compact(estimate.audience.upper, lang) })}</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t('mm_f_estimate_source')}</p>
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mm_f_estimate_none')}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* One line first: ready, or how many suggestions — the detail folds open on request. */}
      <section data-mm-insights="" className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-semibold text-foreground" data-mm-insights-summary={issues.length}>
            {issues.length === 0 ? `✓ ${t('mm_m_review_ready')}` : `💡 ${t('mm_m_review_suggestions', { n: String(issues.length) })}`}
          </p>
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-mm-insights-toggle=""
            className="inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
            {t(open ? 'mm_m_hide_details' : 'mm_m_view_details')}
          </button>
        </div>
        {estimateBox}
        {/* A new campaign has no results yet: it starts from the initial strategy. */}
        <div className="mt-3"><LearningStageCard stage="NEW" /></div>
      </section>
      {open && (<>
      {/* 🧠 THE CAMPAIGN, EXPLAINED */}
      <section data-mm-story="" className="overflow-hidden rounded-2xl border border-[hsl(var(--gold-border))]/50 bg-gradient-to-br from-[hsl(var(--gold-soft))] via-card to-card shadow-card">
        <div className="border-b border-[hsl(var(--gold-border))]/40 px-4 py-3">
          <p className="text-[15px] font-semibold text-foreground">✨ {t('mm_f_story_title')}</p>
          <p className="text-[13px] text-muted-foreground">{t('mm_f_story_lead')}</p>
        </div>
        <div className="grid gap-px bg-[hsl(var(--gold-border))]/25 sm:grid-cols-2">
          {story.map((s) => (
            <div key={s.key} data-mm-story-section={s.key} className="bg-card px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><span aria-hidden>{EMOJI[s.key]}</span>{t(`mm_f_story_h_${s.key}`)}</p>
              <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
                {s.lines.map((l, i) => <li key={i} dir="auto">{t(`mm_f_story_${l.key}`, vars(l.vars))}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 📊 WHAT CAN I EXPECT */}
      <section data-mm-expect={guide.room} className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] font-semibold text-foreground">📊 {t('mm_f_expect_title')}</p>
          <span className={cn('rounded-full px-2.5 py-1 text-2xs font-semibold',
            guide.room === 'GOOD_ROOM' ? 'bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]' : guide.room === 'SOME_ROOM' ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'bg-[hsl(32_78%_45%)]/10 text-[hsl(32_78%_30%)]')}>
            {t(`mm_f_room_${guide.room}`)}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t(`mm_f_room_${guide.room}_d`)}</p>
        <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-foreground">
          {guide.notes.filter((n) => n.key !== 'exp_audience_size').map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden>•</span><span>{t(`mm_f_${n.key}`, vars(n.vars))}</span></li>)}
        </ul>
        <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">{t('mm_f_expect_disclaimer')}</p>
      </section>

      {/* 🔍 ONE HOLISTIC CHECK */}
      <section data-mm-consistency={issues.length} className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <p className="text-[15px] font-semibold text-foreground">🔍 {t('mm_f_check_title')}</p>
        {issues.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">✅ {t('mm_f_check_clear')}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {issues.map((i) => (
              <HelperCard key={i.code} emoji={i.severity === 'WARNING' ? '⚠️' : '💡'} tone={i.severity === 'WARNING' ? 'amber' : 'calm'} data-mm-issue={i.code}
                title={t(`mm_f_issue_${i.code}`, vars(i.vars))}
                action={i.fix ? (
                  <button type="button" onClick={() => void fix(i.fix!)} data-mm-fix={i.fix.kind}
                    className="inline-flex min-h-[38px] items-center rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3.5 text-[13px] font-semibold text-foreground hover:bg-[hsl(var(--gold))] hover:text-[#161309]">
                    {fixLabel(i)}
                  </button>
                ) : undefined}>
                {t(`mm_f_issue_${i.code}_d`, vars(i.vars))}
              </HelperCard>
            ))}
          </div>
        )}
      </section>

      <LearningCard />
      </>)}
    </div>
  );
}
