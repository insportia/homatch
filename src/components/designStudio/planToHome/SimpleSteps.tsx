// THE SIMPLE FIRST RUN — one task per screen, the home as the hero.
//
//   Upload → (understanding) → [one quick question, only if needed] →
//   Style → Next → Quality → Generate my home → (building) → the result.
//
// Every screen has ONE primary action, anchored to the bottom on a phone (the
// thumb's reach, inside the safe area) and inline on a large screen. Detail is
// never removed, only moved: the full plan review and the detailed look
// ("Customise details") are a quiet link away.

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FloorPlanDocument } from '@/services/developer/floorplan';
import type { PlanAnswer, PlanQuestion } from '@/lib/designStudio/planToHome';
import { LOOK_QUALITIES, LOOK_STYLES, type LookQuality, type LookStyle } from '@/lib/designStudio/lookPresets';
import { CUSTOMER_STAGES, customerStages, type StageState } from '@/lib/designStudio/customerStages';
import type { Stage } from '@/lib/designStudio/hybrid/contract';
import { cn } from '@/lib/utils';
import { PlanDrawing } from './PlanDrawing';
import { QuestionChoices, questionText, selectionFor } from './PlanReview';
import { StylePreview } from './StylePreview';

/** The calm surface every simple screen shares. */
export const SURFACE = 'bg-[#F7F4EF] text-[#0C1119]';
export const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F4EF]';
const PRIMARY = cn('inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[hsl(38_92%_56%)] px-7 text-[16px] font-semibold text-[#0C1119] transition-colors hover:bg-[hsl(38_92%_50%)] disabled:cursor-not-allowed disabled:bg-[#E4DDD1] disabled:text-[#4A5263] disabled:shadow-[inset_0_0_0_1px_#9C9180] disabled:hover:bg-[#E4DDD1] sm:w-auto sm:min-w-[240px]', RING);
const QUIET = cn('inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[#4A5263] underline-offset-4 hover:text-[#0C1119] hover:underline', RING);

