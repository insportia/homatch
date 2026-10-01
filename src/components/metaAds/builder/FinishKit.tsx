// The builder's guidance pieces: small cards that answer "what is this, why
// does it matter, what does HOMATCH recommend, do I need to do anything" —
// in a sentence or two, with an emoji as a visual anchor, never a lecture.
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Breadth } from '@/lib/metaAds/audienceGuide';
import type { LearningStage } from '@/lib/metaAds/analysis';

export type Tone = 'gold' | 'navy' | 'calm' | 'amber';

const TONES: Record<Tone, string> = {
  gold: 'border-[hsl(var(--gold-border))]/60 bg-gradient-to-br from-[hsl(var(--gold-soft))] to-[hsl(var(--gold-soft))]/40',
  navy: 'border-[#22324F] bg-gradient-to-br from-[#101A2C] to-[#0B1220] text-white',
  calm: 'border-border bg-card',
  amber: 'border-[hsl(32_78%_45%)]/35 bg-[hsl(32_78%_45%)]/[0.07]',
};

/** One idea, one card: an emoji, a short title, a sentence or two, an optional action. */
export function HelperCard({ emoji, title, children, tone = 'calm', action, className, ...rest }: {
  emoji: string; title: React.ReactNode; children?: React.ReactNode; tone?: Tone; action?: React.ReactNode; className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const dark = tone === 'navy';
  return (
    <div {...rest} className={cn('flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] leading-relaxed shadow-sm', TONES[tone], className)}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/70 text-base shadow-sm dark:bg-white/10" aria-hidden
        style={dark ? { background: 'rgba(255,255,255,0.08)' } : undefined}>{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-semibold', dark ? 'text-white' : 'text-foreground')}>{title}</span>
        {children && <span className={cn('mt-0.5 block', dark ? 'text-white/70' : 'text-muted-foreground')}>{children}</span>}
        {action && <span className="mt-2 flex flex-wrap gap-2">{action}</span>}
      </span>
    </div>
  );
}

/** A titled block inside a step: emoji anchor, heading, optional right-side slot. */
export function Section({ emoji, title, aside, children, id, className }: {
  emoji: string; title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; id?: string; className?: string;
}) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section aria-labelledby={hid} className={cn('space-y-3 rounded-2xl border border-border bg-card/60 p-3.5 sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={hid} className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <span aria-hidden className="text-base">{emoji}</span>{title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Progressive disclosure: the advanced detail stays folded until asked for. */
export function More({ label, children, defaultOpen = false, ...rest }: { label: string; children: React.ReactNode; defaultOpen?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div {...rest}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-[13px] font-medium text-[hsl(var(--gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
        {label}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="mt-2 animate-in fade-in-0 slide-in-from-top-1">{children}</div>}
    </div>
  );
}

/** Learning first, then optimisation — HOMATCH's practical first window, not a Meta guarantee. */
export function LearningCard({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <div data-mm-learning="" className="overflow-hidden rounded-2xl border border-[#22324F] bg-gradient-to-br from-[#101A2C] via-[#0E1729] to-[#0B1220] p-4 text-white shadow-hover">
      <div className={cn('grid gap-3', !compact && 'sm:grid-cols-2')}>
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-lg" aria-hidden>🧠</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('mm_f_learn_title')}</span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-white/70">{t('mm_f_learn_body')}</span>
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-lg" aria-hidden>📈</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t('mm_f_opt_title')}</span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-white/70">{t('mm_f_opt_body')}</span>
          </span>
        </div>
      </div>
      {!compact && <p className="mt-3 border-t border-white/10 pt-3 text-2xs leading-relaxed text-white/55">{t('mm_f_managed_note')}</p>}
    </div>
  );
}

/** Feedback on how broad the chosen area is — guidance, never a prediction. */
export function BreadthGuide({ breadth, areaKm2 }: { breadth: Breadth; areaKm2: number | null }) {
  const { t } = useLanguage();
  const emoji = breadth === 'VERY_SPECIFIC' ? '🎯' : breadth === 'BALANCED' ? '⚖️' : '🌍';
  const scale = breadth === 'VERY_SPECIFIC' ? 1 : breadth === 'BALANCED' ? 2 : 3;
  return (
    <div data-mm-breadth={breadth} className="flex items-start gap-3 rounded-2xl border border-border bg-card px-3.5 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[hsl(var(--gold-soft))] text-base" aria-hidden>{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{t(`mm_f_breadth_${breadth}`)}</span>
          <span className="flex gap-0.5" aria-hidden>
            {[1, 2, 3].map((i) => <span key={i} className={cn('h-1.5 w-5 rounded-full', i <= scale ? 'bg-[hsl(var(--gold))]' : 'bg-[hsl(var(--secondary))]')} />)}
          </span>
          {areaKm2 != null && <span className="text-2xs text-muted-foreground" dir="ltr">≈ {areaKm2.toLocaleString()} km²</span>}
        </span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{t(`mm_f_breadth_${breadth}_d`)}</span>
      </span>
    </div>
  );
}

/** A pill toggle used across the new sections. */
export function Pill({ active, onClick, children, ...rest }: { active: boolean; onClick: () => void; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} {...rest}
      className={cn('inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))] font-semibold text-[#161309] shadow-sm' : 'border-border bg-card text-foreground hover:border-[hsl(var(--gold-border))]')}>
      {children}
    </button>
  );
}

/**
 * A folded section: one row with the title and what is chosen now ("18–65+ ·
 * everyone"), opened to edit. The summary is text, so the state never depends
 * on colour; `aside` (a switch) stays reachable while folded.
 */
export function Fold({ id, emoji, title, summary, aside, defaultOpen = false, children }: {
  id: string; emoji: string; title: React.ReactNode; summary?: React.ReactNode; aside?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  const panel = `${id}-panel`;
  return (
    <section data-mm-fold-section={id} className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 pe-2">
        <button type="button" data-mm-fold={id} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
          <span aria-hidden className="text-base">{emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-snug text-foreground">{title}</span>
            {summary != null && !open && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground" dir="auto">{summary}</span>}
          </span>
          <span className="shrink-0 text-[13px] font-medium text-[hsl(var(--gold-ink))]">{open ? t('mm_m_done') : t('mm_m_edit')}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))] transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
        </button>
        {aside}
      </div>
      {open && <div id={panel} className="space-y-3 border-t border-border px-3.5 pb-3.5 pt-3">{children}</div>}
    </section>
  );
}

/** Where HOMATCH's learning is for this campaign (analysis.learningStage) — one sentence, never a promise. */
export function LearningStageCard({ stage }: { stage: LearningStage }) {
  const { t } = useLanguage();
  const emoji = stage === 'NEW' ? '🌱' : stage === 'COLLECTING' ? '⏳' : '📈';
  return (
    <div data-mm-learning-stage={stage} className="flex items-start gap-3 rounded-2xl border border-[#22324F] bg-gradient-to-br from-[#101A2C] to-[#0B1220] px-3.5 py-3 text-white">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-base" aria-hidden>{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t(`mm_m_stage_${stage}`)}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-white/75">{t(`mm_m_stage_${stage}_d`)}</span>
      </span>
    </div>
  );
}
