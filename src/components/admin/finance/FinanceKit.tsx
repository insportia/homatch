import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usd, num, bps } from '@/services/finance';
import { AlertTriangle, Minus, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * Shared presentation pieces for the Financial Command Center.
 *
 * Two rules are enforced here rather than repeated on every screen:
 *
 *   1. A figure that is NOT KNOWN never renders as zero. Unpriced usage,
 *      an unconfigured payment provider and an uncalculable margin all read
 *      as themselves. "$0.00" is a claim, and making it by accident is how a
 *      cost centre disappears.
 *   2. Money is displayed, never computed. Every number arriving here was
 *      calculated in Postgres with exact numerics.
 */

/** The one big number. */
export function StatCard({
  label, value, sub, tone = 'neutral', unavailable, unavailableNote, icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'gold';
  unavailable?: boolean;
  unavailableNote?: string;
  icon?: React.ElementType;
}) {
  const { t } = useLanguage();
  const toneClass =
    tone === 'good' ? 'text-emerald-400'
    : tone === 'bad' ? 'text-red-400'
    : tone === 'gold' ? 'text-gold-ink'
    : 'text-foreground';

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      {unavailable ? (
        <>
          <p className="mt-1.5 text-lg font-semibold text-muted-foreground">
            {t('fin_not_configured')}
          </p>
          {unavailableNote && (
            <p className="mt-1 text-xs text-muted-foreground/80">{unavailableNote}</p>
          )}
        </>
      ) : (
        <>
          <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`} dir="ltr">
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  );
}

/** Money, with the "never silently zero" rule applied. */
export function Money({
  value, unknown, frac = 2, className = '',
}: { value: number | string | null | undefined; unknown?: boolean; frac?: number; className?: string }) {
  const { t } = useLanguage();
  if (unknown || value === null || value === undefined) {
    return <span className={`text-muted-foreground ${className}`}>{t('fin_unknown')}</span>;
  }
  return <span className={`tabular-nums ${className}`} dir="ltr">{usd(value, frac)}</span>;
}

export function Pct({ value }: { value: number | null | undefined }) {
  const { t } = useLanguage();
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">{t('fin_na')}</span>;
  }
  const n = Number(value);
  return (
    <span className={`tabular-nums ${n < 0 ? 'text-red-400' : ''}`} dir="ltr">{bps(n)}</span>
  );
}

export function Delta({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const n = Number(value);
  if (n === 0) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  const Icon = n > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${n > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="tabular-nums" dir="ltr">{usd(Math.abs(n))}</span>
    </span>
  );
}

const PILL_TONES: Record<string, string> = {
  good: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25',
  warn: 'bg-amber-500/12 text-amber-400 border-amber-500/25',
  bad: 'bg-red-500/12 text-red-400 border-red-500/25',
  gold: 'bg-gold-soft/40 text-gold-ink border-gold/30',
  muted: 'bg-muted/40 text-muted-foreground border-border/60',
};

export function Pill({
  children, tone = 'muted', title,
}: { children: React.ReactNode; tone?: keyof typeof PILL_TONES | string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium ${
        PILL_TONES[tone] ?? PILL_TONES.muted
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Unpriced usage, stated as itself. This is the whole reason the component
 * exists: measured units with no cost attached are real spend, and summing
 * them as zero is the single most misleading thing this dashboard could do.
 */
export function UnpricedBadge({ count, quantity }: { count: number; quantity?: number }) {
  const { t } = useLanguage();
  if (!count) return null;
  return (
    <Pill tone="warn" title={t('fin_unpriced_help')}>
      <AlertTriangle className="h-3 w-3" />
      {t('fin_unpriced')} · {num(count)}
      {quantity !== undefined && ` · ${num(quantity)}`}
    </Pill>
  );
}

/** A horizontal share bar, for "who is eating the money". */
export function ShareBar({ bpsValue, tone = 'gold' }: { bpsValue: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, Number(bpsValue) / 100));
  const bar = tone === 'gold' ? 'bg-gold' : 'bg-primary';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Wide tables must scroll inside themselves, never push the page sideways. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
