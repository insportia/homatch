// THE SIMPLE FIRST RUN — one task per screen, the space as the hero.
//
//   Upload → (analysis) → [one detail, only if needed] → Style → Next →
//   Quality → Create my design → (generating) → the result.
//   (Upload, analysis, generating and failure: unified/Screens.tsx.)
//
// Every screen has ONE primary action, anchored to the bottom on a phone (the
// thumb's reach, inside the safe area) and inline on a large screen. Detail is
// never removed, only moved: the full plan review and the detailed look
// ("Customise details") are a quiet link away.

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import type { PlanAnswer, PlanQuestion } from '@/lib/designStudio/planToHome';
import { LOOK_QUALITIES, LOOK_STYLES, type LookQuality, type LookStyle } from '@/lib/designStudio/lookPresets';
import { cn } from '@/lib/utils';
import { PlanDrawing } from './PlanDrawing';
import { QuestionChoices, questionText, selectionFor } from './PlanReview';
import { StylePreview } from './StylePreview';

/** The calm surface every simple screen shares. */
export const SURFACE = 'bg-[#F7F4EF] text-[#0C1119]';
export const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF]';
export const PRIMARY = cn('inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[hsl(38_92%_56%)] px-7 text-[16px] font-semibold text-[#0C1119] transition-colors hover:bg-[hsl(38_92%_50%)] disabled:cursor-not-allowed disabled:bg-[#E4DDD1] disabled:text-[#4A5263] disabled:shadow-[inset_0_0_0_1px_#9C9180] disabled:hover:bg-[#E4DDD1] sm:w-auto sm:min-w-[240px]', RING);
export const QUIET = cn('inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[#4A5263] underline-offset-4 hover:text-[#0C1119] hover:underline', RING);