/** A screen: an optional back, the one question it asks, its content, and its one action. */
function Screen({ title, body, eyebrow, onBack, children, action, aside, testId, wide = false, center = false }: {
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

// ── 1. Upload ──────────────────────────────────────────────────────────────

export function UploadStep({ onFile, error }: { onFile: (f: File) => void; error: string | null }) {
  const { t } = useLanguage();
  const [over, setOver] = useState(false);
  return (
    <Screen title={t('sf_upload_title')} body={t('sf_upload_body')} testId="simple-upload">
      <label
        className={cn('flex min-h-[44dvh] cursor-pointer flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed bg-white px-6 py-12 text-center transition-colors sm:min-h-[360px]',
          over ? 'border-[#0C1119] bg-[#FBFAF7]' : 'border-[#CFC6B8] hover:border-[#0C1119]', 'focus-within:ring-2 focus-within:ring-[hsl(38_92%_56%)]')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        data-testid="plan-drop"
      >
        <span className="grid h-16 w-16 place-items-center rounded-full bg-[hsl(38_92%_56%)] text-[#0C1119]" aria-hidden="true"><Upload className="h-7 w-7" /></span>
        <span className="text-[18px] font-semibold">{t('sf_upload_cta')}</span>
        <span className="text-[14px] text-[#5B6472]">{t('sf_upload_drop')}</span>
        <span className="text-[13px] text-[#5B6472]">{t('ds_fp_file_types')}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} data-testid="plan-file" />
      </label>
      {error ? <p role="alert" className="mt-4 rounded-2xl bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
      <p className="mt-5 text-center text-[13px] text-[#5B6472] sm:text-start">{t('ds_fp_privacy')}</p>
    </Screen>
  );
}

// ── 2. Understanding ───────────────────────────────────────────────────────

export function UnderstandingStep({ image, stage, since }: { image: string | null; stage: 'UPLOADING' | 'READING'; since: number }) {
  const { t } = useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const steps: Array<['UPLOADING' | 'READING', string]> = [['UPLOADING', 'sf_reading_upload'], ['READING', 'sf_reading_read']];
  const at = steps.findIndex(([s]) => s === stage);
  return (
    <Screen title={t('sf_reading_title')} testId="plan-reading">
      <div role="status" aria-live="polite" className="space-y-6">
        <div className="relative overflow-hidden rounded-[28px] bg-white">
          {image ? <img src={image} alt="" className="mx-auto max-h-[40dvh] w-auto object-contain opacity-80" /> : <div className="h-56" />}
          <div className="hm-plan-scan pointer-events-none absolute inset-x-0 h-24" aria-hidden="true" />
        </div>
        <ol className="space-y-3 text-[16px]">
          {steps.map(([s, key], i) => (
            <li key={s} className={cn('flex items-center gap-3', i < at ? 'text-[#5B6472]' : i === at ? 'font-medium' : 'text-[#646B78]')}>
              <span className="grid h-6 w-6 place-items-center" aria-hidden="true">
                {i === at ? <Loader2 className="h-5 w-5 animate-spin" /> : i < at ? <Check className="h-5 w-5 text-[hsl(152_55%_38%)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#C9CED6]" />}
              </span>
              {t(key)}
            </li>
          ))}
        </ol>
        <p className="text-[14px] text-[#5B6472]">{t('sf_reading_hint', { s: String(secs) })}</p>
      </div>
    </Screen>
  );
}

// ── 2b. One quick question (only when HOMATCH genuinely needs the customer) ──

export function QuickQuestionStep({ question, index, total, doc, imageUrl, onAnswer, onDetail, busy }: {
  question: PlanQuestion; index: number; total: number; doc: FloorPlanDocument; imageUrl: string | null;
  onAnswer: (a: PlanAnswer) => void; onDetail: () => void; busy: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Screen eyebrow={total > 1 ? t('sf_q_progress', { n: String(index + 1), total: String(total) }) : t('sf_q_eyebrow')}
      title={questionText(question, t, doc)} body={t('sf_q_body')} testId="quick-question"
      aside={<button type="button" onClick={onDetail} className={QUIET} data-testid="review-detail">{t('sf_review_detail')}</button>}>
      <div className="overflow-hidden rounded-[28px] bg-white">
        <PlanDrawing doc={doc} imageUrl={imageUrl} mode="CLEAN" selection={selectionFor(question, doc)} className="max-h-[38dvh]" />
      </div>
      <div className={cn('mt-6', busy && 'pointer-events-none opacity-60')}>
        <QuestionChoices q={question} onAnswer={onAnswer} large />
      </div>
    </Screen>
  );
}

// ── 3. Style ───────────────────────────────────────────────────────────────

export function StyleStep({ value, onChange, onNext, onDetail }: { value: LookStyle | null; onChange: (s: LookStyle) => void; onNext: () => void; onDetail: () => void }) {
  const { t } = useLanguage();
  return (
    <Screen wide title={t('sf_style_title')} body={t('sf_style_body')} testId="look-style"
      aside={<button type="button" onClick={onDetail} className={QUIET} data-testid="review-detail">{t('sf_review_detail')}</button>}
      action={<button type="button" onClick={onNext} disabled={!value} className={PRIMARY} data-testid="look-next">{t('sf_next')}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></button>}>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3" role="radiogroup" aria-label={t('sf_style_title')}>
        {LOOK_STYLES.map((s) => {
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

// ── 4. Quality ─────────────────────────────────────────────────────────────

export function QualityStep({ value, onChange, onBack, onGenerate, onCustomize, busy, price, priceUnavailable, onRetryPrice }: {
  value: LookQuality | null; onChange: (q: LookQuality) => void; onBack: () => void; onGenerate: () => void; onCustomize: () => void;
  busy: boolean; price: { credits: number; charged: boolean } | null; priceUnavailable: boolean; onRetryPrice: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Screen wide center title={t('sf_quality_title')} body={t('sf_quality_body')} onBack={onBack} testId="look-quality"
      aside={<button type="button" onClick={onCustomize} className={QUIET} data-testid="look-customize">{t('sf_customize')}</button>}
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
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t('sf_generate')}
          </button>
        </>
      )}>
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4" role="radiogroup" aria-label={t('sf_quality_title')}>
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

// ── 5. Building ────────────────────────────────────────────────────────────

const STATE_KEY: Record<StageState, string> = { PENDING: 'ds_gen_state_pending', RUNNING: 'ds_gen_state_running', DONE: 'ds_gen_state_done', SKIPPED: 'ds_gen_state_skipped' };

export function BuildingStep({ stages, since, failed, error, onRetry, busy }: {
  stages: Record<Stage, StageState>; since?: number; failed: boolean; error: string | null; onRetry: () => void; busy: boolean;
}) {
  const { t } = useLanguage();
  const shown = customerStages(stages);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = since ?? Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return (
    <Screen title={t('sf_building_title')} body={t('sf_building_body')} testId="plan-generating">
      <section role="status" aria-live="polite" className="rounded-[28px] bg-white p-5 sm:p-7" data-testid="generation-stages">
        <ol className="space-y-4">
          {CUSTOMER_STAGES.map((c) => {
            const st = shown[c];
            return (
              <li key={c} data-stage={c} data-state={st} className={cn('flex items-center gap-3 text-[16px]', st === 'PENDING' || st === 'SKIPPED' ? 'text-[#646B78]' : '')}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F7F4EF]" aria-hidden="true">
                  {st === 'RUNNING' ? <Loader2 className="h-4 w-4 animate-spin" /> : st === 'DONE' ? <Check className="h-4 w-4 text-[hsl(152_55%_38%)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#C9CED6]" />}
                </span>
                <span className={cn('min-w-0 flex-1', st === 'RUNNING' && 'font-semibold')}>{t(`sf_stage_${c.toLowerCase()}`)}</span>
                <span className="sr-only">{t(STATE_KEY[st])}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-6 border-t border-[#EFEAE2] pt-4 text-[13px] text-[#5B6472]" data-testid="generation-elapsed">
          {t('ds_gen_elapsed', { m: Math.floor(elapsed / 60), s: String(elapsed % 60).padStart(2, '0') })} · {t('sf_building_leave')}
        </p>
      </section>
      {failed ? (
        <div className="mt-5 space-y-3 text-center">
          {error ? <p role="alert" className="rounded-2xl bg-[hsl(0_66%_44%)]/10 px-4 py-3 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
          <button type="button" onClick={onRetry} disabled={busy} className={PRIMARY} data-testid="plan-retry">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('p2h_retry')}
          </button>
        </div>
      ) : null}
    </Screen>
  );
}
