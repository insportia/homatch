// Small presentational pieces the builder steps share.
import React from 'react';
import { Check, AlertTriangle, XCircle, Loader2, CloudOff, CircleDot, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StepKey } from './steps';
import type { SaveState } from './useMetaDraft';

export function StepShell({ eyebrow, title, lead, children, 'data-mm-field': field }: {
  eyebrow?: string; title: string; lead?: React.ReactNode; children: React.ReactNode; 'data-mm-field'?: string;
}) {
  return (
    <section data-mm-field={field} className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
      {eyebrow && <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">{eyebrow}</p>}
      <h2 className="mt-1 font-display text-xl font-semibold text-foreground sm:text-2xl">{title}</h2>
      {lead && <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{lead}</div>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/** A large selectable card. `aria-pressed` makes the toggle state audible. */
export function ChoiceCard({ active, onClick, title, body, icon, disabled, badge }: {
  active: boolean; onClick: () => void; title: string; body?: string; icon?: React.ReactNode;
  disabled?: boolean; badge?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={cn(
        /* DEFAULT white card · HOVER gold edge · PRESSED settles · SELECTED gold
           ring + check (never colour alone) · DISABLED dashed with its reason
           in the badge, still readable — not a grey ghost. */
        'group relative flex min-h-11 w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-start shadow-sm transition-[border-color,box-shadow,transform] motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] focus-visible:ring-offset-1',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] ring-1 ring-[hsl(var(--gold-border))]'
          : 'border-border bg-card hover:border-[hsl(var(--gold-border))] hover:shadow-card active:scale-[0.99] motion-reduce:active:scale-100',
        disabled && 'cursor-not-allowed border-dashed bg-[hsl(var(--secondary))]/40 shadow-none hover:border-border hover:shadow-none active:scale-100',
      )}>
      {icon && <span className="mt-0.5 shrink-0 text-[hsl(var(--gold-ink))]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {badge && <span className="rounded-full border border-border bg-card px-2 py-px text-2xs font-medium text-muted-foreground">{badge}</span>}
        </span>
        {body && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{body}</span>}
      </span>
      <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))] text-[#161309]' : 'border-border')}>
        {active && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

export type Verdict = 'READY' | 'WARNING' | 'ACTION_REQUIRED' | 'INCOMPATIBLE';

export function VerdictBadge({ verdict, label }: { verdict: Verdict; label?: string }) {
  const { t } = useLanguage();
  const map = {
    READY: { cls: 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]', Icon: Check, key: 'madsb_verdict_ready' },
    WARNING: { cls: 'border-[hsl(32_78%_36%)]/30 bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_30%)]', Icon: AlertTriangle, key: 'madsb_verdict_warning' },
    ACTION_REQUIRED: { cls: 'border-destructive/30 bg-destructive/10 text-destructive', Icon: XCircle, key: 'madsb_verdict_action' },
    INCOMPATIBLE: { cls: 'border-destructive/30 bg-destructive/10 text-destructive', Icon: XCircle, key: 'madsb_verdict_incompatible' },
  }[verdict];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold', map.cls)}>
      <map.Icon className="h-3 w-3" />{label ?? t(map.key as never)}
    </span>
  );
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground" aria-live="polite">
      {state === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />{t('madsb_saving')}</>}
      {state === 'saved' && <><Check className="h-3 w-3 text-[hsl(152_54%_30%)]" />{t('madsb_saved')}</>}
      {state === 'error' && <><CloudOff className="h-3 w-3 text-destructive" />{t('madsb_save_failed')}</>}
    </span>
  );
}

export function Stepper({ steps, current, gaps, onGo, left = 0, onLeft }: {
  steps: readonly StepKey[]; current: StepKey; gaps: Record<StepKey, string | null>; onGo: (s: StepKey) => void;
  /** Steps that still need something; tapping goes to the first one's field. */
  left?: number; onLeft?: () => void;
}) {
  const { t } = useLanguage();
  const idx = steps.indexOf(current);
  return (
    <nav aria-label={t('madsb_steps_label')} data-madsb-stepper="">
      {/* Mobile: compact progress line. */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-semibold text-foreground">{t(`madsb_step_${current}` as never)}</span>
          <span className="text-muted-foreground" dir="ltr">{idx + 1} / {steps.length}</span>
        </div>
        {left > 0 && onLeft && (
          <button type="button" onClick={onLeft} data-mm-left={left}
            className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))]/70 bg-[hsl(var(--gold-soft))] px-3 text-[13px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]">
            <CircleDot className="h-3.5 w-3.5 text-[hsl(32_78%_40%)]" aria-hidden />{t('mm_r_left', { n: String(left) })}
          </button>
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
          <div className="h-full rounded-full bg-[hsl(var(--gold))] transition-all" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      {/* Desktop: the whole journey, every step reachable. */}
      <ol className="hidden space-y-1 lg:block">
        {steps.map((s, i) => {
          const done = !gaps[s];
          const active = s === current;
          return (
            <li key={s}>
              <button type="button" onClick={() => onGo(s)} aria-current={active ? 'step' : undefined}
                className={cn('flex min-h-11 w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm leading-snug transition-colors',
                  active ? 'bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'text-muted-foreground hover:bg-[hsl(var(--secondary))]')}>
                <span className={cn('mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full border text-2xs font-semibold',
                  done && i < idx ? 'border-[hsl(152_40%_40%)]/40 bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]'
                    : active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))] text-[#161309]' : 'border-border')}>
                  {done && i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {/* The whole name, wrapping onto a second line when needed — never an accidental "…". */}
                <span className="mt-0.5 min-w-0 flex-1 [overflow-wrap:break-word] [word-break:normal]">{t(`madsb_step_${s}` as never)}</span>
                {!done && i < idx && <CircleDot className="mt-1 h-3.5 w-3.5 shrink-0 text-[hsl(32_78%_40%)]" aria-label={t('madsb_step_incomplete')} />}
              </button>
            </li>
          );
        })}
      </ol>
      {left > 0 && onLeft && (
        <button type="button" onClick={onLeft} data-mm-left-desktop={left}
          className="mt-2 hidden min-h-11 w-full items-center gap-1.5 rounded-lg px-2.5 text-start text-[13px] font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] lg:flex">
          <CircleDot className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('mm_r_left', { n: String(left) })}
        </button>
      )}
    </nav>
  );
}

/* A short token joined by "/" or "-" ("Facebook/Instagram-ზე", "Wi-Fi") is
   one word to a reader: it may move to the next line but is never split.
   Longer tokens (URLs, codes) keep their normal break opportunities. */
const JOINED = /(\S*[/\u2010-\u2014-]\S*)/u;
export function keepWordsWhole(text: string): React.ReactNode {
  const parts = text.split(JOINED);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 && p.length <= 28 ? <span key={i} className="whitespace-nowrap">{p}</span> : p));
}

/**
 * One "label · value · edit" row that reflows instead of squeezing.
 *
 * At every width: the label on its own line, the value below it with the
 * whole width but the edit button, and the edit button beside the value — a
 * 44 px pencil on phones (named for screen readers), pencil + "Edit" from
 * `sm`. The value never shares its line with a fixed-width label, so normal
 * words are never broken letter by letter; words break only at word
 * boundaries (overflow-wrap: break-word, word-break: normal).
 */
export function SummaryRow({ label, value, onEdit, editLabel, dense = false }: {
  label: string; value: React.ReactNode; onEdit?: () => void; editLabel: string; dense?: boolean;
}) {
  return (
    <div data-mm-row="" className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5', dense ? 'py-1.5' : 'px-3.5 py-2.5')}>
      <dt className="col-start-1 row-start-1 min-w-0 text-[13px] leading-snug text-muted-foreground [overflow-wrap:break-word] [word-break:normal]">{label}</dt>
      <dd data-mm-row-value="" className="col-start-1 row-start-2 min-w-0 font-medium leading-snug text-foreground [overflow-wrap:break-word] [word-break:normal]" dir="auto">
        {typeof value === 'string' ? keepWordsWhole(value) : value}
      </dd>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={`${editLabel} · ${label}`} data-mm-row-edit=""
          className="col-start-2 row-span-2 row-start-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 self-center rounded-full px-2 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:bg-[hsl(var(--gold-soft))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] sm:px-3">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{editLabel}</span>
        </button>
      )}
    </div>
  );
}