/** A screen: an optional back, the one question it asks, its content, and its one action. */
export function Screen({ title, body, eyebrow, onBack, children, action, aside, testId, wide = false, center = false }: {
  title: string; body?: string; eyebrow?: string; onBack?: () => void; children?: React.ReactNode;
  action?: React.ReactNode; aside?: React.ReactNode; testId?: string; wide?: boolean; center?: boolean;
}) {
  const { t } = useLanguage();
  const frame = wide ? 'max-w-5xl' : 'max-w-2xl';
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('flex min-h-full flex-col px-4 sm:px-8', center && 'lg:justify-center')}>
        <div className={cn('mx-auto w-full pb-8 pt-6 sm:pt-12', center && 'lg:pt-6', frame)}>
          {onBack ? (
            <button type="button" onClick={onBack} className={cn('-ms-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-[#4A5263] hover:text-[#0C1119]', RING)} data-testid="simple-back">
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />{t('sf_back')}
            </button>
          ) : null}
          {eyebrow ? <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(36_60%_32%)]">{eyebrow}</p> : null}
          <h1 className="mt-1 text-balance font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.01em] sm:text-[40px]">{title}</h1>
          {body ? <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-[#4A5263]">{body}</p> : null}
          <div className="mt-7 sm:mt-10">{children}</div>
          {aside ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2 sm:justify-start">{aside}</div> : null}
        </div>
        </div>
      </div>
      {action ? (
        <div className="shrink-0 border-t border-[#E7E1D8] bg-[#F7F4EF]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-8">
          <div className={cn('mx-auto flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end', frame)}>{action}</div>
        </div>
      ) : null}
    </div>
  );
}

// ── 2b. One quick question (only when HOMATCH genuinely needs the customer) ──

export function QuickQuestionStep({ question, index, total, doc, imageUrl, onAnswer, onDetail, busy }: {
  question: PlanQuestion; index: number; total: number; doc: FloorPlanDocument; imageUrl: string | null;
  onAnswer: (a: PlanAnswer) => void; onDetail: () => void; busy: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Screen eyebrow={total > 1 ? t('sf_q_progress', { n: String(index + 1), total: String(total) }) : undefined}
      title={t('dsx_q_title')} body={t('dsx_q_body')} testId="quick-question"
      aside={<button type="button" onClick={onDetail} className={QUIET} data-testid="review-detail">{t('sf_review_detail')}</button>}>
      <div className="overflow-hidden rounded-[28px] bg-white">
        <PlanDrawing doc={doc} imageUrl={imageUrl} mode="CLEAN" selection={selectionFor(question, doc)} className="max-h-[38dvh]" />
      </div>
      <h2 className="mt-6 text-[18px] font-semibold leading-snug" data-testid="quick-question-text">{questionText(question, t, doc)}</h2>
      <div className={cn('mt-4', busy && 'pointer-events-none opacity-60')}>
        <QuestionChoices q={question} onAnswer={onAnswer} large />
      </div>
    </Screen>
  );
}

// ── 3. Style ───────────────────────────────────────────────────────────────

/** The first looks shown; the rest are one tap away ("See more options"). */
const FIRST_STYLES = 4;

export function StyleStep({ value, onChange, onNext, onDetail, onSurprise }: {
  value: LookStyle | null; onChange: (s: LookStyle) => void; onNext: () => void; onDetail?: () => void; onSurprise: () => void;
}) {
  const { t } = useLanguage();
  const [more, setMore] = useState(() => !!value && LOOK_STYLES.indexOf(value) >= FIRST_STYLES);
  // A look chosen beyond the first ones ("surprise me", a resumed choice) is always shown.
  useEffect(() => { if (value && LOOK_STYLES.indexOf(value) >= FIRST_STYLES) setMore(true); }, [value]);
  const shown = more ? LOOK_STYLES : LOOK_STYLES.slice(0, FIRST_STYLES);
  return (
    <Screen wide eyebrow={t('dsx_st_eyebrow')} title={t('dsx_st_title')} body={t('dsx_st_body')} testId="look-style"
      aside={(
        <>
          {!more ? <button type="button" onClick={() => setMore(true)} className={QUIET} data-testid="look-more">{t('dsx_st_more')}</button> : null}
          <button type="button" onClick={onSurprise} className={QUIET} data-testid="look-surprise"><Sparkles className="h-4 w-4" aria-hidden="true" />{t('dsx_st_surprise')}</button>
          {onDetail ? <button type="button" onClick={onDetail} className={QUIET} data-testid="review-detail">{t('sf_review_detail')}</button> : null}
        </>
      )}
      action={<button type="button" onClick={onNext} disabled={!value} className={PRIMARY} data-testid="look-next">{t('dsx_next')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>}>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3" role="radiogroup" aria-label={t('dsx_st_title')}>
        {shown.map((s) => {
          const on = value === s;
          return (
            <button key={s} type="button" role="radio" aria-checked={on} onClick={() => onChange(s)}
              className={cn('group relative overflow-hidden rounded-[22px] bg-white text-start transition-shadow', RING, on ? 'ring-2 ring-[#0C1119]' : 'ring-1 ring-[#E7E1D8] hover:ring-[#B9AE9C]')}
              data-testid={`look-style-${s}`}>
              <StylePreview style={s} className="block aspect-[4/3] w-full lg:aspect-[16/9]" />
              <span className="block px-3 pb-3 pt-2.5 sm:px-4 sm:pb-4">
                <span className="block text-[15px] font-semibold sm:text-[17px]">{t(`sf_style_${s.toLowerCase()}`)}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-[#5B6472] sm:text-[14px]">{t(`sf_style_${s.toLowerCase()}_line`)}</span>
              </span>
              {on ? <span className="absolute end-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-[#0C1119] text-white" aria-hidden="true"><Check className="h-4 w-4" /></span> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-2xs text-[#5B6472]">{t('sf_style_illustration')}</p>
    </Screen>
  );
}

/** "Surprise me": one of the looks, never the one already chosen. */
export function surpriseStyle(current: LookStyle | null, rnd: () => number = Math.random): LookStyle {
  const pool = LOOK_STYLES.filter((s) => s !== current);
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}

// ── 4. Quality ─────────────────────────────────────────────────────────────

export function QualityStep({ value, onChange, onBack, onGenerate, onCustomize, busy, price, priceUnavailable, onRetryPrice }: {
  value: LookQuality | null; onChange: (q: LookQuality) => void; onBack: () => void; onGenerate: () => void; onCustomize?: () => void;
  busy: boolean; price: { credits: number; charged: boolean } | null; priceUnavailable: boolean; onRetryPrice: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Screen wide center eyebrow={t('dsx_ql_eyebrow')} title={t('dsx_ql_title')} body={t('dsx_ql_body')} onBack={onBack} testId="look-quality"
      aside={onCustomize ? (
        // The way to say it in one's own words: easy to see, premium, never a small link.
        <button type="button" onClick={onCustomize}
          className={cn('group flex w-full items-center gap-4 rounded-[22px] bg-[#0C1119] p-4 text-start text-white shadow-[0_18px_40px_-24px_rgba(12,17,25,0.6)] ring-1 ring-[hsl(38_92%_56%)]/35 transition-transform hover:-translate-y-0.5 sm:max-w-xl sm:p-5', RING)}
          data-testid="look-customize">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(38_92%_56%)] text-[#0C1119]" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{t('sf_customize')}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-white/70">{t('dsx_customize_sub')}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-[hsl(38_92%_62%)] transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
        </button>
      ) : undefined}
      action={(
        <>
          <p className="text-center text-[13px] text-[#5B6472] sm:me-auto sm:text-start" data-testid="look-price">
            {price ? t(price.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: String(price.credits) })
              : priceUnavailable ? (
                <button type="button" onClick={onRetryPrice} className={cn('inline-flex items-center gap-1 underline underline-offset-4', RING)} data-testid="look-price-retry">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('sf_price_retry')}
                </button>
              ) : <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('sf_price_loading')}</span>}
          </p>
          <button type="button" onClick={onGenerate} disabled={!value || !price || busy} className={PRIMARY} data-testid="look-generate">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('dsx_ql_generate')}
          </button>
        </>
      )}>
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4" role="radiogroup" aria-label={t('dsx_ql_title')}>
        {LOOK_QUALITIES.map((q, i) => {
          const on = value === q;
          return (
            <button key={q} type="button" role="radio" aria-checked={on} onClick={() => onChange(q)}
              className={cn('relative flex min-h-[88px] flex-col justify-center rounded-[22px] bg-white px-5 py-4 text-start transition-shadow sm:min-h-[200px] sm:justify-start sm:p-7 lg:min-h-[240px]', RING, on ? 'ring-2 ring-[#0C1119]' : 'ring-1 ring-[#E7E1D8] hover:ring-[#B9AE9C]')}
              data-testid={`look-quality-${q}`}>
              <span className="hidden gap-1 sm:flex" aria-hidden="true">
                {[0, 1, 2].map((k) => <span key={k} className={cn('h-1.5 w-6 rounded-full', k <= i ? 'bg-[hsl(38_70%_52%)]' : 'bg-[#E7E1D8]')} />)}
              </span>
              <span className="text-[17px] font-semibold sm:mt-12 sm:text-[20px] lg:mt-16">{t(`sf_quality_${q.toLowerCase()}`)}</span>
              <span className="mt-1 text-[14px] leading-snug text-[#5B6472] sm:mt-2 sm:text-[15px]">{t(`sf_quality_${q.toLowerCase()}_line`)}</span>
              {on ? <span className="absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-[#0C1119] text-white" aria-hidden="true"><Check className="h-4 w-4" /></span> : null}
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
