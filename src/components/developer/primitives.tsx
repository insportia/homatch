import React from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { UnitStatus, LeadStage } from '@/services/developer/types';

/**
 * HOMATCH FOR DEVELOPERS — the small pieces every screen is made of.
 *
 * Everything here draws on the existing Homatch tokens (--gold, --gold-ink,
 * --sand, --border) rather than hex values, so the workspace inherits the
 * black / white / gold identity the rest of the product already has, and a
 * change to the palette reaches it (§167).
 *
 * Gold is a RULE, a MARK and a SELECTED STATE. It never fills a panel. That
 * restraint is the difference between the luxury surface the brief asks for
 * and the "crypto dashboard" it explicitly rules out.
 */

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Panel({
  className, children, as: Tag = 'section', ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' }) {
  return (
    <Tag
      className={cn(
        'rounded-lg border border-border bg-card',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title, description, action, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5',
      className,
    )}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** The thin gold rule that marks a section without filling anything. */
export function GoldRule({ className }: { className?: string }) {
  return <div className={cn('h-px w-10 bg-gold/70', className)} aria-hidden="true" />;
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn(
      'text-2xs font-semibold uppercase tracking-[0.14em] text-gold-ink',
      className,
    )}>
      {children}
    </p>
  );
}

// ── Numbers ────────────────────────────────────────────────────────────────

/**
 * Currency is formatted in the CURRENCY THE ROW IS IN, never converted to a
 * house currency (§162). A project priced in USD and one priced in GEL are
 * two different columns of money, and adding them without a rate somebody can
 * point at would be inventing a figure.
 */
export function formatMoney(
  amount: number | null | undefined, currency: string | null | undefined, locale = 'en',
): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    // An unknown ISO code must not blank the figure out.
    return `${new Intl.NumberFormat(locale).format(value)} ${currency ?? ''}`.trim();
  }
}

export function formatNumber(value: number | null | undefined, locale = 'en', digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(value));
}

export function formatArea(value: number | null | undefined, locale = 'en'): string {
  if (value === null || value === undefined) return '—';
  return `${formatNumber(value, locale, Number(value) % 1 === 0 ? 0 : 1)} m²`;
}

export function Money({
  amount, currency, className,
}: { amount: number | null | undefined; currency: string | null | undefined; className?: string }) {
  const { lang: language } = useLanguage();
  return (
    <span className={cn('tabular', className)}>{formatMoney(amount, currency, language)}</span>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * STATUS IS NEVER COLOUR ALONE (§16, §89).
 *
 * Every pill carries its word. The colour is a second, faster channel for
 * people who can use it; the text is the one that always works — in a
 * screenshot, in high contrast mode, for a colour-blind sales director
 * scanning a floor plate.
 */
const UNIT_STATUS_STYLE: Record<UnitStatus, string> = {
  AVAILABLE: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  ON_HOLD: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
  NEGOTIATION: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/[0.07]',
  RESERVED: 'border-gold-border text-gold-ink bg-gold/[0.08]',
  CONTRACT_PENDING: 'border-violet-600/40 text-violet-700 dark:text-violet-400 bg-violet-500/[0.07]',
  SOLD: 'border-border text-muted-foreground bg-muted/60',
  HIDDEN: 'border-dashed border-border text-muted-foreground bg-transparent',
};

export const UNIT_STATUS_KEYS: Record<UnitStatus, string> = {
  AVAILABLE: 'dev_unit_status_available',
  ON_HOLD: 'dev_unit_status_on_hold',
  NEGOTIATION: 'dev_unit_status_negotiation',
  RESERVED: 'dev_unit_status_reserved',
  CONTRACT_PENDING: 'dev_unit_status_contract_pending',
  SOLD: 'dev_unit_status_sold',
  HIDDEN: 'dev_unit_status_hidden',
};

export function UnitStatusPill({ status, className }: { status: UnitStatus; className?: string }) {
  const { t } = useLanguage();
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
      UNIT_STATUS_STYLE[status], className,
    )}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(UNIT_STATUS_KEYS[status])}
    </span>
  );
}

export const LEAD_STAGE_KEYS: Record<LeadStage, string> = {
  NEW: 'dev_stage_new',
  QUALIFIED: 'dev_stage_qualified',
  CONTACTED: 'dev_stage_contacted',
  INTERESTED: 'dev_stage_interested',
  VIEWING_SCHEDULED: 'dev_stage_viewing_scheduled',
  VIEWING_COMPLETED: 'dev_stage_viewing_completed',
  NEGOTIATION: 'dev_stage_negotiation',
  RESERVATION: 'dev_stage_reservation',
  CONTRACT: 'dev_stage_contract',
  PAYMENT_PENDING: 'dev_stage_payment_pending',
  SOLD: 'dev_stage_sold',
  LOST: 'dev_stage_lost',
};

