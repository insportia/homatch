// HOMATCH Communications — the pieces every screen in this product area uses.
//
// §78 and §79. One set of primitives so the Overview, the Calls table, the
// Inbox and Analytics look like one product rather than four, and so §80's
// list of required states — loading, empty, error, disabled, permission
// denied, provider unavailable, partial data — is implemented once instead of
// being re-invented, differently, on every page.
//
// COLOUR
//
// Black, white, cool neutral grey, restrained gold. Gold marks the premium or
// high-value thing, never an ordinary button. Status colours are semantic and
// come from the theme, so they survive light and dark. No beige, no sand, no
// gradient.

import React from 'react';
import { AlertCircle, Inbox, Loader2, Lock, PlugZap, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

// ── KPI ─────────────────────────────────────────────────────────────────────

export interface KpiProps {
  labelKey: string;
  value: string | number | null;
  /** Rendered under the value. Already formatted. */
  sub?: string | null;
  /** Marks the one figure on a row that is the headline. Used sparingly. */
  accent?: boolean;
  loading?: boolean;
  /** A quiet glyph, so a row of six numbers is scannable rather than uniform. */
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * A single number.
 *
 * `null` renders an em-dash-free placeholder, not a zero. §93: a rate over
 * zero attempts is unknown, and showing 0% would be a confident lie about an
 * account that has simply not started yet.
 */
export function Kpi({ labelKey, value, sub, accent, loading, icon: Icon }: KpiProps) {
  const { t } = useLanguage();
  return (
    <Card className={cn(
      'min-w-0 transition-colors',
      accent ? 'border-gold/40 bg-gold/[0.04]' : 'hover:border-foreground/15',
    )}>
      <CardContent className="flex min-h-[5.5rem] flex-col p-3 sm:p-4">
        <div className="flex items-start gap-1.5">
          {/*
           * NOT `truncate`.
           *
           * These labels were sized around English. "Answer rate" is eleven
           * characters; "პასუხის მაჩვენებელი" is nineteen, and Georgian has no
           * shorter form of it. Truncating cut the word in half on every
           * Georgian screen, which is how a KPI ends up reading "პასუხის მაჩ…".
           * Two lines of label is the correct answer; a clipped word is not.
           */}
          <p data-kpi-label className="min-w-0 flex-1 text-[13px] font-medium uppercase leading-[1.25] tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
            {t(labelKey as TKey)}
          </p>
          {Icon ? <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', accent ? 'text-gold-ink' : 'text-muted-foreground/60')} aria-hidden="true" /> : null}
        </div>
        {loading ? (
          <Skeleton className="mt-auto h-7 w-20" />
        ) : (
          <p className={cn('mt-auto pt-1.5 text-xl font-semibold tabular-nums sm:text-2xl', accent && 'text-gold-ink')}>
            {value === null || value === undefined ? <span className="text-muted-foreground">·</span> : value}
          </p>
        )}
        {sub ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export function KpiRow({ children, cols = 6 }: { children: React.ReactNode; cols?: number }) {
  // Two across on the narrowest phone. One across would make a six-KPI row
  // taller than the screen and push the actual content off it.
  return (
    <div
      className={cn(
        'grid gap-2 sm:gap-3',
        'grid-cols-2 sm:grid-cols-3',
        cols >= 6 ? 'lg:grid-cols-6' : cols === 5 ? 'lg:grid-cols-5' : cols === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

// ── Page states (§80) ───────────────────────────────────────────────────────

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  titleKey: string;
  bodyKey?: string;
  action?: { labelKey: string; onClick: () => void };
  secondary?: { labelKey: string; onClick: () => void };
}

export function EmptyState({ icon: Icon = Inbox, titleKey, bodyKey, action, secondary }: EmptyStateProps) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{t(titleKey as TKey)}</p>
      {bodyKey ? <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t(bodyKey as TKey)}</p> : null}
      {(action || secondary) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action ? <Button size="sm" onClick={action.onClick}>{t(action.labelKey as TKey)}</Button> : null}
          {secondary ? (
            <Button size="sm" variant="outline" onClick={secondary.onClick}>{t(secondary.labelKey as TKey)}</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A persistent failure.
 *
 * §80: "For major persistent errors: use inline state, not only toast." A
 * toast that has already faded is not an explanation of why the page is empty.
 */
export function ErrorState({ messageKey, detail, onRetry }: { messageKey: string; detail?: string | null; onRetry?: () => void }) {
  const { t } = useLanguage();
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs">
          {t(messageKey as TKey)}
          {detail ? <span className="ms-1 opacity-70">{detail}</span> : null}
        </span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {t('comm_retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function PermissionDenied() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <Lock className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{t('comm_permission_denied')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('comm_permission_denied_body')}</p>
    </div>
  );
}

/**
 * A channel that cannot be used right now.
 *
 * §92 and §106: the customer is told the channel is unavailable. They are not
 * told which secret is missing, which provider failed or what the fallback
 * order is — that is Admin's business.
 */
export function ProviderUnavailable({ channelKey }: { channelKey: string }) {
  const { t } = useLanguage();
  return (
    <Alert>
      <PlugZap className="h-4 w-4" />
      <AlertDescription className="text-xs">
        {t('comm_channel_unavailable').replace('{channel}', t(channelKey as TKey))}
      </AlertDescription>
    </Alert>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  // Live
  DIALING: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  RINGING: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ANSWERED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  RUNNING: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  // Settled well
  COMPLETED: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  DELIVERED: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  READ: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  APPROVED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  CONNECTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  HEALTHY: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  // Settled badly
  FAILED: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  REJECTED: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  DOWN: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  ACTION_REQUIRED: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  COMPLIANCE_PAUSED: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  // Needs a person
  REVIEW_REQUIRED: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  DEGRADED: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  PAUSED: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  // Premium / high value
  QUALIFIED: 'border-gold/50 bg-gold/10 text-gold-ink',
};

/**
 * §84: status is never conveyed by colour alone. Every badge carries its own
 * translated word, and the colour is reinforcement.
 */
export function StatusBadge({ status, labelKey }: { status: string; labelKey?: string }) {
  const { t } = useLanguage();
  const key = labelKey ?? `comm_status_${status.toLowerCase()}`;
  const label = t(key as TKey);
  return (
    <Badge
      variant="outline"
      className={cn('whitespace-nowrap text-[13px] font-medium', STATUS_TONE[status] ?? 'text-muted-foreground')}
    >
      {/* A missing translation key renders as the key itself in this i18n
          system, which would be worse than the raw status. */}
      {label === key ? status.replace(/_/g, ' ').toLowerCase() : label}
    </Badge>
  );
}

/** §131: a customer sees Ready / Needs review / Paused for safety. Nothing more. */
export function ComplianceBadge({ state }: { state: 'READY' | 'NEEDS_REVIEW' | 'PAUSED_FOR_SAFETY' | 'BLOCKED' }) {
  const { t } = useLanguage();
  const map = {
    READY: { key: 'comm_compliance_ready', tone: STATUS_TONE.APPROVED },
    NEEDS_REVIEW: { key: 'comm_compliance_needs_review', tone: STATUS_TONE.REVIEW_REQUIRED },
    PAUSED_FOR_SAFETY: { key: 'comm_compliance_paused', tone: STATUS_TONE.COMPLIANCE_PAUSED },
    BLOCKED: { key: 'comm_compliance_paused', tone: STATUS_TONE.COMPLIANCE_PAUSED },
  }[state];
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap text-[13px]', map.tone)}>
      {t(map.key as TKey)}
    </Badge>
  );
}

/** A live indicator that does not rely on animation alone to say "live". */
export function LiveDot({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function PageHeader({
  eyebrow, title, subtitle, primary, secondary, children,
}: {
  /**
   * WHICH PRODUCT THIS SCREEN BELONGS TO.
   *
   * Contacts, Numbers and Analytics are one component serving three products,
   * so the title alone ("Numbers") is ambiguous in the one way that matters:
   * it does not say whose. The eyebrow is the breadcrumb -- "AI Calls" above
   * "Numbers" -- and it is omitted on the genuinely cross-channel screens,
   * where there is no single product to name and inventing one would be worse
   * than saying nothing.
   */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  primary?: { label: string; onClick: () => void; busy?: boolean };
  secondary?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-ink">{eyebrow}</p>
        ) : null}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {secondary ? (
          <Button size="sm" variant="outline" onClick={secondary.onClick}>{secondary.label}</Button>
        ) : null}
        {primary ? (
          <Button size="sm" onClick={primary.onClick} disabled={primary.busy}>
            {/* §80: a mutation button shows progress and cannot be double-fired. */}
            {primary.busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {primary.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A table that scrolls inside itself rather than pushing the page sideways.
 *
 * §81: no horizontal page overflow at 320px. The scroll is deliberate and
 * contained; the page body never moves.
 */
export function ScrollTable({ children, minWidth = 760 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatUsd(value: number | null | undefined, locale = 'en'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '·';
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD',
    // Sub-cent amounts are real here: a single WhatsApp message can cost less
    // than a cent, and rounding it to $0.00 makes a spend column look broken.
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '·';
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '·';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A phone number, shown to its owner in full.
 *
 * Redaction belongs in logs and telemetry (§74), not on a screen where the
 * person looking at it is the one who imported the number and needs to dial it.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '·';
  return e164;
}

export function relativeTime(iso: string | null | undefined, locale = 'en'): string {
  if (!iso) return '·';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '·';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(diffSec / 86_400), 'day');
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
}