export function StagePill({ stage, className }: { stage: LeadStage; className?: string }) {
  const { t } = useLanguage();
  const tone = stage === 'LOST'
    ? 'border-border text-muted-foreground bg-muted/60'
    : stage === 'SOLD'
      ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]'
      : 'border-gold-border/60 text-gold-ink bg-gold/[0.06]';
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
      tone, className,
    )}>
      {t(LEAD_STAGE_KEYS[stage])}
    </span>
  );
}

export function PaymentStatusPill({ status }: { status: 'PAID' | 'OVERDUE' | 'PARTIAL' | 'PENDING' }) {
  const { t } = useLanguage();
  const tone = {
    PAID: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
    OVERDUE: 'border-red-600/45 text-red-700 dark:text-red-400 bg-red-500/[0.07]',
    PARTIAL: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/[0.07]',
    PENDING: 'border-border text-muted-foreground bg-muted/60',
  }[status];
  const key = {
    PAID: 'dev_pay_paid', OVERDUE: 'dev_pay_overdue',
    PARTIAL: 'dev_pay_partial', PENDING: 'dev_pay_pending',
  }[status];
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
      tone,
    )}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(key)}
    </span>
  );
}

// ── States ─────────────────────────────────────────────────────────────────

/**
 * An empty state says what is missing and offers the one action that fixes
 * it (§85). It never draws a chart of nothing, and it never invents a row to
 * make the screen look inhabited.
 */
/**
 * AN EMPTY SCREEN IS STILL A SCREEN.
 *
 * A new customer sees more of these than anything else in their first hour,
 * and the version this replaced was a small grey icon and two lines of text
 * marooned in the middle of a very large white field — which reads as an
 * unfinished product rather than as a product with nothing in it yet.
 *
 * Three things changed and none of them is decoration. The panel is given a
 * floor so it occupies the space it is standing in. The icon sits in a ruled
 * plate rather than floating. And `steps` lets a first-run state say what to
 * do FIRST, SECOND, THIRD — the one moment where the product has to explain
 * itself and has nothing but words to do it with.
 */
export function EmptyState({
  icon, title, description, action, steps, className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** An ordered route out of the empty state, for first-run screens. */
  steps?: string[];
  className?: string;
}) {
  return (
    <div className={cn(
      'flex min-h-[18rem] flex-col items-center justify-center gap-4 px-6 py-16 text-center',
      className,
    )}>
      {icon && (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground/70"
        >
          {icon}
        </div>
      )}
      <div className="max-w-md space-y-1.5">
        <p className="text-lg font-semibold tracking-tight">{title}</p>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {steps && steps.length > 0 && (
        <ol className="mt-1 w-full max-w-sm space-y-2 text-left">
          {steps.map((step, i) => (
            <li key={step} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold-border/60 text-2xs font-semibold tabular text-gold-ink"
              >
                {i + 1}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {action}
    </div>
  );
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={cn('space-y-2 p-4', className)} role="status" aria-live="polite">
      <span className="sr-only">{t('dev_loading')}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md bg-muted/70"
          style={{ animationDelay: `${i * 60}ms` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function ErrorState({
  message, onRetry, className,
}: { message?: string | null; onRetry?: () => void; className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={cn('px-6 py-12 text-center', className)} role="alert">
      <p className="text-sm font-medium">{t('dev_err_generic')}</p>
      {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-gold-ink underline underline-offset-4"
        >
          {t('dev_retry')}
        </button>
      )}
    </div>
  );
}

/** Shown where a role legitimately cannot see something, instead of a blank panel. */
export function PermissionState({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={cn('px-6 py-12 text-center', className)}>
      <p className="text-sm font-medium">{t('dev_no_permission_title')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('dev_no_permission_body')}</p>
    </div>
  );
}

// ── Figures ────────────────────────────────────────────────────────────────

/**
 * A number with the thing it counts, and — when there is one — the single
 * action that number implies. No sparkline, no percentage change against a
 * period we have not measured (§10: no fake urgency, no fake data).
 */
export function StatTile({
  label, value, hint, tone = 'default', onClick, className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'attention' | 'good';
  onClick?: () => void;
  className?: string;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-left',
        onClick && 'transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {tone === 'attention' && (
        <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-amber-500" />
      )}
      {tone === 'good' && (
        <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-emerald-500" />
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular tracking-tight">{value}</span>
      {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
    </Wrapper>
  );
}

/**
 * A table that scrolls INSIDE itself. The page body must never scroll
 * sideways (§82), and an inventory table with twenty columns will always be
 * wider than a phone.
 */
export function TableScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)} tabIndex={0} role="region">
      {children}
    </div>
  );
}

export function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('whitespace-nowrap px-3 py-2.5 text-sm', className)} {...rest}>
      {children}
    </td>
  );
}

/** A definition pair, used everywhere a drawer lists facts about one thing. */
export function Fact({
  label, value, className,
}: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export function relativeTime(iso: string | null | undefined, locale = 'en'): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minute = 60000, hour = 3600000, day = 86400000;
  if (abs < hour) return rtf.format(Math.round(diff / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < day * 30) return rtf.format(Math.round(diff / day), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(then);
}

export function formatDate(iso: string | null | undefined, locale = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(iso: string | null | undefined, locale = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
